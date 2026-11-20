// Loop set area (loop deck plan S1b): the content of one loop deck (grid and 4 x 8 cells) as a folder in the store kind `loopsets`.
//   GET  /loopsets                              {sets: [{name, raster, zellen, geaendert}]}; `zellen` counts the filled cells, `geaendert` is the mtime of set.json (ISO)
//   POST /loopset/speichern {deck, name}        -> {ok, name}; an existing name is overwritten (temp folder, then rename; the old set stays if anything fails)
//   POST /loopset/laden {deck, name}            -> {ok}; replaces the grid and all 32 cells of the deck in ONE undo step; a missing deck is created in the same step
// Folder `<store>/<name>/`: `set.json` (format 1, the cells without `id` and `pfad_hinweis`, each with `datei: audio/<sha>.<ext>`) and `audio/<sha>.<ext>`.
// A set holds its own copy of the audio, so it loads without the project it came from. Loading copies the audio into the live project (`loops/`, a
// project-relative `pfad_hinweis`, as a load of POST /loopdeck/laden does) and checks length (zu_lang) and the distinct audio budget (audio_budget) of the
// project AFTER the command before anything is written. A refusal changes nothing and leaves no file in the project.
// Playing cells keep sounding (E7): this area only replaces the cells; the core keeps the voice of a replaced cell.
// Refusals are {ok: false, grund, text}: set_unbekannt (409), set_defekt (409, folder unreadable or its audio missing or altered), audio_fehlt (409, a
// cell's audio is missing in the project), kein_loopdeck (409, save without a deck), ki_gestoppt (409), argument_ungueltig (400, name or deck),
// audio_budget, zu_lang (409).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type http from 'node:http';
import type { BereichKontext, Route } from '../../http/router.ts';
import { json } from '../../http/transport.ts';
import { alsAntwort, leseKoerper, type ProjZugang } from '../proj/area.ts';
import { fuehreListeAus } from '../../project/commands.ts';
import { LOOPDECK_LABEL } from '../../project/commands_loopdeck.ts';
import { LOOP_MAX_FRAMES, LOOP_RASTER_BEATS, LOOP_SPUREN, LOOP_ZELLEN, loopDeckGruppe, loopDeckSpuren, type LoopRaster, type Projekt, type Zelle } from '../../project/model.ts';
import { leseWavF32Bloecke } from '../../sampler/wav.ts';
import { ablageOrdner } from '../../paths.ts';
import { AUDIO_BUDGET_BYTES, LoopFehler, loopdeckBereichVon, type LoopdeckBereich } from './loopdeck.ts';

type Quelle = 'andreas' | 'cypher';
type Antwort = { code: number; j: unknown };
type SetZelle = { name: string; farbe: number; art: 'loop' | 'einmal'; sha256: string; beats?: number; bpm?: number; gain_db: number; datei: string };
interface SetDatei { format: 1; name: string; raster: LoopRaster; spuren: { zellen: (SetZelle | null)[] }[] }
export interface LoopsetsOptionen {
  ordner?(): string;                 // the store (absent: the storage kind `loopsets`); tests pass a temp folder
  loopdeck?: LoopdeckBereich;        // absent: the loop deck area of the same project access (server.ts melds loopdeck first)
}

const TEXTE: Record<string, string> = {
  set_unbekannt: 'No loop set with that name.', set_defekt: 'The loop set is damaged: set.json or its audio is missing or altered.',
  audio_fehlt: 'The audio of a cell is missing in the project.', kein_loopdeck: 'No loop deck on that place.',
  argument_ungueltig: 'Invalid argument.', argument_unbekannt: 'Unknown argument.',
};
const fehler = (code: number, grund: string, text: string = TEXTE[grund] ?? grund): LoopFehler => new LoopFehler(code, grund, text);
const ungueltig = (text: string): never => { throw fehler(400, 'argument_ungueltig', text); };

const NAME = /^[\p{L}\p{N} _-]{1,64}$/u;
function setName(d: Record<string, unknown>): string {
  const n = d.name;
  if (typeof n !== 'string' || !NAME.test(n) || n.trim() !== n) return ungueltig('name: 1..64 characters, letters, digits, space, - and _ (no space at either end)');
  return n;
}
function deckArg(d: Record<string, unknown>): 1 | 2 {
  if (d.deck !== 1 && d.deck !== 2) return ungueltig('deck: integer 1..2 expected');
  return d.deck;
}
function nurFelder(d: Record<string, unknown>, erlaubt: readonly string[]): void {
  for (const k of Object.keys(d)) if (!erlaubt.includes(k)) throw fehler(400, 'argument_unbekannt', `Unknown argument: ${k}`);
}
const dateiTeil = (s: string): string => s.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'cell';
const sicherRelativ = (h: string): boolean => h !== '' && !path.isAbsolute(h) && !h.split(/[\\/]/).includes('..');

