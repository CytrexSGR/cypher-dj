// Presets (package 1.16): the browser panel public/presets.js without a browser. Pure parts, then the panel class with a fake
// root element and a fake host whose holen/senden answer from a real PresetSpeicher behind a real presetsBereich over HTTP.
// One test runs the page/server filter agreement against a deliberately broken page filter and requires it to fail there.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {
  presetId, teileId, presetPfad, falte as falteSeite, filtere, tagsVon, wertText, werteZeilen, fehlerText, KERN_KOMP, kernKompAusPreset,
  presetAusKernKomp, panelHtml, PresetPanel, alsServerFilter, beschreibungAusEntwurf, pruefeEntwurf, beschreibungsFehlerText, wortText, energieText,
} from '../public/presets.js';
import { ladeVokabular } from '../presets/vocabulary.ts';
import { AUTO_BEREICH } from '../public/effects.js';
import { falte, passt } from '../presets/model.ts';
import { GERAETE } from '../presets/devices.ts';
import { Router } from '../http/router.ts';
import { json, postAbgewiesen } from '../http/transport.ts';
import { presetsBereich } from '../presets/area.ts';

const vok = ladeVokabular();
const GLUE = { art: 'compressor', unterart: 'glue', charakter: ['smooth', 'warm'], genre: [], einsatz: ['mixdown'], energie: 2, text: 'Gentle glue.' };
const ACID = { art: 'bass', unterart: 'acid', charakter: ['dirty'], genre: ['acid', 'deep_house'], einsatz: ['drop', 'build'], energie: 5, text: 'Squelchy line for the drop.' };
const DRUM = { art: 'compressor', unterart: 'bus', charakter: ['punchy', 'tight'], genre: ['techno'], einsatz: ['drop'], energie: 4, text: 'Holds the drums together.' };
const LISTE = [
  { herkunft: 'nutzer', geraet: 'komp', geraet_typ: 'effekt', slug: 'glue', name: 'Glue Würze', tags: ['bus'], geaendert: 'x', beschreibung: GLUE, familie: 'effekt' },
  { herkunft: 'nutzer', geraet: 'rb338', geraet_typ: 'instrument', slug: 'acid', name: 'Acid', tags: ['acid', 'bass'], geaendert: 'x', beschreibung: ACID, familie: 'instrument' },
  { herkunft: 'werk', geraet: 'komp', geraet_typ: 'effekt', slug: 'drum-bus', name: 'Drum Bus', tags: ['drums', 'bus'], geaendert: 'x', beschreibung: DRUM, familie: 'effekt' },
  { herkunft: 'nutzer', geraet: 'komp', geraet_typ: null, slug: 'kaputt', name: 'kaputt', tags: [], geaendert: null, beschreibung: null, familie: null, fehler: 'json_kaputt' },
];
const FILTER = [{}, { q: 'wuerze' }, { q: 'bus' }, { q: 'rb-338' }, { q: 'cypher komp' }, { tag: 'bus' }, { geraet: 'komp', herkunft: 'werk' }, { q: 'acid bass' }, { q: 'nix' },
  { art: 'compressor' }, { art: 'bass' }, { charakter: 'tight' }, { genre: 'deep_house' }, { einsatz: 'drop' }, { energie: '4' }, { energie: '5', art: 'compressor' },
  { q: 'deep house' }, { q: 'squelchy' }, { q: 'dirty' }, { art: 'compressor', einsatz: 'mixdown', q: 'glue' }, { q: 'kaputt' }, { geraet: 'komp' }];
// Page filter and server filter must give the same list; the damaged entry follows the server's list rule (shown only without search)
function pruefeGleich(seite) {
  for (const f of FILTER) {
    const server = LISTE.filter((e) => (e.fehler ? !f.q && !f.tag && passt(e, { ...alsServerFilter(f), q: undefined }) : passt(e, alsServerFilter(f))));
    assert.deepEqual(seite(LISTE, f, GERAETE).map(presetId), server.map(presetId), JSON.stringify(f));
  }
}

test('ids and paths: only well-formed ids give a path', () => {
  assert.equal(presetId(LISTE[0]), 'nutzer/komp/glue');
  assert.deepEqual(teileId('werk/komp/drum-bus'), { herkunft: 'werk', geraet: 'komp', slug: 'drum-bus' });
  assert.equal(presetPfad('nutzer/komp/glue', '/loeschen'), '/presets/nutzer/komp/glue/loeschen');
  for (const boese of ['nutzer/komp/../x', 'nutzer/../glue', 'fremd/komp/glue', 'nutzer/komp/glue/x', '']) assert.equal(presetPfad(boese), null, boese);
});

test('page filter and server filter agree; folding is the same on both sides', () => {
  for (const s of ['Glue Würze', 'ÄÖÜß', 'Café', 'RB-338']) assert.equal(falteSeite(s), falte(s));
  pruefeGleich(filtere);
  assert.deepEqual(filtere(LISTE, { charakter: 'tight' }, GERAETE).map((e) => e.slug), ['drum-bus']);
  assert.deepEqual(filtere(LISTE, { energie: '4' }, GERAETE).map((e) => e.slug), ['acid', 'drum-bus'], 'energy is a minimum');
  assert.deepEqual(alsServerFilter({ q: '', art: 'bass', charakter: '', energie: '3' }), { art: ['bass'], energie: { min: 3 } });
  assert.deepEqual(tagsVon(LISTE), ['acid', 'bass', 'bus', 'drums']);
  assert.deepEqual(tagsVon(LISTE, { geraet: 'komp', herkunft: 'nutzer' }), ['bus']);
});

test('the agreement test fails on a page filter that ignores the character (deliberately broken implementation)', () => {
  const kaputt = (liste, f, g) => filtere(liste, { ...f, charakter: '' }, g);
  assert.throws(() => pruefeGleich(kaputt), assert.AssertionError);
});

