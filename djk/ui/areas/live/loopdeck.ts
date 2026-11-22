// Loop deck area (loop deck plan M4): two decks of 4 tracks with 8 cells each, played on the core beat grid. A deck is a loop deck group of the live
// container (project/model.ts loopDeckGruppe); this area reads it and talks to the core, it writes no model.
//   GET  /loopdeck/stand                                  {decks: {"1": Deck | null, "2": Deck | null}, beat, bpm}; beat and bpm are null without a core clock
//   POST /loopdeck/start {deck, spur: 1..4, zelle: 1..8, versatz_beats?, raster?}   -> {ok, ab_beat, status}
//   POST /loopdeck/sprung {deck, spur: 1..4, slice: 1..8}   -> {ok, ab_beat, zelle, versatz_beats}   (the playing or last cell again, at slice * beats / 8)
//   POST /loopdeck/stopp {deck, spur?: 1..4}              -> {ok, ab_beat}; without `spur` four stops share one ab_beat
//   POST /loopdeck/szene {deck, zeile: 1..8}              -> {ok, ab_beat, gestartet, gestoppt}; row `zeile` of the 4 tracks: a filled cell starts, an empty one stops
// Every launch is aimed at a grid point of the core beat (loopZielBeat): the last /uhr extrapolated to now, plus the lead, rounded up to the raster of the
// deck (or `raster` of the request). The core answers with the first /q of the id; status 6 is a refusal (409 with the core's reason).
// The area keeps two things from the core: the last /uhr (with the time it arrived) and the /zustand/zelle mirror per deck track (what plays, what waits).
// Every core event reaches `ereignis` before the page server throttles it. A change of the mirror goes out as the SSE event
// {a: 'loopdeck', f: {deck, spur, lauf}}; model changes come with the existing `proj` event. A new core generation clears the mirror (it knows nothing of
// what the old one reported). `lauf.zuletzt` (last cell that played) lives here only, not in the model.
// Refusals are {ok: false, grund, text}: 409 for a state, 400 for a malformed request. No live container (or no deck on that place) is kein_loopdeck:
// a launch never creates anything.
// The write routes (M5) go through the session's command path (one undo step each, `proj` event as usual) and open or create the live container
// themselves (the session's liveOeffnen, as POST /live/oeffnen does), but only when no project is open or the live container is: any other open project
// is 409 projekt_offen (nothing is closed, stopped or switched). The body is checked before anything is opened:
//   POST /loopdeck/laden {deck, spur?, zelle?, quelle}    -> {ok, spur, zelle, zelle_id}; sources in loopdeck_load.ts; a missing deck is created in the same undo step
//   POST /loopdeck/zelle {deck, spur, zelle, name?, farbe?, art?, gain_db?, beats?, leeren?: true}   -> {ok}
//   POST /loopdeck/bewegen {von: {deck, spur, zelle}, nach: {deck, spur, zelle}}   -> {ok}; POST /loopdeck/raster {deck, raster}; POST /loopdeck/leeren {deck}
//   POST /loopdeck/spur {deck, spur, fader_db?, mute?, filter?, eq?: {tief?, mitte?, hoch?} dB, kill?: {tief?, mitte?, hoch?} booleans, fx?: {"1"?, "2"?, "3"?} booleans, send?: {hall?, delay?} dB}   -> {ok}; POST /loopdeck/neu {deck, raster?} -> {ok, gruppe_id} (idempotent)
//   POST /loopdeck/effekt {deck, spur, graph} (graph '' removes) or {deck, spur, an}   -> {ok, effekt: {id, graph, an} | null}; GET /loopdeck/effekte -> {graphen: [{name, kurz, latenz}]}
// Limits: a cell holds at most 60 s (zu_lang); the distinct decoded audio of the live project (frames x 8 bytes, every sha once over clips and cells,
// counting the new cell) stays within 512 MiB (audio_budget). A refused load writes nothing and removes the WAV it wrote.
import fs from 'node:fs';
import type http from 'node:http';
import type { BereichKontext, Route } from '../../http/router.ts';
import { json } from '../../http/transport.ts';
import { alsAntwort, leseKoerper, type ProjZugang } from '../proj/area.ts';
import { grundCode } from '../proj/mapping.ts';
import { ProjFehler, REV_JETZT } from '../proj/session.ts';
import { alleAudioClips, BefehlFehler, fuehreListeAus } from '../../project/commands.ts';
import { LOOPDECK_LABEL } from '../../project/commands_loopdeck.ts';
import { grundText } from '../../http/reasons.ts';
import { LOOP_RASTER_BEATS, LOOP_SPUREN, LOOP_ZELLEN, LOOP_FARBEN, LOOP_MAX_FRAMES, LOOP_SEND_MAX, FADER_MIN, EQ_BAENDER, FX_NUMMERN, type EqBand, type FxNr, loopDeckGruppe, loopDeckSpuren, platzVonGruppe, istHalten, type LoopRaster, type Projekt, type Spur, type Zelle } from '../../project/model.ts';
import { loopFxGraphen } from './loopdeck_effects.ts';
import { listeGraphen, type GraphEintrag } from '../../graphs.ts';
import { ladeQuelle, LadenFehler, pruefeQuelle, type LadeAbhaengig, type Quelle as LadeQuelle } from './loopdeck_load.ts';
import { KeineUhrFehler, loopBeatJetzt, loopZielBeat, type UhrStand } from './loopdeck_bar.ts';

type Quelle = 'andreas' | 'cypher';
type Antwort = { code: number; j: unknown };
export type Lauf = { zelle: number | null; verwaist: boolean; ab_beat: number; versatz_beats: number;
  wartend: { zelle: number | null; ab_beat: number } | null; zuletzt: number | null };
export type ZelleSicht = Zelle & { frames: number | null };
export type DeckSpur = { spur_id: string; nr: number; name: string; fader_db: number; mute: boolean; filter: number;
  eq: Record<EqBand, number>; kill: Record<EqBand, boolean>; fx: Record<FxNr, boolean>; send: { hall: number; delay: number };
  zellen: (ZelleSicht | null)[]; lauf: Lauf; effekt: Effekt | null };
