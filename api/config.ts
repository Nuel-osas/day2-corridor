// GET -> what the browser needs: who sponsors, who relays, and the corridor's live settings.
import { CORRIDOR, SUI } from '../shared/config.js';
import { base, errorMessage, getOperator, getRelayer, json, sui } from './_lib/server.js';

export async function GET() {
	try {
		const operator = getOperator().toSuiAddress();
		const relayer = getRelayer().account.address;
		const [obj, gasSui, gasEth] = await Promise.all([
			sui.core.getObject({ objectId: CORRIDOR.corridorId, include: { json: true } }).catch(() => null),
			sui.core.getBalance({ owner: operator, coinType: '0x2::sui::SUI' }).then((b) => b.balance.balance).catch(() => null),
			base.getBalance({ address: relayer }).then(String).catch(() => null),
		]);
		const c = obj?.object.json as { fee_bps: string; min_fee: string; vault: string; state: { $kind?: string; variant?: string } | string } | undefined;
		return json({
			network: SUI.network,
			pkg: CORRIDOR.pkg,
			corridorId: CORRIDOR.corridorId,
			operator,
			relayer,
			feeBps: c ? Number(c.fee_bps) : null,
			minFee: c?.min_fee ?? null,
			vault: c?.vault ?? null,
			state: c?.state ?? null,
			operatorSui: gasSui,
			relayerEth: gasEth,
		});
	} catch (e) {
		return json({ error: errorMessage(e) }, 500);
	}
}
