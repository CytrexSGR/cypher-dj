// Shelf tab SAMPLES, LIBRARY mode: the catalog through /stoebern (stubbed answers, stubbed Audio).
import test from 'node:test';
import assert from 'node:assert/strict';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

installiere();
const { bindeWerkbank } = await import('../public/werkbank/werkbank.js');
const { katalogUrl, instrumentKnoepfe, fehlendeQuellen, ordnerKurz, KATALOG_TEXT } = await import('../public/werkbank/regal_catalog.js');

const post = (w, k) => fetch(w, { method: 'POST', body: JSON.stringify(k) });
const ruhe = async () => { for (let i = 0; i < 12; i++) await new Promise((ok) => setImmediate(ok)); };
const GETS = (pre) => attrappe.anrufe.filter((a) => a.methode === 'GET' && a.url.startsWith(pre));
const POSTS = (weg) => attrappe.anrufe.filter((a) => a.methode === 'POST' && a.url === weg);
const modul = (name) => ({ name, rev: 3, werkbank: { schema: 1 }, tempo_bpm: 130, taktart: [4, 4], loop: { an: true, von_beat: 0, bis_beat: 16 }, spuren: [{ id: 's1', name: 'Drums', art: 'instrument', clips: [] }] });
const MODUL_AKTUELL = { slug: 'm', projekt: modul('M') };
const T = (sha, extra = {}) => ({ sha, name: `${sha}.wav`, instrument: 'kick', pack: 'Pack A', dauer_s: 0.72, ordner: 'Kicks', pfad_da: true, nur_live: false, ...extra });
const TREFFER = { gesamt: 2, seite: 0, limit: 100, treffer: [T('aaa'), T('bbb')] };
const BAUM = { facetten: { instrument: [{ wert: 'kick', n: 6459 }, { wert: 'snare', n: 12 }, { wert: '', n: 3 }] } };
const QUELLEN = { quellen: [{ name: 'Battery', pfad: '/x', n: 100, da: true }] };
const basis = (liste = TREFFER) => ({
  'GET /stoebern': () => ({ j: typeof liste === 'function' ? liste(attrappe.anrufe.at(-1).url) : liste }),
  'GET /stoebern/baum': { j: BAUM }, 'GET /stoebern/quellen': { j: QUELLEN },
  'GET /sampler/dateien': { j: { wurzeln: [{ name: 'Battery 4' }] } },
});

let wurzel, w, audios;
class FakeAudio {
  constructor(url) { this.url = url; this.pausiert = false; this.listeners = {}; audios.push(this); }
  addEventListener(a, f) { (this.listeners[a] ??= []).push(f); }
  play() { return Promise.resolve(); }
  pause() { this.pausiert = true; }
}
function aufbau({ antworten = basis(), aktuell = { slug: null }, speicher = {} } = {}) {
  audios = [];
  installiere({ speicher: { 'djk-wb-regal-tab': 'samples', ...speicher }, antworten: {
    'GET /proj/aktuell': { j: aktuell }, 'GET /proj/liste': { j: [] }, 'GET /proj/werkbank/vorlagen': { j: { vorlagen: [] } }, ...antworten } });
  delete globalThis.Audio;
  wurzel = document.createElement('section');
  w = bindeWerkbank({ post, wurzel, frage: () => true });
  w.ctx.Audio = FakeAudio;
  w.ctx.suchMs = 5;
}
const regal = () => wurzel.querySelector('[data-w="regal"]');
const wd = (n) => regal().querySelectorAll(`[data-w="${n}"]`);
const meldung = () => wurzel.querySelector('[data-w="meldung"]').textContent;
const zeige = async (o) => { aufbau(o); w.zeige(); await ruhe(); };

test('pure helpers: url, instrument buttons, missing sources', () => {
  assert.equal(katalogUrl({ text: '', instrument: null, seite: 0 }), '/stoebern?typ=oneshot&schutz=aus&vorrang=1&limit=100');
  assert.equal(katalogUrl({ text: 'kick 909', instrument: 'kick', seite: 2 }), '/stoebern?typ=oneshot&schutz=aus&vorrang=1&limit=100&text=kick%20909&feld=instrument&wert=kick&seite=2');
  assert.ok(katalogUrl({ text: '', instrument: '', seite: 0 }).endsWith('&feld=instrument&wert='));
  assert.deepEqual(instrumentKnoepfe(BAUM).map((b) => b.text), ['ALL', 'KICK 6,459', 'SNARE 12', 'OTHER 3']);
  assert.deepEqual(fehlendeQuellen([{ name: 'HomeLW', n: 24470, da: false }, { name: 'B', n: 1, da: true }]), ['HomeLW: disk not mounted · 24,470 samples not reachable']);
});

