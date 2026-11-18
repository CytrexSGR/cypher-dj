// The SOUND host (cut strip, kit dialog, ROOT box) works on the selected track (schnitt_streifen.js reads st.wahl). So it must never sit in the window of
// another track: window.js moves it into the window of the selected track, or hides it in the workbench root. Setup as in werkbank_schnitt.test.mjs.
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

const scheibenZahl = () => streifen().querySelectorAll('[data-w="schnitt-scheibe"]').length;
const wurzelHost = (host) => host.parent === wurzel;

test('selecting track B takes the cut strip out of the window of track A', async () => {
  aufbau(zweiSpuren());
  w.zeige(); await ruhe();
  const f = w.ctx.oeffneGeraet('s1'); await ruhe();
  const host = w.ctx.klangHost;
  assert.ok(f.koerper.contains(host) && !host.hidden, 'the host sits in the window of s1');
  assert.equal(scheibenZahl(), 16, 'the window of s1 shows the 16 slices of cut x');
  w.ctx.waehle('s3'); await ruhe();
  assert.ok(!f.koerper.contains(host), 'the host left the window of s1');
  assert.ok(host.hidden && wurzelHost(host), 'and is hidden in the workbench root');
  w.ctx.waehle('s1'); await ruhe();
  assert.ok(f.koerper.contains(host) && !host.hidden, 'selecting s1 again brings it back');
  assert.equal(scheibenZahl(), 16);
  assert.equal(w.ctx.schnittWahl?.spur_id, 's1');
});

test('with a window for each track the host follows the selection, also when OPEN is pressed on a window that exists already', async () => {
  aufbau(zweiSpuren());
  w.zeige(); await ruhe();
  const a = w.ctx.oeffneGeraet('s1'); await ruhe();
  const b = w.ctx.oeffneGeraet('s3'); await ruhe();
  const host = w.ctx.klangHost;
  assert.ok(b.koerper.contains(host) && !a.koerper.contains(host), 's3 is selected: the host sits in its window');
  assert.equal(scheibenZahl(), 8);
  w.ctx.oeffneGeraet('s1'); await ruhe();   // the window of s1 exists: it only comes to the front, the host must come to it
  assert.ok(a.koerper.contains(host) && !b.koerper.contains(host));
  assert.equal(scheibenZahl(), 16);
  w.ctx.waehle('s3'); await ruhe();
  assert.ok(b.koerper.contains(host) && !a.koerper.contains(host));
  assert.equal(scheibenZahl(), 8);
});

test('closing the window of the selected track hides the host in the root; closing another window does not move it', async () => {
  aufbau(zweiSpuren());
  w.zeige(); await ruhe();
  const a = w.ctx.oeffneGeraet('s1'); await ruhe();
  const b = w.ctx.oeffneGeraet('s3'); await ruhe();
  const host = w.ctx.klangHost;
  w.ctx.fenster.schliesse('spur:s1'); await ruhe();
  assert.ok(b.koerper.contains(host) && !host.hidden, 'the window of s1 was not the selected one');
  w.ctx.fenster.schliesse('spur:s3'); await ruhe();
  assert.ok(host.hidden && wurzelHost(host), 'no window of the selected track: hidden in the root');
});
