// Session view area (session view M6): the launch grid across the columns of both loop decks, the scenes as rows. It reads the open LIVE project
// (it never opens or creates the live container: SESSION shows what is open, D1) and talks to the core through the loop deck area's helpers.
//   GET  /session/stand                         -> SessionStand (session_state.ts); 409 kein_projekt when no live project is open
//   POST /session/start {spur_id, zelle, raster?}   -> {ok, ab_beat}; grid: raster of the request, else the cell's, else the session grid
//   POST /session/stopp {spur_id?}              -> {ok, ab_beat, gestoppt}; without spur_id every column stops at the session grid
//   POST /session/szene {zeile}                 -> {ok, ab_beat, gestartet, gestoppt, gehalten, tempo?}; row `zeile` over all columns at ONE ab_beat on the
//                                                  session grid (a per-cell grid does not split a scene); a hold slot gets nothing; a scene with `bpm` also
//                                                  sends /k/tempo/rampe {ab_beat, ziel_bpm, dauer_beats: 1} (the shortest ramp the contract allows)
//   POST /session/scheiben {spur_id, zelle, teilung}   -> {ok, grenzen}; teilung '1/16' | '1/8' | 'takt' | 'transienten'; stores the cell's scheiben
//                                                  (identity folge) as one zelle_aendern; an empty or hold slot is zelle_leer
//   POST /session/neue_zelle {spur_id, zelle}  -> {ok, spur_id, zelle, trocken: true}; renders one turn of the cell (slot order, reverse, gain, fades; not the
//                                                  transpose or the track's devices) into a new cell: the first empty cell of that column, then of the deck
//   POST /session/zum_sampler {spur_id, zelle}  -> {ok, kit}; the cell's played slots (source seconds of slot folge[k]) become the sounds of a new kit;
//                                                  a cell without scheiben is scheiben_ungueltig
//   POST /session/vorhoeren {spur_id, zelle, slot}  -> {ok}; played slot `slot` (1-based) as the cell plays it, on the previewer
//   POST /session/zelle {spur_id, zelle, transponieren?, rueckwaerts?, blende?, scheiben?, keylock?, raster?, name?, farbe?, gain_db?, beats?, bpm?}   -> {ok}
//                                                  thin wrapper over zelle_aendern (null removes an editor field); refusals nur_keylock, scheiben_ungueltig, argument_ungueltig
//   POST /session/huelle {spur_id, zelle, ziel, punkte | null}   -> {ok}; zelle_huelle (punkte null removes the envelope); refusal huelle_ungueltig
//   POST /session/raster {raster}, /szene_aendern, /szene_neu {nach?}, /szene_fangen {nach?}, /szene_doppeln {zeile}, /szene_loeschen {zeile}
//                                               -> {ok} (szene_neu, szene_fangen: {ok, zeile}); each is one command, one undo step, label of SESSION_LABEL
// Refusals are {ok: false, grund, text}: 409 for a state, 404 spur_unbekannt, 400 for a malformed request; `cypher` under Stop Cypher is 409 ki_gestoppt.
// The SSE event {a: 'session', f: {spur_id, lauf}} is sent from the same mirror update as the loopdeck event (loopdeck.beimLauf), for session columns only.
import crypto from 'node:crypto';
import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';
import type { BereichKontext, Route } from '../../http/router.ts';
import { json } from '../../http/transport.ts';
import { alsAntwort, leseKoerper, type ProjZugang } from '../proj/area.ts';
import { SESSION_LABEL } from '../../project/commands_session.ts';
import { LOOPDECK_LABEL } from '../../project/commands_loopdeck.ts';
import { LOOP_RASTER_BEATS, LOOP_ZELLEN, SZENEN_ZEILEN, istHalten, sessionRaster, sessionSzenen, ZELL_TEILUNGEN, SAMPLERATE, ZELL_SCHEIBEN_MAX, type LoopRaster, type Projekt, type Spur, type Zelle } from '../../project/model.ts';
import { SchnittFehler } from '../../sampler/schnitt.ts';
import { AUDIO_BUDGET_BYTES, LoopFehler, type LoopdeckBereich } from './loopdeck.ts';
import { wavKopf } from '../../project/recording.ts';
import { zellKarteVon, zellRendern, type ZellKarteTs } from '../../project/zell_map.ts';
import { scheibenGrenzen, zellBeatsAusFrames } from '../../project/scheiben.ts';
import { sessionStand } from './session_state.ts';

