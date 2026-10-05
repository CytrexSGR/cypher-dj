// Set-Journal nach SCHNITTSTELLEN §15: eine JSON-Zeile je Ereignis, synchron geschrieben (ein kill -9
// verliert höchstens die Zeile, die gerade entsteht). sample, beat, takt sind null, solange der Leitstand
// noch keine Kern-Zeit kennt. Erste Zeile einer neuen Datei ist set_start; hängt ein neuer Lauf an eine
// vorhandene Datei an (gleiche set_id), beginnt sein Teil mit "fortsetzung" (gleiche Felder).
import fs from 'node:fs';
import path from 'node:path';

export type Von = 'kern' | 'leitstand' | 'spieler' | 'analyse' | 'werkstatt' | 'notbahn' | 'andreas';

export interface JournalZeile {
  sample: number | null;
  beat: number | null;
  takt: number | null;
  mono_ns: number;
  von: Von;
  typ: string;
  daten: Record<string, unknown>;
}

export const SET_ID_FORM = /^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{4}$/;

// set_id nach §9.2-Beispiel "2026-09-24_2100", Ortszeit.
export function setIdAus(d: Date): string {
  const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}`;
}

export class Journal {
  readonly pfad: string;
  readonly setId: string;
  private fd: number | null = null;
  private puffer: string[] = [];
  private verworfen = 0;
  zeilen = 0; // in diesem Lauf geschrieben
  static readonly PUFFER_MAX = 10000;

  constructor(setsPfad: string, setId: string) {
    if (!SET_ID_FORM.test(setId)) throw new Error(`set_id ${setId} hat nicht die Form JJJJ-MM-TT_hhmm (§9.2)`);
    this.setId = setId;
    this.pfad = path.join(setsPfad, setId, 'journal.jsonl');
  }

  get offen(): boolean { return this.fd !== null; }

  // Öffnet die Datei zum Anhängen und schreibt set_start (neue Datei) bzw. fortsetzung vor allen
  // gepufferten Zeilen.
  oeffne(start: JournalZeile): void {
    if (this.fd !== null) throw new Error('Journal ist schon offen');
    fs.mkdirSync(path.dirname(this.pfad), { recursive: true });
    const neu = !fs.existsSync(this.pfad) || fs.statSync(this.pfad).size === 0;
    this.fd = fs.openSync(this.pfad, 'a');
    this.roh(JSON.stringify({ ...start, typ: neu ? 'set_start' : 'fortsetzung' }));
    for (const z of this.puffer) this.roh(z);
    this.puffer = [];
    if (this.verworfen > 0) {
      this.roh(JSON.stringify({ ...start, typ: 'journal_verworfen', daten: { anzahl: this.verworfen } }));
      this.verworfen = 0;
    }
  }

  // Vor oeffne() wird gepuffert (set_start muss die erste Zeile sein, §15), höchstens PUFFER_MAX Zeilen.
  schreibe(z: JournalZeile): void {
    const text = JSON.stringify(z);
    if (this.fd === null) {
      if (this.puffer.length >= Journal.PUFFER_MAX) { this.puffer.shift(); this.verworfen++; }
      this.puffer.push(text);
      return;
    }
    this.roh(text);
  }

  private roh(text: string): void {
    fs.writeSync(this.fd as number, text + '\n');
    this.zeilen++;
  }

  schliesse(): void {
    if (this.fd !== null) { fs.closeSync(this.fd); this.fd = null; }
  }
}
