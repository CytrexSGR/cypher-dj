// FIND SOUND, part 1: request handling of the variant round (POST /proj/klang/runde and friends). One round per server: it renders the track with
// one knob moved at a time (Ausgabe.rendereKlangVarianten, from a copy of the open project), measures every variant, keeps three audible neighbours
// as the places B to D (pure logic in project/sound_runde.ts), switches the playing instrument to a place through the transient core rows
// (ProjZugang.hoereBk, the project is not written) and answers plans for POST /proj/aendern for a pick and for going back in the family tree.
// Contract: project/klang_runde_vertrag.ts. Nothing thrown in the background run escapes; the state carries it as zustand 'fehler'.
import { AusgabeFehler, alsAntwort, hatLane, type Ausgabe } from './output.ts';
import { analysiereImWerk } from './sound_analysis.ts';
import type { ProjZugang } from './area.ts';
import type { TaktZugang } from './sound_bar.ts';
import { anzeigeWert, parameterTabelle, type Parameter } from '../../devices_parameter.ts';
import { sucheSpur, type Projekt, type Spur } from '../../project/model.ts';
import { STILLE_DB } from '../../project/sound_contract.ts';
import type { Teilmessung } from '../../project/sound_measurement.ts';
import {
  ZIELE, KEIN_KNOPF_TEXT, UEBERSCHUSS, VERGLEICH_PLAN, VERGLEICH_TOTMANN_MS, MAX_MESSUNGEN, MAX_MESSUNGEN_LEER, STAPEL, MAX_BEATS, istPlatz, istSchritt,
  type Merkmale, type Messung, type Platz, type PlatzName, type RundeLage, type RundePlan, type RundeZustand, type Schritt, type Stammbaum,
} from '../../project/sound_runde_contract.ts';
import {
  annehmbar, auffuellen, aufgeloest, ausgleichDb, bauePlatz, bildVon, hoerDiff, kandidaten, merkmale, platzA, schluesselVon, stammbaumNachWahl,
  stammbaumZurueck, taugt, wegVon, weiter,
  wirkung,
  type Gemessen, type Kandidat,
} from '../../project/sound_runde.ts';

type Quelle = 'andreas' | 'cypher';
type Werte = Record<string, number>;
type Teil = { still: boolean; m: Messung };

export interface KlangRundeAbhaengig {
  /** Renders the knob variants of one track (Ausgabe.rendereKlangVarianten). */
  ausgabe: Pick<Ausgabe, 'rendereKlangVarianten'>;
  /** The open project, the transient knob write and the close hook of the access (area.ts). */
  zugang: { offen(): { slug: string; projekt: Projekt } | null; hoereBk?: ProjZugang['hoereBk']; beiSchliessen?: ProjZugang['beiSchliessen'] };
  /** The source of the current request (default andreas). */
  quelle?: () => Quelle;
  /** COMPARE: the bar clock and the core scheduler (sound_bar.ts). Without it COMPARE is refused (vergleich_steht). */
  takt?: TaktZugang;
  /** True while Stop Cypher is set: a COMPARE that Cypher started ends at its next bar. */
  kiGestoppt?: () => boolean;
  /** Throws ki_gestoppt when Cypher may not write (checked before a round starts and before listening). */
  pruefeSchreiben?: () => void;
  /** Reduces one rendered WAV to features and the third-octave picture (default: the analysis worker, `merkmale` and `bildVon`). */
  merkmaleVon?: (datei: string, frames: number) => Promise<Messung>;
  /** The audibility D of a variant against A (default hoerDiff; tests inject). */
  unterschied?: (a: Messung, v: Messung) => number;
  /** The knobs of a graph (default parameterTabelle for the Baukasten graph). */
  tabelle?: (graph: string) => Parameter[];
  /** Waits (default setTimeout); used between the retries of a busy output lock. */
  warte?: (ms: number) => Promise<void>;
  /** Timer of the idle end (default setTimeout / clearTimeout, unref'd). */
  setzeTimer?: (f: () => void, ms: number) => unknown;
  loescheTimer?: (h: unknown) => void;
  leerlaufMs?: number;
  log?: (z: Record<string, unknown>) => void;
}

/** A busy output lock is retried this often, this far apart. */
export const BESCHAEFTIGT_VERSUCHE = 20, BESCHAEFTIGT_MS = 300;
/** A round that got no request for this long ends itself. */
export const LEERLAUF_MS = 15 * 60_000;
const NEUSTARTS_MAX = 2;
const TOLERANZ = 1e-6;
const ABBRUCH = Symbol('round dropped');

const fehl = (grund: string, text: string): never => { throw new AusgabeFehler(grund, text); };
const STILL_T = { stumm: true } as Teilmessung;
const STILL: Messung = { m: merkmale(STILL_T), bild: bildVon(STILL_T) };
const knopfNr = (k: string): number => Number(k.slice(1));

interface Gedaechtnis {
  vorwissen: Map<string, number>;
  versatz: number;
  nicht: Set<string>;
  basis: string;
  umkehr: { basis: string; schluessel: string } | null;
}

