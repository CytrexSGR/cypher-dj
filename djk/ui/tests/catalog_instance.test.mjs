// Browser plan 1 (review g2): a test instance keeps import folder, source list, catalogue, MIDI list and feature cache under /dev/shm/cypherdj-<i>/,
// never the real quellen.toml or katalog.sqlite. The instance name 'zz' is used here so no real test instance folder is touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { KatalogJob, katalogNachImport } from '../catalog_job.ts';
import { ImportDienst } from '../importe.ts';
import { ablageOrdner, importeOrdnerVorgabe, katalogUmgebung } from '../paths.ts';
import { bibUmgebung, warte, wavBytes } from './support/bib_environment.mjs';

const SCHLUESSEL = ['CYPHERDJ_IMPORTE', 'CYPHERDJ_KATALOG', 'CYPHERDJ_BIBLIOTHEK_KONFIG', 'CYPHERDJ_BIBLIOTHEK_CACHE', 'CYPHERDJ_HEIM'];
function ohneEnv(t) {
  const alt = Object.fromEntries(SCHLUESSEL.map((k) => [k, process.env[k]]));
  for (const k of SCHLUESSEL) delete process.env[k];
  t.after(() => { for (const k of SCHLUESSEL) { if (alt[k] === undefined) delete process.env[k]; else process.env[k] = alt[k]; } });
}

test('importeOrdnerVorgabe: an instance gets its shm folder, the studio the storage place, an env override wins', (t) => {
  ohneEnv(t);
  assert.equal(importeOrdnerVorgabe('zz'), '/dev/shm/cypherdj-zz/importe');
  assert.equal(importeOrdnerVorgabe(''), ablageOrdner('importe'));
  process.env.CYPHERDJ_IMPORTE = '/tmp/mein-importe';
  assert.equal(importeOrdnerVorgabe('zz'), '/tmp/mein-importe');
});

test('katalogUmgebung: an instance redirects catalogue, sources, cache and home folder; the studio and env overrides stay as they are', (t) => {
  ohneEnv(t);
  const e = katalogUmgebung('zz', { CYPHERDJ_SAMPLER: '/x' });
  assert.deepEqual(Object.keys(e).sort(), [...SCHLUESSEL.filter((k) => k !== 'CYPHERDJ_IMPORTE'), 'CYPHERDJ_SAMPLER'].sort());
  for (const k of SCHLUESSEL.filter((x) => x !== 'CYPHERDJ_IMPORTE')) assert.ok(e[k].startsWith('/dev/shm/cypherdj-zz/bibliothek/'), `${k} ${e[k]}`);
  assert.equal(katalogUmgebung('', { A: '1' }).A, '1');
  assert.equal(katalogUmgebung('', undefined), undefined);
  process.env.CYPHERDJ_KATALOG = '/tmp/eigen.sqlite';
  assert.equal(katalogUmgebung('zz').CYPHERDJ_KATALOG, undefined, 'the process env already says where: it wins');
});

test('an import on an instance registers, builds and stores everything in its shm folder; the real quellen.toml and katalog.sqlite stay untouched', async (t) => {
  ohneEnv(t);
  const u = bibUmgebung(t);
  const shm = '/dev/shm/cypherdj-zz';
  fs.rmSync(shm, { recursive: true, force: true });
  t.after(() => fs.rmSync(shm, { recursive: true, force: true }));
  const echte = [path.join(os.homedir(), 'cypherdj', 'quellen.toml'), path.join(os.homedir(), '.config', 'cypherdj', 'bibliothek.json'),
    path.join(os.homedir(), '.local', 'share', 'cypherdj', 'mediathek', 'katalog.sqlite')];
  const stat = () => echte.map((p) => { try { const s = fs.statSync(p); return `${s.mtimeMs}:${s.size}`; } catch { return 'none'; } });
  const vorher = stat();
  const env = { ...katalogUmgebung('zz', { HOME: u.heim }) };
  const importe = importeOrdnerVorgabe('zz');
  const job = new KatalogJob({ python: u.python, cwd: u.cwd, env, entprellMs: 60, importeOrdner: () => importe });
  t.after(() => job.schliesse());
  const dienst = new ImportDienst({ importeOrdner: () => importe, projektAudioOrdner: () => null, heute: () => '2026-11-23', nachImport: katalogNachImport(job, () => importe) });
  await dienst.nimmAn(Readable.from([wavBytes(1)]), 'eins.wav', 'auto', null);
  await warte(400);
  await job.ruht();
  assert.ok(fs.existsSync(`${shm}/bibliothek/katalog.sqlite`), 'catalogue in shm');
  assert.ok(fs.existsSync(`${shm}/bibliothek/bibliothek.json`), 'source list in shm');
  assert.ok(fs.readdirSync(importe).length > 0, 'the file is in the shm import folder');
  assert.deepEqual((await job.quellen()).quellen.map((q) => q.pfad), [importe]);
  assert.deepEqual(stat(), vorher, 'the real files were not touched');
});

test('katalogUmgebung: a CYPHERDJ_HEIM in the process env does not carry the instance to the real quellen.toml', (t) => {
  ohneEnv(t);
  process.env.CYPHERDJ_HEIM = os.homedir();
  const e = katalogUmgebung('zz');
  assert.equal(e.CYPHERDJ_HEIM, '/dev/shm/cypherdj-zz/bibliothek/heimat');
  assert.equal(katalogUmgebung('', undefined), undefined, 'the studio is left alone');
});
