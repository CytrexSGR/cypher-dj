// Shelf: one search over everything (media browser B4): the field, the grouped hits, show all, FITS, the keys (stubbed answers, stubbed Audio).
import test from 'node:test';
import assert from 'node:assert/strict';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

installiere();
const { bindeWerkbank } = await import('../public/werkbank/werkbank.js');
const { SUCH_MS, SUCHE_TEXT } = await import('../public/werkbank/regal_suche.js');

const post = (w, k) => fetch(w, { method: 'POST', body: JSON.stringify(k) });
const ruhe = async () => { for (let i = 0; i < 12; i++) await new Promise((ok) => setImmediate(ok)); };
const warte = (ms) => new Promise((ok) => setTimeout(ok, ms));
const GETS = (pre) => attrappe.anrufe.filter((a) => a.methode === 'GET' && a.url.startsWith(pre));
const POSTS = (weg) => attrappe.anrufe.filter((a) => a.methode === 'POST' && a.url === weg);
const modul = (name, extra = {}) => ({ name, rev: 3, werkbank: { schema: 1 }, tempo_bpm: 130, taktart: [4, 4], loop: { an: true, von_beat: 0, bis_beat: 16 }, spuren: [{ id: 's1', name: 'Drums', art: 'instrument', clips: [] }], ...extra });
const MODUL_AKTUELL = { slug: 'm', projekt: modul('M') };
const T = (sha, extra = {}) => ({ sha, name: `${sha}.wav`, instrument: 'kick', pack: 'Pack A', dauer_s: 0.72, ordner: 'Kicks', pfad_da: true, nur_live: false, ...extra });
const G = (art, zahl, treffer, extra = {}) => ({ art, name: { samples: 'Samples', loops: 'Loops', instrumente: 'Instruments', geraete: 'Devices', presets: 'Presets', module: 'Modules', schnitte: 'Cuts' }[art], zahl, treffer, ...extra });
const ANTWORT = {
  q: 'kick', passt: null, gruppen: [
    G('samples', 12, [T('aaa'), T('bbb')]),
    G('loops', 1, [T('lll', { typ: 'loop', bpm: 126 })]),
    G('instrumente', 2, [{ id: 'i1', name: 'Piano kick', noten: 3, zonen: 3, bytes: 1000, erstellt: '2026-11-01T10:00:00Z' }, { name: 'kick-synth', art: 'instrument', kategorie: 'drums' }]),
    G('geraete', 1, [{ name: 'kick-comp', art: 'effekt', kategorie: 'dynamics' }]),
    G('presets', 1, [{ herkunft: 'werk', geraet: 'surge', slug: 'p', name: 'Kick preset', tags: ['punchy'] }]),
    G('module', 1, [{ slug: 'k1', name: 'Kick module', geaendert: '2026-11-01T10:00:00Z', werkbank: true }]),
    G('schnitte', 1, [{ id: 'c1', name: 'Kick cut', scheiben: 8, beats: 4 }]),
  ],
};
const STOEBERN = { gesamt: 12, seite: 0, limit: 100, treffer: [T('aaa'), T('bbb'), T('ccc')] };

let wurzel, w, audios, dokListener = [];
class FakeAudio {
  constructor(url) { this.url = url; this.pausiert = false; audios.push(this); }
  addEventListener() {}
  play() { return Promise.resolve(); }
  pause() { this.pausiert = true; }
}
function aufbau({ antworten = {}, aktuell = { slug: null }, speicher = {}, suchMs = 5 } = {}) {
  audios = []; dokListener = [];   // the keydown listeners the shelf puts on the document
  document.addEventListener = (art, f) => { if (art === 'keydown') dokListener.push(f); };
  installiere({ speicher, antworten: {
    'GET /proj/aktuell': { j: aktuell }, 'GET /proj/liste': { j: [] }, 'GET /proj/werkbank/vorlagen': { j: { vorlagen: [] } },
    'GET /suche': { j: ANTWORT }, 'GET /stoebern': { j: STOEBERN }, 'GET /stoebern/baum': { j: { facetten: { instrument: [{ wert: 'kick', n: 5 }] } } },
    'GET /stoebern/quellen': { j: { quellen: [] } }, 'GET /sampler/quellen': { j: { loops: [], module: [] } }, 'GET /sampler/liste': { j: { schnitte: [] } },
    'GET /sampler/instrumente': { j: { instrumente: [] } }, 'GET /sampler/dateien': { j: { wurzeln: [] } },
    'POST /kollektionen/favourites/posten': { j: {} }, 'POST /kollektionen/recently-used/posten': { j: {} }, ...antworten } });
  delete globalThis.Audio;
  wurzel = document.createElement('section');
  w = bindeWerkbank({ post, wurzel, frage: () => true });
  w.ctx.Audio = FakeAudio;
  if (suchMs !== null) w.ctx.suchMs = suchMs;
}
const regal = () => wurzel.querySelector('[data-w="regal"]');
const wd = (n) => regal().querySelectorAll(`[data-w="${n}"]`);
const host = () => wd('suche-host')[0];
const tabHost = () => regal().querySelector('.w-karten');
const feld = () => wd('suche-feld')[0];
const meldung = () => wurzel.querySelector('[data-w="meldung"]').textContent;
const zeige = async (o) => { aufbau(o); w.zeige(); await ruhe(); };
const tippe = async (text, warteMs = 40) => { const f = feld(); f.value = text; f.dispatch('input'); await warte(warteMs); await ruhe(); };
const tabAn = () => [...regal().querySelectorAll('.w-tab')].filter((t) => t.classList.contains('on')).map((t) => t.textContent);
const gruppe = (art) => wd('suche-gruppe').find((g) => g.getAttribute('data-art') === art);
const alle = (art) => wd('suche-alle').find((b) => b.getAttribute('data-art') === art);