test('save form: description from the typed fields, quick check with the allowed words, error sentences', () => {
  const b = beschreibungAusEntwurf({ art: 'compressor', unterart: 'glue', charakter: 'smooth, warm', genre: '', einsatz: 'mixdown mastering', energie: '2', text: ' Gentle glue. ' });
  assert.deepEqual(b, { art: 'compressor', unterart: 'glue', charakter: ['smooth', 'warm'], genre: [], einsatz: ['mixdown', 'mastering'], energie: 2, text: 'Gentle glue.' });
  assert.deepEqual(pruefeEntwurf(b, vok, 'effekt'), []);
  const leer = pruefeEntwurf(beschreibungAusEntwurf({}), vok, 'effekt');
  assert.deepEqual(leer.map((f) => `${f.feld}:${f.code}`), ['art:fehlt', 'charakter:fehlt', 'einsatz:fehlt', 'energie:fehlt', 'text:fehlt']);
  assert.ok(leer[0].erlaubt.includes('compressor') && !leer[0].erlaubt.includes('bass'), 'only kinds of the device family');
  const falsch = pruefeEntwurf({ ...b, art: 'compressor', unterart: 'plate', charakter: ['fat'], genre: ['deep house'] }, vok, 'effekt');
  assert.deepEqual(falsch.map((f) => `${f.feld}:${f.code}:${f.wert}`), ['unterart:unbekanntes_wort:plate', 'charakter:unbekanntes_wort:fat', 'genre:unbekanntes_wort:deep house']);
  assert.equal(beschreibungsFehlerText(falsch[0]), 'sub-kind: "plate" is not in the vocabulary. Allowed: bus, glue, parallel, sidechain, peak, channel');
  assert.match(beschreibungsFehlerText(falsch[2]), /^genre: "deep house" is not in the vocabulary\. Allowed: .*deep house, tech house/);
  assert.equal(beschreibungsFehlerText({ feld: 'charakter', code: 'widerspruch', wert: ['dry', 'wet'] }), 'character: dry and wet contradict each other');
  assert.equal(beschreibungsFehlerText({ feld: 'art', code: 'familie', wert: 'bass', erlaubt: ['compressor'] }), 'kind: "bass" does not fit this device. Allowed: compressor');
  assert.deepEqual([wortText('deep_house'), energieText(3)], ['deep house', '●●●○○']);
});

test('value texts', () => {
  assert.equal(wertText({ art: 'schalter' }, true), 'on');
  assert.equal(wertText({ art: 'auswahl', werte: ['Bell'] }, 'Bell'), 'Bell');
  assert.equal(wertText({ art: 'zahl', min: -60, max: 0, einheit: 'dB' }, -18), '-18.0 dB');
  assert.equal(wertText({ art: 'zahl', min: 10, max: 22000, einheit: 'Hz' }, 1234.5), '1235 Hz');
  assert.equal(wertText({ art: 'zahl', min: 0, max: 1 }, 0.4), '0.40');
  assert.equal(wertText({ art: 'zahl', min: 0, max: 1, einheit: 'gain' }, 0.5), '-6.0 dB');
  assert.deepEqual(werteZeilen({ werte: { thresh: -18, alt: 3 } }, GERAETE.find((g) => g.id === 'komp')),
    [{ name: 'thresh', titel: 'Threshold', text: '-18.0 dB' }, { name: 'alt', titel: 'alt', text: '3' }]);
  assert.equal(fehlerText({ code: 409, j: { fehler: 'name_vergeben', text: 'taken' } }), 'taken');
  assert.equal(fehlerText({ code: 409, j: { fehler: 'json_kaputt' } }), 'file damaged');
  assert.equal(fehlerText(null), 'refused (no answer)');
});

test('kern compressor mapping: fields exist in the kern automation table with the plugin ranges', () => {
  const komp = GERAETE.find((g) => g.id === 'komp');
  for (const [name, feld] of Object.entries(KERN_KOMP)) {
    const def = komp.parameter.find((p) => p.name === name).def;
    assert.deepEqual(AUTO_BEREICH[`komp/${feld}`], [def.min, def.max], feld);
  }
  assert.deepEqual(kernKompAusPreset({ thresh: -18, ratio: 4, knee: 6, extsc: false }), { felder: { schwelle: -18, ratio: 4 }, uebrig: ['knee', 'extsc'] });
  assert.deepEqual(presetAusKernKomp((f) => ({ schwelle: -10, ratio: 2, mix: Number.NaN })[f]), { thresh: -10, ratio: 2 });
});

