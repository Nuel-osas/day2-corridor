import { useCallback, useEffect, useMemo, useState } from 'react';
import { CORRIDOR } from '../shared/config';
import { fmtUsdc, parseUsdc, quote as corridorQuote } from '../shared/corridor';
import { api, type Config } from './lib/api';
import { CHAINS, type Chain, chainById, corridorServes, SUI_CHAIN } from './lib/chains';
import { evmBalances } from './lib/evm';
import { routeFees, type Fees } from './lib/iris';
import { kitFee, setOurFee } from './lib/kit';
import { checkRecipient } from './lib/recipient';
import { suiBalances } from './lib/sui';
import { type GasMode, type StepKey, type Transfer, emptySteps, findByHash, loadTransfers, runTransfer } from './lib/transfer';
import { type Ecosystem, shortAddr, useWallets } from './lib/wallets';

const REPO = 'https://github.com/Nuel-osas/day2-corridor';
const PRODUCT = 'https://bridge.setsuna.finance';
const BASE = chainById('Base_Sepolia')!;

export default function App() {
	const [list, setList] = useState<Transfer[]>(() => loadTransfers());
	const [active, setActive] = useState<Transfer | null>(null);
	const [error, setError] = useState<string | null>(null);
	const { connected } = useWallets();

	const emit = useCallback((t: Transfer) => {
		setActive(t);
		setList((l) => [t, ...l.filter((x) => x.id !== t.id)]);
	}, []);
	const start = useCallback((t: Transfer) => {
		setError(null);
		void runTransfer(t, connected, emit);
	}, [connected, emit]);

	return (
		<div className="page">
			<header className="top">
				<div className="brand"><img src="/favicon.svg" alt="" /> Corridor</div>
				<span className="net"><span className="dot" /> Testnet · CCTP V2</span>
			</header>
			<WalletBar />
			{error && (
				<div className="banner" data-testid="error">
					<div><span className="eyebrow">[ Something failed ]</span>{error}</div>
					<button className="icon" onClick={() => setError(null)}>Dismiss</button>
				</div>
			)}
			<div className="grid">
				<div className="stack">
					<BridgeForm onStart={start} busy={active?.state === 'live'} onError={setError} />
				</div>
				<div className="stack">
					{active && <TransferCard t={active} onRetry={() => start(structuredClone(active))} />}
					<History list={list} onOpen={(t) => setActive(t)} onFound={(t) => emit(t)} onRetry={(t) => start(structuredClone(t))} />
					<CorridorCard />
				</div>
			</div>
			<footer className="foot">
				<span>SuiHub Lagos · Day 2 · Build your own bridge · the full product: <a href={PRODUCT} target="_blank" rel="noreferrer">bridge.setsuna.finance</a></span>
				<a href={REPO} target="_blank" rel="noreferrer">Source</a>
			</footer>
		</div>
	);
}

function WalletBar() {
	const { options, connected, connect, disconnect } = useWallets();
	const [open, setOpen] = useState<Ecosystem | null>(null);
	const [err, setErr] = useState<string | null>(null);
	const row = (eco: Ecosystem, label: string, install: string) => {
		const c = connected[eco];
		const opts = options.filter((o) => o.ecosystem === eco);
		return (
			<div className="wallet" data-testid={`wallet-${eco}`}>
				<span className="eyebrow muted">{label}</span>
				{c ? (
					<div className="row">
						{c.icon && <img src={c.icon} alt="" className="wicon" />}
						<span className="mono" data-testid={`addr-${eco}`} title={c.address}>{shortAddr(c.address)}</span>
						<span className="tag plain">{c.name}</span>
						<button className="icon" onClick={() => disconnect(eco)}>Disconnect</button>
					</div>
				) : (
					<div className="row">
						<button className="chip" data-testid={`connect-${eco}`} onClick={() => setOpen(open === eco ? null : eco)}>Connect</button>
						{open === eco && (opts.length ? opts.map((o) => (
							<button key={o.id} className="chip" data-testid="wallet-option" onClick={() => { setErr(null); setOpen(null); connect(o).catch((e) => setErr(String(e?.message ?? e))); }}>
								{o.icon && <img src={o.icon} alt="" className="wicon" />}{o.name}
							</button>
						)) : <span className="hint">No wallet found. Install {install}.</span>)}
					</div>
				)}
			</div>
		);
	};
	return (
		<section className="card wallets">
			{row('evm', 'EVM wallet', 'MetaMask')}
			{row('sui', 'Sui wallet', 'Slush')}
			{err && <p className="inline-err">{err}</p>}
		</section>
	);
}

