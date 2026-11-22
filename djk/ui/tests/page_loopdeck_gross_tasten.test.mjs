// Loop deck pop-up and the keyboard: the page shortcuts of seitenrahmen.js stay quiet while it is open (Esc used to close the pop-up AND fold the
// library), a failed open leaves nothing behind, and the first Esc closes only a dock popover. The stand-in's document has no event dispatch, so a
// collecting document and window are installed before the real app.js loads; `taste` then runs the window capture listeners and the document
// listeners in registration order, as the browser does. No fetch leaves the process, no studio port.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
const ruhe = async () => { for (let i = 0; i < 20; i++) await new Promise((ok) => setImmediate(ok)); };
const lauf0 = () => ({ zelle: null, verwaist: false, ab_beat: 0, versatz_beats: 0, wartend: null, zuletzt: null });
const zelle = (n) => ({ id: `z${n}`, name: `cell ${n}`, farbe: n, art: 'loop', sha256: `sha${n}`, beats: 8, frames: 1000 });
const spalte = (n) => ({ spur_id: `a${n}`, kurz: `C${n}`, name: `Loop 1.${n}`, art: 'audio', deck: 1, spur: n, zellen: [zelle(1), null, null, null, null, null, null, null], lauf: lauf0() });
const sStand = () => ({ raster: 'takt', szenen: Array.from({ length: 8 }, () => ({})), beat: 1, bpm: 128, geparkt: [],
  container: [{ buchstabe: 'A', typ: 'loops', name: 'Loop deck 1', spalten: [1, 2, 3, 4].map(spalte) }] });
const platzStand = () => ({ decks: { 1: { gruppe_id: 'g1', platz: 1, raster: 'takt', spuren: [] }, 2: null }, beat: 1, bpm: 128 });

const doc = { keydown: [] }, win = { capture: [], bubble: [] };
let platz;

before(async () => {
  installiere({ html, antworten: { 'GET /bestand': { j: [] }, 'GET /loops': { j: [] }, 'GET /graphen': { j: { graphen: [] } }, 'GET /proj/kits': { j: { kits: [] } }, 'GET /proj/liste': { j: [] },
    'GET /session/stand': () => ({ j: sStand() }), 'GET /loopdeck/stand': () => ({ j: platzStand() }) } });
  document.addEventListener = (art, f) => { if (art === 'keydown') doc.keydown.push(f); };
  document.removeEventListener = (art, f) => { if (art === 'keydown') doc.keydown = doc.keydown.filter((x) => x !== f); };
  globalThis.addEventListener = (art, f, cap) => { if (art === 'keydown') (cap ? win.capture : win.bubble).push(f); };
  globalThis.removeEventListener = (art, f, cap) => { if (art === 'keydown') { if (cap) win.capture = win.capture.filter((x) => x !== f); else win.bubble = win.bubble.filter((x) => x !== f); } };
  await import('../public/app.js');
  platz = await import('../public/loopdeck/view.js');
  await ruhe();
});

function taste(key, target = document.body) {
  const e = { key, target, ctrlKey: false, metaKey: false, altKey: false, defaultPrevented: false, stopped: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } };
  for (const f of [...win.capture]) f(e);
  for (const f of [...doc.keydown]) f(e);
  return e;
}
const sicht = () => document.body.querySelectorAll('.ldg-overlay').length;
const offne = async () => { platz.zuruecksetzen(); platz.zeigeLoopdecks(); await ruhe(); document.querySelector('.loopdeck[data-deck="1"] .ld-gross').click(); await ruhe(); };
const speicherLib = () => globalThis.localStorage.getItem('djk-lib');

test('control: outside the pop-up Esc folds the library (the listener under test is the real one)', () => {
  assert.equal(document.body.classList.contains('lib-zu'), false);
  taste('Escape');
  assert.equal(document.body.classList.contains('lib-zu'), true, 'Esc folds the drawer on the plain page');
  taste('l');
  assert.equal(document.body.classList.contains('lib-zu'), false, 'L opens it again');
});

test('Esc in the pop-up closes it and leaves the library as it was; focus returns to the button', async () => {
  await offne();
  const knopf = document.querySelector('.loopdeck[data-deck="1"] .ld-gross');
  const vorher = speicherLib();
  assert.equal(sicht(), 1);
  const e = taste('Escape');
  assert.equal(sicht(), 0, 'closed');
  assert.equal(document.body.classList.contains('lib-zu'), false, 'the library did not fold');
  assert.equal(speicherLib(), vorher, 'the remembered state did not change');
  assert.equal(e.defaultPrevented, true); assert.equal(e.stopped, true);
  assert.equal(attrappe.aktiv, knopf);
});