test('the field sits above the tabs; the debounce is 250 ms', async () => {
  await zeige();
  const kinder = regal().children;
  assert.equal(kinder[0].className, 'w-such-kopf');
  assert.ok(kinder[0].querySelector('[data-w="suche-feld"]'));
  assert.ok(kinder[1].querySelector('.w-tab'), 'the tabs come after it');
  assert.equal(SUCH_MS, 250);
});

test('typing asks GET /suche once after the pause, with the words, passt=0 and je=5', async () => {
  await zeige({ suchMs: null });
  feld().value = 'kick 909'; feld().dispatch('input'); feld().value = 'kick 909 '; feld().dispatch('input');
  await warte(100);
  assert.equal(GETS('/suche').length, 0, 'not before 250 ms');
  await warte(300); await ruhe();
  assert.deepEqual(GETS('/suche').map((a) => a.url), ['/suche?q=kick%20909&passt=0&je=5']);
});

test('while the field has text the shelf shows the groups instead of the tab: heading with the count, the rows of the tabs, show all only where more exist', async () => {
  await zeige();
  await tippe('kick');
  assert.equal(host().hasAttribute('hidden'), false);
  assert.equal(tabHost().hasAttribute('hidden'), true);
  assert.deepEqual(wd('suche-gruppe').map((g) => g.getAttribute('data-art')), ['samples', 'loops', 'instrumente', 'geraete', 'presets', 'module', 'schnitte']);
  assert.deepEqual(wd('suche-titel').map((t) => t.textContent), ['SAMPLES 12', 'LOOPS 1', 'INSTRUMENTS 2', 'DEVICES 1', 'PRESETS 1', 'MODULES 1', 'CUTS 1']);
  assert.equal(gruppe('samples').querySelectorAll('[data-w="katalog-datei"]').length, 2, 'catalogue rows are the rows of the SAMPLES tab');
  assert.equal(gruppe('loops').querySelectorAll('[data-w="katalog-datei"]').length, 1);
  assert.equal(gruppe('instrumente').querySelectorAll('[data-w="instrument-zeile"]').length, 1, 'a stored instrument has the row of the INSTRUMENTS tab');
  assert.equal(gruppe('instrumente').querySelectorAll('[data-w="suche-info"]').length, 1, 'a Cypher Modular instrument has an info row');
  assert.equal(gruppe('geraete').querySelectorAll('[data-w="suche-info"]').length, 1);
  assert.equal(gruppe('presets').querySelectorAll('[data-w="suche-info"]').length, 1);
  assert.ok(gruppe('module').querySelector('.w-karte'), 'a module is the card of the MODULES tab');
  assert.equal(gruppe('schnitte').querySelectorAll('[data-w="schnitt-spur"]').length, 1, 'a cut is the card of the CUTS tab');
  assert.deepEqual(wd('suche-alle').map((b) => b.getAttribute('data-art')), ['samples'], 'only where the count is above the rows');
  assert.equal(alle('samples').textContent, 'show all 12');
});

