// POST { direction: 'out' | 'in', tx } -> one step of the relayer. Safe to call again and again.
import { relayIn, relayOut } from './_lib/relay.js';
import { errorMessage, json } from './_lib/server.js';

const SUI_DIGEST = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const EVM_HASH = /^0x[0-9a-fA-F]{64}$/;

export async function POST(req: Request) {
	try {
		const { direction, tx } = (await req.json()) as { direction: string; tx: string };
		if (direction === 'out' && SUI_DIGEST.test(tx)) return json(await relayOut(tx));
		if (direction === 'in' && EVM_HASH.test(tx)) return json(await relayIn(tx));
		return json({ error: 'expected { direction: "out", tx: <Sui digest> } or { direction: "in", tx: <0x hash> }' }, 400);
	} catch (e) {
		// Not a failed transfer: the burn is safe and the call can be repeated.
		return json({ error: errorMessage(e), retry: true }, 502);
	}
}
