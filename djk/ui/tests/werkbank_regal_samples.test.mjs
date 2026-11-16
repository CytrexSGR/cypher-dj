// Shelf tab SAMPLES: the pure helpers and the binder against the DOM stand-in (stubbed requests, stubbed Audio).
import test from 'node:test';
import assert from 'node:assert/strict';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

installiere();
const { bindeWerkbank } = await import('../public/werkbank/werkbank.js');
const { krumen, groesseText, zeilenModell, naechsteZeile, vorhoerUrl, listenUrl } = await import('../public/werkbank/regal_samples.js');

const post = (w, k) => fetch(w, { method: 'POST', body: JSON.stringify(k) });
const ruhe = async () => { for (let i = 0; i < 12; i++) await new Promise((ok) => setImmediate(ok)); };
const LISTEN = () => attrappe.anrufe.filter((a) => a.methode === 'GET' && a.url.startsWith('/sampler/dateien'));
const POSTS = (weg) => attrappe.anrufe.filter((a) => a.methode === 'POST' && a.url === weg);

const modul = (name) => ({ name, rev: 3, werkbank: { schema: 1 }, tempo_bpm: 130, taktart: [4, 4], loop: { an: true, von_beat: 0, bis_beat: 16 }, spuren: [{ id: 's1', name: 'Drums', art: 'instrument', clips: [] }] });
const WURZELN = { wurzeln: [{ name: 'Battery 4' }, { name: 'Gone', fehlt: true }] };
const WURZEL_ANTWORT = { wurzel: 'Battery 4', ordner: '', ordner_liste: ['Kicks', 'Snares'], dateien: [{ name: 'a.wav', rel: 'a.wav', bytes: 2048 }, { name: 'b C3.wav', rel: 'b C3.wav', bytes: 3 * 1024 * 1024 }] };
const MODUL_AKTUELL = { slug: 'm', projekt: modul('M') };
// the stand-in answers by path without the query: one function answers the roots and the listing by the URL it was just called with
const dateiAntworten = (listing = WURZEL_ANTWORT) => ({ 'GET /sampler/dateien': () => ({ j: /wurzel=/.test(attrappe.anrufe.at(-1).url) ? listing : WURZELN }) });

let wurzel, w, audios;
class FakeAudio {
  constructor(url) { this.url = url; this.pausiert = false; this.listeners = {}; audios.push(this); }
  addEventListener(a, f) { (this.listeners[a] ??= []).push(f); }
  play() { return Promise.resolve(); }
  pause() { this.pausiert = true; }
  feuere(a) { for (const f of this.listeners[a] ?? []) f({}); }
}
function aufbau({ antworten = dateiAntworten(), aktuell = { slug: null }, mitAudio = true } = {}) {
  audios = [];
  installiere({ speicher: { 'djk-wb-regal-tab': 'samples' }, antworten: {
    'GET /proj/aktuell': { j: aktuell }, 'GET /proj/liste': { j: [] }, 'GET /proj/werkbank/vorlagen': { j: { vorlagen: [] } }, ...antworten } });
  delete globalThis.Audio;
  wurzel = document.createElement('section');
  w = bindeWerkbank({ post, wurzel, frage: () => true });
  if (mitAudio) w.ctx.Audio = FakeAudio;
  w.ctx.suchMs = 5;
}
const regal = () => wurzel.querySelector('[data-w="regal"]');
const wd = (n) => regal().querySelectorAll(`[data-w="${n}"]`);
const hinweis = () => regal().querySelector('.w-hinweis').textContent;
const meldung = () => wurzel.querySelector('[data-w="meldung"]').textContent;

test('krumen: cumulative relative paths, no empty parts', () => {
  assert.deepEqual(krumen('Kicks/Acoustic//Tight/'), [{ name: 'Kicks', rel: 'Kicks' }, { name: 'Acoustic', rel: 'Kicks/Acoustic' }, { name: 'Tight', rel: 'Kicks/Acoustic/Tight' }]);
  assert.deepEqual(krumen(''), []);
  assert.deepEqual(krumen(undefined), []);
});

