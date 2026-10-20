// PRODUCTION V1: reine Teile des Transports (transport.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { kernText, kopfStand, ARR_ALTER_MS } from '../oeffentlich/produktion/transport.js';

test('V1 Transport: Kern-Anzeige liest das Feld nr aus /zustand/arr (Spec 3.1), nicht rev', () => {
  assert.equal(kernText({ nr: 7, status: 2 }), 'core rev 7 · playing');
  assert.equal(kernText({ nr: 7, status: 0 }), 'core rev 7 · stopped');
  // Negativ-Kontrolle: ein Feld rev (alter Vertragsfehler) wird nicht gelesen
  assert.doesNotMatch(kernText({ rev: 9, status: 2 }), /9/);
  assert.equal(kernText({ nr: 3, status: 9 }), 'core rev 3 · 9', 'unbekannter Status zeigt die Zahl');
});

// Fix 9: der Abspielkopf wird nur so lange hochgerechnet, wie die letzte /zustand/arr-Meldung jung ist (höchstens 1 s)

test('V1 Transport: Abspielkopf rechnet nach 1 s ohne /zustand/arr nicht weiter und zeigt „unbekannt“', () => {
  assert.equal(ARR_ALTER_MS, 1000);
  const loop = { an: true, von_beat: 0, bis_beat: 8 };
  const spielt = { status: 2, projekt_beat: 3 };
  const rechne = (t) => 3 + (t - 1000) / 500;                  // 2 Beats je Sekunde ab t = 1000 ms
  const stand = (arrZeit, t, arr = spielt) => kopfStand({ arr, arrZeit, t, hochrechne: rechne, loop });
  // jung: wird hochgerechnet
  assert.deepEqual(stand(1000, 1500), { kopfBeat: 4, unbekannt: false });
  assert.deepEqual(stand(1000, 2000), { kopfBeat: 5, unbekannt: false }, 'genau 1 s alt gilt noch');
  // älter als 1 s: nicht weiter hochrechnen, Zustand unbekannt
  assert.deepEqual(stand(1000, 2001), { kopfBeat: null, unbekannt: true });
  assert.deepEqual(stand(1000, 9000), { kopfBeat: null, unbekannt: true });
  // eine neue Meldung macht den Zustand wieder bekannt
  const neu = stand(9000, 9100);
  assert.equal(neu.unbekannt, false);
  assert.ok(Math.abs(neu.kopfBeat - 3.2) < 1e-9, `gefaltet in die Klammer: ${neu.kopfBeat}`);
  // Negativ-Kontrollen: steht der Kern (status 0), gibt es keinen Kopf, aber auch kein „unbekannt“, solange die Meldungen kommen
  assert.deepEqual(stand(1000, 1400, { status: 0, projekt_beat: 3 }), { kopfBeat: null, unbekannt: false });
  // ohne jede Meldung: nichts zu zeigen und nichts zu behaupten
  assert.deepEqual(kopfStand({ arr: null, arrZeit: null, t: 5000, hochrechne: rechne, loop }), { kopfBeat: null, unbekannt: false });
  // der Loop faltet weiter (kopfImLoop), solange die Meldung jung ist
  assert.ok(stand(1000, 1900).kopfBeat < 8);
});
