// Drives the Corridor app in headless Chrome against real testnets.
//   APP_URL=http://localhost:5293 pnpm e2e        (or the Vercel URL)
// Imports DEMO_SUI_KEY (a wallet with USDC and no SUI), bridges to the DEMO_EVM_KEY address,
// and waits until the transfer is minted on Base. With REQUIRE_MINT=0 it also accepts
// "attested, waiting for relayer" (useful before the relayer has ETH).
import './_env.js';
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { privateKeyToAccount } from 'viem/accounts';
import { need } from './_env.js';

const APP = process.env.APP_URL ?? 'http://localhost:5293';
const AMOUNT = process.env.AMOUNT ?? '0.2';
const REQUIRE_MINT = process.env.REQUIRE_MINT !== '0';
const SHOTS = new URL('./.shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
const to = privateKeyToAccount(need('DEMO_EVM_KEY') as `0x${string}`).address;

const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1200 });
page.on('console', (m) => m.type() === 'error' && console.log('  [console]', m.text().slice(0, 200)));
const text = (sel: string) => page.$eval(sel, (e) => (e as HTMLElement).innerText.trim());
async function idle() {
	await page.waitForFunction(() => !document.querySelector('[data-testid=busy]'), { timeout: 120_000 });
	if (await page.$('[data-testid=error]')) throw new Error('app error: ' + (await text('[data-testid=error]')));
}

await page.goto(APP, { waitUntil: 'networkidle0' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle0' });
await page.screenshot({ path: `${SHOTS}onboarding.png`, fullPage: true });

await page.type('[data-testid=import]', need('DEMO_SUI_KEY'));
await page.click('[data-testid=import-go]');
await page.waitForSelector('[data-testid=address]');
await page.waitForFunction(() => !document.querySelector('[data-testid=usdc]')?.textContent?.includes('unknown'), { timeout: 30_000 });
await page.waitForFunction(() => !document.querySelector('[data-testid=vault]')?.textContent?.includes('unknown'), { timeout: 30_000 });
const address = await text('[data-testid=address]');
const usdcBefore = await text('[data-testid=usdc]');
const vaultBefore = await text('[data-testid=vault]');
console.log(`wallet ${address}: ${usdcBefore}; corridor vault ${vaultBefore}`);

await page.$eval('[data-testid=amount]', (e) => ((e as HTMLInputElement).value = ''));
await page.click('[data-testid=amount]', { clickCount: 3 });
await page.type('[data-testid=amount]', AMOUNT);
await page.type('[data-testid=to]', to);
console.log('quote:', (await text('[data-testid=quote]')).replace(/\s+/g, ' '));
await page.click('[data-testid=send]');
await idle();
await page.waitForSelector('[data-testid=transfer] [data-testid=burn]');
const burn = await text('[data-testid=transfer] [data-testid=burn]');
console.log('burn on Sui:', burn);

const want = REQUIRE_MINT ? ['minted'] : ['minted', 'ready'];
await page.waitForFunction((w) => w.includes(document.querySelector('[data-testid=transfer]')?.getAttribute('data-stage') ?? ''), { timeout: 20 * 60_000, polling: 2000 }, want);
const stage = await page.$eval('[data-testid=transfer]', (e) => e.getAttribute('data-stage'));
const mint = (await page.$('[data-testid=transfer] [data-testid=mint]')) ? await text('[data-testid=transfer] [data-testid=mint]') : null;
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction(() => !document.querySelector('[data-testid=vault]')?.textContent?.includes('unknown'), { timeout: 30_000 });
const vaultAfter = await text('[data-testid=vault]');
const usdcAfter = await text('[data-testid=usdc]');
const card = (await text('[data-testid=transfer]')).replace(/\s+/g, ' ');
console.log(`stage ${stage}; mint ${mint}\nvault ${vaultBefore} -> ${vaultAfter}; wallet ${usdcBefore} -> ${usdcAfter}\ncard: ${card.slice(0, 400)}`);
await page.screenshot({ path: `${SHOTS}final.png`, fullPage: true });
await page.setViewport({ width: 390, height: 900 });
await page.screenshot({ path: `${SHOTS}phone.png`, fullPage: true });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

const ok = want.includes(stage ?? '') && vaultAfter !== vaultBefore && !overflow;
writeFileSync(new URL('./.e2e-result.json', import.meta.url), JSON.stringify({ app: APP, address, to, burn, stage, mint, vaultBefore, vaultAfter, usdcBefore, usdcAfter, overflow, ok }, null, 2));
console.log(ok ? 'PASS' : `FAIL${overflow ? ' (phone overflow)' : ''}`);
await browser.close();
if (!ok) process.exit(1);