interface Runde {
  nr: number; slug: string; spurId: string; spurName: string; graph: string; rev: number; schritt: Schritt; schwelle: number; von: number; bis: number;
  tabelle: Parameter[]; basis: Werte; gesperrt: Set<string>; kand: Kandidat[]; hoechstens: number;
  zustand: RundeZustand; grund?: string; text?: string; hinweis?: string;
  a: Messung | null; gemessen: Gemessen[]; angenommen: Gemessen[]; gewaehlt: Gemessen[]; plaetze: Platz[]; aktiv: PlatzName;
  gedaechtnis: Gedaechtnis; lauf: Promise<void>;
  /** The knobs this round holds a transient override on in the core (what has to be taken off again), whatever `aktiv` says. */
  ueber: Set<string>;
  /** The track fader row holds an audition value (project fader + the level match gain) that has to be taken off again. */
  faderUeber: boolean;
  /** COMPARE: `marke` counts every start and end (a part that answers under an old mark is stale), `letztesAb` is the last bar line used. */
  vergleich: { an: boolean; platz: PlatzName | null; abBeat: number | null; marke: number; letztesAb: number; quelle: Quelle };
}

const werteDer = (s: Spur): Werte => ((s.geraet as { parameter?: Werte } | undefined)?.parameter ?? {});
const graphDer = (s: Spur): string => (s.geraet as { graph: string }).graph;
const istBk = (s: Spur | undefined): s is Spur => s?.geraet?.art === 'intern' && s.geraet.name === 'bk';
const basisSchluessel = (b: Werte): string => Object.entries(b).sort(([x], [y]) => knopfNr(x) - knopfNr(y)).map(([k, v]) => `${k}=${v.toFixed(6)}`).join(',');
// the knobs a lane or a clip envelope of the track drives: they are never measured and never a place
function gesperrteKnoepfe(s: Spur): Set<string> {
  const aus = new Set<string>();
  const ziel = (z: unknown): void => { const m = typeof z === 'string' ? /^geraet\.(k[1-9][0-9]?)$/.exec(z) : null; if (m) aus.add(m[1]); };
  for (const l of s.automation ?? []) ziel(l.ziel);
  for (const c of s.clips) for (const h of c.huellkurven ?? []) ziel(h.ziel);
  return aus;
}

// Where BACK goes without a named node: knobs turned by hand since the active node mean the active node itself (the hand change is recorded and
// undone), else the parent (undefined lets stammbaumZurueck take it).
function zielZurueck(baum: Stammbaum, jetzt: Werte): string | undefined {
  const hand = Object.entries(aufgeloest(baum)).some(([k, v]) => k in jetzt && Math.abs(jetzt[k] - v) > TOLERANZ);
  return hand ? baum.aktiv : undefined;
}

export class KlangRunde {
  private readonly a: KlangRundeAbhaengig;
  private r: Runde | null = null;
  private nummer = 0;
  private readonly gedaechtnis = new Map<string, Gedaechtnis>();
  private leerlauf: unknown = null;

  constructor(a: KlangRundeAbhaengig) {
    this.a = a;
    // a project that closes or is replaced ends the round without writing anything (the core rows go with the playback of the next project)
    a.zugang.beiSchliessen?.(() => {
      const r = this.r;
      this.r = null; this.stoppeLeerlauf(); this.stoppeTotmann();
      if (r?.vergleich.an) { r.vergleich.marke++; r.vergleich.an = false; void this.bricheAb(); }
    });
  }

  private quelle(): Quelle { return this.a.quelle?.() ?? 'andreas'; }
  private warte(ms: number): Promise<void> { return this.a.warte ? this.a.warte(ms) : new Promise((ok) => { setTimeout(ok, ms); }); }
  private tabelleVon(graph: string): Parameter[] {
    return this.a.tabelle ? this.a.tabelle(graph) : parameterTabelle({ art: 'bk', graph } as Parameters<typeof parameterTabelle>[0]);
  }
  private stoppeLeerlauf(): void {
    if (this.leerlauf === null) return;
    (this.a.loescheTimer ?? ((h) => clearTimeout(h as NodeJS.Timeout)))(this.leerlauf);
    this.leerlauf = null;
  }
  // every request renews the idle timer: 15 minutes without one end the round as `ende` does
  private beruehre(): void {
    this.stoppeLeerlauf();
    if (!this.r) return;
    const f = (): void => { this.leerlauf = null; void this.ende(); };
    const h = this.a.setzeTimer ? this.a.setzeTimer(f, this.a.leerlaufMs ?? LEERLAUF_MS) : setTimeout(f, this.a.leerlaufMs ?? LEERLAUF_MS);
    if (!this.a.setzeTimer) (h as NodeJS.Timeout).unref();
    this.leerlauf = h;
    this.totmann();
  }
  // COMPARE needs a page that looks: without a request for VERGLEICH_TOTMANN_MS it ends as `ende` does (the round itself lives on until the idle end)
  private totmannTimer: unknown = null;
  private stoppeTotmann(): void {
    if (this.totmannTimer === null) return;
    (this.a.loescheTimer ?? ((h) => clearTimeout(h as NodeJS.Timeout)))(this.totmannTimer);
    this.totmannTimer = null;
  }
  private totmann(): void {
    this.stoppeTotmann();
    const r = this.r;
    if (!r?.vergleich.an) return;
    const f = (): void => { this.totmannTimer = null; if (this.r === r && r.vergleich.an) void this.beendeVergleich(r, true); };
    const h = this.a.setzeTimer ? this.a.setzeTimer(f, VERGLEICH_TOTMANN_MS) : setTimeout(f, VERGLEICH_TOTMANN_MS);
    if (!this.a.setzeTimer) (h as NodeJS.Timeout).unref();
    this.totmannTimer = h;
  }