type Bal = { usdc: bigint | null; gas: bigint | null };

function BridgeForm({ onStart, busy, onError }: { onStart: (t: Transfer) => void; busy: boolean; onError: (e: string) => void }) {
	const { connected } = useWallets();
	const [fromId, setFromId] = useState(SUI_CHAIN.id);
	const [toId, setToId] = useState(BASE.id);
	const [amount, setAmount] = useState('0.2');
	const [fast, setFast] = useState(true);
	const [custom, setCustom] = useState('');
	const [useCustom, setUseCustom] = useState(false);
	const [gas, setGas] = useState<GasMode>('corridor');
	const [fees, setFees] = useState<Fees | null>(null);
	const [cfg, setCfg] = useState<Config | null>(null);
	const [bal, setBal] = useState<Bal | null>(null);
	const from = chainById(fromId)!, to = chainById(toId)!;
	const sender = connected[from.ecosystem];
	const receiver = connected[to.ecosystem];

	useEffect(() => { api<Config>('/api/config').then(setCfg).catch(() => setCfg(null)); }, []);
	useEffect(() => { setFees(null); routeFees(from.domain, to.domain).then(setFees); }, [from.domain, to.domain]);
	useEffect(() => {
		setBal(null);
		if (!sender) return;
		(from.ecosystem === 'sui' ? suiBalances(sender.address) : evmBalances(from, sender.address)).then(setBal);
	}, [from, sender, busy]); // read again whenever a transfer starts or ends

	const evmToEvm = from.ecosystem === 'evm' && to.ecosystem === 'evm';
	const modes: { id: GasMode; label: string; hint: string }[] = [
		...(corridorServes(from, to) ? [{ id: 'corridor' as const, label: 'Corridor pays', hint: from.ecosystem === 'sui' ? 'Our fee in Move, our gas on both chains: you need 0 SUI' : 'Our relayer mints on Sui: you need no SUI' }] : []),
		...(evmToEvm && to.forwardTo ? [{ id: 'circle' as const, label: 'Pay gas in USDC', hint: 'Circle mints for you and takes its fee from the USDC' }] : []),
		{ id: 'self', label: 'Claim it yourself', hint: `You sign the mint on ${to.name} and pay its ${to.nativeSymbol}` },
	];
	const mode = modes.find((m) => m.id === gas) ? gas : modes[0].id;

	const units = parseUsdc(amount);
	const recipientRaw = useCustom ? custom : receiver?.address ?? '';
	const rc = recipientRaw ? checkRecipient(to, recipientRaw) : null;
	const isFast = fast && from.fast;
	const q = useMemo(() => {
		if (!units) return null;
		const lines: [string, string][] = [];
		let arrive = units, debit = units;
		if (mode === 'corridor' && from.ecosystem === 'sui' && cfg?.feeBps != null && cfg.minFee != null) {
			const { fee, net } = corridorQuote(units, cfg.feeBps, BigInt(cfg.minFee));
			lines.push([`Corridor fee (${cfg.feeBps / 100}%, min ${fmtUsdc(BigInt(cfg.minFee))}), in Move`, fmtUsdc(fee)]);
			arrive = net;
		}
		if (evmToEvm) {
			const f = BigInt(Math.round(kitFee(Number(units) / 1e6) * 1e6));
			lines.push(['Our fee through Bridge Kit (on top, Circle keeps 10%)', fmtUsdc(f)]);
			debit = units + f;
		}
		if (mode === 'circle' && fees?.forwardFee != null) { lines.push(['Circle delivers (forwarding fee, estimate)', fmtUsdc(fees.forwardFee)]); arrive -= fees.forwardFee; }
		if (isFast) {
			const bps = fees?.fastBps ?? (to.ecosystem === 'sui' || from.ecosystem === 'sui' ? 5 : null);
			if (bps != null) { const f = BigInt(Math.ceil((Number(units) * bps) / 10_000)); lines.push([`Circle fast fee (up to ${bps} bp)`, fmtUsdc(f)]); arrive -= f; }
		}
		return { lines, arrive, debit };
	}, [units, mode, from.ecosystem, evmToEvm, cfg, fees, isFast, to.ecosystem]);

	const problem = !sender ? `Connect a ${from.ecosystem === 'sui' ? 'Sui' : 'EVM'} wallet to send from ${from.name}.`
		: from.id === to.id ? 'Pick two different chains.'
		: !units || units <= 0n ? 'Enter an amount.'
		: bal?.usdc != null && q && q.debit > bal.usdc ? `You hold ${fmtUsdc(bal.usdc)} USDC on ${from.name}.`
		: !rc ? `Connect a ${to.ecosystem === 'sui' ? 'Sui' : 'EVM'} wallet, or send to another address.`
		: !rc.ok ? rc.error
		: mode === 'corridor' && from.ecosystem === 'sui' && cfg?.feeBps == null ? 'Reading Corridor\'s fee...'
		: mode === 'circle' && fees?.forwardFee == null ? 'Circle has no forwarding quote for this route right now.'
		: q && q.arrive <= 0n ? 'The amount does not cover the fees.'
		: null;

	const go = () => {
		if (problem || !units || !rc?.ok || !sender) return;
		if (evmToEvm) setOurFee(CORRIDOR.relayerEvm);
		onStart({
			id: `${Date.now()}`, from: from.id, to: to.id, amount, units: units.toString(), fast: isFast, gas: mode,
			sender: sender.address, recipient: rc.address, steps: emptySteps(), state: 'live', createdAt: Date.now(),
		});
	};
	const swap = () => { setFromId(toId); setToId(fromId); };
	void onError;

	return (
		<section className="card">
			<div className="card-head"><span className="eyebrow">[ Bridge USDC ]</span><span className="tag plain">Circle CCTP V2</span></div>
			<div className="route">
				<ChainSelect label="From" value={fromId} onChange={setFromId} testid="from" />
				<button className="icon swap" onClick={swap} aria-label="Swap" data-testid="swap">⇄</button>
				<ChainSelect label="To" value={toId} onChange={setToId} testid="to" />
			</div>
			<div className="amount">
				<input data-testid="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
				<span className="sym">USDC</span>
			</div>
			<p className="hint mt-s" data-testid="balance">
				{sender ? <>On {from.name}: {bal ? `${fmtUsdc(bal.usdc)} USDC · ${bal.gas == null ? 'unknown' : (Number(bal.gas) / (from.ecosystem === 'sui' ? 1e9 : 1e18)).toFixed(4)} ${from.nativeSymbol}` : 'reading...'}</> : 'Connect a wallet to see your balance.'}
			</p>

			<div className="field">
				<span>Speed</span>
				<div className="coin-toggle">
					<button className={isFast ? 'on' : ''} disabled={!from.fast} onClick={() => setFast(true)} data-testid="fast">Fast</button>
					<button className={!isFast ? 'on' : ''} onClick={() => setFast(false)} data-testid="standard">Standard</button>
				</div>
				{!from.fast && <span className="hint">{from.name} sends standard only, and attests in seconds anyway.</span>}
			</div>

			<div className="field">
				<span>Who pays the gas on {to.name}</span>
				<div className="opts">
					{modes.map((m) => (
						<label key={m.id} className={m.id === mode ? 'on' : ''} data-testid={`gas-${m.id}`}>
							<input type="radio" name="gas" checked={m.id === mode} onChange={() => setGas(m.id)} />
							<div><b>{m.label}</b><p>{m.hint}</p></div>
						</label>
					))}
				</div>
			</div>

			<div className="field">
				<span>Recipient on {to.name}</span>
				{!useCustom && <p className="hint" data-testid="recipient">{receiver ? <span className="mono">{shortAddr(receiver.address)} ({receiver.name})</span> : `Connect a ${to.ecosystem === 'sui' ? 'Sui' : 'EVM'} wallet`}</p>}
				{useCustom && <input className="mono" data-testid="recipient-input" placeholder={to.ecosystem === 'sui' ? '0x... (64 hex)' : '0x... (40 hex)'} value={custom} onChange={(e) => setCustom(e.target.value)} />}
				<button className="icon" style={{ alignSelf: 'flex-start' }} onClick={() => setUseCustom(!useCustom)}>{useCustom ? 'Send to my wallet' : 'Send to another address'}</button>
			</div>

			{q && (
				<div className="quote" data-testid="quote">
					<div><span>You send</span><b>{fmtUsdc(q.debit)} USDC</b></div>
					{q.lines.map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}
					<div className="total"><span>Arrives on {to.name}{evmToEvm && (isFast || mode === 'circle') ? ' (about: Circle sets its fee at delivery)' : isFast ? ' (at least)' : ''}</span><b>{fmtUsdc(q.arrive > 0n ? q.arrive : 0n)} USDC</b></div>
				</div>
			)}
			{problem && <p className="hint mt-s" data-testid="problem">{problem}</p>}
			<div className="row mt"><button className="lg" data-testid="bridge" disabled={!!problem || busy} onClick={go}>{busy ? 'A transfer is running' : `Bridge to ${to.name}`}</button></div>
		</section>
	);
}