export type Effekt = { id: string; graph: string; an: boolean };
// ausgang_platz: the place (1..4) of the container the deck sits in (`plaetze`); null = parked (silent)
export type Deck = { gruppe_id: string; platz: 1 | 2; ausgang_platz: 1 | 2 | 3 | 4 | null; raster: LoopRaster; spuren: DeckSpur[] };
export interface LoopdeckOptionen {
  frames?(sha: string): number | null;   // decoded length of a cell's audio (server.ts: the decode cache); absent or unknown = null
  jetzt?(): number;                      // wall clock in ms for the /uhr extrapolation; absent = Date.now (tests pass their own)
  // M5 writes: the session's own way to open or create the live container (POST /live/oeffnen); absent = a write without a live container is kein_loopdeck
  liveOeffnen?(quelle: Quelle): Promise<{ code: number; j: unknown }>;   // must refuse (projekt_offen) when another project is open when its turn comes
  loopOrdner?(): string;                 // sources: the loop library
  modulBasis?(): string;                 // sources: the module library (absent: the default base)
  katalogLoop?(sha: string): Promise<{ name: string }>;   // sources: the catalogue import (server.ts, the code behind POST /loops/aus-katalog)
  deckLoop?: LadeAbhaengig['deckLoop'];  // sources: the active loop of a DJ deck (server.ts)
  graphen?(): GraphEintrag[];            // the Baukasten graph listing for the effect slot; absent = listeGraphen() of the default graph folder (the one GET /graphen reads)
}
export const AUDIO_BUDGET_BYTES = 512 * 1024 * 1024;   // index 2.3: half of the core's 1024 MiB, so the old and the new snapshot fit during a swap

const TEXTE: Record<string, string> = {
  kein_loopdeck: 'No loop deck on that place.', zelle_leer: 'That cell is empty.', zelle_laedt: 'That cell is still loading.', nichts_gespielt: 'Nothing played on that track yet.', nur_loop: 'A one-shot has no slices to jump to.', keine_uhr: 'No core clock yet.', ki_gestoppt: 'Stop Cypher is on.',
  kein_platz: 'No room left in the live container.', graph_unbekannt: 'That graph is not an effect for the loop deck.',
  deck_voll: 'No empty cell in that deck.', audio_budget: 'The distinct audio of the live project would exceed 512 MiB.',
  zu_lang: 'A cell holds at most 60 s of audio.', quelle_unbekannt: 'The source was not found.',
  projekt_offen: 'A project is open. Open the live container first (LIVE); the loop deck never closes a project by itself.',
  kein_kern: 'The core did not answer.', argument_ungueltig: 'Invalid argument.', argument_unbekannt: 'Unknown argument.',
};
// model refusals that mean "a pool is full": 409 kein_platz, the text says which pool
const KEIN_PLATZ: Record<string, string> = {
  routing_grenze: 'All 4 returns of the live container are in use.', ins_voll: 'All 8 Baukasten effect stages are in use.', kette_voll: 'The chain of this track is full.',
};
export class LoopFehler extends Error {
  readonly code: number;
  readonly grund: string;
  readonly text: string;
  constructor(code: number, grund: string, text: string = TEXTE[grund] ?? grund) { super(grund); this.code = code; this.grund = grund; this.text = text; }
}
const ungueltig = (text: string): never => { throw new LoopFehler(400, 'argument_ungueltig', text); };

function nurFelder(d: Record<string, unknown>, erlaubt: readonly string[]): void {
  for (const k of Object.keys(d)) if (!erlaubt.includes(k)) throw new LoopFehler(400, 'argument_unbekannt', `Unknown argument: ${k}`);
}
function ganz(d: Record<string, unknown>, k: string, von: number, bis: number): number {
  const v = d[k];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < von || v > bis) return ungueltig(`${k}: integer ${von}..${bis} expected`);
  return v;
}
// eq: {tief?, mitte?, hoch?} of numbers, kill: the same of booleans; the range and the track rule are the command's
function baenderPruefen(x: unknown, k: string, typ: 'number' | 'boolean'): void {
  if (x === null || typeof x !== 'object' || Array.isArray(x) || Object.keys(x).length === 0) return ungueltig(`${k}: {tief?, mitte?, hoch?} expected`);
  for (const [b, v] of Object.entries(x)) {
    if (!(EQ_BAENDER as readonly string[]).includes(b)) ungueltig(`${k}.${b}: unknown band (tief, mitte, hoch)`);
    if (typeof v !== typ || (typ === 'number' && !Number.isFinite(v))) ungueltig(`${k}.${b}: ${typ === 'number' ? 'number' : 'true or false'} expected`);
  }
}
// fx: {"1"?, "2"?, "3"?} of booleans; the track rule is the command's
function fxPruefen(x: unknown): void {
  if (x === null || typeof x !== 'object' || Array.isArray(x) || Object.keys(x).length === 0) return ungueltig('fx: {"1"?, "2"?, "3"?} expected');
  for (const [u, v] of Object.entries(x)) {
    if (!(FX_NUMMERN as readonly string[]).includes(u)) ungueltig(`fx.${u}: unknown FX (1, 2, 3)`);
    if (typeof v !== 'boolean') ungueltig(`fx.${u}: true or false expected`);
  }
}
// the send level of a deck track into the deck's return of that art; -200 when there is no send or no return
const sendDb = (p: Projekt, s: Spur, platz: 1 | 2, art: 'hall' | 'delay'): number => {
  const r = (p.returns ?? []).find((x) => x.loopdeck?.platz === platz && x.loopdeck.art === art);
  return (r ? s.sends?.find((x) => x.id === r.id)?.db : undefined) ?? FADER_MIN;
};
// send: {hall?, delay?} in dB, -200..0
function sendArg(x: unknown): ['hall' | 'delay', number][] {
  if (x === null || typeof x !== 'object' || Array.isArray(x) || Object.keys(x).length === 0) return ungueltig('send: {hall?, delay?} expected');
  return Object.entries(x).map(([k, v]) => {
    if (k !== 'hall' && k !== 'delay') return ungueltig(`send.${k}: unknown target (hall, delay)`);
    if (typeof v !== 'number' || !Number.isFinite(v) || v < FADER_MIN || v > LOOP_SEND_MAX) return ungueltig(`send.${k}: ${FADER_MIN}..${LOOP_SEND_MAX} dB expected`);
    return [k, v] as ['hall' | 'delay', number];
  });
}
// the effect slot of a track = its first bk stage
const effektVon = (s: Spur): Effekt | null => {
  const i = s.inserts?.find((x) => x.art === 'bk');
  return i ? { id: i.id, graph: i.graph ?? '', an: i.an } : null;
};
const leerLauf = (): Lauf => ({ zelle: null, verwaist: false, ab_beat: 0, versatz_beats: 0, wartend: null, zuletzt: null });

