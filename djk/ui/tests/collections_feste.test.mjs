// Media browser slice 2, task 4: the two fixed collections (favourites, recently used) and their rank.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KollektionFehler, slugVon } from '../collections/model.ts';
import { KollektionSpeicher } from '../collections/store.ts';
import { FESTE, FAVORITEN_SLUG, ZULETZT_SLUG, ZULETZT_MAX, istFest, rangVon } from '../collections/feste.ts';

const sha = (n) => n.toString(16).padStart(64, '0');
const S = (n) => ({ art: 'sample', sha: sha(n) });
function speicher(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'koll-feste-')); t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const ordner = path.join(d, 'kollektionen');
  return { ordner, s: new KollektionSpeicher({ ordner }) };
}
const fehlerIst = (code, fehler) => (e) => e instanceof KollektionFehler && e.code === code && e.fehler === fehler;

test('the fixed slugs follow from their names', () => {
  assert.equal(slugVon('Favourites'), 'favourites');
  assert.equal(slugVon('Recently used'), 'recently-used');
  assert.deepEqual(FESTE.map((f) => f.slug), [FAVORITEN_SLUG, ZULETZT_SLUG]);
  assert.ok(istFest('favourites') && istFest('recently-used') && !istFest('mine'));
  assert.equal(ZULETZT_MAX, 50);
});

test('aendere creates a missing fixed collection', (t) => {
  const { s } = speicher(t);
  assert.equal(s.aendere('favourites', { hinzu: [S(1)] }, 'andreas').anzahl, 1);
  assert.equal(s.lies('favourites').name, 'Favourites');
  assert.equal(s.lies('favourites').autor, undefined);
});

test('aendere on another missing slug stays 404 unbekannt', (t) => {
  const { s } = speicher(t);
  assert.throws(() => s.aendere('nope', { hinzu: [S(1)] }, 'andreas'), fehlerIst(404, 'unbekannt'));
});

test('recently-used keeps the newest 50 in use order', (t) => {
  const { s } = speicher(t);
  for (let i = 1; i <= 51; i++) s.aendere('recently-used', { hinzu: [S(i)] }, 'andreas');
  let p = s.lies('recently-used').posten;
  assert.equal(p.length, 50);
  assert.deepEqual(p[0], S(2));
  assert.deepEqual(p[49], S(51));
  s.aendere('recently-used', { weg: [S(10)], hinzu: [S(10)] }, 'andreas');
  p = s.lies('recently-used').posten;
  assert.equal(p.length, 50);
  assert.deepEqual(p[49], S(10));
  assert.equal(p.filter((x) => x.sha === sha(10)).length, 1, 'no duplicate');
});

test('benenne and loesche of a fixed collection are 409 feste_kollektion; own collections stay free', (t) => {
  const { s, ordner } = speicher(t);
  s.aendere('favourites', { hinzu: [S(1)] }, 'andreas');
  s.aendere('recently-used', { hinzu: [S(1)] }, 'andreas');
  for (const slug of ['favourites', 'recently-used']) {
    assert.throws(() => s.benenne(slug, 'Other', 'andreas'), fehlerIst(409, 'feste_kollektion'));
    assert.throws(() => s.loesche(slug, 'andreas'), fehlerIst(409, 'feste_kollektion'));
    assert.ok(fs.existsSync(path.join(ordner, `${slug}.json`)));
  }
  assert.throws(() => s.benenne('mine', 'Favourites', 'andreas'), fehlerIst(404, 'unbekannt'));
  s.lege('Mine', 'andreas');
  assert.throws(() => s.benenne('mine', 'Favourites', 'andreas'), fehlerIst(409, 'feste_kollektion'), 'taking a fixed slug as a new name is refused too');
  assert.deepEqual(s.benenne('mine', 'Yours', 'andreas'), { slug: 'yours' });
  s.loesche('yours', 'andreas');
});

test('rangVon: favourite 0, newest recent 1, older recent 1 + i, others 1000; a damaged file gives 1000', (t) => {
  const { s, ordner } = speicher(t);
  s.aendere('favourites', { hinzu: [S(1), S(2)] }, 'andreas');
  for (const n of [3, 4, 2]) s.aendere('recently-used', { hinzu: [S(n)] }, 'andreas');   // newest: 2, then 4, then 3
  const r = rangVon(s);
  assert.equal(r.rang(sha(1)), 0);
  assert.equal(r.rang(sha(2)), 0, 'favourite beats recent');
  assert.equal(r.rang(sha(4)), 2);
  assert.equal(r.rang(sha(3)), 3);
  assert.equal(r.rang(sha(9)), 1000);
  assert.equal(r.favorit(sha(1)), true);
  assert.equal(r.favorit(sha(4)), false);
  const nurZuletzt = new KollektionSpeicher({ ordner });
  fs.rmSync(path.join(ordner, 'favourites.json'));
  assert.equal(rangVon(nurZuletzt).rang(sha(2)), 1, 'newest recent');
  fs.writeFileSync(path.join(ordner, 'recently-used.json'), '{kaputt');
  const k = rangVon(nurZuletzt);
  assert.equal(k.rang(sha(2)), 1000);
  assert.equal(k.favorit(sha(2)), false);
  assert.equal(rangVon(new KollektionSpeicher({ ordner: path.join(ordner, 'gibtsnicht') })).rang(sha(1)), 1000);
});
