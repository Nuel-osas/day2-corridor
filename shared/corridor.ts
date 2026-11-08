// The two programmable transactions Corridor is made of, shared by the app, the API and the scripts.
import { coinWithBalance, type Transaction } from '@mysten/sui/transactions';
import { fromHex, normalizeSuiAddress } from '@mysten/sui/utils';
import { keccak256, toBytes, type Hex } from 'viem';
import { CORRIDOR, FINALITY, SUI } from './config.js';

const { tokenMessengerMinter: TMM, messageTransmitter: MT, stablecoinHandler: HANDLER } = SUI;

/** An EVM address as the 32 bytes CCTP uses for mint recipients and callers. */
export const evmToBytes32 = (evm: string) => normalizeSuiAddress(evm.toLowerCase());

/** What CCTP writes as message_sender for a package-auth burn: keccak256 of the witness type name. */
export const corridorSender = (pkg = CORRIDOR.pkg) =>
	keccak256(toBytes(`${normalizeSuiAddress(pkg).slice(2)}::corridor::CorridorAuth`));

/**
 * Sui -> EVM. One PTB, four calls:
 *   corridor::send        takes the fee, returns Circle's package-auth burn ticket
 *   deposit_for_burn_with_package_auth   validates, returns BurnReceipt + the coin
 *   handler::burn         burns the coin with the USDC MintCap, returns CompleteBurnTicket
 *   complete_burn         sends the CCTP message and emits DepositForBurn
 */
export function addSend(
	tx: Transaction,
	o: { amount: bigint; destinationDomain: number; mintRecipient: string; circleMaxFee?: bigint },
) {
	const ticket = tx.moveCall({
		target: `${CORRIDOR.pkg}::corridor::send`,
		typeArguments: [SUI.usdc],
		arguments: [
			tx.object(CORRIDOR.corridorId),
			coinWithBalance({ type: SUI.usdc, balance: o.amount }),
			tx.pure.u32(o.destinationDomain),
			tx.pure.address(evmToBytes32(o.mintRecipient)),
			tx.pure.u64(o.circleMaxFee ?? 0n),
			tx.pure.u32(FINALITY.standard),
		],
	});
	const [receipt, coin] = tx.moveCall({
		target: `${TMM.pkg}::deposit_for_burn::deposit_for_burn_with_package_auth`,
		typeArguments: [SUI.usdc, `${CORRIDOR.pkg}::corridor::CorridorAuth`],
		arguments: [ticket, tx.object(TMM.state)],
	});
	const complete = tx.moveCall({
		target: `${HANDLER.pkg}::handler::burn`,
		arguments: [tx.object(HANDLER.state), receipt, coin, tx.object(SUI.denyList), tx.object(SUI.usdcTreasury)],
	});
	tx.moveCall({
		target: `${TMM.pkg}::deposit_for_burn::complete_burn`,
		typeArguments: [SUI.usdc, `${HANDLER.pkg}::handler::Auth`],
		arguments: [complete, tx.object(TMM.state), tx.object(MT.state)],
	});
}

/**
 * EVM -> Sui. Anyone may submit this once Circle has attested, so the relayer pays the gas and
 * the recipient needs no SUI. Copied from live testnet mints:
 *   receive_message -> prepare_mint<USDC> -> handler::mint -> complete_mint<USDC, Auth>
 */
export function addReceive(tx: Transaction, message: Hex, attestation: Hex) {
	const receipt = tx.moveCall({
		target: `${MT.pkg}::receive_message::receive_message`,
		arguments: [tx.pure.vector('u8', fromHex(message)), tx.pure.vector('u8', fromHex(attestation)), tx.object(MT.state)],
	});
	const mintReceipt = tx.moveCall({
		target: `${TMM.pkg}::handle_receive_message::prepare_mint`,
		typeArguments: [SUI.usdc],
		arguments: [receipt, tx.object(TMM.state), tx.object(SUI.clock)],
	});
	const ticket = tx.moveCall({
		target: `${HANDLER.pkg}::handler::mint`,
		arguments: [tx.object(HANDLER.state), mintReceipt, tx.object(TMM.state), tx.object(SUI.usdcTreasury), tx.object(SUI.denyList)],
	});
	tx.moveCall({
		target: `${TMM.pkg}::handle_receive_message::complete_mint`,
		typeArguments: [SUI.usdc, `${HANDLER.pkg}::handler::Auth`],
		arguments: [ticket, tx.object(TMM.state), tx.object(MT.state)],
	});
}

/** Read-only: has this CCTP nonce already been used on Sui? */
export function addIsNonceUsed(tx: Transaction, nonce: Hex) {
	tx.moveCall({
		target: `${MT.pkg}::state::is_nonce_used`,
		arguments: [tx.object(MT.state), tx.pure.u256(BigInt(nonce))],
	});
}

/** The fee Corridor will take, computed exactly as corridor::fee_for does on chain. */
export function quote(gross: bigint, feeBps: number, minFee: bigint) {
	const proportional = (gross * BigInt(feeBps)) / 10_000n;
	const fee = proportional > minFee ? proportional : minFee;
	return { fee, net: gross > fee ? gross - fee : 0n };
}

export const fmtUsdc = (units: bigint | null | undefined) =>
	units == null ? 'unknown' : (Number(units) / 10 ** SUI.usdcDecimals).toLocaleString('en-GB', { maximumFractionDigits: 6 });

export const parseUsdc = (s: string) => {
	if (!/^\d+(\.\d{1,6})?$/.test(s.trim())) return null;
	const [w, f = ''] = s.trim().split('.');
	return BigInt(w) * 1_000_000n + BigInt(f.padEnd(6, '0'));
};
