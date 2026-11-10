// A typed recipient is checked against the destination chain before anything is burned: Circle
// mints to whatever 32 bytes it is given, and a wrong address can never be recovered.
import { getAddress, isAddress } from 'viem';
import type { Chain } from './chains';

export type RecipientCheck = { ok: true; address: string } | { ok: false; error: string };

export function checkRecipient(chain: Chain, raw: string): RecipientCheck {
	const a = raw.trim();
	if (chain.ecosystem === 'evm') {
		if (!/^0x[0-9a-fA-F]{40}$/.test(a)) return { ok: false, error: `A ${chain.name} address is 0x and 40 hex characters.` };
		if (!isAddress(a)) return { ok: false, error: 'This address fails its checksum; a character is probably wrong.' };
		return { ok: true, address: getAddress(a) };
	}
	// Full 64-hex form only: a shorter value (an EVM address, say) would be padded into an address nobody holds.
	if (!/^0x[0-9a-fA-F]{64}$/.test(a)) return { ok: false, error: 'A Sui address is 0x and 64 hex characters.' };
	return { ok: true, address: a.toLowerCase() };
}
