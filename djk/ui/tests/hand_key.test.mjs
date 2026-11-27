// Agent keys (strand 9, task 2.1): the store behind the bearer token. Pure tests of the store module in a tmp folder, no server.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HandSchluessel, SCHLUESSEL_RE } from '../http/hand_key.ts';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hand-schluessel-'));
const modus = (p) => fs.statSync(p).mode & 0o777;
const lokalerToken = (ordner) => fs.readFileSync(path.join(ordner, 'hand.token'), 'utf8').trim();

test('sichereLokal: creates hand.token with mode 0600 in a 0700 folder and registers it as the local hand', () => {
  const wurzel = tmp(), ordner = path.join(wurzel, 'cypherdj');
  const s = new HandSchluessel(ordner);
  s.sichereLokal();
  assert.equal(modus(ordner), 0o700);
  assert.equal(modus(path.join(ordner, 'hand.token')), 0o600);
  assert.equal(modus(path.join(ordner, 'hand_schluessel.json')), 0o600);
  const token = lokalerToken(ordner);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(s.pruefe(`Bearer ${token}`), { id: 'lokal', name: 'local hand', stufe: 'zerstoerend' });
  const roh = fs.readFileSync(path.join(ordner, 'hand_schluessel.json'), 'utf8');
  assert.ok(!roh.includes(token), 'the store holds only the hash');
  assert.deepEqual(s.liste().map((e) => Object.keys(e).sort()), [['id', 'name', 'seit', 'stufe', 'zuletzt']], 'the list carries no hash');
  assert.ok(fs.readdirSync(ordner).every((f) => !f.endsWith('.tmp')), 'no tmp file left');
});

test('a second instance on the same folder accepts the same token and keeps the token file', () => {
  const ordner = tmp();
  new HandSchluessel(ordner).sichereLokal();
  const token = lokalerToken(ordner);
  const zweite = new HandSchluessel(ordner);
  assert.equal(zweite.pruefe(`Bearer ${token}`)?.id, 'lokal');
  zweite.sichereLokal();
  assert.equal(lokalerToken(ordner), token, 'an intact token file is kept');
  assert.equal(zweite.liste().filter((e) => e.id === 'lokal').length, 1);
});

test('sichereLokal replaces a stale hash when the token file changed', () => {
  const ordner = tmp();
  const s = new HandSchluessel(ordner);
  s.sichereLokal();
  const alt = lokalerToken(ordner);
  const neu = 'A'.repeat(43);
  fs.writeFileSync(path.join(ordner, 'hand.token'), `${neu}\n`, { mode: 0o600 });
  const t = new HandSchluessel(ordner);
  t.sichereLokal();
  assert.equal(t.pruefe(`Bearer ${neu}`)?.id, 'lokal');
  assert.equal(t.pruefe(`Bearer ${alt}`), null);
});

test('neu: a lesen key checks to stufe lesen; wrong tokens and malformed headers give null', () => {
  const ordner = tmp();
  const s = new HandSchluessel(ordner);
  s.sichereLokal();
  const { id, token } = s.neu('x', 'lesen');
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(s.pruefe(`Bearer ${token}`), { id, name: 'x', stufe: 'lesen' });
  assert.equal(new HandSchluessel(ordner).pruefe(`Bearer ${token}`)?.stufe, 'lesen', 'persisted');
  assert.equal(s.pruefe(`Bearer ${'B'.repeat(43)}`), null);
  const kaputt = [undefined, '', token, `Basic ${token}`, `Bearer ${token}x`, `Bearer ${token.slice(1)}`, `bearer  ${token}`];
  for (const k of kaputt) assert.equal(s.pruefe(k), null, String(k));
  assert.ok(SCHLUESSEL_RE.test(`Bearer ${token}`));
  assert.throws(() => s.neu('y', 'alles'));
});

test('widerrufe: a revoked key checks to null; the local key may be revoked and is made anew by sichereLokal', () => {
  const ordner = tmp();
  const s = new HandSchluessel(ordner);
  s.sichereLokal();
  const lokal = lokalerToken(ordner);
  const { id, token } = s.neu('x', 'schreiben');
  assert.equal(s.widerrufe(id), true);
  assert.equal(s.pruefe(`Bearer ${token}`), null);
  assert.equal(new HandSchluessel(ordner).pruefe(`Bearer ${token}`), null, 'revocation is on disk');
  assert.equal(s.widerrufe(id), false);
  assert.equal(s.widerrufe('lokal'), true);
  assert.equal(s.pruefe(`Bearer ${lokal}`), null);
  const t = new HandSchluessel(ordner);
  t.sichereLokal();
  const neu = lokalerToken(ordner);
  assert.notEqual(neu, lokal, 'a revoked local token is replaced');
  assert.equal(t.pruefe(`Bearer ${neu}`)?.id, 'lokal');
});

test('a token file with mode 0644 (or a malformed one) is replaced', () => {
  for (const [inhalt, mode] of [['C'.repeat(43), 0o644], ['kurz', 0o600]]) {
    const ordner = tmp();
    const datei = path.join(ordner, 'hand.token');
    fs.writeFileSync(datei, inhalt, { mode });
    fs.chmodSync(datei, mode);
    const s = new HandSchluessel(ordner);
    s.sichereLokal();
    const neu = lokalerToken(ordner);
    assert.notEqual(neu, inhalt);
    assert.equal(modus(datei), 0o600);
    assert.equal(s.pruefe(`Bearer ${inhalt}`), null);
    assert.equal(s.pruefe(`Bearer ${neu}`)?.id, 'lokal');
  }
});

test('zuletzt: updated in memory on every use, written to disk at most hourly', () => {
  const ordner = tmp();
  let t = 1_000_000;
  const s = new HandSchluessel(ordner, () => t);
  const { id, token } = s.neu('x', 'lesen');
  const aufPlatte = () => JSON.parse(fs.readFileSync(path.join(ordner, 'hand_schluessel.json'), 'utf8')).schluessel.find((e) => e.id === id).zuletzt;
  assert.equal(aufPlatte(), 0, 'never used');
  t += 60_000; s.pruefe(`Bearer ${token}`);
  const erste = t;
  assert.equal(aufPlatte(), erste, 'the first use goes to disk');
  t += 60_000; s.pruefe(`Bearer ${token}`);
  assert.equal(s.liste().find((e) => e.id === id).zuletzt, t);
  assert.equal(aufPlatte(), erste, 'a use within the hour stays in memory');
  t += 3600_000; s.pruefe(`Bearer ${token}`);
  assert.equal(aufPlatte(), t);
});
