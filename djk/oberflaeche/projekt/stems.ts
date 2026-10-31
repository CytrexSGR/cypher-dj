// Paket 1.13 Slice 6 (G08): reine Stems-Rechnung. Ziel und Ausschnitt in Quell-Frames (D5, D9, D14), Warp der Stem-Clips (D5 bis D7), der neue Stand nach
// dem Lauf (F4: Original im Bereich stumm, vier Stem-Spuren darunter, Gruppe D8) und die Veraltet-Prüfung (D16). Kein fs, kein Prozess.
// Clip-Beat zur Projekt-Beat P: P − start_beat + warp.versatz_beats (wiedergabe.ts:110-112); gewarpt heißt warp.an (sonst offset_s und tempo_bpm).
import { fuehreListeAus } from './befehle.ts';
import { MAX_GRUPPEN, MAX_SPUREN, SAMPLERATE, sucheClip, sucheSpur, type AudioClip, type Herkunft, type Projekt, type Warp } from './modell.ts';
import { beatBeiQuelle, quellSekunde } from './warp.ts';

export const STEMS = ['drums', 'bass', 'other', 'vocals'] as const;
export type Stem = (typeof STEMS)[number];
const STEM_NAME: Record<Stem, string> = { drums: 'Drums', bass: 'Bass', other: 'Other', vocals: 'Vocals' };
export const STEMS_MAX_S = 600;                                                 // D9
const EPS = 1e-9;

export class StemsFehler extends Error {
  readonly grund: string;
  constructor(grund: string, text: string) { super(text); this.grund = grund; }
}
const ab = (grund: string, text: string): never => { throw new StemsFehler(grund, text); };

export interface StemsPlan {
  spurId: string; clipId: string; clipName: string; sha256: string; von: number; bis: number; f0: number; f1: number; n: number;
  bClip0: number;                                                                // Clip-Beat am Bereichsanfang (Versatz der Stem-Clips)
  start: number; laenge: number; offset: number; tempo: number; warpText: string;              // Stand des Clips beim Start (D16)
}

const gewarpt = (c: AudioClip): c is AudioClip & { warp: Warp } => c.warp?.an === true;
function quellS(p: Projekt, c: AudioClip, beat: number): number {
  return gewarpt(c) ? quellSekunde(c.warp.marker, beat - c.start_beat + c.warp.versatz_beats) : c.offset_s + (beat - c.start_beat) * 60 / p.tempo_bpm;
}

