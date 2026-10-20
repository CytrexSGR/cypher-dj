// Paket 1.18 (E-b, Erhebung 2026-10-20): was Server, Werkzeug und Projekt-Attrappe aus /pegel lesen und senden, steht im Vertrag (vertrag/osc_adressen.ts,
// SCHNITTSTELLEN §5.6). Der Kern meldet spur/<n> mit denselben acht Feldern wie jeden Kanal; Server und Seite lesen davon kanal und spitze_db.
// Die Projekt-Attrappe (pruef/proj_attrappe.mjs) sendet nur Felder, die der Vertrag kennt, und mit dem Kanalnamen spur/<n>.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ADRESSEN } from '../../vertrag/osc_adressen.ts';

const FELDER = ADRESSEN['/pegel'].felder;
const quelle = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

test('Vertrag /pegel: acht Felder, vom Kern; kanal und spitze_db sind darunter', () => {
  assert.deepEqual(FELDER, ['kanal', 'spitze_db', 'echtspitze_dbtp', 'lufs_m', 'lufs_s', 'band_tief_db', 'band_mitte_db', 'band_hoch_db']);
  assert.equal(ADRESSEN['/pegel'].richtung, 'vom_kern');
});

test('Server liest aus /pegel nur Vertragsfelder (der Pegelpuffer führt kanal und spitze_db, auch für spur/<n>)', () => {
  const s = quelle('../server.ts');
  const m = /this\.pegelPuffer\.nimm\(\{([^}]*)\}\)/.exec(s);
  assert.ok(m, 'die Stelle in server.ts ist da');
  const gelesen = [...m[1].matchAll(/f\.(\w+)/g)].map((x) => x[1]);
  assert.deepEqual(gelesen, ['kanal', 'spitze_db']);
  for (const f of gelesen) assert.ok(FELDER.includes(f), `${f} steht im Vertrag`);
});

test('Projekt-Attrappe sendet /pegel mit Vertragsfeldern und Kanal spur/<n>; ein erfundenes Feld fiele auf', () => {
  const zeilen = quelle('../pruef/proj_attrappe.mjs').split('\n').filter((z) => z.includes("a: '/pegel'"));
  assert.ok(zeilen.length >= 1, 'mindestens eine Sendestelle');
  const schluessel = (z) => {
    const innen = z.slice(z.indexOf('f: {') + 4, z.lastIndexOf('} }')).replace(/`[^`]*`/g, '`x`').replace(/'[^']*'/g, "'x'");
    return [...innen.matchAll(/(?:^|,)\s*(\w+)\s*:/g)].map((m) => m[1]);
  };
  for (const z of zeilen) {
    const felder = schluessel(z);
    assert.deepEqual(felder.slice(0, 2), ['kanal', 'spitze_db']);
    for (const f of felder) assert.ok(FELDER.includes(f), `proj_attrappe sendet /pegel.${f}, der Vertrag kennt es nicht`);
    assert.match(z, /kanal: `spur\/\$\{/);
  }
  // Negativ-Kontrolle des Lesers selbst: ein erfundenes Feld in einer Zeile würde erkannt
  assert.ok(schluessel("sende({ a: '/pegel', f: { kanal: `spur/${s.nr}`, spitze_db: -1, erfunden: 3 } });").includes('erfunden'));
  assert.ok(!FELDER.includes('erfunden'));
});
