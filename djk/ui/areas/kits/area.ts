// The kit routes of the page server (browser plan 5).
//   GET  /kits                              { kits: [{ name, pads, quelle }] }                       open
//   GET  /kits/export?name=[&quelle=projekt] the kit as a zip download                              owner, loopback Host
//   POST /kits/import?name=                  raw zip body (x-djk-roh: 1) -> { ok, name, umbenannt? }  owner
//   POST /kits/umbenennen {name, neu, quelle?} · /kits/kopie {name, neu?, quelle?} · /kits/loeschen {name, trotzdem?, quelle?} -> { ok, name }   page
//   POST /kits/vorhoeren {name, pad?, quelle?}  renders the pads to one WAV and plays it on the preview path          page
//   POST /kits/aus_ordner {pfad, name}       a new kit from a folder of audio files (roots check; the tablet is refused by TABLET_VERBOTEN)   page
//   `quelle` ('global' | 'projekt', as GET /kits lists it) says which kit of that name is meant; without it the global one is preferred.
// Errors answer { ok: false, grund, text, fehler } (http/error_form.ts).
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import type { Bereich, BereichKontext, Route } from '../../http/router.ts';
import { json, koerper } from '../../http/transport.ts';
import { fehlerKoerper } from '../../http/error_form.ts';
import { grundText } from '../../http/reasons.ts';
import { RohFehler, rohInTeilDatei, rohKopfAbweisung, rohLaenge } from '../../http/roh.ts';
import { VorhoerFehler } from '../../prelisten.ts';
import { KIT_NAME } from '../../project/model.ts';
import {
  KIT_MAX_BYTES, KitFehler, benenneKitUm, exportiereKit, installiereKitZip, kitsOrdnerVon, kopiereKit, listeKitsAlle, loescheKit, renderKitVorschau, type VerwaltungsOpt,
} from '../../project/kit_storage.ts';
import { legeKitAusOrdner, type AusOrdnerOpt } from '../../sampler/kit_ordner.ts';
import { kitSchreibGrund } from '../../sampler/bk_schutz.ts';

export interface KitsBereichOptionen {
  kitsOrdner?: string;
  projektOrdner?: () => string | null;
  rohOrdner?: string;                  // temp zips (default: a dot folder inside the kit folder)
  port?: number | (() => number);      // the page's own port (origin and Host checks)
  maxBytes?: number;                   // upload cap (default 256 MiB)
  projekteWurzel?: () => string | null;  // the project folder root: a kit that a project names cannot be renamed or deleted
  ausOrdner?: Pick<AusOrdnerOpt, 'erlaubt' | 'dekodiere'>;   // test hooks: allowed roots and decoder
  vorhoeren?: (wavPfad: string, sha: string) => Promise<void>;   // plays a WAV on the preview path (the server supplies it)
}