// One deck track as the stand shows it (also the session view's columns); a halten slot is empty for the loop deck
export function deckSpurSicht(p: Projekt, s: Spur, platz: 1 | 2, lauf: Lauf, frames?: (sha: string) => number | null): DeckSpur {
  return {
    spur_id: s.id, nr: s.nr, name: s.name, fader_db: s.fader_db, mute: s.mute, filter: s.filter ?? 0,
    eq: { tief: s.eq?.tief ?? 0, mitte: s.eq?.mitte ?? 0, hoch: s.eq?.hoch ?? 0 }, kill: { tief: !!s.kill?.tief, mitte: !!s.kill?.mitte, hoch: !!s.kill?.hoch },
    fx: { '1': !!s.fx?.['1'], '2': !!s.fx?.['2'], '3': !!s.fx?.['3'] },
    send: { hall: sendDb(p, s, platz, 'hall'), delay: sendDb(p, s, platz, 'delay') },
    zellen: (s.zellen ?? []).map((z) => (z && !istHalten(z) ? { ...z, frames: frames?.(z.sha256) ?? null } : null)), lauf, effekt: effektVon(s),
  };
}

export class LoopdeckBereich {
  readonly name = 'loopdeck';
  private uhr: UhrStand | null = null;
  private generation: number | null = null;
  private readonly spiegel = new Map<string, Lauf>();   // track id -> mirror of /zustand/zelle
  private readonly zuletzt = new Map<string, number>();  // track id -> last cell that played
  private readonly lauscher: ((spurId: string, lauf: Lauf | null) => void)[] = [];
  private readonly ctx: BereichKontext;
  private readonly zugang: ProjZugang;
  private readonly o: LoopdeckOptionen;
  constructor(ctx: BereichKontext, zugang: ProjZugang, o: LoopdeckOptionen = {}) { this.ctx = ctx; this.zugang = zugang; this.o = o; }

  private jetzt(): number { return (this.o.jetzt ?? Date.now)(); }

  // Called on every change of the /zustand/zelle mirror (and with null when a new core generation clears it): the session area emits its own event from it.
  beimLauf(f: (spurId: string, lauf: Lauf | null) => void): void { this.lauscher.push(f); }
  private meldeLauf(id: string, lauf: Lauf | null): void { for (const f of this.lauscher) f(id, lauf); }

  // every core event, before throttling
  ereignis(adresse: string, f: Record<string, unknown>): void {
    switch (adresse) {
      case '/uhr': this.uhr = { beat: Number(f.beat), bpm: Number(f.bpm), empfangenMs: this.jetzt() }; break;
      case '/k/willkommen': this.generation = Number(f.generation); break;
      case '/e/neustart': {   // the same signal areas/proj/state.ts uses to drop what the old core reported
        const alt = this.generation, g = Number(f.generation);
        this.generation = g;
        if (g !== alt) {
          const p = this.zugang.offen()?.projekt;   // the page learns that nothing plays or waits any more
          for (const id of this.spiegel.keys()) {
            const ort = p ? this.ort(p, id) : null;
            if (ort) this.ctx.verteile({ a: 'loopdeck', f: { deck: ort.deck, spur: ort.spur, lauf: null } });
            this.meldeLauf(id, null);
          }
          this.spiegel.clear(); this.zuletzt.clear(); this.uhr = null;   // the old clock is not the new core's clock
        }
        break;
      }
      case '/zustand/zelle': this.nimmZelle(f); break;
      default: break;
    }
  }

  private nimmZelle(f: Record<string, unknown>): void {
    const id = String(f.spur), zelle = Number(f.zelle), wart = Number(f.wartend);
    if (zelle > 0) this.zuletzt.set(id, zelle);
    const neu: Lauf = { zelle: zelle > 0 ? zelle : null, verwaist: Number(f.verwaist) === 1, ab_beat: Number(f.ab_beat), versatz_beats: Number(f.versatz_beats),
      wartend: wart < 0 || Number.isNaN(wart) ? null : { zelle: wart === 0 ? null : wart, ab_beat: Number(f.wartend_ab) }, zuletzt: this.zuletzt.get(id) ?? null };
    const alt = this.spiegel.get(id);
    this.spiegel.set(id, neu);
    if (alt && JSON.stringify(alt) === JSON.stringify(neu)) return;   // the 2 Hz repeat of an unchanged state is no event
    const p = this.zugang.offen()?.projekt;
    const ort = p ? this.ort(p, id) : null;
    if (ort) this.ctx.verteile({ a: 'loopdeck', f: { deck: ort.deck, spur: ort.spur, lauf: neu } });
    this.meldeLauf(id, neu);
  }
  private ort(p: Projekt, spurId: string): { deck: 1 | 2; spur: number } | null {
    for (const platz of [1, 2] as const) {
      const g = loopDeckGruppe(p, platz);
      const i = g ? loopDeckSpuren(p, g).findIndex((s) => s.id === spurId) : -1;
      if (i >= 0) return { deck: platz, spur: i + 1 };
    }
    return null;
  }

  private lauf(s: Spur): Lauf {
    return { ...leerLauf(), zuletzt: this.zuletzt.get(s.id) ?? null, ...this.spiegel.get(s.id) };
  }
  private deckVon(p: Projekt | undefined, platz: 1 | 2): Deck | null {
    const g = p ? loopDeckGruppe(p, platz) : null;
    if (!p || !g?.loopdeck) return null;
    return { gruppe_id: g.id, platz, ausgang_platz: platzVonGruppe(p, g.id), raster: g.loopdeck.raster, spuren: loopDeckSpuren(p, g).map((s) => deckSpurSicht(p, s, platz, this.lauf(s), this.o.frames)) };
  }

  // the core clock extrapolated to now; null before the first /uhr (the session view shows it in its stand)
  uhrJetzt(): { beat: number; bpm: number } | null {
    try { return { beat: loopBeatJetzt(this.uhr, this.jetzt()), bpm: this.uhr!.bpm }; } catch (e) { if (e instanceof KeineUhrFehler) return null; throw e; }
  }

  stand(): Antwort {
    const p = this.zugang.offen()?.projekt;
    const u = this.uhrJetzt();
    return { code: 200, j: { decks: { 1: this.deckVon(p, 1), 2: this.deckVon(p, 2) }, beat: u ? u.beat : null, bpm: u ? u.bpm : null } };
  }

