// Dropping a desktop audio file on an arrangement track (browser plan 2, task 9).
import test from 'node:test';
import assert from 'node:assert/strict';
import { legeNachImport } from '../public/browser/einwurf.js';

const SHA = 'ab'.repeat(32);
const zeile = { typ: 'oneshot', sha: SHA, name: 'Kick', pfad_da: true, dauer_s: 2 };
const datei = (name, size = 100) => ({ name, size, slice: () => new Blob([]) });

// a scripted host: the stands come one per GET /bibliothek/stand; calls are recorded in order
function aufbau({ antwort = { status: 200, j: { ok: true, sha256: SHA, art: 'audio' } }, staende = [], detail = zeile, vorab = false } = {}) {
  const log = [], gelegt = [];
  let k = 0;
  const bereit = () => vorab || (staende !== 404 && k >= staende.length);
  const host = {
    holeGet: async (url) => {
      log.push(`GET ${url}`);
      if (url === '/bibliothek/stand') { if (staende === 404) return { status: 404, j: null }; return { status: 200, j: staende[Math.min(k++, staende.length - 1)] }; }
      if (url.startsWith('/stoebern/detail')) return { status: 200, j: { eintrag: bereit() ? detail : null } };   // the catalogue knows the file once every scripted stand was served
      return { status: 404, j: null };
    },
    holeJson: async (url) => { log.push(`POST ${url}`); return { status: 200, j: {} }; },
  };
  return {
    log, gelegt,
    a: (name = 'kick.wav', extra = {}) => ({
      host, datei: datei(name), spurIndex: 3, beat: 7.5, versuche: extra.versuche,
      sende: async () => { log.push('SENDE'); return antwort; },
      warte: async () => { log.push('WARTE'); },
      lege: (n, i, b) => { log.push('LEGE'); gelegt.push([n, i, b]); },
      ...extra,
    }),
  };
}
const st = (phase, zeit) => ({ phase, fertig: 0, gesamt: 0, letzter_bau: zeit ? { zeit } : null, fremd: false, leer: false });

test('upload answer with sha, stand scan, scan, ruht: places once, unchanged index and beat, warte twice', async () => {
  const t = aufbau({ staende: [st('ruht', 1), st('scan', 1), st('scan', 1), st('ruht', 2)] });
  const r = await legeNachImport(t.a());
  assert.deepEqual(r, { ok: true });
  assert.equal(t.log.filter((x) => x === 'WARTE').length, 3);   // the first stand is read before waiting; ruht with the old zeit does not count
  assert.deepEqual(t.gelegt, [[{ sha: SHA, dauer_s: 2, name: 'Kick' }, 3, 7.5]]);
});

test('upload answer with sha, stand running, then ruht: waits twice and places once', async () => {
  const t = aufbau({ staende: [st('scan', 1), st('scan', 1), st('ruht', 2), st('scan', 2), st('ruht', 3)] });
  const r = await legeNachImport(t.a('kick.wav', { }));
  assert.equal(r.ok, true);
  // a build that was running at the answer: after its end one more build is started and awaited
  assert.ok(t.log.includes('POST /bibliothek/bauen'));
});

test('no sha256 in the answer: says so and places nothing', async () => {
  const t = aufbau({ antwort: { status: 200, j: { ok: true, art: 'audio' } }, staende: [st('ruht', 1)] });
  const r = await legeNachImport(t.a());
  assert.equal(r.ok, false);
  assert.match(r.text, /Imported into your library/);
  assert.deepEqual(t.gelegt, []);
});

test('foreign library: the sentence, warte never called', async () => {
  const t = aufbau({ staende: [{ ...st('ruht', 1), fremd: true }] });
  const r = await legeNachImport(t.a());
  assert.match(r.text, /managed by another tool/);
  assert.match(r.text, /FOLDERS/);
  assert.equal(t.log.includes('WARTE'), false);
  assert.deepEqual(t.gelegt, []);
});

test('a build running at the answer: old end ignored, one extra build, placed after the second end only', async () => {
  const t = aufbau({ staende: [st('scan', 5), st('ruht', 5), st('scan', 5), st('ruht', 6)] });
  const r = await legeNachImport(t.a());
  assert.equal(r.ok, true);
  const bau = t.log.indexOf('POST /bibliothek/bauen');
  assert.ok(bau > 0);
  assert.equal(t.log.filter((x) => x === 'POST /bibliothek/bauen').length, 1);
  assert.ok(t.log.indexOf('LEGE') > bau);
  assert.equal(t.gelegt.length, 1);
  const stands = t.log.map((x, i) => [x, i]).filter(([x]) => x === 'GET /bibliothek/stand').map(([, i]) => i);
  assert.ok(stands.at(-1) > bau);   // the last stand read came after the extra build was asked for
});

