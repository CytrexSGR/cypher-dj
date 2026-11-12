// Plan live-module task 8 (decisions 8, 9): the new instrument paths of a module. When the stems have arrived (the nachStems chain of export.ts), this
// runs the task-7 extractor (werkstatt.midi_aus_stem) on the Drums and Bass stem files, one child process each at nice 19 (never computed in the event
// loop), and then baueNeuePfade adds the instrument tracks with the MIDI clips in ONE undo step. It is all or nothing: if either extraction fails, the
// module gets no new path and the reason stands in GET /modul/stand under `midi_fehler`; the stems and the loop keep playing as they are.
import { execFile } from 'node:child_process';
import type { BereichKontext } from '../../http/router.ts';
import { aendereStand } from '../../project/state.ts';
import { baueNeuePfade, liveSlots, type NeuStem, type NeueNote } from '../../project/live.ts';
import { fuehreListeAus } from '../../project/commands.ts';
import { blendPfad, type Projekt } from '../../project/model.ts';
import { pegelVersatz, type PegelMesser } from './level.ts';
import type { ProjZugang } from '../proj/area.ts';

type Slot = 'A' | 'B';
export type MidiLauf = (art: NeuStem, wav: string, beats: number) => Promise<NeueNote[]>;
export interface MidiOptionen {
  laufe?: MidiLauf;                       // the extractor; absent = the real runner (python + cwd below)
  python?: string; cwd?: string;          // the real runner: the interpreter (as StemsOptionen.python) and djk/workshop
  zeitlimitMs?: number;                   // per extraction, default 180 s
  pegel?: PegelMesser;                    // the level measure of the new paths (render of one track); absent = no trim
  zeitlimitDekodierenMs?: number;         // wait for the decoded stems before measuring (default 60 s)
}
export interface MidiFehler { grund: string; text: string; detail?: string }
const STEM_NAME: Record<NeuStem, string> = { drums: 'Drums', bass: 'Bass' };

// python -m werkstatt.midi_off_stem drums|bass <wav> <beats> -> stdout {"noten": [...]} or exit 2 {"fehler": ...}
export function pythonMidiLauf(o: { python: string; cwd: string; zeitlimitMs?: number }): MidiLauf {
  return (art, wav, beats) => new Promise((ok, nein) => {
    execFile('nice', ['-n', '19', o.python, '-m', 'werkstatt.midi_off_stem', art, wav, String(beats)],
      { cwd: o.cwd, timeout: o.zeitlimitMs ?? 180_000, maxBuffer: 16 << 20 }, (e, aus) => {
        let j: { noten?: NeueNote[]; fehler?: string } | null = null;
        try { j = JSON.parse(aus); } catch { /* not JSON: the error below */ }
        if (j?.noten) return ok(j.noten);
        nein(new Error(j?.fehler ? `midi_aus_stem ${art}: ${j.fehler}` : `midi_aus_stem ${art}: ${e ? e.message : 'no output'}`));
      });
  });
}

export class ModulMidi {
  private readonly fehler_: Partial<Record<Slot, MidiFehler>> = {};
  private readonly ctx: BereichKontext;
  private readonly zugang: ProjZugang;
  private readonly laufe: MidiLauf;
  private readonly o: MidiOptionen;
  private readonly pegelFehler_: Partial<Record<Slot, MidiFehler>> = {};
  private readonly bei: () => void;
  constructor(ctx: BereichKontext, zugang: ProjZugang, o: MidiOptionen, bei: () => void) {
    this.ctx = ctx; this.zugang = zugang; this.bei = bei; this.o = o;
    this.laufe = o.laufe ?? pythonMidiLauf({ python: o.python ?? 'python3', cwd: o.cwd ?? process.cwd(), zeitlimitMs: o.zeitlimitMs });
  }
  fehler(slot: Slot): MidiFehler | undefined { return this.fehler_[slot]; }
  pegelFehler(slot: Slot): MidiFehler | undefined { return this.pegelFehler_[slot]; }
  private setze(slot: Slot, f: MidiFehler | undefined): void {
    if (f) this.fehler_[slot] = f; else delete this.fehler_[slot];
    this.bei();
  }

  // the stem file of a stem group: the clip of its original audio track
  private stemDatei(p: Projekt, gruppeId: string, stem: NeuStem): string | null {
    const kind = p.gruppen.find((g) => g.ausgang?.id === gruppeId && g.name === STEM_NAME[stem]);
    const spur = kind && p.spuren.find((s) => s.ausgang?.id === kind.id && s.art === 'audio');
    const clip = spur?.clips.find((c) => c.art === 'audio');
    return clip && clip.art === 'audio' ? clip.quelle.pfad_hinweis : null;
  }

