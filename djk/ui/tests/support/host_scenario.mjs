// Plan 1.11 T7: a fixed project WITH native insert stages (komp, eq, saett, lim on a track, a group, a return and the master) and no host stage.
// tests/support/inserts_mit_golden.json was recorded from this scenario BEFORE the host stage existed (base commit of task 7); the test
// project_host_insert.test.mjs checks that today's translator reproduces it byte for byte: a project without host stages keeps its playback file.
import { fuehreListeAus } from '../../project/commands.ts';
import { kanonisch } from '../../project/model.ts';
import { uebersetze } from '../../project/playback.ts';
import { szenarioOhneInserts } from './inserts_scenario.mjs';

const lauf = (p, b) => fuehreListeAus(p, b, { quelle: 'andreas' }).projekt;

export function szenarioMitInserts() {
  let p = szenarioOhneInserts().projekt;
  p = lauf(p, [
    { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp' },
    { befehl: 'insert_setzen', strang_id: 's1', pos: 1, art: 'eq' },
    { befehl: 'insert_setzen', strang_id: 'g1', pos: 0, art: 'saett' },
    { befehl: 'insert_setzen', strang_id: 'r1', pos: 0, art: 'komp' },
    { befehl: 'insert_setzen', strang_id: 'master', pos: 0, art: 'lim' },
  ]);
  p.rev = 9; p.wiedergabe_rev = 9;
  const w = uebersetze(p, { nr: 1, audioOrdner: '/x/audio', frames: () => 96000 });
  return { projekt: p, kanonisch: kanonisch(p), wiedergabe: JSON.stringify(w) };
}
