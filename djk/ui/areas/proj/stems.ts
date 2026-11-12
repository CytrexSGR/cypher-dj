// Paket 1.13 Slice 6 (G08, D1 bis D20): Bereich proj-stems. POST /proj/stems prüft vor, startet EINEN Lauf (StemsLauf) und antwortet sofort
// {auftrag_id, frames}; Fortschritt per SSE {a:'proj', f:{stems}} und als Feld stems in GET /proj/aktuell (P6). Ende = eine Projektänderung
// (aendereStand + uebernimm, ein Undo) oder eine Meldung abgebrochen | veraltet | fehler mit Grund. Kein sperreLaden (D17). Die WAVs entstehen über den
// Take-Weg (schreibeWavAusF32, D4).
import fs from 'node:fs';
import path from 'node:path';
import type http from 'node:http';
import type { Bereich, BereichKontext, Route } from '../../http/router.ts';
import { json } from '../../http/transport.ts';
import { grundText } from '../../http/reasons.ts';
import { aendereStand } from '../../project/state.ts';
import { schreibeWavAusF32Stueckweise } from '../../project/recording.ts';
import { STEMS, STEMS_PFLICHT, StemsFehler, baueStemsProjekt, pruefeNochGleich, stemsPlan, type Stem, type StemsPlan } from '../../project/stems.ts';
import { herkunft, sucheClip } from '../../project/model.ts';
import { grundCode } from './mapping.ts';
import { alsAntwort, leseKoerper, type ProjZugang } from './area.ts';
import { ProjFehler, type Antwort } from './session.ts';
import { StemsLauf, type StemsLaufOptionen } from './stems_run.ts';

// Plan 2026-11-06-stems-roformer-gpu, D2/D7: GPU only, no CPU fallback; the field geraet stays for compatibility and accepts only 'gpu'
export const STEMS_NUR_GPU = true;
const GPU_GRUENDE = new Set(['gpu_belegt', 'keine_gpu']);                       // grund of the result line, passed through unchanged
// Review MINOR 4: Zeitlimit je Lauf. RTF 0,27 (Probe) mit Faktor 3 Reserve plus Laden; mindestens 10 min (wie die Vorbereiter-Linie, analysis.ts:14)
export const stemsZeitlimitMs = (n: number): number => Math.max(10 * 60_000, Math.round(n / 48000 * 3 * 1000) + 120_000);
export interface StemsOptionen extends Partial<StemsLaufOptionen> { python: string; cwd: string; zeitlimitMs?: number;
  schreibeWav?: (quelle: string, ziel: string) => Promise<{ frames: number; sha256: string }> }   // Test: den Schreiber verlangsamen
type Zustand = 'laeuft' | 'fertig' | 'abgebrochen' | 'veraltet' | 'fehler';
// What happens with the separated files (plan live-module decision 14): the stems runner only separates and writes the WAVs; the caller decides what
// they become. `hinfaellig` judges the fresh project (null = still fine); `setze` takes the files and changes the project in ONE edit, with no await
// before that edit; it calls markiere() right after the edit (from then on the WAVs count as taken over) and returns extra fields of the end state.
type Offen = NonNullable<ReturnType<ProjZugang['offen']>>;
export interface Uebernahme {
  hinfaellig(o: Offen | null, anzahl: number): Record<string, unknown> | null;
  setze(o: Offen, dateien: Partial<Record<Stem, { sha256: string; pfad: string }>>, e: { rest_db?: unknown },
    markiere: () => void): Promise<Record<string, unknown>>;
  dateiName(plan: StemsPlan): string;
}
type EndeHaken = (stand: Record<string, unknown>) => void;
interface Lauf { id: number; slug: string; quelle: 'andreas' | 'cypher'; plan: StemsPlan; uebernahme: Uebernahme; ende?: EndeHaken;
  tmp: string; kennung: number; prozess: StemsLauf;
  abgebrochen: 'abbruch' | 'stems_zeitlimit' | null; wavs: string[];
  rechnet: boolean; gespeichert: boolean; uhr: NodeJS.Timeout; frist: NodeJS.Timeout }
