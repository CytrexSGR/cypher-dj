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
  assert.deepEqual(optionen('analyse-quelle'), ['A Drums', 'B Bass', 'FX 1 Echo', 'MASTER', 'LIVE OUTPUT']);
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
  assert.deepEqual(optionen('analyse-quelle'), ['A Drums', 'FX 1 Echo', 'MASTER', 'LIVE OUTPUT']);
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

// ---- slice 2: live output, references, drop, SAVE REF ----
const { abweichungText } = await import('../public/sound_match.js');
const ZIEH = 'application/x-djk-clip';
const SHA = 'a'.repeat(64);
const LIVE_URL = 'GET /analyse/live';
const LIVES = () => attrappe.anrufe.filter((a) => a.url === '/analyse/live');
const liveAntwort = (extra = {}) => ({ leer: false, w: 1, steht: false, stumm: false,
  spektrum: { hz: FIXTURE.quelle.spektrum.hz, db: FIXTURE.quelle.spektrum.mittel_db }, stereo: FIXTURE.quelle.stereo,
  spitze_db: -3, rms_db: -15, true_peak_dbtp: -4, lufs_m: -12.5, ...extra });
const refZeile = { id: 'r1', name: 'Club kick', rolle: 'kick', erstellt: '2026-11-17', herkunft: 'datei', lufs_i: -8.2 };
const REFS = { 'GET /analyse/referenzen': { j: { referenzen: [refZeile], rollen: ['kick', 'bass', 'other'] } } };
const refMessung = (extra = {}) => {
  const { zeitbild: _z, ...q } = structuredClone(FIXTURE.quelle);
  q.lautheit.lufs_i = -9.1;
  return { ...q, name: 'Club kick', quelle: { art: 'referenz', id: 'r1' }, bereich: { von_s: 65, bis_s: 80, datei_s: 200, wahl: 'laut' }, ...extra };
};
const ABWEICHUNG = { hz_von: 80, hz_bis: 125, diff_db: 4.2 };
const ABGLEICH = { versatz_db: 11.8, baender: [], abweichungen: [ABWEICHUNG] };
const mitRef = (rev = 40, bereich = true) => kopie(rev, (a) => {
  a.vergleich = refMessung(); if (!bereich) delete a.vergleich.bereich;
  a.abgleich = structuredClone(ABGLEICH); delete a.ueberdeckung;
});
const nutzlast = (extra = {}) => ({ types: [ZIEH], getData: (t) => (t === ZIEH ? JSON.stringify({ sha: SHA, dauer_s: 200, name: 'loop.wav', ...extra }) : '') });
const koerperEl = () => $w('analyse-vergleich').closest('.w-fenster-koerper');
const zu = () => $w('fenster-zu')?.dispatch('click');
const tickLive = async (n = 1) => { for (let i = 0; i < n; i++) { mock.timers.tick(100); await ruhe(); } };
function live(t, antworten = {}) {
  aufbau(modul(), { antworten: { [LIVE_URL]: { j: liveAntwort() }, ...antworten } });
  w.zeige();
  return (async () => {
    await ruhe(); await oeffne();
    mock.timers.enable({ apis: ['setTimeout'] });
    t.after(() => { zu(); mock.timers.reset(); });
    await waehle('analyse-quelle', 'live');
  })();
}

test('LIVE OUTPUT follows MASTER in the source selector; no strips next to it', async (t) => {
  await live(t);
  assert.deepEqual(optionen('analyse-quelle').slice(-2), ['MASTER', 'LIVE OUTPUT']);
  assert.equal($w('analyse-quelle').value, 'live');
  assert.deepEqual(optionen('analyse-vergleich'), ['none']);
});

