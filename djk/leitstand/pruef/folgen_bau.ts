// Erzeugt die Folgen der Scheibe 21 unter pruef/folgen/ (Format djk/vertrag/folgen/FORMAT.md, dazu ws_sende mit
// verbindung und die aktion-Werte leitstand_kill9, leitstand_start des Läufers pruef/laeufer.ts). Samples werden aus
// Beats gerechnet (128 BPM konstant: 22 500 Samples je Beat, §1.3), nie abgeschrieben.
// Aufruf: node pruef/folgen_bau.ts   (schreibt alle Dateien neu und nennt sie)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MenschenPlan } from '../src/plan.ts';

const ZIEL = path.join(path.dirname(fileURLToPath(import.meta.url)), 'folgen');
const S = (beat: number) => Math.round(beat * 22500);
type Z = Record<string, unknown>;

const sende = (beat: number, osc: unknown[], herleitung = ''): Z => ({ t: 'sende', sample: S(beat), osc, ...(herleitung ? { herleitung } : {}) });
const erwarte = (ab: number, bis: number, osc: unknown[], herleitung = '', toleranz?: number): Z =>
  ({ t: 'erwarte', ab_sample: S(ab), bis_sample: S(bis), osc, ...(toleranz !== undefined ? { toleranz } : {}), ...(herleitung ? { herleitung } : {}) });
const nicht = (ab: number, bis: number, osc: unknown[], herleitung = ''): Z => ({ t: 'erwarte_nicht', ab_sample: S(ab), bis_sample: S(bis), osc, herleitung });
const erlaube = (ab: number, bis: number, osc: unknown[], herleitung: string): Z => ({ t: 'erlaube', ab_sample: S(ab), bis_sample: S(bis), osc, herleitung });
const hand = (beat: number, pfad: string, x: number): Z => ({ t: 'hand', sample: S(beat), pfad, midi_roh: x });
const ws = (beat: number, verbindung: string, typ: string, daten: Z): Z => ({ t: 'ws_sende', sample: S(beat), verbindung, typ, daten });
const wsErw = (ab: number, bis: number, typ: string, daten: Z, herleitung = ''): Z => ({ t: 'ws_erwarte', ab_sample: S(ab), bis_sample: S(bis), typ, daten, herleitung });
const wert = (beat: number, pfad: string, w: number, toleranz: number, herleitung = ''): Z => ({ t: 'wert', sample: S(beat), pfad, wert: w, toleranz, herleitung });
const aktion = (beat: number, was: string): Z => ({ t: 'aktion', sample: S(beat), was });
const q = (id: number | null, quelle: string, status: number | null, grund: string | null = '') => ['/q', ',hsihds', id, quelle, status, null, null, grund];
const rpc = (beat: number, id: number, methode: string, parameter: unknown, verbindung = 'mcp') => ws(beat, verbindung, 'rpc', { id, methode, parameter });
const antwort = (ab: number, id: number, ergebnis: Z) => wsErw(ab, ab + 1, 'rpc_antwort', { id, ergebnis }, '§10 Rückgabe wie waehle');

export const H2 = { id: 'h2', kanal: 'deck/2', inhalt: 'f0000000000000b2/128000_r1', deck: 2, bpm: 128.0, gemessen_von_beat: 4.0,
  gemessen_bis_beat: 11.0, gueltig_bis_beat: 400.0, quell_von: 0.0, quell_bis: 400.0, erneuerung: 0, sync_ms: 0.5,
  deck_gegen_deck_ms: 1.0, flam_anteil: 0.0, lufs_kurz: -14.0, pegel_diff_db: 0.0, baender_db: [-30, -30, -30, -30, -30, -30],
  urteil: 'ok', gruende: [] };

