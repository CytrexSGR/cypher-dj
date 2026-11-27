// Agent call log (strand 9): one JSONL line per tool call and per refusal. Never headers, bodies or tokens.
// A disk failure is reported once per line on stderr and never reaches the request path.
import fs from 'node:fs';
import path from 'node:path';

export interface HandLogZeile {
  t: number; id: string; name: string; werkzeug: string | null; aktion: string | null;
  methode: string; pfad: string; code: number; ok: boolean; fehler?: string;
}

const MEMO_MAX = 200;
const FELDER = ['t', 'id', 'name', 'werkzeug', 'aktion', 'methode', 'pfad', 'code', 'ok', 'fehler'] as const;

export class HandLog {
  readonly datei: string;
  private readonly alt: string;
  private readonly speicher: HandLogZeile[] = [];
  private readonly ordner: string;
  private readonly maxBytes: number;

  constructor(ordner: string, maxBytes = 1 << 20) {
    this.ordner = ordner;
    this.maxBytes = maxBytes;
    this.datei = path.join(ordner, 'hand.jsonl');
    this.alt = `${this.datei}.1`;
    try {   // the last lines survive a restart, so the page panel is not empty after one
      const zeilen = fs.readFileSync(this.datei, 'utf8').split('\n').filter(Boolean).slice(-MEMO_MAX);
      for (const z of zeilen) { try { this.speicher.push(JSON.parse(z)); } catch { /* torn line */ } }
    } catch { /* no file yet */ }
  }

  schreibe(zeile: HandLogZeile): void {
    const sauber: Record<string, unknown> = {};
    for (const k of FELDER) if (zeile[k] !== undefined) sauber[k] = zeile[k];   // whitelist: nothing else can leak into the file
    this.speicher.push(sauber as unknown as HandLogZeile);
    if (this.speicher.length > MEMO_MAX) this.speicher.shift();
    try {
      fs.mkdirSync(this.ordner, { recursive: true, mode: 0o700 });
      let gross = false;
      try { gross = fs.statSync(this.datei).size > this.maxBytes; } catch { /* not there yet */ }
      if (gross) fs.renameSync(this.datei, this.alt);
      fs.appendFileSync(this.datei, `${JSON.stringify(sauber)}\n`, { mode: 0o600 });
    } catch (e) {
      process.stderr.write(`hand_log: write failed: ${(e as Error).message}\n`);
    }
  }

  /** The last n lines, oldest first. */
  letzte(n: number): HandLogZeile[] {
    return this.speicher.slice(-Math.max(0, n));
  }
}

const kopfText = (v: string | string[] | undefined): string | null => {
  const t = Array.isArray(v) ? v[0] : v;
  return typeof t === 'string' && /^[\x20-\x7e]{1,64}$/.test(t) ? t : null;
};

/** Tool, action and call id for the log: the parsed request when task 3.3 filled it, else the hand's headers. Only these three headers are read. */
export function handLogKopf(q: { headers: Record<string, string | string[] | undefined> },
  a: { werkzeug: string | null; aktion: string | null; aufruf: string | null }): { werkzeug: string | null; aktion: string | null; aufruf: string | null } {
  return {
    werkzeug: a.werkzeug ?? kopfText(q.headers['x-djk-werkzeug']),
    aktion: a.aktion ?? kopfText(q.headers['x-djk-aktion']),
    aufruf: a.aufruf ?? kopfText(q.headers['x-djk-aufruf']),
  };
}