test('live mode polls /analyse/live every 100 ms and sends no /proj/analyse', async (t) => {
  await live(t);
  const proj0 = POSTS().length;   // the one measurement of the strip that was shown before
  assert.equal(LIVES().length, 1, 'the first poll is at once');
  assert.equal($w('analyse-stand').textContent, 'live');
  await tickLive(3);
  assert.equal(LIVES().length, 4);
  w.ctx.uebernimm('m', modul(9)); mock.timers.tick(2000); await ruhe();
  assert.equal(POSTS().length, proj0, 'a project change measures nothing in live mode');
  $w('analyse-neu').dispatch('click'); await ruhe();
  assert.equal(POSTS().length, proj0, 'REFRESH measures nothing in live mode');
  const z = $w('analyse-zahlen').textContent;
  for (const s of ['Momentary (LUFS)', 'Momentary max (LUFS)', 'True peak (dBTP)', 'True peak max (dBTP)', 'Crest (dB)', '-12.5', '-4.0', '12.0']) assert.ok(z.includes(s), `${s} in ${z}`);
  assert.ok($w('analyse-korrelation').textContent.includes(FIXTURE.quelle.stereo.korrelation.toFixed(2)));
});

test('live mode: one request in flight and no polling while the page is hidden', async (t) => {
  await live(t);
  const g = [], echt = globalThis.fetch;
  t.after(() => { globalThis.fetch = echt; delete document.hidden; });
  globalThis.fetch = (url, opt = {}) => {
    if (String(url) !== '/analyse/live') return echt(url, opt);
    attrappe.anrufe.push({ url: String(url), methode: 'GET' });
    return new Promise((ok) => g.push(() => ok({ status: 200, ok: true, json: async () => liveAntwort() })));
  };
  const n = LIVES().length;
  await tickLive(1);
  assert.equal(LIVES().length, n + 1);
  await tickLive(3);
  assert.equal(LIVES().length, n + 1, 'no second request while one is out');
  g[0](); await ruhe();
  document.hidden = true;
  await tickLive(3);
  assert.equal(LIVES().length, n + 1, 'a hidden page does not poll');
  document.hidden = false;
  await tickLive(1);
  assert.equal(LIVES().length, n + 2);
  g.at(-1)(); await ruhe();
});

test('live state texts: engine not running, no signal, stopped', async (t) => {
  await live(t);
  const zeige = async (a) => { attrappe.antworten[LIVE_URL] = { j: a }; await tickLive(1); return $w('analyse-stand').textContent; };
  assert.equal(await zeige({ leer: true, grund: 'no engine' }), 'engine not running');
  assert.equal(await zeige(liveAntwort({ stumm: true })), 'no signal');
  assert.equal(await zeige(liveAntwort({ steht: true })), 'stopped');
  assert.equal(await zeige(liveAntwort()), 'live');
  bild();   // drawing in live mode does not throw
});

test('live hints are held for 2 s', async (t) => {
  await live(t);
  const baender = (k) => FIXTURE.quelle.stereo.baender.map((b, i) => (i === 0 ? { ...b, korrelation: k, pegel_db: -20 } : b));
  const heiss = liveAntwort({ true_peak_dbtp: 0.4, stereo: { ...FIXTURE.quelle.stereo, baender: baender(0.2) } });
  attrappe.antworten[LIVE_URL] = { j: heiss }; await tickLive(1);
  assert.ok($w('analyse-hinweise').textContent.includes('True peak'), $w('analyse-hinweise').textContent);
  assert.ok($w('analyse-hinweise').textContent.includes('mono-safe'));
  attrappe.antworten[LIVE_URL] = { j: liveAntwort({ stereo: { ...FIXTURE.quelle.stereo, baender: baender(0.9) } }) };
  await tickLive(1);
  assert.ok($w('analyse-hinweise').textContent.includes('True peak') && $w('analyse-hinweise').textContent.includes('mono-safe'), 'both still held right after');
});

test('leaving live mode measures the strip again', async (t) => {
  await live(t);
  const n = POSTS().length;
  await waehle('analyse-quelle', 'spur:s2');
  assert.equal(POSTS().length, n + 1);
  assert.deepEqual(POSTS().at(-1).koerper, { quelle: { art: 'spur', id: 's2' }, ohne_freeze: true });
  const l = LIVES().length;
  await tickLive(3);
  assert.equal(LIVES().length, l, 'polling stopped');
});