// Aufbau: Zeitachse 128, A = Deck 1 (a1) läuft ab Beat 8 und steht per Hand auf 0 dB (Halter mensch ab Beat 3, frei ab 35),
// B = Deck 2 (b2) läuft ab Beat 8 hinter geschlossenem Fader (Vorhören), Hörschein h2 über die Analyse-Rolle, Cypher als mcp.
function aufbau(mitB = true, hs: Z[] = [H2]): Z[] {
  const z: Z[] = [
    sende(0, ['/k/set/neu', ',hsd', 1, 'pruefstand', 128.0], '§4.2'),
    sende(1, ['/k/deck/laden', ',hsisdii', 2, 'pruefstand', 1, 'f0000000000000a1', 128.0, 1, 0], '§4.4'),
    erwarte(1, 4, q(2, 'pruefstand', 3)),
    sende(2, ['/k/deck/laden', ',hsisdii', 3, 'pruefstand', 2, 'f0000000000000b2', 128.0, 1, 0], '§4.4'),
    erwarte(2, 5, q(3, 'pruefstand', 3)),
    hand(2.5, 'deck/1/fader', 0.0),
    hand(3, 'deck/1/fader', 1.0),
    erwarte(3, 3.2, ['/e/halter', ',sshd', 'deck/1/fader', 'mensch', S(3), null], '§7.3 Punkt 3'),
    sende(6, ['/k/deck/start', ',hssssiddi', 4, 'andreas', '', '', '', 1, 8.0, 0.0, 0], 'A spielt'),
  ];
  if (mitB) z.push(sende(6, ['/k/deck/start', ',hssssiddi', 5, 'pruefstand', '', '', '', 2, 8.0, 0.0, 0], 'B läuft hinter geschlossenem Fader'));
  z.push(ws(10, 'analyse', 'hallo', { rolle: 'analyse', name: 'laeufer-analyse', protokoll: 1 }));
  hs.forEach((h, i) => z.push(ws(10.5 + i * 0.1, 'analyse', 'hoerschein', h)));
  z.push(ws(12, 'mcp', 'hallo', { rolle: 'mcp', name: 'laeufer-mcp', protokoll: 1 }));
  z.push(wsErw(12, 13, 'willkommen', { rolle: 'mcp', autonomie: 1 }, '§9.2, autonomie_start 1'));
  return z;
}

// 09 NP K1 in Vertragseinheiten wie tests/hilfen/faelle.ts K1_PLAN, hier 4 Takte später (A's Fader ist bis Beat 35 in
// Andreas' Hand): B ab Takt 13, Basstausch in Takt 20, A raus ab Takt 21 über 16 Takte. B's Bass schließt ein Setzen einen
// Beat vor B's Fader (FORMAT.md Punkt 22n: I1 prüft ein Setzen im Kern vielleicht mit seiner Schaltrampe, 09 NP NK3).
export const K1_PLAN: MenschenPlan = {
  hoerschein: 'h2', grund: 'B unter A, Bass tauschen',
  teile: [
    { regler: 'deck/2/eq/tief', art: 'setze', ab_takt: 12, ab_schlag: 4, nach: -30 },
    { regler: 'deck/2/fader', art: 'setze', ab_takt: 13, nach: -15 },
    { regler: 'deck/2/fader', art: 'rampe', ab_takt: 13, dauer_takte: 8, nach: 0 },
    { regler: 'deck/2/eq/tief', art: 'rampe', ab_takt: 20, dauer_takte: 1, nach: 0 },
    { regler: 'deck/1/eq/tief', art: 'rampe', ab_takt: 20, dauer_takte: 1, nach: -30 },
    { regler: 'deck/1/fader', art: 'rampe', ab_takt: 21, dauer_takte: 16, nach: -200 },
  ],
};

