// D1 S2-Integration, Fix-Runde A5 (Spec 6.30 zu 6.22, Spec-Review P3a/R4): 6.22 gilt für jeden Weg. Auch POST /spur (Studio-Automation,
// Werkzeug spur) lehnt Ziele spur/* mit 409 ueber_projekt ab; vorher nahm pruefeSpur spur/1/fader an (review-spec/p3a_spur_umweg.txt) und
// der Server schickte /k/teil am Projekt vorbei. erz/* und die übrigen Ziele bleiben, wie sie waren.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stapel } from './hilfen/mediathek.mjs';
import { ruf, anKern, CYPHER } from './hilfen/proj_stapel.mjs';

const spur = (name, ...ziele) => ({ spur: { name, fahrten: ziele.map((ziel, i) => ({ ziel, ab_takt: 1 + 2 * i, takte: 1, nach: -6 })) } });

test('A5 POST /spur mit Ziel spur/* → 409 ueber_projekt (jede Quelle, auch gemischt), nichts an den Kern, keine laufende Spur', async (t) => {
  const { url, log } = await stapel(t);
  const vorher = anKern(log, '/k/teil').length;
  const faelle = [['a', 'spur/1/fader'], ['b', 'spur/8/pan'], ['c', 'spur/3/mute'], ['d', 'spur/2/solo'], ['e', 'erz/2/filter', 'spur/4/fader']];
  for (const [name, ...ziele] of faelle) {
    for (const kopf of [{}, CYPHER]) {
      const r = await ruf(url, 'POST', '/spur', spur(`u-${name}`, ...ziele), kopf);
      const ziel = ziele.find((z) => z.startsWith('spur/'));
      assert.deepEqual([r.code, r.j.fehler, r.j.ziel], [409, 'ueber_projekt', ziel], `${ziele.join(',')} ${JSON.stringify(kopf)}: ${JSON.stringify(r.j)}`);
      assert.match(r.j.text, /project/);
    }
  }
  assert.equal(anKern(log, '/k/teil').length, vorher, 'nichts ging an den Kern');
  assert.deepEqual((await ruf(url, 'GET', '/spur')).j.laufend ?? [], [], 'keine Spur läuft');
});

test('A5 Negativ-Kontrolle: erz/* geht weiter durch (200, /k/teil an den Kern); spur/9 bleibt 400 spur', async (t) => {
  const { url, log } = await stapel(t);
  const ok = await ruf(url, 'POST', '/spur', spur('erlaubt', 'erz/2/filter'), CYPHER);
  assert.deepEqual([ok.code, ok.j.ok], [200, true], JSON.stringify(ok.j));
  assert.deepEqual(anKern(log, '/k/teil').map((z) => z.felder.pfad), ['erz/2/filter']);
  const neun = await ruf(url, 'POST', '/spur', spur('neun', 'spur/9/fader'));
  assert.deepEqual([neun.code, neun.j.fehler], [400, 'spur']);
});
