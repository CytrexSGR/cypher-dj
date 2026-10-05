// Autonomie-Positivliste SCHNITTSTELLEN §10 (ADR 013 Entscheidung 4 und 5), wörtlich und lückenlos: je Regel ein Test,
// der eine Verletzung abweist (oder bei einer Erlaubnis die Erlaubnis zeigt), und je Regel eine Mutante in
// pruef/mutation_positivliste.ts, die genau diesen Test rot macht. Die Kennung P<nn> im Testnamen ist der Schlüssel,
// über den die Mutationsprobe ihren Test findet; eine neue Regel braucht Test und Mutante.
//
// Befangen: diese Datei prüft meinen eigenen Spielraum. Darum prüft sie jede Richtung, in die er zu groß werden könnte.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { entscheide, METHODEN_10, mitAutonomie, nurKiSpurLeiser, torFuer } from '../src/autonomie.ts';
import { RpcFehler, type Methode } from '../src/hub.ts';
import { ausMenschenform, type MenschenTeil, type Plan, type Teil } from '../src/plan.ts';
import { REGLER } from '../src/regler_info.ts';
import { VERTRAG_ORDNER } from '../src/vertrag.ts';
import { anKern, annahme, welt } from './hilfen/welt.ts';

const KI = new Set(['deck/3', 'erz/1']);
const IST: Record<string, number> = { 'deck/3/fader': -6, 'deck/1/fader': 0, 'erz/1/send/1': -10 };
const wert = (p: string) => IST[p] ?? (REGLER.get(p)?.vorgabe as number);
const mensch = (teile: MenschenTeil[]) => ausMenschenform({ grund: 't', teile }, 'p1', 'cypher');
const kanonisch = (teile: Teil[]): Plan => ({
  id: '', quelle: 'cypher', spielart: null, wahl_id: null, einstieg_quell_beat: null, hoerscheine: [], grund: 't', teile,
});
const deckTeil = (aktion: 'hotcue' | 'sprung' | 'loop' | 'start', mehr: Record<string, number> = {}): Teil =>
  ({ nr: 0, art: 'deck', deck: 1, aktion, ab_beat: 80, politik: 0, gruppe: '', hoerschein: '', ...mehr }) as Teil;

const KI_LEISER: MenschenTeil[] = [{ regler: 'deck/3/fader', art: 'rampe', ab_takt: 9, dauer_takte: 2, nach: -20 }];
const EQ_A: MenschenTeil[] = [{ regler: 'deck/1/eq/hoch', art: 'setze', ab_takt: 17, nach: 6 }];

// Methoden-Tabelle wie im Leitstand (lage, plan_einreichen, plan_abbrechen gebaut; alles andere aus §10 noch nicht)
function tabelle(stufe: number, gestoppt = false) {
  const aufrufe: string[] = [];
  const m: Record<string, Methode> = {
    lage: () => { aufrufe.push('lage'); return {}; },
    plan_einreichen: () => { aufrufe.push('plan_einreichen'); return { status: 'vorgeschlagen' }; },
    plan_abbrechen: () => { aufrufe.push('plan_abbrechen'); return {}; },
  };
  return { t: mitAutonomie(m, () => stufe, () => gestoppt), aufrufe };
}
const code = (f: () => unknown): string => {
  try { f(); } catch (e) { return e instanceof RpcFehler ? e.code : `kein RpcFehler: ${(e as Error).message}`; }
  return 'kein Fehler';
};
const ruf = (t: Record<string, Methode>, name: string) => code(() => t[name]({}, {} as never));

// ---------- Stufe 0: „waehle, plan_einreichen, laden, vorhoeren, erzeuge werden abgelehnt (autonomie)“ ----------

test('P01 Stufe 0: waehle wird abgelehnt, Code autonomie', () => {
  assert.equal(entscheide(0, 'waehle', mensch(KI_LEISER), KI, wert), 'abgelehnt');
  assert.equal(ruf(tabelle(0).t, 'waehle'), 'autonomie');
});

test('P02 Stufe 0: plan_einreichen wird abgelehnt (autonomie), auch ein Plan, der nur die KI-Spur leiser macht', () => {
  const w = welt(); const a = annahme(w, 0);
  const e = a.einreichen({ grund: 'leiser', teile: KI_LEISER });
  assert.equal(e.status, 'abgelehnt');
  assert.deepEqual(e.gruende.map((g) => g.grund), ['autonomie']);
  assert.equal(anKern(w).length, 0);
});