test('clearing the field returns to the tab that was open; so does Escape; nothing is asked for an empty query', async () => {
  await zeige({ speicher: { 'djk-wb-regal-tab': 'cuts' } });
  assert.deepEqual(tabAn(), ['CUTS']);
  await tippe('kick');
  assert.equal(tabHost().hasAttribute('hidden'), true);
  const n = GETS('/suche').length;
  await tippe('');
  assert.equal(GETS('/suche').length, n, 'an empty query asks nothing');
  assert.equal(tabHost().hasAttribute('hidden'), false);
  assert.equal(host().hasAttribute('hidden'), true);
  assert.deepEqual(tabAn(), ['CUTS']);
  await tippe('kick');
  feld().dispatch('keydown', { key: 'Escape' }); await ruhe();
  assert.equal(feld().value, '');
  assert.equal(tabHost().hasAttribute('hidden'), false);
  assert.deepEqual(tabAn(), ['CUTS']);
  assert.equal(host().children.length, 0, 'the groups are gone');
});

test('two queries in flight: the answer of the first arrives after the second and the page shows the second', async () => {
  await zeige();
  const echt = globalThis.fetch, offen = [];
  globalThis.fetch = (url, opt) => (String(url).startsWith('/suche') ? new Promise((ok) => offen.push({ url: String(url), ok })) : echt(url, opt));
  const antworte = (e, art, titel) => e.ok({ status: 200, ok: true, json: async () => ({ q: 'x', passt: null, gruppen: [G(art, 1, [{ id: 'c', name: titel, scheiben: 2, beats: 2 }])] }) });
  await tippe('first'); await tippe('second');
  assert.equal(offen.length, 2);
  antworte(offen[1], 'schnitte', 'SECOND cut'); await ruhe();
  antworte(offen[0], 'schnitte', 'FIRST cut'); await ruhe();
  const text = host().textContent;
  assert.ok(text.includes('SECOND cut'), text);
  assert.ok(!text.includes('FIRST cut'), 'the older answer did not overwrite the newer one');
  globalThis.fetch = echt;
});

test('an answer that arrives after the field was cleared draws nothing', async () => {
  await zeige();
  const echt = globalThis.fetch, offen = [];
  globalThis.fetch = (url, opt) => (String(url).startsWith('/suche') ? new Promise((ok) => offen.push({ ok })) : echt(url, opt));
  await tippe('kick'); await tippe('');
  offen[0].ok({ status: 200, ok: true, json: async () => ANTWORT }); await ruhe();
  assert.equal(host().children.length, 0);
  assert.equal(tabHost().hasAttribute('hidden'), false);
  globalThis.fetch = echt;
});

test('show all of SAMPLES lands on the SAMPLES tab, LIBRARY mode, the query in its own search and the same hits on top', async () => {
  await zeige({ speicher: { 'djk-wb-regal-tab': 'cuts', 'djk-wb-regal-katalog': JSON.stringify({ modus: 'ordner', instrument: 'snare' }) } });
  await tippe('kick');
  const erste = gruppe('samples').querySelectorAll('[data-w="katalog-datei"]').map((r) => r.getAttribute('data-sha'));
  assert.deepEqual(erste, ['aaa', 'bbb']);
  alle('samples').dispatch('click'); await ruhe(); await ruhe();
  assert.deepEqual(tabAn(), ['SAMPLES']);
  assert.equal(host().hasAttribute('hidden'), true, 'the search view is left');
  assert.equal(feld().value, '', 'the query moved into the tab');
  const f = wd('katalog-suche')[0];
  assert.equal(f.value, 'kick');
  const url = GETS('/stoebern?').at(-1).url;
  assert.ok(url.includes('text=kick'), url);
  assert.ok(!url.includes('feld=instrument'), 'no instrument filter hides hits of the search');
  assert.equal(GETS('/sampler/dateien').length, 0, 'LIBRARY, not FOLDERS');
  const oben = wd('katalog-datei').map((r) => r.getAttribute('data-sha'));
  assert.deepEqual(oben.slice(0, erste.length), erste, 'the same hits are on top');
});

test('show all of SAMPLES while SAMPLES is the open tab loads the query into its search at once', async () => {
  await zeige({ speicher: { 'djk-wb-regal-tab': 'samples' } });
  await tippe('kick');
  alle('samples').dispatch('click'); await ruhe(); await ruhe();
  assert.deepEqual(tabAn(), ['SAMPLES']);
  assert.equal(wd('katalog-suche')[0].value, 'kick');
  assert.ok(GETS('/stoebern?').at(-1).url.includes('text=kick'));
});

