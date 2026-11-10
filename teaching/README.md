# Teaching: Day 2 Deck and Speaker Notes

- `Day2_Build_Your_Own_Bridge.pptx`: 13 editable slides with presenter notes.
- `Day2_Build_Your_Own_Bridge.pdf`: the same deck rendered with the real fonts.
- `day2-speaker-notes.md`: before-class checks, run of show, and the notes for every slide.

## Rebuild

```sh
pnpm slides                                    # pptx + speaker notes
PYTHON=/path/to/python-with-pymupdf pnpm slides:pdf   # macOS only: Quick Look + Chrome
```

`pnpm slides:pdf` asks Quick Look for an HTML preview of the pptx, rasterises the shapes Quick Look stores as PDFs (`render-quicklook.py`, needs PyMuPDF), injects the fonts from `fonts/`, and prints the PDF in Chrome. Set `SHOTS=<dir>` to keep one PNG per slide for checking.

## The style kit

`deck-kit.cjs` holds the Account Layer Week look (the Standing Order deck): DM Sans and JetBrains Mono, dark `07080F`, paper `F4F5F8`, blue `2338FF`, periwinkle `A3B2FF`, mono `[ EYEBROW ]` labels. Pass a different footer and day label to `createDeck()` to reuse it for another day. Slide types: `cover`, `statement`, `section`, `slide` (light or dark) with `compare`, `steps`, `code`, `table`, `grid` and `bar`.

Two Quick Look quirks the kit works around:

- It caches shape renders by name and by id, so a shape on one slide can be drawn on the next. Every object gets a deck-unique name, and ids are renumbered to `slide * 1000 + id` on save.
- Its HTML collapses repeated spaces, so code indentation, aligned comments and blank lines use no-break spaces.

Fonts are under the SIL Open Font License; the licences are in `fonts/`.

## Day 2 specifics

The kit is copied unchanged from the Day 1 repo. The deck teaches the app in this repo: a bridge built the way bridge.setsuna.finance is, with users' own wallets, Bridge Kit for EVM routes, our own PTBs for Sui routes, and a choice of who pays the gas. Slide 12 (Proof) lists transactions from the 10 November run on the live site (`RUN` at the top of `generate-slides.cjs`); a row whose id is missing prints as "pending", never as done.
