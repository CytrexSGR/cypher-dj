// Hardening tests for wave_cache.ts (waveform sources and the per-instance waveform cache).
// Covers what tests/wave.test.mjs leaves out: loop names and fassung.json contents shaped like path traversal, corrupt
// and truncated fassung.json files, the time limit for absurd durations, many concurrent requests for the same and for
// different keys (shared run, at most one decoder, only the newest waiting job survives), failures that must not stick in
// the cache, aborts before start and while waiting, an empty file already in the cache, and the start-up cleanup with
// unusual file names.
//
// No real audio and no real waveform.py: the decoder (ffmpeg) and the calculator (python waveform.py) are replaced by small
// synthetic shell scripts written per test. They log every start and end, so the tests count processes and check overlap.
//
// Mutation check (how "demonstrably fails" was verified): the last test loads broken copies of wave_cache.ts through
// tests/fixtures/hardening/mutant.mjs (shared run map not filled, decoder started even while another one runs, LOOP_NAME
// check removed) and asserts that the check functions used by the normal tests reject them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import * as echt from '../wave_cache.ts';
import { ladeMutante, tmpDir } from './fixtures/hardening/mutant.mjs';

const fehler = (code, text) => (e) => e instanceof Error && e.code === code && (text === undefined || e.message === text);

// Synthetic tools in `d`: python.sh (file mode: <datei> <ziel>; stream mode: --strom <rate> <teil>) and ffmpeg.sh.
// Control files in `d`: schlaf (seconds python sleeps), rc (python exit code), ffschlaf (seconds ffmpeg sleeps).
function werkzeuge(d) {
  const py = path.join(d, 'python.sh'), ff = path.join(d, 'ffmpeg.sh');
  fs.writeFileSync(py, `d=$(dirname "$0")
s=$(cat "$d/schlaf" 2>/dev/null || echo 0)
if [ "$1" = "--strom" ]; then cat > /dev/null; echo "py $3" >> "$d/py.log"; sleep "$s"; printf 'DJKW-strom' > "$3"; exit 0; fi
echo "$1" >> "$d/aufrufe.log"
sleep "$s"
if [ -f "$d/rc" ]; then echo "kaputt" >&2; exit "$(cat "$d/rc")"; fi
printf 'DJKW-datei' > "$2.neu" && mv "$2.neu" "$2"
`);
  fs.writeFileSync(ff, `d=$(dirname "$0")
for a; do q="$a"; done
echo "start" >> "$d/ff.log"
sleep "$(cat "$d/ffschlaf" 2>/dev/null || echo 0)"
head -c 4800 /dev/zero
echo "ende" >> "$d/ff.log"
`);
  const zeilen = (n) => { try { return fs.readFileSync(path.join(d, n), 'utf8').split('\n').filter(Boolean); } catch { return []; } };
  return { py, ff, aufrufe: () => zeilen('aufrufe.log'), ffLog: () => zeilen('ff.log'), setze: (n, w) => fs.writeFileSync(path.join(d, n), String(w)), weg: (n) => fs.rmSync(path.join(d, n), { force: true }) };
}
function cache(m, t, o = {}) {
  const d = tmpDir(t);
  const w = werkzeuge(d);
  const c = new m.WelleCache(path.join(d, 'cache'), '/bin/sh', w.py, undefined, { ffmpeg: ['/bin/sh', w.ff], ...o });
  const quelle = path.join(d, 'quelle.f32'); fs.writeFileSync(quelle, 'synthetic');
  return { d, w, c, quelle, ordner: path.join(d, 'cache') };
}