test('show all of a kind without a tab search opens the group in place with up to 50 hits', async () => {
  const viele = Array.from({ length: 7 }, (_, i) => ({ id: `c${i}`, name: `Kick cut ${i}`, scheiben: 4, beats: 4 }));
  await zeige({ antworten: { 'GET /suche': () => {
    const u = attrappe.anrufe.at(-1).url;
    return { j: u.includes('arten=instrumente') ? { q: 'kick', passt: null, gruppen: [G('instrumente', 7, viele.map((v, i) => ({ id: `i${i}`, name: `Piano ${i}`, noten: 1, zonen: 1, bytes: 10, erstellt: '2026-11-01T10:00:00Z' })))] }
      : { q: 'kick', passt: null, gruppen: [G('instrumente', 7, [{ id: 'i0', name: 'Piano 0', noten: 1, zonen: 1, bytes: 10, erstellt: '2026-11-01T10:00:00Z' }])] } };
  } } });
  await tippe('kick');
  alle('instrumente').dispatch('click'); await ruhe();
  assert.ok(GETS('/suche').at(-1).url.endsWith('&arten=instrumente&je=50'), GETS('/suche').at(-1).url);
  assert.equal(gruppe('instrumente').querySelectorAll('[data-w="instrument-zeile"]').length, 7);
  assert.equal(wd('suche-alle').length, 0);
  assert.equal(host().hasAttribute('hidden'), false, 'still searching');
});

test('a star from the search view works as in the tab: it posts the favourite and flips', async () => {
  await zeige();
  await tippe('kick');
  const stern = wd('katalog-datei')[0].querySelector('[data-w="stern"]');
  stern.dispatch('click'); await ruhe();
  assert.deepEqual(POSTS('/kollektionen/favourites/posten')[0].koerper, { hinzu: [{ art: 'sample', sha: 'aaa' }] });
  assert.equal(stern.getAttribute('aria-pressed'), 'true');
  assert.equal(audios.length, 0, 'the click does not preview');
});

test('TO TRACK from the search view: a sample posts its sha and the project is taken over; a click on the row previews it', async () => {
  const neu = { ...modul('M'), rev: 4, spuren: [...modul('M').spuren, { id: 's2', name: 'a', art: 'instrument', clips: [] }] };
  await zeige({ aktuell: MODUL_AKTUELL, antworten: { 'POST /sampler/datei/spur': { j: { rev: 4, projekt: neu, spur_id: 's2', text: 'Tone aaa' } } } });
  await tippe('kick');
  const knopf = wd('katalog-spur')[0];
  assert.equal(knopf.disabled, false, 'a module is open');
  wd('katalog-datei')[0].dispatch('click');
  assert.equal(audios.length, 1); assert.ok(audios[0].url.includes('/sampler/datei/hoer?sha=aaa'));
  assert.equal(wd('katalog-datei')[0].classList.contains('spielt'), true, 'the mark follows the preview in the search view');
  knopf.dispatch('click'); await ruhe();
  assert.deepEqual(POSTS('/sampler/datei/spur')[0].koerper, { sha: 'aaa' });
  assert.equal(w.ctx.st.wahl, 's2');
  assert.ok(meldung().includes('Tone aaa'));
});

test('TO TRACK in the search view is disabled while no module is open', async () => {
  await zeige();
  await tippe('kick');
  assert.equal(wd('katalog-spur')[0].disabled, true);
  assert.equal(wd('schnitt-spur')[0].disabled, true);
});

test('the actions of a cut, a stored instrument and a module work from the search view', async () => {
  const neu = { ...modul('M'), rev: 4 };
  await zeige({ aktuell: MODUL_AKTUELL, antworten: {
    'POST /sampler/spur': { j: { rev: 4, projekt: neu, spur_id: 's1' } }, 'POST /sampler/instrument/spur': { j: { rev: 4, projekt: neu, spur_id: 's1' } },
    'POST /proj/oeffnen': { j: { slug: 'k1', projekt: modul('Kick module') } },
  } });
  await tippe('kick');
  wd('schnitt-spur')[0].dispatch('click'); await ruhe();
  assert.deepEqual(POSTS('/sampler/spur')[0].koerper, { id: 'c1' });
  wd('instrument-spur')[0].dispatch('click'); await ruhe();
  assert.deepEqual(POSTS('/sampler/instrument/spur')[0].koerper, { id: 'i1' });
  gruppe('module').querySelector('.w-karte').dispatch('click'); await ruhe();
  assert.deepEqual(POSTS('/proj/oeffnen')[0].koerper, { slug: 'k1' });
});

test('FITS is off without a module; with one it adds passt=1 and asks again; the choice is remembered', async () => {
  await zeige();
  const knopf = wd('suche-passt')[0];
  assert.equal(knopf.disabled, true);
  assert.equal(knopf.getAttribute('title'), SUCHE_TEXT.passtKein);
  await zeige({ aktuell: MODUL_AKTUELL });
  const k2 = wd('suche-passt')[0];
  assert.equal(k2.disabled, false);
  await tippe('kick');
  k2.dispatch('click'); await ruhe();
  assert.ok(GETS('/suche').at(-1).url.includes('passt=1'), GETS('/suche').at(-1).url);
  assert.equal(k2.getAttribute('aria-pressed'), 'true');
  assert.equal(localStorage.getItem('djk-wb-regal-passt'), '1');
  k2.dispatch('click'); await ruhe();
  assert.ok(GETS('/suche').at(-1).url.includes('passt=0'));
});

