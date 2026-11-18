// Sampler A1 task 8: the cut strip of the SOUND region (schnitt_streifen.js): waveform, numbered slices, click to hear, selection, FIT, the action hook.
// Run against the DOM stand-in; the requests the strip sends are asserted, not only the markup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

installiere();
const { bindeWerkbank } = await import('../public/werkbank/werkbank.js');

const bk = (nr, graph) => ({ id: `s${nr}`, nr, name: `T${nr}`, farbe: '#2fd6c3', art: 'instrument', geraet: { art: 'intern', name: 'bk', graph, parameter: {} }, clips: [] });
const drums = (nr) => ({ id: `s${nr}`, nr, name: `D${nr}`, farbe: '#ff8800', art: 'instrument', geraet: { art: 'intern', name: 'bk', graph: 'drums-909', parameter: {} }, clips: [] });
const projektMit = (spuren, rev = 1) => ({ name: 'M', rev, werkbank: { schema: 1 }, tempo_bpm: 130, taktart: [4, 4], loop: { an: true, von_beat: 0, bis_beat: 16 }, spuren });
const post = (w, k) => fetch(w, { method: 'POST', body: JSON.stringify(k) });
const ruhe = async () => { for (let i = 0; i < 12; i++) await new Promise((ok) => setImmediate(ok)); };
const POSTS = (weg) => attrappe.anrufe.filter((a) => a.methode === 'POST' && a.url === weg);
const GETS = (weg) => attrappe.anrufe.filter((a) => a.methode === 'GET' && a.url.split('?')[0] === weg);
const letzter = (kopf) => { const [m, u] = kopf.split(' '); return attrappe.anrufe.filter((a) => a.methode === m && a.url === u).at(-1); };

// the cut: 16 slices of 5625 frames; guete are unmeasured (staerke null) like every cut of A1
const schnittJson = (id, n = 16, guete = null) => ({
  schema: 1, id, name: `Break ${id}`, quelle: { art: 'loop', ref: 'break' }, bpm: 128, beats: 16, frames: n * 5625, methode: 'raster',
  grenzen: Array.from({ length: n + 1 }, (_, k) => k * 5625),
  guete: guete ?? Array.from({ length: n }, () => ({ staerke: null, raster_abstand_beats: 0 })),
});
// a DJKW v1 wave: 600 columns of hop 150 frames
function welle() {
  const spalten = 600, b = new ArrayBuffer(16 + spalten * 4), v = new DataView(b);
  'DJKW'.split('').forEach((c, i) => v.setUint8(i, c.charCodeAt(0)));
  v.setUint32(4, 1, true); v.setUint32(8, 150, true); v.setUint32(12, spalten, true);
  for (let i = 0; i < spalten * 4; i++) v.setUint8(16 + i, 40 + (i % 90));
  return b;
}
const WELLE = welle();

let wurzel, w, server;
const $w = (n) => wurzel.querySelector(`[data-w="${n}"]`);
const streifen = () => $w('schnitt');
const scheiben = () => streifen().querySelectorAll('[data-w="schnitt-scheibe"]');
const scheibeEl = (i) => { const e = scheiben().find((x) => x.dataset.scheibe === String(i)); assert.ok(e, `no slice ${i}`); return e; };
const klick = (el, ev = {}) => el.dispatch('click', ev);
const knopf = (name) => streifen().querySelectorAll(`[data-w="${name}"]`)[0];

// The stand-in answers one body per URL: the per-track and per-cut answers of the test server come through this wrapper (the call is still recorded).
function aufbau(projekt, { schnitte = { x: schnittJson('x'), y: schnittJson('y', 8) }, info = null } = {}) {
  installiere({ antworten: { 'GET /proj/aktuell': { j: { slug: 'm1', projekt } }, 'GET /proj/liste': { j: [] }, 'GET /proj/werkbank/vorlagen': { j: { vorlagen: [] } }, 'GET /geraete/panel': { j: {} } } });
  server = { schnitte, welleCode: 200, info: info ?? { s1: { schnitt: { id: 'x', scheiben: 16, laengen_beats: [] } }, s2: null, s3: { schnitt: { id: 'y', scheiben: 8, laengen_beats: [] } } } };
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opt) => {
    const r = await orig(url, opt), u = String(url), q = new URLSearchParams(u.split('?')[1] ?? '');
    if (u.startsWith('/welle')) return { ...r, status: server.welleCode, ok: server.welleCode === 200, arrayBuffer: async () => WELLE };
    if (u.startsWith('/seq/geraet')) {
      const s = server.info[q.get('spur_id')];
      return { ...r, json: async () => ({ art: 'bk', regler: [], klaenge: [], ...(s ? { schnitt: s.schnitt } : {}) }) };
    }
    if (u.startsWith('/sampler/schnitt') && (opt?.method ?? 'GET') === 'GET') {
      const s = server.schnitte[q.get('id')];
      return s ? { ...r, status: 200, ok: true, json: async () => ({ schnitt: s }) } : { ...r, status: 404, ok: false, json: async () => ({ fehler: 'schnitt_unbekannt', text: 'cut does not exist' }) };
    }
    return r;
  };
  wurzel = document.createElement('section');
  w = bindeWerkbank({ post, wurzel, frage: () => true });
}
const zweiSpuren = () => projektMit([bk(1, 'smp-x'), drums(2), bk(3, 'smp-y')]);
const antwortHoeren = () => { attrappe.antworten['POST /sampler/hoeren'] = { j: { ok: true, dauer_ms: 117 } }; };