type Quelle = 'andreas' | 'cypher';
type Antwort = { code: number; j: unknown };
export interface SessionOptionen {
  frames?(sha: string): number | null;   // decoded length of a cell's audio (the same bookkeeping as the loop deck area)
  transienten?(sha: string): number[] | null;   // transients of a cell's source in seconds, ascending (TransientenLager.fuer); null = not decoded
  audio?(sha: string): Float32Array | null;     // decoded audio of a cell (interleaved stereo, 48 kHz) from the decode cache; null = not decoded
  // `→ SAMPLER INSTRUMENT`: writes a kit from slices of the cell's source audio (server.ts: sampler/kit.ts legeKitAusAudio); slices are source seconds
  kit?(a: { name: string; daten: Float32Array; scheiben: { von_s: number; bis_s: number }[]; quelle: string }): { kit: string };
  vorhoeren?(a: { sha: string; slot: number; daten: Float32Array }): Promise<void>;   // slot audition: the rendered slot (interleaved stereo) goes to the previewer
  ladenGesperrt?(): boolean;             // a freeze runs (proj.sitzung.ladenGesperrt): a scene tempo ramp waits, as POST /tempo
}

const TEXTE: Record<string, string> = {
  kein_projekt: 'No live project is open.', beschaeftigt: 'A freeze is running; tempo changes wait until it is done.',
  spur_unbekannt: 'No session column with that id.', zelle_leer: 'That cell is empty.', zelle_laedt: 'That cell is still loading.', deck_voll: 'No empty cell in that deck.', audio_budget: 'The distinct audio of the live project would exceed 512 MiB.', zeilen_voll: 'All 8 rows are in use; 16 rows come with the next slice.',
  einmal_zu_lang: 'That one-shot is longer than 64 beats at its tempo: set its beats and bpm by hand, or cut it shorter.',
};
const ZELLE_AENDERN_FELDER = ['transponieren', 'rueckwaerts', 'blende', 'scheiben', 'keylock', 'raster', 'name', 'farbe', 'gain_db', 'beats', 'bpm'] as const;
const ungueltig = (text: string): never => { throw new LoopFehler(400, 'argument_ungueltig', text); };
function nurFelder(d: Record<string, unknown>, erlaubt: readonly string[]): void {
  for (const k of Object.keys(d)) if (!erlaubt.includes(k)) throw new LoopFehler(400, 'argument_unbekannt', `Unknown argument: ${k}`);
}
function ganz(d: Record<string, unknown>, k: string, von: number, bis: number): number {
  const v = d[k];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < von || v > bis) return ungueltig(`${k}: integer ${von}..${bis} expected`);
  return v;
}
function rasterArg(x: unknown): LoopRaster {
  if (typeof x !== 'string' || !Object.hasOwn(LOOP_RASTER_BEATS, x)) return ungueltig("raster: '1/4', '1/2', '1', 'takt' or '4takte' expected");
  return x as LoopRaster;
}
const defaultSzene = (s: { name: string; farbe: number; bpm?: number; takte?: number; folge?: unknown }): boolean =>
  s.name === '' && s.farbe === 0 && s.bpm === undefined && s.takte === undefined && s.folge === undefined;

