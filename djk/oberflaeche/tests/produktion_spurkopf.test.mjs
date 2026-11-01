// PRODUCTION V1: Texte und Werte der Spurköpfe (reine Teile von spurkoepfe.js; der DOM-Teil läuft in der Browserprobe)
import test from 'node:test';
import assert from 'node:assert/strict';
import { faderWert, faderText, panText, geraetText, naechsteFarbe, zielIndex, spurLabels, istUmbenennenTaste, KOPF_WERTE, sperreUmschalten, laneAnlegen, FADER_AUS, FADER_MIN, FADER_MAX } from '../oeffentlich/produktion/spurkoepfe.js';
import { FARBEN } from '../oeffentlich/produktion/layout.js';
import { laneWert } from '../oeffentlich/produktion/lanen.js';

test('V1 Spurkopf: Fader ganz unten ist aus (−200), sonst der Wert; Text mit echtem Minus', () => {
  assert.equal(faderWert(-60), FADER_AUS);
  assert.equal(faderWert(-59.5), -59.5);
  assert.equal(faderWert(9), 6);
  assert.equal(faderText(-200), '−∞');
  assert.equal(faderText(-6), '−6.0');
  assert.equal(faderText(3), '+3.0');
  // Negativ-Kontrolle: 0 dB bleibt 0 und zeigt kein Vorzeichen
  assert.equal(faderWert(0), 0);
  assert.equal(faderText(0), '0.0');
});

test('V1 Spurkopf: Pan-Text C/L/R', () => {
  assert.equal(panText(0), 'C');
  assert.equal(panText(0.004), 'C');
  assert.equal(panText(-0.25), 'L25');
  assert.equal(panText(1), 'R100');
});

test('V1 Spurkopf: Gerätetext und Farbfolge', () => {
  assert.equal(geraetText({ art: 'audio' }), 'AUDIO');
  assert.equal(geraetText({ art: 'instrument', geraet: { art: 'intern', name: 'rb338' } }), 'RB-338');
  assert.equal(geraetText({ art: 'instrument', geraet: { art: 'wirt', name: 'surge', slot: 1 } }), 'SURGE · 1');
  assert.equal(naechsteFarbe(FARBEN[0]), FARBEN[1]);
  assert.equal(naechsteFarbe(FARBEN.at(-1)), FARBEN[0]);
  assert.equal(naechsteFarbe('#123456'), FARBEN[0], 'fremde Farbe: Anfang der Folge');
});

test('V1 Spurkopf: Fader-Bereich −60..+6 dB, der Grenzwert gilt, darüber wird auf ihn gesetzt (Spec §4: fader_db −200..+6)', () => {
  assert.equal(FADER_MAX, 6);
  assert.equal(FADER_MIN, -60);
  assert.equal(faderWert(6), 6, 'Grenzwert selbst');
  assert.equal(faderWert(5.5), 5.5);
  assert.equal(faderWert(6.5), 6, 'knapp darüber');
  assert.equal(faderText(6), '+6.0');
  // Negativ-Kontrolle: nichts im Bereich wird verändert, und der untere Anschlag bleibt „aus“
  assert.equal(faderWert(-0.5), -0.5);
  assert.equal(faderWert(-60), FADER_AUS);
});

test('V1 Spurkopf: ↑/↓ liefern den Zielindex für spur_verschieben, am Rand nichts', () => {
  assert.equal(zielIndex(3, 1, 'hoch'), 0);
  assert.equal(zielIndex(3, 1, 'runter'), 2);
  assert.equal(zielIndex(3, 0, 'hoch'), null, 'erste Spur hat kein ↑');
  assert.equal(zielIndex(3, 2, 'runter'), null, 'letzte Spur hat kein ↓');
  assert.equal(zielIndex(1, 0, 'runter'), null);
  // Negativ-Kontrolle: unbekannte Richtung und unbekannte Spur (Index −1) bewegen nichts
  assert.equal(zielIndex(3, 1, 'quer'), null);
  assert.equal(zielIndex(3, -1, 'hoch'), null);
});

test('V1 Spurkopf: jedes Bedienelement trägt den Spurnamen im zugänglichen Namen (englisch)', () => {
  assert.deepEqual(spurLabels('Kick'), { mute: 'Mute Kick', solo: 'Solo Kick', hoch: 'Move Kick up', runter: 'Move Kick down', farbe: 'Colour Kick',
    loeschen: 'Delete track Kick', umbenennen: 'Rename track Kick', fader: 'Volume Kick', pan: 'Pan Kick', lane: 'Automation lanes Kick' });
  // Negativ-Kontrolle: zwei Spuren, zwei verschiedene Namen je Element (sonst läsen sich acht Spuren als acht gleiche „M“)
  const a = spurLabels('Kick'), b = spurLabels('Bass');
  for (const k of Object.keys(a)) { assert.notEqual(a[k], b[k], k); assert.match(a[k], /Kick/); assert.match(a[k], /^[ -~]+$/, `${k}: ASCII, englisch`); }
});

