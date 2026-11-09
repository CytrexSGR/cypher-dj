import test from 'node:test';
import assert from 'node:assert/strict';
import { dekodiere } from '../../contract/mock_core/osc.mjs';
import { kompiliere } from '../src/compile.mjs';
import { Planer } from '../src/planner.mjs';
import { teile } from '../src/window.mjs';

// Kit wie kit.json: bd:0 → 0, hh:0 → 1, hh:1 → 2
const KIT = { name: 't', note: new Map([['bd:0', 0], ['hh:0', 1], ['hh:1', 2]]), bank: new Map([['bd', 1], ['hh', 2]]) };
const m = (t) => kompiliere(t).muster;

function welt() {
  const bundles = [];
  const p = new Planer({ strom: 1, kit: KIT, sende: (b) => bundles.push(b), jetztUs: () => 0 });
  const fenster = () => bundles.map((b) => {
    const d = dekodiere(b);
    const [kopf, ...evs] = d.elemente;
    return { groesse: b.length, ab: kopf.werte[4], bis: kopf.werte[5], sendung: kopf.werte[1], kappe: kopf.werte[3],
      evs: evs.map((e) => ({ muster: e.werte[1], note: e.werte[3], beat: e.werte[4], velocity: e.werte[6] })) };
  });
  return { p, bundles, fenster };
}

test('takt(0) schickt die Takte 2 und 3 (Beats 4 bis 12) lückenlos', () => {
  const w = welt();
  w.p.setze(m('s("bd*4")'), -Infinity);
  w.p.takt(0);
  const f = w.fenster();
  assert.equal(f[0].ab, 4);
  assert.equal(f.at(-1).bis, 12);
  assert.deepEqual(f.flatMap((x) => x.evs.map((e) => e.beat)), [4, 5, 6, 7, 8, 9, 10, 11]);
  assert.ok(f.every((x) => x.evs.every((e) => e.note === 0 && e.muster === 1)));
});

test('dichtes Muster: jedes Bundle <= 1400 Bytes und <= 20 Ereignisse, Teilfenster lückenlos', () => {
  const w = welt();
  w.p.setze(m('s("hh*16, bd*4")'), -Infinity);
  w.p.takt(0);
  const f = w.fenster();
  assert.ok(f.length >= 2);
  assert.ok(f.every((x) => x.groesse <= 1400 && x.evs.length <= 20), JSON.stringify(f.map((x) => [x.groesse, x.evs.length])));
  for (let i = 1; i < f.length; i++) assert.equal(f[i].ab, f[i - 1].bis);
  assert.equal(f.flatMap((x) => x.evs).length, 2 * (16 + 4) * 1);   // 2 Takte · 20 Ereignisse
});

test('Wechsel bei Beat 10,3 gilt ab Beat 12 und ersetzt das schon geschickte [12, 20)', () => {
  const w = welt();
  w.p.setze(m('s("bd*4")'), -Infinity);
  w.p.takt(2);                                   // Beat 8: schickt [12, 20)
  w.bundles.length = 0;
  const ab = w.p.setze(m('s("hh*2")'), 10.3);
  assert.equal(ab, 12);
  const f = w.fenster();
  assert.equal(f[0].ab, 12);
  assert.equal(f.at(-1).bis, 20);
  assert.deepEqual(f.flatMap((x) => x.evs.map((e) => [e.beat, e.note, e.muster])),
    [[12, 1, 2], [14, 1, 2], [16, 1, 2], [18, 1, 2]]);
});

test('Wechsel kurz vor dem Takt (11,9) gilt erst ab dem nächsten (16)', () => {
  const w = welt();
  w.p.setze(m('s("bd*4")'), -Infinity);
  w.p.takt(2);
  assert.equal(w.p.setze(m('s("hh*2")'), 11.9), 16);
});

