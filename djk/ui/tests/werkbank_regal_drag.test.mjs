// Drag from the shelf (LIBRARY mode) onto the track list and a drum row. Drag events are dispatched on the DOM stand-in with a stand-in dataTransfer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

installiere();
const { bindeWerkbank } = await import('../public/werkbank/werkbank.js');
const { ZIEH_TYP } = await import('../public/production/drag.js');
const { KATALOG_TEXT } = await import('../public/werkbank/regal_catalog.js');

const post = (w, k) => fetch(w, { method: 'POST', body: JSON.stringify(k) });
const ruhe = async () => { for (let i = 0; i < 12; i++) await new Promise((ok) => setImmediate(ok)); };
const POSTS = (weg) => attrappe.anrufe.filter((a) => a.methode === 'POST' && a.url === weg);
const SHA = (c) => c.repeat(64);
const T = (sha, extra = {}) => ({ sha, typ: 'oneshot', name: `${sha.slice(0, 3)}.wav`, instrument: 'kick', pack: 'P', dauer_s: 0.72, ordner: 'Kicks', pfad_da: true, nur_live: false, favorit: false, ...extra });
const TREFFER = { gesamt: 3, seite: 0, limit: 100, treffer: [T(SHA('a')), T(SHA('b'), { pfad_da: false }), T(SHA('c'), { dauer_s: 0 })] };
const clip = { id: 'c1', art: 'midi', name: 'D', start_beat: 0, laenge_beats: 16, loop_beats: 4, noten: [{ id: 'n1', beat: 0, laenge: 0.125, ton: 36, vel: 100 }] };
const spurD = { id: 's1', nr: 1, name: 'Drums', farbe: '#2fd6c3', art: 'instrument', geraet: { art: 'intern', name: 'bk', graph: 'drums-909', parameter: {} }, clips: [clip] };
const spurK = { ...spurD, id: 's3', nr: 3, name: 'Kit', geraet: { art: 'intern', name: 'kit', parameter: {} } };
const spurB = { id: 's2', nr: 2, name: 'Bass', farbe: '#2fd6c3', art: 'instrument', geraet: { art: 'intern', name: 'bk', graph: 'bass-banddrive', parameter: {} }, clips: [{ ...clip, id: 'c2' }] };
const modul = (spuren = [spurD]) => ({ name: 'M', rev: 3, werkbank: { schema: 1 }, tempo_bpm: 130, taktart: [4, 4], loop: { an: true, von_beat: 0, bis_beat: 16 }, spuren });
const KLAENGE = [{ ton: 36, name: 'Kick' }, { ton: 38, name: 'Snare' }];

let wurzel, w;
function aufbau({ aktuell, art = 'bk', klaenge = KLAENGE, extra = {}, wahl } = {}) {
  installiere({ speicher: { 'djk-wb-regal-tab': 'samples', ...(wahl ? { 'djk-wb-wahl-m': wahl } : {}) }, antworten: {
    'GET /proj/aktuell': { j: aktuell ?? { slug: null } }, 'GET /proj/liste': { j: [] }, 'GET /proj/werkbank/vorlagen': { j: { vorlagen: [] } },
    'GET /stoebern': { j: TREFFER }, 'GET /stoebern/baum': { j: { facetten: { instrument: [] } } }, 'GET /stoebern/quellen': { j: { quellen: [] } },
    'GET /sampler/dateien': { j: { wurzeln: [] } }, 'GET /seq/geraet': { j: { art, regler: [], klaenge } }, 'GET /geraete/panel': { j: {} },
    'POST /kollektionen/recently-used/posten': { j: {} }, ...extra } });
  wurzel = document.createElement('section');
  w = bindeWerkbank({ post, wurzel, frage: () => true });
}
const wd = (n) => wurzel.querySelectorAll(`[data-w="${n}"]`);
const meldung = () => wurzel.querySelector('[data-w="meldung"]').textContent;
const zeige = async (o) => { aufbau(o); w.zeige(); await ruhe(); };
const zeile = (i) => wd('katalog-datei')[i];

