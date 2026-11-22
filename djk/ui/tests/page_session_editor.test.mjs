// Bottom area of the loop deck pop-up: the tabs CLIP | DEVICES, the properties of the selected cell and the CLIP editor. Units on the DOM stand-in plus the real app.js for the wiring; no fetch leaves the process, no studio port.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const lies = (n) => fs.readFileSync(path.join(PUBLIC, n), 'utf8');
const ruhe = async () => { for (let i = 0; i < 20; i++) await new Promise((ok) => setImmediate(ok)); };
const text = (e) => e.textContent;
const SESSION_HTML = lies('index.html');

// ---------- the tab bar (unit) ----------
const baueTabs = async (speicher = {}) => {
  installiere({ html: '<body><div id="unten"></div></body>', speicher });
  const m = await import('../public/session/unten.js');
  const u = m.baueUnten(document.querySelector('#unten'), { editor: {} });
  return { m, u };
};

test('V5 the tab bar is CLIP and DEVICES, CLIP first; the DEVICES body stays empty until the pop-up mounts the dock', async () => {
  const { u } = await baueTabs();
  const leiste = document.querySelector('#unten .dtabs');
  assert.deepEqual(leiste.querySelectorAll('[data-tab]').map(text), ['CLIP', 'DEVICES']);
  assert.equal(u.tab(), 'CLIP');
  assert.deepEqual(['CLIP', 'DEVICES'].map((t) => u.koerper(t).hidden), [false, true]);
  assert.equal(u.koerper('DEVICES').children.length, 0);
  u.zeigeTab('STRUDEL'); assert.equal(u.tab(), 'CLIP', 'a tab this build does not know changes nothing');
  assert.equal(document.querySelectorAll('.dtab').length, 2);
});

test('V5 the tab is remembered per viewer (djk-session-tab), a blocked storage changes nothing, an old tab name reads as CLIP', async () => {
  const { u } = await baueTabs();
  u.zeigeTab('DEVICES');
  assert.equal(globalThis.localStorage.getItem('djk-session-tab'), 'DEVICES');
  const { u: u2 } = await baueTabs({ 'djk-session-tab': 'DEVICES' });
  assert.equal(u2.tab(), 'DEVICES');
  const { u: u3 } = await baueTabs({ 'djk-session-tab': 'SCENES' });
  assert.equal(u3.tab(), 'CLIP');
  const alt = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  try { const { u: u4 } = await baueTabs(); u4.zeigeTab('DEVICES'); assert.equal(u4.tab(), 'DEVICES'); } finally { globalThis.localStorage = alt; }
  assert.match(lies('session/unten.js'), /djk-session-tab/);
});


// ---------- the editor (unit) ----------
const zelleV = (extra = {}) => ({ id: 'z2', name: 'Drums', farbe: 3, art: 'loop', sha256: 'sha2', beats: 8, frames: 1000, gain_db: -3, ...extra });
const spalteE = (extra = {}) => ({ spur_id: 'a1', kurz: 'A1', name: 'Loop 1.1', art: 'audio', deck: 1, spur: 1, zellen: [null, zelleV(), null, null, null, null, null, null], ...extra });
const baueEd = async (antwort = () => ({ ok: true })) => {
  installiere({ html: '<body><div id="w"></div></body>', antworten: { 'GET /welle': { j: { spitzen: [] } } } });
  const m = await import('../public/session/editor.js');
  const rufe = { zelle: [], aendere: [], sende: [], meldung: [] };
  const ctx = {
    schreibeZelle: async (spalte, index, felder) => { rufe.zelle.push({ spur_id: spalte.spur_id, index, felder }); return true; },
    aendere: async (label, befehle) => { rufe.aendere.push({ label, befehle }); return true; },
    melde: (t, fehler) => { rufe.meldung.push({ t, fehler }); },
    // the host contract: resolves { ok: true, ... } or { ok: false, text }, never throws, shows nothing itself
    sende: async (weg, daten) => { rufe.sende.push({ weg, daten }); return antwort(weg, daten); },
  };
  const ed = m.baueEditor(document.querySelector('#w'), ctx);
  return { m, ed, rufe, props: ed.props, flaeche: ed.ed };
};
const tippe = (e, wert) => { e.value = wert; e.dispatch('keydown', { key: 'Enter' }); };