async function sha256Datei(pfad: string): Promise<string> {
  const h = crypto.createHash('sha256');
  for await (const b of fs.createReadStream(pfad)) h.update(b as Buffer);
  return h.digest('hex');
}

// set.json read defensively: the folder may have been edited by hand
function pruefeSet(x: unknown, name: string): SetDatei {
  const bad = (): never => { throw fehler(409, 'set_defekt'); };
  if (x === null || typeof x !== 'object') return bad();
  const o = x as Record<string, unknown>;
  if (o.format !== 1 || typeof o.raster !== 'string' || !Object.hasOwn(LOOP_RASTER_BEATS, o.raster) || !Array.isArray(o.spuren) || o.spuren.length !== LOOP_SPUREN) return bad();
  const spuren = o.spuren.map((s: unknown) => {
    const z = (s as { zellen?: unknown } | null)?.zellen;
    if (!Array.isArray(z) || z.length !== LOOP_ZELLEN) return bad();
    return { zellen: z.map((c: unknown): SetZelle | null => {
      if (c === null) return null;
      const k = c as Record<string, unknown> | undefined;
      if (typeof k !== 'object' || k === undefined || typeof k.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(k.sha256)) return bad();
      if (typeof k.datei !== 'string' || k.datei !== `audio/${k.sha256}${path.extname(k.datei)}` || !/^\.[A-Za-z0-9]{1,5}$/.test(path.extname(k.datei))) return bad();
      if (typeof k.name !== 'string' || (k.art !== 'loop' && k.art !== 'einmal') || typeof k.gain_db !== 'number' || typeof k.farbe !== 'number') return bad();
      return { name: k.name, farbe: k.farbe, art: k.art, sha256: k.sha256, gain_db: k.gain_db, datei: k.datei,
        ...(typeof k.beats === 'number' ? { beats: k.beats } : {}), ...(typeof k.bpm === 'number' ? { bpm: k.bpm } : {}) };
    }) };
  });
  return { format: 1, name, raster: o.raster as LoopRaster, spuren };
}

export class LoopsetsBereich {
  readonly name = 'loopsets';
  private zaehler = 0;
  private readonly ctx: BereichKontext;
  private readonly zugang: ProjZugang;
  private readonly o: LoopsetsOptionen;
  constructor(ctx: BereichKontext, zugang: ProjZugang, o: LoopsetsOptionen = {}) { this.ctx = ctx; this.zugang = zugang; this.o = o; }

  private get deckBereich(): LoopdeckBereich {
    const b = this.o.loopdeck ?? loopdeckBereichVon(this.zugang);
    if (!b) throw new Error('loopsets: the loop deck area must be melded first');
    return b;
  }
  private wurzel(): string { return this.o.ordner?.() ?? ablageOrdner('loopsets'); }

  liste(): Antwort {
    const w = this.wurzel();
    const sets: { name: string; raster: LoopRaster; zellen: number; geaendert: string }[] = [];
    let namen: string[] = [];
    try { namen = fs.readdirSync(w); } catch { /* no store yet: no sets */ }
    for (const n of namen.filter((x) => !x.startsWith('.') && NAME.test(x)).sort()) {
      try {
        const datei = path.join(w, n, 'set.json');
        const s = pruefeSet(JSON.parse(fs.readFileSync(datei, 'utf8')), n);
        sets.push({ name: n, raster: s.raster, zellen: s.spuren.reduce((a, sp) => a + sp.zellen.filter((c) => c !== null).length, 0), geaendert: fs.statSync(datei).mtime.toISOString() });
      } catch { /* a folder without a readable set.json is not a set */ }
    }
    return { code: 200, j: { sets } };
  }

