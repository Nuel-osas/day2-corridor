// Calls to Corridor's own API (the sponsor and the relayer). Errors carry `retry` when the call is
// safe to repeat: the transfer itself is never lost by a failed call.
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

/** One step of Corridor's relayer. Safe to call again and again. */
export const relay = (direction: 'out' | 'in', tx: string) => api<Progress>('/api/relay', { direction, tx });
