// Browser plan 1, task 5: KatalogJob with a fake builder process (temp folders only; the real catalogue is never touched).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { KatalogJob, pruefeKatalogBeiStart } from '../catalog_job.ts';

const warte = (ms) => new Promise((ok) => setTimeout(ok, ms));
/** Resolves when the job reaches the phase (checked every 5 ms, a 20 s deadline only for a test that would hang): never a fixed sleep against a fake's run time. */
async function bisPhase(j, phase) {
  const ende = Date.now() + 20_000;
  while (j['phase'] !== phase) { if (Date.now() > ende) throw new Error(`the job never reached phase ${phase}`); await warte(5); }
}

/** A temp folder, a fake `python` (prints zeige.json for every call) and a `befehl` seam that runs a tiny node child. */
function stapel(t) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'katjob-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const python = path.join(d, 'python');
  fs.writeFileSync(python, `#!/bin/sh\ncat "${d}/zeige.json"\n`, { mode: 0o755 });
  const zeige = (o) => fs.writeFileSync(path.join(d, 'zeige.json'), JSON.stringify(o));
  zeige({ datei: 'bibliothek.json', ziel: path.join(d, 'katalog.sqlite'), zustand: 'absent', zaehlung: null, wurzeln: [] });
  const aufrufe = [];
  /** @param plan {stderr?: string[], stdout?: string, rc?: number, warteMs?: number} */
  let plan = { rc: 0 };
  let planA = { rc: 0, stdout: '{"ok":true,"analysiert":0,"mit_wert":0}' };   // the plan of the `analysieren` command
  let folge = [];                                                              // optional plans for the next builds, in order
  const befehl = (args, nice) => {
    aufrufe.push({ args, nice });
    const p = args[0] === 'analysieren' ? planA : folge.length ? folge.shift() : plan;
    const code = `const p=${JSON.stringify(p)};const L=p.stderr??[];const out=()=>{if(p.stdout)process.stdout.write(p.stdout+'\\n');setTimeout(()=>process.exit(p.rc??0),p.warteMs??0)};if(p.zeilenMs===undefined){for(const z of L)process.stderr.write(z+'\\n');out()}else{const e=(i)=>{if(i<L.length){process.stderr.write(L[i]+'\\n');setTimeout(()=>e(i+1),p.zeilenMs)}else out()};e(0)}`;
    return spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
  };
  const job = (o = {}) => { const j = new KatalogJob({ python, cwd: d, befehl, entprellMs: 60, ...o }); t.after(() => j.schliesse()); return j; };
  return { d, zeige, aufrufe, job, setze: (p) => { plan = p; }, setzeA: (p) => { planA = p; }, setzeFolge: (f) => { folge = [...f]; }, python, scope: (pfade) => fs.writeFileSync(path.join(d, 'analyse_quellen.json'), JSON.stringify({ schema: 1, pfade })) };
}

test('two starte() calls in a row spawn one process', async (t) => {
  const s = stapel(t);
  s.setze({ rc: 0, warteMs: 150 });
  const j = s.job();
  assert.deepEqual([j.starte(), j.starte()], [{ laeuft: true }, { laeuft: true }]);
  await j.ruht();
  assert.equal(s.aufrufe.length, 1);
  assert.deepEqual(s.aufrufe[0].args, ['bauen', '--fortschritt-json', '--midi-liste']);
  assert.equal(s.aufrufe[0].nice, 10);
});

test('phase and fertig/gesamt follow the progress lines and end at ruht with letzter_bau.rc 0', async (t) => {
  const s = stapel(t);
  s.setze({ stderr: ['{"phase":"scan","fertig":4,"gesamt":null}', 'scanned 1000 files', '{"phase":"merkmale","fertig":3,"gesamt":9}'], stdout: '{"ok":true,"zeilen":{"track":0,"loop":1,"oneshot":8},"dateien":9}', rc: 0, warteMs: 700 });
  const j = s.job();
  assert.equal((await j.stand()).phase, 'ruht');
  assert.equal((await j.stand()).letzter_bau, null);
  j.starte();
  await bisPhase(j, "merkmale");
  const m = await j.stand();
  assert.deepEqual([m.phase, m.fertig, m.gesamt], ['merkmale', 3, 9]);
  await j.ruht();
  const e = await j.stand();
  assert.equal(e.phase, 'ruht');
  assert.deepEqual([e.letzter_bau.rc, e.letzter_bau.dateien], [0, 9]);
  assert.equal(e.letzter_bau.grund, undefined);
});