test('P03 Stufe 0: laden wird abgelehnt, Code autonomie', () => {
  assert.equal(entscheide(0, 'laden', null, KI, wert), 'abgelehnt');
  assert.equal(ruf(tabelle(0).t, 'laden'), 'autonomie');
});

test('P04 Stufe 0: vorhoeren wird abgelehnt, Code autonomie', () => {
  assert.equal(entscheide(0, 'vorhoeren', null, KI, wert), 'abgelehnt');
  assert.equal(ruf(tabelle(0).t, 'vorhoeren'), 'autonomie');
});

test('P05 Stufe 0: erzeuge wird abgelehnt, Code autonomie', () => {
  assert.equal(entscheide(0, 'erzeuge', null, KI, wert), 'abgelehnt');
  assert.equal(ruf(tabelle(0).t, 'erzeuge'), 'autonomie');
});

test('P06 Stufe 0: lage, warte, bestand, passung, markieren gehen (Erlaubnis); gebaute laufen, ungebaute sind form', () => {
  const { t, aufrufe } = tabelle(0);
  for (const m of ['lage', 'warte', 'bestand', 'passung', 'markieren']) assert.equal(entscheide(0, m, null, KI, wert), 'direkt', m);
  assert.equal(ruf(t, 'lage'), 'kein Fehler');
  assert.deepEqual(aufrufe, ['lage']);
  for (const m of ['warte', 'bestand', 'passung', 'markieren']) assert.equal(ruf(t, m), 'form', m);
});

test('P07 Stufe 0: plan_abbrechen eigener Pläne geht (F11: Abbrechen macht leiser, nie lauter)', () => {
  assert.equal(entscheide(0, 'plan_abbrechen', null, KI, wert), 'direkt');
  const { t, aufrufe } = tabelle(0);
  assert.equal(ruf(t, 'plan_abbrechen'), 'kein Fehler');
  assert.deepEqual(aufrufe, ['plan_abbrechen']);
});

// ---------- Stufe 1: „jede Einreichung aus waehle oder plan_einreichen wird ein Vorschlag, gleich was ihre Teile tun“ ----------

test('P08 Stufe 1: EQ auf +6 dB an Andreas laufendem Deck wird Vorschlag, kein Befehl an den Kern (autonomie_1_eq)', () => {
  const w = welt(); const a = annahme(w, 1);
  assert.equal(a.einreichen({ grund: 'Höhen', teile: EQ_A }).status, 'vorgeschlagen');
  assert.equal(anKern(w).length, 0);
});

test('P09 Stufe 1: Stem auf 0 an Andreas laufendem Deck wird Vorschlag', () => {
  const w = welt(); const a = annahme(w, 1);
  assert.equal(a.einreichen({ grund: 'Bass', teile: [{ regler: 'deck/1/stem/bass', art: 'setze', ab_takt: 17, nach: 0 }] }).status, 'vorgeschlagen');
  assert.equal(anKern(w).length, 0);
});

test('P10 Stufe 1: Send an Andreas laufendem Deck wird Vorschlag', () => {
  const w = welt(); const a = annahme(w, 1);
  assert.equal(a.einreichen({ grund: 'Echo', teile: [{ regler: 'deck/1/send/1', art: 'setze', ab_takt: 17, nach: -10 }] }).status, 'vorgeschlagen');
  assert.equal(anKern(w).length, 0);
});

test('P11 Stufe 1: Hotcue, Sprung, Loop, Deck-Start an Andreas laufendem Deck werden Vorschlag', () => {
  for (const t of [deckTeil('hotcue', { hotcue_nr: 2 }), deckTeil('sprung', { delta_beats: 32 }), deckTeil('loop', { laenge_beats: 4 }),
    deckTeil('start', { quell_beat: 0 })]) {
    const w = welt(); const a = annahme(w, 1);
    const e = a.einreichenKanonisch('plan_einreichen', kanonisch([t]));
    assert.equal(e.status, 'vorgeschlagen', JSON.stringify(t));
    assert.equal(anKern(w).length, 0);
  }
});

