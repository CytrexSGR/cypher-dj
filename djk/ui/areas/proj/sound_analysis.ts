// ANALYZE window, slice 1 (POST /proj/analyse): request handling of the analysis. One call validates the request, answers from a small in-memory LRU
// or joins the identical run that is in flight, otherwise renders the strip(s) through Ausgabe.rendereStreifen (the lock, the transport rule, the render
// exactly as proj_lautheit has it), measures loudness with ffmpeg and analyses the WAVs in a worker thread (sound_factory.ts) at the same time, and
// assembles the answer of project/klang_vertrag.ts. The worker and the pure analysis module are loaded only when a run needs them.
import { Worker } from 'node:worker_threads';
import { AusgabeFehler, untermessgrenze, type Ausgabe } from './output.ts';
import { messeLautheit, type Lautheit } from '../../project/loudness.ts';
import {
  STILLE_DB, istRefQuelle, pruefeAntwort, quellenSchluessel,
  type Abgleich, type AnalyseAntwort, type AnalyseQuelle, type Hinweis, type Lautheitswerte, type Messung, type RefMessung, type RefQuelle, type Ueberdeckung,
} from '../../project/sound_contract.ts';
import type { Teilmessung, MaskierungPaar, MaskierungTeil, ResonanzBand, ResonanzBefehl, ResonanzStrang } from '../../project/sound_measurement.ts';
import { MAX_INSERTS_PRO_STRANG } from '../../project/model.ts';
import { abgleich } from '../../public/sound_match.js';

export interface WerkAuftrag { quelle: string | null; vergleich?: string | null; frames: number[]; versatz?: number[] }
export interface WerkErgebnis { quelle: Teilmessung; vergleich?: Teilmessung; ueberdeckung?: Ueberdeckung }
export interface KlangAnalyseOptionen {
  /** What measures the WAVs: `quelle` / `vergleich` is a file, or null for a strip that is silent (then it is analysed as silence); `vergleich` is absent
   *  without a comparison. `frames` is the common frame count of the entries (quelle, vergleich); `versatz` the frames to skip per entry (slice 2,
   *  references only). Default: the worker sound_factory.ts. */
  analysiere?: (dateien: WerkAuftrag) => Promise<WerkErgebnis>;
  /** The objective hints (hinweiseQuelle, hinweiseUeberdeckung). Default: loaded from project/sound_measurement.ts at the first run. */
  hinweise?: { quelle: (m: Messung) => Hinweis[]; ueberdeckung: (q: Messung, v: Messung, u: Ueberdeckung) => Hinweis[];
    /** Strand 5 slice 5: resonanzVorschlag and resonanzBefehle (without them the answer carries no `vorschlaege`). */
    resonanz?: (m: Messung) => ResonanzBand[]; befehle?: (b: ResonanzBand[], s: ResonanzStrang) => ResonanzBefehl[] | null };
  /** Module of the pure analysis , loaded lazily by the default hints and by the default worker. Default: '../../project/sound_measurement.ts'. */
  messungModul?: string;
  ffmpeg?: string[];
  lruGroesse?: number;
  /** Strand 5 slice 6: measures several rendered files one after the other (null = a silent strip). Default: one worker per file. */
  analysiereViele?: (dateien: (string | null)[], frames: number) => Promise<Teilmessung[]>;
  /** The masking function (default: loaded from project/sound_measurement.ts at the first run). */
  maskierung?: (teile: MaskierungTeil[], max?: number) => MaskierungPaar[];
  /** Slice 2: measures a reference given as `vergleich` (KlangReferenz.messe). `dauer_s` is the length of the analysed range. */
  referenz?: { messe: (q: RefQuelle, dauer_s?: number) => Promise<RefMessung>; stempel?: (q: RefQuelle) => string };
}