const FELDER = ['clip_id', 'spur_id', 'von_beat', 'bis_beat', 'geraet'];
const dateiName = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'clip';

export class Stems {
  private readonly ctx: BereichKontext;
  private readonly zugang: ProjZugang;
  private readonly o: StemsOptionen;
  private lauf: Lauf | null = null;
  private quantum: number | null = null;
  private naechste = 1;
  constructor(ctx: BereichKontext, zugang: ProjZugang, o: StemsOptionen) {
    this.ctx = ctx; this.zugang = zugang; this.o = o;
    raeumeStemsReste(zugang.arbeitsordner(), ctx.log);                          // Review MINOR 4: Reste eines abgestürzten Servers
    // Controller-Entscheid T7: ein Lauf gehört zum Projekt, in dem er gestartet wurde; Schließen oder Wechsel bricht ihn ab, solange das Kind rechnet
    // (danach entscheidet die frische Prüfung in beende: veraltet)
    zugang.beiSchliessen((slug) => { const l = this.lauf; if (l && l.rechnet && l.slug === slug) this.bricheAb(l, 'abbruch'); });
  }

  // The checks every run needs before it starts (the proj_stems route and the live module separation share them)
  private pruefeBereit(quelle: 'andreas' | 'cypher'): void {
    if (this.lauf) throw new ProjFehler(409, 'stems_laeuft', { auftrag_id: this.lauf.id });
    if (quelle === 'cypher' && this.ctx.kiGestoppt()) throw new ProjFehler(409, 'ki_gestoppt');   // P5: nur Cyphers Läufe
    if (this.quantum === null) throw new ProjFehler(409, 'kein_kernstand');
  }

  starte(d: Record<string, unknown>, quelle: 'andreas' | 'cypher'): Antwort {
    for (const k of Object.keys(d)) if (!FELDER.includes(k)) throw new ProjFehler(400, 'argument_unbekannt', { detail: k });
    const geraet = d.geraet ?? 'gpu';
    if (geraet === 'cpu') throw new ProjFehler(400, 'stems_nur_gpu');
    if (geraet !== 'gpu') throw new ProjFehler(400, 'argument_ungueltig', { detail: "geraet: only 'gpu'" });
    this.pruefeBereit(quelle);
    // D10 retired 2026-11-07: the quantum-256 rule came from CPU stems; M9 measured GPU jobs next to the kern at 256 and 128 with 0 gaps
    const o = this.zugang.offen();
    if (!o) throw new ProjFehler(409, 'kein_projekt');
    const plan = stemsPlan(o.projekt, d);
    const g = sucheClip(o.projekt, plan.clipId)!;
    if (quelle === 'cypher' && herkunft(g.spur) === 'andreas') throw new ProjFehler(409, 'nur_andreas_spur');   // D15
    const quellDatei = path.join(this.zugang.arbeitsordner(), 'audio', `${plan.sha256}.f32`);
    if (g.clip.art !== 'audio' || g.clip.dekodiert !== 'fertig' || !fs.existsSync(quellDatei)) throw new ProjFehler(409, 'audio_fehlt');
    return this.beginne(o.slug, plan, quelle, this.projUebernahme());
  }

  // Live module separation (plan live-module decision 14): the same run for a decoded file of the open project; the caller says what the files become.
  // ende(stand) is called once with the end state (fertig, fehler, abgebrochen, veraltet) after it was published.
  starteTrennung(plan: StemsPlan, quelle: 'andreas' | 'cypher', uebernahme: Uebernahme, ende?: EndeHaken): Antwort {
    this.pruefeBereit(quelle);
    const o = this.zugang.offen();
    if (!o) throw new ProjFehler(409, 'kein_projekt');
    if (!fs.existsSync(path.join(this.zugang.arbeitsordner(), 'audio', `${plan.sha256}.f32`))) throw new ProjFehler(409, 'audio_fehlt');
    return this.beginne(o.slug, plan, quelle, uebernahme, ende);
  }
  // True while a run is in progress (the live export reports gpu_belegt-like waits itself; one job at a time stays the rule)
  laeuft(): boolean { return this.lauf !== null; }

