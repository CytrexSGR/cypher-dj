// PRODUCTION V1: Schreibweg (Reihenfolge, rev-Kette, Zusammenfassen, 409)
import test from 'node:test';
import assert from 'node:assert/strict';
import { neuerSchreiber } from '../oeffentlich/produktion/schreiber.js';

// Server-Attrappe im Speicher: zählt rev hoch, 409 bei falscher rev, antwortet erst auf Freigabe (steuerbar)
function server({ start = 5, verzoegert = false } = {}) {
  const s = { rev: start, anfragen: [], freigaben: [] };
  s.holeJson = (weg, koerper) => new Promise((ok) => {
    s.anfragen.push({ weg, koerper: structuredClone(koerper) });
    const antworte = () => {
      if (koerper.rev !== s.rev) return ok({ status: 409, j: { fehler: 'rev_veraltet' } });
      s.rev += 1;
      ok({ status: 200, j: { rev: s.rev, projekt: { rev: s.rev } } });
    };
    if (verzoegert) s.freigaben.push(antworte); else setImmediate(antworte);
  });
  return s;
}
const warte = () => new Promise((r) => setImmediate(r));

test('V1 Schreiber: nacheinander, jede Anfrage trägt die rev der vorigen Antwort', async () => {
  const srv = server();
  const gesehen = [];
  const s = neuerSchreiber({ holeJson: srv.holeJson, beiProjekt: (slug, p, rev) => gesehen.push(rev), beiFehler: () => assert.fail('kein Fehler erwartet') });
  s.setze('a', 5);
  const e = await Promise.all([s.aendere('Add track', [{ befehl: 'spur_neu', art: 'audio' }]), s.aendere('Mute', [{ befehl: 'spur_aendern', spur_id: 's1', mute: true }]), s.undo()]);
  assert.deepEqual(e, [true, true, true]);
  assert.deepEqual(srv.anfragen.map((a) => [a.weg, a.koerper.rev]), [['/proj/aendern', 5], ['/proj/aendern', 6], ['/proj/undo', 7]]);
  assert.deepEqual(srv.anfragen[0].koerper, { rev: 5, label: 'Add track', befehle: [{ befehl: 'spur_neu', art: 'audio' }] });
  assert.deepEqual(srv.anfragen[2].koerper, { rev: 7 }, 'undo trägt nur die rev');
  assert.deepEqual(gesehen, [6, 7, 8]);
  assert.equal(s.rev, 8);
  assert.ok(s.leer());
});

test('V1 Schreiber: wartende Fader-Bewegungen derselben Spur werden zusammengefasst', async () => {
  const srv = server({ verzoegert: true });
  const s = neuerSchreiber({ holeJson: srv.holeJson, beiProjekt: () => {}, beiFehler: () => {} });
  s.setze('a', 5);
  const fader = (db) => [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: db }];
  s.aendere('Fader', fader(-1), 'fader:s1');       // geht sofort hinaus
  s.aendere('Fader', fader(-2), 'fader:s1');       // wartet
  s.aendere('Fader', fader(-3), 'fader:s1');       // ersetzt die wartende
  s.aendere('Pan', [{ befehl: 'spur_aendern', spur_id: 's1', pan: 0.5 }], 'pan:s1');   // anderer Schlüssel: eigene Anfrage
  await warte();
  while (srv.freigaben.length) { srv.freigaben.shift()(); await warte(); await warte(); }
  assert.deepEqual(srv.anfragen.map((a) => a.koerper.befehle[0].fader_db ?? `pan ${a.koerper.befehle[0].pan}`), [-1, -3, 'pan 0.5']);
  // Negativ-Kontrolle: ohne Schlüssel wird nie zusammengefasst
  const srv2 = server({ verzoegert: true });
  const s2 = neuerSchreiber({ holeJson: srv2.holeJson, beiProjekt: () => {}, beiFehler: () => {} });
  s2.setze('a', 5);
  s2.aendere('A', fader(-1)); s2.aendere('B', fader(-2)); s2.aendere('C', fader(-3));
  await warte();
  while (srv2.freigaben.length) { srv2.freigaben.shift()(); await warte(); await warte(); }
  assert.equal(srv2.anfragen.length, 3);
});

