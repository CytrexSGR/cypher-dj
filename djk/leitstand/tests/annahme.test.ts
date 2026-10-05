// Annahme ohne Prozess und ohne Netz: eine Attrappen-Umgebung sammelt, was an den Kern, an die Clients und ins Journal
// ginge. Deckt Vorschlag, Annahme und Verwerfen per Taste, Verfall am Beat, Kopplung in zwei Phasen, KI-Stopp, Stufe 0,
// Abgleich nach Kern-Neustart, Wiederaufnahme aus dem Journal und plan_abbrechen ab.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Felder } from '../src/adressen.ts';
import { Annahme, type Umgebung } from '../src/annahme.ts';
import { FormFehler, type MenschenPlan } from '../src/plan.ts';
import { H2, K1_PLAN } from './hilfen/faelle.ts';

interface Welt { u: Umgebung; beat: { jetzt: number }; gesendet: Array<{ adresse: string; felder: Felder }>;
  ereignisse: Array<{ art: string; daten: Record<string, unknown>; beat?: number }>; journal: Array<{ typ: string; von: string; daten: Record<string, unknown> }> }

function welt(): Welt {
  const w: Welt = { beat: { jetzt: 20 }, gesendet: [], ereignisse: [], journal: [], u: null as unknown as Umgebung };
  let id = 1000;
  w.u = {
    sende: (adresse, felder) => { w.gesendet.push({ adresse, felder }); w.journal.push({ typ: adresse, von: 'leitstand', daten: felder }); },
    ereignis: (art, daten, beat) => { w.ereignisse.push({ art, daten, beat }); },
    ansage: () => {},
    journal: (typ, daten) => { w.journal.push({ typ, von: 'leitstand', daten }); },
    jetztBeat: () => w.beat.jetzt, bpm: () => 128, kernBereit: () => true, neueId: () => ++id,
  };
  return w;
}

function annahme(w: Welt, stufe = 1, mutationen: string[] = []): Annahme {
  const a = new Annahme(w.u, { stufe, kiSpur: ['deck/3'], schwellen: { hoerbarDb: -26, tiefOffenDb: -12 }, maxStretcher: 4, mutationen });
  for (const [adresse, felder] of [
    ['/e/geladen', { deck: 1, material_id: 'f0000000000000a1', basis_bpm: 128, fassung: 1, mit_stems: 0, sample: 0 }],
    ['/e/geladen', { deck: 2, material_id: 'f0000000000000b2', basis_bpm: 128, fassung: 1, mit_stems: 0, sample: 0 }],
    ['/zustand/deck', { deck: 2, status: 2, material_id: 'f0000000000000b2', basis_bpm: 128, fassung: 1, quell_beat: 12,
      beats_bis_ende: 200, faktor: 1, vorlauf_ms: 0, hoerweg: 0, stretcher_fuell: -1, versatz_intern_ms: 0 }],
    ['/e/regler', { pfad: 'deck/1/fader', wert: 0, halter: 'frei', sample: 0, beat: 0 }],
    ['/e/regler', { pfad: 'deck/3/fader', wert: -6, halter: 'frei', sample: 0, beat: 0 }],
  ] as Array<[string, Felder]>) {
    a.spiegel.aufnehmen({ adresse, felder });
    w.journal.push({ typ: adresse, von: 'kern', daten: felder });
  }
  a.hoerschein(H2);
  w.journal.push({ typ: 'hoerschein', von: 'analyse', daten: { rolle: 'analyse', name: 't', daten: H2 } });
  return a;
}

const teile = (w: Welt, adresse = '/k/teil') => w.gesendet.filter((g) => g.adresse === adresse);
const q = (a: Annahme, w: Welt, id: number, status: number, grund = '', stand = false) => {
  const f = { id, quelle: 'cypher', status, ist_sample: 0, ist_beat: w.beat.jetzt, grund };
  a.quittung(f, stand);
  w.journal.push({ typ: stand ? '/q/stand' : '/q', von: 'kern', daten: f });
};
const EQ: MenschenPlan = { grund: 'Höhen von A zurück', teile: [{ regler: 'deck/1/eq/hoch', art: 'setze', ab_takt: 17, nach: -6 }] };

