// Undo-Verlauf (Spec 3.3): undo.jsonl, eine Zeile je Eintrag, nur anhängen.
//   {"rev","zeit","quelle","label","art":"aendern"|"undo"|"redo","bezug","vor","zurueck"}
// Der Undo-Zeiger wird nirgends gespeichert, er ergibt sich aus dem Durchlauf über das Log: eine Änderung schiebt ihre rev auf den
// Undo-Stapel und leert den Redo-Stapel; Undo holt die oberste rev vom Undo- auf den Redo-Stapel, Redo zurück. Darum überlebt der
// Zeiger einen Neustart, und eine neue Änderung macht den Redo-Stapel ungültig, ohne dass etwas gelöscht würde.
// Mixer-Bewegungen derselben Spur und desselben Parameters von derselben Quelle werden im Speicher zu EINEM Eintrag zusammengefasst:
// je Pfad das erste `zurueck` und das letzte `vor`, rev der letzten Bewegung. Den Schlüssel kann der Aufrufer setzen (Spec 6.30: eine Geste des
// Rückwegs mit mehreren Reglern ist ein Eintrag); zusammengefasst werden nur Patches aus replace-Operationen.
// Das Fenster gleitet (Spec 6.5): solange zwischen zwei Bewegungen höchstens `zusammenfassenMs` (1 s) liegen, bleibt es derselbe Eintrag,
// ein Fader-Zug über 10 s ist also eine Zeile. Der Eintrag wird geschrieben, sobald etwas anderes kommt (Änderung, Undo, Redo, flush,
// schliesse) oder das Fenster ohne Bewegung abläuft. Ein Absturz im Fenster verliert nur diesen einen Undo-Eintrag, nie das Projekt
// (project.json wird bei jeder Änderung gespeichert, vor dem Eintrag).
// Haltbarkeit (Spec 6.7): Ein Eintrag gilt erst als im Speicher, wenn er vollständig geschrieben und fsync't ist (Schleife bis zur vollen
// Länge; bei einem Fehler wird die Datei auf die alte Länge zurückgeschnitten). Ausgenommen ist nur der bewusst ausstehende
// Mixer-Eintrag, der per Entwurf erst beim Flush auf die Platte geht; scheitert dieser Flush im Timer, hört `beiFehler` es und der
// Eintrag bleibt ausstehend (der nächste Aufruf versucht es erneut und wirft dann zum Aufrufer).
import fs from 'node:fs';
import { fuehreListeAus, setzeDekodiert, vergleiche, type Befehl, type BefehlErgebnis, type ReglerAenderung } from './befehle.ts';
import { istObjekt, notenZaehler, pruefeFehler, uebernimmNotenZaehler, type DekodiertZustand, type Projekt } from './modell.ts';
import { wende, PatchFehler, type Patch } from './patch.ts';

export type Quelle = 'andreas' | 'cypher';
export type EintragArt = 'aendern' | 'undo' | 'redo';
export interface Eintrag { rev: number; zeit: string; quelle: Quelle; label: string; art: EintragArt; bezug: number | null; vor: Patch; zurueck: Patch }
export interface VerlaufOptionen {
  jetzt?: () => number; zusammenfassenMs?: number; zeitgeber?: boolean;
  beiFehler?: (e: Error) => void;                 // Schreibfehler im Timer-Flush (sonst: Meldung auf stderr)
  beiSchliesse?: () => void;                      // einmal beim ersten schliesse(), z. B. Sperre freigeben (ablage.ts)
}
export interface Meta { quelle: Quelle; label: string }
export interface Wirkung { projekt: Projekt; eintrag: Eintrag | null; betrifft_wiedergabe: boolean; regler_aenderungen: ReglerAenderung[] }

export class VerlaufFehler extends Error {
  readonly grund: string;
  constructor(grund: string, text = '') { super(text ? `${grund}: ${text}` : grund); this.grund = grund; }
}

const ARTEN: readonly string[] = ['aendern', 'undo', 'redo'];
const QUELLEN: readonly string[] = ['andreas', 'cypher'];
const MIXER_FELDER = ['fader_db', 'pan', 'mute', 'solo'];