export function stemsPlan(p: Projekt, a: { clip_id?: unknown; spur_id?: unknown; von_beat?: unknown; bis_beat?: unknown }): StemsPlan {
  if ((a.clip_id === undefined) === (a.spur_id === undefined)) ab('argument_ungueltig', 'give exactly one of clip_id and spur_id');
  for (const k of ['von_beat', 'bis_beat'] as const) {
    if (a[k] !== undefined && (typeof a[k] !== 'number' || !Number.isFinite(a[k] as number))) ab('argument_ungueltig', `${k}: number expected`);
  }
  let clip: AudioClip, spurId: string;
  if (a.clip_id !== undefined) {
    const g = typeof a.clip_id === 'string' ? sucheClip(p, a.clip_id) : undefined;
    if (!g) return ab('clip_unbekannt', String(a.clip_id));
    if (g.clip.art !== 'audio') return ab('feld_nur_audio', 'stems need an audio clip');
    clip = g.clip; spurId = g.spur.id;
  } else {
    const s = typeof a.spur_id === 'string' ? sucheSpur(p, a.spur_id) : undefined;
    if (!s) return ab('spur_unbekannt', String(a.spur_id));
    const v = (a.von_beat as number | undefined) ?? -Infinity, b = (a.bis_beat as number | undefined) ?? Infinity;
    const treffer = s.clips.filter((c) => c.art === 'audio' && c.start_beat < b - EPS && c.start_beat + c.laenge_beats > v + EPS);
    if (treffer.length !== 1) return ab('mehrere_clips', `${treffer.length} audio clips in the range; exactly one is needed`);
    clip = treffer[0] as AudioClip; spurId = s.id;
  }
  if (clip.loop_beats != null) ab('stems_loop', clip.id);
  const ende = clip.start_beat + clip.laenge_beats;
  const v = a.von_beat as number | undefined, b = a.bis_beat as number | undefined;
  const von = a.clip_id !== undefined ? (v ?? clip.start_beat) : Math.max(clip.start_beat, v ?? -Infinity);
  const bis = a.clip_id !== undefined ? (b ?? ende) : Math.min(ende, b ?? Infinity);
  if (!(von >= clip.start_beat - EPS && bis <= ende + EPS && bis - von > EPS)) ab('argument_ungueltig', 'von_beat..bis_beat must lie inside the clip');
  const f0 = Math.round(quellS(p, clip, von) * SAMPLERATE), f1 = Math.round(quellS(p, clip, bis) * SAMPLERATE);
  if (f1 <= f0) ab('argument_ungueltig', 'the range is empty in the source');
  if ((f1 - f0) / SAMPLERATE > STEMS_MAX_S) ab('stems_zu_gross', `the range is ${Math.round((f1 - f0) / SAMPLERATE)} s of source, at most ${STEMS_MAX_S} s`);
  if (p.spuren.length + STEMS.length > MAX_SPUREN) ab('zu_viele_spuren', `stems need ${STEMS.length} free tracks (${MAX_SPUREN - p.spuren.length} free)`);
  return { spurId, clipId: clip.id, clipName: clip.name, sha256: clip.quelle.sha256, von, bis, f0, f1, n: f1 - f0,
    bClip0: gewarpt(clip) ? von - clip.start_beat + clip.warp.versatz_beats : 0,
    start: clip.start_beat, laenge: clip.laenge_beats, offset: clip.offset_s, tempo: p.tempo_bpm, warpText: JSON.stringify(clip.warp ?? null) };
}

// D5: Marker um F0/48000 s verschoben; an den Rändern Marker auf der Geraden des Originals (beatBeiQuelle), innen nur Marker ≥ 1 Frame vom Rand
export function stemWarp(w: Warp, bClip0: number, f0: number, f1: number): Warp {
  const s0 = f0 / SAMPLERATE, s1 = f1 / SAMPLERATE;
  const innen = w.marker.filter(([s]) => s * SAMPLERATE > f0 + 1 && s * SAMPLERATE < f1 - 1).map(([s, b]): [number, number] => [s - s0, b]);
  return { an: true, modus: w.modus, marker: [[0, beatBeiQuelle(w.marker, s0)], ...innen, [(f1 - f0) / SAMPLERATE, beatBeiQuelle(w.marker, s1)]],
    versatz_beats: bClip0, quelle: w.quelle, transpose_st: w.transpose_st, detune_ct: w.detune_ct,
    ...(w.beats ? { beats: structuredClone(w.beats) } : {}) };
}

