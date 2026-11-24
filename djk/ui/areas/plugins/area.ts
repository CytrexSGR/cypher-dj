// Plan 1.11 tasks 10 and 15: the routes of the plugin area.
//   GET  /plugins?text=&art=&format=     the index entries (answers while a scan runs: the scan is a child process)
//   GET  /plugins/scan                   the scan state
//   GET  /plugins/pfade                  the own bundle folders and the user's plugin folders (labelled) plus the default scan folders
//   POST /plugins/pfade/dazu {pfad}      Andreas only, loopback host; adds a folder to plugin_pfade.txt and starts one rescan (out of process)
//   POST /plugins/pfade/weg {pfad}       Andreas only, loopback host; removes a folder of that file
//   POST /plugins/rescan                 Andreas only; one scan at a time (scan_laeuft); progress as the event {a:'plugins', f:{scan}} and in GET /plugins
//   POST /plugins/entsperren {id}        Andreas only; a blocked entry is tried again by the next scan
//   GET  /proj/insert/<insert_id>/parameter   the host's parameter list joined with the current values
//   POST /proj/insert/<insert_id>/fenster {an}  Andreas only; opens or closes the plugin's own window
//   GET /proj/spur/<spur_id>/geraet/ist?namen=a,b  the display values the host of a Surge track plays now (read-only)
//   GET /proj/spur/<spur_id>/geraet/parameter, POST .../geraet/param {werte}, POST .../geraet/fenster {an}  the same for a plugin instrument track
import type http from 'node:http';
import type { Bereich, BereichKontext, Route } from '../../http/router.ts';
import { json } from '../../http/transport.ts';
import type { PluginIndex } from '../../plugins/index.ts';
import { alsAntwort, leseKoerper } from '../proj/area.ts';
import { ProjFehler, type Antwort } from '../proj/session.ts';
import type { Quelle } from '../../project/history.ts';
import { eigeneVst3Pfade } from '../../../contract/orte.ts';
import { PfadeFehler, pfadeDatei, pruefeOrdner, standardPfade } from '../../plugins/paths_file.ts';
import { pluginPfadeDatei } from '../../paths.ts';
import { erlaubteWurzeln, type Wurzel } from '../../importe.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface PluginPfadeOptionen {
  port?: number | (() => number);          // the page server's port: the owner routes answer on a loopback Host only
  datei?: () => string | null;             // the plugin_pfade.txt to read and write; default pluginPfadeDatei() (instance: shm, live: under home)
  home?: () => string;                     // default os.homedir()
  wurzel?: string;                         // the install root whose lib/vst3 is the package row (tests); default the checkout
  erlaubt?: () => Wurzel[];                // folders a plugin folder may lie in; default erlaubteWurzeln() of importe.ts, as the folder picker uses
}

export interface PluginsZugang {
  insertParameter(insertId: string): Promise<Antwort>;
  insertFenster(insertId: string, d: Record<string, unknown>, quelle: Quelle): Promise<Antwort>;
  geraetParameter(spurId: string): Promise<Antwort>;                                                // plan 1.11 task 17: the plugin instrument of a track
  geraetParam(spurId: string, d: Record<string, unknown>, quelle: Quelle): Promise<Antwort>;
  geraetIst?(spurId: string, namen: string): Promise<Antwort>;                                      // front panels: the host's display values of a Surge track
  geraetFenster(spurId: string, d: Record<string, unknown>, quelle: Quelle): Promise<Antwort>;
}
const GERAET_PFAD = (ende: string) => (pfad: string): boolean => new RegExp(`^/proj/spur/s[0-9]{1,6}/geraet/${ende}$`).test(pfad);
const INSERT_PFAD = (ende: string) => (pfad: string): boolean => new RegExp(`^/proj/insert/[A-Za-z][A-Za-z0-9_-]{0,31}/${ende}$`).test(pfad);

