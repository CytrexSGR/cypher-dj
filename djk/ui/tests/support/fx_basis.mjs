// Tracker task 14: projects for the playback tests of the effect commands. `ohneFx()` is the project whose playback file the old translator wrote;
// its hash is pinned in fx_playback.test.mjs (taken before the effect code existed).
import { fuehreListeAus, setzeDekodiert } from '../../project/commands.ts';
import { neuesProjekt } from '../../project/model.ts';

export const BK = { art: 'intern', name: 'bk', graph: 'synth-mono', parameter: {} };
export const KIT = { art: 'intern', name: 'kit', kit: 'k' };
const SHA = 'c'.repeat(64);
export const lauf = (p, ...b) => fuehreListeAus(p, b, { quelle: 'andreas' }).projekt;
export const note = (id, beat, laenge, ton, vel = 100, mehr = {}) => ({ id, beat, laenge, ton, vel, ...mehr });

/** one bk track with a looped clip and a transpose envelope, a kit track, an rb338 track, an audio track with a pan lane, a group */
export function ohneFx() {
  let p = neuesProjekt('T');
  p = lauf(p, { befehl: 'spur_neu', art: 'instrument', name: 'B', geraet: BK }, { befehl: 'spur_neu', art: 'instrument', name: 'K', geraet: KIT },
    { befehl: 'spur_neu', art: 'instrument', name: 'R', geraet: { art: 'intern', name: 'rb338', parameter: {} } }, { befehl: 'spur_neu', art: 'audio', name: 'A' });
  p = lauf(p, { befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 0, laenge_beats: 8, loop_beats: 4,
    noten: [note('n1', 0, 1, 60), note('n2', 1, 1, 64), note('n3', 2.5, 0.5, 67, 90, { versatz: 10 })] });
  p = lauf(p, { befehl: 'clip_neu', spur_id: 's2', art: 'midi', start_beat: 0, laenge_beats: 4, noten: [note('k1', 0, 0.25, 36), note('k2', 1, 0.25, 38)] });
  p = lauf(p, { befehl: 'clip_neu', spur_id: 's3', art: 'midi', start_beat: 4, laenge_beats: 4, noten: [note('r1', 0, 2, 48)] });
  p = lauf(p, { befehl: 'clip_neu', spur_id: 's4', art: 'audio', start_beat: 0, laenge_beats: 8, sha256: SHA, name: 'a' });
  p = lauf(p, { befehl: 'auto_neu', spur_id: 's4', ziel: 'pan', punkte: [{ beat: 0, wert: -1 }, { beat: 8, wert: 1 }] });
  p = lauf(p, { befehl: 'gruppenspur_neu', name: 'G', mitglieder: ['s1', 's2'] });
  setzeDekodiert(p, () => 'fertig');
  return p;
}
export const ohneFxEinfach = () => lauf(lauf(neuesProjekt('E'), { befehl: 'spur_neu', art: 'instrument', name: 'B', geraet: BK }),
  { befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 0, laenge_beats: 4, noten: [note('e1', 0, 1, 60)] });
