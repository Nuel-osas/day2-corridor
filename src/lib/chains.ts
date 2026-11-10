// Every chain the app can bridge between, on testnet. EVM chains come straight from Circle's
// Bridge Kit definitions (domain, chain id, USDC, CCTP V2 contracts, RPC, explorer). Sui is ours:
// Bridge Kit only knows Sui's V1 contracts, so its V2 ids live in shared/config.ts.
import * as BK from '@circle-fin/bridge-kit/chains';
import { BASE_SEPOLIA, SUI } from '../../shared/config';

export type Ecosystem = 'evm' | 'sui';

export type Chain = {
	id: string; // Bridge Kit chain name, e.g. "Base_Sepolia"; "Sui_Testnet" for Sui
	name: string;
	ecosystem: Ecosystem;
	domain: number;
	chainId?: number;
	usdc: string;
	rpc?: string;
	explorer: string; // with {hash}
	tokenMessenger?: string;
	messageTransmitter?: string;
	/** Circle offers Fast from this chain. Sui finalises in about a second, so it has standard only. */
	fast: boolean;
	/** Circle's Forwarding Service can mint here for the user ("pay gas in USDC"). */
	forwardTo: boolean;
	nativeSymbol: string;
};

type BKChain = {
	type: string; chain: string; name: string; isTestnet: boolean; chainId?: number;
	usdcAddress?: string | null; explorerUrl?: string; rpcEndpoints?: string[];
	nativeCurrency?: { name: string; symbol: string; decimals: number };
	cctp?: { domain: number; forwarderSupported?: { destination?: boolean }; contracts?: { v2?: { tokenMessenger?: string; messageTransmitter?: string } } };
};

// Circle lists Fast as N/A from these sources: their standard attestation is already quick.
const NO_FAST = new Set(['Avalanche_Fuji', 'Polygon_Amoy_Testnet', 'Sei_Testnet', 'Sonic_Testnet', 'Monad_Testnet', 'HyperEVM_Testnet', 'XDC_Apothem', 'Arc_Testnet']);
const ORDER = ['Base_Sepolia', 'Ethereum_Sepolia', 'Arbitrum_Sepolia', 'Optimism_Sepolia', 'Avalanche_Fuji', 'Polygon_Amoy_Testnet', 'Unichain_Sepolia', 'Linea_Sepolia', 'World_Chain_Sepolia'];

const evm: Chain[] = (Object.values(BK as Record<string, unknown>) as BKChain[])
	.filter((c) => !!c && typeof c === 'object' && c.type === 'evm' && c.isTestnet && !!c.usdcAddress && !!c.cctp?.contracts?.v2)
	.map((c) => ({
		id: c.chain,
		name: c.name.replace(/ Testnet$/, ''),
		ecosystem: 'evm' as const,
		domain: c.cctp!.domain,
		chainId: c.chainId,
		usdc: c.usdcAddress!,
		rpc: c.rpcEndpoints?.[0],
		explorer: c.explorerUrl ?? '',
		tokenMessenger: c.cctp!.contracts!.v2!.tokenMessenger,
		messageTransmitter: c.cctp!.contracts!.v2!.messageTransmitter,
		fast: !NO_FAST.has(c.chain),
		forwardTo: !!c.cctp?.forwarderSupported?.destination,
		nativeSymbol: c.nativeCurrency?.symbol ?? 'ETH',
	}))
	.sort((a, b) => {
		const ia = ORDER.indexOf(a.id), ib = ORDER.indexOf(b.id);
		return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.name.localeCompare(b.name);
	});

export const SUI_CHAIN: Chain = {
	id: 'Sui_Testnet',
	name: 'Sui Testnet',
	ecosystem: 'sui',
	domain: SUI.domain,
	usdc: SUI.usdc,
	explorer: `${SUI.explorer}/tx/{hash}`,
	fast: false,
	forwardTo: false, // Circle's fee API rejects every route that touches domain 8 (checked 10 Nov 2026)
	nativeSymbol: 'SUI',
};

export const CHAINS: Chain[] = [SUI_CHAIN, ...evm];
export const chainById = (id: string) => CHAINS.find((c) => c.id === id);
export const chainByDomain = (domain: number) => CHAINS.find((c) => c.domain === domain);
export const txUrl = (c: Chain, hash: string) => c.explorer.replace('{hash}', hash);

/** Corridor's own relayer serves Sui <-> Base Sepolia only. */
export const corridorServes = (from: Chain, to: Chain) =>
	(from.ecosystem === 'sui' && to.domain === BASE_SEPOLIA.domain) || (to.ecosystem === 'sui' && from.domain === BASE_SEPOLIA.domain);