test('groesseText: bytes, KB, MB, GB', () => {
  assert.equal(groesseText(512), '512 B');
  assert.equal(groesseText(2048), '2.0 KB');
  assert.equal(groesseText(150 * 1024), '150 KB');
  assert.equal(groesseText(3 * 1024 * 1024), '3.0 MB');
  assert.equal(groesseText(5 * 1024 ** 3), '5.0 GB');
  assert.equal(groesseText(undefined), '');
});

test('zeilenModell: folders first, then files; search hits carry their folder; mehr', () => {
  const m = zeilenModell({ ordner: 'Kicks', ordner_liste: ['Deep'], dateien: [{ name: 'k.wav', rel: 'Kicks/k.wav', bytes: 10 }], mehr: true });
  assert.deepEqual(m.zeilen.map((z) => [z.art, z.name, z.rel]), [['ordner', 'Deep', 'Kicks/Deep'], ['datei', 'k.wav', 'Kicks/k.wav']]);
  assert.equal(m.mehr, true);
  const s = zeilenModell({ dateien: [{ name: 'k.wav', rel: 'Kicks/Deep/k.wav', bytes: 10 }] }, { suche: true });
  assert.equal(s.zeilen[0].ort, 'Kicks/Deep');
  assert.deepEqual(zeilenModell(null), { zeilen: [], mehr: false });
});

test('naechsteZeile: arrow keys clamp at the ends', () => {
  const z = [1, 2, 3];
  assert.equal(naechsteZeile(z, -1, 'ArrowDown'), 0);
  assert.equal(naechsteZeile(z, 0, 'ArrowDown'), 1);
  assert.equal(naechsteZeile(z, 2, 'ArrowDown'), 2);
  assert.equal(naechsteZeile(z, 0, 'ArrowUp'), 0);
  assert.equal(naechsteZeile(z, 2, 'ArrowUp'), 1);
  assert.equal(naechsteZeile([], 0, 'ArrowDown'), -1);
});

test('urls encode wurzel, rel, ordner and suche', () => {
  assert.equal(vorhoerUrl('Battery 4', 'a b/c#d.wav'), '/sampler/datei/hoer?wurzel=Battery%204&rel=a%20b%2Fc%23d.wav');
  assert.equal(listenUrl('R', '', ''), '/sampler/dateien?wurzel=R');
  assert.equal(listenUrl('R', 'A/B', 'x y'), '/sampler/dateien?wurzel=R&ordner=A%2FB&suche=x%20y');
});

test('the tab is the fourth button; it loads only when shown: roots, then the first listing', async () => {
  aufbau();
  assert.deepEqual(regal().querySelectorAll('.w-tab').map((x) => x.textContent), ['MODULES', 'LOOPS', 'CUTS', 'SAMPLES', 'INSTRUMENTS']);
  assert.equal(LISTEN().length, 0);
  w.zeige(); await ruhe();
  assert.deepEqual(LISTEN().map((a) => a.url), ['/sampler/dateien', '/sampler/dateien?wurzel=Battery%204']);
});

test('rows: folders then files with size, play mark and TO TRACK; chips; crumbs; a missing root is disabled', async () => {
  aufbau({ aktuell: MODUL_AKTUELL });
  w.zeige(); await ruhe();
  assert.deepEqual(wd('samples-wurzel').map((c) => c.textContent), ['Battery 4', 'Gone']);
  const gone = wd('samples-wurzel')[1];
  assert.equal(gone.disabled, true);
  assert.equal(gone.getAttribute('title'), 'This folder is not on disk');
  assert.deepEqual(wd('samples-ordner').map((r) => r.textContent), ['▸Kicks', '▸Snares']);
  const d = wd('samples-datei');
  assert.equal(d.length, 2);
  assert.ok(d[1].textContent.includes('3.0 MB'));
  assert.ok(d[0].textContent.includes('▶'));
  assert.equal(wd('samples-spur')[0].disabled, false);
  assert.deepEqual(wd('samples-pfad').map((c) => c.textContent), ['Battery 4']);
});