function pruefeZeile(z: unknown, nr: number): Eintrag {
  const kaputt = (was: string): never => { throw new VerlaufFehler('verlauf_kaputt', `Zeile ${nr}: ${was}`); };
  if (z === null || typeof z !== 'object' || Array.isArray(z)) return kaputt('kein Objekt');
  const e = z as Record<string, unknown>;
  if (!Number.isInteger(e.rev) || (e.rev as number) < 1) kaputt('rev');
  if (typeof e.zeit !== 'string' || Number.isNaN(Date.parse(e.zeit))) kaputt('zeit');
  if (!QUELLEN.includes(e.quelle as string)) kaputt('quelle');
  if (typeof e.label !== 'string') kaputt('label');
  if (!ARTEN.includes(e.art as string)) kaputt('art');
  if (e.art === 'aendern' ? e.bezug !== null : !Number.isInteger(e.bezug)) kaputt('bezug');
  if (!Array.isArray(e.vor) || !Array.isArray(e.zurueck)) kaputt('vor/zurueck');
  return e as unknown as Eintrag;
}

const nurReplace = (...ps: Patch[]): boolean => ps.every((p) => p.every((o) => o.op === 'replace'));
// Zwei replace-Patches zu einem, je Pfad eine Operation: 'spaeter' nimmt bei gleichem Pfad die aus `neu`, 'frueher' die aus `alt`
function vereine(alt: Patch, neu: Patch, wer: 'spaeter' | 'frueher'): Patch {
  if (wer === 'spaeter') { const n = new Set(neu.map((o) => o.pfad)); return [...alt.filter((o) => !n.has(o.pfad)), ...neu]; }
  const a = new Set(alt.map((o) => o.pfad));
  return [...alt, ...neu.filter((o) => !a.has(o.pfad))];
}

export class Verlauf {
  private readonly datei: string;
  private readonly jetzt: () => number;
  private readonly fenster: number;
  private readonly zeitgeber: boolean;
  private readonly beiFehler: (e: Error) => void;
  private beiSchliesse: (() => void) | null;
  private readonly zeilen: Eintrag[] = [];                               // alle Einträge in Reihenfolge, der ausstehende zuletzt
  private readonly aendernMitRev = new Map<number, Eintrag>();
  private undoStapel: number[] = [];
  private redoStapel: number[] = [];
  private ausstehend: { eintrag: Eintrag; schluessel: string; letzteMs: number } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private geschlossen = false;                                           // nach schliesse(): die Sperre ist frei, schreiben verboten

