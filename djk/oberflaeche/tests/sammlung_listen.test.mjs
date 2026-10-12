// Listen (Plan 2026-10-10-mediathek-browser, S2b): Sammlungen mit Art, erlaubte Posten je Art, Reihenfolge, Umbenennen
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Sammlungen, LISTEN_ARTEN } from '../sammlung.ts';

const ordner = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-listen-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const M1 = 'aaaaaaaaaaaaaaaa', M2 = 'bbbbbbbbbbbbbbbb', M3 = 'cccccccccccccccc';

test('Listen-Arten: set (Vorgabe, auch alte Dateien ohne art), playlist, looplist, strudellist', (t) => {
  const d = ordner(t), s = new Sammlungen(d);
  assert.deepEqual(LISTEN_ARTEN, ['set', 'playlist', 'looplist', 'strudellist']);
  const p = s.lege('Warm Up', [], 'playlist');
  assert.equal(s.lies(p).art, 'playlist');
  fs.mkdirSync(path.join(d, 'alt')); fs.writeFileSync(path.join(d, 'alt', 'set.json'), JSON.stringify({ schema: 1, name: 'Alt', angelegt: 'x', notiz: '', posten: [], ablauf: null }));
  assert.deepEqual(s.liste().map((e) => [e.slug, e.art]), [['alt', 'set'], ['warm-up', 'playlist']]);
  assert.deepEqual(s.liste('playlist').map((e) => e.slug), ['warm-up'], 'Filter nach Art');
  assert.throws(() => s.lege('X', [], 'mixtape'), (e) => e.code === 400 && e.fehler === 'art_unbekannt');
});

test('erlaubte Posten je Art; Muster-Posten tragen ref statt material_id', (t) => {
  const s = new Sammlungen(ordner(t));
  const pl = s.lege('PL', [], 'playlist'), ll = s.lege('LL', [], 'looplist'), sl = s.lege('SL', [], 'strudellist'), se = s.lege('Set');
  assert.equal(s.legeHinzu(pl, 'track', M1).schon_drin, false);
  assert.throws(() => s.legeHinzu(pl, 'loop', M2), (e) => e.code === 400 && e.fehler === 'art_passt_nicht_zur_liste');
  s.legeHinzu(ll, 'loop', M2); s.legeHinzu(ll, 'oneshot', M3);
  assert.throws(() => s.legeHinzu(ll, 'track', M1), (e) => e.fehler === 'art_passt_nicht_zur_liste');
  s.legeHinzu(sl, 'muster', 'eigen:acid-a');
  s.legeHinzu(sl, 'muster', 'track:cm-erster:d_intro');
  assert.throws(() => s.legeHinzu(sl, 'muster', '../../etc'), (e) => e.code === 400 && e.fehler === 'ref_ungueltig');
  assert.throws(() => s.legeHinzu(sl, 'track', M1), (e) => e.fehler === 'art_passt_nicht_zur_liste');
  assert.deepEqual(s.lies(sl).posten.map((p) => [p.art, p.ref, p.material_id]), [['muster', 'eigen:acid-a', undefined], ['muster', 'track:cm-erster:d_intro', undefined]]);
  for (const [art, ref] of [['track', M1], ['loop', M2], ['oneshot', M3], ['muster', 'eigen:acid-a']]) s.legeHinzu(se, art, ref);
  assert.equal(s.lies(se).posten.length, 4, 'ein Set nimmt alles (gemischte Sammlung)');
});

test('verschiebe: Posten an neue Stelle, Grenzen geklemmt, unbekannt 404; benenne behält den Slug', (t) => {
  const s = new Sammlungen(ordner(t));
  const pl = s.lege('PL', [], 'playlist');
  const ids = [M1, M2, M3].map((m) => s.legeHinzu(pl, 'track', m).id);
  s.verschiebe(pl, ids[2], 0);
  assert.deepEqual(s.lies(pl).posten.map((p) => p.material_id), [M3, M1, M2]);
  s.verschiebe(pl, ids[2], 99);
  assert.deepEqual(s.lies(pl).posten.map((p) => p.material_id), [M1, M2, M3], 'über das Ende hinaus → ans Ende');
  assert.throws(() => s.verschiebe(pl, 'p999', 0), (e) => e.code === 404 && e.fehler === 'posten_unbekannt');
  s.benenne(pl, 'Peak Hour');
  assert.deepEqual([s.lies(pl).name, fs.existsSync(path.join(s.ordnerPfad, pl, 'set.json'))], ['Peak Hour', true]);
  assert.throws(() => s.benenne(pl, ''), (e) => e.fehler === 'name_ungueltig');
});

