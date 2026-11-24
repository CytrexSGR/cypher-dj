// FIND SOUND window (public/werkbank/sound_runde.js): the top bar button, the round it starts for the selected Baukasten track, the four places,
// PICK, NEW NEIGHBOURS, BACK, the path and the polling, run through bindeWerkbank against the DOM stand-in (the routes answer from fixtures).
import test, { mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

installiere();
const { bindeWerkbank } = await import('../public/werkbank/werkbank.js');

const HIER = path.dirname(fileURLToPath(import.meta.url));
const LAGE = JSON.parse(fs.readFileSync(path.join(HIER, 'fixtures', 'klang_runde_lage.json'), 'utf8'));
const lage = (aendere) => { const a = structuredClone(LAGE); aendere?.(a); return a; };
const post = (w, k) => fetch(w, { method: 'POST', body: JSON.stringify(k) });
const ruhe = async () => { for (let i = 0; i < 12; i++) await new Promise((ok) => setImmediate(ok)); };
const modul = (rev = 3) => ({
  name: 'M', rev, werkbank: { schema: 1 }, tempo_bpm: 130, taktart: [4, 4], loop: { an: true, von_beat: 0, bis_beat: 16 }, master: { fader_db: 0, inserts: [] },
  spuren: [
    { id: 's1', nr: 1, name: 'Bass', art: 'instrument', farbe: '#e0a33e', clips: [], geraet: { art: 'intern', name: 'bk', graph: 'acid', parameter: {} } },
    { id: 's2', nr: 2, name: 'Keys', art: 'instrument', farbe: '#3b8fe0', clips: [], geraet: { art: 'intern', name: 'sampler' } },
  ],
  returns: [],
});
const VGL = (platz, klingt = 'A') => ({ an: platz !== null, platz, klingt, ab_beat: platz ? 8 : null });
const ANRUFE = (methode, url) => attrappe.anrufe.filter((a) => a.methode === methode && a.url === url);
const RUNDEN = () => ANRUFE('POST', '/proj/klang/runde');

let wurzel, w, zustand;   // zustand: what GET /proj/klang/runde answers (null = 404)
// Every window a test builds is closed after the test (the real close button, so the window ends its round and clears its polling timers). A window that
// stays open keeps its real 400 ms / 2 s timer: it fires inside a LATER test, issues its GET to the call log of that test, and its next poll lands on the
// mocked clock of that test (measured 2026-11-18: window 4, built by the measuring test, polled during 'closing the window' once the file had run for 400 ms).
const gebaut = [];
afterEach(() => { for (const x of gebaut.splice(0)) x.querySelectorAll('[data-w="fenster-zu"]').forEach((b) => b.dispatch('click')); });
const $w = (n) => wurzel.querySelector(`[data-w="${n}"]`);
function aufbau({ start = lage(), speicher = {}, plan = { weg: 'proj', rev: 3, label: 'Find sound: brighter · Cutoff 420 → 610', befehle: [{ befehl: 'geraet_param_setzen' }] }, antworten = {} } = {}) {
  zustand = start;
  installiere({ speicher, antworten: {
    'GET /proj/aktuell': { j: { slug: 'm', projekt: modul() } }, 'GET /proj/liste': { j: [] }, 'GET /proj/werkbank/vorlagen': { j: { vorlagen: [] } },
    'GET /graphen': { j: { graphen: [] } }, 'GET /proj/kits': { j: { kits: [] } },
    'POST /proj/klang/runde': (k) => ({ j: { ...(zustand ?? lage()), schritt: k.schritt } }),
    'GET /proj/klang/runde': () => (zustand ? { j: zustand } : { code: 404, j: { grund: 'keine_runde', text: 'There is no round.' } }),
    'POST /proj/klang/hoeren': (k) => ({ j: { ...(zustand ?? lage()), aktiv: k.platz, vergleich: VGL(k.vergleich ? k.platz : null, k.platz) } }),
    'POST /proj/klang/waehlen': { j: plan }, 'POST /proj/klang/zurueck': { j: plan }, 'POST /proj/klang/ende': { j: { ok: true } }, ...antworten } });
  wurzel = document.createElement('section');
  w = bindeWerkbank({ post, wurzel, frage: () => true });
  gebaut.push(wurzel);
}
const oeffne = async () => { $w('runde-auf').dispatch('click'); await ruhe(); };
const start = async (opt) => { aufbau(opt); w.zeige(); await ruhe(); await oeffne(); };
const fenster = () => wurzel.querySelectorAll('[data-w="fenster"]');
const text = (n) => $w(n).textContent;

test('FIND SOUND sits in the top bar after ANALYZE and opens one window', async () => {
  await start();
  const kinder = $w('kopf').elemente.map((e) => e.getAttribute('data-w'));
  assert.ok(kinder.indexOf('analyse-auf') >= 0 && kinder.indexOf('runde-auf') === kinder.indexOf('analyse-auf') + 1, kinder.join());
  assert.equal(text('runde-auf'), 'FIND SOUND');
  assert.equal(fenster().length, 1);
  assert.equal(fenster()[0].getAttribute('data-fenster-id'), 'runde');
  await oeffne();
  assert.equal(fenster().length, 1);
});

test('opening starts a round for the selected Cypher Modular track with the remembered step size', async () => {
  await start({ speicher: { 'runde.schritt': 'grob' } });
  assert.deepEqual(RUNDEN().map((a) => a.koerper), [{ spur_id: 's1', schritt: 'grob' }]);
  assert.equal($w('runde-schritt').value, 'grob');
  assert.deepEqual($w('runde-schritt').querySelectorAll('option').map((o) => [o.value, o.textContent]), [['fein', 'subtle'], ['normal', 'clear'], ['grob', 'strong']]);
  assert.match($w('runde-schritt').title, /audible/);
  $w('runde-schritt').value = 'fein'; $w('runde-schritt').dispatch('change'); await ruhe();
  assert.deepEqual(RUNDEN().at(-1).koerper, { spur_id: 's1', schritt: 'fein' });
  assert.equal(localStorage.getItem('runde.schritt'), 'fein');
});

test('places, level difference, status and path are drawn from the state', async () => {
  await start();
  assert.match(text('runde-kopf'), /Bass/); assert.match(text('runde-kopf'), /acid/);
  assert.match(text('runde-platz-B'), /^B/);
  assert.match(text('runde-platz-B'), /brighter · Cutoff 420 → 610/);
  assert.match(text('runde-platz-B'), /\+1\.2 dB/);
  assert.doesNotMatch(text('runde-platz-C'), /dB/, 'a difference below 0.5 dB is not shown');
  assert.match(text('runde-platz-D'), /-0\.8 dB/);
  assert.equal($w('runde-platz-A').getAttribute('aria-pressed'), 'true');
  assert.equal($w('runde-platz-B').getAttribute('aria-pressed'), 'false');
  assert.equal(text('runde-stand'), '3 neighbours found');
  const ketten = $w('runde-weg').querySelectorAll('[data-w="runde-knoten"]');
  assert.deepEqual(ketten.map((k) => k.textContent), ['start +1', 'brighter · Cutoff 420 → 610']);
});

test('a place that is not there yet says measuring while the round measures, and a dash after', async () => {
  await start({ start: lage((a) => { a.zustand = 'misst'; a.plaetze = a.plaetze.slice(0, 2); a.fortschritt = { gemessen: 5, hoechstens: 16 }; }) });
  assert.equal(text('runde-stand'), 'measuring 5 of 16');
  assert.match(text('runde-platz-C'), /measuring…/);
  assert.equal($w('runde-platz-C').disabled, true);
  zustand = lage((a) => { a.plaetze = a.plaetze.slice(0, 2); });
  w.ctx.uebernimm('m', modul(4)); await ruhe();
  assert.match(text('runde-platz-C'), /–/);
  assert.equal(text('runde-stand'), '1 neighbour found');
});

test('no audible neighbour is said, and a failed round shows its text', async () => {
  await start({ start: lage((a) => { a.plaetze = a.plaetze.slice(0, 1); }) });
  assert.equal(text('runde-stand'), 'no audible neighbour at this step size');
  await start({ start: lage((a) => { a.zustand = 'fehler'; a.grund = 'spur_still'; a.text = 'The track is silent.'; a.plaetze = []; }) });
  assert.equal(text('runde-stand'), 'The track is silent.');
  assert.equal($w('runde-waehlen').disabled, true);
  await start({ start: lage((a) => { a.plaetze = a.plaetze.slice(0, 1); a.hinweis = 'no knob of this sound makes an audible difference on this pattern'; }) });
  assert.equal(text('runde-stand'), 'no knob of this sound makes an audible difference on this pattern');
});

test('a place at the range end shows its marker in the line', async () => {
  await start({ start: lage((a) => { a.plaetze[1] = { ...a.plaetze[1], anschlag: true, text: `${a.plaetze[1].text} · max` }; }) });
  assert.match(text('runde-platz-B'), / · max/);
});

test('a click on B listens to B and marks it; keys 1 to 4 do the same', async () => {
  await start();
  $w('runde-platz-B').dispatch('click'); await ruhe();
  assert.deepEqual(ANRUFE('POST', '/proj/klang/hoeren').map((a) => a.koerper), [{ platz: 'B', runde: 3 }]);
  assert.equal($w('runde-platz-B').getAttribute('aria-pressed'), 'true');
  assert.equal($w('runde-platz-A').getAttribute('aria-pressed'), 'false');
  $w('runde-koerper').dispatch('keydown', { key: '3' }); await ruhe();
  assert.deepEqual(ANRUFE('POST', '/proj/klang/hoeren').at(-1).koerper, { platz: 'C', runde: 3 });
  $w('runde-koerper').dispatch('keydown', { key: '1' }); await ruhe();
  assert.deepEqual(ANRUFE('POST', '/proj/klang/hoeren').at(-1).koerper, { platz: 'A', runde: 3 });
});

test('PICK asks for the plan, writes it and starts the next round', async () => {
  await start();
  const geschrieben = [];
  w.ctx.aendere = async (label, befehle) => { geschrieben.push([label, befehle]); return true; };
  $w('runde-platz-B').dispatch('click'); await ruhe();
  $w('runde-waehlen').dispatch('click'); await ruhe();
  assert.deepEqual(ANRUFE('POST', '/proj/klang/waehlen').map((a) => a.koerper), [{ platz: 'B', runde: 3 }]);
  assert.deepEqual(geschrieben, [['Find sound: brighter · Cutoff 420 → 610', [{ befehl: 'geraet_param_setzen' }]]]);
  assert.equal(RUNDEN().length, 2, 'the next round');
});

test('a plan for another revision is not written, a new round starts', async () => {
  await start({ plan: { weg: 'proj', rev: 2, label: 'x', befehle: [] } });
  let n = 0;
  w.ctx.aendere = async () => { n += 1; return true; };
  $w('runde-platz-B').dispatch('click'); await ruhe();
  $w('runde-waehlen').dispatch('click'); await ruhe();
  assert.equal(n, 0);
  assert.equal(RUNDEN().length, 2);
});

test('PICK is disabled on A and BACK without a parent', async () => {
  await start({ start: lage((a) => { a.zurueck_moeglich = false; }) });
  assert.equal($w('runde-waehlen').disabled, true);
  assert.equal($w('runde-zurueck').disabled, true);
  $w('runde-platz-C').dispatch('click'); await ruhe();
  assert.equal($w('runde-waehlen').disabled, false);
  await start();
  assert.equal($w('runde-zurueck').disabled, false);
  assert.equal(text('runde-waehlen'), 'PICK'); assert.equal(text('runde-zurueck'), 'BACK'); assert.equal(text('runde-neu'), 'NEW NEIGHBOURS');
});

test('BACK asks for the plan, writes it and starts a round; a chip sends its node', async () => {
  await start();
  const geschrieben = [];
  w.ctx.aendere = async (label, befehle) => { geschrieben.push(label); return true; };
  $w('runde-zurueck').dispatch('click'); await ruhe();
  assert.deepEqual(ANRUFE('POST', '/proj/klang/zurueck').map((a) => a.koerper), [{ runde: 3 }]);
  assert.equal(geschrieben.length, 1); assert.equal(RUNDEN().length, 2);
  const ketten = $w('runde-weg').querySelectorAll('[data-w="runde-knoten"]');
  ketten.at(-1).dispatch('click'); await ruhe();
  assert.equal(ANRUFE('POST', '/proj/klang/zurueck').length, 1, 'the active chip sends nothing');
  const neu = $w('runde-weg').querySelectorAll('[data-w="runde-knoten"]');
  neu[0].dispatch('click'); await ruhe();
  assert.deepEqual(ANRUFE('POST', '/proj/klang/zurueck').at(-1).koerper, { knoten: 'n1', runde: 3 });
});

test('NEW NEIGHBOURS starts a round', async () => {
  await start();
  $w('runde-neu').dispatch('click'); await ruhe();
  assert.equal(RUNDEN().length, 2);
});

test('another kind of track shows the hint and ends the round', async () => {
  await start();
  w.ctx.waehle('s2'); await ruhe();
  assert.equal(text('runde-hinweis'), 'Select a track with a Cypher Modular instrument.');
  assert.equal(ANRUFE('POST', '/proj/klang/ende').length, 1);
  w.ctx.waehle('s2'); await ruhe();
  assert.equal(ANRUFE('POST', '/proj/klang/ende').length, 1, 'no round, nothing to end');
  w.ctx.waehle('s1'); await ruhe();
  assert.equal(RUNDEN().length, 2);
  assert.equal($w('runde-hinweis').hidden, true);
});

test('selecting the track the round already runs on does not restart it', async () => {
  await start();
  const n = RUNDEN().length;
  w.ctx.waehle('s1'); await ruhe();   // every click on the track card selects it again
  assert.equal(RUNDEN().length, n, 'the round keeps its places');
});

test('a start that is refused is not asked again by the polling', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await start({ start: null, antworten: { 'POST /proj/klang/runde': { code: 400, j: { fehler: 'argument_ungueltig', text: 'the graph has no knobs' } } } });
  const n = RUNDEN().length;
  assert.equal(text('runde-stand'), 'the graph has no knobs');
  for (let i = 0; i < 3; i++) { t.mock.timers.tick(2000); await ruhe(); }
  assert.equal(RUNDEN().length, n, 'the 404 of the polling does not start the refused round again');
});

