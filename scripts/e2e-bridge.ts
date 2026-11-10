// Drives the bridge app in headless Chrome with two test wallets injected the way real ones arrive:
// an EVM wallet announced over EIP-6963 and a Sui wallet registered with Wallet Standard. Each signs
// in Node with a testnet key from .env (DEMO_EVM_KEY, DEMO_SUI_KEY), so every route runs through the
// real UI, the real contracts and Circle's real attestation service.
//   APP_URL=http://localhost:5293 ROUTES=corridor-out,sui-out,sui-in,kit-forward pnpm e2e
import './_env.js';
import puppeteer, { type Page } from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction } from '@mysten/sui/transactions';
import { toBase64 } from '@mysten/sui/utils';
import * as BK from '@circle-fin/bridge-kit/chains';
import { createPublicClient, createWalletClient, defineChain, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { SUI } from '../shared/config.js';
import { need } from './_env.js';

const APP = process.env.APP_URL ?? 'http://localhost:5293';
const ROUTES = (process.env.ROUTES ?? 'corridor-out,sui-out,sui-in,kit-forward').split(',');
const AMOUNT = process.env.AMOUNT ?? '0.2';
const SHOTS = new URL('./.shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

// ── the EVM wallet (EIP-1193 in the page, signing here) ──────────────────
const evmAccount = privateKeyToAccount(need('DEMO_EVM_KEY') as Hex);
type BKc = { type: string; chainId?: number; rpcEndpoints?: string[]; isTestnet: boolean; name: string };
const rpcOf = new Map<number, string>();
for (const c of Object.values(BK as Record<string, unknown>) as BKc[]) if (c && typeof c === 'object' && c.type === 'evm' && c.chainId && c.rpcEndpoints?.[0]) rpcOf.set(c.chainId, c.rpcEndpoints[0]);
rpcOf.set(84532, process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org');
let chainId = 84532;
const chainFor = (id: number) => defineChain({ id, name: `chain ${id}`, nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpcOf.get(id)!] } } });
async function evmRequest(method: string, params: unknown[] = []) {
	switch (method) {
		case 'eth_requestAccounts': case 'eth_accounts': return [evmAccount.address];
		case 'eth_chainId': return `0x${chainId.toString(16)}`;
		case 'wallet_switchEthereumChain': {
			const id = Number((params[0] as { chainId: string }).chainId);
			if (!rpcOf.has(id)) throw Object.assign(new Error('Unrecognized chain'), { code: 4902 });
			chainId = id;
			return null;
		}
		case 'wallet_addEthereumChain': return null;
		case 'wallet_getCapabilities': case 'wallet_sendCalls': throw Object.assign(new Error('Method not supported'), { code: 4200 });
		case 'eth_sendTransaction': {
			const tx = params[0] as { to: Hex; data?: Hex; value?: Hex; gas?: Hex };
			const wal = createWalletClient({ account: evmAccount, chain: chainFor(chainId), transport: http(rpcOf.get(chainId)) });
			const hash = await wal.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : undefined, gas: tx.gas ? BigInt(tx.gas) : undefined });
			console.log(`  [evm wallet] sent ${hash} on chain ${chainId}`);
			return hash;
		}
		case 'personal_sign': case 'eth_signTypedData_v4': case 'eth_sign':
			throw Object.assign(new Error(`${method} is not used by this app`), { code: 4200 });
		default: {
			// Reads go straight to the current chain's RPC, as a real wallet would.
			const pub = createPublicClient({ chain: chainFor(chainId), transport: http(rpcOf.get(chainId)) });
			return pub.request({ method: method as never, params: params as never });
		}
	}
}

