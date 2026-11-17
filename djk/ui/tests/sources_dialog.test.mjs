// Storage layout A4: the source folder dialog of the shelf (public/werkbank/sources_dialog.js) against the DOM stand-in, and the SOURCES button of the
// SAMPLES tab that opens it. Requests are stubbed; invented paths only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

installiere();
const { bindeQuellenDialog, namenVorschlag, zustandVon, QUELLEN_TEXT } = await import('../public/werkbank/sources_dialog.js');
const { bindeWerkbank } = await import('../public/werkbank/werkbank.js');

const ruhe = async () => { for (let i = 0; i < 12; i++) await new Promise((ok) => setImmediate(ok)); };
const SICHT = (wurzeln) => ({ datei: '/x/quellen.toml', wurzeln });
const W = (name, o = {}) => ({ name, art: 'sample', pfad: `/media/tester/${name}`, wechselplatte: true, katalog: true, regal: true, erreichbar: true, ...o });
const POSTS = (weg) => attrappe.anrufe.filter((a) => a.methode === 'POST' && a.url === weg);

function dialog({ sicht = SICHT([]), frage = () => true } = {}) {
  let aktuell = sicht;
  installiere({ antworten: {
    'GET /quellen': () => ({ j: aktuell }),
    'POST /quellen/dazu': (k) => { aktuell = SICHT([...aktuell.wurzeln, W(k.name, { pfad: k.pfad, art: k.art })]); return { j: aktuell }; },
    'POST /quellen/weg': (k) => { aktuell = SICHT(aktuell.wurzeln.filter((w) => w.name !== k.name)); return { j: aktuell }; },
  } });
  const wurzel = document.createElement('div');
  const call = (weg, k) => fetch(weg, { method: 'POST', body: JSON.stringify(k) }).then(async (r) => ({ status: r.status, j: await r.json() }));
  const ctx = { holeGet: async (w) => { const r = await fetch(w); return { status: r.status, j: await r.json() }; }, holeJson: call, antwortText: (r) => `refused ${r.status}`, frage };
  const geaendert = [];
  const d = bindeQuellenDialog(ctx, { mount: wurzel, beiAenderung: () => geaendert.push(1) });
  const wd = (n) => wurzel.querySelectorAll(`[data-w="${n}"]`);
  return { d, wurzel, wd, geaendert };
}

test('namenVorschlag: the last path element, no trailing slash, at most 40 characters', () => {
  assert.equal(namenVorschlag('/media/tester/Musik'), 'Musik');
  assert.equal(namenVorschlag('/media/tester/01 MP3///'), '01 MP3');
  assert.equal(namenVorschlag('/'), '');
  assert.equal(namenVorschlag('/a/' + 'x'.repeat(60)).length, 40);
});

test('zustandVon: green only when reachable, grey with its reason otherwise', () => {
  assert.deepEqual(zustandVon(W('a')), { an: true, text: QUELLEN_TEXT.da });
  assert.deepEqual(zustandVon(W('a', { erreichbar: false, grund: 'platte' })), { an: false, text: 'Drive missing' });
  assert.deepEqual(zustandVon(W('a', { erreichbar: false, grund: 'ordner' })), { an: false, text: 'Folder missing or empty' });
  assert.deepEqual(zustandVon(W('a', { pfad: null, erreichbar: false, grund: 'kein_pfad_fuer_rechner' })), { an: false, text: 'No path on this machine' });
});

test('the dialog lists the sources with their state dots', async () => {
  const s = dialog({ sicht: SICHT([W('Musik'), W('Stick', { erreichbar: false, grund: 'platte' }), W('Laptop', { pfad: null, erreichbar: false, grund: 'kein_pfad_fuer_rechner' })]) });
  assert.equal(s.d.offen(), false);
  s.d.oeffne(); await ruhe();
  assert.equal(s.d.offen(), true);
  assert.deepEqual(s.wd('quellen-zeile').map((z) => z.getAttribute('data-name')), ['Musik', 'Stick', 'Laptop']);
  assert.deepEqual(s.wd('quellen-punkt').map((p) => p.classList.contains('an')), [true, false, false]);
  assert.deepEqual(s.wd('quellen-zustand').map((z) => z.textContent), ['Reachable', 'Drive missing', 'No path on this machine']);
});

test('ADD: the name follows the path, the answer is listed, the shelf is told', async () => {
  const s = dialog();
  s.d.oeffne(); await ruhe();
  const pfad = s.wd('quellen-pfad-feld')[0], name = s.wd('quellen-name-feld')[0];
  pfad.value = '/media/tester/Musik'; pfad.dispatch('input');
  assert.equal(name.value, 'Musik');
  s.wd('quellen-art')[0].value = 'track';
  s.wd('quellen-dazu')[0].dispatch('click'); await ruhe();
  assert.deepEqual(POSTS('/quellen/dazu').map((a) => a.koerper), [{ name: 'Musik', pfad: '/media/tester/Musik', art: 'track', regal: false }]);
  assert.deepEqual(s.wd('quellen-zeile').map((z) => z.getAttribute('data-name')), ['Musik']);
  assert.equal(s.geaendert.length, 1);
  assert.equal(pfad.value, '');
});