/** The default measuring: one worker per run. A failing worker rejects with its message. */
export const MESSUNG_MODUL = '../../project/sound_measurement.ts';
export function analysiereImWerk(dateien: WerkAuftrag,
  messungModul = MESSUNG_MODUL): Promise<WerkErgebnis> {
  return new Promise((ok, nein) => {
    let fertig = false;
    const w = new Worker(new URL('./sound_factory.ts', import.meta.url), { workerData: { ...dateien, modul: new URL(messungModul, import.meta.url).href } });
    const ende = (f: () => void): void => { if (fertig) return; fertig = true; f(); void w.terminate(); };
    w.once('message', (m: WerkErgebnis) => ende(() => ok(m)));
    w.once('error', (e) => ende(() => nein(e)));
    w.once('exit', (c) => ende(() => nein(new Error(`the analysis worker ended with code ${c} without an answer`))));
  });
}

const NULLEN: Lautheitswerte = { lufs_i: null, lufs_s_max: null, lufs_m_max: null, lra: null, true_peak_dbtp: null, spitze_db: null, rms_db: null,
  crest_db: null };

/** The loudness block of a measurement from the analysis `t` and the ffmpeg result `l` (also used for references, sound_reference.ts). */
export function lautheitswerte(t: Teilmessung, l: Lautheit | null, uebersprungen = false): Lautheitswerte {
  const stumm = uebersprungen || t.stumm;
  const lautheit: Lautheitswerte = stumm || !l ? { ...NULLEN } : {
    lufs_i: l.lufs_i, lufs_s_max: l.lufs_s_max ?? null, lufs_m_max: l.lufs_m_max ?? null, lra: l.lra, true_peak_dbtp: l.true_peak_dbtp,
    spitze_db: t.spitze_db, rms_db: t.rms_db, crest_db: t.crest_db,
  };
  // a source that is quiet but not silent: below the gate of ffmpeg there is no loudness (as proj_lautheit: null, not -70), the true peak stays
  if (!stumm && l && l.lufs_i !== null) {
    const u = untermessgrenze(l);
    if (u.unter) { lautheit.lufs_i = null; lautheit.lra = null; lautheit.lufs_s_max = null; lautheit.lufs_m_max = null; }
  }
  if (!stumm && !l) { lautheit.spitze_db = t.spitze_db; lautheit.rms_db = t.rms_db; lautheit.crest_db = t.crest_db; }
  return lautheit;
}

function messung(q: AnalyseQuelle, name: string, t: Teilmessung, l: Lautheit | null, uebersprungen: boolean): Messung {
  const stumm = uebersprungen || t.stumm;
  return { quelle: q, name, stumm, lautheit: lautheitswerte(t, l, uebersprungen), stereo: t.stereo, spektrum: t.spektrum, zeitbild: t.zeitbild };
}

export const MASKIERUNG_MAX = 24;
export interface MaskierungAntwort {
  rev: number; von_beat: number; bis_beat: number; tempo_bpm: number;
  /** How many strips were analysed; `begrenzt`: more strips sounded, only the 24 loudest were analysed. */
  anzahl: number; begrenzt: boolean; maskierung: MaskierungPaar[];
}
/** The default measuring of several files: the worker of one strip, one file after the other (memory stays at one analysis). */
export async function analysiereVieleImWerk(dateien: (string | null)[], frames: number, messungModul = MESSUNG_MODUL): Promise<Teilmessung[]> {
  const aus: Teilmessung[] = [];
  for (const d of dateien) aus.push((await analysiereImWerk({ quelle: d, frames: [frames] }, messungModul)).quelle);
  return aus;
}

export class KlangAnalyse {
  private readonly lru = new Map<string, AnalyseAntwort>();
  private readonly imFlug = new Map<string, { rev: number; lauf: Promise<AnalyseAntwort> }>();
  private hinweisFn: KlangAnalyseOptionen['hinweise'];

  private readonly a: Ausgabe;
  private readonly o: KlangAnalyseOptionen;
  constructor(a: Ausgabe, o: KlangAnalyseOptionen = {}) { this.a = a; this.o = o; this.hinweisFn = o.hinweise; }

  // `stempel`: the state of a reference file (KlangReferenz.stempel), empty for a strip
  private schluessel(slug: string, rev: number, q: AnalyseQuelle, v: AnalyseQuelle | RefQuelle | undefined, von: number, bis: number,
    stempel = ''): string {
    return [slug, rev, quellenSchluessel(q), quellenSchluessel(v), von, bis, stempel].join('|');
  }

