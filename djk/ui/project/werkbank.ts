// Loop workbench (stage 1): the module marker of a project and its limits. A module is an ordinary production project with the marker
// `werkbank: {schema: 1}`; the marker is never set together with `live`.
import type { Note, Projekt } from './model.ts';

export type WerkbankMarke = { schema: 1 };

// at most this many instrument tracks in a module
export const MAX_WERKBANK_SPUREN = 8;

// The check of a marker (null = fine), as {grund, text}: grund names the field, text says what is expected.
export function werkbankPruefung(x: unknown): { grund: string; text: string } | null {
  const o = typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
  if (o === null) return { grund: 'werkbank', text: 'werkbank: an object {schema: 1} expected' };
  const extra = Object.keys(o).filter((k) => k !== 'schema');
  if (extra.length > 0) return { grund: 'werkbank', text: `werkbank: unknown field ${extra[0]}` };
  if (o.schema !== 1) return { grund: 'werkbank', text: 'werkbank.schema: 1 expected' };
  return null;
}

export const istWerkbank = (p: Projekt): boolean => p.werkbank !== undefined;

// ---- templates -------------------------------------------------------------------------------------------------------------------
export type VorlagenNote = Omit<Note, 'id'>;
export type WerkbankVorlage = {
  id: string; name: string; text: string; tempo_bpm: number; takte: number;
  spuren: { name: string; geraet: unknown; noten: VorlagenNote[] }[];
};

const bkGeraet = (graph: string) => ({ art: 'intern', name: 'bk', graph, parameter: {} });
const BEATS = 16;   // 4 bars; both patterns have loop_beats 16

function technoTrommeln(): VorlagenNote[] {
  const aus: VorlagenNote[] = [];
  for (let b = 0; b < BEATS; b++) {
    aus.push({ beat: b, laenge: 0.125, ton: 36, vel: 120 });                         // kick on every beat
    if (b % 2 === 1) aus.push({ beat: b, laenge: 0.125, ton: 39, vel: 105 });        // clap on beats 2 and 4 of every bar
    aus.push({ beat: b + 0.5, laenge: 0.125, ton: 42, vel: 90 });                    // closed hat on every off-beat eighth
  }
  return aus.sort((x, y) => x.beat - y.beat);
}

function technoBass(): VorlagenNote[] {
  const aus: VorlagenNote[] = [];
  const tonProTakt = [40, 40, 43, 38];                                               // E1, E1, G1, D1
  for (let b = 0; b < BEATS; b++) {
    const ton = tonProTakt[Math.floor(b / 4)];
    for (const [d, vel] of [[0.25, 96], [0.5, 112], [0.75, 96]] as const) aus.push({ beat: b + d, laenge: 0.25, ton, vel });
  }
  return aus;
}

export const WERKBANK_VORLAGEN: readonly WerkbankVorlage[] = [{
  id: 'techno-130-start', name: 'Techno 130 · Start', text: 'Drums 909 and Bass Banddrive, 4 bars, 130 BPM',
  tempo_bpm: 130, takte: 4,
  spuren: [
    { name: 'Drums', geraet: bkGeraet('drums-909'), noten: technoTrommeln() },
    { name: 'Bass', geraet: bkGeraet('bass-banddrive'), noten: technoBass() },
  ],
}];

export function vorlageVon(id: unknown): WerkbankVorlage | null {
  return typeof id === 'string' ? WERKBANK_VORLAGEN.find((v) => v.id === id) ?? null : null;
}

// The command list that turns an empty module into the template: tempo, loop over the module length, one werkbank_spur_neu per track
export function vorlageBefehle(v: WerkbankVorlage): unknown[] {
  return [
    { befehl: 'tempo_setzen', bpm: v.tempo_bpm },
    { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: v.takte * 4 },
    ...v.spuren.map((s) => ({ befehl: 'werkbank_spur_neu', name: s.name, geraet: s.geraet, loop_beats: BEATS, noten: s.noten })),
  ];
}

export const vorlagenListe = (): { id: string; name: string; text: string }[] => WERKBANK_VORLAGEN.map(({ id, name, text }) => ({ id, name, text }));
