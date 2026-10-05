import test from 'node:test';
import assert from 'node:assert/strict';
import { dekodiere } from '../../vertrag/attrappe_kern/osc.mjs';
import { kompiliere } from '../src/kompiliere.mjs';
import { Planer } from '../src/planer.mjs';
import { teile } from '../src/fenster.mjs';

// Kit wie kit.json: bd:0 → 0, hh:0 → 1, hh:1 → 2
const KIT = { name: 't', note: new Map([['bd:0', 0], ['hh:0', 1], ['hh:1', 2]]), bank: new Map([['bd', 1], ['hh', 2]]) };
const m = (t) => kompiliere(t).muster;

function welt() {
  const bundles = [];
  const p = new Planer({ strom: 1, kit: KIT, sende: (b) => bundles.push(b), jetztUs: () => 0 });
  const fenster = () => bundles.map((b) => {
    const d = dekodiere(b);
    const [kopf, ...evs] = d.elemente;
    return { groesse: b.length, ab: kopf.werte[4], bis: kopf.werte[5], sendung: kopf.werte[1],
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

test('slice meldet keine Felder (Strudels internes _slices ist kein Parameter)', () => {
  const w = welt();
  w.p.setze(m('s("bd*4").slice(4, "0 1 2 3")'), -Infinity);
  w.p.takt(0);
  assert.deepEqual([...w.p.felder], []);
});
