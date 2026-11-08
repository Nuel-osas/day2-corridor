// Render the deck to PDF on macOS: Quick Look HTML -> fonts and shape fixes -> Chrome print.
//   PYTHON=/path/to/python-with-pymupdf pnpm slides:pdf
// Also writes one PNG per slide (SHOTS dir) so every page can be checked by eye.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const here = new URL('.', import.meta.url).pathname;
const name = 'Day2_Build_Your_Own_Bridge';
const pptx = join(here, `${name}.pptx`);
const pdf = join(here, `${name}.pdf`);
const work = process.env.WORK ?? mkdtempSync(join(tmpdir(), 'deck-'));
const shots = process.env.SHOTS ?? join(work, 'shots');
mkdirSync(shots, { recursive: true });

execFileSync('qlmanage', ['-p', '-o', work, pptx], { stdio: 'ignore' });
const preview = join(work, readdirSync(work).find((f) => f.endsWith('.qlpreview'))!);
execFileSync(process.env.PYTHON ?? 'python3', [join(here, 'render-quicklook.py'), preview], { stdio: 'inherit' });

const browser = await puppeteer.launch({
	executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	headless: true,
	args: ['--allow-file-access-from-files'],
});
const page = await browser.newPage();
await page.setViewport({ width: 960, height: 540, deviceScaleFactor: 2 });
await page.goto('file://' + join(preview, 'Rendered.html'), { waitUntil: 'networkidle0' });
await page.evaluate(() => document.fonts.ready);
const slides = await page.$$('div.slide');
for (const [i, el] of slides.entries()) await el.screenshot({ path: join(shots, `slide-${String(i + 1).padStart(2, '0')}.png`) });
await page.pdf({ path: pdf, width: '960px', height: '540px', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
await browser.close();
console.log(`${slides.length} slides -> ${pdf}\nshots: ${shots}`);
if (process.env.COPY_TO) for (const f of [`${name}.pptx`, `${name}.pdf`, 'day2-speaker-notes.md']) copyFileSync(join(here, f), join(process.env.COPY_TO, f));