test('V1 Schreiber: 409 rev_veraltet meldet den Fehler und lässt die rev stehen', async () => {
  const srv = server({ start: 9 });
  const fehler = [];
  const s = neuerSchreiber({ holeJson: srv.holeJson, beiProjekt: () => assert.fail('kein Projekt erwartet'), beiFehler: (a, r) => fehler.push([a.label, r.status, r.j.fehler]) });
  s.setze('a', 5);
  assert.equal(await s.aendere('Mute', []), false);
  assert.deepEqual(fehler, [['Mute', 409, 'rev_veraltet']]);
  assert.equal(s.rev, 5);
});

test('V1 Schreiber: setze nimmt keinen älteren Stand desselben Projekts an, ein anderes Projekt immer', () => {
  const s = neuerSchreiber({ holeJson: async () => ({}), beiProjekt: () => {}, beiFehler: () => {} });
  assert.equal(s.setze('a', 7), true);
  assert.equal(s.setze('a', 6), false);
  assert.equal(s.rev, 7);
  assert.equal(s.setze('b', 2), true);
  assert.equal(s.slug, 'b');
});

// Fix 8: nach rev_veraltet läuft nichts mit der alten rev weiter. Die Schlange hält an, bis der neue Stand gesetzt ist,
// dann werden die Wartenden verworfen und gemeldet.
test('V1 Schreiber: 409 rev_veraltet hält die Schlange an, verwirft zwei Wartende nach dem neuen Stand und meldet das', async () => {
  const srv = server({ start: 9, verzoegert: true });          // der Server steht auf 9, die Seite kennt 5
  const ereignisse = [];
  let s;
  s = neuerSchreiber({
    holeJson: srv.holeJson,
    beiProjekt: () => ereignisse.push('projekt'),
    beiFehler: (a, r) => {
      ereignisse.push(`fehler ${a.label} ${r.j.fehler}`);
      return new Promise((ok) => setTimeout(() => { s.setze('a', 9); ereignisse.push('neuer Stand gesetzt'); ok(); }, 20));   // „neu laden“ dauert
    },
    beiVerworfen: (n) => ereignisse.push(`verworfen ${n}`),
  });
  s.setze('a', 5);
  const e1 = s.aendere('Erste', [{ befehl: 'tempo_setzen', bpm: 100 }]);
  const e2 = s.aendere('Zweite', [{ befehl: 'tempo_setzen', bpm: 110 }]);
  const e3 = s.undo();
  await warte();
  srv.freigaben.shift()();                                      // die erste Anfrage bekommt 409
  assert.deepEqual(await Promise.all([e1, e2, e3]), [false, false, false]);
  assert.equal(srv.anfragen.length, 1, 'die zwei Wartenden sind nie mit der alten rev hinausgegangen');
  assert.deepEqual(ereignisse, ['fehler Erste rev_veraltet', 'neuer Stand gesetzt', 'verworfen 2'], 'erst der neue Stand, dann die Meldung');
  assert.equal(s.rev, 9);
  assert.ok(s.leer());
  // danach geht ein neuer Auftrag mit der neuen rev hinaus
  const e4 = s.aendere('Neu', [{ befehl: 'tempo_setzen', bpm: 120 }]);
  await warte(); srv.freigaben.shift()();
  assert.equal(await e4, true);
  assert.equal(srv.anfragen[1].koerper.rev, 9);
});

