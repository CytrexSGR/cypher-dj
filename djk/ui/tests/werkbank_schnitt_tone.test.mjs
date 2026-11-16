// Sampler C task 5: TO TONE on the cut strip and the ROOT box of a tone track (public/werkbank/schnitt_tone.js). Run against the DOM stand-in; the requests
// the page sends are asserted, not only the markup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

installiere();
const { bindeWerkbank } = await import('../public/werkbank/werkbank.js');

const bk = (nr, graph) => ({ id: `s${nr}`, nr, name: `T${nr}`, farbe: '#2fd6c3', art: 'instrument', geraet: { art: 'intern', name: 'bk', graph, parameter: {} }, clips: [] });
const projektMit = (spuren, rev = 1) => ({ name: 'M', rev, werkbank: { schema: 1 }, tempo_bpm: 130, taktart: [4, 4], loop: { an: true, von_beat: 0, bis_beat: 16 }, spuren });
const post = (w, k) => fetch(w, { method: 'POST', body: JSON.stringify(k) });
const ruhe = async () => { for (let i = 0; i < 12; i++) await new Promise((ok) => setImmediate(ok)); };
const GETS = (weg) => attrappe.anrufe.filter((a) => a.methode === 'GET' && a.url.split('?')[0] === weg);
const POSTS = (weg) => attrappe.anrufe.filter((a) => a.methode === 'POST' && a.url === weg);
const letzter = (kopf) => { const [m, u] = kopf.split(' '); return attrappe.anrufe.filter((a) => a.methode === m && a.url === u).at(-1); };

const schnittJson = (id, n = 16) => ({
  schema: 1, id, name: `Break ${id}`, quelle: { art: 'loop', ref: 'break' }, bpm: 128, beats: 16, frames: n * 5625, methode: 'raster',
  grenzen: Array.from({ length: n + 1 }, (_, k) => k * 5625),
  guete: Array.from({ length: n }, () => ({ staerke: null, raster_abstand_beats: 0 })),
});
function welle() {
  const spalten = 600, b = new ArrayBuffer(16 + spalten * 4), v = new DataView(b);
  'DJKW'.split('').forEach((c, i) => v.setUint8(i, c.charCodeAt(0)));
  v.setUint32(4, 1, true); v.setUint32(8, 150, true); v.setUint32(12, spalten, true);
  for (let i = 0; i < spalten * 4; i++) v.setUint8(16 + i, 40 + (i % 90));
  return b;
}
const WELLE = welle();
const tonJson = (grund, quelle = 'erkannt', erkannt = { note: 57, hz: 220, konfidenz: 0.93 }) => ({
  schema: 1, graph: 'ton-x-1', schnitt_id: 'x', nr: 1, name: 'Break x · 4', scheiben: [3, 3], a: 16875, b: 22500, grund, grund_quelle: quelle, erkannt, erstellt: '2026-11-16T10:00:00Z',
});

let wurzel, w;
const $w = (n) => wurzel.querySelector(`[data-w="${n}"]`);
const streifen = () => $w('schnitt');
const scheibeEl = (i) => { const e = streifen().querySelectorAll('[data-w="schnitt-scheibe"]').find((x) => x.dataset.scheibe === String(i)); assert.ok(e, `no slice ${i}`); return e; };
const knopf = (text) => streifen().querySelectorAll('[data-w="schnitt-aktion"]').find((b) => b.textContent === text);
const klick = (el, ev = {}) => el.dispatch('click', ev);
const box = () => $w('ton');
const wahlSelect = () => box().querySelectorAll('[data-w="ton-grund"]')[0];
const erkanntText = () => box().querySelectorAll('[data-w="ton-erkannt"]')[0].textContent;

