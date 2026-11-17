// The routes /quellen of the page server (storage layout A4): the source folders of the owner.
//   GET  /quellen        → QuellenSicht
//   POST /quellen/dazu   {name, pfad, art, wechselplatte?, regal?} → QuellenSicht
//   POST /quellen/weg    {name} → QuellenSicht
// Every POST carries schutz fremdePost; the tablet port refuses the whole prefix (http/coupling.ts, folder paths stay on the studio screen).
import path from 'node:path';
import type http from 'node:http';
import type { Bereich, BereichKontext, Route } from '../../http/router.ts';
import { json, koerper } from '../../http/transport.ts';
import { QuellenFehler, type Quellen } from '../../sources.ts';

const ARTEN = ['sample', 'oneshot', 'loop', 'track'];
const NAME_MAX = 40;
const arg = (text: string): QuellenFehler => new QuellenFehler(400, 'argument_ungueltig', text);

async function lesen(q: http.IncomingMessage): Promise<Record<string, unknown>> {
  try { return await koerper(q); } catch { throw arg('the request body must be a JSON object'); }
}
const text = (d: Record<string, unknown>, k: string): string => {
  const v = d[k];
  if (typeof v !== 'string' || v.trim() === '') throw arg(`${k}: a non-empty text is required`);
  return v;
};

export function quellenBereich(ctx: Pick<BereichKontext, 'log'>, quellen: Quellen): Bereich {
  const antworte = async (a: http.ServerResponse, f: () => Promise<unknown>): Promise<void> => {
    try { json(a, 200, await f()); }
    catch (e) {
      if (e instanceof QuellenFehler) {
        ctx.log({ typ: 'quellen_abgelehnt', grund: e.grund });
        return json(a, e.code, { fehler: e.grund, text: e.text, ...(e.detail ? { detail: e.detail } : {}) });
      }
      ctx.log({ typ: 'quellen_fehler', fehler: (e as Error)?.message ?? String(e) });
      json(a, 500, { fehler: 'quellen_fehler', text: 'internal error in the source list' });
    }
  };
  const dazu = async (q: http.IncomingMessage) => {
    const d = await lesen(q);
    const name = text(d, 'name').trim(), pfad = text(d, 'pfad').trim(), art = text(d, 'art');
    if (name.length > NAME_MAX || name.includes('/')) throw arg(`name: 1 to ${NAME_MAX} characters without a slash`);
    if (!path.isAbsolute(pfad) || pfad.includes('\0')) throw arg('pfad: an absolute folder path is required');
    if (!ARTEN.includes(art)) throw arg('art: one of sample, oneshot, loop, track');
    if (d.wechselplatte !== undefined && typeof d.wechselplatte !== 'boolean') throw arg('wechselplatte: true or false');
    if (d.regal !== undefined && typeof d.regal !== 'boolean') throw arg('regal: true or false');
    const r = await quellen.dazu({ name, pfad, art, ...(d.wechselplatte !== undefined ? { wechselplatte: d.wechselplatte as boolean } : {}), ...(d.regal !== undefined ? { regal: d.regal as boolean } : {}) });
    ctx.log({ typ: 'quelle_dazu', name, art });
    return r;
  };
  const weg = async (q: http.IncomingMessage) => {
    const d = await lesen(q);
    const name = text(d, 'name');
    const r = await quellen.weg(name);
    ctx.log({ typ: 'quelle_weg', name });
    return r;
  };
  const routen = (): Route[] => [
    { methode: 'GET', pfad: '/quellen', schutz: 'offen', handler: (_q, a) => antworte(a, () => quellen.zeige()) },
    { methode: 'POST', pfad: '/quellen/dazu', schutz: 'fremdePost', handler: (q, a) => antworte(a, () => dazu(q)) },
    { methode: 'POST', pfad: '/quellen/weg', schutz: 'fremdePost', handler: (q, a) => antworte(a, () => weg(q)) },
  ];
  return { name: 'quellen', routen };
}
