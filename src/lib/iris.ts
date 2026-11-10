// Circle's attestation service (Iris), testnet. Public: no wallet and no key needed.
import type { Hex } from 'viem';
import { IRIS } from '../../shared/config';

export type IrisMessage = {
	ready: boolean;
	status: string;
	message: Hex;
	attestation: Hex;
	eventNonce: string;
	sourceDomain: number;
	destinationDomain: number;
	amount: string | null;
	mintRecipient: string | null;
	destinationCaller: string | null;
	forwardTx?: string;
};

/** The message for a burn. Null while Iris has not indexed it (404): pending, never failed. */
export async function irisMessage(domain: number, burnTx: string): Promise<IrisMessage | null> {
	try {
		const r = await fetch(`${IRIS}/v2/messages/${domain}?transactionHash=${encodeURIComponent(burnTx)}`);
		if (!r.ok) return null;
		const m = (await r.json()).messages?.[0];
		if (!m) return null;
		const d = m.decodedMessage ?? {};
		return {
			ready: m.status === 'complete' && !!m.attestation && m.attestation !== 'PENDING' && !!m.message && m.message !== '0x',
			status: m.status,
			message: m.message,
			attestation: m.attestation,
			eventNonce: String(m.eventNonce ?? ''),
			sourceDomain: Number(d.sourceDomain ?? domain),
			destinationDomain: Number(d.destinationDomain),
			amount: d.decodedMessageBody?.amount ?? null,
			mintRecipient: d.decodedMessageBody?.mintRecipient ?? null,
			destinationCaller: d.destinationCaller ?? null,
			forwardTx: m.forwardTxHash || undefined,
		};
	} catch {
		return null;
	}
}

/** Poll until attested. Never gives up on its own: a slow attestation is still a safe transfer. */
export async function waitForAttestation(domain: number, burnTx: string, fast: boolean, signal?: { stop: boolean }) {
	for (;;) {
		if (signal?.stop) throw new Error('stopped');
		const m = await irisMessage(domain, burnTx);
		if (m?.ready) return m;
		await new Promise((res) => setTimeout(res, fast ? 2000 : 4000));
	}
}

export type Fees = { fastBps: number | null; forwardFee: bigint | null };

/** Circle's fees for a route. Iris has no quotes for routes that touch Sui: no Fast, no forwarding. */
export async function routeFees(src: number, dst: number): Promise<Fees | null> {
	try {
		const r = await fetch(`${IRIS}/v2/burn/USDC/fees/${src}/${dst}?forward=true`);
		if (!r.ok) return { fastBps: null, forwardFee: null };
		const j: { finalityThreshold: number; minimumFee: number; forwardFee?: { low: number; med: number; high: number } }[] = await r.json();
		const fast = j.find((x) => x.finalityThreshold === 1000);
		// Quote Circle's high estimate: on 10 Nov the fee charged was above "med" and below "high", and
		// the app promises the user an "at least" amount.
		const high = j.find((x) => x.forwardFee)?.forwardFee?.high;
		return { fastBps: fast?.minimumFee ?? null, forwardFee: high == null ? null : BigInt(Math.ceil(high)) };
	} catch {
		return null;
	}
}
