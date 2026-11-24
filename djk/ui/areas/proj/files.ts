// Project files for the browser (browser plan 2; contract "Plan 2"): GET /proj/dateien (task 1), finden, relink, aufraeumen (task 2),
// umbenennen and the "last opened" stamp (task 4). Built like einsammeln.ts: a Bereich over ProjZugang.
import crypto from 'node:crypto';
import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';
import type { Bereich, BereichKontext } from '../../http/router.ts';
import { json } from '../../http/transport.ts';
import { kopiereGeprueft, zeitLimitMs } from '../../project/einsammeln.ts';
import { einsammelName } from '../../project/source_path.ts';
import { alsAntwort, leseKoerper, type ProjZugang } from './area.ts';
import { ProjFehler } from './session.ts';
import { AblageFehler, Projekte } from '../../project/storage.ts';
import { merkeZuletzt } from '../../project/zuletzt.ts';
import { dateienSicht, hinweisVon, unreferenziert, type GeretteterTake } from './files_view.ts';

export interface DateienOptionen {
  quellPfad: (sha: string, hinweis: string) => string | null;   // the session's resolver (catalog, hint, collected copy)
  katalogName?: (sha: string) => string | null;
  katalogDa?: () => boolean;                                    // false: there is no catalogue file (finden answers 503 katalog_fehlt); absent = there is one
  arbeitLaeuft?: () => boolean;                                 // a bounce, resample, stems or other output job runs: CLEAN UP refuses; absent = none
  wurzel: () => string;                                         // the project root folder
  gerettetListe?: (ordner: string) => Promise<GeretteterTake[]>;   // plan 4 (recovered takes); absent = none
}

// one error shape for the browser routes: { ok: false, grund, fehler, text } (contract); grund and fehler carry the same code.
// Called with a ground code first and a literal English sentence second: tests/proj_reasons_text.test.mjs reads these calls and demands a literal sentence.
export function fehl(grund: string, text: string, code = 409): ProjFehler {
  const extra = { ok: false, grund, fehler: grund, text };
  return new ProjFehler(code, grund, extra);
}

const SHA = /^[0-9a-f]{64}$/;
const echt = (p: string): string => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const drin = (wurzel: string, p: string): boolean => p.startsWith(wurzel.endsWith(path.sep) ? wurzel : wurzel + path.sep);

// UTC stamp of a CLEAN UP run: 20261123T101500Z
const stempel = (d: Date): string => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