test('panel html escapes names and shows edit buttons only for user presets', () => {
  const z = { liste: [{ ...LISTE[0], name: '<img src=x onerror=alert(1)>', beschreibung: { ...GLUE, text: '<script>x</script>.' } }, LISTE[2]], geraete: GERAETE,
    filter: { q: '', tag: '', geraet: '', herkunft: '' }, kannAnwenden: (g) => g === 'komp', kannSpeichern: () => false, vok,
    fehlerListe: [{ feld: 'charakter', code: 'unbekanntes_wort', wert: '<b>', erlaubt: ['warm'] }] };
  const h = panelHtml(z);
  assert.ok(!h.includes('<img') && !h.includes('<script') && !h.includes('"<b>"'));
  assert.ok(h.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.match(h, /<span class="preset-art">compressor · bus<\/span>/);
  assert.match(h, /<select data-preset-feld="charakter"[^>]*>.*<option value="warm">warm<\/option>/s);
  assert.match(h, /<option value="deep_house">deep house<\/option>/);
  assert.match(h, /<li data-preset-fehler-feld="charakter">character: &quot;&lt;b&gt;&quot; is not in the vocabulary\. Allowed: warm<\/li>/);
  assert.equal((h.match(/data-preset-aktion="loeschen"/g) ?? []).length, 1);
  assert.equal((h.match(/data-preset-aktion="umbenennen"/g) ?? []).length, 1);
  assert.match(h, /data-preset-aktion="speichern" disabled/);
});

// ---------- the panel against the real routes ----------
async function stapel(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'presets-s-'));
  const werk = path.join(d, 'werk'), nutzer = path.join(d, 'nutzer');
  fs.mkdirSync(path.join(werk, 'komp'), { recursive: true });
  fs.copyFileSync(path.join(import.meta.dirname, 'fixtures', 'presets', 'gueltig.json'), path.join(werk, 'komp', 'test-glue.preset.json'));
  const router = new Router();
  router.melde(presetsBereich({ log: () => {}, quelle: () => 'andreas' }, { werk, nutzer }));
  let port = 0;
  const server = http.createServer(async (q, a) => {
    const url = new URL(q.url ?? '/', 'http://127.0.0.1');
    const r = router.finde(q.method ?? '', url.pathname);
    if (!r) return json(a, 404, { fehler: 'keine_route' });
    if (r.schutz === 'fremdePost' && q.method === 'POST' && postAbgewiesen(q, a, port)) return;
    await r.handler(q, a, url);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  port = server.address().port;
  t.after(() => { server.close(); fs.rmSync(d, { recursive: true, force: true }); });
  const basis = `http://127.0.0.1:${port}`;
  return {
    nutzer,
    holen: async (p) => { const r = await fetch(basis + p); return { code: r.status, j: await r.json() }; },
    senden: async (p, daten) => {
      const r = await fetch(basis + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(daten) });
      return { code: r.status, j: await r.json() };
    },
  };
}
const FORM = ['name', 'tags', 'art', 'unterart', 'charakter', 'genre', 'einsatz', 'energie', 'text'];
function wurzel() {
  const felder = Object.fromEntries(FORM.map((k) => [`[data-preset-entwurf="${k}"]`, { value: '' }]));
  felder.setze = (werte) => { for (const [k, v] of Object.entries(werte)) felder[`[data-preset-entwurf="${k}"]`].value = v; };
  return { innerHTML: '', felder, ereignisse: {}, addEventListener(n, f) { (this.ereignisse[n] ??= []).push(f); }, querySelector: (s) => felder[s] ?? null };
}
const knopf = (aktion, id, extra = {}) => ({ disabled: false, dataset: { presetAktion: aktion, presetId: id, ...extra } });
const klick = (b) => ({ target: { closest: (s) => (s === '[data-preset-aktion]' ? b : null) } });

test('panel: load, filter, save current, overwrite after asking, apply, rename, delete', async (t) => {
  const s = await stapel(t);
  const w = wurzel();
  const gefragt = [], angewendet = [];
  let ja = true;
  const p = new PresetPanel(w, {
    holen: s.holen, senden: s.senden,
    aktuell: (g) => (g === 'komp' ? { thresh: -12, ratio: 3 } : null),
    kannAnwenden: (g) => g === 'komp',
    anwenden: async (preset, g) => { angewendet.push([preset.name, g.id, preset.werte]); return { ok: true }; },
    bestaetige: (text) => { gefragt.push(text); return ja; },
    frage: () => 'Renamed Glue',
  }).binde();
  assert.deepEqual(Object.keys(w.ereignisse).sort(), ['change', 'click', 'dragstart', 'input', 'keydown']);
  await p.lade();
  assert.equal(p.z.geraete.length, 10);   // six plugin devices + the four kern mix tools (A8)
  assert.equal(p.z.vok.version, 2);
  assert.deepEqual(p.z.liste.map(presetId), ['werk/komp/test-glue']);
  assert.match(w.innerHTML, /compressor · glue/, 'the list shows kind and sub-kind');
  assert.match(w.innerHTML, /Test Glue/);
  assert.match(w.innerHTML, /data-preset-aktion="speichern" disabled/, 'no device picked: nothing to save');

  p.ereignis('change', { target: { dataset: { presetFeld: 'geraet' }, value: 'komp' } });
  assert.equal(p.z.filter.geraet, 'komp');
  assert.equal(p.z.entwurf.art, 'compressor', 'the kind is prefilled for the device');
  assert.doesNotMatch(w.innerHTML, /data-preset-aktion="speichern" disabled/);
  w.felder.setze({ name: 'My Glue', tags: 'bus, Warm', art: 'compressor' });
  await p.ereignis('click', klick(knopf('speichern')));
  assert.equal(p.z.meldung.text, 'Not saved: the description needs fixing');
  assert.deepEqual(p.z.fehlerListe.map((f) => f.feld), ['unterart', 'charakter', 'einsatz', 'energie', 'text']);
  assert.match(w.innerHTML, /sub-kind: missing\. Allowed: bus, glue, parallel, sidechain, peak, channel/);
  assert.equal(p.z.liste.length, 1, 'nothing was sent');
  // opposites pass the page check and are refused by the server; its details are listed the same way
  w.felder.setze({ unterart: 'glue', charakter: 'dry, wet', einsatz: 'mixdown', energie: '2', text: 'Warm glue for the bus.' });
  await p.ereignis('click', klick(knopf('speichern')));
  assert.equal(p.z.meldung.text, 'Not saved: the description needs fixing (see below)');
  assert.deepEqual(p.z.fehlerListe.map((f) => `${f.feld}:${f.code}`), ['charakter:widerspruch']);
  assert.match(w.innerHTML, /character: dry and wet contradict each other/);
  w.felder.setze({ charakter: 'warm smooth' });
  await p.ereignis('click', klick(knopf('speichern')));
  assert.equal(p.z.meldung.text, 'Saved My Glue');
  assert.deepEqual(p.z.fehlerListe, []);
  assert.deepEqual(p.z.detail.beschreibung, { art: 'compressor', unterart: 'glue', charakter: ['warm', 'smooth'], genre: [], einsatz: ['mixdown'], energie: 2, text: 'Warm glue for the bus.' });
  assert.match(w.innerHTML, /<p class="preset-satz">Warm glue for the bus\.<\/p>/);
  assert.equal(p.z.entwurf.name, '', 'the form is cleared after saving');
  assert.deepEqual(p.z.liste.map(presetId), ['nutzer/komp/my-glue', 'werk/komp/test-glue']);
  assert.deepEqual(p.z.detail.werte, { thresh: -12, ratio: 3 }); assert.deepEqual(p.z.detail.tags, ['bus', 'warm']);

  const nochmal = { name: 'my glue', art: 'compressor', unterart: 'bus', charakter: 'punchy', genre: 'techno', einsatz: 'drop', energie: '4', text: 'Harder this time.' };
  ja = false;
  assert.equal(await p.speichere(nochmal), undefined);
  assert.equal(gefragt.length, 1); assert.equal(p.z.meldung.text, 'Not saved');
  ja = true;
  await p.speichere(nochmal);
  assert.equal(gefragt.length, 2); assert.equal(p.z.meldung.text, 'Saved my glue');
  assert.equal(p.z.liste.filter((e) => e.herkunft === 'nutzer').length, 1);
  assert.equal(p.z.liste.find((e) => e.herkunft === 'nutzer').beschreibung.unterart, 'bus');

  p.ereignis('change', { target: { dataset: { presetFeld: 'charakter' }, value: 'punchy' } });
  assert.deepEqual(filtere(p.z.liste, p.z.filter, GERAETE).map(presetId), ['nutzer/komp/my-glue']);
  p.ereignis('change', { target: { dataset: { presetFeld: 'charakter' }, value: '' } });
  p.ereignis('change', { target: { dataset: { presetFeld: 'energie' }, value: '3' } });
  assert.deepEqual(filtere(p.z.liste, p.z.filter, GERAETE).map(presetId), ['nutzer/komp/my-glue']);
  p.setzeFilter({ energie: '' });

  p.ereignis('input', { target: { dataset: { presetFeld: 'q' }, value: 'test' } });
  const liste = /<ul class="preset-liste"[\s\S]*?<\/ul>/.exec(w.innerHTML)[0];
  assert.match(liste, /Test Glue/); assert.doesNotMatch(liste, /my glue/i);
  p.setzeFilter({ q: '' });

  await p.ereignis('click', klick(knopf('anwenden', 'werk/komp/test-glue')));
  assert.deepEqual(angewendet, [['Test Glue', 'komp', { thresh: -10, ratio: 2, mix: 0.5, extsc: false }]]);
  assert.equal(p.z.meldung.text, 'Applied Test Glue');

  await p.ereignis('click', klick(knopf('umbenennen', 'nutzer/komp/my-glue')));
  assert.deepEqual(p.z.liste.map(presetId), ['nutzer/komp/renamed-glue', 'werk/komp/test-glue']);

  await p.ereignis('click', klick(knopf('loeschen', 'nutzer/komp/renamed-glue')));
  assert.deepEqual(p.z.liste.map(presetId), ['werk/komp/test-glue']);
  assert.equal(fs.readdirSync(path.join(s.nutzer, '.papierkorb')).length, 1);
});

