// SESSION clip editor, lane E (E2): the SLICES tab. Pure helper folgeNeu plus the tab on the DOM stand-in; no fetch leaves the process, no studio port.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installiere } from './helpers/pages_mock.mjs';

const ruhe = async () => { for (let i = 0; i < 20; i++) await new Promise((ok) => setImmediate(ok)); };
const text = (e) => e.textContent;

const grenzen = (n, beats = 8) => Array.from({ length: n }, (_, k) => k * beats / n);
const mitScheiben = (n, folge, teilung = '1/16') => ({ teilung, grenzen: grenzen(n), folge: folge ?? Array.from({ length: n }, (_, i) => i + 1) });
const zelleV = (extra = {}) => ({ id: 'z2', name: 'Drums', farbe: 3, art: 'loop', sha256: 'sha2', beats: 8, frames: 1000, gain_db: -3, ...extra });
const spalteE = (zelle) => ({ spur_id: 'a1', kurz: 'A1', name: 'Loop 1.1', art: 'audio', deck: 1, spur: 1, zellen: [null, zelle, null, null, null, null, null, null] });
const baue = async (zelle, antwort = () => ({ ok: true })) => {
  installiere({ html: '<body><div id="w"></div></body>', antworten: { 'GET /welle': { j: { spitzen: [] } } } });
  const m = await import('../public/session/editor.js');
  const s = await import('../public/session/editor_scheiben.js');
  const rufe = { sende: [], meldung: [], gewaehlt: [] };
  const ctx = {
    schreibeZelle: async () => true, aendere: async () => true, szeneAendern: async () => true,
    melde: (t, fehler) => rufe.meldung.push({ t, fehler }),
    sende: async (weg, daten) => { rufe.sende.push({ weg, daten }); return antwort(weg, daten); },
    waehle: (spur_id, z) => rufe.gewaehlt.push({ spur_id, zelle: z }),
  };
  const ed = m.baueEditor(document.querySelector('#w'), ctx);
  ed.zeigeZelle(spalteE(zelle), 2);
  const oeffne = () => { ed.ed.querySelector('[data-tab="SLICES"]').click(); return ed.ed; };
  return { m, s, ed, rufe, oeffne };
};

// ---------- folgeNeu (pure) ----------
test('E2 folgeNeu: reset is 1..n, reverse n..1', async () => {
  const { s } = await baue(zelleV());
  assert.deepEqual(s.folgeNeu('reset', [3, 3, 1, 2]), [1, 2, 3, 4]);
  assert.deepEqual(s.folgeNeu('reverse', [1, 2, 3, 4]), [4, 3, 2, 1]);
  assert.deepEqual(s.folgeNeu('reverse', [2, 2, 2]), [3, 2, 1], 'reverse is of the slots, not of the current order');
});

test('E2 folgeNeu: shuffle with a seeded zufall gives a fixed permutation and keeps every slot once', async () => {
  const { s } = await baue(zelleV());
  const reihe = [0.99, 0, 0.5];
  let i = 0;
  const zufall = () => reihe[i++ % reihe.length];
  assert.deepEqual(s.folgeNeu('shuffle', [1, 2, 3, 4], zufall), [3, 2, 1, 4]);
  for (const n of [1, 2, 7, 16, 64]) {
    const f = s.folgeNeu('shuffle', Array.from({ length: n }, (_, k) => k + 1));
    assert.deepEqual([...f].sort((a, b) => a - b), Array.from({ length: n }, (_, k) => k + 1), `n=${n}`);
  }
});

test('E2 folgeNeu: stutter repeats the slot before in every second slot', async () => {
  const { s } = await baue(zelleV());
  assert.deepEqual(s.folgeNeu('stutter', [1, 2, 3, 4, 5, 6]), [1, 1, 3, 3, 5, 5]);
  assert.deepEqual(s.folgeNeu('stutter', [4, 3, 2, 1, 7]), [4, 4, 2, 2, 7]);
  assert.deepEqual(s.folgeNeu('stutter', [1]), [1]);
  assert.deepEqual(s.folgeNeu('reset', []), []);
});

// ---------- passt ----------
test('E2 the tab fits audio cells only', async () => {
  const { s } = await baue(zelleV());
  assert.equal(s.scheibenTab.passt(zelleV()), true);
  assert.equal(s.scheibenTab.passt(zelleV({ art: 'einmal' })), true);
  assert.equal(s.scheibenTab.passt(null), false);
  assert.equal(s.scheibenTab.passt({ halten: true }), false);
  assert.equal(s.scheibenTab.passt({ art: 'strudel', name: 'x' }), false);
});

