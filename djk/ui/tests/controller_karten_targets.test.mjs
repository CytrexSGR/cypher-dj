// Container core, lane U (U10): the shipped controller maps keep working. Every target of apc20.json, pult.json, softcontroller.json and
// lernen-lpd8-remix.json is a known target: a row of the conductor regler table (container strip rows, stems, global rows, erz alias rows),
// a transport row of a player, a softcontroller key, or xfader / tempo / arr/start_stopp. No map is edited by this test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { pultContainerPfad } from '../../contract/pult.ts';
import { reglerInfo } from '../../conductor/src/controls_info.ts';

const ORDNER = path.join(import.meta.dirname, '..', '..', 'config', 'controller');
const KARTEN = ['apc20.json', 'pult.json', 'softcontroller.json', 'lernen-lpd8-remix.json'];
const lade = (n) => JSON.parse(fs.readFileSync(path.join(ORDNER, n), 'utf8')).eintraege;
const ziele = (n) => lade(n).map((e) => e.ziel);

const PLAYER = /^deck\/[1-4]\/(play|cue|loop|loop_laenge|laden|tap|nudge|hotcue\/[1-9][0-9]?)$/;
const EINZEL = new Set(['xfader', 'tempo', 'arr/start_stopp']);
const bekannt = (z) => reglerInfo(z) !== null || PLAYER.test(z) || /^taste\/[a-z_]+$/.test(z) || EINZEL.has(z);

test('every ziel of the four maps is a known target (and the check itself rejects what the new core dropped)', () => {
  for (const z of ['deck/3/fader', 'erz/4/fader', 'erz/8/fader', 'pad/3/fader', 'erz/1/send/9']) assert.equal(bekannt(z), false, z);
  const unbekannt = KARTEN.flatMap((n) => ziele(n).filter((z) => !bekannt(z)).map((z) => `${n}: ${z}`));
  assert.deepEqual(unbekannt, []);
});

test('the erz targets of the maps are only erz/1, erz/2, erz/3 with fader or pfl', () => {
  const erz = KARTEN.flatMap((n) => ziele(n).filter((z) => z.startsWith('erz/')));
  assert.ok(erz.length > 0);
  for (const z of erz) assert.match(z, /^erz\/[123]\/(fader|pfl)$/, z);
});

test('no map names erz/4, erz/5..8, a strip row of deck/3 or deck/4, or a pad as a loop box', () => {
  const alle = KARTEN.flatMap((n) => ziele(n));
  assert.deepEqual(alle.filter((z) => /^erz\/(4|[5-9]|1[0-9])\//.test(z)), []);
  assert.deepEqual(alle.filter((z) => /^deck\/[34]\//.test(z) && reglerInfo(z) !== null && !z.includes('/stem/')), []);   // transport rows of players 3 and 4 are fine
  assert.deepEqual(alle.filter((z) => /^(pad\/[12]\/(loop|loops|loopbox)|loopbox)/.test(z)), []);
});

test('the maps address four containers by their contract paths', () => {
  const benutzt = new Set(KARTEN.flatMap((n) => ziele(n)).map((z) => /^((deck|pad)\/[0-9]+)\/(fader|trim|eq|kill|filter|pfl)/.exec(z)?.[1]).filter(Boolean));
  for (const k of benutzt) assert.ok(pultContainerPfad.includes(k), `${k} is not a container`);
  for (const k of pultContainerPfad) assert.ok(benutzt.has(k), `${k} unused by the maps`);
});

test('the number of entries per map is pinned so a silent edit shows', () => {
  assert.deepEqual(Object.fromEntries(KARTEN.map((n) => [n, lade(n).length])),
    { 'apc20.json': 39, 'pult.json': 462, 'softcontroller.json': 44, 'lernen-lpd8-remix.json': 8 });
});
