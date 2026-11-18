// Audit U29 repro: after a kern restart that lost the b_rein part, the a_raus part waiting for it must not wait forever.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Felder } from '../src/addresses.ts';
import { Annahme, type Umgebung } from '../src/intake.ts';
import { H2, K1_PLAN } from './support/cases.ts';

test('audit U29: kern restart without /q/stand for b_rein turns the waiting a_raus part into entfallen and ends the plan', () => {
  const gesendet: Array<{ adresse: string; felder: Felder }> = [];
  const ereignisse: Array<{ art: string; daten: Record<string, unknown> }> = [];
  let id = 1000;
  const u: Umgebung = {
    sende: (adresse, felder) => { gesendet.push({ adresse, felder }); },
    ereignis: (art, daten) => { ereignisse.push({ art, daten }); },
    ansage: () => {}, journal: () => {}, jetztBeat: () => 20, bpm: () => 128, kernBereit: () => true, neueId: () => ++id,
  };
  const a = new Annahme(u, { stufe: 3, kiSpur: ['deck/3'], schwellen: { hoerbarDb: -26, tiefOffenDb: -12 }, maxStretcher: 4, mutationen: [] });
  for (const [adresse, felder] of [
    ['/e/geladen', { deck: 1, material_id: 'f0000000000000a1', basis_bpm: 128, fassung: 1, mit_stems: 0, sample: 0 }],
    ['/e/geladen', { deck: 2, material_id: 'f0000000000000b2', basis_bpm: 128, fassung: 1, mit_stems: 0, sample: 0 }],
    ['/zustand/deck', { deck: 2, status: 2, material_id: 'f0000000000000b2', basis_bpm: 128, fassung: 1, quell_beat: 12,
      beats_bis_ende: 200, faktor: 1, vorlauf_ms: 0, hoerweg: 0, stretcher_fuell: -1, versatz_intern_ms: 0,
      keylock_unterlauf: 0, keylock_aufgegeben: 0 }],
    ['/e/regler', { pfad: 'deck/1/fader', wert: 0, halter: 'frei', sample: 0, beat: 0 }],
    ['/e/regler', { pfad: 'deck/3/fader', wert: -6, halter: 'frei', sample: 0, beat: 0 }],
  ] as Array<[string, Felder]>) a.spiegel.aufnehmen({ adresse, felder });
  a.hoerschein(H2);
  a.einreichen(K1_PLAN);
  const ps = a.plaene.get('p1')!;
  assert.equal(ps.teile.get(5)!.status, 'wartet_auf_b');   // a_raus waits for b_rein
  // the kern dies before it has started anything; the new generation sends no /q/stand
  a.abgleichBeginnen('kern_neustart');
  a.abgleichSchliessen();
  assert.equal(ps.teile.get(1)!.status, 'abgebrochen');
  assert.equal(ps.teile.get(5)!.status, 'entfallen');
  assert.equal(ps.status, 'abgebrochen');
  assert.ok(ereignisse.some((e) => e.art === 'teil_abgebrochen' && e.daten.teil === 5));
});