test('a group that failed shows its reason and no rows; the other groups are drawn', async () => {
  await zeige({ antworten: { 'GET /suche': { j: { q: 'k', passt: null, gruppen: [G('samples', 0, [], { fehler: 'katalog_fehlt' }), G('presets', 1, [{ herkunft: 'nutzer', geraet: 'surge', slug: 'p', name: 'P', tags: [] }], {}), G('geraete', 0, [], { fehler: 'suche_quelle' })] } } } });
  await tippe('k');
  assert.equal(gruppe('samples').querySelectorAll('[data-w="katalog-datei"]').length, 0);
  assert.equal(gruppe('samples').querySelector('[data-w="suche-fehler"]').textContent, SUCHE_TEXT.katalogFehlt);
  assert.equal(gruppe('geraete').querySelector('[data-w="suche-fehler"]').textContent, SUCHE_TEXT.quelleFehlt);
  assert.equal(gruppe('presets').querySelectorAll('[data-w="suche-info"]').length, 1);
  assert.equal(wd('suche-alle').length, 0, 'no show all for a failed group');
});

test('an answer that is not a search answer shows one line, not an exception', async () => {
  await zeige({ antworten: { 'GET /suche': { code: 400, j: { fehler: 'argument_ungueltig' } } } });
  await tippe('kick');
  assert.ok(host().textContent.includes(SUCHE_TEXT.netz));
});

test('the / key focuses the field when no input has the focus, and not when one has', async () => {
  await zeige();
  const taste = (ziel) => { let verhindert = false; const r = w.ctx.suche.taste({ key: '/', target: ziel, preventDefault() { verhindert = true; } }); return { r, verhindert }; };
  attrappe.aktiv = null;
  const a = taste(wurzel);
  assert.equal(a.r, true); assert.equal(a.verhindert, true);
  assert.equal(attrappe.aktiv, feld());
  const andere = wd('katalog-suche')[0] ?? document.createElement('input');
  attrappe.aktiv = null;
  const b = taste(document.createElement('input'));
  assert.equal(b.r, false); assert.equal(b.verhindert, false, 'a slash typed into an input stays a slash');
  void andere;
  const c = w.ctx.suche.taste({ key: 'k', target: wurzel, preventDefault() {} });
  assert.equal(c, false);
  assert.equal(w.ctx.suche.taste({ key: '/', ctrlKey: true, target: wurzel, preventDefault() {} }), false);
});

test('a row of the search view follows the open module: its buttons enable when one opens', async () => {
  await zeige();
  await tippe('kick');
  assert.equal(wd('katalog-spur')[0].disabled, true);
  w.ctx.uebernimm('m', modul('M'));
  assert.equal(wd('schnitt-spur')[0].disabled, false);
});

// ---- review findings: FITS state, in-place show all, the playing mark ----
// holds the /suche requests open; `beantworte(f)` answers every open one with f(url)
const haengend = () => {
  const echt = globalThis.fetch, offen = [];
  globalThis.fetch = (url, opt) => (String(url).startsWith('/suche') ? new Promise((ok) => offen.push({ url: String(url), ok })) : echt(url, opt));
  return {
    offen,
    beantworte: (f) => { for (const e of offen.splice(0)) e.ok({ status: 200, ok: true, json: async () => f(e.url) }); },
    fehler: () => { for (const e of offen.splice(0)) e.ok({ status: 500, ok: false, json: async () => ({ fehler: 'x' }) }); },
    ende: () => { globalThis.fetch = echt; },
  };
};

test('FITS remembered as on but no module open: the button is not pressed and the query says passt=0; a module opening turns it on and asks again', async () => {
  await zeige({ speicher: { 'djk-wb-regal-passt': '1' } });
  const k = wd('suche-passt')[0];
  assert.equal(k.disabled, true);
  assert.equal(k.getAttribute('aria-pressed'), 'false');
  assert.equal(k.classList.contains('an'), false);
  await tippe('kick');
  assert.ok(GETS('/suche').at(-1).url.includes('passt=0'), GETS('/suche').at(-1).url);
  w.ctx.uebernimm('m', modul('M')); await ruhe(); await ruhe();
  assert.equal(k.getAttribute('aria-pressed'), 'true');
  assert.equal(k.disabled, false);
  assert.ok(GETS('/suche').at(-1).url.includes('passt=1'), 'the hits follow the open module: ' + GETS('/suche').at(-1).url);
});

