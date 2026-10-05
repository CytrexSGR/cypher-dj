// Kopplung durch den Leitstand (§14.1): das Beispiel aus dem Vertragstext ohne Gruppen hinein, mit genau seinen Gruppen
// und Politiken heraus; der Fall aus 09 NP K1 (LLM-Plan ohne Gruppe) bekommt sein Basstausch-Paar.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { koppeln } from '../src/kopplung.ts';
import { ausMenschenform, type Plan } from '../src/plan.ts';
import { REGLER } from '../src/regler_info.ts';
import { beispiel141, K1_PLAN } from './hilfen/faelle.ts';

const SCHWELLEN = { hoerbarDb: -26, tiefOffenDb: -12 };
const wertMit = (x: Record<string, number>) => (p: string) => x[p] ?? (REGLER.get(p)?.vorgabe as number);

test('§14.1: Gruppen und Politik des Beispiels entstehen aus dem Plan ohne Gruppen', () => {
  const soll = beispiel141();
  const ohne: Plan = structuredClone(soll);
  for (const t of ohne.teile) if (t.art !== 'tempo') { t.gruppe = 'falsch'; t.politik = 0; }
  const k = koppeln(ohne, wertMit({ 'deck/1/fader': 0 }), SCHWELLEN);
  assert.deepEqual(k.b, ['deck/2']);
  assert.deepEqual(k.a, ['deck/1']);
  assert.deepEqual(k.paare, [[5, 4]]);
  const kurz = (p: Plan) => p.teile.map((t) => (t.art === 'tempo' ? [t.nr] : [t.nr, t.gruppe, t.politik]));
  assert.deepEqual(kurz(ohne), kurz(soll));
});

test('09 NP K1: der LLM-Plan ohne Gruppe bekommt Basstausch-Paar, b_rein und a_raus', () => {
  const p = ausMenschenform(K1_PLAN, 'p1', 'cypher');
  const k = koppeln(p, wertMit({ 'deck/1/fader': 0 }), SCHWELLEN);
  assert.deepEqual(k.paare, [[4, 3]]);
  assert.deepEqual(p.teile.map((t) => (t.art === 'regler' ? t.gruppe : '')),
    ['b_rein', 'b_rein', 'b_rein', 'basstausch', 'basstausch', 'a_raus']);
  assert.deepEqual(p.teile.map((t) => (t.art === 'regler' ? t.politik : -1)), [0, 0, 0, 0, 0, 1]);
});

test('Negativ-Kontrolle: ein Plan nur mit EQ an einem Deck wird nicht gekoppelt', () => {
  const p = ausMenschenform({ grund: 'Höhen', teile: [{ regler: 'deck/1/eq/hoch', art: 'setze', ab_takt: 17, nach: -6 }] }, 'p2', 'cypher');
  const k = koppeln(p, wertMit({ 'deck/1/fader': 0 }), SCHWELLEN);
  assert.deepEqual([k.b, k.a, k.paare], [[], [], []]);
  assert.equal(p.teile[0].art === 'regler' && p.teile[0].gruppe, '');
});

test('Mutation kopplung_aus: alle Gruppen leer, Politik bleibt', () => {
  const p = ausMenschenform(K1_PLAN, 'p1', 'cypher');
  koppeln(p, wertMit({ 'deck/1/fader': 0 }), SCHWELLEN, false);
  assert.deepEqual(p.teile.map((t) => (t.art === 'regler' ? t.gruppe : '?')), ['', '', '', '', '', '']);
  assert.equal(p.teile[5].art === 'regler' && p.teile[5].politik, 1);
});