test('LIBRARY is the default and asks /stoebern with typ=oneshot, schutz=aus, vorrang=1, limit=100', async () => {
  await zeige();
  assert.deepEqual(GETS('/stoebern?').map((a) => a.url), ['/stoebern?typ=oneshot&schutz=aus&vorrang=1&limit=100']);
  assert.equal(GETS('/sampler/dateien').length, 0, 'FOLDERS is not loaded');
  assert.equal(wd('katalog-datei').length, 2);
});

test('instrument buttons come from the facets in served order, empty is OTHER; click sends feld/wert, ALL drops it', async () => {
  await zeige();
  assert.deepEqual(wd('katalog-instrument').map((b) => b.textContent), ['ALL', 'KICK 6,459', 'SNARE 12', 'OTHER 3']);
  wd('katalog-instrument')[1].dispatch('click'); await ruhe();
  assert.ok(GETS('/stoebern?').at(-1).url.endsWith('&feld=instrument&wert=kick'));
  wd('katalog-instrument')[3].dispatch('click'); await ruhe();
  assert.ok(GETS('/stoebern?').at(-1).url.endsWith('&feld=instrument&wert='));
  wd('katalog-instrument')[0].dispatch('click'); await ruhe();
  assert.ok(!GETS('/stoebern?').at(-1).url.includes('feld='));
});

test('the search waits ctx.suchMs and sends text', async () => {
  await zeige();
  const n0 = GETS('/stoebern?').length;
  const feld = wd('katalog-suche')[0];
  feld.value = 'snare'; feld.dispatch('input'); feld.dispatch('input');
  assert.equal(GETS('/stoebern?').length, n0);
  await new Promise((ok) => setTimeout(ok, 40)); await ruhe();
  assert.equal(GETS('/stoebern?').length, n0 + 1);
  assert.ok(GETS('/stoebern?').at(-1).url.includes('&text=snare'));
});

test('a click previews /sampler/datei/hoer?sha=, a second click stops it', async () => {
  await zeige();
  const [a] = wd('katalog-datei');
  a.dispatch('click'); await ruhe();
  assert.equal(audios[0].url, '/sampler/datei/hoer?sha=aaa');
  assert.ok(a.classList.contains('spielt'));
  a.dispatch('click'); await ruhe();
  assert.equal(audios[0].pausiert, true);
});

test('TO TRACK posts {sha} and takes over the project', async () => {
  const neu = { ...modul('M'), rev: 4, spuren: [...modul('M').spuren, { id: 's2', name: 'a', art: 'instrument', clips: [] }] };
  await zeige({ aktuell: MODUL_AKTUELL, antworten: { ...basis(), 'POST /sampler/datei/spur': { j: { rev: 4, projekt: neu, spur_id: 's2', text: 'Tone aaa' } } } });
  wd('katalog-spur')[0].dispatch('click'); await ruhe();
  assert.deepEqual(POSTS('/sampler/datei/spur')[0].koerper, { sha: 'aaa' });
  assert.equal(w.ctx.st.wahl, 's2');
  assert.ok(meldung().includes('Tone aaa'));
});

test('a refused TO TRACK (file vanished) shows the text of the answer', async () => {
  await zeige({ aktuell: MODUL_AKTUELL, antworten: { ...basis(), 'POST /sampler/datei/spur': { code: 404, j: { fehler: 'quelle_unbekannt' } } } });
  wd('katalog-spur')[0].dispatch('click'); await ruhe();
  assert.ok(meldung().includes('not reachable any more'));
  assert.equal(wd('katalog-datei').length, 2, 'the list stays');
});

test('a row with pfad_da false has class fehlt, no TO TRACK and does not preview', async () => {
  await zeige({ antworten: basis({ gesamt: 1, treffer: [T('zzz', { pfad_da: false })] }) });
  const [z] = wd('katalog-datei');
  assert.ok(z.classList.contains('fehlt'));
  assert.equal(wd('katalog-spur').length, 0);
  z.dispatch('click'); await ruhe();
  assert.equal(audios.length, 0);
  assert.ok(regal().querySelector('.w-hinweis').textContent.includes(KATALOG_TEXT.fehltZeile));
});

test('a missing source shows "HomeLW: disk not mounted · 24,470 samples not reachable"', async () => {
  await zeige({ antworten: { ...basis(), 'GET /stoebern/quellen': { j: { quellen: [{ name: 'HomeLW', pfad: '/media/x', n: 24470, da: false }, QUELLEN.quellen[0]] } } } });
  const t = wd('katalog-platte').map((e) => e.textContent);
  assert.deepEqual(t, ['HomeLW: disk not mounted · 24,470 samples not reachable']);
});