// Fehlerfall 09 NP K1: LLM-Plan ohne Gruppe, Andreas greift A's Bass vor dem Tausch (Beat 70); mit Kopplung fällt B's
// Bass-Rampe mit (Gruppe basstausch), B's Bass bleibt zu, kein Takt Sub doppelt.
function k1(): Z[] {
  return [
    ...aufbau(),
    rpc(36, 1, 'plan_einreichen', K1_PLAN),
    antwort(36, 1, { status: 'vorgeschlagen' }),
    hand(40, 'taste/annehmen', 1.0),
    wsErw(40, 41, 'ereignis', { art: 'vorschlag_angenommen' }),
    ...[0, 1, 2, 3, 4].map(() => erwarte(40, 41, q(null, 'cypher', 1))),
    erwarte(48, 49, q(null, 'cypher', 1), 'a_raus nach dem Start von B rein (§14.1)'),
    hand(66, 'deck/1/eq/tief', 0.5),
    hand(70, 'deck/1/eq/tief', 0.53125),
    erwarte(70, 70.2, ['/e/halter', ',sshd', 'deck/1/eq/tief', 'mensch', S(70), null], 'Griff an A-Bass'),
    erwarte(70, 70.2, q(null, 'cypher', 7, 'hand'), 'A-Bass-Rampe fällt (§7.3 Punkt 3)'),
    erwarte(70, 70.2, q(null, 'cypher', 7, 'hand'), 'B-Bass-Rampe fällt mit, Gruppe basstausch (Kopplung)'),
    nicht(0, 146, ['/e/invariante', ',ssihd', 'sub_doppelt', null, null, null, null], 'Kopplung verhindert es, I1 muss nicht greifen'),
    wert(90, 'deck/2/eq/tief', -30.0, 0.01, 'B-Bass bleibt zu'),
    wert(80.5, 'deck/2/fader', 0.0, 0.01, 'B rein läuft zu Ende'),
    wert(144.5, 'deck/1/fader', -200.0, 0.0, 'A raus läuft zu Ende'),
  ];
}

// Negativ-Kontrolle K1: dieselbe Folge ohne Griff; der Basstausch läuft durch, kein Sub doppelt
function k1OhneHand(): Z[] {
  return [
    ...aufbau(),
    rpc(36, 1, 'plan_einreichen', K1_PLAN),
    antwort(36, 1, { status: 'vorgeschlagen' }),
    hand(40, 'taste/annehmen', 1.0),
    ...[0, 1, 2, 3, 4].map(() => erwarte(40, 41, q(null, 'cypher', 1))),
    nicht(0, 146, ['/e/invariante', ',ssihd', 'sub_doppelt', null, null, null, null]),
    nicht(0, 146, q(null, 'cypher', 7, null)),
    wert(90, 'deck/2/eq/tief', 0.0, 0.01, 'Tausch vollzogen'),
    wert(90, 'deck/1/eq/tief', -30.0, 0.01, 'Tausch vollzogen'),
    wert(144.5, 'deck/1/fader', -200.0, 0.0, 'A raus läuft zu Ende'),
  ];
}

