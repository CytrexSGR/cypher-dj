// INSTRUMENTS AND EFFECTS and PRESETS sections (browser plan 2, tasks 10 and 11): pure parts and actions against stand-in hosts with the contract shapes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pfadeZeilen, pluginZusatz, ladePfade, fuegePluginOrdnerHinzu, entfernePluginOrdner, entsperre } from '../public/browser/sektion_devices.js';

const aktHost = (antworten = {}) => {
  const g = { posts: [], gets: [], meldungen: [] };
  g.holeJson = async (url, body) => { g.posts.push([url, body]); return antworten[url] ?? { status: 200, j: { ok: true } }; };
  g.holeGet = async (url) => { g.gets.push(url); return antworten[url] ?? { status: 200, j: {} }; };
  g.melde = (t, f) => g.meldungen.push([t, f === true]);
  return g;
};

test('pfadeZeilen: only rows added by the user can be removed, the words are English', () => {
  assert.deepEqual(pfadeZeilen(null), []);
  assert.deepEqual(pfadeZeilen({ pfade: [{ pfad: '/a', quelle: 'nutzer' }, { pfad: '/b', quelle: 'paket' }, { pfad: '/c', quelle: 'umgebung' }, { pfad: '/d', quelle: 'datei' }] }).map((z) => [z.pfad, z.text, z.entfernbar]),
    [['/a', 'Added by you', true], ['/b', 'Bundled', false], ['/c', 'Environment', false], ['/d', 'Config file', false]]);
});

test('pluginZusatz: vendor and version, empty when both are missing', () => {
  assert.equal(pluginZusatz({ hersteller: 'Xfer', version: '1.2' }), 'Xfer 1.2');
  assert.equal(pluginZusatz({ hersteller: 'Xfer' }), 'Xfer');
  assert.equal(pluginZusatz({ version: '2' }), '2');
  assert.equal(pluginZusatz({}), '');
  assert.equal(pluginZusatz(null), '');
});

test('ADD PLUGIN FOLDER posts the folder, then rescans; cancelling posts nothing; a refusal shows its text', async () => {
  let h = aktHost();
  const r = await fuegePluginOrdnerHinzu(h, { waehleOrdner: async () => '/opt/vst3' });
  assert.equal(r.status, 'ok');
  assert.deepEqual(h.posts, [['/plugins/pfade/dazu', { pfad: '/opt/vst3' }], ['/plugins/rescan', {}]]);
  h = aktHost();
  assert.equal((await fuegePluginOrdnerHinzu(h, { waehleOrdner: async () => null })).status, 'abgebrochen');
  assert.deepEqual(h.posts, []);
  h = aktHost({ '/plugins/pfade/dazu': { status: 400, j: { ok: false, grund: 'argument_ungueltig', text: 'that folder does not exist' } } });
  assert.equal((await fuegePluginOrdnerHinzu(h, { waehleOrdner: async () => '/nope' })).status, 'fehler');
  assert.deepEqual(h.meldungen, [['that folder does not exist', true]]);
  assert.deepEqual(h.posts.map((p) => p[0]), ['/plugins/pfade/dazu']);   // no rescan after a refusal
  h = aktHost({ '/plugins/pfade/dazu': { status: 404 } });
  assert.equal((await fuegePluginOrdnerHinzu(h, { waehleOrdner: async () => '/x' })).status, 'nicht_da');
});

test('plugin paths: a 404 gives no list (the section hides the sub-head), REMOVE posts the path and rescans', async () => {
  assert.deepEqual(await ladePfade(aktHost({ '/plugins/pfade': { status: 404 } })), { status: 'nicht_da', zeilen: [] });
  const ok = await ladePfade(aktHost({ '/plugins/pfade': { status: 200, j: { pfade: [{ pfad: '/a', quelle: 'nutzer' }] } } }));
  assert.equal(ok.status, 'ok');
  assert.equal(ok.zeilen[0].entfernbar, true);
  const h = aktHost();
  assert.equal((await entfernePluginOrdner(h, '/a')).status, 'ok');
  assert.deepEqual(h.posts, [['/plugins/pfade/weg', { pfad: '/a' }], ['/plugins/rescan', {}]]);
});

