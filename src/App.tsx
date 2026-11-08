import { useCallback, useEffect, useRef, useState } from 'react';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { isAddress, type Hex } from 'viem';
import { BASE_SEPOLIA, CORRIDOR } from '../shared/config';
import { fmtUsdc, parseUsdc, quote } from '../shared/corridor';
import {
	api, balances, baseAcct, baseTx, connectEvm, hasEvmWallet, importKey, keyStore, relay, sendIn, sendOut, suiAcct, suiTx, transfers,
	type Config, type Progress, type Saved,
} from './lib/wallet';

const REPO = 'https://github.com/Nuel-osas/day2-corridor';
const short = (a: string) => `${a.slice(0, 8)}...${a.slice(-6)}`;
type Guard = (label: string, fn: () => Promise<void>) => Promise<void>;

export default function App() {
	const [kp, setKp] = useState<Ed25519Keypair | null>(() => keyStore.load());
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [list, setList] = useState<Saved[]>(() => transfers.load());

	const guard: Guard = useCallback(async (label, fn) => {
		setBusy(label);
		setError(null);
		try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
	}, []);
	const track = useCallback((s: Saved) => setList((l) => {
		const next = [s, ...l.filter((x) => x.tx !== s.tx)];
		transfers.save(next);
		return next;
	}), []);

	return (
		<div className="page">
			<header className="top">
				<div className="brand"><img src="/favicon.svg" alt="" /> Corridor</div>
				<span className="net"><span className="dot" /> Sui testnet ⇄ Base Sepolia</span>
			</header>
			{error && (
				<div className="banner" data-testid="error">
					<div><span className="eyebrow">[ Something failed ]</span>{error}</div>
					<button className="icon" onClick={() => setError(null)}>Dismiss</button>
				</div>
			)}
			{!kp ? <Onboarding guard={guard} setKp={setKp} /> : <Bridge kp={kp} guard={guard} setKp={setKp} list={list} track={track} />}
			<footer className="foot">
				<span>SuiHub Lagos · Day 2 · CCTP V2 + a Move fee + a relayer · testnet</span>
				<a href={REPO} target="_blank">Source</a>
			</footer>
			{busy && <div className="toast" data-testid="busy"><span className="spin" />{busy}...</div>}
		</div>
	);
}

function Onboarding({ guard, setKp }: { guard: Guard; setKp: (k: Ed25519Keypair) => void }) {
	const [secret, setSecret] = useState('');
	return (
		<>
			<section className="hero">
				<span className="eyebrow">[ Day 2 / Build your own bridge ]</span>
				<h1 className="headline">Native USDC across chains.<br /><span className="soft">Your fee, your relayer, no gas for users.</span></h1>
				<p className="lede">Corridor burns USDC on Sui and Circle mints it on Base Sepolia. A Move contract takes the fee in the same transaction, the operator pays the SUI, and a relayer pays the ETH. Nothing is wrapped and nothing sits in a pool.</p>
				<div className="hero-actions">
					<button className="lg" data-testid="create" onClick={() => { const k = new Ed25519Keypair(); keyStore.save(k); setKp(k); }}>Create a testnet wallet</button>
				</div>
			</section>
			<div className="grid">
				<section className="card">
					<span className="eyebrow">[ Or import ]</span>
					<h2>Use an existing testnet key</h2>
					<p className="lede">An ED25519 <code>suiprivkey</code> that already holds testnet USDC. It stays in this browser.</p>
					<div className="inline mt">
						<input className="mono" data-testid="import" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="suiprivkey1..." />
						<button className="ghost" data-testid="import-go" disabled={!secret} onClick={() => guard('Importing', async () => { const k = importKey(secret); keyStore.save(k); setKp(k); })}>Import</button>
					</div>
				</section>
				<section className="card">
					<span className="eyebrow">[ What you need ]</span>
					<h2>USDC, and nothing else</h2>
					<p className="lede">Get testnet USDC on Sui from <a href="https://faucet.circle.com" target="_blank">faucet.circle.com</a>. You need no SUI and no ETH: Corridor pays both.</p>
				</section>
			</div>
		</>
	);
}

