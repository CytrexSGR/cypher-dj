// node --test tests/vertrag.test.mjs: die Adresstabellen der Attrappe (vertrag.mjs) gegen djk/vertrag/osc.json (Scheibe 02):
// jede Adresse mit Richtung an_kern steht in BEFEHLE, jede mit vom_kern in AUSGABEN, mit gleicher Typ-Zeichenkette und
// gleichen Feldnamen in gleicher Reihenfolge; /nb (von_notbahn) gehört nicht zur Attrappe.
// OSC_JSON überschreibt den Pfad (Vorgabe: ../../osc.json neben attrappe_kern/, also djk/vertrag/osc.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BEFEHLE, AUSGABEN } from '../vertrag.mjs';

const PFAD = process.env.OSC_JSON ?? new URL('../../osc.json', import.meta.url).pathname;
const osc = JSON.parse(fs.readFileSync(PFAD, 'utf8'));

export function abweichungen(o, befehle, ausgaben) {
  const fehler = [];
  const gesehen = new Set();
  for (const a of o.adressen) {
    if (a.richtung === 'von_notbahn') continue;
    const tab = a.richtung === 'an_kern' ? befehle : ausgaben;
    const name = a.richtung === 'an_kern' ? 'BEFEHLE' : 'AUSGABEN';
    gesehen.add(`${name}:${a.adresse}`);
    const def = tab[a.adresse];
    if (!def) { fehler.push(`${a.adresse} fehlt in ${name}`); continue; }
    if (`,${def.typen}` !== a.typen) fehler.push(`${a.adresse}: Typen ${def.typen} statt ${a.typen}`);
    const soll = a.felder.map((f) => f.name).join(' ');
    if (def.felder.join(' ') !== soll) fehler.push(`${a.adresse}: Felder "${def.felder.join(' ')}" statt "${soll}"`);
  }
  for (const [name, tab] of [['BEFEHLE', befehle], ['AUSGABEN', ausgaben]]) {
    for (const adresse of Object.keys(tab)) if (!gesehen.has(`${name}:${adresse}`)) fehler.push(`${adresse} in ${name}, fehlt in osc.json`);
  }
  return fehler;
}

test('vertrag.mjs stimmt mit osc.json überein (Adressen, Typen, Feldnamen)', () => {
  assert.equal(osc.vertrag, 1);
  assert.deepEqual(abweichungen(osc, BEFEHLE, AUSGABEN), []);
});

test('Fehlerfall: eine vertauschte Typ-Zeichenkette und ein fehlender Eintrag werden gemeldet', () => {
  const falsch = { ...BEFEHLE, '/k/storno': { typen: 'hsi', felder: ['id', 'quelle', 'ziel_id'] } };
  delete falsch['/k/kiste'];
  const f = abweichungen(osc, falsch, AUSGABEN);
  assert.ok(f.includes('/k/storno: Typen hsi statt ,hsh'), f.join('\n'));
  assert.ok(f.includes('/k/kiste fehlt in BEFEHLE'), f.join('\n'));
});