  // Liest eine vorhandene Datei und stellt den Zeiger her. Fehlende Datei = leerer Verlauf. Eine abgeschnittene letzte Zeile (Absturz
  // mitten im Anhängen) wird abgeräumt; eine kaputte Zeile in der Mitte ist Beschädigung und wirft verlauf_kaputt.
  constructor(datei: string, o: VerlaufOptionen = {}) {
    this.datei = datei; this.jetzt = o.jetzt ?? Date.now; this.fenster = o.zusammenfassenMs ?? 1000; this.zeitgeber = o.zeitgeber ?? true;
    this.beiSchliesse = o.beiSchliesse ?? null;
    this.beiFehler = o.beiFehler ?? ((e) => { console.error(`Verlauf ${datei}: Schreiben fehlgeschlagen, Eintrag bleibt ausstehend: ${e.message}`); });
    let buf: Buffer;
    try { buf = fs.readFileSync(datei); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
    const ende = buf.lastIndexOf(0x0a);
    const rest = buf.subarray(ende + 1);
    if (rest.length > 0) {
      let heil = true;
      try { JSON.parse(rest.toString('utf8')); } catch { heil = false; }
      if (heil) fs.appendFileSync(datei, '\n'); else { fs.truncateSync(datei, ende + 1); buf = buf.subarray(0, ende + 1); }
    }
    const zeilen = buf.toString('utf8').split('\n').filter((z, i, a) => !(i === a.length - 1 && z === ''));
    let letzte = 0;
    zeilen.forEach((roh, i) => {
      let z: unknown;
      try { z = JSON.parse(roh); } catch { throw new VerlaufFehler('verlauf_kaputt', `Zeile ${i + 1}: kein JSON`); }
      const e = pruefeZeile(z, i + 1);
      if (e.rev <= letzte) throw new VerlaufFehler('verlauf_kaputt', `Zeile ${i + 1}: rev ${e.rev} steigt nicht (davor ${letzte})`);
      letzte = e.rev;
      this.einordnen(e, `Zeile ${i + 1}`);
      this.zeilen.push(e);
    });
  }

  // Zeiger fortschreiben; wirft verlauf_kaputt bei einem Widerspruch (Undo ohne passenden Vorgänger).
  private einordnen(e: Eintrag, wo: string): void {
    const kaputt = (was: string): never => { throw new VerlaufFehler('verlauf_kaputt', `${wo}: ${was}`); };
    if (e.art === 'aendern') { this.aendernMitRev.set(e.rev, e); this.undoStapel.push(e.rev); this.redoStapel = []; return; }
    if (!this.aendernMitRev.has(e.bezug as number)) kaputt(`bezug ${e.bezug} ist keine Änderung`);
    if (e.art === 'undo') {
      if (this.undoStapel.pop() !== e.bezug) kaputt(`Undo von ${e.bezug}, oben liegt etwas anderes`);
      this.redoStapel.push(e.bezug as number);
      return;
    }
    if (this.redoStapel.pop() !== e.bezug) kaputt(`Redo von ${e.bezug}, oben liegt etwas anderes`);
    this.undoStapel.push(e.bezug as number);
  }

  private letzteRev(): number { return this.zeilen.length ? this.zeilen[this.zeilen.length - 1].rev : 0; }
  // rev des letzten Eintrags (auch eines ausstehenden), 0 bei leerem Log. Projekte.verlauf() vergleicht sie mit project.json.
  stand(): number { return this.letzteRev(); }
  // Nach schliesse() hält niemand mehr die Sperre `.lauf`: ein Schreiben wäre ein zweiter Schreiber ohne Schutz (Re-Review S2-Kern).
  private offen(): void { if (this.geschlossen) throw new VerlaufFehler('verlauf_geschlossen', this.datei); }

  // Hängt eine Zeile an, vollständig und dauerhaft: Schleife bis zur vollen Länge, dann fsync. Scheitert etwas, wird die Datei auf die
  // alte Länge zurückgeschnitten (kein Zeilenfragment) und der Fehler geht weiter; der Speicherzustand ändert der Aufrufer erst danach.
  private schreibe(e: Eintrag): void {
    const zeile = Buffer.from(`${JSON.stringify(e)}\n`, 'utf8');
    const fd = fs.openSync(this.datei, 'a');
    try {
      const alt = fs.fstatSync(fd).size;
      try {
        let schon = 0;
        while (schon < zeile.length) {
          const n = fs.writeSync(fd, zeile, schon, zeile.length - schon);
          if (!(n > 0)) throw new Error(`writeSync schrieb ${n} Bytes`);
          schon += n;
        }
        fs.fsyncSync(fd);
      } catch (err) {
        try { fs.ftruncateSync(fd, alt); } catch { /* die Platte ist ohnehin kaputt: der Fehler unten bleibt der erste */ }
        throw err;
      }
    } finally { fs.closeSync(fd); }
  }

  // Wirft rev_nicht_steigend, ohne etwas zu verändern. Der Ablauf ruft das VOR dem Speichern von project.json.
  pruefeRev(rev: number): void {
    if (!Number.isInteger(rev) || rev <= this.letzteRev()) throw new VerlaufFehler('rev_nicht_steigend', `${rev} nach ${this.letzteRev()}`);
  }

  pruefeMeta(m: Meta): void {
    if (!m || !QUELLEN.includes(m.quelle)) throw new VerlaufFehler('quelle_ungueltig', 'andreas oder cypher erwartet');
    if (typeof m.label !== 'string' || m.label.trim() === '' || m.label.length > 200) throw new VerlaufFehler('label_ungueltig', '1 bis 200 Zeichen erwartet');
  }

  private iso = (): string => new Date(this.jetzt()).toISOString();

  private ablaufTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.zeitgeber || !this.ausstehend) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try { this.flush(); } catch (e) { this.beiFehler(e instanceof Error ? e : new Error(String(e))); }
    }, this.fenster);
    this.timer.unref();
  }

  // schluessel: nur bei Mixer-Bewegungen (z. B. "s1:fader_db" oder eine Rückweg-Geste "rueckweg:3"), sonst weglassen
  haengeAn(e: { rev: number; quelle: Quelle; label: string; vor: Patch; zurueck: Patch; schluessel?: string | null }): Eintrag {
    this.offen();
    this.pruefeMeta(e);
    this.pruefeRev(e.rev);
    const jetzt = this.jetzt();
    const a = this.ausstehend;
    if (a && e.schluessel && a.schluessel === e.schluessel && a.eintrag.quelle === e.quelle && jetzt - a.letzteMs <= this.fenster
      && nurReplace(a.eintrag.vor, a.eintrag.zurueck, e.vor, e.zurueck)) {
      this.aendernMitRev.delete(a.eintrag.rev);
      // je Pfad: das erste zurueck bleibt, das letzte vor gewinnt (bei einem Pfad wie bisher: erstes zurueck, letztes vor)
      Object.assign(a.eintrag, { rev: e.rev, zeit: this.iso(), label: e.label,
        vor: vereine(a.eintrag.vor, e.vor, 'spaeter'), zurueck: vereine(a.eintrag.zurueck, e.zurueck, 'frueher') });
      this.undoStapel[this.undoStapel.length - 1] = e.rev;
      this.aendernMitRev.set(e.rev, a.eintrag);
      a.letzteMs = jetzt; this.ablaufTimer();
      return a.eintrag;
    }
    this.flush();                                                          // wirft, wenn der ausstehende Eintrag nicht geschrieben werden kann
    const eintrag: Eintrag = { rev: e.rev, zeit: this.iso(), quelle: e.quelle, label: e.label, art: 'aendern', bezug: null, vor: e.vor, zurueck: e.zurueck };
    if (!e.schluessel) this.schreibe(eintrag);                             // erst auf die Platte, dann in den Speicher
    this.zeilen.push(eintrag); this.aendernMitRev.set(eintrag.rev, eintrag); this.undoStapel.push(eintrag.rev); this.redoStapel = [];
    if (e.schluessel) { this.ausstehend = { eintrag, schluessel: e.schluessel, letzteMs: jetzt }; this.ablaufTimer(); }
    return eintrag;
  }

  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const a = this.ausstehend;
    if (!a) return;
    this.schreibe(a.eintrag);
    this.ausstehend = null;
  }
  // Schreibt Ausstehendes und gibt Betriebsmittel frei (Sperre). Mehrfaches Schliessen ist erlaubt. Scheitert das Schreiben, wird trotzdem
  // freigegeben und der Fehler weitergereicht.
  schliesse(): void {
    if (this.geschlossen) return;
    try { this.flush(); } finally { this.geschlossen = true; const f = this.beiSchliesse; this.beiSchliesse = null; f?.(); }
  }

  // Einträge mit rev > `rev`, in Reihenfolge (für das Nachziehen eines Projekts, das dem Log hinterherläuft)
  eintraegeNach(rev: number): Eintrag[] { return this.zeilen.filter((e) => e.rev > rev); }

  kannUndo(): boolean { return this.undoStapel.length > 0; }
  kannRedo(): boolean { return this.redoStapel.length > 0; }
  zeiger(): { undo: number[]; redo: number[] } { return { undo: [...this.undoStapel], redo: [...this.redoStapel] }; }
  liste(): { rev: number; zeit: string; quelle: Quelle; label: string; art: EintragArt }[] {
    return this.zeilen.map((e) => ({ rev: e.rev, zeit: e.zeit, quelle: e.quelle, label: e.label, art: e.art }));
  }

  // Die Änderung, die ein Undo/Redo zurücknehmen/wiederholen würde (schreibt eine hängende Bewegung zuerst).
  naechstesUndo(): Eintrag {
    this.flush();
    const rev = this.undoStapel[this.undoStapel.length - 1];
    if (rev === undefined) throw new VerlaufFehler('nichts_zu_tun', 'nichts zum Rückgängigmachen');
    return this.aendernMitRev.get(rev)!;
  }
  naechstesRedo(): Eintrag {
    this.flush();
    const rev = this.redoStapel[this.redoStapel.length - 1];
    if (rev === undefined) throw new VerlaufFehler('nichts_zu_tun', 'nichts zum Wiederholen');
    return this.aendernMitRev.get(rev)!;
  }

  // Eintrag für ein vollzogenes Undo/Redo schreiben. `ziel` ist die Änderung aus naechstesUndo/naechstesRedo.
  protokolliere(art: 'undo' | 'redo', ziel: Eintrag, rev: number, quelle: Quelle): Eintrag {
    this.offen();
    this.pruefeMeta({ quelle, label: 'x' });
    this.pruefeRev(rev);
    const oben = (art === 'undo' ? this.undoStapel : this.redoStapel).at(-1);
    if (oben !== ziel.rev) throw new VerlaufFehler('verlauf_inkonsistent', `${art} von ${ziel.rev}, oben liegt ${oben}`);
    const e: Eintrag = art === 'undo'
      ? { rev, zeit: this.iso(), quelle, label: `Undo: ${ziel.label}`, art, bezug: ziel.rev, vor: ziel.zurueck, zurueck: ziel.vor }
      : { rev, zeit: this.iso(), quelle, label: `Redo: ${ziel.label}`, art, bezug: ziel.rev, vor: ziel.vor, zurueck: ziel.zurueck };
    this.schreibe(e);                                                      // erst auf die Platte, dann Zeiger und Liste
    this.einordnen(e, `${art} ${ziel.rev}`);
    this.zeilen.push(e);
    return e;
  }
}

