// Slice 4a T5: one fixed project WITHOUT inserts (three tracks with clips, one group, two returns, sends, master fader).
// The golden file inserts_ohne_golden.json was recorded from this scenario at the parent commit (before any insert code existed);
// the test project_inserts.test.mjs checks that today's code reproduces it byte for byte (negative control: no inserts = the old format).
import { fuehreListeAus } from '../../project/commands.ts';
import { neuesProjekt, kanonisch, wiedergabeSicht } from '../../project/model.ts';
import { uebersetze } from '../../project/playback.ts';

export const SHA = 'c'.repeat(64);
const lauf = (p, b) => fuehreListeAus(p, b, { quelle: 'andreas' }).projekt;

export function basisProjekt() {
  let p = neuesProjekt('T');
  p = lauf(p, ['Kick', 'Bass', 'Lead'].map((name) => ({ befehl: 'spur_neu', art: 'audio', name })));
  for (const id of ['s1', 's2', 's3']) {
    p = lauf(p, [{ befehl: 'clip_neu', spur_id: id, art: 'audio', start_beat: 0, laenge_beats: 16, sha256: SHA, name: id }]);
  }
  return p;
}

export function szenarioOhneInserts() {
  let p = basisProjekt();
  p = lauf(p, [{ befehl: 'gruppenspur_neu', name: 'Music', mitglieder: ['s2', 's3'] }]);
  p = lauf(p, [{ befehl: 'return_neu', name: 'Hall' }, { befehl: 'return_neu', name: 'Plate' }]);
  p = lauf(p, [{ befehl: 'send_setzen', strang_id: 's1', return_id: 'r1', db: -6 }, { befehl: 'master_aendern', fader_db: -1.5 }]);
  p.rev = 7; p.wiedergabe_rev = 7;
  const w = uebersetze(p, { nr: 1, audioOrdner: '/x/audio', frames: () => 96000 });
  return { projekt: p, kanonisch: kanonisch(p), wiedergabe: JSON.stringify(w), sicht: kanonisch(wiedergabeSicht(p)) };
}