  // the deck of a request with its 4 tracks; kein_loopdeck without a live container or a deck on that place
  private brauche(d: Record<string, unknown>): { deck: Deck; spuren: Spur[]; p: Projekt } {
    const platz = ganz(d, 'deck', 1, 2) as 1 | 2;
    const p = this.zugang.offen()?.projekt;
    const g = p ? loopDeckGruppe(p, platz) : null;
    if (!p || !g?.loopdeck) throw new LoopFehler(409, 'kein_loopdeck');
    const spuren = loopDeckSpuren(p, g);
    if (spuren.length !== LOOP_SPUREN) throw new LoopFehler(409, 'kein_loopdeck');
    return { deck: this.deckVon(p, platz)!, spuren, p };
  }
  riegel(quelle: Quelle): void {   // not private: loopsets.ts (lane S) shares the gate, the container, the command path and the budget check
    if (quelle === 'cypher' && this.ctx.kiGestoppt()) throw new LoopFehler(409, 'ki_gestoppt');
  }
  zielBeat(raster: LoopRaster): number {   // not private: the session area aims its launches at the same grid
    try { return loopZielBeat(this.uhr, LOOP_RASTER_BEATS[raster], this.jetzt()); } catch (e) {
      if (e instanceof KeineUhrFehler) throw new LoopFehler(409, 'keine_uhr');
      throw e;
    }
  }
  private rasterArg(d: Record<string, unknown>, deck: Deck): LoopRaster {
    if (d.raster === undefined) return deck.raster;
    if (typeof d.raster !== 'string' || !Object.hasOwn(LOOP_RASTER_BEATS, d.raster)) return ungueltig("raster: '1/4', '1/2', '1', 'takt' or '4takte' expected");
    return d.raster as LoopRaster;
  }

  // a cell the decode bookkeeping does not know yet (frames null); without bookkeeping (no `frames` option) nothing is held back
  private laedt(z: ZelleSicht): boolean { return this.o.frames !== undefined && z.frames === null; }
  private sendeStart(quelle: Quelle, s: Spur, zelle: number, ab: number, versatz: number): number {
    return this.ctx.sende('/k/arr/zelle_start', { quelle, spur: s.id, zelle, ab_beat: ab, versatz_beats: versatz });
  }
  private sendeStopp(quelle: Quelle, s: Spur, ab: number): number {
    return this.ctx.sende('/k/arr/zelle_stopp', { quelle, spur: s.id, ab_beat: ab });
  }
  // the first receipt of an id; a refusal (6) is a 409 with the core's reason, no answer at all means no core
  private async quittung(id: number): Promise<number> {
    const q = await this.ctx.warteQuittung(id, undefined, false, 400, true);   // the first receipt answers (status 1 included); 400 ms only if none comes
    if (!q) throw new LoopFehler(409, 'kein_kern');
    if (q.status === 6) throw new LoopFehler(409, q.grund || 'abgelehnt');
    return q.status;
  }

