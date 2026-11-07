// Collections (package 1.16 rest, spec 4.4): HTTP routes under their OWN prefix /kollektionen (/sammlungen are the DJ sets, sammlung.ts).
// Every POST carries schutz fremdePost, so the router answers 415/403 before a handler runs.
//   GET  /kollektionen                         [{slug, name, anzahl, autor?, geaendert, fehler?}]
//   GET  /kollektionen/<slug>                  {slug, name, autor?, angelegt, geaendert, posten}
//   POST /kollektionen                         {name} → 201 {slug}
//   POST /kollektionen/<slug>/posten           {hinzu?, weg?, erwartet?} → {anzahl, geaendert}
//   POST /kollektionen/<slug>/umbenennen       {name} → {slug}
//   POST /kollektionen/<slug>/loeschen         → {ok} (moved to .papierkorb)
// A refusal is {fehler, text}, plus the offending item for posten_ungueltig.
import type http from 'node:http';
import type { Bereich, BereichKontext, Route } from '../http/router.ts';
import { json, koerper } from '../http/transport.ts';
import { KollektionFehler } from './modell.ts';
import { KollektionSpeicher, type KollektionOptionen } from './speicher.ts';

export interface KollektionBereichOptionen extends KollektionOptionen { speicher?: KollektionSpeicher }
type Ctx = Pick<BereichKontext, 'log' | 'quelle'>;
const EINZEL = /^\/kollektionen\/([^/]+)(\/posten|\/umbenennen|\/loeschen)?$/;

// The own prefix: /kollektionen and everything below it, nothing else (not /kollektionenx, never /sammlungen)
export const istKollektionPfad = (p: string): boolean => p === '/kollektionen' || p.startsWith('/kollektionen/');

// A lock held by a foreign process: retry up to 4 times after 25 ms, never block (as presets/bereich.ts wiederhole)
async function wiederhole<T>(f: () => T): Promise<T> {
  for (let i = 0; ; i++) {
    try { return f(); }
    catch (e) { if (!(e instanceof KollektionFehler) || e.fehler !== 'kollektion_busy' || i >= 4) throw e; await new Promise((ok) => setTimeout(ok, 25)); }
  }
}

export function kollektionenBereich(ctx: Ctx, opt: KollektionBereichOptionen = {}): Bereich & { speicher: KollektionSpeicher } {
  const speicher = opt.speicher ?? new KollektionSpeicher(opt);
  const fehler = (a: http.ServerResponse, e: unknown): void => {
    if (e instanceof KollektionFehler) return json(a, e.code, { fehler: e.fehler, text: e.text, ...(e.posten !== undefined && e.code === 400 ? { posten: e.posten } : {}) });
    ctx.log({ typ: 'kollektionen_fehler', fehler: (e as Error)?.message ?? String(e) });
    json(a, 500, { fehler: 'intern', text: 'internal error in the collection store' });
  };
  const lesen = async (q: http.IncomingMessage): Promise<Record<string, unknown>> => {
    let d: unknown;
    try { d = await koerper(q); } catch { throw new KollektionFehler(400, 'koerper_ungueltig'); }
    if (d === null || typeof d !== 'object' || Array.isArray(d)) throw new KollektionFehler(400, 'koerper_ungueltig');
    return d as Record<string, unknown>;
  };
  const teil = (s: string): string => { try { return decodeURIComponent(s); } catch { return '\u0000'; } };

  const handler = async (q: http.IncomingMessage, a: http.ServerResponse, url: URL): Promise<void> => {
    try {
      const p = url.pathname;
      if (p === '/kollektionen' && q.method === 'GET') return json(a, 200, speicher.liste());
      if (p === '/kollektionen' && q.method === 'POST') {
        const d = await lesen(q);
        const r = await wiederhole(() => speicher.lege(d.name, ctx.quelle()));
        ctx.log({ typ: 'kollektion_angelegt', slug: r.slug, quelle: ctx.quelle() });
        return json(a, 201, r);
      }
      const m = EINZEL.exec(p);
      if (!m) return json(a, 404, { fehler: 'nicht_gefunden', text: 'no such collection route' });
      const slug = teil(m[1]), was = m[2] ?? '';
      if (q.method === 'GET' && was === '') return json(a, 200, { slug, ...speicher.lies(slug) });
      if (q.method !== 'POST' || was === '') return json(a, 405, { fehler: 'methode', text: 'method not allowed on this collection route' });
      const d = await lesen(q);
      if (was === '/posten') {
        const r = await wiederhole(() => speicher.aendere(slug, { hinzu: d.hinzu, weg: d.weg, erwartet: d.erwartet }, ctx.quelle()));
        ctx.log({ typ: 'kollektion_geaendert', slug, anzahl: r.anzahl, quelle: ctx.quelle() });
        return json(a, 200, r);
      }
      if (was === '/umbenennen') {
        const r = await wiederhole(() => speicher.benenne(slug, d.name, ctx.quelle()));
        ctx.log({ typ: 'kollektion_umbenannt', slug, neu: r.slug, quelle: ctx.quelle() });
        return json(a, 200, r);
      }
      await wiederhole(() => speicher.loesche(slug, ctx.quelle()));
      ctx.log({ typ: 'kollektion_geloescht', slug, quelle: ctx.quelle() });
      return json(a, 200, { ok: true });
    } catch (e) { fehler(a, e); }
  };

  const route: Route = { methode: '*', pfad: istKollektionPfad, schutz: 'fremdePost', handler };
  return { name: 'kollektionen', routen: () => [route], speicher };
}