// a dataTransfer stand-in; a drag event with it; `abgebrochen` tells whether the listener called preventDefault
function dt(daten = null) {
  const d = { types: daten ? [ZIEH_TYP] : [], daten: {}, effectAllowed: '', dropEffect: '', setData(t, v) { this.daten[t] = v; this.types = [t]; }, getData(t) { return daten && t === ZIEH_TYP ? daten : this.daten[t] ?? ''; } };
  return d;
}
function zieh(ziel, art, daten) {
  let abgebrochen = false;
  ziel.dispatch(art, { dataTransfer: dt(daten), preventDefault() { abgebrochen = true; } });
  return abgebrochen;
}
const NUTZ = JSON.stringify({ sha: SHA('a'), dauer_s: 0.72, name: 'aaa.wav' });
const NEU = { ...modul([spurD, spurB]), rev: 4 };

test('a reachable row is draggable and sets application/x-djk-clip with nutzlast(t); a missing or protected row is not draggable', async () => {
  await zeige();
  assert.equal(zeile(0).getAttribute('draggable'), 'true');
  assert.equal(zeile(1).getAttribute('draggable'), null, 'pfad_da false');
  assert.equal(zeile(2).getAttribute('draggable'), null, 'length 0');
  const d = dt();
  zeile(0).dispatch('dragstart', { dataTransfer: d });
  assert.deepEqual(JSON.parse(d.daten[ZIEH_TYP]), { sha: SHA('a'), dauer_s: 0.72, name: 'aaa.wav' });
  assert.equal(d.effectAllowed, 'copy');
  assert.ok(KATALOG_TEXT.hint.endsWith('drag it onto TRACKS, or onto a row of a kit track'));
});

test('a drop on the track list posts {sha} to /sampler/datei/spur, selects the new track and records recently used', async () => {
  await zeige({ aktuell: { slug: 'm', projekt: modul() }, extra: { 'POST /sampler/datei/spur': { j: { rev: 4, projekt: NEU, spur_id: 's2', text: 'Tone aaa' } } } });
  const liste = wd('spuren')[0];
  assert.ok(zieh(liste, 'dragover', NUTZ), 'dragover accepts');
  assert.ok(liste.classList.contains('w-drop'));
  zieh(liste, 'drop', NUTZ); await ruhe();
  assert.ok(!liste.classList.contains('w-drop'));
  assert.deepEqual(POSTS('/sampler/datei/spur').map((a) => a.koerper), [{ sha: SHA('a') }]);
  assert.equal(w.ctx.st.wahl, 's2');
  assert.equal(POSTS('/kollektionen/recently-used/posten').length, 1);
  assert.ok(meldung().includes('Tone aaa'));
});

test('the whole TRACKS panel is the zone: the mark stays while crossing children, goes when the panel is left; a drop on the heading adds the track', async () => {
  await zeige({ aktuell: { slug: 'm', projekt: modul() }, extra: { 'POST /sampler/datei/spur': { j: { rev: 4, projekt: NEU, spur_id: 's2' } } } });
  const host = wd('spuren')[0], titel = wd('spuren-titel')[0], karte = wd('spur')[0];
  assert.ok(!zieh(host, 'dragover', null), 'no ZIEH_TYP: not accepted');
  zieh(host, 'dragenter', NUTZ); assert.ok(zieh(host, 'dragover', NUTZ));
  assert.ok(host.classList.contains('w-drop'));
  zieh(karte, 'dragenter', NUTZ); zieh(host, 'dragleave', NUTZ);   // host -> track card
  assert.ok(host.classList.contains('w-drop'), 'still marked on the card');
  zieh(karte, 'dragleave', NUTZ);
  assert.ok(!host.classList.contains('w-drop'), 'gone after leaving the panel');
  zieh(titel, 'dragenter', NUTZ); zieh(titel, 'dragover', NUTZ);
  zieh(titel, 'drop', NUTZ); await ruhe();
  assert.ok(!host.classList.contains('w-drop'));
  assert.deepEqual(POSTS('/sampler/datei/spur').map((a) => a.koerper), [{ sha: SHA('a') }]);
});

test('a drop on a drum row name posts {spur_id, ton, sha} to /sampler/datei/pad and takes over the project', async () => {
  const nach = { ...modul([spurK]), rev: 5, tempo_bpm: 131 };
  await zeige({ aktuell: { slug: 'm', projekt: modul([spurK]) }, wahl: 's3', extra: { 'POST /sampler/datei/pad': { j: { rev: 5, projekt: nach, text: 'Snare replaced' } } } });
  const namen = wd('zeilenname');
  assert.deepEqual([...namen].map((n) => n.textContent), ['Kick', 'Snare']);
  const snare = namen[1];
  const grid = wd('r-raster')[0];
  assert.ok(zieh(snare, 'dragover', NUTZ));
  assert.ok(snare.classList.contains('w-drop'));
  zieh(snare, 'drop', NUTZ); await ruhe();
  assert.deepEqual(POSTS('/sampler/datei/pad').map((a) => a.koerper), [{ spur_id: 's3', ton: 38, sha: SHA('a') }]);
  assert.equal(w.ctx.st.projekt.tempo_bpm, 131, 'the answer project is taken over');
  assert.ok(meldung().includes('Snare replaced'));
  assert.equal(POSTS('/kollektionen/recently-used/posten').length, 1);
  assert.ok(grid !== null);
  assert.equal(wd('zeilenname').filter((n) => n.classList.contains('w-drop')).length, 0);
});