test('a stale state restarts the round after 800 ms without another project event', async (t) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  await start();
  zustand = lage((a) => { a.zustand = 'veraltet'; });
  for (const rev of [4, 5]) { w.ctx.uebernimm('m', modul(rev)); await ruhe(); mock.timers.tick(300); }
  assert.equal(RUNDEN().length, 1);
  mock.timers.tick(800); await ruhe();
  assert.equal(RUNDEN().length, 2);
});

test('the active place is sent again after a project event', async () => {
  await start({ start: lage((a) => { a.aktiv = 'B'; }) });
  assert.equal(ANRUFE('POST', '/proj/klang/hoeren').length, 0);
  w.ctx.uebernimm('m', modul(4)); await ruhe();
  assert.deepEqual(ANRUFE('POST', '/proj/klang/hoeren').map((a) => a.koerper), [{ platz: 'B', runde: 3 }]);
});

test('polling every 400 ms while measuring, every 2 s when done; a 404 starts a round', async (t) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  await start({ start: lage((a) => { a.zustand = 'misst'; a.plaetze = a.plaetze.slice(0, 1); }) });
  const gets = () => ANRUFE('GET', '/proj/klang/runde').length;
  const g0 = gets();
  mock.timers.tick(400); await ruhe();
  assert.equal(gets(), g0 + 1, 'one read per 400 ms while measuring');
  zustand = lage();
  mock.timers.tick(400); await ruhe();
  const g1 = gets();
  assert.equal(text('runde-stand'), '3 neighbours found');
  mock.timers.tick(400); await ruhe();
  assert.equal(gets(), g1, 'not every 400 ms any more');
  mock.timers.tick(2000); await ruhe();
  assert.equal(gets(), g1 + 1, 'every 2 s');
  zustand = null;
  mock.timers.tick(2000); await ruhe();
  assert.equal(RUNDEN().length, 2, 'the round is gone on the server: a new one');
});

