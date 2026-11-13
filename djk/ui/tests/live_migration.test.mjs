// DJ view places, plan task 7 (decision 9): an existing live project whose module group sits at -200 dB. The channel fader of pad/N is the only
// gain now, so opening the container raises the group to 0 dB when pad/N is closed (kanalOffen false); with the channel open it is reported and
// left, because the module would jump in. Only the open of the container does this, never a call on an already open one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sitzung, ist, warteBis, arrNr } from './support/proj_context.mjs';
import { ProjFehler } from '../areas/proj/session.ts';

const HASH = 'c'.repeat(64);
const modul = (slot) => ({ quelle_sha256: HASH, titel: 'T', kuenstler: 'K', fassung: 'f1', basis_bpm: 124, von_beat: 32, laenge_beats: 16,
  bpm: 124, tonart: '8A', datum: '2026-11-12', slot });

// a live container on disk with a module in each slot (group fader as given), then the container is left, so the next liveOeffnen is a real open
async function aufbau(t, fader, opt = {}) {
  const z = sitzung(t, { arrFristMs: 30, ...opt });
  assert.equal((await z.s.liveOeffnen('andreas')).code, 200);
  const rev = () => z.s.aktuell('rev').j.rev;
  const befehle = [];
  for (const [i, slot] of ['A', 'B'].entries()) {
    befehle.push({ befehl: 'gruppenspur_neu', name: `${slot} · T` });
  }
  let r = await z.s.aendern({ rev: rev(), label: 'groups', befehle }, 'andreas');
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const gr = z.s.aktuell().j.projekt.gruppen;
  const zwei = [];
  gr.forEach((g, i) => {
    zwei.push({ befehl: 'gruppenspur_aendern', gruppe_id: g.id, fader_db: fader[i] });
    zwei.push({ befehl: 'modul_setzen', gruppe_id: g.id, modul: modul(i === 0 ? 'A' : 'B') });
  });
  r = await z.s.aendern({ rev: rev(), label: 'modules', befehle: zwei }, 'andreas');
  assert.equal(r.code, 200, JSON.stringify(r.j));
  await z.s.neu('Flat', 'andreas');
  const gruppe = (slot) => z.s.aktuell().j.projekt.gruppen.find((g) => g.modul?.slot === slot);
  return { ...z, gruppe };
}
const GRP = (z, g) => z.k.an('/k/teil').filter((x) => x.felder.pfad === `grp/${g.nr}/fader`);

test('migration: a -200 module group is raised to 0 dB when pad/N is closed, as one undo step, and the core row follows', async (t) => {
  const z = await aufbau(t, [-200, -200]);
  ist(z.s, 'pad/1/trim', 0); ist(z.s, 'pad/1/fader', -200);       // closed
  ist(z.s, 'pad/2/trim', 0); ist(z.s, 'pad/2/fader', -60);        // closed (trim + fader <= -26)
  const r = await z.s.liveOeffnen('andreas');
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual(r.j.fader, { angehoben: ['A', 'B'], gemeldet: [] });
  assert.equal(z.gruppe('A').fader_db, 0);
  assert.equal(z.gruppe('B').fader_db, 0);
  assert.equal(GRP(z, z.gruppe('A')).at(-1)?.felder.nach, 0, 'the core row of the group went to 0');
  // opening again (already open) moves nothing and says nothing
  const nochmal = await z.s.liveOeffnen('andreas');
  assert.equal('fader' in nochmal.j, false);
});

test('migration: with pad/N open the group stays at -200 and is reported; the closed slot is raised', async (t) => {
  const z = await aufbau(t, [-200, -200]);
  ist(z.s, 'pad/1/trim', 0); ist(z.s, 'pad/1/fader', -6);         // open
  ist(z.s, 'pad/2/trim', 0); ist(z.s, 'pad/2/fader', -200);       // closed
  const r = await z.s.liveOeffnen('andreas');
  assert.deepEqual(r.j.fader, { angehoben: ['B'], gemeldet: ['A'] });
  assert.equal(z.gruppe('A').fader_db, -200, 'the module in the open channel would jump in: left');
  assert.equal(z.gruppe('B').fader_db, 0);
});

