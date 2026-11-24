// UI check 2026-11-23, MAJOR findings at 1366 x 768: pins of the CSS and page rules that only Chrome shows (the DOM stand-in has no layout).
// The measured numbers are in ~/messungen/2026-11-23-release-1.0/ui-1366/. One block per finding (M1 .. M8, contrast).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const lies = (...teile) => fs.readFileSync(path.join(PUBLIC, ...teile), 'utf8');
const style = lies('style.css');
const loopCss = lies('loopdeck', 'loopdeck.css');
const loopJs = lies('loopdeck', 'view.js');
/** all `@media (max-width: 1500px) { ... }` blocks of a stylesheet, joined (each block ends at the first line that is just `}`) */
const schmal = (css) => { const t = [...css.matchAll(/@media \(max-width: 1500px\) \{\n([\s\S]*?)\n\}/g)].map((m) => m[1]); assert.ok(t.length, 'narrow block'); return t.join('\n'); };

test('M1: loop deck rows scroll with a VISIBLE scrollbar and a cut hint; below 1500 px the rows keep their base size (22 px) and scroll with the cut hint', () => {
  // the track columns keep the visible scrollbar; only the scene column hides its own (review item 1, see the scene key test)
  assert.doesNotMatch(loopCss, /\.zellen[^{]*\{[^}]*scrollbar-width: none/);
  assert.match(loopCss, /\.ld-spur \.zellen::-webkit-scrollbar, \.ld-szenenzeilen::-webkit-scrollbar \{ width: 4px; \}/);
  assert.match(loopCss, /\.ld-rumpf\.ld-schnitt \.zellen, \.ld-rumpf\.ld-schnitt \.ld-szenenzeilen \{ mask-image: linear-gradient/);
  // review decision: no row compaction below 1500 px (a mis-click in a live set is worse than scrolling)
  assert.doesNotMatch(schmal(loopCss), /grid-template-rows|minmax\(14px/);
  assert.match(loopCss, /\.ld-spur \.zellen, \.ld-szenenzeilen \{ display: grid; grid-template-rows: repeat\(8, minmax\(22px, 1fr\)\);/);
  assert.match(loopJs, /classList\.toggle\('ld-schnitt'/);
  assert.match(loopJs, /new ResizeObserver\(markiereSchnitt\)/);
});

test('M2: below 1500 px the loop cell leaves room for the name (2 px gaps, go key stays 22 px, 2 px track padding)', () => {
  const c = schmal(loopCss);
  assert.match(c, /\.ld-spur \.zelle \{ gap: 2px; padding-right: 2px; \}/);
  assert.doesNotMatch(c, /\.go \{ flex-basis/);   // the go key keeps its 22 px
  assert.match(c, /\.ld-spur \{ padding-left: 2px; padding-right: 2px; \}/);
});

test('M7: below 1500 px the deck closes its row gaps and padding so the LOOP -> 1 2 3 4 row stays inside a 221 px place', () => {
  assert.match(schmal(style), /#pult \.deck:not\(\.mini\) \{ row-gap: 2px; padding-top: 6px; padding-bottom: 6px; \}/);
  // it must come after the grid rule that sets `gap: 6px 12px`, or that rule wins
  assert.ok(style.indexOf('row-gap: 2px; padding-top: 6px') > style.indexOf('gap: 6px 12px; align-content: start'));
});

test('M3: big loop dialog: below 800 px of window height the bottom area is 200 px so the eight cells get about 20 px each', () => {
  const g = lies('loopdeck', 'gross.css');
  const i = g.indexOf('@media (max-height: 800px)');
  assert.ok(i > g.indexOf('#session-unten { display: flex'), 'after the 300 px rule');
  assert.match(g.slice(i), /#session-unten \{ flex-basis: 200px; height: 200px; \}/);
});

test('M5: the PRESETS panel of the dock scrolls (visible bar) and keeps a list of 2 rows (58 px) instead of 0, never more than the 1920 dock leaves (save fields inside the dock as at the base)', () => {
  const p = lies('presets.css');
  assert.match(p, /\.presets \{ padding-top: 8px; overflow: hidden auto; \}/);
  assert.match(p, /\.preset-rumpf \{[^}]*min-height: 0; flex: 1 0 58px; \}/);
});

test('M6: the BROWSE middle column scrolls and keeps a list of the table head and 5 rows (146 px) instead of 0', () => {
  assert.match(style, /\.st-mitte \{[^}]*min-height: 0; overflow-y: auto; \}/);
  assert.match(style, /\.st-liste \{ flex: 1 0 146px; overflow: auto; min-height: 0; \}/);
});

test('M8: Studio at every window size: the open shelf gets its height as room at the bottom of the grid, so the instrument controls are not covered', () => {
  const css = lies('werkbank', 'werkbank.css');
  assert.match(css, /\nbody\.werkbank #werkbank \{ padding-bottom: var\(--regal-hoehe, 0px\); \}/);
  assert.doesNotMatch(css, /max-height: 800px\) \{ body\.werkbank/);
  assert.match(lies('werkbank', 'regal.js'), /setProperty\('--regal-hoehe'/);
});

test('contrast: tracker empty cells, the song-list cells of the selected row and the COLOR PARAMETER label keep 4.5:1 (no opacity on text)', () => {
  const t = lies('tracker', 'tracker.css');
  assert.match(t, /#tracker \.t-c\.leer \{ color: #9a9da8; \}/);
  assert.match(t, /#tracker \.t-lied-zeile\.an \.t-lied-zelle \{ color: #0b0d12; \}/);
  assert.match(style, /\.colorfx\.filter-art \.colorknopf \{ opacity: \.4; \}/);
  assert.doesNotMatch(style, /\.colorfx\.filter-art \.colorparam > (span|output)[^{]*\{ opacity/);
});

test('M5 (follow-up): on a low window the preset list comes first and shows 3 rows (92 px) without scrolling', () => {
  const p = lies('presets.css');
  assert.match(p, /@media \(max-height: 800px\) \{\n  \.preset-rumpf \{ order: -1; flex: 0 0 92px; \}/);
  assert.match(p, /\.presets > :not\(\.preset-rumpf\) \{ flex-shrink: 0; \}/);
});

test('M2 (follow-up): loop names keep the end ("star…oop3") and carry the full name as tooltip', () => {
  const js = lies('session', 'spalte.js'), css = lies('session', 'spalte.css');
  assert.match(js, /const setzeName = /);
  assert.match(js, /e\.title = t/);
  assert.match(js, /setzeName\(c\.nm, /);
  assert.match(css, /\.nm-kopf \{[^}]*text-overflow: ellipsis/);
  assert.match(css, /\.nm-ende \{ flex: none; \}/);
});

test('Review 1: scene keys keep the full 22 px column (no own scrollbar) and, at the base row height of 22 px, no hit-area overlay', () => {
  assert.match(loopCss, /\.ld-szenenzeilen \{ scrollbar-width: none; \}/);
  assert.match(loopCss, /\.ld-szenenzeilen::-webkit-scrollbar \{ display: none; \}/);
  assert.doesNotMatch(loopCss, /\.ld-szene::before/);   // no overlap with the neighbour: every key is hit over its whole area
});

test('Review 2 (M6): in a low window type tabs and search stay on one row, the other filters fold behind FILTER, the list keeps head + 2 compact rows', () => {
  assert.match(style, /\.lib-mehr \{ display: none; \}/);
  assert.match(style, /\.st-kopf \.lib-filter:not\(\.offen\) > :is\(#lib-key, label\.klein, #lib-bpm, #lib-energie\) \{ display: none; \}/);
  assert.match(style, /\.st-mitte > \.st-liste \{ flex: 1 0 61px; \}/);
  assert.doesNotMatch(style, /\.st-liste \{ order: -1/);
  assert.match(style, /\.st-liste table \{ border-spacing: 0; \}/);
  assert.match(style, /\.st-liste tbody td \{ height: 21px; padding-top: 0; padding-bottom: 0; \}/);
  assert.match(style, /\.st-liste tbody button \{ padding-top: 1px; padding-bottom: 1px; min-height: 20px; line-height: 16px; vertical-align: middle; \}/);
  assert.match(lies('index.html'), /id="lib-mehr" class="lib-mehr" aria-expanded="false"/);
  assert.match(lies('library_view.js'), /\$\('#lib-mehr'\)\.addEventListener\('click'/);
});

test('Review 2 (M6): opening LIBRARY focuses the search field without scrolling the middle column over the list', () => {
  assert.match(lies('seitenrahmen.js'), /\$\('#lib-suche'\)\.focus\(\{ preventScroll: true \}\)/);
});

test('Review 4 (M7): below 1500 px the LOOP -> LOOP 1, 1 2 3 4 row has narrow keys so it stays on one line with two loop decks', () => {
  assert.match(style, /@media \(max-width: 1500px\) \{\n  body:not\(\.studio\) #pult \.cuewahl \.nachbox \{ margin-left: 2px; \}\n  body:not\(\.studio\) #pult \.cuewahl \.nachbox ~ button \{ padding: 0 5px; \}/);
  // after the rule that sets the 6 px indent, or that rule wins
  assert.ok(style.lastIndexOf('.nachbox { margin-left: 2px; }') > style.indexOf('.nachbox { margin-left: 6px; white-space: nowrap; }'));
});

test('Review 2: the preset name key is at least 20 px high (it was 19.6 px and shows in the low dock now)', () => {
  assert.match(lies('presets.css'), /\.preset-name \{[^}]*min-height: 20px;/);
});