  async analysiere(d: Record<string, unknown>): Promise<AnalyseAntwort> {
    if (d.alle_paare !== undefined) return this.maskierung(d) as unknown as Promise<AnalyseAntwort>;
    const pre = this.a.analyseVorpruefung(d);
    const q = d.quelle as AnalyseQuelle, v = (d.vergleich ?? undefined) as AnalyseQuelle | RefQuelle | undefined;
    // a reference is part of the key as the file is now: a replaced file or a removed reference is never answered from the cache (it refuses here)
    const stempel = istRefQuelle(v) ? this.o.referenz?.stempel?.(v) ?? '' : '';
    const schl = this.schluessel(pre.slug, pre.rev, q, v, pre.von, pre.bis, stempel);
    const treffer = this.lru.get(schl);
    if (treffer) { this.lru.delete(schl); this.lru.set(schl, treffer); return treffer; }
    // An identical request that comes while the run is in flight waits for it, but only takes its answer when that answer is for the rev it saw itself:
    // the rev the run started with (nothing changed since), or the rev the answer carries (the run froze a Surge track and so raised it). A project that
    // changed meanwhile is measured again.
    // the mode is part of the key: the window (ohne_freeze) refuses where the tool freezes, so one must not take over the other's refusal (Audit U08)
    const flug = this.schluessel(pre.slug, 0, q, v, pre.von, pre.bis, stempel) + (d.ohne_freeze === true ? '|ohne_freeze' : '');
    const im = this.imFlug.get(flug);
    if (im) {
      const a = await im.lauf;
      if (pre.rev === im.rev || pre.rev === a.rev) return a;
      return this.analysiere(d);
    }
    const lauf = this.messe(q, v, pre.von, pre.bis, d.ohne_freeze === true, pre.tempo_bpm, stempel).finally(() => { this.imFlug.delete(flug); });
    this.imFlug.set(flug, { rev: pre.rev, lauf });
    return lauf;
  }