for (const [rc, satz] of [[3, 'x was not built by djk-bibliothek and is left untouched.'], [4, 'library root is missing: /mnt/Platte (drive unplugged?)'], [5, 'cannot put the catalog at /x: no hard links'], [6, 'the scan found no audio files but the catalogue has rows.']]) {
  test(`exit ${rc}: letzter_bau.rc ${rc} and the grund is the last plain stderr line${rc === 3 ? ', fremd stays false while zeige does not say foreign' : ''}`, async (t) => {
    const s = stapel(t);
    s.setze({ stderr: ['{"phase":"scan","fertig":1,"gesamt":null}', 'djk-bibliothek: erste Zeile', satz], rc });
    const j = s.job();
    j.starte(); await j.ruht();
    const e = await j.stand();
    assert.equal(e.letzter_bau.rc, rc);
    assert.equal(e.letzter_bau.grund, satz);
    assert.equal(e.fremd, false, 'an exit 3 alone (a lost race) is no proof of a foreign catalogue');
    assert.equal(e.phase, 'ruht');
  });
}

test('exit 4 names the folder in the grund', async (t) => {
  const s = stapel(t);
  s.setze({ stderr: ['djk-bibliothek: library root is missing: /mnt/Musik'], rc: 4 });
  const j = s.job(); j.starte(); await j.ruht();
  assert.match((await j.stand()).letzter_bau.grund, /\/mnt\/Musik/);
});

test('a build with rc 0, dateien 0 and a non-empty MIDI list sets the hinweis', async (t) => {
  const s = stapel(t);
  s.setze({ stdout: '{"ok":true,"zeilen":{"track":0,"loop":0,"oneshot":0},"dateien":0}', rc: 0 });
  const j = s.job(); j.starte(); await j.ruht();
  assert.equal((await j.stand()).hinweis, undefined);
  fs.writeFileSync(path.join(s.d, 'katalog.sqlite.midi.json'), JSON.stringify({ schema: 1, dateien: [{ pfad: '/a/beat.mid', name: 'beat.mid', groesse: 4 }] }));
  assert.equal((await j.stand()).hinweis, 'only MIDI files so far, no audio to catalogue');
});

test('a child that is killed, or python missing, gives rc -1 with a grund and the job starts again', async (t) => {
  const s = stapel(t);
  const j = new KatalogJob({ python: path.join(s.d, 'gibt-es-nicht'), cwd: s.d, entprellMs: 60 });
  t.after(() => j.schliesse());
  j.starte(); await j.ruht();
  const e = await j.stand();
  assert.equal(e.letzter_bau.rc, -1);
  assert.equal(typeof e.letzter_bau.grund, 'string');
  assert.equal(e.phase, 'ruht');
  j.starte(); await j.ruht();   // startable again, no throw
  const k = s.job();
  s.setze({ stderr: [], rc: 0, warteMs: 5000 });
  k.starte();
  await warte(100);
  process.kill(k.pid(), 'SIGKILL');
  await k.ruht();
  assert.equal((await k.stand()).letzter_bau.rc, -1);
  assert.match((await k.stand()).letzter_bau.grund, /SIGKILL/);
});

test('anstoss three times within the debounce window spawns once; anstoss during a run spawns exactly one follow-up', async (t) => {
  const s = stapel(t);
  s.setze({ rc: 0, warteMs: 200 });
  const j = s.job();
  j.anstoss('a'); j.anstoss('b'); j.anstoss('c');
  await warte(120);
  assert.equal(s.aufrufe.length, 1);
  j.anstoss('mitten'); j.anstoss('mitten2'); j.anstoss('mitten3');
  await j.ruht();
  await warte(20);
  assert.equal(s.aufrufe.length, 2, 'one follow-up, not three');
});

