// DEVICES list: the star, the filter chips and the indices of filtered rows (production/devices_browser.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { geraeteHtml, filterHtml, geraetKey, eintraege } from '../public/production/devices_browser.js';

const katalog = {
  instrumente: [{ geraet: 'rb338', titel: 'RB-338', ziel: 'spur_neu' },
    { geraet: 'bk', titel: 'synth-mono', ziel: 'spur_neu', graph: 'synth-mono', prinzip: 'analog', kategorie: 'bass' },
    { geraet: 'bk', titel: 'fm-bass', ziel: 'spur_neu', graph: 'fm-bass', prinzip: 'fm', kategorie: 'bass' }],
  effekte: [{ geraet: 'komp', titel: 'Compressor', ziel: 'insert', aktiv: true }],
};

test('geraetKey: bk:<graph>, the device name, null', () => {
  assert.equal(geraetKey(katalog.instrumente[1]), 'bk:synth-mono');
  assert.equal(geraetKey(katalog.effekte[0]), 'komp');
  assert.equal(geraetKey({}), null);
});

test('a filter hides rows but keeps their index into eintraege()', () => {
  const h = geraeteHtml(katalog, 'prinzip', { zeigen: (e) => geraetKey(e) === 'bk:fm-bass', favoriten: new Set(['bk:fm-bass']), stern: true });
  const i = eintraege(katalog, 'prinzip').findIndex((e) => e.graph === 'fm-bass');
  assert.match(h, new RegExp(`data-geraet-i="${i}"`));
  assert.doesNotMatch(h, /synth-mono/);
  assert.match(h, /data-stern="bk:fm-bass"[^>]*>★/);
  assert.match(h, /None in this filter/);   // no effect in the filter
});

test('filter chips: All, the star, collections that hold a device', () => {
  const h = filterHtml([{ slug: 'favourites', name: 'Favourites', keys: new Set() }, { slug: 'bass', name: 'Bass', keys: new Set(['bk:fm-bass']) }, { slug: 'leer', name: 'Empty', keys: new Set() }], 'bass');
  assert.match(h, /data-filter="alle"/);
  assert.match(h, /data-filter="favourites"[^>]*>★/);
  assert.match(h, /class="geraete-chip an" data-filter="bass"/);
  assert.doesNotMatch(h, /Empty/);
});
