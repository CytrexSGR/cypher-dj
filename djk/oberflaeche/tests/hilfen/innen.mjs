// Dünner Zugriff auf die Innereien der Oberflaeche, die Tests heute direkt anfassen (Karte 2026-10-01, Abschnitt 4).
// Wer server.ts umbaut (Schnittfolge S1 bis S16), passt NUR diese Datei an; neue Tests gehen über sie.
// Ein Feld, das nach einem Umbau nicht mehr wirkt, soll hier laut scheitern, nicht still: darum prüfen Setter ihr Ziel.

export function innen(o) {
  const feld = (name) => {
    if (!(name in o)) throw new Error(`innen: Oberflaeche hat kein Feld ${name} mehr (Umbau? dann nur hilfen/innen.mjs anpassen)`);
  };
  return {
    // Kern-Ereignis einspeisen, wie es von der UDP-Anbindung käme
    vomKern(adresse, felder) { feld('vomKern'); o.vomKern({ adresse, felder }); },
    // Zähler der an den Kern gesendeten Befehle
    get gesendet() { feld('gesendet'); return o.gesendet; },
    // Stand-Spiegel (regler, decks, loops, fx, fxZuweisung, fxRouting, geladen); jedes Lesen holt das aktuelle Objekt,
    // denn ein Neustart ersetzt stand.loops und stand.fx
    get stand() { feld('stand'); return o.stand; },
    // Befehlszähler (bigint im Server); naechsteId() zählt wie die Befehlswege
    naechsteId() { feld('id'); return Number(++o.id); },
    get id() { feld('id'); return o.id; },
    // 30-s-Sperre der Wiederherstellung zurücksetzen oder lesen
    get letzteBoxFxWieder() { feld('letzteBoxFxWieder'); return o.letzteBoxFxWieder; },
    set letzteBoxFxWieder(v) { feld('letzteBoxFxWieder'); o.letzteBoxFxWieder = v; if (o.letzteBoxFxWieder !== v) throw new Error('innen: letzteBoxFxWieder wirkt nicht'); },
    // gemerkte Deck-Loops
    get aktiverLoop() { feld('aktiverLoop'); return o.aktiverLoop; },
    set aktiverLoop(v) { feld('aktiverLoop'); o.aktiverLoop = v; if (o.aktiverLoop !== v) throw new Error('innen: aktiverLoop wirkt nicht'); },
    get kiGestoppt() { feld('kiGestoppt'); return o.kiGestoppt; },
    get generation() { feld('generation'); return o.generation; },
    get kern() { feld('kern'); return o.kern; },
  };
}