test('schliesse kills a running child and leaves no timer', async (t) => {
  const s = stapel(t);
  s.setze({ rc: 0, warteMs: 20_000 });
  const j = s.job();
  j.starte();
  await warte(100);
  const pid = j.pid();
  await j.schliesse();
  await assert.rejects(async () => process.kill(pid, 0), /ESRCH/);
  j.anstoss('nach dem Schliessen');
  await warte(150);
  assert.equal(s.aufrufe.length, 1, 'no start after schliesse');
  const j2 = s.job(); j2.anstoss('x'); await j2.schliesse(); await warte(150);
  assert.equal(s.aufrufe.length, 1, 'the debounce timer of a closed job is cleared');
});

test('the default command lowers the priority of the child to nice 10', async (t) => {
  const s = stapel(t);
  const sleeper = path.join(s.d, 'schlaf');
  fs.writeFileSync(sleeper, '#!/bin/sh\nsleep 2\n', { mode: 0o755 });
  const j = new KatalogJob({ python: sleeper, cwd: s.d });
  t.after(() => j.schliesse());
  j.starte();
  await warte(150);
  assert.equal(os.getPriority(j.pid()), 10);
  await j.schliesse();
});

test('stand: katalog counts come from zeige, a foreign catalogue is fremd', async (t) => {
  const s = stapel(t);
  s.zeige({ ziel: path.join(s.d, 'k.sqlite'), zustand: 'own', zaehlung: { zeilen: { track: 1, loop: 2, oneshot: 3 } }, wurzeln: [{ pfad: '/a', typ: 'auto' }] });
  const j = s.job();
  const a = await j.stand();
  assert.deepEqual(a.katalog, { track: 1, loop: 2, oneshot: 3 });
  assert.equal(a.fremd, false);
  j.verwerfeZeige();
  s.zeige({ ziel: path.join(s.d, 'k.sqlite'), zustand: 'foreign', zaehlung: { track: 5 }, wurzeln: [] });
  const b = await j.stand();
  assert.deepEqual([b.fremd, b.leer], [true, false]);
});

test('six stand() calls at once run one zeige process; a later call after verwerfeZeige reads afresh', async (t) => {
  const s = stapel(t);
  let n = 0;
  class Zaehlt extends KatalogJob { lies(args) { n++; return super.lies(args); } }
  const j = new Zaehlt({ python: s.python, cwd: s.d, befehl: undefined, entprellMs: 60 });
  t.after(() => j.schliesse());
  await Promise.all([1, 2, 3, 4, 5, 6].map(() => j.stand()));
  assert.equal(n, 1);
  await j.stand();
  assert.equal(n, 1, 'cached');
  j.verwerfeZeige();
  await Promise.all([j.stand(), j.stand()]);
  assert.equal(n, 2);
});

test('the debounce waits the whole window: nothing before it, one build after it', async (t) => {
  const s = stapel(t);
  s.setze({ rc: 0 });
  const j = s.job({ entprellMs: 400 });
  j.anstoss('a');
  await warte(150);
  j.anstoss('b');   // a later request of the burst does not start earlier, nor push the start out
  assert.equal(s.aufrufe.length, 0, 'still waiting');
  await warte(150);
  assert.equal(s.aufrufe.length, 0, 'still inside the window');
  await warte(250);
  assert.equal(s.aufrufe.length, 1);
});

test('a child killed by a signal names the signal even when it had printed a plain line', async (t) => {
  const s = stapel(t);
  s.setze({ stderr: ['scanned 5 files (1 track, 0 loop, 0 oneshot, 0 skipped)'], rc: 0, warteMs: 5000 });
  const j = s.job();
  j.starte();
  await warte(200);
  process.kill(j.pid(), 'SIGTERM');
  await j.ruht();
  const e = (await j.stand()).letzter_bau;
  assert.equal(e.rc, -1);
  assert.match(e.grund, /SIGTERM/);
});

