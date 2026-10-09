// Vorprüfung beim Annehmen: je Verriegelungsgrund aus §16.2 (Leitstand) ein Fall mit genau diesem Code, dazu die
// Negativ-Kontrollen (gültiger Plan, Leisermachen ohne Hörschein, Sprung als Vorschlag).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Dekodiert } from '../src/adressen.ts';
import { HoerscheinRegister, type Hoerschein } from '../src/hoerscheine.ts';
import { B2, H2 } from './hilfen/faelle.ts';
import { ausMenschenform, type MenschenTeil, type Plan, type Teil } from '../src/plan.ts';
import { Spiegel } from '../src/spiegel.ts';
import { pruefe, type Pruefumgebung } from '../src/verriegelung.ts';

const JETZT = 20; // Beat
function umgebung(extra: Partial<Pruefumgebung> = {}, meldungen: Dekodiert[] = [], hs: Hoerschein[] = [H2]): Pruefumgebung {
  const spiegel = new Spiegel(() => JETZT);
  const std: Dekodiert[] = [
    { adresse: '/e/geladen', felder: { deck: 2, material_id: B2, basis_bpm: 128, fassung: 1, mit_stems: 0, sample: 0 } },
    { adresse: '/zustand/deck', felder: { deck: 2, status: 2, material_id: B2, basis_bpm: 128, fassung: 1, quell_beat: 12,
      beats_bis_ende: 200, faktor: 1, vorlauf_ms: 0, hoerweg: 0, stretcher_fuell: -1, versatz_intern_ms: 0,
      keylock_unterlauf: 0, keylock_aufgegeben: 0 } },
    { adresse: '/e/geladen', felder: { deck: 1, material_id: 'f0000000000000a1', basis_bpm: 128, fassung: 1, mit_stems: 0, sample: 0 } },
    { adresse: '/e/regler', felder: { pfad: 'deck/1/fader', wert: 0, halter: 'frei', sample: 0, beat: 0 } },
  ];
  for (const d of [...std, ...meldungen]) spiegel.aufnehmen(d);
  const hoerscheine = new HoerscheinRegister();
  for (const h of hs) hoerscheine.aufnehmen(h);
  return { jetztBeat: JETZT, bpm: 128, spiegel, hoerscheine, schwellen: { hoerbarDb: -26, tiefOffenDb: -12 },
    maxStretcher: 4, angenommen: [], wirdVorschlag: false, ...extra };
}
const plan = (teile: MenschenTeil[], hs = 'h2'): Plan => {
  const p = ausMenschenform({ grund: 't', hoerschein: hs, teile }, 'p1', 'cypher');
  for (const t of p.teile) if (t.art === 'regler' && /deck\/2\/(fader|trim)$/.test(t.pfad)) t.hoerschein = hs;
  return p;
};
const B_REIN: MenschenTeil[] = [
  { regler: 'deck/2/fader', art: 'setze', ab_takt: 9, nach: -15 },
  { regler: 'deck/2/fader', art: 'rampe', ab_takt: 9, dauer_takte: 8, nach: 0 },
];
const codes = (p: Plan, u: Pruefumgebung) => pruefe(p, u).map((g) => g.grund);

test('Negativ-Kontrollen: gültiger Plan, Leiser ohne Hörschein', () => {
  assert.deepEqual(codes(plan(B_REIN), umgebung()), []);
  assert.deepEqual(codes(plan([{ regler: 'deck/1/fader', art: 'rampe', ab_takt: 9, dauer_takte: 4, nach: -40 }], ''), umgebung()), []);
});

test('Keylock 3: Teil keylock 0 (cypher) wird angenommen, deck/1/keylock nicht; der Spiegel übernimmt /e/regler keylock', () => {
  assert.deepEqual(codes(plan([{ regler: 'keylock', art: 'setze', ab_takt: 9, nach: 0 }], ''), umgebung()), []);
  assert.deepEqual(codes(plan([{ regler: 'deck/1/keylock', art: 'setze', ab_takt: 9, nach: 0 }], ''), umgebung()), ['unbekannter_regler']);
  const u = umgebung({}, [{ adresse: '/e/regler', felder: { pfad: 'keylock', wert: 0, halter: 'frei', sample: 0, beat: 0 } }]);
  assert.equal(u.spiegel.wert('keylock'), 0);
});

test('Form an Teilen: unbekannter Regler, nur Hand, außerhalb des Bereichs', () => {
  assert.deepEqual(codes(plan([{ regler: 'deck/9/fader', art: 'setze', ab_takt: 9, nach: -6 }]), umgebung()), ['unbekannter_regler']);
  assert.deepEqual(codes(plan([{ regler: 'xfader', art: 'setze', ab_takt: 9, nach: 0.5 }]), umgebung()), ['nur_hand']);
  assert.deepEqual(codes(plan([{ regler: 'deck/1/eq/tief', art: 'setze', ab_takt: 9, nach: 9 }]), umgebung()), ['ausserhalb_bereich']);
});

test('zu_spaet mit fruehestens_beat', () => {
  const g = pruefe(plan([{ regler: 'deck/1/eq/hoch', art: 'setze', ab_takt: 6, nach: -6 }]), umgebung()); // Beat 20 = jetzt
  assert.deepEqual(g, [{ teil: 0, grund: 'zu_spaet', fruehestens_beat: 21 }]);
});

