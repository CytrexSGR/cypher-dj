// 1.10 slice 7 (T6, spec 5.7, plan D6 to D8): resampling a strip through the core tap /k/arr/abgriff. Pure calculation: the plan with its refusals, the
// Surge tracks that play along in real time, the check that the project is still the one the run started on, and the new project state. No fs,
// no process, no core. The server run lives in areas/proj/output.ts (Ausgabe.resample).
import { fuehreListeAus } from './commands.ts';
import { FREEZE_MAX_BEATS, istWirt, klingendeNoten } from './freeze.ts';
import { PAN_MITTE_DB } from './merge.ts';
import { MAX_SPUREN, sucheGruppe, sucheSpur, type Herkunft, type Projekt, type Spur } from './model.ts';

export const RESAMPLE_MAX_BEATS = FREEZE_MAX_BEATS;   // the core limit of the tap (bis - von, zu_gross above)

// text: English (spec 6.34)
export class ResampleFehler extends Error {
  readonly grund: string;
  readonly text: string;
  constructor(grund: string, text = '') { super(text ? `${grund}: ${text}` : grund); this.grund = grund; this.text = text; }
}
const ab = (grund: string, text: string): never => { throw new ResampleFehler(grund, text); };

export type ResamplePunkt = 'pre' | 'post';
export interface ResamplePlan {
  strangId: string; art: 0 | 1 | 2 | 3; nr: number; name: string; punkt: ResamplePunkt; von: number; bis: number; index: number; tempo: number;
}

// strip kind of the tap (arr 0 track, 1 group, 2 return, 3 production master) and number of the project's own strip id (D6)
function strang(p: Projekt, id: string): { art: 0 | 1 | 2 | 3; nr: number; name: string; index: number } | null {
  if (id === 'master') return { art: 3, nr: 1, name: 'Master', index: p.spuren.length };
  const s = sucheSpur(p, id);
  if (s) return { art: 0, nr: s.nr, name: s.name, index: p.spuren.indexOf(s) + 1 };       // a track: right below the source
  const g = sucheGruppe(p, id);
  if (g) return { art: 1, nr: g.nr, name: g.name, index: p.spuren.length };
  const r = (p.returns ?? []).find((x) => x.id === id);
  return r ? { art: 2, nr: r.nr, name: r.name, index: p.spuren.length } : null;
}

// vorgabe: the default range (Ausgabe.songBereich: loop bracket if on, else the whole song)
export function resamplePlan(p: Projekt, a: Record<string, unknown>, vorgabe: { von: number; bis: number }): ResamplePlan {
  for (const k of Object.keys(a)) if (!['strang_id', 'punkt', 'von_beat', 'bis_beat'].includes(k)) ab('argument_ungueltig', `unknown field ${k}`);
  if (typeof a.strang_id !== 'string' || a.strang_id === '') ab('argument_ungueltig', 'strang_id: a strip id (s<n>, g<n>, r<n> or master) is required');
  if (a.punkt !== undefined && a.punkt !== 'pre' && a.punkt !== 'post') ab('argument_ungueltig', 'punkt: pre or post expected');
  for (const k of ['von_beat', 'bis_beat']) {
    if (a[k] !== undefined && (typeof a[k] !== 'number' || !Number.isFinite(a[k]))) ab('argument_ungueltig', `${k}: a number is required`);
  }
  const st = strang(p, a.strang_id) ?? ab('spur_unbekannt', `there is no strip ${a.strang_id}`);
  const von = (a.von_beat as number | undefined) ?? vorgabe.von, bis = (a.bis_beat as number | undefined) ?? vorgabe.bis;
  if (bis - von > RESAMPLE_MAX_BEATS) ab('zu_gross', `a resample covers at most ${RESAMPLE_MAX_BEATS} beats (beat ${von} to ${bis})`);
  if (!(von >= 0) || !(bis - von >= 1)) {
    ab('export_bereich', `beat ${von} to ${bis}: the range starts at beat 0 or later and is 1 to ${RESAMPLE_MAX_BEATS} beats long`);
  }
  if (p.spuren.length >= MAX_SPUREN) ab('merge_keine_spur_frei', `all ${MAX_SPUREN} tracks are used`);
  return { strangId: a.strang_id, art: st.art, nr: st.nr, name: st.name, punkt: (a.punkt as ResamplePunkt | undefined) ?? 'post', von, bis,
    index: st.index, tempo: p.tempo_bpm };
}

// D10: the Surge tracks that play into the strip in this range and are not frozen play along in real time through the host: a dead host would give a
// silent file. Muted tracks do not count. A track feeds its own strip; a group the tracks whose target it is; a return and the master every track.
export function wirtSpurenImStrang(p: Projekt, z: ResamplePlan): Spur[] {
  const quellen = z.art === 0 ? p.spuren.filter((s) => s.id === z.strangId)
    : z.art === 1 ? p.spuren.filter((s) => s.ausgang?.id === z.strangId) : p.spuren;
  return quellen.filter((s) => istWirt(s) && !s.freeze && !s.mute && klingendeNoten(s) > 0
    && s.clips.some((c) => c.start_beat < z.bis && c.start_beat + c.laenge_beats > z.von));
}

// what must still hold after the run: the tempo (the WAV is fixed in seconds), the strip, a free track slot. null = still the project of the start
export function pruefeResampleNochGleich(p: Projekt, z: ResamplePlan): 'veraltet' | 'merge_keine_spur_frei' | null {
  if (p.tempo_bpm !== z.tempo || strang(p, z.strangId) === null) return 'veraltet';
  if (p.spuren.length >= MAX_SPUREN) return 'merge_keine_spur_frei';
  return null;
}

// D8: a copy, each command one by one through fuehreListeAus (pattern baueMergeProjekt); the source stays untouched
export function baueResampleProjekt(p0: Projekt, z: ResamplePlan, datei: { sha256: string; pfad: string }, quelle: Herkunft):
  { projekt: Projekt; spurId: string } {
  const lauf = (p: Projekt, b: unknown): Projekt => fuehreListeAus(p, [b], { quelle }).projekt;
  const name = `${z.name} (resampled)`.slice(0, 80);
  let p = lauf(p0, { befehl: 'spur_neu', art: 'audio', name });
  const id = p.spuren[p.spuren.length - 1].id;                                   // spur_neu appends at the end
  if (z.index < p.spuren.length - 1) p = lauf(p, { befehl: 'spur_verschieben', spur_id: id, index: z.index });
  p = lauf(p, { befehl: 'clip_neu', spur_id: id, art: 'audio', start_beat: z.von, laenge_beats: z.bis - z.von, sha256: datei.sha256,
    pfad_hinweis: datei.pfad, name });
  const c = sucheSpur(p, id)!.clips[0];
  // the tap holds the pan law of the source already, the new track applies it once more at pan 0 (same compensation as the merge)
  p = lauf(p, { befehl: 'clip_aendern', clip_id: c.id, gain_db: PAN_MITTE_DB });
  return { projekt: p, spurId: id };
}