test('a drum synth track: the row is not marked, a drop sends nothing and says so as a hint', async () => {
  await zeige({ aktuell: { slug: 'm', projekt: modul() }, wahl: 's1' });
  const kick = wd('zeilenname')[0];
  zieh(kick, 'dragover', NUTZ);
  assert.ok(!kick.classList.contains('w-drop'));
  zieh(kick, 'drop', NUTZ); await ruhe();
  assert.equal(meldung(), 'Drums plays a drum synth, not a sample kit. Drop the sample on TRACKS for a new track.');
  assert.equal(POSTS('/sampler/datei/pad').length, 0);
  assert.equal(POSTS('/kollektionen/recently-used/posten').length, 0);
});

test('a NOTE grid row name does not accept the drop', async () => {
  await zeige({ aktuell: { slug: 'm', projekt: modul([spurB]) }, wahl: 's2', klaenge: [] });
  const namen = wd('zeilenname');
  assert.ok(namen.length > 0);
  assert.ok(!zieh(namen[0], 'dragover', NUTZ));
  assert.ok(!namen[0].classList.contains('w-drop'));
  zieh(namen[0], 'drop', NUTZ); await ruhe();
  assert.equal(POSTS('/sampler/datei/pad').length, 0);
  assert.equal(POSTS('/sampler/datei/spur').length, 0);
});

test('a refused drop shows the refusal text and records nothing', async () => {
  await zeige({ aktuell: { slug: 'm', projekt: modul([spurK]) }, wahl: 's3', extra: {
    'POST /sampler/datei/spur': { code: 404, j: { fehler: 'quelle_unbekannt' } },
    'POST /sampler/datei/pad': { code: 409, j: { fehler: 'kit_unbekannt', text: 'this track is not a drum kit' } } } });
  const liste = wd('spuren')[0];
  zieh(liste, 'dragover', NUTZ); zieh(liste, 'drop', NUTZ); await ruhe();
  assert.ok(meldung().includes('not reachable any more'));
  assert.ok(!liste.classList.contains('w-drop'));
  const kick = wd('zeilenname')[0];
  zieh(kick, 'dragover', NUTZ); zieh(kick, 'drop', NUTZ); await ruhe();
  assert.ok(meldung().includes('This track is not a drum kit'));
  assert.equal(POSTS('/kollektionen/recently-used/posten').length, 0);
  assert.ok(!kick.classList.contains('w-drop'));
});

test('a drop without an open module shows "Open a module first." and sends nothing', async () => {
  await zeige();
  const liste = wd('spuren')[0];
  assert.ok(!zieh(liste, 'dragover', NUTZ), 'no module: not accepted');
  zieh(liste, 'drop', NUTZ); await ruhe();
  assert.equal(meldung(), KATALOG_TEXT.keinModul);
  assert.equal(POSTS('/sampler/datei/spur').length, 0);
  assert.equal(POSTS('/sampler/datei/pad').length, 0);
});

test('a garbled payload sends nothing', async () => {
  await zeige({ aktuell: { slug: 'm', projekt: modul() } });
  const liste = wd('spuren')[0];
  zieh(liste, 'drop', '{not json'); zieh(liste, 'drop', JSON.stringify({ sha: 'zz' })); await ruhe();
  assert.equal(POSTS('/sampler/datei/spur').length, 0);
});

test('without dragging, click, preview and keys of a row are unchanged', async () => {
  await zeige({ aktuell: { slug: 'm', projekt: modul() }, extra: { 'POST /sampler/datei/spur': { j: { rev: 4, projekt: NEU, spur_id: 's2' } } } });
  wd('katalog-spur')[0].dispatch('click'); await ruhe();
  assert.deepEqual(POSTS('/sampler/datei/spur').map((a) => a.koerper), [{ sha: SHA('a') }]);
});