test('unbekannter Klang wird gemeldet und nicht geschickt; gain wird velocity; n wählt im Bank-Ring', () => {
  const w = welt();
  w.p.setze(m('s("bd xyz hh:1 hh:3").gain("0.5 1 1 1")'), -Infinity);
  const unbekannt = w.p.takt(0);
  assert.deepEqual([...unbekannt], ['xyz']);
  const evs = w.fenster().flatMap((x) => x.evs).filter((e) => e.beat < 8);
  assert.deepEqual(evs.map((e) => [e.beat, e.note]), [[4, 0], [6, 2], [7, 2]]);   // hh:3 → 3 mod 2 = hh:1
  assert.equal(evs[0].velocity, 0.5);
});

test('Negativ-Kontrolle: ohne Muster ein leeres Fenster (Stille ersetzt), keine Ereignisse', () => {
  const w = welt();
  w.p.takt(0);
  const f = w.fenster();
  assert.equal(f.length, 1);
  assert.deepEqual([f[0].ab, f[0].bis, f[0].evs.length], [4, 12, 0]);
});

test('teile: was auf einem Beat nicht in ein Bundle passt, ist ein Fehler', () => {
  const evs = Array.from({ length: 22 }, () => ({ beat: 4, param: [] }));   // 22 · 60 > 1 312
  assert.throws(() => teile(evs, 4, 8), /passen auf Beat 4 nicht in ein Bundle/);
  assert.equal(teile(evs.slice(0, 21), 4, 8).length, 1);                    // 21 · 60 = 1 260 passt
});

// Scheibe 3 (§4.8 Parameter-Schwanz): begin/end aus Strudel kommen als Paare (nr, wert) an /erz/ev, nur wenn ungleich
// der Vorgabe; Bundle-Größe nach Bytes; unbekannte Strudel-Felder werden gemeldet, nicht still verschluckt.
test('begin/end werden als Schwanz geschickt, Vorgabewerte nicht', () => {
  const w = welt();
  w.p.setze(m('s("bd bd").begin("0 0.5").end("1 0.75")'), -Infinity);
  w.p.takt(0);
  const els = w.bundles.flatMap((b) => dekodiere(b).elemente.slice(1)).filter((e) => e.werte[4] < 8);   // zwei Schläge je Takt: Beat 4 und 6
  assert.deepEqual(els.map((e) => [e.werte[4], e.typen, e.werte.slice(7)]),
    [[4, 'iiiiddf', []], [6, 'iiiiddfifif', [0, 0.5, 1, 0.75]]]);
});

test('slice(4, …) wird zu begin/end je Stück', () => {
  const w = welt();
  w.p.setze(m('s("bd*4").slice(4, "0 2 1 3")'), -Infinity);
  w.p.takt(0);
  const els = w.bundles.flatMap((b) => dekodiere(b).elemente.slice(1)).filter((e) => e.werte[4] < 8);
  const par = els.map((e) => Object.fromEntries(Array.from({ length: (e.werte.length - 7) / 2 }, (_, k) => [e.werte[7 + 2 * k], e.werte[8 + 2 * k]])));
  assert.deepEqual(par.map((x) => [x[0] ?? 0, x[1] ?? 1]), [[0, 0.25], [0.5, 0.75], [0.25, 0.5], [0.75, 1]]);
});

test('Bundles bleiben mit Schwanz unter 1 400 Bytes und lückenlos', () => {
  const w = welt();
  w.p.setze(m('s("hh*16, bd*4").begin(0.1).end(0.9)'), -Infinity);
  w.p.takt(0);
  const f = w.fenster();
  assert.ok(f.every((x) => x.groesse <= 1400), JSON.stringify(f.map((x) => x.groesse)));
  for (let i = 1; i < f.length; i++) assert.equal(f[i].ab, f[i - 1].bis);
  assert.equal(f.flatMap((x) => x.evs).length, 40);
});

test('unbekannte Strudel-Felder werden gemeldet (speed), bekannte nicht', () => {
  const w = welt();
  w.p.setze(m('s("bd").speed(2).begin(0.5).gain(0.8)'), -Infinity);
  w.p.takt(0);
  assert.deepEqual([...w.p.felder], ['speed']);
});

