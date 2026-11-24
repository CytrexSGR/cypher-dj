// PROJECTS section (browser plan 2, task 4): the pure rows and the actions against a stand-in host.
import test from 'node:test';
import assert from 'node:assert/strict';
import { projekteZeilen, dupliziere, speichereUnter, umbenenne, loesche, importText, versionZeilen, ladeVersionen, sichereVersion, stelleWiederHer, importiereProjekt, WIEDERHERSTELLEN_FRAGE } from '../public/browser/sektion_projekte.js';

const liste = [
  { slug: 'beat', name: 'Beat', geaendert: '2026-11-23T10:00:00.000Z', zuletzt: '2026-11-23T12:00:00.000Z' },
  { slug: 'mod', name: 'Mod', geaendert: 'g', zuletzt: 'z', werkbank: true },
  { slug: 'trk', name: 'Trk', geaendert: 'g', zuletzt: 'z', tracker: true },
  { slug: 'kaputt', name: 'kaputt', geaendert: 'g', zuletzt: 'z', fehler: 'json_kaputt', text: 'project.json is damaged' },
];

const host = (antworten = {}) => {
  const g = { posts: [], meldungen: [], geoeffnet: [] };
  g.holeGet = async (url) => antworten[url] ?? { status: 200, j: {} };
  g.nachWechsel = () => { g.gewechselt = (g.gewechselt ?? 0) + 1; };
  g.holeJson = async (url, body) => { g.posts.push([url, body]); return antworten[url] ?? { status: 200, j: { ok: true, slug: 'beat-copy' } }; };
  g.oeffne = async (slug) => { g.geoeffnet.push(slug); return { ok: true }; };
  g.melde = (t, fehler) => g.meldungen.push([t, fehler === true]);
  return g;
};

test('projekteZeilen marks the open slug, module, tracker and broken entries and keeps the order', () => {
  const z = projekteZeilen(liste, 'beat');
  assert.deepEqual(z.map((x) => x.art), ['project', 'module', 'tracker', 'broken']);
  assert.deepEqual(z.map((x) => x.offen), [true, false, false, false]);
  assert.equal(z[3].text, 'project.json is damaged');
  assert.equal(z[0].zuletzt, '2026-11-23T12:00:00.000Z');
  assert.deepEqual(projekteZeilen(null, null), []);
});

test('DELETE on the open row does not post; elsewhere it asks once and posts', async () => {
  const h = host();
  assert.equal((await loesche(h, { slug: 'beat', name: 'Beat', offen: true }, () => true)).ok, false);
  assert.deepEqual(h.posts, []);
  assert.equal((await loesche(h, { slug: 'x', name: 'X', offen: false }, () => false)).ok, false);
  assert.deepEqual(h.posts, []);
  let text = '';
  assert.equal((await loesche(h, { slug: 'x', name: 'X', offen: false }, (t) => { text = t; return true; })).ok, true);
  assert.match(text, /Move the project X to the bin/);
  assert.deepEqual(h.posts, [['/proj/loeschen', { slug: 'x' }]]);
});

test('DUPLICATE posts the copy named "<name> copy" and does not open it', async () => {
  const h = host();
  await dupliziere(h, { slug: 'beat', name: 'Beat' });
  assert.deepEqual(h.posts, [['/proj/kopie', { slug: 'beat', name: 'Beat copy' }]]);
  assert.deepEqual(h.geoeffnet, []);
});

test('SAVE AS copies then opens the copy; a refusal shows the route text as an error', async () => {
  const h = host();
  await speichereUnter(h, { slug: 'beat', name: 'Beat' }, 'Take 2');
  assert.deepEqual(h.posts, [['/proj/kopie', { slug: 'beat', name: 'Take 2' }]]);
  assert.deepEqual(h.geoeffnet, ['beat-copy']);
  const n = host({ '/proj/kopie': { status: 409, j: { grund: 'name_vergeben', text: 'another project has that name' } } });
  assert.equal((await speichereUnter(n, { slug: 'beat', name: 'Beat' }, 'Beat')).ok, false);
  assert.deepEqual(n.meldungen, [['another project has that name', true]]);
  assert.deepEqual(n.geoeffnet, []);
});

test('RENAME posts slug and name; 409 name_vergeben shows its text', async () => {
  const h = host({ '/proj/umbenennen': { status: 409, j: { grund: 'name_vergeben', text: 'another project has that name' } } });
  const r = await umbenenne(h, { slug: 'mod', name: 'Mod' }, 'Beat');
  assert.equal(r.ok, false);
  assert.deepEqual(h.posts, [['/proj/umbenennen', { slug: 'mod', name: 'Beat' }]]);
  assert.deepEqual(h.meldungen, [['another project has that name', true]]);
});

