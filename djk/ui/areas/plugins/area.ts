// Plan 1.11 tasks 10 and 15: the routes of the plugin area.
//   GET  /plugins?text=&art=&format=     the index entries (answers while a scan runs: the scan is a child process)
//   GET  /plugins/scan                   the scan state
//   POST /plugins/rescan                 Andreas only; one scan at a time (scan_laeuft); progress as the event {a:'plugins', f:{scan}} and in GET /plugins
//   POST /plugins/entsperren {id}        Andreas only; a blocked entry is tried again by the next scan
//   GET  /proj/insert/<insert_id>/parameter   the host's parameter list joined with the current values
//   POST /proj/insert/<insert_id>/fenster {an}  Andreas only; opens or closes the plugin's own window
//   GET /proj/spur/<spur_id>/geraet/parameter, POST .../geraet/param {werte}, POST .../geraet/fenster {an}  the same for a plugin instrument track
import type http from 'node:http';
import type { Bereich, BereichKontext, Route } from '../../http/router.ts';
import { json } from '../../http/transport.ts';
import type { PluginIndex } from '../../plugins/index.ts';
import { alsAntwort, leseKoerper } from '../proj/area.ts';
import { ProjFehler, type Antwort } from '../proj/session.ts';
import type { Quelle } from '../../project/history.ts';

export interface PluginsZugang {
  insertParameter(insertId: string): Promise<Antwort>;
  insertFenster(insertId: string, d: Record<string, unknown>, quelle: Quelle): Promise<Antwort>;
  geraetParameter(spurId: string): Promise<Antwort>;                                                // plan 1.11 task 17: the plugin instrument of a track
  geraetParam(spurId: string, d: Record<string, unknown>, quelle: Quelle): Promise<Antwort>;
  geraetFenster(spurId: string, d: Record<string, unknown>, quelle: Quelle): Promise<Antwort>;
}
const GERAET_PFAD = (ende: string) => (pfad: string): boolean => new RegExp(`^/proj/spur/s[0-9]{1,6}/geraet/${ende}$`).test(pfad);
const INSERT_PFAD = (ende: string) => (pfad: string): boolean => new RegExp(`^/proj/insert/[A-Za-z][A-Za-z0-9_-]{0,31}/${ende}$`).test(pfad);

export function pluginsBereich(ctx: BereichKontext, index: PluginIndex, zugang: PluginsZugang): Bereich {
  const antworte = async (a: http.ServerResponse, f: () => Antwort | Promise<Antwort>): Promise<void> => {
    let r: Antwort;
    try { r = await f(); } catch (e) { r = alsAntwort(e, ctx); }
    json(a, r.code, r.j);
  };
  const nurAndreas = (): void => { if (ctx.quelle() !== 'andreas') throw new ProjFehler(403, 'nur_andreas'); };
  const routen: Route[] = [
    { methode: 'GET', pfad: '/plugins', schutz: 'offen', handler: (_q, a, url) => antworte(a, () => ({ code: 200, j: {
      plugins: index.liste({ text: url.searchParams.get('text') ?? '', art: url.searchParams.get('art') ?? '', format: url.searchParams.get('format') ?? '' }),
      scan: index.scanStand() } })) },
    { methode: 'GET', pfad: '/plugins/scan', schutz: 'offen', handler: (_q, a) => antworte(a, () => ({ code: 200, j: index.scanStand() })) },
    { methode: 'POST', pfad: '/plugins/rescan', schutz: 'fremdePost', handler: (_q, a) => antworte(a, () => {
      nurAndreas();
      if (!index.scanne()) throw new ProjFehler(409, 'scan_laeuft');
      return { code: 200, j: { ok: true, scan: index.scanStand() } };
    }) },
    { methode: 'POST', pfad: '/plugins/entsperren', schutz: 'fremdePost', handler: (q, a) => antworte(a, async () => {
      nurAndreas();
      const id = (await leseKoerper(q)).id;
      if (typeof id !== 'string' || id === '') throw new ProjFehler(400, 'argument_ungueltig', { text: 'id: a plugin ID is required' });
      const r = index.entsperre(id);
      if (r === 'scan_laeuft') throw new ProjFehler(409, 'scan_laeuft');
      if (r === null) throw new ProjFehler(404, 'plugin_unbekannt');
      return { code: 200, j: { ok: true, ...r } };
    }) },
    { methode: 'GET', pfad: INSERT_PFAD('parameter'), schutz: 'offen',
      handler: (_q, a, url) => antworte(a, () => zugang.insertParameter(url.pathname.split('/')[3])) },
    { methode: 'POST', pfad: INSERT_PFAD('fenster'), schutz: 'fremdePost',
      handler: async (q, a, url) => { const quelle = ctx.quelle(); await antworte(a, async () => zugang.insertFenster(url.pathname.split('/')[3], await leseKoerper(q), quelle)); } },
    // plan 1.11 task 17: the same three for the device of an instrument track (<spur_id> is in the path)
    { methode: 'GET', pfad: GERAET_PFAD('parameter'), schutz: 'offen',
      handler: (_q, a, url) => antworte(a, () => zugang.geraetParameter(url.pathname.split('/')[3])) },
    { methode: 'POST', pfad: GERAET_PFAD('param'), schutz: 'fremdePost',
      handler: async (q, a, url) => { const quelle = ctx.quelle(); await antworte(a, async () => zugang.geraetParam(url.pathname.split('/')[3], await leseKoerper(q), quelle)); } },
    { methode: 'POST', pfad: GERAET_PFAD('fenster'), schutz: 'fremdePost',
      handler: async (q, a, url) => { const quelle = ctx.quelle(); await antworte(a, async () => zugang.geraetFenster(url.pathname.split('/')[3], await leseKoerper(q), quelle)); } },
  ];
  return { name: 'plugins', routen: () => routen };
}