test('the strip appears for a slice track only and numbers its slices', async () => {
  aufbau(zweiSpuren());
  w.zeige(); await ruhe();
  assert.ok(!streifen().hidden);
  assert.deepEqual(streifen().querySelectorAll('[data-w="schnitt-nr"]').map((e) => e.textContent), Array.from({ length: 16 }, (_, i) => String(i + 1)));
  assert.deepEqual(GETS('/sampler/schnitt').map((a) => a.url), ['/sampler/schnitt?id=x']);
  assert.deepEqual(GETS('/welle').map((a) => a.url), ['/welle?schnitt=x']);
  assert.ok(knopf('schnitt-fit').textContent === 'FIT');
  // the drums track: hidden, nothing asked about a cut
  const n = GETS('/sampler/schnitt').length, nw = GETS('/welle').length;
  w.ctx.waehle('s2'); await ruhe();
  assert.ok(streifen().hidden);
  assert.equal(GETS('/sampler/schnitt').length, n);
  assert.equal(GETS('/welle').length, nw);
  assert.equal(w.ctx.schnittWahl, null);
});

test('the numbers and the slice positions come from the cut, the wave is fetched once per cut', async () => {
  aufbau(zweiSpuren());
  w.zeige(); await ruhe();
  assert.equal(scheibeEl(3).style.left, '18.75%');
  assert.equal(scheibeEl(3).style.width, '6.25%');
  w.ctx.waehle('s3'); await ruhe();
  assert.equal(scheiben().length, 8);
  assert.equal(scheibeEl(7).style.left, '87.5%');
  w.ctx.waehle('s1'); await ruhe();
  assert.equal(scheiben().length, 16);
  assert.equal(GETS('/welle').length, 2, 'x and y once each');
  assert.equal(GETS('/sampler/schnitt').length, 3, 'x and y once each, x again when its track is selected again (E10: a selection reads the cut once more)');
});

test('click hears and selects one, shift-click toggles and sends nothing', async () => {
  aufbau(zweiSpuren()); antwortHoeren();
  w.zeige(); await ruhe();
  klick(scheibeEl(3)); await ruhe();
  assert.deepEqual(letzter('POST /sampler/hoeren').koerper, { spur_id: 's1', scheibe: 3 });
  assert.deepEqual(w.ctx.schnittWahl, { spur_id: 's1', schnitt_id: 'x', scheiben: [3] });
  assert.ok(scheibeEl(3).classList.contains('gewaehlt'));
  const n = attrappe.anrufe.length;
  klick(scheibeEl(5), { shiftKey: true }); klick(scheibeEl(3), { shiftKey: true }); await ruhe();
  assert.equal(attrappe.anrufe.length, n);
  assert.deepEqual(w.ctx.schnittWahl, { spur_id: 's1', schnitt_id: 'x', scheiben: [5] });
  assert.ok(scheibeEl(5).classList.contains('gewaehlt'));
  assert.ok(!scheibeEl(3).classList.contains('gewaehlt'));
  // the selection stays in ascending order
  klick(scheibeEl(1), { shiftKey: true }); klick(scheibeEl(9), { shiftKey: true });
  assert.deepEqual(w.ctx.schnittWahl.scheiben, [1, 5, 9]);
});

test('a refused click on a slice shows the text of the answer and keeps the selection', async () => {
  aufbau(zweiSpuren()); antwortHoeren();
  w.zeige(); await ruhe();
  klick(scheibeEl(2)); await ruhe();
  klick(scheibeEl(6), { shiftKey: true });
  assert.deepEqual(w.ctx.schnittWahl.scheiben, [2, 6]);
  attrappe.antworten['POST /sampler/hoeren'] = { code: 409, j: { fehler: 'hoeren_abgelehnt', text: 'the core refused the note: spur_bereich' } };
  klick(scheibeEl(8)); await ruhe();
  assert.ok($w('meldung').textContent.includes('The core refused the note'));
  assert.ok($w('meldung').classList.contains('fehler'));
  assert.deepEqual(w.ctx.schnittWahl, { spur_id: 's1', schnitt_id: 'x', scheiben: [2, 6] });
  assert.ok(scheibeEl(2).classList.contains('gewaehlt') && scheibeEl(6).classList.contains('gewaehlt') && !scheibeEl(8).classList.contains('gewaehlt'));
});

