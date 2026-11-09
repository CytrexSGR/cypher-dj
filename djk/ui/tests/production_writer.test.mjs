// PRODUCTION V1: Schreibweg (Reihenfolge, rev-Kette, Zusammenfassen, 409)
import test from 'node:test';
import assert from 'node:assert/strict';
import { neuerSchreiber, WIEDERHOLUNGEN, WIEDERHOLE_PAUSE_MS } from '../public/production/writer.js';

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

// 1.12 S3 task 9 fixup: the own revision is confirmed by the RESPONSE of the request, never guessed. A server take (rev R+1 written by the recorder) that
// lands while the page's own request with rev R is in flight looks like "sent + 1" at the event; the response then says rev R+2 (or 409), the event
// was foreign, and the page reloads.
test('Schreiber task 9: ein Ereignis sent+1 gilt vorläufig als eigen; die Antwort entscheidet (Fremdes → Neuladen)', async () => {
  const fremd = [];
  const srv = server({ start: 5, verzoegert: true });
  const s = neuerSchreiber({ holeJson: srv.holeJson, beiProjekt: () => {}, beiFehler: () => {}, beiFremdeRev: (slug, rev) => fremd.push([slug, rev]) });
  s.setze('a', 5);
  // case 1: the event rev 6 is the answer of our own request (rev 6): no reload
  const e1 = s.aendere('Volume', [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -3 }]);
  await warte();
  assert.equal(s.istEigeneRev('a', 6), true);
  srv.freigaben.shift()();
  assert.equal(await e1, true);
  assert.deepEqual(fremd, [], 'own event confirmed by the response rev 6: no reload');
  // case 2: a server take took rev 7 while our request with rev 6 was in flight: the event rev 7 is NOT ours
  const e2 = s.aendere('Volume', [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -4 }]);
  await warte();
  srv.rev = 7;                                              // the take
  assert.equal(s.istEigeneRev('a', 7), true, 'at the event it cannot be known yet');
  srv.freigaben.shift()();
  assert.equal(await e2, false, 'our request is stale (409)');
  assert.deepEqual(fremd, [['a', 7]], 'the response did not confirm rev 7: the page reloads');
  // negative control: a rev that is not sent+1 is refused at once and nothing is pending
  const e3 = s.aendere('Volume', [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -5 }]);
  await warte();
  assert.equal(s.istEigeneRev('a', 9), false);
  srv.rev = srv.rev;                                        // unchanged
  srv.freigaben.shift()();
  await e3;
  assert.equal(fremd.length, 1, 'the unrelated rev 9 added no deferred reload');
});

test('Schreiber task 9: leerWarten löst, sobald Anfrage und Schlange leer sind', async () => {
  const srv = server({ verzoegert: true });
  const s = neuerSchreiber({ holeJson: srv.holeJson, beiProjekt: () => {}, beiFehler: () => {} });
  s.setze('a', 5);
  let leer = false;
  s.aendere('A', [{ befehl: 'x' }]); s.aendere('B', [{ befehl: 'y' }]);
  const w = s.leerWarten().then(() => { leer = true; });
  await warte(); srv.freigaben.shift()(); await warte(); await warte();
  assert.equal(leer, false, 'one request still waits');
  srv.freigaben.shift()(); await w;
  assert.equal(leer, true);
  await s.leerWarten();   // negative control: an idle writer answers at once
});