test('UNBLOCK posts the id; a running scan and an unknown plugin say so; no melde on success', async () => {
  let h = aktHost();
  assert.equal((await entsperre(h, 'p1')).status, 'ok');
  assert.deepEqual(h.posts, [['/plugins/entsperren', { id: 'p1' }]]);
  assert.deepEqual(h.meldungen, []);
  h = aktHost({ '/plugins/entsperren': { status: 409, j: { ok: false, grund: 'scan_laeuft' } } });
  assert.equal((await entsperre(h, 'p1')).status, 'fehler');
  assert.match(h.meldungen[0][0], /scan is running/);
  h = aktHost({ '/plugins/entsperren': { status: 404, j: { ok: false, grund: 'plugin_unbekannt' } } });
  assert.equal((await entsperre(h, 'p1')).status, 'fehler');
  assert.match(h.meldungen[0][0], /not in the index/);
});

// ---- task 11: PRESETS ----
import { kitZeilen, ladeKits, kitAusOrdner, loescheKit, vorhoereKit, importiereKit, benenneKitUm, KITS_NICHT_DA } from '../public/browser/sektion_kits.js';
import { zeigeKollektionsMenue } from '../public/browser/kollektion_menue.js';
import { beiAchse, merkeAchse, leseAchse } from '../public/instrument_groups.js';
import { presetZusatzHtml, vorschau, setzeStern, importiere, ladeExport } from '../public/browser/sektion_presets.js';
import { panelHtml, PresetPanel } from '../public/presets.js';

test('presetZusatzHtml: PREVIEW, EXPORT and the star; the id is escaped; a damaged file disables PREVIEW and EXPORT', () => {
  const h = presetZusatzHtml({}, 'werk:komp/drum-bus', false);
  assert.match(h, /data-preset-aktion="vorschau" data-preset-id="werk:komp\/drum-bus"/);
  assert.match(h, /href="\/presets\/export\?id=werk%3Akomp%2Fdrum-bus" download/);
  assert.match(h, /data-preset-aktion="stern"[^>]*aria-pressed="false"/);
  assert.doesNotMatch(h, / disabled/);
  assert.match(presetZusatzHtml({}, 'a', true), /aria-pressed="true"[^>]*>★/);
  const x = presetZusatzHtml({}, 'a"><img src=x onerror=1>', false);
  assert.doesNotMatch(x, /<img/);
  const k = presetZusatzHtml({ fehler: 'kaputt' }, 'a', false);
  assert.match(k, /data-preset-aktion="vorschau"[^>]* disabled/);
  assert.match(k, /data-preset-aktion="export"[^>]*disabled/);
  assert.doesNotMatch(k, /href=/);
  assert.match(presetZusatzHtml({}, 'a', false, {}, true), /Rendering…/);
  assert.match(presetZusatzHtml({}, 'a', false, { vorschau: true }), /data-preset-aktion="vorschau"[^>]* disabled[^>]*title="Not available in this build yet"/);
});

test('PREVIEW posts the id; a 404 only disables the key; a refusal shows its text', async () => {
  let h = aktHost({ '/presets/vorhoeren': { status: 200, j: { ok: true, aus_cache: true } } });
  assert.deepEqual(await vorschau(h, 'werk:komp/x'), { status: 'ok', aus_cache: true });
  assert.deepEqual(h.posts, [['/presets/vorhoeren', { id: 'werk:komp/x' }]]);
  assert.equal((await vorschau(aktHost({ '/presets/vorhoeren': { status: 404 } }), 'x')).status, 'nicht_da');
  h = aktHost({ '/presets/vorhoeren': { status: 409, j: { ok: false, grund: 'beschaeftigt', text: 'Another preview is rendering' } } });
  assert.equal((await vorschau(h, 'x')).status, 'fehler');
  assert.deepEqual(h.meldungen, [['Another preview is rendering', true]]);
});