  private async messe(q: AnalyseQuelle, vAlle: AnalyseQuelle | RefQuelle | undefined, von: number, bis: number, ohneFreeze: boolean,
    tempo: number, stempel = ''): Promise<AnalyseAntwort> {
    const t0 = Date.now();
    // a reference as the comparison is measured first (an unknown file fails before anything is rendered); only the strip is rendered
    const ref = vAlle && istRefQuelle(vAlle) ? vAlle : undefined;
    const v = vAlle && !ref ? vAlle as AnalyseQuelle : undefined;
    let refMessung: RefMessung | undefined;
    if (ref) {
      if (!this.o.referenz) throw new AusgabeFehler('argument_ungueltig', 'vergleich: references are not available here');
      // the window of the reference is as long as the analysed range, but never under 8 s (a one-bar loop would compare against too short a piece)
      refMessung = await this.o.referenz.messe(ref, Math.min(900, Math.max(8, (bis - von) * 60 / tempo)));
    }
    let slug = '';   // the slug of the project that was rendered
    const antwort = await this.a.rendereStreifen(v ? [q, v] : [q], von, bis, ohneFreeze, async (r) => {
      slug = r.slug;
      // a part is measured when it was rendered and is not silent; the others are analysed as silence on the frame count of the rendered ones
      const klingt = (t: typeof r.teile[number]): t is Extract<typeof t, { datei: string }> => 'datei' in t && t.spitze_db > STILLE_DB;
      const framesVon = r.teile.filter((t): t is Extract<typeof t, { datei: string }> => 'datei' in t).map((t) => t.frames);
      const erwartet = Math.max(1, Math.round((bis - von) * 60 / r.tempo_bpm * 48000));
      const frames = framesVon.length ? Math.min(...framesVon) : erwartet;
      const datei = (i: number): string | null => { const t = r.teile[i]; return klingt(t) ? t.datei : null; };
      // the loudness run is checked at once: a failing ffmpeg is an error with its reason, never a silent null
      const lautheiten = await Promise.all(r.teile.map((t) => (klingt(t) ? messeLautheit(t.datei, this.o.ffmpeg, 120_000,
        { maxima: true }) : Promise.resolve(null))));
      for (const l of lautheiten) if (l?.loudness_fehler) throw new AusgabeFehler('render_fehler', `the loudness measurement failed: ${l.loudness_fehler}`);
      let werk: WerkErgebnis;
      try {
        werk = await (this.o.analysiere ?? ((x) => analysiereImWerk(x, this.o.messungModul)))({ quelle: datei(0),
          ...(v ? { vergleich: datei(1) } : {}), frames: v ? [frames, frames] : [frames] });
      } catch (e) {
        if (e instanceof AusgabeFehler) throw e;
        throw new AusgabeFehler('render_fehler', 'the analysis failed', (e as Error)?.message ?? String(e));
      }
      const mq = messung(q, r.teile[0].name, werk.quelle, lautheiten[0], !klingt(r.teile[0]));
      const mv = v && werk.vergleich ? messung(v, r.teile[1].name, werk.vergleich, lautheiten[1], !klingt(r.teile[1])) : undefined;
      // no masking and no hints for a silent side
      const u = mv && !mq.stumm && !mv.stumm ? werk.ueberdeckung : undefined;
      const hf = this.hinweisFn ?? (this.hinweisFn = await this.ladeHinweise());
      const hinweise: Hinweis[] = [...hf.quelle(mq), ...(mv ? hf.quelle(mv) : []), ...(mv && u ? hf.ueberdeckung(mq, mv, u) : [])];
      // a reference: the level-matched difference of the spectra, no masking and only the hints of the source
      const ag: Abgleich | undefined = refMessung && !mq.stumm && !refMessung.stumm ?
        abgleich(mq.spektrum.mittel_db, refMessung.spektrum.mittel_db) as Abgleich : undefined;
      const aus: AnalyseAntwort = { rev: r.rev, von_beat: von, bis_beat: bis, dauer_s: (bis - von) * 60 / r.tempo_bpm, tempo_bpm: r.tempo_bpm, quelle: mq,
        ...(mv ? { vergleich: mv } : {}), ...(refMessung ? { vergleich: refMessung } : {}), ...(u ? { ueberdeckung: u } : {}), ...(ag ? { abgleich: ag } : {}),
        hinweise };
      // strand 5 slice 5: the resonances of the source as dynamic EQ bands, with the ready command list for proj_aendern (one undo step)
      if (!mq.stumm && hf.resonanz && hf.befehle) {
        const baender = hf.resonanz(mq);
        if (baender.length) {
          // a test double of Ausgabe may lack the method: then the bands come without a target strip
          const ziel = typeof this.a.resonanzZiel === 'function' ? this.a.resonanzZiel(q, baender.length) : null;
          aus.vorschlaege = { resonanz: { baender, strang_id: ziel?.id ?? null, befehle: ziel ? hf.befehle(baender, ziel) : null } };
        }
      }
      const fehler = pruefeAntwort(aus);
      if (fehler.length) throw new AusgabeFehler('render_fehler', `the analysis answer is malformed: ${fehler.slice(0, 3).join('; ')}`);
      return aus;
    });
    this.merke(this.schluessel(slug, antwort.rev, q, vAlle, von, bis, stempel), antwort);
    this.a.protokolliere({ typ: 'proj_analyse', slug, von_beat: von, bis_beat: bis, quelle: quellenSchluessel(q), vergleich: quellenSchluessel(vAlle),
      ms: Date.now() - t0 });
    return antwort;
  }