  // The proj_stems way: the original is cut and muted, the stems become tracks under it (baueStemsProjekt), one undo step
  private projUebernahme(): Uebernahme {
    return {
      dateiName: (plan) => dateiName(plan.clipName),
      hinfaellig: (o, anzahl) => {
        if (!o) return { zustand: 'veraltet', grund: 'veraltet', text: 'the clip changed while separating; nothing was placed' };
        const l = this.lauf!;
        if (o.slug !== l.slug) return { zustand: 'veraltet', grund: 'veraltet', text: 'the clip changed while separating; nothing was placed' };
        const alt = pruefeNochGleich(o.projekt, l.plan, anzahl);
        if (alt === 'zu_viele_spuren') return { zustand: 'veraltet', grund: 'zu_viele_spuren', text: `separating stems needs ${anzahl} free tracks` };
        if (alt !== null) return { zustand: 'veraltet', grund: 'veraltet', text: 'the clip changed while separating; nothing was placed' };
        return null;
      },
      setze: async (o, dateien, e, markiere) => {
        const l = this.lauf!;
        const neu = baueStemsProjekt(o.projekt, l.plan, dateien, l.quelle);
        const meta = { quelle: l.quelle, label: `Stems ${l.plan.clipName}` };
        const w = aendereStand(o.verlauf, o.projekt, neu.projekt, meta, this.zugang.haken());
        markiere();
        if (w.eintrag !== null) await this.zugang.uebernimm(w, meta);
        return { spuren: neu.spuren, rev: this.zugang.offen()?.projekt.rev ?? w.projekt.rev,
          rest_db: e.rest_db ?? null, ...(neu.hinweis ? { hinweis: neu.hinweis } : {}), ...(neu.hinweisText ? { hinweis_text: neu.hinweisText } : {}) };
      },
    };
  }

  private beginne(slug: string, plan: StemsPlan, quelle: 'andreas' | 'cypher', uebernahme: Uebernahme, ende?: EndeHaken): Antwort {
    const quellDatei = path.join(this.zugang.arbeitsordner(), 'audio', `${plan.sha256}.f32`);
    const id = this.naechste++;
    const tmp = path.join(this.zugang.arbeitsordner(), `stems-${id}`);
    const auftrag = { quelle: quellDatei, f0: plan.f0, f1: plan.f1, aus: tmp };
    const prozess = new StemsLauf({ ...this.o }, auftrag, (stufe, prozent) => this.melde(stufe, prozent));
    const l: Lauf = { id, slug, quelle, plan, uebernahme, ...(ende ? { ende } : {}), tmp, kennung: this.zugang.naechsteNummer(), prozess,
      abgebrochen: null, wavs: [],
      rechnet: true, gespeichert: false,
      uhr: setInterval(() => this.stand({ cpu_s: prozess.cpuSekunden() }, false), 1000),
      frist: setTimeout(() => { if (l.rechnet) this.bricheAb(l, 'stems_zeitlimit'); },
        this.o.zeitlimitMs ?? stemsZeitlimitMs(plan.n)) };
    this.lauf = l;
    this.stand({ zustand: 'laeuft', stufe: null, prozent: null, cpu_s: null }, true, true);
    void this.beende(l);
    return { code: 200, j: { auftrag_id: id, frames: plan.n } };
  }

