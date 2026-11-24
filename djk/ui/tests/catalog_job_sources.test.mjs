// Browser plan 1, task 6: first-start flag (leer), pruefeBeiStart and the import hook, with the real `python -m bibliothek` in a sealed temp
// environment. Builds are counted through the `befehl` seam where the test only needs to know that one started; real builds fill the catalogue.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import { KatalogJob, katalogNachImport } from '../catalog_job.ts';
import { ImportDienst } from '../importe.ts';
import { bibUmgebung, warte, wavBytes } from './support/bib_environment.mjs';

function stapel(t, { zaehle = false, rc = 0 } = {}) {
  const u = bibUmgebung(t);
  const musik = path.join(u.heim, 'Musik');
  const importe = path.join(u.heim, 'importe');
  fs.mkdirSync(musik); fs.mkdirSync(importe);
  const baeue = [];
  const befehl = zaehle ? (args) => { if (args[0] === 'bauen') baeue.push(args); return spawn(process.execPath, ['-e', `process.stderr.write('library root is missing: /mnt/weg\\n');process.exit(${rc})`], { stdio: ['ignore', 'pipe', 'pipe'] }); } : undefined;
  const job = (o = {}) => { const j = new KatalogJob({ python: u.python, cwd: u.cwd, env: u.env, entprellMs: 60, importeOrdner: () => importe, befehl, ...o }); t.after(() => j.schliesse()); return j; };
  return { ...u, musik, importe, baeue, job };
}

test('leer is true on a fresh config, false after dazu, false for a foreign catalogue', async (t) => {
  const s = stapel(t);
  const j = s.job();
  assert.equal((await j.stand()).leer, true);
  fs.writeFileSync(path.join(s.musik, 'k.wav'), wavBytes(1));
  await j.dazu(s.musik, 'auto');
  assert.equal((await j.stand()).leer, false);
  await j.ruht();
  const f = stapel(t);
  f.fremderKatalog();
  const jf = f.job();
  const st = await jf.stand();
  assert.deepEqual([st.leer, st.fremd], [false, true]);
});

test('leer stays true after an import that only registered importe, until the catalogue has rows', async (t) => {
  const s = stapel(t);
  const j = s.job();
  await j.sorgeFuerImporteQuelle(s.importe);
  assert.deepEqual((await j.quellen()).quellen.map((q) => q.pfad), [s.importe]);
  assert.equal((await j.stand()).leer, true, 'only the importe folder is a source and the catalogue has no rows');
  fs.writeFileSync(path.join(s.importe, 'a.wav'), wavBytes(2));
  j.starte(); await j.ruht();
  assert.equal((await j.stand()).leer, false);
});

test('the import hook registers importe once and starts one build for a batch of 5 uploads', async (t) => {
  const s = stapel(t, { zaehle: true });
  const j = s.job();
  const dienst = new ImportDienst({ importeOrdner: () => s.importe, projektAudioOrdner: () => null, heute: () => '2026-11-23', nachImport: katalogNachImport(j, () => s.importe) });
  for (let i = 0; i < 5; i++) await dienst.nimmAn(Readable.from([wavBytes(i + 1)]), `s${i}.wav`, 'auto', null);
  await warte(500);
  await j.ruht();
  assert.equal(s.baeue.length, 1, 'one build for the whole batch');
  assert.deepEqual((await j.quellen()).quellen.map((q) => q.pfad), [s.importe], 'importe is registered once');
  await dienst.nimmAn(Readable.from([wavBytes(9)]), 'noch.wav', 'auto', null);
  await warte(400); await j.ruht();
  assert.equal((await j.quellen()).quellen.length, 1, 'a later import adds no second entry');
  const scope = JSON.parse(fs.readFileSync(path.join(path.dirname(s.katalog), 'analyse_quellen.json'), 'utf8'));
  assert.deepEqual(scope.pfade, [s.importe]);
});

test('an import into the project, a preset or a kit zip does not start a build', async (t) => {
  const s = stapel(t, { zaehle: true });
  const j = s.job();
  const hook = katalogNachImport(j, () => s.importe);
  hook({ pfad: path.join(s.heim, 'projekt', 'audio', 'a.wav'), art: 'audio' });
  hook({ pfad: path.join(s.importe, 'x', 'p.json'), art: 'preset' });
  hook({ pfad: path.join(s.importe, 'x', 'kit.zip'), art: 'kit' });
  await warte(300);
  assert.equal(s.baeue.length, 0);
});

test('pruefeBeiStart builds when the marke differs, does nothing when equal, with no source, or for a foreign catalogue', async (t) => {
  const s = stapel(t);
  fs.writeFileSync(path.join(s.musik, 'k.wav'), wavBytes(1));
  s.cli(['dazu', s.musik]);
  const echt = s.job();
  await echt.pruefeBeiStart();   // no catalogue yet: the marke differs from nothing, a real build runs
  await echt.ruht();
  assert.equal((await echt.stand()).letzter_bau.dateien, 1);
  const gleich = stapel(t, { zaehle: true });
  const zaehl = (u) => u.baeue.length;
  // same environment as `echt`: a counting job on the same temp folders
  const j2 = new KatalogJob({ python: s.python, cwd: s.cwd, env: s.env, entprellMs: 60, befehl: () => { gleich.baeue.push(1); return spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' }); } });
  t.after(() => j2.schliesse());
  await j2.pruefeBeiStart();
  await j2.ruht();
  assert.equal(zaehl(gleich), 0, 'the stored marke equals the current one');
  fs.mkdirSync(path.join(s.musik, 'neu'));
  await j2.pruefeBeiStart();
  await j2.ruht();
  assert.equal(zaehl(gleich), 1, 'a new folder changes the marke');
  const leer = stapel(t, { zaehle: true });
  await leer.job().pruefeBeiStart();
  assert.equal(leer.baeue.length, 0, 'no source');
  const fremd = stapel(t, { zaehle: true });
  fs.writeFileSync(path.join(fremd.musik, 'k.wav'), wavBytes(1));
  fremd.cli(['dazu', fremd.musik]); fremd.fremderKatalog();
  const jf = fremd.job();
  await jf.pruefeBeiStart(); await jf.ruht();
  assert.equal(fremd.baeue.length, 0, 'foreign catalogue');
});

test('pruefeBeiStart with an unplugged source folder does not loop: one build, rc 4, no second start', async (t) => {
  const s = stapel(t);
  const weg = path.join(s.heim, 'Platte');
  fs.mkdirSync(weg);
  s.cli(['dazu', weg]);
  fs.rmdirSync(weg);
  const j = s.job({ befehl: undefined });
  await j.pruefeBeiStart();
  await j.ruht();
  const e = await j.stand();
  assert.equal(e.letzter_bau.rc, 4);
  assert.match(e.letzter_bau.grund, /Platte/);
  const zeit = e.letzter_bau.zeit;
  await warte(300);
  assert.equal((await j.stand()).letzter_bau.zeit, zeit, 'nothing started again');
  assert.equal(e.phase, 'ruht');
});