// ── the Sui wallet (Wallet Standard in the page, signing here) ──────────
const suiKp = Ed25519Keypair.fromSecretKey(need('DEMO_SUI_KEY'));
const sui = new SuiGrpcClient({ network: SUI.network, baseUrl: SUI.grpc });
async function suiSign(json: string) {
	const bytes = await Transaction.from(json).build({ client: sui });
	const { signature } = await suiKp.signTransaction(bytes);
	return { bytes: toBase64(bytes), signature };
}
async function suiSignExec(json: string) {
	const { bytes, signature } = await suiSign(json);
	const r = await sui.core.executeTransaction({ transaction: Uint8Array.from(Buffer.from(bytes, 'base64')), signatures: [signature], include: { effects: true } });
	const t = r.Transaction ?? r.FailedTransaction!;
	console.log(`  [sui wallet] executed ${t.digest} ${t.status.success ? 'ok' : JSON.stringify(t.status.error)}`);
	return { digest: t.digest, bytes, signature, effects: '' };
}

function inject(evmAddress: string, suiAddress: string, suiPub: number[]) {
	const icon = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiLz4=';
	const w = window as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
	const provider = {
		request: async ({ method, params }: { method: string; params?: unknown[] }) => {
			const r = (await w.__evm(method, params ?? [])) as { ok: boolean; v?: unknown; e?: { message: string; code?: number } };
			if (!r.ok) throw Object.assign(new Error(r.e!.message), { code: r.e!.code });
			return r.v;
		},
		on: () => {}, removeListener: () => {},
	};
	const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info: { uuid: 'test-evm', name: 'Test EVM Wallet', icon, rdns: 'test.evm' }, provider }) }));
	window.addEventListener('eip6963:requestProvider', announce);
	announce();

	const account = { address: suiAddress, publicKey: new Uint8Array(suiPub), chains: ['sui:testnet'], features: ['sui:signTransaction', 'sui:signAndExecuteTransaction'] };
	const call = async (name: string, transaction: { toJSON: () => Promise<string> }) => {
		const r = (await w[name](await transaction.toJSON())) as { ok: boolean; v?: unknown; e?: { message: string } };
		if (!r.ok) throw new Error(r.e!.message);
		return r.v;
	};
	const wallet = {
		version: '1.0.0', name: 'Test Sui Wallet', icon, chains: ['sui:testnet'], accounts: [account],
		features: {
			'standard:connect': { version: '1.0.0', connect: async () => ({ accounts: [account] }) },
			'standard:events': { version: '1.0.0', on: () => () => {} },
			'sui:signTransaction': { version: '2.0.0', signTransaction: ({ transaction }: { transaction: { toJSON: () => Promise<string> } }) => call('__suiSign', transaction) },
			'sui:signAndExecuteTransaction': { version: '2.0.0', signAndExecuteTransaction: ({ transaction }: { transaction: { toJSON: () => Promise<string> } }) => call('__suiSignExec', transaction) },
		},
	};
	const register = (api: { register: (w: unknown) => void }) => api.register(wallet);
	window.addEventListener('wallet-standard:app-ready', ((e: CustomEvent) => register(e.detail)) as EventListener);
	window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: register }));
}

const wrap = (f: (...a: never[]) => Promise<unknown>) => async (...a: never[]) => {
	try { return { ok: true, v: await f(...a) }; } catch (e) { const x = e as { message?: string; code?: number }; return { ok: false, e: { message: x.message ?? String(e), code: x.code } }; }
};

const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1300 });
page.on('console', (m) => m.type() === 'error' && !m.text().includes('status of 400') && console.log('  [console]', m.text().slice(0, 240)));
page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 300)));
await page.exposeFunction('__evm', wrap(evmRequest as never));
await page.exposeFunction('__suiSign', wrap(suiSign as never));
await page.exposeFunction('__suiSignExec', wrap(suiSignExec as never));
// tsx keeps function names with an __name helper; the page needs it too.
await page.evaluateOnNewDocument('globalThis.__name = (f) => f;');
await page.evaluateOnNewDocument(inject, evmAccount.address, suiKp.toSuiAddress(), [...suiKp.getPublicKey().toRawBytes()]);

await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForSelector('[data-testid=connect-evm]', { timeout: 120_000 });
await page.screenshot({ path: `${SHOTS}bridge-1-start.png`, fullPage: true });

