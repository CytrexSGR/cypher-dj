// A representative FLAT project (no group nesting): groups, a return, sends, an insert key. `bauFlach()` returns the project file text and both
// playback forms (/1 without routing, /2 with it). tests/support/flach_golden.json holds the output of the code before nested groups existed
// (generated from c3396e9a); tests/project_flach_golden.test.mjs compares byte for byte.
import { fuehreAus } from '../../project/commands.ts';
import { pruefeProjekt, kanonisch } from '../../project/model.ts';
import { uebersetze } from '../../project/playback.ts';
import { specProjekt, SHA_A, SHA_B } from './project.mjs';

const opt = () => ({ nr: 1, audioOrdner: '/arbeit/arr/audio', frames: (sha) => (sha === SHA_A || sha === SHA_B ? 24000 : null) });

export function bauFlach() {
  const eins = uebersetze(specProjekt(), opt());   // /1: no routing
  let p = pruefeProjekt(specProjekt()).projekt;
  const ok = (b) => { p = fuehreAus(p, b).projekt; };
  ok({ befehl: 'gruppenspur_neu', name: 'Music', mitglieder: ['s2', 's3'] });
  ok({ befehl: 'gruppenspur_neu', name: 'Empty' });
  ok({ befehl: 'return_neu' });
  ok({ befehl: 'send_setzen', strang_id: 's1', return_id: 'r1', db: -6 });
  ok({ befehl: 'send_setzen', strang_id: 'g1', return_id: 'r1', db: -9 });
  ok({ befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', key: { quelle: 'spur', nr: 2, punkt: 'post' } });
  ok({ befehl: 'insert_setzen', strang_id: 'g2', pos: 0, art: 'komp', key: { quelle: 'grp', nr: 1, punkt: 'pre' } });
  ok({ befehl: 'insert_setzen', strang_id: 'g1', pos: 0, art: 'eq' });
  return { datei: kanonisch(p), wiedergabe1: eins, wiedergabe2: uebersetze(p, opt()) };
}
