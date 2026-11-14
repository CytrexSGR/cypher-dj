// Regler-Tabelle gegen den Vertrag: dieselbe Pfadmenge wie das Muster regler_pfad (defs.schema.json), Bereiche und
// „nur Hand“ wie §1.5, „leiser machen“ wie §10 Stufe 1.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { REGLER, imBereich, kanalVon, machtLeiser, reglerInfo } from '../src/controls_info.ts';
import { SCHEMA_ORDNER } from '../src/contract.ts';

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
  // S5r: Graph-Regler <kanal>/bk/<n> auf jedem Kanal, dazu die Ränder 0, 9, 32, 33, 64, 65 und Nicht-Kanäle (nur Kanäle mit Graph gelten)
  u.push(...kanaele.flatMap((k) => [0, 1, 8, 9, 10, 32, 33, 63, 64, 65, 100].map((n) => `${k}/bk/${n}`)), 'master/bk/1', 'cue/bk/1', 'pad/3/bk/1');
  // S14: the same for the send returns fx/1..5 (only fx/3 and fx/4 have graph knobs)
  u.push(...[1, 2, 3, 4, 5].flatMap((n) => [0, 1, 8, 9, 10, 32, 33, 64, 65].map((m) => `fx/${n}/bk/${m}`)));
  // 1.15 A2: every mix-tool suffix on every channel kind (positives where the contract has a row, wrong-kind negatives everywhere
  // else), plus near misses that are deliberately not exposed (utility gain_db, per-band solo, limiter vorhalt_ms / echtspitze)
  u.push(...kanaele.flatMap((k) => WERKZEUG_SUFFIXE.map((s) => `${k}/${s}`)));
  u.push('spektrum/kanal', 'spektrum/kanal/1', 'spektrum', 'deck/1/spektrum/kanal', 'bus/5/util/dc', 'bus/0/lim/an', 'erz/9/gate/an',
    ...kanaele.flatMap((k) => ['util/gain_db', 'mb/tief/solo', 'mb/solo', 'lim/vorhalt_ms', 'lim/echtspitze', 'gate/zz', 'util/zz', 'lim/zz',
      'mb/zz/ratio', 'mb/tief/zz'].map((s) => `${k}/${s}`)));
  return u;
}

// The suffixes of section 3 (INTERFACES 1.5), written out here independently of controls_info.ts and of the C++ header
const GATE = ['an', 'schwelle', 'hysterese', 'ratio', 'bereich', 'attack', 'hold', 'release', 'sc'].map((s) => `gate/${s}`);
const UTIL = ['balance', 'breite', 'bassmono', 'phase_l', 'phase_r', 'tausch', 'dc'].map((s) => `util/${s}`);
const MB = ['mb/an', 'mb/grenze_tief', 'mb/grenze_hoch', ...['tief', 'mitte', 'hoch'].flatMap((b) =>
  ['schwelle', 'ratio', 'attack', 'release', 'knie', 'makeup', 'umgehen'].map((s) => `mb/${b}/${s}`))];
const LIM = ['lim/an', 'lim/decke', 'lim/abklingen'];
const WERKZEUG_SUFFIXE = [...GATE, ...UTIL, ...MB, ...LIM];
const Q13 = ['deck/1', 'deck/2', 'deck/3', 'deck/4', 'erz/1', 'erz/2', 'erz/3', 'erz/4', 'erz/5', 'erz/6', 'erz/7', 'pad/1', 'pad/2'];
const B4 = ['bus/1', 'bus/2', 'bus/3', 'bus/4'];
// The exact set of the 345 tool paths: gate on Q13, utility on Q13 + B4, multiband and limiter on B4, one global row
function werkzeugPfade(): string[] {
  return [...Q13.flatMap((k) => GATE.map((s) => `${k}/${s}`)), ...[...Q13, ...B4].flatMap((k) => UTIL.map((s) => `${k}/${s}`)),
    ...B4.flatMap((k) => MB.map((s) => `${k}/${s}`)), ...B4.flatMap((k) => LIM.map((s) => `${k}/${s}`)), 'spektrum/kanal'];
}

test('Pfadmenge gleich dem Vertragsmuster regler_pfad', () => {
  const abweichend = universum().filter((p) => muster.test(p) !== REGLER.has(p));
  assert.deepEqual(abweichend, []);
  assert.ok(REGLER.size >= 600, `nur ${REGLER.size} Pfade`); // Gegenprobe: die Tabelle ist nicht leer (A2: with the tool rows, 1254)
});