test('show all of SAMPLES while FITS is on opens the group in place (the tab cannot carry FITS), with passt=1', async () => {
  await zeige({ aktuell: MODUL_AKTUELL, speicher: { 'djk-wb-regal-passt': '1', 'djk-wb-regal-tab': 'cuts' },
    antworten: { 'GET /suche': () => { const u = attrappe.anrufe.at(-1).url; return { j: { q: 'kick', passt: null, gruppen: [G('samples', 12, u.includes('arten=') ? Array.from({ length: 12 }, (_, i) => T(`s${i}`)) : [T('s0'), T('s1')])] } }; } } });
  await tippe('kick');
  alle('samples').dispatch('click'); await ruhe(); await ruhe();
  assert.deepEqual(tabAn(), ['CUTS'], 'the tab did not change');
  assert.equal(host().hasAttribute('hidden'), false, 'still in the search view');
  assert.equal(feld().value, 'kick');
  const u = GETS('/suche').filter((a) => a.url.includes('arten=samples')).at(-1).url;
  assert.ok(u.includes('passt=1') && u.endsWith('&arten=samples&je=50'), u);
  assert.equal(gruppe('samples').querySelectorAll('[data-w="katalog-datei"]').length, 12);
  assert.equal(GETS('/stoebern?').length, 0, 'the tab was not asked');
});

test('the playing mark of a running preview survives a redraw of the search view', async () => {
  await zeige({ aktuell: MODUL_AKTUELL });
  await tippe('kick');
  wd('katalog-datei')[0].dispatch('click');
  assert.equal(wd('katalog-datei')[0].classList.contains('spielt'), true);
  wd('suche-passt')[0].dispatch('click'); await ruhe(); await ruhe();   // redraws all rows
  assert.equal(wd('katalog-datei')[0].classList.contains('spielt'), true, 'the new row of the same sample is marked');
  assert.equal(wd('katalog-datei')[1].classList.contains('spielt'), false);
  assert.equal(audios[0].pausiert, false, 'the preview itself runs on');
});

// ---- review findings: expansions, concurrent loads, retry ----
const VIELE = Array.from({ length: 7 }, (_, i) => ({ id: `i${i}`, name: `Piano ${i}`, noten: 1, zonen: 1, bytes: 10, erstellt: '2026-11-01T10:00:00Z' }));
const instrAntwort = () => { const u = attrappe.anrufe.at(-1).url; return { j: { q: 'kick', passt: null, gruppen: [G('instrumente', 7, u.includes('arten=') ? VIELE : VIELE.slice(0, 1))] } }; };
const instrZeilen = () => gruppe('instrumente').querySelectorAll('[data-w="instrument-zeile"]').length;

test('an expanded group stays expanded when the same query draws again (module change, FITS); a new query collapses it', async () => {
  await zeige({ aktuell: MODUL_AKTUELL, antworten: { 'GET /suche': instrAntwort } });
  await tippe('kick');
  alle('instrumente').dispatch('click'); await ruhe();
  assert.equal(instrZeilen(), 7);
  w.ctx.suche.neu(); await ruhe(); await ruhe();
  assert.equal(instrZeilen(), 7, 'still 7 after neu()');
  assert.equal(wd('suche-alle').length, 0);
  wd('suche-passt')[0].dispatch('click'); await ruhe(); await ruhe();
  assert.equal(instrZeilen(), 7, 'still 7 after the FITS toggle');
  await tippe('kick drum');
  assert.equal(instrZeilen(), 1, 'a new query starts with five');
  assert.equal(wd('suche-alle').length, 1);
});

test('show all while a load is on its way: neither reply is lost, nothing stays on "Searching"', async () => {
  await zeige({ aktuell: MODUL_AKTUELL, antworten: { 'GET /suche': instrAntwort } });
  await tippe('kick');
  const h = haengend();
  const antwort = (u) => ({ q: 'kick', passt: null, gruppen: [G('samples', 9, [T(u.includes('passt=1') ? 'FIT' : 'old')]), G('instrumente', 7, u.includes('arten=instrumente') ? VIELE : VIELE.slice(0, 1))].filter((g) => !u.includes('arten=') || u.includes(`arten=${g.art}`)) });
  wd('suche-passt')[0].dispatch('click'); await ruhe();   // a load is open
  alle('instrumente').dispatch('click'); await ruhe();    // show all meanwhile
  h.beantworte(antwort); await ruhe(); await ruhe();
  h.beantworte(antwort); await ruhe(); await ruhe();
  h.ende();
  assert.deepEqual(gruppe('samples').querySelectorAll('[data-w="katalog-datei"]').map((r) => r.getAttribute('data-sha')), ['FIT'], 'the FITS answer is there');
  assert.equal(instrZeilen(), 7, 'and the group is open');
  assert.ok(!host().textContent.includes(SUCHE_TEXT.liest));
  assert.equal(h.offen.length, 0);
});

