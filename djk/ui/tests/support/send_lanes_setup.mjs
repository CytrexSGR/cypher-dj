// Shared builder of the send-lane tests: a project with two returns, a kit track and an RB-338 track with sends, no send lane.
import { fuehreListeAus } from '../../project/commands.ts';
import { neuesProjekt } from '../../project/model.ts';

export const lauf = (p, b, extra = {}) => fuehreListeAus(p, Array.isArray(b) ? b : [b], { quelle: 'andreas', ...extra }).projekt;
const note = (id, beat, ton) => ({ id, beat, laenge: 0.5, ton, vel: 100 });
export function ohneSendLane() {
  let p = neuesProjekt('Send');
  p = lauf(p, [
    { befehl: 'spur_neu', art: 'instrument', name: 'Kit', geraet: { art: 'intern', name: 'kit', kit: 'k1' } },
    { befehl: 'spur_neu', art: 'instrument', name: 'Bass', geraet: { art: 'intern', name: 'rb338', parameter: {} } },
    { befehl: 'return_neu', name: 'Hall' }, { befehl: 'return_neu', name: 'Echo' },
  ]);
  const [kit, bass] = p.spuren;
  const [r1, r2] = p.returns;
  return lauf(p, [
    { befehl: 'clip_neu', spur_id: kit.id, art: 'midi', start_beat: 0, laenge_beats: 8, noten: [note('k1', 0, 36), note('k2', 4, 36)] },
    { befehl: 'clip_neu', spur_id: bass.id, art: 'midi', start_beat: 0, laenge_beats: 8, noten: [note('b1', 0, 40)] },
    { befehl: 'send_setzen', strang_id: kit.id, return_id: r1.id, db: -6 },
    { befehl: 'send_setzen', strang_id: bass.id, return_id: r2.id, db: -3 },
    { befehl: 'auto_neu', spur_id: kit.id, ziel: 'fader' },
  ]);
}
export const OPT = { nr: 7, audioOrdner: '@A@', frames: () => 400000 };