// s1 plays the cut x (a slice track), s2 plays a tone, s3 plays another tone
function aufbau(projekt) {
  installiere({ antworten: { 'GET /proj/aktuell': { j: { slug: 'm1', projekt } }, 'GET /proj/liste': { j: [] }, 'GET /proj/werkbank/vorlagen': { j: { vorlagen: [] } }, 'GET /geraete/panel': { j: {} } } });
  const info = { s1: { schnitt: { id: 'x', scheiben: 16, laengen_beats: [] } } };
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opt) => {
    const r = await orig(url, opt), u = String(url), q = new URLSearchParams(u.split('?')[1] ?? '');
    if (u.startsWith('/welle')) return { ...r, status: 200, ok: true, arrayBuffer: async () => WELLE };
    if (u.startsWith('/seq/geraet')) { const s = info[q.get('spur_id')]; return { ...r, json: async () => ({ art: 'bk', regler: [], klaenge: [], ...(s ? { schnitt: s.schnitt } : {}) }) }; }
    if (u.startsWith('/sampler/schnitt') && (opt?.method ?? 'GET') === 'GET') return { ...r, status: 200, ok: true, json: async () => ({ schnitt: schnittJson(q.get('id')) }) };
    return r;
  };
  wurzel = document.createElement('section');
  w = bindeWerkbank({ post, wurzel, frage: () => true });
}
const mitToenen = () => projektMit([bk(1, 'smp-x'), bk(2, 'ton-x-1'), bk(3, 'ton-y-2')]);

test('TO TONE is active for one slice or neighbours only (review focus 2)', async () => {
  aufbau(mitToenen());
  w.zeige(); await ruhe();
  assert.ok(knopf('TO TONE'), 'the button is drawn after FIT');
  assert.equal(knopf('TO TONE').getAttribute('title'), 'Make the selected slice, or a run of neighbouring slices, a tone on a new NOTE track');
  assert.equal(knopf('TO TONE').disabled, true, 'nothing selected');
  w.ctx.waehleScheiben([3]); assert.equal(knopf('TO TONE').disabled, false);
  w.ctx.waehleScheiben([3, 4, 5]); assert.equal(knopf('TO TONE').disabled, false);
  w.ctx.waehleScheiben([2, 5]); assert.equal(knopf('TO TONE').disabled, true);
  w.ctx.waehleScheiben([2, 3, 5]); assert.equal(knopf('TO TONE').disabled, true);
  const n = POSTS('/sampler/ton').length;
  klick(knopf('TO TONE')); await ruhe();
  assert.equal(POSTS('/sampler/ton').length, n, 'a disabled button sends nothing');
});

test('TO TONE sends the range and selects the new track', async () => {
  aufbau(mitToenen());
  w.zeige(); await ruhe();
  const neu = { ...mitToenen(), rev: 2, spuren: [...mitToenen().spuren, bk(9, 'ton-x-2')] };
  attrappe.antworten['POST /sampler/ton'] = { j: { ton: { ...tonJson(57, 'erkannt'), graph: 'ton-x-2', name: 'Break x · 4-5' }, text: 'tone ...', rev: 2, projekt: neu, spur_id: 's9' } };
  w.ctx.waehleScheiben([3, 4]); klick(knopf('TO TONE')); await ruhe();
  assert.deepEqual(letzter('POST /sampler/ton').koerper, { id: 'x', von: 3, bis: 4, spur: true });
  assert.equal(w.ctx.st.wahl, 's9');
  assert.equal(w.ctx.st.projekt.rev, 2);
  assert.equal($w('meldung').textContent, 'Tone Break x · 4-5: root A2 (from detection)');
  assert.ok(!$w('meldung').classList.contains('fehler'));
  // one slice
  attrappe.antworten['POST /sampler/ton'] = { j: { ton: { ...tonJson(60, 'vorgabe'), name: 'Break x · 7' }, text: 't', rev: 3, projekt: { ...neu, rev: 3 }, spur_id: 's9' } };
  w.ctx.waehle('s1'); await ruhe();
  w.ctx.waehleScheiben([6]); klick(knopf('TO TONE')); await ruhe();
  assert.deepEqual(letzter('POST /sampler/ton').koerper, { id: 'x', von: 6, bis: 6, spur: true });
  assert.equal($w('meldung').textContent, 'Tone Break x · 7: root C3 (default)');
});

test('the message names the source of the root: the key, or by hand', async () => {
  aufbau(mitToenen());
  w.zeige(); await ruhe();
  const neu = { ...mitToenen(), rev: 2 };
  attrappe.antworten['POST /sampler/ton'] = { j: { ton: { ...tonJson(69, 'tonart'), name: 'N' }, text: 't', tonart: '8A', rev: 2, projekt: neu, spur_id: 's2' } };
  w.ctx.waehleScheiben([1]); klick(knopf('TO TONE')); await ruhe();
  assert.equal($w('meldung').textContent, 'Tone N: root A3 (from the key 8A)');
});