test('a 503 katalog_fehlt shows the catalog text; FOLDERS still lists /sampler/dateien', async () => {
  await zeige({ antworten: { ...basis(), 'GET /stoebern': { code: 503, j: { fehler: 'katalog_fehlt', text: 'raw' } } } });
  assert.ok(regal().textContent.includes('The sample catalog is not available right now. FOLDERS still works.'));
  wd('samples-modus').find((b) => b.getAttribute('data-modus') === 'ordner').dispatch('click'); await ruhe();
  assert.ok(GETS('/sampler/dateien').length > 0);
  assert.ok(regal().textContent.includes('Battery 4'));
});

test('a 400 suche_ungueltig shows the refusal text, not "Nothing found"', async () => {
  await zeige({ antworten: { ...basis(), 'GET /stoebern': { code: 400, j: { fehler: 'suche_ungueltig' } } } });
  assert.ok(regal().textContent.includes('That search is not valid'));
  assert.ok(!regal().textContent.includes('Nothing found'));
});

test('an empty catalog says Nothing found', async () => {
  await zeige({ antworten: basis({ gesamt: 0, treffer: [] }) });
  assert.ok(regal().textContent.includes('Nothing found'));
});

test('MORE appends the rows of seite=1 and disappears when all are shown', async () => {
  await zeige({ antworten: basis((u) => (u.includes('seite=1') ? { gesamt: 3, seite: 1, limit: 100, treffer: [T('ccc')] } : { gesamt: 3, seite: 0, limit: 100, treffer: [T('aaa'), T('bbb')] })) });
  assert.equal(wd('katalog-mehr').length, 1);
  wd('katalog-mehr')[0].dispatch('click'); await ruhe();
  assert.ok(GETS('/stoebern?').at(-1).url.endsWith('&seite=1'));
  assert.deepEqual(wd('katalog-datei').map((r) => r.getAttribute('data-sha')), ['aaa', 'bbb', 'ccc']);
  assert.equal(wd('katalog-mehr').length, 0);
});

test('an answer to an older search is dropped when something newer was typed', async () => {
  await zeige();
  let frei;
  const tor = new Promise((ok) => { frei = ok; });
  const echt = globalThis.fetch;
  const ant = (sha) => ({ status: 200, json: async () => ({ gesamt: 1, seite: 0, limit: 100, treffer: [T(sha)] }) });
  globalThis.fetch = async (url, opt) => {
    if (String(url).includes('text=alt')) { await tor; return ant('alt'); }
    if (String(url).includes('text=neu')) return ant('neu');
    return echt(url, opt);
  };
  try {
    const feld = wd('katalog-suche')[0];
    feld.value = 'alt'; feld.dispatch('keydown', { key: 'Enter' }); await ruhe();
    feld.value = 'neu'; feld.dispatch('keydown', { key: 'Enter' }); await ruhe();
    frei(); await ruhe();
    assert.deepEqual(wd('katalog-datei').map((r) => r.getAttribute('data-sha')), ['neu']);
  } finally { globalThis.fetch = echt; }
});

test('the mode is remembered under djk-wb-regal-katalog and restored', async () => {
  await zeige();
  wd('samples-modus').find((b) => b.getAttribute('data-modus') === 'ordner').dispatch('click'); await ruhe();
  assert.equal(JSON.parse(localStorage.getItem('djk-wb-regal-katalog')).modus, 'ordner');
  assert.ok(wd('samples-modus').find((b) => b.getAttribute('data-modus') === 'ordner').classList.contains('an'));
  assert.ok(GETS('/sampler/dateien').length > 0);
  await zeige({ speicher: { 'djk-wb-regal-katalog': '{"modus":"ordner","instrument":"kick"}' } });
  assert.equal(GETS('/stoebern?').length, 0);
  assert.ok(GETS('/sampler/dateien').length > 0);
});

test('the chosen instrument is remembered next to the mode', async () => {
  await zeige();
  wd('katalog-instrument')[1].dispatch('click'); await ruhe();
  assert.deepEqual(JSON.parse(localStorage.getItem('djk-wb-regal-katalog')), { instrument: 'kick' });
  await zeige({ speicher: { 'djk-wb-regal-katalog': '{"modus":"katalog","instrument":"kick"}' } });
  assert.ok(GETS('/stoebern?')[0].url.endsWith('&feld=instrument&wert=kick'));
});

