// Tracker stage 6, task 26: IMPORT MOD. The route POST /tracker/import_mod against the full in-process server (kern stand-in), the command list, the report
// text, the all-or-nothing rollback against a stand-in session, and the page part (import.js). Modules come from the test writer; every folder is a temp
// folder (bank graphs, sample files, projects, the sample roots), never ~/.config.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pruefeProjekt, pruefeFehler, neuesProjekt } from '../project/model.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { leseMod } from '../project/mod_import.ts';
import { uebersetze } from '../project/playback.ts';
import { findeGraph } from '../graphs.ts';
import { pfadeVon } from '../devices_parameter.ts';
import { plaetzeVon } from '../sampler/slots.ts';
import { modBefehle, trackerImportMod, MOD_MAX } from '../areas/proj/tracker_routes.ts';
import { ProjFehler } from '../areas/proj/session.ts';
import { berichtText, importKoerper, tooBig, IMPORT_TEXT } from '../public/tracker/import.js';
import { stapel } from './support/media_library.mjs';
import { ruf } from './support/proj_stack.mjs';
import { bauMod } from './support/mod_writer.mjs';

const BK0 = pfadeVon();
const P = { 'C-1': 856, 'C-2': 428, 'D-2': 381, 'E-2': 339, 'G-2': 285, 'C-3': 214 };
const SMP = (n, o = {}) => ({ name: 'smp', bytes: Array.from({ length: n }, (_, i) => ((i * 7) % 200) - 100), vol: 64, ...o });

// two patterns, order 0 1 0 (the third position links to the first), loop sample, arpeggio, vibrato, a jump (counted, not imported)
const modBytes = (o = {}) => bauMod({
  titel: 'Test Tune', ordnung: [0, 1, 0],
  samples: [SMP(400, { name: 'bass', vol: 64 }), SMP(300, { name: 'lead', vol: 32, loopStart: 20, loopLen: 100 })],
  muster: [
    { 0: { 0: [P['C-2'], 1, 0, 0x37], 1: [P['E-2'], 2, 4, 0x46], 2: [P['G-2'], 1, 0, 0], 3: [P['C-3'], 2, 0, 0] }, 8: { 0: [P['D-2'], 0, 0, 0] } },
    { 0: { 0: [P['G-2'], 1, 0, 0] }, 4: { 0: [P['C-1'], 2, 0, 0] }, 9: { 1: [0, 0, 0xb, 0] } },
  ], ...o,
});
const b64 = (u8) => Buffer.from(u8).toString('base64');