test('no roots: the text names the file', async () => {
  aufbau({ antworten: { 'GET /sampler/dateien': () => ({ j: { wurzeln: [] } }) } });
  w.zeige(); await ruhe();
  assert.ok(regal().textContent.includes('No sample folders yet. List them in ~/.config/cypherdj/sampler/wurzeln.json'));
});

test('a folder click lists it, crumbs go back, the choice is remembered', async () => {
  aufbau({ aktuell: MODUL_AKTUELL });
  w.zeige(); await ruhe();
  wd('samples-ordner')[0].dispatch('click'); await ruhe();
  assert.equal(LISTEN().at(-1).url, '/sampler/dateien?wurzel=Battery%204&ordner=Kicks');
  assert.deepEqual(wd('samples-pfad').map((c) => c.textContent), ['Battery 4', 'Kicks']);
  assert.deepEqual(JSON.parse(localStorage.getItem('djk-wb-regal-samples')), { wurzel: 'Battery 4', ordner: 'Kicks' });
  wd('samples-pfad')[0].dispatch('click'); await ruhe();
  assert.equal(LISTEN().at(-1).url, '/sampler/dateien?wurzel=Battery%204');
});

test('a click plays through the Audio element, a second click stops, another file switches', async () => {
  aufbau({ aktuell: MODUL_AKTUELL });
  w.zeige(); await ruhe();
  const [a, b] = wd('samples-datei');
  a.dispatch('click'); await ruhe();
  assert.equal(audios.length, 1);
  assert.equal(audios[0].url, '/sampler/datei/hoer?wurzel=Battery%204&rel=a.wav');
  assert.ok(a.classList.contains('spielt'));
  a.dispatch('click'); await ruhe();
  assert.equal(audios[0].pausiert, true);
  assert.ok(!a.classList.contains('spielt'));
  a.dispatch('click'); b.dispatch('click'); await ruhe();
  assert.equal(audios[1].pausiert, true);
  assert.equal(audios[2].url, '/sampler/datei/hoer?wurzel=Battery%204&rel=b%20C3.wav');
  assert.ok(b.classList.contains('spielt') && !a.classList.contains('spielt'));
});

test('a preview error shows a short text in the hint, no alert', async () => {
  aufbau({ aktuell: MODUL_AKTUELL });
  w.zeige(); await ruhe();
  const alerts = []; globalThis.alert = (t) => alerts.push(t);
  wd('samples-datei')[0].dispatch('click'); await ruhe();
  audios[0].feuere('error');
  assert.ok(hinweis().includes('cannot be previewed'));
  assert.equal(alerts.length, 0);
  delete globalThis.alert;
});

test('without an Audio constructor a click does not throw and the hint says so', async () => {
  aufbau({ aktuell: MODUL_AKTUELL, mitAudio: false });
  w.zeige(); await ruhe();
  wd('samples-datei')[0].dispatch('click'); await ruhe();
  assert.ok(hinweis().includes('not available'));
});

test('arrow keys move and play, Enter is TO TRACK', async () => {
  aufbau({ aktuell: MODUL_AKTUELL, antworten: { ...dateiAntworten(), 'POST /sampler/datei/spur': { j: { rev: 4, projekt: { ...modul('M'), rev: 4 }, spur_id: 's2', text: 'Tone a' } } } });
  w.zeige(); await ruhe();
  const liste = regal().querySelector('.w-smp-liste');
  for (let i = 0; i < 3; i++) liste.dispatch('keydown', { key: 'ArrowDown' });   // Kicks, Snares, a.wav
  await ruhe();
  assert.equal(audios.length, 1);
  assert.ok(audios[0].url.endsWith('rel=a.wav'));
  liste.dispatch('keydown', { key: 'Enter' }); await ruhe();
  assert.deepEqual(POSTS('/sampler/datei/spur').map((p) => p.koerper), [{ wurzel: 'Battery 4', rel: 'a.wav' }]);
});

