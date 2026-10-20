// node --test tests/ki.test.mjs: KI-Stopp, KI-Freigabe, LEDs und übrige Sofort-Befehle
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BEFEHLE } from '../vertrag.mjs';
import { fahre } from '../folgen_schnell.mjs';
import { S, ID, inhalt, arbeitsbestand, sende, erwarte, wert, hand, teil, q, deckRein } from './hilfe.mjs';

const gruen = (r) => assert.ok(r.ok, r.fehler.join('\n'));
const AB = arbeitsbestand({ materialien: [{ beats: 400 }] });
const cfg = { arbeitsbestand: AB };

test('ki_stopp (E-a): alle cypher-Teile ab (ki_stopp), kein Fader gesenkt, danach ki_gestoppt; frei nur von andreas', () => {
  const r = fahre([
    ...deckRein(3, { id0: 10, ab: 8, mid: ID, quelle: 'cypher' }),
    sende(1000, ['/k/ki/spur', 'hss', 1, 'leitstand', 'deck/3,erz/1']),
    sende(S(9), teil(2, 'cypher', 'p1', 0, 'deck/1/eq/mitte', 16, 16, -10)),
    sende(S(9), teil(3, 'cypher', 'p1', 1, 'deck/1/eq/hoch', 40, 0, -10)),
    sende(S(20), ['/k/ki/stopp', 'hs', 4, 'leitstand']),
    erwarte(S(20) + 512, q(2, 'cypher', 7, null, 'ki_stopp')),
    erwarte(S(20) + 512, q(3, 'cypher', 7, null, 'ki_stopp')),
    erwarte(S(20) + 512, ['/e/ki', 'ish', 1, 'ki_stopp', null]),
    wert(S(22) + 256, 'deck/3/fader', 0),     // Entscheidung E-a: die KI-Spur (deck/3) wird nicht gesenkt (vorher −30, dann −200)
    wert(S(24) + 512, 'deck/3/fader', 0),
    sende(S(26), teil(5, 'cypher', 'p2', 0, 'deck/1/eq/tief', 30, 0, -3)),
    erwarte(S(26) + 512, q(5, 'cypher', 6, null, 'ki_gestoppt')),
    sende(S(27), ['/k/ki/frei', 'hs', 6, 'leitstand']),
    erwarte(S(27) + 512, q(6, 'leitstand', 6, null, 'nur_hand')),
    sende(S(28), ['/k/ki/frei', 'hs', 7, 'andreas']),
    erwarte(S(28) + 512, ['/e/ki', 'ish', 0, 'frei', null]),
    sende(S(30), teil(8, 'cypher', 'p3', 0, 'deck/1/eq/tief', 34, 0, -3)),
    erwarte(S(34), q(8, 'cypher', 3, S(34))),
  ], { cfg });
  gruen(r);
});

test('Stopp-Taste am Controller wirkt wie /k/ki/stopp; Freigabe plus Stopp wie /k/ki/frei', () => {
  const r = fahre([
    sende(1000, teil(1, 'cypher', 'p1', 0, 'deck/1/eq/mitte', 16, 16, -10)),
    hand(S(20), 'taste/stopp', 1),
    erwarte(S(20), q(1, 'cypher', 7, S(20), 'ki_stopp')),
    erwarte(S(20), ['/e/taste', 'sihd', 'stopp', 127, S(20), null]),
    hand(S(22), 'taste/freigabe', 1), hand(S(22) + 100, 'taste/stopp', 1),
    erwarte(S(23), ['/e/ki', 'ish', 0, 'freigabe', null]),
  ], { cfg });
  gruen(r);
});

