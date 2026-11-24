// Tags area (B19..B21): HTTP routes under /tags. Every POST carries schutz fremdePost (415/403 before the handler); reads are open.
//   GET  /tags/vokabular            the extended vocabulary
//   GET  /tags?item=<id>            { item, tags: [{ tag, herkunft }] }, an empty list for a store that does not exist yet
//   POST /tags/setzen {items, tags, an}   { ok, geaendert }
//   GET  /tags/suche?tags=a,b&text=&art=   { treffer: [{ item, name, art, tags }] }
//   GET  /tags/verwandt?item=<id>   { gemacht_aus, steckt_in, passt_zu, aehnlich, daraus, enthaelt }
//   GET  /tags/gespeichert          { suchen: [{ name, tags, text, art, anzahl, frisch }] } (anzahl null and frisch false: not counted in this call, the page server counts inside a time budget; ask again);  POST /tags/gespeichert {name, tags, text, art?};  POST /tags/gespeichert/weg {name}
// A refusal is { ok: false, grund, fehler: grund, text } (+ betroffen: the offending id or tag); both keys are emitted so readers
// of the older `fehler` shape and of the route contract's `grund` shape both work.
import type http from 'node:http';
import path from 'node:path';
import { grundText } from '../http/reasons.ts';
import type { Bereich, BereichKontext, Route } from '../http/router.ts';
import { json } from '../http/transport.ts';
import { TagFehler, pruefeItemId } from './model.ts';
import { TagSpeicher } from './store.ts';
import { bezuegeBereit, type BezugQuellen, type Bezuege } from './bezuege.ts';
import { vokabularAntwort } from './vocabulary_item.ts';

export interface TagsBereichOptionen { speicher?: TagSpeicher; katalog?: string; tags?: { pfad?: string }; quellen?: BezugQuellen }
type Ctx = Pick<BereichKontext, 'log' | 'quelle'>;
const MAX_KOERPER = 1 << 20;

export const istTagsPfad = (p: string): boolean => p === '/tags' || p.startsWith('/tags/');

async function lesen(q: http.IncomingMessage): Promise<Record<string, unknown>> {
  const teile: Buffer[] = [];
  let bytes = 0;
  for await (const teil of q) {
    const b = typeof teil === 'string' ? Buffer.from(teil) : (teil as Buffer);
    bytes += b.length;
    if (bytes > MAX_KOERPER) throw new TagFehler(400, 'koerper_zu_gross');
    teile.push(b);
  }
  let j: unknown;
  try { j = JSON.parse(Buffer.concat(teile).toString('utf8') || '{}'); } catch { throw new TagFehler(400, 'json'); }
  if (j === null || typeof j !== 'object' || Array.isArray(j)) throw new TagFehler(400, 'koerper_kein_objekt');
  return j as Record<string, unknown>;
}

export function tagsBereich(ctx: Ctx, opt: TagsBereichOptionen = {}): Bereich & { speicher: TagSpeicher; bezuege: Bezuege | null } {
  const pfad = opt.tags?.pfad ?? (opt.katalog ? path.join(path.dirname(opt.katalog), 'tags.sqlite') : undefined);
  const speicher = opt.speicher ?? new TagSpeicher({ pfad });
  const bezuege = opt.quellen ? bezuegeBereit(speicher, opt.quellen, { log: (z) => ctx.log(z) }) : null;
  const fehler = (a: http.ServerResponse, e: unknown): void => {
    if (e instanceof TagFehler) {
      return json(a, e.code, { ok: false, grund: e.grund, fehler: e.grund, text: grundText(e.grund), ...(e.wer !== undefined ? { betroffen: e.wer } : {}) });
    }
    ctx.log({ typ: 'tags_fehler', fehler: (e as Error)?.message ?? String(e) });
    json(a, 500, { ok: false, grund: 'intern', fehler: 'intern', text: 'internal error in the tag store' });
  };

  const handler = async (q: http.IncomingMessage, a: http.ServerResponse, url: URL): Promise<void> => {
    try {
      const p = url.pathname;
      if (p === '/tags/vokabular' && q.method === 'GET') return json(a, 200, vokabularAntwort());
      if ((p === '/tags' || p === '/tags/suche' || p === '/tags/verwandt' || p === '/tags/gespeichert') && q.method === 'GET') bezuege?.frisch();   // provenance relations and preset tags follow the files lazily
      if (p === '/tags' && q.method === 'GET') {
        const item = url.searchParams.get('item');
        if (!pruefeItemId(item)) throw new TagFehler(400, 'item_ungueltig', item ?? undefined);
        return json(a, 200, { item, tags: speicher.tagsVon(item as string) });
      }
      if (p === '/tags/suche' && q.method === 'GET') {
        const tags = (url.searchParams.get('tags') ?? '').split(',').filter((t) => t !== '');
        const limit = url.searchParams.get('limit');
        return json(a, 200, { treffer: speicher.suche({ tags, text: url.searchParams.get('text') ?? '', art: url.searchParams.get('art') ?? '', ...(limit ? { limit: Number(limit) } : {}) }) });
      }
      if (p === '/tags/setzen' && q.method === 'POST') {
        const d = await lesen(q);
        if (typeof d.an !== 'boolean') throw new TagFehler(400, 'an_ungueltig');
        const herkunft = ctx.quelle() === 'cypher' ? 'agent' : 'nutzer';
        const geaendert = speicher.setze(d.items, d.tags, d.an, herkunft);
        ctx.log({ typ: 'tags_gesetzt', geaendert, an: d.an, quelle: ctx.quelle() });
        return json(a, 200, { ok: true, geaendert });
      }
      if (p === '/tags/verwandt' && q.method === 'GET') {
        const item = url.searchParams.get('item');
        if (!pruefeItemId(item)) throw new TagFehler(400, 'item_ungueltig', item ?? undefined);
        const pm = url.searchParams.get('passt_max');
        return json(a, 200, speicher.verwandt(item as string, pm ? { passt_max: Number(pm) } : {}));
      }
      if (p === '/tags/gespeichert' && q.method === 'GET') return json(a, 200, { suchen: speicher.gespeichert() });
      if (p === '/tags/gespeichert' && q.method === 'POST') {
        const d = await lesen(q);
        speicher.merke(d.name, d.tags, d.text, d.art);
        return json(a, 200, { ok: true });
      }
      if (p === '/tags/gespeichert/weg' && q.method === 'POST') {
        const d = await lesen(q);
        speicher.vergiss(d.name);
        return json(a, 200, { ok: true });
      }
      if (p === '/tags/vokabular' || p === '/tags' || p === '/tags/verwandt' || p === '/tags/gespeichert' || p === '/tags/gespeichert/weg' || p === '/tags/setzen' || p === '/tags/suche') return json(a, 405, { ok: false, grund: 'methode', fehler: 'methode', text: 'method not allowed on this tag route' });
      return json(a, 404, { ok: false, grund: 'nicht_gefunden', fehler: 'nicht_gefunden', text: 'no such tag route' });
    } catch (e) { fehler(a, e); }
  };

  const route: Route = { methode: '*', pfad: istTagsPfad, schutz: 'fremdePost', handler };
  return { name: 'tags', routen: () => [route], speicher, bezuege };
}
