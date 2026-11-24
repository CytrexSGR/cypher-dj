// The import routes of the page server (browser plan 1).
//   POST /import/datei?name=&ziel=auto|bibliothek|projekt   raw body (header x-djk-roh: 1, Content-Type application/octet-stream) → ImportErgebnis
//   POST /import/pfad {pfad, ziel}                          copies a file from home, /media/<user> or /mnt into the studio (page protection)
//   GET  /dateisystem/ordner?pfad=                          the folder picker: directories only, owner only, same roots
// Owner only (x-djk-quelle andreas). The route has schutz offen with offenErlaubt: its protection is the raw one of http/roh.ts, not the JSON one.
import type http from 'node:http';
import type { Bereich, BereichKontext, Route } from '../../http/router.ts';
import { json, koerper } from '../../http/transport.ts';
import { RohFehler, rohKopfAbweisung, rohLaenge } from '../../http/roh.ts';
import { ImportDienst, ImportFehler, erlaubteWurzeln, importText, listeDateisystem, type Wurzel } from '../../importe.ts';

export interface ImportBereichOptionen { port: number | (() => number); erlaubt?: () => Wurzel[] }
const ZIELE = ['auto', 'bibliothek', 'projekt'] as const;

export function importeBereich(ctx: Pick<BereichKontext, 'log' | 'quelle'>, dienst: ImportDienst, opt: ImportBereichOptionen): Bereich {
  // every refusal closes the connection so a large body is not drained
  const antwort = (q: http.IncomingMessage, a: http.ServerResponse, f: { code: number; grund: string; detail?: string }): void => {
    ctx.log({ typ: 'import_abgelehnt', grund: f.grund });
    a.setHeader('connection', 'close');
    q.resume();
    json(a, f.code, { ok: false, grund: f.grund, fehler: f.grund, text: importText(f.grund), ...(f.detail ? { detail: f.detail } : {}) });
  };
  const datei = async (q: http.IncomingMessage, a: http.ServerResponse, url: URL): Promise<void> => {
    if (ctx.quelle() !== 'andreas') return antwort(q, a, { code: 403, grund: 'nur_andreas' });
    const port = typeof opt.port === 'function' ? opt.port() : opt.port;
    const ab = rohKopfAbweisung(q, port);
    if (ab) return antwort(q, a, ab);
    const ziel = url.searchParams.get('ziel') ?? 'auto';
    if (!(ZIELE as readonly string[]).includes(ziel)) return antwort(q, a, { code: 400, grund: 'argument_ungueltig', detail: 'ziel' });
    try {
      const r = await dienst.nimmAn(q, url.searchParams.get('name') ?? '', ziel as typeof ZIELE[number], rohLaenge(q));
      ctx.log({ typ: 'import_datei', art: r.art });
      json(a, 200, r);
    } catch (e) {
      if (e instanceof ImportFehler || e instanceof RohFehler) return antwort(q, a, e);
      ctx.log({ typ: 'import_fehler', fehler: (e as Error)?.message ?? String(e) });
      json(a, 500, { ok: false, grund: 'import_fehler', fehler: 'import_fehler', text: importText('import_fehler') });
    }
  };
  const gefehlt = (q: http.IncomingMessage, a: http.ServerResponse, e: unknown): void => {
    if (e instanceof ImportFehler || e instanceof RohFehler) return antwort(q, a, e);
    ctx.log({ typ: 'import_fehler', fehler: (e as Error)?.message ?? String(e) });
    json(a, 500, { ok: false, grund: 'import_fehler', fehler: 'import_fehler', text: importText('import_fehler') });
  };
  const pfad = async (q: http.IncomingMessage, a: http.ServerResponse): Promise<void> => {
    try {
      let d: Record<string, unknown>;
      try { d = await koerper(q); } catch { throw new ImportFehler(400, 'argument_ungueltig', 'body'); }
      const ziel = d.ziel === undefined ? 'auto' : d.ziel;
      if (typeof ziel !== 'string' || !(ZIELE as readonly string[]).includes(ziel)) throw new ImportFehler(400, 'argument_ungueltig', 'ziel');
      const r = await dienst.kopiere(d.pfad, ziel as typeof ZIELE[number]);
      ctx.log({ typ: 'import_pfad', art: r.art });
      json(a, 200, r);
    } catch (e) { gefehlt(q, a, e); }
  };
  const ordner = (q: http.IncomingMessage, a: http.ServerResponse, url: URL): void => {
    try {
      if (ctx.quelle() !== 'andreas') throw new ImportFehler(403, 'nur_andreas');
      const host = String(q.headers.host ?? ''), p = typeof opt.port === 'function' ? opt.port() : opt.port;   // a GET sends no Origin: only a loopback name (DNS rebinding)
      if (host !== `127.0.0.1:${p}` && host !== `localhost:${p}`) throw new ImportFehler(421, 'falscher_host');
      json(a, 200, listeDateisystem(url.searchParams.get('pfad') ?? '', (opt.erlaubt ?? erlaubteWurzeln)()));
    } catch (e) { gefehlt(q, a, e); }
  };
  const routen = (): Route[] => [
    { methode: 'POST', pfad: '/import/datei', schutz: 'offen', offenErlaubt: true, handler: (q, a, url) => datei(q, a, url) },
    { methode: 'POST', pfad: '/import/pfad', schutz: 'fremdePost', handler: (q, a) => pfad(q, a) },
    { methode: 'GET', pfad: '/dateisystem/ordner', schutz: 'offen', handler: (q, a, url) => ordner(q, a, url) },
  ];
  return { name: 'importe', routen };
}
