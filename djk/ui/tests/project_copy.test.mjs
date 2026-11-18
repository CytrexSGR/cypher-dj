// Workbench shelf SAVE AS and DELETE (A 2026-11-16): Projekte.kopiere copies a project with its media under a new name and an empty history;
// Projekte.entferne moves the folder to the bin, refuses a project held open by a process.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Projekte, AblageFehler } from '../project/storage.ts';
import { startzeit } from '../lock.ts';

const wurzel = () => fs.mkdtempSync(path.join(os.tmpdir(), 'djk-kopie-'));

test('kopiere: a copy with the new name, the media, an empty history, no locks; the source stays as it was', () => {
  const w = wurzel(), pr = new Projekte(w);
  const { slug } = pr.lege('Alpha', { werkbank: true });
  fs.mkdirSync(path.join(w, slug, 'export')); fs.writeFileSync(path.join(w, slug, 'export', 'a.wav'), 'x');
  fs.writeFileSync(path.join(w, slug, 'undo.jsonl'), '{"rev":1}\n');
  fs.writeFileSync(path.join(w, slug, '.lauf'), 'lock');
  const r = pr.kopiere(slug, ' Alpha v2 ');
  assert.equal(r.slug, 'alpha-v2');
  assert.equal(pr.lies('alpha-v2').name, 'Alpha v2');
  assert.ok(pr.lies('alpha-v2').werkbank, 'still a module');
  assert.equal(fs.readFileSync(path.join(w, 'alpha-v2', 'export', 'a.wav'), 'utf8'), 'x');
  assert.equal(fs.readFileSync(path.join(w, 'alpha-v2', 'undo.jsonl'), 'utf8'), '');
  assert.ok(!fs.existsSync(path.join(w, 'alpha-v2', '.lauf')));
  assert.equal(pr.lies(slug).name, 'Alpha');
  assert.equal(pr.kopiere(slug, 'Alpha v2').slug, 'alpha-v2-2', 'a taken name gets the next slug');
  assert.throws(() => pr.kopiere(slug, '  '), (e) => e instanceof AblageFehler && e.fehler === 'name_ungueltig');
  assert.throws(() => pr.kopiere('nope', 'x'), (e) => e instanceof AblageFehler && e.fehler === 'unbekannt');
  const o = pr.oeffne('alpha-v2'); o.verlauf.schliesse();
});

test('entferne: the folder moves to the bin and leaves the list; a project held open is refused', () => {
  const w = wurzel(), pr = new Projekte(w);
  pr.lege('Alpha', { werkbank: true }); pr.lege('Beta', { werkbank: true });
  const r = pr.entferne('alpha');
  assert.ok(fs.existsSync(path.join(r.papierkorb, 'project.json')));
  assert.ok(r.papierkorb.startsWith(path.join(w, '.papierkorb')));
  assert.deepEqual(pr.liste().map((x) => x.slug), ['beta']);
  // the lock of another living process (the parent of this test run)
  fs.writeFileSync(path.join(w, 'beta', '.lauf'), JSON.stringify({ pid: process.ppid, start: startzeit(process.ppid) }));
  assert.throws(() => pr.entferne('beta'), (e) => e instanceof AblageFehler && e.fehler === 'projekt_busy');
  assert.ok(fs.existsSync(path.join(w, 'beta', 'project.json')), 'a refused delete leaves the folder');
  assert.throws(() => pr.entferne('alpha'), (e) => e instanceof AblageFehler && e.fehler === 'unbekannt');
});

// SAVE AS must not hand the copy the source's playback identity: istWiederanlauf (areas/proj/session.ts) takes /zustand/arr.nr === wiedergabe_rev
// for "the core already plays this project's last playback", and that number is unique per instance. A copy starts at 0 (a full load on open).
test('kopiere: the copy does not keep the source wiedergabe_rev', () => {
  const w = wurzel(), pr = new Projekte(w);
  const { slug } = pr.lege('Alpha', { werkbank: true });
  pr.speichere(slug, { ...pr.lies(slug), wiedergabe_rev: 10 });
  assert.equal(pr.lies(slug).wiedergabe_rev, 10);
  const r = pr.kopiere(slug, 'Alpha v2');
  assert.equal(r.projekt.wiedergabe_rev, 0, 'the copy would be taken for a restart of the source playback');
  assert.equal(pr.lies(r.slug).wiedergabe_rev, 0);
  assert.equal(pr.lies(slug).wiedergabe_rev, 10, 'the source keeps its number');
});
