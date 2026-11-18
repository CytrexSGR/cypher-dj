// S19 (MIDI learn): the learn tables in the controller folder, normal Mapping-v1 files (INTERFACES 7.2). The kern has eight raw MIDI inputs
// midi_ein_1..8 and one table per input (slot = place): place 1 is lernen.json with the reserved device name "lernen", the places 2..8 are
// lernen-<k>.json with the name "lernen-<k>". A learned CC therefore belongs to the device on that place; two controllers that send the same CC
// do not collide. This store reads and writes the files: entries the server writes carry no "kurve" (default curve of the control), one entry
// per line, atomically, with a .bak of the previous file. A file that does not parse or has the wrong shape is reported ("kaputt") and never
// overwritten; entries the server did not write survive every change unchanged.
import fs from 'node:fs';
import path from 'node:path';
import { schreibeAtomar } from '../devices/edges.ts';

export class LernFehler extends Error {
  readonly grund: string;
  readonly code: number;
  readonly text: string;
  constructor(grund: string, code = 400, text = '') { super(text ? `${grund}: ${text}` : grund); this.grund = grund; this.code = code; this.text = text; }
}
export const PLAETZE = 8;
/** Device name of a place for /k/mapping and the file name without .json: place 1 keeps the reserved name "lernen". */
export const lernName = (platz: number): string => (platz === 1 ? 'lernen' : `lernen-${platz}`);
export interface Zuordnung { pfad: string; kanal: number; nr: number; platz: number }
export type Eintrag = Record<string, unknown>;
// eintraege: the raw entries of all places one after the other (reading only); zuordnungen: the CC entries with their place
export interface Stand { datei: 'fehlt' | 'ok' | 'kaputt'; eintraege: Eintrag[]; zuordnungen: Zuordnung[] }
interface PlatzStand { datei: 'fehlt' | 'ok' | 'kaputt'; eintraege: Eintrag[] }

const istObjekt = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const gleicheCc = (e: Eintrag, kanal: number, nr: number): boolean => { const n = e.nachricht; return istObjekt(n) && n.typ === 'cc' && n.kanal === kanal && n.nr === nr; };

// a CC entry as the learn flow writes it: absolute, on any target (graph knob or continuous control)
function alsZuordnung(e: Eintrag, platz: number): Zuordnung | null {
  const n = e.nachricht;
  if (!istObjekt(n) || n.typ !== 'cc' || e.art !== 'absolut' || typeof e.ziel !== 'string') return null;
  if (!Number.isInteger(n.kanal) || !Number.isInteger(n.nr)) return null;
  return { pfad: e.ziel, kanal: n.kanal as number, nr: n.nr as number, platz };
}

export class LernSpeicher {
  readonly ordner: string;
  readonly datei: string;                              // the file of place 1 (kept for callers that name it)
  private readonly hatteKeine = new Set<number>();     // places whose file did not exist before the last write: a restore removes it
  constructor(ordner: string) { this.ordner = ordner; this.datei = this.pfad(1); }
  pfad(platz: number): string { return path.join(this.ordner, `${lernName(platz)}.json`); }

