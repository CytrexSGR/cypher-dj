// Slice 4: rate limit per key and per tool call. Token buckets, refilled lazily from an injected clock.
import type { HandAnfrage, HandRegel } from './hand_schutz.ts';
import { noetigeStufe } from './hand_stufe.ts';
import { klasseVon } from './hand_klassen.ts';

interface Eimer { n: number; t: number }
interface Schluessel { schreiben: Eimer; zerstoerend: Eimer; ring: string[]; menge: Set<string> }

const GROESSE = { schreiben: 20, zerstoerend: 3 } as const;
/** Tokens per millisecond: 2 per second, 1 per 20 seconds. */
const NACHFUELLUNG = { schreiben: 2 / 1000, zerstoerend: 1 / 20000 } as const;
const MAX_AUFRUFE = 256;
const MAX_SCHLUESSEL = 100;

export function eimerRegel(jetzt: () => number = Date.now): HandRegel {
  const alle = new Map<string, Schluessel>();

  const holen = (id: string, t: number): Schluessel => {
    let s = alle.get(id);
    if (!s) {
      s = {
        schreiben: { n: GROESSE.schreiben, t }, zerstoerend: { n: GROESSE.zerstoerend, t },
        ring: [], menge: new Set(),
      };
      alle.set(id, s);
      if (alle.size > MAX_SCHLUESSEL) alle.delete(alle.keys().next().value as string);
    }
    return s;
  };

  return (q: HandAnfrage) => {
    if (!q.wer || q.methode === 'GET' || q.methode === 'HEAD' || q.pfad === '/abbruch') return null;
    // a call without a known tool (a script's raw curl) is rate-limited as a write: the destructive bucket (3 per 20 s) is for
    // calls the tool table names destructive, else a live script that POSTs /spur every bar would stall
    const art = (q.werkzeug ? klasseVon(q.werkzeug, q.aktion) : null) === null ? 'schreiben' : noetigeStufe(q);
    if (art === 'lesen') return null;
    const t = jetzt();
    const s = holen(q.wer.id, t);
    if (q.aufruf && s.menge.has(q.aufruf)) return null;
    const e = s[art];
    e.n = Math.min(GROESSE[art], e.n + (t - e.t) * NACHFUELLUNG[art]);
    e.t = t;
    if (e.n < 1) {
      const wieder = Math.ceil((1 - e.n) / NACHFUELLUNG[art]);
      return { ok: false, code: 429, fehler: 'zu_schnell', text: 'too many agent writes; wait', mehr: { wieder_in_ms: wieder } };
    }
    e.n -= 1;
    if (q.aufruf) {
      s.menge.add(q.aufruf);
      s.ring.push(q.aufruf);
      if (s.ring.length > MAX_AUFRUFE) s.menge.delete(s.ring.shift() as string);
    }
    return null;
  };
}
