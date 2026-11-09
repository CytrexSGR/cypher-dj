// N8 (routing 1.10, open flank 4): an export right after a mixer change rendered an interim value of the 10 ms ramp when the page answered the change
// at the first status of the /k/teil (2, "started", the ramp still running). The export reads the controls from the core state, so the answer of a
// mixer change must come only after the END status (> 2) of every ramp. Measured on the real core (instance e, wait 0 ms, 30 exports per run):
// first status only: 14 of 30 and 13 of 30 exports wrong (check/n8_export_after_controls.mjs); end status: 0 of 30.
// The stub (tests/support/proj_context.mjs, teileMax) keeps a part open until it is waited for with bisEnde, which models the running ramp.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pruefKontext, sitzung } from './support/proj_context.mjs';

async function aufbau(t, opt = {}) {
  const k = pruefKontext({ teileMax: 256 });
  const { s } = sitzung(t, opt, k);
  await s.neu('N8', 'andreas');
  k.mitModell = false;                                              // the set-up is not under test
  await s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'build', befehle: [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'spur_neu', art: 'audio' }, { befehl: 'gruppenspur_neu' }] }, 'cypher');
  await s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'route', befehle: [{ befehl: 'ziel_setzen', strang_id: 's2', ausgang: { art: 'gruppe', id: 'g1' } }] }, 'cypher');
  k.mitModell = true; k.leere(); k.offen.clear();
  return { s, k };
}
const rev = (s) => s.aktuell().j.projekt.rev;

test('N8: the answer of a track fader, group fader or pan change comes after the end status of every ramp (no ramp still open)', async (t) => {
  const { s, k } = await aufbau(t);
  const faelle = [
    ['track fader', [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -9 }], /^spur\/1\/fader$/],
    ['group fader', [{ befehl: 'gruppenspur_aendern', gruppe_id: 'g1', fader_db: -6.0206 }], /^grp\/1\/fader$/],
    ['track pan', [{ befehl: 'spur_aendern', spur_id: 's2', pan: 0.5 }], /^spur\/2\/pan$/],
  ];
  for (const [name, befehle, pfad] of faelle) {
    k.leere();
    const r = await s.aendern({ rev: rev(s), label: name, befehle }, 'cypher');
    assert.equal(r.code, 200, name);
    assert.ok(k.teile(pfad).length >= 1, `${name}: the control went to the core`);
    assert.equal(k.offen.size, 0, `${name}: no ramp is still open when the answer is given (an export now would read the final value)`);
  }
});

test('N8: undo and redo of a mixer change also answer only after the end status', async (t) => {
  const { s, k } = await aufbau(t);
  await s.aendern({ rev: rev(s), label: 'fader', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -9 }] }, 'cypher');
  for (const art of ['undo', 'redo']) {
    k.leere();
    const r = await s.umkehr(art, { rev: rev(s) }, 'cypher');
    assert.equal(r.code, 200, art);
    assert.ok(k.teile(/^spur\/1\/fader$/).length >= 1, `${art}: the control went to the core`);
    assert.equal(k.offen.size, 0, `${art}: no ramp is still open when the answer is given`);
  }
});

test('N8 negative control: waiting only for the first status (the state before the fix) leaves the ramp open when the answer is given', async (t) => {
  const { s, k } = await aufbau(t, { kernWeg: { bisEnde: false } });
  const r = await s.aendern({ rev: rev(s), label: 'fader', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -9 }] }, 'cypher');
  assert.equal(r.code, 200);
  assert.ok(k.offen.size > 0, `the ramp is still open (${k.offen.size}): an export now could read an interim value`);
});

test('N8 negative control: a note-only change sends no control, so nothing is open and nothing waits', async (t) => {
  const { s, k } = await aufbau(t);
  k.leere();
  const r = await s.aendern({ rev: rev(s), label: 'name', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', name: 'Bass' }] }, 'cypher');
  assert.equal(r.code, 200);
  assert.equal(k.teile().length, 0);
  assert.equal(k.offen.size, 0);
});