test('Stufe 1: Einreichung wird Vorschlag, kein /k/teil; LED blinkt, Vorschlag-Kanal gesetzt', () => {
  const w = welt(); const a = annahme(w);
  const e = a.einreichen(EQ);
  assert.equal(e.status, 'vorgeschlagen');
  assert.equal(teile(w).length, 0);
  assert.deepEqual(w.gesendet.filter((g) => g.adresse === '/k/led' && g.felder.name === 'vorschlag').map((g) => g.felder.zustand), [2]);
  assert.deepEqual(w.gesendet.filter((g) => g.adresse === '/k/vorschlag_kanal').map((g) => g.felder.kanal), ['deck/1']);
  const v = a.vorschlaege.alle()[0];
  assert.deepEqual([v.start_beat, v.verfaellt_beat], [64, 60]);
});

test('Negativ-Kontrolle: nur KI-Spur leiser geht auf Stufe 1 direkt an den Kern, Quelle cypher, Politik 1', () => {
  const w = welt(); const a = annahme(w);
  const e = a.einreichen({ grund: 'eigene Spur leiser', teile: [{ regler: 'deck/3/fader', art: 'rampe', ab_takt: 9, dauer_takte: 2, nach: -20 }] });
  assert.equal(e.status, 'angenommen');
  assert.deepEqual(teile(w).map((g) => [g.felder.quelle, g.felder.pfad, g.felder.politik]), [['cypher', 'deck/3/fader', 1]]);
});

test('Annahme per Taste vor dem Verfall: Teile gehen mit Quelle cypher an den Kern', () => {
  const w = welt(); const a = annahme(w);
  a.einreichen(EQ);
  w.beat.jetzt = 59.99;
  a.annehmen(59.99);
  assert.deepEqual(teile(w).map((g) => [g.felder.quelle, g.felder.pfad, g.felder.ab_beat]), [['cypher', 'deck/1/eq/hoch', 64]]);
  assert.ok(w.ereignisse.some((x) => x.art === 'vorschlag_angenommen'));
});

test('Verfall genau 1 Takt vor dem Start: Ereignis mit verfaellt_beat, danach nimmt die Taste nichts mehr an', () => {
  const w = welt(); const a = annahme(w);
  a.einreichen(EQ);
  a.tick(59.9);
  assert.equal(w.ereignisse.filter((x) => x.art === 'vorschlag_verfallen').length, 0);
  a.tick(60.003);
  const v = w.ereignisse.filter((x) => x.art === 'vorschlag_verfallen');
  assert.equal(v.length, 1);
  assert.equal(v[0].beat, 60);
  assert.equal(v[0].daten.verfaellt_beat, 60);
  a.annehmen(60.1);
  assert.equal(teile(w).length, 0);
});

test('Taste genau am Verfall-Beat nimmt nicht an (b < verfaellt_beat)', () => {
  const w = welt(); const a = annahme(w);
  a.einreichen(EQ);
  a.annehmen(60);
  assert.equal(teile(w).length, 0);
});

test('Taste verwerfen: der früheste offene Vorschlag fällt, nichts geht an den Kern; ohne Vorschlag passiert nichts', () => {
  const w = welt(); const a = annahme(w);
  a.einreichen(EQ);
  a.einreichen({ grund: 'später', teile: [{ regler: 'deck/1/eq/mitte', art: 'setze', ab_takt: 25, nach: -6 }] });
  a.verwerfen(30);
  assert.deepEqual(w.ereignisse.filter((x) => x.art === 'vorschlag_verworfen').map((x) => [x.daten.plan_id, x.daten.grund]), [['p1', 'andreas']]);
  assert.deepEqual(a.vorschlaege.alle().map((v) => v.plan_id), ['p2']);
  assert.equal(teile(w).length, 0);
  a.verwerfen(30); a.verwerfen(30);                        // p2, dann nichts mehr
  assert.equal(w.ereignisse.filter((x) => x.art === 'vorschlag_verworfen').length, 2);
  assert.deepEqual(w.gesendet.filter((g) => g.adresse === '/k/led' && g.felder.name === 'vorschlag').map((g) => g.felder.zustand), [2, 0]);
});

