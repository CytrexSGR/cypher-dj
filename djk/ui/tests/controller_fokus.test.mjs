// Controller focus (page side): which selection yields which message, and the sender (dedupe, window focus, a server without the route).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fokusVon, neuerFokusSender, waehleQuelle } from '../public/controller_fokus.js';

test('fokusVon: a channel, a project track, nothing', () => {
  assert.deepEqual(fokusVon({ kanal: 'erz/5' }), { kanal: 'erz/5' });
  assert.deepEqual(fokusVon({ spur_id: 's3' }), { spur_id: 's3' });
  assert.deepEqual(fokusVon({ spurId: 's3' }), { spur_id: 's3' }, 'the page spells it spurId in places');
  assert.deepEqual(fokusVon('erz/6'), { kanal: 'erz/6' });
  assert.deepEqual(fokusVon('s12'), { spur_id: 's12' });
  assert.deepEqual(fokusVon({ kanal: 'pad/1' }), { kanal: 'pad/1' });
  for (const leer of [null, undefined, '', '  ', {}, { kanal: '' }, { spur_id: null }, 5, [], { kanal: 3 }]) assert.equal(fokusVon(leer), null, JSON.stringify(leer));
});
test('fokusVon: a channel wins when both are given, the id is trimmed', () => {
  assert.deepEqual(fokusVon({ kanal: 'erz/5', spur_id: 's1' }), { kanal: 'erz/5' });
  assert.deepEqual(fokusVon({ spur_id: ' s2 ' }), { spur_id: 's2' });
});

const bereit = () => { const gesendet = []; const s = neuerFokusSender({ senden: async (d) => { gesendet.push(d); return { status: 200 }; } }); return { s, gesendet }; };
const warte = () => new Promise((r) => setImmediate(r));

test('sender: the same focus is not sent twice in a row, a changed one is', async () => {
  const { s, gesendet } = bereit();
  assert.equal(s.melde({ kanal: 'erz/5' }), true);
  assert.equal(s.melde({ kanal: 'erz/5' }), false);
  assert.equal(s.melde({ spur_id: 's3' }), true);
  assert.equal(s.melde({ kanal: 'erz/5' }), true, 'back to the first one is a change');
  await warte();
  assert.deepEqual(gesendet, [{ kanal: 'erz/5' }, { spur_id: 's3' }, { kanal: 'erz/5' }]);
});
test('sender: a selection that is no synth sends nothing and keeps the last one', async () => {
  const { s, gesendet } = bereit();
  s.melde({ kanal: 'erz/5' });
  assert.equal(s.melde(null), false);
  assert.equal(s.melde({}), false);
  assert.equal(s.melde({ kanal: 'erz/5' }), false, 'the last synth is still in front: no resend');
  await warte();
  assert.equal(gesendet.length, 1);
});
test('sender: what the server reports counts as the last focus (another window moved it)', async () => {
  const { s, gesendet } = bereit();
  s.melde({ kanal: 'erz/5' });
  s.vomServer({ fokus: { kanal: 'erz/6', graph: 'synth-poly', basis: 'erz/6/bk/' }, plaetze: [] });
  assert.equal(s.melde({ kanal: 'erz/6' }), false, 'the server has it already');
  assert.equal(s.melde({ kanal: 'erz/5' }), true, 'this page selected it again');
  s.vomServer({ fokus: { spur_id: 's2', graph: null, basis: null, grund: 'kein_graph' }, plaetze: [] });
  assert.equal(s.melde({ spur_id: 's2' }), false);
  s.vomServer({ fokus: null, plaetze: [] });
  assert.equal(s.melde({ spur_id: 's2' }), true, 'no focus on the server: send it');
  await warte();
  assert.deepEqual(gesendet, [{ kanal: 'erz/5' }, { kanal: 'erz/5' }, { spur_id: 's2' }]);
});
test('sender: window focus sends the selection of the page again, also when it is the last one this page sent', async () => {
  const { s, gesendet } = bereit();
  s.registriere('instrumente', () => ({ kanal: 'erz/5' }));
  s.melde({ kanal: 'erz/5' }, 'instrumente');
  s.erneut();
  s.erneut();
  await warte();
  assert.deepEqual(gesendet, [{ kanal: 'erz/5' }, { kanal: 'erz/5' }, { kanal: 'erz/5' }]);
});
test('sender: window focus without a visible selection sends nothing', async () => {
  const { s, gesendet } = bereit();
  s.registriere('a', () => null);
  s.registriere('b', () => undefined);
  assert.equal(s.erneut(), false);
  await warte();
  assert.deepEqual(gesendet, []);
});
test('waehleQuelle: the source that spoke last first, then the others in order; invisible ones are skipped', () => {
  const q = [['a', () => ({ kanal: 'erz/2' })], ['b', () => ({ spur_id: 's1' })], ['c', () => null]];
  assert.deepEqual(waehleQuelle(q, null), { kanal: 'erz/2' });
  assert.deepEqual(waehleQuelle(q, 'b'), { spur_id: 's1' });
  assert.deepEqual(waehleQuelle(q, 'c'), { kanal: 'erz/2' }, 'the last speaker has nothing visible now');
  assert.equal(waehleQuelle([['c', () => null]], 'c'), null);
  assert.equal(waehleQuelle([['x', () => { throw new Error('boom'); }], ['b', () => ({ spur_id: 's1' })]], null) !== undefined, true, 'a failing source does not stop the others');
});
test('sender: a server without the route (404) stops the automatic sends, window focus tries again', async () => {
  const antworten = [{ status: 404 }, { status: 200 }];
  const gesendet = [];
  const s = neuerFokusSender({ senden: async (d) => { gesendet.push(d); return antworten.shift() ?? { status: 200 }; } });
  s.registriere('i', () => ({ kanal: 'erz/5' }));
  s.melde({ kanal: 'erz/5' });
  await warte();
  assert.equal(s.fehlt(), true);
  assert.equal(s.melde({ kanal: 'erz/6' }), false, 'no spam against a server that does not know the route');
  await warte();
  assert.equal(gesendet.length, 1);
  s.erneut();
  await warte();
  assert.equal(gesendet.length, 2);
  assert.equal(s.fehlt(), false, 'it answered this time');
});
test('sender: a thrown or refused send does not throw out of melde and is retried at the next change', async () => {
  let n = 0;
  const gesendet = [];
  const s = neuerFokusSender({ senden: async (d) => { gesendet.push(d); n++; if (n === 1) throw new Error('offline'); return { status: n === 2 ? 403 : 200 }; } });
  assert.doesNotThrow(() => s.melde({ kanal: 'erz/5' }));
  await warte();
  assert.equal(s.melde({ kanal: 'erz/5' }), true, 'the first send failed: the same focus goes out again');
  await warte();
  assert.equal(gesendet.length, 2);
  assert.equal(s.fehlt(), false, '403 is not "route missing"');
});
test('sender: before a send function is connected the latest selection waits and goes out on connect', async () => {
  const s = neuerFokusSender({});
  s.melde({ kanal: 'erz/2' });
  s.melde({ kanal: 'erz/3' });
  const gesendet = [];
  s.verbinde(async (d) => { gesendet.push(d); return { status: 200 }; });
  await warte();
  assert.deepEqual(gesendet, [{ kanal: 'erz/3' }]);
});
