// SEQ scenes T3, at the stack (real server, core stand-in on the ports of the test instance): a launch while the transport plays sends the mute rows with ONE
// future ab_beat, plan szene; the core stand-in executes them at the bar, the receipt reaches the page server, and only then the project model follows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stapel } from './support/media_library.mjs';
import { innen } from './support/inside.mjs';
import { bis, ruf, anKern } from './support/proj_stack.mjs';

test('scene launch flips the mutes in the core after the bar and the model follows; save/list answer over HTTP', async (t) => {
  const { o, url, log } = await stapel(t);
  assert.equal((await ruf(url, 'POST', '/live/oeffnen', {})).code, 200);
  assert.equal((await ruf(url, 'POST', '/seq/anlegen', { platz: 2 })).code, 200);
  for (const name of ['Drums', 'Bass', 'Lead']) {
    const a = await ruf(url, 'POST', '/seq/folge', { platz: 2, name, geraet: 'rb338', loop_beats: 4 });
    assert.equal(a.code, 200, JSON.stringify(a.j));
  }
  const projekt = async () => (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
  const spuren = async () => (await projekt()).spuren.filter((s) => ['Drums', 'Bass', 'Lead'].includes(s.name));
  const mutes = async () => Object.fromEntries((await spuren()).map((s) => [s.name, s.mute]));
  const m = async (drums, bass, lead) => {
    const sp = await spuren(); const id = (n) => sp.find((s) => s.name === n).id;
    const x = await ruf(url, 'POST', '/seq/befehle', { platz: 2, label: 'M', befehle: [
      { befehl: 'spur_aendern', spur_id: id('Drums'), mute: drums }, { befehl: 'spur_aendern', spur_id: id('Bass'), mute: bass }, { befehl: 'spur_aendern', spur_id: id('Lead'), mute: lead }] });
    assert.equal(x.code, 200, JSON.stringify(x.j));
  };
  await m(false, true, true);
  assert.equal((await ruf(url, 'POST', '/seq/szene', { slot: 3, aktion: 'speichern' })).code, 200);
  const liste = (await ruf(url, 'GET', '/seq/szenen')).j;
  assert.deepEqual([liste.szenen[3], liste.aktiv, liste.wartet], [{ an: 1, aus: 2 }, 3, null]);
  assert.deepEqual(Object.keys((await ruf(url, 'GET', '/seq/stand')).j), ['1', '2', '3', '4']);
  await m(true, false, false);
  const st = await ruf(url, 'POST', '/proj/transport', { aktion: 'start', beat: 0 });
  assert.equal(st.code, 200, JSON.stringify(st.j));
  // the pair of /uhr and /zustand/arr must be known before the launch can aim at a bar
  let a;
  for (let i = 0; i < 100; i++) {
    a = await ruf(url, 'POST', '/seq/szene', { slot: 3, aktion: 'starten' });
    if (a.code === 200 && a.j.wartet) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.ok(a.j.wartet, `the launch waits for a bar: ${JSON.stringify(a.j)}`);
  const teile = anKern(log, '/k/teil').filter((z) => z.felder.plan === 'szene');
  assert.equal(teile.length >= 3, true);
  const letzte = teile.slice(-3);
  assert.equal(new Set(letzte.map((z) => z.felder.ab_beat)).size, 1, 'one shared ab_beat');
  let wartet = true;
  for (let i = 0; i < 300 && wartet; i++) { wartet = (await ruf(url, 'GET', '/seq/szenen')).j.wartet !== null; if (wartet) await new Promise((r) => setTimeout(r, 50)); }
  assert.equal(wartet, false, 'the launch ended');
  assert.deepEqual(await mutes(), { Drums: false, Bass: true, Lead: true }, 'the model follows the core');
  const regler = () => innen(o).stand.regler;
  const sp = await spuren();
  assert.ok(await bis(() => sp.every((s) => regler()[`spur/${s.nr}/mute`] === (s.mute ? 1 : 0)), 3000), 'the core shows the scene');
});