test('a catalogue marked foreign by zeige is fremd also when the last build exited 0', async (t) => {
  const s = stapel(t);
  s.zeige({ ziel: path.join(s.d, 'k.sqlite'), zustand: 'foreign', zaehlung: null, wurzeln: [] });
  s.setze({ rc: 0 });
  const j = s.job();
  j.starte(); await j.ruht();
  assert.equal((await j.stand()).fremd, true);
});

test('pruefeKatalogBeiStart: the studio asks the job, a test instance never does, a failure is logged and not thrown', async () => {
  const n = []; const logs = [];
  const job = { pruefeBeiStart: async () => { n.push(1); } };
  await pruefeKatalogBeiStart(job, '', (e) => logs.push(e));
  assert.equal(n.length, 1);
  await pruefeKatalogBeiStart(job, 'b', (e) => logs.push(e));
  await pruefeKatalogBeiStart(job, 'i', (e) => logs.push(e));
  assert.equal(n.length, 1);
  await pruefeKatalogBeiStart({ pruefeBeiStart: async () => { throw new Error('kaputt'); } }, '', (e) => logs.push(e));
  assert.deepEqual(logs, [{ typ: 'katalog_start_pruefung', fehler: 'kaputt' }]);
});

// ---- task 8: the analysis phase ----
const BAU = (n) => ({ stderr: ['{"phase":"scan","fertig":1,"gesamt":null}', '{"phase":"merkmale","fertig":1,"gesamt":' + n + '}', '{"phase":"schreiben","fertig":0,"gesamt":1}'], stdout: `{"ok":true,"zeilen":{"track":0,"loop":${n},"oneshot":0},"dateien":${n}}`, rc: 0, warteMs: 150, zeilenMs: 60 });
const ANALYSE = (mit) => ({ stderr: ['{"phase":"analyse","fertig":0,"gesamt":4}', '{"phase":"analyse","fertig":2,"gesamt":4}'], stdout: `{"ok":true,"analysiert":4,"mit_wert":${mit}}`, rc: 0, warteMs: 150, zeilenMs: 60 });

test('rc 0 build, then analysis, then one more build: the phases run ruht, scan, merkmale, schreiben, analyse, scan, schreiben, ruht', async (t) => {
  const s = stapel(t);
  s.scope(['/musik/importe']);
  s.setzeFolge([BAU(4), { stderr: ['{"phase":"scan","fertig":1,"gesamt":null}', '{"phase":"schreiben","fertig":0,"gesamt":1}'], stdout: '{"ok":true,"dateien":4}', rc: 0, warteMs: 150, zeilenMs: 60 }]);
  s.setzeA(ANALYSE(3));
  const j = s.job();
  const phasen = [(await j.stand()).phase];
  const uhr = setInterval(() => { j.stand().then((e) => { if (phasen.at(-1) !== e.phase) phasen.push(e.phase); }); }, 15);
  j.starte(); await j.ruht();
  await warte(40); clearInterval(uhr);
  assert.deepEqual(phasen, ['ruht', 'scan', 'merkmale', 'schreiben', 'analyse', 'scan', 'schreiben', 'ruht']);
  assert.deepEqual(s.aufrufe.map((a) => a.args[0]), ['bauen', 'analysieren', 'bauen']);
  assert.deepEqual(s.aufrufe[1].args, ['analysieren', '--unter', '/musik/importe', '--max', '300', '--fortschritt-json']);
});

test('analysis uses nice 19 and the builds nice 10; letzter_bau describes the last build, not the analysis', async (t) => {
  const s = stapel(t);
  s.scope(['/a', '/b']);
  s.setzeFolge([BAU(4), BAU(4)]);
  s.setzeA(ANALYSE(1));
  const j = s.job();
  j.starte(); await j.ruht();
  assert.deepEqual(s.aufrufe.map((a) => a.nice), [10, 19, 10]);
  assert.deepEqual(s.aufrufe[1].args.filter((x) => x.startsWith('/')), ['/a', '/b']);
  const e = (await j.stand()).letzter_bau;
  assert.deepEqual([e.rc, e.dateien], [0, 4]);
});