// --- Ablauf aus Projekt + Verlauf -------------------------------------------------------------------------------------
// Diese Funktionen sind der Weg, auf dem ein Server das Projekt ändert: sie verbinden Befehle, Verlauf und rev. Das Speichern
// (ablage.ts) macht der Aufrufer über den Haken `speichere` (fsync auf Datei und Verzeichnis): er läuft, wenn der neue Stand feststeht,
// BEVOR der Eintrag in undo.jsonl geschrieben wird (Spec 6.7). Ein Absturz dazwischen lässt project.json eine Änderung weiter als das Log
// (Undo-Eintrag fehlt, rev bleibt steigend, nichts widerspricht sich). Scheitert das Log, schreibt der Ablauf den alten Stand zurück,
// damit Platte und Aufrufer (der sein altes Projekt behält) übereinstimmen. Läuft nach einem Stromausfall trotzdem das Log dem Projekt
// voraus, zieht `zieheNach` es beim Öffnen aus dem Log nach (Projekte.oeffne).
// `dekodiert`: Patches tragen den abgeleiteten Zustand der Audio-Clips nicht (Spec 6.6); nach Undo/Redo setzt dieser Haken ihn neu.
export interface Haken { speichere?: (neu: Projekt) => void; dekodiert?: (sha256: string) => DekodiertZustand }