  /** Resolves when the background run of the current round has ended (tests and callers that want the final state). */
  async warteFertig(): Promise<void> { await this.r?.lauf; }

  // --- the open project --------------------------------------------------------------------------------------------------------------------
  private werteVon(s: Spur, tabelle: readonly Parameter[]): Werte {
    const p = werteDer(s), aus: Werte = {};
    for (const k of tabelle) aus[k.name] = p[k.name] ?? k.vorgabe;
    return aus;
  }
  // the track of the round in the open project, or null when the project is another one, the track is gone, no longer a Baukasten track, or has another graph
  private spurJetzt(r: Runde): { projekt: Projekt; spur: Spur } | null {
    const o = this.a.zugang.offen();
    if (!o || o.slug !== r.slug) return null;
    const s = sucheSpur(o.projekt, r.spurId);
    return istBk(s) && graphDer(s) === r.graph ? { projekt: o.projekt, spur: s } : null;
  }
  // stale: the project, the track, its graph or one of its resolved knob values is not what the round was measured on
  private veraltet(r: Runde): boolean {
    const j = this.spurJetzt(r);
    if (!j) return true;
    const jetzt = this.werteVon(j.spur, r.tabelle);
    return r.tabelle.some((k) => Math.abs(jetzt[k.name] - r.basis[k.name]) > TOLERANZ);
  }

  // --- request checks --------------------------------------------------------------------------------------------------------------------
  private lies(d: Record<string, unknown>, erlaubt: readonly string[]): void {
    for (const k of Object.keys(d)) if (!erlaubt.includes(k)) fehl('argument_ungueltig', `unknown field ${k}`);
    if (d.runde !== undefined && !Number.isInteger(d.runde)) fehl('argument_ungueltig', 'runde: a whole number is required');
  }
  private aktuell(d: Record<string, unknown>): Runde {
    const r = this.r ?? fehl('keine_runde', 'no round is running; start one first');
    if (d.runde !== undefined && d.runde !== r.nr) fehl('runde_veraltet', `round ${String(d.runde)} is over; the current round is ${r.nr}`);
    return r;
  }
  private frisch(r: Runde): void {
    if (this.veraltet(r)) fehl('runde_veraltet', 'the project changed since this round was measured; start a new round');
  }

  // --- the transient knob ------------------------------------------------------------------------------------------------------------------
  // Every write to the core runs in one chain, in the order of the calls: a listen that is still on its way is finished before the next listen, a
  // restart or the end of the round takes the override off, so no knob stays behind when two of them cross.
  private kette: Promise<void> = Promise.resolve();
  private inKette<T>(f: () => Promise<T>): Promise<T> {
    const p = this.kette.then(f, f);
    this.kette = p.then(() => undefined, () => undefined);
    return p;
  }
  // The override is taken off again: every knob the round holds one on gets the value the open project has for it now (never the basis of the round),
  // and only while the open project is the project of the round and the track is still there with the same graph. The write is the server cleaning
  // up, so it goes as the owner whoever asked last (Stop Cypher must not keep an override alive). Never throws.
  private setzeZurueck(r: Runde): Promise<void> {
    return this.inKette(async () => {
      const knoepfe = [...r.ueber], faderUeber = r.faderUeber;
      r.aktiv = 'A'; r.ueber.clear(); r.faderUeber = false;
      if ((!knoepfe.length && !faderUeber) || !this.a.zugang.hoereBk) return;
      const j = this.spurJetzt(r);
      if (!j) return;
      const jetzt = this.werteVon(j.spur, r.tabelle), werte: Werte = {};
      for (const k of knoepfe) werte[k] = jetzt[k];
      const fader = faderUeber ? this.faderJetzt(r) : null;
      if (!knoepfe.length && fader === null) return;
      try { await (fader === null ? this.a.zugang.hoereBk(r.spurId, werte, 'andreas') : this.a.zugang.hoereBk(r.spurId, werte, 'andreas', fader)); } catch (e) {
        this.a.log?.({ typ: 'proj_klang_runde_zurueck_fehler', fehler: (e as Error).message });
      }
    });
  }

  // Level match: the project fader (dB) of the track while the audition may move it, else null: a track with a fader, mute or solo lane, a track that
  // is off (-200) and a project without a fader value are left alone. The fader row is no knob row: the core does not clear it at a playback build.
  private faderJetzt(r: Runde): number | null {
    const s = this.spurJetzt(r)?.spur;
    return s && typeof s.fader_db === 'number' && s.fader_db > -200 && !hatLane(s) ? s.fader_db : null;
  }

