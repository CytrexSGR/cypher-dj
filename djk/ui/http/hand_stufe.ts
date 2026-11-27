// Slice 3: the level rule. A key may only do what its level allows; the tool table decides what a call needs.
import type { HandAnfrage, HandRegel } from './hand_schutz.ts';
import { HAND_KLASSEN, RANG, klasseVon } from './hand_klassen.ts';
import type { Stufe } from './hand_schutz.ts';

/** A header value from the hand: trimmed, at most 64 chars, only [a-z_] (call ids also digits and '-'); anything else counts as absent. */
export function kopfWert(v: string | string[] | undefined, id = false): string | null {
  const s = (Array.isArray(v) ? v[0] : v)?.trim();
  return s && s.length <= 64 && (id ? /^[a-z0-9_-]+$/ : /^[a-z_]+$/).test(s) ? s : null;
}

/** The level a non-GET request needs. A call without a known tool counts as destructive. */
export function noetigeStufe(q: HandAnfrage): Stufe {
  const k = q.werkzeug ? klasseVon(q.werkzeug, q.aktion) : null;
  if (k === null) return 'zerstoerend';
  if (k.stufe === 'lesen' && !(HAND_KLASSEN[q.werkzeug!]?.lesendePost ?? []).includes(q.pfad)) return 'schreiben';
  return k.stufe;
}

export function stufenRegel(): HandRegel {
  return (q) => {
    if (!q.wer || q.methode === 'GET' || q.methode === 'HEAD') return null;
    const braucht = noetigeStufe(q);
    if (RANG[q.wer.stufe] >= RANG[braucht]) return null;
    return { ok: false, code: 403, fehler: 'stufe_zu_niedrig', text: 'this key may not do that', mehr: { braucht, hat: q.wer.stufe } };
  };
}