// ---- check functions (normal tests and mutation checks) ----
async function pruefeGeteilt(m, t) {
  const { w, c, quelle } = cache(m, t);
  w.setze('schlaf', 0.3);
  const q = { datei: quelle, schluessel: 'fassung-geteilt' };
  const r = await Promise.allSettled(Array.from({ length: 12 }, () => c.hole(q)));
  assert.equal(w.aufrufe().length, 1, '12 concurrent requests for one key share one run');
  assert.deepEqual(r.map((x) => x.status), Array(12).fill('fulfilled'));
  const alle = r.map((x) => x.value);
  assert.equal(new Set(alle).size, 1);
  assert.equal(fs.readFileSync(alle[0], 'utf8'), 'DJKW-datei');
}

async function pruefeEinDekodierer(m, t) {
  const { w, c, quelle } = cache(m, t);
  w.setze('ffschlaf', 0.25);
  const q = (k) => ({ datei: quelle, schluessel: `datei-v2-${k}`, dekodieren: true, dauerS: 10 });
  // settle everything before asserting, so a broken copy leaves no activity behind the test
  const [a, b, cc] = await Promise.allSettled([c.hole(q('a')), c.hole(q('b')), c.hole(q('c'))]);
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(b.status === 'rejected' && fehler(429, 'verdraengt')(b.reason), 'the waiting job is replaced by the newer one');
  assert.match(a.value ?? '', /datei-v2-a\.welle$/);
  assert.match(cc.value ?? '', /datei-v2-c\.welle$/);
  assert.deepEqual(w.ffLog(), ['start', 'ende', 'start', 'ende'], 'never two decoders at the same time, the replaced one never starts');
}

function pruefeLoopNamen(m, t) {
  const d = tmpDir(t);
  fs.mkdirSync(path.join(d, 'loops', 'gut'), { recursive: true }); fs.writeFileSync(path.join(d, 'loops', 'gut', 'loop.f32'), 'x');
  fs.mkdirSync(path.join(d, 'geheim')); fs.writeFileSync(path.join(d, 'geheim', 'loop.f32'), 'x');
  for (const n of ['../geheim', '..', '.', '', 'a/b', 'gut/', 'GUT', 'güt', 'x'.repeat(33), 'gut\u0000', 'gut ', '%2e%2e']) {
    assert.throws(() => m.loopQuelle(path.join(d, 'loops'), n), fehler(400, 'unbekannter_loop'), JSON.stringify(n));
  }
  assert.match(m.loopQuelle(path.join(d, 'loops'), 'gut').schluessel, /^loop-gut-\d+-1$/);
}

// ---- sources ----
test('welle_cache hardening: loop names shaped like path traversal, Unicode or too long are 400', (t) => pruefeLoopNamen(echt, t));

test('welle_cache hardening: the loop key changes with the content (size and mtime), a missing loop is 404', (t) => {
  const d = tmpDir(t);
  const f = path.join(d, 'l1', 'loop.f32'); fs.mkdirSync(path.dirname(f)); fs.writeFileSync(f, 'x');
  const k1 = echt.loopQuelle(d, 'l1').schluessel;
  fs.writeFileSync(f, 'xy');
  const k2 = echt.loopQuelle(d, 'l1').schluessel;
  assert.notEqual(k1, k2);
  assert.throws(() => echt.loopQuelle(d, 'l2'), fehler(404, 'loop_fehlt'));
});