test('the selection hook fires and resets when the track or the cut changes', async () => {
  aufbau(zweiSpuren()); antwortHoeren();
  const gesehen = [];
  w.ctx.beiSchnittWahl.push((wahl) => gesehen.push(wahl));
  w.zeige(); await ruhe();
  assert.deepEqual(gesehen.at(-1), { spur_id: 's1', schnitt_id: 'x', scheiben: [] });
  klick(scheibeEl(4)); await ruhe();
  assert.deepEqual(gesehen.at(-1), { spur_id: 's1', schnitt_id: 'x', scheiben: [4] });
  const n = gesehen.length;
  w.ctx.zeichneSchnitt(); w.ctx.uebernimm('m1', zweiSpuren()); await ruhe();   // a redraw or a project change of the same track and cut keeps the selection
  assert.equal(gesehen.length, n);
  assert.deepEqual(w.ctx.schnittWahl.scheiben, [4]);
  w.ctx.waehle('s3'); await ruhe();                                            // another track: reset
  assert.deepEqual(gesehen.at(-1), { spur_id: 's3', schnitt_id: 'y', scheiben: [] });
  assert.deepEqual(w.ctx.schnittWahl, gesehen.at(-1));
  w.ctx.waehle('s1'); await ruhe();
  klick(scheibeEl(4)); await ruhe();
  // the same track plays another cut: reset
  w.ctx.uebernimm('m1', projektMit([bk(1, 'smp-y'), drums(2), bk(3, 'smp-y')], 2)); await ruhe();
  assert.deepEqual(gesehen.at(-1), { spur_id: 's1', schnitt_id: 'y', scheiben: [] });
  w.ctx.waehle('s2'); await ruhe();                                            // a track without a cut: the selection is null
  assert.equal(gesehen.at(-1), null);
  assert.equal(w.ctx.schnittWahl, null);
});

test('waehleScheiben sets a sorted selection and drops indices outside the cut', async () => {
  aufbau(zweiSpuren());
  w.zeige(); await ruhe();
  const gesehen = [];
  w.ctx.beiSchnittWahl.push((wahl) => gesehen.push(wahl));
  w.ctx.waehleScheiben([7, 2, 2, 20, -1, 1.5]);
  assert.deepEqual(w.ctx.schnittWahl, { spur_id: 's1', schnitt_id: 'x', scheiben: [2, 7] });
  assert.equal(gesehen.length, 1);
  assert.ok(scheibeEl(7).classList.contains('gewaehlt') && scheibeEl(2).classList.contains('gewaehlt'));
  w.ctx.waehleScheiben([2, 7]);
  assert.equal(gesehen.length, 1, 'the same selection fires nothing');
  w.ctx.waehle('s2'); await ruhe();
  w.ctx.waehleScheiben([1]);
  assert.equal(w.ctx.schnittWahl, null, 'no slice track: nothing to select');
});

test('FIT writes and a refusal shows its text (review focus 5)', async () => {
  aufbau(zweiSpuren());
  w.zeige(); await ruhe();
  const fitProjekt = { ...zweiSpuren(), rev: 2 };
  attrappe.antworten['POST /sampler/fit'] = { j: { rev: 2, projekt: fitProjekt, wert: 0.7 } };
  knopf('schnitt-fit').dispatch('click'); await ruhe();
  assert.deepEqual(POSTS('/sampler/fit').map((a) => a.koerper), [{ spur_id: 's1' }]);
  assert.equal(w.ctx.st.projekt.rev, 2);
  // a refusal: the text of the server, the project and the selection stay, nothing else is sent
  attrappe.antworten['POST /sampler/fit'] = { code: 409, j: { fehler: 'fit_ausserhalb', text: 'the project tempo 20 BPM is outside 0.25x to 4x of the cut tempo 128 BPM; SPEED is unchanged' } };
  klick(scheibeEl(1), { shiftKey: true });
  const n = attrappe.anrufe.length;
  knopf('schnitt-fit').dispatch('click'); await ruhe();
  assert.equal(attrappe.anrufe.length, n + 1);
  assert.equal(attrappe.anrufe.at(-1).url, '/sampler/fit');
  assert.ok($w('meldung').textContent.includes('outside 0.25x to 4x'));
  assert.ok($w('meldung').classList.contains('fehler'));
  assert.equal(w.ctx.st.projekt.rev, 2);
  assert.deepEqual(w.ctx.schnittWahl.scheiben, [1]);
});