test('the star writes the favourites collection with {art: preset, id}', async () => {
  const h = aktHost();
  assert.equal((await setzeStern(h, 'werk:komp/x', true)).status, 'ok');
  assert.equal((await setzeStern(h, 'werk:komp/x', false)).status, 'ok');
  assert.deepEqual(h.posts, [['/kollektionen/favourites/posten', { hinzu: [{ art: 'preset', id: 'werk:komp/x' }] }], ['/kollektionen/favourites/posten', { weg: [{ art: 'preset', id: 'werk:komp/x' }] }]]);
});

test('IMPORT PRESET sends the raw text with only the JSON content type; a refusal shows the server text; 404 is not available', async () => {
  const aufrufe = [];
  const f = (antwort) => async (url, opt) => { aufrufe.push([url, opt]); return { status: antwort.status, json: async () => antwort.j }; };
  let h = aktHost();
  const r = await importiere(h, '{"name":"x"}', { fetchFn: f({ status: 200, j: { ok: true, id: 'nutzer:komp/x' } }) });
  assert.deepEqual(r, { status: 'ok', id: 'nutzer:komp/x', schon_da: false });
  assert.equal(aufrufe[0][0], '/presets/import');
  assert.equal(aufrufe[0][1].body, '{"name":"x"}');
  assert.deepEqual(aufrufe[0][1].headers, { 'content-type': 'application/json' });
  h = aktHost();
  assert.equal((await importiere(h, '{', { fetchFn: f({ status: 400, j: { ok: false, grund: 'preset_ungueltig', text: 'This is not a preset file' } }) })).status, 'fehler');
  assert.deepEqual(h.meldungen, [['This is not a preset file', true]]);
  assert.equal((await importiere(aktHost(), '{}', { fetchFn: f({ status: 404, j: null }) })).status, 'nicht_da');
  h = aktHost();
  const schon = await importiere(h, '{}', { fetchFn: f({ status: 200, j: { ok: true, id: 'nutzer:komp/x', schon_da: true } }) });
  assert.equal(schon.schon_da, true);
  assert.deepEqual(h.meldungen, [['That preset is already there: nothing was added', false]]);
});

test('an unknown preset (404 with a code, `fehler` only) is an error of that preset, not a missing route', async () => {
  const f = (j) => async () => ({ status: 404, json: async () => j, blob: async () => 'B' });
  let h = aktHost();
  assert.deepEqual(await ladeExport(h, 'werk:komp/zz', { fetchFn: f({ fehler: 'unbekannt', text: 'No such preset' }) }), { status: 'fehler', text: 'No such preset' });
  assert.deepEqual(h.meldungen, [['No such preset', true]]);
  h = aktHost({ '/presets/vorhoeren': { status: 404, j: { fehler: 'unbekannt', text: 'No such preset' } } });
  assert.equal((await vorschau(h, 'werk:komp/zz')).status, 'fehler');
  assert.equal((await importiere(aktHost(), '{}', { fetchFn: f({ fehler: 'unbekannt', text: 'x' }) })).status, 'fehler');
});

test('EXPORT fetches the file and saves it; a 404 is not available', async () => {
  const gespeichert = [];
  const f = (status) => async () => ({ status, blob: async () => 'BLOB', json: async () => null });
  assert.equal((await ladeExport(aktHost(), 'werk:komp/x', { fetchFn: f(200), speichere: (b, n) => gespeichert.push([b, n]) })).status, 'ok');
  assert.deepEqual(gespeichert, [['BLOB', 'x.json']]);
  assert.equal((await ladeExport(aktHost(), 'x', { fetchFn: f(404), speichere: () => assert.fail('nothing to save') })).status, 'nicht_da');
});