export function pluginsBereich(ctx: BereichKontext, index: PluginIndex, zugang: PluginsZugang, pfadeOpt: PluginPfadeOptionen = {}): Bereich {
  const antworte = async (a: http.ServerResponse, f: () => Antwort | Promise<Antwort>): Promise<void> => {
    let r: Antwort;
    try { r = await f(); } catch (e) { r = alsAntwort(e, ctx); }
    json(a, r.code, r.j);
  };
  const nurAndreas = (): void => { if (ctx.quelle() !== 'andreas') throw new ProjFehler(403, 'nur_andreas'); };
  // plugin folders (plan 6): own refusal shape { ok:false, grund, text }
  const heim = (): string => (pfadeOpt.home ?? os.homedir)();
  const pfadeDateiVon = (): string | null => (pfadeOpt.datei ?? pluginPfadeDatei)();   // a test instance: its own file in /dev/shm, never the owner's
  const abgelehnt = (a: http.ServerResponse, code: number, grund: string, text: string): void => json(a, code, { ok: false, grund, text });
  const echt = (p: string): string => { try { return fs.realpathSync(p); } catch { return p; } };
  const zeilen = (): { pfad: string; quelle: 'nutzer' | 'umgebung' | 'datei' | 'paket' }[] => {
    const eigen = eigeneVst3Pfade({ home: heim(), ...(pfadeOpt.wurzel ? { wurzel: pfadeOpt.wurzel } : {}) }), datei = pfadeDatei(heim(), pfadeDateiVon()).lies().map((pfad) => ({ pfad, quelle: 'datei' as const }));
    return [...eigen.filter((r) => r.quelle !== 'paket'), ...datei, ...eigen.filter((r) => r.quelle === 'paket')];
  };
  const eigner = (q: http.IncomingMessage, a: http.ServerResponse): boolean => {
    if (ctx.quelle() !== 'andreas') { abgelehnt(a, 403, 'nur_andreas', 'Only Andreas may change the plugin folders.'); return false; }
    if (pfadeOpt.port !== undefined) {   // a POST has passed the Origin check (fremdePost); the Host check closes DNS rebinding
      const host = String(q.headers.host ?? ''), p = typeof pfadeOpt.port === 'function' ? pfadeOpt.port() : pfadeOpt.port;
      if (host !== `127.0.0.1:${p}` && host !== `localhost:${p}`) { abgelehnt(a, 421, 'falscher_host', 'Open the page as http://127.0.0.1:<port>/ to change plugin folders.'); return false; }
    }
    return true;
  };
  const pfadAusBody = async (q: http.IncomingMessage, a: http.ServerResponse): Promise<unknown | undefined> => {
    try { return (await leseKoerper(q)).pfad; } catch { abgelehnt(a, 400, 'pfad_ungueltig', 'The request body is not valid JSON.'); return undefined; }
  };
  const dazu = async (q: http.IncomingMessage, a: http.ServerResponse): Promise<void> => {
    if (!eigner(q, a)) return;
    try {
      const roh = await pfadAusBody(q, a);
      if (roh === undefined && a.writableEnded) return;
      const bekannt = [...standardPfade(heim()), ...zeilen().map((r) => r.pfad)].map(echt);
      if (typeof roh === 'string' && path.isAbsolute(roh) && bekannt.includes(echt(path.resolve(roh)))) return abgelehnt(a, 409, 'pfad_schon_da', 'That folder is already searched.');
      const real = pruefeOrdner(roh, (pfadeOpt.erlaubt ?? (() => erlaubteWurzeln({ heim: heim() })))());
      if (bekannt.includes(real)) return abgelehnt(a, 409, 'pfad_schon_da', 'That folder is already searched.');
      pfadeDatei(heim(), pfadeDateiVon()).dazu(real);
      let gestartet = false, vorgemerkt = false;
      try {   // the scan is a child process with its own time limit; a missing scan command only skips the rescan
        gestartet = index.scanne();
        if (!gestartet) vorgemerkt = index.merkeNachlauf?.() ?? false;
      } catch { gestartet = false; }
      json(a, 200, { ok: true, scan_gestartet: gestartet, ...(vorgemerkt ? { scan_vorgemerkt: true, text: 'A scan is running now. The new folder joins the next scan, and a rescan is queued right after the current one.' } : {}) });
    } catch (e) {
      if (e instanceof PfadeFehler) return abgelehnt(a, e.code, e.grund, e.text);
      ctx.log({ typ: 'plugin_pfade_fehler', fehler: (e as Error)?.message ?? String(e) });
      abgelehnt(a, 500, 'pfade_fehler', 'The plugin folders file could not be written.');
    }
  };
  const weg = async (q: http.IncomingMessage, a: http.ServerResponse): Promise<void> => {
    if (!eigner(q, a)) return;
    try {
      const roh = await pfadAusBody(q, a);
      if (a.writableEnded) return;
      if (typeof roh !== 'string' || roh === '') return abgelehnt(a, 400, 'pfad_ungueltig', 'A folder path is required.');
      const z = zeilen().find((r) => r.pfad === roh);
      if (!z) return abgelehnt(a, 404, 'pfad_unbekannt', 'That folder is not in the list.');
      if (z.quelle !== 'datei') return abgelehnt(a, 409, 'pfad_fest', 'This folder is part of the installation and cannot be removed here.');
      pfadeDatei(heim(), pfadeDateiVon()).weg(roh);
      json(a, 200, { ok: true });
    } catch (e) {
      ctx.log({ typ: 'plugin_pfade_fehler', fehler: (e as Error)?.message ?? String(e) });
      abgelehnt(a, 500, 'pfade_fehler', 'The plugin folders file could not be written.');
    }
  };
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
    { methode: 'GET', pfad: '/plugins/pfade', schutz: 'offen', handler: (_q, a) => json(a, 200, { pfade: zeilen(), standard: standardPfade(heim()) }) },
    { methode: 'POST', pfad: '/plugins/pfade/dazu', schutz: 'fremdePost', handler: (q, a) => dazu(q, a) },
    { methode: 'POST', pfad: '/plugins/pfade/weg', schutz: 'fremdePost', handler: (q, a) => weg(q, a) },
    { methode: 'GET', pfad: INSERT_PFAD('parameter'), schutz: 'offen',
      handler: (_q, a, url) => antworte(a, () => zugang.insertParameter(url.pathname.split('/')[3])) },
    { methode: 'POST', pfad: INSERT_PFAD('fenster'), schutz: 'fremdePost',
      handler: async (q, a, url) => { const quelle = ctx.quelle(); await antworte(a, async () => zugang.insertFenster(url.pathname.split('/')[3], await leseKoerper(q), quelle)); } },
    // plan 1.11 task 17: the same three for the device of an instrument track (<spur_id> is in the path)
    { methode: 'GET', pfad: GERAET_PFAD('parameter'), schutz: 'offen',
      handler: (_q, a, url) => antworte(a, () => zugang.geraetParameter(url.pathname.split('/')[3])) },
    { methode: 'GET', pfad: GERAET_PFAD('ist'), schutz: 'offen',
      handler: (_q, a, url) => antworte(a, () => (zugang.geraetIst ?? (async () => { throw new ProjFehler(404, 'nicht_unterstuetzt'); }))(url.pathname.split('/')[3], url.searchParams.get('namen') ?? '')) },
    { methode: 'POST', pfad: GERAET_PFAD('param'), schutz: 'fremdePost',
      handler: async (q, a, url) => { const quelle = ctx.quelle(); await antworte(a, async () => zugang.geraetParam(url.pathname.split('/')[3], await leseKoerper(q), quelle)); } },
    { methode: 'POST', pfad: GERAET_PFAD('fenster'), schutz: 'fremdePost',
      handler: async (q, a, url) => { const quelle = ctx.quelle(); await antworte(a, async () => zugang.geraetFenster(url.pathname.split('/')[3], await leseKoerper(q), quelle)); } },
  ];
  return { name: 'plugins', routen: () => routen };
}
