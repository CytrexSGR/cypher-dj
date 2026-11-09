// Automation Slice 1, Task 2: Befehle auto_neu, auto_punkte, auto_loeschen (Gründe, Undo, Patch-Größe). Plan 2026-10-31-automation-slice1.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreAus, fuehreListeAus, BefehlFehler, BEFEHL_NAMEN } from '../project/commands.ts';
import { neuesProjekt, pruefeProjekt, kanonisch } from '../project/model.ts';
import { wende } from '../project/patch.ts';
import { GRUND_TEXT } from '../http/reasons.ts';
import { grundCode } from '../areas/proj/mapping.ts';
import { ohneAbgeleitetes } from './support/project.mjs';
import fs from 'node:fs';

const ok = (p, b) => fuehreAus(p, b);
const lehntAb = (p, b, grund) => assert.throws(() => fuehreAus(p, b), (e) => e instanceof BefehlFehler && e.grund === grund,
  `erwartet ${grund} für ${JSON.stringify(b).slice(0, 100)}`);
function pruefe(p, r) {   // gültig, vor/zurueck gehen hin und zurück, Eingabe unberührt (ein Undo-Schritt)
  assert.equal(pruefeProjekt(JSON.parse(JSON.stringify(r.projekt))).fehler, undefined);
  assert.equal(ohneAbgeleitetes(wende(p, r.vor)), ohneAbgeleitetes(r.projekt));
  assert.equal(ohneAbgeleitetes(wende(r.projekt, r.zurueck)), ohneAbgeleitetes(p));
}
const mit2 = () => {
  let p = neuesProjekt('T');
  p = ok(p, { befehl: 'spur_neu', art: 'audio', name: 'A' }).projekt;
  p = ok(p, { befehl: 'spur_neu', art: 'audio', name: 'B' }).projekt;
  return p;
};
const mitLane = (punkte) => {
  let p = ok(mit2(), { befehl: 'auto_neu', spur_id: 's1', ziel: 'fader' }).projekt;
  if (punkte) p = ok(p, { befehl: 'auto_punkte', lane_id: 'a1', setze: punkte, loesche_von: 0, loesche_bis: 1e6 }).projekt;
  return p;
};
const lane = (p) => p.spuren[0].automation[0];

test('S1 T2.1 auto_neu: zwei Punkte an der Loop-Klammer mit dem Grundwert; doppelt, Ziel, Spur', () => {
  let p = mit2();
  p = ok(p, { befehl: 'spur_aendern', spur_id: 's1', fader_db: -6 }).projekt;
  const r = ok(p, { befehl: 'auto_neu', spur_id: 's1', ziel: 'fader' });
  pruefe(p, r);
  assert.deepEqual(r.projekt.spuren[0].automation, [{ id: 'a1', ziel: 'fader', punkte: [{ beat: 0, wert: -6 }, { beat: 32, wert: -6 }] }]);
  assert.equal(r.projekt.naechste_id.lane, 2);
  assert.equal(r.betrifft_wiedergabe, true); assert.deepEqual(r.regler_aenderungen, [], 'kein Regler');
  assert.equal(p.spuren[0].automation, undefined, 'Eingabe unberührt');
  lehntAb(r.projekt, { befehl: 'auto_neu', spur_id: 's1', ziel: 'fader' }, 'lane_doppelt');
  lehntAb(p, { befehl: 'auto_neu', spur_id: 's1', ziel: 'wurst' }, 'ziel_unbekannt');
  lehntAb(p, { befehl: 'auto_neu', spur_id: 's9', ziel: 'fader' }, 'spur_unbekannt');
  lehntAb(p, { befehl: 'auto_neu', spur_id: 's1' }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'auto_neu', spur_id: 's1', ziel: 'fader', farbe: 1 }, 'argument_unbekannt');
  // Loop-Klammer aus p.loop
  const q = ok(p, { befehl: 'loop_setzen', an: true, von_beat: 8, bis_beat: 24 }).projekt;
  assert.deepEqual(ok(q, { befehl: 'auto_neu', spur_id: 's2', ziel: 'fader' }).projekt.spuren[1].automation[0].punkte.map((x) => x.beat), [8, 24]);
  // zweite Spur bekommt die nächste ID (der Zähler steigt über Spuren)
  assert.equal(ok(r.projekt, { befehl: 'auto_neu', spur_id: 's2', ziel: 'fader' }).projekt.spuren[1].automation[0].id, 'a2');
});