test('importText: the slug, and each renamed kit with both names', () => {
  assert.equal(importText({ slug: 'beat-2', kits_umbenannt: [] }), 'Imported as "beat-2".');
  const t = importText({ slug: 'beat-2', kits_umbenannt: [{ alt: 'Drums', neu: 'Drums-3fa91c2e' }] });
  assert.equal(t, 'Imported as "beat-2". Kit "Drums" was installed as "Drums-3fa91c2e" because another kit had that name.');
});

test('versionZeilen: newest first, named or Automatic with the local date, auto flags follow the input', () => {
  assert.deepEqual(versionZeilen(null), []);
  const z = versionZeilen({ versionen: [
    { id: 'a1', zeit: '2026-11-23T10:00:00.000Z', auto: true },
    { id: 'n1', zeit: '2026-11-23T12:30:00.000Z', name: 'Before the drop', auto: false },
  ] });
  assert.deepEqual(z.map((x) => [x.id, x.auto]), [['n1', false], ['a1', true]]);
  assert.match(z[0].text, /^Before the drop \d{4}-\d\d-\d\d \d\d:\d\d$/);
  assert.match(z[1].text, /^Automatic \d{4}-\d\d-\d\d \d\d:\d\d$/);
});

test('VERSIONS: a 404 hides them, SAVE VERSION posts the name, RESTORE asks once: no posts nothing, yes posts {id} once and reads the project again', async () => {
  assert.equal((await ladeVersionen(host({ '/proj/versionen': { status: 404 } }))).status, 'nicht_da');
  assert.equal((await ladeVersionen(host({ '/proj/versionen': { status: 409, j: { grund: 'kein_projekt' } } }))).status, 'kein_projekt');
  let h = host({ '/proj/version_sichern': { status: 200, j: { ok: true, id: 'v1' } } });
  assert.deepEqual(await sichereVersion(h, 'Before'), { status: 'ok', id: 'v1' });
  assert.deepEqual(h.posts, [['/proj/version_sichern', { name: 'Before' }]]);
  h = host({ '/proj/version_zurueck': { status: 200, j: { ok: true, gesichert_als: 'v9' } } });
  let text = '';
  assert.equal((await stelleWiederHer(h, 'v1', (t) => { text = t; return false; })).status, 'abgebrochen');
  assert.deepEqual(h.posts, []);
  assert.equal(text, WIEDERHERSTELLEN_FRAGE);
  assert.equal((await stelleWiederHer(h, 'v1', () => true)).status, 'ok');
  assert.deepEqual(h.posts, [['/proj/version_zurueck', { id: 'v1' }]]);
  assert.equal(h.gewechselt, 1);
  const f = host({ '/proj/version_zurueck': { status: 409, j: { ok: false, grund: 'version_neuer', text: 'that version was written by a newer format' } } });
  assert.equal((await stelleWiederHer(f, 'v1', () => true)).status, 'fehler');
  assert.deepEqual(f.meldungen, [['that version was written by a newer format', true]]);
  assert.equal(f.gewechselt, undefined);
});

test('IMPORT PROJECT sends a project zip, shows importText and opens the slug; a zip that is no project is refused before sending; 404 is not available', async () => {
  const datei = { name: 'beat.cypherdj.zip' };
  const route = { url: '/proj/import_zip', art: 'projekt', headers: {} };
  const h = host();
  const gesendet = [];
  const r = await importiereProjekt(h, datei, { route, sende: async (d, ro) => { gesendet.push(ro.url); return { status: 200, j: { ok: true, slug: 'beat-2', kits_umbenannt: [{ alt: 'Drums', neu: 'Drums-3fa91c2e' }] } }; } });
  assert.equal(r.status, 'ok');
  assert.deepEqual(gesendet, ['/proj/import_zip']);
  assert.deepEqual(h.geoeffnet, ['beat-2']);
  assert.match(h.meldungen[0][0], /Imported as "beat-2"\. Kit "Drums" was installed as "Drums-3fa91c2e"/);
  const k = host();
  assert.equal((await importiereProjekt(k, datei, { route: { art: 'zip' }, sende: async () => assert.fail('not sent') })).status, 'fehler');
  assert.equal((await importiereProjekt(host(), datei, { route, sende: async () => ({ status: 404, j: null }) })).status, 'nicht_da');
  const ab = host();
  assert.equal((await importiereProjekt(ab, datei, { route, sende: async () => ({ status: 400, j: { ok: false, grund: 'zip_abgelehnt', text: 'the zip was refused' } }) })).status, 'fehler');
  assert.deepEqual(ab.geoeffnet, []);
});