test('a refused TO TONE shows the text and leaves the selection and the selected track as they were; a second click while it runs sends nothing', async () => {
  aufbau(mitToenen());
  w.zeige(); await ruhe();
  w.ctx.waehleScheiben([3, 4]);
  attrappe.antworten['POST /sampler/ton'] = { code: 409, j: { fehler: 'werkbank_voll', text: 'a module holds at most 8 instrument tracks' } };
  const rev = w.ctx.st.projekt.rev;
  klick(knopf('TO TONE')); await ruhe();
  assert.ok($w('meldung').textContent.includes('instrument tracks'), $w('meldung').textContent);
  assert.ok($w('meldung').classList.contains('fehler'));
  assert.deepEqual(w.ctx.schnittWahl, { spur_id: 's1', schnitt_id: 'x', scheiben: [3, 4] });
  assert.equal(w.ctx.st.wahl, 's1');
  assert.equal(w.ctx.st.projekt.rev, rev);
  // a reason the page has a text for
  attrappe.antworten['POST /sampler/ton'] = { code: 409, j: { fehler: 'kein_projekt' } };
  klick(knopf('TO TONE')); await ruhe();
  assert.equal($w('meldung').textContent, w.ctx.antwortText({ status: 409, j: { fehler: 'kein_projekt' } }));
  // a request that is still running: the button is off and a click sends nothing
  let frei;
  const orig = globalThis.fetch;
  let gesendet = 0;
  globalThis.fetch = async (url, opt) => {
    if (String(url) === '/sampler/ton') { gesendet++; await new Promise((ok) => { frei = ok; }); return { status: 409, ok: false, json: async () => ({ fehler: 'ton_blockiert', text: 'no room' }) }; }
    return orig(url, opt);
  };
  klick(knopf('TO TONE')); await ruhe();
  assert.equal(knopf('TO TONE').disabled, true, 'busy');
  klick(knopf('TO TONE')); await ruhe();
  assert.equal(gesendet, 1, 'the second click sent nothing');
  frei(); await ruhe();
  assert.equal(knopf('TO TONE').disabled, false, 'free again');
  assert.ok($w('meldung').textContent.includes('No room'), $w('meldung').textContent);
});

test('the ROOT box shows for a tone track only, with the detection text (the root is a note name list 16..95)', async () => {
  aufbau(mitToenen());
  attrappe.antworten['GET /sampler/ton'] = { j: { ton: tonJson(57), text: 'tone ton-x-1 ...' } };
  w.zeige(); await ruhe();
  assert.ok(box().hidden, 'the slice track has no ROOT box');
  assert.equal(GETS('/sampler/ton').length, 0);
  w.ctx.waehle('s2'); await ruhe();
  assert.ok(!box().hidden);
  assert.deepEqual(GETS('/sampler/ton').map((a) => a.url), ['/sampler/ton?graph=ton-x-1']);
  assert.equal(wahlSelect().value, '57');
  assert.equal(erkanntText(), 'Detected A2 · confidence 0.93');
  const optionen = wahlSelect().querySelectorAll('option');
  assert.deepEqual([optionen.length, optionen[0].value, optionen[0].textContent, optionen.at(-1).value, optionen.at(-1).textContent], [80, '16', 'E-1', '95', 'B5']);
  assert.ok(optionen.find((o) => o.value === '57').textContent === 'A2');
  // box sits right after the strip
  assert.ok(streifen().nextElementSibling === box());
  // back to the slice track: hidden again, and the tone is fetched once per graph
  w.ctx.waehle('s1'); await ruhe();
  assert.ok(box().hidden);
  w.ctx.waehle('s2'); await ruhe();
  assert.equal(GETS('/sampler/ton').length, 2, 'asked again when the graph came back');
  w.ctx.uebernimm('m1', { ...mitToenen(), rev: 2 }); await ruhe();
  assert.equal(GETS('/sampler/ton').length, 2, 'a project change of the same track asks nothing');
});