// Negativ-Kontrolle der Abnahme: Stufe 1, Plan macht ausschließlich KI-Spur leiser → direkt angenommen (Leitstand mit
// --ki-spur deck/3). Dazu zwei Gegenproben aus derselben KI-Spur: lauter und EQ → Vorschlag.
function kiSpurLeiser(): Z[] {
  return [
    { t: 'notiz', text: 'Leitstand mit KI-Spur deck/3 (§4.7 /k/ki/spur)', leitstand_args: ['--ki-spur', 'deck/3'] },
    sende(0, ['/k/set/neu', ',hsd', 1, 'pruefstand', 128.0]),
    sende(1, ['/k/deck/laden', ',hsisdii', 2, 'pruefstand', 3, 'f0000000000000a1', 128.0, 1, 0]),
    erwarte(1, 4, q(2, 'pruefstand', 3)),
    sende(6, ['/k/deck/start', ',hssssiddi', 3, 'pruefstand', '', '', '', 3, 8.0, 0.0, 0]),
    hand(9, 'deck/3/fader', 0.0),
    hand(10, 'deck/3/fader', 1.0),
    erwarte(41.9, 42.2, ['/e/halter', ',sshd', 'deck/3/fader', 'frei', null, null], '§7.3 Punkt 4: frei nach 32 Beats'),
    ws(12, 'mcp', 'hallo', { rolle: 'mcp', name: 'laeufer-mcp', protokoll: 1 }),
    rpc(44, 1, 'plan_einreichen', { grund: 'eigene Spur leiser', teile: [{ regler: 'deck/3/fader', art: 'rampe', ab_takt: 13, dauer_takte: 2, nach: -20 }] }),
    antwort(44, 1, { status: 'angenommen' }),
    erwarte(44, 45, q(null, 'cypher', 1), 'direkt an den Kern (§10 Stufe 1, Ausnahme)'),
    erwarte(48, 48.2, ['/q', ',hsihds', null, 'cypher', 2, S(48), null, '']),
    erwarte(56, 56.2, ['/q', ',hsihds', null, 'cypher', 3, S(56), null, '']),
    wert(56.5, 'deck/3/fader', -20.0, 0.01),
    rpc(45, 2, 'plan_einreichen', { grund: 'eigene Spur lauter', teile: [{ regler: 'deck/3/fader', art: 'setze', ab_takt: 16, nach: -3 }] }),
    antwort(45, 2, { status: 'vorgeschlagen' }),
    rpc(46, 3, 'plan_einreichen', { grund: 'EQ an der eigenen Spur', teile: [{ regler: 'deck/3/eq/tief', art: 'setze', ab_takt: 16, nach: -10 }] }),
    antwort(46, 3, { status: 'vorgeschlagen' }),
    nicht(45.5, 70, q(null, 'cypher', 1), 'Vorschläge erreichen den Kern nicht'),
    wert(64, 'deck/3/eq/tief', 0.0, 0.0),
  ];
}

// Verfall genau 1 Takt vor dem Start (§3): P1 verfällt bei Beat 60; P2 wird bei 91,9 angenommen (vor 92); P3 bei genau
// 124,0 nicht mehr (verfaellt_beat 124).
function verfall(): Z[] {
  return [
    ...aufbau(false, []),
    rpc(13, 1, 'plan_einreichen', { grund: 'P1', teile: [{ regler: 'deck/1/eq/hoch', art: 'setze', ab_takt: 17, nach: -6 }] }),
    antwort(13, 1, { status: 'vorgeschlagen' }),
    rpc(14, 2, 'plan_einreichen', { grund: 'P2', teile: [{ regler: 'deck/1/eq/mitte', art: 'setze', ab_takt: 25, nach: -6 }] }),
    antwort(14, 2, { status: 'vorgeschlagen' }),
    rpc(15, 3, 'plan_einreichen', { grund: 'P3', teile: [{ regler: 'deck/1/eq/hoch', art: 'setze', ab_takt: 33, nach: -3 }] }),
    antwort(15, 3, { status: 'vorgeschlagen' }),
    wsErw(60, 60.2, 'ereignis', { art: 'vorschlag_verfallen', plan_id: 'p1', verfaellt_beat: 60.0 }, '§3: 1 Takt vor Beat 64'),
    hand(91.9, 'taste/annehmen', 1.0),
    wsErw(91.9, 92, 'ereignis', { art: 'vorschlag_angenommen', plan_id: 'p2' }),
    erwarte(91.9, 92.5, q(null, 'cypher', 1)),
    erwarte(96, 96.2, ['/q', ',hsihds', null, 'cypher', 2, S(96), null, '']),
    hand(124, 'taste/annehmen', 1.0),
    wsErw(124, 124.2, 'ereignis', { art: 'vorschlag_verfallen', plan_id: 'p3', verfaellt_beat: 124.0 }),
    nicht(123, 130, q(null, 'cypher', 1), 'Taste genau am Verfall-Beat nimmt nicht an'),
    wert(70, 'deck/1/eq/hoch', 0.0, 0.0, 'P1 nie ausgeführt'),
    wert(100, 'deck/1/eq/mitte', -6.0, 0.01, 'P2 ausgeführt'),
  ];
}