test('stored references are listed in the REFERENCES group of COMPARE WITH', async () => {
  aufbau(modul(), { antworten: REFS }); w.zeige(); await ruhe(); await oeffne();
  assert.deepEqual(optionen('analyse-vergleich'), ['none', 'B Bass', 'FX 1 Echo', 'MASTER', 'KICK · Club kick']);
  const g = $w('analyse-vergleich').querySelectorAll('optgroup');
  assert.equal(g.length, 1);
  assert.equal(g[0].getAttribute('label'), 'REFERENCES');
  assert.equal(g[0].querySelectorAll('option')[0].value, 'ref:r1');
  assert.equal($w('analyse-vergleich').title, 'Compare with a strip or a reference. Drop a track or sample from the shelf here.');
  assert.ok(attrappe.anrufe.some((a) => a.methode === 'GET' && a.url === '/analyse/referenzen'));
  zu();
});

test('a reference as the comparison sends the right body and shows VS REFERENCE with the deviations; MATCH only for references', async () => {
  aufbau(modul(), { antworten: { ...REFS, 'POST /proj/analyse': (k) => ({ j: k.vergleich?.art === 'referenz' ? mitRef() : FIXTURE }) } });
  w.zeige(); await ruhe(); await oeffne();
  assert.equal($w('analyse-abgleich').hidden, true);
  assert.equal($w('analyse-match').hidden, true);
  assert.equal($w('analyse-match').checked, true, 'MATCH is on by default');
  await waehle('analyse-vergleich', 'spur:s2');
  assert.equal($w('analyse-match').hidden, true, 'not for a strip');
  await waehle('analyse-vergleich', 'ref:r1');
  assert.deepEqual(POSTS().at(-1).koerper, { quelle: { art: 'spur', id: 's1' }, vergleich: { art: 'referenz', id: 'r1' }, ohne_freeze: true });
  assert.equal($w('analyse-match').hidden, false);
  assert.equal($w('analyse-abgleich').hidden, false);
  const t = $w('analyse-abgleich').textContent;
  assert.ok(t.includes('Club kick · 1:05 - 1:20 · -9.1 LUFS'), t);
  assert.ok(t.includes(abweichungText(ABWEICHUNG)), t);
  assert.ok($w('analyse-zahlen').textContent.includes('Club kick'), 'the reference has its column');
  assert.ok($w('analyse-zahlen').textContent.includes('-9.1'));
  $w('analyse-spektrum').dispatch('pointermove', { clientX: 50 });
  assert.match($w('analyse-lesung').textContent, /ref -?[\d.]+ dB \(matched \+11\.8\)/);
  $w('analyse-match').checked = false; $w('analyse-match').dispatch('change');
  $w('analyse-spektrum').dispatch('pointermove', { clientX: 50 });
  assert.match($w('analyse-lesung').textContent, /ref -?[\d.]+ dB$/);
  await waehle('analyse-vergleich', '');
  assert.equal($w('analyse-abgleich').hidden, true);
  assert.equal($w('analyse-match').hidden, true);
  zu();
});

test('VS REFERENCE without deviations and without a range', async () => {
  const a = mitRef(41, false); a.abgleich.abweichungen = [];
  aufbau(modul(), { antworten: { ...REFS, 'POST /proj/analyse': { j: a } } }); w.zeige(); await ruhe(); await oeffne();
  await waehle('analyse-vergleich', 'ref:r1');
  const t = $w('analyse-abgleich').textContent;
  assert.ok(t.includes('Club kick · -9.1 LUFS'), t);
  assert.ok(!t.includes(':'), 'no range text');
  assert.ok(t.includes('Close to the reference (within 3 dB)'), t);
  zu();
});

