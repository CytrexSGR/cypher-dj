// Hörbares Ziehen (2026-10-17): die Hand zieht die Welle im Zoomfenster, der Kern liest das Material an der Handposition.
// Diese Klasse drosselt den Strom der Handposition (~60 Hz), schickt Lebenszeichen, solange die Hand hält, und meldet das Los.
// Rein: Uhr, Zeitgeber und Senden werden hineingereicht (Test ohne Browser). Keine Audio-Ausgabe auf der Seite.
export const SCRUB_TAKT_MS = 16;             // höchstens ~60 Meldungen je Sekunde
export const SCRUB_LEBENSZEICHEN_MS = 250;   // steht die Hand still, kommt trotzdem etwas (der Kern löst nach 2 s selbst)
export const SCRUB_SCHWELLE_PX = 3;          // kürzer ist ein Klick, kein Zug

export class ScrubZieher {
  // senden(phase, delta) → Promise<boolean>: phase 0 Los, 1 Griff, 2 Zug; delta in Quell-Beats seit dem Griff
  constructor({ senden, jetzt = () => Date.now(), setzeZeit = (f, ms) => setTimeout(f, ms), loescheZeit = (h) => clearTimeout(h),
    setzeTakt = (f, ms) => setInterval(f, ms), loescheTakt = (h) => clearInterval(h) }) {
    // Die Zeitgeber werden ohne Bindung an dieses Objekt gerufen: im Browser wirft setInterval mit fremdem this „Illegal invocation“
    // (gemessen im Browser-Smoke 2026-10-17; unter Node fällt das nicht auf). Darum Pfeilfunktionen als Vorgabe und Aufruf über Konstanten.
    this.senden = senden; this.jetzt = jetzt;
    this.zeit = { setze: setzeZeit, loesche: loescheZeit, setzeTakt, loescheTakt };
    this.zuruecksetzen();
  }
  zuruecksetzen() {
    this.erlaubt = false; this.aktiv = false; this.griffOk = false; this.delta = 0; this.zuletzt = 0;
    this.nachlauf = null; this.takt = null; this.griff = null;
  }
  // Zeiger gedrückt; erlaubt = false (etwa bei aktivem Loop): kein Ton-Ziehen, die Seite bleibt beim Sprung beim Loslassen
  beginne(erlaubt = true) {
    this.kappe();
    this.zuruecksetzen();
    this.erlaubt = !!erlaubt;
  }
  // dx: Zeigerweg in Pixeln; delta: Handstrecke in Quell-Beats. true, sobald das Ziehen läuft.
  bewege(dx, delta) {
    if (!this.erlaubt || !Number.isFinite(delta)) return this.aktiv;
    this.delta = delta;
    if (!this.aktiv) {
      if (Math.abs(dx) < SCRUB_SCHWELLE_PX) return false;
      this.aktiv = true;
      this.griff = this.senden(1, 0).then((ok) => { this.griffOk = !!ok; return !!ok; }, () => false);
      this.schick(2);
      { const { setzeTakt } = this.zeit; this.takt = setzeTakt(() => { if (this.aktiv) this.schick(2); }, SCRUB_LEBENSZEICHEN_MS); }
      return true;
    }
    const seit = this.jetzt() - this.zuletzt;
    if (seit >= SCRUB_TAKT_MS) this.schick(2);
    else if (this.nachlauf === null) {   // zu früh: der letzte Stand geht nach, sobald der Takt um ist
      { const { setze } = this.zeit; this.nachlauf = setze(() => { this.nachlauf = null; if (this.aktiv) this.schick(2); }, SCRUB_TAKT_MS - seit); }
    }
    return true;
  }
  schick(phase) {
    this.zuletzt = this.jetzt();
    if (this.nachlauf !== null) { const { loesche } = this.zeit; loesche(this.nachlauf); this.nachlauf = null; }
    return Promise.resolve(this.senden(phase, this.delta)).catch(() => false);
  }
  kappe() {
    if (this.nachlauf !== null) { const { loesche } = this.zeit; loesche(this.nachlauf); this.nachlauf = null; }
    if (this.takt !== null) { const { loescheTakt } = this.zeit; loescheTakt(this.takt); this.takt = null; }
  }
  // Zeiger los (delta: Endstand). Ergebnis: gescrubbt = der Kern hat gezogen; griffOk = der Griff kam beim Kern an (sonst
  // soll die Seite wie bisher einen Sprung schicken).
  async ende(delta) {
    this.kappe();
    if (!this.aktiv) { this.zuruecksetzen(); return { gescrubbt: false, griffOk: false }; }
    if (Number.isFinite(delta)) this.delta = delta;
    this.aktiv = false;
    await this.griff;   // das Los nie vor dem Griff
    const griffOk = this.griffOk;
    if (griffOk) await this.schick(0);   // ohne angekommenen Griff gibt es nichts zu lösen
    const r = { gescrubbt: true, griffOk };
    this.zuruecksetzen();
    return r;
  }
  // Zeiger abgebrochen (pointercancel): der Kern lässt los, ohne dass die Seite etwas nachschiebt
  async abbruch() {
    this.kappe();
    if (!this.aktiv) { this.zuruecksetzen(); return; }
    this.aktiv = false;
    await this.griff;
    if (this.griffOk) await this.schick(0);
    this.zuruecksetzen();
  }
}
