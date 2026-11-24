// Portable projects (browser plan 5, B13): GET /proj/export_zip (the open project as a download) and POST /proj/import_zip (a project zip becomes a new
// project,
// never opened). Owner only; the download also needs a loopback Host (a GET carries no Origin), the upload the raw-body protection of plan 1.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type http from 'node:http';
import type { Bereich, BereichKontext, Route } from '../../http/router.ts';
import { json } from '../../http/transport.ts';
import { fehlerKoerper } from '../../http/error_form.ts';
import { grundText } from '../../http/reasons.ts';
import { RohFehler, rohInTeilDatei, rohKopfAbweisung, rohLaenge } from '../../http/roh.ts';
import { AblageFehler, Projekte } from '../../project/storage.ts';
import { KitFehler } from '../../project/kit_storage.ts';
import { exportiereProjekt, importiereProjektZip, projektAusserhalb, raeumeProjektReste } from '../../project/project_zip.ts';
import { ZipFehler } from '../../project/zipwerk.ts';
import type { ProjZugang } from './area.ts';

export const PROJEKT_ZIP_MAX_BYTES = 4 * 2 ** 30;

export interface PortabelOptionen {
  projekteWurzel: () => string;
  quellPfad: (sha: string, hinweis: string) => string | null;   // the session's resolver (catalog, hint, collected copy)
  kitsOrdner?: string;
  port?: number | (() => number);
  maxBytes?: number;
  frei?: (ordner: string) => number;                            // test hook: free bytes
}

export function portabelBereich(ctx: Pick<BereichKontext, 'log' | 'quelle'>, zugang: Pick<ProjZugang, 'offen'>, opt: PortabelOptionen): Bereich {
  const port = (): number => (typeof opt.port === 'function' ? opt.port() : opt.port ?? 0);
  try { raeumeProjektReste(opt.projekteWurzel()); } catch { /* the root may not exist yet */ }   // leftovers of a crashed export or import
  const fehler = (q: http.IncomingMessage, a: http.ServerResponse, f: { code: number; grund: string; text?: string; detail?: string },
    schliessen = false): void => {
    ctx.log({ typ: 'proj_zip_abgelehnt', grund: f.grund });
    if (schliessen) { a.setHeader('connection', 'close'); q.resume(); }
    json(a, f.code, { ...fehlerKoerper(f.grund, f.text ?? grundText(f.grund)), ...(f.detail ? { detail: f.detail } : {}) });
  };
  const unerwartet = (q: http.IncomingMessage, a: http.ServerResponse, e: unknown, schliessen = false): void => {
    if (e instanceof KitFehler || e instanceof RohFehler) return fehler(q, a, e, schliessen);
    if (e instanceof AblageFehler) return fehler(q, a, { code: e.code, grund: e.fehler, text: e.message }, schliessen);
    if (e instanceof ZipFehler) return fehler(q, a, { code: 400, grund: 'zip_abgelehnt', text: `the zip was refused: ${e.grund}` }, schliessen);
    ctx.log({ typ: 'proj_zip_fehler', fehler: (e as Error)?.message ?? String(e) });
    json(a, 500, fehlerKoerper('kit_fehler', 'internal error while handling the project zip'));
  };

  const exportRoute: Route['handler'] = async (q, a, url) => {
    let tmp: string | null = null;
    try {
      if (ctx.quelle() !== 'andreas') throw new KitFehler(403, 'nur_andreas');
      const host = String(q.headers.host ?? ''), p = port();   // a GET sends no Origin: only a loopback name (DNS rebinding)
      if (host !== `127.0.0.1:${p}` && host !== `localhost:${p}`) throw new KitFehler(421, 'falscher_host');
      const slug = url.searchParams.get('slug') ?? '';
      const o = zugang.offen();
      if (!o || o.slug !== slug) throw new KitFehler(409, 'projekt_nicht_offen');
      const aussen = projektAusserhalb({ projekt: o.projekt, projektOrdner: o.ordner, quellPfad: opt.quellPfad });
      if (aussen.length > 0) throw new KitFehler(409, 'nicht_eingesammelt',
        `${aussen.length} audio file${aussen.length === 1 ? '' : 's'} of the project lie outside its folder: collect all first`);
      const wurzel = opt.projekteWurzel();
      fs.mkdirSync(wurzel, { recursive: true });
      tmp = fs.mkdtempSync(path.join(wurzel, '.export-'));
      const zip = path.join(tmp, `${slug}.cypherdj.zip`);
      await exportiereProjekt({ ordner: o.ordner, zip, ...(opt.kitsOrdner !== undefined ? { kitsOrdner: opt.kitsOrdner } : {}),
        ...(opt.frei ? { frei: opt.frei } : {}) });
      const groesse = fs.statSync(zip).size;
      const aufraeumen = tmp;
      a.writeHead(200, { 'content-type': 'application/zip', 'content-length': groesse,
        'content-disposition': `attachment; filename="${slug}.cypherdj.zip"`, 'cache-control': 'no-store' });
      const strom = fs.createReadStream(zip);
      a.on('close', () => { strom.destroy(); try { fs.rmSync(aufraeumen, { recursive: true, force: true }); } catch { /* best effort */ } });
      strom.on('error', () => { a.destroy(); });
      strom.pipe(a);
      tmp = null;
    } catch (e) {
      if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
      unerwartet(q, a, e);
    }
  };

  const importRoute: Route['handler'] = async (q, a) => {
    let teil: string | null = null, tmpDir: string | null = null;
    try {
      if (ctx.quelle() !== 'andreas') throw new KitFehler(403, 'nur_andreas');
      const ab = rohKopfAbweisung(q, port());
      if (ab) throw ab;
      const wurzel = opt.projekteWurzel();
      tmpDir = path.join(wurzel, `.einspielen-${crypto.randomBytes(5).toString('hex')}`);
      const r = await rohInTeilDatei(q, { ordner: tmpDir, laenge: rohLaenge(q), maxBytes: opt.maxBytes ?? PROJEKT_ZIP_MAX_BYTES,
        ...(opt.frei ? { freierPlatz: opt.frei } : {}) });
      teil = r.teil;
      const b = await importiereProjektZip(teil, { projekte: new Projekte(wurzel), ...(opt.kitsOrdner !== undefined ? { kitsOrdner: opt.kitsOrdner } : {}),
        ...(opt.frei ? { frei: opt.frei } : {}) });
      ctx.log({ typ: 'proj_zip_import', kits_umbenannt: b.kits_umbenannt.length });
      json(a, 200, { ok: true, slug: b.slug, kits_umbenannt: b.kits_umbenannt });
    } catch (e) { unerwartet(q, a, e, true); }
    finally { if (teil) fs.rmSync(teil, { force: true }); if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); }
  };

  const routen = (): Route[] => [
    { methode: 'GET', pfad: '/proj/export_zip', schutz: 'offen', handler: exportRoute },
    { methode: 'POST', pfad: '/proj/import_zip', schutz: 'offen', offenErlaubt: true, handler: importRoute },
  ];
  return { name: 'proj-portabel', routen };
}