test('closing the window ends the round and stops the polling', async (t) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  await start(); await ruhe();
  const e0 = ANRUFE('POST', '/proj/klang/ende').length;
  $w('fenster-zu').dispatch('click'); await ruhe();
  assert.equal(ANRUFE('POST', '/proj/klang/ende').length, e0 + 1);
  const n = ANRUFE('GET', '/proj/klang/runde').length;
  mock.timers.tick(5000); await ruhe();
  assert.equal(ANRUFE('GET', '/proj/klang/runde').length, n);
});

test('a refusal shows its text and a stale round number starts a new round', async () => {
  await start({ antworten: { 'POST /proj/klang/hoeren': { code: 409, j: { grund: 'runde_veraltet', text: 'The round is out of date.' } } } });
  $w('runde-platz-B').dispatch('click'); await ruhe();
  assert.equal(RUNDEN().length, 2);
});

test('leaving the page sends the end of the round as a beacon', async () => {
  const gehoert = [], beacons = [];
  // installiere() assigns a no-op addEventListener: an accessor that ignores the assignment records the page listeners instead
  Object.defineProperty(globalThis, 'addEventListener', { configurable: true, get: () => (art, f) => gehoert.push([art, f]), set() {} });
  aufbau();
  Object.defineProperty(globalThis, 'addEventListener', { configurable: true, writable: true, value: () => {} });
  globalThis.navigator.sendBeacon = (url, daten) => { beacons.push([url, daten]); return true; };
  w.zeige(); await ruhe(); await oeffne();
  gehoert.filter(([a]) => a === 'pagehide').forEach(([, f]) => f());
  assert.deepEqual(beacons.map((b) => b[0]), ['/proj/klang/ende']);
  delete globalThis.navigator.sendBeacon;
});