// Nur eine einzelne Reglerbewegung (ein Befehl mit genau einem Mixer-Feld) ist zusammenfassbar: spur_aendern (spur_id), seit 1.10 auch
// gruppenspur_aendern (gruppe_id) und master_aendern (der Produktions-Master hat nur fader_db). Name, Farbe und gefaltet sind keine Mixer-Felder.
function mixerSchluessel(befehle: unknown[]): string | null {
  if (befehle.length !== 1) return null;
  const b = befehle[0] as Record<string, unknown>;
  if (!b) return null;
  const idFeld = b.befehl === 'spur_aendern' ? 'spur_id' : b.befehl === 'gruppenspur_aendern' ? 'gruppe_id' : b.befehl === 'master_aendern' ? '' : null;
  if (idFeld === null || (idFeld !== '' && typeof b[idFeld] !== 'string')) return null;
  const rest = Object.keys(b).filter((k) => k !== 'befehl' && k !== idFeld);
  return rest.length === 1 && MIXER_FELDER.includes(rest[0]) ? `${idFeld === '' ? 'master' : String(b[idFeld])}:${rest[0]}` : null;
}

// speichern, dann ins Log; scheitert das Log, steht project.json wieder auf `alt`. Vertrag (sitzung.ts vollziehe hängt daran, Spec 6.31): speichere
// zuerst genau einmal mit `neu`, höchstens danach einmal mit `alt`.
function speichereDannProtokolliere<T>(haken: Haken, alt: Projekt, neu: Projekt, protokoll: () => T): T {
  haken.speichere?.(neu);
  try { return protokoll(); } catch (e) {
    try { haken.speichere?.(alt); } catch { /* auch das Zurückschreiben scheitert: das Projekt bleibt dem Log voraus, das ist beim Öffnen unkritisch */ }
    throw e;
  }
}

