// 1.10 Slice 1: grp/* und pm/fader ändern sich nur über das Projekt, weder über POST /regler noch über eine Automationsspur (POST /spur).
import test from 'node:test';
import assert from 'node:assert/strict';
import { stapel } from './support/media_library.mjs';
import { ruf, anKern, CYPHER } from './support/proj_stack.mjs';

const UEBER = ['grp/1/fader', 'grp/8/pan', 'grp/3/mute', 'grp/2/solo', 'pm/fader'];
const spur = (name, ...ziele) => ({ spur: { name, fahrten: ziele.map((ziel, i) => ({ ziel, ab_takt: 1 + 2 * i, takte: 1, nach: -6 })) } });

test('1.10 POST /spur mit Ziel grp/* oder pm/fader → 409 ueber_projekt (jede Quelle, auch gemischt), nichts an den Kern, keine laufende Spur', async (t) => {
  const { url, log } = await stapel(t);
  const vorher = anKern(log, '/k/teil').length;
  for (const [i, ziel] of UEBER.entries()) {
    for (const kopf of [{}, CYPHER]) {
      const r = await ruf(url, 'POST', '/spur', spur(`g${i}`, ziel), kopf);
      assert.deepEqual([r.code, r.j.fehler, r.j.ziel, r.j.index], [409, 'ueber_projekt', ziel, 0], `${ziel} ${JSON.stringify(kopf)}: ${JSON.stringify(r.j)}`);
      assert.match(r.j.text, /project/);
    }
  }
  const gemischt = await ruf(url, 'POST', '/spur', spur('gem', 'erz/2/filter', 'grp/1/fader'), CYPHER);
  assert.deepEqual([gemischt.code, gemischt.j.fehler, gemischt.j.ziel, gemischt.j.index], [409, 'ueber_projekt', 'grp/1/fader', 1]);
  assert.equal(anKern(log, '/k/teil').length, vorher, 'nichts ging an den Kern');
  assert.deepEqual((await ruf(url, 'GET', '/spur')).j.laufend ?? [], [], 'keine Spur läuft');
});

test('1.10 POST /regler mit Pfad grp/* oder pm/fader → 409 ueber_projekt (jede Quelle), nichts an den Kern', async (t) => {
  const { url, log } = await stapel(t);
  for (const pfad of UEBER) {
    for (const kopf of [{}, CYPHER]) {
      const r = await ruf(url, 'POST', '/regler', { pfad, nach: 0 }, kopf);
      assert.deepEqual([r.code, r.j.fehler], [409, 'ueber_projekt'], `${pfad} ${JSON.stringify(kopf)}`);
    }
  }
  assert.equal(anKern(log, '/k/teil').length, 0, 'nichts ging an den Kern');
});

test('1.10 Negativ-Kontrolle: erz/* geht weiter durch, grp/17 und pm/pan bleiben 400, ein anderes Ziel in einer Spur bleibt 200', async (t) => {
  const { url, log } = await stapel(t);
  const ok = await ruf(url, 'POST', '/spur', spur('erlaubt', 'erz/2/filter'), CYPHER);
  assert.deepEqual([ok.code, ok.j.ok], [200, true], JSON.stringify(ok.j));
  assert.deepEqual(anKern(log, '/k/teil').map((z) => z.felder.pfad), ['erz/2/filter']);
  assert.equal((await ruf(url, 'POST', '/regler', { pfad: 'erz/2/fader', nach: -3 })).j.ok, true);
  assert.equal((await ruf(url, 'POST', '/regler', { pfad: 'grp/17/fader', nach: 0 })).j.fehler, 'pfad');
  assert.equal((await ruf(url, 'POST', '/regler', { pfad: 'pm/pan', nach: 0 })).j.fehler, 'pfad');
  assert.deepEqual((await ruf(url, 'POST', '/spur', spur('neun', 'grp/17/fader'))).j.fehler, 'spur');
});

// ---- 1.10 slice 3: sends and return strips (Hall values included) change only through the project -----------------------------------------------
const UEBER3 = ['ret/1/fader', 'ret/4/pan', 'ret/2/mute', 'ret/3/solo', 'ret/1/hall/decay', 'ret/1/hall/an', 'spur/1/send/1', 'spur/32/send/4', 'grp/1/send/2', 'grp/8/send/4'];

test('slice 3 POST /regler with ret/* or a send path → 409 ueber_projekt (every source), nothing to the core', async (t) => {
  const { url, log } = await stapel(t);
  for (const pfad of UEBER3) {
    for (const kopf of [{}, CYPHER]) {
      const r = await ruf(url, 'POST', '/regler', { pfad, nach: 0 }, kopf);
      assert.deepEqual([r.code, r.j.fehler], [409, 'ueber_projekt'], `${pfad} ${JSON.stringify(kopf)}: ${JSON.stringify(r.j)}`);
      assert.match(r.j.text, /project/);
    }
  }
  assert.equal(anKern(log, '/k/teil').length, 0, 'nothing went to the core');
  assert.match((await ruf(url, 'POST', '/regler', { pfad: 'ret/1/fader', nach: 0 })).j.text, /send_setzen, return_aendern/);
});

test('slice 3 POST /spur: an automation track cannot drive ret/1/hall/decay or a send (the detour is closed), the index names the target', async (t) => {
  const { url, log } = await stapel(t);
  for (const [i, ziel] of UEBER3.entries()) {
    const r = await ruf(url, 'POST', '/spur', spur(`r${i}`, ziel), CYPHER);
    assert.deepEqual([r.code, r.j.fehler, r.j.ziel, r.j.index], [409, 'ueber_projekt', ziel, 0], `${ziel}: ${JSON.stringify(r.j)}`);
  }
  const gemischt = await ruf(url, 'POST', '/spur', spur('gem', 'erz/2/filter', 'ret/1/hall/decay'), CYPHER);
  assert.deepEqual([gemischt.code, gemischt.j.fehler, gemischt.j.ziel, gemischt.j.index], [409, 'ueber_projekt', 'ret/1/hall/decay', 1]);
  assert.equal(anKern(log, '/k/teil').length, 0, 'nothing went to the core');
  // negative control: ret/5 and spur/1/send/5 are not vocabulary (400), and erz/2/filter still passes
  assert.equal((await ruf(url, 'POST', '/regler', { pfad: 'ret/5/fader', nach: 0 })).j.fehler, 'pfad');
  assert.equal((await ruf(url, 'POST', '/regler', { pfad: 'spur/1/send/5', nach: 0 })).j.fehler, 'pfad');
  assert.equal((await ruf(url, 'POST', '/spur', spur('ok', 'erz/2/filter'), CYPHER)).code, 200);
});

test('live modules: grp/<n>/cue is no project value: POST /regler lets Andreas through to the core, Cypher gets the core refusal, not ueber_projekt', async (t) => {
  const { url, log } = await stapel(t);
  const cue = () => anKern(log, '/k/teil').filter((z) => JSON.stringify(z).includes('grp/1/cue')).length;
  const a = await ruf(url, 'POST', '/regler', { pfad: 'grp/1/cue', nach: 1 });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.equal(cue(), 1, 'Andreas: the row went to the core');
  const c = await ruf(url, 'POST', '/regler', { pfad: 'grp/1/cue', nach: 1 }, CYPHER);
  assert.notEqual(c.j.fehler, 'ueber_projekt', JSON.stringify(c.j));
  assert.equal((await ruf(url, 'POST', '/regler', { pfad: 'grp/1/fader', nach: 0 })).j.fehler, 'ueber_projekt', 'the other group rows stay with the project');
});
