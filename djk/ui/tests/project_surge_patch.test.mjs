// A Surge track stores its sound in the project: geraet.patch is the library name of a Surge patch (as `klang liste` prints it: "Pads/Warm Pad" of the
// factory folder, or the stem of an own sound). The server resolves it to a file and sends `lade` to the host of the slot when the project opens, when
// patch changes (command, undo, redo) and before a freeze; the parameter map goes on top after every load. No patch = the host stays untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fuehreListeAus, BefehlFehler } from '../project/commands.ts';
import { neuesProjekt, pruefeFehler, kanonisch } from '../project/model.ts';
import { surgeBereich } from '../areas/proj/surge.ts';
import { surgePatchDatei, listeSurgePatches } from '../areas/proj/surge_patches.ts';
import { grundCode } from '../areas/proj/mapping.ts';
import { GRUND_TEXT } from '../http/reasons.ts';
import { sitzung, warteBis } from './support/proj_context.mjs';
import { falscherWirt, wirtOrdner } from './support/surge_instrument_host.mjs';
import { stapel, hole, post } from './support/media_library.mjs';

// the library: a factory folder and an own folder in a temp dir (the server reads CYPHERDJ_SURGE_PATCHES and CYPHERDJ_KLAENGE at every call)
const bib = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-bib-'));
const WERK = path.join(bib, 'werk'), EIGENE = path.join(bib, 'eigene');
for (const f of ['Pads/Warm Pad', 'Leads/Acid', 'Init']) { fs.mkdirSync(path.dirname(path.join(WERK, `${f}.fxp`)), { recursive: true }); fs.writeFileSync(path.join(WERK, `${f}.fxp`), 'x'); }
fs.mkdirSync(EIGENE, { recursive: true }); fs.writeFileSync(path.join(EIGENE, 'mein-bass.fxp'), 'x'); fs.writeFileSync(path.join(EIGENE, 'Init.fxp'), 'own');
process.env.CYPHERDJ_SURGE_PATCHES = WERK; process.env.CYPHERDJ_KLAENGE = EIGENE;
test.after(() => fs.rmSync(bib, { recursive: true, force: true }));

const lehntAb = (fn, grund) => assert.throws(fn, (e) => e instanceof BefehlFehler && e.grund === grund, `expected ${grund}`);
const SURGE = (extra = {}) => ({ art: 'wirt', name: 'surge', ...extra });
const ctx = { surgeBereich, surgePatchDa: (n) => surgePatchDatei(n) !== null };
const neu = (extra) => fuehreListeAus(neuesProjekt('P'), [{ befehl: 'spur_neu', art: 'instrument', geraet: SURGE(extra) }], ctx);

test('library: names resolve like klang liste/lade (own folder first, then the factory), listing has both, nothing leaves the folders', () => {
  assert.equal(surgePatchDatei('Pads/Warm Pad'), path.join(WERK, 'Pads/Warm Pad.fxp'));
  assert.equal(surgePatchDatei('mein-bass'), path.join(EIGENE, 'mein-bass.fxp'));
  assert.equal(surgePatchDatei('Init'), path.join(EIGENE, 'Init.fxp'), 'own wins, as in finde_klang');
  for (const schlecht of ['', '../x', 'Pads/../../x', '/etc/passwd', 'Pads\\Warm Pad', 'Nope', 'Pads/Warm Pad.fxp', 'Pads/\u0000']) assert.equal(surgePatchDatei(schlecht), null, JSON.stringify(schlecht));
  const l = listeSurgePatches();
  assert.deepEqual(l.map((x) => x.name).sort(), ['Init', 'Init', 'Leads/Acid', 'Pads/Warm Pad', 'mein-bass']);
  assert.ok(l.some((x) => x.name === 'mein-bass' && x.art === 'own') && l.some((x) => x.name === 'Leads/Acid' && x.art === 'factory'));
});

test('command: spur_neu takes geraet.patch; unknown name is patch_unbekannt (404), a malformed one argument_ungueltig; no patch writes no key', () => {
  const r = neu({ patch: 'Pads/Warm Pad' });
  assert.equal(r.projekt.spuren[0].geraet.patch, 'Pads/Warm Pad');
  assert.equal(pruefeFehler(r.projekt), null);
  lehntAb(() => neu({ patch: 'Pads/Nope' }), 'patch_unbekannt');
  lehntAb(() => neu({ patch: '../x' }), 'patch_unbekannt');
  lehntAb(() => neu({ patch: 5 }), 'argument_ungueltig');
  assert.equal(grundCode('patch_unbekannt'), 404);
  assert.ok(GRUND_TEXT.patch_unbekannt);
  assert.ok(!('patch' in neu().projekt.spuren[0].geraet), 'old projects stay as they are');
});