// ---------- the tab ----------
test('E2 SLICES is registered after CLIP and a cell without scheiben shows only SLICE BY', async () => {
  const { ed, oeffne, rufe } = await baue(zelleV());
  assert.deepEqual(ed.ed.querySelectorAll('.ed-tab').map(text), ['CLIP', 'SLICES', 'WARP', 'ENVELOPES']);
  const w = oeffne();
  assert.deepEqual(w.querySelectorAll('.sl-teilung .seg-b').map(text), ['1/16', '1/8', 'TRANSIENTS', 'BARS']);
  assert.equal(w.querySelectorAll('.sl-pad').length, 0);
  assert.equal(w.querySelector('.sl-folge'), null);
  assert.equal(w.querySelector('.sl-neuzelle'), null);
  w.querySelector('.sl-teilung [data-wert="transienten"]').click(); await ruhe();
  assert.deepEqual(rufe.sende.at(-1), { weg: '/session/scheiben', daten: { spur_id: 'a1', zelle: 2, teilung: 'transienten' } });
  w.querySelector('.sl-teilung [data-wert="takt"]').click(); await ruhe();
  assert.equal(rufe.sende.at(-1).daten.teilung, 'takt');
  w.querySelector('.sl-teilung [data-wert="1/8"]').click(); await ruhe();
  assert.equal(rufe.sende.at(-1).daten.teilung, '1/8');
});

test('E2 a sliced cell: numbered marks on the waveform, 16 pads, the active SLICE BY, the order row', async () => {
  const { oeffne } = await baue(zelleV({ scheiben: mitScheiben(16, undefined, '1/8') }));
  const w = oeffne();
  assert.ok(w.querySelector('.sl-teilung [data-wert="1/8"]').classList.contains('an'));
  assert.deepEqual(w.querySelectorAll('.sl-marke').map((e) => e.dataset.slice), Array.from({ length: 16 }, (_, i) => String(i + 1)));
  assert.equal(w.querySelectorAll('.sl-pad').length, 16);
  assert.equal(w.querySelectorAll('.sl-fe').length, 16);
  assert.equal(w.querySelectorAll('.sl-fe.geaendert').length, 0, 'identity: nothing highlighted');
  assert.equal(w.querySelector('.sl-seite'), null, 'no page buttons up to 16 slots');
});

test('E2 64 slots give 4 pad pages with page buttons', async () => {
  const { oeffne, rufe } = await baue(zelleV({ scheiben: mitScheiben(64) }));
  const w = oeffne();
  assert.equal(text(w.querySelector('.sl-seite')), '1/4');
  assert.deepEqual(w.querySelectorAll('.sl-pad').map(text).slice(0, 2), ['1', '2']);
  const weiter = w.querySelector('.sl-vor'), zurueck = w.querySelector('.sl-zurueck');
  assert.equal(zurueck.disabled, true);
  weiter.click(); weiter.click(); weiter.click();
  assert.equal(text(w.querySelector('.sl-seite')), '4/4');
  assert.deepEqual(w.querySelectorAll('.sl-pad').map(text).slice(0, 1), ['49']);
  assert.equal(w.querySelectorAll('.sl-pad').length, 16);
  assert.equal(w.querySelector('.sl-vor').disabled, true);
  w.querySelectorAll('.sl-pad')[2].click(); await ruhe();
  assert.deepEqual(rufe.sende.at(-1), { weg: '/session/vorhoeren', daten: { spur_id: 'a1', zelle: 2, slot: 51 } });
  w.querySelector('.sl-zurueck').click();
  assert.equal(text(w.querySelector('.sl-seite')), '3/4');
  const w2 = w; assert.equal(w2.querySelectorAll('.sl-pad').length, 16);
});

test('E2 the last page holds the rest: 20 slots give 2 pages of 16 and 4', async () => {
  const { oeffne } = await baue(zelleV({ scheiben: mitScheiben(20) }));
  const w = oeffne();
  assert.equal(text(w.querySelector('.sl-seite')), '1/2');
  w.querySelector('.sl-vor').click();
  assert.deepEqual(w.querySelectorAll('.sl-pad').map(text), ['17', '18', '19', '20']);
});

test('E2 a pad click previews its slot', async () => {
  const { oeffne, rufe } = await baue(zelleV({ scheiben: mitScheiben(8) }));
  oeffne().querySelectorAll('.sl-pad')[4].click(); await ruhe();
  assert.deepEqual(rufe.sende.at(-1), { weg: '/session/vorhoeren', daten: { spur_id: 'a1', zelle: 2, slot: 5 } });
});

test('E2 PLAY ORDER buttons post /session/zelle { scheiben } with the new folge', async () => {
  const sch = mitScheiben(4, [1, 2, 3, 4], '1/16');
  const { oeffne, rufe } = await baue(zelleV({ scheiben: sch }));
  const w = oeffne();
  assert.deepEqual(w.querySelectorAll('.sl-ordnung .seg-b').map(text), ['RESET', 'REVERSE', 'SHUFFLE', 'STUTTER']);
  const voll = (folge) => ({ weg: '/session/zelle', daten: { spur_id: 'a1', zelle: 2, scheiben: { teilung: '1/16', grenzen: sch.grenzen, folge } } });
  w.querySelector('.sl-ordnung [data-wert="reverse"]').click(); await ruhe();
  assert.deepEqual(rufe.sende.at(-1), voll([4, 3, 2, 1]));
  w.querySelector('.sl-ordnung [data-wert="stutter"]').click(); await ruhe();
  assert.deepEqual(rufe.sende.at(-1), voll([1, 1, 3, 3]));
  w.querySelector('.sl-ordnung [data-wert="reset"]').click(); await ruhe();
  assert.deepEqual(rufe.sende.at(-1), voll([1, 2, 3, 4]));
  w.querySelector('.sl-ordnung [data-wert="shuffle"]').click(); await ruhe();
  const f = rufe.sende.at(-1).daten.scheiben.folge;
  assert.deepEqual([...f].sort(), [1, 2, 3, 4]);
});