test('TO TRACK: sends root and rel, takes over the project, selects the new track, shows the text', async () => {
  const neu = { ...modul('M'), rev: 4, spuren: [{ id: 's1', name: 'Drums', art: 'instrument', clips: [] }, { id: 's2', name: 'a', art: 'instrument', clips: [] }] };
  aufbau({ aktuell: MODUL_AKTUELL, antworten: { ...dateiAntworten(), 'POST /sampler/datei/spur': { j: { rev: 4, projekt: neu, spur_id: 's2', text: 'Tone a: root C3' } } } });
  w.zeige(); await ruhe();
  wd('samples-spur')[0].dispatch('click'); await ruhe();
  assert.deepEqual(POSTS('/sampler/datei/spur').map((p) => p.koerper), [{ wurzel: 'Battery 4', rel: 'a.wav' }]);
  assert.equal(w.ctx.st.wahl, 's2');
  assert.ok(meldung().includes('Tone a: root C3'));
  assert.equal(wd('samples-spur')[0].disabled, false);
});

test('TO TRACK is disabled without an open module', async () => {
  aufbau();
  w.zeige(); await ruhe();
  assert.equal(wd('samples-spur')[0].disabled, true);
  assert.equal(wd('samples-spur')[0].getAttribute('title'), 'Open a module first.');
});

test('a refused TO TRACK shows the text of the answer', async () => {
  aufbau({ aktuell: MODUL_AKTUELL, antworten: { ...dateiAntworten(), 'POST /sampler/datei/spur': { code: 400, j: { fehler: 'zu_lang', text: 'This file is longer than 60 s' } } } });
  w.zeige(); await ruhe();
  wd('samples-spur')[0].dispatch('click'); await ruhe();
  assert.ok(meldung().includes('longer than 60 s'));
});

test('search: debounced, sends suche; Escape clears and lists again', async () => {
  aufbau({ aktuell: MODUL_AKTUELL });
  w.zeige(); await ruhe();
  const feld = wd('samples-suche')[0];
  const n0 = LISTEN().length;
  feld.value = 'kick c3'; feld.dispatch('input'); feld.dispatch('input');
  assert.equal(LISTEN().length, n0, 'not before the pause');
  await new Promise((ok) => setTimeout(ok, 40)); await ruhe();
  assert.equal(LISTEN().length, n0 + 1);
  assert.equal(LISTEN().at(-1).url, '/sampler/dateien?wurzel=Battery%204&suche=kick%20c3');
  feld.dispatch('keydown', { key: 'Escape' }); await ruhe();
  assert.equal(feld.value, '');
  assert.equal(LISTEN().at(-1).url, '/sampler/dateien?wurzel=Battery%204');
});

test('mehr: true adds the last row', async () => {
  aufbau({ antworten: dateiAntworten({ ...WURZEL_ANTWORT, mehr: true }) });
  w.zeige(); await ruhe();
  assert.ok(regal().textContent.includes('More files than shown: narrow the search'));
});

test('Reading… shows while a request is on its way; a newer request wins over an older answer', async () => {
  aufbau({ aktuell: MODUL_AKTUELL });
  w.zeige(); await ruhe();
  let frei;
  const tor = new Promise((ok) => { frei = ok; });
  const echt = globalThis.fetch;
  const treffer = (rel) => ({ status: 200, json: async () => ({ dateien: [{ name: rel, rel, bytes: 1 }] }) });
  globalThis.fetch = async (url, opt) => {
    if (String(url).includes('suche=alt')) { await tor; return treffer('alt.wav'); }
    if (String(url).includes('suche=neu')) return treffer('neu.wav');
    return echt(url, opt);
  };
  try {
    const feld = wd('samples-suche')[0];
    feld.value = 'alt'; feld.dispatch('keydown', { key: 'Enter' }); await ruhe();
    assert.ok(regal().textContent.includes('Reading…'));
    feld.value = 'neu'; feld.dispatch('keydown', { key: 'Enter' }); await ruhe();
    frei(); await ruhe();
    assert.deepEqual(wd('samples-datei').map((r) => r.getAttribute('data-rel')), ['neu.wav']);
  } finally { globalThis.fetch = echt; }
});