test('LED, Kiste, Mapping, Latenz, Stufe, Vorschlagskanal: angenommen; falsche Namen abgelehnt', () => {
  const r = fahre([
    sende(1000, ['/k/led', 'hssi', 1, 'leitstand', 'vorschlag', 2]),
    sende(1000, ['/k/led', 'hssi', 2, 'leitstand', 'gibtsnicht', 1]),
    sende(1000, ['/k/kiste', 'hs', 3, 'leitstand']),
    sende(1000, ['/k/mapping', 'hss', 4, 'leitstand', 'beispiel']),
    sende(1000, ['/k/latenz', 'hssi', 5, 'leitstand', 'erz/2', 512]),
    sende(1000, ['/k/ki/stufe', 'hsi', 6, 'leitstand', 4]),
    sende(1000, ['/k/vorschlag_kanal', 'hss', 7, 'leitstand', 'deck/2']),
    erwarte(1600, q(1, 'leitstand', 3)), erwarte(1600, q(2, 'leitstand', 6, null, 'ausserhalb_bereich')),
    erwarte(1600, q(3, 'leitstand', 3)), erwarte(1600, q(4, 'leitstand', 3)), erwarte(1600, q(5, 'leitstand', 3)),
    erwarte(1600, q(6, 'leitstand', 6, null, 'ausserhalb_bereich')), erwarte(1600, q(7, 'leitstand', 3)),
  ], { cfg });
  gruen(r);
});

test('D1 Spec 6.15 (E-a): KI-Spur-Listen mit Cyphers Spuren (S2) und Kanälen (Leitstand) getrennt geführt; der Stopp senkt keine', () => {
  const r = fahre([
    sende(1000, ['/k/ki/spur', 'hss', 1, 'leitstand', 'erz/1']),
    sende(1000, ['/k/ki/spur', 'hss', 2, 'andreas', 'spur/1,spur/2']),
    sende(1000, ['/k/ki/spur', 'hss', 3, 'andreas', 'spur/13']),       // S2 erneuert seine Spuren, erz/1 bleibt
    sende(1000, ['/k/ki/spur', 'hss', 4, 'andreas', 'spur/1x']),
    sende(1000, ['/k/ki/spur', 'hss', 5, 'andreas', 'spur/']),
    erwarte(1600, q(3, 'andreas', 3)),
    erwarte(1600, q(4, 'andreas', 6, null, 'unbekannter_regler')),
    erwarte(1600, q(5, 'andreas', 6, null, 'unbekannter_regler')),
    sende(S(2), teil(6, 'andreas', 'p', 0, 'erz/1/fader', 4, 0, -6)),
    sende(S(10), ['/k/ki/stopp', 'hs', 7, 'andreas']),
    wert(S(16), 'erz/1/fader', -6),   // E-a: die Listen senken nichts, jeder Fader behält seinen Wert (vorher alle −200 außer spur/2)
    wert(S(16), 'spur/1/fader', 0),
    wert(S(16), 'spur/3/fader', 0),
    wert(S(16), 'spur/2/fader', 0),
  ], { cfg });
  gruen(r);
});

test('D1 Spec 6.15 (E-a): spur/0 leert nur die Spuren, die leere Liste nur die Kanäle; keine Liste senkt etwas', () => {
  const r = fahre([
    sende(1000, ['/k/ki/spur', 'hss', 1, 'leitstand', 'erz/1,spur/2']),
    sende(1000, ['/k/ki/spur', 'hss', 2, 'andreas', 'spur/0']),
    sende(1000, ['/k/ki/spur', 'hss', 3, 'andreas', 'spur/4']),
    sende(1000, ['/k/ki/spur', 'hss', 4, 'leitstand', '']),
    sende(S(2), teil(5, 'andreas', 'p', 0, 'erz/1/fader', 4, 0, -6)),
    sende(S(10), ['/k/ki/stopp', 'hs', 6, 'andreas']),
    wert(S(16), 'erz/1/fader', -6),
    wert(S(16), 'spur/2/fader', 0),
    wert(S(16), 'spur/4/fader', 0),   // E-a: auch die Spur in der Liste (spur/4) bleibt offen (vorher −200)
  ], { cfg });
  gruen(r);
});

