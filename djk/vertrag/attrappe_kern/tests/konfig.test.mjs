// node --test tests/konfig.test.mjs: die Attrappe kennt jeden Schlüssel von kern.toml aus djk/vertrag/konfig.schema.json
// (S3-Befund 16.10.: arr_ordner fehlte, mit Andreas' echter kern.toml endete sie mit „unbekannter Schlüssel
// keylock_maschine“, Rückgabe 2). Jeder Schlüssel des Schemas steht in VORGABE_CFG, mit dem Typ und der Vorgabe des
// Schemas; VORGABE_CFG hat keinen, den das Schema nicht kennt. Gegenprobe von Hand: einen Schlüssel aus VORGABE_CFG
// entfernen, dann ist dieser Test rot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { VORGABE_CFG } from '../kern.mjs';
import { leseToml } from '../toml.mjs';

const SCHEMA = JSON.parse(fs.readFileSync(new URL('../../konfig.schema.json', import.meta.url), 'utf8')).$defs['kern.toml'];
const TYP = { float: 'number', int: 'number', str: 'string', Pfad: 'string', bool: 'boolean' };

test('VORGABE_CFG kennt jeden Schlüssel aus konfig.schema.json mit Typ und Vorgabe, und keinen weiteren', () => {
  const fehlt = [];
  for (const [k, p] of Object.entries(SCHEMA.properties)) {
    if (!(k in VORGABE_CFG)) { fehlt.push(`${k} fehlt`); continue; }
    if (p['x-typ'] && typeof VORGABE_CFG[k] !== TYP[p['x-typ']]) fehlt.push(`${k}: Typ ${typeof VORGABE_CFG[k]}, Schema ${p['x-typ']}`);
    if ('default' in p && VORGABE_CFG[k] !== p.default) fehlt.push(`${k}: Vorgabe ${VORGABE_CFG[k]}, Schema ${p.default}`);
  }
  for (const k of Object.keys(VORGABE_CFG)) if (!(k in SCHEMA.properties)) fehlt.push(`${k} steht nicht im Schema`);
  assert.deepEqual(fehlt, []);
});

test('eine kern.toml mit jedem Schlüssel des Schemas ist lesbar, ein unbekannter Schlüssel nicht (Negativ-Kontrolle)', () => {
  const zeile = (k, v) => `${k} = ${typeof v === 'string' ? `"${v}"` : v}`;
  const voll = Object.entries(SCHEMA.properties).map(([k, p]) => zeile(k, k === 'version' ? 1 : p.default)).join('\n');
  const cfg = leseToml(voll, VORGABE_CFG);
  assert.equal(Object.keys(cfg).length, Object.keys(SCHEMA.properties).length);
  assert.equal(cfg.keylock_maschine, 'r3');
  assert.throws(() => leseToml(`${voll}\ngibt_es_nicht = 1`, VORGABE_CFG), /unbekannter Schlüssel gibt_es_nicht/);
});