  private bricheAb(l: Lauf, grund: 'abbruch' | 'stems_zeitlimit'): void {
    l.abgebrochen ??= grund;                                                    // der erste Grund zählt
    l.prozess.abbrechen(this.o.killMs ?? 2000);                                 // D2: SIGTERM, nach killMs SIGKILL
  }
  abbrechen(d: Record<string, unknown>): Antwort {
    const l = this.lauf;
    if (!l || l.id !== d.auftrag_id) throw new ProjFehler(404, 'kein_auftrag', { auftrag_id: d.auftrag_id ?? null });
    if (l.gespeichert) throw new ProjFehler(409, 'zu_spaet', { auftrag_id: l.id });   // das Ergebnis ist schon übernommen
    this.bricheAb(l, 'abbruch');
    return { code: 200, j: { auftrag_id: l.id, zustand: 'abbrechen' } };
  }
  private abbruchStand(l: Lauf): void {
    if (l.abgebrochen === 'stems_zeitlimit') {
      this.endStand(l, { zustand: 'abgebrochen', grund: 'stems_zeitlimit', text: 'the stem separation took too long and was cancelled' });
    } else this.endStand(l, { zustand: 'abgebrochen', grund: 'abbruch', text: 'the stem separation was cancelled' });
  }

  // Stand für /proj/aktuell (P6) und SSE; neu = frischer Stand dieses Laufs
  private aktuellerStand: Record<string, unknown> | null = null;
  private stand(teil: Record<string, unknown>, sse: boolean, neu = false): void {
    const l = this.lauf;
    if (!l) return;
    const basis = neu ? { slug: l.slug, auftrag_id: l.id, clip_id: l.plan.clipId } : (this.aktuellerStand ?? {});
    this.aktuellerStand = { ...basis, ...teil };
    this.zugang.stemsStand(this.aktuellerStand);
    if (sse) this.ctx.verteile({ a: 'proj', f: { stems: this.aktuellerStand } });
  }
  private melde(stufe: string, prozent: number | null): void { this.stand({ stufe, prozent }, true); }
  // Review M3: jedes Literal mit grund trägt seinen englischen text selbst (tests/proj_reasons_text.test.mjs:137, gruendeOhneText); grundText nur als Rückfall
  private endStand(l: Lauf, e: { zustand: Zustand; grund?: string; text?: string; detail?: string } & Record<string, unknown>): void {
    this.stand({ ...e, ...(e.grund && !e.text ? { text: grundText(e.grund) } : {}) }, true);
    clearInterval(l.uhr); clearTimeout(l.frist);
    this.lauf = null;
    try { l.ende?.({ ...this.aktuellerStand }); } catch (x) { this.ctx.log({ typ: 'stems_ende_fehler', fehler: (x as Error).message }); }
  }