test('an action registered in ctx.schnittAktionen is drawn after FIT and gets the selection', async () => {
  aufbau(zweiSpuren()); antwortHoeren();
  w.zeige(); await ruhe();
  const knoepfe = () => streifen().querySelectorAll('[data-w="schnitt-aktion"]').map((b) => b.textContent);
  const eigene = knoepfe();   // what binding the page registers by itself: plan B (TO KIT) and plan C (TO TONE)
  assert.deepEqual(eigene, w.ctx.schnittAktionen.map((a) => a.text), 'every registered action is drawn, in the order of the array');
  assert.deepEqual([...eigene].sort(), ['TO KIT', 'TO TONE'], 'the page itself registers TO KIT (plan B) and TO TONE (plan C), nothing else');
  const gelaufen = [];
  w.ctx.schnittAktionen.push({ id: 'probe', text: 'PROBE', titel: 'A probe action', aktiv: (wahl) => wahl.scheiben.length > 0, lauf: async (wahl) => { gelaufen.push(wahl); } });
  w.ctx.zeichneSchnitt();
  const a = () => streifen().querySelectorAll('[data-w="schnitt-aktion"]').find((b) => b.textContent === 'PROBE');
  assert.equal(a().textContent, 'PROBE');
  assert.equal(a().getAttribute('title'), 'A probe action');
  assert.equal(a().disabled, true);
  a().dispatch('click'); await ruhe();
  assert.equal(gelaufen.length, 0);
  klick(scheibeEl(3)); await ruhe();
  assert.equal(a().disabled, false);
  a().dispatch('click'); await ruhe();
  assert.deepEqual(gelaufen, [{ spur_id: 's1', schnitt_id: 'x', scheiben: [3] }]);
  // the buttons come in the order of the array, after FIT
  w.ctx.schnittAktionen.push({ id: 'zwei', text: 'TWO', titel: 't', aktiv: () => true, lauf: async () => { throw new Error('boom'); } });
  w.ctx.zeichneSchnitt();
  assert.deepEqual(streifen().querySelectorAll('button').filter((b) => ['schnitt-fit', 'schnitt-aktion'].includes(b.getAttribute('data-w'))).map((b) => b.textContent), ['FIT', ...eigene, 'PROBE', 'TWO']);
  streifen().querySelectorAll('[data-w="schnitt-aktion"]').find((b) => b.textContent === 'TWO').dispatch('click'); await ruhe();
  assert.ok($w('meldung').textContent.includes('boom'), 'a failing action shows its message');
});

test('a quality bar is drawn only for a marker with a strength (D13)', async () => {
  aufbau(zweiSpuren());
  w.zeige(); await ruhe();
  assert.equal(streifen().querySelectorAll('[data-w="schnitt-guete"]').length, 0);
  const guete = Array.from({ length: 16 }, (_, i) => ({ staerke: i === 4 ? 0.5 : i === 9 ? 0 : null, raster_abstand_beats: 0 }));
  aufbau(zweiSpuren(), { schnitte: { x: schnittJson('x', 16, guete), y: schnittJson('y', 8) } });
  w.zeige(); await ruhe();
  const balken = streifen().querySelectorAll('[data-w="schnitt-guete"]');
  assert.deepEqual(balken.map((b) => b.dataset.marke), ['4', '9'], 'a strength of 0 is a strength; null is none');
  assert.equal(streifen().querySelectorAll('[data-w="schnitt-guete-zahl"]').length, 0, 'the count selector belongs to A2');
});

test('a cut that cannot be read shows the text of the refusal; a missing wave leaves the slices usable', async () => {
  aufbau(zweiSpuren(), { schnitte: {} });
  w.zeige(); await ruhe();
  assert.ok(!streifen().hidden);
  assert.ok($w('schnitt-text').textContent.includes('Cut does not exist'));
  assert.equal(scheiben().length, 0);
  aufbau(zweiSpuren()); antwortHoeren();
  server.welleCode = 404;
  w.zeige(); await ruhe();
  assert.equal(scheiben().length, 16);
  klick(scheibeEl(0)); await ruhe();
  assert.deepEqual(w.ctx.schnittWahl.scheiben, [0]);
});

// ---- sampler A2 task 4: the strip edits the cut and follows it ----

// a changed cut as the routes answer it; the cut and the info of the track change together, like on the server
function setzeSchnitt(id, s, spur = 's1') {
  server.schnitte[id] = s;
  server.info[spur] = { schnitt: { id, scheiben: s.grenzen.length - 1, laengen_beats: [] } };
}
const mit = (n, extra = {}) => ({ ...schnittJson('x', n), ...extra });
const handle = (k) => streifen().querySelectorAll('[data-w="schnitt-marke"]').find((e) => e.dataset.marke === String(k));
const ziehe = (h, von, bis, extra = {}) => {
  h.dispatch('pointerdown', { clientX: von, pointerId: 1, button: 0, ...extra });
  h.dispatch('pointermove', { clientX: bis, pointerId: 1, buttons: 1, ...extra });
  h.dispatch('pointerup', { clientX: bis, pointerId: 1, ...extra });
};
function beobachte() {
  const n = { vergiss: 0, projekte: [] };
  const v = w.ctx.vergissInfo, u = w.ctx.uebernimm;
  w.ctx.vergissInfo = (...a) => { n.vergiss++; return v(...a); };
  w.ctx.uebernimm = (slug, p) => { n.projekte.push([slug, p]); return u(slug, p); };
  return n;
}

