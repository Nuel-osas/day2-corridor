// Polls the relayer until the transfer is minted, rejected, or we give up. Safe to rerun.
import { relayIn, relayOut, type Direction } from '../api/_lib/relay.js';
import { BASE_SEPOLIA, SUI } from '../shared/config.js';

export async function follow(direction: Direction, tx: string, minutes = 25) {
	const started = Date.now();
	let last = '';
	while (Date.now() - started < minutes * 60_000) {
		try {
			const p = direction === 'out' ? await relayOut(tx) : await relayIn(tx);
			const line = `${p.stage}${p.circleStatus ? ` (Circle: ${p.circleStatus})` : ''}${p.note ? `: ${p.note}` : ''}`;
			if (line !== last) console.log(`  ${Math.round((Date.now() - started) / 1000)}s ${line}`), (last = line);
			if (p.stage === 'minted') {
				const link = direction === 'out' ? `${BASE_SEPOLIA.explorer}/tx/${p.destinationTx}` : `${SUI.explorer}/tx/${p.destinationTx}`;
				console.log(`minted: ${p.destinationTx ? link : '(earlier mint, tx not located)'}\n  amount ${p.amount}, Circle fee ${p.circleFee ?? 0}, recipient ${p.mintRecipient}, gas paid by ${p.paidBy}`);
				if (p.corridor) console.log(`  Corridor: gross ${p.corridor.gross}, fee ${p.corridor.fee}, net ${p.corridor.net}`);
				return p;
			}
			if (p.stage === 'rejected') return p;
		} catch (e) {
			const msg = `  relayer error (transfer is safe, will retry): ${e instanceof Error ? e.message.split('\n')[0] : e}`;
			if (msg !== last) console.log(msg), (last = msg);
		}
		await new Promise((r) => setTimeout(r, 5000));
	}
	console.log(`still pending after ${minutes} min. Resume any time: pnpm relay ${direction} ${tx}`);
}
