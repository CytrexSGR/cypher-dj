// Plan Hand (2026-09-28): reine Funktionen für Cyphers Griffe über den Seiten-Server (MCP djk-hand).

// Startraster der Zeitangabe `ab`: Beats der Master-Uhr (Takt = Vielfache von 4, Phrase = von 32; §10 ab_beat = (takt−1)·4)
export const AB: Record<string, number> = { jetzt: 0, schlag: 1, takt: 4, phrase: 32 };   // Phrase 8 Takte (SCHNITTSTELLEN.md:30)

// Regler-Pfade nach SCHNITTSTELLEN §1.5. Die „nur Hand“-Pfade stehen mit drin: sie lehnt der Kern ab (nur_hand).
export const PFAD = /^(deck\/[1-4]|erz\/[1-8]|pad\/[12]|bus\/[1-4])\/(fader|trim|eq\/(tief|mitte|hoch)|kill\/(tief|mitte|hoch)|filter|send\/[1-4]|stem\/(drums|bass|vocals|other)|xseite|pfl|ziel)$|^(xfader|master\/(pegel|kleber)|cue\/(mix|pegel|split)|fx\/[1-4]\/(notenwert|rueckkopplung|rueckweg)|duck\/(tiefe|release)|keylock)$/;   // keylock: Keylock 3, EIN Knopf für alle Quellen

// Plan Hand D8 (Rev. 2 nach Review B1): Der Kern prüft I3a seit Ohr T13/T14 selbst; der Server-Riegel ist die frühe
// Absage vor dem Senden. Er sperrt Cyphers Öffnen nach §1.6: offen(k) ⇔ trim + fader > −26 dB (kern_deck.cpp:106
// deck_offen). Unbekannter Fader = −200 (nach Laden), unbekannter Trim = 0.
export const OFFEN_DB = -26;
const KANAL = /^(deck\/[1-4]|erz\/[1-8]|pad\/[12])\/(fader|trim)$/;
export function kanalOffen(regler: Record<string, number>, k: string): boolean {
  return (regler[`${k}/trim`] ?? 0) + (regler[`${k}/fader`] ?? -200) > OFFEN_DB;
}
// Öffnet der Befehl pfad → nach einen zuvor geschlossenen Kanal? Strudel-Kanäle (erz/*) nie: ihr Inhalt ist Cyphers
// eigenes Muster. AUTO hält der Seiten-Server (409 auto_aus in /spur und /regler), Stop Cypher hält Kern und Seiten-Server
// samt Wirt und Muster-Fahrten (Andreas 2026-09-29: „ja sperre kann für strudel kanäle fallen").
export function oeffnet(regler: Record<string, number>, pfad: string, nach: number): boolean {
  const m = KANAL.exec(pfad);
  if (!m || m[1].startsWith('erz/')) return false;
  const k = m[1];
  if (kanalOffen(regler, k)) return false;
  return kanalOffen({ ...regler, [pfad]: nach }, k);
}

// Quittungs-Status §5.1: 4 verspätet verworfen, 6 abgelehnt, 7 abgebrochen, 8 storniert = nicht (mehr) ausgeführt
export const FEHL_STATUS = new Set([4, 6, 7, 8]);

// Plan Glanz 1.2: die Überlappungsregel des Kerns (einsortieren.cpp:17-27, §17 I4) für zwei Cypher-Teile desselben Plans.
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
