// Container core, lane U (U8): the regler table derives its channel rows from the generated pult module. Four containers carry the
// strip rows, the stream aliases erz/<n>/* are rows of their own (alias: true, the container row's unit, range and default), the
// path set equals the regler_pfad pattern of the contract.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  PULT_ALIAS_STROEME, pultAliasSuffixe, pultBkN, pultBusPfad, pultContainerPfad, pultReglerBus, pultReglerPlayer, pultReglerZug, pultStroeme,
} from '../../contract/pult.ts';
import { BK_KANAELE, REGLER, kanalVon, machtLeiser, reglerInfo } from '../src/controls_info.ts';
import { BASS } from '../src/coupling.ts';
import { SCHEMA_ORDNER } from '../src/contract.ts';

const muster = new RegExp(JSON.parse(fs.readFileSync(path.join(SCHEMA_ORDNER, 'defs.schema.json'), 'utf8')).$defs.regler_pfad.pattern);
const bk = (k: string) => Array.from({ length: pultBkN }, (_, i) => `${k}/bk/${i + 1}`);

test('the four containers carry exactly the strip rows of pult regler.zug; deck/3, deck/4 and erz/8 carry none', () => {
  for (const c of pultContainerPfad) {
    for (const s of pultReglerZug) {
      if (s === 'bk/<k>') continue;
      assert.ok(REGLER.has(`${c}/${s}`), `${c}/${s}`);
      assert.equal(kanalVon(`${c}/${s}`), c);
    }
    for (const p of bk(c)) assert.ok(REGLER.has(p), p);
  }
  for (const k of ['deck/3', 'deck/4', 'erz/8']) {
    const rows = [...REGLER.keys()].filter((p) => p.startsWith(`${k}/`) && !p.includes('/stem/'));
    assert.deepEqual(rows, [], k);
  }
  assert.equal(REGLER.has('deck/3/fader'), false);
  assert.equal(REGLER.has('pad/3/fader'), false);
  assert.deepEqual([reglerInfo('deck/1/komp/sc')!.min, reglerInfo('deck/1/komp/sc')!.max], [0, 4]);
  assert.deepEqual([reglerInfo('pad/2/gate/sc')!.min, reglerInfo('pad/2/gate/sc')!.max], [0, 4]);
  assert.deepEqual([reglerInfo('spektrum/kanal')!.min, reglerInfo('spektrum/kanal')!.max], [0, 9]);
});

test('the buses carry the rows of pult regler.bus, no compressor, gate or target row', () => {
  for (const b of pultBusPfad) for (const s of pultReglerBus) assert.ok(REGLER.has(`${b}/${s}`), `${b}/${s}`);
  for (const s of ['komp/an', 'gate/an', 'ziel']) assert.equal(REGLER.has(`bus/1/${s}`), false, s);
});

test('stem rows exist for deck/1..4 (players), not for the pads', () => {
  for (let n = 1; n <= 4; n++) for (const s of pultReglerPlayer.filter((x) => x.startsWith('stem/'))) assert.ok(REGLER.has(`deck/${n}/${s}`), `deck/${n}/${s}`);
  assert.equal(REGLER.has('pad/1/stem/bass'), false);
});

test('alias rows: erz/<n>/<suffix> for the alias streams, marked alias, with the unit, range and default of the container row', () => {
  assert.deepEqual([...PULT_ALIAS_STROEME], [1, 2, 3, 5, 6, 7, 9, 10]);
  const alias = [...REGLER.values()].filter((i) => i.pfad.startsWith('erz/'));
  assert.equal(alias.length, PULT_ALIAS_STROEME.length * (pultAliasSuffixe.length - 1 + pultBkN));
  assert.ok(alias.every((i) => i.alias === true));
  assert.ok([...REGLER.values()].filter((i) => !i.pfad.startsWith('erz/')).every((i) => i.alias !== true));
  for (const n of PULT_ALIAS_STROEME) {
    for (const s of pultAliasSuffixe) {
      if (s === 'bk/<k>') continue;
      const i = reglerInfo(`erz/${n}/${s}`);
      assert.ok(i, `erz/${n}/${s}`);
      assert.equal(i.kanal, `erz/${n}`);
      const c = reglerInfo(`deck/1/${s}`);
      if (c) assert.deepEqual([i.einheit, i.min, i.max, i.vorgabe, i.nurHand], [c.einheit, c.min, c.max, c.vorgabe, c.nurHand], s);
    }
  }
  for (const s of ['pan', 'mute', 'solo']) assert.ok(REGLER.has(`erz/1/${s}`), s);
  for (const p of ['erz/4/fader', 'erz/8/fader', 'erz/11/fader', 'erz/1/ziel', 'erz/1/xseite', 'erz/1/gate/an', 'erz/1/stem/bass']) assert.equal(REGLER.has(p), false, p);
  assert.equal(REGLER.has('erz/10/bk/64'), true);
  assert.equal(REGLER.has('erz/1/bk/65'), false);
});

test('strom/1..16/bk/1..64 are global graph knobs, 0..1, default 0.5', () => {
  const rows = [...REGLER.keys()].filter((p) => p.startsWith('strom/'));
  assert.equal(rows.length, pultStroeme * pultBkN);
  const i = reglerInfo('strom/16/bk/64')!;
  assert.deepEqual([i.einheit, i.min, i.max, i.vorgabe, i.nurHand, i.kanal], ['linear', 0, 1, 0.5, false, null]);
  assert.equal(REGLER.has('strom/17/bk/1'), false);
});

test('BK_KANAELE: the containers and the alias streams', () => {
  assert.deepEqual([...BK_KANAELE], [...pultContainerPfad, ...PULT_ALIAS_STROEME.filter((n) => n !== 1).map((n) => `erz/${n}`)]);
});

test('machtLeiser follows the alias rows: erz fader and kill lower, erz EQ does not', () => {
  assert.equal(machtLeiser('erz/2/fader', -3, -6), true);
  assert.equal(machtLeiser('erz/2/kill/tief', 0, 1), true);
  assert.equal(machtLeiser('erz/2/eq/tief', 0, -6), false);
  assert.equal(machtLeiser('erz/2/send/1', -10, -20), true);
});

test('the path set equals the regler_pfad pattern on the erz, container, deck and strom universe', () => {
  const suffixe = [...new Set([...pultReglerZug, ...pultReglerBus, ...pultAliasSuffixe, 'ziel', 'xseite', 'stem/bass', 'stem/other', 'transport'])]
    .filter((s) => s !== 'bk/<k>');
  const kanaele = [...pultContainerPfad, ...pultBusPfad, 'deck/3', 'deck/4', 'pad/3', 'pad/0', 'bus/5',
    ...Array.from({ length: 12 }, (_, i) => `erz/${i}`), 'strom/0', 'strom/1', 'strom/16', 'strom/17'];
  const u = kanaele.flatMap((k) => suffixe.map((s) => `${k}/${s}`));
  u.push(...kanaele.flatMap((k) => [0, 1, 64, 65].map((n) => `${k}/bk/${n}`)));
  assert.deepEqual(u.filter((p) => muster.test(p) !== REGLER.has(p)), []);
});

test('kopplung BASS matches the container and alias bass rows and not deck/3', () => {
  for (const p of ['deck/1/eq/tief', 'pad/2/kill/tief', 'erz/3/eq/tief', 'deck/4/stem/bass', 'erz/10/kill/tief']) assert.equal(BASS.test(p), true, p);
  for (const p of ['deck/3/eq/tief', 'erz/4/eq/tief', 'erz/8/eq/tief', 'pad/3/kill/tief']) assert.equal(BASS.test(p), false, p);
});