  private async beende(l: Lauf): Promise<void> {
    const e = await l.prozess.fertig;
    l.rechnet = false;
    let gespeichert = false;
    try {
      if (l.abgebrochen) { this.abbruchStand(l); return; }
      if (l.quelle === 'cypher' && this.ctx.kiGestoppt()) {                     // D15: Stop Cypher am Ende → verwerfen, räumt das finally
        this.endStand(l, { zustand: 'veraltet', grund: 'ki_gestoppt', text: 'Stop Cypher is set; the result was discarded' }); return;
      }
      if (e.zeile?.status === 'fehler' && GPU_GRUENDE.has(String(e.zeile.grund))) {   // D2: no GPU or not enough free memory
        const grund = String(e.zeile.grund);
        this.endStand(l, { zustand: 'fehler', grund, text: grundText(grund), detail: String(e.zeile.text ?? '') });
        return;
      }
      // the placed stems: the four required ones always, guitar and piano when werkstatt.stems kept them (D4)
      const gesetzt = Array.isArray(e.zeile?.stems) ? (e.zeile!.stems as unknown[]).map(String) : [];
      const stimmig = STEMS_PFLICHT.every((s) => gesetzt.includes(s)) && gesetzt.every((s) => (STEMS as readonly string[]).includes(s));
      if (e.rc !== 0 || e.zeile?.status !== 'ok' || !stimmig) {
        this.endStand(l, { zustand: 'fehler', grund: 'stems_fehler', text: 'the stem separation failed; nothing was changed',
          detail: String(e.zeile?.grund ?? e.signal ?? `rc ${e.rc}`) });
        return;
      }
      // B1/M1 (Review T6): geprüft wird vor den WAVs (billig) und NOCH EINMAL frisch nach dem letzten await, gebaut und gespeichert wird nur aus dem
      // frischen Stand (wie setze() in output.ts); zwischen dem frischen offen() und aendereStand steht kein await.
      const o0 = this.zugang.offen();
      const hinfaellig = (o: ReturnType<ProjZugang['offen']>): Record<string, unknown> | null => l.uebernahme.hinfaellig(o, gesetzt.length);
      const vor = hinfaellig(o0);
      if (vor) { this.endStand(l, vor as { zustand: Zustand }); return; }
      const dateien: Partial<Record<Stem, { sha256: string; pfad: string }>> = {};
      for (const s of STEMS.filter((x) => gesetzt.includes(x))) {
        const ziel = path.join(o0!.ordner, 'stems', `${l.kennung}-${l.uebernahme.dateiName(l.plan)}-${s}.wav`);
        const w = await (this.o.schreibeWav ?? schreibeWavAusF32Stueckweise)(path.join(l.tmp, `${s}.f32`), ziel);   // Review MINOR 5: Event-Loop frei
        l.wavs.push(ziel);
        if (w.frames !== l.plan.n) throw new Error(`${s}: ${w.frames} frames, expected ${l.plan.n}`);
        dateien[s] = { sha256: w.sha256, pfad: ziel };
      }
      if (l.abgebrochen) { this.abbruchStand(l); return; }                      // Abbrechen im WAV-Fenster: nichts übernehmen
      const o = this.zugang.offen();                                             // frisch, kein await bis aendereStand
      const spaet = hinfaellig(o);
      if (spaet) { this.endStand(l, spaet as { zustand: Zustand }); return; }
      if (l.quelle === 'cypher' && this.ctx.kiGestoppt()) {                     // D15 MAJOR T8: Stop im WAV-Fenster (wie session.ts:864)
        this.endStand(l, { zustand: 'veraltet', grund: 'ki_gestoppt', text: 'Stop Cypher is set; the result was discarded' }); return;
      }
      // m1: from markiere() on the WAVs count as taken over, never delete them again
      const markiere = (): void => { gespeichert = true; l.gespeichert = true; l.wavs = []; };
      const extra = await l.uebernahme.setze(o!, dateien, { rest_db: e.zeile.rest_db }, markiere);
      this.endStand(l, { zustand: 'fertig', ...extra });
    } catch (x) {
      for (const f of l.wavs) fs.rmSync(f, { force: true });
      if (gespeichert) {                                                         // m1: gespeichert, nur das Laden/Melden scheiterte; WAVs bleiben
        this.endStand(l, { zustand: 'fehler', grund: 'stems_fehler', text: 'the stems were saved, but loading them failed', detail: (x as Error).message });
      } else {
        this.endStand(l, { zustand: 'fehler', grund: 'stems_fehler', text: 'the stem separation failed; nothing was changed', detail: (x as Error).message });
      }
    } finally {
      for (const f of l.wavs) fs.rmSync(f, { force: true });                    // veraltet nach geschriebenen WAVs: die eigenen räumen
      fs.rmSync(l.tmp, { recursive: true, force: true });
    }
  }