// Task 1.4 Review Fund 1: Felder sammeln über alle Takte des Musters, nicht nur bis zur ersten Meldung
test('Felder eines späten Zweigs (alle 4 Takte) kommen nach dem ersten Takt noch dazu', () => {
  const w = welt();
  w.p.setze(m('stack(s("bd").lpf(800), s("<~ ~ ~ bd>").room(0.3))'), -Infinity);
  w.p.takt(0);
  assert.deepEqual([...w.p.felder], ['cutoff']);
  for (let n = 1; n < 6; n++) w.p.takt(n);
  assert.deepEqual([...w.p.felder].sort(), ['cutoff', 'room']);
});

// Fund 2: ein neues Muster verdrängt die Felder des alten
test('zwei Musterwechsel vor dem nächsten Takt: Felder des verdrängten Musters sind weg', () => {
  const w = welt();
  w.p.setze(m('s("bd")'), -Infinity);
  w.p.takt(0);
  w.p.setze(m('s("bd").lpf(800)'), 1);
  w.p.setze(m('s("bd").gain(0.8)'), 1.5);
  w.p.takt(1);
  assert.deepEqual([...w.p.felder], []);
});

test('slice meldet keine Felder (Strudels internes _slices ist kein Parameter)', () => {
  const w = welt();
  w.p.setze(m('s("bd*4").slice(4, "0 1 2 3")'), -Infinity);
  w.p.takt(0);
  assert.deepEqual([...w.p.felder], []);
});

// Bug t_bffc3708 (2) (live jam 2026-11-07): `stille` writes `silence` into every stream. The window of the silence only replaced
// events that had not started; a note that was already sounding (hartsync-lead on erz/3, long note) rang on to the end of its own
// duration, nothing told the kern to end it. A silent pattern now ships its first window with kappe = 1 (/erz/fenster 4th field):
// the kern ends the notes of the stream that still sound at ab_beat. Patterns that are not silent never set it.
const MIDI = { midi: true };
function midiWelt() {
  const bundles = [];
  const p = new Planer({ strom: 3, kit: MIDI, sende: (b) => bundles.push(b), jetztUs: () => 0 });
  const kappen = () => bundles.map((b) => { const [kopf, ...evs] = dekodiere(b).elemente; return { ab: kopf.werte[4], bis: kopf.werte[5], kappe: kopf.werte[3], n: evs.length }; });
  return { p, bundles, kappen };
}

test('held note, then silence at beat 10.3: the replacing window [12, 20) carries kappe = 1 and no events', () => {
  const w = midiWelt();
  w.p.setze(m('note("c3").slow(4)'), -Infinity);   // one note of 16 beats
  w.p.takt(2);                                     // beat 8: ships [12, 20)
  w.bundles.length = 0;
  assert.equal(w.p.setze(m('silence'), 10.3), 12);
  assert.deepEqual(w.kappen(), [{ ab: 12, bis: 20, kappe: 1, n: 0 }]);
});

test('the flag sits on the replacing window only; the bar windows after it do not repeat it', () => {
  const w = midiWelt();
  w.p.setze(m('note("c3*16")'), -Infinity);
  w.p.takt(2);
  w.bundles.length = 0;
  w.p.setze(m('silence'), 10.3);
  assert.deepEqual(w.kappen().map((x) => x.kappe), [1]);   // silence is one empty window
  w.p.takt(3);
  assert.ok(w.kappen().slice(1).every((x) => x.kappe === 0), JSON.stringify(w.kappen()));
});

test('negative controls: a pattern with notes never sets kappe, neither does a plain bar window, nor the very first pattern', () => {
  const w = midiWelt();
  w.p.setze(m('note("c3").slow(4)'), -Infinity);
  w.p.takt(0);
  w.p.takt(1);
  w.p.setze(m('note("e3 g3")'), 5.0);
  w.p.takt(2);
  assert.ok(w.kappen().every((x) => x.kappe === 0), JSON.stringify(w.kappen()));
  const e = midiWelt();
  e.p.setze(m('silence'), -Infinity);   // nothing was shipped yet, nothing can ring
  e.p.takt(0);
  assert.ok(e.kappen().every((x) => x.kappe === 0), JSON.stringify(e.kappen()));
});