  // --- the state ------------------------------------------------------------------------------------------------------------------------------
  private baueLage(r: Runde): RundeLage {
    const j = this.spurJetzt(r);
    const baum: Stammbaum | null = j?.spur.stammbaum && j.spur.stammbaum.graph === r.graph ? j.spur.stammbaum : null;
    const jetzt = j ? this.werteVon(j.spur, r.tabelle) : r.basis;
    const zustand = r.zustand === 'fehler' ? 'fehler' : this.veraltet(r) ? 'veraltet' : r.zustand;
    return {
      runde: r.nr, spur_id: r.spurId, spur_name: j?.spur.name ?? r.spurName, graph: r.graph, rev: r.rev, zustand, schritt: r.schritt,
      von_beat: r.von, bis_beat: r.bis, fortschritt: { gemessen: r.gemessen.length, hoechstens: r.hoechstens }, aktiv: r.aktiv,
      vergleich: { an: r.vergleich.an, platz: r.vergleich.platz, klingt: r.aktiv, ab_beat: r.vergleich.abBeat }, plaetze: r.plaetze,
      stammbaum: baum, weg: baum ? wegVon(baum) : [],
      zurueck_moeglich: baum !== null && stammbaumZurueck({ baum, ziel: zielZurueck(baum, jetzt), basis: jetzt }) !== null,
      ...(r.grund ? { grund: r.grund, text: r.text } : {}),
      ...(r.hinweis ? { hinweis: r.hinweis } : {}),
    };
  }

  /** The state of the round; keine_runde (404) without one. */
  lage(): RundeLage {
    const r = this.r ?? fehl('keine_runde', 'no round is running; start one first');
    this.beruehre();
    return this.baueLage(r);
  }

  // A fader left at an audition value (a restart or a dead page; the core does not clear mixer rows) is written back once when a round starts.
  private heileFader(r: Runde): void {
    const h = this.a.zugang.hoereBk, f = this.faderJetzt(r);
    if (!h || f === null) return;
    void this.inKette(async () => {
      try { await h(r.spurId, {}, 'andreas', f); } catch (e) { this.a.log?.({ typ: 'proj_klang_runde_zurueck_fehler', fehler: (e as Error).message }); }
    });
  }

  // --- start -------------------------------------------------------------------------------------------------------------------------------------
  /** Starts a round for a Baukasten track (replacing a running one) and answers its state at once; the measuring continues in the background. */
  starte(d: Record<string, unknown>): RundeLage {
    this.lies(d, ['spur_id', 'schritt']);
    if (typeof d.spur_id !== 'string' || d.spur_id === '') fehl('argument_ungueltig', 'spur_id: a track id is required');
    if (d.schritt !== undefined && !istSchritt(d.schritt)) fehl('argument_ungueltig', 'schritt: fein, normal or grob is required');
    const schritt: Schritt = (d.schritt as Schritt | undefined) ?? 'normal';
    this.a.pruefeSchreiben?.();
    const o = this.a.zugang.offen() ?? fehl('kein_projekt', 'no project is open');
    const s = sucheSpur(o.projekt, d.spur_id as string) ?? fehl('spur_unbekannt', `there is no track ${String(d.spur_id)}`);
    if (!istBk(s)) fehl('geraet_falsch', `${s.id} is not a Cypher Modular track`);
    const graph = graphDer(s), tabelle = this.tabelleVon(graph);
    if (!tabelle.length) fehl('argument_ungueltig', `the graph ${graph} has no knobs`);
    // the old round goes first: its override is taken off, its background run stops at the next step
    const alt = this.r;
    this.r = null;
    if (alt) void this.beendeVergleich(alt, true);
    const basis = this.werteVon(s, tabelle), gesperrt = gesperrteKnoepfe(s);
    const loop = o.projekt.loop;
    const von = loop.an ? loop.von_beat : 0, bis = loop.an ? Math.min(loop.bis_beat, von + MAX_BEATS) : MAX_BEATS;
    const g = this.gedaechtnisVon(`${o.slug}|${s.id}|${graph}`, basis, schritt);
    const roh = (nicht: Set<string>): Kandidat[] => kandidaten({ tabelle, werte: basis, schwelle: ZIELE[schritt], gesperrt, nicht,
      vorwissen: g.vorwissen, versatz: g.versatz });
    // what was offered on the same basis is not offered again; when that would leave nothing, everything is allowed again
    const alle = roh(g.nicht).length ? roh(g.nicht) : roh(new Set());
    g.versatz++;
    const hoechstens = Math.min(MAX_MESSUNGEN, alle.length);
    const r: Runde = {
      nr: ++this.nummer, slug: o.slug, spurId: s.id, spurName: s.name, graph, rev: o.projekt.rev, schritt, schwelle: ZIELE[schritt], von, bis, tabelle, basis,
      gesperrt,
      kand: alle, hoechstens, zustand: 'misst', a: null, gemessen: [], angenommen: [], gewaehlt: [], plaetze: [], aktiv: 'A',
      gedaechtnis: g, lauf: Promise.resolve(), ueber: new Set(), faderUeber: false,
      vergleich: { an: false, platz: null, abBeat: null, marke: 0, letztesAb: -Infinity, quelle: this.quelle() },
    };
    this.r = r;
    this.heileFader(r);
    r.lauf = Promise.resolve().then(() => this.lauf(r));
    this.beruehre();
    return this.baueLage(r);
  }

