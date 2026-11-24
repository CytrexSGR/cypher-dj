// Preset preview, render service (browser plan 6, B14): a preset becomes a throwaway project (an instrument: one track and a two-bar clip of a
// starter phrase; an effect: one audio track with a starter loop as a clip and the effect as an insert; the preset applied through the same plan the PRESETS page uses), rendered offline by rendereProjektDatei (nice 19) and cached as
// <cache>/<key>.wav plus a sidecar <key>.json. Renders run one at a time with at most one waiting behind them: a newer request replaces the
// waiting one (it is refused 409 ueberholt), a request for a key that is already rendering or waiting joins it. Every render is capped (limitMs)
// and killed beyond it. The finished WAV is normalised to a common loudness (RMS -18 dBFS, peak at most -1 dBFS; the gain is in the sidecar).
// The key comes from prelisten_source.ts (sound, graph file, phrase, loops.json, renderer build, version). Nothing outside the cache folder is written.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { findeGraph, graphHash } from '../graphs.ts';
import { renderProgramm } from '../paths.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { deckle } from '../project/cache_deckel.ts';
import { neuesProjekt, type Projekt } from '../project/model.ts';
import { rendereProjektDatei, RenderDateiFehler } from '../project/render_file.ts';
import { planeAnwendung } from './apply.ts';
import { PresetFehler, PRESET_ID } from './model.ts';
import { effektEingang, phraseFuer, rolleVon, transponiereFuer, vorhoerSchluessel, type LoopsDatei, type Rolle } from './prelisten_source.ts';
import type { PresetSpeicher } from './store.ts';
import type { Herkunft } from './model.ts';

export const PRESET_VORHOER_DECKEL = 200 * 1024 ** 2;
const SPUR_NAME = 'preview';
const BEATS = 8;

export type VorhoerGrund = 'preset_unbekannt' | 'preset_unlesbar' | 'vorhoeren_nicht_moeglich' | 'graph_fehlt' | 'vorhoeren_stumm' | 'starter_fehlt' | 'ueberholt' | 'render_fehlt' | 'render_fehlgeschlagen';
export class PresetVorhoerFehler extends Error {
  readonly code: 404 | 409 | 422 | 503; readonly grund: VorhoerGrund; readonly text: string;
  constructor(code: PresetVorhoerFehler['code'], grund: VorhoerGrund, text: string) { super(grund); this.code = code; this.grund = grund; this.text = text; }
}

export interface VorhoerErgebnis { schluessel: string; datei: string; aus_cache: boolean; dauer_s: number; spitze_db: number; rms_db: number; render_ms: number }
export interface VorhoererOptionen {
  speicher: PresetSpeicher; cacheOrdner: string; loopsDatei: string; starterWavOrdner: string; graphenOrdner: string; kitOrdner: string;
  render?: typeof rendereProjektDatei; deckel?: number; limitMs?: number; rendererVersion?: () => string; log?: (z: Record<string, unknown>) => void;
}
interface Seite { schluessel?: string; gain_db?: number; id: string; rolle: string; loop: string; dauer_s: number; spitze_db: number; rms_db: number; render_ms: number; erzeugt: string }

const STUMM_DB = -70;
export const ZIEL_RMS_DB = -18, SPITZE_MAX_DB = -1, GAIN_MAX_DB = 30;
const LIMIT_MS = 20_000;
const EFFEKT_GERAETE = ['eq', 'komp', 'saett'];
const STARTER_FEHLT = 'the starter loops are not installed yet; run djk-starter once';
interface Plan { id: string; schluessel: string; preset: ReturnType<PresetSpeicher['lies']>; rolle: Rolle | null; loops: LoopsDatei; loop: string; herkunft: Herkunft }
export interface StarterWav { daten: Buffer; frames: number }

