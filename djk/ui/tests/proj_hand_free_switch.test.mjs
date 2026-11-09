// Project switch breaks the human hand holder (Andreas, 2026-11-02: "a switch is a fresh start"). Whole path through the stand-in:
// a grip on a fader, then within the 32 beats /proj/oeffnen of another project: the core must report the value of the project, kern.regler_fehler stays empty.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stapel } from './support/media_library.mjs';
import { bis, ruf, sse, CYPHER } from './support/proj_stack.mjs';

const u = (db) => (db + 200) / 206;                       // the stand-in maps the fader linearly over -200..6 dB
async function projekt(url, name, db) {
  const neu = await ruf(url, 'POST', '/proj/neu', { name });
  assert.equal(neu.code, 200, JSON.stringify(neu.j));
  const a = await ruf(url, 'POST', '/proj/aendern', { rev: neu.j.projekt.rev, label: 'Setup', befehle: [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'spur_aendern', spur_id: 's1', fader_db: db }] });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  return neu.j.slug;
}
const regler = (strom, pfad) => strom.ereignisse.filter((e) => e.a === '/e/regler' && e.f.pfad === pfad).at(-1)?.f;
const griff = (url, pfad, db) => ruf(url, 'POST', '/griff', { pfad, u: u(db) });

test('a grip, then /proj/oeffnen within the hold time: the project fader wins, no regler_fehler (the hand holder is released)', async (t) => {
  const { url } = await stapel(t);
  const strom = sse(url);
  t.after(() => strom.zu());
  const a = await projekt(url, 'Alpha', -6);
  await projekt(url, 'Beta', -12);                         // Beta is open now
  await griff(url, 'spur/1/fader', 0);                     // the first value is only the position
  await griff(url, 'spur/1/fader', -3);                    // grips: holder mensch for 32 beats
  assert.ok(await bis(() => regler(strom, 'spur/1/fader')?.halter === 'mensch'), 'the hand holds the fader');
  const r = await ruf(url, 'POST', '/proj/oeffnen', { slug: a });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual(r.j.kern.regler_fehler, [], 'no refusal');
  assert.ok(await bis(() => Math.abs((regler(strom, 'spur/1/fader')?.wert ?? 99) + 6) < 0.5 && regler(strom, 'spur/1/fader').halter !== 'mensch'), JSON.stringify(regler(strom, 'spur/1/fader')));
});

test('negative controls: without a grip opening behaves as before; a grip on ANOTHER path is not released', async (t) => {
  const { url } = await stapel(t);
  const strom = sse(url);
  t.after(() => strom.zu());
  const a = await projekt(url, 'Alpha', -6);
  await projekt(url, 'Beta', -12);
  const r1 = await ruf(url, 'POST', '/proj/oeffnen', { slug: a });
  assert.deepEqual(r1.j.kern.regler_fehler, []);
  assert.ok(await bis(() => Math.abs((regler(strom, 'spur/1/fader')?.wert ?? 99) + 6) < 0.5));
  // a deck fader is no project regulator: the grip stays over a switch
  await griff(url, 'deck/2/fader', 0);
  await griff(url, 'deck/2/fader', -3);
  assert.ok(await bis(() => regler(strom, 'deck/2/fader')?.halter === 'mensch'));
  const r2 = await ruf(url, 'POST', '/proj/oeffnen', { slug: a });
  assert.deepEqual(r2.j.kern.regler_fehler, []);
  assert.equal(regler(strom, 'deck/2/fader').halter, 'mensch', 'a grip on another path is irrelevant and stays');
});

// D9: only Andreas's own switch breaks his hand. Cypher's open or new sends nothing; after a core restart nothing is sent either (the cause is unknown).
import { pruefKontext, sitzung, warteBis } from './support/proj_context.mjs';
test('/k/hand/frei: Andreas open and new send it first (prefixes, source andreas); Cypher open and new and a core restart send nothing', async (t) => {
  const k = pruefKontext();
  const { s } = sitzung(t, {}, k);
  assert.equal(k.an('/k/hand/frei').length, 0, 'nothing before a project');
  await s.neu('Eins', 'andreas');
  await s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'a', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'andreas');
  const frei = k.an('/k/hand/frei');
  assert.equal(frei.length, 1, 'one per Andreas open');
  assert.equal(frei[0].felder.quelle, 'andreas');
  assert.ok(frei[0].felder.pfade.split(',').includes('spur/'), frei[0].felder.pfade);
  assert.ok(frei[0].felder.pfade.split(',').includes('erz/4/') && !frei[0].felder.pfade.split(',').includes('erz/'), frei[0].felder.pfade);   // never erz/ whole
  assert.ok(k.gesendet.findIndex((x) => x.adresse === '/k/hand/frei') < k.gesendet.findIndex((x) => x.adresse === '/k/teil'), 'before the first mixer write');
  k.leere();
  await s.oeffnen('eins', 'cypher');
  await s.neu('Zwei', 'cypher');
  assert.equal(k.an('/k/hand/frei').length, 0, 'Cypher never releases his hand');
  s.ereignis('/e/neustart', { generation: 2 });
  assert.ok(await warteBis(() => k.protokoll.some((z) => z.typ === 'proj_neustart'), 2000));
  assert.equal(k.an('/k/hand/frei').length, 0, 'a restart sends nothing');
});

test('Cypher opens after a grip: the holder stays and the refusal stays visible (the whole path through the stand-in)', async (t) => {
  const { url } = await stapel(t);
  const strom = sse(url);
  t.after(() => strom.zu());
  const a = await projekt(url, 'Alpha', -6);
  await projekt(url, 'Beta', -12);
  await griff(url, 'spur/1/fader', 0);
  await griff(url, 'spur/1/fader', -3);
  assert.ok(await bis(() => regler(strom, 'spur/1/fader')?.halter === 'mensch'));
  const r = await ruf(url, 'POST', '/proj/oeffnen', { slug: a }, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.ok(r.j.kern.regler_fehler.some((x) => x.pfad === 'spur/1/fader' && x.quittung.grund === 'regler_beim_menschen'), JSON.stringify(r.j.kern.regler_fehler));
  assert.equal(regler(strom, 'spur/1/fader').halter, 'mensch', 'the hand still holds it');
});

test('a grip on erz/1 (instrument) survives Andreas open (the switch writes erz/4/ only; the erz/4 release is pinned by the prefix test above and the stand-in hand_frei test)', async (t) => {
  const { url } = await stapel(t);
  const strom = sse(url);
  t.after(() => strom.zu());
  const a = await projekt(url, 'Alpha', -6);
  await projekt(url, 'Beta', -12);
  await griff(url, 'erz/1/fader', 0);
  await griff(url, 'erz/1/fader', -30);   // beyond the dead zone 3/128
  assert.ok(await bis(() => regler(strom, 'erz/1/fader')?.halter === 'mensch'), 'erz/1 grip: ' + JSON.stringify(regler(strom, 'erz/1/fader')));
  const r = await ruf(url, 'POST', '/proj/oeffnen', { slug: a });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual(r.j.kern.regler_fehler, []);
  assert.equal(regler(strom, 'erz/1/fader').halter, 'mensch', 'erz/1 untouched');
});