function Bridge({ kp, guard, setKp, list, track }: { kp: Ed25519Keypair; guard: Guard; setKp: (k: Ed25519Keypair | null) => void; list: Saved[]; track: (s: Saved) => void }) {
	const me = kp.toSuiAddress();
	const [bal, setBal] = useState<{ usdc: bigint | null; gas: bigint | null }>({ usdc: null, gas: null });
	const [cfg, setCfg] = useState<Config | null>(null);
	const [amount, setAmount] = useState('0.25');
	const [to, setTo] = useState('');
	const [showKey, setShowKey] = useState(false);

	const refresh = useCallback(async () => {
		setBal(await balances(me));
		setCfg(await api<Config>('/api/config').catch(() => null));
	}, [me]);
	useEffect(() => { refresh(); }, [refresh]);

	const gross = parseUsdc(amount);
	const feeBps = cfg?.feeBps ?? CORRIDOR.feeBps;
	const minFee = BigInt(cfg?.minFee ?? CORRIDOR.minFee);
	const q = gross == null ? null : quote(gross, feeBps, minFee);

	return (
		<div className="grid">
			<div className="stack">
				<section className="card balance">
					<div className="card-head" style={{ marginBottom: 0 }}>
						<span className="eyebrow">[ Your Sui wallet ]</span>
						<button className="icon" onClick={() => refresh()}>Refresh</button>
					</div>
					<ul className="keys mt">
						<li className="me">
							<span className="kicon">S</span>
							<div className="kbody">
								<a className="mono" data-testid="address" href={suiAcct(me)} target="_blank" title={me}>{me}</a>
								<div className="tags">
									<span className="tag" data-testid="usdc">{fmtUsdc(bal.usdc)} USDC</span>
									<span className="tag plain">{bal.gas == null ? 'unknown' : (Number(bal.gas) / 1e9).toFixed(3)} SUI</span>
									{bal.gas === 0n && <span className="tag good">no gas needed</span>}
								</div>
							</div>
						</li>
					</ul>
					<div className="row mt">
						<a className="chip" href="https://faucet.circle.com" target="_blank">Get testnet USDC</a>
						<button className="chip" onClick={() => setShowKey((v) => !v)}>{showKey ? 'Hide' : 'Show'} key</button>
						<button className="chip" onClick={() => { keyStore.clear(); setKp(null); }}>Sign out</button>
					</div>
					{showKey && <div className="secret">Testnet only. Anyone with this key controls the wallet.<code>{kp.getSecretKey()}</code></div>}
				</section>

				<section className="card">
					<div className="card-head">
						<span className="eyebrow">[ 01 / Sui to {BASE_SEPOLIA.name} ]</span>
						<span className="tag">gas paid by Corridor</span>
					</div>
					<div className="amount">
						<input data-testid="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount" />
						<span className="sym">USDC</span>
					</div>
					<label className="field"><span>Recipient on {BASE_SEPOLIA.name}</span>
						<input className="mono" data-testid="to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x..." />
					</label>
					<div className="quote" data-testid="quote">
						<div><span>You send</span><b>{gross == null ? '...' : fmtUsdc(gross)}</b></div>
						<div><span>Corridor fee ({(feeBps / 100).toFixed(2)}%, min {fmtUsdc(minFee)}), kept onchain</span><b>{q ? fmtUsdc(q.fee) : '...'}</b></div>
						<div><span>Circle fee (standard transfer)</span><b>0</b></div>
						<div><span>Gas on Sui and on Base</span><b>paid by Corridor</b></div>
						<div className="total"><span>Arrives on {BASE_SEPOLIA.name}</span><b>{q ? fmtUsdc(q.net) : '...'} USDC</b></div>
					</div>
					<div className="row mt">
						<button className="lg" data-testid="send" disabled={!q || q.net === 0n || !isAddress(to) || (bal.usdc != null && gross! > bal.usdc)} onClick={() => guard('Burning on Sui (Corridor pays the gas)', async () => {
							const digest = await sendOut(kp, gross!, to);
							track({ direction: 'out', tx: digest, at: Date.now(), amount: gross!.toString(), to });
							setTimeout(() => refresh(), 1500);
						})}>Bridge {gross == null ? '' : fmtUsdc(gross)} USDC</button>
					</div>
					{bal.usdc != null && gross != null && gross > bal.usdc && <p className="inline-err">More than your balance.</p>}
					<p className="ptb">One PTB: <b>corridor::send</b> takes the fee → <b>deposit_for_burn_with_package_auth</b> → <b>handler::burn</b> → <b>complete_burn</b>. Circle records Corridor's package as the sender, so the relayer only pays for Corridor transfers.</p>
				</section>

				<Inbound me={me} guard={guard} track={track} />
			</div>

			<div className="stack">
				<Transfers list={list} />
				<Recover track={track} />
				<CorridorCard cfg={cfg} />
			</div>
		</div>
	);
}