test('panel: refusals reach the status line; disabled buttons do nothing', async (t) => {
  const s = await stapel(t);
  const w = wurzel();
  const p = new PresetPanel(w, { holen: s.holen, senden: s.senden, aktuell: (g) => (g === 'komp' ? { thresh: 5 } : null), geraet: 'komp' });
  await p.lade();
  await p.speichere({ name: 'Too Hot', art: 'compressor', unterart: 'peak', charakter: 'aggressive', einsatz: 'drop', energie: '5', text: 'Far too hot.' });
  assert.equal(p.z.meldung.fehler, true); assert.match(p.z.meldung.text, /^Not saved: Threshold \(thresh\) must be a number from -60 to 0/);
  assert.equal(p.ereignis('click', klick({ ...knopf('loeschen', 'werk/komp/test-glue'), disabled: true })), null);
  w.felder.setze({ name: '   ' });
  assert.equal(p.speichereAusFeldern(), null); assert.equal(p.z.meldung.text, 'Type a name first');
  const leer = new PresetPanel(wurzel(), { holen: s.holen, senden: s.senden, geraet: 'hall' });
  await leer.speichere({ name: 'X' });
  assert.equal(leer.z.meldung.text, 'Nothing to save: pick a device that is loaded here');
  const weg = new PresetPanel(wurzel(), { holen: async () => { throw new Error('ECONNREFUSED'); } });
  await weg.lade();
  assert.equal(weg.z.meldung.text, 'Page server unreachable: ECONNREFUSED');
});

// ---------- package 1.16 rest, U1 T1.5: author mark and Baukasten graph on the page ----------
test('panel html shows "by Cypher" only for presets with autor cypher', () => {
  const z = { liste: [{ ...LISTE[0], autor: 'cypher' }, LISTE[2]], geraete: GERAETE, filter: { q: '', tag: '', geraet: '', herkunft: '' }, vok };
  const h = panelHtml(z);
  assert.equal((h.match(/class="preset-autor"[^>]*>by Cypher</g) ?? []).length, 1);
  assert.equal((panelHtml({ ...z, liste: [LISTE[0], LISTE[2]] }).match(/by Cypher/g) ?? []).length, 0, 'negative control: no mark, no badge');
});

test('save form asks for the graph of a Baukasten preset (instrument graphs from GET /graphen) and sends it', async () => {
  const gesendet = [];
  const host = {
    holen: async (p) => (p === '/graphen' ? { code: 200, j: { graphen: [{ name: 'pad', art: 'instrument' }, { name: 'fx', art: 'effekt' }, { name: 'lead', art: 'instrument' }] } }
      : p === '/presets/geraete' ? { code: 200, j: GERAETE } : p === '/presets/vokabular' ? { code: 200, j: { version: vok.version, inhalt: vok.inhalt } }
        : p === '/presets' ? { code: 200, j: [] } : { code: 404, j: { fehler: 'unbekannt' } }),
    senden: async (p, d) => { gesendet.push([p, d]); return { code: 400, j: { fehler: 'x' } }; },
    aktuell: (g) => (g === 'baukasten' ? { knob1: 0.3 } : g === 'komp' ? { thresh: -3 } : null),
  };
  const w = wurzel();
  const p = new PresetPanel(w, host);
  await p.lade();
  p.setzeFilter({ geraet: 'baukasten' });
  assert.match(w.innerHTML, /<select data-preset-graph[^>]*>.*<option value="lead">lead<\/option><option value="pad">pad<\/option><\/select>/s);
  assert.doesNotMatch(/<select data-preset-graph[\s\S]*?<\/select>/.exec(w.innerHTML)[0], /value="fx"/, 'effect graphs are not offered');
  const ent = { name: 'Pad', art: 'pad', unterart: 'analog', charakter: 'warm', genre: '', einsatz: 'intro', energie: '1', text: 'A pad.' };
  await p.speichere(ent);
  assert.equal(p.z.meldung.text, 'Not saved: pick the graph of this Baukasten preset');
  assert.equal(gesendet.length, 0);
  p.ereignis('change', { target: { dataset: { presetGraph: '' }, value: 'pad' } });
  await p.speichere(ent);
  assert.equal(gesendet[0][1].graph, 'pad');
  // negative control: another device shows no graph field and sends no graph
  p.setzeFilter({ geraet: 'komp' });
  assert.doesNotMatch(w.innerHTML, /data-preset-graph/);
  await p.speichere({ ...ent, art: 'compressor', unterart: 'glue', charakter: 'warm', einsatz: 'mixdown' });
  assert.equal('graph' in gesendet[1][1], false);
});