export function dateienBereich(ctx: BereichKontext, zugang: ProjZugang, opt: DateienOptionen): Bereich {
  const offen = (): NonNullable<ReturnType<ProjZugang['offen']>> => {
    const o = zugang.offen();
    if (!o) throw fehl('kein_projekt', 'no project is open');
    return o;
  };
  // plan 4 may fail or be absent: the list is then empty and the failure is logged
  const gerettet = async (ordner: string): Promise<GeretteterTake[]> => {
    if (!opt.gerettetListe) return [];
    try { return await opt.gerettetListe(ordner); } catch (e) { ctx.log({ typ: 'dateien_gerettet', fehler: (e as Error).message }); return []; }
  };
  const antworte = async (r: http.ServerResponse, f: () => Promise<unknown>): Promise<void> => {
    let code = 200, j: unknown;
    try { j = await f(); } catch (e) { const x = alsAntwort(e, ctx); code = x.code; j = x.j; }
    json(r, code, j);
  };
  const koerperVon = async (q: http.IncomingMessage): Promise<Record<string, unknown>> => {
    try { return await leseKoerper(q); } catch { throw fehl('argument_ungueltig', 'the request body is not a valid JSON object of at most 1 MiB', 400); }
  };
  const nurFelder = (d: Record<string, unknown>, ...erlaubt: string[]): void => {
    for (const k of Object.keys(d)) if (!erlaubt.includes(k)) throw fehl('argument_ungueltig', 'the request has a field this route does not take', 400);
  };
  const stoppt = (quelle: 'andreas' | 'cypher'): void => {
    if (quelle === 'cypher' && ctx.kiGestoppt()) throw fehl('ki_gestoppt', 'Stop Cypher is set; Cypher cannot change project files now');
  };
  const shaArg = (d: Record<string, unknown>): string => {
    if (typeof d.sha256 !== 'string' || !SHA.test(d.sha256)) throw fehl('argument_ungueltig', 'sha256 must be 64 lower case hex characters', 400);
    return d.sha256;
  };

  // copies `von` into <project>/audio/<name>-<sha8>.<ext> through a checked copy (nice 19); the content hash must be `sha`. Returns the new path.
  const legeKopie = async (ordner: string, von: string, sha: string): Promise<string> => {
    const audio = path.join(ordner, 'audio');
    const ziel = path.join(audio, einsammelName(von, sha));
    const tmp = path.join(audio, `.q-${path.basename(ziel)}.tmp-${crypto.randomBytes(4).toString('hex')}`);
    fs.mkdirSync(audio, { recursive: true });
    try {
      const h = await kopiereGeprueft(von, tmp, { zeitMs: zeitLimitMs(fs.statSync(von).size) });
      if (h !== sha) throw fehl('sha_stimmt_nicht', 'that file does not have the content the project expects (its sha256 differs)');
      const fd = fs.openSync(tmp, 'r+');
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, ziel);
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* nothing to remove */ }
      if (e instanceof ProjFehler) throw e;
      throw fehl('datei_unlesbar', 'the file could not be read or copied', 400);
    }
    return ziel;
  };

  // the stamp of the project list: when another project is open than the last stamped one, it is stamped; a failed write is logged, never thrown
  let letzterStempel: string | null = null;
  zugang.beiSchliessen(() => { letzterStempel = null; });   // reopening the same project stamps it again
  zugang.beiStand(() => {
    const slug = zugang.offen()?.slug ?? null;
    if (slug === null || slug === letzterStempel) return;
    letzterStempel = slug;
    try { merkeZuletzt(opt.wurzel(), slug, new Date()); } catch (e) { ctx.log({ typ: 'zuletzt_fehler', fehler: (e as Error).message }); }
  });

  return {
    name: 'proj-dateien',
    routen: () => [
      { methode: 'POST', pfad: '/proj/umbenennen', schutz: 'fremdePost', handler: async (q, r) => {
        const quelle = ctx.quelle();
        await antworte(r, async () => {
          const d = await koerperVon(q);
          nurFelder(d, 'slug', 'name');
          stoppt(quelle);
          if (typeof d.slug !== 'string' || d.slug === '') throw fehl('argument_ungueltig', 'slug must be the name of a project folder', 400);
          const name = typeof d.name === 'string' ? d.name.trim() : '';
          if (name.length < 1 || name.length > 80) throw fehl('name_ungueltig', 'a project name needs 1 to 80 characters', 400);
          if (zugang.offen()?.slug === d.slug) throw fehl('projekt_offen', 'the open project cannot be renamed; use SAVE AS or open another project first');
          const speicher = new Projekte(opt.wurzel());
          try {
            const projekt = speicher.lies(d.slug);
            const klein = name.toLowerCase();
            if (speicher.liste().some((x) => x.slug !== d.slug && x.name.toLowerCase() === klein)) {
              throw fehl('name_vergeben', 'another project already has that name');
            }
            speicher.speichere(d.slug, { ...projekt, name });
          } catch (e) {
            if (e instanceof AblageFehler && e.fehler === 'unbekannt') throw fehl('unbekannt', 'no such project', 404);
            if (e instanceof AblageFehler && e.code === 400) throw fehl('argument_ungueltig', 'slug must be the name of a project folder', 400);
            throw e;
          }
          return { ok: true, slug: d.slug };
        });
      } },
      { methode: 'GET', pfad: '/proj/dateien', schutz: 'offen', handler: async (_q, r) => antworte(r, async () => {
        const o = offen();
        return dateienSicht({
          projekt: o.projekt, ordner: o.ordner, gerettet: await gerettet(o.ordner), quellPfad: opt.quellPfad,
          katalogName: opt.katalogName ?? (() => null),
        });
      }) },
      { methode: 'POST', pfad: '/proj/finden', schutz: 'fremdePost', handler: async (q, r) => {
        const quelle = ctx.quelle();
        await antworte(r, async () => {
          const d = await koerperVon(q);
          nurFelder(d, 'sha256');
          stoppt(quelle);
          const sha = shaArg(d);
          const o = offen();
          if (opt.katalogDa && !opt.katalogDa()) throw fehl('katalog_fehlt', 'no library catalogue exists yet; add a folder to the library first', 503);
          const pfad = opt.quellPfad(sha, hinweisVon(o.projekt, sha));
          if (pfad === null) {
            return { ok: false, grund: 'nicht_gefunden', fehler: 'nicht_gefunden', text: 'that file was not found in the library or the project' };
          }
          if (drin(echt(path.join(o.ordner, 'audio')), echt(pfad))) return { ok: true, pfad };
          return { ok: true, pfad: await legeKopie(o.ordner, pfad, sha) };
        });
      } },
      { methode: 'POST', pfad: '/proj/relink', schutz: 'fremdePost', handler: async (q, r) => {
        const quelle = ctx.quelle();
        await antworte(r, async () => {
          const d = await koerperVon(q);
          nurFelder(d, 'sha256', 'pfad');
          stoppt(quelle);
          const sha = shaArg(d);
          if (typeof d.pfad !== 'string' || d.pfad === '' || !path.isAbsolute(d.pfad)) {
            throw fehl('argument_ungueltig', 'pfad must be an absolute file path', 400);
          }
          const o = offen();
          let ok = false;
          try { ok = fs.statSync(d.pfad).isFile(); fs.accessSync(d.pfad, fs.constants.R_OK); } catch { ok = false; }
          if (!ok) throw fehl('datei_unlesbar', 'that path is not a readable file', 400);
          await legeKopie(o.ordner, d.pfad, sha);
          return { ok: true };
        });
      } },
      { methode: 'POST', pfad: '/proj/aufraeumen', schutz: 'fremdePost', handler: async (q, r) => {
        const quelle = ctx.quelle();
        await antworte(r, async () => {
          const d = await koerperVon(q);
          nurFelder(d, 'nur_zeigen');
          if (d.nur_zeigen !== undefined && typeof d.nur_zeigen !== 'boolean') throw fehl('argument_ungueltig', 'nur_zeigen must be true or false', 400);
          const nurZeigen = d.nur_zeigen === true;
          if (!nurZeigen) stoppt(quelle);
          const o = offen();
          if (!nurZeigen && opt.arbeitLaeuft?.()) {
            throw fehl('aufraeumen_laeuft_arbeit', 'a bounce, resample or stems job is running; clean up when it is done');
          }
          const dateien = unreferenziert({ projekt: o.projekt, ordner: o.ordner, gerettet: await gerettet(o.ordner) });
          if (nurZeigen || dateien.length === 0) return { dateien, verschoben: false };
          // CLEAN UP never deletes: every file is renamed into .papierkorb/<stamp>/<same relative path>
          const bin = path.join(o.ordner, '.papierkorb');
          let ziel = path.join(bin, stempel(new Date()));
          for (let n = 2; fs.existsSync(ziel); n++) ziel = path.join(bin, `${stempel(new Date())}-${n}`);
          for (const rel of dateien) {
            const nach = path.join(ziel, rel);
            fs.mkdirSync(path.dirname(nach), { recursive: true });
            fs.renameSync(path.join(o.ordner, rel), nach);
          }
          return { dateien, verschoben: true };
        });
      } },
    ],
  };
}
