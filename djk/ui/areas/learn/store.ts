// S19 (MIDI learn): the learn table <controller folder>/lernen.json, a normal Mapping-v1 file (INTERFACES 7.2) with the reserved device
// name "lernen". The kern translates midi_ein_1 with it (slot 1). This store reads and writes it: entries the server writes carry no
// "kurve" (default curve of the control), one entry per line, atomically, with a .bak of the previous file. A file that does not parse or
// has the wrong shape is reported ("kaputt") and never overwritten; entries the server did not write survive every change unchanged.
import fs from 'node:fs';
import path from 'node:path';
import { schreibeAtomar } from '../devices/edges.ts';

export class LernFehler extends Error {
  readonly grund: string;
  readonly code: number;
  readonly text: string;
  constructor(grund: string, code = 400, text = '') { super(text ? `${grund}: ${text}` : grund); this.grund = grund; this.code = code; this.text = text; }
}
export interface Zuordnung { pfad: string; kanal: number; nr: number }
export type Eintrag = Record<string, unknown>;
export interface Stand { datei: 'fehlt' | 'ok' | 'kaputt'; eintraege: Eintrag[]; zuordnungen: Zuordnung[] }

const istObjekt = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

// a CC entry as the learn flow writes it: absolute, on a graph knob
function alsZuordnung(e: Eintrag): Zuordnung | null {
  const n = e.nachricht;
  if (!istObjekt(n) || n.typ !== 'cc' || e.art !== 'absolut' || typeof e.ziel !== 'string' || !/\/bk\/[1-8]$/.test(e.ziel)) return null;
  if (!Number.isInteger(n.kanal) || !Number.isInteger(n.nr)) return null;
  return { pfad: e.ziel, kanal: n.kanal as number, nr: n.nr as number };
}

export class LernSpeicher {
  readonly ordner: string;
  readonly datei: string;
  private hatteKeine = false;   // the file did not exist before the last write: a restore removes it
  constructor(ordner: string) { this.ordner = ordner; this.datei = path.join(ordner, 'lernen.json'); }

  lies(): Stand {
    let text: string;
    try { text = fs.readFileSync(this.datei, 'utf8'); } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { datei: 'fehlt', eintraege: [], zuordnungen: [] };
      return { datei: 'kaputt', eintraege: [], zuordnungen: [] };
    }
    let j: unknown;
    try { j = JSON.parse(text); } catch { return { datei: 'kaputt', eintraege: [], zuordnungen: [] }; }
    if (!istObjekt(j) || j.version !== 1 || j.geraet !== 'lernen' || typeof j.quelle_port !== 'string' || !Array.isArray(j.eintraege) || !j.eintraege.every(istObjekt)) {
      return { datei: 'kaputt', eintraege: [], zuordnungen: [] };
    }
    const eintraege = j.eintraege as Eintrag[];
    return { datei: 'ok', eintraege, zuordnungen: eintraege.map(alsZuordnung).filter((z): z is Zuordnung => z !== null) };
  }

  private text(eintraege: Eintrag[]): string {
    const kopf = '{"version":1,"geraet":"lernen","quelle_port":"midi_ein_1","eintraege":[\n';
    return kopf + eintraege.map((e) => ` ${JSON.stringify(e)}`).join(',\n') + (eintraege.length ? '\n' : '') + ']}\n';
  }

  private schreibe(eintraege: Eintrag[]): void {
    const vorhanden = fs.existsSync(this.datei);
    this.hatteKeine = !vorhanden;
    if (vorhanden) fs.copyFileSync(this.datei, `${this.datei}.bak.${process.pid}`), fs.renameSync(`${this.datei}.bak.${process.pid}`, `${this.datei}.bak`);
    schreibeAtomar(this.datei, this.text(eintraege));
  }

  private gesund(): Stand {
    const s = this.lies();
    if (s.datei === 'kaputt') throw new LernFehler('lernen_datei_kaputt', 409);
    return s;
  }

  // One CC <-> one knob: a new assignment removes any entry with the same CC and any entry with the same target.
  zuordne(z: Zuordnung): void {
    const s = this.gesund();
    const rest = s.eintraege.filter((e) => {
      const n = e.nachricht;
      const gleicheCc = istObjekt(n) && n.typ === 'cc' && n.kanal === z.kanal && n.nr === z.nr;
      return !gleicheCc && e.ziel !== z.pfad;
    });
    rest.push({ nachricht: { typ: 'cc', kanal: z.kanal, nr: z.nr }, ziel: z.pfad, art: 'absolut' });
    this.schreibe(rest);
  }

  loesche(pfad: string): void {
    const s = this.gesund();
    const rest = s.eintraege.filter((e) => e.ziel !== pfad);
    if (rest.length === s.eintraege.length) throw new LernFehler('keine_zuordnung', 404);
    this.schreibe(rest);
  }

  // The kern refused the new file: put the previous one back (or remove the one we just created).
  stelleWiederHer(): void {
    const bak = `${this.datei}.bak`;
    if (this.hatteKeine) { fs.rmSync(this.datei, { force: true }); return; }
    if (fs.existsSync(bak)) schreibeAtomar(this.datei, fs.readFileSync(bak, 'utf8'));
  }
}