test('P12 Stufe 1: waehle wird Vorschlag, nie direkt (Wahl startet ein Deck)', () => {
  assert.equal(entscheide(1, 'waehle', kanonisch([deckTeil('start', { quell_beat: 0 })]), KI, wert), 'vorschlag');
  assert.equal(ruf(tabelle(1).t, 'waehle'), 'form'); // Tor lässt durch, gebaut ist waehle erst in Scheibe 41
});

test('P13 Stufe 1: ein Vorschlag geht erst nach Andreas\' Annahme an den Kern, mit Quelle cypher', () => {
  const w = welt(); const a = annahme(w, 1);
  a.einreichen({ grund: 'Höhen', teile: EQ_A });
  assert.equal(anKern(w).length, 0);
  a.annehmen(20);
  assert.deepEqual(anKern(w).map((g) => g.felder.quelle), ['cypher']);
});

test('P14 Stufe 1: Deck-Teile eines angenommenen Vorschlags tragen hoerschein annahme:<vorschlag_id> (§4.4)', () => {
  const w = welt(); const a = annahme(w, 1);
  a.einreichenKanonisch('plan_einreichen', kanonisch([deckTeil('loop', { laenge_beats: 4 })]));
  const v = a.vorschlaege.alle()[0];
  a.annehmen(20);
  assert.deepEqual(anKern(w).map((g) => [g.adresse, g.felder.hoerschein]), [['/k/deck/loop', `annahme:${v.id}`]]);
});

// ---------- Stufe 1: „allein erlaubt sind nur laden, vorhoeren, erzeuge, plan_abbrechen eigener Pläne“ ----------

test('P15 Stufe 1: laden, vorhoeren, erzeuge gehen allein durch das Tor (Erlaubnis)', () => {
  for (const m of ['laden', 'vorhoeren', 'erzeuge']) {
    assert.equal(entscheide(1, m, null, KI, wert), 'direkt', m);
    assert.equal(ruf(tabelle(1).t, m), 'form', m); // durchgelassen; gebaut in 36 und 44
  }
});

test('P16 plan_abbrechen nur für eigene Pläne: ein Plan mit anderer Quelle wird mit autonomie abgelehnt', () => {
  const w = welt(); const a = annahme(w, 3);
  a.einreichen({ grund: 'Andreas', teile: EQ_A }, 'andreas');
  assert.equal(code(() => a.abbrechen('p1')), 'autonomie');
  assert.equal(w.gesendet.filter((g) => g.adresse === '/k/abbruch').length, 0);
  a.einreichen({ grund: 'Cypher', teile: KI_LEISER });
  assert.equal(code(() => a.abbrechen('p2')), 'kein Fehler'); // Negativ-Kontrolle: eigener Plan
});

test('P17 Stufe 1 und 2: spielzettel und Methoden außerhalb der Liste werden abgelehnt', () => {
  for (const s of [0, 1, 2]) {
    assert.equal(entscheide(s, 'spielzettel', null, KI, wert), 'abgelehnt', `Stufe ${s}`);
    assert.equal(entscheide(s, 'unbekannt', null, KI, wert), 'abgelehnt', `Stufe ${s}`);
    assert.equal(ruf(tabelle(s).t, 'spielzettel'), 'autonomie', `Stufe ${s}`);
  }
});

// ---------- Stufe 1: „ein Plan, dessen Teile ausschließlich Kanäle der KI-Spur leiser machen (Fader oder Send nach unten, Kill an)“ ----------

test('P18 Ausnahme leiser: Fader nach unten an der KI-Spur geht direkt an den Kern (Erlaubnis, Negativ-Kontrolle des Steckbriefs)', () => {
  const w = welt(); const a = annahme(w, 1);
  assert.equal(a.einreichen({ grund: 'leiser', teile: KI_LEISER }).status, 'angenommen');
  assert.deepEqual(anKern(w).map((g) => [g.felder.quelle, g.felder.pfad]), [['cypher', 'deck/3/fader']]);
});

test('P19 Ausnahme leiser: Send nach unten und Kill an an der KI-Spur gehen direkt (Erlaubnis)', () => {
  assert.equal(entscheide(1, 'plan_einreichen', mensch([{ regler: 'erz/1/send/1', art: 'setze', ab_takt: 9, nach: -200 }]), KI, wert), 'direkt');
  for (const k of ['tief', 'mitte', 'hoch']) {
    assert.equal(entscheide(1, 'plan_einreichen', mensch([{ regler: `deck/3/kill/${k}`, art: 'setze', ab_takt: 9, nach: 1 }]), KI, wert), 'direkt', k);
  }
});

