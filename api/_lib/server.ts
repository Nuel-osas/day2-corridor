// Server-only. Keys come from the environment and never reach the browser.
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction } from '@mysten/sui/transactions';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { createPublicClient, createWalletClient, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { CORRIDOR, SUI } from '../../shared/config.js';

export const sui = new SuiGrpcClient({ network: SUI.network, baseUrl: SUI.grpc });

let operator: Ed25519Keypair | undefined;
/** Sponsors user gas on Sui and pays for inbound mints. Holds the CorridorAdminCap. */
export function getOperator() {
	if (!operator) {
		const secret = process.env.OPERATOR_SECRET_KEY;
		if (!secret) throw new Error('OPERATOR_SECRET_KEY is not set');
		operator = Ed25519Keypair.fromSecretKey(secret);
	}
	return operator;
}

const rpc = () => http(process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org');
export const base = createPublicClient({ chain: baseSepolia, transport: rpc() });
export function getRelayer() {
	const key = process.env.RELAYER_EVM_KEY;
	if (!key) throw new Error('RELAYER_EVM_KEY is not set');
	const account = privateKeyToAccount(key as Hex);
	return createWalletClient({ account, chain: baseSepolia, transport: rpc() });
}

export const MAX_GAS_BUDGET = 100_000_000n; // 0.1 SUI

const short = (pkg: string) => normalizeSuiAddress(pkg).replace(/^0x0+(?=[0-9a-f])/, '0x');
const { tokenMessengerMinter: TMM, stablecoinHandler: HANDLER } = SUI;

// Only Corridor's own flow is sponsored. The coin helpers are what coinWithBalance emits when it
// gathers the sender's USDC from coins and address balance.
const ALLOWED_TARGETS = new Set([
	`${short(CORRIDOR.pkg)}::corridor::send`,
	`${short(TMM.pkg)}::deposit_for_burn::deposit_for_burn_with_package_auth`,
	`${short(HANDLER.pkg)}::handler::burn`,
	`${short(TMM.pkg)}::deposit_for_burn::complete_burn`,
	'0x2::coin::redeem_funds',
	'0x2::balance::redeem_funds',
	'0x2::coin::from_balance',
	'0x2::coin::into_balance',
	'0x2::coin::send_funds',
	'0x2::coin::split',
	'0x2::coin::join',
	'0x2::coin::zero',
]);

/**
 * A sponsor signs as a required signer, so anything it owns is reachable from the transaction.
 * This policy stops a user from spending the operator's coins, its address balance, or its
 * CorridorAdminCap, and refuses anything that is not a Corridor send.
 */
export async function checkSponsorable(txBytes: Uint8Array) {
	const op = getOperator().toSuiAddress();
	const data = Transaction.from(txBytes).getData();
	if (!data.sender) throw new Error('missing sender');
	if (normalizeSuiAddress(data.sender) === op) throw new Error('sender cannot be the sponsor');
	if (!data.gasData.owner || normalizeSuiAddress(data.gasData.owner) !== op) throw new Error('gas owner must be the sponsor');
	if (data.gasData.payment?.length !== 0) throw new Error('gas must come from the sponsor address balance');
	if (BigInt(data.gasData.budget ?? 0) > MAX_GAS_BUDGET) throw new Error('gas budget too high');
	if (data.expiration?.$kind !== 'ValidDuring') throw new Error('address-balance gas needs a ValidDuring expiration');

	const objectIds: string[] = [];
	for (const input of data.inputs) {
		if (input.$kind === 'FundsWithdrawal' && input.FundsWithdrawal.withdrawFrom.$kind !== 'Sender')
			throw new Error('only withdrawals from the sender are sponsored');
		if (input.$kind === 'Object') {
			const o = input.Object;
			objectIds.push(o.$kind === 'ImmOrOwnedObject' ? o.ImmOrOwnedObject.objectId : o.$kind === 'SharedObject' ? o.SharedObject.objectId : o.Receiving.objectId);
		}
	}
	let sends = 0;
	for (const cmd of data.commands) {
		if (cmd.$kind === 'MoveCall') {
			const t = `${short(cmd.MoveCall.package)}::${cmd.MoveCall.module}::${cmd.MoveCall.function}`;
			if (!ALLOWED_TARGETS.has(t)) throw new Error(`call not sponsored: ${t}`);
			if (t.endsWith('::corridor::send')) sends++;
		} else if (!['SplitCoins', 'MergeCoins'].includes(cmd.$kind)) {
			throw new Error(`command not sponsored: ${cmd.$kind}`);
		}
	}
	if (sends !== 1) throw new Error('a sponsored transaction must contain exactly one corridor::send');
	if (objectIds.length) {
		const { objects } = await sui.core.getObjects({ objectIds });
		for (const o of objects) {
			if (o instanceof Error) continue;
			if (o.owner.$kind === 'AddressOwner' && normalizeSuiAddress(o.owner.AddressOwner) === op)
				throw new Error('transaction touches a sponsor-owned object');
		}
	}
	return data;
}

export function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)), {
		status,
		headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
	});
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
