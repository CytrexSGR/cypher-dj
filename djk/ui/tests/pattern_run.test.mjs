// strudel-clip: the child process layer (areas/proj/pattern_run.ts) and its use by the session. The server thread must never wait for a pattern:
// a pattern that crashes the child, runs out of memory or never ends is a cached refusal with a plain text, and the event loop keeps beating.
import test from 'node:test';
import assert from 'node:assert/strict';
import { vorlauf, ausCache, uebersetzeAusCache, pruefeAntwort, vergiss, messung, MUSTER_KINDER_MAX, MUSTER_RSS_MAX_KB, MUSTER_ZEITLIMIT_MS } from '../areas/proj/pattern_run.ts';
import { sitzung } from './support/proj_context.mjs';

// longest gap between two beats of a 5 ms timer while f runs, in ms: how long the event loop stood still
async function stillstand(f) {
  let letzter = performance.now(), max = 0;
  const uhr = setInterval(() => { const jetzt = performance.now(); max = Math.max(max, jetzt - letzter); letzter = jetzt; }, 5);
  try { await f(); } finally { clearInterval(uhr); }
  return Math.max(max, performance.now() - letzter);
}
const frage = (code, takte = null) => ({ code, takte });
const kein_v8 = (text) => assert.ok(!/node::|v8::|0x[0-9a-f]{6}|Native stack|\[node\]/.test(text), `no V8 crash line in: ${text}`);

test('crash by memory (a density spike in the third bar, past the cheap pre-check): the loop beats, the answer is a plain cached refusal', async () => {
  vergiss();
  const a = frage('s("<bd bd bd bd*1000000>")', 4);
  const still = await stillstand(() => vorlauf([a]));
  const r = uebersetzeAusCache(a);
  assert.equal(r.ok, false); assert.equal(r.grund, 'muster_zu_gross'); kein_v8(r.fehler);
  assert.ok(still < 50, `event loop stood still for ${still.toFixed(1)} ms`);
  const t0 = performance.now();
  assert.deepEqual(uebersetzeAusCache(a), r, 'the second ask is the cached answer');
  assert.ok(performance.now() - t0 < 5);
});

test('crash without an answer (process.exit): cached, plain text, loop free', async () => {
  vergiss();
  const a = frage('(process.exit(3), s("bd"))');
  const still = await stillstand(() => vorlauf([a]));
  const r = uebersetzeAusCache(a);
  assert.equal(r.grund, 'muster_fehler'); assert.match(r.fehler, /stopped without an answer/); kein_v8(r.fehler);
  assert.ok(still < 50, `${still} ms`);
  assert.deepEqual(ausCache(a), r);
});

test('a pattern that never ends: time limit after 5 s, cached, loop free', { timeout: 20000 }, async () => {
  vergiss();
  const a = frage('(() => { while (true) {} })()');
  const still = await stillstand(() => vorlauf([a]));
  const r = uebersetzeAusCache(a);
  assert.equal(r.grund, 'muster_zeitlimit'); assert.match(r.fehler, new RegExp(`${MUSTER_ZEITLIMIT_MS / 1000} s`));
  assert.ok(still < 50, `${still} ms`);
});

test('memory outside the heap (a 3 GB buffer) is killed by the RSS watcher far below 3 GB', { timeout: 20000 }, async () => {
  vergiss();
  const a = frage('(new Uint8Array(3e9).fill(7), s("bd"))');
  const t0 = performance.now();
  const still = await stillstand(() => vorlauf([a]));
  const r = uebersetzeAusCache(a);
  assert.equal(r.grund, 'muster_zu_gross'); assert.match(r.fehler, /memory/);
  assert.ok(messung.spitzeKB > MUSTER_RSS_MAX_KB * 0.5, `the watcher saw ${messung.spitzeKB} kB`);
  assert.ok(messung.spitzeKB < 1.3 * 1024 * 1024, `peak RSS seen ${Math.round(messung.spitzeKB / 1024)} MB (limit ${Math.round(MUSTER_RSS_MAX_KB / 1024)} MB)`);
  assert.ok(performance.now() - t0 < 4000 && still < 50, `${performance.now() - t0} ms, loop ${still} ms`);
});

test('the pre-check refuses a dense pattern in the child at once, without the heap running full', async () => {
  vergiss();
  for (const code of ['s("bd*1000000")', 's("bd*5").fast(1e9)']) {
    const t0 = performance.now();
    await vorlauf([frage(code)]);
    const r = uebersetzeAusCache(frage(code));
    assert.equal(r.grund, 'muster_zu_gross', code); assert.match(r.fehler, /more than 20000 events/);
    assert.ok(performance.now() - t0 < 3000, `${code}: ${performance.now() - t0} ms`);
  }
});

test('the child sees none of the server environment', async () => {
  vergiss();
  process.env.MUSTER_TEST_TOKEN = 'geheim';
  try {
    const a = frage('s(process.env.MUSTER_TEST_TOKEN === undefined && process.env.HOME === undefined ? "bd" : "hh")');
    await vorlauf([a]);
    const r = uebersetzeAusCache(a);
    assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.ereignisse[0].werte.s, 'bd');
  } finally { delete process.env.MUSTER_TEST_TOKEN; }
});