test('the panel: the hook adds its HTML to every row, the save form folds behind SAVE AS PRESET and opens and closes; without both the output is the old one', () => {
  const z = { geraete: [{ id: 'komp', titel: 'Compressor', typ: 'effekt' }], liste: [{ herkunft: 'werk', geraet: 'komp', slug: 'a', name: 'A', tags: [] }], filter: { q: '', tag: '', geraet: 'komp', herkunft: '', art: '', charakter: '', genre: '', einsatz: '', energie: '' }, ziehbar: () => false, ziele: () => null };
  const alt = panelHtml(z);
  assert.doesNotMatch(alt, /SAVE AS PRESET/);
  assert.equal(panelHtml({ ...z, zeilenZusatz: () => '' }), alt);
  assert.match(panelHtml({ ...z, zeilenZusatz: (e, id) => `<b class="zusatz">${id}</b>` }), /<b class="zusatz">werk\/komp\/a<\/b>/);
  const zu = panelHtml({ ...z, speichernFalten: true });
  assert.match(zu, /data-preset-aktion="speichern-auf"[^>]*>SAVE AS PRESET/);
  assert.doesNotMatch(zu, /data-preset-entwurf/);
  const auf = panelHtml({ ...z, speichernFalten: true, speichernOffen: true });
  assert.match(auf, /data-preset-entwurf="name"/);
  assert.match(auf, /data-preset-aktion="speichern-zu"/);
  const p = new PresetPanel({ innerHTML: '', querySelector: () => null, addEventListener() {} }, { speichernFalten: true });
  p.ereignis('click', { target: { closest: () => ({ dataset: { presetAktion: 'speichern-auf' } }) } });
  assert.equal(p.z.speichernOffen, true);
  p.ereignis('click', { target: { closest: () => ({ dataset: { presetAktion: 'speichern-zu' } }) } });
  assert.equal(p.z.speichernOffen, false);
});

test('right click menu of the browser: one entry per collection, an item already inside is disabled, a new collection asks for a name', async () => {
  const h = aktHost({
    '/kollektionen': { status: 200, j: [{ slug: 'a', name: 'A' }, { slug: 'b', name: 'B' }] },
    '/kollektionen/a': { status: 200, j: { posten: [{ art: 'geraet', geraet: 'komp' }] } },
    '/kollektionen/b': { status: 200, j: { posten: [] } },
  });
  let punkte = null;
  assert.equal(await zeigeKollektionsMenue(h, { art: 'geraet', geraet: 'komp' }, 5, 6, { menue: (p, x, y) => { punkte = [p, x, y]; } }), true);
  assert.deepEqual(punkte[0].map((p) => [p.text, !!p.aus]), [['Add to A', true], ['Add to B', false], ['New collection…', false]]);
  await punkte[0][1].aktion();
  assert.deepEqual(h.posts.at(-1), ['/kollektionen/b/posten', { hinzu: [{ art: 'geraet', geraet: 'komp' }] }]);
  const k = aktHost({ '/kollektionen': { status: 404 } });
  assert.equal(await zeigeKollektionsMenue(k, { art: 'geraet', geraet: 'komp' }, 0, 0, { menue: () => assert.fail('no menu') }), false);
});

test('beiAchse returns the function that removes the listener', () => {
  const aufrufe = [];
  const ab = beiAchse((a) => aufrufe.push(a));
  const andere = leseAchse() === 'prinzip' ? 'rolle' : 'prinzip';
  merkeAchse(andere);
  ab();
  merkeAchse(andere === 'rolle' ? 'prinzip' : 'rolle');
  assert.equal(aufrufe.length, 1);
});

test('kitZeilen: null gives nothing, text is "<name>, <n> pads", global follows quelle', () => {
  assert.deepEqual(kitZeilen(null), []);
  const z = kitZeilen({ kits: [{ name: 'Drums', pads: 16, quelle: 'global' }, { name: 'Mine', pads: 1, quelle: 'projekt' }] });
  assert.deepEqual(z.map((x) => [x.name, x.text, x.global]), [['Drums', 'Drums, 16 pads', true], ['Mine', 'Mine, 1 pad', false]]);
});

test('KITS: a 404 on /kits is the honest state with the sentence and no rows; other errors show their text', async () => {
  const x = await ladeKits(aktHost({ '/kits': { status: 404 } }));
  assert.deepEqual(x, { status: 'nicht_da', text: KITS_NICHT_DA, zeilen: [] });
  assert.equal(KITS_NICHT_DA, 'Kits are not available in this build yet');
  const e = await ladeKits(aktHost({ '/kits': { status: 500, j: { text: 'kit folder unreadable' } } }));
  assert.deepEqual([e.status, e.text], ['fehler', 'kit folder unreadable']);
  const ok = await ladeKits(aktHost({ '/kits': { status: 200, j: { kits: [{ name: 'a', pads: 2, quelle: 'global' }] } } }));
  assert.equal(ok.zeilen.length, 1);
});

