// Ringpuffer der Kern-/pegel-Ereignisse: Fenster, Maximum, Median, Speicherdeckel
import test from 'node:test';
import assert from 'node:assert/strict';
import { PegelPuffer } from '../pegel_puffer.ts';

test('drei Master-Ereignisse in 1 s: max_db -6, median_db -9', () => {
  let t = 1000;
  const p = new PegelPuffer(() => t);
  for (const db of [-6, -12, -9]) { p.nimm({ kanal: 'master', spitze_db: db }); t += 300; }
  const k = p.lies(3).master;
  assert.equal(k.n, 3); assert.equal(k.max_db, -6); assert.equal(k.median_db, -9);
});

test('Fenster: Ereignis vor 5 s fehlt bei lies(3), ist bei lies(10) da', () => {
  let t = 0;
  const p = new PegelPuffer(() => t);
  p.nimm({ kanal: 'master', spitze_db: -3 });
  t = 5000;
  assert.deepEqual(p.lies(3), {}, 'Kanal ohne Ereignis im Fenster fehlt');
  assert.equal(p.lies(10).master.max_db, -3);
});

test('nur Stille (-200): max_db -200, median_db null', () => {
  const p = new PegelPuffer(() => 0);
  p.nimm({ kanal: 'erz/1', spitze_db: -200 }); p.nimm({ kanal: 'erz/1', spitze_db: -200 });
  const k = p.lies(3)['erz/1'];
  assert.equal(k.max_db, -200); assert.equal(k.median_db, null); assert.equal(k.n, 2);
});

test('Ereignisse älter als 10 s werden verworfen (Speicher)', () => {
  let t = 0;
  const p = new PegelPuffer(() => t);
  p.nimm({ kanal: 'master', spitze_db: -1 });
  t = 10001;
  p.nimm({ kanal: 'master', spitze_db: -20 });
  assert.equal(p.groesse(), 1);
  assert.equal(p.lies(10).master.max_db, -20);
});

test('Kanäle bleiben getrennt', () => {
  const p = new PegelPuffer(() => 0);
  p.nimm({ kanal: 'master', spitze_db: -5 }); p.nimm({ kanal: 'cue', spitze_db: -30 });
  const l = p.lies(3);
  assert.equal(l.master.max_db, -5); assert.equal(l.cue.max_db, -30);
});