test('P20 Ausnahme leiser: „ausschließlich KI-Spur“: ein Teil an einem anderen Kanal macht den Plan zum Vorschlag', () => {
  assert.equal(entscheide(1, 'plan_einreichen', mensch([...KI_LEISER,
    { regler: 'deck/1/fader', art: 'rampe', ab_takt: 9, dauer_takte: 2, nach: -20 }]), KI, wert), 'vorschlag');
  assert.equal(entscheide(1, 'plan_einreichen', mensch([{ regler: 'deck/1/fader', art: 'rampe', ab_takt: 9, dauer_takte: 2, nach: -20 }]), KI, wert), 'vorschlag');
});

test('P21 Ausnahme leiser: nur Fader, Send, Kill: EQ, Trim, Stem, Filter nach unten an der KI-Spur sind Vorschlag', () => {
  for (const [regler, nach] of [['deck/3/eq/tief', -30], ['deck/3/trim', -12], ['deck/3/stem/bass', -30], ['deck/3/filter', -0.5]] as Array<[string, number]>) {
    assert.equal(entscheide(1, 'plan_einreichen', mensch([{ regler, art: 'setze', ab_takt: 9, nach }]), KI, wert), 'vorschlag', regler);
  }
});

test('P22 Ausnahme leiser: „nach unten“: lauter und gleich laut sind Vorschlag', () => {
  assert.equal(entscheide(1, 'plan_einreichen', mensch([{ regler: 'deck/3/fader', art: 'setze', ab_takt: 9, nach: -3 }]), KI, wert), 'vorschlag');
  assert.equal(entscheide(1, 'plan_einreichen', mensch([{ regler: 'deck/3/fader', art: 'setze', ab_takt: 9, nach: -6 }]), KI, wert), 'vorschlag');
  assert.equal(entscheide(1, 'plan_einreichen', mensch([{ regler: 'erz/1/send/1', art: 'setze', ab_takt: 9, nach: -10 }]), KI, wert), 'vorschlag');
});

test('P23 Ausnahme leiser: „Kill an“: Kill aus an der KI-Spur ist Vorschlag', () => {
  assert.equal(entscheide(1, 'plan_einreichen', mensch([{ regler: 'deck/3/kill/tief', art: 'setze', ab_takt: 9, nach: 0 }]), KI, wert), 'vorschlag');
});

test('P24 Ausnahme leiser: innerhalb des Plans zählt der Wert vor jedem Teil: erst leiser, dann lauter ist Vorschlag', () => {
  assert.equal(entscheide(1, 'plan_einreichen', mensch([{ regler: 'deck/3/fader', art: 'setze', ab_takt: 9, nach: -20 },
    { regler: 'deck/3/fader', art: 'setze', ab_takt: 10, nach: -10 }]), KI, wert), 'vorschlag');
});

test('P25 Ausnahme leiser: Vergleich gegen das Leiseste aus Ist-Wert und angenommenen Plänen (F9)', () => {
  const w = welt(); const a = annahme(w, 1);
  assert.equal(a.einreichen({ grund: 'leiser', teile: [{ regler: 'deck/3/fader', art: 'rampe', ab_takt: 9, dauer_takte: 2, nach: -20 }] }).status, 'angenommen');
  assert.equal(a.einreichen({ grund: 'wieder lauter', teile: [{ regler: 'deck/3/fader', art: 'setze', ab_takt: 12, nach: -10 }] }).status, 'vorgeschlagen');
});

test('P26 Ausnahme leiser: nur Regler-Teile: ein Deck- oder Tempo-Teil an der KI-Spur macht den Plan zum Vorschlag', () => {
  const stopp = { nr: 1, art: 'deck', deck: 3, aktion: 'stopp', ab_beat: 40, politik: 1, gruppe: '', hoerschein: '' } as Teil;
  const leiser = { nr: 0, art: 'regler', pfad: 'deck/3/fader', ab_beat: 32, dauer_beats: 4, nach: -30, form: 0, politik: 0, gruppe: '', hoerschein: '' } as Teil;
  assert.equal(entscheide(1, 'plan_einreichen', kanonisch([leiser, stopp]), KI, wert), 'vorschlag');
  const tempo = { nr: 1, art: 'tempo', ab_beat: 40, ziel_bpm: 126, dauer_beats: 16 } as Teil;
  assert.equal(entscheide(1, 'plan_einreichen', kanonisch([leiser, tempo]), KI, wert), 'vorschlag');
});