  // memory per slug, track and graph: strengths, rounds started, offered keys for the current basis and the reverse of the last pick
  private gedaechtnisVon(schluessel: string, basis: Werte, schritt: Schritt): Gedaechtnis {
    let g = this.gedaechtnis.get(schluessel);
    if (!g) { g = { vorwissen: new Map(), versatz: 0, nicht: new Set(), basis: '', umkehr: null }; this.gedaechtnis.set(schluessel, g); }
    // what was offered counts per basis and step size: another step size offers the same knobs again
    const b = basisSchluessel(basis), bs = `${b}|${schritt}`;
    if (g.umkehr && g.umkehr.basis === b) { g.nicht = new Set([g.umkehr.schluessel]); g.basis = bs; g.umkehr = null; }
    else if (g.basis !== bs) { g.nicht = new Set(); g.basis = bs; }
    return g;
  }

  // --- the background run -------------------------------------------------------------------------------------------------------------------
  private async lauf(r: Runde): Promise<void> {
    try {
      for (let neustarts = 0; ; neustarts++) {
        if ((await this.messe(r)) !== 'neustart' || this.r !== r) return;
        // the project moved on while this round measured: from A again, but only twice, and not at all when a knob, the graph or the track changed
        if (neustarts >= NEUSTARTS_MAX || this.veraltet(r)) { r.zustand = 'veraltet'; return; }
      }
    } catch (e) {
      if (e === ABBRUCH || this.r !== r) return;
      const x = alsAntwort(e).body;
      r.zustand = 'fehler'; r.grund = x.fehler; r.text = x.text;
      this.a.log?.({ typ: 'proj_klang_runde_fehler', grund: x.fehler, detail: x.detail });
    }
  }

  private async messeDatei(datei: string, frames: number): Promise<Messung> {
    if (this.a.merkmaleVon) return this.a.merkmaleVon(datei, frames);
    try {
      const t = (await analysiereImWerk({ quelle: datei, frames: [frames] })).quelle;
      return { m: merkmale(t), bild: bildVon(t) };
    } catch (e) {
      if (e instanceof AusgabeFehler) throw e;
      throw new AusgabeFehler('render_fehler', 'the analysis failed', (e as Error)?.message ?? String(e));
    }
  }

  // One batch of variants: rendered and reduced inside the callback (the WAVs are gone when the render returns). A busy lock is retried.
  private async rendere(r: Runde, varianten: Werte[]): Promise<{ rev: number; slug: string; teile: Teil[] }> {
    for (let i = 0; ; i++) {
      try {
        return await this.a.ausgabe.rendereKlangVarianten(r.spurId, varianten, r.von, r.bis, async (x) => ({
          rev: x.rev, slug: x.slug,
          teile: await Promise.all(x.teile.map(async (t): Promise<Teil> => ('stumm' in t || t.spitze_db <= STILLE_DB ? { still: true, m: STILL }
            : { still: false, m: await this.messeDatei(t.datei, t.frames) }))),
        }));
      } catch (e) {
        if ((e as { grund?: unknown })?.grund !== 'beschaeftigt' || i >= BESCHAEFTIGT_VERSUCHE) throw e;
        await this.warte(BESCHAEFTIGT_MS);
        if (this.r !== r) throw ABBRUCH;
      }
    }
  }