// o.schluessel: Schlüssel zum Zusammenfassen statt des aus dem Befehl abgeleiteten (Rückweg-Geste, Spec 6.30)
// o.ergebnis (Spec 6.31, Leistung): fuehreListeAus(projekt, befehle, {quelle: meta.quelle}), schon gerechnet (die Probe des Servers).
// Wird o.ergebnis übergeben, gilt es ungeprüft; ohne o.ergebnis rechnet aendere selbst. Die Gültigkeit sichert vollziehe (o.projekt !== alt).
export function aendere(v: Verlauf, projekt: Projekt, befehle: Befehl[], meta: Meta, haken: Haken = {},
  o: { schluessel?: string; ergebnis?: BefehlErgebnis } = {}): Wirkung {
  v.pruefeMeta(meta);
  const r = o.ergebnis ?? fuehreListeAus(projekt, befehle, { quelle: meta.quelle });
  if (r.vor.length === 0) return { projekt, eintrag: null, betrifft_wiedergabe: false, regler_aenderungen: [] };
  const neu = r.projekt; neu.rev = projekt.rev + 1;
  v.pruefeRev(neu.rev);                                                    // vor dem Speichern: ein veralteter Stand schreibt nichts
  const schluessel = o.schluessel ?? (r.vor.length === 1 ? mixerSchluessel(befehle) : null);
  const eintrag = speichereDannProtokolliere(haken, projekt, neu,
    () => v.haengeAn({ rev: neu.rev, quelle: meta.quelle, label: meta.label, vor: r.vor, zurueck: r.zurueck, schluessel }));
  return { projekt: neu, eintrag, betrifft_wiedergabe: r.betrifft_wiedergabe, regler_aenderungen: r.regler_aenderungen };
}

// Spec 6.31 (Leistung): schon gerechneter Stand eines Undo/Redo (die Probe des Servers): wende(projekt, Patch von `ziel`) und vergleiche(projekt, ·).
// Gilt nur für genau diesen Eintrag (Identität); sonst rechnet umkehren selbst.
export interface UmkehrProbe { ziel: Eintrag; stand: Projekt; vergleich: { betrifft_wiedergabe: boolean; regler_aenderungen: ReglerAenderung[] } }

function umkehren(v: Verlauf, projekt: Projekt, meta: { quelle: Quelle }, art: 'undo' | 'redo', haken: Haken, probe?: UmkehrProbe): Wirkung {
  const ziel = art === 'undo' ? v.naechstesUndo() : v.naechstesRedo();
  const vorab = probe && probe.ziel === ziel ? probe : undefined;
  let neu: Projekt;
  try {
    neu = vorab ? vorab.stand : wende(projekt, art === 'undo' ? ziel.zurueck : ziel.vor);
    uebernimmNotenZaehler(neu);                     // Spec 6.28: ein Clip aus einem Log des ersten S2int-Baus bringt einen Clip-Zähler mit
    const fehler = pruefeFehler(neu);
    if (fehler !== null) throw new VerlaufFehler('verlauf_inkonsistent', fehler);
  } catch (e) {
    if (e instanceof PatchFehler) throw new VerlaufFehler('verlauf_inkonsistent', `${art} von ${ziel.rev}: ${e.message}`);
    throw e;
  }
  if (haken.dekodiert) setzeDekodiert(neu, haken.dekodiert);
  neu.rev = projekt.rev + 1;
  v.pruefeRev(neu.rev);
  const eintrag = speichereDannProtokolliere(haken, projekt, neu, () => v.protokolliere(art, ziel, neu.rev, meta.quelle));
  const { betrifft_wiedergabe, regler_aenderungen } = vorab ? vorab.vergleich : vergleiche(projekt, neu);
  return { projekt: neu, eintrag, betrifft_wiedergabe, regler_aenderungen };
}
export const rueckgaengig = (v: Verlauf, projekt: Projekt, meta: { quelle: Quelle }, haken: Haken = {}, probe?: UmkehrProbe): Wirkung =>
  umkehren(v, projekt, meta, 'undo', haken, probe);
export const wiederholen = (v: Verlauf, projekt: Projekt, meta: { quelle: Quelle }, haken: Haken = {}, probe?: UmkehrProbe): Wirkung =>
  umkehren(v, projekt, meta, 'redo', haken, probe);