test('Kopplung in zwei Phasen: a_raus erst nach dem Start des öffnenden b_rein-Teils', () => {
  const w = welt(); const a = annahme(w, 3);
  const e = a.einreichen(K1_PLAN);
  assert.equal(e.status, 'angenommen');
  assert.deepEqual(teile(w).map((g) => [g.felder.teil, g.felder.gruppe]),
    [[0, 'b_rein'], [1, 'b_rein'], [2, 'b_rein'], [3, 'basstausch'], [4, 'basstausch']]);
  const fader = teile(w).find((g) => g.felder.teil === 1)!;
  q(a, w, fader.felder.id as number, 2);
  assert.deepEqual(teile(w).slice(5).map((g) => [g.felder.teil, g.felder.gruppe, g.felder.politik]), [[5, 'a_raus', 1]]);
});

test('B verriegelt am Start: A raus entfällt, der Basstausch wird abgebrochen', () => {
  const w = welt(); const a = annahme(w, 3);
  a.einreichen(K1_PLAN);
  const fader = teile(w).find((g) => g.felder.teil === 1)!;
  q(a, w, fader.felder.id as number, 6, 'kein_hoerschein');
  assert.equal(teile(w).length, 5); // a_raus nie gesendet
  assert.deepEqual(w.gesendet.filter((g) => g.adresse === '/k/abbruch').map((g) => [g.felder.quelle, g.felder.teile]), [['leitstand', '3,4']]);
  assert.ok(w.ereignisse.some((x) => x.art === 'teil_abgebrochen' && x.daten.teil === 5 && x.daten.grund === 'kein_hoerschein'));
});

test('KI-Stopp: Einreichung abgelehnt mit ki_gestoppt, offene Vorschläge verworfen', () => {
  const w = welt(); const a = annahme(w);
  a.einreichen(EQ);
  a.spiegel.aufnehmen({ adresse: '/e/ki', felder: { gestoppt: 1, grund: 'taste', sample: 0 } });
  a.kiStopp(true, 21);
  assert.ok(w.ereignisse.some((x) => x.art === 'vorschlag_verworfen' && x.daten.grund === 'ki_stopp'));
  const e = a.einreichen(EQ);
  assert.deepEqual([e.status, e.gruende[0].grund], ['abgelehnt', 'ki_gestoppt']);
});

test('Stufe 0: plan_einreichen abgelehnt mit autonomie; Formfehler wirft', () => {
  const w = welt(); const a = annahme(w, 0);
  const e = a.einreichen(EQ);
  assert.deepEqual([e.status, e.gruende[0].grund], ['abgelehnt', 'autonomie']);
  assert.throws(() => a.einreichen({ grund: 'x', teile: [{ regler: 'deck/1/fader', art: 'rampe', ab_takt: 17, nach: -6 }] }), FormFehler);
});

test('Abgleich nach Kern-Neustart: bestätigt läuft weiter, ohne /q/stand verloren (Grund neustart)', () => {
  const w = welt(); const a = annahme(w, 3);
  a.einreichen(K1_PLAN);
  const [t0, t1] = teile(w);
  q(a, w, t0.felder.id as number, 2); q(a, w, t1.felder.id as number, 2);
  a.abgleichBeginnen('kern_neustart');
  q(a, w, t1.felder.id as number, 2, '', true);
  a.abgleichSchliessen();
  const st = a.plaene.get('p1')!.teile;
  assert.equal(st.get(1)!.status, 'gestartet');
  assert.deepEqual([st.get(0)!.status, st.get(0)!.grund], ['abgebrochen', 'neustart']);
  const j = w.journal.filter((z) => z.typ === 'abgleich');
  assert.equal(j[0].daten.q_stand, 1);
});

test('Wiederaufnahme: ein neuer Leitstand übernimmt Pläne, Teile und Kennungen aus dem Journal', () => {
  const w = welt(); const a = annahme(w, 3);
  a.einreichen(K1_PLAN);
  const fader = teile(w).find((g) => g.felder.teil === 1)!;
  q(a, w, fader.felder.id as number, 2);
  const w2 = welt(); const b = new Annahme(w2.u, { stufe: 1, kiSpur: [], schwellen: { hoerbarDb: -26, tiefOffenDb: -12 }, maxStretcher: 4, mutationen: [] });
  assert.equal(b.wiederaufnehmen(w.journal), 1);
  assert.equal(b.stufe, 1);
  assert.equal(b.plaene.get('p1')!.teile.get(1)!.status, 'gestartet');
  assert.equal(b.plaene.get('p1')!.teile.get(5)!.status, 'gesendet'); // a_raus war nach dem Start von B gesendet
  assert.equal(w2.gesendet.length, 0);                                 // Nachspielen sendet nichts
  b.quittung({ id: fader.felder.id as number, quelle: 'cypher', status: 3, ist_sample: 0, ist_beat: 96, grund: '' }, false);
  assert.equal(b.plaene.get('p1')!.teile.get(1)!.status, 'fertig');     // spätere Quittungen treffen den übernommenen Teil
  const c = new Annahme(welt().u, { stufe: 1, kiSpur: [], schwellen: { hoerbarDb: -26, tiefOffenDb: -12 }, maxStretcher: 4, mutationen: ['wiederaufnahme_aus'] });
  assert.equal(c.wiederaufnehmen(w.journal), 0);                         // Mutation: der Fehlerfall vorher
  assert.equal(c.plaene.size, 0);
});