test('V5 no selection: the CLIP tab says "Select a cell"', async () => {
  const { flaeche, props } = await baueEd();
  assert.match(text(flaeche), /Select a cell/); assert.match(text(props), /Select a cell/);
});

test('V5 cell properties: name and colour write /loopdeck/zelle fields, GRID writes zelle_aendern {raster} (GLOBAL: null), LENGTH writes beats', async () => {
  const { ed, rufe, props } = await baueEd();
  ed.zeigeZelle(spalteE(), 2);
  assert.equal(props.querySelector('.pr-name').value, 'Drums');
  assert.equal(props.querySelector('.pr-swatch.an').dataset.farbe, '3');
  tippe(props.querySelector('.pr-name'), '  Kick loop ');
  assert.deepEqual(rufe.zelle.at(-1), { spur_id: 'a1', index: 2, felder: { name: 'Kick loop' } });
  props.querySelectorAll('.pr-swatch')[5].click();
  assert.deepEqual(rufe.zelle.at(-1).felder, { farbe: 5 });
  const raster = props.querySelector('.pr-raster');
  assert.deepEqual(raster.querySelectorAll('.seg-b').map(text), ['GLOBAL', '1/4', '1/2', '1', 'BAR', '4 BARS']);
  assert.ok(raster.querySelector('[data-wert="null"]').classList.contains('an'), 'a cell without a grid shows GLOBAL');
  raster.querySelector('[data-wert="takt"]').click();
  assert.deepEqual(rufe.aendere.at(-1).befehle, [{ befehl: 'zelle_aendern', spur_id: 'a1', index: 2, raster: 'takt' }]);
  raster.querySelector('[data-wert="4takte"]').click();
  assert.equal(rufe.aendere.at(-1).befehle[0].raster, '4takte');
  raster.querySelector('[data-wert="null"]').click();
  assert.deepEqual(rufe.aendere.at(-1).befehle, [{ befehl: 'zelle_aendern', spur_id: 'a1', index: 2, raster: null }]);
  tippe(props.querySelector('.pr-laenge'), '16');
  assert.deepEqual(rufe.zelle.at(-1).felder, { beats: 16 });
});

test('V5 a cell with its own grid shows it; LAUNCH and THEN are disabled with the S5 title', async () => {
  const { ed, props } = await baueEd();
  ed.zeigeZelle(spalteE({ zellen: [null, zelleV({ raster: '1/2' }), null, null, null, null, null, null] }), 2);
  assert.ok(props.querySelector('.pr-raster [data-wert="1/2"]').classList.contains('an'));
  assert.ok(!props.querySelector('.pr-raster [data-wert="null"]').classList.contains('an'));
  for (const k of ['.pr-start', '.pr-dann']) {
    const knoepfe = props.querySelectorAll(`${k} .seg-b`);
    assert.ok(knoepfe.length >= 3);
    for (const b of knoepfe) { assert.equal(b.disabled, true); assert.equal(b.title, 'comes with slice S5'); }
  }
});

