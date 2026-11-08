// Deck kit in the Account Layer Week "Seedless" style (Standing Order deck, 15 Oct 2026):
// DM Sans + JetBrains Mono, dark 07080F / paper F4F5F8 / blue 2338FF, mono [ EYEBROW ] labels.
// Measurements were read from Day2_Standing_Order_Seedless_Style.pptx. Reuse it for any day by
// passing a different footer and day label to createDeck().
const pptxgen = require('pptxgenjs');
const fs = require('node:fs');
const path = require('node:path');

const C = {
	dark: '07080F', paper: 'F4F5F8', blue: '2338FF', peri: 'A3B2FF', near: 'F2F4FB', pale: 'DFE4FF',
	ink: '0B0D12', muted: '4A4F5C', dim: '8D93AD', dcard: '171C30', dline: '262C44', code: '0C0F1D',
	line: 'E3E5EC', white: 'FFFFFF', row: 'ECEEF3', teal: '8BD5C8', amber: 'EBC17A', strip: 'E4E8FF', dstrip: '161C3A',
};
const W = 13.333333, M = 0.89, CW = 11.55;
const SANS = 'DM Sans', MONO = 'JetBrains Mono';

function createDeck({ title, subject, footerLeft, footerRight, total, glow }) {
	const p = new pptxgen();
	p.layout = 'LAYOUT_WIDE';
	p.author = 'Ruru | SuiHub Lagos';
	p.company = 'SuiHub Lagos';
	p.lang = 'en-GB';
	p.title = title;
	p.subject = subject;
	p.theme = { headFontFace: SANS, bodyFontFace: SANS, lang: 'en-GB' };
	const notes = [];
	// Quick Look caches shape renders by name, so repeated names ("Shape 5" on two slides) make it
	// draw one slide's shape on another. Every object gets a deck-unique name.
	let seq = 0;
	const uid = () => ({ objectName: `o${p._slides.length}-${++seq}` });

	const text = (s, t, x, y, w, h, size = 18, color = C.ink, more = {}) =>
		s.addText(t, { x, y, w, h, fontFace: SANS, fontSize: size, color, margin: 0, valign: 'top', ...uid(), ...more });
	const mono = (s, t, x, y, w, h, size = 12, color = C.blue, more = {}) => text(s, t, x, y, w, h, size, color, { fontFace: MONO, ...more });
	const box = (s, x, y, w, h, color, more = {}) => s.addShape('rect', { x, y, w, h, fill: { color }, line: { color, transparency: 100 }, ...uid(), ...more });
	const card = (s, x, y, w, h, fill, border) =>
		s.addShape('roundRect', { x, y, w, h, rectRadius: 0.1, fill: { color: fill }, line: border ? { color: border, width: 0.5 } : { color: fill, transparency: 100 }, ...uid() });

	function footer(s, tone) {
		const n = String(p._slides.length).padStart(2, '0');
		const color = tone === 'light' ? C.muted : C.dim;
		mono(s, footerLeft, M, 7.09, 7, 0.18, 8.5, color);
		mono(s, `${footerRight}   ${n} / ${String(total).padStart(2, '0')}`, 8.35, 7.09, 4.1, 0.18, 8.5, color, { align: 'right' });
	}

	function addNotes(s, heading, n) {
		const body = [
			'EXPLAIN\n' + n.explain,
			'SHOW / DO\n' + n.show,
			'ASK THE ROOM\n' + n.ask,
			'EXPECTED ANSWER\n' + n.answer,
			'TRANSITION\n' + n.next,
			n.refs ? 'REFERENCES\n' + n.refs : '',
		].filter(Boolean).join('\n\n');
		s.addNotes(body);
		notes.push({ n: p._slides.length, heading, body });
	}

	// 1. Cover: glow, circle glyph, lowercase name, periwinkle subtitle, link, event label.
	function cover({ glyph, name, subtitle, blurb, link, label, byline = 'RURU (@MINTING_RURU)', note }) {
		const s = p.addSlide();
		s.background = { color: C.dark };
		if (glow) s.addImage({ path: glow, x: 0, y: 0, w: W, h: 7.5, ...uid() });
		s.addShape('ellipse', { x: 6.2, y: 0.95, w: 0.94, h: 0.94, fill: { color: C.dark, transparency: 100 }, line: { color: C.near, width: 2 }, ...uid() });
		text(s, glyph, 6.2, 0.95, 0.94, 0.94, 30, C.near, { align: 'center', valign: 'middle' });
		text(s, name, M, 2.13, CW, 1.05, 64, C.near, { align: 'center', charSpacing: -2 });
		text(s, subtitle, M, 3.37, CW, 0.55, 28, C.peri, { align: 'center' });
		text(s, blurb, 2.18, 4.27, 8.97, 0.98, 18, C.pale, { align: 'center', lineSpacingMultiple: 1.1 });
		mono(s, [{ text: link.replace(/^https:\/\//, ''), options: { hyperlink: { url: link }, underline: { style: 'sng' }, color: C.peri } }], M, 5.57, CW, 0.3, 13, C.peri, { align: 'center' });
		mono(s, label, M, 6.43, CW, 0.28, 11, C.dim, { align: 'center', charSpacing: 1 });
		mono(s, byline, M, 6.86, CW, 0.23, 10, C.dim, { align: 'center' });
		addNotes(s, name + ': ' + subtitle, note);
		return s;
	}

	// 2. Statement: one idea on blue.
	function statement({ eyebrow, line1, line2, body, note }) {
		const s = p.addSlide();
		s.background = { color: C.blue };
		mono(s, `[ ${eyebrow} ]`, M, 1.2, CW, 0.28, 12, C.pale, { charSpacing: 1 });
		// Shrink a long first line so it stays on one line (DM Sans averages about 0.53 em per char).
		const fit = Math.min(51, Math.floor((CW * 72) / (line1.length * 0.53)));
		text(s, line1, M, 2.07 + (51 - fit) / 144, CW, 1.0, fit, C.near, { charSpacing: -1 });
		text(s, line2, M, 3.11, CW, 1.6, 46, C.pale, { charSpacing: -1, lineSpacingMultiple: 0.95 });
		text(s, body, M, 5.2, 10.8, 1.3, 19, C.pale, { lineSpacingMultiple: 1.12 });
		footer(s, 'blue');
		addNotes(s, line1, note);
		return s;
	}

	// 3. Section divider: huge mono number.
	function section({ eyebrow, number, title, note }) {
		const s = p.addSlide();
		s.background = { color: C.blue };
		mono(s, `[ ${eyebrow} ]`, M, 0.85, CW, 0.28, 12, C.pale, { charSpacing: 1 });
		mono(s, number, M, 2.05, 3, 1.1, 68, C.pale);
		text(s, title, M, 3.35, 10.9, 2.2, 54, C.near, { charSpacing: -1, lineSpacingMultiple: 0.95 });
		footer(s, 'blue');
		addNotes(s, number + ' ' + title, note);
		return s;
	}

	// 4. Content slide, light or dark.
	function slide({ tone = 'light', eyebrow, title, subtitle, note }) {
		const s = p.addSlide();
		const dark = tone === 'dark';
		s.background = { color: dark ? C.dark : C.paper };
		mono(s, `[ ${eyebrow} ]`, M, 0.84, CW, 0.28, 12, dark ? C.peri : C.blue, { charSpacing: 1 });
		text(s, title, M, 1.3, CW, 0.7, 40, dark ? C.near : C.ink, { charSpacing: -0.5 });
		if (subtitle) text(s, subtitle, M, 2.16, CW, 0.42, 14, dark ? C.dim : C.muted);
		footer(s, tone);
		addNotes(s, title, note);
		s.dark = dark;
		return s;
	}

	function bullets(s, items, x, y, w, { dot = C.blue, color = C.muted, size = 16.5, step = 0.48 } = {}) {
		items.forEach((t, i) => {
			const lines = Math.ceil(t.length / Math.floor(w * 7.2 * (16.5 / size)));
			text(s, '·', x, y + i * step, 0.16, 0.32, 18, dot);
			text(s, t, x + 0.2, y + i * step, w - 0.2, lines > 1 ? 0.62 : 0.35, size, color, { lineSpacingMultiple: 1.05 });
		});
	}

	// White card versus blue card, bullets in each.
	function compare(s, left, right, { y = 2.55, h = 4.25 } = {}) {
		[[left, 0.89, false], [right, 6.79, true]].forEach(([c, x, blue]) => {
			card(s, x, y, 5.65, h, blue ? C.blue : C.white, blue ? null : C.line);
			text(s, c.title, x + 0.29, y + 0.28, 5.07, 0.84, 23, blue ? C.near : C.ink);
			bullets(s, c.bullets, x + 0.28, y + 1.31, 5.27, { dot: blue ? C.peri : C.blue, color: blue ? C.pale : C.muted, step: c.step ?? 0.62 });
		});
	}

	// Numbered cards in a row; the last one is blue.
	function steps(s, items, { y = 3.35, h = 3.3, bodySize = 14 } = {}) {
		const n = items.length, gap = 0.18, w = (CW - gap * (n - 1)) / n;
		items.forEach((it, i) => {
			const x = M + i * (w + gap), last = i === n - 1, dark = s.dark;
			card(s, x, y, w, h, last ? C.blue : dark ? C.dcard : C.white, last ? null : dark ? C.dline : C.line);
			mono(s, String(i + 1).padStart(2, '0'), x + 0.23, y + 0.22, w - 0.46, 0.22, 11, last ? C.pale : dark ? C.peri : C.blue);
			text(s, it.title, x + 0.23, y + 0.59, w - 0.46, 0.4, 20, last || dark ? C.near : C.ink);
			text(s, it.body, x + 0.23, y + 1.11, w - 0.46, h - 1.3, bodySize, last ? C.pale : dark ? C.dim : C.muted, { lineSpacingMultiple: 1.05 });
		});
	}

	// Syntax-coloured code panel. lang: TYPESCRIPT, MOVE, SHELL, GRAPHQL.
	const KW = new Set('const let var export import from function return await async new if else public struct fun has use entry type true false null module mut query'.split(' '));
	function tokens(line, lang) {
		const out = [], re = lang === 'SHELL' ? /(#.*$|'[^']*'|"[^"]*"|\b\d[\d_,]*n?\b|\b[A-Za-z_][A-Za-z0-9_]*\b|\s+|.)/g : /(\/\/.*$|#.*$|'[^']*'|"[^"]*"|`[^`]*`|\b\d[\d_,]*n?\b|\b[A-Za-z_][A-Za-z0-9_]*\b|\s+|.)/g;
		let m;
		while ((m = re.exec(line))) {
			const t = m[0];
			let color = C.pale;
			if (t.startsWith('//') || (lang === 'SHELL' && t.startsWith('#'))) color = C.dim;
			else if (t.startsWith('#')) { out.push(...tokens(t.slice(0, 1), lang)); out.push(...tokens(t.slice(1), lang)); continue; }
			else if (/^['"`]/.test(t)) color = C.amber;
			else if (/^\d/.test(t)) color = C.teal;
			else if (KW.has(t)) color = C.peri;
			else if (/^[A-Z][A-Za-z0-9]*$/.test(t) && lang !== 'SHELL') color = C.teal;
			out.push({ text: t, options: { color } });
		}
		return out;
	}
	function code(s, source, { x = M, y = 2.88, w = CW, h = 3.92, lang = 'TYPESCRIPT', size = 11.5 } = {}) {
		card(s, x, y, w, h, C.code, C.dline);
		mono(s, lang, x + 0.28, y + 0.19, w - 0.56, 0.23, 10.5, C.dim, { charSpacing: 1 });
		// HTML renderers collapse ordinary spaces: indentation, aligned comments and blank lines use
		// no-break spaces so the code reads the same in PowerPoint, Keynote and the PDF.
		const NB = '\u00a0';
		const runs = [];
		source.split('\n').forEach((line, i, all) => {
			const t = line.length ? tokens(line, lang) : [{ text: NB, options: { color: C.pale } }];
			for (const r of t) r.text = r.text.replace(/^ +| {2,}/g, (m) => NB.repeat(m.length));
			if (i < all.length - 1) t[t.length - 1].options.breakLine = true;
			runs.push(...t);
		});
		mono(s, runs, x + 0.28, y + 0.58, w - 0.56, h - 0.76, size, C.pale, { lineSpacing: Math.round(size * 1.3) });
	}

	// Blue header row, then alternating white and pale rows.
	function table(s, rows, { x = M, y = 2.88, widths, rowH = 0.5, size = 14, monoCols = [], headH } = {}) {
		const total = widths.reduce((a, b) => a + b, 0);
		let ry = y;
		rows.forEach((r, i) => {
			const h = i === 0 ? (headH ?? rowH) : rowH;
			box(s, x, ry, total, h, i === 0 ? C.blue : i % 2 ? C.white : C.row);
			let cx = x;
			r.forEach((cell, j) => {
				const isMono = i > 0 && monoCols.includes(j);
				const color = i === 0 ? C.white : j === 0 ? C.ink : C.muted;
				(isMono ? mono : text)(s, cell, cx + 0.12, ry, widths[j] - 0.24, h, isMono ? size - 2 : size, color, { valign: 'middle' });
				cx += widths[j];
			});
			ry += h;
		});
		return ry;
	}

	// Numbered white cards, 3 across.
	function grid(s, items, { y = 2.55, h = 2.02, cols = 3, gapY = 0.21, bodySize = 14 } = {}) {
		const gap = 0.2, w = (CW - gap * (cols - 1)) / cols;
		items.forEach((it, i) => {
			const x = M + (i % cols) * (w + gap), cy = y + Math.floor(i / cols) * (h + gapY), dark = s.dark;
			card(s, x, cy, w, h, dark ? C.dcard : C.white, dark ? C.dline : C.line);
			mono(s, String(i + 1).padStart(2, '0'), x + 0.23, cy + 0.27, 0.4, 0.22, 11, dark ? C.peri : C.blue);
			text(s, it.title, x + 0.62, cy + 0.19, w - 0.85, 0.41, 17.5, dark ? C.near : C.ink);
			text(s, it.body, x + 0.23, cy + 0.68, w - 0.46, h - 0.82, bodySize, dark ? C.dim : C.muted, { lineSpacingMultiple: 1.05 });
		});
	}

	// Thin strip for a one-line takeaway.
	function bar(s, t, y = 6.42) {
		box(s, M, y, CW, 0.46, s.dark ? C.dstrip : C.strip);
		text(s, t, M + 0.18, y, CW - 0.36, 0.46, 14, s.dark ? C.pale : C.blue, { valign: 'middle' });
	}

	async function save(out, notesOut, header) {
		if (p._slides.length !== total) throw new Error(`TOTAL says ${total}, deck has ${p._slides.length}`);
		// Quick Look also mixes up shapes that share an id on neighbouring slides (pptxgenjs numbers
		// ids from 2 on every slide), so ids are renumbered to slide * 1000 + id before writing.
		const JSZip = require(require.resolve('jszip', { paths: [path.dirname(require.resolve('pptxgenjs'))] }));
		const zip = await JSZip.loadAsync(await p.write({ outputType: 'nodebuffer' }));
		for (const f of Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))) {
			const n = Number(f.match(/slide(\d+)\.xml$/)[1]);
			const xml = await zip.file(f).async('string');
			zip.file(f, xml.replace(/<p:cNvPr id="(\d+)"/g, (_, id) => `<p:cNvPr id="${n * 1000 + Number(id)}"`));
		}
		fs.writeFileSync(out, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
		const md = [header, ...notes.map((x) => `## ${String(x.n).padStart(2, '0')}. ${x.heading}\n\n${x.body}\n`)].join('\n');
		if (/\u2014/.test(md)) throw new Error('Em dash in speaker notes');
		fs.writeFileSync(notesOut, md);
		return { slides: p._slides.length, out, notesOut };
	}

	return { p, C, M, CW, W, text, mono, box, card, cover, statement, section, slide, bullets, compare, steps, code, table, grid, bar, save };
}

module.exports = { createDeck, C, M, CW, W, assets: path.join(__dirname, 'assets') };