test('command: spur_aendern with the whole geraet changes the patch: one undo step, the freeze goes, undo and redo restore', () => {
  const p0 = neu({ patch: 'Pads/Warm Pad', parameter: { a_filter1_cutoff: 3 } }).projekt;
  p0.spuren[0].freeze = { datei: 'f.wav', frames: 10, kennung: 1, sha256: 'a'.repeat(64) };
  const r = fuehreListeAus(p0, [{ befehl: 'spur_aendern', spur_id: 's1', geraet: SURGE({ patch: 'Leads/Acid', parameter: { a_filter1_cutoff: 3 } }) }], ctx);
  assert.equal(r.projekt.spuren[0].geraet.patch, 'Leads/Acid');
  assert.equal(r.projekt.spuren[0].freeze, null);
  assert.equal(r.betrifft_wiedergabe, true);
  const ohne = fuehreListeAus(r.projekt, [{ befehl: 'spur_aendern', spur_id: 's1', geraet: SURGE({ parameter: { a_filter1_cutoff: 3 } }) }], ctx);
  assert.ok(!('patch' in ohne.projekt.spuren[0].geraet), 'a geraet without patch drops it');
  assert.notEqual(kanonisch(ohne.projekt), kanonisch(r.projekt));
});

test('format: the model accepts patch in /2 and refuses a rack member with a patch', () => {
  const p = neu({ patch: 'Init' }).projekt;
  assert.equal(pruefeFehler(p), null);
  p.spuren[0].geraet.patch = 7;
  assert.notEqual(pruefeFehler(p), null);
});

// --- the session: the host of the slot ----------------------------------------------------------------------------------------------------
const aufbau = async (t, werte = { a_filter1_cutoff: 3, a_env1_release: -1 }) => {
  const ordner = wirtOrdner(t);
  const h = falscherWirt(t, ordner, 1, werte);
  const e = sitzung(t, { wirtOrdner: () => ordner });
  return { ...e, h, ordner };
};
const spurBefehl = (extra) => [{ befehl: 'spur_neu', art: 'instrument', geraet: SURGE(extra) }];
const laden = (h) => h.befehle.filter((b) => b.befehl === 'lade').map((b) => b.pfad);
const folge = (h) => h.befehle.filter((b) => b.befehl === 'lade' || b.befehl === 'fahre').map((b) => (b.befehl === 'lade' ? `lade ${path.basename(b.pfad)}` : `fahre ${b.name}`));

test('session open: a project with a patch sends lade with the resolved file, THEN the map', async (t) => {
  const { s, h } = await aufbau(t);
  const a = await s.neu('A', 'andreas');
  await s.aendern({ rev: 0, label: 'Pad', befehle: spurBefehl({ patch: 'Pads/Warm Pad', parameter: { a_filter1_cutoff: 20, a_env1_release: -3 } }) }, 'andreas');
  assert.ok(await warteBis(() => h.werte.a_filter1_cutoff === 20));
  await s.neu('B', 'andreas');
  assert.ok(await warteBis(() => h.werte.a_filter1_cutoff === 3), 'closing A took its entries back');
  h.befehle.length = 0;
  await s.oeffnen(a.j.slug, 'andreas');
  assert.ok(await warteBis(() => h.fahrten().length >= 2));
  assert.deepEqual(laden(h), [path.join(WERK, 'Pads/Warm Pad.fxp')], 'one lade with the file of the library');
  const f = folge(h);
  assert.equal(f[0], 'lade Warm Pad.fxp', 'the load comes first');
  assert.deepEqual(f.slice(1).sort(), ['fahre a_env1_release', 'fahre a_filter1_cutoff'], 'then every map entry again, the load overwrote them');
});