import { stapel, hole, post, tmpMt, mid } from './hilfen/mediathek.mjs';
test('Routen: anlegen mit art, Liste je art, posten mit ref, verschieben, umbenennen, Traktor-Import als playlist', async (t) => {
  const m = tmpMt(t);
  const s = await stapel(t, { mediathek: m.db, sammlungen: ordner(t) });
  const pl = (await post(s.url, '/sammlungen', { name: 'Peak', art: 'playlist' })).j.slug;
  assert.equal((await post(s.url, '/sammlungen', { name: 'X', art: 'mixtape' })).code, 400);
  assert.equal((await post(s.url, `/sammlungen/${pl}/posten`, { art: 'track', material_id: mid(5) })).code, 201);
  assert.equal((await post(s.url, `/sammlungen/${pl}/posten`, { art: 'track', material_id: mid(2) })).code, 201);
  const vorher = (await hole(s.url, `/sammlungen/${pl}`)).j.posten.map((p) => p.material_id);
  assert.equal((await post(s.url, `/sammlungen/${pl}/posten/verschieben`, { id: 'p2', nach: 0 })).code, 200);
  assert.deepEqual((await hole(s.url, `/sammlungen/${pl}`)).j.posten.map((p) => p.material_id), [vorher[1], vorher[0]]);
  assert.equal((await post(s.url, `/sammlungen/${pl}/umbenennen`, { name: 'Peak Hour' })).code, 200);
  assert.equal((await hole(s.url, `/sammlungen/${pl}`)).j.name, 'Peak Hour');
  assert.equal((await hole(s.url, `/sammlungen/${pl}`)).j.art, 'playlist', 'die Ansicht nennt die Art (die Seite wählt danach die Spalten)');
  const imp = await post(s.url, '/sammlungen/import', { liste_id: 1, art: 'playlist' });
  assert.equal(imp.code, 201);
  assert.deepEqual((await hole(s.url, '/sammlungen?art=playlist')).j.map((e) => e.slug).sort(), [imp.j.slug, pl].sort());
  assert.equal((await hole(s.url, '/sammlungen?art=set')).j.length, 0, 'Import mit art playlist legt kein Set an');
  assert.equal((await post(s.url, '/sammlungen/import', { liste_id: 1 })).code, 201, 'ohne art wie bisher ein Set (Reiter SETS)');
  assert.equal((await post(s.url, '/sammlungen/import', { liste_id: 1, art: 'strudellist' })).j.fehler, 'art_unbekannt', 'Import nur set oder playlist');
  assert.equal((await hole(s.url, '/sammlungen?art=gibtsnicht')).j.length, 0, 'unbekannte Art: leere Liste, kein Fehler');
  const sl = (await post(s.url, '/sammlungen', { name: 'Grooves', art: 'strudellist' })).j.slug;
  assert.deepEqual((await post(s.url, `/sammlungen/${sl}/posten`, { art: 'muster', ref: 'eigen:acid-a' })).code, 201);
  assert.equal((await post(s.url, `/sammlungen/${sl}/posten`, { art: 'muster', ref: '/etc/passwd' })).code, 400);
  assert.equal((await post(s.url, `/sammlungen/${pl}/posten`, { art: 'muster', ref: 'eigen:acid-a' })).j.fehler, 'art_passt_nicht_zur_liste');
  assert.equal((await post(s.url, `/sammlungen/${pl}/posten/verschieben`, { id: 'p999', nach: 0 })).code, 404);
  assert.equal((await post(s.url, `/sammlungen/${pl}/umbenennen`, { name: '' })).code, 400);
});

test('Art-Prüfung auch OHNE Katalog: der typ kommt dann aus der Mediathek (Review S2b Befund 1)', async (t) => {
  const m = tmpMt(t);
  const s = await stapel(t, { mediathek: m.db, sammlungen: ordner(t) });   // kein katalog → /stoebern 503, Sets sehen keinen Katalogeintrag
  assert.equal((await hole(s.url, '/stoebern?typ=track')).code, 503, 'Voraussetzung: der Katalog fehlt');
  const pl = (await post(s.url, '/sammlungen', { name: 'PL', art: 'playlist' })).j.slug;
  const ll = (await post(s.url, '/sammlungen', { name: 'LL', art: 'looplist' })).j.slug;
  assert.deepEqual([(await post(s.url, `/sammlungen/${pl}/posten`, { art: 'track', material_id: mid(14) })).code, 'Loop als track in Playlist'], [400, 'Loop als track in Playlist']);
  assert.equal((await post(s.url, `/sammlungen/${pl}/posten`, { art: 'track', material_id: mid(11) })).code, 400, 'Sample als track');
  assert.equal((await post(s.url, `/sammlungen/${ll}/posten`, { art: 'loop', material_id: mid(5) })).code, 400, 'Track als loop in Loop-Liste');
  assert.equal((await hole(s.url, `/sammlungen/${pl}`)).j.posten.length, 0, 'nichts liegt in der Playlist');
  // Negativkontrolle: passende Arten gehen weiter
  assert.equal((await post(s.url, `/sammlungen/${pl}/posten`, { art: 'track', material_id: mid(5) })).code, 201, 'Track in Playlist');
  assert.equal((await post(s.url, `/sammlungen/${ll}/posten`, { art: 'loop', material_id: mid(14) })).code, 201, 'Loop in Loop-Liste');
});