  // The level offsets of the new paths (stem group id -> dB), measured on a preview of the finished module. A failure leaves the offset 0 and the reason
  // in /modul/stand under `pegel_fehler`; the module is built all the same. Waits first until the stems are decoded (the render needs the files).
  private async messePegel(slot: Slot, gruppeId: string, noten: Partial<Record<NeuStem, NeueNote[]>>,
    quelle: 'andreas' | 'cypher'): Promise<Map<string, number>> {
    const aus = new Map<string, number>();
    if (!this.o.pegel) return aus;
    const fehl: string[] = [];
    try {
      const bis = Date.now() + (this.o.zeitlimitDekodierenMs ?? 60_000);
      for (;;) {
        const o = this.zugang.offen();
        if (!o || liveSlots(o.projekt)[slot] !== gruppeId) return aus;
        const offen = o.projekt.spuren.some((s) => s.ausgang && o.projekt.gruppen.some((k) => k.id === s.ausgang!.id && k.ausgang?.id === gruppeId)
          && s.clips.some((c) => c.art === 'audio' && c.dekodiert !== 'fertig'));
        if (!offen) break;
        if (Date.now() > bis) throw new Error('the stems were not decoded in time');
        await new Promise((r) => setTimeout(r, 50));
      }
      const vorschau = baueNeuePfade(this.zugang.offen()!.projekt, slot, noten, quelle);
      for (const stem of ['drums', 'bass'] as const) {
        const kind = vorschau.gruppen.find((g) => g.ausgang?.id === gruppeId && g.name === STEM_NAME[stem]);
        const pf = kind ? blendPfad(vorschau, kind.id) : null;
        if (!kind || !pf) continue;
        try { aus.set(kind.id, await pegelVersatz(this.o.pegel, vorschau, pf.original.id, pf.neu.id)); } catch (e) {
          fehl.push(`${STEM_NAME[stem]}: ${(e as Error).message}`);
        }
      }
    } catch (e) { fehl.push((e as Error).message); }
    if (fehl.length > 0) {
      this.ctx.log({ typ: 'modul_pegel_fehler', slot, fehler: fehl.join('; ') });
      const text = 'the level of the new path could not be measured; its trim stays 0 dB';
      this.pegelFehler_[slot] = { grund: 'pegel_fehler', text, detail: fehl.join('; ') };
    } else delete this.pegelFehler_[slot];
    this.bei();
    return aus;
  }

  // Never throws: every failure becomes `midi_fehler` of the slot.
  async nachStems(slot: Slot, gruppeId: string, quelle: 'andreas' | 'cypher'): Promise<void> {
    const gleich = (): { o: NonNullable<ReturnType<ProjZugang['offen']>>; p: Projekt } | null => {
      const o = this.zugang.offen();
      return o && o.projekt.live && liveSlots(o.projekt)[slot] === gruppeId ? { o, p: o.projekt } : null;
    };
    try {
      const g0 = gleich();
      if (!g0) return;
      const slug = g0.o.slug;
      const beats = g0.p.gruppen.find((g) => g.id === gruppeId)!.modul!.laenge_beats;
      const noten: Partial<Record<NeuStem, NeueNote[]>> = {};
      const fehl: string[] = [];
      for (const stem of ['drums', 'bass'] as const) {
        const wav = this.stemDatei(g0.p, gruppeId, stem);
        if (wav === null) continue;                                         // this module has no such stem (nothing to extract)
        try { noten[stem] = await this.laufe(stem, wav, beats); } catch (e) { fehl.push((e as Error).message); }
      }
      if (fehl.length > 0) {
        const text = 'the MIDI extraction failed; the module keeps its stems without new paths';
        return this.setze(slot, { grund: 'midi_fehler', text, detail: fehl.join('; ') });
      }
      const g = gleich();
      if (!g || g.o.slug !== slug) return;                                  // the module changed meanwhile: nothing is placed
      const trims = await this.messePegel(slot, gruppeId, noten, quelle);
      const g2 = gleich();
      if (!g2 || g2.o.slug !== slug) return;
      let neu = baueNeuePfade(g2.p, slot, noten, quelle);
      for (const [kindId, db] of trims) neu = fuehreListeAus(neu, [{ befehl: 'blend_trim_setzen', gruppe_id: kindId, db }], { quelle }).projekt;
      if (neu !== g2.p) {
        const meta = { quelle, label: `New paths module ${slot}` };
        const w = aendereStand(g2.o.verlauf, g2.p, neu, meta, this.zugang.haken());
        if (w.eintrag !== null) await this.zugang.uebernimm(w, meta);
      }
      this.setze(slot, undefined);
    } catch (e) {
      this.ctx.log({ typ: 'modul_midi_fehler', slot, fehler: (e as Error).message });
      this.setze(slot, { grund: 'midi_fehler', text: 'the new paths could not be built; the module keeps its stems', detail: (e as Error).message });
    }
  }
}