test('S1 T2.2 auto_punkte: ersetzt im Bereich, sortiert, Grenzen und Argumente', () => {
  const p = mitLane();
  const r = ok(p, { befehl: 'auto_punkte', lane_id: 'a1', setze: [{ beat: 20, wert: -30 }, { beat: 4, wert: 0 }], loesche_von: 0, loesche_bis: 32 });
  pruefe(p, r);
  assert.deepEqual(lane(r.projekt).punkte, [{ beat: 4, wert: 0 }, { beat: 20, wert: -30 }], 'Eingabereihenfolge egal, Ausgabe sortiert');
  assert.equal(r.betrifft_wiedergabe, true);
  lehntAb(p, { befehl: 'auto_punkte', lane_id: 'a1', setze: [{ beat: 4, wert: 0 }, { beat: 4, wert: -3 }, { beat: 4, wert: -6 }] }, 'punkte_ungueltig');
  lehntAb(p, { befehl: 'auto_punkte', lane_id: 'a1', setze: [{ beat: 4, wert: -201 }] }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'auto_punkte', lane_id: 'a1', setze: [{ beat: 4, wert: 0, x: 1 }] }, 'argument_unbekannt');
  lehntAb(p, { befehl: 'auto_punkte', lane_id: 'a1', setze: [{ beat: 4, wert: 0 }], bar: 1 }, 'argument_unbekannt');
  lehntAb(p, { befehl: 'auto_punkte', lane_id: 'a9', setze: [{ beat: 4, wert: 0 }] }, 'lane_unbekannt');
  lehntAb(p, { befehl: 'auto_punkte', lane_id: 'a1' }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'auto_punkte', lane_id: 'a1', setze: [{ beat: 4, wert: 0, form: 'rund' }] }, 'argument_ungueltig');
  const viele = Array.from({ length: 8193 }, (_, i) => ({ beat: i, wert: 0 }));
  lehntAb(p, { befehl: 'auto_punkte', lane_id: 'a1', setze: viele, loesche_von: 0, loesche_bis: 100 }, 'zu_gross');
  const genau = Array.from({ length: 8192 }, (_, i) => ({ beat: i, wert: 0 }));
  ok(p, { befehl: 'auto_punkte', lane_id: 'a1', setze: genau, loesche_von: 0, loesche_bis: 100 });   // Gegenprobe: 8192 geht
});

test('S1 T2.3 auto_loeschen entfernt die Lane und das Feld; spur_loeschen nimmt sie mit', () => {
  const p = mitLane();
  const r = ok(p, { befehl: 'auto_loeschen', lane_id: 'a1' });
  pruefe(p, r);
  assert.ok(!('automation' in r.projekt.spuren[0]), 'leere Liste wird nicht gespeichert');
  assert.equal(kanonisch({ ...r.projekt, naechste_id: 0 }), kanonisch({ ...mit2(), naechste_id: 0, rev: 0 }), 'sonst nichts geändert');
  assert.equal(r.projekt.naechste_id.lane, 2, 'der Zähler steigt nur');
  lehntAb(p, { befehl: 'auto_loeschen', lane_id: 'a7' }, 'lane_unbekannt');
  const s = ok(p, { befehl: 'spur_loeschen', spur_id: 's1' });
  pruefe(p, s); assert.equal(s.projekt.spuren.length, 1);
  assert.equal(ok(r.projekt, { befehl: 'auto_neu', spur_id: 's1', ziel: 'fader' }).projekt.spuren[0].automation[0].id, 'a2', 'ID nie wiederverwendet');
});

test('S1 T2.4 Undo/Redo je Befehl genau ein Schritt, vor/zurück am selben Fall', () => {
  const p = mitLane([{ beat: 0, wert: 0 }, { beat: 16, wert: -20 }]);
  for (const b of [
    { befehl: 'auto_punkte', lane_id: 'a1', setze: [{ beat: 8, wert: -5 }] },
    { befehl: 'auto_punkte', lane_id: 'a1', loesche_von: 0, loesche_bis: 0 },
    { befehl: 'auto_loeschen', lane_id: 'a1' },
  ]) {
    const r = ok(p, b); pruefe(p, r);
    assert.notEqual(ohneAbgeleitetes(r.projekt), ohneAbgeleitetes(p), `${b.befehl} ändert etwas`);
    assert.equal(ohneAbgeleitetes(wende(wende(p, r.vor), r.zurueck)), ohneAbgeleitetes(p), 'Redo, Undo: gleich');
  }
  // Liste von zwei Befehlen: ein Patch
  const l = fuehreListeAus(p, [{ befehl: 'auto_punkte', lane_id: 'a1', setze: [{ beat: 8, wert: -5 }] }, { befehl: 'auto_punkte', lane_id: 'a1', setze: [{ beat: 9, wert: -6 }] }]);
  pruefe(p, l); assert.equal(lane(l.projekt).punkte.length, 4);
});