test('migration: groups that are not at -200 are left alone, and an unknown channel state is reported, not moved', async (t) => {
  const z = await aufbau(t, [-6, -200]);
  ist(z.s, 'pad/1/fader', -200);                                   // A is at -6 dB by choice
  // pad/2 is not known to the page server at all
  const r = await z.s.liveOeffnen('andreas');
  assert.deepEqual(r.j.fader, { angehoben: [], gemeldet: ['B'] });
  assert.equal(z.gruppe('A').fader_db, -6);
  assert.equal(z.gruppe('B').fader_db, -200);
});

test('migration: a project without anything at -200 answers without a fader field', async (t) => {
  const z = await aufbau(t, [0, 0]);
  const r = await z.s.liveOeffnen('andreas');
  assert.equal('fader' in r.j, false);
});

// Fix round 1, finding 3: the gaps of the first version
test('migration: /proj/oeffnen of the live project migrates too (every open of it), and the answer carries the new project and the report', async (t) => {
  const z = await aufbau(t, [-200, -200]);
  ist(z.s, 'pad/1/trim', 0); ist(z.s, 'pad/1/fader', -200); ist(z.s, 'pad/2/trim', 0); ist(z.s, 'pad/2/fader', -6);   // A closed, B open
  const r = await z.s.oeffnen('live', 'andreas');
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual(r.j.fader, { angehoben: ['A'], gemeldet: ['B'] });
  assert.equal(z.gruppe('A').fader_db, 0);
  assert.equal(z.gruppe('B').fader_db, -200);
  assert.equal(r.j.projekt.gruppen.find((g) => g.modul?.slot === 'A').fader_db, 0, 'the answer shows the raised group');
});

test('migration: a slot that was only reported is raised by a second /live/oeffnen once its channel is closed', async (t) => {
  const z = await aufbau(t, [-200, -200]);
  ist(z.s, 'pad/1/trim', 0); ist(z.s, 'pad/1/fader', -6); ist(z.s, 'pad/2/trim', 0); ist(z.s, 'pad/2/fader', -200);
  const r = await z.s.liveOeffnen('andreas');
  assert.deepEqual(r.j.fader, { angehoben: ['B'], gemeldet: ['A'] });
  ist(z.s, 'pad/1/fader', -200);                                    // Andreas closes the channel afterwards: the row event itself raises the group
  assert.ok(await warteBis(() => z.gruppe('A').fader_db === 0), 'raised when the server sees the channel closed');
  assert.equal((await z.s.liveOeffnen('andreas')).j.fader, undefined, 'nothing left to report');
});

test('migration: a call on the open container raises a reported slot (no row event in between)', async (t) => {
  const z0 = { offen: new Set() };
  const z = await aufbau(t, [-200, -200], { kanalOffen: (k) => z0.offen.has(k) });
  z0.offen.add('pad/1');
  ist(z.s, 'pad/1/trim', 0); ist(z.s, 'pad/1/fader', -200); ist(z.s, 'pad/2/trim', 0); ist(z.s, 'pad/2/fader', -200);
  const r = await z.s.liveOeffnen('andreas');
  assert.deepEqual(r.j.fader, { angehoben: ['B'], gemeldet: ['A'] }, 'a planned or running ramp (the hook) counts as open');
  z0.offen.clear();
  const r2 = await z.s.liveOeffnen('andreas');
  assert.deepEqual(r2.j.fader, { angehoben: ['A'], gemeldet: [] });
  assert.equal(z.gruppe('A').fader_db, 0);
});

