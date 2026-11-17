// ANALYZE window (public/werkbank/analysis.js): the top bar button, the window, its requests and what it shows, run through bindeWerkbank
// against the DOM stand-in. The stand-in cannot read canvas pixels: what goes into the window (texts, selection, requests) is asserted.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

installiere();
const { bindeWerkbank } = await import('../public/werkbank/werkbank.js');
const { antwortText } = await import('../public/production/production.js');

const HIER = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(fs.readFileSync(path.join(HIER, 'fixtures', 'analyse_antwort.json'), 'utf8'));
const kopie = (rev, aendere) => { const a = structuredClone(FIXTURE); a.rev = rev; aendere?.(a); return a; };
const post = (w, k) => fetch(w, { method: 'POST', body: JSON.stringify(k) });
const ruhe = async () => { for (let i = 0; i < 12; i++) await new Promise((ok) => setImmediate(ok)); };
const POSTS = () => attrappe.anrufe.filter((a) => a.methode === 'POST' && a.url === '/proj/analyse');
const modul = (rev = 3, extra = {}) => ({
  name: 'M', rev, werkbank: { schema: 1 }, tempo_bpm: 130, taktart: [4, 4], loop: { an: true, von_beat: 0, bis_beat: 16 }, master: { fader_db: 0, inserts: [] },
  spuren: [
    { id: 's1', nr: 1, name: 'Drums', art: 'instrument', farbe: '#e0a33e', clips: [] },
    { id: 's2', nr: 2, name: 'Bass', art: 'instrument', farbe: '#3b8fe0', clips: [] },
  ],
  returns: [{ id: 'r1', nr: 1, name: 'Echo', farbe: '#5cd0ff', fader_db: 0, mute: false, inserts: [] }],
  ...extra,
});

let wurzel, w;
const $w = (n) => wurzel.querySelector(`[data-w="${n}"]`);
function aufbau(p = modul(), { antworten = {}, postFn = post } = {}) {
  installiere({ antworten: { 'GET /proj/aktuell': { j: p ? { slug: 'm', projekt: p } : { slug: null } }, 'GET /proj/liste': { j: [] }, 'GET /proj/werkbank/vorlagen': { j: { vorlagen: [] } },
    'GET /graphen': { j: { graphen: [] } }, 'GET /proj/kits': { j: { kits: [] } }, 'POST /proj/analyse': { j: FIXTURE }, ...antworten } });
  wurzel = document.createElement('section');
  w = bindeWerkbank({ post: postFn, wurzel, frage: () => true });
}
const oeffne = async () => { $w('analyse-auf').dispatch('click'); await ruhe(); };
const fenster = () => wurzel.querySelectorAll('[data-w="fenster"]');
const optionen = (n) => $w(n).querySelectorAll('option').map((o) => o.textContent);
const waehle = async (n, wert) => { const s = $w(n); s.value = wert; s.dispatch('change'); await ruhe(); };
const spielt = (beat) => w.ereignis('/zustand/arr', { status: 2, projekt_beat: beat });
const bild = () => { for (const h of w.ctx.vorBild) h(performance.now()); };

test('ANALYZE sits in the top bar before SHELF and is off without a module', async () => {
  aufbau(null); w.zeige(); await ruhe();
  const kinder = $w('kopf').elemente;
  const i = kinder.findIndex((e) => e.getAttribute('data-w') === 'analyse-auf'), j = kinder.findIndex((e) => e.getAttribute('data-w') === 'regal-auf');
  assert.ok(i >= 0 && j >= 0 && i < j, `analyse-auf ${i} must come before regal-auf ${j}`);
  assert.equal($w('analyse-auf').textContent, 'ANALYZE');
  assert.equal($w('analyse-auf').disabled, true);
  aufbau(); w.zeige(); await ruhe();
  assert.equal($w('analyse-auf').disabled, false);
});

test('a click opens one window of kind analyse and measures the selected track', async () => {
  aufbau(); w.zeige(); await ruhe();
  assert.equal(fenster().length, 0);
  await oeffne();
  assert.equal(fenster().length, 1);
  assert.equal(fenster()[0].getAttribute('data-fenster-id'), 'analyse');
  assert.deepEqual(POSTS().map((a) => a.koerper), [{ quelle: { art: 'spur', id: 's1' }, ohne_freeze: true }]);
  await oeffne();
  assert.equal(fenster().length, 1, 'a second click opens no second window');
  assert.equal(POSTS().length, 1, 'a second click does not measure again');
});