// 1.12 S3 task 9 fixup 2: a hand value (fader, pan) that meets rev_veraltet because a server take took the revision a moment ago is written again once
// after the reload, without the "changed elsewhere" notice. Everything else keeps the old rule (no repeat).
test('Schreiber task 9: wiederhole: ein Handwert nach rev_veraltet wird nach dem Neuladen wiederholt (höchstens WIEDERHOLUNGEN), ohne Fehlermeldung', async () => {
  const srv = server({ start: 5 });
  const ereignisse = [];
  let s;
  s = neuerSchreiber({ holeJson: srv.holeJson, beiProjekt: () => {}, beiFehler: (a, r) => ereignisse.push(`fehler ${r.j.fehler}`),
    beiWiederhole: async () => { ereignisse.push('neu geladen'); s.setze('a', srv.rev); } });
  s.setze('a', 5);
  srv.rev = 6;                                    // a server take took revision 5 -> 6 meanwhile
  const ok = await s.aendere('Volume', [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -3 }], 'k', { wiederhole: true });
  assert.equal(ok, true, 'written on the second try');
  assert.deepEqual(ereignisse, ['neu geladen'], 'no error notice for the first answer');
  assert.deepEqual(srv.anfragen.map((a) => a.koerper.rev), [5, 6]);
  // negative control: without the option the old rule holds (error, no repeat)
  srv.rev = 8;
  const ok2 = await s.aendere('Volume', [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -4 }], 'k');
  assert.equal(ok2, false);
  assert.deepEqual(ereignisse.slice(1), ['fehler rev_veraltet']);
  assert.equal(srv.anfragen.length, 3, 'one request, not repeated');
  // and a second 409 of the repeat is final (no loop): the reload did not bring the revision
  const s2 = neuerSchreiber({ holeJson: srv.holeJson, beiProjekt: () => {}, beiFehler: (a, r) => ereignisse.push(`fehler2 ${r.j.fehler}`), beiWiederhole: async () => { ereignisse.push('neu2'); } });
  s2.setze('a', 1);
  const n0 = srv.anfragen.length;
  assert.equal(await s2.aendere('Volume', [{ befehl: 'x' }], 'k2', { wiederhole: true }), false);
  assert.equal(srv.anfragen.length - n0, 1 + WIEDERHOLUNGEN, 'WIEDERHOLUNGEN repeats, then final');
  assert.deepEqual(ereignisse.slice(-2), ['neu2', 'fehler2 rev_veraltet']);
  assert.equal(ereignisse.filter((x) => x === 'neu2').length, WIEDERHOLUNGEN);
});

// fixup 2: the mutants of the retry pinned
test('Schreiber task 9: a retried write goes BEFORE a newer write of the same field (it never overwrites the newer one)', async () => {
  const gesehen = [];
  let n = 0;
  const holeJson = async (weg, koerper) => {
    gesehen.push(koerper.befehle?.[0]?.wert);
    n++;
    if (n === 1) return { status: 409, j: { fehler: 'rev_veraltet' } };
    return { status: 200, j: { rev: koerper.rev + 1, projekt: { rev: koerper.rev + 1 } } };
  };
  let s;
  s = neuerSchreiber({ holeJson, beiProjekt: () => {}, beiFehler: () => {}, beiWiederhole: async () => {} });
  s.setze('a', 5);
  const a = s.aendere('Volume', [{ befehl: 'x', wert: 'alt' }], 'k', { wiederhole: true });       // in flight, will meet 409
  const b = s.aendere('Volume', [{ befehl: 'x', wert: 'neu' }], 'k2', { wiederhole: true });      // a newer value queued behind it
  await Promise.all([a, b]);
  assert.deepEqual(gesehen, ['alt', 'alt', 'neu'], 'the repeat of the old value comes before the newer value, so the newer one is the last write');
});

test('Schreiber task 9: from the second repeat on there is a pause (the take is still being written)', async () => {
  const zeiten = [];
  const holeJson = async () => { zeiten.push(Date.now()); return { status: 409, j: { fehler: 'rev_veraltet' } }; };
  const s = neuerSchreiber({ holeJson, beiProjekt: () => {}, beiFehler: () => {}, beiWiederhole: async () => {} });
  s.setze('a', 5);
  await s.aendere('Volume', [{ befehl: 'x' }], 'k', { wiederhole: true });
  assert.equal(zeiten.length, 1 + WIEDERHOLUNGEN);
  assert.ok(zeiten[2] - zeiten[1] >= WIEDERHOLE_PAUSE_MS - 10, `pause before the second repeat: ${zeiten[2] - zeiten[1]} ms`);
  assert.ok(zeiten[3] - zeiten[2] >= WIEDERHOLE_PAUSE_MS - 10, 'and before the third');
});

test('Schreiber task 9: bisHier wartet nur auf die bis jetzt eingereihten Anfragen, nicht auf spätere', async () => {
  const srv = server({ verzoegert: true });
  const s = neuerSchreiber({ holeJson: srv.holeJson, beiProjekt: () => {}, beiFehler: () => {} });
  s.setze('a', 5);
  await s.bisHier();                                   // idle: at once
  s.aendere('A', [{ befehl: 'x' }]); s.aendere('B', [{ befehl: 'y' }]);
  let da = false; const w = s.bisHier().then(() => { da = true; });
  s.aendere('C', [{ befehl: 'z' }]);                   // later: not awaited
  await warte(); srv.freigaben.shift()(); await warte(); await warte();
  assert.equal(da, false, 'B is still open');
  srv.freigaben.shift()(); await w;
  assert.equal(da, true);
  assert.equal(srv.anfragen.length, 3, 'C is only now in flight or queued');
  srv.freigaben.shift()?.();
});