function aufbau(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trimp-'));
  const d = { root, bk: path.join(root, 'bk'), sampler: path.join(root, 'sampler'), lib: path.join(root, 'lib') };
  fs.mkdirSync(path.join(d.bk, 'panels'), { recursive: true });
  fs.mkdirSync(d.sampler); fs.mkdirSync(d.lib);
  fs.copyFileSync(path.join(BK0.beispiele, 'amiga.json'), path.join(d.bk, 'amiga.json'));
  fs.copyFileSync(path.join(BK0.paneele, 'amiga.json'), path.join(d.bk, 'panels', 'amiga.json'));
  fs.writeFileSync(path.join(d.sampler, 'wurzeln.json'), JSON.stringify([{ name: 'Mods', pfad: d.lib }]));
  const alt = { bk: process.env.CYPHERDJ_BK_ORDNER, sampler: process.env.CYPHERDJ_SAMPLER };
  process.env.CYPHERDJ_BK_ORDNER = d.bk;
  process.env.CYPHERDJ_SAMPLER = d.sampler;
  t.after(() => {
    for (const [k, v] of [['CYPHERDJ_BK_ORDNER', alt.bk], ['CYPHERDJ_SAMPLER', alt.sampler]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(root, { recursive: true, force: true });
  });
  const bankDateien = () => fs.readdirSync(d.bk).filter((n) => /^amiga-[0-9a-f]{6}\.json$/.test(n));
  const sampleDateien = () => (fs.existsSync(path.join(d.bk, 'samples')) ? fs.readdirSync(path.join(d.bk, 'samples')) : []).filter((n) => n.startsWith('smp-'));
  return { ...d, bankDateien, sampleDateien };
}

// the shape of a project without ids and link ids: tracks, clips, notes, effects, and which clips of a track are linked together
const form = (p) => ({
  tempo: p.tempo_bpm, tracker: p.tracker, loop: p.loop,
  spuren: p.spuren.map((s) => ({ name: s.name, pan: s.pan, fader: s.fader_db,
    clips: s.clips.map((c) => ({ start: c.start_beat, laenge: c.laenge_beats, noten: c.noten.map(({ id, ...n }) => n), fx: c.fx ?? [] })),
    verbund: s.clips.map((c) => (c.verbund === undefined ? -1 : s.clips.findIndex((x) => x.verbund === c.verbund))) })),
});

// ---- pure ----
test('berichtText: the counts in words; what was left out, only the non-zero parts, with numbers', () => {
  const b = { kanaele: 4, muster: 2, positionen: 3, samples: 2, weggelassen: { tempo_wechsel: 0, sprung: 0, muster_schleife: 0, unbekannt: {} } };
  assert.equal(berichtText(b), 'Imported 4 channels, 2 patterns in 3 song positions and 2 samples. Nothing was left out.');
  assert.equal(berichtText({ ...b, kanaele: 1, muster: 1, positionen: 1, samples: 1 }), 'Imported 1 channel, 1 pattern in 1 song position and 1 sample. Nothing was left out.');
  assert.equal(berichtText({ ...b, weggelassen: { tempo_wechsel: 2, sprung: 1, muster_schleife: 3, unbekannt: { E5x: 4, '9xx': 1 } } }),
    'Imported 4 channels, 2 patterns in 3 song positions and 2 samples. Left out: 2 tempo or speed changes, 1 position jump, 3 pattern loops, E5x (4x), 9xx (1x).');
});

test('importKoerper: name and base64 of the bytes (also past the chunk size); tooBig at 4 MiB', () => {
  const u = Uint8Array.from({ length: 70000 }, (_, i) => i % 251);
  const k = importKoerper('a.mod', u);
  assert.deepEqual(Object.keys(k), ['name', 'daten']);
  assert.ok(Buffer.from(k.daten, 'base64').equals(Buffer.from(u)));
  assert.ok(tooBig(MOD_MAX + 1) === true && tooBig(MOD_MAX) === false);
});

test('modBefehle: the command list makes the parser project in a fresh tracker project (valid, same content)', (t) => {
  const z = aufbau(t);
  const r = leseMod(modBytes());
  const befehle = modBefehle(r.projekt, 'amiga-abcdef');
  const leer = neuesProjekt('x'); leer.tracker = { schema: 1 };
  const p = fuehreListeAus(leer, befehle, { quelle: 'andreas', graphArt: (n) => (n === 'amiga-abcdef' ? 'instrument' : findeGraph(n)?.art ?? null) }).projekt;
  assert.equal(pruefeFehler(p), null);
  assert.deepEqual(form(p), form(r.projekt));
  assert.ok(p.spuren.every((s) => s.geraet.graph === 'amiga-abcdef'));
  assert.ok(z.bk);
});

// ---- the route ----
async function stapelMit(t) {
  const z = aufbau(t);
  const s = await stapel(t);
  s.optionen.samplerOrdner = z.sampler;
  return { ...s, z };
}
const importiere = (s, daten, extra = {}) => ruf(s.url, 'POST', '/tracker/import_mod', { name: 'Test Tune.mod', daten: b64(daten), ...extra });

test('POST /tracker/import_mod: a new tracker module, ONE history step, one bank, the report; the project is valid and its playback file carries the slot lane', async (t) => {
  const s = await stapelMit(t);
  const roh = modBytes();
  const erg = leseMod(roh);
  const vor = (await ruf(s.url, 'POST', '/proj/neu', { name: 'Before' })).j.slug;
  const r = await importiere(s, roh);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual(Object.keys(r.j).sort(), ['bank', 'bericht', 'rev', 'slug', 'text']);
  assert.match(r.j.bank, /^amiga-[0-9a-f]{6}$/);
  assert.deepEqual(r.j.bericht, erg.bericht);
  assert.equal(r.j.text, berichtText(erg.bericht));
  assert.equal(r.j.bericht.weggelassen.sprung, 1);
  assert.notEqual(r.j.slug, vor);
  const a = (await ruf(s.url, 'GET', '/proj/aktuell')).j;
  assert.equal(a.slug, r.j.slug);
  const p = a.projekt;
  assert.equal(p.name, 'Test Tune');
  assert.equal(p.rev, r.j.rev);
  assert.deepEqual(form(p), form(erg.projekt));
  assert.ok('projekt' in pruefeProjekt(JSON.parse(JSON.stringify(p))));
  const v = (await ruf(s.url, 'GET', '/proj/verlauf')).j;
  assert.equal(v.filter((e) => String(e.label).startsWith('Import MOD')).length, 1);
  assert.equal(v.at(-1).label, 'Import MOD: Test Tune');
  // one bank for all four channels, the slots of the module, the sample files are there
  assert.ok(p.spuren.every((x) => x.geraet.graph === r.j.bank));
  const g = findeGraph(r.j.bank);
  assert.equal(g.art, 'instrument');
  const plaetze = plaetzeVon(JSON.parse(fs.readFileSync(path.join(s.z.bk, `${r.j.bank}.json`), 'utf8')));
  assert.equal(plaetze.length, 2);
  assert.deepEqual(plaetze.map((x) => x.name), ['bass', 'lead']);
  assert.deepEqual(plaetze.map((x) => x.schleife ?? 0), [0, 1]);
  assert.ok(plaetze.every((x) => fs.existsSync(path.join(s.z.bk, 'samples', x.datei))));
  assert.equal(s.z.bankDateien().length, 1);
  assert.equal(s.z.sampleDateien().length, 2);
  // the playback file can be made and carries the slot lane
  const rollen = (graph) => (graph === r.j.bank ? { stufig: true, rollen: { slot: 1, start: 2, rueckwaerts: 3 } } : { stufig: true, rollen: {} });
  const w = uebersetze(p, { nr: 1, audioOrdner: '@A@', frames: () => 400000, geraetFx: rollen });
  assert.ok(w.spuren.some((x) => (x.auto ?? []).some((l) => l.ziel === 'geraet.k1')), 'slot lane');
  assert.ok(w.spuren.some((x) => (x.bend ?? []).length > 0), 'the arpeggio and vibrato columns reach the bend events');
  // the module before is still on disk
  const liste = (await ruf(s.url, 'GET', '/proj/liste')).j;
  assert.ok(liste.some((x) => x.slug === vor) && liste.some((x) => x.slug === r.j.slug && x.tracker === true));
});

test('the module can come as pfad (<root>/<rel>) from the sample roots; the name follows the file', async (t) => {
  const s = await stapelMit(t);
  fs.writeFileSync(path.join(s.z.lib, 'song.mod'), modBytes());
  const r = await ruf(s.url, 'POST', '/tracker/import_mod', { pfad: 'Mods/song.mod' });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal((await ruf(s.url, 'GET', '/proj/aktuell')).j.projekt.name, 'song');
  for (const [pfad, code] of [['Mods/../x.mod', 400], ['Nope/song.mod', 404], ['Mods/missing.mod', 404]]) {
    const x = await ruf(s.url, 'POST', '/tracker/import_mod', { pfad });
    assert.equal(x.code >= 400, true, `${pfad} ${JSON.stringify(x.j)}`);
    assert.ok(typeof x.j.fehler === 'string', pfad);
    assert.ok(code);
  }
  assert.equal(s.z.bankDateien().length, 1, 'refusals write no bank');
});

test('refusal too big: 413 mod_zu_gross, decided from the length before anything is decoded; nothing is written', async (t) => {
  const s = await stapelMit(t);
  const projekteVor = (await ruf(s.url, 'GET', '/proj/liste')).j.length;
  const gross = 'A'.repeat(Math.ceil((MOD_MAX + 100) * 4 / 3) + 4);   // not even valid as a module; the size is refused first
  const r = await ruf(s.url, 'POST', '/tracker/import_mod', { name: 'big.mod', daten: gross });
  assert.deepEqual([r.code, r.j.fehler], [413, 'mod_zu_gross']);
  assert.match(r.j.text, /4 MiB/);
  const ueber = await ruf(s.url, 'POST', '/tracker/import_mod', { name: 'big.mod', daten: 'A'.repeat(MOD_MAX * 2) });   // over the body limit
  assert.deepEqual([ueber.code, ueber.j.fehler], [413, 'mod_zu_gross']);
  fs.writeFileSync(path.join(s.z.lib, 'big.mod'), Buffer.alloc(MOD_MAX + 1));
  const f = await ruf(s.url, 'POST', '/tracker/import_mod', { pfad: 'Mods/big.mod' });
  assert.deepEqual([f.code, f.j.fehler], [413, 'mod_zu_gross']);
  assert.deepEqual([s.z.bankDateien().length, s.z.sampleDateien().length], [0, 0]);
  assert.equal((await ruf(s.url, 'GET', '/proj/liste')).j.length, projekteVor);
});

test('refusal not a module: 400 mod_ungueltig with the reason and offset; bad base64, unknown field, both or neither source; nothing is written', async (t) => {
  const s = await stapelMit(t);
  const projekteVor = (await ruf(s.url, 'GET', '/proj/liste')).j.length;
  const r = await importiere(s, Uint8Array.from({ length: 3000 }, (_, i) => i % 7));
  assert.deepEqual([r.code, r.j.fehler], [400, 'mod_ungueltig']);
  assert.equal(typeof r.j.detail, 'string');
  assert.equal(typeof r.j.offset, 'number');
  assert.match(r.j.text, /not a ProTracker module/);
  const kurz = await importiere(s, Uint8Array.from([1, 2, 3]));
  assert.deepEqual([kurz.code, kurz.j.fehler], [400, 'mod_ungueltig']);
  for (const k of [{ daten: '!!!notbase64' }, { daten: b64(modBytes()), extra: 1 }, { daten: b64(modBytes()), pfad: 'Mods/a.mod' }, { daten: '' }, {}, { pfad: 7 }, { daten: 5 },
    { name: 5, daten: b64(modBytes()) }]) {
    const x = await ruf(s.url, 'POST', '/tracker/import_mod', k);
    assert.deepEqual([x.code, x.j.fehler], [400, 'argument_ungueltig'], JSON.stringify(k).slice(0, 80));
  }
  assert.deepEqual([s.z.bankDateien().length, s.z.sampleDateien().length], [0, 0]);
  assert.equal((await ruf(s.url, 'GET', '/proj/liste')).j.length, projekteVor);
});

// ---- all or nothing, against a stand-in session ----
function attrappe(z, wie) {
  const log = [];
  const sitzung = {
    async neu(name) { log.push('neu'); if (wie === 'neu') return { code: 409, j: { fehler: 'live_laeuft' } }; return { code: 200, j: { slug: 'neu-1', projekt: { rev: 1 } } }; },
    async aendern() { log.push('aendern'); return wie === 'aendern' ? { code: 409, j: { fehler: 'projekt_ungueltig' } } : { code: 200, j: { rev: 2 } }; },
    async oeffnen(slug) { log.push(`oeffnen ${slug}`); return { code: 200, j: {} }; },
    async schliessen() { log.push('schliessen'); return { code: 200, j: {} }; },
    async loeschen(slug) { log.push(`loeschen ${slug}`); return { code: 200, j: {} }; },
  };
  const opt = { sitzung, zugang: { offen: () => (wie === 'vorher' ? { slug: 'alt-1', projekt: {} } : null) }, ordner: () => ({ ordner: z.sampler }), kiGestoppt: () => false };
  return { log, opt };
}
const sauber = (z) => assert.deepEqual([z.bankDateien().length, z.sampleDateien().length], [0, 0], 'no bank and no sample file left behind');

test('rollback: the session refuses the new module -> bank and sample files are removed again', async (t) => {
  const z = aufbau(t);
  const { log, opt } = attrappe(z, 'neu');
  const r = await trackerImportMod(opt, { daten: b64(modBytes()), name: 'a' }, 'andreas');
  assert.equal(r.code, 409);
  assert.deepEqual(log, ['neu']);
  sauber(z);
});

test('rollback: the filling step is refused -> the previous project is opened again, the new module deleted, bank and samples removed', async (t) => {
  const z = aufbau(t);
  const { log, opt } = attrappe(z, 'aendern');
  const r = await trackerImportMod(opt, { daten: b64(modBytes()), name: 'a' }, 'andreas');
  assert.equal(r.code, 409);
  assert.deepEqual(log, ['neu', 'aendern', 'schliessen', 'loeschen neu-1']);
  sauber(z);
  const v = attrappe(z, 'aendern'); v.opt.zugang.offen = () => ({ slug: 'alt-1', projekt: {} });
  await trackerImportMod(v.opt, { daten: b64(modBytes()), name: 'a' }, 'andreas');
  assert.deepEqual(v.log, ['neu', 'aendern', 'oeffnen alt-1', 'loeschen neu-1']);
  sauber(z);
});

test('rollback: a throw while the new module exists takes everything back; a throw before any project exists leaves no bank', async (t) => {
  const z = aufbau(t);
  const { log, opt } = attrappe(z, 'ok');
  opt.sitzung.aendern = async () => { log.push('aendern'); throw new ProjFehler(500, 'boom'); };
  await assert.rejects(() => trackerImportMod(opt, { daten: b64(modBytes()), name: 'a' }, 'andreas'), (e) => e.fehler === 'boom');
  assert.deepEqual(log, ['neu', 'aendern', 'schliessen', 'loeschen neu-1']);
  sauber(z);
  // the bank step fails (the panel folder is a file): the sample files written a moment before and the half bank are removed, no session call was made
  const kaputt = aufbau(t);
  fs.rmSync(path.join(kaputt.bk, 'panels'), { recursive: true });
  fs.writeFileSync(path.join(kaputt.bk, 'panels'), 'x');
  const b = attrappe(kaputt, 'ok');
  await assert.rejects(() => trackerImportMod(b.opt, { daten: b64(modBytes()), name: 'a' }, 'andreas'));
  assert.deepEqual(b.log, []);
  sauber(kaputt);
});

test('Stop Cypher refuses a call from Cypher before anything is written; Andreas is not refused', async (t) => {
  const z = aufbau(t);
  const { log, opt } = attrappe(z, 'ok');
  opt.kiGestoppt = () => true;
  await assert.rejects(() => trackerImportMod(opt, { daten: b64(modBytes()), name: 'a' }, 'cypher'), (e) => e.fehler === 'ki_gestoppt' && e.code === 409);
  assert.deepEqual(log, []);
  sauber(z);
  assert.equal((await trackerImportMod(opt, { daten: b64(modBytes()), name: 'a' }, 'andreas')).code, 200);
});

// ---- the page ----
function dom() {
  const mk = (tag) => {
    const e = { tag, attrs: {}, children: [], listeners: {}, hidden: false, textContent: '', className: '', files: null, value: '' };
    e.setAttribute = (k, v) => { e.attrs[k] = v; };
    e.getAttribute = (k) => e.attrs[k];
    e.append = (...c) => { e.children.push(...c); };
    e.addEventListener = (n, f) => { (e.listeners[n] ??= []).push(f); };
    e.click = () => { e.clicked = (e.clicked ?? 0) + 1; };
    return e;
  };
  return mk;
}
async function seite(t, antworten) {
  const mk = dom();
  const alt = globalThis.document;
  globalThis.document = { createElement: mk };
  t.after(() => { globalThis.document = alt; });
  const { bindeImport } = await import('../public/tracker/import.js');
  const kopf = mk('div'), leer = mk('div');
  const alle = [];
  const finde = (w, n) => { let r = null; const geh = (e) => { if (e.attrs?.['data-t'] === n) r = e; e.children.forEach(geh); }; geh(w); return r; };
  const meldungen = [], posts = [], fragen = [];
  let geladen = 0;
  const ctx = {
    $: (n) => (n === 'kopf' ? kopf : n === 'leer' ? leer : finde(kopf, n)),
    melde: (text, fehler) => meldungen.push([text, !!fehler]), antwortText: (r) => r.j?.text ?? 'error',
    frage: (text) => { fragen.push(text); return true; },
    holeJson: async (weg, koerper) => { posts.push([weg, koerper]); return antworten.shift(); },
    ladeAktuell: async () => { geladen++; },
  };
  bindeImport(ctx);
  alle.push(kopf, leer);
  return { ctx, kopf, leer, finde, meldungen, posts, fragen, geladen: () => geladen };
}

test('page: IMPORT MOD button and file input in the bar and in the empty pane; the report span only in the bar', async (t) => {
  const z = await seite(t, []);
  assert.ok(z.finde(z.kopf, 'import').textContent === IMPORT_TEXT.knopf);
  assert.ok(z.finde(z.kopf, 'import-datei').attrs.accept === '.mod,.MOD');
  assert.ok(z.finde(z.kopf, 'import-bericht') !== null);
  assert.ok(z.finde(z.leer, 'import') !== null && z.finde(z.leer, 'import-datei-leer') !== null && z.finde(z.leer, 'import-bericht') === null);
  const k = z.finde(z.kopf, 'import'); const d = z.finde(z.kopf, 'import-datei');
  k.listeners.click[0]();
  assert.ok(d.clicked === 1, 'the button opens the file dialog');
});

test('page: the chosen file goes to the route as base64, the answer is shown as one line, the view reloads', async (t) => {
  const bericht = { kanaele: 4, muster: 2, positionen: 3, samples: 2, weggelassen: { tempo_wechsel: 1, sprung: 0, muster_schleife: 0, unbekannt: {} } };
  const z = await seite(t, [{ status: 200, j: { slug: 'x', bank: 'amiga-000000', rev: 2, bericht, text: 'x' } }]);
  const d = z.finde(z.kopf, 'import-datei');
  const bytes = Uint8Array.from([1, 2, 3, 250]);
  d.files = [{ name: 'a.mod', size: 4, arrayBuffer: async () => bytes.buffer }];
  await d.listeners.change[0]();
  await new Promise((r) => setImmediate(r));
  assert.ok(z.posts.length === 1 && z.posts[0][0] === '/tracker/import_mod');
  assert.deepEqual(z.posts[0][1], importKoerper('a.mod', bytes));
  assert.ok(z.finde(z.kopf, 'import-bericht').textContent === berichtText(bericht));
  assert.match(z.finde(z.kopf, 'import-bericht').textContent, /Left out: 1 tempo or speed change\./);
  assert.ok(z.geladen() === 1);
  assert.ok(d.value === '', 'the input is reset so the same file can be chosen again');
});

test('page: a file over 4 MiB is refused before it is read; a refusal of the server is shown as a message, the report line stays empty', async (t) => {
  const z = await seite(t, [{ status: 400, j: { fehler: 'mod_ungueltig', text: 'That file is not a ProTracker module' } }]);
  const d = z.finde(z.kopf, 'import-datei');
  let gelesen = false;
  d.files = [{ name: 'big.mod', size: MOD_MAX + 1, arrayBuffer: async () => { gelesen = true; return new ArrayBuffer(0); } }];
  await d.listeners.change[0]();
  assert.ok(gelesen === false && z.posts.length === 0);
  assert.deepEqual(z.meldungen, [[IMPORT_TEXT.zuGross, true]]);
  d.files = [{ name: 'x.mod', size: 3, arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer }];
  await d.listeners.change[0]();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(z.meldungen.at(-1), ['That file is not a ProTracker module', true]);
  assert.ok(z.finde(z.kopf, 'import-bericht').textContent === '');
  assert.ok(z.geladen() === 0);
});

test('page: the live container asks first (mitBestaetigung); no answer from Andreas means nothing is imported', async (t) => {
  const z = await seite(t, [{ status: 409, j: { fehler: 'live_laeuft' } }]);
  z.ctx.frage = () => false;
  assert.ok(await z.ctx.importiereMod('a.mod', Uint8Array.from([1])) === false);
  assert.ok(z.posts.length === 1 && z.geladen() === 0 && z.meldungen.length === 0);
});
