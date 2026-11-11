// Plan 1.11 task 17, negative control: a project with two Surge tracks (patch, parameter map, notes, a freeze, a rack member) and its playback file.
// tests/support/surge_spur_golden.json was recorded from this scenario BEFORE the plugin device existed (HEAD of task 17); the test
// instrument_track.test.mjs checks that today's code reproduces it byte for byte: Surge commands, project bytes and playback are unchanged.
import { fuehreListeAus } from '../../project/commands.ts';
import { neuesProjekt, kanonisch } from '../../project/model.ts';
import { uebersetze } from '../../project/playback.ts';

const lauf = (p, b) => fuehreListeAus(p, b, { quelle: 'andreas', surgePatchDa: () => true, surgeBereich: () => [0, 1] }).projekt;

export function surgeSzenario() {
  let p = neuesProjekt('S');
  p = lauf(p, [{ befehl: 'spur_neu', art: 'instrument', name: 'Pad', geraet: { art: 'wirt', name: 'surge', patch: 'Pads/Warm Pad' } },
    { befehl: 'spur_neu', art: 'instrument', name: 'Lead', geraet: { art: 'wirt', name: 'surge' } },
    { befehl: 'spur_neu', art: 'audio', name: 'Kick' }]);
  p = lauf(p, [{ befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 0, laenge_beats: 8, name: 'n' }]);
  const clip = p.spuren[0].clips[0];
  p = lauf(p, [{ befehl: 'noten_neu', clip_id: clip.id, noten: [{ beat: 0, laenge: 1, ton: 60, vel: 100 }, { beat: 2, laenge: 1, ton: 64, vel: 90 }] }]);
  p.rev = 5; p.wiedergabe_rev = 5;
  const w = uebersetze(p, { nr: 1, audioOrdner: '/x/audio', frames: () => 96000 });
  return { projekt: p, kanonisch: kanonisch(p), wiedergabe: JSON.stringify(w) };
}