  ereignis(adresse: string, f: Record<string, unknown>): void {
    const q = adresse === '/zustand/kern' ? f.quantum : adresse === '/e/quantum' ? f.neu : undefined;
    if (q === undefined) return;
    // MINOR 2 T8: 0 = der Kern hat noch keinen Zyklus gerechnet (telemetry.h:62) → unbekannt, nicht falsch: Start kein_kernstand, im Lauf kein Abbruch
    this.quantum = Number(q) > 0 ? Number(q) : null;
  }
  schliesse(): void {
    const l = this.lauf;
    if (!l) return;
    l.abgebrochen ??= 'abbruch';                                                // beende() meldet abgebrochen und räumt Temp und WAVs
    l.prozess.toete();                                                          // Serverstopp: sofort SIGKILL, kein Waise
    clearTimeout(l.frist);
  }
}

// Review MINOR 4: beim Start Reste eines abgestürzten Servers räumen. Kinder: jeder Prozess, dessen Kommandozeile `werkstatt.stems` und ein --aus unter
// <arbeitsordner>/stems- trägt (nur DIESE Instanz, der Arbeitsordner ist je Instanz eigen), bekommt SIGKILL; dann alle Ordner stems-* im Arbeitsordner weg.
export function raeumeStemsReste(arbeitsordner: string, log: (z: Record<string, unknown>) => void = () => {},
  proc = '/proc'): { prozesse: number[]; ordner: string[] } {
  const praefix = path.join(arbeitsordner, 'stems-');
  const prozesse: number[] = [];
  for (const d of fs.existsSync(proc) ? fs.readdirSync(proc) : []) {
    if (!/^\d+$/.test(d) || Number(d) === process.pid) continue;
    let arg: string[];
    try { arg = fs.readFileSync(path.join(proc, d, 'cmdline'), 'utf8').split('\0'); } catch { continue; }
    const i = arg.indexOf('--aus');
    if (arg.includes('werkstatt.stems') && i >= 0 && (arg[i + 1] ?? '').startsWith(praefix)) {
      try { process.kill(Number(d), 'SIGKILL'); prozesse.push(Number(d)); } catch { /* schon weg */ }
    }
  }
  // leftovers of a live module export that died mid-cut (areas/live/export.ts): the cut file of the loop
  if (fs.existsSync(arbeitsordner)) {
    for (const f of fs.readdirSync(arbeitsordner)) if (/^live-export-\d+\.f32$/.test(f)) fs.rmSync(path.join(arbeitsordner, f), { force: true });
  }
  const ordner = fs.existsSync(arbeitsordner) ? fs.readdirSync(arbeitsordner).filter((f) => /^stems-\d+$/.test(f)) : [];
  for (const f of ordner) fs.rmSync(path.join(arbeitsordner, f), { recursive: true, force: true });
  if (prozesse.length || ordner.length) log({ typ: 'stems_reste', prozesse, ordner });
  return { prozesse, ordner };
}

export function stemsBereich(ctx: BereichKontext, zugang: ProjZugang, o: StemsOptionen): Bereich & { stems: Stems } {
  const st = new Stems(ctx, zugang, o);
  const antworte = async (r: http.ServerResponse, f: () => Antwort | Promise<Antwort>): Promise<void> => {
    let x: Antwort;
    try { x = await f(); } catch (e) {
      x = e instanceof StemsFehler ? { code: grundCode(e.grund), j: { fehler: e.grund, text: grundText(e.grund), detail: e.message } } : alsAntwort(e, ctx);
    }
    json(r, x.code, x.j);
  };
  const routen = (): Route[] => [
    { methode: 'POST', pfad: '/proj/stems', schutz: 'fremdePost', handler: async (q, r) => {
      const quelle = ctx.quelle();                                               // vor dem await (Muster recording.ts:279)
      await antworte(r, async () => st.starte(await leseKoerper(q), quelle));
    } },
    { methode: 'POST', pfad: '/proj/stems/abbrechen', schutz: 'fremdePost', handler: async (q, r) => {
      await antworte(r, async () => st.abbrechen(await leseKoerper(q)));
    } },
  ];
  return { name: 'proj-stems', stems: st, routen, ereignis: (adresse, felder) => st.ereignis(adresse, felder) };
}