test('S1 T2.5 Wiedergabe-Bezug, Regler leer, Freeze bleibt stehen', () => {
  const p = mitLane();
  for (const b of [{ befehl: 'auto_punkte', lane_id: 'a1', setze: [{ beat: 8, wert: -5 }] }, { befehl: 'auto_loeschen', lane_id: 'a1' }]) {
    const r = ok(p, b);
    assert.equal(r.betrifft_wiedergabe, true, b.befehl); assert.deepEqual(r.regler_aenderungen, []);
  }
  // Negativ-Kontrolle: ein Befehl ohne Wiedergabe-Bezug meldet false
  assert.equal(ok(p, { befehl: 'spur_aendern', spur_id: 's2', name: 'neu' }).betrifft_wiedergabe, false);
  // Freeze einer Wirt-Spur bleibt nach auto_punkte stehen (Sicht ohne Lane)
  let q = ok(neuesProjekt('F'), { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'wirt', name: 'surge', slot: 1 } }).projekt;
  q.spuren[0].freeze = { datei: 'f.wav', frames: 100, kennung: 1, sha256: 'a'.repeat(64) };
  q = ok(q, { befehl: 'auto_neu', spur_id: 's1', ziel: 'fader' }).projekt;
  assert.ok(q.spuren[0].freeze, 'auto_neu verwirft keinen Freeze');
  q = ok(q, { befehl: 'auto_punkte', lane_id: 'a1', setze: [{ beat: 8, wert: -5 }] }).projekt;
  assert.ok(q.spuren[0].freeze, 'auto_punkte verwirft keinen Freeze');
  // Gegenprobe: ein Tempo-Wechsel verwirft ihn
  assert.equal(ok(q, { befehl: 'tempo_setzen', bpm: 130 }).projekt.spuren[0].freeze, null);
});

test('S1 T2.6 die neuen Gründe und Befehle sind bekannt und haben englische Texte', () => {
  for (const n of ['auto_neu', 'auto_punkte', 'auto_loeschen']) assert.ok(BEFEHL_NAMEN.includes(n), n);
  for (const g of ['lane_unbekannt', 'lane_doppelt', 'ziel_unbekannt', 'punkte_ungueltig', 'zu_gross']) {
    assert.match(GRUND_TEXT[g] ?? '', /^[\x20-\x7e]+$/, `GRUND_TEXT ${g}`);
  }
  const seite = fs.readFileSync(new URL('../public/production/production.js', import.meta.url), 'utf8');
  for (const g of ['lane_unbekannt', 'lane_doppelt', 'punkte_ungueltig']) assert.match(seite, new RegExp(`\\b${g}:`), `FEHLER_TEXT ${g}`);
});

