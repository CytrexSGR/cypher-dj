// PRODUCTION V2: Piano-Roll (reine Funktionen pianoroll.js). Ansicht: Klaviatur 40 px, 20 px je Beat, oberste Zeile Ton 60.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TASTEN_BREITE, TON_HOEHE, VEL_HOEHE, tonName, istSchwarz, neueRollAnsicht, beatZuRx, rxZuBeat, yZuTon, trefferNote, trefferVel, velZuY, yZuVel,
  naechsteNotenIds, neueNote, verschiebeNoten, dehneNoten, velocityNoten, quantisiere, rechteckAuswahl, tastenSchritt, auswahlVel, zoomRoll, scrolleTon, notenLabel } from '../oeffentlich/produktion/pianoroll.js';

const A = { beat0: 0, pxProBeat: 20, tonOben: 60 };
const clip = () => ({ id: 'c3', art: 'midi', start_beat: 4, laenge_beats: 4, noten: [
  { id: 'n1', beat: 0, laenge: 1, ton: 60, vel: 100 }, { id: 'n2', beat: 1.5, laenge: 1, ton: 58, vel: 90 }, { id: 'n7', beat: 3.1, laenge: 0.5, ton: 55, vel: 80 }] });

test('V2 Roll: Tonnamen wie Ableton, Geometrie hin und zurück', () => {
  assert.equal(tonName(60), 'C3'); assert.equal(tonName(36), 'C1'); assert.equal(tonName(61), 'C#3');
  assert.equal(istSchwarz(61), true); assert.equal(istSchwarz(60), false);
  assert.equal(beatZuRx(A, 1), TASTEN_BREITE + 20); assert.equal(rxZuBeat(A, TASTEN_BREITE + 30), 1.5);
  assert.equal(yZuTon(A, 0), 60); assert.equal(yZuTon(A, TON_HOEHE * 2 + 1), 58);
  const a = neueRollAnsicht(clip(), 840, 240);
  assert.equal(a.pxProBeat, 200, '4 Beats auf 800 px');
  assert.equal(a.tonOben, 58 + Math.floor((240 - VEL_HOEHE) / TON_HOEHE / 2), 'Mitte der Noten (55..60 → 58) in der Mitte');
  assert.equal(neueRollAnsicht({ laenge_beats: 1, noten: [] }, 840, 240).pxProBeat, 200, 'mindestens ein Takt breit');
  assert.equal(scrolleTon(a, 500, 240).tonOben, 127); assert.equal(zoomRoll(A, 2, TASTEN_BREITE).pxProBeat, 40);
});

test('V2 Roll: Treffer (Rand zieht die Länge), Velocity-Spur', () => {
  const c = clip();
  assert.deepEqual(trefferNote(c, A, TASTEN_BREITE + 5, 3), { note: c.noten[0], zone: 'mitte' });
  assert.equal(trefferNote(c, A, TASTEN_BREITE + 18, 3).zone, 'rand');
  assert.equal(trefferNote(c, A, TASTEN_BREITE + 25, 3), null, 'hinter n1');
  assert.equal(trefferVel(c, A, TASTEN_BREITE + 31).id, 'n2');
  assert.equal(trefferVel(c, A, TASTEN_BREITE + 2, ['n1']).id, 'n1');
  assert.equal(yZuVel(velZuY(100, 240), 240), 100); assert.equal(yZuVel(0, 240), 127); assert.equal(yZuVel(500, 240), 1);
});

