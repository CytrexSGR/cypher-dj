// Sampler B task 2: the routes of the kit from slices. A Bereich of its own (`sampler-kit`) so that the route list of samplerBereich, which plans A1, A2
// and C pin in their tests, stays as it is. The writer is sampler/kit.ts; the answers follow areas/sampler/area.ts (SchnittFehler -> {fehler, text}).
import type http from 'node:http';
import type { Bereich, BereichKontext, Route } from '../../http/router.ts';
import { json } from '../../http/transport.ts';
import { kitVorschlag, legeKit, type KitOrdner } from '../../sampler/kit.ts';
import { SchnittFehler } from '../../sampler/schnitt.ts';
import { alsAntwort, leseKoerper } from '../proj/area.ts';
import { ProjFehler, type Antwort } from '../proj/session.ts';

/** `ordner` (cut store), `bk` (graph folder) and `kits` (kit folder) are read at every request, so a getter may follow the options of the server; each one
 *  that is absent falls back to its default (`samplerOrdner()`, `graphenOrdner()`, `kitsOrdnerVorgabe()`). */
export interface KitRoutenOptionen { ordner?: string; bk?: string; kits?: string }

const arg = (text: string): ProjFehler => new ProjFehler(400, 'argument_ungueltig', { text });
const nurSchluessel = (d: Record<string, unknown>, ...erlaubt: string[]): void => {
  for (const k of Object.keys(d)) if (!erlaubt.includes(k)) throw new ProjFehler(400, 'argument_unbekannt', { text: `${k}: the request has no field of that name`, detail: k });
};

export function samplerKitBereich(ctx: BereichKontext, opt: KitRoutenOptionen = {}): Bereich {
  const ordner = (): KitOrdner => ({ ordner: opt.ordner, bk: opt.bk, kits: opt.kits });
  const holeId = (id: unknown): string => {
    if (typeof id !== 'string' || id === '') throw arg('id: the id of a cut expected');
    return id;
  };
  const vorschlag = (url: URL): Antwort => {
    const id = holeId(url.searchParams.get('id'));
    const roh = url.searchParams.get('scheiben') ?? '';
    const teile = roh === '' ? [] : roh.split(',');
    if (teile.length === 0 || !teile.every((x) => /^\d{1,6}$/.test(x))) throw arg('scheiben: slice indices from 0, separated by commas, expected (scheiben=0,3,5)');
    return { code: 200, j: kitVorschlag(id, teile.map(Number), ordner()) };
  };
  const schreibe = (d: Record<string, unknown>, quelle: 'andreas' | 'cypher'): Antwort => {
    nurSchluessel(d, 'id', 'scheiben', 'banken', 'kit');
    if (quelle === 'cypher' && ctx.kiGestoppt()) throw new ProjFehler(409, 'ki_gestoppt');
    const id = holeId(d.id);
    return { code: 200, j: legeKit({ id, scheiben: d.scheiben as number[], ...(d.banken !== undefined ? { banken: d.banken as string[] } : {}),
      ...(d.kit !== undefined ? { kit: d.kit as string } : {}) }, ordner()) };
  };
  const antworte = async (r: http.ServerResponse, f: () => Antwort | Promise<Antwort>): Promise<void> => {
    let x: Antwort;
    try { x = await f(); } catch (e) { x = e instanceof SchnittFehler ? { code: e.code, j: { fehler: e.grund, text: e.text } } : alsAntwort(e, ctx); }
    json(r, x.code, x.j);
  };
  const routen = (): Route[] => [
    { methode: 'GET', pfad: '/sampler/kit/vorschlag', schutz: 'offen', handler: async (_q, r, url) => antworte(r, () => vorschlag(url)) },
    { methode: 'POST', pfad: '/sampler/kit', schutz: 'fremdePost', handler: async (q, r) => {
      const quelle = ctx.quelle();                                       // read at the start of the request
      await antworte(r, async () => schreibe(await leseKoerper(q), quelle));
    } },
  ];
  return { name: 'sampler-kit', routen };
}