// teil_rampe über den Leitstand (§19.3), Leitstand-Abschuss bei Beat 80, neuer Leitstand ab Beat 81.
// mitKernNeustart: die Attrappe startet vorher einmal neu (Generation 1), damit /q/stand nach §4.1 kommt. Ohne ihn
// (Generation 0) startet der neue Leitstand ohne --set-id wie unter systemd und findet das Set über <sets>/aktuell.
function leitstandNeustart(mitKernNeustart: boolean): Z[] {
  return [
    sende(0, ['/k/set/neu', ',hsd', 1, 'pruefstand', 128.0]),
    ...(mitKernNeustart ? [aktion(2, 'kern_kill9')] : []),
    sende(3, ['/k/deck/laden', ',hsisdii', 2, 'pruefstand', 2, 'f0000000000000b2', 128.0, 1, 0]),
    erwarte(3, 6, q(2, 'pruefstand', 3)),
    sende(6, ['/k/deck/start', ',hssssiddi', 3, 'pruefstand', '', '', '', 2, 8.0, 0.0, 0]),
    ws(11, 'analyse', 'hallo', { rolle: 'analyse', name: 'laeufer-analyse', protokoll: 1 }),
    ws(11.5, 'analyse', 'hoerschein', H2),
    ws(12, 'mcp', 'hallo', { rolle: 'mcp', name: 'laeufer-mcp', protokoll: 1 }),
    rpc(13, 1, 'plan_einreichen', { hoerschein: 'h2', grund: 'teil_rampe', teile: [
      { regler: 'deck/2/fader', art: 'setze', ab_takt: 17, nach: -15 },
      { regler: 'deck/2/fader', art: 'rampe', ab_takt: 17, dauer_takte: 8, nach: 0 }] }),
    antwort(13, 1, { status: 'vorgeschlagen' }),
    hand(20, 'taste/annehmen', 1.0),
    erwarte(20, 21, q(null, 'cypher', 1)),
    erwarte(20, 21, q(null, 'cypher', 1)),
    erwarte(64, 64.2, ['/q', ',hsihds', null, 'cypher', 2, S(64), null, ''], 'Setzen'),
    erwarte(64, 64.2, ['/q', ',hsihds', null, 'cypher', 2, S(64), null, ''], 'Rampe'),
    wert(72, 'deck/2/fader', -11.25, 0.01),
    aktion(80, 'leitstand_kill9'),
    wert(80, 'deck/2/fader', -7.5, 0.01, '§19.3 teil_rampe: Beat 80 = −7,5 dB, der Kern fährt weiter'),
    mitKernNeustart ? aktion(81, 'leitstand_start') : { ...aktion(81, 'leitstand_start'), ohne_set_id: true },
    // der neue Leitstand braucht zum Starten unter Last bis 2,6 s (Probe 2026-09-23, Last 17 bis 36): Anfrage erst bei Beat 92
    ws(90, 'pruef', 'hallo', { rolle: 'pruefstand', name: 'laeufer-pruef', protokoll: 1 }),
    rpc(92, 1, 'lage', {}, 'pruef'),
    wsErw(92, 93, 'rpc_antwort', { id: 1, ergebnis: { lage: { plaene: [{ id: 'p1', status: 'laeuft' }] } } }, 'der neue Leitstand kennt p1'),
    erwarte(96, 96.2, ['/q', ',hsihds', null, 'cypher', 3, S(96), null, ''], 'die Attrappe fährt zu Ende'),
    wsErw(96, 96.5, 'ereignis', { art: 'teil_fertig', plan_id: 'p1', teil: 1 }, 'der neue Leitstand ordnet die Quittung zu'),
    wert(96.5, 'deck/2/fader', 0.0, 0.01),
  ];
}