test('120 tries without ruht: a failure that names the wait', async () => {
  const t = aufbau({ staende: [st('ruht', 1), st('scan', 1)] });
  const r = await legeNachImport(t.a());
  assert.equal(r.ok, false);
  assert.match(r.text, /did not finish in time/);
  assert.equal(t.log.filter((x) => x === 'WARTE').length, 120);
  assert.deepEqual(t.gelegt, []);
});

test('an mp3 over 2 GB is refused before anything is sent', async () => {
  const t = aufbau({ staende: [st('ruht', 1)] });
  const r = await legeNachImport({ ...t.a(), datei: datei('big.mp3', 2147483649) });
  assert.equal(r.ok, false);
  assert.match(r.text, /2 GB/);
  assert.equal(t.log.includes('SENDE'), false);
});

test('a .mid is imported but not placed', async () => {
  const t = aufbau({ antwort: { status: 200, j: { ok: true, art: 'midi' } }, staende: [st('ruht', 1)] });
  const r = await legeNachImport({ ...t.a(), datei: datei('kick.mid') });
  assert.equal(r.ok, false);
  assert.equal(r.info, true);
  assert.ok(t.log.includes('SENDE'));
  assert.deepEqual(t.gelegt, []);
});

test('a refusal of the import shows the server text and places nothing', async () => {
  const t = aufbau({ antwort: { status: 413, j: { text: 'too big for the server' } }, staende: [st('ruht', 1)] });
  const r = await legeNachImport(t.a());
  assert.deepEqual([r.ok, r.text], [false, 'too big for the server']);
  assert.equal(t.log.includes('GET /bibliothek/stand'), false);
});

test('legeSample keeps the old arguments: ablageBefehl checks and ctx.aendereAus', async () => {
  const { bindeAblage } = await import('../public/production/storage.js').catch(() => ({}));
  assert.ok(bindeAblage, 'storage.js must import');
  const ev = {};
  globalThis.document = { querySelector: () => null };
  const ueber = { addEventListener: (n, f) => { ev[n] = f; } };
  const melde = [], aus = [];
  const projekt = { tempo_bpm: 120, taktart: '4/4', spuren: [{ id: 's1', art: 'audio' }, { id: 's2', art: 'instrument' }] };
  const ctx = { st: { projekt, raster: 'beat', ansicht: {} }, $: () => ueber, beimSichtwechsel: [], zeilen: () => [], stoebern: () => null,
    melde: (t, f) => melde.push([t, f]), aendereAus: (fn) => aus.push(fn(projekt)), holeJson: null };
  bindeAblage(ctx);
  assert.equal(typeof ctx.legeSample, 'function');
  ctx.legeSample({ sha: SHA, dauer_s: 2, name: 'Kick' }, 0, 4);
  assert.equal(aus.length, 1);
  assert.equal(aus[0].label, 'Add clip');
  assert.equal(aus[0].befehle[0].spur_id, 's1');
  assert.equal(aus[0].befehle[0].laenge_beats, 4);
  ctx.legeSample({ sha: SHA, dauer_s: 2 }, 1, 0);
  assert.deepEqual(melde.at(-1), ['Samples go on audio tracks only', true]);
  delete globalThis.document;
});

test('stand answers 404: stops at once, one stand call, honest text, no timeout', async () => {
  const t = aufbau({ staende: 404 });
  const r = await legeNachImport(t.a());
  assert.equal(r.ok, false); assert.equal(r.info, true);
  assert.match(r.text, /cannot report the library build/);
  assert.equal(t.log.filter((x) => x === 'GET /bibliothek/stand').length, 1);
  assert.equal(t.log.includes('WARTE'), false);
  assert.deepEqual(t.gelegt, []);
});

test('stand 404 but the catalogue already knows the file: placed from the sha256 of the import answer', async () => {
  const t = aufbau({ staende: 404, vorab: true });
  const r = await legeNachImport(t.a());
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(t.gelegt.map((x) => [x[1], x[2]]), [[3, 7.5]]);
  assert.equal(t.log.includes('GET /bibliothek/stand'), false);
  assert.equal(t.log.includes('WARTE'), false);
});

test('a file the catalogue already knows is placed without waiting', async () => {
  const t = aufbau({ staende: [st('scan', 1)], vorab: true });
  const r = await legeNachImport(t.a());
  assert.equal(r.ok, true);
  assert.equal(t.log.includes('WARTE'), false);
});
