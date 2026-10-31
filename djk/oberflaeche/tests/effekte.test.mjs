// Effekt-Sektion: Kennlinie wie komp_dsp (Gl. 4), Presets der Seite gleich denen des VST3.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { kennlinie, kennlinienPfad, KOMP_PRESETS, AUTO_BEREICH, punktAusStelle, fxInhaltText } from '../oeffentlich/effekte.js';
import { AUTO_BEREICH as SERVER_AUTO, pruefeAutomation } from '../loop_automation.ts';
import { AUTO_VORLAGEN, vorlagePunkte, knobListe, KNOB_GRUPPE, htmlText } from '../oeffentlich/effekte.js';

test('Baukasten S2 knobListe: nur gemeldete Knobs, Namen aus dem Graphen, sonst „Knob n“; Surge ohne Knobs → leer', () => {
  const l = knobListe({ Volume: 0.75, 'Knob 1': 0.25, 'Knob 2': 1.5, 'Knob 8': 0 }, { 'Knob 1': 'Cutoff' });
  assert.deepEqual(l, [
    { nr: 1, param: 'Knob 1', name: 'Cutoff', wert: 0.25 },
    { nr: 2, param: 'Knob 2', name: 'Knob 2', wert: 1 },
    { nr: 8, param: 'Knob 8', name: 'Knob 8', wert: 0 },
  ]);
  assert.deepEqual(knobListe({ volume: -12, a_filter1_cutoff: 0.4 }), []);
  assert.deepEqual(knobListe(undefined), []);
  assert.deepEqual(knobListe({ 'Knob 3': 'x', 'Knob 4': NaN }), []);
  assert.deepEqual(KNOB_GRUPPE, { 'erz/2': 'bass', 'erz/3': 'melodie' });
});

test('Kennlinie: unter dem Knie unverändert, darüber 1/R, Knie stetig (Werte wie komp_dsp/tests/komp.rs)', () => {
  assert.equal(kennlinie(-40, -20, 4, 10), -40);
  assert.ok(Math.abs(kennlinie(0, -20, 4, 10) - -15) < 1e-9);
  assert.ok(Math.abs(kennlinie(-20, -20, 4, 10) - (-20 - 0.9375)) < 1e-9);
  assert.ok(Math.abs(kennlinie(-15, -20, 4, 10) - (-20 + 5 / 4)) < 1e-9);
  assert.ok(Math.abs(kennlinie(-16, -20, 4, 0) - -19) < 1e-9);
});

test('Kennlinienpfad: 121 Punkte, beginnt links unten, Makeup hebt', () => {
  const p = kennlinienPfad(-20, 4, 0, 120, 84);
  assert.equal(p.split(' L').length, 121);
  assert.ok(p.startsWith('M0.0,84.0'));
  assert.notEqual(kennlinienPfad(-20, 4, 6, 120, 84), p);
});

test('Presets der Seite = Presets des VST3; Sidechain = Schlüssel DRUMS (5), sonst ausdrücklich 0', () => {
  const vst = JSON.parse(readFileSync(new URL('../../instrumente/komp/presets/presets.json', import.meta.url), 'utf8'));
  const feld = { thresh: 'schwelle', ratio: 'ratio', attack: 'attack', release: 'release', makeup: 'makeup', mix: 'mix' };
  const alle = Object.entries(vst).filter(([n]) => !n.startsWith('_'));
  assert.deepEqual(Object.keys(KOMP_PRESETS).sort(), alle.map(([n]) => n).sort());
  for (const [n, w] of alle) {
    for (const [a, b] of Object.entries(feld)) assert.equal(KOMP_PRESETS[n][b], w[a], `${n} ${b}`);
    assert.equal(KOMP_PRESETS[n].sc, w.extsc ? 5 : 0, `${n} sc`);
  }
});

test('Automation: Bereiche der Seite = Bereiche des Servers; Punkt aus der Stelle gerastet und begrenzt', () => {
  assert.deepEqual(AUTO_BEREICH, SERVER_AUTO);
  assert.deepEqual(punktAusStelle(0, 0, 480, 120, 8, [-60, 0]), [0, 0]);
  assert.deepEqual(punktAusStelle(240, 120, 480, 120, 8, [-60, 0]), [4, -60]);
  assert.deepEqual(punktAusStelle(479, 60, 480, 120, 8, [-1, 1]), [7.75, 0]);   // nie auf beats selbst
});

test('Inhalt je Kanal aus der Lage: Deck, Strudel mit Klang, Box, leer', () => {
  const lage = { decks: [{ deck: 1, status: 3, titel: 'Uppermost', camelot: '1A' }, { deck: 2, status: 0 }],
    boxen: { 1: { status: 3, name: 'komp-roh-drums', beats: 8 } },
    studio: { stroeme: [{ strom: 1, autonom: true, text_kurz: 'stack(s("bd*4"))' }, { strom: 2, autonom: false, text_kurz: 'silence' }], klang: { bass: 'vst3:rb338' } } };
  assert.equal(fxInhaltText('deck/1', lage), '▶ Uppermost · 1A');
  assert.equal(fxInhaltText('deck/2', lage), 'empty');
  assert.equal(fxInhaltText('pad/1', lage), '▶ komp-roh-drums · 8 beats');
  assert.equal(fxInhaltText('pad/2', lage), 'empty');
  assert.equal(fxInhaltText('erz/1', lage), '▶ stack(s("bd*4"))');
  assert.equal(fxInhaltText('erz/2', lage), 'rb338 · silence · AUTO off');
});

test('Automations-Vorlagen: jede passt zu ihrem Ziel und besteht die Prüfung des Servers, auf 1 bis 32 Durchgängen', () => {
  let n = 0;
  for (const [pfad, liste] of Object.entries(AUTO_VORLAGEN)) {
    assert.ok(pfad in SERVER_AUTO, pfad);
    for (const v of liste) for (const beats of [1, 4, 8, 32]) for (const d of [1, 8, 32]) {
      const punkte = vorlagePunkte(v, beats * d);
      const r = pruefeAutomation([{ pfad, punkte, durchgaenge: d }], beats);
      assert.ok('automation' in r, `${pfad} ${v.name} ${beats}x${d}: ${JSON.stringify(r)}`);
      n++;
    }
  }
  assert.ok(n > 200);
  // Gegenprobe: ein Wert außerhalb des Bereichs fällt durch
  assert.ok('fehler' in pruefeAutomation([{ pfad: 'send/2', punkte: vorlagePunkte({ punkte: [[0, -70]] }, 8) }], 8));
});

test('Baukasten S2 htmlText: Knob-Namen aus der Graphdatei gehen als Text, nicht als HTML auf die Seite (Review F2)', () => {
  assert.equal(htmlText('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(htmlText(`a"b'c&d`), 'a&quot;b&#39;c&amp;d');
  assert.equal(htmlText('Cutoff'), 'Cutoff');
});