function ChainSelect({ label, value, onChange, testid }: { label: string; value: string; onChange: (v: string) => void; testid: string }) {
	return (
		<label className="chain">
			<span className="eyebrow muted">{label}</span>
			<select data-testid={testid} value={value} onChange={(e) => onChange(e.target.value)}>
				{CHAINS.map((c: Chain) => <option key={c.id} value={c.id}>{c.name}</option>)}
			</select>
		</label>
	);
}

const STEP_LABEL: Record<StepKey, string> = { approve: 'Approve', burn: 'Burn', attest: 'Circle attests', mint: 'Mint' };

function TransferCard({ t, onRetry }: { t: Transfer; onRetry: () => void }) {
	const from = chainById(t.from)!, to = chainById(t.to)!;
	const head = t.state === 'done' ? <span className="tag good">Arrived</span>
		: t.state === 'claim' ? <span className="tag warn">Ready to claim</span>
		: t.state === 'error' ? <span className="tag warn">Stopped</span>
		: <span className="tag"><span className="spin" /> In progress</span>;
	return (
		<section className="card" data-testid="transfer" data-state={t.state}>
			<div className="xfer-head"><strong>{t.amount} USDC · {from.name} → {to.name}</strong>{head}</div>
			<p className="hint mt-s">{t.gas === 'corridor' ? 'Corridor pays the gas' : t.gas === 'circle' ? 'Circle delivers, gas paid in USDC' : 'You claim on the destination'} · {t.fast ? 'Fast' : 'Standard'}</p>
			<div className="progress mt">
				{(['approve', 'burn', 'attest', 'mint'] as StepKey[]).map((k, i) => {
					const s = t.steps[k];
					return (
						<div key={k} className={s.state === 'done' ? 'done' : ''} data-testid={`step-${k}`} data-state={s.state}>
							<span className="n">0{i + 1} {s.state === 'done' ? <span className="check">✓</span> : s.state === 'live' ? <span className="spin" /> : s.state === 'skip' ? '·' : ''}</span>
							<p>{STEP_LABEL[k]}{s.state === 'skip' ? ' (not needed)' : ''}</p>
						</div>
					);
				})}
			</div>
			<div className="links">
				{t.steps.burn.tx && <span>burn <a href={t.steps.burn.url} target="_blank" rel="noreferrer" data-testid="burn">{t.steps.burn.tx}</a></span>}
				{t.steps.mint.tx && <span>mint <a href={t.steps.mint.url} target="_blank" rel="noreferrer" data-testid="mint">{t.steps.mint.tx}</a></span>}
			</div>
			{t.note && <p className="note">{t.note}</p>}
			{t.error && <p className="inline-err" data-testid="transfer-error">{t.error}</p>}
			{(t.state === 'error' || t.state === 'claim') && <div className="row mt"><button className="ghost" data-testid="retry" onClick={onRetry}>{t.state === 'claim' ? 'Claim' : 'Retry from the failed step'}</button></div>}
		</section>
	);
}

