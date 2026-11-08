// Browser side. The Sui key lives in localStorage: fine for a testnet class, never for real money.
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { toBase64 } from '@mysten/sui/utils';
import { createWalletClient, custom, zeroHash, type Hex } from 'viem';
import { baseSepolia } from 'viem/chains';
import { BASE_SEPOLIA, CORRIDOR, FINALITY, SUI } from '../../shared/config';
import { addSend } from '../../shared/corridor';
import { erc20, fastMaxFee, tokenMessengerV2 } from '../../shared/evm';

export const sui = new SuiGrpcClient({ network: SUI.network, baseUrl: SUI.grpc });
export const suiTx = (d: string) => `${SUI.explorer}/tx/${d}`;
export const suiAcct = (a: string) => `${SUI.explorer}/account/${a}`;
export const baseTx = (h: string) => `${BASE_SEPOLIA.explorer}/tx/${h}`;
export const baseAcct = (a: string) => `${BASE_SEPOLIA.explorer}/address/${a}`;

const KEY = 'corridor-v1';
export const keyStore = {
	load(): Ed25519Keypair | null {
		try {
			const s = localStorage.getItem(KEY);
			return s ? Ed25519Keypair.fromSecretKey(s) : null;
		} catch {
			return null;
		}
	},
	save(kp: Ed25519Keypair) {
		try { localStorage.setItem(KEY, kp.getSecretKey()); } catch { /* private window: key lives for this tab only */ }
	},
	clear() {
		try { localStorage.removeItem(KEY); } catch { /* nothing stored */ }
	},
};

export function importKey(secret: string) {
	const { scheme } = decodeSuiPrivateKey(secret.trim());
	if (scheme !== 'ED25519') throw new Error(`Corridor's demo wallet takes an ED25519 suiprivkey, not ${scheme}`);
	return Ed25519Keypair.fromSecretKey(secret.trim());
}

/** A failed read is unknown (null), never zero. */
export async function balances(owner: string) {
	const [usdc, gas] = await Promise.all([
		sui.core.getBalance({ owner, coinType: SUI.usdc }).then((b) => BigInt(b.balance.balance)).catch(() => null),
		sui.core.getBalance({ owner, coinType: '0x2::sui::SUI' }).then((b) => BigInt(b.balance.balance)).catch(() => null),
	]);
	return { usdc, gas };
}

export async function api<T>(path: string, body?: unknown): Promise<T> {
	const r = await fetch(path, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
	const j = await r.json().catch(() => ({ error: `${path} answered ${r.status}` }));
	if (!r.ok || j.error) throw Object.assign(new Error(j.error ?? r.statusText), { retry: !!j.retry });
	return j as T;
}

export type Config = {
	pkg: string; corridorId: string; operator: string; relayer: string;
	feeBps: number | null; minFee: string | null; vault: string | null;
	operatorSui: string | null; relayerEth: string | null;
};

export type Progress = {
	direction: 'out' | 'in'; sourceTx: string;
	stage: 'not_found' | 'attesting' | 'ready' | 'minted' | 'rejected';
	circleStatus?: string; amount?: string; circleFee?: string; mintRecipient?: string;
	destinationTx?: string | null; paidBy?: string; note?: string;
	corridor?: { gross: string; fee: string; net: string } | null;
};

export const relay = (direction: 'out' | 'in', tx: string) => api<Progress>('/api/relay', { direction, tx });

/** Sui -> Base. The user signs, the operator co-signs as gas owner and executes. */
export async function sendOut(kp: Ed25519Keypair, amount: bigint, mintRecipient: string) {
	const tx = new Transaction();
	tx.setSender(kp.toSuiAddress());
	tx.setGasOwner(CORRIDOR.operator);
	tx.setGasPayment([]);
	addSend(tx, { amount, destinationDomain: BASE_SEPOLIA.domain, mintRecipient });
	const bytes = await tx.build({ client: sui });
	const { signature } = await kp.signTransaction(bytes);
	const out = await api<{ digest: string; ok: boolean; error: unknown }>('/api/sponsor', { txBytes: toBase64(bytes), signature });
	if (!out.ok) throw new Error(`Burn ${out.digest} failed onchain: ${JSON.stringify(out.error)}`);
	return out.digest;
}

type Eip1193 = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };
const eth = () => (globalThis as { ethereum?: Eip1193 }).ethereum;
export const hasEvmWallet = () => !!eth();

export async function connectEvm() {
	const provider = eth();
	if (!provider) throw new Error('No browser wallet found. Install MetaMask or use pnpm inbound.');
	const [address] = (await provider.request({ method: 'eth_requestAccounts' })) as Hex[];
	try {
		await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${BASE_SEPOLIA.chainId.toString(16)}` }] });
	} catch {
		await provider.request({ method: 'wallet_addEthereumChain', params: [{ chainId: `0x${BASE_SEPOLIA.chainId.toString(16)}`, chainName: 'Base Sepolia', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://sepolia.base.org'], blockExplorerUrls: [BASE_SEPOLIA.explorer] }] });
	}
	return address;
}

/** Base -> Sui. The browser wallet approves and burns (fast transfer); the relayer mints on Sui. */
export async function sendIn(from: Hex, amount: bigint, suiRecipient: string, onStep: (s: string) => void) {
	const wallet = createWalletClient({ account: from, chain: baseSepolia, transport: custom(eth()!) });
	const read = async (data: Hex) => (await eth()!.request({ method: 'eth_call', params: [{ to: BASE_SEPOLIA.usdc, data }, 'latest'] })) as Hex;
	const { encodeFunctionData, decodeFunctionResult } = await import('viem');
	const allowance = decodeFunctionResult({ abi: erc20, functionName: 'allowance', data: await read(encodeFunctionData({ abi: erc20, functionName: 'allowance', args: [from, BASE_SEPOLIA.tokenMessenger] })) });
	if (allowance < amount) {
		onStep('Approve USDC in your wallet');
		const h = await wallet.writeContract({ address: BASE_SEPOLIA.usdc, abi: erc20, functionName: 'approve', args: [BASE_SEPOLIA.tokenMessenger, amount] });
		onStep('Waiting for the approval');
		await waitEvm(h);
	}
	onStep('Confirm the burn in your wallet');
	const hash = await wallet.writeContract({
		address: BASE_SEPOLIA.tokenMessenger,
		abi: tokenMessengerV2,
		functionName: 'depositForBurn',
		args: [amount, SUI.domain, suiRecipient as Hex, BASE_SEPOLIA.usdc, zeroHash, fastMaxFee(amount), FINALITY.fast],
	});
	onStep('Waiting for the burn');
	await waitEvm(hash);
	return hash;
}

async function waitEvm(hash: Hex) {
	for (let i = 0; i < 60; i++) {
		const r = (await eth()!.request({ method: 'eth_getTransactionReceipt', params: [hash] })) as { status: Hex } | null;
		if (r) {
			if (r.status !== '0x1') throw new Error(`Transaction ${hash} reverted`);
			return;
		}
		await new Promise((res) => setTimeout(res, 2000));
	}
	throw new Error(`No receipt for ${hash} yet. It may still land: check the explorer.`);
}

const XFERS = 'corridor-transfers-v1';
export type Saved = { direction: 'out' | 'in'; tx: string; at: number; amount: string; to: string };
export const transfers = {
	load(): Saved[] {
		try { return JSON.parse(localStorage.getItem(XFERS) ?? '[]'); } catch { return []; }
	},
	save(list: Saved[]) {
		try { localStorage.setItem(XFERS, JSON.stringify(list.slice(0, 20))); } catch { /* not persisted */ }
	},
};