test('migration: an unknown channel stays reported until a value arrives; the first row then raises the group', async (t) => {
  const z = await aufbau(t, [-200, -200]);
  const r = await z.s.liveOeffnen('andreas');
  assert.deepEqual(r.j.fader, { angehoben: [], gemeldet: ['A', 'B'] });
  assert.equal(z.gruppe('A').fader_db, -200);
  ist(z.s, 'pad/1/fader', -200);                                    // the fader row is known and closed (trim unknown = 0)
  assert.ok(await warteBis(() => z.gruppe('A').fader_db === 0), 'A raised');
  assert.equal(z.gruppe('B').fader_db, -200, 'B is still unknown');
});

test('migration: undo of the migration gives -200 back and nothing raises it again until the next row of that channel', async (t) => {
  const z = await aufbau(t, [-200, -200]);
  ist(z.s, 'pad/1/trim', 0); ist(z.s, 'pad/1/fader', -200); ist(z.s, 'pad/2/trim', 0); ist(z.s, 'pad/2/fader', -200);
  const r = await z.s.liveOeffnen('andreas');
  assert.deepEqual(r.j.fader.angehoben, ['A', 'B']);
  const u = await z.s.umkehr('undo', { rev: z.s.aktuell('rev').j.rev }, 'andreas');
  assert.equal(u.code, 200, JSON.stringify(u.j));
  assert.deepEqual([z.gruppe('A').fader_db, z.gruppe('B').fader_db], [-200, -200], 'undo restores -200');
  await new Promise((r2) => setTimeout(r2, 100));
  assert.deepEqual([z.gruppe('A').fader_db, z.gruppe('B').fader_db], [-200, -200], 'not raised again behind the undo');
});

// Fix round 1, finding 1: modul_setzen through proj_aendern is gated like the export
test('modul_setzen into a live slot is kanal_offen while that channel is open, whoever sends it; closed it goes through; undo is not gated', async (t) => {
  const offen = new Set();
  const z = sitzung(t, { arrFristMs: 30, kanalOffen: (k) => offen.has(k) });
  assert.equal((await z.s.liveOeffnen('andreas')).code, 200);
  const rev = () => z.s.aktuell('rev').j.rev;
  assert.equal((await z.s.aendern({ rev: rev(), label: 'g', befehle: [{ befehl: 'gruppenspur_neu', name: 'G1' }, { befehl: 'gruppenspur_neu', name: 'G2' }] }, 'andreas')).code, 200);
  const [g1, g2] = z.s.aktuell().j.projekt.gruppen.map((g) => g.id);
  const setze = (id, slot, q) => z.s.aendern({ rev: rev(), label: 'm', befehle: [{ befehl: 'modul_setzen', gruppe_id: id, modul: modul(slot) }] }, q)
    .then((r) => ({ code: r.code }), (e) => ({ code: e.code, fehler: e.fehler, text: e.extra?.text }));
  ist(z.s, 'pad/2/trim', 0); ist(z.s, 'pad/2/fader', -6);           // B open by its rows
  for (const q of ['andreas', 'cypher']) {
    const e = await setze(g2, 'B', q);
    assert.deepEqual([e.code, e.fehler], [409, 'kanal_offen'], q);
    assert.match(e.text, /pad\/2/);
  }
  ist(z.s, 'pad/2/fader', -200);                                    // closed by rows, but a ramp is planned (the hook of the server): still open
  offen.add('pad/2');
  assert.equal((await setze(g2, 'B', 'cypher')).fehler, 'kanal_offen');
  offen.clear();
  assert.equal((await setze(g1, 'A', 'cypher')).code, 200, 'slot A: channel unknown = closed');
  assert.equal((await setze(g2, 'B', 'cypher')).code, 200, 'closed: accepted');
  ist(z.s, 'pad/1/trim', 0); ist(z.s, 'pad/1/fader', -6);           // A opens; undo removes the module of A (and of B first): not gated
  const u = await z.s.umkehr('undo', { rev: rev() }, 'cypher');
  assert.equal(u.code, 200, JSON.stringify(u.j));
});

// Fix round 2: the migration happens once; only waiting groups are raised by a row, only while the live playback is stopped
const laeuft = (z, status) => z.s.ereignis('/zustand/arr', { ...arrNr(1), status });
const eingriffe = (z) => z.k.protokoll.filter((x) => x.typ === 'live_modul_fader_fehler').length;

