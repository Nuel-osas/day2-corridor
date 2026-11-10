// The user signs first. With gas from the operator's address balance there are no gas coins to
// choose, so the bytes are final before the operator ever sees them.
import { checkSponsorable, getOperator, sui } from './server.js';

export async function sponsorAndExecute(txBytes: Uint8Array, userSignature: string) {
	await checkSponsorable(txBytes);
	const { signature } = await getOperator().signTransaction(txBytes);
	const r = await sui.core.executeTransaction({ transaction: txBytes, signatures: [userSignature, signature], include: { effects: true, events: true } });
	const t = r.Transaction ?? r.FailedTransaction!;
	await sui.core.waitForTransaction({ digest: t.digest }).catch(() => {});
	return { digest: t.digest, ok: t.status.success, error: t.status.success ? null : t.status.error };
}
