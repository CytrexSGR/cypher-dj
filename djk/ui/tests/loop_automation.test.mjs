// Effekt-Sektion Schritt 4: Automation je Loop, Prüfung, Planung je Durchgang, Lesen und Schreiben in loop.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pruefeAutomation, planeDurchgang, planeSpur, spurLaenge, naechsterDurchgang, leseLoopAutomation, schreibeLoopAutomation, AUTO_BEREICH } from '../loop_automation.ts';
import { reglerInfo } from '../../conductor/src/controls_info.ts';

const spur = [{ pfad: 'komp/schwelle', punkte: [[0, -10], [4, -30], [6, -20]] }];

test('Prüfung: gültig, und jede Regel hat einen Fall, der scheitert', () => {
  assert.ok('automation' in pruefeAutomation(spur, 8));
  for (const [x, grund] of [
    [[{ pfad: 'fader', punkte: [[0, 0]] }], 'pfad'],
    [[{ pfad: 'komp/schwelle', punkte: [[0, -10], [0, -20]] }], 'beat'],
    [[{ pfad: 'komp/schwelle', punkte: [[8, -10]] }], 'beat'],
    [[{ pfad: 'komp/schwelle', punkte: [[0, -61]] }], 'value'],
    [[{ pfad: 'filter', punkte: [] }], 'punkte'],
    [[{ pfad: 'filter', punkte: [[0, 0]] }, { pfad: 'filter', punkte: [[1, 0]] }], 'twice'],
  ]) {
    const r = pruefeAutomation(x, 8);
    assert.ok('fehler' in r && r.fehler.includes(grund), `${JSON.stringify(x)} → ${JSON.stringify(r)}`);
  }
});

test('Planung: Rampen von Punkt zu Punkt, zurück zum ersten über die Loop-Grenze, Setzen nur beim ersten Durchgang', () => {
  const erst = planeDurchgang(spur, 8, 64, true);
  assert.deepEqual(erst, [
    { pfad: 'komp/schwelle', ab_beat: 64, dauer_beats: 0, nach: -10 },
    { pfad: 'komp/schwelle', ab_beat: 64, dauer_beats: 4, nach: -30 },
    { pfad: 'komp/schwelle', ab_beat: 68, dauer_beats: 2, nach: -20 },
    { pfad: 'komp/schwelle', ab_beat: 70, dauer_beats: 2, nach: -10 },
  ]);
  const weiter = planeDurchgang(spur, 8, 72, false);
  assert.equal(weiter.length, 3);
  assert.equal(weiter[0].ab_beat, 72);
  // lückenlos: jede Fahrt endet, wo die nächste beginnt, auch über die Grenze zum nächsten Durchgang
  const alle = [...erst.slice(1), ...weiter];
  for (let i = 0; i + 1 < alle.length; i++) assert.equal(alle[i].ab_beat + alle[i].dauer_beats, alle[i + 1].ab_beat);
  // ein Punkt: nur Setzen, je Durchgang
  assert.deepEqual(planeDurchgang([{ pfad: 'filter', punkte: [[2, 0.5]] }], 4, 8, false), [{ pfad: 'filter', ab_beat: 10, dauer_beats: 0, nach: 0.5 }]);
});

test('Nächster Durchgang: erst kurz vorher, nie doppelt', () => {
  assert.equal(naechsterDurchgang(57, 8, 0), null);   // 7 Beats vorher: noch nicht
  assert.equal(naechsterDurchgang(61, 8, 0), 64);
  assert.equal(naechsterDurchgang(61, 8, 64), null);   // schon geplant
  assert.equal(naechsterDurchgang(64, 8, 56), 64);     // genau auf der Grenze
});