async function connect(p: Page, eco: 'evm' | 'sui') {
	await p.click(`[data-testid=connect-${eco}]`);
	await p.waitForSelector(`[data-testid=wallet-${eco}] [data-testid=wallet-option]`);
	await p.click(`[data-testid=wallet-${eco}] [data-testid=wallet-option]`);
	await p.waitForSelector(`[data-testid=addr-${eco}]`);
}
await connect(page, 'evm');
await connect(page, 'sui');
console.log(`wallets: evm ${evmAccount.address}, sui ${suiKp.toSuiAddress()}`);

type Route = { from: string; to: string; gas: 'corridor' | 'self' | 'circle'; fast?: boolean };
const DEF: Record<string, Route> = {
	'corridor-out': { from: 'Sui_Testnet', to: 'Base_Sepolia', gas: 'corridor' },
	'sui-out': { from: 'Sui_Testnet', to: 'Base_Sepolia', gas: 'self' },
	'sui-in': { from: 'Base_Sepolia', to: 'Sui_Testnet', gas: 'self', fast: true },
	'corridor-in': { from: 'Base_Sepolia', to: 'Sui_Testnet', gas: 'corridor', fast: true },
	'kit-forward': { from: 'Base_Sepolia', to: 'Arbitrum_Sepolia', gas: 'circle', fast: true },
	'kit-self': { from: 'Base_Sepolia', to: 'Arbitrum_Sepolia', gas: 'self', fast: true },
};

const results: Record<string, unknown> = {};
for (const name of ROUTES) {
	const r = DEF[name];
	const t0 = Date.now();
	console.log(`\n== ${name}: ${r.from} -> ${r.to}, gas ${r.gas}`);
	await page.select('[data-testid=from]', r.from);
	await page.select('[data-testid=to]', r.to);
	await page.click('[data-testid=amount]', { count: 3 });
	await page.type('[data-testid=amount]', AMOUNT);
	if (await page.$('[data-testid=fast]:not([disabled])')) await page.click(r.fast ? '[data-testid=fast]' : '[data-testid=standard]');
	await page.waitForSelector(`[data-testid=gas-${r.gas}]`);
	await page.click(`[data-testid=gas-${r.gas}]`);
	await page.waitForFunction(() => !document.querySelector('[data-testid=bridge]')?.hasAttribute('disabled'), { timeout: 30_000 }).catch(async () => {
		throw new Error(`bridge button disabled: ${await page.$eval('[data-testid=problem]', (e) => e.textContent).catch(() => '?')}`);
	});
	console.log('quote:', (await page.$eval('[data-testid=quote]', (e) => (e as HTMLElement).innerText)).replace(/\s+/g, ' '));
	await page.click('[data-testid=bridge]');
	let state = '';
	for (let i = 0; i < 600; i++) {
		state = await page.$eval('[data-testid=transfer]', (e) => e.getAttribute('data-state') ?? '').catch(() => '');
		if (state === 'done' || state === 'error') break;
		if (state === 'claim') { await page.click('[data-testid=retry]'); }
		await new Promise((res) => setTimeout(res, 2000));
	}
	const get = (id: string) => page.$eval(`[data-testid=transfer] [data-testid=${id}]`, (e) => e.textContent).catch(() => null);
	const out = { state, burn: await get('burn'), mint: await get('mint'), error: await get('transfer-error'), seconds: Math.round((Date.now() - t0) / 1000) };
	console.log(out);
	results[name] = out;
	await page.screenshot({ path: `${SHOTS}bridge-${name}.png`, fullPage: true });
	if (state !== 'done') break;
}
await page.setViewport({ width: 390, height: 900 });
await page.screenshot({ path: `${SHOTS}bridge-phone.png`, fullPage: true });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
const ok = ROUTES.every((n) => (results[n] as { state?: string } | undefined)?.state === 'done') && !overflow;
writeFileSync(new URL('./.e2e-bridge.json', import.meta.url), JSON.stringify({ app: APP, at: new Date().toISOString(), results, overflow, ok }, null, 2));
console.log(ok ? 'PASS' : `FAIL${overflow ? ' (phone overflow)' : ''}`);
await browser.close();
if (!ok) process.exit(1);
