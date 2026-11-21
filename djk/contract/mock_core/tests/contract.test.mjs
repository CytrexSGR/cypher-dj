// node --test tests/contract.test.mjs: die Adresstabellen der Attrappe (contract.mjs) gegen djk/contract/osc.json (Scheibe 02):
// jede Adresse mit Richtung an_kern steht in BEFEHLE, jede mit vom_kern in AUSGABEN, mit gleicher Typ-Zeichenkette und
// gleichen Feldnamen in gleicher Reihenfolge; /nb (von_notbahn) gehört nicht zur Attrappe.
// OSC_JSON überschreibt den Pfad (Vorgabe: ../../osc.json neben attrappe_kern/, also djk/contract/osc.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { BEFEHLE, AUSGABEN, REGLER } from '../contract.mjs';

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

test('contract.mjs stimmt mit osc.json überein (Adressen, Typen, Feldnamen)', () => {
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

// container core V5: the mock REGLER table follows pult.json (the expanded paths come from `generate_pult.py --liste`)
const liste = spawnSync('python3', [new URL('../../generate_pult.py', import.meta.url).pathname, '--liste'], { encoding: 'utf8' });
const PULT = liste.stdout.split('\n').filter(Boolean);
const FAMILIE = /^((deck\/[12]|pad\/[12]|bus\/[1-4])\/|deck\/[1-4]\/(stem|transport)|strom\/)/;

test('REGLER: every pult path except the core-only transport rows is a mock row, and the mock has no other row in those families', () => {
  assert.equal(liste.status, 0, liste.stderr);
  assert.ok(PULT.length > 1000, 'pult list parsed empty');
  const soll = new Set(PULT.filter((p) => !/^deck\/[1-4]\/transport$/.test(p)));
  const fehlt = [...soll].filter((p) => !REGLER.has(p));
  const zuviel = [...REGLER.keys()].filter((p) => FAMILIE.test(p) && !soll.has(p));
  assert.deepEqual([fehlt.slice(0, 5), zuviel.slice(0, 5)], [[], []]);
});

test('REGLER: no erz/* rows, no deck/3 or deck/4 strip rows; stem rows ride on the container of the player; sc ranges and stream knobs', () => {
  assert.ok(![...REGLER.keys()].some((k) => k.startsWith('erz/')));
  assert.ok(!REGLER.has('deck/3/fader') && !REGLER.has('deck/4/trim'));
  assert.equal(REGLER.get('deck/3/stem/bass')?.kanal, 'pad/1');
  assert.equal(REGLER.get('deck/2/stem/drums')?.kanal, 'deck/2');
  assert.equal(REGLER.get('pad/1/komp/sc').max, 4);
  assert.equal(REGLER.get('pad/2/gate/sc').max, 4);
  assert.equal(REGLER.get('spektrum/kanal').max, 9);
  const k = REGLER.get('strom/16/bk/64');
  assert.deepEqual([k.kanal, k.min, k.max, k.vorgabe], [null, 0, 1, 0.5]);
  assert.ok(!REGLER.has('strom/17/bk/1') && !REGLER.has('strom/1/bk/65'));
  assert.ok(!REGLER.has('deck/1/transport'), 'transport is a core row, not a mock row');
});