// ---------- package 1.16 rest, U3b T3b.1: channel targets go through the server plan ----------
import * as SeiteAlle from '../public/presets.js';
import { PresetSpeicher, WERK_VORGABE } from '../presets/store.ts';
import { planeAnwendung } from '../presets/apply.ts';

// The page keeps kernKompAusPreset / kernGeraetAnfragen as copies (they decide which APPLY buttons are enabled and feed the unit
// tests of the page); the server plan is the one that is sent. For every factory komp preset the two must name the same /regler paths
// and values, and the same skipped names.
test('page copy kernKompAusPreset equals the server plan for a channel, for every factory komp preset (T3b.1)', (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'presets-u3b-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const s = new PresetSpeicher({ werk: WERK_VORGABE, nutzer: path.join(d, 'nutzer') });
  const liste = s.liste({ herkunft: 'werk', geraet: 'komp' });
  assert.equal(liste.length, 6, 'a pin over an empty list proves nothing');
  for (const e of liste) {
    const p = s.lies('werk', 'komp', e.slug);
    const plan = planeAnwendung({ ...p, id: `werk:komp/${e.slug}` }, { art: 'kanal', kanal: 'deck/1' }, null);
    const seite = kernKompAusPreset(p.werte);
    assert.equal(plan.weg, 'regler');
    assert.deepEqual(plan.anfragen.map((a) => [a.pfad, a.nach]), Object.entries(seite.felder).map(([f, w]) => [`deck/1/komp/${f}`, w]), e.slug);
    assert.deepEqual(plan.uebersprungen, seite.uebrig, e.slug);
  }
});

test('page copy kernGeraetAnfragen equals the server plan for the kern mix tools (T3b.1)', () => {
  const faelle = [['gate', { an: true, schwelle: -35, sc: 5 }, 'erz/1'], ['utility', { breite: 150, unbekannt: 1 }, 'bus/2'],
    ['multiband', { tief_schwelle: -20, mitte_umgehen: true }, 'bus/1'], ['kanal-limiter', { decke: -1 }, 'bus/4']];
  for (const [id, werte, kanal] of faelle) {
    const g = GERAETE.find((x) => x.id === id);
    assert.ok(g, id);
    const plan = planeAnwendung({ id: `nutzer:${id}/x`, name: 'x', geraet: id, werte }, { art: 'kanal', kanal }, null);
    const seite = SeiteAlle.kernGeraetAnfragen({ ...g, herkunft: 'kern' }, werte, kanal);
    assert.deepEqual(plan.anfragen, seite.anfragen.map(({ pfad, nach }) => ({ pfad, nach })), id);
    assert.deepEqual(plan.uebersprungen, seite.uebrig, id);
  }
});

test('kern plan and page copy: the on switch goes last when it switches the tool on, first when it switches it off (Review 1.15), values keep their order', () => {
  const g = GERAETE.find((x) => x.id === 'gate');
  const gib = (werte) => planeAnwendung({ id: 'nutzer:gate/x', name: 'x', geraet: 'gate', werte }, { art: 'kanal', kanal: 'erz/1' }, null).anfragen.map((a) => a.pfad.split('/').pop());
  assert.deepEqual(gib({ an: true, schwelle: -35, sc: 5 }), ['schwelle', 'sc', 'an']);
  assert.deepEqual(gib({ schwelle: -35, an: false, sc: 5 }), ['an', 'schwelle', 'sc']);
  assert.deepEqual(gib({ schwelle: -35, sc: 5 }), ['schwelle', 'sc'], 'negative control: no on switch, nothing moves');
  assert.deepEqual(SeiteAlle.kernGeraetAnfragen({ ...g, herkunft: 'kern' }, { an: false, schwelle: -35 }, 'erz/1').anfragen.map((a) => a.pfad.split('/').pop()), ['an', 'schwelle']);
});

test('kanalPlanHolen: asks POST /presets/anwenden and returns the requests; a refusal returns its text and no requests (T3b.1)', async (t) => {
  const s = await stapel(t);
  const gesendet = [];
  const senden = async (p, d) => { gesendet.push([p, d]); return s.senden(p, d); };
  const ok = await SeiteAlle.kanalPlanHolen(senden, 'werk:komp/test-glue', 'deck/1');
  assert.deepEqual(gesendet, [['/presets/anwenden', { id: 'werk:komp/test-glue', ziel: { art: 'kanal', kanal: 'deck/1' } }]]);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.anfragen, [{ pfad: 'deck/1/komp/schwelle', nach: -10 }, { pfad: 'deck/1/komp/ratio', nach: 2 }, { pfad: 'deck/1/komp/mix', nach: 0.5 }]);
  assert.deepEqual(ok.uebersprungen, ['extsc']);
  // the kern compressor sits on source channels only: a bus is refused by the server, the page shows the server's text
  const nein = await SeiteAlle.kanalPlanHolen(senden, 'werk:komp/test-glue', 'bus/1');
  assert.equal(nein.ok, false); assert.deepEqual(nein.anfragen ?? [], []);
  assert.match(nein.text, /channel kind does not carry the device/);
  // a malformed id never leaves the page
  const n = gesendet.length;
  assert.equal((await SeiteAlle.kanalPlanHolen(senden, 'kaputt', 'deck/1')).ok, false);
  assert.equal((await SeiteAlle.kanalPlanHolen(senden, 'werk/komp/test-glue', 'deck/1')).ok, false, 'the page id form is not a register id');
  assert.equal(gesendet.length, n);
});