// Abgleich nach Kern-Neustart (§16.3): Attrappe per kill -9 bei Beat 80, der Leitstand lebt weiter
function kernNeustart(): Z[] {
  const z = leitstandNeustart(false).filter((x) => !(x.t === 'aktion') && !(x.t === 'ws_sende' && x.verbindung === 'pruef')
    && !(x.t === 'ws_erwarte' && (x.daten as Z).id === 1 && x.typ === 'rpc_antwort' && ((x.daten as Z).ergebnis as Z).lage));
  z.push(aktion(76, 'kern_kill9'));
  z.push(wsErw(76, 78, 'ereignis', { art: 'neustart', generation: 1 }, '§16.3: ein Generationssprung ist ein Kern-Neustart'));
  return z;
}

// Je Verriegelungsgrund, den plan_einreichen ausdrücken kann, ein Fall mit dem Code aus §16.2
function verriegelung(): Z[] {
  const hs = (id: string, x: Z) => ({ ...H2, id, ...x });
  const z = aufbau(true, [H2, hs('h3', { urteil: 'nicht_sync' }), hs('h4', { urteil: 'zu_laut' }), hs('h5', { bpm: 130.0 }),
    hs('h6', { gueltig_bis_beat: 5.0 }), hs('h7', { quell_von: 300.0, quell_bis: 310.0 }),
    hs('h8', { inhalt: 'f0000000000000b2/128000_r2' }), hs('h9', { kanal: 'deck/3', deck: 3 })]);
  const offen = (h: string) => ({ hoerschein: h, grund: 'B auf', teile: [{ regler: 'deck/2/fader', art: 'setze', ab_takt: 30, nach: -10 }] });
  const verr = (beat: number, id: number, parameter: unknown, grund: string) => [
    rpc(beat, id, 'plan_einreichen', parameter),
    antwort(beat, id, { status: 'verriegelt', gruende: [{ teil: 0, grund }] }),
  ];
  let id = 1;
  let b = 13;
  const fall = (parameter: unknown, grund: string) => { const x = verr(b, id++, parameter, grund); b += 0.5; return x; };
  z.push(
    rpc(b, id, 'plan_einreichen', { grund: 'x', teile: [{ regler: 'deck/2/fader', art: 'rampe', ab_takt: 30, nach: -6 }] }),
    wsErw(b, b + 1, 'rpc_fehler', { id: id++, code: 'form' }, 'rampe ohne dauer_takte'),
  );
  b += 0.5;
  z.push(...fall({ grund: 'x', teile: [{ regler: 'deck/1/eq/hoch', art: 'setze', ab_takt: 1, nach: -6 }] }, 'zu_spaet'));
  z.push(...fall({ grund: 'x', teile: [{ regler: 'deck/1/fader', art: 'setze', ab_takt: 20, nach: -3 }] }, 'regler_beim_menschen'));
  z.push(rpc(b, id, 'plan_einreichen', { grund: 'x', teile: [
    { regler: 'deck/1/eq/hoch', art: 'rampe', ab_takt: 20, dauer_takte: 4, nach: -20 },
    { regler: 'deck/1/eq/hoch', art: 'rampe', ab_takt: 22, dauer_takte: 4, nach: -30 }] }));
  z.push(antwort(b, id++, { status: 'verriegelt', gruende: [{ teil: 0, grund: 'ueberlappung' }, { teil: 1, grund: 'ueberlappung' }] }));
  b += 0.5;
  for (const [h, grund] of [['', 'kein_hoerschein'], ['h9', 'hoerschein_anderer_kanal'], ['h3', 'hoerschein_nicht_sync'],
    ['h4', 'hoerschein_pegel'], ['h8', 'hoerschein_anderer_inhalt'], ['h5', 'hoerschein_anderes_tempo'],
    ['h6', 'hoerschein_abgelaufen'], ['h7', 'hoerschein_anderer_abschnitt']]) {
    z.push(...fall(h ? offen(h) : { grund: 'B auf', teile: offen('').teile }, grund));
  }
  z.push(...fall({ grund: 'x', teile: [{ regler: 'xfader', art: 'setze', ab_takt: 30, nach: 0.5 }] }, 'nur_hand'));
  z.push(...fall({ grund: 'x', teile: [{ regler: 'deck/1/eq/tief', art: 'setze', ab_takt: 30, nach: 9 }] }, 'ausserhalb_bereich'));
  // regler_verplant: ein angenommener Plan hält deck/1/eq/mitte in Takt 25 bis 28
  z.push(rpc(b, id, 'plan_einreichen', { grund: 'A Mitten', teile: [{ regler: 'deck/1/eq/mitte', art: 'rampe', ab_takt: 25, dauer_takte: 4, nach: -6 }] }));
  z.push(antwort(b, id++, { status: 'vorgeschlagen' }));
  z.push(hand(b + 1, 'taste/annehmen', 1.0));
  z.push(erwarte(b + 1, b + 2, q(null, 'cypher', 1), 'angenommen, am Kern'));
  b += 2;
  z.push(...fall({ grund: 'x', teile: [{ regler: 'deck/1/eq/mitte', art: 'setze', ab_takt: 26, nach: -3 }] }, 'regler_verplant'));
  // autonomie: Stufe 0 per Taste, danach zurück auf 1
  z.push(hand(b, 'taste/autonomie', 0.0));
  b += 0.5;
  z.push(rpc(b, id, 'plan_einreichen', { grund: 'x', teile: [{ regler: 'deck/1/eq/hoch', art: 'setze', ab_takt: 30, nach: -6 }] }));
  z.push(antwort(b, id++, { status: 'abgelehnt', gruende: [{ teil: 0, grund: 'autonomie' }] }));
  b += 0.5;
  z.push(hand(b, 'taste/autonomie', 1 / 127));
  b += 0.5;
  // ki_gestoppt: Stopp-Taste; der Kern bricht Cyphers angenommenen Plan ab (§4.7), dann Freigabe plus Stopp
  z.push(hand(b, 'taste/stopp', 1.0));
  z.push(erwarte(b, b + 1, q(null, 'cypher', 7, 'ki_stopp'), '§4.7: alle Teile mit Quelle cypher ab'));
  b += 0.5;
  z.push(rpc(b, id, 'plan_einreichen', { grund: 'x', teile: [{ regler: 'deck/1/eq/hoch', art: 'setze', ab_takt: 30, nach: -6 }] }));
  z.push(antwort(b, id++, { status: 'abgelehnt', gruende: [{ teil: 0, grund: 'ki_gestoppt' }] }));
  b += 0.5;
  z.push(hand(b, 'taste/freigabe', 1.0), hand(b + 0.25, 'taste/stopp', 1.0));
  z.push(erwarte(b, b + 1, ['/e/ki', ',ish', 0, null, null], '§7.3 Punkt 8: Freigabe plus Stopp'));
  z.push(nicht(0, 60, q(null, 'cypher', 2)), nicht(0, 60, ['/e/invariante', ',ssihd', null, null, null, null, null]));
  return z;
}

export const FOLGEN: Record<string, () => Z[]> = {
  k1_kopplung: k1, k1_ohne_hand: k1OhneHand, ki_spur_leiser: kiSpurLeiser, vorschlag_verfall: verfall,
  leitstand_neustart_gen1: () => leitstandNeustart(true), leitstand_neustart_gen0: () => leitstandNeustart(false),
  kern_neustart: kernNeustart, verriegelung_gruende: verriegelung,
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(ZIEL, { recursive: true });
  for (const [name, bau] of Object.entries(FOLGEN)) {
    const zeilen = bau();
    fs.writeFileSync(path.join(ZIEL, `${name}.jsonl`), zeilen.map((x) => JSON.stringify(x)).join('\n') + '\n');
    process.stdout.write(`folgen_bau: ${name}.jsonl ${zeilen.length} Zeilen\n`);
  }
}
