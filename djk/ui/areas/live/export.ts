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
import { schneideAusFassung, leseLoopQuelle, type LoopQuelle } from '../../loops.ts';
import { schreibeWavAusF32Stueckweise } from '../../project/recording.ts';
import { aendereStand } from '../../project/state.ts';
import { neueModulId } from '../../project/module_storage.ts';
import { baueModul, liveSlots, normiereSlot, LIVE_LOOP_BEATS, LOOP_SPUR, type ModulDatei, type ModulLoop, type ModulHerkunftSlot } from '../../project/live.ts';
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
  // DJ view places task 7 (decision 10): is the channel of the slot (`pad/1`, `pad/2`) open? An open channel refuses the export (kanal_offen); PFL is no reason.
  kanalOffen?(kanal: string): boolean;
  // DJ view places task 10: the loop library folder (POST /modul/loop); absent = the verb answers loop_unbekannt
  loopOrdner?(): string;
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
    if (d.slot !== undefined) {                                                // 1/2 and A/B (decision 13)
      const s0 = normiereSlot(d.slot);
      if (s0 === undefined) throw new ProjFehler(400, 'argument_ungueltig', { detail: "slot: 1, 2, 'A' or 'B'" });
      d = { ...d, slot: s0 };
    }
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
      const exportZeit = this.o.jetzt?.() ?? new Date();
      const herkunft0 = { quelle_sha256: z.sha, titel: (z.titel || 'Untitled').slice(0, 200), ...(z.kuenstler ? { kuenstler: z.kuenstler.slice(0, 200) } : {}),
        fassung: String(a.fassung), basis_bpm: a.basis_bpm, von_beat: a.von_beat, ...(a.eins ? { eins_beat: a.eins } : {}), laenge_beats: a.laenge_beats,
        bpm: z.bpm ?? a.basis_bpm, ...(z.camelot ? { tonart: z.camelot } : {}), datum: exportZeit.toISOString().slice(0, 10) };
      return await this.legeAb(slot, o0, { sha256: w.sha256, pfad: wav, beats: a.laenge_beats, frames: a.frames }, herkunft0, exportZeit, quelle, () => { uebernommen = true; });
    } catch (e) {
      if (wav && !uebernommen) fs.rmSync(wav, { force: true });
      throw e;
    } finally {
      this.imBau.delete(slot);
      fs.rmSync(tmp, { force: true });
    }
  }

  // The part both verbs share: with the WAV written, place the module (checks that may have changed while the file was written, one undo step, the
  // store hook, the separation in the background). `markiere` runs once the project owns the file, so the caller keeps the WAV from then on.
  private async legeAb(slot: Slot, o0: NonNullable<ReturnType<ProjZugang['offen']>>, loop: ModulLoop, herkunft0: Omit<ModulHerkunftSlot, 'slot' | 'id'>,
    exportZeit: Date, quelle: 'andreas' | 'cypher', markiere: () => void): Promise<Antwort> {
    const o = this.zugang.offen();                                          // fresh; no await up to aendereStand
    if (!o || o.slug !== o0.slug || !o.projekt.live) throw new ProjFehler(409, 'projekt_gewechselt');
    if (liveSlots(o.projekt)[slot] !== undefined) throw this.belegt(slot);
    this.pruefeKanal(slot);                                                 // the fader may have moved while the WAV was written
    const herkunft = { ...herkunft0, id: neueModulId({ ...herkunft0, slot }, this.zugang.naechsteNummer(), exportZeit) };
    const neu = baueModul(o.projekt, slot, loop, {}, herkunft, quelle);
    const meta = { quelle, label: `Module ${slot} ${herkunft.titel}`.slice(0, 80) };
    const wirkung = aendereStand(o.verlauf, o.projekt, neu, meta, this.zugang.haken());
    markiere();
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
    return { code: 200, j: { slot, gruppe_id: gruppeId, laenge_beats: loop.beats, frames: loop.frames, rev: jetzt.projekt.rev, stand: this.stand()[slot] } };
  }

  // POST /modul/loop {name, slot?}: a loop of the loop library becomes a module (DJ view places task 10, spec 7). Same rules as the deck export: the
  // slot (1/2 or A/B) must be free and its channel closed, nothing is created when it is refused. The loop is written as a project WAV, the module sounds
  // through its Loop track at once; separation follows (a busy GPU leaves it loop-only, the state says so).
  async ladeLoop(d: Record<string, unknown>, quelle: 'andreas' | 'cypher'): Promise<Antwort> {
    for (const k of Object.keys(d)) if (k !== 'name' && k !== 'slot') throw new ProjFehler(400, 'argument_unbekannt', { detail: k });
    if (typeof d.name !== 'string') throw new ProjFehler(400, 'argument_ungueltig', { detail: 'name: a loop of the loop library' });
    let wunsch: Slot | undefined;
    if (d.slot !== undefined) {
      wunsch = normiereSlot(d.slot);
      if (wunsch === undefined) throw new ProjFehler(400, 'slot_ungueltig', { text: text('slot_ungueltig') });
    }
    if (quelle === 'cypher' && this.ctx.kiGestoppt()) throw new ProjFehler(409, 'ki_gestoppt');
    const o0 = this.zugang.offen();
    if (!o0 || !o0.projekt.live) throw new ProjFehler(409, 'kein_liveprojekt');
    const dir = this.o.loopOrdner?.();
    const l = dir === undefined ? null : leseLoopQuelle(dir, d.name);
    if (!l) throw new ProjFehler(404, 'loop_unbekannt', { text: text('loop_unbekannt') });
    const slot = this.waehleSlot(o0.projekt, wunsch);
    this.imBau.add(slot);
    let wav: string | null = null, uebernommen = false;
    try {
      wav = path.join(o0.ordner, 'loops', `${this.zugang.naechsteNummer()}-${slot}-${l.name}.wav`);
      fs.mkdirSync(path.dirname(wav), { recursive: true });
      const w = await schreibeWavAusF32Stueckweise(l.datei, wav);
      if (w.frames !== l.frames) throw new Error(`${w.frames} frames written, ${l.frames} expected`);
      const zeit = this.o.jetzt?.() ?? new Date();
      return await this.legeAb(slot, o0, { sha256: w.sha256, pfad: wav, beats: l.beats, frames: l.frames }, this.loopHerkunft(l, zeit), zeit, quelle, () => { uebernommen = true; });
    } catch (e) {
      if (wav && !uebernommen) fs.rmSync(wav, { force: true });
      throw e;
    } finally {
      this.imBau.delete(slot);
    }
  }
  // The module origin of a library loop (decision 12): 128 bpm, from beat 0; the bar phase comes from the loop's grid offset. A deck loop or an import
  // keeps its origin (catalogue track or source sha); a recorded loop has none and gets the placeholder sha plus quelle 'mitschnitt'.
  private loopHerkunft(l: LoopQuelle, zeit: Date): Omit<ModulHerkunftSlot, 'slot' | 'id'> {
    const PLATZHALTER = '0'.repeat(64), h = l.herkunft;
    const z = h && typeof h.material_id === 'string' ? this.o.herkunft(h.material_id) : null;
    const sha = z?.sha ?? (h && typeof h.sha === 'string' && /^[0-9a-f]{64}$/.test(h.sha) ? h.sha : PLATZHALTER);
    return { quelle_sha256: sha, titel: l.name, ...(z?.kuenstler ? { kuenstler: z.kuenstler.slice(0, 200) } : {}),
      fassung: h && h.fassung !== undefined ? String(h.fassung).slice(0, 200) : '0', basis_bpm: 128, von_beat: 0,
      ...(l.versatz_frames !== 0 ? { eins_beat: l.versatz_frames / 22500 } : {}), laenge_beats: l.beats, bpm: 128,
      ...(z?.camelot ? { tonart: z.camelot } : {}), datum: zeit.toISOString().slice(0, 10), ...(h === null ? { quelle: 'mitschnitt' as const } : {}) };
  }

  private pruefeKanal(slot: Slot): void {
    const kanal = `pad/${slot === 'A' ? 1 : 2}`;
    if (this.o.kanalOffen?.(kanal)) throw new ProjFehler(409, 'kanal_offen', { slot, kanal, text: `the channel ${kanal} of Loop ${slot === 'A' ? 1 : 2} is open; close it before a module is placed` });
  }
  private belegt(slot: Slot): ProjFehler { return new ProjFehler(409, 'slot_belegt', { slot, text: `Loop ${slot === 'A' ? 1 : 2} already holds a module` }); }
  private waehleSlot(p: Projekt, wunsch: Slot | undefined): Slot {
    const frei = (s: Slot): boolean => liveSlots(p)[s] === undefined && !this.imBau.has(s);
    if (wunsch !== undefined) { if (!frei(wunsch)) throw this.belegt(wunsch); this.pruefeKanal(wunsch); return wunsch; }
    // without a slot: the first free slot whose channel is closed (an open channel is skipped); refused only when none fits
    const freie = (['A', 'B'] as const).filter(frei);
    if (freie.length === 0) throw new ProjFehler(409, 'slot_belegt', { text: 'both live slots hold a module' });
    const s = freie.find((x) => !this.o.kanalOffen?.(`pad/${x === 'A' ? 1 : 2}`));
    if (!s) throw new ProjFehler(409, 'kanal_offen', { text: `the channel of every free loop slot is open (${freie.map((x) => `pad/${x === 'A' ? 1 : 2}`).join(' and ')}); close one before a module is placed` });
    return s;
  }

  // POST /modul/stems {slot}: separation again for a module without stems (after a failure, a busy GPU or a restart)
  async stemsNeu(d: Record<string, unknown>, quelle: 'andreas' | 'cypher'): Promise<Antwort> {
    for (const k of Object.keys(d)) if (k !== 'slot') throw new ProjFehler(400, 'argument_unbekannt', { detail: k });
    const s0 = normiereSlot(d.slot);                                           // 1/2 and A/B (decision 13)
    if (s0 === undefined) throw new ProjFehler(400, 'argument_ungueltig', { detail: "slot: 1, 2, 'A' or 'B'" });
    d = { ...d, slot: s0 };
    if (quelle === 'cypher' && this.ctx.kiGestoppt()) throw new ProjFehler(409, 'ki_gestoppt');
    const o = this.zugang.offen();
    if (!o || !o.projekt.live) throw new ProjFehler(409, 'kein_liveprojekt');
    const gruppeId = liveSlots(o.projekt)[s0];
    if (gruppeId === undefined) throw new ProjFehler(409, 'slot_leer');
    if (o.projekt.gruppen.some((x) => x.ausgang?.id === gruppeId)) throw new ProjFehler(409, 'modul_hat_stems');
    const s = this.zustand[s0]?.stems;
    if (s === 'wartet' || s === 'laeuft') throw new ProjFehler(409, 'stems_laeuft');
    this.setze(s0, { stems: 'wartet' });
    void this.trenne(s0, gruppeId, quelle);
    return { code: 200, j: { slot: s0, stand: this.stand()[s0] } };
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
    { methode: 'POST', pfad: '/modul/loop', schutz: 'fremdePost', handler: async (q, r) => {
      const quelle = ctx.quelle();
      await antworte(r, async () => m.ladeLoop(await leseKoerper(q), quelle));
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
