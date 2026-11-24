// The catalogue routes of the page server (browser plan 1).
//   POST /bibliothek/bauen    starts the catalogue build or joins the running one → { ok: true, laeuft: true }   (page protection)
//   GET  /bibliothek/stand    → { phase, fertig, gesamt, letzter_bau, fremd, leer, hinweis?, katalog }
//   GET  /bibliothek/midi?text=&max=   → { dateien: [{ pfad, name, groesse }] } from the MIDI sidecar of the last build
//   GET  /bibliothek/quellen          → { datei, quellen: [{ pfad, typ, fehlt }] }
//   POST /bibliothek/quellen/dazu {pfad, typ}   adds a folder below home, /media/<user> or /mnt, starts a build (page protection)
//   POST /bibliothek/quellen/weg {pfad}         removes a source
import type http from 'node:http';
import type { Bereich, BereichKontext, Route } from '../../http/router.ts';
import path from 'node:path';
import { json, koerper } from '../../http/transport.ts';
import { grundText } from '../../http/reasons.ts';
import { ImportFehler, erlaubteWurzeln, importText, istOrdner, loeseAuf, type Wurzel } from '../../importe.ts';
import { KatalogFehler, istQuellenTyp, type KatalogJob } from '../../catalog_job.ts';

export interface BibliothekOptionen { erlaubt?: () => Wurzel[] }

const MIDI_STANDARD = 200;
const MIDI_MAX = 1000;

export function bibliothekBereich(ctx: Pick<BereichKontext, 'log'>, job: KatalogJob, opt: BibliothekOptionen = {}): Bereich {
  const bauen = (_q: http.IncomingMessage, a: http.ServerResponse): void => {
    ctx.log({ typ: 'bibliothek_bauen' });
    json(a, 200, { ok: true, ...job.starte() });
  };
  const stand = async (_q: http.IncomingMessage, a: http.ServerResponse): Promise<void> => {
    try { json(a, 200, await job.stand()); }
    catch (e) { ctx.log({ typ: 'bibliothek_fehler', fehler: (e as Error)?.message ?? String(e) }); json(a, 500, { ok: false, grund: 'katalog_fehler', fehler: 'katalog_fehler', text: 'the catalogue state could not be read' }); }
  };
  const midi = async (_q: http.IncomingMessage, a: http.ServerResponse, url: URL): Promise<void> => {
    const text = (url.searchParams.get('text') ?? '').trim().toLowerCase();
    const m = Number(url.searchParams.get('max'));
    const max = Number.isInteger(m) && m > 0 ? Math.min(m, MIDI_MAX) : MIDI_STANDARD;
    const alle = await job.midiListe();
    json(a, 200, { dateien: alle.filter((d) => text === '' || d.name.toLowerCase().includes(text)).slice(0, max) });
  };
  const fehler = (a: http.ServerResponse, e: unknown): void => {
    if (e instanceof KatalogFehler || e instanceof ImportFehler) {
      ctx.log({ typ: 'bibliothek_abgelehnt', grund: e.grund });
      return json(a, e.code, { ok: false, grund: e.grund, fehler: e.grund, text: e instanceof ImportFehler ? importText(e.grund) : grundText(e.grund), ...(e.detail ? { detail: e.detail } : {}) });
    }
    ctx.log({ typ: 'bibliothek_fehler', fehler: (e as Error)?.message ?? String(e) });
    json(a, 500, { ok: false, grund: 'katalog_fehler', fehler: 'katalog_fehler', text: grundText('katalog_fehler') });
  };
  const body = async (q: http.IncomingMessage): Promise<Record<string, unknown>> => {
    try { return await koerper(q); } catch { throw new KatalogFehler(400, 'argument_ungueltig', 'body'); }
  };
  /** The realpath of a folder the page may register: absolute, below the allowed roots, an existing directory. */
  const quellPfad = (roh: unknown): string => {
    if (typeof roh !== 'string' || roh === '' || roh.includes('\0') || !path.isAbsolute(roh)) throw new KatalogFehler(400, 'quelle_ungueltig', 'pfad');
    const real = loeseAuf(roh, (opt.erlaubt ?? erlaubteWurzeln)());   // 403 pfad_ausserhalb, 404 pfad_fehlt, 403 pfad_nicht_lesbar
    if (!istOrdner(real)) throw new KatalogFehler(400, 'quelle_ungueltig', 'pfad is not a folder');
    return real;
  };
  const quellen = async (_q: http.IncomingMessage, a: http.ServerResponse): Promise<void> => {
    try { json(a, 200, await job.quellen()); } catch (e) { fehler(a, e); }
  };
  const dazu = async (q: http.IncomingMessage, a: http.ServerResponse): Promise<void> => {
    try {
      const d = await body(q);
      const typ = d.typ === undefined ? 'auto' : d.typ;
      if (!istQuellenTyp(typ)) throw new KatalogFehler(400, 'argument_ungueltig', 'typ');
      await job.dazu(quellPfad(d.pfad), typ);
      ctx.log({ typ: 'bibliothek_quelle_dazu' });
      json(a, 200, { ok: true });
    } catch (e) { fehler(a, e); }
  };
  const weg = async (q: http.IncomingMessage, a: http.ServerResponse): Promise<void> => {
    try {
      const d = await body(q);
      if (typeof d.pfad !== 'string' || d.pfad === '' || d.pfad.includes('\0') || !path.isAbsolute(d.pfad)) throw new KatalogFehler(400, 'quelle_ungueltig', 'pfad');
      await job.weg(path.resolve(d.pfad));
      ctx.log({ typ: 'bibliothek_quelle_weg' });
      json(a, 200, { ok: true });
    } catch (e) { fehler(a, e); }
  };
  const routen = (): Route[] => [
    { methode: 'POST', pfad: '/bibliothek/bauen', schutz: 'fremdePost', handler: bauen },
    { methode: 'GET', pfad: '/bibliothek/stand', schutz: 'offen', handler: stand },
    { methode: 'GET', pfad: '/bibliothek/midi', schutz: 'offen', handler: (q, a, url) => midi(q, a, url) },
    { methode: 'GET', pfad: '/bibliothek/quellen', schutz: 'offen', handler: (q, a) => quellen(q, a) },
    { methode: 'POST', pfad: '/bibliothek/quellen/dazu', schutz: 'fremdePost', handler: (q, a) => dazu(q, a) },
    { methode: 'POST', pfad: '/bibliothek/quellen/weg', schutz: 'fremdePost', handler: (q, a) => weg(q, a) },
  ];
  return { name: 'bibliothek', routen };
}
