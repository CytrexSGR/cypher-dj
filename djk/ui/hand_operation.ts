// Plan Hand (2026-09-28): reine Funktionen für Cyphers Griffe über den Seiten-Server (MCP djk-hand).
import { pultContainerPfad } from '../contract/pult.ts';

// Startraster der Zeitangabe `ab`: Beats der Master-Uhr (Takt = Vielfache von 4, Phrase = von 32; §10 ab_beat = (takt−1)·4)
export const AB: Record<string, number> = { jetzt: 0, schlag: 1, takt: 4, phrase: 32 };   // Phrase 8 Takte (INTERFACES.md:30)

// Start raster of `ab` in beats for a project meter of `proTakt` beats per bar (4: identical to AB; unknown key: undefined).
export function abRaster(ab: string, proTakt: number): number | undefined {
  return ab === 'takt' ? proTakt : ab === 'phrase' ? 8 * proTakt : AB[ab];
}

// Regler-Pfade nach INTERFACES §1.5. Die „nur Hand“-Pfade stehen mit drin: sie lehnt der Kern ab (nur_hand).
// Container core K7/K6: strom track rows pfl, trim, kill; sends and returns 1..8.
// Container core M7: erz/<n> n 1..16 is alias vocabulary (stream_alias.ts resolves it, or refuses it with kein_alias_ziel); pan, mute and solo exist on the alias only.
// 1.15 A2: the five alternatives before the bk one are the mix-tool paths (gate and util on the containers deck/1, deck/2, pad/1, pad/2; util, mb and lim on bus/1..4; spektrum/kanal), an exact set; the erz alias has none.
// Strand 2 slice 2: the alternative in front of the bk one is plug/<h>/k<m>, h 1..8, m 1..16, the knob rows of the effect hosts (no consumer in the core).
export const PFAD = /^(deck\/[1-4]|erz\/([1-9]|1[0-6])|pad\/[12]|bus\/[1-4])\/(fader|trim|eq\/(tief|mitte|hoch)|kill\/(tief|mitte|hoch)|filter|send\/[1-4]|stem\/(drums|bass|vocals|other)|xseite|pfl|ziel)$|^(deck\/[1-4]|erz\/([1-9]|1[0-6])|pad\/[12])\/komp\/(an|schwelle|ratio|attack|release|makeup|mix|sc)$|^(xfader|master\/(pegel|kleber|pfl)|cue\/(mix|pegel|split)|fx\/[1-4]\/(notenwert|rueckkopplung|rueckweg)|duck\/(tiefe|release)|color\/(art|param)|keylock)$|^erz\/([1-9]|1[0-6])\/(pan|mute|solo)$|^spur\/([1-9]|[1-9][0-9]|1[01][0-9]|12[0-8])\/(fader|pan|mute|solo|filter|pfl|trim|kill\/(tief|mitte|hoch)|eq\/(tief|mitte|hoch)|fx\/[123])$|^grp\/([1-9]|1[0-6])\/(fader|pan|mute|solo|cue)$|^pm\/fader$|^(spur\/([1-9]|[1-9][0-9]|1[01][0-9]|12[0-8])|grp\/([1-9]|1[0-6]))\/send\/[1-8]$|^ret\/[1-8]\/(fader|pan|mute|solo|hall\/(an|pre|decay|groesse|tief|highcut|fahne))$|^(deck\/[12]|pad\/[12])\/gate\/(an|schwelle|hysterese|ratio|bereich|attack|hold|release|sc)$|^(deck\/[12]|pad\/[12]|bus\/[1-4])\/util\/(balance|breite|bassmono|phase_l|phase_r|tausch|dc)$|^bus\/[1-4]\/mb\/(an|grenze_tief|grenze_hoch|(tief|mitte|hoch)\/(schwelle|ratio|attack|release|knie|makeup|umgehen))$|^bus\/[1-4]\/lim\/(an|decke|abklingen)$|^spektrum\/kanal$|^ins\/komp\/([1-9]|[1-9][0-9]|1[0-5][0-9]|160)\/(an|schwelle|ratio|knie|attack|release|makeup|mix|schp|sc|glue|auto)$|^ins\/eq\/([1-9]|[1-9][0-9]|1[0-5][0-9]|160)\/(an|out|propq|b[1-8]\/(an|typ|freq|gain|q|steil|platz)|d[1-8]\/(dyn|schwelle|bereich)|dyn_attack|dyn_release|sc)$|^ins\/saett\/([1-9]|[12][0-9]|3[0-2])\/(an|drive|out|mix|kurve|decke|knie)$|^ins\/trans\/([1-9]|[12][0-9]|3[0-2])\/(an|angriff|halten|tempo|out|mix)$|^ins\/bild\/([1-9]|1[0-6])\/(an|grenze_tief|grenze_hoch|breite_tief|breite_mitte|breite_hoch|mono_unter)$|^ins\/lim\/[1-8]\/(an|decke|abklingen)$|^ins\/gate\/([1-9]|1[0-6])\/(an|schwelle|hysterese|ratio|bereich|attack|hold|release)$|^ins\/mb\/[1-8]\/(an|grenze_tief|grenze_hoch|b[1-3]\/(schwelle|ratio|attack|release|knie|makeup|umgehen)|u[1-3]\/(schwelle|ratio|bereich)|sc)$|^ins\/utility\/[1-8]\/(an|breite|mono_unter|gain|balance)$|^ins\/bk\/[1-8]\/(an|k([1-9]|[1-5][0-9]|6[0-4]))$|^spur\/([1-9]|1[0-6])\/bk\/([1-9]|[1-5][0-9]|6[0-4])$|^strom\/([1-9]|1[0-6])\/bk\/([1-9]|[1-5][0-9]|6[0-4])$|^ins\/host\/[1-8]\/an$|^rack\/([1-9]|1[0-2])\/m[1-4]$|^plug\/[1-8]\/k([1-9]|1[0-6])$|^(deck\/[12]|erz\/(1|2|3|5|6|7|9|10)|pad\/[12]|fx\/[34]|master)\/bk\/([1-9]|[1-5][0-9]|6[0-4])$/;   // keylock: Keylock 3, EIN Knopf für alle Quellen