// D1 Spec 6.27, SCHNITTSTELLEN §4.7/§4.11: gemeinsamer Fall mit dem Kern (test_kern_arr_ki Fall 7). laden, start, loop und
// metronom von cypher während des KI-Stopps abgelehnt (ki_gestoppt), stopp von cypher erlaubt (Anhalten ist die sichere
// Richtung). Die OSC-Form jedes Befehls kommt aus BEFEHLE (Feldnamen wie osc.json), die Erwartung aus der Datei.
test('D1 Spec 6.27: KI-Stopp am Arrangement wie im Kern (djk/vertrag/faelle/arr_ki_stopp.json)', () => {
  const f = JSON.parse(fs.readFileSync(new URL('../../faelle/arr_ki_stopp.json', import.meta.url), 'utf8'));
  let id = 500, s = 0;
  const osc = (b) => {
    const def = BEFEHLE[b.adresse];
    assert.ok(def, `${b.adresse} fehlt in BEFEHLE`);
    const werte = def.felder.map((n) => (n === 'id' ? ++id : n === 'quelle' ? b.quelle : b.werte[n]));
    assert.ok(werte.every((w) => w !== undefined), `${b.adresse}: Felder ${def.felder.join(' ')}`);
    return [b.adresse, def.typen, ...werte];
  };
  const schritte = [], ids = [];
  for (const b of f.vorher) { schritte.push(sende((s += 4096), osc(b))); }
  for (const b of f.befehle) { schritte.push(sende((s += 4096), osc(b))); ids.push([id, b]); }
  schritte.push({ t: 'erwarte', bis_sample: s + 48000, osc: ['/zustand/arr', null] });   // lange genug für den Einsatz
  const r = fahre(schritte, { cfg });
  const fehler = [];
  for (const [i, b] of ids) {
    const qs = r.log.filter((m) => m.adresse === '/q' && Number(m.werte[0]) === i);
    const letzte = qs.at(-1);
    const ist = letzte ? `${letzte.werte[2]} '${letzte.werte[5]}'` : 'keine';
    if (ist !== `${b.ende} '${b.grund}'`) fehler.push(`${b.adresse} von ${b.quelle}: endet mit ${ist}, erwartet ${b.ende} '${b.grund}'`);
  }
  assert.deepEqual(fehler, []);
});

// Entscheidung E-a (2026-10-20), DJ-Spiel wie Produktion: der KI-Stopp senkt keinen Fader (djk/kern/stellwerk/src/ki.cpp). Cyphers Teile enden
// (eine laufende Rampe hält am Ist-Wert, wie /k/abbruch), fremde Teile laufen weiter. Vorher (D1 S2-Integration Fix7 U2) bildete dieser Fall
// ki_fader_ab nach: Ausblende über 4 Beats, Fader in Andreas' Hand und schon stumme Fader ausgenommen.
test('E-a KI-Stopp: kein Fader wird gesenkt, Cyphers laufende Rampe hält am Ist-Wert, fremde Teile laufen weiter, auch an Fadern der KI-Spur', () => {
  const r = fahre([
    sende(1000, ['/k/ki/spur', 'hss', 1, 'andreas', 'spur/124']),
    sende(S(1), teil(2, 'andreas', 'p', 0, 'spur/1/fader', 2, 0, -6)),          // gesetzt auf −6, in der KI-Spur
    sende(S(1), teil(3, 'cypher', 'c', 0, 'deck/1/eq/mitte', 4, 16, -16)),      // Cyphers Rampe Beat 4 bis 20: bei Beat 12 halb unterwegs
    sende(S(1), teil(4, 'andreas', 'l', 0, 'deck/1/eq/hoch', 4, 16, -16)),      // Negativ-Kontrolle: Andreas' gleiche Rampe läuft weiter
    sende(S(1), teil(6, 'andreas', 'm', 0, 'spur/2/fader', 4, 16, -16)),        // Andreas' Rampe an einem Fader der KI-Spur läuft ebenso weiter (Review S1)
    sende(S(12), ['/k/ki/stopp', 'hs', 5, 'andreas']),
    erwarte(S(12) + 512, q(3, 'cypher', 7, null, 'ki_stopp')),
    erwarte(S(12) + 512, ['/e/ki', 'ish', 1, 'ki_stopp', null]),
    wert(S(14), 'spur/1/fader', -6),                                            // in der KI-Spur, nicht gesenkt (vorher −200)
    wert(S(14), 'deck/1/eq/mitte', -8, 0.2),                                    // hält am Ist-Wert vom Stopp
    wert(S(18), 'deck/1/eq/mitte', -8, 0.2),                                    // und bleibt dort
    wert(S(18), 'deck/1/eq/hoch', -14, 0.3),                                    // Andreas' Rampe läuft weiter
    wert(S(18), 'spur/2/fader', -14, 0.3),                                      // auch in der KI-Spur
  ], { cfg });
  gruen(r);
});