  // A first with the first three candidates, then batches of STAPEL, until three are accepted, the budget is rendered or none are left. A candidate
  // that stays under the target is followed by its next rung (weiter), which goes to the FRONT of the queue; a knob whose range end stays under the
  // target is not queued again. Every try is one render and counts against the budget.
  private async messe(r: Runde): Promise<'ende' | 'neustart'> {
    // measuring anew (a batch rendered on another revision): the places go, so the place that plays is taken off first
    if (r.ueber.size || r.aktiv !== 'A') await this.setzeZurueck(r);
    r.a = null; r.gemessen = []; r.angenommen = []; r.gewaehlt = []; r.plaetze = []; r.zustand = 'misst'; delete r.hinweis;
    const schlange = [...r.kand];
    let erster = true, geplant = r.kand.length;
    for (;;) {
      // the budget: MAX_MESSUNGEN, but while nothing audible was found the round goes on up to MAX_MESSUNGEN_LEER
      const budget = erster || r.gemessen.some((g) => taugt(g, Math.min(r.schwelle, ZIELE.fein))) ? MAX_MESSUNGEN : MAX_MESSUNGEN_LEER;
      r.hoechstens = Math.min(budget, geplant);
      const kand = schlange.splice(0, Math.max(0, Math.min(erster ? 3 : STAPEL, r.hoechstens - r.gemessen.length)));
      if (!erster && !kand.length) break;
      const res = await this.rendere(r, [...(erster ? [{}] : []), ...kand.map((k) => ({ [k.param]: k.wert }))]);
      if (this.r !== r) return 'ende';
      if (res.slug !== r.slug) { r.zustand = 'veraltet'; return 'ende'; }
      const teile = [...res.teile];
      if (erster) {
        r.rev = res.rev;
        const a = teile.shift() as Teil;
        if (a.still) { r.zustand = 'fehler'; r.grund = 'spur_still'; r.text = 'the track is silent in the measured range'; return 'ende'; }
        r.a = a.m; r.plaetze = [platzA(a.m.m)]; erster = false;
      } else if (res.rev !== r.rev) return 'neustart';
      const a = r.a as Messung, unterschied = this.a.unterschied ?? ((x: Messung, y: Messung) => hoerDiff(x, y).d);
      const naechste: Kandidat[] = [];
      kand.forEach((k, i) => {
        const w = wirkung(a.m, teile[i].m.m);
        // the strength is the audibility D; the effect vector only gives the direction and the word
        const g: Gemessen = { ...k, merkmale: teile[i].m.m, e: w.e, staerke: teile[i].still ? 0 : unterschied(a, teile[i].m), wort: w.wort };
        r.gemessen.push(g);
        // the sensitivity of the knob (D per travel) is what the next round starts from; a silent or far quieter candidate is no variant: 0
        r.gedaechtnis.vorwissen.set(schluesselVon(g), taugt(g, r.schwelle) || g.staerke < r.schwelle ? g.staerke / g.weg : 0);
        // the next try of this knob (wider when under the target, narrower when far over it); a too strong try is not accepted while a narrower one is due
        const n = teile[i].still || r.angenommen.some((x) => x.param === g.param) ? null : weiter(g, r.schwelle);
        const zuStark = n !== null && g.staerke > UEBERSCHUSS * r.schwelle * (1 + 1e-9);
        const wort = r.angenommen.length < 3 && !zuStark ? annehmbar(g, r.angenommen, r.schwelle) : null;
        if (wort !== null) r.angenommen.push({ ...g, wort });
        else if (n) naechste.push(n);
      });
      schlange.unshift(...naechste);
      geplant += naechste.length;
      this.setzePlaetze(r, r.angenommen);
      if (this.veraltet(r)) { r.zustand = 'veraltet'; return 'ende'; }
      if (r.angenommen.length >= 3) break;
    }
    this.setzePlaetze(r, auffuellen(r.gemessen, r.angenommen, r.schwelle, 3));
    if (r.gemessen.length && !r.gemessen.some((g) => taugt(g, ZIELE.fein))) r.hinweis = KEIN_KNOPF_TEXT;
    r.zustand = 'fertig';
    return 'ende';
  }

  // A and the given candidates as the places B to D; what is offered is not offered again on the same basis
  private setzePlaetze(r: Runde, liste: readonly Gemessen[]): void {
    const a = (r.a as Messung).m, fader = this.faderJetzt(r);
    r.gewaehlt = [...liste];
    r.plaetze = [platzA(a), ...liste.map((g, i) => {
      const p = r.tabelle.find((x) => x.name === g.param) as Parameter;
      r.gedaechtnis.nicht.add(schluesselVon(g));
      const platz = bauePlatz((['B', 'C', 'D'] as const)[i], g, { label: p.label, basisWert: r.basis[g.param], basis: a,
        anzeige: (n) => anzeigeWert(p, n) });
      return fader === null ? platz : { ...platz, ausgleich_db: ausgleichDb(platz.pegel_db, fader) };
    })];
  }

  // --- listen, pick, back, end -------------------------------------------------------------------------------------------------------------
  // The rows one side of the audition writes: the knobs that were held go back to the project value except the place's own knob, which gets the place's
  // value; the fader row carries the level match (project fader + gain), A and a place that needs no gain put the project fader back when it was moved.
  private zeilen(r: Runde, neu: Platz): { werte: Werte; fader: number | undefined; gain: number } {
    const werte: Werte = {};
    for (const k of r.ueber) if (k !== neu.param) werte[k] = r.basis[k];   // not stale, so the basis is what the project has
    if (neu.param && neu.wert !== null) werte[neu.param] = neu.wert;
    const f = this.faderJetzt(r), gain = f === null || !neu.param ? 0 : ausgleichDb(neu.pegel_db, f);
    const fader = f === null ? undefined : gain !== 0 ? Math.round(Math.min(6, f + gain) * 1e6) / 1e6 : r.faderUeber ? f : undefined;
    return { werte, fader, gain };
  }