test('the selectors list the tracks, the return and MASTER; choosing a comparison measures again', async () => {
  aufbau(); w.zeige(); await ruhe(); await oeffne();
  assert.deepEqual(optionen('analyse-quelle'), ['A Drums', 'B Bass', 'FX 1 Echo', 'MASTER']);
  assert.deepEqual(optionen('analyse-vergleich'), ['none', 'B Bass', 'FX 1 Echo', 'MASTER'], 'the source is not offered as its own comparison');
  await waehle('analyse-vergleich', 'spur:s2');
  assert.deepEqual(POSTS().map((a) => a.koerper).at(-1), { quelle: { art: 'spur', id: 's1' }, vergleich: { art: 'spur', id: 's2' }, ohne_freeze: true });
  await waehle('analyse-quelle', 'master');
  assert.deepEqual(POSTS().map((a) => a.koerper).at(-1), { quelle: { art: 'master' }, vergleich: { art: 'spur', id: 's2' }, ohne_freeze: true });
  await waehle('analyse-vergleich', '');
  assert.deepEqual(POSTS().map((a) => a.koerper).at(-1), { quelle: { art: 'master' }, ohne_freeze: true });
});

test('the answer fills numbers and hints', async () => {
  aufbau(); w.zeige(); await ruhe(); await oeffne();
  assert.equal($w('analyse-stand').textContent, 'rev 26');
  const z = $w('analyse-zahlen').textContent;
  assert.ok(z.includes('-14.2') && z.includes('-16.8'), z);
  assert.ok(z.includes('LUFS-I') && z.includes('True peak') && z.includes('Crest') && z.includes('LRA'));
  assert.equal($w('analyse-hinweise').querySelectorAll('li').length, 4);
  for (const h of FIXTURE.hinweise) assert.ok($w('analyse-hinweise').textContent.includes(h.text));
  assert.ok($w('analyse-korrelation').textContent.includes(FIXTURE.quelle.stereo.korrelation.toFixed(2)));
  for (let i = 0; i < 4; i++) assert.ok($w(`analyse-band-${i}`), `band ${i}`);
  assert.ok($w('analyse-korrelation-min'));
});

test('REFRESH measures again; a rev change measures once after 800 ms', async (t) => {
  aufbau(); w.zeige(); await ruhe(); await oeffne();
  assert.equal(POSTS().length, 1);
  $w('analyse-neu').dispatch('click'); await ruhe();
  assert.equal(POSTS().length, 2);
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  for (const rev of [4, 5, 6]) { w.ctx.uebernimm('m', modul(rev)); mock.timers.tick(200); }
  await ruhe();
  assert.equal(POSTS().length, 2, 'nothing is sent while the project keeps changing');
  mock.timers.tick(800); await ruhe();
  assert.equal(POSTS().length, 3);
  mock.timers.tick(5000); await ruhe();
  assert.equal(POSTS().length, 3, 'one measurement per burst');
});

test('a closed window sends nothing on a rev change', async (t) => {
  aufbau(); w.zeige(); await ruhe(); await oeffne();
  $w('fenster-zu').dispatch('click');
  assert.equal(fenster().length, 0);
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  w.ctx.uebernimm('m', modul(9)); mock.timers.tick(2000); await ruhe();
  assert.equal(POSTS().length, 1);
});

test('an open window that is closed before the debounce fires does not measure', async (t) => {
  aufbau(); w.zeige(); await ruhe(); await oeffne();
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  w.ctx.uebernimm('m', modul(9)); mock.timers.tick(300);
  $w('fenster-zu').dispatch('click');
  mock.timers.tick(2000); await ruhe();
  assert.equal(POSTS().length, 1);
});

// fetch wrapped for /proj/analyse: the answers wait until the test lets them go (the stand-in calls answer functions synchronously); restored by `ende`
function geteuert() {
  const wartend = [], echt = globalThis.fetch;
  globalThis.fetch = (url, opt = {}) => {
    if (String(url) !== '/proj/analyse') return echt(url, opt);
    attrappe.anrufe.push({ url: String(url), methode: 'POST', koerper: JSON.parse(opt.body) });
    return new Promise((ok) => wartend.push((a, code = 200) => ok({ status: code, ok: code < 300, json: async () => a })));
  };
  return { wartend, ende: () => { globalThis.fetch = echt; } };
}

test('an answer for an older request is dropped', async () => {
  aufbau(); const g = geteuert();
  w.zeige(); await ruhe();
  try {
  await oeffne();
  assert.equal(POSTS().length, 1);
  assert.equal($w('analyse-stand').textContent, 'measuring…');
  await waehle('analyse-vergleich', 'spur:s2');
  $w('analyse-neu').dispatch('click'); await ruhe();
  assert.equal(POSTS().length, 1, 'at most one request in flight');
  g.wartend[0](kopie(30)); await ruhe();
  assert.equal(POSTS().length, 2, 'one new request after the stale answer');
  assert.ok(!$w('analyse-stand').textContent.includes('30'), 'the stale answer is not shown');
  assert.deepEqual(POSTS()[1].koerper, { quelle: { art: 'spur', id: 's1' }, vergleich: { art: 'spur', id: 's2' }, ohne_freeze: true });
  g.wartend[1](kopie(31)); await ruhe();
  assert.equal($w('analyse-stand').textContent, 'rev 31');
  assert.equal(POSTS().length, 2);
  } finally { g.ende(); }
});