test('panel apply hands the register id to the host (T3b.1)', async () => {
  const gesehen = [];
  const p = new PresetPanel(wurzel(), {
    holen: async (pf) => (pf === '/presets/werk/komp/test-glue' ? { code: 200, j: { name: 'Test Glue', geraet: 'komp', werte: { thresh: -10 } } } : { code: 404, j: {} }),
    anwenden: async (preset, g, id) => { gesehen.push(id); return { ok: true }; },
  });
  p.z.geraete = GERAETE;
  await p.anwenden('werk/komp/test-glue');
  assert.deepEqual(gesehen, ['werk:komp/test-glue']);
});

// found in the browser on instance e: the panel hands the REGISTER id to the host and the host must pass exactly that to kanalPlanHolen
test('panel apply to a channel end to end: the register id from the panel reaches POST /presets/anwenden (T3b.1, browser finding)', async (t) => {
  const s = await stapel(t);
  const gesendet = [];
  const p = new PresetPanel(wurzel(), {
    holen: s.holen, senden: s.senden,
    anwenden: async (preset, g, id) => {
      const plan = await SeiteAlle.kanalPlanHolen(async (pf, d) => { gesendet.push([pf, d]); return s.senden(pf, d); }, id, 'deck/1');
      return plan.ok ? { ok: true, text: `${plan.anfragen.length} requests` } : { ok: false, text: plan.text };
    },
  });
  await p.lade();
  await p.anwenden('werk/komp/test-glue');
  assert.equal(p.z.meldung.text, 'Applied Test Glue (3 requests)');
  assert.deepEqual(gesendet.map(([pf, d]) => [pf, d.id]), [['/presets/anwenden', 'werk:komp/test-glue']]);
});

// review finding (MAJOR): the device id "kanal-limiter" (presets/devices.ts) carries a hyphen like the server's PRESET_ID allows; the page id
// form "nutzer/kanal-limiter/x" must survive teileId so that holen, registerId and presetPfad all work for the Bus Limiter.
test('panel apply of a hyphenated device id (kanal-limiter) hands the register id to the host (T3b.1, review MAJOR)', async () => {
  const gesehen = [], geholt = [];
  const p = new PresetPanel(wurzel(), {
    holen: async (pf) => { geholt.push(pf); return pf === '/presets/nutzer/kanal-limiter/x' ? { code: 200, j: { name: 'X', geraet: 'kanal-limiter', werte: { decke: -1 } } } : { code: 404, j: {} }; },
    anwenden: async (preset, g, id) => { gesehen.push(id); return { ok: true }; },
  });
  p.z.geraete = GERAETE;
  await p.anwenden('nutzer/kanal-limiter/x');
  assert.deepEqual(geholt, ['/presets/nutzer/kanal-limiter/x']);
  assert.deepEqual(gesehen, ['nutzer:kanal-limiter/x']);
  // the helpers on their own, and the negative control: a plain device id still converts, a malformed id stays null
  assert.equal(SeiteAlle.registerId('nutzer/kanal-limiter/x'), 'nutzer:kanal-limiter/x');
  assert.equal(SeiteAlle.presetPfad('nutzer/kanal-limiter/x', '/loeschen'), '/presets/nutzer/kanal-limiter/x/loeschen');
  assert.equal(SeiteAlle.registerId('werk/komp/drum-bus'), 'werk:komp/drum-bus');
  assert.equal(SeiteAlle.registerId('nutzer/Kanal_Limiter/x'), null);
  assert.equal(SeiteAlle.registerId('nutzer/kanal limiter/x'), null);
});

// ---------- package 1.16 rest U7: the panel in PRODUCTION (drag, save from a project target) ----------
import { PRESET_TYP } from '../public/production/preset_target.js';
const GERAETE_P = GERAETE;
function panelHost(extra = {}) {
  const gesendet = [];
  const host = {
    holen: async (p) => (p === '/presets/geraete' ? { code: 200, j: GERAETE_P } : p === '/presets/vokabular' ? { code: 200, j: { version: vok.version, inhalt: vok.inhalt } }
      : p === '/graphen' ? { code: 200, j: { graphen: [] } } : p === '/presets' ? { code: 200, j: LISTE } : { code: 404, j: { fehler: 'unbekannt' } }),
    senden: async (p, d) => { gesendet.push([p, d]); return { code: 201, j: { herkunft: 'nutzer', geraet: d.geraet ?? 'komp', slug: 'neu', geaendert: 'x' } }; },
    aktuell: () => null, kannAnwenden: () => false, ...extra,
  };
  return { host, gesendet };
}
const ZIELE = [{ wert: 'insert:i1', text: 'Drums, compressor 1', ziel: { art: 'insert', insert_id: 'i1' } }, { wert: 'insert:i2', text: 'Master, compressor 1', ziel: { art: 'insert', insert_id: 'i2' } }];

test('U7 panel html: rows are draggable and have no APPLY button only when the host says so; a damaged file is never draggable', () => {
  const z = { liste: LISTE, geraete: GERAETE, filter: { q: '', tag: '', geraet: '', herkunft: '' }, kannAnwenden: () => true, kannSpeichern: () => false, vok };
  const dj = panelHtml(z);
  assert.doesNotMatch(dj, /draggable/, 'DJ view: unchanged, no draggable row');
  assert.equal((dj.match(/data-preset-aktion="anwenden"/g) ?? []).length, 4);
  const prod = panelHtml({ ...z, ziehbar: () => true });
  assert.equal((prod.match(/data-preset-ziehen/g) ?? []).length, 3, 'three readable rows, the damaged one is not draggable');
  assert.match(prod, /<li class="preset-zeile" data-preset-id="nutzer\/komp\/glue" draggable="true" data-preset-ziehen>/);
  assert.doesNotMatch(prod, /data-preset-aktion="anwenden"/, 'PRODUCTION has no channel to apply to: the drop is the way');
  assert.match(prod, /Drag a preset onto a track/);
});