test('an analysis with mit_wert 0 triggers no second build', async (t) => {
  const s = stapel(t);
  s.scope(['/a']);
  s.setze(BAU(2));
  s.setzeA(ANALYSE(0));
  const j = s.job();
  j.starte(); await j.ruht();
  assert.deepEqual(s.aufrufe.map((a) => a.args[0]), ['bauen', 'analysieren']);
});

test('no scope file, an empty one or an unreadable one skips the analysis phase', async (t) => {
  const s = stapel(t);
  s.setze(BAU(2));
  const j = s.job();
  j.starte(); await j.ruht();
  s.scope([]);
  j.starte(); await j.ruht();
  fs.writeFileSync(path.join(s.d, 'analyse_quellen.json'), '{kaputt');
  j.starte(); await j.ruht();
  assert.deepEqual([...new Set(s.aufrufe.map((a) => a.args[0]))], ['bauen']);
  assert.equal(s.aufrufe.length, 3);
});

for (const rc of [3, 4, 5, 6]) {
  test(`a failed build (rc ${rc}) never starts the analysis`, async (t) => {
    const s = stapel(t);
    s.scope(['/a']);
    s.setze({ stderr: ['ein Grund'], rc });
    const j = s.job();
    j.starte(); await j.ruht();
    assert.deepEqual(s.aufrufe.map((a) => a.args[0]), ['bauen']);
    assert.equal((await j.stand()).letzter_bau.rc, rc);
  });
}

test('an analysis that exits non-zero or is killed leaves letzter_bau alone, starts no second build and the job starts again', async (t) => {
  const s = stapel(t);
  s.scope(['/a']);
  s.setze(BAU(2));
  s.setzeA({ stderr: ['kaputt'], rc: 1 });
  const j = s.job();
  j.starte(); await j.ruht();
  const a = (await j.stand()).letzter_bau;
  assert.deepEqual(s.aufrufe.map((x) => x.args[0]), ['bauen', 'analysieren']);
  assert.deepEqual([a.rc, a.dateien], [0, 2]);
  assert.equal((await j.stand()).phase, 'ruht');
  s.setzeA({ rc: 0, warteMs: 5000 });
  j.starte();
  await bisPhase(j, "analyse");
  const kind = j.pid();
  assert.ok(kind);
  process.kill(kind, 'SIGKILL');
  await j.ruht();
  assert.equal((await j.stand()).letzter_bau.rc, 0, 'a killed analysis is not a failed build');
  s.setzeA(ANALYSE(0));
  j.starte(); await j.ruht();   // startable again
  assert.equal(s.aufrufe.at(-1).args[0], 'analysieren');
});

test('anstoss during the analysis kills nothing and sets exactly one follow-up run', async (t) => {
  const s = stapel(t);
  s.scope(['/a']);
  s.setze(BAU(2));
  s.setzeA({ rc: 0, stdout: '{"ok":true,"analysiert":1,"mit_wert":0}', warteMs: 300 });
  const j = s.job();
  j.starte();
  await bisPhase(j, "analyse");
  assert.equal((await j.stand()).phase, 'analyse');
  j.anstoss('a'); j.anstoss('b'); j.anstoss('c');
  await j.ruht();
  assert.deepEqual(s.aufrufe.map((x) => x.args[0]), ['bauen', 'analysieren', 'bauen', 'analysieren']);
});

test('schliesse during the analysis kills the child and no further command starts', async (t) => {
  const s = stapel(t);
  s.scope(['/a']);
  s.setze(BAU(2));
  s.setzeA({ rc: 0, stdout: '{"ok":true,"analysiert":1,"mit_wert":1}', warteMs: 5000 });
  const j = s.job();
  j.starte();
  await bisPhase(j, "analyse");
  assert.equal((await j.stand()).phase, 'analyse');
  const pid = j.pid();
  await j.schliesse();
  await j.ruht();
  assert.throws(() => process.kill(pid, 0));
  assert.deepEqual(s.aufrufe.map((x) => x.args[0]), ['bauen', 'analysieren']);
});

