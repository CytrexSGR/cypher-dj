// ANALYZE window, slice 1 (POST /proj/analyse): request handling of the analysis. One call validates the request, answers from a small in-memory LRU
// or joins the identical run that is in flight, otherwise renders the strip(s) through Ausgabe.rendereStreifen (the lock, the transport rule, the render
// exactly as proj_lautheit has it), measures loudness with ffmpeg and analyses the WAVs in a worker thread (sound_factory.ts) at the same time, and
// assembles the answer of project/klang_vertrag.ts. The worker and the pure analysis module are loaded only when a run needs them.
import { Worker } from 'node:worker_threads';
import { AusgabeFehler, untermessgrenze, type Ausgabe } from './output.ts';
import { messeLautheit, type Lautheit } from '../../project/loudness.ts';
import {
  STILLE_DB, pruefeAntwort, quellenSchluessel,
  type AnalyseAntwort, type AnalyseQuelle, type Hinweis, type Lautheitswerte, type Messung, type Ueberdeckung,
} from '../../project/sound_contract.ts';
import type { Teilmessung } from '../../project/sound_measurement.ts';

export interface WerkErgebnis { quelle: Teilmessung; vergleich?: Teilmessung; ueberdeckung?: Ueberdeckung }
export interface KlangAnalyseOptionen {
  /** What measures the WAVs: `quelle` / `vergleich` is a file, or null for a strip that is silent (then it is analysed as silence); `vergleich` is absent
   *  without a comparison. `frames` is the common frame count of the entries (quelle, vergleich). Default: the worker sound_factory.ts. */
  analysiere?: (dateien: { quelle: string | null; vergleich?: string | null; frames: number[] }) => Promise<WerkErgebnis>;
  /** The objective hints (hinweiseQuelle, hinweiseUeberdeckung). Default: loaded from project/sound_measurement.ts at the first run. */
  hinweise?: { quelle: (m: Messung) => Hinweis[]; ueberdeckung: (q: Messung, v: Messung, u: Ueberdeckung) => Hinweis[] };
  /** Module of the pure analysis , loaded lazily by the default hints and by the default worker. Default: '../../project/sound_measurement.ts'. */
  messungModul?: string;
  ffmpeg?: string[];
  lruGroesse?: number;
}

/** The default measuring: one worker per run. A failing worker rejects with its message. */
export const MESSUNG_MODUL = '../../project/sound_measurement.ts';
export function analysiereImWerk(dateien: { quelle: string | null; vergleich?: string | null; frames: number[] },
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

function messung(q: AnalyseQuelle, name: string, t: Teilmessung, l: Lautheit | null, uebersprungen: boolean): Messung {
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
  return { quelle: q, name, stumm, lautheit, stereo: t.stereo, spektrum: t.spektrum, zeitbild: t.zeitbild };
}

export class KlangAnalyse {
  private readonly lru = new Map<string, AnalyseAntwort>();
  private readonly imFlug = new Map<string, { rev: number; lauf: Promise<AnalyseAntwort> }>();
  private hinweisFn: KlangAnalyseOptionen['hinweise'];

  private readonly a: Ausgabe;
  private readonly o: KlangAnalyseOptionen;
  constructor(a: Ausgabe, o: KlangAnalyseOptionen = {}) { this.a = a; this.o = o; this.hinweisFn = o.hinweise; }

  private schluessel(slug: string, rev: number, q: AnalyseQuelle, v: AnalyseQuelle | undefined, von: number, bis: number): string {
    return [slug, rev, quellenSchluessel(q), quellenSchluessel(v), von, bis].join('|');
  }

  async analysiere(d: Record<string, unknown>): Promise<AnalyseAntwort> {
    const pre = this.a.analyseVorpruefung(d);
    const q = d.quelle as AnalyseQuelle, v = (d.vergleich ?? undefined) as AnalyseQuelle | undefined;
    const schl = this.schluessel(pre.slug, pre.rev, q, v, pre.von, pre.bis);
    const treffer = this.lru.get(schl);
    if (treffer) { this.lru.delete(schl); this.lru.set(schl, treffer); return treffer; }
    // An identical request that comes while the run is in flight waits for it, but only takes its answer when that answer is for the rev it saw itself:
    // the rev the run started with (nothing changed since), or the rev the answer carries (the run froze a Surge track and so raised it). A project that
    // changed meanwhile is measured again.
    const flug = this.schluessel(pre.slug, 0, q, v, pre.von, pre.bis);
    const im = this.imFlug.get(flug);
    if (im) {
      const a = await im.lauf;
      if (pre.rev === im.rev || pre.rev === a.rev) return a;
      return this.analysiere(d);
    }
    const lauf = this.messe(q, v, pre.von, pre.bis, d.ohne_freeze === true).finally(() => { this.imFlug.delete(flug); });
    this.imFlug.set(flug, { rev: pre.rev, lauf });
    return lauf;
  }

  private async messe(q: AnalyseQuelle, v: AnalyseQuelle | undefined, von: number, bis: number, ohneFreeze: boolean): Promise<AnalyseAntwort> {
    const t0 = Date.now();
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
      const aus: AnalyseAntwort = { rev: r.rev, von_beat: von, bis_beat: bis, dauer_s: (bis - von) * 60 / r.tempo_bpm, tempo_bpm: r.tempo_bpm, quelle: mq,
        ...(mv ? { vergleich: mv } : {}), ...(u ? { ueberdeckung: u } : {}), hinweise };
      const fehler = pruefeAntwort(aus);
      if (fehler.length) throw new AusgabeFehler('render_fehler', `the analysis answer is malformed: ${fehler.slice(0, 3).join('; ')}`);
      return aus;
    });
    this.merke(this.schluessel(slug, antwort.rev, q, v, von, bis), antwort);
    this.a.protokolliere({ typ: 'proj_analyse', slug, von_beat: von, bis_beat: bis, quelle: quellenSchluessel(q), vergleich: quellenSchluessel(v),
      ms: Date.now() - t0 });
    return antwort;
  }

  private async ladeHinweise(): Promise<NonNullable<KlangAnalyseOptionen['hinweise']>> {
    const m = await import(this.o.messungModul ?? MESSUNG_MODUL);
    return { quelle: m.hinweiseQuelle, ueberdeckung: m.hinweiseUeberdeckung };
  }

  private merke(schl: string, antwort: AnalyseAntwort): void {
    this.lru.delete(schl);
    this.lru.set(schl, antwort);
    const max = this.o.lruGroesse ?? 8;
    while (this.lru.size > max) this.lru.delete(this.lru.keys().next().value as string);
  }
}