test('1.15 A2: the table holds exactly the 345 tool paths of section 3 and grows by exactly 345 (909 -> 1254)', () => {
  const soll = werkzeugPfade();
  assert.equal(soll.length, 345);
  assert.equal(new Set(soll).size, 345);
  const werkzeug = [...REGLER.keys()].filter((p) => !p.startsWith('ins/') && /\/(gate|util|mb|lim)\/|^spektrum\//.test(p));
  assert.deepEqual(werkzeug.sort(), [...soll].sort());
  // 909 listed rows before A2 (measured at b257b17c; the controller table has 4 more unlisted ones), + 120 insert rows ins/komp/1..12/* (slice 4a T6) + 59 ins/eq/1/* + 4 ins/saett/1/* (slice 4b T12) + 59 ins/eq/2/* (eq pool 2, 2026-11-06) + 3 ins/lim/1/* (master limiter kind; the tool-row filter below skips ins/ because bus lim rows share the segment)
  // 730 = 120 komp + 8 x 59 eq + 4 x 4 saett + 2 x 3 lim + 4 host + 8 x 5 utility (arr-fx) + 8 x 65 bk (arr-bk, an + k1..k64 since the 64-knob widening; 8 x 33 at 32 knobs, 8 x 9 before); the pin said 245 and ignored the 4 host rows, so it was already red on main (249 rows)
  assert.equal([...REGLER.keys()].filter((p) => p.startsWith('ins/')).length, 1178);
  assert.equal([...REGLER.keys()].filter((p) => p.startsWith('ins/eq/')).length, 8 * 59);
  assert.equal([...REGLER.keys()].filter((p) => p.startsWith('ins/saett/')).length, 4 * 4);
  assert.equal([...REGLER.keys()].filter((p) => p.startsWith('ins/lim/')).length, 2 * 3);
  assert.equal([...REGLER.keys()].filter((p) => p.startsWith('ins/utility/')).length, 8 * 5);   // arr-fx slice 1
  assert.equal([...REGLER.keys()].filter((p) => p.startsWith('ins/bk/')).length, 8 * 65);   // arr-bk slice 3 + 64-knob widening: an and k1..k64 per instance
  assert.equal([...REGLER.keys()].filter((p) => p.startsWith('rack/')).length, 48);   // slice 4c: 12 racks x 4 macro rows
  assert.equal(REGLER.size, 909 + 784 + 345 + 1178 + 48 + 80 + 64);   // 3408 = 3344 + 64 (master/bk/1..64, the graph place on the DJ master); 3344 = 3264 + 80: the mixer went from 8 groups x 8 rows to 16 groups x 9 rows (c3396e9a, 3db625e3); the sibling test below compares every row with the core table in both directions
  for (const p of soll) assert.equal(muster.test(p), true, `schema takes ${p}`);
});

// Strict parser of the one machine-readable source: one `{...}` row per line of tool_controls.h. Throws on any line of the block it
// cannot read, so a reformatted header never yields an empty green.
function kopfZeilen(): { suffix: string; min: number; max: number; vorgabe: number; kurve: string; ganz: boolean; kanalart: string }[] {
  const kopf = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'core', 'signalbox', 'include', 'cypherdj', 'signalbox',
    'tool_controls.h'), 'utf8');
  const von = kopf.indexOf('WERKZEUG_ZEILEN[] = {');
  const bis = kopf.indexOf('\n};', von);
  assert.ok(von > 0 && bis > von, 'WERKZEUG_ZEILEN block not found in tool_controls.h');
  const zahl = '(-?[0-9]+(?:\\.[0-9]+)?)f?';
  const zeile = new RegExp(`^\\{WzTool::[a-z]+, "([a-z_/]+)", ${zahl}, ${zahl}, ${zahl}, KurvenTyp::(schalter|stufen|linear), [0-9]+, (true|false), ` +
    'WzKanalart::(quellen|quellen_busse|busse|global)\\},$');
  return kopf.slice(von, bis).split('\n').slice(1).map((l) => {
    const m = zeile.exec(l.trim());
    if (!m) throw new Error(`tool_controls.h: unreadable row: ${l}`);
    return { suffix: m[1], min: Number(m[2]), max: Number(m[3]), vorgabe: Number(m[4]), kurve: m[5], ganz: m[6] === 'true', kanalart: m[7] };
  });
}

test('1.15 A2: range, default, unit and channel set of every tool row equal the rows of tool_controls.h (both directions)', () => {
  const zeilen = kopfZeilen();
  assert.equal(zeilen.length, 44);
  const kanaele: Record<string, readonly string[]> = { quellen: Q13, quellen_busse: [...Q13, ...B4], busse: B4, global: [''] };
  const einheit: Record<string, string> = { schalter: 'schalter', stufen: 'stufe', linear: 'linear' };
  const ausKopf: string[] = [];
  for (const z of zeilen) {
    for (const k of kanaele[z.kanalart]) {
      const pfad = k === '' ? z.suffix : `${k}/${z.suffix}`;
      ausKopf.push(pfad);
      const i = reglerInfo(pfad);
      assert.ok(i, `${pfad} missing in regler_info`);
      assert.equal(i.einheit, einheit[z.kurve], pfad);
      assert.equal(i.nurHand, false, pfad);
      assert.equal(i.kanal, k === '' ? null : k, pfad);
      // the header writes 0.1f / -0.3f (float), the table holds the double: equal within float precision
      for (const f of ['min', 'max', 'vorgabe'] as const) assert.ok(Math.abs(i[f] - z[f]) < 1e-6, `${pfad}.${f}: ${i[f]} vs ${z[f]}`);
      assert.equal(z.ganz, i.einheit !== 'linear', pfad);   // switch or steps = integer value
    }
  }
  assert.deepEqual(ausKopf.sort(), werkzeugPfade().sort());
});