// Nachziehen (Spec 6.7): Läuft das Log dem Projekt voraus (project.json auf der Platte älter als das Log, etwa nach einem Stromausfall),
// werden die Einträge mit rev > projekt.rev der Reihe nach angewendet (jeder Eintrag trägt in `vor` seine Änderung, Undo und Redo auch).
// Die Zusammenfassung von Mixer-Bewegungen erzeugt Lücken in den revs, aber nur absolute replace-Werte, die auf dem früheren Stand gelten.
// Ein Eintrag, der sich nicht anwenden lässt, ist verlauf_inkonsistent: geraten wird nicht.
export function zieheNach(v: Verlauf, projekt: Projekt): { projekt: Projekt; angewendet: number } {
  const offen = v.eintraegeNach(projekt.rev);
  if (offen.length === 0) return { projekt, angewendet: 0 };
  let p = projekt;
  for (const e of offen) {
    try { p = wende(p, e.vor); } catch (x) {
      if (x instanceof PatchFehler) throw new VerlaufFehler('verlauf_inkonsistent', `Nachziehen von rev ${e.rev}: ${x.message}`);
      throw x;
    }
    p.rev = e.rev;
  }
  uebernimmNotenZaehler(p);                                                // Spec 6.28, wie in umkehren
  hebeZaehler(p, offen);                                                   // Spec 6.35: Zähler über jede ID der nachgezogenen Einträge
  const fehler = pruefeFehler(p);
  if (fehler !== null) throw new VerlaufFehler('verlauf_inkonsistent', `Nachziehen bis rev ${p.rev}: ${fehler}`);
  return { projekt: p, angewendet: offen.length };
}

// Spec 6.35 (zu 6.7, 6.26): Die Zähler stehen in keinem Patch, das Nachziehen allein brächte eine angelegte und wieder gelöschte ID nach einem
// Absturz zurück. Deshalb hebt es die Zähler über jede ID, die ein nachgezogener Eintrag nennt: in den Pfaden (/spuren/<s>/clips/<c>/noten/<n>)
// und in den Werten eines add oder replace (eine ganze Spur, ein Clip, eine Note), in vor und zurück (ein Undo-Eintrag löscht in vor, was er
// anlegte). Gezählt werden nur IDs der Form s<n>, c<n>, n<n> (wie hoechste in modell.ts). Die Zähler steigen nur.
function hebeZaehler(p: Projekt, eintraege: readonly Eintrag[]): void {
  const m = { s: 0, c: 0, n: 0 };
  const nimm = (praefix: 's' | 'c' | 'n', id: unknown): void => {
    if (typeof id === 'string' && id.length > 1 && id[0] === praefix && /^\d+$/.test(id.slice(1))) m[praefix] = Math.max(m[praefix], Number(id.slice(1)));
  };
  const note = (x: unknown): void => { if (istObjekt(x)) nimm('n', x.id); };
  const clip = (x: unknown): void => { if (!istObjekt(x)) return; nimm('c', x.id); if (Array.isArray(x.noten)) x.noten.forEach(note); };
  const spur = (x: unknown): void => { if (!istObjekt(x)) return; nimm('s', x.id); if (Array.isArray(x.clips)) x.clips.forEach(clip); };
  for (const e of eintraege) {
    for (const o of [...e.vor, ...e.zurueck]) {
      if (typeof o?.pfad !== 'string') continue;
      const seg = o.pfad.split('/').slice(1);
      if (seg[0] !== 'spuren') continue;
      nimm('s', seg[1]);
      if (seg[2] === 'clips') nimm('c', seg[3]);
      if (seg[2] === 'clips' && seg[4] === 'noten') nimm('n', seg[5]);
      if (o.wert === undefined) continue;
      if (seg.length === 2) spur(o.wert);
      else if (seg.length === 4 && seg[2] === 'clips') clip(o.wert);
      else if (seg.length === 6 && seg[4] === 'noten') note(o.wert);
    }
  }
  const z = p.naechste_id;
  const gehoben = { spur: Math.max(z?.spur ?? 1, m.s + 1), clip: Math.max(z?.clip ?? 1, m.c + 1) };
  p.naechste_id = { ...z, ...gehoben };
  p.naechste_noten_id = Math.max(notenZaehler(p), m.n + 1);
}