test('U7 panel dragstart: the payload is the register id, device and name; a damaged row or a non-draggable host sets nothing', async () => {
  const { host } = panelHost({ ziehbar: () => true });
  const w = wurzel();
  const p = new PresetPanel(w, host).binde();
  assert.ok(w.ereignisse.dragstart?.length, 'dragstart is bound');
  await p.lade();
  const setzt = [];
  const ev = (id) => ({ target: { closest: (s) => (s === '[data-preset-ziehen]' ? { dataset: { presetId: id } } : null) }, dataTransfer: { setData: (t, v) => setzt.push([t, v]), effectAllowed: '' }, preventDefault() { this.verhindert = true; } });
  const e1 = ev('werk/komp/drum-bus');
  p.ereignis('dragstart', e1);
  assert.deepEqual(setzt, [[PRESET_TYP, JSON.stringify({ id: 'werk:komp/drum-bus', geraet: 'komp', name: 'Drum Bus' })]]);
  assert.equal(e1.dataTransfer.effectAllowed, 'copy');
  setzt.length = 0;
  const e2 = ev('nutzer/komp/kaputt'); p.ereignis('dragstart', e2);
  assert.deepEqual([setzt.length, e2.verhindert], [0, true], 'damaged: nothing set, drag cancelled');
  const e3 = ev('werk/komp/gibt-es-nicht'); p.ereignis('dragstart', e3);
  assert.deepEqual([setzt.length, e3.verhindert], [0, true], 'not in the list: nothing set');
  const dj = new PresetPanel(wurzel(), panelHost().host).binde(); await dj.lade();
  const e4 = ev('werk/komp/drum-bus'); dj.ereignis('dragstart', e4);
  assert.deepEqual([setzt.length, e4.verhindert], [0, true], 'a host that is not draggable (DJ view) sets nothing');
});

test('U7 SAVE CURRENT from a project target: POST /presets/von_ziel with the chosen target, no values and no device from the page', async () => {
  const { host, gesendet } = panelHost({ ziele: (g) => (g === 'komp' ? ZIELE : g === 'rb338' ? [] : null) });
  const w = wurzel();
  const p = new PresetPanel(w, host).binde();
  await p.lade();
  p.setzeFilter({ geraet: 'komp' });
  assert.match(w.innerHTML, /<select data-preset-ziel[^>]*><option value="insert:i1" selected>Drums, compressor 1<\/option><option value="insert:i2">Master, compressor 1<\/option><\/select>/);
  assert.doesNotMatch(w.innerHTML, /data-preset-aktion="speichern" disabled/, 'targets exist: SAVE CURRENT is on although aktuell() has nothing');
  p.ereignis('change', { target: { dataset: { presetZiel: '' }, value: 'insert:i2' } });
  const ent = { name: 'Master Glue', tags: 'bus', art: 'compressor', unterart: 'glue', charakter: 'warm', genre: '', einsatz: 'mixdown', energie: '2', text: 'Glue.' };
  await p.speichere(ent);
  assert.equal(gesendet.length, 1);
  assert.equal(gesendet[0][0], '/presets/von_ziel');
  assert.deepEqual(Object.keys(gesendet[0][1]).sort(), ['beschreibung', 'name', 'tags', 'ziel']);
  assert.deepEqual(gesendet[0][1].ziel, { art: 'insert', insert_id: 'i2' });
  assert.equal(gesendet[0][1].name, 'Master Glue');
  // the overwrite after a taken name keeps the target
  const { host: h2, gesendet: g2 } = panelHost({ ziele: () => ZIELE, bestaetige: () => true });
  h2.senden = async (pfad, d) => { g2.push([pfad, d]); return d.ueberschreiben ? { code: 200, j: { herkunft: 'nutzer', geraet: 'komp', slug: 'master-glue', geaendert: 'y' } } : { code: 409, j: { fehler: 'name_vergeben' } }; };
  const p2 = new PresetPanel(wurzel(), h2).binde(); await p2.lade(); p2.setzeFilter({ geraet: 'komp' });
  await p2.speichere(ent);
  assert.deepEqual(g2.map(([pf, d]) => [pf, d.ueberschreiben ?? false, d.ziel.insert_id]), [['/presets/von_ziel', false, 'i1'], ['/presets/von_ziel', true, 'i1']]);
  // a device without targets (rb338 here): SAVE CURRENT is off and nothing is sent
  p.setzeFilter({ geraet: 'rb338' });
  assert.match(w.innerHTML, /data-preset-aktion="speichern" disabled/);
  await p.speichere({ ...ent, art: 'bass' });
  assert.equal(gesendet.length, 1, 'no target: nothing sent');
  assert.equal(p.z.meldung.text, 'Nothing to save: pick a device that is loaded here');
  // negative control: a host without ziele (null) keeps the old way with the values
  const { host: h3, gesendet: g3 } = panelHost({ ziele: () => null, aktuell: (g) => (g === 'komp' ? { thresh: -12 } : null) });
  const p3 = new PresetPanel(wurzel(), h3).binde(); await p3.lade(); p3.setzeFilter({ geraet: 'komp' });
  await p3.speichere(ent);
  assert.equal(g3[0][0], '/presets');
  assert.deepEqual(g3[0][1].werte, { thresh: -12 });
});

test('U7 hostWechsel: PRODUCTION answers while the page is in PRODUCTION, the DJ host otherwise; a missing production hook falls back to the DJ one', async () => {
  const { hostWechsel } = await import('../public/presets.js');
  let prod = true;
  const dj = { geraet: 'komp', aktuell: () => ({ a: 1 }), kannAnwenden: () => true, anwenden: async () => ({ ok: true, text: 'dj' }) };
  const pr = { ziehbar: () => true, ziele: () => ZIELE, aktuell: () => null, kannAnwenden: () => false, anwenden: async () => ({ ok: false, text: 'drag' }) };
  const h = hostWechsel(dj, () => pr, () => prod);
  assert.equal(h.geraet, 'komp');
  assert.deepEqual([h.ziehbar(), h.ziele('komp').length, h.aktuell('komp'), h.kannAnwenden('komp')], [true, 2, null, false]);
  assert.equal((await h.anwenden()).text, 'drag');
  prod = false;
  assert.deepEqual([h.ziehbar(), h.ziele('komp'), h.aktuell('komp'), h.kannAnwenden('komp')], [false, null, { a: 1 }, true]);
  assert.equal((await h.anwenden()).text, 'dj');
  const ohne = hostWechsel(dj, () => undefined, () => true);   // PRODUCTION not bound yet
  assert.deepEqual([ohne.ziehbar(), ohne.ziele('komp'), ohne.aktuell('komp')], [false, null, { a: 1 }]);
});