test('welle_cache hardening: fassungQuelle rejects malformed ids and numbers, and corrupt fassung.json is 404', (t) => {
  const d = tmpDir(t);
  const ordner = path.join(d, 'aaaaaaaaaaaaaaaa', 'fassungen', '128000_r1'); fs.mkdirSync(ordner, { recursive: true });
  fs.writeFileSync(path.join(ordner, 'basis.f32'), 'x');
  for (const [mat, bpm, f] of [['../../etc/pass', 128, 1], ['AAAAAAAAAAAAAAAA', 128, 1], ['aaaaaaaaaaaaaaaa', NaN, 1], ['aaaaaaaaaaaaaaaa', Infinity, 1], ['aaaaaaaaaaaaaaaa', 128, 1.5], ['aaaaaaaaaaaaaaaa', 128, NaN]]) {
    assert.throws(() => echt.fassungQuelle(d, mat, bpm, f), fehler(400, 'unbekannte_fassung'), JSON.stringify([mat, bpm, f]));
  }
  const sha = 'b'.repeat(64);
  for (const j of ['', '{', `{"sha256":"${sha}"`, '[]', '"text"', '{}', '{"datei":"basis.f32"}', `{"sha256":"${sha}","datei":"fehlt.f32"}`]) {
    fs.writeFileSync(path.join(ordner, 'fassung.json'), j);
    assert.throws(() => echt.fassungQuelle(d, 'aaaaaaaaaaaaaaaa', 128, 1), fehler(404, 'fassung_fehlt'), JSON.stringify(j));
  }
  fs.writeFileSync(path.join(ordner, 'fassung.json'), JSON.stringify({ sha256: sha }));
  assert.deepEqual(echt.fassungQuelle(d, 'aaaaaaaaaaaaaaaa', 128.0004, 1), { datei: path.join(ordner, 'basis.f32'), schluessel: `fassung-${sha}` }, 'BPM rounded to 1/1000');
});

test('welle_cache hardening: fassung.json cannot point outside the version folder or the cache, and "null" is 404',
  (t) => {
    const d = tmpDir(t);
    const ordner = path.join(d, 'aaaaaaaaaaaaaaaa', 'fassungen', '128000_r1'); fs.mkdirSync(ordner, { recursive: true });
    fs.writeFileSync(path.join(ordner, 'basis.f32'), 'x');
    fs.writeFileSync(path.join(d, 'fremd.f32'), 'x');
    const mit = (j) => { fs.writeFileSync(path.join(ordner, 'fassung.json'), j); return () => echt.fassungQuelle(d, 'aaaaaaaaaaaaaaaa', 128, 1); };
    assert.throws(mit('null'), fehler(404, 'fassung_fehlt'));
    assert.throws(mit(JSON.stringify({ sha256: 'b'.repeat(64), datei: '../../../fremd.f32' })), fehler(404, 'fassung_fehlt'));
    let q = null;
    try { q = mit(JSON.stringify({ sha256: '/../../../../tmp/entwischt' }))(); } catch { /* rejected: fine */ }
    if (q) {
      const ziel = path.resolve(path.join(d, 'cache'), `${q.schluessel}.welle`);
      assert.ok(ziel.startsWith(path.join(d, 'cache') + path.sep), `cache target ${ziel} escapes the cache folder`);
    }
  });

test('welle_cache hardening: dateiQuelle — missing file 404, key from the sha, null duration becomes undefined', (t) => {
  const d = tmpDir(t);
  assert.throws(() => echt.dateiQuelle(path.join(d, 'weg.wav'), 'a'.repeat(64)), fehler(404, 'datei_fehlt'));
  const f = path.join(d, 'Grüße 🎵 (1).wav'); fs.writeFileSync(f, 'x');
  assert.deepEqual(echt.dateiQuelle(f, 'c'.repeat(64), null), { datei: f, schluessel: `datei-v2-${'c'.repeat(64)}`, dekodieren: true, dauerS: undefined });
});

// ---- time limit ----
test('welle_cache hardening: zeitlimitVorgabe for missing, zero, negative and NaN durations assumes one hour', () => {
  for (const d of [undefined, 0, -5, NaN, -Infinity]) assert.equal(echt.zeitlimitVorgabe(d), 390_000, String(d));
  assert.equal(echt.zeitlimitVorgabe(300), 60_000);
  assert.equal(echt.zeitlimitVorgabe(0.001), 30_000);
});