function History({ list, onOpen, onFound, onRetry }: { list: Transfer[]; onOpen: (t: Transfer) => void; onFound: (t: Transfer) => void; onRetry: (t: Transfer) => void }) {
	const [hash, setHash] = useState('');
	const [msg, setMsg] = useState<string | null>(null);
	const find = async () => {
		setMsg('Looking at Circle...');
		const t = await findByHash(hash);
		if (!t) return setMsg('Circle has no CCTP burn with that hash on a testnet we know.');
		setMsg(null);
		onFound(t);
	};
	return (
		<section className="card">
			<div className="card-head"><span className="eyebrow">[ History ]</span><span className="count">{list.length}</span></div>
			<div className="inline">
				<input className="mono" data-testid="find-input" placeholder="Find a transfer by its burn hash" value={hash} onChange={(e) => setHash(e.target.value)} />
				<button className="ghost" data-testid="find" onClick={find} disabled={!hash.trim()}>Find</button>
			</div>
			{msg && <p className="hint mt-s">{msg}</p>}
			{list.length === 0 ? <p className="empty mt">No transfers yet. They are saved in this browser after every step.</p> : (
				<ul className="log mt">
					{list.slice(0, 8).map((t) => (
						<li key={t.id}>
							<span className="pip" />
							<span className="what">{t.amount} USDC · {chainById(t.from)?.name} → {chainById(t.to)?.name}</span>
							<span className="row">
								<button className="icon" onClick={() => onOpen(t)}>{t.state === 'done' ? 'Arrived' : t.state === 'claim' ? 'Claim' : 'Open'}</button>
								{t.state !== 'done' && t.state !== 'live' && <button className="icon" onClick={() => onRetry(t)}>Resume</button>}
							</span>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

function CorridorCard() {
	const [cfg, setCfg] = useState<Config | null>(null);
	useEffect(() => { api<Config>('/api/config').then(setCfg).catch(() => setCfg(null)); }, []);
	return (
		<section className="card">
			<div className="card-head"><span className="eyebrow">[ Corridor, our bridge business ]</span></div>
			<p className="hint">On Sui routes Corridor charges its fee in Move, pays the gas and relays the mint. Circle&apos;s forwarding has no Sui routes, so this is how you make Sui gasless.</p>
			<div className="stats">
				<div><span className="n">Fees collected</span><b data-testid="vault">{cfg?.vault != null ? `${fmtUsdc(BigInt(cfg.vault))} USDC` : 'unknown'}</b></div>
				<div><span className="n">Fee</span><b>{cfg?.feeBps != null ? `${cfg.feeBps / 100}%, min ${fmtUsdc(BigInt(cfg.minFee ?? '0'))}` : 'unknown'}</b></div>
				<div><span className="n">Sponsor SUI</span><b>{cfg?.operatorSui != null ? (Number(cfg.operatorSui) / 1e9).toFixed(2) : 'unknown'}</b></div>
				<div><span className="n">Relayer ETH (Base)</span><b>{cfg?.relayerEth != null ? (Number(cfg.relayerEth) / 1e18).toFixed(4) : 'unknown'}</b></div>
			</div>
		</section>
	);
}
