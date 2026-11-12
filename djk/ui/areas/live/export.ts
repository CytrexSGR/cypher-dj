// Plan live-module task 2 (decisions 1, 13, 14, 17): a deck loop becomes a module of the live container. POST /modul/export {deck, slot?} cuts the deck's
// active loop from its rendering (the same frames deck/loop/sichern writes), writes it as a WAV into the live project, builds the loop-only module
// (top group, Loop track unmuted, module fader closed at -200) and answers. The stem separation then runs in the background on that loop (the
// existing StemsLauf child process, via Stems.starteTrennung); when the stems arrive ONE undo step adds the stem groups and mutes Loop. A failed or
// GPU-busy separation leaves the loop-only module (a complete, playable module) with the reason in GET /modul/stand; POST /modul/stems {slot} retries.
// Progress of the separation is the proj_stems state (GET /proj/aktuell stems, SSE {a:'proj', f:{stems}}).
// The live container must already be open (POST /live/oeffnen): the export never switches the open project (choice: refuse kein_liveprojekt).
import fs from 'node:fs';
import path from 'node:path';
import type http from 'node:http';
import type { Bereich, BereichKontext, Route } from '../../http/router.ts';
import { json } from '../../http/transport.ts';
import { grundText } from '../../http/reasons.ts';
import { schneideAusFassung } from '../../loops.ts';
import { schreibeWavAusF32Stueckweise } from '../../project/recording.ts';
import { aendereStand } from '../../project/state.ts';
import { neueModulId } from '../../project/module_storage.ts';
import { baueModul, liveSlots, LIVE_LOOP_BEATS, LOOP_SPUR, type ModulDatei } from '../../project/live.ts';
import { MAX_GRUPPEN, MAX_SPUREN, type Herkunft, type Projekt } from '../../project/model.ts';
import type { StemsPlan, Stem } from '../../project/stems.ts';
import { alsAntwort, leseKoerper, type ProjZugang } from '../proj/area.ts';
import { ProjFehler, type Antwort } from '../proj/session.ts';
import type { Stems, Uebernahme } from '../proj/stems.ts';
import { ModulLeeren, type LeerenOptionen } from './leeren.ts';
import { ModulBlend } from './blend.ts';
import { ModulMidi, type MidiOptionen } from './midi.ts';
import { ModulTonart, type MasterTonartQuelle } from './key.ts';

// What the page server knows about a deck's active loop (server.ts deckLoopAusschnitt); startFrame and frames are the cut of the rendering file
export interface DeckLoopAusschnitt {
  deck: number; material_id: string; basis_bpm: number; fassung: number; basisDatei: string;
  startFrame: number; frames: number; laenge_beats: number; von_beat: number;
  eins?: number;   // first downbeat of the rendering (beat axis of von_beat); absent or 0 = beat 0
}
export interface KatalogZeile { sha: string; typ: string; titel: string | null; kuenstler: string | null; bpm: number | null; camelot: string | null }
export interface ExportOptionen {
  deckLoop(deck: unknown): DeckLoopAusschnitt | { code: number; fehler: string };
  herkunft(materialId: string): KatalogZeile | null;
  jetzt?: () => Date;
  // Hooks of the module store (task 3): nachExport runs once after the loop-only module is in the project, never for a failed export; nachStems runs
  // when the stems have been placed (the saved module then holds them, same module id)
  nachExport?(e: { slot: 'A' | 'B'; gruppeId: string; projekt: Projekt }): void | Promise<void>;
  nachStems?(e: { slot: 'A' | 'B'; gruppeId: string; projekt: Projekt }): void | Promise<void>;
  leeren?: LeerenOptionen;   // POST /modul/leeren (task 3): clock source, store, test seam; POST /modul/blend (task 8) takes the same clock
  midi?: MidiOptionen;       // task 8: the MIDI extraction of Drums and Bass after the stems (absent: no new paths)
  masterTonart?: MasterTonartQuelle;   // task 11: key of the deck on the master (server.ts), for POST /modul/tonart and the distance in /modul/stand
  zeitlimitDekodierenMs?: number;
}
type Slot = 'A' | 'B';
export interface ModulStand { stems: 'wartet' | 'laeuft' | 'fertig' | 'fehler'; grund?: string; text?: string; detail?: string; auftrag_id?: number }