  start(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> { return this.antwort(() => this.startSicher(d, quelle)); }
  private async startSicher(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> {
    nurFelder(d, ['deck', 'spur', 'zelle', 'versatz_beats', 'raster']);
    this.riegel(quelle);
    const { deck, spuren } = this.brauche(d);
    const spur = ganz(d, 'spur', 1, LOOP_SPUREN), zelle = ganz(d, 'zelle', 1, LOOP_ZELLEN);
    const versatz = d.versatz_beats === undefined ? 0 : d.versatz_beats;
    if (typeof versatz !== 'number' || !Number.isFinite(versatz) || versatz < 0) ungueltig('versatz_beats: number >= 0 expected');
    const raster = this.rasterArg(d, deck);
    const r = await this.spurStarten(spuren[spur - 1], zelle, raster, quelle, versatz as number);
    return { code: 200, j: { ok: true, ab_beat: r.ab_beat, status: r.status } };
  }
  // One track, one cell, at the next grid point of `raster`: zelle_leer / zelle_laedt (nothing sent), keine_uhr, or the core's refusal. Throws LoopFehler.
  async spurStarten(s: Spur, zelle: number, raster: LoopRaster, quelle: Quelle, versatz = 0): Promise<{ ab_beat: number; status: number }> {
    const z = s.zellen?.[zelle - 1];
    if (!z || istHalten(z)) throw new LoopFehler(409, 'zelle_leer');
    if (this.laedt(this.sicht(z))) throw new LoopFehler(409, 'zelle_laedt');   // in the model, not yet decoded for the core: not sent
    const ab = this.zielBeat(raster);
    const status = await this.quittung(this.sendeStart(quelle, s, zelle, ab, versatz));
    return { ab_beat: ab, status };
  }
  private sicht(z: Zelle): ZelleSicht { return { ...z, frames: this.o.frames?.(z.sha256) ?? null }; }

  sprung(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> { return this.antwort(() => this.sprungSicher(d, quelle)); }
  private async sprungSicher(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> {
    nurFelder(d, ['deck', 'spur', 'slice']);
    this.riegel(quelle);
    const { deck, spuren } = this.brauche(d);
    const spur = ganz(d, 'spur', 1, LOOP_SPUREN), slice = ganz(d, 'slice', 1, 8);
    const lauf = this.lauf(spuren[spur - 1]);
    const nr = lauf.zelle ?? lauf.zuletzt;   // the playing cell, else the last one that played
    const z = nr === null ? null : deck.spuren[spur - 1].zellen[nr - 1];
    if (nr === null || !z) throw new LoopFehler(409, 'nichts_gespielt');
    if (z.art === 'einmal') throw new LoopFehler(409, 'nur_loop');
    if (this.laedt(z)) throw new LoopFehler(409, 'zelle_laedt');
    const versatz = (slice - 1) * z.beats / 8;
    const ab = this.zielBeat(deck.raster);
    await this.quittung(this.sendeStart(quelle, spuren[spur - 1], nr, ab, versatz));
    return { code: 200, j: { ok: true, ab_beat: ab, zelle: nr, versatz_beats: versatz } };
  }

  stopp(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> { return this.antwort(() => this.stoppSicher(d, quelle)); }
  private async stoppSicher(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> {
    nurFelder(d, ['deck', 'spur']);
    this.riegel(quelle);
    const { deck, spuren } = this.brauche(d);
    const nr = d.spur === undefined ? null : ganz(d, 'spur', 1, LOOP_SPUREN);
    const ab = this.zielBeat(deck.raster);
    const r = await this.spurStoppen(spuren.filter((_, i) => nr === null || i + 1 === nr), ab, quelle);
    const nrn = new Map(spuren.map((s, i) => [s.id, i + 1]));
    return { code: 200, j: { ok: true, ab_beat: ab, ...(r.abgelehnt.length ? { abgelehnt: r.abgelehnt.map((x) => ({ spur: nrn.get(x.spur_id)!, grund: x.grund })) } : {}) } };
  }
  // Stops the given tracks at `ab`. A track without any cell is unknown to the core's launcher (spur_bereich): nothing can play there, so nothing is sent.
  // One refused track is listed in abgelehnt; when every track that was sent is refused it throws the first refusal.
  async spurStoppen(spuren: Spur[], ab: number, quelle: Quelle): Promise<{ gestoppt: string[]; abgelehnt: { spur_id: string; grund: string }[] }> {
    const ziel = spuren.filter((s) => (s.zellen ?? []).some((z) => z && !istHalten(z)));
    const r = await this.ergebnisse(ziel.map((s) => this.sendeStopp(quelle, s, ab)), ziel.map((s) => s.id));
    const nein = new Set(r.abgelehnt.map((x) => x.spur));
    return { gestoppt: ziel.map((s) => s.id).filter((id) => !nein.has(id)), abgelehnt: r.abgelehnt.map((x) => ({ spur_id: x.spur, grund: x.grund })) };
  }

  szene(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> { return this.antwort(() => this.szeneSicher(d, quelle)); }
  private async szeneSicher(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> {
    nurFelder(d, ['deck', 'zeile']);
    this.riegel(quelle);
    const { deck, spuren } = this.brauche(d);
    const zeile = ganz(d, 'zeile', 1, LOOP_ZELLEN);
    const ab = this.zielBeat(deck.raster);
    const r = await this.zeileStarten(spuren, zeile, ab, quelle);
    const nr = new Map(spuren.map((s, i) => [s.id, i + 1]));
    const num = (ids: string[]): number[] => ids.map((id) => nr.get(id)!);
    return { code: 200, j: { ok: true, ab_beat: ab, gestartet: num(r.gestartet), gestoppt: num(r.gestoppt),
      ...(r.gehalten.length ? { gehalten: num(r.gehalten) } : {}),
      ...(r.laedt.length ? { laedt: num(r.laedt) } : {}), ...(r.abgelehnt.length ? { abgelehnt: r.abgelehnt.map((x) => ({ spur: nr.get(x.spur_id)!, grund: x.grund })) } : {}) } };
  }
  // Row `zeile` of the given tracks at one `ab`: a filled cell starts, an empty one stops its track, a hold slot gets nothing (gehalten). A cell that is not
  // decoded yet is skipped like an empty one (its track stops, `laedt` lists it); a track without any cell is unknown to the launcher and gets nothing.
  // Refusals of single tracks are listed in `abgelehnt`; when every command that was sent is refused it throws the first one.
  async zeileStarten(spuren: Spur[], zeile: number, ab: number, quelle: Quelle): Promise<{ gestartet: string[]; gestoppt: string[]; gehalten: string[];
    laedt: string[]; abgelehnt: { spur_id: string; grund: string }[] }> {
    const start: string[] = [], stopp: string[] = [], gehalten: string[] = [], laedt: string[] = [];
    const ids = spuren.flatMap((s) => {
      const z = s.zellen?.[zeile - 1] ?? null;
      if (z && istHalten(z)) { gehalten.push(s.id); return []; }
      if (z && !this.laedt(this.sicht(z))) { start.push(s.id); return [this.sendeStart(quelle, s, zeile, ab, 0)]; }
      if (z) laedt.push(s.id);
      if (!(s.zellen ?? []).some((c) => c && !istHalten(c))) return [];   // no cell at all: unknown to the launcher, nothing to stop
      stopp.push(s.id); return [this.sendeStopp(quelle, s, ab)];
    });
    const gesendet = [...start, ...stopp].sort((a, b) => spuren.findIndex((s) => s.id === a) - spuren.findIndex((s) => s.id === b));
    const r = await this.ergebnisse(ids, spuren.map((s) => s.id).filter((id) => gesendet.includes(id)));
    const nein = new Set(r.abgelehnt.map((x) => x.spur));
    return { gestartet: start.filter((id) => !nein.has(id)), gestoppt: stopp.filter((id) => !nein.has(id)), gehalten, laedt,
      abgelehnt: r.abgelehnt.map((x) => ({ spur_id: x.spur, grund: x.grund })) };
  }

  // spalten: the 8 deck tracks of the project in deck, track order, each with its mirror state
  spalten(p: Projekt): { spur: Spur; deck: 1 | 2; nr: 1 | 2 | 3 | 4; lauf: Lauf }[] {
    return ([1, 2] as const).flatMap((deck) => {
      const g = loopDeckGruppe(p, deck);
      return g?.loopdeck ? loopDeckSpuren(p, g).map((spur, i) => ({ spur, deck, nr: (i + 1) as 1 | 2 | 3 | 4, lauf: this.lauf(spur) })) : [];
    });
  }

  // ---- writes (M5) ----------------------------------------------------------------------------------------------------------------------

  // A write needs the live container: an open one is kept, anything else is opened or created by the session (never a second way of opening)
  // Another (non-live) project that is open is never closed for it: that is projekt_offen and nothing changes.
  async container(quelle: Quelle): Promise<void> {
    const offen = this.zugang.offen();
    if (offen?.projekt.live) return;
    if (offen) throw new LoopFehler(409, 'projekt_offen');
    if (!this.o.liveOeffnen) throw new LoopFehler(409, 'kein_loopdeck');
    let r: { code: number; j: unknown };
    try { r = await this.o.liveOeffnen(quelle); } catch (e) { throw this.fehlerVon(e); }   // the session refuses with projekt_offen when a project is (being) open
    if (r.code !== 200 || !this.zugang.offen()?.projekt.live) {
      const j = (r.j ?? {}) as { fehler?: string; text?: string };
      throw new LoopFehler(r.code === 200 ? 409 : r.code, j.fehler ?? 'kein_loopdeck', j.text ?? TEXTE[j.fehler ?? 'kein_loopdeck'] ?? 'The live container cannot be opened.');
    }
  }
  fehlerVon(e: unknown): unknown {
    if (e instanceof ProjFehler) return new LoopFehler(e.code, e.fehler, String((e.extra as { text?: string }).text ?? grundText(e.fehler)));
    if (e instanceof BefehlFehler && KEIN_PLATZ[e.grund] !== undefined) return new LoopFehler(409, 'kein_platz', KEIN_PLATZ[e.grund]);
    if (e instanceof BefehlFehler) return new LoopFehler(grundCode(e.grund), e.grund, e.detail || grundText(e.grund));
    if (e instanceof LadenFehler) return new LoopFehler(e.code, e.grund, e.text);
    return e;
  }
  // one command list as one undo step through the session (gates, lock, undo, core load and the `proj` event as for POST /proj/aendern)
  async schreibe(befehle: unknown[], label: string, quelle: Quelle): Promise<Projekt> {
    const o = this.zugang.offen();
    if (!o) throw new LoopFehler(409, 'kein_loopdeck');
    try {
      const r = await this.zugang.aendern({ rev: REV_JETZT, label, befehle }, quelle);
      if (r.code !== 200) { const j = r.j as { fehler?: string; text?: string }; throw new LoopFehler(r.code, j.fehler ?? 'abgelehnt', j.text ?? ''); }
    } catch (e) { throw this.fehlerVon(e); }
    return this.zugang.offen()!.projekt;
  }
  // the deck of a request for a write: the container is opened first, a missing deck is kein_loopdeck
  private async schreibDeck(d: Record<string, unknown>, quelle: Quelle, platzKey = 'deck'): Promise<{ deck: Deck; spuren: Spur[]; p: Projekt }> {
    ganz(d, platzKey, 1, 2);
    await this.container(quelle);
    return this.brauche({ deck: d[platzKey] });
  }
  private spurVon(spuren: Spur[], nr: unknown, k = 'spur'): Spur { return spuren[ganz({ [k]: nr }, k, 1, LOOP_SPUREN) - 1]; }

  // distinct decoded audio (bytes) of a project: clips and cells, every sha once. `neu` is the new cell's audio, `frames` knows the decode of the rest.
  audioBytes(p: Projekt, neu: { sha256: string; frames: number } | { sha256: string; frames: number }[]): number {
    const frames = new Map<string, number>();
    const merke = (sha: string): void => { if (!frames.has(sha)) frames.set(sha, this.o.frames?.(sha) ?? 0); };
    for (const c of alleAudioClips(p)) merke(c.quelle.sha256);
    for (const s of p.spuren) for (const z of s.zellen ?? []) if (z && !istHalten(z)) merke(z.sha256);
    for (const n of Array.isArray(neu) ? neu : [neu]) frames.set(n.sha256, n.frames);
    let n = 0;
    for (const f of frames.values()) n += f * 8;
    return n;
  }
  // the cell a load goes to: the given one, else the first empty by track then row; { spur, zelle } 1-based
  private waehleZiel(deck: Deck, ziel: { spur?: number; zelle?: number }): { spur: number; zelle: number } {
    if (ziel.spur !== undefined && ziel.zelle !== undefined) return { spur: ziel.spur, zelle: ziel.zelle };
    for (let s = 1; s <= LOOP_SPUREN; s++) {
      if (ziel.spur !== undefined && ziel.spur !== s) continue;
      for (let z = 1; z <= LOOP_ZELLEN; z++) {
        if (ziel.zelle !== undefined && ziel.zelle !== z) continue;
        if (!deck.spuren[s - 1].zellen[z - 1]) return { spur: s, zelle: z };
      }
    }
    throw new LoopFehler(409, 'deck_voll');
  }

  async ladeZelle(deck: 1 | 2, ziel: { spur?: number; zelle?: number }, q: LadeQuelle, wer: Quelle): Promise<{ spur: number; zelle: number; zelle_id: string }> {
    this.riegel(wer);
    ganz({ deck }, 'deck', 1, 2);
    if (ziel.spur !== undefined) ganz(ziel as Record<string, unknown>, 'spur', 1, LOOP_SPUREN);
    if (ziel.zelle !== undefined) ganz(ziel as Record<string, unknown>, 'zelle', 1, LOOP_ZELLEN);
    await this.container(wer);
    const vorher = this.zugang.offen()!;
    // a full deck is known before any audio is written
    const g0 = loopDeckGruppe(vorher.projekt, deck);
    if (g0?.loopdeck) this.waehleZiel(this.brauche({ deck }).deck, ziel);
    const dep: LadeAbhaengig = { loopOrdner: this.o.loopOrdner, modulBasis: this.o.modulBasis, katalogLoop: this.o.katalogLoop, deckLoop: this.o.deckLoop, zugang: this.zugang };
    const zuLang = (f: number): void => { if (f > LOOP_MAX_FRAMES) throw new LoopFehler(409, 'zu_lang'); };
    let geladen: Awaited<ReturnType<typeof ladeQuelle>> | null = null;
    try {
      try { geladen = await ladeQuelle(dep, vorher.ordner, deck, q, zuLang); } catch (e) { throw this.fehlerVon(e); }
      zuLang(geladen.frames);
      // the state after the await: the target is chosen on it and nothing awaits up to the command
      const o = this.zugang.offen();
      if (!o || o.slug !== vorher.slug || !o.projekt.live) throw new LoopFehler(409, 'projekt_gewechselt', 'The live container changed while the audio was written.');
      const probe = (von: Projekt, b: unknown[]): Projekt => { try { return fuehreListeAus(von, b, { quelle: wer }).projekt; } catch (e) { throw this.fehlerVon(e); } };
      const befehle: unknown[] = [];
      let p: Projekt = o.projekt, label: string = LOOPDECK_LABEL.zelle_setzen;
      if (!loopDeckGruppe(p, deck)) {   // a missing deck is created in the same undo step (the ids of the new tracks come from a trial run)
        befehle.push({ befehl: 'loopdeck_neu', platz: deck });
        p = probe(p, befehle);
        label = LOOPDECK_LABEL.loopdeck_neu;
      }
      const spuren = loopDeckSpuren(p, loopDeckGruppe(p, deck)!);
      const z = this.waehleZiel(this.deckVon(p, deck)!, ziel);
      const zelle = { name: geladen.name, farbe: ((z.spur - 1) * 4 + (z.zelle - 1)) % LOOP_FARBEN, art: geladen.art, sha256: geladen.sha256,
        ...(geladen.beats !== undefined ? { beats: geladen.beats } : {}), ...(geladen.bpm !== undefined ? { bpm: geladen.bpm } : {}), gain_db: 0, pfad_hinweis: geladen.pfad };
      befehle.push({ befehl: 'zelle_setzen', spur_id: spuren[z.spur - 1].id, index: z.zelle, zelle });
      const nach = probe(o.projekt, befehle);
      if (this.audioBytes(nach, geladen) > AUDIO_BUDGET_BYTES) throw new LoopFehler(409, 'audio_budget');
      const fertig = await this.schreibe(befehle, label, wer);
      const id = loopDeckSpuren(fertig, loopDeckGruppe(fertig, deck)!)[z.spur - 1].zellen![z.zelle - 1]!.id;
      geladen = null;   // the project owns the WAV from here on
      return { spur: z.spur, zelle: z.zelle, zelle_id: id };
    } catch (e) {
      if (geladen) fs.rmSync(geladen.abs, { force: true });
      throw e;
    }
  }

  neu(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> { return this.antwort(() => this.neuSicher(d, quelle)); }
  private async neuSicher(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> {
    nurFelder(d, ['deck', 'raster']);
    this.riegel(quelle);
    const platz = ganz(d, 'deck', 1, 2) as 1 | 2;
    const raster = d.raster === undefined ? undefined : this.rasterArg(d, { raster: 'takt' } as Deck);
    await this.container(quelle);
    const g = loopDeckGruppe(this.zugang.offen()!.projekt, platz);
    if (g?.loopdeck) return { code: 200, j: { ok: true, gruppe_id: g.id } };
    const p = await this.schreibe([{ befehl: 'loopdeck_neu', platz, ...(raster ? { raster } : {}) }], LOOPDECK_LABEL.loopdeck_neu, quelle);
    return { code: 200, j: { ok: true, gruppe_id: loopDeckGruppe(p, platz)!.id } };
  }

  laden(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> {
    return this.antwort(async () => {
      nurFelder(d, ['deck', 'spur', 'zelle', 'quelle']);
      const deck = ganz(d, 'deck', 1, 2) as 1 | 2;
      const q = pruefeQuelle(d.quelle);
      const ziel = { ...(d.spur !== undefined ? { spur: ganz(d, 'spur', 1, LOOP_SPUREN) } : {}), ...(d.zelle !== undefined ? { zelle: ganz(d, 'zelle', 1, LOOP_ZELLEN) } : {}) };
      return { code: 200, j: { ok: true, ...(await this.ladeZelle(deck, ziel, q, quelle)) } };
    });
  }

  zelle(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> {
    return this.antwort(async () => {
      nurFelder(d, ['deck', 'spur', 'zelle', 'name', 'farbe', 'art', 'gain_db', 'beats', 'leeren']);
      this.riegel(quelle);
      const spur = ganz(d, 'spur', 1, LOOP_SPUREN), index = ganz(d, 'zelle', 1, LOOP_ZELLEN);
      const { spuren } = await this.schreibDeck(d, quelle);
      const spur_id = spuren[spur - 1].id;
      if (d.leeren !== undefined) {
        if (d.leeren !== true || ['name', 'farbe', 'art', 'gain_db', 'beats'].some((k) => d[k] !== undefined)) ungueltig('leeren: true alone expected');
        await this.schreibe([{ befehl: 'zelle_setzen', spur_id, index, zelle: null }], LOOPDECK_LABEL.zelle_setzen, quelle);
      } else {
        const felder = Object.fromEntries(['name', 'farbe', 'art', 'gain_db', 'beats'].filter((k) => d[k] !== undefined).map((k) => [k, d[k]]));
        await this.schreibe([{ befehl: 'zelle_aendern', spur_id, index, ...felder }], LOOPDECK_LABEL.zelle_aendern, quelle);
      }
      return { code: 200, j: { ok: true } };
    });
  }

  bewegen(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> {
    return this.antwort(async () => {
      nurFelder(d, ['von', 'nach']);
      this.riegel(quelle);
      const stelle = (x: unknown, k: string): { deck: number; spur: number; zelle: number } => {
        if (x === null || typeof x !== 'object' || Array.isArray(x)) return ungueltig(`${k}: {deck, spur, zelle} expected`);
        const o = x as Record<string, unknown>;
        nurFelder(o, ['deck', 'spur', 'zelle']);
        return { deck: ganz(o, 'deck', 1, 2), spur: ganz(o, 'spur', 1, LOOP_SPUREN), zelle: ganz(o, 'zelle', 1, LOOP_ZELLEN) };
      };
      const von = stelle(d.von, 'von'), nach = stelle(d.nach, 'nach');
      await this.container(quelle);
      const a = this.brauche({ deck: von.deck }), b = this.brauche({ deck: nach.deck });
      await this.schreibe([{ befehl: 'zelle_bewegen', von: { spur_id: a.spuren[von.spur - 1].id, index: von.zelle },
        nach: { spur_id: b.spuren[nach.spur - 1].id, index: nach.zelle } }], LOOPDECK_LABEL.zelle_bewegen, quelle);
      return { code: 200, j: { ok: true } };
    });
  }

  raster(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> {
    return this.antwort(async () => {
      nurFelder(d, ['deck', 'raster']);
      this.riegel(quelle);
      if (d.raster === undefined) ungueltig("raster: '1/4', '1/2', '1', 'takt' or '4takte' expected");
      const raster = this.rasterArg(d, { raster: 'takt' } as Deck);
      const { deck } = await this.schreibDeck(d, quelle);
      await this.schreibe([{ befehl: 'loopdeck_aendern', gruppe_id: deck.gruppe_id, raster }], LOOPDECK_LABEL.loopdeck_aendern, quelle);
      return { code: 200, j: { ok: true } };
    });
  }

  spurAendern(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> {
    return this.antwort(async () => {
      nurFelder(d, ['deck', 'spur', 'fader_db', 'mute', 'filter', 'eq', 'kill', 'fx', 'send']);
      this.riegel(quelle);
      const spur = ganz(d, 'spur', 1, LOOP_SPUREN);
      const felder = Object.fromEntries(['fader_db', 'mute', 'filter', 'eq', 'kill', 'fx'].filter((k) => d[k] !== undefined).map((k) => [k, d[k]]));
      if (Object.keys(felder).length === 0 && d.send === undefined) ungueltig('fader_db, mute, filter, eq, kill, fx or send expected');
      if (d.eq !== undefined) baenderPruefen(d.eq, 'eq', 'number');
      if (d.kill !== undefined) baenderPruefen(d.kill, 'kill', 'boolean');
      if (d.fx !== undefined) fxPruefen(d.fx);
      const sends = d.send === undefined ? [] : sendArg(d.send);
      const { spuren } = await this.schreibDeck(d, quelle);
      const id = spuren[spur - 1].id;
      // the fields and every send are ONE command list: one undo step
      await this.schreibe([...(Object.keys(felder).length ? [{ befehl: 'spur_aendern', spur_id: id, ...felder }] : []),
        ...sends.map(([ziel, db]) => ({ befehl: 'loopdeck_send', spur_id: id, ziel, db }))], 'Loop deck track', quelle);
      return { code: 200, j: { ok: true } };
    });
  }

  // the qualifying effect graphs (index 1.4), read from the graph folder on every call
  effekte(): Antwort {
    return { code: 200, j: { graphen: loopFxGraphen(this.o.graphen?.() ?? listeGraphen().graphen) } };
  }

  // POST /loopdeck/effekt {deck, spur, graph} (graph '' removes) or {deck, spur, an}: the effect slot of a track, one undo step
  effektAendern(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> {
    return this.antwort(async () => {
      nurFelder(d, ['deck', 'spur', 'graph', 'an']);
      ganz(d, 'deck', 1, 2);
      const spur = ganz(d, 'spur', 1, LOOP_SPUREN);
      if ((d.graph === undefined) === (d.an === undefined)) return ungueltig('exactly one of graph and an expected');
      if (d.an !== undefined && typeof d.an !== 'boolean') return ungueltig('an: true or false expected');
      if (d.graph !== undefined && typeof d.graph !== 'string') return ungueltig('graph: an effect graph name or an empty string expected');
      if (d.graph !== undefined && d.graph !== '' && !loopFxGraphen(this.o.graphen?.() ?? listeGraphen().graphen).some((g) => g.name === d.graph)) {
        throw new LoopFehler(400, 'graph_unbekannt', `${d.graph} is not an effect graph the loop deck can use (GET /loopdeck/effekte lists them)`);
      }
      this.riegel(quelle);
      const { spuren } = await this.schreibDeck(d, quelle);
      const id = spuren[spur - 1].id;
      let befehle: unknown[];
      if (d.an !== undefined) {   // the light path of insert_an: only the row goes to the core
        const slot = spuren[spur - 1].inserts?.find((x) => x.art === 'bk');
        if (!slot) return ungueltig('no effect on this track');
        befehle = [{ befehl: 'insert_an', insert_id: slot.id, an: d.an }];
      } else befehle = [{ befehl: 'loopdeck_effekt', spur_id: id, graph: d.graph }];
      const p = await this.schreibe(befehle, LOOPDECK_LABEL.loopdeck_effekt, quelle);
      return { code: 200, j: { ok: true, effekt: effektVon(p.spuren.find((x) => x.id === id)!) } };
    });
  }

  leeren(d: Record<string, unknown>, quelle: Quelle): Promise<Antwort> {
    return this.antwort(async () => {
      nurFelder(d, ['deck']);
      this.riegel(quelle);
      const { deck } = await this.schreibDeck(d, quelle);
      await this.schreibe([{ befehl: 'loopdeck_leeren', gruppe_id: deck.gruppe_id }], LOOPDECK_LABEL.loopdeck_leeren, quelle);
      return { code: 200, j: { ok: true } };
    });
  }

  // a refusal of this area is {ok: false, grund, text}; anything else goes the way of the other areas
  private async antwort(f: () => Promise<Antwort>): Promise<Antwort> {
    try { return await f(); } catch (e0) {
      const e = this.fehlerVon(e0);
      return e instanceof LoopFehler ? { code: e.code, j: { ok: false, grund: e.grund, text: e.text } } : alsAntwort(e, this.ctx);
    }
  }
  // all receipts of one gesture are waited for (none is left dangling); the first refusal is the answer
  // A track that is refused is listed in `abgelehnt`; the call only fails (the first refusal) when no track went out at all.
  private async ergebnisse<T>(ids: number[], spuren: T[]): Promise<{ abgelehnt: { spur: T; grund: string }[] }> {
    const r = await Promise.allSettled(ids.map((id) => this.quittung(id)));
    const abgelehnt: { spur: T; grund: string }[] = [];
    const fehler: LoopFehler[] = [];
    for (let i = 0; i < r.length; i++) {
      const x = r[i];
      if (x.status === 'fulfilled') continue;
      if (!(x.reason instanceof LoopFehler)) throw x.reason;
      fehler.push(x.reason);
      abgelehnt.push({ spur: spuren[i], grund: x.reason.grund });
    }
    if (fehler.length > 0 && abgelehnt.length === ids.length) throw fehler[0];
    return { abgelehnt };
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
      { methode: 'GET', pfad: '/loopdeck/stand', schutz: 'offen', handler: async (_q, r) => antworte(r, () => this.stand()) },
      post('/loopdeck/start', (d, q) => this.start(d, q)),
      post('/loopdeck/sprung', (d, q) => this.sprung(d, q)),
      post('/loopdeck/stopp', (d, q) => this.stopp(d, q)),
      post('/loopdeck/szene', (d, q) => this.szene(d, q)),
      post('/loopdeck/laden', (d, q) => this.laden(d, q)),
      post('/loopdeck/zelle', (d, q) => this.zelle(d, q)),
      post('/loopdeck/bewegen', (d, q) => this.bewegen(d, q)),
      post('/loopdeck/raster', (d, q) => this.raster(d, q)),
      post('/loopdeck/spur', (d, q) => this.spurAendern(d, q)),
      post('/loopdeck/effekt', (d, q) => this.effektAendern(d, q)),
      { methode: 'GET', pfad: '/loopdeck/effekte', schutz: 'offen', handler: async (_q, r) => antworte(r, () => this.effekte()) },
      post('/loopdeck/leeren', (d, q) => this.leeren(d, q)),
      post('/loopdeck/neu', (d, q) => this.neu(d, q)),
    ];
  }
}

// exported for the lanes S, H and C: load a source into a cell of a loop deck (index 1.5)
export function ladeZelle(b: LoopdeckBereich, deck: 1 | 2, ziel: { spur?: number; zelle?: number }, quelle: LadeQuelle, wer: Quelle): Promise<{ spur: number; zelle: number; zelle_id: string }> {
  return b.ladeZelle(deck, ziel, quelle, wer);
}

// the area of a page server by its project access, so that loopsets.ts finds the one loop deck area without server.ts passing it on
const BEREICHE = new WeakMap<ProjZugang, LoopdeckBereich>();
export function loopdeckBereichVon(zugang: ProjZugang): LoopdeckBereich | undefined { return BEREICHE.get(zugang); }

export function loopdeckBereich(ctx: BereichKontext, zugang: ProjZugang, o: LoopdeckOptionen = {}): LoopdeckBereich {
  const b = new LoopdeckBereich(ctx, zugang, o);
  BEREICHE.set(zugang, b);
  return b;
}