test('session: a patch change loads the new file and resends the whole map; undo loads the old one again', async (t) => {
  const { s, h } = await aufbau(t);
  await s.neu('A', 'andreas');
  await s.aendern({ rev: 0, label: 'Pad', befehle: spurBefehl({ patch: 'Pads/Warm Pad', parameter: { a_filter1_cutoff: 20 } }) }, 'andreas');
  assert.ok(await warteBis(() => laden(h).length === 1 && h.werte.a_filter1_cutoff === 20));
  h.befehle.length = 0;
  await s.aendern({ rev: 1, label: 'Acid', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', geraet: SURGE({ patch: 'Leads/Acid', parameter: { a_filter1_cutoff: 20 } }) }] }, 'andreas');
  assert.ok(await warteBis(() => folge(h).length >= 2));
  assert.deepEqual(folge(h), ['lade Acid.fxp', 'fahre a_filter1_cutoff'], 'new file, then the map entry again');
  h.befehle.length = 0;
  await s.umkehr('undo', { rev: 2 }, 'andreas');
  assert.ok(await warteBis(() => folge(h).length >= 2));
  assert.deepEqual(folge(h), ['lade Warm Pad.fxp', 'fahre a_filter1_cutoff'], 'undo brings the old patch back');
  h.befehle.length = 0;
  await s.aendern({ rev: 3, label: 'Cutoff', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', geraet: SURGE({ patch: 'Pads/Warm Pad', parameter: { a_filter1_cutoff: 22 } }) }] }, 'andreas');
  assert.ok(await warteBis(() => h.werte.a_filter1_cutoff === 22));
  assert.deepEqual(laden(h), [], 'a map change without a patch change does not reload');
});

test('session: an unknown patch name is refused patch_unbekannt and nothing is stored or sent', async (t) => {
  const { s, h } = await aufbau(t);
  await s.neu('A', 'andreas');
  await assert.rejects(() => s.aendern({ rev: 0, label: 'x', befehle: spurBefehl({ patch: 'Pads/Nope' }) }, 'andreas'), (e) => e.grund === 'patch_unbekannt');
  assert.equal(s.aktuell().j.projekt.rev, 0);
  assert.deepEqual(h.befehle, []);
});

test('session: no patch, no lade (old projects leave the host alone), on open, command and freeze sync', async (t) => {
  const { s, h } = await aufbau(t);
  await s.neu('A', 'andreas');
  await s.aendern({ rev: 0, label: 'Lead', befehle: spurBefehl({ parameter: { a_filter1_cutoff: 20 } }) }, 'andreas');
  assert.ok(await warteBis(() => h.werte.a_filter1_cutoff === 20));
  await s.wirtSpiegel();
  const a = s.aktuell().j.projekt.slug ?? null; void a;
  assert.deepEqual(laden(h), []);
});

test('session freeze path: wirtSpiegel loads the patch again when someone loaded another one in the host meanwhile', async (t) => {
  const { s, h } = await aufbau(t);
  await s.neu('A', 'andreas');
  await s.aendern({ rev: 0, label: 'Pad', befehle: spurBefehl({ patch: 'Pads/Warm Pad', parameter: { a_filter1_cutoff: 20 } }) }, 'andreas');
  assert.ok(await warteBis(() => laden(h).length === 1));
  h.befehle.length = 0;
  const fehler = await s.wirtSpiegel();
  assert.deepEqual(fehler, []);
  assert.deepEqual(laden(h), [path.join(WERK, 'Pads/Warm Pad.fxp')], 'before a freeze the patch is loaded again (the host may have been changed by hand)');
  assert.ok(h.fahrten().some((x) => x[0] === 'a_filter1_cutoff'), 'and the map is on top again');
});

test('session: a host that refuses lade is a mirror error (the freeze refuses), the entries stay pending, the next sync retries', async (t) => {
  const { s, h } = await aufbau(t);
  h.antwort = (b) => (b.befehl === 'lade' ? { ok: false, fehler: 'no such file' } : null);
  await s.neu('A', 'andreas');
  await s.aendern({ rev: 0, label: 'Pad', befehle: spurBefehl({ patch: 'Pads/Warm Pad', parameter: { a_filter1_cutoff: 20 } }) }, 'andreas');
  const fehler = await s.wirtSpiegel();
  assert.ok(fehler.some((x) => /lade/.test(x)), `errors: ${fehler}`);
  assert.equal(h.werte.a_filter1_cutoff, 3, 'the map was not sent on top of a patch that did not load');
  h.antwort = null;
  assert.deepEqual(await s.wirtSpiegel(), []);
  assert.equal(h.werte.a_filter1_cutoff, 20);
});

test('GET /proj/surge_patches lists the library (?text filters), and spur_neu with an unknown patch is 404 patch_unbekannt through the real server', async (t) => {
  const { o, url } = await stapel(t);
  assert.deepEqual(o.routen().filter((r) => r.pfad === '/proj/surge_patches').map((r) => [r.bereich, r.methode, r.schutz]), [['proj', 'GET', 'offen']]);
  const alle = await hole(url, '/proj/surge_patches');
  assert.equal(alle.code, 200);
  assert.deepEqual(alle.j.patches.map((x) => x.name), ['Init', 'mein-bass', 'Init', 'Leads/Acid', 'Pads/Warm Pad'], 'own sounds first, then the factory');
  assert.deepEqual((await hole(url, '/proj/surge_patches?text=WARM')).j.patches, [{ name: 'Pads/Warm Pad', art: 'factory' }]);
  assert.equal((await post(url, '/proj/neu', { name: 'Patch' })).code, 200);
  const rev = () => hole(url, '/proj/aktuell?nur=rev').then((r) => r.j.rev);
  const rev0 = await rev();
  const aendern = (patch) => post(url, '/proj/aendern', { rev: rev0, label: 'p', befehle: [{ befehl: 'spur_neu', art: 'instrument', geraet: { art: 'wirt', name: 'surge', patch } }] });
  const nix = await aendern('Pads/Nope');
  assert.deepEqual([nix.code, nix.j.fehler], [404, 'patch_unbekannt'], JSON.stringify(nix.j));
  assert.equal(await rev(), rev0, 'a refusal changes nothing');
  const ok = await aendern('Pads/Warm Pad');
  assert.equal(ok.code, 200, JSON.stringify(ok.j));
  assert.equal((await hole(url, '/proj/aktuell')).j.projekt.spuren.at(-1).geraet.patch, 'Pads/Warm Pad');
});