// F4 und D8: teilt das Original an den Bereichsgrenzen, setzt das Mittelstück stumm, legt vier Spuren direkt unter die Quellspur, je einen Clip
// über den Bereich (Warp nach stemWarp, sonst offset 0), Gain und Fades des Mittelstücks, und eine Gruppe „Stems: <Name>“, solange eine frei ist.
export function baueStemsProjekt(p0: Projekt, z: StemsPlan, dateien: Record<Stem, { sha256: string; pfad: string }>, quelle: Herkunft):
  { projekt: Projekt; spuren: string[]; hinweis?: string } {
  const lauf = (p: Projekt, b: unknown): Projekt => fuehreListeAus(p, [b], { quelle }).projekt;
  let p = p0;
  const clipId = (id: string) => sucheSpur(p, z.spurId)!.clips.find((c) => c.id === id) as AudioClip;
  const neuerClip = (vorher: Projekt, nachher: Projekt): string => {                // Id aus dem Unterschied der Id-Mengen, nie über den Startbeat
    const alt = new Set(sucheSpur(vorher, z.spurId)!.clips.map((c) => c.id));
    return sucheSpur(nachher, z.spurId)!.clips.find((c) => !alt.has(c.id))!.id;
  };
  let mitteId = z.clipId;
  if (z.von > z.start + EPS) {
    const v = p; p = lauf(p, { befehl: 'clip_teilen', clip_id: z.clipId, beat: z.von }); mitteId = neuerClip(v, p);
  }
  const mitte = clipId(mitteId);
  if (z.bis < mitte.start_beat + mitte.laenge_beats - EPS) p = lauf(p, { befehl: 'clip_teilen', clip_id: mitteId, beat: z.bis });
  const m = clipId(mitteId);
  p = lauf(p, { befehl: 'clip_aendern', clip_id: m.id, stumm: true });
  const index = p.spuren.findIndex((s) => s.id === z.spurId);
  const spuren: string[] = [];
  STEMS.forEach((stem, i) => {
    p = lauf(p, { befehl: 'spur_neu', art: 'audio', name: `${z.clipName.slice(0, 70)} ${STEM_NAME[stem]}` });
    const id = p.spuren[p.spuren.length - 1].id;                                 // spur_neu hängt hinten an (befehle.ts:213-230)
    p = lauf(p, { befehl: 'spur_verschieben', spur_id: id, index: index + 1 + i });
    const q = sucheSpur(p, z.spurId)!;                                          // Review MINOR 6: Fader und Pan der Quellspur erben, Ausgang nach D8
    // mute erben (stumme Quelle, stumme Stems); solo nicht (Abhörzustand); Gruppen verschachteln nicht (Gruppe hat keinen Ausgang), also bleibt D8
    if (q.fader_db !== 0 || q.pan !== 0 || q.mute) p = lauf(p, { befehl: 'spur_aendern', spur_id: id, fader_db: q.fader_db, pan: q.pan, mute: q.mute });
    p = lauf(p, { befehl: 'clip_neu', spur_id: id, art: 'audio', start_beat: z.von, laenge_beats: z.bis - z.von, sha256: dateien[stem].sha256,
      pfad_hinweis: dateien[stem].pfad, name: `${z.clipName.slice(0, 70)} ${STEM_NAME[stem]}`,
      ...(gewarpt(m) ? { warp: stemWarp(m.warp, z.bClip0, z.f0, z.f1) } : {}) });
    const c = sucheSpur(p, id)!.clips[0];
    const extra = { ...(m.gain_db !== 0 ? { gain_db: m.gain_db } : {}), ...(m.fade_ein_beats !== 0 ? { fade_ein_beats: m.fade_ein_beats } : {}),
      ...(m.fade_aus_beats !== 0 ? { fade_aus_beats: m.fade_aus_beats } : {}) };
    if (Object.keys(extra).length) p = lauf(p, { befehl: 'clip_aendern', clip_id: c.id, ...extra });
    spuren.push(id);
  });
  if ((p.gruppen?.length ?? 0) >= MAX_GRUPPEN) return { projekt: p, spuren, hinweis: 'stems_ohne_gruppe' };
  p = lauf(p, { befehl: 'gruppenspur_neu', name: `Stems: ${z.clipName}`.slice(0, 80), mitglieder: spuren });
  return { projekt: p, spuren };
}

// D16: null = der Clip ist noch der vom Start; sonst der Grund
export function pruefeNochGleich(p: Projekt, z: StemsPlan): 'veraltet' | 'zu_viele_spuren' | null {
  const g = sucheClip(p, z.clipId);
  if (!g || g.clip.art !== 'audio' || g.spur.id !== z.spurId) return 'veraltet';
  const c = g.clip;
  if (c.quelle.sha256 !== z.sha256 || c.start_beat !== z.start || c.laenge_beats !== z.laenge || c.loop_beats != null) return 'veraltet';
  if (JSON.stringify(c.warp ?? null) !== z.warpText) return 'veraltet';
  if (!gewarpt(c) && (c.offset_s !== z.offset || p.tempo_bpm !== z.tempo)) return 'veraltet';   // ungewarpt hängt F0 am Tempo (wie setze)
  if (z.von < c.start_beat - EPS || z.bis > c.start_beat + c.laenge_beats + EPS) return 'veraltet';
  if (p.spuren.length + STEMS.length > MAX_SPUREN) return 'zu_viele_spuren';
  return null;
}