export class SessionBereich {
  readonly name = 'session';
  private readonly ctx: BereichKontext;
  private readonly zugang: ProjZugang;
  private readonly ld: LoopdeckBereich;
  private readonly o: SessionOptionen;
  constructor(ctx: BereichKontext, zugang: ProjZugang, loopdeck: LoopdeckBereich, o: SessionOptionen = {}) {
    this.ctx = ctx; this.zugang = zugang; this.ld = loopdeck; this.o = o;
    loopdeck.beimLauf((id, lauf) => {
      const p = this.zugang.offen()?.projekt;
      if (p?.live && this.ld.spalten(p).some((x) => x.spur.id === id)) this.ctx.verteile({ a: 'session', f: { spur_id: id, lauf } });
    });
  }

  private async antwort(f: () => Promise<Antwort> | Antwort): Promise<Antwort> {
    try { return await f(); } catch (e0) {
      const e = this.ld.fehlerVon(e0);
      return e instanceof LoopFehler ? { code: e.code, j: { ok: false, grund: e.grund, text: e.text } } : alsAntwort(e, this.ctx);
    }
  }
  // the open project, which must be a live one (never opened here)
  private live(): Projekt {
    const p = this.zugang.offen()?.projekt;
    if (!p?.live) throw new LoopFehler(409, 'kein_projekt', TEXTE.kein_projekt);
    return p;
  }
  private zeitlos(quelle: Quelle): Projekt { this.ld.riegel(quelle); return this.live(); }
  private lauf(p: Projekt): (id: string) => ReturnType<LoopdeckBereich['spalten']>[number]['lauf'] {
    const m = new Map(this.ld.spalten(p).map((x) => [x.spur.id, x.lauf]));
    return (id) => m.get(id)!;
  }

  stand(): Antwort {
    return this.antwortSync(() => {
      const p = this.live();
      return { code: 200, j: sessionStand(p, this.lauf(p), (sha) => this.o.frames?.(sha) ?? null, this.ld.uhrJetzt()) };
    });
  }
  private antwortSync(f: () => Antwort): Antwort {
    try { return f(); } catch (e0) {
      const e = this.ld.fehlerVon(e0);
      return e instanceof LoopFehler ? { code: e.code, j: { ok: false, grund: e.grund, text: e.text } } : alsAntwort(e, this.ctx);
    }
  }

  private spalte(p: Projekt, id: unknown): ReturnType<LoopdeckBereich['spalten']>[number] {
    if (typeof id !== 'string' || !id) return ungueltig('spur_id: ID expected');
    return this.ld.spalten(p).find((x) => x.spur.id === id) ?? ((): never => { throw new LoopFehler(404, 'spur_unbekannt', TEXTE.spur_unbekannt); })();
  }

