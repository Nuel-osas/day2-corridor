// EVM to EVM with Circle's Bridge Kit: one call runs approve, burn, attestation and mint, and emits
// an event per step for the tracker. With useForwarder, Circle mints on the destination and takes
// its fee from the USDC, so the user needs no gas there ("pay gas in USDC").
import { BridgeKit } from '@circle-fin/bridge-kit';
import type { Eip1193 } from './wallets';

export const kit = new BridgeKit();

// Our fee on EVM routes, through Bridge Kit's custom fee policy: added on top of the amount, taken
// on the source chain, split 90/10 between our recipient and Circle. 0.1 percent, at least 0.01 USDC.
export const KIT_FEE_BPS = 10;
export const KIT_MIN_FEE = 0.01;
export const kitFee = (amount: number) => Math.max((amount * KIT_FEE_BPS) / 10_000, KIT_MIN_FEE);
let feeRecipient: string | null = null;
export function setOurFee(recipient: string) {
	if (feeRecipient === recipient) return;
	feeRecipient = recipient;
	kit.setCustomFeePolicy({
		computeFee: (p: { amount: string }) => kitFee(Number(p.amount)).toFixed(6),
		resolveFeeRecipientAddress: () => recipient,
	} as never);
}

export async function adapterFor(provider: Eip1193) {
	const { createViemAdapterFromProvider } = await import('@circle-fin/adapter-viem-v2');
	return createViemAdapterFromProvider({ provider: provider as never });
}

export type KitStep = 'approve' | 'burn' | 'attest' | 'mint';
const METHOD: Record<string, KitStep> = { approve: 'approve', burn: 'burn', fetchAttestation: 'attest', mint: 'mint' };

/** Subscribe to Bridge Kit's step events for one transfer. Returns the unsubscribe function. */
export function onKitStep(handler: (step: KitStep, txHash?: string) => void) {
	const h = (e: { method: string; values?: { txHash?: string } }) => {
		const k = METHOD[e.method];
		if (k) handler(k, e.values?.txHash);
	};
	kit.on('*', h as never);
	return () => (kit as unknown as { off?: (n: string, f: unknown) => void }).off?.('*', h);
}

export type KitResult = { state: string; steps?: { name: string; state: string; txHash?: string; error?: { message?: string } }[] };

export async function kitBridge(o: {
	provider: Eip1193; from: string; to: string; amount: string; fast: boolean; recipient: string; owner: string; gasInUsdc: boolean;
}): Promise<KitResult> {
	const adapter = await adapterFor(o.provider);
	const sameRecipient = o.recipient.toLowerCase() === o.owner.toLowerCase();
	return (await kit.bridge({
		from: { adapter, chain: o.from },
		to: o.gasInUsdc
			? { chain: o.to, recipientAddress: o.recipient, useForwarder: true }
			: sameRecipient ? { adapter, chain: o.to } : { adapter, chain: o.to, recipientAddress: o.recipient },
		amount: o.amount,
		config: { transferSpeed: o.fast ? 'FAST' : 'SLOW', batchTransactions: false },
	} as never)) as KitResult;
}

export async function kitRetry(result: KitResult, provider: Eip1193): Promise<KitResult> {
	const adapter = await adapterFor(provider);
	return (await kit.retry(result as never, { from: adapter, to: adapter } as never)) as KitResult;
}