  speichern(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> { return this.antwort(() => this.speichernSicher(d, quelle)); }
  private async speichernSicher(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> {
    nurFelder(d, ['deck', 'name']);
    this.deckBereich.riegel(quelle);
    const platz = deckArg(d), name = setName(d);
    const o = this.zugang.offen();
    const g = o ? loopDeckGruppe(o.projekt, platz) : null;
    if (!o || !g?.loopdeck) throw fehler(409, 'kein_loopdeck');
    const spuren = loopDeckSpuren(o.projekt, g);
    if (spuren.length !== LOOP_SPUREN) throw fehler(409, 'kein_loopdeck');
    const wurzel = this.wurzel();
    const id = `${process.pid}-${++this.zaehler}`;
    const tmp = path.join(wurzel, `.${name}.neu-${id}`), alt = path.join(wurzel, `.${name}.alt-${id}`), ziel = path.join(wurzel, name);
    fs.mkdirSync(path.join(tmp, 'audio'), { recursive: true });
    try {
      const kopiert = new Set<string>();
      const datei: SetDatei = { format: 1, name, raster: g.loopdeck.raster, spuren: [] };
      for (const s of spuren) {
        const zellen: (SetZelle | null)[] = [];
        for (const z of s.zellen ?? []) {
          if (!z) { zellen.push(null); continue; }
          const hinweis = z.pfad_hinweis ?? '';
          const quell = path.join(o.ordner, hinweis);
          if (!sicherRelativ(hinweis) || !fs.existsSync(quell)) throw fehler(409, 'audio_fehlt', `The audio of cell '${z.name}' is missing in the project.`);
          const ext = /^\.[A-Za-z0-9]{1,5}$/.test(path.extname(hinweis)) ? path.extname(hinweis) : '.wav';
          const rel = `audio/${z.sha256}${ext}`;
          if (!kopiert.has(z.sha256)) { await fs.promises.copyFile(quell, path.join(tmp, rel)); kopiert.add(z.sha256); }
          zellen.push({ name: z.name, farbe: z.farbe, art: z.art, sha256: z.sha256, ...(z.beats !== undefined ? { beats: z.beats } : {}),
            ...(z.bpm !== undefined ? { bpm: z.bpm } : {}), gain_db: z.gain_db, datei: rel });
        }
        datei.spuren.push({ zellen });
      }
      fs.writeFileSync(path.join(tmp, 'set.json'), `${JSON.stringify(datei, null, 2)}\n`);
      // the new folder replaces the old one by two renames; if the second fails the old set is put back
      const hatAlt = fs.existsSync(ziel);
      if (hatAlt) fs.renameSync(ziel, alt);
      try { fs.renameSync(tmp, ziel); } catch (e) { if (hatAlt) fs.renameSync(alt, ziel); throw e; }
      if (hatAlt) fs.rmSync(alt, { recursive: true, force: true });
    } catch (e) {
      fs.rmSync(tmp, { recursive: true, force: true });
      throw e;
    }
    return { code: 200, j: { ok: true, name } };
  }

  laden(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> { return this.antwort(() => this.ladenSicher(d, quelle)); }
  private async ladenSicher(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> {
    nurFelder(d, ['deck', 'name']);
    const b = this.deckBereich;
    b.riegel(quelle);
    const platz = deckArg(d), name = setName(d);
    const ordner = path.join(this.wurzel(), name);
    let roh: unknown;
    try { roh = JSON.parse(fs.readFileSync(path.join(ordner, 'set.json'), 'utf8')); } catch (e) {
      throw (e as NodeJS.ErrnoException).code === 'ENOENT' ? fehler(409, 'set_unbekannt') : fehler(409, 'set_defekt');
    }
    const set = pruefeSet(roh, name);
    // the audio of the set: length and checksum are known before anything is written to the project
    const audio = new Map<string, { abs: string; frames: number; name: string }>();
    for (const s of set.spuren) for (const z of s.zellen) {
      if (!z || audio.has(z.sha256)) continue;
      const abs = path.join(ordner, z.datei);
      let frames: number;
      try { frames = leseWavF32Bloecke(abs, 48000, () => {}); } catch { throw fehler(409, 'set_defekt'); }
      if (frames > LOOP_MAX_FRAMES) throw fehler(409, 'zu_lang');
      if (await sha256Datei(abs) !== z.sha256) throw fehler(409, 'set_defekt');
      audio.set(z.sha256, { abs, frames, name: z.name });
    }
    await b.container(quelle);
    const vorher = this.zugang.offen()!;
    // the command list on a project state: [loopdeck_neu when missing], grid, clear, 32 x zelle_setzen
    const baue = (p: Projekt, pfade: Map<string, string>): { befehle: unknown[]; label: string } => {
      const befehle: unknown[] = [];
      let q = p, label: string = LOOPDECK_LABEL.loopdeck_leeren;
      if (!loopDeckGruppe(q, platz)) { befehle.push({ befehl: 'loopdeck_neu', platz, raster: set.raster }); q = this.probe(p, befehle, quelle); label = LOOPDECK_LABEL.loopdeck_neu; }
      const g = loopDeckGruppe(q, platz)!;
      if (g.loopdeck!.raster !== set.raster) befehle.push({ befehl: 'loopdeck_aendern', gruppe_id: g.id, raster: set.raster });
      befehle.push({ befehl: 'loopdeck_leeren', gruppe_id: g.id });
      const spuren = loopDeckSpuren(q, g);
      set.spuren.forEach((s, i) => s.zellen.forEach((z, k) => {
        if (!z) return;
        const zelle: Omit<Zelle, 'id'> = { name: z.name, farbe: z.farbe, art: z.art, sha256: z.sha256, gain_db: z.gain_db,
          ...(z.beats !== undefined ? { beats: z.beats } : {}), ...(z.bpm !== undefined ? { bpm: z.bpm } : {}), pfad_hinweis: pfade.get(z.sha256) ?? `loops/${z.sha256}.wav` };
        befehle.push({ befehl: 'zelle_setzen', spur_id: spuren[i].id, index: k + 1, zelle });
      }));
      return { befehle, label };
    };
    // budget on the project after the command, with the paths still to come (the paths are not part of the check)
    const neue = [...audio.entries()].map(([sha256, a]) => ({ sha256, frames: a.frames }));
    const trocken = baue(vorher.projekt, new Map());
    if (b.audioBytes(this.probe(vorher.projekt, trocken.befehle, quelle), neue) > AUDIO_BUDGET_BYTES) throw fehler(409, 'audio_budget');
    // the audio goes into the live project; whatever was copied is removed again when anything below fails
    const geschrieben: string[] = [];
    try {
      const pfade = new Map<string, string>();
      fs.mkdirSync(path.join(vorher.ordner, 'loops'), { recursive: true });
      for (const [sha, a] of audio) {
        const datei = `${this.zugang.naechsteNummer()}-L${platz}-${dateiTeil(a.name)}.wav`;
        const abs = path.join(vorher.ordner, 'loops', datei);
        await fs.promises.copyFile(a.abs, abs, fs.constants.COPYFILE_EXCL);
        geschrieben.push(abs);
        pfade.set(sha, `loops/${datei}`);
      }
      // the state after the awaits: the command list is built on it, and nothing awaits up to the command
      const o = this.zugang.offen();
      if (!o || o.slug !== vorher.slug || !o.projekt.live) throw fehler(409, 'projekt_gewechselt', 'The live container changed while the audio was written.');
      const { befehle, label } = baue(o.projekt, pfade);
      if (b.audioBytes(this.probe(o.projekt, befehle, quelle), neue) > AUDIO_BUDGET_BYTES) throw fehler(409, 'audio_budget');
      await b.schreibe(befehle, label, quelle);
    } catch (e) {
      for (const f of geschrieben) fs.rmSync(f, { force: true });
      throw e;
    }
    return { code: 200, j: { ok: true } };
  }
  // a trial run of a command list (the model's own checks), the result project or a refusal
  private probe(von: Projekt, befehle: unknown[], quelle: Quelle): Projekt {
    try { return fuehreListeAus(von, befehle, { quelle }).projekt; } catch (e) { throw this.deckBereich.fehlerVon(e); }
  }

  private async antwort(f: () => Promise<Antwort>): Promise<Antwort> {
    try { return await f(); } catch (e0) {
      const e = e0 instanceof LoopFehler ? e0 : this.deckBereich.fehlerVon(e0);
      return e instanceof LoopFehler ? { code: e.code, j: { ok: false, grund: e.grund, text: e.text } } : alsAntwort(e, this.ctx);
    }
  }

  routen(): Route[] {
    const ctx = this.ctx;
    const antworte = async (r: http.ServerResponse, f: () => Antwort | Promise<Antwort>): Promise<void> => {
      const x = await this.antwort(async () => f());
      json(r, x.code, x.j);
    };
    const post = (pfad: string, f: (d: Record<string, unknown>, q: Quelle) => Promise<Antwort>): Route => ({
      methode: 'POST', pfad, schutz: 'fremdePost', handler: async (q, r) => {
        const quelle = ctx.quelle();   // before the await (pattern of the other live routes)
        await antworte(r, async () => f(await leseKoerper(q), quelle));
      } });
    return [
      { methode: 'GET', pfad: '/loopsets', schutz: 'offen', handler: async (_q, r) => antworte(r, () => this.liste()) },
      post('/loopset/speichern', (d, q) => this.speichern(d, q)),
      post('/loopset/laden', (d, q) => this.laden(d, q)),
    ];
  }
}

export function loopsetsBereich(ctx: BereichKontext, zugang: ProjZugang, o: LoopsetsOptionen = {}): LoopsetsBereich {
  return new LoopsetsBereich(ctx, zugang, o);
}