test('welle_cache hardening: an absurd duration (corrupt tag: 1e8 s) gives a long time limit, not an immediate timeout',
  async (t) => {
    const { w, c, quelle } = cache(echt, t);
    w.setze('ffschlaf', 0.2);
    assert.match(await c.hole({ datei: quelle, schluessel: 'datei-v2-lang', dekodieren: true, dauerS: 1e8 }), /datei-v2-lang\.welle$/);
    assert.ok(echt.zeitlimitVorgabe(1e8) <= 2 ** 31 - 1);
  });

// ---- concurrency ----
test('welle_cache hardening: 12 concurrent requests for one fassung key start one calculation', (t) => pruefeGeteilt(echt, t));

test('welle_cache hardening: different keys run in parallel; a failure rejects all waiters and is retried on the next request', async (t) => {
  const { w, c, quelle } = cache(echt, t);
  w.setze('schlaf', 0.2);
  const r = await Promise.all(['x', 'y', 'z'].map((k) => c.hole({ datei: quelle, schluessel: `fassung-${k}` })));
  assert.equal(new Set(r).size, 3);
  assert.equal(w.aufrufe().length, 3);
  w.setze('rc', 3);
  const q = { datei: quelle, schluessel: 'fassung-kaputt' };
  const fehl = await Promise.allSettled([c.hole(q), c.hole(q), c.hole(q)]);
  for (const f of fehl) assert.ok(f.status === 'rejected' && f.reason.code === 500 && /^welle\.py rc 3: kaputt/.test(f.reason.message));
  assert.equal(w.aufrufe().length, 4, 'one failed run for three waiters');
  w.weg('rc');
  assert.match(await c.hole(q), /fassung-kaputt\.welle$/, 'the failure is not cached');
  assert.equal(w.aufrufe().length, 5);
  assert.equal(await c.hole(q), await c.hole(q), 'later requests come from the file');
  assert.equal(w.aufrufe().length, 5);
});

test('welle_cache hardening: decoding — at most one decoder, only the newest waiting job survives, same key shares the run', (t) => pruefeEinDekodierer(echt, t));

test('welle_cache hardening: decoding — five requests for one key share one decoder', async (t) => {
  const { w, c, quelle } = cache(echt, t);
  w.setze('ffschlaf', 0.2);
  const q = { datei: quelle, schluessel: 'datei-v2-gleich', dekodieren: true, dauerS: 5 };
  const r = await Promise.all(Array.from({ length: 5 }, () => c.hole(q)));
  assert.equal(new Set(r).size, 1);
  assert.deepEqual(w.ffLog(), ['start', 'ende']);
  assert.equal(fs.readFileSync(r[0], 'utf8'), 'DJKW-strom');
});

test('welle_cache hardening: decoding — an already aborted signal is 499 without a process; aborting the waiting job leaves the runner alone', async (t) => {
  const { w, c, quelle, ordner } = cache(echt, t);
  const ab = new AbortController(); ab.abort();
  await assert.rejects(c.hole({ datei: quelle, schluessel: 'datei-v2-vorab', dekodieren: true }, ab.signal), fehler(499, 'abgebrochen'));
  assert.deepEqual(w.ffLog(), []);
  w.setze('ffschlaf', 0.25);
  const laeuft = c.hole({ datei: quelle, schluessel: 'datei-v2-erst', dekodieren: true, dauerS: 5 });
  const ab2 = new AbortController();
  const wartet = c.hole({ datei: quelle, schluessel: 'datei-v2-zweit', dekodieren: true, dauerS: 5 }, ab2.signal);
  ab2.abort();
  await assert.rejects(wartet, fehler(499, 'abgebrochen'));
  assert.match(await laeuft, /datei-v2-erst\.welle$/);
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(w.ffLog(), ['start', 'ende'], 'the aborted waiting job never started');
  assert.deepEqual(fs.readdirSync(ordner).sort(), ['datei-v2-erst.welle'], 'no .teil or .neu left behind');
});