test('plan_abbrechen: eigener Plan per /k/abbruch mit Quelle cypher; fremder Plan ist ein Formfehler', () => {
  const w = welt(); const a = annahme(w, 3);
  a.einreichen(K1_PLAN);
  const r = a.abbrechen('p1', [2]);
  assert.equal(r.plan_id, 'p1');
  assert.deepEqual(w.gesendet.filter((g) => g.adresse === '/k/abbruch').map((g) => [g.felder.quelle, g.felder.teile]), [['cypher', '2']]);
  assert.throws(() => a.abbrechen('p99'), FormFehler);
});

test('Positivliste: leiser zählt gegen das Leiseste, was angenommene Pläne am Regler schon vorhaben', () => {
  // gefunden 2026-09-23 mit pruef/folgen/ki_spur_leiser.jsonl: nach „deck/3 auf −20“ ging „deck/3 auf −3“ direkt durch,
  // weil −3 unter dem Ist-Wert 0 dB bei der Einreichung lag, aber über den −20, auf denen der Regler dann steht
  const w = welt(); const a = annahme(w);
  a.spiegel.aufnehmen({ adresse: '/e/regler', felder: { pfad: 'deck/3/fader', wert: 0, halter: 'frei', sample: 0, beat: 19 } });
  const e1 = a.einreichen({ grund: 'leiser', teile: [{ regler: 'deck/3/fader', art: 'rampe', ab_takt: 9, dauer_takte: 2, nach: -20 }] });
  assert.equal(e1.status, 'angenommen');
  const e2 = a.einreichen({ grund: 'lauter', teile: [{ regler: 'deck/3/fader', art: 'setze', ab_takt: 12, nach: -3 }] });
  assert.equal(e2.status, 'vorgeschlagen');
  const e3 = a.einreichen({ grund: 'noch leiser', teile: [{ regler: 'deck/3/fader', art: 'setze', ab_takt: 13, nach: -30 }] });
  assert.equal(e3.status, 'angenommen'); // Negativ-Kontrolle: unter −20 bleibt es leiser
});

test('Kern kennt /k/led nicht: nach unbekannte_adresse keine LED mehr, /k/teil und /k/vorschlag_kanal weiter; Neustart hebt auf', () => {
  const w = welt(); const a = annahme(w);
  a.kernUnbekannt('/k/led');
  a.kernUnbekannt('/k/teil');   // Negativ-Kontrolle: keine reine Anzeige, wird nie verschluckt
  const ab = w.gesendet.length;  // LEDs vom Aufbau (vor der Ablehnung) zählen nicht
  const danach = () => w.gesendet.slice(ab);
  a.einreichen(EQ);
  assert.equal(danach().filter((g) => g.adresse === '/k/led').length, 0);
  assert.deepEqual(danach().filter((g) => g.adresse === '/k/vorschlag_kanal').map((g) => g.felder.kanal), ['deck/1']);
  a.annehmen(56);
  assert.ok(teile(w).length > 0, '/k/teil geht trotz kernUnbekannt weiter');
  const ab2 = w.gesendet.length;
  a.kernNeu();
  const e2 = a.einreichen({ grund: 'Mitten von A', teile: [{ regler: 'deck/1/eq/mitte', art: 'setze', ab_takt: 25, nach: -6 }] });
  assert.equal(e2.status, 'vorgeschlagen');
  assert.ok(w.gesendet.slice(ab2).some((g) => g.adresse === '/k/led'), 'nach Kern-Neustart gehen LEDs wieder raus');
});