test('V1 Spurkopf: Umbenennen per Tastatur mit Enter oder F2, nicht mit Zusatztasten oder anderen Tasten', () => {
  assert.equal(istUmbenennenTaste({ key: 'Enter' }), true);
  assert.equal(istUmbenennenTaste({ key: 'F2' }), true);
  assert.equal(istUmbenennenTaste({ key: 'F2', ctrlKey: true }), false);
  assert.equal(istUmbenennenTaste({ key: 'Enter', shiftKey: true }), false);
  assert.equal(istUmbenennenTaste({ key: 'a' }), false);
  assert.equal(istUmbenennenTaste({ key: ' ' }), false);
});

test('S2 T6 Spurkopf (D11): the playhead value of a pan lane shows in the pan value (a pan text, no dB rule), the fader keeps its dB text', () => {
  const pan = [{ beat: 0, wert: -1 }, { beat: 8, wert: 1 }];
  const [selPan, textPan, basisPan] = KOPF_WERTE.pan;
  assert.equal(selPan, '.p-panwert');
  assert.equal(textPan(laneWert(pan, 4, 'pan')), 'C', 'the middle of the lane is the centre');
  assert.equal(textPan(laneWert(pan, 2, 'pan')), 'L50');
  assert.equal(textPan(laneWert(pan, 6, 'pan')), 'R50');
  assert.equal(basisPan({ pan: -0.3, fader_db: -6 }), -0.3, 'the base value written back at stop is the pan of the track');
  const [selF, textF, basisF] = KOPF_WERTE.fader;
  assert.equal(selF, '.p-faderwert');
  assert.equal(textF(-6), '−6.0');
  assert.equal(basisF({ pan: -0.3, fader_db: -6 }), -6);
  assert.deepEqual(Object.keys(KOPF_WERTE), ['fader', 'pan'], 'mute and solo show no lane value in the head');
});

// ---------------------------------------------------------------- Automation Slice 2, task 6, fix round 1

// A small writer like schreiber.js: the commands are computed one after the other, each from the state the previous one produced (aendereAus)
function schreiberAttrappe(projekt, antwort = () => true) {
  const schlange = [], gesendet = [];
  let laeuft = false;
  const pumpe = async () => {
    if (laeuft) return; laeuft = true;
    while (schlange.length) {
      const { rechne, ende } = schlange.shift();
      const x = rechne(projekt);
      if (!x) { ende(false); continue; }
      gesendet.push(x);
      const ok = await antwort(x);
      if (ok) for (const b of x.befehle) if (b.befehl === 'auto_aendern') {
        const l = projekt.spuren.flatMap((s) => s.automation ?? []).find((q) => q.id === b.lane_id);
        if (b.gesperrt) l.gesperrt = true; else delete l.gesperrt;
      }
      ende(ok);
    }
    laeuft = false;
  };
  return { gesendet, aendereAus: (rechne) => new Promise((ende) => { schlange.push({ rechne, ende }); pumpe(); }) };
}

test('S2 T6 fix 1: two quick clicks on the lock lock and then unlock (the command is computed at send time, not at the click)', async () => {
  const projekt = { spuren: [{ id: 's1', automation: [{ id: 'a1', ziel: 'pan', punkte: [{ beat: 0, wert: 0 }] }] }] };
  const w = schreiberAttrappe(projekt);
  await Promise.all([sperreUmschalten(w.aendereAus, 's1', () => 'pan'), sperreUmschalten(w.aendereAus, 's1', () => 'pan')]);
  assert.deepEqual(w.gesendet.map((x) => x.befehle[0].gesperrt), [true, false]);
  assert.deepEqual(w.gesendet.map((x) => x.label), ['Lock automation lane', 'Unlock automation lane']);
  assert.equal(projekt.spuren[0].automation[0].gesperrt, undefined, 'the lane ends unlocked');
  const leer = schreiberAttrappe({ spuren: [] });                       // a track that is gone at send time: nothing is sent
  await sperreUmschalten(leer.aendereAus, 's1', () => undefined);
  assert.equal(leer.gesendet.length, 0);
});

test('S2 T6 fix 6: "+ Lane" switches the shown target only when the server accepted, a refusal keeps the old choice', async () => {
  const gewaehlt = [], befehle = [];
  const aendere = (accept) => async (label, b) => { befehle.push(b[0]); return accept; };
  assert.equal(await laneAnlegen(aendere(false), (id, z) => gewaehlt.push([id, z]), 's1', 'pan'), false);
  assert.deepEqual(gewaehlt, [], 'refused: no switch');
  assert.equal(await laneAnlegen(aendere(true), (id, z) => gewaehlt.push([id, z]), 's1', 'pan'), true);
  assert.deepEqual(gewaehlt, [['s1', 'pan']]);
  assert.deepEqual(befehle[0], { befehl: 'auto_neu', spur_id: 's1', ziel: 'pan' });
  // timing: the choice is not made before the answer
  let antworte; const spaet = () => new Promise((ok) => { antworte = ok; });
  const g2 = []; const p = laneAnlegen(spaet, (id, z) => g2.push(z), 's1', 'mute');
  assert.deepEqual(g2, [], 'before the answer nothing is chosen');
  antworte(true); await p;
  assert.deepEqual(g2, ['mute']);
});
