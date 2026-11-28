// Strand 13 (bus dynamics): rows added to existing kinds after their first release (komp glue/auto, saett knie, mb u<m>/*).
// A project file written before strand 13 has stages without these values. It must still load, each missing value read as its
// contract default, and a save of such a project writes the same bytes as before (late values at their default are left out, project/insert_spaeter.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt, pruefeProjekt, kanonisch } from '../project/model.ts';
import { INSERT_ARTEN } from '../project/insert_key.ts';
import { normalisiere } from '../project/storage.ts';

const NEU = { komp: ['glue', 'auto'], saett: ['knie'], mb: ['u1/schwelle', 'u1/ratio', 'u1/bereich', 'u2/schwelle', 'u2/ratio', 'u2/bereich', 'u3/schwelle', 'u3/ratio', 'u3/bereich'] };
const vorgabe = (art, name) => INSERT_ARTEN[art].parameter.find((q) => q.name === name).vorgabe;

function projektMitStufen() {
  let p = fuehreListeAus(neuesProjekt('T'), [{ befehl: 'spur_neu', art: 'audio', name: 'A' }], { quelle: 'andreas' }).projekt;
  Object.keys(NEU).forEach((art, pos) => {
    p = fuehreListeAus(p, [{ befehl: 'insert_setzen', strang_id: 's1', pos, art }], { quelle: 'andreas' }).projekt;
  });
  return p;
}

test('strand 13: a project file from before strand 13 (stages without glue/auto, knie, u<m>/*) loads with the contract defaults', () => {
  const alt = JSON.parse(kanonisch(projektMitStufen()));
  for (const i of alt.spuren[0].inserts) for (const n of NEU[i.art]) delete i.werte[n];
  for (const i of alt.spuren[0].inserts) for (const n of NEU[i.art]) assert.ok(!(n in i.werte), `${i.art}.${n} removed`);
  const g = pruefeProjekt(alt);
  assert.equal(g.fehler, undefined, JSON.stringify(g.fehler));
  const geladen = g.projekt.spuren[0].inserts;
  assert.deepEqual(geladen.map((i) => i.art), Object.keys(NEU));
  for (const i of geladen) for (const n of NEU[i.art]) assert.equal(i.werte[n], vorgabe(i.art, n), `${i.art}.${n} is its default`);
});

test('strand 13: the new values at their default are not written; a changed one is written (negative control)', () => {
  const p = projektMitStufen();
  const datei = JSON.parse(JSON.stringify(normalisiere(p)));
  for (const i of datei.spuren[0].inserts) for (const n of NEU[i.art]) assert.ok(!(n in i.werte), `${i.art}.${n} at its default is left out`);
  const komp = p.spuren[0].inserts.find((i) => i.art === 'komp');
  komp.werte.glue = 1;
  const geaendert = JSON.parse(JSON.stringify(normalisiere(p)));
  assert.equal(geaendert.spuren[0].inserts.find((i) => i.art === 'komp').werte.glue, 1);
});
