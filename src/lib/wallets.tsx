// One connected wallet per ecosystem. EVM wallets announce themselves with EIP-6963, so several
// can live side by side; Sui wallets (Slush, Suiet, ...) register with Wallet Standard.
import { getWallets, type Wallet } from '@mysten/wallet-standard';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Ecosystem } from './chains';
export type { Ecosystem };

export type Eip1193 = {
	request: (a: { method: string; params?: unknown[] }) => Promise<unknown>;
	on?: (e: string, f: (...a: never[]) => void) => void;
	removeListener?: (e: string, f: (...a: never[]) => void) => void;
};

export type WalletOption = { id: string; name: string; icon?: string; ecosystem: Ecosystem; connect: () => Promise<Connected> };

export type Connected = {
	ecosystem: Ecosystem;
	name: string;
	icon?: string;
	address: string;
	evm?: Eip1193; // the EIP-1193 provider, for viem and Bridge Kit
	sui?: Wallet; // the Wallet Standard wallet, for signing PTBs
};

type Ctx = {
	options: WalletOption[];
	connected: Partial<Record<Ecosystem, Connected>>;
	connect: (o: WalletOption) => Promise<void>;
	disconnect: (e: Ecosystem) => void;
};

const WalletCtx = createContext<Ctx | null>(null);
export const useWallets = () => useContext(WalletCtx)!;

type Announced = { info: { uuid: string; name: string; icon: string; rdns?: string }; provider: Eip1193 };

export function WalletProvider({ children }: { children: ReactNode }) {
	const [evm, setEvm] = useState<Announced[]>([]);
	const [standard, setStandard] = useState<readonly Wallet[]>([]);
	const [connected, setConnected] = useState<Partial<Record<Ecosystem, Connected>>>({});

	// EIP-6963: ask every EVM wallet to announce itself.
	useEffect(() => {
		const seen = new Map<string, Announced>();
		const onAnnounce = (e: Event) => {
			const d = (e as CustomEvent<Announced>).detail;
			if (!d?.info?.uuid) return;
			seen.set(d.info.rdns ?? d.info.uuid, d);
			setEvm([...seen.values()]);
		};
		window.addEventListener('eip6963:announceProvider', onAnnounce);
		window.dispatchEvent(new Event('eip6963:requestProvider'));
		// An older wallet that only sets window.ethereum.
		const t = setTimeout(() => {
			const eth = (window as { ethereum?: Eip1193 }).ethereum;
			if (!seen.size && eth) setEvm([{ info: { uuid: 'injected', name: 'Browser wallet', icon: '' }, provider: eth }]);
		}, 600);
		return () => { window.removeEventListener('eip6963:announceProvider', onAnnounce); clearTimeout(t); };
	}, []);

	// Wallet Standard: keep the wallets that speak Sui.
	useEffect(() => {
		const api = getWallets();
		const sync = () => setStandard(api.get().filter((w) => w.chains.some((c) => c.startsWith('sui:'))));
		sync();
		const offs = [api.on('register', sync), api.on('unregister', sync)];
		return () => offs.forEach((off) => off());
	}, []);

	const options = useMemo<WalletOption[]>(() => [
		...evm.map(({ info, provider }) => ({
			id: `evm:${info.rdns ?? info.uuid}`, name: info.name, icon: info.icon || undefined, ecosystem: 'evm' as const,
			connect: async (): Promise<Connected> => {
				const [address] = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
				return { ecosystem: 'evm', name: info.name, icon: info.icon, address, evm: provider };
			},
		})),
		...standard.map((w) => ({
			id: `sui:${w.name}`, name: w.name, icon: w.icon, ecosystem: 'sui' as const,
			connect: async (): Promise<Connected> => {
				const f = w.features['standard:connect'] as { connect: () => Promise<{ accounts: readonly { address: string; chains: readonly string[] }[] }> } | undefined;
				if (!f) throw new Error(`${w.name} cannot connect`);
				const { accounts } = await f.connect();
				const acct = accounts.find((a) => a.chains.some((c) => c.startsWith('sui:'))) ?? accounts[0];
				if (!acct) throw new Error(`${w.name} returned no account`);
				return { ecosystem: 'sui', name: w.name, icon: w.icon, address: acct.address, sui: w };
			},
		})),
	], [evm, standard]);

	const connect = useCallback(async (o: WalletOption) => {
		const c = await o.connect();
		setConnected((prev) => ({ ...prev, [c.ecosystem]: c }));
	}, []);

	const disconnect = useCallback((e: Ecosystem) => {
		setConnected((prev) => {
			const f = prev[e]?.sui?.features['standard:disconnect'] as { disconnect?: () => Promise<void> } | undefined;
			f?.disconnect?.().catch(() => {});
			const next = { ...prev };
			delete next[e];
			return next;
		});
	}, []);

	// Follow the EVM wallet when the user switches accounts in it.
	useEffect(() => {
		const p = connected.evm?.evm;
		if (!p?.on) return;
		const onAcc = (a: string[]) => setConnected((prev) => (a[0] && prev.evm ? { ...prev, evm: { ...prev.evm, address: a[0] } } : prev));
		p.on('accountsChanged', onAcc as never);
		return () => p.removeListener?.('accountsChanged', onAcc as never);
	}, [connected.evm?.evm]);

	return <WalletCtx.Provider value={{ options, connected, connect, disconnect }}>{children}</WalletCtx.Provider>;
}

export const shortAddr = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}...${a.slice(-4)}` : a);