  // --- COMPARE -----------------------------------------------------------------------------------------------------------------------------
  private async bricheAb(): Promise<void> {
    try { await this.a.takt?.abbruch(VERGLEICH_PLAN, 'andreas'); } catch (e) {
      this.a.log?.({ typ: 'proj_klang_vergleich_abbruch_fehler', fehler: (e as Error).message });
    }
  }
  // Ends COMPARE: the mark moves on (a part that answers later is stale), the scheduled plan is ended in the core first, then, with `zuruecksetzen`, the
  // knobs and the fader go back to the project values. PICK and BACK pass false: the project write follows and the reset happens at the next round start.
  // The abort is sent before anything else, and without COMPARE nothing is awaited before the reset is queued. Never throws.
  private beendeVergleich(r: Runde, zuruecksetzen: boolean): Promise<void> {
    const v = r.vergleich, war = v.an;
    v.marke++; v.an = false; v.platz = null; v.abBeat = null;
    this.stoppeTotmann();
    const danach = (): Promise<void> => (zuruecksetzen ? this.setzeZurueck(r) : Promise.resolve());
    return war ? this.bricheAb().then(danach) : danach();
  }
  // One part per bar: the side that does not sound is scheduled for the next bar line (never twice the same one), and when its receipt says it was
  // executed the other side follows at once. A part under an old mark only updates what is known to sound.
  private async vergleichLauf(r: Runde, marke: number): Promise<void> {
    const v = r.vergleich, t = this.a.takt as TaktZugang;
    const gilt = (): boolean => this.r === r && v.marke === marke;
    try {
      while (gilt()) {
        if (v.quelle === 'cypher' && this.a.kiGestoppt?.()) break;
        const ziel = t.zielBeat(), platz = r.plaetze.find((p) => p.platz === v.platz);
        if (ziel === null || !platz || this.veraltet(r)) break;
        const seite = r.aktiv === platz.platz ? r.plaetze[0] : platz, ab = Math.max(ziel, v.letztesAb + t.takt()), z = this.zeilen(r, seite);
        if (seite.param) r.ueber.add(seite.param);   // noted first: a part that fires after an abort is still taken off
        if (z.gain !== 0) r.faderUeber = true;
        v.abBeat = ab;
        const res = await t.teile(VERGLEICH_PLAN, v.quelle, ab, r.spurId, z.werte, z.fader);
        if (res.ausgefuehrt) {
          r.aktiv = seite.platz; r.ueber = new Set(seite.param ? [seite.param] : []); v.letztesAb = Math.max(v.letztesAb, ab);
          if (z.gain === 0 && z.fader !== undefined) r.faderUeber = false;
        }
        if (!gilt()) return;
        if (!res.ausgefuehrt) break;
      }
    } catch (e) { this.a.log?.({ typ: 'proj_klang_vergleich_fehler', fehler: (e as Error).message }); }
    if (gilt()) await this.beendeVergleich(r, true);
  }
  // Starts COMPARE on a place B to D, or moves it to another place; runs inside the write chain, so after every listen that was on its way.
  private async starteVergleich(r: Runde, neu: Platz, quelle: Quelle): Promise<RundeLage> {
    const v = r.vergleich;
    if (v.an) { v.marke++; await this.bricheAb(); }
    if (this.r !== r) fehl('runde_veraltet', 'the round ended while COMPARE was set up');
    v.an = true; v.platz = neu.platz; v.quelle = quelle; v.abBeat = null;
    const marke = ++v.marke;
    this.totmann();
    void this.vergleichLauf(r, marke);
    return this.baueLage(r);
  }

  /** Transport events from the core: COMPARE ends when the transport stops or a new core starts. */
  ereignis(adresse: string, f: Record<string, unknown>): void {
    const r = this.r;
    if (!r?.vergleich.an) return;
    if ((adresse === '/zustand/arr' && Number(f.status) !== 2) || adresse === '/e/neustart') void this.beendeVergleich(r, true);
  }

  /** Switches the playing instrument to a place (the project is not written). The knob of the place that played goes back to the project value.
   *  With `vergleich: true` (places B to D) the server alternates A and the place on every bar line instead; any other listen ends COMPARE. */
  async hoere(d: Record<string, unknown>): Promise<RundeLage> {
    this.lies(d, ['platz', 'runde', 'vergleich']);
    if (!istPlatz(d.platz)) fehl('argument_ungueltig', 'platz: A, B, C or D is required');
    if (d.vergleich !== undefined && typeof d.vergleich !== 'boolean') fehl('argument_ungueltig', 'vergleich: true or false is required');
    this.a.pruefeSchreiben?.();
    const r = this.aktuell(d);
    this.beruehre();
    this.frisch(r);
    const neu = r.plaetze.find((p) => p.platz === d.platz) ?? fehl('platz_leer', `place ${String(d.platz)} has no sound yet`);
    const quelle = this.quelle(), vergleich = d.vergleich === true && neu.param !== null;
    if (vergleich && (!this.a.takt || this.a.takt.zielBeat() === null)) {
      fehl('vergleich_steht', 'COMPARE needs a running transport and the clock of the core');
    }
    return this.inKette(async () => {
      // checked again when its turn comes: the round may have ended or measured anew while an earlier write was on its way
      if (this.r !== r || !r.plaetze.includes(neu)) fehl('runde_veraltet', 'the round ended while the sound was switched');
      this.frisch(r);
      if (vergleich) return this.starteVergleich(r, neu, quelle);
      if (r.vergleich.an) await this.beendeVergleich(r, false);   // abort only: the write below sets what sounds
      const h = this.a.zugang.hoereBk ?? fehl('kein_kernstand', 'there is no connection to the core that could switch the sound');
      const z = this.zeilen(r, neu);
      if (neu.param && neu.wert !== null) r.ueber.add(neu.param);   // noted first: a failed write is still taken off
      if (z.gain !== 0) r.faderUeber = true;
      if (Object.keys(z.werte).length || z.fader !== undefined) {
        await (z.fader === undefined ? h(r.spurId, z.werte, quelle) : h(r.spurId, z.werte, quelle, z.fader));
      }
      if (z.gain === 0 && z.fader !== undefined) r.faderUeber = false;
      r.ueber = new Set(neu.param ? [neu.param] : []);
      r.aktiv = neu.platz;
      return this.baueLage(r);
    });
  }