test('V5 CLIP tab: waveform with loop range and 7 slice marks, GAIN and LOOP editable, START read-only 1.1.1, TRANSPOSE REVERSE FADE live', async () => {
  const { ed, rufe, flaeche } = await baueEd();
  ed.zeigeZelle(spalteE(), 2);
  assert.deepEqual(flaeche.querySelectorAll('.ed-tab').map(text), ['CLIP', 'SLICES', 'WARP', 'ENVELOPES'], 'the inner tab bar: CLIP and the S1b tabs registered so far');
  const wv = flaeche.querySelector('.ed-welle');
  assert.equal(wv.dataset.sha, 'sha2');
  assert.ok(wv.querySelector('.ed-schleife'), 'loop range');
  assert.equal(wv.querySelectorAll('.ed-marke').length, 7);
  assert.equal(flaeche.querySelector('.ed-gain').value, '-3');
  tippe(flaeche.querySelector('.ed-gain'), '2.5');
  assert.deepEqual(rufe.zelle.at(-1), { spur_id: 'a1', index: 2, felder: { gain_db: 2.5 } });
  tippe(flaeche.querySelector('.ed-gain'), '99');
  assert.deepEqual(rufe.zelle.at(-1).felder, { gain_db: 12 }, 'clamped to the range of the command');
  tippe(flaeche.querySelector('.ed-loop-laenge'), '4');
  assert.deepEqual(rufe.zelle.at(-1).felder, { beats: 4 });
  assert.equal(text(flaeche.querySelector('.ed-start')), '1.1.1');
  assert.equal(flaeche.querySelector('.ed-start').tagName, 'B');
  assert.equal(flaeche.querySelector('.ed-transponieren').disabled, false, 'S1b: TRANSPOSE is live on a keylock loop');
  assert.ok(flaeche.querySelector('.ed-rueckwaerts') && flaeche.querySelector('.ed-blende'), 'REVERSE and FADE are live toggles');
});

test('V5 a one-shot has no slice marks', async () => {
  const { ed, flaeche } = await baueEd();
  ed.zeigeZelle(spalteE({ zellen: [null, zelleV({ art: 'einmal' }), null, null, null, null, null, null] }), 2);
  assert.equal(flaeche.querySelectorAll('.ed-marke').length, 0);
});

test('V5 registriereTab is the hook for lane E: a registered tab appears in the inner bar when it fits the cell', async () => {
  const { m, ed, flaeche } = await baueEd();
  const gebaut = [];
  m.registriereTab('SLICES', { passt: (z) => z.art === 'loop', baue: (w, c) => { gebaut.push(c.index); w.append(document.createElement('span')); } });
  try {
    ed.zeigeZelle(spalteE(), 2);
    assert.deepEqual(flaeche.querySelectorAll('.ed-tab').map(text), ['CLIP', 'SLICES', 'WARP', 'ENVELOPES']);
    flaeche.querySelector('[data-tab="SLICES"]').click();
    assert.deepEqual(gebaut, [2]);
    ed.zeigeZelle(spalteE({ zellen: [null, zelleV({ art: 'einmal' }), null, null, null, null, null, null] }), 2);
    assert.deepEqual(flaeche.querySelectorAll('.ed-tab').map(text), ['CLIP', 'WARP', 'ENVELOPES'], 'a one-shot does not fit SLICES here');
  } finally { m.registriereTab('SLICES', (await import('../public/session/editor_scheiben.js')).scheibenTab); }
  assert.deepEqual(m.registrierteTabs().filter((t) => t !== 'SLICES'), ['CLIP', 'WARP', 'ENVELOPES']);
});

// ---------- the real app: selection -> properties ----------
const lauf0 = () => ({ zelle: null, verwaist: false, ab_beat: 0, versatz_beats: 0, wartend: null, zuletzt: null });
const spalteApp = (id, deck, spur) => ({ spur_id: id, kurz: `${deck === 1 ? 'A' : 'B'}${spur}`, name: `Loop ${deck}.${spur}`, art: 'audio', deck, spur,
  zellen: [zelleV({ id: `${id}z1`, name: `cell ${id}` }), null, null, null, null, null, null, null], lauf: lauf0(), fader_db: 0, mute: false, filter: 0, eq: {}, kill: {}, send: {}, effekt: null });
const standApp = () => ({ raster: 'takt', szenen: Array.from({ length: 8 }, (_, i) => (i === 1 ? { name: 'Intro', farbe: 4, bpm: 120 } : {})), beat: 1, bpm: 128,
  container: [{ buchstabe: 'A', typ: 'loops', name: 'Loop deck 1', spalten: [1, 2, 3, 4].map((n) => spalteApp(`a${n}`, 1, n)) },
    { buchstabe: 'B', typ: 'leer', name: '', spalten: [] }, { buchstabe: 'C', typ: 'leer', name: '', spalten: [] }, { buchstabe: 'D', typ: 'leer', name: '', spalten: [] }], geparkt: [] });

