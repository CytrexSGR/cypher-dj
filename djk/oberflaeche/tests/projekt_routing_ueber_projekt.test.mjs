// 1.10 Slice 1: grp/* und pm/fader ändern sich nur über das Projekt, weder über POST /regler noch über eine Automationsspur (POST /spur).
import test from 'node:test';
import assert from 'node:assert/strict';
import { stapel } from './hilfen/mediathek.mjs';
import { ruf, anKern, CYPHER } from './hilfen/proj_stapel.mjs';

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

test('1.10 Negativ-Kontrolle: erz/* geht weiter durch, grp/9 und pm/pan bleiben 400, ein anderes Ziel in einer Spur bleibt 200', async (t) => {
  const { url, log } = await stapel(t);
  const ok = await ruf(url, 'POST', '/spur', spur('erlaubt', 'erz/2/filter'), CYPHER);
  assert.deepEqual([ok.code, ok.j.ok], [200, true], JSON.stringify(ok.j));
  assert.deepEqual(anKern(log, '/k/teil').map((z) => z.felder.pfad), ['erz/2/filter']);
  assert.equal((await ruf(url, 'POST', '/regler', { pfad: 'erz/2/fader', nach: -3 })).j.ok, true);
  assert.equal((await ruf(url, 'POST', '/regler', { pfad: 'grp/9/fader', nach: 0 })).j.fehler, 'pfad');
  assert.equal((await ruf(url, 'POST', '/regler', { pfad: 'pm/pan', nach: 0 })).j.fehler, 'pfad');
  assert.deepEqual((await ruf(url, 'POST', '/spur', spur('neun', 'grp/9/fader'))).j.fehler, 'spur');
});