test('S1 T2.7 loesche_von/bis sind inklusiv; ein gesetzter Punkt ersetzt den Beat; zwei am gleichen Beat sind ein Sprung', () => {
  const p = mitLane([{ beat: 4, wert: 0 }, { beat: 8, wert: -10 }, { beat: 12, wert: -20 }]);
  assert.deepEqual(lane(p).punkte.map((x) => x.beat), [4, 8, 12]);
  const a = ok(p, { befehl: 'auto_punkte', lane_id: 'a1', loesche_von: 4, loesche_bis: 8 });
  assert.deepEqual(lane(a.projekt).punkte.map((x) => x.beat), [12], '4 und 8 weg, 12 bleibt');
  const b = ok(p, { befehl: 'auto_punkte', lane_id: 'a1', loesche_von: 4.0001, loesche_bis: 8 });
  assert.deepEqual(lane(b.projekt).punkte.map((x) => x.beat), [4, 12], '4 bleibt bei 4.0001');
  const c = ok(p, { befehl: 'auto_punkte', lane_id: 'a1', loesche_bis: 8 });
  assert.deepEqual(lane(c.projekt).punkte.map((x) => x.beat), [12], 'offene linke Seite');
  const d = ok(p, { befehl: 'auto_punkte', lane_id: 'a1', loesche_von: 8 });
  assert.deepEqual(lane(d.projekt).punkte.map((x) => x.beat), [4], 'offene rechte Seite');
  const e = ok(p, { befehl: 'auto_punkte', lane_id: 'a1', setze: [{ beat: 8, wert: -1 }] });
  assert.deepEqual(lane(e.projekt).punkte, [{ beat: 4, wert: 0 }, { beat: 8, wert: -1 }, { beat: 12, wert: -20 }], 'ersetzt den Punkt bei 8');
  const f = ok(p, { befehl: 'auto_punkte', lane_id: 'a1', setze: [{ beat: 8, wert: -3 }, { beat: 8, wert: -9 }] });
  assert.deepEqual(lane(f.projekt).punkte.filter((x) => x.beat === 8).map((x) => x.wert), [-3, -9], 'Sprung: zwei Punkte, Reihenfolge der Eingabe');
});

test('S1 T2.8 alle Punkte löschen ohne neuen: punkte_ungueltig (use auto_loeschen); mit neuem Punkt gültig', () => {
  const p = mitLane([{ beat: 4, wert: 0 }, { beat: 8, wert: -10 }]);
  assert.throws(() => fuehreAus(p, { befehl: 'auto_punkte', lane_id: 'a1', loesche_von: 0, loesche_bis: 100 }),
    (e) => e instanceof BefehlFehler && e.grund === 'punkte_ungueltig' && /auto_loeschen/.test(e.detail));
  const r = ok(p, { befehl: 'auto_punkte', lane_id: 'a1', setze: [{ beat: 2, wert: -1 }], loesche_von: 0, loesche_bis: 100 });
  assert.deepEqual(lane(r.projekt).punkte, [{ beat: 2, wert: -1 }]);
});

test('S1 T2.9 Patch-Größe: die ganze Punkteliste steht in vor und zurueck (Zahl wird berichtet, kein Tor)', () => {
  const zahlen = {};
  for (const n of [100, 8191]) {
    const p = mitLane(Array.from({ length: n }, (_, i) => ({ beat: i * 0.5, wert: -(i % 50) })));
    const r = ok(p, { befehl: 'auto_punkte', lane_id: 'a1', setze: [{ beat: 0.25, wert: -3 }] });
    zahlen[n] = { vor: JSON.stringify(r.vor).length, zurueck: JSON.stringify(r.zurueck).length };
    pruefe(p, r);
  }
  console.log(`S1 T2.9 Patch-Bytes (ein Punkt eingefügt): ${JSON.stringify(zahlen)}`);
  assert.ok(zahlen[8191].vor > zahlen[100].vor, 'wächst mit der Liste');
});

// --- Automation slice 2, task 1: targets pan, mute, solo, geraet.*; lock -------------------------------------------------------------
const mitRb = () => {   // s1 audio, s2 internal (RB-338), s3 host (Surge)
  let p = ok(neuesProjekt('T'), { befehl: 'spur_neu', art: 'audio', name: 'A' }).projekt;
  p = ok(p, { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'intern', name: 'rb338', parameter: { cutoff: 0.7 } } }).projekt;
  p = ok(p, { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'wirt', name: 'surge' } }).projekt;
  return p;
};
const neueLane = (p, spur, ziel) => ok(p, { befehl: 'auto_neu', spur_id: spur, ziel }).projekt;
const lanes = (p, i) => p.spuren[i].automation;