// Plan Hand D8 (Rev. 2 nach Review B1): Der Kern prüft I3a seit Ohr T13/T14 selbst; der Server-Riegel ist die frühe
// Absage vor dem Senden. Er sperrt Cyphers Öffnen nach §1.6: offen(k) ⇔ trim + trim_auto + fader > −26 dB (core_deck.cpp:106
// deck_offen). Unbekannter Fader = −200 (nach Laden), unbekannter Trim = 0.
export const OFFEN_DB = -26;
// The strips that can be opened are the four container strips only (deck/1, deck/2, pad/1, pad/2). erz/<n> is alias vocabulary (stream_alias.ts), deck/3 and deck/4 have no strip.
const KANAL = /^(deck\/[12]|pad\/[12])\/(fader|trim)$/;
export function kanalOffen(regler: Record<string, number>, k: string): boolean {
  return (regler[`${k}/trim`] ?? 0) + (regler[`${k}/trim_auto`] ?? 0) + (regler[`${k}/fader`] ?? -200) > OFFEN_DB;
}
// Container core M6: the channel strips that belong to a place. One strip per container (deck/1, deck/2, pad/1, pad/2 for places 1..4).
export function kanaeleVonPlatz(platz: 1 | 2 | 3 | 4): string[] { return [pultContainerPfad[platz - 1]]; }

