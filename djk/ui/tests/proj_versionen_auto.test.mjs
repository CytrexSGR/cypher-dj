// Project versions B10, task 1: automatic copies under <project>/.versionen/ (open, 5-minute spacing, keep 20, list, never failing the caller).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Projekte } from '../project/storage.ts';
import { Versionen, VERSIONEN_ORDNER } from '../project/versionen.ts';
import { sammleEin } from '../project/einsammeln.ts';
import { tmpOrdner, specProjekt, kopie } from './support/project.mjs';

const T0 = Date.UTC(2026, 10, 23, 10, 0, 0, 0);
const MIN = 60000;
// a Projekte whose clock is ours: replaces the public field with a Versionen on the injected clock
function aufbau(t, opt = {}) {
  const w = tmpOrdner(t); const pr = new Projekte(w);
  const uhr = { t: T0 };
  pr.versionen = new Versionen(w, { jetzt: () => uhr.t, ...opt });
  const { slug } = pr.lege('Auto');
  const ord = path.join(w, slug, VERSIONEN_ORDNER);
  return { w, pr, slug, uhr, ord, datei: path.join(w, slug, 'project.json') };
}
const gross = (p, n) => { const q = kopie(p); q.name = `Name ${n}`; return q; };

test('oeffne creates exactly one automatic copy holding the project.json bytes from before zieheNach', (t) => {
  const a = aufbau(t);
  const vorher = fs.readFileSync(a.datei);
  const o = a.pr.oeffne(a.slug, { zeitgeber: false }); o.verlauf.schliesse();
  const dateien = fs.readdirSync(a.ord).filter((x) => x.endsWith('.json'));
  assert.equal(dateien.length, 1);
  assert.match(dateien[0], /^20261123T100000000Z\.json$/);
  assert.deepEqual(fs.readFileSync(path.join(a.ord, dateien[0])), vorher);
  const l = a.pr.versionen.liste(a.slug);
  assert.equal(l.length, 1); assert.equal(l[0].auto, true); assert.equal('name' in l[0], false);
  assert.equal(l[0].id, '20261123T100000000Z'); assert.equal(l[0].zeit, '2026-11-23T10:00:00.000Z');
});

test('speichere: none inside 5 minutes, one after, holding the bytes of the file being REPLACED', (t) => {
  const a = aufbau(t);
  const o = a.pr.oeffne(a.slug, { zeitgeber: false }); o.verlauf.schliesse();
  const p = specProjekt();
  a.uhr.t += 4 * MIN; a.pr.speichere(a.slug, gross(p, 1));
  assert.equal(a.pr.versionen.liste(a.slug).length, 1, 'inside five minutes: no copy');
  const stand1 = fs.readFileSync(a.datei);
  a.uhr.t += 2 * MIN; a.pr.speichere(a.slug, gross(p, 2));
  const l = a.pr.versionen.liste(a.slug);
  assert.equal(l.length, 2);
  assert.deepEqual(a.pr.versionen.lies(a.slug, l[0].id), stand1, 'the earlier state, not the new one');
  assert.notDeepEqual(fs.readFileSync(a.datei), stand1);
});

test('identical bytes as the newest version create no new file', (t) => {
  const a = aufbau(t);
  for (let i = 0; i < 3; i++) { const o = a.pr.oeffne(a.slug, { zeitgeber: false }); o.verlauf.schliesse(); a.uhr.t += 10 * MIN; }
  assert.equal(a.pr.versionen.liste(a.slug).length, 1);
  a.pr.speichere(a.slug, gross(specProjekt(), 1));
  a.uhr.t += 10 * MIN;
  const o = a.pr.oeffne(a.slug, { zeitgeber: false }); o.verlauf.schliesse();
  assert.equal(a.pr.versionen.liste(a.slug).length, 2, 'changed bytes at the next open make one');
});