test('Lesen und Schreiben in loop.json, übrige Felder bleiben', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loopauto-'));
  fs.mkdirSync(path.join(dir, 'x'));
  fs.writeFileSync(path.join(dir, 'x', 'loop.json'), JSON.stringify({ schema: 1, name: 'x', beats: 8, bpm: 128, frames: 180000, datei: 'loop.f32', quelle: 'mitschnitt' }));
  assert.deepEqual(leseLoopAutomation(dir, 'x'), []);
  schreibeLoopAutomation(dir, 'x', spur);
  assert.deepEqual(leseLoopAutomation(dir, 'x'), spur);
  const j = JSON.parse(fs.readFileSync(path.join(dir, 'x', 'loop.json'), 'utf8'));
  assert.equal(j.quelle, 'mitschnitt');
  schreibeLoopAutomation(dir, 'x', []);
  assert.ok(!('automation' in JSON.parse(fs.readFileSync(path.join(dir, 'x', 'loop.json'), 'utf8'))));
  fs.rmSync(dir, { recursive: true });
});

test('Länge in Durchgängen: Punkte bis Loop mal Durchgänge, Planung über die ganze Länge, send/2 erlaubt', () => {
  const lang = { pfad: 'send/2', punkte: [[0, -60], [56, -60], [60, -6]], durchgaenge: 8 };
  assert.ok('automation' in pruefeAutomation([lang], 8));
  assert.equal(spurLaenge(lang, 8), 64);
  const r = pruefeAutomation([{ ...lang, punkte: [[64, -6]] }], 8);
  assert.ok('fehler' in r && r.fehler.includes('0..64'));
  assert.ok('fehler' in pruefeAutomation([{ ...lang, durchgaenge: 3 }], 8));
  const t = planeSpur(lang, 64, 128, false);
  assert.deepEqual(t.map((x) => [x.ab_beat, x.dauer_beats, x.nach]), [[128, 56, -60], [184, 4, -6], [188, 4, -60]]);
  assert.equal(naechsterDurchgang(125, 64, 64), 128);   // Anfänge auf Vielfachen der Spurlänge
  assert.equal(naechsterDurchgang(130, 64, 128), null);
});

// 1.15 A2: a loop box is a source channel (pad/1, pad/2), so its automation may drive the continuous gate and utility rows, with the contract's range
// (the same numbers as controls_info.ts). Switches and steps stay out (like komp/an and komp/sc); multiband and limiter are bus-only, not box rows.
test('1.15 A2: AUTO_BEREICH holds the continuous gate and util rows with the contract range, no switches, no bus-only tools', () => {
  const soll = { 'gate/schwelle': [-90, 0], 'gate/hysterese': [0, 24], 'gate/ratio': [1, 100], 'gate/bereich': [-120, 0], 'gate/attack': [0.1, 500],
    'gate/hold': [0, 2000], 'gate/release': [1, 5000], 'util/balance': [-1, 1], 'util/breite': [0, 200], 'util/bassmono': [0, 500] };
  for (const [p, bereich] of Object.entries(soll)) {
    assert.deepEqual(AUTO_BEREICH[p], bereich, p);
    const i = reglerInfo(`pad/1/${p}`);   // the contract row on a box channel: same range, and it is a continuous row
    assert.deepEqual([i.einheit, i.min, i.max], ['linear', ...bereich], p);
    assert.ok('automation' in pruefeAutomation([{ pfad: p, punkte: [[0, bereich[0]], [4, bereich[1]]] }], 8), p);
    for (const aus of [bereich[0] - 1, bereich[1] + 1]) {
      const r = pruefeAutomation([{ pfad: p, punkte: [[0, aus]] }], 8);   // negative control: just outside the range
      assert.ok('fehler' in r && r.fehler.includes('value'), `${p} ${aus}`);
    }
  }
  for (const p of ['gate/an', 'gate/sc', 'util/phase_l', 'util/phase_r', 'util/tausch', 'util/dc', 'mb/an', 'mb/tief/schwelle', 'lim/decke', 'spektrum/kanal']) {
    const r = pruefeAutomation([{ pfad: p, punkte: [[0, 0]] }], 8);
    assert.ok('fehler' in r && r.fehler.includes('pfad'), `${p} is refused`);
  }
});