test('V5 in the pop-up on the real page: a cell click fills the properties, writes carry the project rev', async () => {
  installiere({ html: SESSION_HTML,
    antworten: { 'GET /bestand': { j: [] }, 'GET /loops': { j: [] }, 'GET /graphen': { j: { graphen: [] } }, 'GET /proj/kits': { j: { kits: [] } }, 'GET /proj/liste': { j: [] },
      'GET /session/stand': () => ({ j: standApp() }), 'GET /loopdeck/stand': { j: { decks: { 1: { gruppe_id: 'g1', platz: 1, raster: 'takt', spuren: [] }, 2: null }, beat: 1, bpm: 128 } },
      'POST /loopdeck/zelle': { j: { ok: true } }, 'POST /proj/aendern': { j: { ok: true } } } });
  await import('../public/app.js');
  const live = await import('../public/live_view.js');
  const platz = await import('../public/loopdeck/view.js');
  await ruhe();
  platz.zuruecksetzen(); platz.zeigeLoopdecks(); await ruhe();
  document.querySelector('.loopdeck[data-deck="1"] .ld-gross').click(); await ruhe();
  const unten = document.querySelector('#session-unten');
  assert.deepEqual(unten.querySelectorAll('.dtab').map(text), ['CLIP', 'DEVICES']);
  assert.match(text(unten.querySelector('.pane-clip')), /Select a cell/);
  const zellen = document.querySelector('.spalte-host[data-spur="a2"]').querySelectorAll('.zelle');
  zellen[0].querySelector('.nm').click(); await ruhe();   // the name of a filled cell selects it (the rest of the cell launches)
  const gewaehlt = unten.querySelector('.pr-name');
  assert.ok(gewaehlt, 'the properties are drawn for the clicked cell');
  assert.equal(gewaehlt.value, 'cell a2');
  live.live.projekt = { rev: 11, spuren: [] }; live.live.rev = 11;
  unten.querySelector('.pr-raster [data-wert="1"]').click(); await ruhe();
  const a = attrappe.anrufe.filter((c) => c.url === '/proj/aendern' && c.methode === 'POST').at(-1);
  assert.equal(a.koerper.rev, 11);
  assert.deepEqual(a.koerper.befehle, [{ befehl: 'zelle_aendern', spur_id: 'a2', index: 1, raster: '1' }]);
  tippe(unten.querySelector('.ed-gain'), '1');
  await ruhe();
  const z = attrappe.anrufe.filter((c) => c.url === '/loopdeck/zelle').at(-1);
  assert.deepEqual(z.koerper, { deck: 1, spur: 2, zelle: 1, gain_db: 1 });
});


// ---------- review follow-up ----------
test('V5 a focused button (GRID, a colour) does not freeze the editor, a focused text field does', async () => {
  const { ed, props } = await baueEd();
  ed.zeige({ spalte: spalteE(), index: 2 }, true);
  props.querySelector('.pr-raster [data-wert="takt"]').focus();
  ed.zeige({ spalte: spalteE({ zellen: [null, zelleV({ raster: 'takt' }), null, null, null, null, null, null] }), index: 2 });
  assert.ok(props.querySelector('.pr-raster [data-wert="takt"]').classList.contains('an'), 'redrawn with the new grid');
  props.querySelectorAll('.pr-swatch')[4].focus();
  ed.zeige({ spalte: spalteE({ zellen: [null, zelleV({ farbe: 6 }), null, null, null, null, null, null] }), index: 2 });
  assert.equal(props.querySelector('.pr-swatch.an').dataset.farbe, '6');
  props.querySelector('.pr-name').focus();
  ed.zeige({ spalte: spalteE({ zellen: [null, zelleV({ name: 'Other' }), null, null, null, null, null, null] }), index: 2 });
  assert.equal(props.querySelector('.pr-name').value, 'Drums', 'typing is not interrupted');
});