test('NEW KIT FROM FOLDER: the name is asked with the folder name, files that did not fit are named; cancelling posts nothing', async () => {
  let h = aktHost({ '/kits/aus_ordner': { status: 200, j: { ok: true, name: 'my-drums', pads: 16, uebrig: ['a.wav', 'b.wav'] } } });
  let vorgabe = null;
  const r = await kitAusOrdner(h, { waehleOrdner: async () => '/home/x/My Drums' }, async (v) => { vorgabe = v; return 'my-drums'; });
  assert.equal(vorgabe, 'my-drums');
  assert.equal(r.status, 'ok');
  assert.deepEqual(h.posts, [['/kits/aus_ordner', { pfad: '/home/x/My Drums', name: 'my-drums' }]]);
  assert.match(r.text, /2 files did not fit: a kit has at most 16 pads/);
  assert.match(r.text, /a\.wav, b\.wav/);
  h = aktHost();
  assert.equal((await kitAusOrdner(h, { waehleOrdner: async () => null }, async () => 'x')).status, 'abgebrochen');
  assert.equal((await kitAusOrdner(h, { waehleOrdner: async () => '/a' }, async () => null)).status, 'abgebrochen');
  assert.deepEqual(h.posts, []);
});

test('KIT DELETE asks, a kit in use asks again and sends trotzdem; PREVIEW, RENAME and IMPORT KIT use the routes of plan 5', async () => {
  const k = { name: 'drums', quelle: 'global' };
  let h = aktHost();
  assert.equal((await loescheKit(h, k, () => false)).status, 'abgebrochen');
  assert.deepEqual(h.posts, []);
  let n = 0;
  h = aktHost();
  h.holeJson = async (url, b) => { h.posts.push([url, b]); return b.trotzdem ? { status: 200, j: { ok: true, name: 'drums' } } : { status: 409, j: { ok: false, grund: 'kit_in_benutzung', text: 'a project uses this kit' } }; };
  assert.equal((await loescheKit(h, k, () => { n++; return true; })).status, 'ok');
  assert.equal(n, 2);
  assert.deepEqual(h.posts.map((p) => p[1]), [{ name: 'drums', quelle: 'global' }, { name: 'drums', quelle: 'global', trotzdem: true }]);
  h = aktHost();
  await vorhoereKit(h, k, 1); await vorhoereKit(h, k);
  assert.deepEqual(h.posts, [['/kits/vorhoeren', { name: 'drums', quelle: 'global', pad: 1 }], ['/kits/vorhoeren', { name: 'drums', quelle: 'global' }]]);
  h = aktHost({ '/kits/umbenennen': { status: 409, j: { ok: false, grund: 'kit_vorhanden', text: 'a kit with that name exists already' } } });
  assert.equal((await benenneKitUm(h, k, 'x')).status, 'fehler');
  assert.deepEqual(h.meldungen, [['a kit with that name exists already', true]]);
  h = aktHost();
  const route = { url: '/kits/import', art: 'kit', headers: {} };
  const r = await importiereKit(h, { name: 'k.zip' }, { route, sende: async () => ({ status: 200, j: { ok: true, name: 'drums-3fa91c2e', neu: true, umbenannt: { alt: 'drums', neu: 'drums-3fa91c2e' } } }) });
  assert.match(r.text, /"drums" was installed as "drums-3fa91c2e"/);
  assert.equal((await importiereKit(aktHost(), { name: 'x.zip' }, { route: { art: 'zip' }, sende: async () => assert.fail('no') })).status, 'fehler');
  assert.equal((await importiereKit(aktHost(), { name: 'x.zip' }, { route, sende: async () => ({ status: 404, j: null }) })).status, 'nicht_da');
});