const text = (g: string): string => grundText(g);
const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class Modulexport {
  private readonly zustand: Partial<Record<Slot, ModulStand>> = {};
  private readonly imBau = new Set<Slot>();
  private readonly ctx: BereichKontext;
  private readonly zugang: ProjZugang;
  private readonly stems: Stems;
  private readonly o: ExportOptionen;
  private readonly midi?: ModulMidi;
  constructor(ctx: BereichKontext, zugang: ProjZugang, stems: Stems, o: ExportOptionen) {
    this.ctx = ctx; this.zugang = zugang; this.stems = stems; this.o = o;
    if (o.midi) this.midi = new ModulMidi(ctx, zugang, o.midi, () => this.ctx.verteile({ a: 'modul', f: { stand: this.stand() } }));
  }

  stand(): Record<string, unknown> {
    const o = this.zugang.offen();
    const slots = o?.projekt.live ? liveSlots(o.projekt) : {};
    return { A: this.slotStand('A', slots.A), B: this.slotStand('B', slots.B) };
  }
  private slotStand(slot: Slot, gruppeId: string | undefined): Record<string, unknown> | null {
    if (gruppeId === undefined) return null;
    const g = this.zugang.offen()!.projekt.gruppen.find((x) => x.id === gruppeId)!;
    const hatStems = this.zugang.offen()!.projekt.gruppen.some((x) => x.ausgang?.id === gruppeId);
    const unbekannt: ModulStand = { stems: 'fehler', grund: 'unbekannt',
      text: 'the stems of this module were never separated in this session; retry with /modul/stems' };
    const mf = this.midi?.fehler(slot), pf = this.midi?.pegelFehler(slot);
    return { gruppe_id: gruppeId, name: g.name, titel: g.modul?.titel, stems: hatStems ? { stems: 'fertig' } : (this.zustand[slot] ?? unbekannt),
      ...(mf ? { midi_fehler: mf } : {}), ...(pf ? { pegel_fehler: pf } : {}) };
  }
  private setze(slot: Slot, s: ModulStand): void {
    this.zustand[slot] = s;
    this.ctx.verteile({ a: 'modul', f: { stand: this.stand() } });
  }

  async exportiere(d: Record<string, unknown>, quelle: 'andreas' | 'cypher'): Promise<Antwort> {
    for (const k of Object.keys(d)) if (k !== 'deck' && k !== 'slot') throw new ProjFehler(400, 'argument_unbekannt', { detail: k });
    if (d.slot !== undefined && d.slot !== 'A' && d.slot !== 'B') throw new ProjFehler(400, 'argument_ungueltig', { detail: "slot: 'A' or 'B'" });
    if (quelle === 'cypher' && this.ctx.kiGestoppt()) throw new ProjFehler(409, 'ki_gestoppt');
    const o0 = this.zugang.offen();
    if (!o0 || !o0.projekt.live) throw new ProjFehler(409, 'kein_liveprojekt');
    const slot = this.waehleSlot(o0.projekt, d.slot as Slot | undefined);
    const a = this.o.deckLoop(d.deck);
    if ('fehler' in a) throw new ProjFehler(a.code, a.fehler, { text: text(a.fehler) });
    const z = this.o.herkunft(a.material_id);
    if (!z || z.typ !== 'track') throw new ProjFehler(409, 'kein_bibliothekstrack');
    this.imBau.add(slot);
    const tmp = path.join(this.zugang.arbeitsordner(), `live-export-${this.zugang.naechsteNummer()}.f32`);
    let wav: string | null = null, uebernommen = false;
    try {
      // the cut: the same code as deck/loop/sichern (loops.ts schneideAusFassung), then the WAV the way stems are written (decision 13)
      fs.mkdirSync(path.dirname(tmp), { recursive: true });
      fs.writeFileSync(tmp, schneideAusFassung(a.basisDatei, a.startFrame, a.frames));
      wav = path.join(o0.ordner, 'loops', `${this.zugang.naechsteNummer()}-${slot}-${a.material_id}.wav`);
      const w = await schreibeWavAusF32Stueckweise(tmp, wav);
      if (w.frames !== a.frames) throw new Error(`${w.frames} frames written, ${a.frames} expected`);
      const o = this.zugang.offen();                                          // fresh; no await up to aendereStand
      if (!o || o.slug !== o0.slug || !o.projekt.live) throw new ProjFehler(409, 'projekt_gewechselt');
      if (liveSlots(o.projekt)[slot] !== undefined) throw this.belegt(slot);
      const exportZeit = this.o.jetzt?.() ?? new Date();
      const herkunft0 = { quelle_sha256: z.sha, titel: (z.titel || 'Untitled').slice(0, 200), ...(z.kuenstler ? { kuenstler: z.kuenstler.slice(0, 200) } : {}),
        fassung: String(a.fassung), basis_bpm: a.basis_bpm, von_beat: a.von_beat, ...(a.eins ? { eins_beat: a.eins } : {}), laenge_beats: a.laenge_beats,
        bpm: z.bpm ?? a.basis_bpm, ...(z.camelot ? { tonart: z.camelot } : {}), datum: exportZeit.toISOString().slice(0, 10) };
      const herkunft = { ...herkunft0, id: neueModulId({ ...herkunft0, slot }, this.zugang.naechsteNummer(), exportZeit) };
      const neu = baueModul(o.projekt, slot, { sha256: w.sha256, pfad: wav, beats: a.laenge_beats, frames: a.frames }, {}, herkunft, quelle);
      const meta = { quelle, label: `Module ${slot} ${herkunft.titel}`.slice(0, 80) };
      const wirkung = aendereStand(o.verlauf, o.projekt, neu, meta, this.zugang.haken());
      uebernommen = true;
      await this.zugang.uebernimm(wirkung, meta);
      const jetzt = this.zugang.offen()!;
      const gruppeId = liveSlots(jetzt.projekt)[slot]!;
      this.setze(slot, { stems: 'wartet' });
      if (this.o.nachExport) {
        try { await this.o.nachExport({ slot, gruppeId, projekt: jetzt.projekt }); } catch (e) {
          this.ctx.log({ typ: 'modul_nach_export_fehler', fehler: (e as Error).message });
        }
      }
      void this.trenne(slot, gruppeId, quelle);                               // in the background: decoding, then the child process
      return { code: 200, j: { slot, gruppe_id: gruppeId, laenge_beats: a.laenge_beats, frames: a.frames, rev: jetzt.projekt.rev, stand: this.stand()[slot] } };
    } catch (e) {
      if (wav && !uebernommen) fs.rmSync(wav, { force: true });
      throw e;
    } finally {
      this.imBau.delete(slot);
      fs.rmSync(tmp, { force: true });
    }
  }

  private belegt(slot: Slot): ProjFehler { return new ProjFehler(409, 'slot_belegt', { slot, text: `live slot ${slot} already holds a module` }); }
  private waehleSlot(p: Projekt, wunsch: Slot | undefined): Slot {
    const frei = (s: Slot): boolean => liveSlots(p)[s] === undefined && !this.imBau.has(s);
    if (wunsch !== undefined) { if (!frei(wunsch)) throw this.belegt(wunsch); return wunsch; }
    const s = (['A', 'B'] as const).find(frei);
    if (!s) throw new ProjFehler(409, 'slot_belegt', { text: 'both live slots hold a module' });
    return s;
  }

  // POST /modul/stems {slot}: separation again for a module without stems (after a failure, a busy GPU or a restart)
  async stemsNeu(d: Record<string, unknown>, quelle: 'andreas' | 'cypher'): Promise<Antwort> {
    for (const k of Object.keys(d)) if (k !== 'slot') throw new ProjFehler(400, 'argument_unbekannt', { detail: k });
    if (d.slot !== 'A' && d.slot !== 'B') throw new ProjFehler(400, 'argument_ungueltig', { detail: "slot: 'A' or 'B'" });
    if (quelle === 'cypher' && this.ctx.kiGestoppt()) throw new ProjFehler(409, 'ki_gestoppt');
    const o = this.zugang.offen();
    if (!o || !o.projekt.live) throw new ProjFehler(409, 'kein_liveprojekt');
    const gruppeId = liveSlots(o.projekt)[d.slot];
    if (gruppeId === undefined) throw new ProjFehler(409, 'slot_leer');
    if (o.projekt.gruppen.some((x) => x.ausgang?.id === gruppeId)) throw new ProjFehler(409, 'modul_hat_stems');
    const s = this.zustand[d.slot]?.stems;
    if (s === 'wartet' || s === 'laeuft') throw new ProjFehler(409, 'stems_laeuft');
    this.setze(d.slot, { stems: 'wartet' });
    void this.trenne(d.slot, gruppeId, quelle);
    return { code: 200, j: { slot: d.slot, stand: this.stand()[d.slot] } };
  }

  private fehler(slot: Slot, grund: string, detail?: string, extra: Partial<ModulStand> = {}): void {
    this.setze(slot, { stems: 'fehler', grund, text: text(grund), ...(detail ? { detail } : {}), ...extra });
  }
  // the loop of a module as the separation needs it, read from the project (so a retry after a restart works the same way)
  private loopVon(p: Projekt, gruppeId: string): { spurId: string; clipId: string; sha256: string; pfad: string; dekodiert: string } | null {
    const spur = p.spuren.find((s) => s.ausgang?.id === gruppeId && s.name === LOOP_SPUR);
    const clip = spur?.clips.find((c) => c.art === 'audio');
    if (!spur || !clip || clip.art !== 'audio') return null;
    return { spurId: spur.id, clipId: clip.id, sha256: clip.quelle.sha256, pfad: clip.quelle.pfad_hinweis, dekodiert: clip.dekodiert };
  }
  private async trenne(slot: Slot, gruppeId: string, quelle: 'andreas' | 'cypher'): Promise<void> {
    const mein = this.zustand[slot];                                          // this run's state object: a newer export replaces it, then this run says nothing
    try {
      const slug = this.zugang.offen()!.slug;
      const gleich = (): Projekt | null => {
        const o = this.zugang.offen();
        return o && o.slug === slug && liveSlots(o.projekt)[slot] === gruppeId ? o.projekt : null;
      };
      // the runner needs the decoded loop (decision 13): wait for it here, inside the job
      const bis = Date.now() + (this.o.zeitlimitDekodierenMs ?? 120_000);
      let l: ReturnType<Modulexport['loopVon']> = null;
      for (;;) {
        const p = gleich();
        if (!p) {                                  // the module or the project is gone: nothing to separate, and `wartet` must not stay
          if (this.zustand[slot] === mein) this.fehler(slot, 'abbruch', 'the project or the module changed while the loop was decoding');
          return;
        }
        l = this.loopVon(p, gruppeId);
        if (!l) return this.fehler(slot, 'stems_fehler', 'the Loop track of the module is gone');
        if (l.dekodiert === 'fertig') break;
        if (l.dekodiert === 'fehler' || Date.now() > bis) return this.fehler(slot, 'audio_fehlt', `the loop was not decoded (${l.dekodiert})`);
        await warte(50);
      }
      const datei = path.join(this.zugang.arbeitsordner(), 'audio', `${l.sha256}.f32`);
      const frames = Math.floor(fs.statSync(datei).size / 8);
      const modul = gleich()!.gruppen.find((g) => g.id === gruppeId)!.modul!;
      const loop = { sha256: l.sha256, pfad: l.pfad, beats: modul.laenge_beats, frames };
      const plan: StemsPlan = { spurId: l.spurId, clipId: l.clipId, clipName: LOOP_SPUR, sha256: l.sha256, von: 0, bis: modul.laenge_beats,
        f0: 0, f1: frames, n: frames, bClip0: 0, start: 0, laenge: LIVE_LOOP_BEATS, offset: 0, tempo: 0, warpText: '' };
      const uebernahme: Uebernahme = {
        dateiName: () => `modul-${slot}`,
        hinfaellig: (o, anzahl) => {
          const veraltet = (grund: string, t: string): Record<string, unknown> => ({ zustand: 'veraltet', grund, text: t });
          if (!o || o.slug !== slug || liveSlots(o.projekt)[slot] !== gruppeId || o.projekt.gruppen.some((x) => x.ausgang?.id === gruppeId)) {
            return veraltet('veraltet', 'the module changed while separating; nothing was placed');
          }
          if (this.loopVon(o.projekt, gruppeId)?.sha256 !== l!.sha256) {
            return veraltet('veraltet', 'the module loop changed while separating; nothing was placed');
          }
          if (o.projekt.spuren.length + anzahl > MAX_SPUREN || o.projekt.gruppen.length + anzahl > MAX_GRUPPEN) {
            return veraltet('zu_viele_spuren', `the stems need ${anzahl} free tracks and groups`);
          }
          return null;
        },
        setze: async (o, dateien, _e, markiere) => {
          const { slot: _s, ...herkunft } = o.projekt.gruppen.find((g) => g.id === gruppeId)!.modul!;
          const neu = baueModul(o.projekt, slot, loop, dateien as Partial<Record<Stem, ModulDatei>>, herkunft, quelle);
          const meta = { quelle, label: `Stems module ${slot}` };
          const w = aendereStand(o.verlauf, o.projekt, neu, meta, this.zugang.haken());
          markiere();
          if (w.eintrag !== null) await this.zugang.uebernimm(w, meta);
          return { slot, rev: this.zugang.offen()?.projekt.rev ?? w.projekt.rev, stems: Object.keys(dateien) };
        },
      };
      const antwort = this.stems.starteTrennung(plan, quelle, uebernahme, (e) => {
        if (e.zustand === 'fertig') {
          this.setze(slot, { stems: 'fertig' });
          if (gleich() && (this.midi || this.o.nachStems)) {
            // task 8: the MIDI paths first (one undo step of their own, never throws), then the store hook sees the module with its new paths
            Promise.resolve().then(async () => {
              if (this.midi) await this.midi.nachStems(slot, gruppeId, quelle);
              const p = gleich();
              if (p && this.o.nachStems) await this.o.nachStems({ slot, gruppeId, projekt: p });
            }).catch((x: Error) => this.ctx.log({ typ: 'modul_nach_stems_fehler', fehler: x.message }));
          }
        }
        else this.fehler(slot, String(e.grund ?? 'stems_fehler'), typeof e.detail === 'string' ? e.detail : undefined,
          typeof e.text === 'string' ? { text: e.text } : {});
      });
      this.setze(slot, { stems: 'laeuft', auftrag_id: (antwort.j as { auftrag_id: number }).auftrag_id });
    } catch (e) {
      if (e instanceof ProjFehler) this.fehler(slot, e.fehler, undefined, typeof e.extra.text === 'string' ? { text: e.extra.text } : {});
      else this.fehler(slot, 'stems_fehler', (e as Error).message);
    }
  }
}