test('25 automatic copies: the newest 20 remain, a named file survives', (t) => {
  const a = aufbau(t);
  fs.mkdirSync(a.ord, { recursive: true });
  fs.writeFileSync(path.join(a.ord, '20260101T000000000Z--x.json'), '{}');
  for (let i = 0; i < 25; i++) {
    a.uhr.t += 6 * MIN;
    a.pr.speichere(a.slug, gross(specProjekt(), i));
    a.pr.speichere(a.slug, gross(specProjekt(), i + 100));   // inside the spacing: no copy
  }
  const l = a.pr.versionen.liste(a.slug);
  assert.equal(l.filter((x) => x.auto).length, 20);
  assert.equal(l.filter((x) => !x.auto).length, 1);
  assert.equal(l.find((x) => !x.auto).name, 'x');
});

test('liste: newest first, foreign files ignored', (t) => {
  const a = aufbau(t);
  fs.mkdirSync(a.ord, { recursive: true });
  for (const n of ['20260102T000000000Z.json', '20260103T000000000Z--b.json', '20260101T000000000Z.json', 'x.tmp', 'notes.txt', '20260104T000000000Z.json.123.tmp'])
    fs.writeFileSync(path.join(a.ord, n), '{}');
  assert.deepEqual(a.pr.versionen.liste(a.slug).map((x) => x.id), ['20260103T000000000Z--b', '20260102T000000000Z', '20260101T000000000Z']);
  assert.deepEqual(new Versionen(a.w).liste('gibt-es-nicht'), []);
});

test('an unwritable .versionen (a regular file) never fails open or save', (t) => {
  const a = aufbau(t);
  fs.writeFileSync(a.ord, 'ich bin eine Datei');
  const log = console.error; console.error = () => {};
  t.after(() => { console.error = log; });
  const o = a.pr.oeffne(a.slug, { zeitgeber: false }); o.verlauf.schliesse();
  a.uhr.t += 10 * MIN;
  a.pr.speichere(a.slug, gross(specProjekt(), 1));
  assert.equal(a.pr.lies(a.slug).name, 'Name 1');
  assert.equal(fs.readFileSync(a.ord, 'utf8'), 'ich bin eine Datei');
});

test('the 5-minute state starts from the newest automatic stamp in the folder (restart adds no copy per save)', (t) => {
  const a = aufbau(t);
  const o = a.pr.oeffne(a.slug, { zeitgeber: false }); o.verlauf.schliesse();
  const pr2 = new Projekte(a.w);
  pr2.versionen = new Versionen(a.w, { jetzt: () => a.uhr.t + MIN });
  pr2.speichere(a.slug, gross(specProjekt(), 1));
  assert.equal(pr2.versionen.liste(a.slug).length, 1);
});

test('kopiere does not copy .versionen; collect leaves .versionen byte-identical', async (t) => {
  const a = aufbau(t);
  const o = a.pr.oeffne(a.slug, { zeitgeber: false }); o.verlauf.schliesse();
  const k = a.pr.kopiere(a.slug, 'Kopie');
  assert.equal(fs.existsSync(path.join(a.w, k.slug, VERSIONEN_ORDNER)), false);
  const vor = fs.readdirSync(a.ord).map((n) => [n, fs.readFileSync(path.join(a.ord, n))]);
  await sammleEin({ projekt: { spuren: [] }, projektOrdner: path.join(a.w, a.slug), quellPfad: () => null });
  assert.deepEqual(fs.readdirSync(a.ord).map((n) => [n, fs.readFileSync(path.join(a.ord, n))]), vor);
});

test('sichereAuto on a slug without project.json skips silently (no log noise)', (t) => {
  const a = aufbau(t);
  const meldungen = []; const log = console.error; console.error = (...x) => meldungen.push(x);
  t.after(() => { console.error = log; });
  a.pr.versionen.sichereAuto('gibt-es-nicht', 'oeffnen');
  a.pr.versionen.sichereAuto('gibt-es-nicht', 'speichern');
  assert.deepEqual(meldungen, []);
});
