// The route GET /suche of the page server (media browser slice B4): one search across the shelf, hits grouped by kind.
//   GET /suche?q=<words>&arten=<comma list>&je=<n>&passt=0|1  →  {q, gruppen: [{art, name, zahl, treffer, fehler?}], passt}
// An empty q is refused (argument_ungueltig). A source that fails gives an empty group with `fehler`, never a failed search.
import type http from 'node:http';
import type { Bereich, BereichKontext, Route } from '../../http/router.ts';
import { json } from '../../http/transport.ts';
import { ARTEN, JE_MAX, JE_VORGABE, Q_MAX, camelotVon, suche, type Art, type Passt, type Quellen } from '../../suche.ts';

export interface SucheOptionen {
  quellen: Quellen;
  /** The open project: its tempo and its key (project/model.ts Tonart), or null when none is open. */
  projekt(): { tempo_bpm: number; tonart?: { grundton?: unknown; skala?: unknown } } | null;
}

const abgelehnt = (a: http.ServerResponse, text: string): void => json(a, 400, { fehler: 'argument_ungueltig', text });

export function sucheBereich(ctx: Pick<BereichKontext, 'log'>, opt: SucheOptionen): Bereich {
  const handler = async (_q: http.IncomingMessage, a: http.ServerResponse, url: URL): Promise<void> => {
    const p = url.searchParams;
    const q = (p.get('q') ?? '').trim();
    if (q === '') return abgelehnt(a, 'q: a search text is required');
    if (q.length > Q_MAX) return abgelehnt(a, `q: at most ${Q_MAX} characters`);
    let arten: Art[] = [...ARTEN];
    if (p.has('arten') && p.get('arten') !== '') {
      const roh = (p.get('arten') as string).split(',').map((x) => x.trim());
      if (roh.some((x) => !(ARTEN as readonly string[]).includes(x))) return abgelehnt(a, `arten: a comma list of ${ARTEN.join(', ')}`);
      arten = roh as Art[];
    }
    let je = JE_VORGABE;
    if (p.has('je')) {
      const t = p.get('je') as string;
      if (!/^\d+$/.test(t) || Number(t) < 1) return abgelehnt(a, 'je: a whole number of 1 or more');
      je = Math.min(JE_MAX, Number(t));
    }
    if (p.has('passt') && p.get('passt') !== '0' && p.get('passt') !== '1') return abgelehnt(a, 'passt: 0 or 1');
    let passt: Passt | null = null;
    if (p.get('passt') === '1') {
      const o = opt.projekt();
      if (o && Number.isFinite(o.tempo_bpm) && o.tempo_bpm > 0) passt = { bpm: o.tempo_bpm, camelot: camelotVon(o.tonart) };   // no project: nothing to fit
    }
    try {
      const r = await suche(opt.quellen, { q, je, passt }, arten);
      json(a, 200, { ...r, passt });
    } catch (e) {
      ctx.log({ typ: 'suche_fehler', fehler: (e as Error)?.message ?? String(e) });
      json(a, 500, { fehler: 'intern', text: 'internal error in the search' });
    }
  };
  const routen = (): Route[] => [{ methode: 'GET', pfad: '/suche', schutz: 'offen', handler }];
  return { name: 'suche', routen };
}