test('migration is once: after an undo the next rows of pad/N do not raise the group again, however many come', async (t) => {
  const z = await aufbau(t, [-200, -200]);
  ist(z.s, 'pad/1/trim', 0); ist(z.s, 'pad/1/fader', -200); ist(z.s, 'pad/2/trim', 0); ist(z.s, 'pad/2/fader', -200);
  assert.deepEqual((await z.s.liveOeffnen('andreas')).j.fader.angehoben, ['A', 'B']);
  const rev = () => z.s.aktuell('rev').j.rev;
  assert.equal((await z.s.umkehr('undo', { rev: rev() }, 'andreas')).code, 200);
  const r0 = rev();
  for (const w of [-200, -90, -26, -60, -200]) { ist(z.s, 'pad/1/fader', w); ist(z.s, 'pad/2/fader', w); ist(z.s, 'pad/1/trim', 0); }
  await new Promise((r) => setTimeout(r, 150));
  assert.deepEqual([z.gruppe('A').fader_db, z.gruppe('B').fader_db], [-200, -200], 'a deliberate -200 holds');
  assert.equal(rev(), r0, 'no history step was added by the rows');
  assert.equal((await z.s.liveOeffnen('andreas')).j.fader, undefined, 'a call on the open container does not raise it either');
});

test('migration: a waiting group is not raised while the live playback runs, and is raised once it stops', async (t) => {
  const z = await aufbau(t, [-200, -200]);
  ist(z.s, 'pad/1/trim', 0); ist(z.s, 'pad/1/fader', -6); ist(z.s, 'pad/2/trim', 0); ist(z.s, 'pad/2/fader', -200);
  const r = await z.s.liveOeffnen('andreas');
  assert.deepEqual(r.j.fader, { angehoben: ['B'], gemeldet: ['A'] });
  laeuft(z, 2);
  ist(z.s, 'pad/1/fader', -40);                                     // the channel is fading out through -26 dB while the set plays
  ist(z.s, 'pad/1/fader', -200);
  await new Promise((r2) => setTimeout(r2, 150));
  assert.equal(z.gruppe('A').fader_db, -200, 'playing: the old module does not jump in');
  laeuft(z, 0);                                                     // stopped: the next row raises the waiting group
  ist(z.s, 'pad/1/fader', -200);
  assert.ok(await warteBis(() => z.gruppe('A').fader_db === 0), 'raised after the stop');
});

test('migration: a refused raise (freeze running) leaves the group waiting with one log entry per group, and succeeds later', async (t) => {
  const z = await aufbau(t, [-200, -200]);
  ist(z.s, 'pad/1/trim', 0); ist(z.s, 'pad/1/fader', -6); ist(z.s, 'pad/2/trim', 0); ist(z.s, 'pad/2/fader', -6);
  assert.deepEqual((await z.s.liveOeffnen('andreas')).j.fader, { angehoben: [], gemeldet: ['A', 'B'] });
  const echt = z.s.aendern.bind(z.s);
  z.s.aendern = async () => { throw new ProjFehler(409, 'beschaeftigt', { text: 'a freeze is running' }); };
  for (let i = 0; i < 4; i++) { ist(z.s, 'pad/1/fader', -200); ist(z.s, 'pad/2/fader', -200); await new Promise((r) => setTimeout(r, 30)); }
  assert.deepEqual([z.gruppe('A').fader_db, z.gruppe('B').fader_db], [-200, -200]);
  assert.ok(eingriffe(z) <= 2, `at most one log entry per group (${eingriffe(z)})`);
  assert.ok(eingriffe(z) >= 1);
  z.s.aendern = echt;                                               // the freeze is over
  ist(z.s, 'pad/1/fader', -200);
  assert.ok(await warteBis(() => z.gruppe('A').fader_db === 0 && z.gruppe('B').fader_db === 0), 'both raised afterwards');
});