test('COMPARE is disabled until a place B to D is selected, then sends hoeren with vergleich true and shows which of the two sounds', async () => {
  await start();
  assert.equal(text('runde-vergleich'), 'COMPARE');
  assert.equal($w('runde-vergleich').disabled, true);
  assert.equal($w('runde-vergleich').getAttribute('aria-pressed'), 'false');
  $w('runde-platz-B').dispatch('click'); await ruhe();
  assert.equal($w('runde-vergleich').disabled, false);
  $w('runde-vergleich').dispatch('click'); await ruhe();
  assert.deepEqual(ANRUFE('POST', '/proj/klang/hoeren').at(-1).koerper, { platz: 'B', runde: 3, vergleich: true });
  assert.equal($w('runde-vergleich').getAttribute('aria-pressed'), 'true');
  assert.equal(text('runde-klingt'), 'B sounding');
  assert.ok($w('runde-klingt').className.includes('w-runde-klingt'));
  assert.ok($w('runde-platz-B').className.includes('w-runde-aktiv'));
  assert.ok($w('runde-platz-B').className.includes('w-runde-gewaehlt'));
  zustand = lage((a) => { a.aktiv = 'A'; a.vergleich = VGL('B', 'A'); });
  w.ctx.uebernimm('m', modul(3)); await ruhe();   // any state read shows the other side
  $w('runde-vergleich').dispatch('click'); await ruhe();   // off
  assert.deepEqual(ANRUFE('POST', '/proj/klang/hoeren').at(-1).koerper, { platz: 'B', runde: 3 });
  assert.equal($w('runde-vergleich').getAttribute('aria-pressed'), 'false');
  assert.equal(text('runde-klingt'), '');
});