test('E2 the order row highlights changed slots and a click cycles the source slot of an entry', async () => {
  const sch = mitScheiben(4, [1, 4, 3, 3]);
  const { oeffne, rufe } = await baue(zelleV({ scheiben: sch }));
  const w = oeffne();
  const eintraege = w.querySelectorAll('.sl-fe');
  assert.deepEqual(eintraege.map(text), ['1', '4', '3', '3']);
  assert.deepEqual(eintraege.map((e) => e.classList.contains('geaendert')), [false, true, false, true]);
  eintraege[1].click(); await ruhe();
  assert.deepEqual(rufe.sende.at(-1).daten.scheiben.folge, [1, 1, 3, 3], '4 wraps to 1');
  eintraege[0].click(); await ruhe();
  assert.deepEqual(rufe.sende.at(-1).daten.scheiben.folge, [2, 4, 3, 3]);
  assert.equal(rufe.sende.at(-1).daten.scheiben.teilung, '1/16');
});

test('E2 TO SAMPLER INSTRUMENT posts /session/zum_sampler and says the kit', async () => {
  const { oeffne, rufe } = await baue(zelleV({ scheiben: mitScheiben(4) }), () => ({ ok: true, kit: 'Drums kit' }));
  const knopf = oeffne().querySelector('.sl-sampler');
  assert.match(text(knopf), /SAMPLER INSTRUMENT/);
  knopf.click(); await ruhe();
  assert.deepEqual(rufe.sende.at(-1), { weg: '/session/zum_sampler', daten: { spur_id: 'a1', zelle: 2 } });
  assert.match(rufe.meldung.at(-1).t, /Drums kit/); assert.equal(rufe.meldung.at(-1).fehler, false);
});

test('E2 TO NEW CELL posts /session/neue_zelle and selects the new cell; the tooltip says it renders dry', async () => {
  const { oeffne, rufe } = await baue(zelleV({ scheiben: mitScheiben(4) }), () => ({ ok: true, spur_id: 'a1', zelle: 3 }));
  const knopf = oeffne().querySelector('.sl-neuzelle');
  assert.match(text(knopf), /NEW CELL/);
  assert.equal(knopf.title, "Renders dry: the re-ordered slices with reverse, gain and fade. Rendering with the track's devices comes in a later slice (resample of the track tap)");
  knopf.click(); await ruhe();
  assert.deepEqual(rufe.sende.at(-1), { weg: '/session/neue_zelle', daten: { spur_id: 'a1', zelle: 2 } });
  assert.deepEqual(rufe.gewaehlt, [{ spur_id: 'a1', zelle: 3 }]);
});

test('E2 a refused write (deck_voll) shows its text and selects nothing', async () => {
  const { oeffne, rufe } = await baue(zelleV({ scheiben: mitScheiben(4) }), () => ({ ok: false, text: 'The column is full.' }));
  oeffne().querySelector('.sl-neuzelle').click(); await ruhe();
  assert.deepEqual(rufe.meldung, [{ t: 'The column is full.', fehler: true }]);
  assert.deepEqual(rufe.gewaehlt, []);
});

// ---------- fix round: a redraw of the same cell and tab keeps the view ----------
test('E2 fix: the pad page and the scroll position survive a write and the redraw of the same cell and tab', async () => {
  const { ed, oeffne } = await baue(zelleV({ scheiben: mitScheiben(64) }));
  const w = oeffne();
  w.querySelector('.sl-vor').click(); w.querySelector('.sl-vor').click();
  assert.equal(text(w.querySelector('.sl-seite')), '3/4');
  w.querySelector('.ed-koerper').scrollTop = 42;
  // the write answered: the page reads the stand again and redraws the same cell with the new content
  ed.zeigeZelle(spalteE(zelleV({ scheiben: mitScheiben(64), name: 'Drums 2' })), 2);
  const neu = ed.ed;
  assert.equal(text(neu.querySelector('.sl-seite')), '3/4', 'the pad page is kept');
  assert.equal(neu.querySelector('.ed-koerper').scrollTop, 42, 'the scroll position is kept');
  assert.ok(neu.querySelector('[data-tab="SLICES"]').classList.contains('an'), 'the tab is kept');
  // another cell starts at the top
  ed.zeigeZelle(spalteE(zelleV({ scheiben: mitScheiben(64) })), 3);
  ed.zeigeZelle(spalteE(zelleV({ scheiben: mitScheiben(64) })), 2);
  ed.ed.querySelector('[data-tab="SLICES"]')?.click();
  assert.equal(text(ed.ed.querySelector('.sl-seite')), '1/4', 'a cell change resets the page');
});
