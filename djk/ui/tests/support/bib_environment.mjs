// A sealed environment for the catalogue tests that run the real `python -m bibliothek` (browser plan 1): HOME, the config file, the catalogue
// and the feature cache all live in one temp folder, so no test can touch ~/.config/cypherdj or the real katalog.sqlite.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO } from '../../paths.ts';

export const warte = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** A tiny valid 16 bit mono 8 kHz WAV; `n` makes the content (and so the sha) differ. */
export function wavBytes(n, frames = 400) {
  const daten = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) daten.writeInt16LE(((n * 37 + i * 11) % 2000) - 1000, i * 2);
  const kopf = Buffer.alloc(44);
  kopf.write('RIFF', 0); kopf.writeUInt32LE(36 + daten.length, 4); kopf.write('WAVEfmt ', 8);
  kopf.writeUInt32LE(16, 16); kopf.writeUInt16LE(1, 20); kopf.writeUInt16LE(1, 22); kopf.writeUInt32LE(8000, 24); kopf.writeUInt32LE(16000, 28);
  kopf.writeUInt16LE(2, 32); kopf.writeUInt16LE(16, 34); kopf.write('data', 36); kopf.writeUInt32LE(daten.length, 40);
  return Buffer.concat([kopf, daten]);
}

export function bibUmgebung(t) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bib-umg-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const heim = path.join(d, 'home');
  fs.mkdirSync(heim, { recursive: true });
  const env = {
    HOME: heim, XDG_CONFIG_HOME: path.join(heim, '.config'), XDG_CACHE_HOME: path.join(heim, '.cache'), XDG_DATA_HOME: path.join(heim, '.local', 'share'),
    CYPHERDJ_KATALOG: path.join(d, 'kat', 'katalog.sqlite'), CYPHERDJ_BIBLIOTHEK_CACHE: path.join(d, 'cache.sqlite'),
    CYPHERDJ_BIBLIOTHEK_KONFIG: path.join(d, 'bibliothek.json'), CYPHERDJ_HEIM: path.join(d, 'heimat'),
  };
  const python = path.join(REPO, 'djk', 'workshop', '.venv', 'bin', 'python');
  const cwd = path.join(REPO, 'djk');
  const cli = (args) => execFileSync(python, ['-m', 'bibliothek', ...args], { cwd, env: { ...process.env, ...env }, encoding: 'utf8' });
  const katalog = env.CYPHERDJ_KATALOG;
  /** A catalogue another program built: it has no stand.erbauer of ours. */
  const fremderKatalog = () => {
    fs.mkdirSync(path.dirname(katalog), { recursive: true });
    execFileSync(python, ['-c', 'import sqlite3,sys;d=sqlite3.connect(sys.argv[1]);d.execute("create table stand(schluessel text primary key, wert text not null)");d.execute("insert into stand values(\'erbauer\',\'anderes-programm\')");d.execute("create table katalog(typ text)");d.commit()', katalog]);
  };
  fs.mkdirSync(env.CYPHERDJ_HEIM, { recursive: true });
  return { d, heim, heimat: env.CYPHERDJ_HEIM, env, python, cwd, cli, katalog, fremderKatalog };
}
