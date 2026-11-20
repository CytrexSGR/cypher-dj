// The address grammar of device windows (public/dock/target.js): `/#geraet=<target>`. Pure, no DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseZiel, formatZiel, zielHash, zielAusHash, zielName } from '../public/dock/target.js';

test('parseZiel: a plain id is a track, the prefixes name stage, return, group, master', () => {
  assert.deepEqual(parseZiel('s3'), { art: 'spur', id: 's3', text: 's3' });
  assert.deepEqual(parseZiel('ins:i7'), { art: 'ins', id: 'i7', text: 'ins:i7' });
  assert.deepEqual(parseZiel('ret:r1'), { art: 'ret', id: 'r1', text: 'ret:r1' });
  assert.deepEqual(parseZiel('grp:g2'), { art: 'grp', id: 'g2', text: 'grp:g2' });
  assert.deepEqual(parseZiel('master'), { art: 'master', id: 'master', text: 'master' });
  assert.deepEqual(parseZiel(' s 3 '), { art: 'spur', id: 's 3', text: 's 3' }, 'an id with a space (old address) is kept, the ends are trimmed');
});
test('parseZiel: nothing, an empty id, reserved live targets and unknown prefixes are null', () => {
  for (const t of ['', '  ', 'ins:', 'ret:', 'grp:', 'fx:3', 'kanal:erz/2', 'color', 'x:y', 'master:1', undefined, null, 5, {}]) assert.equal(parseZiel(t), null, String(t));
});
test('formatZiel is the inverse of parseZiel', () => {
  for (const t of ['s3', 'ins:i7', 'ret:r1', 'grp:g2', 'master']) { const z = parseZiel(t); assert.equal(formatZiel(z.art, z.id), t); }
  assert.equal(formatZiel('master'), 'master');
  assert.equal(formatZiel('ins', ''), null);
  assert.equal(formatZiel('fx', '3'), null);
});
test('zielHash encodes, zielAusHash reads both the encoded and the plain address', () => {
  assert.equal(zielHash(parseZiel('ins:i7')), '#geraet=ins%3Ai7');
  assert.equal(zielHash(parseZiel('s3')), '#geraet=s3');
  assert.deepEqual(zielAusHash('#geraet=ins%3Ai7'), parseZiel('ins:i7'));
  assert.deepEqual(zielAusHash('#geraet=ins:i7'), parseZiel('ins:i7'));
  assert.deepEqual(zielAusHash('#geraet=s%203'), parseZiel('s 3'));
  for (const h of ['#remix', '#controller', '#tablet', '', '#', '#geraet', '#geraet=', '#geraet=%E0%A4%A', '#geraet=fx:3', undefined, null, 5]) assert.equal(zielAusHash(h), null, String(h));
});
test('zielName: one window for every track, one per other target', () => {
  assert.equal(zielName(parseZiel('s3')), 'djk-geraet');
  assert.equal(zielName(parseZiel('s12')), 'djk-geraet');
  assert.equal(zielName(parseZiel('ins:i7')), 'djk-geraet-ins_i7');
  assert.equal(zielName(parseZiel('master')), 'djk-geraet-master');
  assert.notEqual(zielName(parseZiel('ins:i7')), zielName(parseZiel('ins:i8')));
  assert.notEqual(zielName(parseZiel('ret:a')), zielName(parseZiel('grp:a')));
});