test('V1 Schreiber: ein anderer Fehler (kein rev_veraltet) lässt die Wartenden weiterlaufen (Negativ-Kontrolle)', async () => {
  let n = 0;
  const holeJson = async (weg, koerper) => { n++; return n === 1 ? { status: 400, j: { fehler: 'argument_ungueltig' } } : { status: 200, j: { rev: koerper.rev + 1, projekt: { rev: koerper.rev + 1 } } }; };
  const verworfen = [];
  const s = neuerSchreiber({ holeJson, beiProjekt: () => {}, beiFehler: () => {}, beiVerworfen: (k) => verworfen.push(k) });
  s.setze('a', 5);
  const r = await Promise.all([s.aendere('A', [{ befehl: 'x' }]), s.aendere('B', [{ befehl: 'y' }])]);
  assert.deepEqual(r, [false, true]);
  assert.deepEqual(verworfen, []);
});

// Fix 7: die eigene ausstehende rev. Während eine Anfrage mit rev R unterwegs ist, kommt ihr SSE-Ereignis rev R+1 vor der
// HTTP-Antwort; die Seite lädt dafür nicht nach.
test('V1 Schreiber: eigene ausstehende rev ist bekannt, solange die Anfrage unterwegs ist', async () => {
  const srv = server({ start: 5, verzoegert: true });
  const s = neuerSchreiber({ holeJson: srv.holeJson, beiProjekt: () => {}, beiFehler: () => {} });
  s.setze('a', 5);
  assert.equal(s.istEigeneRev('a', 6), false, 'nichts unterwegs');
  const e = s.aendere('Tempo', [{ befehl: 'tempo_setzen', bpm: 100 }]);
  await warte();
  assert.equal(s.istEigeneRev('a', 6), true, 'unterwegs mit rev 5: das Ereignis rev 6 ist unser eigenes');
  assert.equal(s.istEigeneRev('a', 7), false, 'rev 7 wäre eine fremde Änderung');
  assert.equal(s.istEigeneRev('a', 5), false);
  assert.equal(s.istEigeneRev('b', 6), false, 'anderes Projekt');
  assert.equal(s.istEigeneRev(undefined, 6), false);
  srv.freigaben.shift()();
  assert.equal(await e, true);
  assert.equal(s.istEigeneRev('a', 6), false, 'nach der Antwort gilt die Regel „nicht höher als die gezeigte rev“, nicht diese');
});

// V2 Fix-Runde F2 (Spec 6.34): aendereMit rechnet die Änderung erst, wenn sie an der Reihe ist, und schickt genau die rev des Stands, aus dem
// sie gerechnet wurde. Leere Befehle schicken nichts.
test('V2 Schreiber F2: aendereMit rechnet beim Senden, mit der rev dieses Stands', async () => {
  const srv = server({ verzoegert: true });
  let stand = { rev: 5, wert: 'alt' };
  const s = neuerSchreiber({ holeJson: srv.holeJson, beiProjekt: (slug, p) => { stand = { rev: p.rev, wert: 'neu' }; }, beiFehler: () => assert.fail('kein Fehler erwartet') });
  s.setze('a', 5);
  const erst = s.aendere('Erst', [{ befehl: 'x' }]);
  let gerechnet = null;
  const zug = s.aendereMit(() => { gerechnet = stand.wert; return { label: 'Zug', befehle: [{ befehl: 'y', aus: stand.wert }], rev: stand.rev }; });
  const leer = s.aendereMit(() => ({ label: 'Leer', befehle: [], rev: 99 }));
  await warte();
  assert.equal(gerechnet, null, 'solange die erste unterwegs ist, wird der Zug nicht gerechnet');
  srv.freigaben.shift()(); await erst; await warte();
  assert.equal(gerechnet, 'neu', 'gerechnet aus dem Stand nach der ersten Antwort');
  assert.deepEqual(srv.anfragen[1].koerper, { rev: 6, label: 'Zug', befehle: [{ befehl: 'y', aus: 'neu' }] });
  srv.freigaben.shift()();
  assert.deepEqual([await zug, await leer], [true, false]);
  assert.equal(srv.anfragen.length, 2, 'Negativ-Kontrolle: leere Befehle schicken nichts');
});
