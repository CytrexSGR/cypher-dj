// PRODUCTION V1: reine Teile des Transports (transport.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { kernText, kopfStand, ARR_ALTER_MS, limiterAn } from '../oeffentlich/produktion/transport.js';

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

test('1.10 Slice 2: die Lampe SET LIMITER ist an, sobald limiter_db unter −0,1 liegt (kein Wert, 0, Rauschen: aus)', () => {
  assert.equal(limiterAn({ limiter_db: -3 }), true);
  assert.equal(limiterAn({ limiter_db: -0.11 }), true);
  for (const f of [{ limiter_db: 0 }, { limiter_db: -0.05 }, {}, null, undefined, { limiter_db: 'x' }, { limiter_db: Number.NaN }]) assert.equal(limiterAn(f), false, JSON.stringify(f));
});

// Andreas 2026-10-30: „kann ich mit dem curser nicht auf einen punkt vor oder zurückclicken“. Ein Klick springt, wenn der Transport läuft.
test('Klick im Lauf: springt nur bei laufendem oder startendem Transport und bekanntem Zustand', async () => {
  const { springtImLauf } = await import('../oeffentlich/produktion/transport.js');
  assert.equal(springtImLauf({ status: 2 }, false), true);
  assert.equal(springtImLauf({ status: 1 }, false), true);
  assert.equal(springtImLauf({ status: 0 }, false), false, 'gestoppt: nur Startmarker setzen');
  assert.equal(springtImLauf({ status: 2 }, true), false, 'Zustand unbekannt: nie blind starten');
  assert.equal(springtImLauf(null, false), false);
});