  /** The plan of a pick (place B to D): the knob and the new family tree as one command list for POST /proj/aendern. */
  async waehle(d: Record<string, unknown>): Promise<RundePlan> {
    this.lies(d, ['platz', 'runde']);
    if (!istPlatz(d.platz) || d.platz === 'A') fehl('argument_ungueltig', 'platz: B, C or D is required');
    const r = this.aktuell(d);
    this.beruehre();
    this.frisch(r);
    const i = r.plaetze.findIndex((p) => p.platz === d.platz);
    const platz = r.plaetze[i] ?? fehl('platz_leer', `place ${String(d.platz)} has no sound yet`);
    if (r.vergleich.an) await this.beendeVergleich(r, false);   // COMPARE ends with the abort only; no reset write before the project write
    const g = r.gewaehlt[i - 1], j = this.spurJetzt(r) as { projekt: Projekt; spur: Spur };
    const param = platz.param as string, wert = platz.wert as number;
    const baum = stammbaumNachWahl({ baum: j.spur.stammbaum ?? null, graph: r.graph, basis: r.basis, param, wert, text: platz.text });
    // the next round on the picked sound does not offer the way back
    r.gedaechtnis.umkehr = { basis: basisSchluessel({ ...r.basis, [param]: wert }), schluessel: schluesselVon({ param, richtung: g.richtung > 0 ? -1 : 1 }) };
    return { weg: 'proj', rev: j.projekt.rev, label: `Find sound: ${platz.text}`,
      befehle: [{ befehl: 'geraet_param_setzen', spur_id: r.spurId, param, wert }, { befehl: 'stammbaum_setzen', spur_id: r.spurId, stammbaum: baum }] };
  }

  /** The plan of going back (to `knoten`, default the parent of the active node; after a hand change the active node itself). */
  async zurueck(d: Record<string, unknown>): Promise<RundePlan> {
    this.lies(d, ['knoten', 'runde']);
    if (d.knoten !== undefined && (typeof d.knoten !== 'string' || !/^n[1-9][0-9]{0,5}$/.test(d.knoten))) {
      fehl('argument_ungueltig', 'knoten: a node id such as n2 is required');
    }
    const r = this.aktuell(d);
    this.beruehre();
    if (r.vergleich.an) await this.beendeVergleich(r, false);
    const j = this.spurJetzt(r) ?? fehl('runde_veraltet', 'the track of this round is gone or has another graph; start a new round');
    const baum = j.spur.stammbaum && j.spur.stammbaum.graph === r.graph ? j.spur.stammbaum : null;
    if (!baum) fehl('kein_stammbaum', 'this track has no family tree to go back in');
    if (d.knoten !== undefined && !baum.knoten.some((k) => k.id === d.knoten)) {
      fehl('argument_ungueltig', `knoten: ${String(d.knoten)} is not a node of the tree`);
    }
    const jetzt = this.werteVon(j.spur, r.tabelle);
    const z = stammbaumZurueck({ baum, ziel: (d.knoten as string | undefined) ?? zielZurueck(baum, jetzt), basis: jetzt })
      ?? fehl('kein_stammbaum', 'there is nowhere to go back to');
    const ziel = z.baum.knoten.find((k) => k.id === z.baum.aktiv);
    const knoepfe = Object.entries(z.werte).sort(([x], [y]) => knopfNr(x) - knopfNr(y))
      .map(([param, wert]) => ({ befehl: 'geraet_param_setzen', spur_id: r.spurId, param, wert }));
    return { weg: 'proj', rev: j.projekt.rev, label: `Find sound: back to ${ziel?.text ?? z.baum.aktiv}`,
      befehle: [...knoepfe, { befehl: 'stammbaum_setzen', spur_id: r.spurId, stammbaum: z.baum }] };
  }

  /** Ends the round: the place that plays is taken off, the round is dropped. Always answers. */
  async ende(): Promise<{ ok: true }> {
    const r = this.r;
    this.r = null;
    this.stoppeLeerlauf();
    if (r) await this.beendeVergleich(r, true);
    return { ok: true };
  }
}
