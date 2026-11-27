// Slice 5: while music plays, destructive tools of an agent are refused (deletes, overwrites, exports wait).
// Tools that only stop sound are exempt: stopping matters most while music plays.
import type { HandRegel } from './hand_schutz.ts';
import { klasseVon } from './hand_klassen.ts';

export function spielRegel(musikLaeuft: () => boolean): HandRegel {
  return (q) => {
    if (!q.wer || q.methode === 'GET' || q.methode === 'HEAD') return null;
    const k = q.werkzeug ? klasseVon(q.werkzeug, q.aktion) : null;
    if (k !== null && (k.stufe !== 'zerstoerend' || k.art === 'stoppt_klang')) return null;
    // a call without a known tool is a script's raw request (live arcs POST /spur, /regler every bar): only its DELETE waits
    if (k === null && q.methode !== 'DELETE') return null;
    if (!musikLaeuft()) return null;
    return { ok: false, code: 409, fehler: 'musik_laeuft', text: 'music is playing: deleting, overwriting and exporting wait until it stops', mehr: { art: k?.art ?? null } };
  };
}