test('S2 T1.1 auto_neu start values per target: fader, pan, mute, solo, geraet.* (parameter or normalised default)', () => {
  let p = mitRb();
  p = ok(p, { befehl: 'spur_aendern', spur_id: 's2', fader_db: -6, pan: 0.5, mute: true, solo: false }).projekt;
  const start = (ziel, spur = 's2') => lanes(neueLane(p, spur, ziel), 1)[0].punkte;
  assert.deepEqual(start('fader'), [{ beat: 0, wert: -6 }, { beat: 32, wert: -6 }]);
  assert.deepEqual(start('pan'), [{ beat: 0, wert: 0.5 }, { beat: 32, wert: 0.5 }]);
  assert.deepEqual(start('mute'), [{ beat: 0, wert: 1, form: 'sprung' }, { beat: 32, wert: 1, form: 'sprung' }], 'mute true -> 1, sprung');
  assert.deepEqual(start('solo'), [{ beat: 0, wert: 0, form: 'sprung' }, { beat: 32, wert: 0, form: 'sprung' }], 'solo false -> 0, sprung');
  assert.deepEqual(start('geraet.cutoff'), [{ beat: 0, wert: 0.7 }, { beat: 32, wert: 0.7 }], 'the track parameter wins');
  assert.deepEqual(start('geraet.resonanz'), [{ beat: 0, wert: 0.3 }, { beat: 32, wert: 0.3 }], 'default resonanz');
  assert.deepEqual(start('geraet.env_mod').map((x) => x.wert), [0.4, 0.4], 'default env_mod');
  const lv = start('geraet.lautstaerke').map((x) => x.wert);
  assert.ok(lv[0] > 0 && lv[0] < 1 && lv[0] === lv[1], `default lautstaerke is a normalised value: ${lv[0]}`);
  pruefe(p, ok(p, { befehl: 'auto_neu', spur_id: 's2', ziel: 'mute' }));
  // eight lanes on one internal track, then lane_doppelt per target
  let q = p;
  for (const z of ['fader', 'pan', 'mute', 'solo', 'geraet.lautstaerke', 'geraet.cutoff', 'geraet.resonanz', 'geraet.env_mod']) q = neueLane(q, 's2', z);
  assert.equal(lanes(q, 1).length, 8);
  lehntAb(q, { befehl: 'auto_neu', spur_id: 's2', ziel: 'pan' }, 'lane_doppelt');
});

test('S2 T1.2 geraet.* only on internal tracks; the other geraet.* names are unknown targets', () => {
  const p = mitRb();
  lehntAb(p, { befehl: 'auto_neu', spur_id: 's1', ziel: 'geraet.cutoff' }, 'ziel_unbekannt');
  lehntAb(p, { befehl: 'auto_neu', spur_id: 's3', ziel: 'geraet.cutoff' }, 'ziel_unbekannt');
  assert.equal(lanes(neueLane(p, 's2', 'geraet.cutoff'), 1)[0].ziel, 'geraet.cutoff', 'control: internal track');
  for (const z of ['geraet.decay', 'geraet.wellenform', 'geraet.accent', 'wurst']) lehntAb(p, { befehl: 'auto_neu', spur_id: 's2', ziel: z }, 'ziel_unbekannt');
  assert.equal(lanes(neueLane(p, 's3', 'mute'), 2)[0].ziel, 'mute', 'control: mute on a host track');
});

test('S2 T1.3 auto_punkte per target: ranges, sprung-only for mute/solo, form normalised', () => {
  let p = neueLane(mitRb(), 's2', 'mute');                    // a1 mute
  p = neueLane(p, 's2', 'pan');                               // a2 pan
  p = neueLane(p, 's2', 'geraet.cutoff');                     // a3
  const set = (id, setze) => ({ befehl: 'auto_punkte', lane_id: id, setze });
  const r = ok(p, set('a1', [{ beat: 4, wert: 1 }, { beat: 8, wert: 0 }]));
  pruefe(p, r);
  assert.deepEqual(lanes(r.projekt, 1)[0].punkte.filter((x) => x.beat === 4 || x.beat === 8),
    [{ beat: 4, wert: 1, form: 'sprung' }, { beat: 8, wert: 0, form: 'sprung' }], 'a mute point without form is stored as sprung');
  assert.deepEqual(lanes(ok(p, set('a1', [{ beat: 4, wert: 1, form: 'sprung' }])).projekt, 1)[0].punkte[1], { beat: 4, wert: 1, form: 'sprung' }, 'explicit sprung is fine');
  lehntAb(p, set('a1', [{ beat: 4, wert: 1, form: 'linear' }]), 'punkte_ungueltig');
  lehntAb(p, set('a1', [{ beat: 4, wert: 1, form: 's' }]), 'punkte_ungueltig');
  lehntAb(p, set('a1', [{ beat: 4, wert: 0.5 }]), 'argument_ungueltig');
  lehntAb(p, set('a2', [{ beat: 4, wert: 1.2 }]), 'argument_ungueltig');
  assert.equal(lanes(ok(p, set('a2', [{ beat: 4, wert: -1, form: 'linear' }])).projekt, 1)[1].punkte[1].wert, -1, 'control: pan -1 with linear');
  lehntAb(p, set('a3', [{ beat: 4, wert: 1.5 }]), 'argument_ungueltig');
  assert.equal(lanes(ok(p, set('a3', [{ beat: 4, wert: 1 }])).projekt, 1)[2].punkte[1].wert, 1, 'control: geraet.cutoff 1');
  // a fader point is not normalised to sprung
  const f = ok(neueLane(mitRb(), 's1', 'fader'), { befehl: 'auto_punkte', lane_id: 'a1', setze: [{ beat: 4, wert: -3 }] }).projekt;
  assert.equal('form' in lanes(f, 0)[0].punkte[1], false, 'fader point keeps no form');
});