test('CUT AGAIN sends the method and count, shows the text, offers the original order', async () => {
  aufbau(zweiSpuren());
  w.zeige(); await ruhe();
  const methode = () => knopf('schnitt-methode'), zahl = () => knopf('schnitt-zahl'), empf = () => knopf('schnitt-empf'), neu = () => knopf('schnitt-neu');
  // the controls show the cut: GRID, 16 slices, the count selector on, the sensitivity off
  assert.equal(methode().value, 'raster');
  assert.deepEqual(methode().querySelectorAll('option').map((o) => o.textContent), ['GRID', 'HITS']);
  assert.equal(zahl().value, '16');
  assert.deepEqual(zahl().querySelectorAll('option').map((o) => o.value), ['4', '8', '16', '32', '64']);
  assert.ok(!zahl().disabled && empf().disabled);
  assert.equal(neu().textContent, 'CUT AGAIN');
  assert.equal(empf().getAttribute('min'), '0'); assert.equal(empf().getAttribute('max'), '1'); assert.equal(empf().getAttribute('step'), '0.05');
  assert.equal(streifen().querySelectorAll('[data-w="schnitt-ursprung"]').length, 0, 'nothing to write before a cut again');
  // GRID: the count
  zahl().value = '32'; zahl().dispatch('change');
  setzeSchnitt('x', mit(32));
  attrappe.antworten['POST /sampler/neu_schneiden'] = { j: { schnitt: mit(32), spuren: ['T1'], text: 'Cut again: 32 slices by grid. The patterns keep their slice numbers.' } };
  neu().dispatch('click'); await ruhe();
  assert.deepEqual(letzter('POST /sampler/neu_schneiden').koerper, { id: 'x', methode: 'raster', scheiben: 32 });
  assert.equal(scheiben().length, 32);
  // HITS: the sensitivity, the count selector off
  methode().value = 'anschlag'; methode().dispatch('change');
  assert.ok(zahl().disabled && !empf().disabled);
  empf().value = '0.7'; empf().dispatch('input');
  setzeSchnitt('x', mit(9, { methode: 'anschlag', empfindlichkeit: 0.7 }));
  attrappe.antworten['POST /sampler/neu_schneiden'] = { j: { schnitt: mit(9, { methode: 'anschlag', empfindlichkeit: 0.7 }), spuren: ['T1'], text: 'Cut again: 9 slices by hits. The patterns keep their slice numbers; WRITE ORIGINAL ORDER puts the new order on a track.' } };
  neu().dispatch('click'); await ruhe();
  assert.deepEqual(letzter('POST /sampler/neu_schneiden').koerper, { id: 'x', methode: 'anschlag', empfindlichkeit: 0.7 });
  assert.equal(POSTS('/sampler/neu_schneiden').length, 2);
  assert.ok($w('schnitt-text').textContent.includes('Cut again: 9 slices by hits'));
  assert.ok(!$w('schnitt-text').hidden);
  // after the answer the controls show the new cut
  assert.equal(methode().value, 'anschlag'); assert.equal(empf().value, '0.7');
  // WRITE ORIGINAL ORDER: the track of the selection, then the project of the answer
  const ur = knopf('schnitt-ursprung');
  assert.equal(ur.textContent, 'WRITE ORIGINAL ORDER');
  attrappe.antworten['POST /sampler/ursprung'] = { j: { rev: 7, projekt: { ...zweiSpuren(), rev: 7 }, text: 'Original order: 9 notes, one per slice, on track T1.' } };
  ur.dispatch('click'); await ruhe();
  assert.deepEqual(POSTS('/sampler/ursprung').map((a) => a.koerper), [{ spur_id: 's1' }]);
  assert.equal(w.ctx.st.projekt.rev, 7);
  assert.ok($w('schnitt-text').textContent.includes('Original order: 9 notes'));
  assert.equal(streifen().querySelectorAll('[data-w="schnitt-ursprung"]').length, 0, 'written: the offer is gone');
  // a refusal (no hit): the text, the cut as it was, nothing offered
  const n = scheiben().length;
  attrappe.antworten['POST /sampler/neu_schneiden'] = { code: 422, j: { fehler: 'keine_anschlaege', text: 'no hits found at sensitivity 0.70; cut by grid instead, or raise the sensitivity (HITS in the strip of a cut track, empfindlichkeit in the hand tool)' } };
  neu().dispatch('click'); await ruhe();
  assert.ok($w('meldung').textContent.includes('No hits found at sensitivity 0.70'));
  assert.ok($w('meldung').classList.contains('fehler'));
  assert.equal(scheiben().length, n);
});

