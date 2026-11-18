// Audit U18: the stop edge restarts an unmeasured host to measure it on an empty rack. A host whose plugin window is open must not be restarted (the
// window would vanish while lage() still says it is open); its measurement waits for the next stop edge, after the window is closed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { HostVerwaltung } from '../plugins/hostverwaltung.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { basisProjekt } from './support/inserts_scenario.mjs';
import { tmpOrdner } from './support/project.mjs';
import { hostAttrappe, ZEITEN, warteBis, schlaf } from './support/host_mock.mjs';

function aufbau(t) {
  const d = tmpOrdner(t, 'djk-hfk-');
  const pfad = path.join(d, 'Fake EQ.vst3');
  fs.mkdirSync(pfad);
  const A = hostAttrappe({ ordner: path.join(d, 'project') });
  fs.mkdirSync(A.ordner, { recursive: true });
  const verw = new HostVerwaltung(A.abhaengig(), { ...ZEITEN });
  A.verw = verw;
  t.after(() => verw.halt());
  const plugin = { format: 'vst3', pfad, uid: 'ABCDEF0123456789ABCDEF0123456789' };
  const projekt = fuehreListeAus(basisProjekt(), [{ befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'host', plugin }]).projekt;
  const insert = projekt.spuren.flatMap((s) => s.inserts ?? []).find((i) => i.art === 'host');
  return { A, verw, projekt, insert };
}
const bereit = (verw) => verw.lage()[0]?.status === 'bereit';

test('stop edge with an open plugin window: no restart, the window stays; closing it and the next stop edge measures', async (t) => {
  const e = aufbau(t);
  e.A.steht = false;                                   // the transport plays: the host starts on an estimate
  e.verw.abgleich(e.projekt);
  assert.ok(await warteBis(() => bereit(e.verw)));
  assert.equal(e.verw.lage()[0].gemessen, false);
  const r = await e.verw.fenster(e.insert.id, true);
  assert.deepEqual(r, { ok: true, fenster: true });
  e.verw.ereignis('/zustand/arr', { status: 2 });
  e.A.steht = true;
  e.verw.ereignis('/zustand/arr', { status: 0 });      // stop edge
  await schlaf(400);
  assert.equal(e.A.aufrufe('insert', 'start').length, 1, 'the host was not restarted under the open window');
  assert.equal(e.A.aufrufe('insert', 'stop').length, 0);
  assert.equal(e.verw.lage()[0].fenster, true);
  // close the window; the next stop edge does what it always did
  assert.deepEqual(await e.verw.fenster(e.insert.id, false), { ok: true, fenster: false });
  e.verw.ereignis('/zustand/arr', { status: 2 }); e.verw.ereignis('/zustand/arr', { status: 0 });
  assert.ok(await warteBis(() => e.verw.lage()[0].gemessen && bereit(e.verw)), JSON.stringify(e.verw.lage()));
  assert.equal(e.A.aufrufe('insert', 'start').length, 2, 'one clean restart');
});