test('ADD: an edited name stays, the removable box is sent only when set, a relative path is not sent', async () => {
  const s = dialog();
  s.d.oeffne(); await ruhe();
  const pfad = s.wd('quellen-pfad-feld')[0], name = s.wd('quellen-name-feld')[0];
  pfad.value = 'rel/ordner'; pfad.dispatch('input');
  s.wd('quellen-dazu')[0].dispatch('click'); await ruhe();
  assert.equal(POSTS('/quellen/dazu').length, 0);
  assert.equal(s.wd('quellen-text')[0].textContent, QUELLEN_TEXT.pfadFehlt);
  name.value = 'Eigen'; name.dispatch('input');
  pfad.value = '/media/tester/Loops'; pfad.dispatch('input');
  assert.equal(name.value, 'Eigen');
  s.wd('quellen-wechsel')[0].checked = true;
  s.wd('quellen-dazu')[0].dispatch('click'); await ruhe();
  assert.deepEqual(POSTS('/quellen/dazu').map((a) => a.koerper), [{ name: 'Eigen', pfad: '/media/tester/Loops', art: 'sample', regal: true, wechselplatte: true }]);
});

test('REMOVE asks first and sends the name; a refusal shows the server text', async () => {
  let gefragt = null;
  const s = dialog({ sicht: SICHT([W('Musik')]), frage: (t) => { gefragt = t; return false; } });
  s.d.oeffne(); await ruhe();
  s.wd('quellen-weg')[0].dispatch('click'); await ruhe();
  assert.equal(gefragt, QUELLEN_TEXT.fragWeg('Musik'));
  assert.equal(POSTS('/quellen/weg').length, 0, 'declined: nothing is sent');
  const t = dialog({ sicht: SICHT([W('Musik')]) });
  t.d.oeffne(); await ruhe();
  t.wd('quellen-weg')[0].dispatch('click'); await ruhe();
  assert.deepEqual(POSTS('/quellen/weg').map((a) => a.koerper), [{ name: 'Musik' }]);
  assert.equal(t.wd('quellen-zeile').length, 0);
  assert.equal(t.geaendert.length, 1);
});

test('a refused ADD shows the English text of the server and keeps the fields', async () => {
  installiere({ antworten: { 'GET /quellen': { j: SICHT([]) }, 'POST /quellen/dazu': { code: 409, j: { fehler: 'name_vergeben', text: 'a source folder with that name exists already' } } } });
  const wurzel = document.createElement('div');
  const ctx = { holeGet: async (w) => { const r = await fetch(w); return { status: r.status, j: await r.json() }; },
    holeJson: async (w, k) => { const r = await fetch(w, { method: 'POST', body: JSON.stringify(k) }); return { status: r.status, j: await r.json() }; }, antwortText: () => 'x', frage: () => true };
  const d = bindeQuellenDialog(ctx, { mount: wurzel });
  d.oeffne(); await ruhe();
  const q = (n) => wurzel.querySelectorAll(`[data-w="${n}"]`)[0];
  q('quellen-pfad-feld').value = '/media/tester/Musik'; q('quellen-pfad-feld').dispatch('input');
  q('quellen-dazu').dispatch('click'); await ruhe();
  assert.equal(q('quellen-text').textContent, 'A source folder with that name exists already');
  assert.equal(q('quellen-pfad-feld').value, '/media/tester/Musik');
});

test('the SOURCES button of the SAMPLES tab opens the dialog and a change reloads the folders', async () => {
  installiere({ speicher: { 'djk-wb-regal-tab': 'samples', 'djk-wb-regal-katalog': '{"modus":"ordner"}' }, antworten: {
    'GET /proj/aktuell': { j: { slug: null } }, 'GET /proj/liste': { j: [] }, 'GET /proj/werkbank/vorlagen': { j: { vorlagen: [] } },
    'GET /sampler/dateien': { j: { wurzeln: [] } }, 'GET /quellen': { j: SICHT([W('Musik')]) },
    'POST /quellen/weg': { j: SICHT([]) } } });
  const wurzel = document.createElement('section');
  const w = bindeWerkbank({ post: (weg, k) => fetch(weg, { method: 'POST', body: JSON.stringify(k) }), wurzel, frage: () => true });
  w.zeige(); await ruhe();
  const q = (n) => wurzel.querySelectorAll(`[data-w="${n}"]`);
  assert.ok(wurzel.textContent.includes('No sample folders yet. Add one with SOURCES.'));
  assert.equal(q('samples-quellen')[0].textContent, 'SOURCES');
  assert.equal(q('quellen-dialog')[0].hidden, true);
  q('samples-quellen')[0].dispatch('click'); await ruhe();
  assert.equal(q('quellen-dialog')[0].hidden, false);
  assert.equal(q('quellen-zeile').length, 1);
  const vorher = attrappe.anrufe.filter((a) => a.url === '/sampler/dateien').length;
  q('quellen-weg')[0].dispatch('click'); await ruhe();
  assert.ok(attrappe.anrufe.filter((a) => a.url === '/sampler/dateien').length > vorher, 'the shelf reloaded its folders');
});