test('S2 T1.4 lock: auto_aendern gesperrt blocks every other lane command; undo and unlock release it', () => {
  const p0 = neueLane(mitRb(), 's1', 'fader');
  const r = ok(p0, { befehl: 'auto_aendern', lane_id: 'a1', gesperrt: true });
  pruefe(p0, r);
  assert.equal(lanes(r.projekt, 0)[0].gesperrt, true);
  assert.equal(r.betrifft_wiedergabe, false, 'the lock does not touch playback');
  assert.deepEqual(r.regler_aenderungen, []);
  const p = r.projekt;
  lehntAb(p, { befehl: 'auto_punkte', lane_id: 'a1', setze: [{ beat: 4, wert: -3 }] }, 'lane_gesperrt');
  lehntAb(p, { befehl: 'auto_punkte', lane_id: 'a1', loesche_von: 0, loesche_bis: 100 }, 'lane_gesperrt');
  lehntAb(p, { befehl: 'auto_loeschen', lane_id: 'a1' }, 'lane_gesperrt');
  // undo (one step) -> the lane is writable again
  const zurueck = wende(p, r.zurueck);
  assert.equal('gesperrt' in lanes(zurueck, 0)[0], false, 'undo removes the key');
  assert.equal(lanes(ok(zurueck, { befehl: 'auto_punkte', lane_id: 'a1', setze: [{ beat: 4, wert: -3 }] }).projekt, 0)[0].punkte.length, 3);
  // unlock: the key is deleted, never written as false; the project is byte for byte the slice 1 shape again
  const frei = ok(p, { befehl: 'auto_aendern', lane_id: 'a1', gesperrt: false });
  pruefe(p, frei);
  assert.equal('gesperrt' in lanes(frei.projekt, 0)[0], false);
  assert.equal(kanonisch(frei.projekt), kanonisch(p0), 'lock and unlock: back to the unlocked project');
  assert.equal(lanes(ok(frei.projekt, { befehl: 'auto_punkte', lane_id: 'a1', setze: [{ beat: 4, wert: -3 }] }).projekt, 0)[0].punkte.length, 3);
  // locking twice and unlocking an unlocked lane are not errors; the lock of one lane does not touch another
  const nochmal = ok(p, { befehl: 'auto_aendern', lane_id: 'a1', gesperrt: true });
  assert.equal(kanonisch(nochmal.projekt), kanonisch(p), 'locking a locked lane changes nothing');
  const frei2 = ok(p0, { befehl: 'auto_aendern', lane_id: 'a1', gesperrt: false });
  assert.equal(kanonisch(frei2.projekt), kanonisch(p0), 'unlocking a free lane changes nothing');
  assert.equal('gesperrt' in lanes(frei2.projekt, 0)[0], false, 'and writes no gesperrt: false');
  const zwei = neueLane(p, 's2', 'pan');
  assert.equal(lanes(ok(zwei, { befehl: 'auto_loeschen', lane_id: 'a2' }).projekt, 1), undefined, 'control: the unlocked lane is deleted');
  // arguments
  lehntAb(p0, { befehl: 'auto_aendern', lane_id: 'a1' }, 'argument_ungueltig');
  lehntAb(p0, { befehl: 'auto_aendern', lane_id: 'a1', gesperrt: 'ja' }, 'argument_ungueltig');
  lehntAb(p0, { befehl: 'auto_aendern', lane_id: 'a1', aktiv: false }, 'argument_unbekannt');
  lehntAb(p0, { befehl: 'auto_aendern', lane_id: 'a9', gesperrt: true }, 'lane_unbekannt');
  // spur_loeschen takes a locked lane with it (the lock protects points, not the track)
  const weg = ok(p, { befehl: 'spur_loeschen', spur_id: 's1' });
  assert.equal(weg.projekt.spuren.some((s) => s.id === 's1'), false);
});

