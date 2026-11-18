import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { instanzVersatz, ladeKonfig, mitInstanz, VORGABEN } from '../src/config.ts';
import { LEITSTAND } from './support/process.ts';

const TOML = path.join(LEITSTAND, '..', 'config', 'leitstand.toml');
const env = { XDG_RUNTIME_DIR: '/run/user/1000' };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-konfig-'));
const schreibe = (name: string, text: string) => { const p = path.join(tmp, name); fs.writeFileSync(p, text); return p; };

test('Vorgaben aus dem Schema von 02 sind die Werte aus §2.1', () => {
  assert.deepEqual(VORGABEN, {
    version: 1, ws_port: 47200, abo_port: 47110, set_basis_bpm: 128, autonomie_start: 1,
    bestand: '~/cypher-dj/bestand', sets: '~/cypher-dj/sets/djk', rechner_socket: '$XDG_RUNTIME_DIR/cypherdj/rechner.sock',
    zug_vorlauf_takte: 12, antwort_frist_takte: 4, nachrender_ruhe_takte: 16, grenzen_tief_verriegeln: false, journal: 'voll',
  });
});

test('Negativ-Kontrolle: djk/config/leitstand.toml besteht und trägt genau die Vorgaben', () => {
  const lz = ladeKonfig({ pfad: TOML, env });
  assert.deepEqual(lz.konfig, VORGABEN);
  assert.deepEqual([lz.ws_port, lz.abo_port, lz.kern_port], [47200, 47110, 47100]);
});

test('Fehlerfall: unbekannter Schlüssel ist ein Startfehler mit Schlüsselnamen', () => {
  const p = schreibe('tippfehler.toml', 'version = 1\nws_prot = 47200\n');
  assert.throws(() => ladeKonfig({ pfad: p, env }), /ws_prot/);
});

test('Fehlerfall: version fehlt, falscher Typ, Datei fehlt', () => {
  assert.throws(() => ladeKonfig({ pfad: schreibe('ohne.toml', 'ws_port = 1\n'), env }), /version/);
  assert.throws(() => ladeKonfig({ pfad: schreibe('typ.toml', 'version = 1\nws_port = "x"\n'), env }), /ws_port/);
  assert.throws(() => ladeKonfig({ pfad: path.join(tmp, 'gibtsnicht.toml'), env }), /fehlt/);
});

test('fehlende Schlüssel kommen aus den Vorgaben', () => {
  const lz = ladeKonfig({ pfad: schreibe('knapp.toml', 'version = 1\nws_port = 47999\n'), env });
  assert.equal(lz.konfig.ws_port, 47999);
  assert.equal(lz.konfig.abo_port, 47110);
});

test('Prüfinstanz c verschiebt alle Ports um 3000 und cypherdj/ im Socket-Pfad (Z2)', () => {
  const lz = ladeKonfig({ pfad: TOML, env: { ...env, CYPHERDJ_INSTANZ: 'c' } });
  assert.deepEqual([lz.ws_port, lz.abo_port, lz.kern_port], [50200, 50110, 50100]);
  assert.equal(lz.rechner_socket_pfad, '/run/user/1000/cypherdj-c/rechner.sock');
  assert.equal(mitInstanz('/home/x/cypher-dj/sets/djk', 'c'), '/home/x/cypher-dj/sets/djk'); // cypher-dj bleibt
  assert.throws(() => instanzVersatz('z'), /a bis i/);
});

test('--kern-port gewinnt über die Z2-Rechnung', () => {
  const lz = ladeKonfig({ pfad: TOML, kernPort: 51234, env: { ...env, CYPHERDJ_INSTANZ: 'c' } });
  assert.equal(lz.kern_port, 51234);
});

test('journal: default voll, schlank accepted, any other value refused with file and key', () => {
  assert.equal(VORGABEN.journal, 'voll');
  assert.equal(ladeKonfig({ pfad: schreibe('j-leer.toml', 'version = 1\n'), env }).konfig.journal, 'voll');
  assert.equal(ladeKonfig({ pfad: schreibe('j-voll.toml', 'version = 1\njournal = "voll"\n'), env }).konfig.journal, 'voll');
  assert.equal(ladeKonfig({ pfad: schreibe('j-schlank.toml', 'version = 1\njournal = "schlank"\n'), env }).konfig.journal, 'schlank');
  const falsch = schreibe('j-falsch.toml', 'version = 1\njournal = "halb"\n');
  assert.throws(() => ladeKonfig({ pfad: falsch, env }), (e: Error) => e.message.includes(falsch) && /journal/.test(e.message));
  assert.throws(() => ladeKonfig({ pfad: schreibe('j-typ.toml', 'version = 1\njournal = true\n'), env }), /journal/);
});

test('test instance with the default sets gets the shm path, an explicit sets stays, production keeps the default', () => {
  const heim = os.homedir();
  // no file at all (defaults) and a file without sets: the default applies
  const ohne = schreibe('s-ohne.toml', 'version = 1\n');
  assert.equal(ladeKonfig({ pfad: ohne, env: { ...env, CYPHERDJ_INSTANZ: 'a' } }).sets_pfad, '/dev/shm/cypherdj-a/sets');
  assert.equal(ladeKonfig({ pfad: ohne, env: { ...env, CYPHERDJ_INSTANZ: 'i' } }).sets_pfad, '/dev/shm/cypherdj-i/sets');
  // the shipped file spells the default out: still the default value, still the shm path
  assert.equal(ladeKonfig({ pfad: TOML, env: { ...env, CYPHERDJ_INSTANZ: 'c' } }).sets_pfad, '/dev/shm/cypherdj-c/sets');
  // an explicit sets that differs is used as written (with the usual ~ and $VAR resolution)
  const eigen = schreibe('s-eigen.toml', 'version = 1\nsets = "/tmp/meine-sets"\n');
  assert.equal(ladeKonfig({ pfad: eigen, env: { ...env, CYPHERDJ_INSTANZ: 'b' } }).sets_pfad, '/tmp/meine-sets');
  const tilde = schreibe('s-tilde.toml', 'version = 1\nsets = "~/andere/sets"\n');
  assert.equal(ladeKonfig({ pfad: tilde, env: { ...env, CYPHERDJ_INSTANZ: 'b' } }).sets_pfad, path.join(heim, 'andere/sets'));
  // production (no instance): the default stays
  assert.equal(ladeKonfig({ pfad: ohne, env }).sets_pfad, path.join(heim, 'cypher-dj/sets/djk'));
  assert.equal(ladeKonfig({ pfad: TOML, env }).sets_pfad, path.join(heim, 'cypher-dj/sets/djk'));
  assert.equal(ladeKonfig({ pfad: eigen, env }).sets_pfad, '/tmp/meine-sets');
});