// Noten-IDs: S2 führt EINEN Zähler je Projekt (Spec 6.28 Nachsatz zu 6.26, modell.ts notenZaehler): naechste_noten_id, sonst das Maximum aller
// Noten-IDs n<k> über alle MIDI-Clips plus 1. Eine ausdrückliche ID unter dem Zähler lehnt S2 mit id_belegt ab (6.30).
test('V2 Roll: Noten setzen mit IDs nach dem S2-Zähler des Projekts, auf das Raster abgerundet', () => {
  const p = { spuren: [{ clips: [clip()] }] };
  assert.deepEqual(naechsteNotenIds(p, 2), ['n8', 'n9']);
  assert.deepEqual(naechsteNotenIds({ spuren: [{ clips: [{ art: 'midi', noten: [{ id: 'x' }] }] }] }, 1), ['n1']);
  assert.deepEqual(naechsteNotenIds({ ...p, naechste_noten_id: 20 }, 2), ['n20', 'n21'], 'der Projekt-Zähler gewinnt (gelöschte Noten zählen weiter)');
  const zwei = { spuren: [{ clips: [clip()] }, { clips: [{ art: 'midi', noten: [{ id: 'n30' }] }, { art: 'audio' }] }] };
  assert.deepEqual(naechsteNotenIds(zwei, 1), ['n31'], 'über alle Clips des Projekts, nicht nur den gezeigten');
  assert.deepEqual(neueNote(p, 2.45, 62, 0.25, 0.5), { id: 'n8', beat: 2.25, laenge: 0.5, ton: 62, vel: 100 }, 'abgerundet: die Zelle, in die geklickt wurde');
  assert.deepEqual(neueNote(p, 2.37, 200, 0, 1, 64), { id: 'n8', beat: 2.37, laenge: 1, ton: 127, vel: 64 }, 'SNAP OFF frei, Ton begrenzt');
});

test('V2 Roll: verschieben, Länge ziehen, Velocity, Quantisieren', () => {
  const c = clip();
  assert.deepEqual(verschiebeNoten(c, ['n1', 'n2'], 'n2', 0.6, 2, 0.25), [{ id: 'n1', beat: 0.5, ton: 62 }, { id: 'n2', beat: 2, ton: 60 }], 'Anker n2 rastet auf 2.0, n1 folgt um +0.5');
  assert.deepEqual(verschiebeNoten(c, ['n1', 'n2'], 'n2', -5, 0, 0.25), [], 'n1 steht auf 0: keine rückt vor 0');
  assert.deepEqual(verschiebeNoten(c, ['n1'], 'n1', 0, 100, 0.25), [{ id: 'n1', ton: 127 }]);
  assert.deepEqual(dehneNoten(c, ['n1', 'n7'], 'n1', 0.6, 0.25), [{ id: 'n1', laenge: 1.5 }, { id: 'n7', laenge: 1 }], 'Ende von n1 rastet auf 1.5, n7 wächst gleich');
  assert.deepEqual(dehneNoten(c, ['n1'], 'n1', -5, 0.25), [{ id: 'n1', laenge: 0.25 }], 'mindestens ein Rasterschritt');
  assert.deepEqual(velocityNoten(c, ['n1', 'n2'], 'n1', 110), [{ id: 'n1', vel: 110 }, { id: 'n2', vel: 100 }]);
  assert.deepEqual(velocityNoten(c, ['n2'], 'n1', 120), [{ id: 'n1', vel: 120 }], 'Anker nicht gewählt: nur er');
  assert.deepEqual(quantisiere(c, []), [{ id: 'n7', beat: 3 }], 'ohne Auswahl alle; n1 und n2 liegen schon auf 1/16');
  assert.deepEqual(quantisiere(c, ['n1']), [], 'Negativ-Kontrolle: schon auf dem Raster');
});

test('V2 Roll: Rechteck, Tasten, Werkzeugleiste, Labels', () => {
  const c = clip();
  assert.deepEqual(rechteckAuswahl(c, A, TASTEN_BREITE, 0, TASTEN_BREITE + 40, TON_HOEHE * 2 + 2), ['n1', 'n2']);
  assert.deepEqual(rechteckAuswahl(c, A, 500, 0, 600, 10), []);
  assert.deepEqual(tastenSchritt('ArrowRight', false, 0.25), { dBeat: 0.25, dTon: 0 });
  assert.deepEqual(tastenSchritt('ArrowUp', true, 0.25), { dBeat: 0, dTon: 12 });
  assert.deepEqual(tastenSchritt('ArrowLeft', false, 0), { dBeat: -0.25, dTon: 0 }, 'SNAP OFF: 1/16');
  assert.equal(tastenSchritt('a', false, 1), null);
  assert.equal(auswahlVel(c, ['n1']), '100'); assert.equal(auswahlVel(c, ['n1', 'n2']), '–'); assert.equal(auswahlVel(c, []), '');
  assert.equal(notenLabel('Move', 1), 'Move note'); assert.equal(notenLabel('Move', 3), 'Move 3 notes');
});
