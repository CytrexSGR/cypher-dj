// Autonomie-Positivliste §10 wörtlich: jede Methode auf jeder Stufe, dazu die Grenzfälle der Ausnahme „nur KI-Spur leiser“.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { entscheide, nurKiSpurLeiser } from '../src/autonomie.ts';
import { ausMenschenform, type MenschenTeil } from '../src/plan.ts';
import { REGLER } from '../src/regler_info.ts';

const KI = new Set(['deck/3', 'erz/1']);
const wert = (p: string) => ({ 'deck/3/fader': -6, 'deck/1/fader': 0, 'erz/1/send/1': -10 } as Record<string, number>)[p]
  ?? (REGLER.get(p)?.vorgabe as number);
const plan = (teile: MenschenTeil[]) => ausMenschenform({ grund: 't', teile }, 'p1', 'cypher');

const EQ_A = plan([{ regler: 'deck/1/eq/hoch', art: 'setze', ab_takt: 17, nach: -6 }]);
const KI_LEISER = plan([{ regler: 'deck/3/fader', art: 'rampe', ab_takt: 9, dauer_takte: 2, nach: -20 }]);

test('§10 Tabelle: Methoden je Stufe', () => {
  const alle = ['lage', 'warte', 'bestand', 'passung', 'markieren', 'waehle', 'plan_einreichen', 'laden', 'vorhoeren',
    'erzeuge', 'plan_abbrechen', 'spielzettel'];
  const soll: Record<number, string[]> = {
    0: ['direkt', 'direkt', 'direkt', 'direkt', 'direkt', 'abgelehnt', 'abgelehnt', 'abgelehnt', 'abgelehnt', 'abgelehnt', 'direkt', 'abgelehnt'],
    1: ['direkt', 'direkt', 'direkt', 'direkt', 'direkt', 'vorschlag', 'vorschlag', 'direkt', 'direkt', 'direkt', 'direkt', 'abgelehnt'],
    2: ['direkt', 'direkt', 'direkt', 'direkt', 'direkt', 'vorschlag', 'vorschlag', 'direkt', 'direkt', 'direkt', 'direkt', 'abgelehnt'],
    3: ['direkt', 'direkt', 'direkt', 'direkt', 'direkt', 'direkt', 'direkt', 'direkt', 'direkt', 'direkt', 'direkt', 'direkt'],
  };
  for (const stufe of [0, 1, 2, 3]) {
    assert.deepEqual(alle.map((m) => entscheide(stufe, m, EQ_A, KI, wert)), soll[stufe], `Stufe ${stufe}`);
  }
});

test('autonomie_1_eq: Stufe 1, EQ-Teil an Andreas hörbarem Deck wird Vorschlag', () => {
  assert.equal(entscheide(1, 'plan_einreichen', EQ_A, KI, wert), 'vorschlag');
});

test('Negativ-Kontrolle: Stufe 1, ausschließlich KI-Spur leiser, geht direkt', () => {
  assert.equal(entscheide(1, 'plan_einreichen', KI_LEISER, KI, wert), 'direkt');
  assert.equal(entscheide(1, 'plan_einreichen', plan([{ regler: 'deck/3/kill/tief', art: 'setze', ab_takt: 9, nach: 1 },
    { regler: 'erz/1/send/1', art: 'setze', ab_takt: 9, nach: -200 }]), KI, wert), 'direkt');
});

test('Grenzen der Ausnahme: lauter, fremder Kanal, EQ, gemischt, Rampe über den Ist-Wert hinaus', () => {
  const faelle: MenschenTeil[][] = [
    [{ regler: 'deck/3/fader', art: 'rampe', ab_takt: 9, dauer_takte: 2, nach: -3 }],            // lauter
    [{ regler: 'deck/1/fader', art: 'rampe', ab_takt: 9, dauer_takte: 2, nach: -20 }],           // nicht KI-Spur
    [{ regler: 'deck/3/eq/tief', art: 'setze', ab_takt: 9, nach: -30 }],                          // EQ steht nicht auf der Liste
    [{ regler: 'deck/3/fader', art: 'setze', ab_takt: 9, nach: -20 },
      { regler: 'deck/1/eq/hoch', art: 'setze', ab_takt: 9, nach: -6 }],                         // gemischt
    [{ regler: 'deck/3/fader', art: 'setze', ab_takt: 9, nach: -20 },
      { regler: 'deck/3/fader', art: 'setze', ab_takt: 10, nach: -10 }],                         // erst leiser, dann lauter
    [{ regler: 'deck/3/kill/tief', art: 'setze', ab_takt: 9, nach: 0 }],                          // Kill aus
  ];
  for (const f of faelle) assert.equal(entscheide(1, 'plan_einreichen', plan(f), KI, wert), 'vorschlag', JSON.stringify(f));
  assert.equal(nurKiSpurLeiser(plan([]), KI, wert), false);
  assert.equal(nurKiSpurLeiser(KI_LEISER, new Set(), wert), false); // ohne KI-Spur nie
});
