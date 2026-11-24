// POST /proj/einsammeln (storage layout A5): collect every audio source outside the open project into <project>/audio/ and answer the report.
// Copies only; no source is moved or removed. The button refuses while the transport runs or a deck plays (409 transport_laeuft): file work then
// would compete with the audio ("transport_laeuft" also covers a deck, a loop box or a studio stream). Each file has a time limit.
// The background collector of the session (project/einsammeln.ts Einsammler) waits instead of refusing.
import type http from 'node:http';
import type { Bereich, BereichKontext } from '../../http/router.ts';
import { json, koerper } from '../../http/transport.ts';
import { sammleEin, type Einsammler } from '../../project/einsammeln.ts';
import type { ProjZugang } from './area.ts';
import { KitFehler } from '../../project/kit_storage.ts';
import { sammleKitsEin } from '../../project/kits_einsammeln.ts';
import { grundText } from '../../http/reasons.ts';

export interface EinsammelnOptionen {
  einsammler: Einsammler;
  quellPfad: (sha: string, hinweis: string) => string | null;   // the session's resolver (catalog, hint, collected copy)
  kitsOrdner?: string;                                          // the global kit folder (default: the instance's)
  kitFrei?: (ordner: string) => number;                         // test hook: free bytes
}

const fehler = (r: http.ServerResponse, code: number, grund: string, text: string): void => json(r, code, { fehler: grund, text });

export function einsammelnBereich(_ctx: BereichKontext, zugang: ProjZugang, opt: EinsammelnOptionen): Bereich {
  return {
    name: 'proj-einsammeln',
    routen: () => [
      { methode: 'POST', pfad: '/proj/einsammeln', schutz: 'fremdePost', handler: async (q, r) => {
        let d: Record<string, unknown>;
        try { d = await koerper(q); } catch { return fehler(r, 400, 'argument_ungueltig', 'unreadable request body (no valid JSON object)'); }
        if (Object.keys(d).length > 0) return fehler(r, 400, 'argument_ungueltig', 'this request takes no fields');
        const o = zugang.offen();
        if (!o) return fehler(r, 409, 'kein_projekt', 'no project is open');
        if (!opt.einsammler.frei()) return fehler(r, 409, 'transport_laeuft', 'music is playing: collecting starts when it stops');
        try {
          const bericht = await sammleEin({ projekt: o.projekt, projektOrdner: o.ordner, quellPfad: opt.quellPfad, frei: () => opt.einsammler.frei(),
            signal: opt.einsammler.signal, zeit: opt.einsammler.zeit, lauf: opt.einsammler.lauf });
          // browser plan 5: the kits the project names are collected as well (kits/<name>/ in the project folder)
          const kits = await sammleKitsEin({ projekt: o.projekt, projektOrdner: o.ordner,
            ...(opt.kitsOrdner !== undefined ? { kitsOrdner: opt.kitsOrdner } : {}),
            ...(opt.kitFrei ? { frei: opt.kitFrei } : {}) });
          json(r, 200, { ...bericht, kits });
        } catch (e) {
          if (e instanceof KitFehler) return json(r, e.code, { ok: false, grund: e.grund, fehler: e.grund, text: e.text ?? grundText(e.grund) });
          fehler(r, 500, 'intern', 'internal server error while collecting');
        }
      } },
    ],
  };
}
