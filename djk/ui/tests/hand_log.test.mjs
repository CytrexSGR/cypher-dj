// Agent log: rotation, order, no secrets.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HandLog } from '../http/hand_log.ts';

const zeile = (i, extra = {}) => ({
  t: 1000 + i, id: 'k1', name: 'local', werkzeug: 'pad', aktion: null, methode: 'POST', pfad: '/regler', code: 200, ok: true, ...extra,
});
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hl-'));

test('rotates at maxBytes into hand.jsonl.1 and keeps writing', () => {
  const d = tmp(), l = new HandLog(d, 300);
  for (let i = 0; i < 12; i++) l.schreibe(zeile(i));
  assert.ok(fs.existsSync(path.join(d, 'hand.jsonl.1')));
  assert.ok(fs.statSync(path.join(d, 'hand.jsonl')).size <= 300 + 200);
  assert.ok(!fs.existsSync(path.join(d, 'hand.jsonl.2')));
  assert.equal((fs.statSync(path.join(d, 'hand.jsonl')).mode & 0o777), 0o600);
});

test('letzte returns the newest n, oldest first, capped at 200', () => {
  const l = new HandLog(tmp());
  for (let i = 0; i < 250; i++) l.schreibe(zeile(i));
  assert.deepEqual(l.letzte(3).map((z) => z.t), [1247, 1248, 1249]);
  assert.equal(l.letzte(500).length, 200);
});

test('a line holds no authorization, body or token', () => {
  const d = tmp(), l = new HandLog(d);
  l.schreibe(zeile(1, { authorization: 'Bearer SECRET', body: { x: 1 }, token: 'SECRET' }));
  const text = fs.readFileSync(path.join(d, 'hand.jsonl'), 'utf8');
  assert.ok(!/SECRET|authorization|body|token/i.test(text));
});

test('a disk failure does not throw', () => {
  const d = tmp(); fs.writeFileSync(path.join(d, 'datei'), 'x');
  const l = new HandLog(path.join(d, 'datei', 'unter'));
  assert.doesNotThrow(() => l.schreibe(zeile(1)));
  assert.equal(l.letzte(1).length, 1);
});

test('lines survive a restart', () => {
  const d = tmp(); new HandLog(d).schreibe(zeile(7));
  assert.equal(new HandLog(d).letzte(1)[0].t, 1007);
});
