// Central checks for requests that come from an agent (source cypher). Each slice adds one rule in its own file and appends it to the
// list in server.ts; the first objection wins. Slice 1: the stop switch (brake).
import { GRUND_TEXT } from './reasons.ts';
import { noetigeStufe } from './hand_stufe.ts';
export type Stufe = 'lesen' | 'schreiben' | 'zerstoerend';
export interface HandAnfrage {
  methode: string; pfad: string;
  quelle: 'cypher' | 'andreas';
  wer: { id: string; name: string; stufe: Stufe } | null;   // null until slice 2
  werkzeug: string | null; aktion: string | null; aufruf: string | null;   // from x-djk-werkzeug, x-djk-aktion, x-djk-aufruf (slice 3)
}
export type HandUrteil = { ok: true } | { ok: false; code: number; fehler: string; text: string; mehr?: Record<string, unknown> };
export type HandRegel = (q: HandAnfrage) => HandUrteil | null;   // null = no objection

/** First objection wins, else ok. */
export function pruefeHand(regeln: readonly HandRegel[], q: HandAnfrage): HandUrteil {
  for (const r of regeln) { const u = r(q); if (u) return u; }
  return { ok: true };
}

/** The stop switch: while braked, every agent write is refused. /abbruch stays open (aborting its own parts reduces activity). */
export function bremsRegel(gebremst: () => boolean): HandRegel {
  return (q) => {
    if (q.quelle !== 'cypher' || q.methode === 'GET' || q.methode === 'HEAD' || q.pfad === '/abbruch' || !gebremst()) return null;
    if (noetigeStufe(q) === 'lesen') return null;   // a reading POST the tool table names (klang zeige, reference measure) stays free
    return { ok: false, code: 409, fehler: 'ki_gestoppt', text: GRUND_TEXT.ki_gestoppt };   // the same text as the routes' own Stop Cypher refusal
  };
}