// ---- corrupt cache content ----
test('welle_cache hardening: a cached file is served without a new run, whatever its name characters', async (t) => {
  const { w, c, quelle, ordner } = cache(echt, t);
  fs.mkdirSync(ordner, { recursive: true });
  fs.writeFileSync(path.join(ordner, 'fassung-ä ö.welle'), 'DJKW-alt');
  assert.equal(await c.hole({ datei: quelle, schluessel: 'fassung-ä ö' }), path.join(ordner, 'fassung-ä ö.welle'));
  assert.deepEqual(w.aufrufe(), []);
});

test('welle_cache hardening: an empty file in the cache (crash after rename without fsync) is recalculated, not served forever',
  async (t) => {
    const { w, c, quelle, ordner } = cache(echt, t);
    fs.mkdirSync(ordner, { recursive: true });
    fs.writeFileSync(path.join(ordner, 'fassung-leer.welle'), '');
    const p = await c.hole({ datei: quelle, schluessel: 'fassung-leer' });
    assert.ok(fs.statSync(p).size > 0);
    assert.equal(w.aufrufe().length, 1);
  });

// ---- start-up cleanup ----
test('welle_cache hardening: start-up cleanup removes leftovers of dead PIDs and old .neu files, keeps everything else', async (t) => {
  const d = tmpDir(t);
  const ordner = path.join(d, 'cache'); fs.mkdirSync(ordner);
  const tot = await new Promise((ok) => { const p = spawn('true'); p.once('exit', () => ok(p.pid)); });
  const datei = (n, alt = false) => { const p = path.join(ordner, n); fs.writeFileSync(p, 'x'); if (alt) { const z = new Date(Date.now() - 11 * 60_000); fs.utimesSync(p, z, z); } return n; };
  const weg = [datei(`a.welle.${tot}.teil`), datei(`b.welle.${tot}.teil.neu`), datei(`c.welle.${tot}.f32`), datei('d.welle.neu', true)];
  const bleibt = [datei(`e.welle.${process.pid}.teil`), datei('f.welle.neu'), datei('g.welle'), datei('notiz.txt'), datei('h.welle.abc.teil'), datei('Größe 🎵.welle')];
  fs.mkdirSync(path.join(ordner, `verzeichnis.${tot}.teil`));
  fs.writeFileSync(path.join(ordner, `verzeichnis.${tot}.teil`, 'inhalt'), 'x');
  bleibt.push(`verzeichnis.${tot}.teil`);
  new echt.WelleCache(ordner, '/bin/false', '/nicht/da');
  const jetzt = fs.readdirSync(ordner);
  for (const n of weg) assert.ok(!jetzt.includes(n), `${n} removed`);
  for (const n of bleibt) assert.ok(jetzt.includes(n), `${n} kept`);
  assert.doesNotThrow(() => new echt.WelleCache(path.join(d, 'gibt-es-nicht'), '/bin/false', '/nicht/da'), 'a missing folder is no error');
});

// ---- mutation checks ----
test('welle_cache hardening, mutation check: the checks above reject broken copies of wave_cache.ts', async (t) => {
  const ohneTeilen = await ladeMutante(t, 'wave_cache.ts', [['this.laufend.set(q.schluessel, p);', '']]);
  await assert.rejects(() => pruefeGeteilt(ohneTeilen, t), assert.AssertionError, 'without the shared run map every request starts waveform.py');
  const immerStarten = await ladeMutante(t, 'wave_cache.ts', [['if (this.lauf === null) this.starte(a);\n      else {', 'if (true) this.starte(a);\n      else {']]);
  await assert.rejects(() => pruefeEinDekodierer(immerStarten, t), assert.AssertionError, 'two decoders would run at the same time');
  const ohneName = await ladeMutante(t, 'wave_cache.ts', [["if (!LOOP_NAME.test(name)) throw new WelleFehler(400, 'unbekannter_loop');", '']]);
  assert.throws(() => pruefeLoopNamen(ohneName, t), assert.AssertionError, 'without LOOP_NAME ../geheim reaches a foreign loop');
});
