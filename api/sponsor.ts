// POST { txBytes, signature } -> the operator checks the policy, co-signs and executes.
import { fromBase64 } from '@mysten/sui/utils';
import { errorMessage, json } from './_lib/server.js';
import { sponsorAndExecute } from './_lib/sponsor.js';

export async function POST(req: Request) {
	try {
		const { txBytes, signature } = (await req.json()) as { txBytes: string; signature: string };
		return json(await sponsorAndExecute(fromBase64(txBytes), signature));
	} catch (e) {
		return json({ error: errorMessage(e) }, 400);
	}
}