test('1.15 A2: tool rows are never "leiser machen" for Cypher (D16, default deny); wrong channel kinds are not in the table', () => {
  assert.equal(machtLeiser('deck/1/gate/an', 0, 1), false);
  assert.equal(machtLeiser('bus/1/lim/an', 0, 1), false);
  assert.equal(machtLeiser('bus/1/mb/an', 0, 1), false);
  assert.equal(machtLeiser('deck/1/gate/schwelle', -40, -90), false);   // lowering a threshold is not "leiser"
  assert.equal(machtLeiser('bus/2/mb/tief/makeup', 0, -24), false);
  assert.equal(machtLeiser('deck/3/fader', -6, -20), true);   // control: the rule itself is still alive
  for (const p of ['erz/8/gate/an', 'erz/8/util/dc', 'bus/1/gate/an', 'deck/1/mb/an', 'deck/1/lim/an', 'bus/5/util/dc', 'spektrum/kanal/1',
    'bus/1/mb/tief/solo', 'bus/1/util/gain_db']) assert.equal(REGLER.has(p), false, p);   // negative list of A1b (d)
  assert.equal(kanalVon('bus/2/mb/mitte/makeup'), 'bus/2');
  assert.equal(kanalVon('spektrum/kanal'), null);
  assert.equal(imBereich(reglerInfo('deck/1/gate/an')!, 1, 0), true);
  assert.equal(imBereich(reglerInfo('deck/1/gate/an')!, 1, 4), false);   // switch never as a ramp
  assert.equal(imBereich(reglerInfo('spektrum/kanal')!, 19, 0), true);
  assert.equal(imBereich(reglerInfo('spektrum/kanal')!, 20, 0), false);
  assert.equal(imBereich(reglerInfo('spektrum/kanal')!, 2.5, 0), false);   // steps are integers
  assert.equal(imBereich(reglerInfo('bus/1/mb/tief/ratio')!, 20, 3), true);
  assert.equal(imBereich(reglerInfo('bus/1/mb/tief/ratio')!, 20.5, 3), false);
});

test('S5r: <kanal>/bk/<1..64> nur auf Kanälen mit Graph, 0..1, Vorgabe 0,5, alle dürfen', () => {
  const mit = ['deck/1', 'deck/2', 'deck/3', 'deck/4', 'erz/1', 'erz/2', 'erz/3', 'erz/5', 'erz/6', 'erz/7', 'pad/1', 'pad/2'];
  const bk = [...REGLER.keys()].filter((p) => /\/bk\/\d+$/.test(p));
  assert.equal(bk.length, (mit.length + 3) * 64);   // S14: + fx/3, fx/4; + master (graph place on the DJ master)
  for (const k of ['erz/4', 'erz/8', 'bus/1']) assert.equal(REGLER.has(`${k}/bk/1`), false, k);
  assert.equal(kanalVon('master/bk/3'), null);   // the master sum is no channel
  for (const k of mit) assert.equal(kanalVon(`${k}/bk/3`), k);
  const i = reglerInfo('erz/5/bk/64')!;
  assert.deepEqual([i.einheit, i.min, i.max, i.vorgabe, i.nurHand], ['linear', 0, 1, 0.5, false]);
  assert.equal(imBereich(i, 0.25, 0), true);
  assert.equal(imBereich(i, 1.01, 0), false);
  assert.equal(machtLeiser('deck/1/bk/1', 0.9, 0.1), false);   // ein Graph-Regler ist kein Fader: nie "leiser machen"
});

test('S14: fx/3/bk/<1..64> and fx/4/bk/<1..64> are global graph knobs of the send returns, 0..1, default 0.5, everybody may', () => {
  for (const n of [3, 4]) for (let m = 1; m <= 64; m++) {
    const i = reglerInfo(`fx/${n}/bk/${m}`)!;
    assert.deepEqual([i.einheit, i.min, i.max, i.vorgabe, i.nurHand], ['linear', 0, 1, 0.5, false], `fx/${n}/bk/${m}`);
    assert.equal(i.kanal, null);
  }
  assert.equal(kanalVon('fx/3/bk/1'), kanalVon('fx/3/rueckweg'));   // both global
  for (const p of ['fx/1/bk/1', 'fx/2/bk/1', 'fx/5/bk/1', 'fx/3/bk/0', 'fx/3/bk/65', 'fx/4/bk/033', 'fx/4/bk/640', 'deck/1/bk/65']) assert.equal(REGLER.has(p), false, p);   // negative controls
  assert.equal(machtLeiser('fx/3/bk/1', 0.9, 0.1), false);
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