  start(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> {
    return this.antwort(async () => {
      nurFelder(d, ['spur_id', 'zelle', 'raster']);
      const p = this.zeitlos(quelle);
      const zelle = ganz(d, 'zelle', 1, LOOP_ZELLEN);
      const raster = d.raster === undefined ? undefined : rasterArg(d.raster);
      const sp = this.spalte(p, d.spur_id);
      const z = sp.spur.zellen?.[zelle - 1];
      const r = await this.ld.spurStarten(sp.spur, zelle, raster ?? (z && !istHalten(z) ? z.raster : undefined) ?? sessionRaster(p), quelle);
      return { code: 200, j: { ok: true, ab_beat: r.ab_beat } };
    });
  }

  stopp(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> {
    return this.antwort(async () => {
      nurFelder(d, ['spur_id']);
      const p = this.zeitlos(quelle);
      const spuren = d.spur_id === undefined ? this.ld.spalten(p).map((x) => x.spur) : [this.spalte(p, d.spur_id).spur];
      const ab = this.ld.zielBeat(sessionRaster(p));
      const r = await this.ld.spurStoppen(spuren, ab, quelle);
      return { code: 200, j: { ok: true, ab_beat: ab, gestoppt: r.gestoppt, ...(r.abgelehnt.length ? { abgelehnt: r.abgelehnt } : {}) } };
    });
  }

  szene(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> {
    return this.antwort(async () => {
      nurFelder(d, ['zeile']);
      const p = this.zeitlos(quelle);
      const zeile = ganz(d, 'zeile', 1, SZENEN_ZEILEN);
      const bpm = sessionSzenen(p)[zeile - 1].bpm;
      // the scene is all or nothing: a tempo ramp that cannot be sent holds back the starts too
      if (bpm !== undefined && this.o.ladenGesperrt?.()) throw new LoopFehler(409, 'beschaeftigt', TEXTE.beschaeftigt);
      const ab = this.ld.zielBeat(sessionRaster(p));
      const r = await this.ld.zeileStarten(this.ld.spalten(p).map((x) => x.spur), zeile, ab, quelle);
      let tempo: { tempo?: number; tempo_abgelehnt?: string } | null = null;
      if (bpm !== undefined) {
        const ziel = Math.round(bpm * 100) / 100;
        const id = this.ctx.sende('/k/tempo/rampe', { quelle, ab_beat: ab, ziel_bpm: ziel, dauer_beats: 1 });
        const q = await this.ctx.warteQuittung(id, ab);
        tempo = q === null ? { tempo_abgelehnt: 'kein_kern' } : { tempo: bpm, ...(q.status === 6 ? { tempo_abgelehnt: q.grund } : {}) };
      }
      return { code: 200, j: { ok: true, ab_beat: ab, gestartet: r.gestartet, gestoppt: r.gestoppt, gehalten: r.gehalten,
        ...(r.laedt.length ? { laedt: r.laedt } : {}), ...(r.abgelehnt.length ? { abgelehnt: r.abgelehnt } : {}), ...(tempo ?? {}) } };
    });
  }

  // ---- writes: one command each, through the loop deck area's command path (gates, lock, undo, core load, `proj` event) --------------------------

  private async befehl(befehl: Record<string, unknown>, label: string, quelle: Quelle): Promise<void> {
    await this.ld.schreibe([befehl], label, quelle);
  }
  // the last row that holds a cell, a hold slot or a scene with content (0 = none)
  private letzteZeile(p: Projekt): number {
    const sz = sessionSzenen(p);
    for (let r = SZENEN_ZEILEN; r >= 1; r--) {
      if (!defaultSzene(sz[r - 1]) || p.spuren.some((s) => s.zellen?.[r - 1])) return r;
    }
    return 0;
  }
  private nachArg(d: Record<string, unknown>, p: Projekt): number {
    const nach = d.nach === undefined ? this.letzteZeile(p) : ganz(d, 'nach', 0, SZENEN_ZEILEN - 1);
    if (nach >= SZENEN_ZEILEN) throw new LoopFehler(409, 'zeilen_voll', TEXTE.zeilen_voll);
    return nach;
  }

  raster(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> {
    return this.antwort(async () => {
      nurFelder(d, ['raster']);
      this.zeitlos(quelle);
      await this.befehl({ befehl: 'session_aendern', raster: rasterArg(d.raster) }, SESSION_LABEL.session_aendern, quelle);
      return { code: 200, j: { ok: true } };
    });
  }

  scheiben(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> {
    return this.antwort(async () => {
      nurFelder(d, ['spur_id', 'zelle', 'teilung']);
      const p = this.zeitlos(quelle);
      const zelle = ganz(d, 'zelle', 1, LOOP_ZELLEN);
      const teilung = d.teilung;
      if (typeof teilung !== 'string' || !(ZELL_TEILUNGEN as readonly string[]).includes(teilung)) return ungueltig(`teilung: ${ZELL_TEILUNGEN.join(' | ')} expected`);
      const sp = this.spalte(p, d.spur_id);
      const z = sp.spur.zellen?.[zelle - 1];
      if (!z || istHalten(z)) throw new LoopFehler(409, 'zelle_leer', TEXTE.zelle_leer);
      // an einmal cell may have no length: it comes from the decoded frames and the source tempo, as the translator derives it, and is stored with the slices
      const frames = this.o.frames?.(z.sha256) ?? null;
      // zelle_aendern takes beats as a multiple of 0.25 up to 64, so the derived length is rounded to that grid (at least 0.25) and the slices use exactly
      // the stored value: the loader maps beats to frames through frames/beats, so slices and envelopes stay consistent with the stored ratio
      const abgeleitet = z.beats === undefined && frames !== null ? Math.max(0.25, Math.round(zellBeatsAusFrames(frames, z.bpm ?? p.tempo_bpm) * 4) / 4) : null;
      if (abgeleitet !== null && abgeleitet > 64) throw new LoopFehler(409, 'einmal_zu_lang', TEXTE.einmal_zu_lang);
      const beats = z.beats ?? abgeleitet ?? 0;
      // transients arrive in seconds of the source; they become cell beats the way the core loader reads the cell (frame * beats / frames), so a bpm
      // that disagrees with the length does not move them. Without decoded frames the source tempo is the only conversion left.
      const sek = teilung === 'transienten' ? this.o.transienten?.(z.sha256) ?? null : null;
      const tb = !sek ? null : frames !== null && beats > 0 ? sek.map((s) => s * SAMPLERATE * beats / frames)
        : typeof z.bpm === 'number' ? sek.map((s) => s * z.bpm! / 60) : null;
      const grenzen = scheibenGrenzen(teilung as (typeof ZELL_TEILUNGEN)[number], beats, tb);
      const scheiben = { teilung, grenzen, folge: grenzen.map((_, i) => i + 1) };
      await this.befehl({ befehl: 'zelle_aendern', spur_id: sp.spur.id, index: zelle, ...(abgeleitet !== null ? { beats: abgeleitet } : {}), scheiben },
        LOOPDECK_LABEL.zelle_aendern, quelle);
      return { code: 200, j: { ok: true, grenzen } };
    });
  }

  // the cell a rendered copy goes to: the first empty cell of the column, then of the deck by track and row (as a load without target); null = the deck is full
  private freieZelle(p: Projekt, spur: Spur): { spur: Spur; zelle: number } | null {
    const deck = this.ld.spalten(p).find((x) => x.spur.id === spur.id)!.deck;
    const spuren = [spur, ...this.ld.spalten(p).filter((x) => x.deck === deck && x.spur.id !== spur.id).map((x) => x.spur)];
    for (const sp of spuren) for (let i = 1; i <= LOOP_ZELLEN; i++) if (!sp.zellen?.[i - 1]) return { spur: sp, zelle: i };
    return null;
  }

  neueZelle(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> {
    return this.antwort(async () => {
      nurFelder(d, ['spur_id', 'zelle']);
      const p = this.zeitlos(quelle);
      const zelle = ganz(d, 'zelle', 1, LOOP_ZELLEN);
      const sp = this.spalte(p, d.spur_id);
      const z = sp.spur.zellen?.[zelle - 1];
      if (!z || istHalten(z)) throw new LoopFehler(409, 'zelle_leer', TEXTE.zelle_leer);
      const frames = this.o.frames?.(z.sha256) ?? null, audio = frames === null ? null : this.o.audio?.(z.sha256) ?? null;
      if (frames === null || audio === null || audio.length < frames * 2) throw new LoopFehler(409, 'zelle_laedt', TEXTE.zelle_laedt);
      const beats = z.beats ?? zellBeatsAusFrames(frames, z.bpm ?? p.tempo_bpm);
      const aus = zellRendern(audio, zellKarteVon(z, frames, beats), 10 ** (z.gain_db / 20));
      const wav = Buffer.concat([wavKopf(frames), Buffer.from(aus.buffer, aus.byteOffset, aus.byteLength)]);
      const sha256 = crypto.createHash('sha256').update(wav).digest('hex');
      const ziel = this.freieZelle(p, sp.spur);
      if (!ziel) throw new LoopFehler(409, 'deck_voll', TEXTE.deck_voll);
      if (this.ld.audioBytes(p, { sha256, frames }) > AUDIO_BUDGET_BYTES) throw new LoopFehler(409, 'audio_budget', TEXTE.audio_budget);
      const ordner = this.zugang.offen()!.ordner;
      const name = `${z.name.slice(0, 58)} edit`.trim();
      const datei = `${this.zugang.naechsteNummer()}-L${sp.deck}-${name.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'cell'}.wav`;
      const abs = path.join(ordner, 'loops', datei);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, wav, { flag: 'wx' });
      try {
        await this.befehl({ befehl: 'zelle_setzen', spur_id: ziel.spur.id, index: ziel.zelle, zelle: { name, farbe: z.farbe, art: z.art, sha256,
          ...(z.beats !== undefined ? { beats: z.beats } : {}), ...(z.bpm !== undefined ? { bpm: z.bpm } : {}), gain_db: 0, ...(z.keylock === false ? { keylock: false } : {}), pfad_hinweis: `loops/${datei}` } },
        LOOPDECK_LABEL.zelle_setzen, quelle);
      } catch (e) { fs.rmSync(abs, { force: true }); throw e; }
      return { code: 200, j: { ok: true, spur_id: ziel.spur.id, zelle: ziel.zelle, trocken: true } };
    });
  }

  // a cell with a slot map and its decoded audio, for the routes that read the slots; scheiben_ungueltig without a map, zelle_laedt without audio
  private scheibenZelle(d: Record<string, unknown>, quelle: Quelle, extra: string[]): { z: Zelle; karte: ZellKarteTs; daten: Float32Array; frames: number; beats: number } {
    nurFelder(d, ['spur_id', 'zelle', ...extra]);
    const p = this.zeitlos(quelle);
    const zelle = ganz(d, 'zelle', 1, LOOP_ZELLEN);
    const sp = this.spalte(p, d.spur_id);
    const z = sp.spur.zellen?.[zelle - 1];
    if (!z || istHalten(z)) throw new LoopFehler(409, 'zelle_leer', TEXTE.zelle_leer);
    if (!z.scheiben) throw new LoopFehler(409, 'scheiben_ungueltig', 'The cell has no slices yet.');
    const frames = this.o.frames?.(z.sha256) ?? null, daten = frames === null ? null : this.o.audio?.(z.sha256) ?? null;
    if (frames === null || daten === null || daten.length < frames * 2) throw new LoopFehler(409, 'zelle_laedt', TEXTE.zelle_laedt);
    const beats = z.beats ?? zellBeatsAusFrames(frames, z.bpm ?? p.tempo_bpm);
    return { z, karte: zellKarteVon(z, frames, beats), daten, frames, beats };
  }
  // an error of the kit writer or the previewer is an answer, not a crash
  private async fremd<T>(f: () => T | Promise<T>): Promise<T> {
    try { return await f(); } catch (e) {
      if (e instanceof SchnittFehler) throw new LoopFehler(e.code, e.grund, e.text);
      const x = e as { code?: unknown; fehler?: unknown };
      if (typeof x?.code === 'number' && typeof x.fehler === 'string') throw new LoopFehler(x.code, x.fehler);
      throw e;
    }
  }

  zumSampler(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> {
    return this.antwort(async () => {
      const { z, karte, daten } = this.scheibenZelle(d, quelle, []);
      if (!this.o.kit) throw new LoopFehler(409, 'kein_kit', 'No kit writer here.');
      // played order: slot k sounds as source slot folge[k]; the sounds are those source ranges, in source seconds
      const scheiben = z.scheiben!.folge.map((f) => ({ von_s: karte.g[f - 1] / SAMPLERATE, bis_s: karte.g[f] / SAMPLERATE }));
      const r = await this.fremd(() => this.o.kit!({ name: z.name, daten, scheiben, quelle: `zelle:${z.sha256.slice(0, 16)}` }));
      return { code: 200, j: { ok: true, kit: r.kit } };
    });
  }

  vorhoeren(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> {
    return this.antwort(async () => {
      const slot = ganz(d, 'slot', 1, ZELL_SCHEIBEN_MAX);
      const { z, karte, daten } = this.scheibenZelle(d, quelle, ['slot']);
      if (!this.o.vorhoeren) throw new LoopFehler(409, 'kein_vorhoerer', 'No previewer here.');
      if (slot > karte.s.length) return ungueltig(`slot: 1..${karte.s.length} expected (the cell has ${karte.s.length} slots)`);
      // the slot as the cell plays it: the same read map, the range of played slot `slot`, the cell's gain
      const aus = zellRendern(daten, karte, 10 ** (z.gain_db / 20), karte.g[slot - 1], karte.g[slot]);
      await this.fremd(() => this.o.vorhoeren!({ sha: z.sha256, slot, daten: aus }));
      return { code: 200, j: { ok: true } };
    });
  }

  zelleAendern(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> {
    return this.antwort(async () => {
      nurFelder(d, ['spur_id', 'zelle', ...ZELLE_AENDERN_FELDER]);
      const p = this.zeitlos(quelle);
      const zelle = ganz(d, 'zelle', 1, LOOP_ZELLEN);
      const sp = this.spalte(p, d.spur_id);
      const z = sp.spur.zellen?.[zelle - 1];
      if (!z || istHalten(z)) throw new LoopFehler(409, 'zelle_leer', TEXTE.zelle_leer);
      const felder = Object.fromEntries(ZELLE_AENDERN_FELDER.filter((k) => d[k] !== undefined).map((k) => [k, d[k]]));
      await this.befehl({ befehl: 'zelle_aendern', spur_id: sp.spur.id, index: zelle, ...felder }, LOOPDECK_LABEL.zelle_aendern, quelle);
      return { code: 200, j: { ok: true } };
    });
  }

  huelle(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> {
    return this.antwort(async () => {
      nurFelder(d, ['spur_id', 'zelle', 'ziel', 'punkte']);
      const p = this.zeitlos(quelle);
      const zelle = ganz(d, 'zelle', 1, LOOP_ZELLEN);
      if (typeof d.ziel !== 'string') return ungueltig('ziel: gain | filter | send.hall | send.delay expected');
      if (!('punkte' in d)) return ungueltig('punkte: a list of {beat, wert, form?} or null expected');
      const sp = this.spalte(p, d.spur_id);
      await this.befehl({ befehl: 'zelle_huelle', spur_id: sp.spur.id, index: zelle, ziel: d.ziel, punkte: d.punkte }, SESSION_LABEL.zelle_huelle, quelle);
      return { code: 200, j: { ok: true } };
    });
  }

  szeneAendern(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> {
    return this.antwort(async () => {
      const felder = ['zeile', 'name', 'farbe', 'bpm', 'takte', 'folge'];
      nurFelder(d, felder);
      this.zeitlos(quelle);
      ganz(d, 'zeile', 1, SZENEN_ZEILEN);
      const nurName = Object.keys(d).every((k) => k === 'zeile' || k === 'name');
      await this.befehl({ befehl: 'szene_aendern', ...Object.fromEntries(felder.filter((k) => d[k] !== undefined).map((k) => [k, d[k]])) },
        nurName && d.name !== undefined ? SESSION_LABEL.szene_benennen : SESSION_LABEL.szene_aendern, quelle);
      return { code: 200, j: { ok: true } };
    });
  }

  szeneNeu(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> {
    return this.antwort(async () => {
      nurFelder(d, ['nach']);
      const p = this.zeitlos(quelle);
      const nach = this.nachArg(d, p);
      await this.befehl({ befehl: 'szene_neu', nach }, SESSION_LABEL.szene_neu, quelle);
      return { code: 200, j: { ok: true, zeile: nach + 1 } };
    });
  }

  // The playing cell of each column becomes the new row (a pending launch does not count): the server fills `zellen` from the mirror.
  szeneFangen(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> {
    return this.antwort(async () => {
      nurFelder(d, ['nach']);
      const p = this.zeitlos(quelle);
      const nach = this.nachArg(d, p);
      const zellen = Object.fromEntries(this.ld.spalten(p).map((x) => [x.spur.id, x.lauf.zelle]));
      await this.befehl({ befehl: 'szene_fangen', nach, zellen }, SESSION_LABEL.szene_fangen, quelle);
      return { code: 200, j: { ok: true, zeile: nach + 1 } };
    });
  }

  szeneDoppeln(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> {
    return this.antwort(async () => {
      nurFelder(d, ['zeile']);
      this.zeitlos(quelle);
      await this.befehl({ befehl: 'szene_doppeln', zeile: ganz(d, 'zeile', 1, SZENEN_ZEILEN) }, SESSION_LABEL.szene_doppeln, quelle);
      return { code: 200, j: { ok: true } };
    });
  }

  szeneLoeschen(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> {
    return this.antwort(async () => {
      nurFelder(d, ['zeile']);
      this.zeitlos(quelle);
      await this.befehl({ befehl: 'szene_loeschen', zeile: ganz(d, 'zeile', 1, SZENEN_ZEILEN) }, SESSION_LABEL.szene_loeschen, quelle);
      return { code: 200, j: { ok: true } };
    });
  }

  routen(): Route[] {
    const ctx = this.ctx;
    const antworte = async (r: http.ServerResponse, f: () => Antwort | Promise<Antwort>): Promise<void> => {
      const x = await f();
      json(r, x.code, x.j);
    };
    const post = (pfad: string, f: (d: Record<string, unknown>, q: Quelle) => Promise<Antwort>): Route => ({
      methode: 'POST', pfad, schutz: 'fremdePost', handler: async (q, r) => {
        const quelle = ctx.quelle();   // before the await (pattern of the other live routes)
        try { const d = await leseKoerper(q); await antworte(r, () => f(d, quelle)); } catch (e) { const a = alsAntwort(e, ctx); json(r, a.code, a.j); }
      } });
    return [
      { methode: 'GET', pfad: '/session/stand', schutz: 'offen', handler: async (_q, r) => antworte(r, () => this.stand()) },
      post('/session/start', (d, q) => this.start(d, q)),
      post('/session/stopp', (d, q) => this.stopp(d, q)),
      post('/session/szene', (d, q) => this.szene(d, q)),
      post('/session/scheiben', (d, q) => this.scheiben(d, q)),
      post('/session/neue_zelle', (d, q) => this.neueZelle(d, q)),
      post('/session/zum_sampler', (d, q) => this.zumSampler(d, q)),
      post('/session/vorhoeren', (d, q) => this.vorhoeren(d, q)),
      post('/session/zelle', (d, q) => this.zelleAendern(d, q)),
      post('/session/huelle', (d, q) => this.huelle(d, q)),
      post('/session/raster', (d, q) => this.raster(d, q)),
      post('/session/szene_aendern', (d, q) => this.szeneAendern(d, q)),
      post('/session/szene_neu', (d, q) => this.szeneNeu(d, q)),
      post('/session/szene_fangen', (d, q) => this.szeneFangen(d, q)),
      post('/session/szene_doppeln', (d, q) => this.szeneDoppeln(d, q)),
      post('/session/szene_loeschen', (d, q) => this.szeneLoeschen(d, q)),
    ];
  }
}

export function sessionBereich(ctx: BereichKontext, zugang: ProjZugang, loopdeck: LoopdeckBereich, o: SessionOptionen = {}): SessionBereich {
  return new SessionBereich(ctx, zugang, loopdeck, o);
}