// ---------- U7: the panel against the REAL routes with an open project (SAVE CURRENT from a stage, the plan for a stage) ----------
import { neuesProjekt } from '../project/model.ts';
import { fuehreListeAus } from '../project/commands.ts';
async function stapelMitProjekt(t, projekt) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'presets-u7-'));
  const werk = path.join(d, 'werk'), nutzer = path.join(d, 'nutzer');
  fs.mkdirSync(path.join(werk, 'komp'), { recursive: true });
  fs.copyFileSync(path.join(import.meta.dirname, 'fixtures', 'presets', 'gueltig.json'), path.join(werk, 'komp', 'test-glue.preset.json'));
  const router = new Router();
  router.melde(presetsBereich({ log: () => {}, quelle: () => 'andreas' }, { werk, nutzer, projekt: () => projekt }));
  let port = 0;
  const server = http.createServer(async (q, a) => {
    const url = new URL(q.url ?? '/', 'http://127.0.0.1');
    const r = router.finde(q.method ?? '', url.pathname);
    if (!r) return json(a, 404, { fehler: 'keine_route' });
    if (r.schutz === 'fremdePost' && q.method === 'POST' && postAbgewiesen(q, a, port)) return;
    await r.handler(q, a, url);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  port = server.address().port;
  t.after(() => { server.close(); fs.rmSync(d, { recursive: true, force: true }); });
  const basis = `http://127.0.0.1:${port}`;
  return {
    nutzer,
    holen: async (p) => { const r = await fetch(basis + p); return { code: r.status, j: await r.json() }; },
    senden: async (p, daten) => { const r = await fetch(basis + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(daten) }); return { code: r.status, j: await r.json() }; },
  };
}
test('U7 SAVE CURRENT from a stage end to end: the real POST /presets/von_ziel reads the values from the open project, the list shows the new preset', async (t) => {
  let p = neuesProjekt('S');
  p = fuehreListeAus(p, [{ befehl: 'spur_neu', art: 'audio', name: 'Drums' }, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', werte: { schwelle: -33, ratio: 7 } }]).projekt;
  const s = await stapelMitProjekt(t, p);
  const w = wurzel();
  const ziele = [{ wert: 'insert:i1', text: 'Drums, compressor 1', ziel: { art: 'insert', insert_id: 'i1' } }];
  const panel = new PresetPanel(w, { holen: s.holen, senden: s.senden, ziele: (g) => (g === 'komp' ? ziele : null), ziehbar: () => true }).binde();
  await panel.lade();
  panel.setzeFilter({ geraet: 'komp' });
  const ent = { name: 'Stage Sound', tags: 'bus', art: 'compressor', unterart: 'glue', charakter: 'warm', genre: '', einsatz: 'mixdown', energie: '2', text: 'Taken from the stage.' };
  const r = await panel.speichere(ent);
  assert.equal(panel.z.meldung.text, 'Saved Stage Sound');
  assert.equal(r.slug, 'stage-sound');
  const gespeichert = await s.holen('/presets/nutzer/komp/stage-sound');
  assert.equal(gespeichert.code, 200);
  assert.equal(gespeichert.j.werte.thresh, -33, 'the threshold of the stage, mapped back to the plugin id');
  assert.equal(gespeichert.j.werte.ratio, 7);
  assert.ok(panel.z.liste.some((e) => e.slug === 'stage-sound'), 'the list shows it');
  // a second save with the same name asks before overwriting, and the overwrite works through the same route
  panel.host.bestaetige = () => true;
  const r2 = await panel.speichere(ent);
  assert.equal(r2.slug, 'stage-sound');
  assert.equal(panel.z.meldung.text, 'Saved Stage Sound');
  // the plan the production page asks for a stage and for a track (what a drop sends)
  const plan = await s.senden('/presets/anwenden', { id: 'nutzer:komp/stage-sound', ziel: { art: 'insert', insert_id: 'i1' } });
  assert.equal(plan.code, 200);
  assert.equal(plan.j.weg, 'proj');
  assert.equal(plan.j.befehle[0].befehl, 'insert_werte_setzen');
  assert.equal(plan.j.befehle[0].werte.schwelle, -33);
  assert.equal(plan.j.befehle[0].preset, 'nutzer:komp/stage-sound');
  const hall = await s.senden('/presets/anwenden', { id: 'nutzer:komp/stage-sound', ziel: { art: 'insert', insert_id: 'i9' } });
  assert.equal(hall.code, 404, 'a stage that is not there is refused (ziel_unbekannt)');
  assert.equal(hall.j.fehler, 'ziel_unbekannt');
});

test('U7 save: when the list does not (yet) hold the saved preset the panel reads nothing at "null" and still says Saved', async () => {
  const geholt = [];
  const { host } = panelHost({ ziele: () => ZIELE });
  const holen = host.holen;
  host.holen = async (p) => { geholt.push(p); return holen(p); };
  const p = new PresetPanel(wurzel(), host).binde(); await p.lade(); p.setzeFilter({ geraet: 'komp' });
  const r = await p.speichere({ name: 'Neu', tags: '', art: 'compressor', unterart: 'glue', charakter: 'warm', genre: '', einsatz: 'mixdown', energie: '2', text: 'Glue.' });
  assert.equal(r.slug, 'neu');
  assert.equal(p.z.meldung.text, 'Saved Neu');
  assert.deepEqual(geholt.filter((x) => /null|undefined/.test(x)), [], 'no request for a missing id');
  assert.equal(p.z.gewaehlt, null);
});
