// Regler-Tabelle gegen den Vertrag: dieselbe Pfadmenge wie das Muster regler_pfad (defs.schema.json), Bereiche und
// „nur Hand“ wie §1.5, „leiser machen“ wie §10 Stufe 1.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { REGLER, imBereich, kanalVon, machtLeiser, reglerInfo } from '../src/regler_info.ts';
import { SCHEMA_ORDNER } from '../src/vertrag.ts';

const muster = new RegExp(JSON.parse(fs.readFileSync(path.join(SCHEMA_ORDNER, 'defs.schema.json'), 'utf8'))
  .$defs.regler_pfad.pattern);

// Universum aller denkbaren Pfade: jede Kanal-Art mit jedem Kanalzug-Glied, dazu die Einzelregler je fx-Nummer
function universum(): string[] {
  const kanaele = [1, 2, 3, 4].map((n) => `deck/${n}`).concat([1, 2, 3, 4, 5, 6, 7, 8].map((n) => `erz/${n}`),
    ['pad/1', 'pad/2'], [1, 2, 3, 4].map((n) => `bus/${n}`));
  const glieder = ['fader', 'trim', 'eq/tief', 'eq/mitte', 'eq/hoch', 'kill/tief', 'kill/mitte', 'kill/hoch', 'filter',
    'send/1', 'send/2', 'send/3', 'send/4', 'ziel', 'xseite', 'pfl', 'stem/drums', 'stem/bass', 'stem/vocals', 'stem/other'];
  const u = kanaele.flatMap((k) => glieder.map((g) => `${k}/${g}`));
  for (const n of [1, 2, 3, 4]) u.push(`fx/${n}/notenwert`, `fx/${n}/rueckkopplung`, `fx/${n}/rueckweg`);
  u.push('xfader', 'master/pegel', 'cue/mix', 'cue/pegel', 'cue/split');
  u.push('duck/tiefe', 'duck/release', 'master/kleber', 'master/pfl');
  u.push('color/art', 'color/param');
  u.push('keylock', 'deck/1/keylock', 'pad/1/keylock');   // Keylock 3: nur der globale Knopf
  // S5r: Graph-Regler <kanal>/bk/<n> auf jedem Kanal, dazu die Ränder 0 und 9 und Nicht-Kanäle (nur Kanäle mit Graph gelten)
  u.push(...kanaele.flatMap((k) => [0, 1, 8, 9].map((n) => `${k}/bk/${n}`)), 'master/bk/1', 'cue/bk/1', 'pad/3/bk/1');
  return u;
}

test('Pfadmenge gleich dem Vertragsmuster regler_pfad', () => {
  const abweichend = universum().filter((p) => muster.test(p) !== REGLER.has(p));
  assert.deepEqual(abweichend, []);
  assert.ok(REGLER.size > 300, `nur ${REGLER.size} Pfade`); // Gegenprobe: die Tabelle ist nicht leer
});

test('S5r: <kanal>/bk/<1..8> nur auf Kanälen mit Graph, 0..1, Vorgabe 0,5, alle dürfen', () => {
  const mit = ['deck/1', 'deck/2', 'deck/3', 'deck/4', 'erz/1', 'erz/2', 'erz/3', 'erz/5', 'erz/6', 'erz/7', 'pad/1', 'pad/2'];
  const bk = [...REGLER.keys()].filter((p) => /\/bk\/\d$/.test(p));
  assert.equal(bk.length, mit.length * 8);
  for (const k of ['erz/4', 'erz/8', 'bus/1', 'master']) assert.equal(REGLER.has(`${k}/bk/1`), false, k);
  for (const k of mit) assert.equal(kanalVon(`${k}/bk/3`), k);
  const i = reglerInfo('erz/5/bk/8')!;
  assert.deepEqual([i.einheit, i.min, i.max, i.vorgabe, i.nurHand], ['linear', 0, 1, 0.5, false]);
  assert.equal(imBereich(i, 0.25, 0), true);
  assert.equal(imBereich(i, 1.01, 0), false);
  assert.equal(machtLeiser('deck/1/bk/1', 0.9, 0.1), false);   // ein Graph-Regler ist kein Fader: nie "leiser machen"
});

test('§1.5: Bereiche, Vorgaben, nur Hand', () => {
  assert.equal(reglerInfo('deck/2/fader')?.vorgabe, -200);
  assert.equal(reglerInfo('bus/1/fader')?.nurHand, true);
  assert.equal(reglerInfo('deck/1/fader')?.nurHand, false);
  assert.equal(reglerInfo('xfader')?.nurHand, true);
  assert.equal(reglerInfo('deck/1/ziel')?.nurHand, true);
  assert.equal(reglerInfo('cue/pegel')?.vorgabe, -12);
  assert.equal(reglerInfo('duck/tiefe')?.vorgabe, 0);
  assert.equal(reglerInfo('duck/release')?.vorgabe, 200);
  assert.equal(reglerInfo('master/kleber')?.vorgabe, 0);
  assert.equal(reglerInfo('master/kleber')?.nurHand, true);
  // Keylock 3 (Fassung 4): EIN Knopf für alle Quellen, Schalter 0..1, Vorgabe 1, nicht nur Hand, kein Kanal
  assert.deepEqual([reglerInfo('keylock')?.vorgabe, reglerInfo('keylock')?.nurHand, reglerInfo('keylock')?.kanal], [1, false, null]);
  assert.equal(imBereich(reglerInfo('keylock')!, 0, 0), true);
  assert.equal(imBereich(reglerInfo('keylock')!, 0.5, 0), false);
  assert.equal(imBereich(reglerInfo('keylock')!, 1, 4), false);
  assert.equal(imBereich(reglerInfo('deck/1/eq/tief')!, 6, 0), true);
  assert.equal(imBereich(reglerInfo('deck/1/eq/tief')!, 6.5, 0), false);
  assert.equal(imBereich(reglerInfo('deck/1/kill/tief')!, 1, 0), true);
  assert.equal(imBereich(reglerInfo('deck/1/kill/tief')!, 1, 4), false); // Schalter nie als Rampe
  assert.equal(kanalVon('deck/3/send/2'), 'deck/3');
  assert.equal(kanalVon('fx/1/rueckweg'), null);
});

test('§10: leiser heißt Fader oder Send nach unten, Kill an; alles andere nicht', () => {
  assert.equal(machtLeiser('deck/3/fader', -6, -20), true);
  assert.equal(machtLeiser('deck/3/send/1', -10, -200), true);
  assert.equal(machtLeiser('deck/3/kill/tief', 0, 1), true);
  assert.equal(machtLeiser('deck/3/fader', -20, -6), false);  // lauter
  assert.equal(machtLeiser('deck/3/kill/tief', 1, 0), false); // Kill aus
  assert.equal(machtLeiser('deck/3/eq/tief', 0, -30), false); // EQ steht nicht auf der Liste
  assert.equal(machtLeiser('deck/3/trim', 0, -10), false);    // Trim auch nicht
  assert.equal(machtLeiser('fx/1/rueckweg', 0, -20), false);  // kein Kanal
});