test('the analysis child gets --max and a wall-clock limit: past it the child is killed, the job leaves analyse with a reason and does not build again', async (t) => {
  const s = stapel(t);
  s.scope(['/a']);
  s.setze(BAU(2));
  s.setzeA({ rc: 0, stdout: '{"ok":true,"analysiert":1,"mit_wert":1}', warteMs: 60_000 });
  const j = s.job({ analyseFristMs: 150, analyseMax: 7 });
  j.starte();
  await j.ruht();
  const a = s.aufrufe.find((x) => x.args[0] === 'analysieren');
  assert.equal(a.args[a.args.indexOf('--max') + 1], '7');
  assert.deepEqual(s.aufrufe.map((x) => x.args[0]), ['bauen', 'analysieren']);
  const e = await j.stand();
  assert.equal(e.phase, 'ruht');
  assert.match(e.analyse_grund, /time limit/);
  assert.equal(e.letzter_bau.rc, 0, 'the build record is not touched by the analysis');
  assert.equal(j.pid(), undefined);
});

test('a foreign catalogue gets no analyse_quellen.json next to it', async (t) => {
  const s = stapel(t);
  s.zeige({ ziel: path.join(s.d, 'k.sqlite'), zustand: 'foreign', zaehlung: null, wurzeln: [] });
  const j = s.job();
  await j['scopeAendern']('/tmp/x', true);
  assert.equal(fs.existsSync(path.join(s.d, 'analyse_quellen.json')), false);
  s.zeige({ ziel: path.join(s.d, 'k.sqlite'), zustand: 'own', zaehlung: null, wurzeln: [] });
  const j2 = s.job();
  await j2['scopeAendern']('/tmp/x', true);
  assert.equal(fs.existsSync(path.join(s.d, 'analyse_quellen.json')), true);
});

// plan 7 task 12: nachLetztemBau
test('nachLetztemBau fires once after the follow-up build, not earlier', async (t) => {
  const s = stapel(t);
  s.scope(['/x']);
  s.setzeA({ rc: 0, stdout: '{"ok":true,"analysiert":3,"mit_wert":2}' });
  const n = [];
  const j = s.job({ nachLetztemBau: () => n.push(s.aufrufe.length) });
  j.starte(); await j.ruht();
  assert.deepEqual(s.aufrufe.map((a) => a.args[0]), ['bauen', 'analysieren', 'bauen']);
  assert.deepEqual(n, [3]);
});

test('nachLetztemBau fires once after the single build (no analysis value, no scope)', async (t) => {
  const s = stapel(t);
  let n = 0;
  const j = s.job({ nachLetztemBau: () => { n++; } });
  j.starte(); await j.ruht();
  assert.equal(n, 1);
  const s2 = stapel(t); s2.scope(['/x']);
  let m = 0;
  const j2 = s2.job({ nachLetztemBau: () => { m++; } });
  j2.starte(); await j2.ruht();
  assert.equal(m, 1);
});

test('nachLetztemBau never fires after a failed build', async (t) => {
  for (const rc of [3, 4]) {
    const s = stapel(t); s.setze({ rc });
    let n = 0;
    const j = s.job({ nachLetztemBau: () => { n++; } });
    j.starte(); await j.ruht();
    assert.equal(n, 0, `rc ${rc}`);
  }
});

test('nachLetztemBau fires after the last of two runs, not after each', async (t) => {
  const s = stapel(t); s.setze({ rc: 0, warteMs: 100 });
  const n = [];
  const j = s.job({ nachLetztemBau: () => n.push(s.aufrufe.length) });
  j.starte(); j.anstoss('x'); await j.ruht();
  assert.equal(s.aufrufe.length, 2);
  assert.deepEqual(n, [2]);
});

test('nachLetztemBau never fires when schliesse() ends the run', async (t) => {
  const s = stapel(t); s.setze({ rc: 0, warteMs: 3000 });
  let n = 0;
  const j = s.job({ nachLetztemBau: () => { n++; } });
  j.starte();
  await bisPhase(j, 'scan');
  await j.schliesse();
  assert.equal(n, 0);
});