// ---------- E1: transpose, reverse, fade ----------
const zelleBei = (extra) => ({ zellen: [null, zelleV(extra), null, null, null, null, null, null] });

test('E1 TRANSPOSE is a -24..24 stepper that posts /session/zelle { transponieren }, 0 removes it', async () => {
  const { ed, rufe, flaeche } = await baueEd();
  ed.zeigeZelle(spalteE(zelleBei({ transponieren: 3 })), 2);
  const f = flaeche.querySelector('.ed-transponieren');
  assert.equal(f.value, '3'); assert.equal(f.min, '-24'); assert.equal(f.max, '24'); assert.equal(f.step, '1'); assert.equal(f.disabled, false);
  tippe(f, '-5'); await ruhe();
  assert.deepEqual(rufe.sende.at(-1), { weg: '/session/zelle', daten: { spur_id: 'a1', zelle: 2, transponieren: -5 } });
  tippe(f, '99'); await ruhe();
  assert.equal(rufe.sende.at(-1).daten.transponieren, 24, 'clamped');
  tippe(f, '0'); await ruhe();
  assert.equal(rufe.sende.at(-1).daten.transponieren, null, '0 removes the field');
  assert.equal(rufe.zelle.length, 0, 'it does not take the loop deck write');
});

test('E1 TRANSPOSE is disabled with "needs keylock" on einmal and repitch cells', async () => {
  for (const extra of [{ art: 'einmal' }, { keylock: false }]) {
    const { ed, flaeche } = await baueEd();
    ed.zeigeZelle(spalteE(zelleBei(extra)), 2);
    const f = flaeche.querySelector('.ed-transponieren');
    assert.equal(f.disabled, true, JSON.stringify(extra)); assert.equal(f.title, 'needs keylock');
  }
});

test('E1 REVERSE and FADE toggle rueckwaerts / blende, null when turned off', async () => {
  const { ed, rufe, flaeche } = await baueEd();
  ed.zeigeZelle(spalteE(), 2);
  const r = flaeche.querySelector('.ed-rueckwaerts'), b = flaeche.querySelector('.ed-blende');
  assert.equal(text(r), 'REVERSE'); assert.equal(text(b), 'FADE');
  assert.equal(r.getAttribute('aria-pressed'), 'false');
  r.click(); await ruhe();
  assert.deepEqual(rufe.sende.at(-1), { weg: '/session/zelle', daten: { spur_id: 'a1', zelle: 2, rueckwaerts: true } });
  b.click(); await ruhe();
  assert.deepEqual(rufe.sende.at(-1).daten, { spur_id: 'a1', zelle: 2, blende: true });
  ed.zeigeZelle(spalteE(zelleBei({ rueckwaerts: true, blende: true })), 2);
  const r2 = flaeche.querySelector('.ed-rueckwaerts'), b2 = flaeche.querySelector('.ed-blende');
  assert.equal(r2.getAttribute('aria-pressed'), 'true'); assert.ok(r2.classList.contains('an'));
  r2.click(); await ruhe();
  assert.equal(rufe.sende.at(-1).daten.rueckwaerts, null);
  b2.click(); await ruhe();
  assert.equal(rufe.sende.at(-1).daten.blende, null);
});

test('E1 a refusal shows its text and the field goes back', async () => {
  const { ed, rufe, flaeche } = await baueEd(() => ({ ok: false, text: 'Transpose needs keylock.' }));
  ed.zeigeZelle(spalteE(zelleBei({ transponieren: 2 })), 2);
  const f = flaeche.querySelector('.ed-transponieren');
  tippe(f, '7'); await ruhe();
  assert.deepEqual(rufe.meldung.at(-1), { t: 'Transpose needs keylock.', fehler: true });
  assert.equal(f.value, '2', 'refused: the old value is back');
  flaeche.querySelector('.ed-blende').click(); await ruhe();
  assert.equal(rufe.meldung.length, 2);
});