test('at most MUSTER_KINDER_MAX children at a time; the rest waits; the same pattern asked twice runs once', { timeout: 30000 }, async () => {
  vergiss();
  const langsam = (i) => frage(`(() => { const t = Date.now(); while (Date.now() - t < 400) {} return s("bd:${i}"); })()`);
  const alle = [0, 1, 2, 3, 4, 5].map(langsam);
  const t0 = performance.now();
  await vorlauf([...alle, alle[0], alle[1]]);
  const dauer = performance.now() - t0;
  assert.equal(messung.kinderMax, MUSTER_KINDER_MAX, 'never more than the cap alive at once');
  assert.ok(dauer >= 3 * 400 * 0.9, `6 children of 0.4 s with 2 at a time take at least 1.2 s: ${dauer}`);
  assert.ok(alle.every((a) => ausCache(a)?.ok === true));
});

test('a miss in the cache is a refusal, not a process: the synchronous side never starts anything', () => {
  vergiss();
  const r = uebersetzeAusCache(frage('s("hh*3")'));
  assert.equal(r.ok, false); assert.equal(r.grund, 'muster_nicht_verfuegbar');
});

test('the answer of the child is checked: werte null, a string where a number belongs, too many events are refused', () => {
  const gut = { ok: true, takte: 1, laenge_beats: 4, loop_beats: null, periode_takte: 1, stetig: [], komplex: [], hinweise: [],
    ereignisse: [{ beat: 0, laenge: 1, ton: 36, werte: { s: 'bd' } }] };
  assert.ok(pruefeAntwort(gut));
  const mit = (e) => ({ ...gut, ereignisse: [{ ...gut.ereignisse[0], ...e }] });
  assert.equal(pruefeAntwort(mit({ werte: null })), null);
  assert.equal(pruefeAntwort(mit({ beat: '0' })), null);
  assert.equal(pruefeAntwort(mit({ werte: { x: {} } })), null);
  assert.equal(pruefeAntwort({ ...gut, takte: NaN }), null);
  assert.equal(pruefeAntwort({ ...gut, ereignisse: new Array(20001).fill(gut.ereignisse[0]) }), null);
  assert.equal(pruefeAntwort(null), null);
});

// --- through the session --------------------------------------------------------------------------------------------------------------------------
const fehlerVon = async (p) => { try { await p; } catch (e) { return e; } return null; };
async function mitRb(t) {
  const { s, k } = sitzung(t);
  await s.neu('M', 'andreas');
  await s.aendern({ rev: 0, label: 'Track', befehle: [{ befehl: 'spur_neu', art: 'instrument', geraet: { art: 'intern', name: 'rb338' } }] }, 'andreas');
  return { s, k };
}

test('session: a crashing pattern is a 400 muster_zu_gross, the loop stays free during the call, the second call answers at once', { timeout: 30000 }, async (t) => {
  vergiss();
  const { s } = await mitRb(t);
  const befehl = { befehl: 'clip_aus_muster', spur_id: 's1', start_beat: 0, takte: 4, code: 'note("<c3 c3 c3 c3*1000000>")' };
  let e;
  const still = await stillstand(async () => { e = await fehlerVon(s.aendern({ rev: 1, label: 'p', befehle: [befehl] }, 'andreas')); });
  assert.equal(e?.grund ?? e?.fehler, 'muster_zu_gross', String(e)); kein_v8(String(e?.detail ?? e?.extra?.detail ?? ''));
  assert.ok(still < 50, `the event loop stood still for ${still.toFixed(1)} ms`);
  const t0 = performance.now();
  const e2 = await fehlerVon(s.aendern({ rev: 1, label: 'p', befehle: [befehl] }, 'andreas'));
  assert.equal(e2?.grund ?? e2?.fehler, 'muster_zu_gross');
  assert.ok(performance.now() - t0 < 500, `the second call took ${performance.now() - t0} ms (cached)`);
  assert.equal(s.aktuell().j.projekt.rev, 1, 'nothing was created');
});

test('session: a pattern for a clip that an earlier command of the same list makes (its length is only known in the run) is found by the dry run', async (t) => {
  vergiss();
  const { s } = await mitRb(t);
  const r = await s.aendern({ rev: 1, label: 'zwei', befehle: [
    { befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 0, laenge_beats: 8 },
    { befehl: 'clip_aus_muster', clip_id: 'c1', code: 'note("c3 e3")' }] }, 'andreas');
  assert.equal(r.code, 200);
  const clip = r.j.projekt.spuren[0].clips[0];
  assert.equal(clip.laenge_beats, 8); assert.equal(clip.muster.code, 'note("c3 e3")');
  assert.equal(r.j.muster[0].takte, 2);
});

test('session: more than 8 clip_aus_muster in one call are refused before any child starts', async (t) => {
  vergiss();
  const { s } = await mitRb(t);
  const befehle = Array.from({ length: 9 }, (_, i) => ({ befehl: 'clip_aus_muster', spur_id: 's1', start_beat: i * 4, code: `note("c${i % 5}")` }));
  const e = await fehlerVon(s.aendern({ rev: 1, label: 'viele', befehle }, 'andreas'));
  assert.deepEqual([e?.code, e?.fehler], [400, 'argument_ungueltig']);
  assert.equal(messung.kinderMax, 0, 'no child was started');
});
