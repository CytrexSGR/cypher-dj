// R7: page errors are kept. The page hook (public/page_error.js) posts every uncaught error and unhandled rejection; this keeps them in a
// rotating file in the page server's state folder (seitenfehler.jsonl, at most two files, 1 MB each). Nothing is shown in the page.
import fs from 'node:fs';
import path from 'node:path';
import type http from 'node:http';
import type { Route } from './http/router.ts';
import { json } from './http/transport.ts';

export const MELDUNG_MAX = 500;
export const DATEI_MAX = 300;
const KOERPER_MAX = 65536;

type Ergebnis = { ok: true } | { ok: false; grund: 'ungueltig' | 'zu_viele' };
const kurz = (v: unknown, n: number): string => String(v ?? '').slice(0, n);
const zahl = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null);

export class Seitenfehler {
  private readonly datei: string;
  private readonly maxBytes: number;
  private readonly proMinute: number;
  private readonly jetzt: () => number;
  private zeiten: number[] = [];

  constructor(ordner: string, opt: { maxBytes?: number; proMinute?: number; jetzt?: () => number } = {}) {
    this.datei = path.join(ordner, 'seitenfehler.jsonl');
    this.maxBytes = opt.maxBytes ?? 1_048_576;
    this.proMinute = opt.proMinute ?? 50;
    this.jetzt = opt.jetzt ?? Date.now;
  }

  schreibe(e: unknown): Ergebnis {
    if (typeof e !== 'object' || e === null || Array.isArray(e)) return { ok: false, grund: 'ungueltig' };
    const o = e as Record<string, unknown>;
    if (typeof o.meldung !== 'string') return { ok: false, grund: 'ungueltig' };
    const jetzt = this.jetzt();
    this.zeiten = this.zeiten.filter((t) => jetzt - t < 60_000);
    if (this.zeiten.length >= this.proMinute) return { ok: false, grund: 'zu_viele' };
    this.zeiten.push(jetzt);
    const zeile = JSON.stringify({
      meldung: kurz(o.meldung, MELDUNG_MAX), datei: kurz(o.datei, DATEI_MAX), zeile: zahl(o.zeile), spalte: zahl(o.spalte),
      ansicht: kurz(o.ansicht, 60), zeit: kurz(o.zeit, 40), server_zeit: new Date(jetzt).toISOString(),
    }) + '\n';
    try {
      fs.mkdirSync(path.dirname(this.datei), { recursive: true });
      let groesse = 0;
      try { groesse = fs.statSync(this.datei).size; } catch { /* no file yet */ }
      if (groesse > 0 && groesse + Buffer.byteLength(zeile) > this.maxBytes) fs.renameSync(this.datei, `${this.datei}.1`);
      fs.appendFileSync(this.datei, zeile);
    } catch { /* a full or missing disk must not turn into a page error loop; the entry is dropped */ }
    return { ok: true };
  }

  routen(): Route[] {
    return [{ methode: 'POST', pfad: '/seite/fehler', schutz: 'fremdePost', handler: async (q, a) => {
      let d: unknown;
      try { d = JSON.parse(await lies(q) || '{}'); } catch { return json(a, 400, { fehler: 'ungueltig' }); }
      const r = this.schreibe(d);
      if (r.ok) return json(a, 200, { ok: true });
      return json(a, r.grund === 'zu_viele' ? 429 : 400, { fehler: r.grund });
    } }];
  }
}

async function lies(q: http.IncomingMessage): Promise<string> {
  let s = '';
  for await (const teil of q) { s += teil; if (s.length > KOERPER_MAX) throw new Error('too large'); }
  return s;
}