test('a drop of a shelf track makes it the comparison', async () => {
  aufbau(modul(), { antworten: { 'POST /proj/analyse': (k) => ({ j: k.vergleich?.art === 'datei' ? mitRef(42) : FIXTURE }) } });
  w.zeige(); await ruhe(); await oeffne();
  let verhindert = 0;
  const vor = () => { verhindert += 1; };
  $w('analyse-vergleich').dispatch('dragover', { preventDefault: vor, dataTransfer: { types: ['text/plain'] } });
  assert.equal(verhindert, 0, 'a foreign drag is not accepted');
  assert.ok(!koerperEl().classList.contains('w-analyse-ziel'));
  $w('analyse-vergleich').dispatch('dragover', { preventDefault: vor, dataTransfer: nutzlast() });
  assert.equal(verhindert, 1);
  assert.ok(koerperEl().classList.contains('w-analyse-ziel'));
  $w('analyse-vergleich').dispatch('dragleave', {});
  assert.ok(!koerperEl().classList.contains('w-analyse-ziel'));
  $w('analyse-vergleich').dispatch('dragover', { preventDefault: vor, dataTransfer: nutzlast() });
  $w('analyse-vergleich').dispatch('drop', { preventDefault: vor, dataTransfer: nutzlast() }); await ruhe();
  assert.ok(!koerperEl().classList.contains('w-analyse-ziel'));
  assert.equal($w('analyse-vergleich').value, 'datei');
  assert.ok(optionen('analyse-vergleich').includes('FILE · loop.wav'));
  assert.deepEqual(POSTS().at(-1).koerper, { quelle: { art: 'spur', id: 's1' }, vergleich: { art: 'datei', sha: SHA }, ohne_freeze: true });
  assert.equal($w('analyse-match').hidden, false);
  zu();
});

test('a drop without a name reads "file"; in live mode the file is measured once for 15 s', async (t) => {
  const messen = { 'POST /analyse/referenz/messen': { j: { messung: refMessung({ name: 'file', quelle: { art: 'datei', sha: SHA } }) } } };
  await live(t, messen);
  $w('analyse-vergleich').dispatch('drop', { dataTransfer: nutzlast({ name: undefined }) }); await ruhe();
  assert.ok(optionen('analyse-vergleich').includes('FILE · file'));
  const m = () => attrappe.anrufe.filter((a) => a.url === '/analyse/referenz/messen');
  assert.deepEqual(m().map((a) => a.koerper), [{ quelle: { art: 'datei', sha: SHA }, dauer_s: 15 }]);
  await tickLive(5);
  assert.equal(m().length, 1, 'once per selection');
  assert.equal(POSTS().filter((a) => a.koerper.vergleich).length, 0);
  assert.equal($w('analyse-abgleich').hidden, false);
  assert.ok($w('analyse-abgleich').textContent.includes('file'));
  assert.ok($w('analyse-abgleich').textContent.includes('1:05 - 1:20'));
  assert.equal($w('analyse-ref-speichern').disabled, false, 'a dropped file can be stored in live mode');
});

test('a stored reference as the live comparison is measured once with dauer_s 15', async (t) => {
  await live(t, { ...REFS, 'POST /analyse/referenz/messen': { j: { messung: refMessung() } } });
  await ruhe();
  await waehle('analyse-vergleich', 'ref:r1');
  const m = () => attrappe.anrufe.filter((a) => a.url === '/analyse/referenz/messen');
  assert.deepEqual(m().map((a) => a.koerper), [{ quelle: { art: 'referenz', id: 'r1' }, dauer_s: 15 }]);
  await tickLive(3);
  assert.equal(m().length, 1);
  assert.ok($w('analyse-abgleich').textContent.includes('Club kick'));
  assert.ok($w('analyse-abgleich').textContent.includes('LUFS'));
  assert.ok($w('analyse-zahlen').textContent.includes('Club kick'));
});