// A starter loop WAV as djk-starter writes it: 32-bit float, stereo, 48 kHz. Anything else (or a truncated file) is null.
export function leseStarterWav(datei: string): StarterWav | null {
  let b: Buffer;
  try { b = fs.readFileSync(datei); } catch { return null; }
  if (b.length < 12 || b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WAVE') return null;
  let fmtOk = false;
  for (let o = 12; o + 8 <= b.length;) {
    const id = b.toString('latin1', o, o + 4), n = b.readUInt32LE(o + 4), k = o + 8;
    if (id === 'fmt ' && k + 16 <= b.length) {
      const tag = b.readUInt16LE(k);
      fmtOk = (tag === 3 || tag === 0xfffe) && b.readUInt16LE(k + 2) === 2 && b.readUInt32LE(k + 4) === 48000 && b.readUInt16LE(k + 14) === 32;
    } else if (id === 'data') {
      if (!fmtOk || k + n > b.length || n < 8) return null;
      const daten = b.subarray(k, k + n - (n % 8));
      return { daten, frames: daten.length / 8 };
    }
    o = k + n + (n % 2);
  }
  return null;
}

// 32-bit float WAV: the chunk layout read from the head of the file, null when it is anything else or the data chunk reaches past the end
function wavDaten(b: Buffer, gesamt: number): { daten: number; n: number; kanaele: number } | null {
  if (b.length < 12 || b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WAVE') return null;
  let ok = false, kanaele = 1;
  for (let o = 12; o + 8 <= b.length;) {
    const id = b.toString('latin1', o, o + 4), n = b.readUInt32LE(o + 4), k = o + 8;
    if (id === 'fmt ' && k + 16 <= b.length) { ok = b.readUInt16LE(k) === 3 && b.readUInt16LE(k + 14) === 32; kanaele = Math.max(1, b.readUInt16LE(k + 2)); }
    else if (id === 'data') return ok && n >= 8 && k + n <= gesamt ? { daten: k, n, kanaele } : null;
    o = k + n + (n % 2);
  }
  return null;
}
// An intact cached WAV: a float WAV whose data chunk lies fully inside the file and matches the length in the sidecar (to the frame, 100 frames of rounding),
// has no NaN or infinite sample, and is not all zero when the sidecar says it was audible.
function wavHeil(datei: string, dauerS: number, hoerbar: boolean): boolean {
  try {
    const b = fs.readFileSync(datei);
    const w = wavDaten(b, b.length);
    if (!w) return false;
    if (Math.abs(w.n / (4 * w.kanaele) - dauerS * 48000) > 100) return false;
    let summe = 0;
    for (let i = 0, n = Math.floor(w.n / 4); i < n; i++) { const x = b.readFloatLE(w.daten + i * 4); if (!Number.isFinite(x)) return false; summe += Math.abs(x); }
    return !hoerbar || summe > 0;
  } catch { return false; }
}

/** Scales the 32-bit float WAV in place to RMS ZIEL_RMS_DB with the peak at most SPITZE_MAX_DB (gain capped at GAIN_MAX_DB). null when it is not such a file. */
export function normalisiere(datei: string): { gain_db: number; rms_db: number; spitze_db: number } | null {
  let b: Buffer;
  try { b = fs.readFileSync(datei); } catch { return null; }
  const w = wavDaten(b, b.length);
  if (!w) return null;
  const n = Math.floor(w.n / 4);
  let s = 0, spitze = 0;
  for (let i = 0; i < n; i++) { const x = b.readFloatLE(w.daten + i * 4); s += x * x; const a = Math.abs(x); if (a > spitze) spitze = a; }
  if (!(s > 0)) return null;
  const rms = 20 * Math.log10(Math.sqrt(s / n)), pk = 20 * Math.log10(spitze);
  const gain = Math.min(GAIN_MAX_DB, ZIEL_RMS_DB - rms, SPITZE_MAX_DB - pk);
  const f = 10 ** (gain / 20);
  for (let i = 0; i < n; i++) b.writeFloatLE(b.readFloatLE(w.daten + i * 4) * f, w.daten + i * 4);
  fs.writeFileSync(datei, b);
  const r2 = (x: number): number => Math.round(x * 100) / 100;
  return { gain_db: r2(gain), rms_db: r2(rms + gain), spitze_db: r2(pk + gain) };
}
const SCHLUESSEL_WAV = /^[0-9a-f]{64}\.wav$/;

export class PresetVorhoerer {
  private readonly o: VorhoererOptionen;
  private readonly render: typeof rendereProjektDatei;
  private readonly imFlug = new Map<string, Promise<VorhoerErgebnis>>();
  private laeuft = false;
  private wartend: { plan: Plan; ok: (r: VorhoerErgebnis) => void; nein: (e: unknown) => void } | null = null;
  private loopsStand: { mtime: number; size: number; loops: LoopsDatei; hash: string } | null = null;

  constructor(o: VorhoererOptionen) {
    this.o = o; this.render = o.render ?? rendereProjektDatei;
    try { fs.rmSync(path.join(o.cacheOrdner, 'arbeit'), { recursive: true, force: true }); } catch { /* work folders of an earlier run: best effort */ }
  }

  private log(z: Record<string, unknown>): void { try { this.o.log?.(z); } catch { /* a logger never breaks a preview */ } }
  private datei(key: string): string { return path.join(this.o.cacheOrdner, `${key}.wav`); }
  private seite(key: string): string { return path.join(this.o.cacheOrdner, `${key}.json`); }

  /** Throws the refusal a preview of this preset would get before any render (unknown, damaged, hall, graph or starter missing); changes nothing. */
  pruefe(id: string): void { this.plane(id); }

  async vorhoer(id: string): Promise<VorhoerErgebnis> {
    const plan = this.plane(id);
    const hit = this.ausCache(plan.schluessel);
    if (hit) return hit;
    const key = plan.schluessel;
    const laeuft = this.imFlug.get(key);
    if (laeuft) return laeuft;
    const p = new Promise<VorhoerErgebnis>((ok, nein) => {
      const e = { plan, ok, nein };
      if (!this.laeuft) return this.fahre(e);
      // one running and one waiting: the newest click takes the waiting place, the one it replaces is refused
      const alt = this.wartend;
      if (alt) { this.imFlug.delete(alt.plan.schluessel); alt.nein(new PresetVorhoerFehler(409, 'ueberholt', 'a newer preview replaced this one')); }
      this.wartend = e;
    });
    this.imFlug.set(key, p);
    const weg = (): void => { if (this.imFlug.get(key) === p) this.imFlug.delete(key); };
    p.then(weg, weg);
    return p;
  }

  private fahre(e: { plan: Plan; ok: (r: VorhoerErgebnis) => void; nein: (e: unknown) => void }): void {
    this.laeuft = true;
    this.rendere(e.plan).then(e.ok, e.nein).finally(() => {
      this.laeuft = false;
      const n = this.wartend; this.wartend = null;
      if (n) this.fahre(n);
    });
  }

  private rendererVersion(): string {
    if (this.o.rendererVersion) return this.o.rendererVersion();
    try { const st = fs.statSync(renderProgramm()); return `${st.size}-${Math.floor(st.mtimeMs)}`; } catch { return 'none'; }
  }

  // loops.json parsed once per file state (mtime and size), with its content hash
  private leseLoops(): { loops: LoopsDatei; hash: string } {
    const st = fs.statSync(this.o.loopsDatei);
    const c = this.loopsStand;
    if (c && c.mtime === st.mtimeMs && c.size === st.size) return c;
    const text = fs.readFileSync(this.o.loopsDatei, 'utf8');
    this.loopsStand = { mtime: st.mtimeMs, size: st.size, loops: JSON.parse(text) as LoopsDatei, hash: crypto.createHash('sha256').update(text).digest('hex') };
    return this.loopsStand;
  }

  // content hash of the starter WAV an effect preview plays through (a re-recorded starter loop must not replay an old preview); 'fehlt' when it is not there
  private starterHash(loop: string): string {
    try { return crypto.createHash('sha256').update(fs.readFileSync(path.join(this.o.starterWavOrdner, `${loop}_128bpm.wav`))).digest('hex'); } catch { return 'fehlt'; }
  }

  // Everything that can be refused before a render starts. Pure reading: preset, graph folder, starter loops.
  private plane(id: string): Plan {
    const m = PRESET_ID.test(id) ? /^(werk|nutzer):([a-z0-9-]+)\/(.+)$/.exec(id) : null;
    if (!m) throw new PresetVorhoerFehler(404, 'preset_unbekannt', 'no such preset');
    let preset: ReturnType<PresetSpeicher['lies']>;
    try { preset = this.o.speicher.lies(m[1] as Herkunft, m[2], m[3]); } catch (e) {
      if (e instanceof PresetFehler && e.code === 404) throw new PresetVorhoerFehler(404, 'preset_unbekannt', 'no such preset');
      if (e instanceof PresetFehler && (e.code === 409 || e.code === 400)) {
        throw new PresetVorhoerFehler(e.fehler === 'geraet_unbekannt' ? 404 : 409, e.fehler === 'geraet_unbekannt' ? 'preset_unbekannt' : 'preset_unlesbar',
          e.fehler === 'geraet_unbekannt' ? 'no such preset' : 'the preset file is damaged and cannot be previewed');
      }
      throw e;
    }
    const nichtMoeglich = (): PresetVorhoerFehler => new PresetVorhoerFehler(422, 'vorhoeren_nicht_moeglich', 'this preset cannot be previewed');
    let graphHashe: string | null = null;
    let effekt = preset.geraet_typ === 'effekt';
    if (preset.geraet === 'baukasten') {
      const g = typeof preset.graph === 'string' ? findeGraph(preset.graph, this.o.graphenOrdner) : null;
      if (!g) throw new PresetVorhoerFehler(422, 'graph_fehlt', `the graph '${String(preset.graph)}' of this preset is not installed`);
      effekt = g.art === 'effekt';
      graphHashe = graphHash(preset.graph as string, this.o.graphenOrdner);
    }
    if (effekt) {
      // a hall preset has no apply target (kein_ziel): only the insert devices and Baukasten effect graphs can be heard
      if (preset.geraet !== 'baukasten' && !EFFEKT_GERAETE.includes(preset.geraet)) throw nichtMoeglich();
      const loop = effektEingang(preset).loop;
      return { id, schluessel: vorhoerSchluessel(preset, { loop, renderer: this.rendererVersion(), starter: this.starterHash(loop), kit: this.o.kitOrdner }, graphHashe), preset, rolle: null, loops: [], loop, herkunft: m[1] as Herkunft };
    }
    const rolle = rolleVon(preset);
    if (rolle === null || (preset.geraet !== 'rb338' && preset.geraet !== 'baukasten')) throw nichtMoeglich();
    let loops: LoopsDatei, loopsHash: string;
    try { ({ loops, hash: loopsHash } = this.leseLoops()); } catch {
      throw new PresetVorhoerFehler(503, 'starter_fehlt', 'the starter material for previews is missing');
    }
    let loop: string;
    try { loop = phraseFuer(rolle, loops).loop; } catch { throw new PresetVorhoerFehler(503, 'starter_fehlt', 'the starter material for previews is missing'); }
    return { id, schluessel: vorhoerSchluessel(preset, { loop, transponiere: transponiereFuer(rolle), loopsHash, renderer: this.rendererVersion(), kit: this.o.kitOrdner }, graphHashe), preset, rolle, loops, loop, herkunft: m[1] as Herkunft };
  }

  // A cached preview plays only when the WAV has an intact header with all its data and the sidecar of this key is there; anything else is
  // dropped and rendered again.
  private ausCache(key: string): VorhoerErgebnis | null {
    const datei = this.datei(key);
    if (!fs.existsSync(datei)) return null;
    let s: Seite | null = null;
    try { s = JSON.parse(fs.readFileSync(this.seite(key), 'utf8')) as Seite; } catch { s = null; }
    if (!s || s.schluessel !== key || !(typeof s.dauer_s === 'number' && s.dauer_s > 0) || !wavHeil(datei, s.dauer_s, !(typeof s.rms_db === 'number' && s.rms_db <= STUMM_DB))) {
      this.log({ schluessel: key, cache_verworfen: true });
      fs.rmSync(datei, { force: true }); fs.rmSync(this.seite(key), { force: true });
      return null;
    }
    try { const jetzt = new Date(); fs.utimesSync(datei, jetzt, jetzt); } catch { /* recently used stays longer */ }
    return { schluessel: key, datei, aus_cache: true, dauer_s: s.dauer_s, spitze_db: s.spitze_db ?? 0, rms_db: s.rms_db ?? 0, render_ms: s.render_ms ?? 0 };
  }

  // The throwaway project, exactly the recipe of the plan: a track of the preset's own device, a clip of the phrase, then the apply plan of the page.
  private projekt(plan: Plan): Projekt {
    const { preset } = plan;
    if (plan.rolle === null) throw new Error('an effect preview has no phrase');
    const phrase = phraseFuer(plan.rolle, plan.loops);
    const p0 = neuesProjekt('preview');
    p0.tempo_bpm = 128;
    const geraet = preset.geraet === 'rb338' ? { art: 'intern', name: 'rb338', parameter: {} } : { art: 'intern', name: 'bk', graph: preset.graph, parameter: {} };
    const r1 = fuehreListeAus(p0, [{ befehl: 'spur_neu', art: 'instrument', name: SPUR_NAME, geraet }]);
    const spur = r1.projekt.spuren.find((s) => s.name === SPUR_NAME);
    if (!spur) throw new Error('preview track was not created');
    const r2 = fuehreListeAus(r1.projekt, [{ befehl: 'clip_neu', spur_id: spur.id, art: 'midi', start_beat: 0, laenge_beats: BEATS,
      noten: phrase.noten.map((n) => ({ beat: n.beat, laenge: n.laenge_beats, ton: n.ton, vel: n.vel })) }]);
    const anwenden = planeAnwendung({ id: plan.id, name: preset.name, geraet: preset.geraet, ...(preset.graph ? { graph: preset.graph } : {}), werte: preset.werte,
      ...(preset.stifte ? { stifte: preset.stifte } : {}) }, { art: 'spur', spur_id: spur.id }, r2.projekt);
    if (anwenden.weg !== 'proj') throw new Error('the apply plan of a track is not a project edit');
    if (anwenden.uebersprungen.length) this.log({ id: plan.id, uebersprungen: anwenden.uebersprungen });
    return fuehreListeAus(r2.projekt, anwenden.befehle).projekt;
  }

  // An effect: one audio track whose clip is the starter loop (its raw data written as <arbeit>/audio/<sha>.f32, the decoded-cache layout), the preset
  // applied as a new insert of that track by the same plan the PRESETS page uses.
  private effektProjekt(plan: Plan, wav: StarterWav, arbeit: string): Projekt {
    const { preset } = plan;
    const sha = crypto.createHash('sha256').update(wav.daten).digest('hex');
    fs.mkdirSync(path.join(arbeit, 'audio'), { recursive: true });
    fs.writeFileSync(path.join(arbeit, 'audio', `${sha}.f32`), wav.daten);
    const p0 = neuesProjekt('preview');
    p0.tempo_bpm = 128;
    const r1 = fuehreListeAus(p0, [{ befehl: 'spur_neu', art: 'audio', name: SPUR_NAME }]);
    const spur = r1.projekt.spuren.find((s) => s.name === SPUR_NAME);
    if (!spur) throw new Error('preview track was not created');
    const laenge = Math.min(BEATS, wav.frames * 128 / (48000 * 60));
    const r2 = fuehreListeAus(r1.projekt, [{ befehl: 'clip_neu', spur_id: spur.id, art: 'audio', start_beat: 0, laenge_beats: laenge, sha256: sha, name: plan.loop }]);
    const anwenden = planeAnwendung({ id: plan.id, name: preset.name, geraet: preset.geraet, ...(preset.graph ? { graph: preset.graph } : {}), werte: preset.werte,
      ...(preset.stifte ? { stifte: preset.stifte } : {}) }, { art: 'insert_neu', strang_id: spur.id }, r2.projekt);
    if (anwenden.weg !== 'proj') throw new Error('the apply plan of an insert is not a project edit');
    if (anwenden.uebersprungen.length) this.log({ id: plan.id, uebersprungen: anwenden.uebersprungen });
    const fertig = fuehreListeAus(r2.projekt, anwenden.befehle).projekt;
    // the file is already in place, so the clip counts as decoded (the translation plays only clips marked 'fertig')
    for (const s of fertig.spuren) for (const c of s.clips) if (c.art === 'audio') c.dekodiert = 'fertig';
    return fertig;
  }

  private async rendere(plan: Plan): Promise<VorhoerErgebnis> {
    const key = plan.schluessel;
    const cache = this.o.cacheOrdner;
    const arbeit = path.join(cache, 'arbeit', key);
    const ziel = path.join(arbeit, 'out.wav');
    const doppelt = this.ausCache(key);     // a joiner that waited in the queue behind the same key
    if (doppelt) return doppelt;
    try {
      const wav = plan.rolle === null ? leseStarterWav(path.join(this.o.starterWavOrdner, `${plan.loop}_128bpm.wav`)) : null;
      if (plan.rolle === null && !wav) throw new PresetVorhoerFehler(409, 'starter_fehlt', STARTER_FEHLT);
      fs.rmSync(arbeit, { recursive: true, force: true });
      fs.mkdirSync(arbeit, { recursive: true });
      let projekt: Projekt;
      try { projekt = wav ? this.effektProjekt(plan, wav, arbeit) : this.projekt(plan); } catch (e) {
        if (e instanceof PresetFehler && (e.fehler === 'kein_ziel' || e.fehler === 'geraet_passt_nicht')) {
          throw new PresetVorhoerFehler(422, 'vorhoeren_nicht_moeglich', 'this preset cannot be previewed');
        }
        throw e;
      }
      const t0 = Date.now();
      const limit = this.o.limitMs ?? LIMIT_MS;
      const ab = new AbortController();
      const uhr = setTimeout(() => ab.abort(), limit);
      let r: Awaited<ReturnType<typeof rendereProjektDatei>>;
      try {
        r = await this.render({ projekt, ziel, vonBeat: 0, bisBeat: BEATS, arbeitsOrdner: arbeit, timeoutMs: limit, abbruch: ab.signal,
          env: { CYPHERDJ_BK_ORDNER: this.o.graphenOrdner, CYPHERDJ_KIT_ORDNER: this.o.kitOrdner } });
      } finally { clearTimeout(uhr); }
      const renderMs = Date.now() - t0;
      if (!(r.rms_db > STUMM_DB)) throw new PresetVorhoerFehler(422, 'vorhoeren_stumm', 'the preview rendered silent; check the preset volume and try again');
      const n = normalisiere(r.datei);
      const spitze = n?.spitze_db ?? r.spitze_db, rms = n?.rms_db ?? r.rms_db;
      const seite: Seite = { schluessel: key, id: plan.id, rolle: plan.rolle, loop: plan.loop, dauer_s: Math.round(r.frames / 48) / 1000, spitze_db: spitze, rms_db: rms,
        gain_db: n?.gain_db ?? 0, render_ms: renderMs, erzeugt: new Date().toISOString() };
      const seiteTmp = path.join(arbeit, 'seite.json');
      fs.writeFileSync(seiteTmp, JSON.stringify(seite));
      fs.renameSync(seiteTmp, this.seite(key));
      fs.renameSync(r.datei, this.datei(key));
      this.log({ id: plan.id, schluessel: key, render_ms: renderMs });
      this.deckeln(key);
      return { schluessel: key, datei: this.datei(key), aus_cache: false, dauer_s: seite.dauer_s, spitze_db: spitze, rms_db: rms, render_ms: renderMs };
    } catch (e) {
      if (e instanceof PresetVorhoerFehler) throw e;
      if (e instanceof RenderDateiFehler) {
        if (e.grund === 'render_fehlt') throw new PresetVorhoerFehler(503, 'render_fehlt', 'the offline renderer is not installed on this machine');
        if (e.grund === 'projekt_ungueltig') this.log({ id: plan.id, fehler: `preview project refused: ${e.message}` });
        else this.log({ id: plan.id, fehler: e.message });
        throw new PresetVorhoerFehler(503, 'render_fehlgeschlagen', 'the preview could not be rendered');
      }
      this.log({ id: plan.id, fehler: (e as Error).message });
      throw new PresetVorhoerFehler(503, 'render_fehlgeschlagen', 'the preview could not be rendered');
    } finally {
      fs.rmSync(arbeit, { recursive: true, force: true });
    }
  }

  private deckeln(behalte: string): void {
    const d = deckle({ ordner: this.o.cacheOrdner, muster: SCHLUESSEL_WAV, deckel: this.o.deckel ?? PRESET_VORHOER_DECKEL, geschuetzt: (n) => n === `${behalte}.wav` });
    for (const n of d.geloescht) fs.rmSync(this.seite(n.slice(0, -4)), { force: true });
  }
}