  /** Strand 5 slice 6: `{alle_paare: true, von_beat?, bis_beat?, ohne_freeze?}` renders every sounding track of the range once, measures each (the 24
   *  with the highest peak at most) and answers the five worst masking conflicts over all pairs, each with a proposed EQ move on the quieter strip.
   *  Nothing is changed in the project: the proposal is a list of commands for `proj_aendern`. */
  async maskierung(d: Record<string, unknown>): Promise<MaskierungAntwort> {
    for (const k of Object.keys(d)) if (!['alle_paare', 'von_beat', 'bis_beat', 'ohne_freeze'].includes(k)) {
      throw new AusgabeFehler('argument_ungueltig', `unknown field ${k}`);
    }
    if (d.alle_paare !== true) throw new AusgabeFehler('argument_ungueltig', 'alle_paare: true is required');
    if (d.ohne_freeze !== undefined && typeof d.ohne_freeze !== 'boolean')
      throw new AusgabeFehler('argument_ungueltig', 'ohne_freeze: true or false is required');
    // the range and the open project are checked as for a strip (the master stands in for a source)
    const pre = this.a.analyseVorpruefung({ quelle: { art: 'master' }, von_beat: d.von_beat, bis_beat: d.bis_beat });
    const spuren = this.a.klingendeSpuren(pre.von, pre.bis);
    if (spuren.length < 2) return { rev: pre.rev, von_beat: pre.von, bis_beat: pre.bis, tempo_bpm: pre.tempo_bpm, anzahl: spuren.length,
      begrenzt: false, maskierung: [] };
    const t0 = Date.now();
    const quellen: AnalyseQuelle[] = spuren.map((s) => ({ art: 'spur', id: s.id }));
    const antwort = await this.a.rendereStreifen(quellen, pre.von, pre.bis, d.ohne_freeze === true, async (r) => {
      const klingt = r.teile.map((t, i) => ({ t, s: spuren[i] })).filter((x): x is { t: Extract<typeof x.t, { datei: string }>; s: typeof x.s } =>
        'datei' in x.t && x.t.spitze_db > STILLE_DB);
      if (klingt.length < 2) return { rev: r.rev, von_beat: pre.von, bis_beat: pre.bis, tempo_bpm: r.tempo_bpm, anzahl: klingt.length, begrenzt: false,
        maskierung: [] as MaskierungPaar[] };
      // the loudest 24 by sample peak are analysed (the render is the cost; the analysis of a strip is a second or two)
      const begrenzt = klingt.length > MASKIERUNG_MAX;
      const gewaehlt = [...klingt].sort((x, y) => y.t.spitze_db - x.t.spitze_db).slice(0, MASKIERUNG_MAX);
      const frames = Math.min(...gewaehlt.map((x) => x.t.frames));
      let ms: Teilmessung[];
      try {
        ms = await (this.o.analysiereViele ?? ((f, n) => analysiereVieleImWerk(f, n, this.o.messungModul)))(gewaehlt.map((x) => x.t.datei), frames);
      } catch (e) {
        if (e instanceof AusgabeFehler) throw e;
        throw new AusgabeFehler('render_fehler', 'the analysis failed', (e as Error)?.message ?? String(e));
      }
      const teile: MaskierungTeil[] = gewaehlt.map((x, i) => ({ id: x.s.id, name: x.t.name, m: ms[i], pegel_db: ms[i].rms_db,
        pos: x.s.kette >= MAX_INSERTS_PRO_STRANG ? null : 0 }));
      const fn = this.o.maskierung ?? (await import(this.o.messungModul ?? MESSUNG_MODUL)).maskierungPaare;
      return { rev: r.rev, von_beat: pre.von, bis_beat: pre.bis, tempo_bpm: r.tempo_bpm, anzahl: gewaehlt.length,
        begrenzt, maskierung: fn(teile, 5) as MaskierungPaar[] };
    });
    this.a.protokolliere({ typ: 'proj_analyse', alle_paare: true, von_beat: pre.von, bis_beat: pre.bis, anzahl: antwort.anzahl, ms: Date.now() - t0 });
    return antwort;
  }

  private async ladeHinweise(): Promise<NonNullable<KlangAnalyseOptionen['hinweise']>> {
    const m = await import(this.o.messungModul ?? MESSUNG_MODUL);
    return { quelle: m.hinweiseQuelle, ueberdeckung: m.hinweiseUeberdeckung, resonanz: m.resonanzVorschlag, befehle: m.resonanzBefehle };
  }

  private merke(schl: string, antwort: AnalyseAntwort): void {
    this.lru.delete(schl);
    this.lru.set(schl, antwort);
    const max = this.o.lruGroesse ?? 8;
    while (this.lru.size > max) this.lru.delete(this.lru.keys().next().value as string);
  }
}