test('L and G while the pop-up is open do nothing to the library; they work again after closing', async () => {
  await offne();
  const klassen = () => `${document.body.classList.contains('lib-zu')}/${document.body.classList.contains('lib-gross')}`;
  const vor = klassen(), vorher = speicherLib();
  taste('l'); taste('g'); taste('ArrowDown'); taste(' ', document.body);
  assert.equal(klassen(), vor);
  assert.equal(speicherLib(), vorher);
  assert.equal(attrappe.anrufe.filter((c) => /vorhoeren/.test(c.url)).length, 0, 'no preview started');
  document.body.querySelector('.ldg-zu').click();
  taste('l');
  assert.notEqual(klassen(), vor, 'closed: L works again');
  taste('l');
});

test('the studio report follows open and close through the real listener path too', async () => {
  await offne();
  assert.equal(attrappe.anrufe.filter((c) => c.url === '/controller/ansicht').at(-1).koerper.ansicht, 'studio');
  taste('Escape');
  assert.equal(attrappe.anrufe.filter((c) => c.url === '/controller/ansicht').at(-1).koerper.ansicht, 'dj');
});

// ---------- the pop-up on its own: a failed open, a dock popover ----------
async function eigenes(extra = {}) {
  const gm = await import('../public/loopdeck/gross.js');
  const liste = new Set(), tasten = [];
  const dok = { addEventListener: (a, f) => { if (a === 'keydown') liste.add(f); }, removeEventListener: (a, f) => { if (a === 'keydown') liste.delete(f); }, body: document.body };
  const beiOffen = [];
  const gross = gm.bindeLoopdeckGross({ dokument: dok, aendere: async () => true, spurAendern() {}, projekt: () => null, holeJson: async () => ({ status: 0, j: null }),
    beatVon: () => null, beiOffen: (o) => beiOffen.push(o), ...extra });
  return { gross, dok, liste, beiOffen, tasten };
}

test('a build that throws on a deck change leaves no node, no listener, reports closed and rethrows', async () => {
  const { gross, liste, beiOffen } = await eigenes({ raster: (nr) => { if (nr === 2) throw new Error('boom'); return 'takt'; } });
  const win0 = win.capture.length;
  gross.oeffne(1, null); await ruhe();
  assert.equal(gross.istOffen(), true); assert.deepEqual(beiOffen, [true]);
  assert.throws(() => gross.oeffne(2, null), /boom/);
  assert.equal(gross.istOffen(), false);
  assert.equal(beiOffen.at(-1), false, 'the page is told: closed');
  assert.equal(liste.size, 0, 'no key listener left');
  assert.equal(win.capture.length, win0, 'no window listener left');
  assert.equal(document.body.querySelectorAll('.ldg-overlay').filter((n) => n.parent === document.body).length, 0, 'no node left');
  gross.oeffne(1, null); await ruhe();   // and a later open works
  assert.equal(gross.istOffen(), true);
  gross.schliesse();
  assert.equal(win.capture.length, win0);
});

test('with a dock popover open the first Esc closes only the popover, the second closes the pop-up', async () => {
  const { gross, liste } = await eigenes();
  gross.oeffne(1, null); await ruhe();
  const pop = document.createElement('div'); pop.className = 'p-ins-schwebend'; document.body.append(pop);
  // insert_popover.js: window capture, registered after the pop-up opened; it closes itself on Escape and does not stop the event
  const popoverZu = (e) => { if (e.key === 'Escape') pop.remove(); };
  win.capture.push(popoverZu);
  try {
    const sendeEsc = () => { const e = { key: 'Escape', target: document.body, preventDefault() {}, stopPropagation() {} }; for (const f of [...win.capture]) f(e); for (const f of [...liste]) f(e); };
    sendeEsc();
    assert.equal(gross.istOffen(), true, 'the pop-up is still there');
    assert.equal(document.body.querySelectorAll('.p-ins-schwebend').length, 0, 'the popover is gone');
    sendeEsc();
    assert.equal(gross.istOffen(), false, 'the next Esc closes the pop-up');
  } finally { win.capture = win.capture.filter((f) => f !== popoverZu); }
});