test('an answer that arrives after the window was closed is ignored; a reopened window waits for the old request', async () => {
  aufbau(); const g = geteuert();
  w.zeige(); await ruhe();
  try {
    await oeffne();
    $w('fenster-zu').dispatch('click');
    await oeffne();   // opens again while the old request is still out: at most one in flight
    assert.equal(POSTS().length, 1);
    g.wartend[0](kopie(41)); await ruhe();   // the old answer is not shown, one fresh request follows
    assert.equal(POSTS().length, 2);
    assert.ok(!$w('analyse-stand').textContent.includes('41'));
    g.wartend[1](kopie(42)); await ruhe();
    assert.equal($w('analyse-stand').textContent, 'rev 42');
    $w('fenster-zu').dispatch('click');
    await oeffne();
    g.wartend[2](kopie(43)); $w('fenster-zu').dispatch('click'); await ruhe();   // answer after close: nothing happens, no throw
    assert.equal(POSTS().length, 3);
  } finally { g.ende(); }
});

test('the source is not its own comparison; moving the source onto the comparison clears it', async () => {
  aufbau(); w.zeige(); await ruhe(); await oeffne();
  await waehle('analyse-vergleich', 'spur:s2');
  assert.equal(POSTS().length, 2);
  await waehle('analyse-quelle', 'spur:s2');
  assert.equal($w('analyse-vergleich').value, '');
  assert.deepEqual(optionen('analyse-vergleich'), ['none', 'A Drums', 'FX 1 Echo', 'MASTER']);
  assert.deepEqual(POSTS().at(-1).koerper, { quelle: { art: 'spur', id: 's2' }, ohne_freeze: true });
});

test('a very quiet source with null loudness shows n/a and does not throw', async () => {
  const a = kopie(29, (x) => { x.quelle.lautheit.lufs_i = null; x.quelle.lautheit.lra = null; });
  aufbau(modul(), { antworten: { 'POST /proj/analyse': { j: a } } }); w.zeige(); await ruhe(); await oeffne();
  assert.equal($w('analyse-stand').textContent, 'rev 29');
  assert.ok($w('analyse-zahlen').textContent.includes('n/a'));
  assert.ok($w('analyse-zahlen').textContent.includes('-0.6'), 'the other numbers stay');
});

test('a refusal shows its text and keeps the drawing', async () => {
  aufbau(); w.zeige(); await ruhe(); await oeffne();
  attrappe.antworten['POST /proj/analyse'] = { code: 409, j: { fehler: 'beschaeftigt' } };
  $w('analyse-neu').dispatch('click'); await ruhe();
  const erwartet = antwortText({ status: 409, j: { fehler: 'beschaeftigt' } });
  assert.ok(erwartet.length > 0);
  assert.ok($w('analyse-stand').textContent.includes(erwartet), $w('analyse-stand').textContent);
  assert.ok($w('analyse-zahlen').textContent.includes('-14.2'), 'the last numbers stay');
  attrappe.antworten['POST /proj/analyse'] = { code: 409, j: { fehler: 'kein_projekt' } };
  $w('analyse-neu').dispatch('click'); await ruhe();
  assert.ok($w('analyse-stand').textContent.includes(antwortText({ status: 409, j: { fehler: 'kein_projekt' } })));
  attrappe.antworten['POST /proj/analyse'] = { code: 200, j: { unsinn: true } };
  $w('analyse-neu').dispatch('click'); await ruhe();
  assert.ok(!$w('analyse-stand').textContent.startsWith('rev'), 'a broken answer is no measurement');
});

test('a vanished source falls back to the selected track', async (t) => {
  aufbau(); w.zeige(); await ruhe(); await oeffne();
  await waehle('analyse-quelle', 'spur:s2');
  assert.deepEqual(POSTS().at(-1).koerper, { quelle: { art: 'spur', id: 's2' }, ohne_freeze: true });
  const ohne = modul(8); ohne.spuren = ohne.spuren.filter((s) => s.id !== 's2');
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  w.ctx.uebernimm('m', ohne);
  assert.deepEqual(optionen('analyse-quelle'), ['A Drums', 'FX 1 Echo', 'MASTER']);
  assert.equal($w('analyse-quelle').value, 'spur:s1');
  mock.timers.tick(800); await ruhe();
  assert.deepEqual(POSTS().at(-1).koerper, { quelle: { art: 'spur', id: 's1' }, ohne_freeze: true });
});

