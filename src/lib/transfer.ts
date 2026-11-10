// One transfer, four steps: approve, burn, attest, mint. The record is saved after every step, so a
// closed tab never loses a transfer, and a burn hash alone is enough to pick it up anywhere.
import type { Hex } from 'viem';
import { BASE_SEPOLIA } from '../../shared/config';
import { relay } from './api';
import { CHAINS, type Chain, chainByDomain, chainById, txUrl } from './chains';
import { evmBurn, evmMessageUsed, evmMint, evmTo32, settleEvmBurn } from './evm';
import { irisMessage, waitForAttestation } from './iris';
import { type KitResult, kitBridge, kitRetry, onKitStep } from './kit';
import { corridorSend, suiAddress32, suiBurn, suiMint } from './sui';
import type { Connected, Ecosystem } from './wallets';

export type StepKey = 'approve' | 'burn' | 'attest' | 'mint';
export type StepState = 'idle' | 'live' | 'done' | 'skip' | 'error';
/** self: the user claims on the destination. circle: Circle's Forwarding Service. corridor: our relayer. */
export type GasMode = 'self' | 'circle' | 'corridor';

export type Transfer = {
	id: string;
	from: string; // chain id
	to: string;
	amount: string; // decimal USDC, what is burned
	units: string; // the same, in base units
	fast: boolean;
	gas: GasMode;
	sender: string;
	recipient: string;
	steps: Record<StepKey, { state: StepState; tx?: string; url?: string }>;
	state: 'live' | 'claim' | 'done' | 'error';
	error?: string;
	note?: string;
	kit?: KitResult; // Bridge Kit's result, kept for kit.retry
	createdAt: number;
	doneAt?: number;
};