function Inbound({ me, guard, track }: { me: string; guard: Guard; track: (s: Saved) => void }) {
	const [from, setFrom] = useState<Hex | null>(null);
	const [amount, setAmount] = useState('0.5');
	const [step, setStep] = useState<string | null>(null);
	const gross = parseUsdc(amount);
	return (
		<section className="card">
			<div className="card-head">
				<span className="eyebrow">[ 02 / {BASE_SEPOLIA.name} to Sui ]</span>
				<span className="tag">fast transfer</span>
			</div>
			<p className="lede">Burn on Base with your browser wallet. Circle attests in seconds and the relayer mints on Sui, paying the SUI. Your Sui address needs no gas.</p>
			{!hasEvmWallet() ? (
				<p className="hint mt-s">No browser wallet here. From the repo: <code>pnpm inbound 0.5 {short(me)}</code></p>
			) : !from ? (
				<div className="row mt"><button className="ghost" data-testid="connect-evm" onClick={() => guard('Connecting your EVM wallet', async () => setFrom(await connectEvm()))}>Connect MetaMask</button></div>
			) : (
				<>
					<p className="hint mt-s">From <a className="mono" href={baseAcct(from)} target="_blank">{short(from)}</a> to {short(me)}</p>
					<div className="amount mt-s">
						<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount to bring in" />
						<span className="sym">USDC</span>
					</div>
					<div className="row mt">
						<button className="lg" disabled={!gross} onClick={() => guard('Bridging into Sui', async () => {
							const hash = await sendIn(from, gross!, me, setStep);
							setStep(null);
							track({ direction: 'in', tx: hash, at: Date.now(), amount: gross!.toString(), to: me });
						})}>Burn on Base</button>
					</div>
					{step && <p className="hint mt-s">{step}</p>}
				</>
			)}
		</section>
	);
}