export function kitsBereich(ctx: Pick<BereichKontext, 'log' | 'quelle'>, opt: KitsBereichOptionen = {}): Bereich {
  const port = (): number => (typeof opt.port === 'function' ? opt.port() : opt.port ?? 0);
  const kitOpt = (): { kitsOrdner?: string } => (opt.kitsOrdner !== undefined ? { kitsOrdner: opt.kitsOrdner } : {});
  const rohOrdner = (): string => opt.rohOrdner ?? path.join(kitsOrdnerVon(kitOpt()), '.einspielen');
  const projektOrdner = (): string | null => opt.projektOrdner?.() ?? null;

  const fehler = (q: http.IncomingMessage, a: http.ServerResponse, f: { code: number; grund: string; text?: string; detail?: string }, schliessen = false): void => {
    ctx.log({ typ: 'kits_abgelehnt', grund: f.grund });
    if (schliessen) { a.setHeader('connection', 'close'); q.resume(); }
    json(a, f.code, { ...fehlerKoerper(f.grund, f.text ?? grundText(f.grund)), ...(f.detail ? { detail: f.detail } : {}) });
  };
  const unerwartet = (q: http.IncomingMessage, a: http.ServerResponse, e: unknown, schliessen = false): void => {
    if (e instanceof KitFehler || e instanceof RohFehler) return fehler(q, a, e, schliessen);
    // the previewer's refusals (VorhoerFehler: code + fehler such as 'kein_kopfhoerer' or 'vorhoerer_start: <why>'): the reason is the part before the colon
    if (e instanceof VorhoerFehler) return fehler(q, a, { code: e.code, grund: e.fehler.split(':')[0], detail: e.fehler });
    ctx.log({ typ: 'kits_fehler', fehler: (e as Error)?.message ?? String(e) });
    json(a, 500, fehlerKoerper('kit_fehler', grundText('kit_fehler')));
  };

  const liste: Route['handler'] = (_q, a) => {
    json(a, 200, { kits: listeKitsAlle(projektOrdner(), kitOpt()) });
  };

  const exportRoute: Route['handler'] = async (q, a, url) => {
    let tmp: string | null = null;
    try {
      if (ctx.quelle() !== 'andreas') throw new KitFehler(403, 'nur_andreas');
      const host = String(q.headers.host ?? ''), p = port();   // a GET sends no Origin: only a loopback name (DNS rebinding)
      if (host !== `127.0.0.1:${p}` && host !== `localhost:${p}`) throw new KitFehler(421, 'falscher_host');
      const name = url.searchParams.get('name') ?? '';
      if (!KIT_NAME.test(name)) throw new KitFehler(400, 'kit_name_ungueltig');
      const quelle = url.searchParams.get('quelle') === 'projekt' ? 'projekt' : 'global';
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-export-'));
      const zip = path.join(tmp, `${name}.kit.zip`);
      await exportiereKit(name, quelle, projektOrdner(), zip, kitOpt());
      const groesse = fs.statSync(zip).size;
      const aufraeumen = tmp;
      a.writeHead(200, { 'content-type': 'application/zip', 'content-length': groesse, 'content-disposition': `attachment; filename="${name}.kit.zip"`, 'cache-control': 'no-store' });
      const strom = fs.createReadStream(zip);
      const weg = (): void => { try { fs.rmSync(aufraeumen, { recursive: true, force: true }); } catch { /* best effort */ } };
      a.on('close', () => { strom.destroy(); weg(); });
      strom.on('error', () => { a.destroy(); });
      strom.pipe(a);
      tmp = null;
    } catch (e) {
      if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
      unerwartet(q, a, e);
    }
  };

  const importRoute: Route['handler'] = async (q, a, url) => {
    let teil: string | null = null;
    try {
      if (ctx.quelle() !== 'andreas') throw new KitFehler(403, 'nur_andreas');
      const ab = rohKopfAbweisung(q, port());
      if (ab) throw ab;
      const wunsch = url.searchParams.get('name');
      if (wunsch !== null && wunsch !== '' && !KIT_NAME.test(wunsch)) throw new KitFehler(400, 'kit_name_ungueltig');
      const r = await rohInTeilDatei(q, { ordner: rohOrdner(), laenge: rohLaenge(q), maxBytes: opt.maxBytes ?? KIT_MAX_BYTES });
      teil = r.teil;
      const e = await installiereKitZip(teil, wunsch || null, kitOpt());
      ctx.log({ typ: 'kit_import', neu: e.neu });
      json(a, 200, { ok: true, name: e.name, neu: e.neu, ...(e.umbenannt ? { umbenannt: e.umbenannt } : {}) });
    } catch (e) { unerwartet(q, a, e, true); }
    finally { if (teil) fs.rmSync(teil, { force: true }); }
  };

  const quelleAus = (d: Record<string, unknown>): { quelle?: 'global' | 'projekt' } => {
    if (d.quelle === undefined || d.quelle === null) return {};
    if (d.quelle !== 'global' && d.quelle !== 'projekt') throw new KitFehler(400, 'argument_ungueltig');
    return { quelle: d.quelle };
  };
  const verwOpt = (d: Record<string, unknown>): VerwaltungsOpt => ({
    ...kitOpt(), ...(opt.projekteWurzel?.() ? { projekteWurzel: opt.projekteWurzel() as string } : {}),
    ...(projektOrdner() ? { projektOrdner: projektOrdner() } : {}), ...quelleAus(d),
  });
  const name = (d: Record<string, unknown>, feld = 'name'): string => {
    const n = d[feld];
    if (typeof n !== 'string' || !KIT_NAME.test(n)) throw new KitFehler(400, 'kit_name_ungueltig');
    return n;
  };
  const koerperLesen = async (q: http.IncomingMessage): Promise<Record<string, unknown>> => {
    try { return await koerper(q); } catch { throw new KitFehler(400, 'json'); }
  };
  const verwaltung = (art: 'umbenennen' | 'kopie' | 'loeschen'): Route['handler'] => async (q, a) => {
    try {
      const d = await koerperLesen(q);
      const n = name(d);
      if (art === 'umbenennen') { const neu = name(d, 'neu'); benenneKitUm(n, neu, verwOpt(d)); ctx.log({ typ: 'kit_umbenannt' }); return json(a, 200, { ok: true, name: neu }); }
      if (art === 'kopie') {
        const neu = d.neu === undefined || d.neu === null ? null : name(d, 'neu');
        const r = await kopiereKit(n, neu, verwOpt(d)); ctx.log({ typ: 'kit_kopiert' }); return json(a, 200, { ok: true, name: r.name });
      }
      loescheKit(n, { ...verwOpt(d), trotzdem: d.trotzdem === true });
      ctx.log({ typ: 'kit_geloescht' });
      json(a, 200, { ok: true, name: n });
    } catch (e) { unerwartet(q, a, e); }
  };
  const vorhoeren: Route['handler'] = async (q, a) => {
    try {
      const d = await koerperLesen(q);
      const n = name(d);
      const pad = d.pad === undefined || d.pad === null ? null : d.pad;
      if (pad !== null && (typeof pad !== 'number' || !Number.isInteger(pad))) throw new KitFehler(400, 'argument_ungueltig');
      if (!opt.vorhoeren) throw new KitFehler(503, 'vorhoeren_nicht_da');
      const r = await renderKitVorschau(n, pad as number | null, verwOpt(d));
      const sha = crypto.createHash('sha256').update(r.wav).digest('hex').slice(0, 16);
      const dir = path.join(rohOrdner(), 'vorhoer');
      { const g = kitSchreibGrund(dir); if (g !== null) throw new KitFehler(409, 'kit_ordner_fehlt', g); }
      fs.mkdirSync(dir, { recursive: true });
      for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true });
      const wav = path.join(dir, `kit-${sha}.wav`);
      fs.writeFileSync(wav, r.wav);
      await opt.vorhoeren(wav, `kit:${n}/${pad ?? 'alle'}/${sha}`);
      json(a, 200, { ok: true });
    } catch (e) { unerwartet(q, a, e); }
  };

  const ausOrdner: Route['handler'] = async (q, a) => {
    try {
      const d = await koerperLesen(q);
      if (typeof d.pfad !== 'string') throw new KitFehler(400, 'argument_ungueltig');
      const r = await legeKitAusOrdner({ pfad: d.pfad, name: name(d) }, { ...kitOpt(), ...(opt.ausOrdner ?? {}) });
      ctx.log({ typ: 'kit_aus_ordner', pads: r.pads });
      json(a, 200, { ok: true, name: r.name, pads: r.pads, uebrig: r.uebrig });
    } catch (e) { unerwartet(q, a, e); }
  };

  const routen = (): Route[] => [
    { methode: 'GET', pfad: '/kits', schutz: 'offen', handler: liste },
    { methode: 'GET', pfad: '/kits/export', schutz: 'offen', handler: exportRoute },
    { methode: 'POST', pfad: '/kits/import', schutz: 'offen', offenErlaubt: true, handler: importRoute },
    { methode: 'POST', pfad: '/kits/umbenennen', schutz: 'fremdePost', handler: verwaltung('umbenennen') },
    { methode: 'POST', pfad: '/kits/kopie', schutz: 'fremdePost', handler: verwaltung('kopie') },
    { methode: 'POST', pfad: '/kits/loeschen', schutz: 'fremdePost', handler: verwaltung('loeschen') },
    { methode: 'POST', pfad: '/kits/vorhoeren', schutz: 'fremdePost', handler: vorhoeren },
    { methode: 'POST', pfad: '/kits/aus_ordner', schutz: 'fremdePost', handler: ausOrdner },
  ];
  return { name: 'kits', routen };
}