test('SAVE REF stores the source strip with the range of the shown answer', async () => {
  aufbau(modul(), { antworten: { ...REFS, 'POST /analyse/referenz/merken': { j: { referenz: { ...refZeile, id: 'r2', name: 'My drums' } } } } });
  w.zeige(); await ruhe();
  await oeffne();
  assert.equal($w('analyse-ref-speichern').disabled, false);
  assert.equal($w('analyse-ref-reihe').hidden, true);
  $w('analyse-ref-speichern').dispatch('click');
  assert.equal($w('analyse-ref-reihe').hidden, false);
  assert.equal($w('analyse-ref-name').value, FIXTURE.quelle.name, 'prefilled with the strip name');
  assert.deepEqual($w('analyse-ref-rolle').querySelectorAll('option').map((o) => o.value), ['kick', 'bass', 'other']);
  $w('analyse-ref-name').value = 'My drums'; $w('analyse-ref-rolle').value = 'kick';
  const geladen = attrappe.anrufe.filter((a) => a.url === '/analyse/referenzen').length;
  $w('analyse-ref-ok').dispatch('click'); await ruhe();
  const s = attrappe.anrufe.find((a) => a.url === '/analyse/referenz/merken');
  assert.deepEqual(s.koerper, { name: 'My drums', rolle: 'kick', projekt: { quelle: { art: 'spur', id: 's1' }, von_beat: FIXTURE.von_beat, bis_beat: FIXTURE.bis_beat } });
  assert.equal(attrappe.anrufe.filter((a) => a.url === '/analyse/referenzen').length, geladen + 1, 'the list is loaded again');
  assert.equal($w('analyse-ref-reihe').hidden, true);
  zu();
});

test('SAVE REF stores a dropped file with its measured range and selects the new reference', async () => {
  const neu = { ...refZeile, id: 'r9', name: 'loop.wav' };
  let gespeichert = false;
  aufbau(modul(), { antworten: {
    'GET /analyse/referenzen': () => ({ j: { referenzen: gespeichert ? [refZeile, neu] : [refZeile], rollen: ['kick', 'bass', 'other'] } }),
    'POST /analyse/referenz/merken': () => { gespeichert = true; return { j: { referenz: neu } }; },
    'POST /proj/analyse': (k) => ({ j: k.vergleich ? mitRef(43) : FIXTURE }) } });
  w.zeige(); await ruhe(); await oeffne();
  $w('analyse-vergleich').dispatch('drop', { dataTransfer: nutzlast() }); await ruhe();
  $w('analyse-ref-speichern').dispatch('click');
  assert.equal($w('analyse-ref-name').value, 'loop.wav', 'prefilled with the file name');
  $w('analyse-ref-rolle').value = 'bass';
  $w('analyse-ref-ok').dispatch('click'); await ruhe();
  assert.deepEqual(attrappe.anrufe.find((a) => a.url === '/analyse/referenz/merken').koerper, { name: 'loop.wav', rolle: 'bass', quelle: { art: 'datei', sha: SHA, von_s: 65, bis_s: 80 } });
  assert.equal($w('analyse-vergleich').value, 'ref:r9');
  assert.deepEqual(POSTS().at(-1).koerper.vergleich, { art: 'referenz', id: 'r9' });
  assert.ok(!optionen('analyse-vergleich').some((o) => o.startsWith('FILE')), 'the file entry is replaced by the stored reference');
  zu();
});

test('SAVE REF is off without something to store and shows an error text', async (t) => {
  aufbau(modul(), { antworten: { 'POST /analyse/referenz/merken': { code: 409, j: { fehler: 'name_belegt', text: 'Name taken' } } } });
  const g = geteuert();
  w.zeige(); await ruhe();
  try {
    await oeffne();
    assert.equal($w('analyse-ref-speichern').disabled, true, 'no answer yet');
    g.wartend[0](FIXTURE); await ruhe();
    assert.equal($w('analyse-ref-speichern').disabled, false);
  } finally { g.ende(); }
  $w('analyse-ref-speichern').dispatch('click');
  $w('analyse-ref-ok').dispatch('click'); await ruhe();
  assert.ok($w('analyse-stand').textContent.includes('Name taken'), $w('analyse-stand').textContent);
  assert.equal($w('analyse-ref-reihe').hidden, false, 'the row stays after an error');
  $w('analyse-ref-abbruch').dispatch('click');
  assert.equal($w('analyse-ref-reihe').hidden, true);
  zu();
});