test('a hand cut asks twice, and the first click disarms after 3 s', async () => {
  const hand = mit(16, { methode: 'hand' });
  aufbau(zweiSpuren(), { schnitte: { x: hand, y: schnittJson('y', 8) } });
  w.zeige(); await ruhe();
  const neu = () => knopf('schnitt-neu');
  const optionen = knopf('schnitt-methode').querySelectorAll('option');
  assert.deepEqual(optionen.map((o) => o.textContent), ['GRID', 'HITS', 'HAND']);
  assert.ok(optionen[2].disabled && !optionen[0].disabled, 'HAND is shown, not selectable');
  assert.equal(knopf('schnitt-methode').value, 'hand');
  assert.ok(neu().disabled, 'no method to cut by chosen yet');
  knopf('schnitt-methode').value = 'raster'; knopf('schnitt-methode').dispatch('change');
  assert.ok(!neu().disabled);
  const echt = [globalThis.setTimeout, globalThis.clearTimeout], uhren = [];
  globalThis.setTimeout = (f, ms) => { const u = { f, ms, weg: false, unref() {} }; uhren.push(u); return u; };
  globalThis.clearTimeout = (u) => { if (u) u.weg = true; };
  try {
    attrappe.antworten['POST /sampler/neu_schneiden'] = { j: { schnitt: mit(16), spuren: [], text: 'Cut again: 16 slices by grid.' } };
    neu().dispatch('click'); await ruhe();
    assert.equal(POSTS('/sampler/neu_schneiden').length, 0, 'the first click arms');
    assert.equal(neu().textContent, 'CONFIRM');
    const uhr = uhren.filter((u) => u.ms === 3000 && !u.weg).at(-1);
    assert.ok(uhr, 'a 3 s timer');
    uhr.f(); await ruhe();                                   // time runs out: disarmed
    assert.equal(neu().textContent, 'CUT AGAIN');
    neu().dispatch('click'); await ruhe();
    assert.equal(POSTS('/sampler/neu_schneiden').length, 0);
    assert.equal(neu().textContent, 'CONFIRM');
    neu().dispatch('click'); await ruhe();                   // the second click sends
    assert.deepEqual(POSTS('/sampler/neu_schneiden').map((a) => a.koerper), [{ id: 'x', methode: 'raster', scheiben: 16 }]);
  } finally { [globalThis.setTimeout, globalThis.clearTimeout] = echt; }
});

test('a drag moves a marker with snap, alt drag without; a double click adds and removes', async () => {
  aufbau(zweiSpuren(), { schnitte: { x: mit(16), y: schnittJson('y', 8) } }); antwortHoeren();
  w.zeige(); await ruhe();
  assert.deepEqual(streifen().querySelectorAll('[data-w="schnitt-marke"]').map((e) => e.dataset.marke), Array.from({ length: 15 }, (_, i) => String(i + 1)), 'one handle per interior bound');
  assert.equal(handle(3).style.left, '18.75%');
  const antwort = (j) => { attrappe.antworten['POST /sampler/marke'] = { j }; };
  // the field is 100 px wide in the stand-in: x 50 is half of the 90000 frames
  antwort({ schnitt: mit(16, { methode: 'hand' }), text: 'Marker 3 moved to frame 45000. The patterns are unchanged.' });
  ziehe(handle(3), 20, 50); await ruhe();
  assert.deepEqual(letzter('POST /sampler/marke').koerper, { id: 'x', art: 'schieben', marke: 3, frame: 45000, einrasten: true });
  assert.ok($w('schnitt-text').textContent.includes('Marker 3 moved'));
  ziehe(handle(3), 20, 30, { altKey: true }); await ruhe();
  assert.deepEqual(letzter('POST /sampler/marke').koerper, { id: 'x', art: 'schieben', marke: 3, frame: 27000, einrasten: false });
  // 3 px and under is a click: nothing is sent (and nothing is heard)
  const n = attrappe.anrufe.length;
  ziehe(handle(3), 20, 22); ziehe(handle(5), 40, 43); await ruhe();
  assert.equal(attrappe.anrufe.length, n);
  assert.equal(POSTS('/sampler/hoeren').length, 0);
  // a double click on a handle removes the marker
  antwort({ schnitt: mit(15, { methode: 'hand' }), text: 'Marker 3 removed.', rev: 4, projekt: { ...zweiSpuren(), rev: 4 } });
  setzeSchnitt('x', mit(15));
  handle(3).dispatch('dblclick'); await ruhe();
  assert.deepEqual(letzter('POST /sampler/marke').koerper, { id: 'x', art: 'weg', marke: 3 });
  assert.equal(w.ctx.st.projekt.rev, 4);
  assert.equal(scheiben().length, 15);
  // a double click on a slice adds one at the pointer: snapped by default, alt without snap
  setzeSchnitt('x', mit(16));
  antwort({ schnitt: mit(16, { methode: 'hand' }), text: 'Marker added. Slice 5 is split: its hits play the first part; slice 6 has no hits yet.' });
  scheibeEl(4).dispatch('dblclick', { clientX: 30 }); await ruhe();
  // the cut is 15 slices long now (84375 frames): 30 % of it
  assert.deepEqual(letzter('POST /sampler/marke').koerper, { id: 'x', art: 'neu', frame: 25313, einrasten: true });
  assert.ok($w('schnitt-text').textContent.includes('Slice 5 is split'));
  scheibeEl(4).dispatch('dblclick', { clientX: 30, altKey: true }); await ruhe();
  assert.deepEqual(letzter('POST /sampler/marke').koerper, { id: 'x', art: 'neu', frame: 27000, einrasten: false });   // the answer made it 16 slices again (90000 frames)
  // a click on a slice without a drag still hears and selects
  klick(scheibeEl(2)); await ruhe();
  assert.deepEqual(letzter('POST /sampler/hoeren').koerper, { spur_id: 's1', scheibe: 2 });
  assert.deepEqual(w.ctx.schnittWahl.scheiben, [2]);
});