test('the key c toggles COMPARE', async () => {
  await start();
  $w('runde-koerper').dispatch('keydown', { key: 'c' }); await ruhe();
  assert.equal(ANRUFE('POST', '/proj/klang/hoeren').length, 0, 'no place selected: nothing');
  $w('runde-platz-C').dispatch('click'); await ruhe();
  $w('runde-koerper').dispatch('keydown', { key: 'c' }); await ruhe();
  assert.deepEqual(ANRUFE('POST', '/proj/klang/hoeren').at(-1).koerper, { platz: 'C', runde: 3, vergleich: true });
});

test('a click on another place keeps COMPARE, a click on A ends it', async () => {
  await start();
  $w('runde-platz-B').dispatch('click'); await ruhe();
  $w('runde-vergleich').dispatch('click'); await ruhe();
  $w('runde-platz-D').dispatch('click'); await ruhe();
  assert.deepEqual(ANRUFE('POST', '/proj/klang/hoeren').at(-1).koerper, { platz: 'D', runde: 3, vergleich: true });
  assert.equal($w('runde-vergleich').getAttribute('aria-pressed'), 'true');
  $w('runde-koerper').dispatch('keydown', { key: '3' }); await ruhe();
  assert.deepEqual(ANRUFE('POST', '/proj/klang/hoeren').at(-1).koerper, { platz: 'C', runde: 3, vergleich: true });
  $w('runde-platz-A').dispatch('click'); await ruhe();
  assert.deepEqual(ANRUFE('POST', '/proj/klang/hoeren').at(-1).koerper, { platz: 'A', runde: 3 });
  assert.equal($w('runde-vergleich').getAttribute('aria-pressed'), 'false');
});