test('silence in other spellings is silence too (s("~"), note("~ ~")); a pattern with an onset within 16 bars of ab is not', () => {
  for (const [text, still] of [['silence', true], ['s("~")', true], ['note("~ ~")', true], ['note("c3 ~ ~ ~").slow(4)', false], ['note("c3")', false]]) {
    const w = midiWelt();
    w.p.setze(m('note("c3").slow(4)'), -Infinity);
    w.p.takt(2);
    w.bundles.length = 0;
    w.p.setze(m(text), 10.3);
    assert.equal(w.kappen()[0].kappe, still ? 1 : 0, text);
  }
});

// Review t_bffc3708 Minor 3: istStille asks cycle by cycle and stops at the first onset (a dense stack costs one cycle, not 16, before the window goes out)
test('istStille stops at the first cycle with an onset; a silent pattern is asked 16 cycles in a row from ab / 4, not from cycle 0', () => {
  const p = new Planer({ strom: 3, kit: MIDI, sende: () => {}, jetztUs: () => 0 });
  const fragen = [];
  const mit = (ab_zyklus) => ({ queryArc: (a, b) => { fragen.push([a, b]); return a <= ab_zyklus && ab_zyklus < b ? [{ hasOnset: () => true }] : []; } });
  assert.equal(p.istStille(mit(3), 12), false);
  assert.deepEqual(fragen, [[3, 4]], 'an onset in the very first cycle: one query');
  fragen.length = 0;
  assert.equal(p.istStille(mit(5), 12), false);
  assert.deepEqual(fragen, [[3, 4], [4, 5], [5, 6]], 'stops in the cycle that has the onset');
  fragen.length = 0;
  assert.equal(p.istStille(mit(18), 12), false);   // the last cycle of the 16 from cycle 3 is 18
  assert.equal(fragen.length, 16);
  fragen.length = 0;
  assert.equal(p.istStille(mit(19), 12), true);    // cycle 19 is one too far
  assert.equal(fragen.length, 16);
  assert.deepEqual([fragen[0], fragen.at(-1)], [[3, 4], [18, 19]]);
  fragen.length = 0;
  assert.equal(p.istStille(mit(0), -Infinity), false);   // no ab yet (first pattern): from cycle 0
  assert.deepEqual(fragen, [[0, 1]]);
});

test('a sparse pattern counts from ab, not from cycle 0: slow(32) has its onset in cycle 0, none in the 16 cycles from cycle 3', () => {
  const w = midiWelt();
  w.p.setze(m('note("c3").slow(4)'), -Infinity);
  w.p.takt(2);
  w.bundles.length = 0;
  w.p.setze(m('note("c3").slow(32)'), 10.3);   // ab = 12 = cycle 3
  assert.equal(w.kappen()[0].kappe, 1);
  const v = midiWelt();   // control: the same pattern asked from cycle 0 would have an onset; a pattern with its onset at cycle 18 is not silent
  v.p.setze(m('note("c3").slow(4)'), -Infinity);
  v.p.takt(2);
  v.bundles.length = 0;
  v.p.setze(m('note("<~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ c3>")'), 10.3);   // onset in cycle 15 (every 16)
  assert.equal(v.kappen()[0].kappe, 0);
});

test('only the first window of a split replacing range carries kappe (schicke called directly with a dense pattern)', () => {
  const w = midiWelt();
  w.p.setze(m('note("c3*16, e3*16")'), -Infinity);
  w.p.horizont = 20;
  w.p.schicke(12, 20, true);
  const k = w.kappen();
  assert.ok(k.length >= 2, `needs a split: ${k.length} window(s)`);
  assert.deepEqual(k.map((x) => x.kappe), [1, ...k.slice(1).map(() => 0)]);
});