test('Enter on the same text after a failed search asks again; a failure of show all says so', async () => {
  await zeige({ antworten: { 'GET /suche': { code: 500, j: { fehler: 'x' } } } });
  await tippe('kick');
  assert.ok(host().textContent.includes(SUCHE_TEXT.netz));
  const n = GETS('/suche').length;
  attrappe.antworten['GET /suche'] = { j: ANTWORT };
  feld().dispatch('keydown', { key: 'Enter' }); await ruhe();
  assert.equal(GETS('/suche').length, n + 1, 'Enter retried');
  assert.ok(!host().textContent.includes(SUCHE_TEXT.netz));
  assert.ok(gruppe('samples'));
  feld().dispatch('keydown', { key: 'Enter' }); await ruhe();
  assert.equal(GETS('/suche').length, n + 1, 'a good answer is not asked for twice');
  attrappe.antworten['GET /suche'] = () => (attrappe.anrufe.at(-1).url.includes('arten=') ? { code: 500, j: { fehler: 'x' } } : instrAntwort());
  await tippe('kick two');
  alle('instrumente').dispatch('click'); await ruhe(); await ruhe();
  assert.ok(host().textContent.includes(SUCHE_TEXT.netz), 'show all failed: the same line as a failed search');
  assert.equal(instrZeilen(), 1, 'the hits already drawn stay');
});

// ---- review findings: keys, hostile names, redraw, malformed hits ----
// a key as the page sees it: every keydown listener of the document
const taste = (key, ziel, extra = {}) => { let verhindert = false; const ev = { key, target: ziel, preventDefault() { verhindert = true; }, stopPropagation() {}, ...extra }; for (const f of dokListener) f(ev); return verhindert; };

test('the shelf listens for keydown on the document: / focuses the field', async () => {
  await zeige();
  assert.ok(dokListener.length >= 1, 'a keydown listener is registered');
  attrappe.aktiv = null;
  assert.equal(taste('/', wurzel), true);
  assert.equal(attrappe.aktiv, feld());
});

test('/ stays a slash in a textarea, a contenteditable and a select', async () => {
  await zeige();
  const ta = document.createElement('textarea'), ce = document.createElement('div'), se = document.createElement('select');
  ce.isContentEditable = true;
  for (const z of [ta, ce, se]) {
    attrappe.aktiv = z;
    assert.equal(taste('/', z), false, z.tagName);
    assert.notEqual(attrappe.aktiv, feld());
  }
  attrappe.aktiv = ta;   // the target is the page but the focus sits in a text area
  assert.equal(taste('/', wurzel), false);
});

test('Escape clears the search while the focus is on a row button, and stops a running preview', async () => {
  await zeige({ speicher: { 'djk-wb-regal-tab': 'cuts' } });
  await tippe('kick');
  wd('katalog-datei')[0].dispatch('click');
  assert.equal(audios.length, 1);
  const stern = wd('katalog-datei')[0].querySelector('[data-w="stern"]');
  attrappe.aktiv = stern;
  assert.equal(taste('Escape', stern), true);
  assert.equal(feld().value, '');
  assert.equal(host().hasAttribute('hidden'), true);
  assert.equal(tabHost().hasAttribute('hidden'), false);
  assert.equal(audios[0].pausiert, true, 'the preview stopped');
});

test('Escape in the field stops a running preview', async () => {
  await zeige();
  await tippe('kick');
  wd('katalog-datei')[0].dispatch('click');
  feld().dispatch('keydown', { key: 'Escape' }); await ruhe();
  assert.equal(audios[0].pausiert, true);
});

test('Escape does nothing to the search while another text field outside the shelf has the focus, or when no search is shown', async () => {
  await zeige();
  assert.equal(taste('Escape', wurzel), false, 'no search view: the key is not taken');
  await tippe('kick');
  const fremd = document.createElement('input');
  attrappe.aktiv = fremd;
  assert.equal(taste('Escape', fremd), false);
  assert.equal(feld().value, 'kick');
  assert.equal(host().hasAttribute('hidden'), false);
  const draussen = document.createElement('button');   // a button elsewhere on the page
  attrappe.aktiv = draussen;
  assert.equal(taste('Escape', draussen), false);
  assert.equal(feld().value, 'kick');
});