const KEY = 'corridor-v2:transfers';
export function loadTransfers(): Transfer[] {
	try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
}
function save(t: Transfer) {
	try {
		const rest = loadTransfers().filter((x) => x.id !== t.id);
		localStorage.setItem(KEY, JSON.stringify([t, ...rest].slice(0, 30), (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
	} catch { /* private window: the transfer lives for this tab only */ }
}

export const emptySteps = (): Transfer['steps'] => ({ approve: { state: 'idle' }, burn: { state: 'idle' }, attest: { state: 'idle' }, mint: { state: 'idle' } });
const ORDER: StepKey[] = ['approve', 'burn', 'attest', 'mint'];

type Emit = (t: Transfer) => void;
type Wallets = Partial<Record<Ecosystem, Connected>>;

function patch(t: Transfer, p: Partial<Transfer>, emit: Emit) {
	Object.assign(t, p);
	save(t);
	emit(structuredClone(t));
}
function live(t: Transfer, k: StepKey) {
	ORDER.slice(0, ORDER.indexOf(k)).forEach((s) => { if (t.steps[s].state === 'idle' || t.steps[s].state === 'live') t.steps[s].state = t.steps[s].tx ? 'done' : 'skip'; });
	t.steps[k] = { ...t.steps[k], state: 'live' };
}
function landed(t: Transfer, to: Chain, emit: Emit, tx?: string | null, note?: string) {
	ORDER.forEach((k) => { if (t.steps[k].state !== 'done') t.steps[k].state = t.steps[k].tx ? 'done' : k === 'approve' ? 'skip' : 'done'; });
	if (tx) t.steps.mint = { state: 'done', tx, url: txUrl(to, tx) };
	patch(t, { state: 'done', doneAt: t.doneAt ?? Date.now(), error: undefined, note }, emit);
}

/** What the recipient looks like as CCTP's 32-byte mint recipient on `to`. */
const recipient32 = (to: Chain, addr: string) => (to.ecosystem === 'evm' ? evmTo32(addr) : (suiAddress32(addr) as Hex));
/** Circle's fast fee into Sui was 1 bp on live mints and Iris has no quote for Sui routes: cap at 5 bp. */
const fastCap = (units: bigint) => { const f = (units * 5n) / 10_000n; return f > 0n ? f : 1n; };

export async function runTransfer(t: Transfer, wallets: Wallets, emit: Emit) {
	const from = chainById(t.from)!, to = chainById(t.to)!;
	try {
		patch(t, { state: 'live', error: undefined }, emit);
		if (from.ecosystem === 'evm' && to.ecosystem === 'evm' && (!t.steps.burn.tx || t.kit)) return await runKit(t, from, to, wallets, emit);
		if (t.gas === 'corridor') return await runCorridor(t, from, to, wallets, emit);
		return await runOwnLegs(t, from, to, wallets, emit);
	} catch (e) {
		const err = e as { shortMessage?: string; message?: string };
		ORDER.forEach((k) => { if (t.steps[k].state === 'live') t.steps[k].state = 'error'; });
		// After a burn the money is safe: say what is pending, never that it failed.
		const burned = !!t.steps.burn.tx && t.steps.burn.state === 'done';
		patch(t, { state: 'error', error: (err.shortMessage ?? err.message ?? 'Something went wrong').split('\n')[0] + (burned ? ' Your USDC is safe: the burn is done, retry to finish.' : '') }, emit);
	}
}

// EVM to EVM: Bridge Kit runs all four steps.
async function runKit(t: Transfer, from: Chain, to: Chain, wallets: Wallets, emit: Emit) {
	const w = wallets.evm;
	if (!w?.evm) throw new Error('Connect an EVM wallet to send.');
	const off = onKitStep((k, tx) => {
		t.steps[k] = { state: 'done', tx: tx ?? t.steps[k].tx, url: tx ? txUrl(k === 'mint' ? to : from, tx) : t.steps[k].url };
		const next = ORDER[ORDER.indexOf(k) + 1];
		if (next && t.steps[next].state === 'idle') t.steps[next].state = 'live';
		patch(t, {}, emit);
	});
	try {
		if (t.steps.approve.state === 'idle') live(t, 'approve');
		patch(t, {}, emit);
		const result = t.kit
			? await kitRetry(t.kit, w.evm)
			: await kitBridge({ provider: w.evm, from: from.id, to: to.id, amount: t.amount, fast: t.fast, recipient: t.recipient, owner: w.address, gasInUsdc: t.gas === 'circle' });
		for (const s of result.steps ?? []) {
			const n = s.name.toLowerCase();
			const k: StepKey | undefined = n.includes('approv') ? 'approve' : n.includes('burn') ? 'burn' : n.includes('attest') ? 'attest' : n.includes('mint') ? 'mint' : undefined;
			if (!k) continue;
			const chain = k === 'mint' ? to : from;
			t.steps[k] = { state: s.state === 'success' ? 'done' : s.state === 'noop' ? 'skip' : s.state === 'error' ? 'error' : t.steps[k].state, tx: s.txHash ?? t.steps[k].tx, url: s.txHash ? txUrl(chain, s.txHash) : t.steps[k].url };
		}
		if (result.state === 'success') {
			// With the forwarder, Circle sends the mint: find its hash at Iris.
			if (t.gas === 'circle' && !t.steps.mint.tx && t.steps.burn.tx) {
				const m = await irisMessage(from.domain, t.steps.burn.tx);
				if (m?.forwardTx) t.steps.mint = { state: 'done', tx: m.forwardTx, url: txUrl(to, m.forwardTx) };
			}
			t.kit = result;
			landed(t, to, emit, null, t.gas === 'circle' ? 'Delivered by Circle' : undefined);
		} else {
			const failed = result.steps?.find((s) => s.state === 'error');
			patch(t, { state: 'error', kit: result, error: failed?.error?.message ?? 'Stopped. Retry from the failed step.' }, emit);
		}
	} finally {
		off();
	}
}

// Any route that touches Sui, the user claims: burn, attestation from Iris, mint with the user's
// wallet on the destination. Resumable at every step.
async function runOwnLegs(t: Transfer, from: Chain, to: Chain, wallets: Wallets, emit: Emit) {
	const units = BigInt(t.units);
	await burnStep(t, from, to, wallets, emit, units, t.fast && from.fast ? fastCap(units) : 0n);
	live(t, 'attest');
	patch(t, {}, emit);
	const m = await waitForAttestation(from.domain, t.steps.burn.tx!, t.fast);
	t.steps.attest = { state: 'done' };
	live(t, 'mint');
	patch(t, {}, emit);

	if (to.ecosystem === 'evm') {
		if (await evmMessageUsed(to, m.message)) return landed(t, to, emit, null, 'Already minted');
		const w = wallets.evm;
		if (!w?.evm) return patch(t, { state: 'claim', note: `Attested. Connect an EVM wallet to claim on ${to.name}.` }, emit);
		const tx = await evmMint({ provider: w.evm, owner: w.address, chain: to, message: m.message, attestation: m.attestation, onSent: (h) => { t.steps.mint = { state: 'live', tx: h, url: txUrl(to, h) }; patch(t, {}, emit); } });
		return landed(t, to, emit, tx);
	}
	const w = wallets.sui;
	if (!w?.sui) return patch(t, { state: 'claim', note: 'Attested. Connect a Sui wallet to claim on Sui.' }, emit);
	try {
		const tx = await suiMint({ wallet: w.sui, owner: w.address, message: m.message, attestation: m.attestation });
		return landed(t, to, emit, tx);
	} catch (e) {
		// Someone else (or an earlier attempt) may have minted it: ask Corridor's relayer, which reads is_nonce_used.
		if (from.domain === BASE_SEPOLIA.domain) {
			const p = await relay('in', t.steps.burn.tx!).catch(() => null);
			if (p?.stage === 'minted') return landed(t, to, emit, p.destinationTx ?? null, 'Already minted');
		}
		throw e;
	}
}

// Sui <-> Base Sepolia through Corridor: our fee, our gas, our relayer.
async function runCorridor(t: Transfer, from: Chain, to: Chain, wallets: Wallets, emit: Emit) {
	const units = BigInt(t.units);
	if (from.ecosystem === 'sui' && !t.steps.burn.tx) {
		const w = wallets.sui;
		if (!w?.sui) throw new Error('Connect a Sui wallet to send.');
		live(t, 'burn');
		patch(t, {}, emit);
		const digest = await corridorSend({ wallet: w.sui, owner: w.address, amount: units, evmRecipient: t.recipient });
		t.steps.burn = { state: 'done', tx: digest, url: txUrl(from, digest) };
	} else if (from.ecosystem === 'evm') {
		await burnStep(t, from, to, wallets, emit, units, t.fast && from.fast ? fastCap(units) : 0n);
	}
	live(t, 'attest');
	patch(t, {}, emit);
	const dir = from.ecosystem === 'sui' ? 'out' : 'in';
	for (;;) {
		const p = await relay(dir, t.steps.burn.tx!).catch(() => null);
		if (p?.stage === 'minted') return landed(t, to, emit, p.destinationTx ?? null, 'Gas paid by Corridor');
		if (p?.stage === 'rejected') throw new Error(`Corridor's relayer will not mint this transfer: ${p.note ?? 'not a Corridor transfer'}`);
		if (p?.stage === 'ready' && t.steps.attest.state !== 'done') { t.steps.attest = { state: 'done' }; live(t, 'mint'); patch(t, { note: p.note }, emit); }
		await new Promise((r) => setTimeout(r, 3000));
	}
}

/** Approve and burn on the source, or settle a burn we recorded but never saw confirm. Never burns twice. */
async function burnStep(t: Transfer, from: Chain, to: Chain, wallets: Wallets, emit: Emit, units: bigint, maxFee: bigint) {
	if (t.steps.burn.tx) {
		if (t.steps.burn.state !== 'done' && from.ecosystem === 'evm') {
			live(t, 'burn');
			patch(t, {}, emit);
			if (!(await settleEvmBurn(from, t.steps.burn.tx))) {
				t.steps.burn = { state: 'idle' };
				throw new Error('The burn reverted, so nothing left your wallet. Retry to send it.');
			}
		}
		t.steps.burn = { ...t.steps.burn, state: 'done' };
		return;
	}
	const r32 = recipient32(to, t.recipient);
	if (from.ecosystem === 'sui') {
		const w = wallets.sui;
		if (!w?.sui) throw new Error('Connect a Sui wallet to send.');
		t.steps.approve = { state: 'skip' };
		live(t, 'burn');
		patch(t, {}, emit);
		const digest = await suiBurn({ wallet: w.sui, owner: w.address, amount: units, destDomain: to.domain, recipient32: r32 });
		t.steps.burn = { state: 'done', tx: digest, url: txUrl(from, digest) };
		return patch(t, {}, emit);
	}
	const w = wallets.evm;
	if (!w?.evm) throw new Error('Connect an EVM wallet to send.');
	live(t, 'approve');
	patch(t, {}, emit);
	const hash = await evmBurn({
		provider: w.evm, owner: w.address, chain: from, amount: units, destDomain: to.domain, recipient32: r32, maxFee,
		finality: maxFee > 0n ? 1000 : 2000,
		onApproved: (tx) => { t.steps.approve = tx ? { state: 'done', tx, url: txUrl(from, tx) } : { state: 'skip' }; live(t, 'burn'); patch(t, {}, emit); },
		onBurnSent: (tx) => { t.steps.burn = { state: 'live', tx, url: txUrl(from, tx) }; patch(t, {}, emit); },
	});
	t.steps.burn = { state: 'done', tx: hash, url: txUrl(from, hash) };
	patch(t, {}, emit);
}

/**
 * Find a transfer from its burn hash alone, on any device: Iris knows the source domain, the
 * destination, the amount and the recipient. Then ask the destination whether it was minted.
 */
export async function findByHash(raw: string): Promise<Transfer | null> {
	const hash = raw.trim();
	const isEvm = /^0x[0-9a-fA-F]{64}$/.test(hash), isSui = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(hash);
	if (!isEvm && !isSui) return null;
	const domains = CHAINS.filter((c) => (isSui ? c.ecosystem === 'sui' : c.ecosystem === 'evm')).map((c) => c.domain);
	const found = (await Promise.all(domains.map((d) => irisMessage(d, hash)))).find((m) => m && m.amount);
	if (!found) return null;
	const from = chainByDomain(found.sourceDomain), to = chainByDomain(found.destinationDomain);
	if (!from || !to) return null;
	const units = BigInt(found.amount!);
	const recipient = to.ecosystem === 'evm' ? `0x${found.mintRecipient!.slice(-40)}` : found.mintRecipient!;
	const corridorCaller = !!found.destinationCaller && BigInt(found.destinationCaller) !== 0n;
	const t: Transfer = {
		id: `${from.domain}:${hash}`, from: from.id, to: to.id, amount: (Number(units) / 1e6).toString(), units: units.toString(),
		fast: false, gas: corridorCaller ? 'corridor' : found.forwardTx ? 'circle' : 'self', sender: '', recipient,
		steps: { ...emptySteps(), approve: { state: 'skip' }, burn: { state: 'done', tx: hash, url: txUrl(from, hash) } },
		state: 'live', note: 'Found by burn hash', createdAt: Date.now(),
	};
	if (found.forwardTx) { landed(t, to, () => {}, found.forwardTx, 'Delivered by Circle'); return t; }
	if (found.ready) {
		t.steps.attest = { state: 'done' };
		const used = to.ecosystem === 'evm' ? await evmMessageUsed(to, found.message) : null;
		if (used) { landed(t, to, () => {}, null, 'Already minted'); return t; }
		t.state = 'claim';
		t.note = 'Attested and not minted yet. Connect the recipient wallet and press Claim.';
	}
	save(t);
	return t;
}