test('a vanished comparison goes back to none', async (t) => {
  aufbau(); w.zeige(); await ruhe(); await oeffne();
  await waehle('analyse-vergleich', 'spur:s2');
  const ohne = modul(8); ohne.spuren = ohne.spuren.filter((s) => s.id !== 's2');
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  w.ctx.uebernimm('m', ohne);
  mock.timers.tick(800); await ruhe();
  assert.deepEqual(POSTS().at(-1).koerper, { quelle: { art: 'spur', id: 's1' }, ohne_freeze: true });
});

test('the column under the playhead follows the transport', async () => {
  aufbau(); w.zeige(); await ruhe(); await oeffne();
  assert.equal($w('analyse-spektrum').getAttribute('data-spalte'), '');
  spielt(4); bild();
  const s = $w('analyse-spektrum').getAttribute('data-spalte');
  assert.match(s, /^\d+$/);
  assert.ok(Number(s) >= 0 && Number(s) <= 169);
  w.ereignis('/zustand/arr', { status: 0, projekt_beat: 0 }); bild();
  assert.equal($w('analyse-spektrum').getAttribute('data-spalte'), '');
});

test('the frame hook is registered once and idle while the window is closed', async () => {
  aufbau(); w.zeige(); await ruhe();
  const n = w.ctx.vorBild.length;
  await oeffne(); $w('fenster-zu').dispatch('click'); await oeffne(); $w('fenster-zu').dispatch('click');
  assert.equal(w.ctx.vorBild.length, n, 'no hook per opening');
  spielt(4); bild();   // closed: nothing throws, nothing is drawn
  assert.equal(fenster().length, 0);
});

test('the window closes on a module switch', async () => {
  aufbau(); w.zeige(); await ruhe(); await oeffne();
  assert.equal(fenster().length, 1);
  w.ctx.uebernimm('other', modul(2));
  assert.equal(fenster().length, 0);
  assert.equal($w('analyse-auf').disabled, false);
});

test('a stumm comparison shows n/a', async () => {
  const a = kopie(27, (x) => {
    x.vergleich.stumm = true;
    for (const k of Object.keys(x.vergleich.lautheit)) x.vergleich.lautheit[k] = null;
  });
  aufbau(modul(), { antworten: { 'POST /proj/analyse': { j: a } } }); w.zeige(); await ruhe(); await oeffne();
  await waehle('analyse-vergleich', 'spur:s2');
  const z = $w('analyse-zahlen').textContent;
  assert.ok(z.includes('n/a'), z);
  assert.ok(z.includes('-14.2'));
  assert.ok(!z.includes('-16.8'));
  bild();   // drawing a silent side does not throw
});

test('a silent source and a one-column answer do not throw', async () => {
  const a = kopie(28, (x) => {
    x.quelle.stumm = true; delete x.vergleich; delete x.ueberdeckung; x.hinweise = [];
    for (const k of Object.keys(x.quelle.lautheit)) x.quelle.lautheit[k] = null;
    x.quelle.zeitbild = { ...x.quelle.zeitbild, spalten: 1, daten: Buffer.alloc(120).toString('base64') };
  });
  aufbau(modul(), { antworten: { 'POST /proj/analyse': { j: a } } }); w.zeige(); await ruhe(); await oeffne();
  assert.equal($w('analyse-stand').textContent, 'rev 28');
  assert.ok($w('analyse-zahlen').textContent.includes('n/a'));
  spielt(1); bild();
  assert.equal($w('analyse-spektrum').getAttribute('data-spalte'), '0');
});

test('a mono source reads "mono" and a band without level reads "no signal"', async () => {
  const a = kopie(30, (x) => {
    x.quelle.stereo.breite_db = -200;
    x.quelle.stereo.baender[0] = { ...x.quelle.stereo.baender[0], korrelation: 0, breite_db: -200, pegel_db: -200 };
    x.quelle.stereo.baender[1] = { ...x.quelle.stereo.baender[1], korrelation: 1, breite_db: -200, pegel_db: -20 };
  });
  aufbau(modul(), { antworten: { 'POST /proj/analyse': { j: a } } }); w.zeige(); await ruhe(); await oeffne();
  assert.ok($w('analyse-breite').textContent.includes('mono'));
  assert.ok(!$w('analyse-breite').textContent.includes('-200'));
  assert.ok($w('analyse-band-0').textContent.includes('no signal'));
  assert.ok($w('analyse-band-1').textContent.includes('1.00') && $w('analyse-band-1').textContent.includes('mono'));
  assert.ok($w('analyse-band-2').textContent.includes('0.70') && $w('analyse-band-2').textContent.includes('-9.0 dB'));
});