test('a redraw while the focus is on a row button gives the focus back to the field; a focus elsewhere is left alone', async () => {
  await zeige({ aktuell: MODUL_AKTUELL });
  await tippe('kick');
  attrappe.aktiv = wd('katalog-spur')[0];
  w.ctx.suche.neu(); await ruhe(); await ruhe();
  assert.equal(attrappe.aktiv, feld());
  const fremd = document.createElement('input');
  attrappe.aktiv = fremd;
  w.ctx.suche.neu(); await ruhe(); await ruhe();
  assert.equal(attrappe.aktiv, fremd);
});

test('a hostile name is drawn as text in every kind of row', async () => {
  const bos = '<img src=x onerror=alert(1)>';
  await zeige({ antworten: { 'GET /suche': { j: { q: 'k', passt: null, gruppen: [
    G('samples', 1, [T('aaa', { name: bos })]), G('loops', 1, [T('lll', { name: bos, typ: 'loop', bpm: 120 })]),
    G('instrumente', 2, [{ id: 'i1', name: bos, noten: 1, zonen: 1, bytes: 10, erstellt: '2026-11-01T10:00:00Z' }, { name: bos, art: 'instrument', kategorie: bos }]),
    G('geraete', 1, [{ name: bos, art: 'effekt', kategorie: bos }]), G('presets', 1, [{ herkunft: 'werk', geraet: bos, slug: 'p', name: bos, tags: [bos] }]),
    G('module', 1, [{ slug: 'k1', name: bos, geaendert: '2026-11-01T10:00:00Z', werkbank: true }]), G('schnitte', 1, [{ id: 'c1', name: bos, scheiben: 8, beats: 4 }]),
  ] } } } });
  await tippe('k');
  assert.equal(host().querySelectorAll('img').length, 0, 'no element came out of a name');
  assert.ok(host().textContent.split(bos).length - 1 >= 7, 'every name is there as text');
});

test('after a redraw a click on the star or TO TRACK acts on the new hit, not the one that was there', async () => {
  const neu = { ...modul('M'), rev: 4, spuren: [...modul('M').spuren, { id: 's2', name: 'a', art: 'instrument', clips: [] }] };
  await zeige({ aktuell: MODUL_AKTUELL, antworten: { 'POST /sampler/datei/spur': { j: { rev: 4, projekt: neu, spur_id: 's2', text: 'ok' } } } });
  await tippe('kick');
  assert.equal(wd('katalog-datei')[0].getAttribute('data-sha'), 'aaa');
  attrappe.antworten['GET /suche'] = { j: { q: 'kick', passt: null, gruppen: [G('samples', 2, [T('zzz'), T('yyy')])] } };
  w.ctx.suche.neu(); await ruhe(); await ruhe();
  assert.equal(wd('katalog-datei')[0].getAttribute('data-sha'), 'zzz');
  wd('katalog-datei')[0].querySelector('[data-w="stern"]').dispatch('click'); await ruhe();
  assert.deepEqual(POSTS('/kollektionen/favourites/posten').at(-1).koerper, { hinzu: [{ art: 'sample', sha: 'zzz' }] });
  wd('katalog-spur')[0].dispatch('click'); await ruhe();
  assert.deepEqual(POSTS('/sampler/datei/spur').at(-1).koerper, { sha: 'zzz' });
});

test('a malformed group or hit draws one error line for that group; the others are drawn and the view does not stay on "Searching"', async () => {
  const kaputt = { j: { q: 'k', passt: null, gruppen: [
    { art: 'samples', name: 'Samples', treffer: [T('aaa')] },                       // no count
    G('loops', 1, [null]),                                                          // a hit that is not an object
    G('presets', 1, [{ herkunft: 'nutzer', geraet: 'surge', slug: 'p', name: 'P', tags: [] }]),
    null,
  ] } };
  await zeige({ antworten: { 'GET /suche': kaputt } });
  await tippe('k');
  assert.ok(!host().textContent.includes(SUCHE_TEXT.liest));
  assert.equal(gruppe('samples').querySelector('[data-w="suche-fehler"]').textContent, SUCHE_TEXT.quelleFehlt);
  assert.equal(gruppe('loops').querySelector('[data-w="suche-fehler"]').textContent, SUCHE_TEXT.quelleFehlt);
  assert.equal(gruppe('presets').querySelectorAll('[data-w="suche-info"]').length, 1);
  // the view is not stuck: the next query is answered and drawn
  attrappe.antworten['GET /suche'] = { j: ANTWORT };
  await tippe('kick');
  assert.equal(gruppe('samples').querySelectorAll('[data-w="katalog-datei"]').length, 2);
});
