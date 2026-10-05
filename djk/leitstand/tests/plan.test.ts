// Planform §14.1 und Menschenform §10: Umrechnung Takt → Beat, Formfehler, Hörschein an die öffnenden Teile, OSC je Teil
// mit den Feldnamen aus djk/vertrag/osc_adressen.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ADRESSEN, baue, liesUndDekodiere } from '../src/adressen.ts';
import { ausMenschenform, FormFehler, geordnet, oscFuer, setzeHoerschein, type Plan, type Teil } from '../src/plan.ts';
import { REGLER } from '../src/regler_info.ts';

test('§10: ab_beat = (ab_takt − 1)·4 + (ab_schlag − 1), dauer_beats = dauer_takte·4, setze hat Dauer 0', () => {
  const p = ausMenschenform({ grund: 'g', teile: [
    { regler: 'deck/2/fader', art: 'rampe', ab_takt: 113, dauer_takte: 8, nach: 0 },
    { regler: 'deck/1/eq/tief', art: 'setze', ab_takt: 17, ab_schlag: 3, nach: -30 }] }, 'p7', 'cypher');
  assert.deepEqual(p.teile.map((t) => (t.art === 'regler' ? [t.nr, t.ab_beat, t.dauer_beats] : [])), [[0, 448, 32], [1, 66, 0]]);
  assert.deepEqual([p.id, p.quelle, p.spielart, p.wahl_id, p.hoerscheine], ['p7', 'cypher', null, null, []]);
});

test('Formfehler: rampe ohne Dauer, setze mit Dauer', () => {
  assert.throws(() => ausMenschenform({ grund: 'g', teile: [{ regler: 'deck/1/fader', art: 'rampe', ab_takt: 2, nach: -6 }] }, 'p1', 'cypher'), FormFehler);
  assert.throws(() => ausMenschenform({ grund: 'g', teile: [{ regler: 'deck/1/fader', art: 'setze', ab_takt: 2, dauer_takte: 1, nach: -6 }] }, 'p1', 'cypher'), FormFehler);
});

test('Plan-Hörschein nur an Fader- und Trim-Teile, die nach oben gehen (§14.1 Teile 2 und 3)', () => {
  const p = ausMenschenform({ grund: 'g', hoerschein: 'h12', teile: [
    { regler: 'deck/2/eq/tief', art: 'setze', ab_takt: 113, nach: -30 },
    { regler: 'deck/2/fader', art: 'setze', ab_takt: 113, nach: -15 },
    { regler: 'deck/2/fader', art: 'rampe', ab_takt: 113, dauer_takte: 8, nach: 0 },
    { regler: 'deck/1/fader', art: 'rampe', ab_takt: 124, dauer_takte: 4, nach: -40 }] }, 'p1', 'cypher');
  setzeHoerschein(p, 'h12', (x) => (x === 'deck/1/fader' ? 0 : REGLER.get(x)!.vorgabe));
  assert.deepEqual(p.teile.map((t) => (t.art === 'regler' ? t.hoerschein : '?')), ['', 'h12', 'h12', '']);
});

test('OSC je Teil: Regler, Deck (mit annahme:), Tempo; jede Nachricht baut und liest nach dem Vertrag', () => {
  const plan: Plan = { id: 'p3', quelle: 'cypher', spielart: null, wahl_id: null, einstieg_quell_beat: 64, hoerscheine: [], grund: 'g', teile: [] };
  const teile: Teil[] = [
    { nr: 0, art: 'deck', deck: 2, aktion: 'start', ab_beat: 448, quell_beat: 64, politik: 0, gruppe: 'b_rein', hoerschein: '' },
    { nr: 1, art: 'regler', pfad: 'deck/2/fader', ab_beat: 448, dauer_beats: 32, nach: 0, form: 0, politik: 0, gruppe: 'b_rein', hoerschein: 'h12' },
    { nr: 2, art: 'deck', deck: 1, aktion: 'stopp', ab_beat: 512, politik: 1, gruppe: 'a_raus', hoerschein: '' },
    { nr: 3, art: 'deck', deck: 1, aktion: 'loop', ab_beat: 500, laenge_beats: 4, politik: 0, gruppe: '', hoerschein: '' },
    { nr: 4, art: 'deck', deck: 1, aktion: 'roll', ab_beat: 500, laenge_beats: 0.5, roll_art: 0, politik: 0, gruppe: '', hoerschein: '' },
    { nr: 5, art: 'deck', deck: 1, aktion: 'sprung', ab_beat: 500, delta_beats: 16, politik: 0, gruppe: '', hoerschein: '' },
    { nr: 6, art: 'deck', deck: 1, aktion: 'hotcue', ab_beat: 500, hotcue_nr: 3, politik: 0, gruppe: '', hoerschein: '' },
    { nr: 7, art: 'tempo', ab_beat: 520, ziel_bpm: 130, dauer_beats: 8 },
  ];
  const o = teile.map((t, i) => oscFuer(plan, t, 1000 + i, 'cypher', 'annahme:v5'));
  assert.deepEqual(o.map((x) => x.adresse), ['/k/deck/start', '/k/teil', '/k/deck/stopp', '/k/deck/loop', '/k/deck/roll',
    '/k/deck/sprung', '/k/deck/hotcue', '/k/tempo/rampe']);
  for (const x of o) assert.deepEqual(liesUndDekodiere(baue(x.adresse, x.felder)).felder, Object.fromEntries(ADRESSEN[x.adresse].felder.map((f) => [f, x.felder[f]])));
  assert.equal(o[0].felder.hoerschein, 'annahme:v5');  // Deck-Teil eines angenommenen Vorschlags (§4.4)
  assert.equal(o[1].felder.hoerschein, 'h12');         // Regler-Teil behält seinen Hörschein
  assert.equal(o[6].felder.nr, 3);
});

test('geordnet: nach ab_beat, am selben Beat nach Teil-Nummer', () => {
  const t = (nr: number, ab: number): Teil => ({ nr, art: 'regler', pfad: 'deck/1/fader', ab_beat: ab, dauer_beats: 0, nach: 0, form: 0, politik: 0, gruppe: '', hoerschein: '' });
  assert.deepEqual(geordnet([t(2, 8), t(0, 8), t(1, 4)]).map((x) => x.nr), [1, 0, 2]);
});
