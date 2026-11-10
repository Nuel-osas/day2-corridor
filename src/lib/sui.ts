// The Sui side of CCTP V2, signed by the user's own Sui wallet through Wallet Standard.
// Burn: deposit_for_burn -> handler::burn -> complete_burn (one PTB, hot potatoes keep it atomic).
// Mint: receive_message -> prepare_mint -> handler::mint -> complete_mint (shared/corridor.ts).
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction, coinWithBalance } from '@mysten/sui/transactions';
import { normalizeSuiAddress, toBase64 } from '@mysten/sui/utils';
import type { Wallet } from '@mysten/wallet-standard';
import type { Hex } from 'viem';
import { BASE_SEPOLIA, CORRIDOR, FINALITY, SUI } from '../../shared/config';
import { addReceive, addSend } from '../../shared/corridor';
import { api } from './api';

export const sui = new SuiGrpcClient({ network: SUI.network, baseUrl: SUI.grpc });
const CHAIN = `sui:${SUI.network}` as const;
const { tokenMessengerMinter: TMM, messageTransmitter: MT, stablecoinHandler: HANDLER } = SUI;

type SignExec = { signAndExecuteTransaction: (i: { transaction: Transaction; account: unknown; chain: string }) => Promise<{ digest: string }> };
type Sign = { signTransaction: (i: { transaction: Transaction; account: unknown; chain: string }) => Promise<{ bytes: string; signature: string }> };

const account = (w: Wallet, owner: string) => w.accounts.find((a) => a.address === owner) ?? w.accounts[0];

/** The wallet signs and executes. coinWithBalance is resolved first, so the wallet sees plain inputs. */
async function execute(w: Wallet, owner: string, tx: Transaction) {
	tx.setSender(owner);
	await tx.prepareForSerialization({ client: sui });
	const f = w.features['sui:signAndExecuteTransaction'] as SignExec | undefined;
	if (!f) throw new Error(`${w.name} cannot sign Sui transactions`);
	const { digest } = await f.signAndExecuteTransaction({ transaction: tx, account: account(w, owner), chain: CHAIN });
	const r = await sui.core.waitForTransaction({ digest, include: { effects: true } });
	const t = r.Transaction ?? r.FailedTransaction!;
	if (!t.status.success) throw new Error(`Sui transaction ${digest} failed: ${JSON.stringify(t.status.error)}`);
	return digest;
}

/** Sui -> anywhere, the user pays the SUI. Finality 2000: Sui is standard only, and final in a second. */
export async function suiBurn(o: { wallet: Wallet; owner: string; amount: bigint; destDomain: number; recipient32: string }) {
	const tx = new Transaction();
	const coin = tx.add(coinWithBalance({ type: SUI.usdc, balance: o.amount }));
	const [receipt, rest] = tx.moveCall({
		target: `${TMM.pkg}::deposit_for_burn::deposit_for_burn`,
		typeArguments: [SUI.usdc],
		arguments: [
			coin, tx.pure.u32(o.destDomain), tx.pure.address(o.recipient32), tx.pure.address('0x0'),
			tx.pure.u256(0n), tx.pure.u32(FINALITY.standard), tx.pure.vector('u8', []), tx.object(TMM.state),
		],
	});
	const [ticket] = tx.moveCall({
		target: `${HANDLER.pkg}::handler::burn`,
		arguments: [tx.object(HANDLER.state), receipt, rest, tx.object(SUI.denyList), tx.object(SUI.usdcTreasury)],
	});
	tx.moveCall({
		target: `${TMM.pkg}::deposit_for_burn::complete_burn`,
		typeArguments: [SUI.usdc, `${HANDLER.pkg}::handler::Auth`],
		arguments: [ticket, tx.object(TMM.state), tx.object(MT.state)],
	});
	return execute(o.wallet, o.owner, tx);
}

/** anywhere -> Sui, the user claims and pays the SUI. Anyone may submit when destinationCaller is zero. */
export async function suiMint(o: { wallet: Wallet; owner: string; message: Hex; attestation: Hex }) {
	const tx = new Transaction();
	addReceive(tx, o.message, o.attestation);
	return execute(o.wallet, o.owner, tx);
}

/**
 * Sui -> Base Sepolia through Corridor: corridor::send takes the fee in the same PTB as the burn, the
 * operator pays the gas (the user needs 0 SUI) and Corridor's relayer mints on Base.
 * The wallet signs bytes we built with the operator as gas owner; the API co-signs and executes.
 */
export async function corridorSend(o: { wallet: Wallet; owner: string; amount: bigint; evmRecipient: string }) {
	const tx = new Transaction();
	tx.setSender(o.owner);
	tx.setGasOwner(CORRIDOR.operator);
	tx.setGasPayment([]);
	addSend(tx, { amount: o.amount, destinationDomain: BASE_SEPOLIA.domain, mintRecipient: o.evmRecipient });
	const built = await tx.build({ client: sui });
	const f = o.wallet.features['sui:signTransaction'] as Sign | undefined;
	if (!f) throw new Error(`${o.wallet.name} cannot sign a sponsored transaction`);
	const signed = await f.signTransaction({ transaction: Transaction.from(built), account: account(o.wallet, o.owner), chain: CHAIN });
	// Send exactly the bytes the wallet signed; the API checks its sponsor policy against them.
	const out = await api<{ digest: string; ok: boolean; error: unknown }>('/api/sponsor', { txBytes: signed.bytes || toBase64(built), signature: signed.signature });
	if (!out.ok) throw new Error(`Burn ${out.digest} failed on chain: ${JSON.stringify(out.error)}`);
	return out.digest;
}

/** USDC and SUI in base units. A failed read is unknown (null), never zero. */
export async function suiBalances(owner: string) {
	const [usdc, gas] = await Promise.all([
		sui.core.getBalance({ owner, coinType: SUI.usdc }).then((b) => BigInt(b.balance.balance)).catch(() => null),
		sui.core.getBalance({ owner, coinType: '0x2::sui::SUI' }).then((b) => BigInt(b.balance.balance)).catch(() => null),
	]);
	return { usdc, gas };
}

export const suiAddress32 = (a: string) => normalizeSuiAddress(a);