test('the ROOT box says where the root came from', async () => {
  aufbau(mitToenen());
  const zeige = async (j) => { attrappe.antworten['GET /sampler/ton'] = { j }; w.ctx.waehle('s3'); await ruhe(); w.ctx.waehle('s2'); await ruhe(); return erkanntText(); };
  w.zeige(); await ruhe();
  assert.equal(await zeige({ ton: tonJson(69, 'tonart', { note: 62, hz: 293, konfidenz: 0.31 }), tonart: '8A' }), 'Detected D3 · confidence 0.31 · root from the key 8A');
  assert.equal(await zeige({ ton: tonJson(60, 'vorgabe', { note: null, hz: null, konfidenz: 0 }) }), 'No clear pitch · confidence 0.00 · root C3 (default)');
  assert.equal(wahlSelect().value, '60');
  assert.equal(await zeige({ ton: tonJson(64, 'hand', { note: null, hz: null, konfidenz: 0 }) }), 'No clear pitch · confidence 0.00 · root set by hand');
  assert.equal(wahlSelect().value, '64');
  // a tone that cannot be read: the text of the refusal, no selector action
  attrappe.antworten['GET /sampler/ton'] = { code: 404, j: { fehler: 'ton_unbekannt', text: 'tone ton-x-1 does not exist' } };
  w.ctx.waehle('s3'); await ruhe(); w.ctx.waehle('s2'); await ruhe();
  assert.ok(erkanntText().includes('Tone ton-x-1 does not exist'), erkanntText());
  const n = POSTS('/sampler/ton/grund').length;
  wahlSelect().value = '70'; wahlSelect().dispatch('change'); await ruhe();
  assert.equal(POSTS('/sampler/ton/grund').length, n, 'no tone loaded: a change sends nothing');
});

test('a ROOT change posts and a refusal puts the select back', async () => {
  aufbau(mitToenen());
  attrappe.antworten['GET /sampler/ton'] = { j: { ton: tonJson(57), text: 't' } };
  w.zeige(); await ruhe();
  w.ctx.waehle('s2'); await ruhe();
  attrappe.antworten['POST /sampler/ton/grund'] = { j: { ton: tonJson(64, 'hand'), text: 't', neu_geladen: true } };
  wahlSelect().value = '64'; wahlSelect().dispatch('change'); await ruhe();
  assert.deepEqual(letzter('POST /sampler/ton/grund').koerper, { graph: 'ton-x-1', grund: 64 });
  assert.equal(wahlSelect().value, '64');
  assert.equal(erkanntText(), 'Detected A2 · confidence 0.93 · root set by hand', 'the text follows the new source');
  assert.ok(!$w('meldung').classList.contains('fehler'));
  // refused: the select goes back to the root the tone has, the text of the answer shows
  attrappe.antworten['POST /sampler/ton/grund'] = { code: 409, j: { fehler: 'ki_gestoppt' } };
  wahlSelect().value = '70'; wahlSelect().dispatch('change'); await ruhe();
  assert.equal(wahlSelect().value, '64');
  assert.equal($w('meldung').textContent, w.ctx.antwortText({ status: 409, j: { fehler: 'ki_gestoppt' } }));
  assert.ok($w('meldung').classList.contains('fehler'));
  attrappe.antworten['POST /sampler/ton/grund'] = { code: 404, j: { fehler: 'ton_unbekannt', text: 'tone ton-x-1 does not exist' } };
  wahlSelect().value = '20'; wahlSelect().dispatch('change'); await ruhe();
  assert.equal(wahlSelect().value, '64');
  assert.ok($w('meldung').textContent.includes('Tone ton-x-1 does not exist'), $w('meldung').textContent);
  // a reload that failed on the server is shown, the root stays changed
  attrappe.antworten['POST /sampler/ton/grund'] = { j: { ton: tonJson(65, 'hand'), text: 't', neu_geladen: false, neu_laden_fehler: 'the playback could not be reloaded: no' } };
  wahlSelect().value = '65'; wahlSelect().dispatch('change'); await ruhe();
  assert.equal(wahlSelect().value, '65');
  assert.ok($w('meldung').textContent.includes('could not be reloaded'));
  assert.ok($w('meldung').classList.contains('fehler'));
});
