import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { instanzVersatz, ladeKonfig, mitInstanz, VORGABEN } from '../src/konfig.ts';
import { LEITSTAND } from './hilfen/prozess.ts';

const TOML = path.join(LEITSTAND, '..', 'konfig', 'leitstand.toml');
const env = { XDG_RUNTIME_DIR: '/run/user/1000' };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-konfig-'));
const schreibe = (name: string, text: string) => { const p = path.join(tmp, name); fs.writeFileSync(p, text); return p; };

test('Vorgaben aus dem Schema von 02 sind die Werte aus §2.1', () => {
  assert.deepEqual(VORGABEN, {
    version: 1, ws_port: 47200, abo_port: 47110, set_basis_bpm: 128, autonomie_start: 1,
    bestand: '~/cypher-dj/bestand', sets: '~/cypher-dj/sets/djk', rechner_socket: '$XDG_RUNTIME_DIR/cypherdj/rechner.sock',
    zug_vorlauf_takte: 12, antwort_frist_takte: 4, nachrender_ruhe_takte: 16, grenzen_tief_verriegeln: false,
  });
});

test('Negativ-Kontrolle: djk/konfig/leitstand.toml besteht und trägt genau die Vorgaben', () => {
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