function Transfers({ list }: { list: Saved[] }) {
	return (
		<section className="card">
			<div className="card-head" style={{ marginBottom: 14 }}>
				<span className="eyebrow">[ Transfers ]</span>
				<span className="count">{list.length} saved in this browser</span>
			</div>
			{list.length ? list.map((s) => <Transfer key={s.tx} s={s} />) : <p className="empty">Each transfer shows its burn, Circle's attestation and the mint. Close the tab mid-way and it picks up again here.</p>}
		</section>
	);
}

const STEPS_OUT = ['Fee taken, burned on Sui', 'Circle attested', 'Relayer minted on Base', 'Arrived'];
const STEPS_IN = ['Burned on Base', 'Circle attested', 'Relayer minted on Sui', 'Arrived'];

function Transfer({ s }: { s: Saved }) {
	const [p, setP] = useState<Progress | null>(null);
	const [err, setErr] = useState<string | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout>>();
	const poll = useCallback(async () => {
		try {
			const next = await relay(s.direction, s.tx);
			setP(next);
			setErr(null);
			if (next.stage !== 'minted' && next.stage !== 'rejected') timer.current = setTimeout(poll, 5000);
		} catch (e) {
			// The burn is safe. An error here is the relayer or Circle being slow: show pending, retry.
			setErr(e instanceof Error ? e.message : String(e));
			timer.current = setTimeout(poll, 8000);
		}
	}, [s.direction, s.tx]);
	useEffect(() => { poll(); return () => clearTimeout(timer.current); }, [poll]);

	const stage = p?.stage;
	const done = [true, stage === 'ready' || stage === 'minted', stage === 'minted', stage === 'minted'];
	const out = s.direction === 'out';
	const tag = stage === 'minted' ? <span className="tag good">arrived</span>
		: stage === 'rejected' ? <span className="tag warn">not relayed</span>
		: stage === 'ready' ? <span className="tag warn">attested, waiting for relayer</span>
		: <span className="tag plain">pending</span>;
	return (
		<div className="xfer" data-testid="transfer" data-stage={stage ?? 'loading'}>
			<div className="xfer-head">
				<strong>{fmtUsdc(BigInt(s.amount))} USDC · {out ? `Sui → ${BASE_SEPOLIA.name}` : `${BASE_SEPOLIA.name} → Sui`}</strong>
				{tag}
			</div>
			<div className="progress">
				{(out ? STEPS_OUT : STEPS_IN).map((label, i) => (
					<div key={label} className={done[i] ? 'done' : ''}>
						<span className="n">{String(i + 1).padStart(2, '0')}{done[i] && <span className="check"> ✓</span>}</span>
						<p>{label}</p>
					</div>
				))}
			</div>
			<div className="links">
				<span>burn <a href={out ? suiTx(s.tx) : baseTx(s.tx)} target="_blank" data-testid="burn">{s.tx}</a></span>
				{p?.destinationTx && <span>mint <a href={out ? baseTx(p.destinationTx) : suiTx(p.destinationTx)} target="_blank" data-testid="mint">{p.destinationTx}</a></span>}
				{p?.corridor && <span>fee {fmtUsdc(BigInt(p.corridor.fee))} kept by Corridor, {fmtUsdc(BigInt(p.corridor.net))} burned</span>}
				{p?.stage === 'minted' && p.amount && <span>minted {fmtUsdc(BigInt(p.amount) - BigInt(p.circleFee ?? 0))} to {short(p.mintRecipient ?? s.to)}{p.paidBy ? `, gas paid by ${short(p.paidBy)}` : ''}</span>}
			</div>
			{(p?.note || err) && <p className="note">{err ? `Still pending, retrying: ${err}` : p?.note}</p>}
		</div>
	);
}

function Recover({ track }: { track: (s: Saved) => void }) {
	const [v, setV] = useState('');
	const out = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(v.trim());
	const inb = /^0x[0-9a-fA-F]{64}$/.test(v.trim());
	return (
		<section className="card">
			<span className="eyebrow">[ Recover ]</span>
			<h2>Pick up any transfer</h2>
			<p className="lede">Paste a Sui digest or a Base transaction hash. The relayer keeps no database: it asks Circle and both chains, so repeating a step never pays twice.</p>
			<div className="inline mt">
				<input className="mono" data-testid="recover" value={v} onChange={(e) => setV(e.target.value)} placeholder="Sui digest or 0x hash" />
				<button className="ghost" data-testid="recover-go" disabled={!out && !inb} onClick={() => { track({ direction: out ? 'out' : 'in', tx: v.trim(), at: Date.now(), amount: '0', to: '' }); setV(''); }}>Track</button>
			</div>
		</section>
	);
}

function CorridorCard({ cfg }: { cfg: Config | null }) {
	const eth = cfg?.relayerEth == null ? null : Number(cfg.relayerEth) / 1e18;
	return (
		<section className="card">
			<span className="eyebrow">[ The corridor ]</span>
			<h2>Your bridge, as a business</h2>
			<div className="stats" data-testid="corridor">
				<div><span className="n">Fee</span><b>{cfg?.feeBps == null ? 'unknown' : `${(cfg.feeBps / 100).toFixed(2)}%`}</b></div>
				<div><span className="n">Minimum fee</span><b>{cfg?.minFee == null ? 'unknown' : `${fmtUsdc(BigInt(cfg.minFee))} USDC`}</b></div>
				<div><span className="n">Fees collected</span><b data-testid="vault">{cfg?.vault == null ? 'unknown' : `${fmtUsdc(BigInt(cfg.vault))} USDC`}</b></div>
				<div><span className="n">Relayer gas left</span><b>{eth == null ? 'unknown' : `${eth.toFixed(5)} ETH`}</b></div>
				<div><span className="n">Relayer (destination caller)</span><b className="small">{cfg ? <a href={baseAcct(cfg.relayer)} target="_blank">{short(cfg.relayer)}</a> : 'unknown'}</b></div>
				<div><span className="n">Sponsor (Sui gas)</span><b className="small">{cfg ? <a href={suiAcct(cfg.operator)} target="_blank">{short(cfg.operator)}</a> : 'unknown'}</b></div>
			</div>
			<p className="hint mt-s">Corridor object <a className="mono" href={`https://suiscan.xyz/testnet/object/${CORRIDOR.corridorId}`} target="_blank">{short(CORRIDOR.corridorId)}</a> · package <a className="mono" href={`https://suiscan.xyz/testnet/object/${CORRIDOR.pkg}`} target="_blank">{short(CORRIDOR.pkg)}</a></p>
		</section>
	);
}