// The still rule of a place change: a place may only change while every strip of its container is closed (not open by trim + fader, no PFL).
// The same arithmetic as the page's `kanalOffen` and `pflAn`; `regler` is the server's view of the core's controls.
export function platzStill(platz: 1 | 2 | 3 | 4, regler: Record<string, number>): { still: boolean; offen: { kanal: string; grund: 'open' | 'pfl' }[]; text: string } {
  const offen: { kanal: string; grund: 'open' | 'pfl' }[] = [];
  for (const kanal of kanaeleVonPlatz(platz)) {
    if (kanalOffen(regler, kanal)) offen.push({ kanal, grund: 'open' });
    else if ((regler[`${kanal}/pfl`] ?? 0) >= 0.5) offen.push({ kanal, grund: 'pfl' });
  }
  const text = offen.length === 0 ? '' : offen.map((o) => `${o.kanal} is ${o.grund === 'open' ? 'open' : 'on PFL'}`).join(', ');
  return { still: offen.length === 0, offen, text: offen.length === 0 ? '' : `place ${platz} cannot change: ${text}; close the strip first` };
}
// Container core M8, guard table D3: whether Cypher may open the strip of a container without a hearing check, by the type of the place that feeds it.
// 'frei': no check (a strudel module, an empty container, a SEQ deck while no track is loaded on its player: only Cypher's own sound plays there).
// 'hoerschein': a valid hearing check of the player with the container's number (the key `deck/<N>`, N = container number = player number).
// Strand 11 (4.3): loops and stems are 'frei' too: Andreas' words "du solltest alles drehen können"; the ramp rule (nur_rampe) guards the level instead.
// `geladen`: a track is loaded on the player of the container (F10 R2: a SEQ deck keeps today's condition, free only without a track).
export type ContainerRiegel = 'frei' | 'hoerschein';
export function containerFrei(typ: string | undefined, geladen: boolean): ContainerRiegel {
  switch (typ) {
    case 'seq': return geladen ? 'hoerschein' : 'frei';
    case 'strudel': case 'leer': case 'loops': case 'stems': return 'frei';
    default: return 'hoerschein';   // track, and a project without places (production, none open): the old rule of the deck strips
  }
}
// The container (place number 1..4) a fader or trim path belongs to, null for any other path.
export function containerVonPfad(pfad: string): 1 | 2 | 3 | 4 | null {
  const m = KANAL.exec(pfad);
  return m ? ((pultContainerPfad.indexOf(m[1] as never) + 1) as 1 | 2 | 3 | 4) : null;
}
// Plan seq-fader-frei, simplified for containers: a container strip that a SEQ deck feeds and that has NO track loaded on its player is free for Cypher.
// Pure: `seqPlaetze` are the places with a SEQ deck in the open live project, `geladen` the places with a track on the player (same as containerFrei('seq', ...)).
export function seqDeckFrei(pfad: string, seqPlaetze: ReadonlySet<number>, geladen: ReadonlySet<number>): boolean {
  const platz = containerVonPfad(pfad);
  return platz !== null && seqPlaetze.has(platz) && !geladen.has(platz);
}
// Does the command pfad -> nach open a strip that was closed? Only container strips can be opened (KANAL); erz/<n> aliases never reach here
// (their content is Cypher's own pattern). AUTO is held by the page server (409 auto_aus in /spur and /regler), Stop Cypher by core and page server.
export function oeffnet(regler: Record<string, number>, pfad: string, nach: number): boolean {
  const m = KANAL.exec(pfad);
  if (!m) return false;
  const k = m[1];
  if (kanalOffen(regler, k)) return false;
  return kanalOffen({ ...regler, [pfad]: nach }, k);
}

// Quittungs-Status §5.1: 4 verspätet verworfen, 6 abgelehnt, 7 abgebrochen, 8 storniert = nicht (mehr) ausgeführt
export const FEHL_STATUS = new Set([4, 6, 7, 8]);

// Plan Glanz 1.2: die Überlappungsregel des Kerns (sort_in.cpp:17-27, §17 I4) für zwei Cypher-Teile desselben Plans.
// Cyphers Teile tragen alle Teil-Nummer 0, darum entscheidet am selben Beat nie die Nummer: Setzen und Rampe am selben
// Beat überlappen nicht, zwei Setzen am selben Beat überlappen. `x` ist der schon angenommene Teil, `a` der neue.
export interface Teilzeit { ab: number; dauer: number }
export function ueberlappt(x: Teilzeit, a: Teilzeit): boolean {
  if (x.dauer > 0 && a.dauer > 0) return Math.max(x.ab, a.ab) < Math.min(x.ab + x.dauer, a.ab + a.dauer);
  if (x.dauer === 0 && a.dauer === 0) return x.ab === a.ab;
  if (a.dauer === 0) return x.ab < a.ab && a.ab < x.ab + x.dauer;   // neu: Setzen in einer Rampe
  return a.ab < x.ab && x.ab < a.ab + a.dauer;                     // neu: Rampe über ein Setzen
}

// Frühester Beat ab `ab`, an dem der neue Teil gegen keinen offenen Teil überlappt: hinter das Ende des Störers, bei
// Setzen gegen Setzen einen Beat weiter. Jeder Schritt rückt vor, die Schleife endet.
export function ersterFreierBeat(offen: Teilzeit[], ab: number, dauer: number): number {
  let b = ab;
  for (let n = 0; n < 1000; n++) {
    const e = offen.find((x) => ueberlappt(x, { ab: b, dauer }));
    if (!e) return b;
    b = e.dauer === 0 && dauer === 0 ? b + 1 : e.ab + e.dauer;
  }
  return b;
}