test('S2 T1.12 device lanes only on the RB-338 device: bk track refuses auto_neu, rb338 -> bk is handled like rb338 -> host', () => {
  const bkGeraet = { art: 'intern', name: 'bk', graph: 'juno-pad' };
  const base = () => ok(ok(neuesProjekt('T'), { befehl: 'spur_neu', art: 'audio' }).projekt, { befehl: 'spur_neu', art: 'instrument' }).projekt;   // s2 = rb338
  // auto_neu: rb338 passes (control), bk is refused with the existing reason
  assert.equal(ok(base(), { befehl: 'auto_neu', spur_id: 's2', ziel: 'geraet.cutoff' }).projekt.spuren[1].automation.length, 1, 'control: rb338');
  const bkP = ok(neuesProjekt('T'), { befehl: 'spur_neu', art: 'instrument', geraet: bkGeraet }).projekt;
  lehntAb(bkP, { befehl: 'auto_neu', spur_id: 's1', ziel: 'geraet.cutoff' }, 'ziel_unbekannt');
  assert.equal(ok(bkP, { befehl: 'auto_neu', spur_id: 's1', ziel: 'pan' }).projekt.spuren[0].automation.length, 1, 'control: pan on bk');
  // spur_aendern rb338 -> bk with geraet.* lanes: geraet_lanes; without them ok; rb338 -> rb338 keeps the lanes
  const p = neueLane(base(), 's2', 'geraet.cutoff');
  lehntAb(p, { befehl: 'spur_aendern', spur_id: 's2', geraet: bkGeraet }, 'geraet_lanes');
  const ohne = neueLane(base(), 's2', 'pan');
  assert.equal(ok(ohne, { befehl: 'spur_aendern', spur_id: 's2', geraet: bkGeraet }).projekt.spuren[1].geraet.name, 'bk', 'control: a pan lane does not block');
  assert.equal(ok(p, { befehl: 'spur_aendern', spur_id: 's2', geraet: { art: 'intern', name: 'rb338', parameter: { cutoff: 0.1 } } }).projekt.spuren[1].geraet.name, 'rb338');
});

test('S2 T1.5 spur_aendern internal -> host with geraet.* lanes: geraet_lanes; without them ok', () => {
  const ohneWirt = () => ok(ok(neuesProjekt('T'), { befehl: 'spur_neu', art: 'audio' }).projekt, { befehl: 'spur_neu', art: 'instrument' }).projekt;   // s2 internal, no host yet
  const p = neueLane(ohneWirt(), 's2', 'geraet.cutoff');
  lehntAb(p, { befehl: 'spur_aendern', spur_id: 's2', geraet: { art: 'wirt', name: 'surge' } }, 'geraet_lanes');
  const ohne = neueLane(ohneWirt(), 's2', 'pan');
  assert.equal(ok(ohne, { befehl: 'spur_aendern', spur_id: 's2', geraet: { art: 'wirt', name: 'surge', slot: 1 } }).projekt.spuren[1].geraet.art, 'wirt', 'control: a pan lane does not block');
  // internal -> internal keeps the geraet.* lanes
  assert.equal(ok(p, { befehl: 'spur_aendern', spur_id: 's2', geraet: { art: 'intern', name: 'rb338', parameter: { cutoff: 0.1 } } }).projekt.spuren[1].geraet.art, 'intern');
});

test('S2 T1.6 the new reasons are known and have English texts in all three tables', () => {
  assert.ok(BEFEHL_NAMEN.includes('auto_aendern'));
  for (const g of ['lane_gesperrt', 'geraet_lanes']) {
    assert.match(GRUND_TEXT[g] ?? '', /^[\x20-\x7e]+$/, `GRUND_TEXT ${g}`);
    const seite = fs.readFileSync(new URL('../public/production/production.js', import.meta.url), 'utf8');
    assert.match(seite, new RegExp(`\\b${g}:`), `FEHLER_TEXT ${g}`);
    assert.equal(grundCode(g), 409, `${g} maps to HTTP 409`);
  }
});