test('regler_beim_menschen und deck_beruehrt', () => {
  const mensch = [{ adresse: '/e/halter', felder: { pfad: 'deck/1/eq/tief', halter: 'mensch', sample: 0, beat: 19 } }];
  assert.deepEqual(codes(plan([{ regler: 'deck/1/eq/tief', art: 'setze', ab_takt: 9, nach: -30 }]), umgebung({}, mensch)),
    ['regler_beim_menschen']);
  const transport = [{ adresse: '/e/halter', felder: { pfad: 'deck/1/transport', halter: 'mensch', sample: 0, beat: 19 } }];
  const p = plan([]);
  p.teile = [{ nr: 0, art: 'deck', deck: 1, aktion: 'loop', ab_beat: 32, laenge_beats: 4, politik: 0, gruppe: '', hoerschein: '' }];
  assert.deepEqual(codes(p, umgebung({}, transport)), ['deck_beruehrt']);
});

test('ueberlappung im Plan, regler_verplant gegen einen angenommenen Plan', () => {
  assert.deepEqual(codes(plan([{ regler: 'deck/1/eq/hoch', art: 'rampe', ab_takt: 9, dauer_takte: 4, nach: -20 },
    { regler: 'deck/1/eq/hoch', art: 'rampe', ab_takt: 11, dauer_takte: 4, nach: -30 }]), umgebung()), ['ueberlappung', 'ueberlappung']);
  const alt: Teil = { nr: 0, art: 'regler', pfad: 'deck/1/eq/hoch', ab_beat: 30, dauer_beats: 8, nach: -6, form: 0, politik: 0, gruppe: '', hoerschein: '' };
  assert.deepEqual(codes(plan([{ regler: 'deck/1/eq/hoch', art: 'setze', ab_takt: 9, nach: -10 }]),
    umgebung({ angenommen: [{ plan: 'p0', teil: alt }] })), ['regler_verplant']);
});

test('Hörschein: je Code ein Fall (I3a im Leitstand)', () => {
  const mit = (h: Partial<Hoerschein>) => umgebung({}, [], [{ ...H2, ...h }]);
  // nur das Setzen auf −15 öffnet; die Rampe danach beginnt am offenen Kanal und braucht keinen
  assert.deepEqual(codes(plan(B_REIN, ''), umgebung()), ['kein_hoerschein']);
  assert.deepEqual(codes(plan(B_REIN, 'h9'), umgebung()), ['kein_hoerschein']);
  assert.deepEqual(codes(plan(B_REIN), mit({ kanal: 'deck/3' })).slice(0, 1), ['hoerschein_anderer_kanal']);
  assert.deepEqual(codes(plan(B_REIN), mit({ urteil: 'nicht_sync' })).slice(0, 1), ['hoerschein_nicht_sync']);
  assert.deepEqual(codes(plan(B_REIN), mit({ urteil: 'zu_laut' })).slice(0, 1), ['hoerschein_pegel']);
  assert.deepEqual(codes(plan(B_REIN), mit({ inhalt: `${B2}/128000_r2` })).slice(0, 1), ['hoerschein_anderer_inhalt']);
  assert.deepEqual(codes(plan(B_REIN), mit({ bpm: 130 })).slice(0, 1), ['hoerschein_anderes_tempo']);
  assert.deepEqual(codes(plan(B_REIN), mit({ gueltig_bis_beat: 19 })).slice(0, 1), ['hoerschein_abgelaufen']);
  assert.deepEqual(codes(plan(B_REIN), mit({ quell_von: 100, quell_bis: 150 })).slice(0, 1), ['hoerschein_anderer_abschnitt']);
});

test('ziel_ungehoert: Cyphers Sprung auf offenem Deck ohne gemessenes Ziel; als Vorschlag frei', () => {
  const offen = [{ adresse: '/e/regler', felder: { pfad: 'deck/2/fader', wert: 0, halter: 'frei', sample: 0, beat: 19 } }];
  const p = plan([]);
  p.teile = [{ nr: 0, art: 'deck', deck: 2, aktion: 'sprung', ab_beat: 32, delta_beats: 256, politik: 0, gruppe: '', hoerschein: '' }];
  assert.deepEqual(codes(p, umgebung({}, offen)), ['ziel_ungehoert']);
  assert.deepEqual(codes(p, umgebung({ wirdVorschlag: true }, offen)), []);
  p.teile[0] = { ...p.teile[0], delta_beats: 16 } as Teil;                       // Ziel 40 liegt im gemessenen Bereich
  assert.deepEqual(codes(p, umgebung({}, offen)), []);
});

test('budget_stretcher: Tempo-Rampe braucht mehr Stretcher als max_stretcher', () => {
  const p = plan([]);
  p.teile = [{ nr: 0, art: 'tempo', ab_beat: 32, ziel_bpm: 130, dauer_beats: 8 }];
  assert.deepEqual(codes(p, umgebung({ maxStretcher: 1 })), ['budget_stretcher']); // Deck 1 und 2 geladen
  assert.deepEqual(codes(p, umgebung({ maxStretcher: 4 })), []);
});