test('SAVE REF is off in live mode without a dropped file', async (t) => {
  await live(t);
  assert.equal($w('analyse-ref-speichern').disabled, true);
});

test('removing a reference takes two clicks within 3 s', async (t) => {
  let weg = false;
  aufbau(modul(), { antworten: {
    'GET /analyse/referenzen': () => ({ j: { referenzen: weg ? [] : [refZeile], rollen: ['other'] } }),
    'POST /analyse/referenz/loeschen': () => { weg = true; return { j: { ok: true } }; },
    'POST /proj/analyse': (k) => ({ j: k.vergleich ? mitRef(44) : FIXTURE }) } });
  w.zeige(); await ruhe(); await oeffne();
  assert.equal($w('analyse-ref-weg').hidden, true, 'no reference selected');
  await waehle('analyse-vergleich', 'ref:r1');
  assert.equal($w('analyse-ref-weg').hidden, false);
  assert.equal($w('analyse-ref-weg').textContent, '×');
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => { zu(); mock.timers.reset(); });
  $w('analyse-ref-weg').dispatch('click'); await ruhe();
  assert.equal($w('analyse-ref-weg').textContent, 'REMOVE?');
  assert.equal(attrappe.anrufe.filter((a) => a.url === '/analyse/referenz/loeschen').length, 0);
  mock.timers.tick(3000); await ruhe();
  assert.equal($w('analyse-ref-weg').textContent, '×', 'the question lapses after 3 s');
  $w('analyse-ref-weg').dispatch('click'); $w('analyse-ref-weg').dispatch('click'); await ruhe();
  assert.deepEqual(attrappe.anrufe.filter((a) => a.url === '/analyse/referenz/loeschen').map((a) => a.koerper), [{ id: 'r1' }]);
  assert.equal($w('analyse-vergleich').value, '');
  assert.deepEqual(optionen('analyse-vergleich'), ['none', 'B Bass', 'FX 1 Echo', 'MASTER']);
  assert.equal($w('analyse-ref-weg').hidden, true);
  assert.deepEqual(POSTS().at(-1).koerper, { quelle: { art: 'spur', id: 's1' }, ohne_freeze: true });
});

test('a failed measurement shows the detail after the text', async () => {
  aufbau(); w.zeige(); await ruhe(); await oeffne();
  const r = { status: 422, j: { fehler: 'nicht_messbar', text: 'Cannot measure', detail: 'file is too short' } };
  attrappe.antworten['POST /proj/analyse'] = { code: 422, j: r.j };
  $w('analyse-neu').dispatch('click'); await ruhe();
  const t = $w('analyse-stand').textContent;
  assert.ok(t.includes('Cannot measure') && t.includes('file is too short'), t);
  assert.ok(t.indexOf('file is too short') > t.indexOf('Cannot measure'));
  zu();
});

test('a failed measurement shows the server text and a shortened detail', async () => {
  aufbau(); w.zeige(); await ruhe(); await oeffne();
  const lang = `ffmpeg said ${'x'.repeat(400)}`;
  attrappe.antworten['POST /proj/analyse'] = { code: 500, j: { fehler: 'render_fehler', text: 'the analysis failed', detail: lang } };
  $w('analyse-neu').dispatch('click'); await ruhe();
  const t = $w('analyse-stand').textContent;
  assert.ok(t.startsWith('the analysis failed \u00b7 ffmpeg said'), t);
  assert.ok(t.length < 200 && t.endsWith('\u2026'), String(t.length));
  zu();
});