test('P27 Ausnahme leiser: ein leerer Plan ist keine Ausnahme', () => {
  assert.equal(nurKiSpurLeiser(mensch([]), KI, wert), false);
  assert.equal(entscheide(1, 'plan_einreichen', mensch([]), KI, wert), 'vorschlag');
});

test('P28 Ausnahme leiser: ohne festgelegte KI-Spur gibt es keine Ausnahme', () => {
  assert.equal(entscheide(1, 'plan_einreichen', mensch(KI_LEISER), new Set(), wert), 'vorschlag');
});

// ---------- Stufe 2 (bis Scheibe 56 wie 1, strenger, nie lockerer) und Stufe 3 ----------

test('P29 Stufe 2 ist nicht lockerer als Stufe 1: KI-Spur lauter und EQ an Andreas Deck sind Vorschlag', () => {
  assert.equal(entscheide(2, 'plan_einreichen', mensch([{ regler: 'deck/3/fader', art: 'setze', ab_takt: 9, nach: 0 }]), KI, wert), 'vorschlag');
  assert.equal(entscheide(2, 'plan_einreichen', mensch(EQ_A), KI, wert), 'vorschlag');
  assert.equal(entscheide(2, 'plan_einreichen', mensch(KI_LEISER), KI, wert), 'direkt'); // Negativ-Kontrolle
});

test('P30 Stufe 3: alles direkt (Erlaubnis), Invarianten prüft weiter der Kern', () => {
  for (const m of METHODEN_10) assert.equal(entscheide(3, m, mensch(EQ_A), KI, wert), 'direkt', m);
  const w = welt(); const a = annahme(w, 3);
  assert.equal(a.einreichen({ grund: 'Höhen', teile: EQ_A }).status, 'angenommen');
});

// ---------- Stufe liegt in Andreas' Hand, Cypher-Stopp (ADR 013 Entscheidung 4 und 5) ----------

test('P31 Die Stufe setzt nur Andreas: die Methoden-Tabelle nimmt keine Methode außerhalb §10 an (etwa autonomie)', () => {
  assert.throws(() => mitAutonomie({ autonomie: () => ({}) }, () => 1, () => false), /§10/);
  assert.throws(() => mitAutonomie({ stufe: () => ({}) }, () => 1, () => false), /§10/);
  assert.doesNotThrow(() => mitAutonomie({ lage: () => ({}) }, () => 1, () => false)); // Negativ-Kontrolle
  // die Liste ist genau die des Vertrags (ws_daten.schema.json#/rpc methode)
  const ws = JSON.parse(fs.readFileSync(path.join(VERTRAG_ORDNER, 'schemas', 'ws_daten.schema.json'), 'utf8'));
  assert.deepEqual([...METHODEN_10].sort(), [...ws.$defs.rpc.properties.methode.enum].sort());
});

test('P32 Cypher-Stopp: jede Einreichung abgelehnt (ki_gestoppt), auch KI-Spur leiser; laden, vorhoeren, erzeuge ebenso', () => {
  const w = welt(); const a = annahme(w, 3);
  a.spiegel.aufnehmen({ adresse: '/e/ki', felder: { gestoppt: 1, sample: 0, beat: 19 } });
  const e = a.einreichen({ grund: 'leiser', teile: KI_LEISER });
  assert.equal(e.status, 'abgelehnt');
  assert.deepEqual([...new Set(e.gruende.map((g) => g.grund))], ['ki_gestoppt']);
  assert.equal(anKern(w).length, 0);
  for (const m of ['laden', 'vorhoeren', 'erzeuge']) assert.equal(ruf(tabelle(3, true).t, m), 'ki_gestoppt', m);
  assert.equal(ruf(tabelle(3, true).t, 'lage'), 'kein Fehler'); // Negativ-Kontrolle: Zuhören bleibt
});

test('P33 Das Tor meldet für eine Ablehnung einen Satz, der sagt, was geht', () => {
  const t = torFuer(0, 'laden', false);
  assert.ok(t && t.code === 'autonomie' && /nur zuhören/.test(t.text), JSON.stringify(t));
  assert.equal(torFuer(1, 'laden', false), null);
});
