// node --test tests/hallo_stand.test.mjs: wer sich zum ersten Mal meldet (neuer Abonnent oder neue Generation), bekommt nach /k/willkommen den
// gemerkten Stand aller schon gemeldeten Regler als /e/regler mit Halter frei, wie der Kern (kern/src/netz.cpp, hallo: „Effekt-Sektion
// (2026-10-11): danach der gemerkte Stand aller gemeldeten Regler“). Ein Herzschlag eines Bekannten bringt nichts. Anlass: D1 S2-Integration
// Fix-Runde 4 J1 (Spec 6.35, 6.21): ein Seiten-Server, der nach dem Ende der Abonnenten-Frist neu startet, kennt so die Spur-Regler des Kerns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fahre } from '../folgen_schnell.mjs';
import { S, sende, teil } from './hilfe.mjs';

const zweiter = (s) => sende(s, ['/k/hallo', 'sii', 'zweiter', 1, 1]);   // neuer Name, derselbe Port des Läufers (so landet die Antwort im Log)
const meldungen = (r, pfad) => r.log.filter((m) => m.adresse === '/e/regler' && m.werte[0] === pfad)
  .map((m) => ({ s: m.s, wert: Math.round(m.werte[1] * 1000) / 1000, halter: m.werte[2] }));

test('Hallo-Stand: ein neuer Abonnent bekommt die gemeldeten Regler (Halter frei), nie gemeldete nicht', () => {
  const r = fahre([
    sende(S(1), teil(1, 'andreas', '', 0, 'spur/3/fader', 2, 0, -7, { politik: 1 })),
    zweiter(S(6)),
    sende(S(8), ['/k/ki/frei', 'hs', 2, 'andreas']),
  ]);
  const s3 = meldungen(r, 'spur/3/fader');
  console.log(`hallo_stand ${JSON.stringify(s3)}`);
  assert.equal(s3.length, 2, 'eine Meldung vom Setzen, eine aus dem Hallo-Stand');
  assert.deepEqual([s3[1].wert, s3[1].halter], [-7, 'frei']);
  assert.ok(s3[1].s >= S(6) && s3[1].s < S(7), `Stempel des Hallo-Stands ${s3[1].s}`);
  assert.equal(meldungen(r, 'spur/4/fader').length, 0, 'spur/4 wurde nie gemeldet');
});

test('Hallo-Stand Negativ-Kontrolle: der Herzschlag eines Bekannten bringt keinen Stand', () => {
  const r = fahre([
    sende(S(1), teil(1, 'andreas', '', 0, 'spur/3/fader', 2, 0, -7, { politik: 1 })),
    sende(S(6), ['/k/hallo', 'sii', 'folgen', 1, 1]),
    sende(S(8), ['/k/ki/frei', 'hs', 2, 'andreas']),
  ]);
  assert.equal(meldungen(r, 'spur/3/fader').length, 1);
});
