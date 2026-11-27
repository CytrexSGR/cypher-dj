// Container core M6: POST /strudel needs the strudel module (kein_strudel_modul / kein_liveprojekt) and creates the strom track of the stream on demand.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { belegeTestInstanz } from './support/instance.mjs';
import { echterServer, hol } from './support/echter_server.mjs';

belegeTestInstanz();
const T = { timeout: 60000 };
const stromSpuren = (p) => p.spuren.filter((s) => s.art === 'strom');

test('kein_liveprojekt without a project and with a production project; nothing is written', T, async (t) => {
  const { post, o, muster } = await echterServer(t, 'sm1', 10);
  let r = await post('/strudel', { strom: 2, text: 'note("c2")' });
  assert.deepEqual([r.code, r.j.fehler], [409, 'kein_liveprojekt']);
  await o.proj.sitzung.neu('prod', 'andreas');
  r = await post('/strudel', { strom: 2, text: 'note("c2")' });
  assert.deepEqual([r.code, r.j.fehler], [409, 'kein_liveprojekt']);
  assert.equal(fs.existsSync(`${muster}2`), false);
  assert.equal(fs.existsSync(muster) && fs.readdirSync(muster).length > 0, false);
});

test('kein_strudel_modul when no place holds the strudel group; the stream folder stays untouched', T, async (t) => {
  const { post, o, muster, projekt } = await echterServer(t, 'sm2', 10);
  await o.proj.sitzung.liveOeffnen('andreas');
  assert.equal((await post('/plaetze', { platz: 3, typ: 'track' })).code, 200);   // the strudel place is parked
  const r = await post('/strudel', { strom: 2, text: 'note("c2")' });
  assert.deepEqual([r.code, r.j.fehler], [409, 'kein_strudel_modul'], JSON.stringify(r.j));
  assert.equal(fs.existsSync(`${muster}2`), false, 'nothing written to the stream folder');
  assert.equal(stromSpuren(projekt()).length, 0, 'no strom track either');
});

test('the strom track is created on demand with the stream number; a second call creates none', T, async (t) => {
  const { post, o, muster, projekt } = await echterServer(t, 'sm3', 10);
  await o.proj.sitzung.liveOeffnen('andreas');
  assert.equal(stromSpuren(projekt()).length, 0);
  let r = await post('/strudel', { strom: 5, text: 'note("c3")' });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const spuren = stromSpuren(projekt());
  assert.equal(spuren.length, 1);
  assert.equal(spuren[0].strom, 5);
  assert.equal(r.j.strom_spur, spuren[0].id);
  assert.equal(r.j.strom_spur_neu, true);
  assert.match(fs.readFileSync(`${muster}5/strom1.js`, 'utf8'), /note\("c3"\)/);
  const rev = projekt().rev;
  r = await post('/strudel', { strom: 5, text: 'note("c4")' });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.strom_spur, spuren[0].id);
  assert.equal(r.j.strom_spur_neu, undefined);
  assert.equal(stromSpuren(projekt()).length, 1);
  assert.equal(projekt().rev, rev, 'the second call does not touch the project');
});

test('a pattern that fails leaves no strom track behind', T, async (t) => {
  const { post, o, projekt } = await echterServer(t, 'sm4', 10);
  await o.proj.sitzung.liveOeffnen('andreas');
  const r = await post('/strudel', { strom: 6, text: 's("bd*4")\n  .gain(' });
  assert.equal(r.code, 400);
  assert.equal(stromSpuren(projekt()).length, 0);
});

test('streams 9 and 10 are ordinary streams: accepted and get their tracks', T, async (t) => {
  const { post, o, muster, projekt } = await echterServer(t, 'sm5', 10);
  await o.proj.sitzung.liveOeffnen('andreas');
  for (const s of [9, 10]) {
    const r = await post('/strudel', { strom: s, text: `note("c${s - 6}")` });
    assert.equal(r.code, 200, JSON.stringify([s, r.j]));
    assert.ok(fs.existsSync(`${muster}${s}/strom1.js`));
  }
  assert.deepEqual(stromSpuren(projekt()).map((s) => s.strom).sort((a, b) => a - b), [9, 10]);
});

test('GET /strudel is unchanged: it reads the stream folder and needs no project', T, async (t) => {
  const { url } = await echterServer(t, 'sm6', 10);
  const r = await hol(`${url}/strudel`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { text: '', von: null, zeit: null, bezeichnung: null, status: null, autonom: true });
  assert.equal((await hol(`${url}/strudel?strom=4`)).status, 400);
});