test('after a change the strip and the grid follow (E10)', async () => {
  aufbau(zweiSpuren(), { schnitte: { x: mit(16), y: schnittJson('y', 8) } }); antwortHoeren();
  w.zeige(); await ruhe();
  klick(scheibeEl(4)); await ruhe();
  klick(scheibeEl(6), { shiftKey: true });
  assert.deepEqual(w.ctx.schnittWahl.scheiben, [4, 6]);
  const gesehen = [];
  w.ctx.beiSchnittWahl.push((wahl) => gesehen.push(wahl));
  const b = beobachte();
  const infosS1 = () => GETS('/seq/geraet').filter((a) => a.url.includes('spur_id=s1')).length;
  const infos = infosS1();
  const projekt = { ...zweiSpuren(), rev: 5 };
  setzeSchnitt('x', mit(9, { methode: 'hand' }));
  attrappe.antworten['POST /sampler/marke'] = { j: { schnitt: mit(9, { methode: 'hand' }), text: 'Marker 10 removed.', rev: 5, projekt } };
  handle(5).dispatch('dblclick'); await ruhe();
  assert.equal(scheiben().length, 9, 'nine slices are drawn');
  assert.equal(streifen().querySelectorAll('[data-w="schnitt-marke"]').length, 8);
  assert.deepEqual(w.ctx.schnittWahl, { spur_id: 's1', schnitt_id: 'x', scheiben: [] });
  assert.deepEqual(gesehen.at(-1), { spur_id: 's1', schnitt_id: 'x', scheiben: [] });
  assert.equal(b.vergiss, 1, 'the info of the track is forgotten once');
  assert.equal(b.projekte.length, 1);
  assert.equal(b.projekte[0][0], 'm1');
  assert.ok(b.projekte[0][1] === projekt, 'the project of the answer is taken over');
  assert.equal(infosS1(), infos + 1, 'the info of the track is asked again');
  assert.equal(GETS('/sampler/schnitt').length, 1, 'the answer carries the cut: no second read');
  assert.ok(!streifen().hidden);
});

test('a cut changed elsewhere is read again on selection (geaendert differs)', async () => {
  aufbau(zweiSpuren(), { schnitte: { x: mit(16, { geaendert: '2026-11-16T10:00:00.000Z' }), y: schnittJson('y', 8) } });
  w.zeige(); await ruhe();
  const b = beobachte();
  w.ctx.waehleScheiben([3]);
  // the same stamp: a project event reads nothing, an event of the cut with the same stamp neither
  w.ctx.uebernimm('m1', { ...zweiSpuren(), rev: 3 }); await ruhe();
  w.ereignis('schnitt', { id: 'x', geaendert: '2026-11-16T10:00:00.000Z' }); await ruhe();
  b.vergiss = 0;
  assert.equal(GETS('/sampler/schnitt').length, 1, 'neither a project event nor an event with the same stamp read the cut');
  assert.deepEqual(w.ctx.schnittWahl.scheiben, [3]);
  assert.equal(b.vergiss, 0);
  w.ctx.waehle('s3'); await ruhe(); w.ctx.waehle('s1'); await ruhe();
  assert.equal(scheiben().length, 16);
  assert.equal(b.vergiss, 0);
  // Cypher cut it again meanwhile
  setzeSchnitt('x', mit(9, { geaendert: '2026-11-16T10:05:00.000Z', methode: 'anschlag' }));
  w.ctx.waehle('s3'); await ruhe(); w.ctx.waehle('s1'); await ruhe();
  assert.equal(scheiben().length, 9, 'redrawn from the new cut');
  assert.equal(b.vergiss, 1);
  assert.deepEqual(w.ctx.schnittWahl, { spur_id: 's1', schnitt_id: 'x', scheiben: [] });
  // a hand cut without a project step: the event of the server reaches the open strip, no selection and no project event needed
  const n = GETS('/sampler/schnitt').length;
  setzeSchnitt('x', mit(12, { geaendert: '2026-11-16T10:09:00.000Z' }));
  w.ctx.uebernimm('m1', { ...zweiSpuren(), rev: 4 }); await ruhe();
  assert.equal(scheiben().length, 9, 'a project event does not read the cut');
  w.ereignis('schnitt', { id: 'x', geaendert: '2026-11-16T10:09:00.000Z' }); await ruhe();
  assert.equal(scheiben().length, 12);
  assert.equal(GETS('/sampler/schnitt').length, n + 1);
  assert.equal(b.vergiss, 2);
  w.ereignis('schnitt', { id: 'unbekannt', geaendert: 'x' }); await ruhe();   // a cut the strip never read: nothing to refresh
  assert.equal(GETS('/sampler/schnitt').length, n + 1);
});

