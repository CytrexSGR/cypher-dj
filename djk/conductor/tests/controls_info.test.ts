// Regler-Tabelle gegen den Vertrag: dieselbe Pfadmenge wie das Muster regler_pfad (defs.schema.json), Bereiche und
// „nur Hand“ wie §1.5, „leiser machen“ wie §10 Stufe 1.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { PLUG_HOSTS, PLUG_KNOEPFE, REGLER, imBereich, kanalVon, machtLeiser, reglerInfo, SPUR_BK_SLOTS } from '../src/controls_info.ts';
import { SCHEMA_ORDNER } from '../src/contract.ts';

const muster = new RegExp(JSON.parse(fs.readFileSync(path.join(SCHEMA_ORDNER, 'defs.schema.json'), 'utf8'))
  .$defs.regler_pfad.pattern);

// Universum aller denkbaren Pfade: jede Kanal-Art mit jedem Kanalzug-Glied, dazu die Einzelregler je fx-Nummer
function universum(): string[] {
  const kanaele = [1, 2, 3, 4].map((n) => `deck/${n}`).concat([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `erz/${n}`),
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
  // controller targets: spur/<slot>/bk/<k>, slots 1..SPUR_BK_SLOTS (16), knobs 1..64 (the rows of core/signalbox/src/controls.cpp)
  u.push(...[0, 1, 8, 9, 10, 16, 32].flatMap((n) => [0, 1, 2, 9, 33, 64, 65, 100].map((k) => `spur/${n}/bk/${k}`)), 'spur/1/bk/010', 'spur/1/bk/1x', 'spur/bk/1', 'spur/1/bk');
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
const Q13 = ['deck/1', 'deck/2', 'pad/1', 'pad/2'];   // the four containers (the name is kept from the 13-channel era)
const B4 = ['bus/1', 'bus/2', 'bus/3', 'bus/4'];
// The exact set of the 201 tool paths: gate on the 4 containers, utility on Q13 + B4, multiband and limiter on B4, one global row
function werkzeugPfade(): string[] {
  return [...Q13.flatMap((k) => GATE.map((s) => `${k}/${s}`)), ...[...Q13, ...B4].flatMap((k) => UTIL.map((s) => `${k}/${s}`)),
    ...B4.flatMap((k) => MB.map((s) => `${k}/${s}`)), ...B4.flatMap((k) => LIM.map((s) => `${k}/${s}`)), 'spektrum/kanal'];
}

test('Pfadmenge gleich dem Vertragsmuster regler_pfad', () => {
  const abweichend = universum().filter((p) => muster.test(p) !== REGLER.has(p));
  assert.deepEqual(abweichend, []);
  assert.ok(REGLER.size >= 600, `nur ${REGLER.size} Pfade`); // Gegenprobe: die Tabelle ist nicht leer (A2: with the tool rows, 1254)
});

test('1.15 A2: the table holds exactly the 201 tool paths of section 3 (container core: gate on 4 containers, 36 + 56 + 108 + 1)', () => {
  const soll = werkzeugPfade();
  assert.equal(soll.length, 201);
  assert.equal(new Set(soll).size, 201);
  const werkzeug = [...REGLER.keys()].filter((p) => !p.startsWith('ins/') && /\/(gate|util|mb|lim)\/|^spektrum\//.test(p));
  assert.deepEqual(werkzeug.sort(), [...soll].sort());
  // 909 listed rows before A2 (measured at b257b17c; the controller table has 4 more unlisted ones), + 120 insert rows ins/komp/1..12/* (slice 4a T6) + 59 ins/eq/1/* + 4 ins/saett/1/* (slice 4b T12) + 59 ins/eq/2/* (eq pool 2, 2026-11-06) + 3 ins/lim/1/* (master limiter kind; the tool-row filter below skips ins/ because bus lim rows share the segment)
  // 730 = 120 komp + 8 x 59 eq + 4 x 4 saett + 2 x 3 lim + 4 host + 8 x 5 utility (arr-fx) + 8 x 65 bk (arr-bk, an + k1..k64 since the 64-knob widening; 8 x 33 at 32 knobs, 8 x 9 before); the pin said 245 and ignored the 4 host rows, so it was already red on main (249 rows)
  // strand 5 (dynamics): ins/ rows by kind = komp 160 x 10 + eq 160 x 86 (EQ Pro + key row sc) + saett 32 x 6 + lim 8 x 3 + host 8 + utility 8 x 5 + bk 8 x 65 + gate 16 x 8 + mb 8 x 24 + trans 32 x 6 + bild 16 x 7 (16768; the per-kind pins follow)
  assert.equal([...REGLER.keys()].filter((p) => p.startsWith('ins/')).length, 160 * 10 + 160 * 86 + 32 * 6 + 8 * 3 + 8 + 8 * 5 + 8 * 65 + 16 * 8 + 8 * 24 + 32 * 6 + 16 * 7);
  assert.equal([...REGLER.keys()].filter((p) => p.startsWith('ins/eq/')).length, 160 * 86);   // strand 1 slice 3b: 96 -> 160; strand 5: EQ Pro 59 -> 85 parameters, slice 4: + key row sc
  assert.equal([...REGLER.keys()].filter((p) => p.startsWith('ins/saett/')).length, 32 * 6);   // strand 5: 4 -> 32 instances, 6 parameters (an, drive, out, mix, kurve, decke)
  assert.equal([...REGLER.keys()].filter((p) => p.startsWith('ins/trans/')).length, 32 * 6);   // strand 5 slice 3: transient shaper
  assert.equal([...REGLER.keys()].filter((p) => p.startsWith('ins/bild/')).length, 16 * 7);   // strand 5 slice 3: imager
  assert.equal([...REGLER.keys()].filter((p) => p.startsWith('ins/lim/')).length, 8 * 3);   // strand 1 slice 4: 2 -> 8
  assert.equal([...REGLER.keys()].filter((p) => p.startsWith('ins/gate/')).length, 16 * 8);   // strand 1 slice 4
  assert.equal([...REGLER.keys()].filter((p) => p.startsWith('ins/mb/')).length, 8 * 24);   // strand 1 slice 4: an, grenze_tief, grenze_hoch + 3 bands x 7
  assert.equal([...REGLER.keys()].filter((p) => p.startsWith('ins/utility/')).length, 8 * 5);   // arr-fx slice 1
  assert.equal([...REGLER.keys()].filter((p) => p.startsWith('ins/bk/')).length, 8 * 65);   // arr-bk slice 3 + 64-knob widening: an and k1..k64 per instance
  assert.equal([...REGLER.keys()].filter((p) => p.startsWith('rack/')).length, 48);   // slice 4c: 12 racks x 4 macro rows
  // container core: 4048 rows of the 13-channel table - 432 deck/* rows - 688 erz/* rows + 224 deck/* rows (2 containers x 104 + 16 stem rows)
  // + 712 erz/* alias rows (8 streams x (25 suffixes + 64 bk)) + 1024 strom/1..16/bk/1..64 rows (+ 512 spur/9..16/bk/1..64 rows since 2026-11-21, the core slots 8 -> 16); pad/* (208) and bus/* (196) are unchanged
  // + 396 rows of the K7/K6 growth: spur/1..32/pfl, trim, kill/* (32 x 5 = 160), sends 5..8 of the 32 tracks (128), of the 16 groups (64) and the return strips ret/5..8 (4 x 11 = 44)
  // + 96 rows spur/1..32/fx/1..3 (loop deck lane strip K1/lane S: FX 1 2 3 assignment per track; controls_info.ts:93)
  // Note: the 201 "tool paths" of this test are the gate/util/mb/lim control rows of section 3, not the hand (MCP) tools; the hand tool count is unrelated.
  // + 338 rows: strand 1 slice 4 (gate, multiband, limiters 2 -> 8); + 572 rows: strand 1 slice 1, 10 more compressors (10 rows each) and 8 more EQs
  // (59 rows each); + 9876 rows: strand 1 slice 3b, 138 more compressors and 144 more EQs (slice 3: 74 and 80); + 2304 rows: strand 1 slice 6.1,
  // tracks 33..128 (96 x 24); + 128 rows: strand 2 slice 2, plug/<h>/k<m> (8 x 16)
  // strand 5: the 4048 of the 13-channel table held 1178 ins/ rows (the first 8 compressors and EQs, 4 saturators, ...); every ins/ row is now counted
  // by kind in one sum (INS_ZEILEN, pinned per kind above), so the base is taken without them
  const INS_ZEILEN = 160 * 10 + 160 * 86 + 32 * 6 + 8 * 3 + 8 + 8 * 5 + 8 * 65 + 16 * 8 + 8 * 24 + 32 * 6 + 16 * 7;
  assert.equal(REGLER.size, 4048 - 1178 + 512 - 432 - 688 + 224 + 712 + 1024 + 160 + 128 + 64 + 44 + 32 * 3 + 96 * 24 + 8 * 16 + INS_ZEILEN);
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
      for (const f of ['min', 'max', 'vorgabe'] as const) assert.ok(Math.abs(i[f] - z[f]) < 1e-6 , `${pfad}.${f}: ${i[f]} vs ${z[f]}`);
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
  assert.equal(machtLeiser('pad/1/fader', -6, -20), true);   // control: the rule itself is still alive
  for (const p of ['erz/1/gate/an', 'erz/8/util/dc', 'deck/3/gate/an', 'pad/3/util/dc', 'bus/1/gate/an', 'deck/1/mb/an', 'deck/1/lim/an', 'bus/5/util/dc', 'spektrum/kanal/1',
    'bus/1/mb/tief/solo', 'bus/1/util/gain_db']) assert.equal(REGLER.has(p), false, p);   // negative list of A1b (d)
  assert.equal(kanalVon('bus/2/mb/mitte/makeup'), 'bus/2');
  assert.equal(kanalVon('spektrum/kanal'), null);
  assert.equal(imBereich(reglerInfo('deck/1/gate/an')!, 1, 0), true);
  assert.equal(imBereich(reglerInfo('deck/1/gate/an')!, 1, 4), false);   // switch never as a ramp
  assert.equal(imBereich(reglerInfo('spektrum/kanal')!, 9, 0), true);
  assert.equal(imBereich(reglerInfo('spektrum/kanal')!, 10, 0), false);
  assert.equal(imBereich(reglerInfo('spektrum/kanal')!, 2.5, 0), false);   // steps are integers
  assert.equal(imBereich(reglerInfo('bus/1/mb/tief/ratio')!, 20, 3), true);
  assert.equal(imBereich(reglerInfo('bus/1/mb/tief/ratio')!, 20.5, 3), false);
});

test('S5r: <kanal>/bk/<1..64> on the containers and the alias streams, 0..1, default 0.5, everybody may', () => {
  const mit = ['deck/1', 'deck/2', 'pad/1', 'pad/2', 'erz/1', 'erz/2', 'erz/3', 'erz/5', 'erz/6', 'erz/7', 'erz/9', 'erz/10'];
  const bk = [...REGLER.keys()].filter((p) => /\/bk\/\d+$/.test(p));
  assert.equal(bk.length, (mit.length + 3) * 64 + SPUR_BK_SLOTS * 64 + 16 * 64);   // + fx/3, fx/4, master; + spur/1..16/bk/1..64 (test below); + strom/1..16/bk/1..64
  for (const k of ['deck/3', 'deck/4', 'erz/4', 'erz/8', 'bus/1']) assert.equal(REGLER.has(`${k}/bk/1`), false, k);
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

test('spur/<slot>/bk/<k>: slots 1..16 x knobs 1..64, linear 0..1, default 0.5, no channel, everybody may (as the core rows)', () => {
  const spur = [...REGLER.keys()].filter((p) => p.startsWith('spur/') && p.includes('/bk/'));
  assert.equal(SPUR_BK_SLOTS, 16);
  assert.equal(spur.length, SPUR_BK_SLOTS * 64);
  for (let n = 1; n <= SPUR_BK_SLOTS; n++) for (let k = 1; k <= 64; k++) {
    const i = reglerInfo(`spur/${n}/bk/${k}`)!;
    assert.deepEqual([i.einheit, i.min, i.max, i.vorgabe, i.nurHand, i.kanal], ['linear', 0, 1, 0.5, false, null], `spur/${n}/bk/${k}`);
  }
  for (const p of ['spur/0/bk/1', 'spur/17/bk/1', 'spur/1/bk/0', 'spur/1/bk/65', 'spur/1/bk/01', 'spur/32/bk/1']) assert.equal(REGLER.has(p), false, p);   // negative controls
  assert.equal(machtLeiser('spur/1/bk/1', 0.9, 0.1), false);
});

test('§1.5: Bereiche, Vorgaben, nur Hand', () => {
  assert.equal(reglerInfo('deck/2/fader')?.vorgabe, -200);
  assert.equal(reglerInfo('bus/1/fader')?.nurHand, false);
  assert.equal(reglerInfo('deck/1/fader')?.nurHand, false);
  assert.equal(reglerInfo('xfader')?.nurHand, false);
  assert.equal(reglerInfo('deck/1/ziel')?.nurHand, false);
  assert.equal(reglerInfo('cue/pegel')?.vorgabe, -12);
  assert.equal(reglerInfo('cue/pegel')?.nurHand, true);   // kept lock: headphone level at Andreas' ears
  assert.equal(reglerInfo('master/pegel')?.nurHand, false);
  assert.equal(reglerInfo('cue/mix')?.nurHand, false);
  assert.equal(reglerInfo('duck/tiefe')?.vorgabe, 0);
  assert.equal(reglerInfo('duck/release')?.vorgabe, 200);
  assert.equal(reglerInfo('master/kleber')?.vorgabe, 0);
  assert.equal(reglerInfo('master/kleber')?.nurHand, false);
  // Keylock 3 (Fassung 4): EIN Knopf für alle Quellen, Schalter 0..1, Vorgabe 1, nicht nur Hand, kein Kanal
  assert.deepEqual([reglerInfo('keylock')?.vorgabe, reglerInfo('keylock')?.nurHand, reglerInfo('keylock')?.kanal], [1, false, null]);
  assert.equal(imBereich(reglerInfo('keylock')!, 0, 0), true);
  assert.equal(imBereich(reglerInfo('keylock')!, 0.5, 0), false);
  assert.equal(imBereich(reglerInfo('keylock')!, 1, 4), false);
  assert.equal(imBereich(reglerInfo('deck/1/eq/tief')!, 6, 0), true);
  assert.equal(imBereich(reglerInfo('deck/1/eq/tief')!, 6.5, 0), false);
  assert.equal(imBereich(reglerInfo('deck/1/kill/tief')!, 1, 0), true);
  assert.equal(imBereich(reglerInfo('deck/1/kill/tief')!, 1, 4), false); // Schalter nie als Rampe
  assert.equal(kanalVon('pad/1/send/2'), 'pad/1');
  assert.equal(kanalVon('fx/1/rueckweg'), null);
});

test('§10: leiser heißt Fader oder Send nach unten, Kill an; alles andere nicht', () => {
  assert.equal(machtLeiser('pad/1/fader', -6, -20), true);
  assert.equal(machtLeiser('pad/1/send/1', -10, -200), true);
  assert.equal(machtLeiser('pad/1/kill/tief', 0, 1), true);
  assert.equal(machtLeiser('pad/1/fader', -20, -6), false);  // lauter
  assert.equal(machtLeiser('pad/1/kill/tief', 1, 0), false); // Kill aus
  assert.equal(machtLeiser('pad/1/eq/tief', 0, -30), false); // EQ steht nicht auf der Liste
  assert.equal(machtLeiser('pad/1/trim', 0, -10), false);    // Trim auch nicht
  assert.equal(machtLeiser('fx/1/rueckweg', 0, -20), false);  // kein Kanal
});

test('strand 2 slice 2: plug/<h>/k<m>, hosts 1..8 x knobs 1..16, linear 0..1, default 0, no channel, everybody may (as the core rows)', () => {
  assert.equal(PLUG_HOSTS, 8);
  assert.equal(PLUG_KNOEPFE, 16);
  const plug = [...REGLER.keys()].filter((p) => p.startsWith('plug/'));
  assert.equal(plug.length, 128);
  for (let h = 1; h <= 8; h++) for (let m = 1; m <= 16; m++) {
    assert.deepEqual(reglerInfo(`plug/${h}/k${m}`), { pfad: `plug/${h}/k${m}`, kanal: null, einheit: 'linear', min: 0, max: 1, vorgabe: 0, nurHand: false });
  }
  assert.equal(reglerInfo('plug/3/k7')?.einheit, 'linear');
  for (const p of ['plug/0/k1', 'plug/9/k1', 'plug/1/k0', 'plug/1/k17', 'plug/1/k01', 'plug/01/k1', 'plug/1/1', 'plug/1']) assert.equal(reglerInfo(p), null, p);
  assert.equal(kanalVon('plug/1/k1'), null);
  assert.equal(machtLeiser('plug/1/k1', 0.9, 0.1), false);
  assert.equal(imBereich(reglerInfo('plug/1/k1')!, 0.5, 100), true);
  assert.equal(imBereich(reglerInfo('plug/1/k1')!, 1.5, 0), false);
});