  private liesPlatz(platz: number): PlatzStand {
    let text: string;
    try { text = fs.readFileSync(this.pfad(platz), 'utf8'); } catch (e) {
      return { datei: (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'fehlt' : 'kaputt', eintraege: [] };
    }
    let j: unknown;
    try { j = JSON.parse(text); } catch { return { datei: 'kaputt', eintraege: [] }; }
    if (!istObjekt(j) || j.version !== 1 || j.geraet !== lernName(platz) || typeof j.quelle_port !== 'string' || !Array.isArray(j.eintraege) || !j.eintraege.every(istObjekt)) {
      return { datei: 'kaputt', eintraege: [] };
    }
    return { datei: 'ok', eintraege: j.eintraege as Eintrag[] };
  }

  // All places together. One damaged file makes the whole state "kaputt": learning is refused until it is repaired, nothing is overwritten.
  lies(): Stand {
    const alle = Array.from({ length: PLAETZE }, (_, i) => ({ platz: i + 1, ...this.liesPlatz(i + 1) }));
    if (alle.some((p) => p.datei === 'kaputt')) return { datei: 'kaputt', eintraege: [], zuordnungen: [] };
    if (alle.every((p) => p.datei === 'fehlt')) return { datei: 'fehlt', eintraege: [], zuordnungen: [] };
    return { datei: 'ok', eintraege: alle.flatMap((p) => p.eintraege),
      zuordnungen: alle.flatMap((p) => p.eintraege.map((e) => alsZuordnung(e, p.platz)).filter((z): z is Zuordnung => z !== null)) };
  }

  private text(platz: number, eintraege: Eintrag[]): string {
    const kopf = `{"version":1,"geraet":"${lernName(platz)}","quelle_port":"midi_ein_${platz}","eintraege":[\n`;
    return kopf + eintraege.map((e) => ` ${JSON.stringify(e)}`).join(',\n') + (eintraege.length ? '\n' : '') + ']}\n';
  }

  private schreibe(platz: number, eintraege: Eintrag[]): void {
    const datei = this.pfad(platz), vorhanden = fs.existsSync(datei);
    if (vorhanden) this.hatteKeine.delete(platz); else this.hatteKeine.add(platz);
    if (vorhanden) fs.copyFileSync(datei, `${datei}.bak.${process.pid}`), fs.renameSync(`${datei}.bak.${process.pid}`, `${datei}.bak`);
    schreibeAtomar(datei, this.text(platz, eintraege));
  }

  private gesund(): PlatzStand[] {
    const alle = Array.from({ length: PLAETZE }, (_, i) => this.liesPlatz(i + 1));
    if (alle.some((p) => p.datei === 'kaputt')) throw new LernFehler('lernen_datei_kaputt', 409);
    return alle;
  }

  // One CC of one device <-> one knob: a new assignment removes the entry with the same CC on its place and every entry with the same target on
  // any place. Answers the places whose file changed (the kern reloads exactly those).
  zuordne(z: Omit<Zuordnung, 'platz'> & { platz?: number }): number[] {
    const ziel = z.platz ?? 1, alle = this.gesund(), geaendert: number[] = [];
    alle.forEach((p, i) => {
      const platz = i + 1;
      const rest = p.eintraege.filter((e) => e.ziel !== z.pfad && !(platz === ziel && gleicheCc(e, z.kanal, z.nr)));
      if (platz === ziel) rest.push({ nachricht: { typ: 'cc', kanal: z.kanal, nr: z.nr }, ziel: z.pfad, art: 'absolut' });
      else if (rest.length === p.eintraege.length) return;
      this.schreibe(platz, rest);
      geaendert.push(platz);
    });
    return geaendert;
  }

  loesche(pfad: string): number[] {
    const alle = this.gesund(), geaendert: number[] = [];
    alle.forEach((p, i) => {
      const rest = p.eintraege.filter((e) => e.ziel !== pfad);
      if (rest.length === p.eintraege.length) return;
      this.schreibe(i + 1, rest);
      geaendert.push(i + 1);
    });
    if (geaendert.length === 0) throw new LernFehler('keine_zuordnung', 404);
    return geaendert;
  }

  // The kern refused a new file: put the previous ones back (or remove the ones we just created). Without places: place 1.
  stelleWiederHer(plaetze: number[] = [1]): void {
    for (const platz of plaetze) {
      const datei = this.pfad(platz), bak = `${datei}.bak`;
      if (this.hatteKeine.has(platz)) { fs.rmSync(datei, { force: true }); continue; }
      if (fs.existsSync(bak)) schreibeAtomar(datei, fs.readFileSync(bak, 'utf8'));
    }
  }
}