type LiveBereich = Bereich & { modul: Modulexport; leeren: ModulLeeren; blend: ModulBlend; tonart: ModulTonart };
export function liveBereich(ctx: BereichKontext, zugang: ProjZugang, stems: Stems, o: ExportOptionen): LiveBereich {
  const m = new Modulexport(ctx, zugang, stems, o);
  const l = new ModulLeeren(ctx, zugang, o.leeren ?? {});
  const bl = new ModulBlend(ctx, zugang, o.leeren ?? {});
  const tonart = new ModulTonart(ctx, zugang, o.masterTonart);
  const antworte = async (r: http.ServerResponse, f: () => Antwort | Promise<Antwort>): Promise<void> => {
    let x: Antwort;
    try { x = await f(); } catch (e) { x = alsAntwort(e, ctx); }
    json(r, x.code, x.j);
  };
  const routen = (): Route[] => [
    { methode: 'POST', pfad: '/modul/export', schutz: 'fremdePost', handler: async (q, r) => {
      const quelle = ctx.quelle();                                             // before the await (pattern recording.ts:279)
      await antworte(r, async () => m.exportiere(await leseKoerper(q), quelle));
    } },
    { methode: 'POST', pfad: '/modul/stems', schutz: 'fremdePost', handler: async (q, r) => {
      const quelle = ctx.quelle();
      await antworte(r, async () => m.stemsNeu(await leseKoerper(q), quelle));
    } },
    { methode: 'POST', pfad: '/modul/leeren', schutz: 'fremdePost', handler: async (q, r) => {
      const quelle = ctx.quelle();
      await antworte(r, async () => l.leere(await leseKoerper(q), quelle));
    } },
    { methode: 'POST', pfad: '/modul/blend', schutz: 'fremdePost', handler: async (q, r) => {
      const quelle = ctx.quelle();
      await antworte(r, async () => bl.blende(await leseKoerper(q), quelle));
    } },
    { methode: 'POST', pfad: '/modul/tonart', schutz: 'fremdePost', handler: async (q, r) => {
      const quelle = ctx.quelle();
      await antworte(r, async () => tonart.passeAn(await leseKoerper(q), quelle));
    } },
    { methode: 'GET', pfad: '/modul/stand', schutz: 'offen',
      handler: async (_q, r) => antworte(r, () => {
        const st = m.stand() as Record<string, Record<string, unknown> | null>;
        for (const s of ['A', 'B']) if (st[s]) Object.assign(st[s]!, tonart.stand(String(st[s]!.gruppe_id)));
        return { code: 200, j: { ...st, leeren: l.stand(), blend: bl.stand() } };
      }) },
  ];
  return { name: 'live-modul', modul: m, leeren: l, blend: bl, tonart, routen };
}
