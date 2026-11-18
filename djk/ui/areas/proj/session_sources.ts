import fs from 'node:fs';
import type { Katalog, Zeile } from '../../catalog.ts';
import type { Hinweis, Koerper, ProjOptionen } from './session.ts';
import { ProjFehler, graphArt } from './session.ts';
import { fuehreListeAus } from '../../project/commands.ts';
import { kitDa, kitKlaenge } from './kits.ts';
import { uebersetzeAusCache } from './pattern_run.ts';
import { surgeBereich } from './surge.ts';
import { MAX_BEAT, sucheClip, type Projekt } from '../../project/model.ts';
import { WarpFehler, abHierStart, autoWarp, fensterTempo, handWarp, quantisiere, type TempoQuelle } from '../../project/warp.ts';
import { leseKarte, leseTraktor } from './sources.ts';
import type { AnalyseListe, Anforderung } from './analysis.ts';
import { brauchtAnalyse } from '../../project/warp_analysis.ts';

// The part of ProjSitzung that the source resolution of a command list reaches (the rest stays with the session).
export interface QuellenHost {
  readonly analyse: string | null;
  readonly analyseGescheitert: Set<string>;
  readonly analysen: AnalyseListe | null;
  readonly bestand: string | null;
  readonly katalog: Katalog | null;
  readonly mediathekPfad: string | null;
  readonly presetLies: ProjOptionen['presetLies'];
  quellPfad(sha: string, hinweis: string): string | null;
  transienten(sha: string): number[] | null;
}