test('rows show the folder: last part, two parts when the last says nothing, source name instead of the absolute path, full place as title', async () => {
  const q = [{ name: 'Battery', pfad: '/data/samples/Battery', n: 1, da: true }];
  assert.deepEqual(ordnerKurz('/data/samples/Battery/Drums/HiHat', q), { text: 'Battery/…/HiHat', title: 'Battery/Drums/HiHat' });
  assert.deepEqual(ordnerKurz('/data/samples/vcsl/Renaissance Organ/4\'', []).text, 'Renaissance Organ/4\'');
  assert.ok(!ordnerKurz('/data/samples/vcsl/Renaissance Organ/4\'', []).text.includes('/data'));
  assert.ok(ordnerKurz('/x/' + 'a'.repeat(80), []).text.length <= 34);
  assert.equal(ordnerKurz(null, q).text, '');
  const ein = [T('a1', { name: '1 F1', ordner: '/data/samples/Battery/Drums/HiHat' })];
  await zeige({ antworten: { ...basis({ gesamt: 1, treffer: ein }), 'GET /stoebern/quellen': { j: { quellen: q } } } });
  const o = wd('katalog-datei')[0].querySelector('.w-kat-ordner');
  assert.equal(o.textContent, 'Battery/…/HiHat');
  assert.equal(o.getAttribute('title'), 'Battery/Drums/HiHat');
});

test('the row keeps the whole hit, typ included', async () => {
  await zeige({ antworten: basis({ gesamt: 1, treffer: [T('aaa', { typ: 'oneshot' })] }) });
  assert.equal(wd('katalog-datei')[0].treffer?.typ, 'oneshot');
});

test('a refused TO TRACK with the server text shows that text and a second click asks again', async () => {
  await zeige({ aktuell: MODUL_AKTUELL, antworten: { ...basis(), 'POST /sampler/datei/spur': { code: 404, j: { fehler: 'quelle_unbekannt', text: 'that sample is not in the catalog' } } } });
  wd('katalog-spur')[0].dispatch('click'); await ruhe();
  assert.ok(meldung().includes('That sample is not in the catalog'));
  wd('katalog-spur')[0].dispatch('click'); await ruhe();
  assert.equal(POSTS('/sampler/datei/spur').length, 2);
});

test('a row with favorit true shows a pressed star; a click posts weg', async () => {
  await zeige({ antworten: { ...basis({ gesamt: 2, treffer: [T('aaa', { favorit: true }), T('bbb')] }), 'POST /kollektionen/favourites/posten': { j: {} } } });
  const [a, b] = wd('katalog-datei').map((r) => r.querySelector('[data-w="stern"]'));
  assert.equal(a.getAttribute('aria-pressed'), 'true');
  assert.equal(b.getAttribute('aria-pressed'), 'false');
  a.dispatch('click'); await ruhe();
  assert.deepEqual(POSTS('/kollektionen/favourites/posten')[0].koerper, { weg: [{ art: 'sample', sha: 'aaa' }] });
  assert.equal(audios.length, 0, 'the click does not reach the row');
  assert.equal(a.getAttribute('aria-pressed'), 'false');
});

test('a refused star flips back and shows the text', async () => {
  await zeige({ antworten: { ...basis(), 'POST /kollektionen/favourites/posten': { code: 400, j: { fehler: 'x', text: 'no way' } } } });
  const s = wd('katalog-datei')[1].querySelector('[data-w="stern"]');
  s.dispatch('click'); await ruhe();
  assert.equal(s.getAttribute('aria-pressed'), 'false');
  assert.ok(meldung().includes('No way'));
});

test('TO TRACK records the sha as recently used after a 200 and not after a 409; a preview does not', async () => {
  const neu = { ...modul('M'), rev: 4, spuren: [...modul('M').spuren, { id: 's2', name: 'a', art: 'instrument', clips: [] }] };
  await zeige({ aktuell: MODUL_AKTUELL, antworten: { ...basis(), 'POST /sampler/datei/spur': { j: { rev: 4, projekt: neu, spur_id: 's2' } }, 'POST /kollektionen/recently-used/posten': { j: {} } } });
  wd('katalog-datei')[1].dispatch('click'); await ruhe();
  assert.equal(POSTS('/kollektionen/recently-used/posten').length, 0);
  wd('katalog-spur')[0].dispatch('click'); await ruhe();
  const p = { art: 'sample', sha: 'aaa' };
  assert.deepEqual(POSTS('/kollektionen/recently-used/posten').map((a) => a.koerper), [{ weg: [p], hinzu: [p] }]);
  await zeige({ aktuell: MODUL_AKTUELL, antworten: { ...basis(), 'POST /sampler/datei/spur': { code: 409, j: { fehler: 'werkbank_voll' } }, 'POST /kollektionen/recently-used/posten': { j: {} } } });
  wd('katalog-spur')[0].dispatch('click'); await ruhe();
  assert.equal(POSTS('/kollektionen/recently-used/posten').length, 0);
});