test('moved markers are amber; a refusal keeps the strip and shows the text', async () => {
  const ursprung = Array.from({ length: 17 }, (_, k) => k * 5625); ursprung[2] = 11000;
  aufbau(zweiSpuren(), { schnitte: { x: mit(16, { ursprung, methode: 'hand' }), y: schnittJson('y', 8) } });
  w.zeige(); await ruhe();
  assert.deepEqual(streifen().querySelectorAll('[data-w="schnitt-marke"]').filter((e) => e.classList.contains('bewegt')).map((e) => e.dataset.marke), ['2']);
  // a cut without `ursprung` (written by A1): nothing is amber
  w.ctx.waehle('s3'); await ruhe();
  assert.equal(streifen().querySelectorAll('[data-w="schnitt-marke"]').filter((e) => e.classList.contains('bewegt')).length, 0);
  w.ctx.waehle('s1'); await ruhe();
  klick(scheibeEl(2)); await ruhe();
  attrappe.antworten['POST /sampler/hoeren'] = { j: { ok: true } };
  const b = beobachte();
  attrappe.antworten['POST /sampler/marke'] = { code: 409, j: { fehler: 'marke_zu_nah', text: 'marker 3 would be within 4 frames of marker 4' } };
  const vorher = handle(3).style.left;
  ziehe(handle(3), 20, 24); ziehe(handle(3), 20, 90); await ruhe();   // the second drag is sent and refused
  assert.equal(POSTS('/sampler/marke').length, 1);
  assert.ok($w('meldung').textContent.includes('Marker 3 would be within 4 frames of marker 4'));
  assert.ok($w('meldung').classList.contains('fehler'));
  assert.equal(handle(3).style.left, vorher, 'the handle is back where it was');
  assert.equal(scheiben().length, 16);
  assert.deepEqual(w.ctx.schnittWahl.scheiben, [2], 'the selection stays');
  assert.equal(b.vergiss, 0);
  assert.equal(b.projekte.length, 0);
  assert.ok($w('schnitt-text').hidden, 'a refusal is not a hint of the strip');
});

test('hit ticks come from the cut; marker 0 is neutral, a marker without a hit is dim', async () => {
  const guete = Array.from({ length: 16 }, (_, i) => ({ staerke: i === 0 ? 0 : i === 5 ? 0 : 0.5, raster_abstand_beats: i === 7 ? 0.06 : i === 8 ? -0.125 : 0 }));
  aufbau(zweiSpuren(), { schnitte: { x: schnittJson('x', 16, guete), y: schnittJson('y', 8) } });
  w.zeige(); await ruhe();
  assert.equal(streifen().querySelectorAll('[data-w="schnitt-treffer"]').length, 0, 'no hits stored: no ticks');
  aufbau(zweiSpuren(), { schnitte: { x: { ...schnittJson('x', 16, guete), treffer: [100, 5600, 45000] }, y: schnittJson('y', 8) } });
  w.zeige(); await ruhe();
  const ticks = streifen().querySelectorAll('[data-w="schnitt-treffer"]');
  assert.deepEqual(ticks.map((t) => t.style.left), ['0.1111%', '6.2222%', '50%']);
  // the bar of marker 0 is not drawn (the detector never finds a hit at frame 0); every other measured marker has one, a strength of 0 included
  assert.deepEqual(streifen().querySelectorAll('[data-w="schnitt-guete"]').map((b) => b.dataset.marke), Array.from({ length: 15 }, (_, i) => String(i + 1)));
  assert.deepEqual(streifen().querySelectorAll('[data-w="schnitt-marke"]').filter((e) => e.classList.contains('ohne-treffer')).map((e) => e.dataset.marke), ['5']);
  // strength and grid distance are in the hover text of the handle
  assert.ok(handle(7).getAttribute('title').includes('strength 0.50'));
  assert.ok(handle(7).getAttribute('title').includes('0.060 beat after the grid'));
  assert.ok(handle(8).getAttribute('title').includes('0.125 beat before the grid'));
  assert.ok(handle(5).getAttribute('title').includes('no hit'));
  assert.ok(handle(1).getAttribute('title').includes('on the grid'));
});

test('a double click on a slice hears it once: the second click of the pair does not start another listening', async () => {
  aufbau(zweiSpuren(), { schnitte: { x: mit(16), y: schnittJson('y', 8) } }); antwortHoeren();
  w.zeige(); await ruhe();
  attrappe.antworten['POST /sampler/marke'] = { j: { schnitt: mit(17, { methode: 'hand' }), text: 'Marker added.' } };
  const el = scheibeEl(4);
  klick(el, { detail: 1 }); klick(el, { detail: 2 }); el.dispatch('dblclick', { clientX: 30 }); await ruhe();
  assert.equal(POSTS('/sampler/hoeren').length, 1);
  assert.equal(POSTS('/sampler/marke').length, 1);
});