export class SitzungQuellen {
  private readonly h: QuellenHost;
  constructor(h: QuellenHost) { this.h = h; }
  // Slice 3a: die Tempo-Angaben des Katalogs plus die Werkstatt-Karte zur sha des Clips; die Dauer fällt auf die der Karte zurück, wenn der Katalog keine hat
  tempoQuelleFuer(z: Zeile, sha: string): TempoQuelle {
    const k = leseKarte(this.h.analyse, sha, this.h.bestand);
    // auch bei einer Karte: sie kann unbrauchbar sein (karten_hinweis)
    const t = z.typ === 'track' || z.typ === 'loop' ? leseTraktor(this.h.mediathekPfad, sha) : null;
    return { typ: z.typ, bpm: z.bpm, takte: z.takte, dauer_s: z.dauer_s ?? k?.dauer_s ?? null, instrument: z.instrument, kategorie: z.kategorie,
      ...(k ? { karte: k.karte } : {}), ...(t ? { traktor: t } : {}) };
  }
  // Audio-Clips nur aus dem Katalog (Spec 2.11): sha256 → Pfad; Ableton-geschützt, Datei fehlt, unbekannt werden abgelehnt.
  // Paket 1.13: dasselbe Wissen löst den Auto-Warp auf (Reihenfolge werkstatt > traktor > takte > mediathek, tempoQuelleFuer). clip_neu mit warp
  // 'auto' bekommt Warp und Länge in Beats, laenge_beats des Aufrufers ist der Rückfall für Typen und Einträge ohne Tempo (Hinweis kein_tempo);
  // warp_auto auf einem vorhandenen Clip wird zu warp_setzen (Länge bleibt). Slice 3a (D1, F2): braucht ein langer Track eine Analyse
  // (brauchtAnalyse, nicht für eine sha, deren Analyse scheiterte), bekommt der Clip trotzdem sofort den Warp der besten Quelle (ohne jedes Tempo
  // keinen); die Auflösung merkt sich einen Wunsch (die Aufträge starten erst nach dem erfolgreichen Schreiben, starteAnalysen) und sagt es in
  // hinweise. Ein warp_auto ohne Tempo, das nur eine Analyse anstößt, fällt aus der Liste (T6).
  loeseQuellenAuf(befehle: unknown[], projekt: Projekt):
    { befehle: unknown[]; quellen: Map<string, string>; hinweise: Hinweis[]; wuensche: Anforderung[] } {
    const quellen = new Map<string, string>();
    const hinweise: Hinweis[] = [];
    const wuensche: Anforderung[] = [];
    const analyseHinweis = (index: number, sha: string): void => {
      hinweise.push({ index, hinweis: this.h.analysen?.laeuft(sha) ? 'analyse_laeuft' : 'analyse_angefordert' });
    };
    const brauchtSie = (q: Parameters<typeof brauchtAnalyse>[0], r: Parameters<typeof brauchtAnalyse>[1], sha: string): boolean =>
      this.h.analysen !== null && !this.h.analyseGescheitert.has(sha) && brauchtAnalyse(q, r);
    // Slice 3b: der Stand, den ein Befehl an dieser Stelle sieht (die Befehle davor sind schon aufgelöst). Scheitert einer davon, rechnet der Lauf
    // ohnehin dieselbe Ablehnung.
    const bisher: unknown[] = [];
    const standVor = (): Projekt => {
      const davor = bisher.filter((v) => v !== null);
      if (davor.length === 0) return projekt;
      try {
        return fuehreListeAus(projekt, davor, { transienten: this.h.transienten, graphArt, kitDa, presetLies: this.h.presetLies, surgeBereich,
          musterUebersetze: uebersetzeAusCache, kitKlaenge }).projekt;
      } catch { return projekt; }
    };
    const loese = (b: unknown, index: number): unknown => {
      const x = b as Koerper;
      if (x && typeof x === 'object' && x.befehl === 'tempo_vom_clip') {
        const nurId = Object.keys(x).every((k) => k === 'befehl' || k === 'clip_id');
        const g = nurId && typeof x.clip_id === 'string' ? sucheClip(standVor(), x.clip_id) : undefined;
        if (g?.clip.art !== 'audio' || !g.clip.warp) return b;      // der Baustein meldet clip_unbekannt, feld_nur_audio, kein_warp, argument_unbekannt
        return { befehl: 'tempo_setzen', bpm: fensterTempo(g.clip.warp, g.clip.loop_beats ?? g.clip.laenge_beats) };
      }
      if (x && typeof x === 'object' && x.befehl === 'warp_ab_hier' && x.art === 'start' && typeof x.clip_id === 'string' && typeof x.beat === 'number') {
        const g = Object.keys(x).every((k) => ['befehl', 'clip_id', 'beat', 'art'].includes(k)) ? sucheClip(standVor(), x.clip_id) : undefined;
        if (g?.clip.art !== 'audio' || !g.clip.warp) return b;                   // der Baustein meldet die Ablehnung
        if (!this.h.katalog) throw new ProjFehler(503, 'katalog_fehlt', { index });
        const z = this.h.katalog.eintrag(g.clip.quelle.sha256);
        if (!z) throw new ProjFehler(404, 'sha_unbekannt', { index });
        const r = autoWarp(this.tempoQuelleFuer(z, g.clip.quelle.sha256));
        if (r === null || 'hinweis' in r) throw new ProjFehler(409, 'kein_tempo', { index });
        const marker = abHierStart(g.clip.warp.marker, x.beat, r.warp.marker);
        if (marker === null) throw new ProjFehler(409, 'kein_tempo', { index, text: 'the auto warp has no marker behind that beat' });
        return { befehl: 'warp_setzen', clip_id: x.clip_id, warp: handWarp(g.clip.warp, marker) };
      }
      // Slice 4 (D8): Quantize Audio. Je Transient im Bereich ein Hand-Marker auf dem Raster; die Grenzen (800 BPM, 4096 Marker) prüft warp_setzen und lehnt ab
      if (x && typeof x === 'object' && x.befehl === 'audio_quantisieren' && typeof x.clip_id === 'string') {
        const felder = ['befehl', 'clip_id', 'raster', 'staerke', 'von_beat', 'bis_beat'];
        const g = Object.keys(x).every((k) => felder.includes(k)) ? sucheClip(standVor(), x.clip_id) : undefined;
        if (g?.clip.art !== 'audio' || !g.clip.warp) return b;                   // der Baustein meldet die Ablehnung
        const r = ({ '1/4': 1, '1/8': 0.5, '1/16': 0.25, '1/32': 0.125 } as Record<string, number | undefined>)[String(x.raster)];
        const falsch = (detail: string): never => { throw new ProjFehler(400, 'argument_ungueltig', { index, detail }); };
        if (r === undefined) falsch('raster: 1/4 | 1/8 | 1/16 | 1/32');
        const staerke = x.staerke === undefined ? 1 : x.staerke;
        if (typeof staerke !== 'number' || !(staerke >= 0 && staerke <= 1)) falsch('staerke: 0..1');
        for (const k of ['von_beat', 'bis_beat']) {
          const v = x[k];
          if (v !== undefined && !(typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_BEAT)) falsch(`${k}: a clip beat (number)`);
        }
        const t = this.h.transienten(g.clip.quelle.sha256);
        if (t === null) throw new ProjFehler(409, 'transienten_fehlen', { index });
        let marker: [number, number][];
        // D13/Fix 2: Standardbereich = der Bereich des Clips (Randtempo außerhalb der Marker), Raster im Projekt (erste Kopie)
        const c = g.clip, versatz = c.warp!.versatz_beats;
        const laenge = c.loop_beats ?? c.laenge_beats;
        const bereich = { von_beat: (x.von_beat as number | undefined) ?? versatz, bis_beat: (x.bis_beat as number | undefined) ?? versatz + laenge,
          off: c.start_beat - versatz };
        try { marker = quantisiere(g.clip.warp.marker, t, r!, staerke as number, bereich); }
        catch (e) { if (e instanceof WarpFehler) throw new ProjFehler(409, e.grund, { index }); throw e; }
        return { befehl: 'warp_setzen', clip_id: x.clip_id, warp: handWarp(g.clip.warp, marker) };
      }
      if (x && typeof x === 'object' && x.befehl === 'warp_auto' && typeof x.clip_id === 'string') {
        const g = sucheClip(projekt, x.clip_id);
        if (!g && befehle.slice(0, index).some((v) => (v as Koerper)?.befehl === 'clip_neu')) throw new ProjFehler(409, 'warp_auto_neuer_clip', { index });
        if (g?.clip.art !== 'audio') return b;                                   // der Baustein meldet clip_unbekannt bzw. feld_nur_audio
        if (!this.h.katalog) throw new ProjFehler(503, 'katalog_fehlt', { index });
        const sha = g.clip.quelle.sha256;
        const z = this.h.katalog.eintrag(sha);
        if (!z) throw new ProjFehler(404, 'sha_unbekannt', { index });
        const q = this.tempoQuelleFuer(z, sha), r = autoWarp(q);
        const pfad = brauchtSie(q, r, sha) ? this.h.quellPfad(sha, g.clip.quelle.pfad_hinweis) : null;
        if (pfad !== null) { wuensche.push({ sha, pfad, clip_id: x.clip_id }); analyseHinweis(index, sha); }
        if (r === null || 'hinweis' in r) {
          if (pfad !== null) return null;                          // kein Tempo, die Analyse ist unterwegs: der Befehl tut nichts und lehnt nicht ab
          throw new ProjFehler(409, 'kein_tempo', { index });
        }
        const { clip_id, ...rest } = x;
        return { ...rest, befehl: 'warp_setzen', clip_id, warp: r.warp };
      }
      if (!x || typeof x !== 'object' || x.befehl !== 'clip_neu' || x.art !== 'audio' || typeof x.sha256 !== 'string') return b;
      if (!this.h.katalog) throw new ProjFehler(503, 'katalog_fehlt', { index });
      const z = this.h.katalog.eintrag(x.sha256);
      if (!z) throw new ProjFehler(404, 'sha_unbekannt', { index });
      if (z.schutz === 'ableton') throw new ProjFehler(409, 'nur_live', { index });
      if (!z.pfad || !fs.existsSync(z.pfad)) throw new ProjFehler(409, 'quelle_fehlt', { index });
      quellen.set(z.sha, z.pfad);
      let warpTeil: Koerper = {};
      if (x.warp === 'auto') {
        const q = this.tempoQuelleFuer(z, z.sha), r = autoWarp(q);
        const analyse = brauchtSie(q, r, z.sha);
        if (analyse) { wuensche.push({ sha: z.sha, pfad: z.pfad }); analyseHinweis(index, z.sha); }   // D1: die Karte kommt nebenher
        if (r !== null && 'warp' in r) {
          warpTeil = { warp: r.warp, laenge_beats: r.laenge_beats };
          if (r.karten_hinweis) hinweise.push({ index, hinweis: r.karten_hinweis });   // T3: eine bessere Quelle war da, taugte aber nicht
        } else {
          warpTeil = { warp: 'aus' };
          if (r !== null && !analyse) hinweise.push({ index, hinweis: r.hinweis });    // mit Analyse sagt analyse_angefordert mehr als kein_tempo
        }
      }
      return { ...x, sha256: z.sha, pfad_hinweis: z.pfad, ...warpTeil };
    };
    const aus = befehle.map((b, index) => { const r = loese(b, index); bisher.push(r); return r; });
    return { befehle: aus.filter((b) => b !== null), quellen, hinweise, wuensche };
  }
}