test('PICK during COMPARE picks the selected place, not the one that sounds', async () => {
  await start();
  w.ctx.aendere = async () => true;
  $w('runde-platz-B').dispatch('click'); await ruhe();
  $w('runde-vergleich').dispatch('click'); await ruhe();
  zustand = lage((a) => { a.aktiv = 'A'; a.vergleich = VGL('B', 'A'); });
  w.ctx.uebernimm('m', modul(3)); await ruhe();
  assert.equal($w('runde-waehlen').disabled, false, 'A sounds, B is selected');
  $w('runde-waehlen').dispatch('click'); await ruhe();
  assert.deepEqual(ANRUFE('POST', '/proj/klang/waehlen').map((a) => a.koerper), [{ platz: 'B', runde: 3 }]);
});

test('a state read while COMPARE is on does not send a plain listen again; polling 400 ms while on, 2 s after', async (t) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  await start({ start: lage((a) => { a.aktiv = 'B'; a.vergleich = VGL('B', 'B'); }) });
  assert.equal($w('runde-vergleich').getAttribute('aria-pressed'), 'true', 'a COMPARE the hand started is shown');
  w.ctx.uebernimm('m', modul(4)); await ruhe();
  assert.equal(ANRUFE('POST', '/proj/klang/hoeren').length, 0, 'a plain listen would end COMPARE');
  const gets = () => ANRUFE('GET', '/proj/klang/runde').length;
  const g0 = gets();
  mock.timers.tick(400); await ruhe();
  assert.equal(gets(), g0 + 1);
  zustand = lage((a) => { a.aktiv = 'A'; a.vergleich = VGL('B', 'A'); });
  mock.timers.tick(400); await ruhe();
  assert.equal(text('runde-klingt'), 'A sounding');
  assert.equal(gets(), g0 + 2);
  zustand = lage((a) => { a.aktiv = 'A'; });
  mock.timers.tick(400); await ruhe();
  const g1 = gets();
  mock.timers.tick(400); await ruhe();
  assert.equal(gets(), g1, 'every 2 s again');
  mock.timers.tick(2000); await ruhe();
  assert.equal(gets(), g1 + 1);
});

test('the server ending COMPARE switches the button off and says so once', async (t) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  await start({ start: lage((a) => { a.aktiv = 'B'; a.vergleich = VGL('B', 'B'); }) });
  assert.equal($w('runde-vergleich').getAttribute('aria-pressed'), 'true');
  zustand = lage((a) => { a.aktiv = 'A'; });
  mock.timers.tick(400); await ruhe();
  assert.equal($w('runde-vergleich').getAttribute('aria-pressed'), 'false');
  assert.equal(text('runde-klingt'), '');
  assert.match(text('runde-stand'), /COMPARE ended/);
  mock.timers.tick(2000); await ruhe();
  assert.doesNotMatch(text('runde-stand'), /COMPARE ended/, 'once');
});

test('a refused COMPARE shows the text of the server and stays off', async () => {
  await start({ antworten: { 'POST /proj/klang/hoeren': (k) => (k.vergleich
    ? { code: 409, j: { grund: 'vergleich_steht', text: 'COMPARE needs a running transport.' } } : { j: lage() }) } });
  $w('runde-platz-B').dispatch('click'); await ruhe();
  $w('runde-vergleich').dispatch('click'); await ruhe();
  assert.equal(text('runde-stand'), 'COMPARE needs a running transport.');
  assert.equal($w('runde-vergleich').getAttribute('aria-pressed'), 'false');
});

test('closing the window during COMPARE ends the round', async () => {
  await start();
  $w('runde-platz-B').dispatch('click'); await ruhe();
  $w('runde-vergleich').dispatch('click'); await ruhe();
  const e0 = ANRUFE('POST', '/proj/klang/ende').length;
  $w('fenster-zu').dispatch('click'); await ruhe();
  assert.equal(ANRUFE('POST', '/proj/klang/ende').length, e0 + 1);
});

test('the tooltip of a place names the gain the listening adds', async () => {
  await start({ start: lage((a) => { a.plaetze[1].ausgleich_db = -3; }) });
  assert.match($w('runde-platz-B').title, /played -3\.0 dB/);
  assert.doesNotMatch($w('runde-platz-C').title, /played/);
});
