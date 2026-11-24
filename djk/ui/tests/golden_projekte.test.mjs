// Golden project folders (release reliability R1): the 1.0 project format is pinned by files that are loaded, saved and compared.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FORMAT, kanonisch, pruefeProjekt } from '../project/model.ts';
import { normalisiere } from '../project/storage.ts';
import { GOLDEN_WURZEL, goldenListe, inTemp } from './support/golden_projekte.mjs';

const stored = (p) => JSON.stringify(normalisiere(p), null, 1) + '\n';
const drei = () => goldenListe().filter((g) => g.format === FORMAT);

test('golden: every /3 folder is a fixpoint (load, save, load again)', () => {
  const liste = drei();
  assert.ok(liste.length >= 7, `at least seven /3 folders expected, found ${liste.length}`);
  for (const g of liste) {
    const { wurzel, projekte, slug } = inTemp(g.slug);
    const datei = path.join(wurzel, slug, 'project.json');
    const committed = fs.readFileSync(path.join(g.ordner, 'project.json'), 'utf8');
    const m1 = projekte.lies(slug);
    projekte.speichere(slug, m1);
    const save1 = fs.readFileSync(datei, 'utf8');
    const m2 = projekte.lies(slug);
    projekte.speichere(slug, m2);
    const save2 = fs.readFileSync(datei, 'utf8');
    assert.equal(save1, save2, `${g.slug}: bytes of save 1 and save 2 differ`);
    assert.equal(kanonisch(m1), kanonisch(m2), `${g.slug}: model changed on the second load`);
    assert.equal(save1, committed, `${g.slug}: a save does not reproduce the committed bytes`);
    assert.equal(stored(m1), committed, `${g.slug}: normalised form differs from the committed bytes`);
  }
});

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const strings = (x, aus = []) => {
  if (typeof x === 'string') aus.push(x);
  else if (Array.isArray(x)) x.forEach((y) => strings(y, aus));
  else if (x && typeof x === 'object') Object.values(x).forEach((y) => strings(y, aus));
  return aus;
};
const PFAD_TEIL = ['/home/', '/mnt/', '/media/', '/tmp/', '~/'];

test('golden: no developer path, user name or host name in any golden file', () => {
  const host = os.hostname(), user = os.userInfo().username;
  const dateien = walk(GOLDEN_WURZEL).filter((f) => path.basename(f) !== 'generate.mjs');
  assert.ok(dateien.length >= 7, 'the golden folders exist');
  for (const f of dateien) {
    const text = fs.readFileSync(f, 'utf8');
    if (host.length >= 4) assert.ok(!text.includes(host), `${f}: host name ${host}`);
    assert.ok(!text.includes(`/${user}/`), `${f}: user folder /${user}/`);
    if (f.endsWith('.json')) {
      for (const s of strings(JSON.parse(text))) {
        assert.ok(!s.startsWith('/'), `${f}: absolute path value ${s}`);
        assert.ok(!/^[A-Za-z]:[\\/]/.test(s), `${f}: drive letter path ${s}`);
        for (const t of PFAD_TEIL) assert.ok(!s.includes(t), `${f}: path fragment ${t} in ${s}`);
      }
    }
  }
});

test('golden: the format of 1.0 is pinned', () => {
  assert.equal(FORMAT, 'cypherdj-projekt/3', 'format change: bump the number, add a lift in pruefeProjekt, add a golden folder');
});

test('golden: an unknown field is still an error (strict policy)', () => {
  const liste = drei();
  assert.ok(liste.length > 0, 'a /3 golden folder exists');
  const j = JSON.parse(fs.readFileSync(path.join(liste[0].ordner, 'project.json'), 'utf8'));
  const r = pruefeProjekt({ ...j, zzz: 1 });
  assert.ok('fehler' in r, 'an unknown field must be refused');
  assert.match(r.fehler, /zzz/);
});

// ---- Task 2: instruments, live, /1 and /2 files and their lifts ----

const lies = (slug, datei = 'project.json') => JSON.parse(fs.readFileSync(path.join(GOLDEN_WURZEL, slug, datei), 'utf8'));
const alleModelle = () => drei().map((g) => lies(g.slug));

test('golden: at least twelve folders, and the committed set covers every R1 feature', () => {
  const liste = goldenListe();
  assert.equal(liste.length, 14, `exactly 14 golden folders expected now, found ${liste.map((g) => g.slug).join(', ')}`);
  assert.ok(liste.length >= 12);
  const ms = alleModelle();
  const spuren = ms.flatMap((m) => m.spuren);
  const clips = spuren.flatMap((s) => s.clips);
  const geraete = spuren.map((s) => s.geraet).filter(Boolean);
  const wert = (b, was) => assert.ok(b, `missing feature: ${was}`);
  wert(clips.some((c) => c.art === 'audio'), 'audio clip');
  wert(clips.some((c) => c.art === 'midi' && c.noten.length >= 16 && c.noten.some((n) => 'chance' in n)), 'midi clip with notes');
  wert(spuren.some((s) => (s.automation ?? []).length > 0), 'automation lane');
  wert(geraete.some((g) => g.name === 'kit'), 'kit device');
  wert(spuren.some((s) => s.rack && s.rack.makros.length === 4), 'rack with macros');
  wert(ms.some((m) => (m.gruppen ?? []).length > 0 && (m.returns ?? []).length > 0), 'groups and returns');
  wert(geraete.some((g) => g.art === 'wirt' && g.name === 'surge' && typeof g.patch === 'string'), 'surge with patch');
  wert(geraete.some((g) => g.name === 'bk' && 'k1' in g.parameter), 'bk with parameter');
  const zellen = spuren.flatMap((s) => (s.zellen ?? [])).filter((z) => z && !z.halten);
  wert(zellen.some((z) => z.scheiben) && zellen.some((z) => z.huellen), 'cells with slices and envelopes');
  wert(zellen.some((z) => z.art === 'loop') && zellen.some((z) => z.art === 'einmal'), 'cells of art loop and einmal');
  wert(ms.some((m) => Array.isArray(m.szenen) && m.szenen.some((s) => s !== null)), 'scenes');
  wert(spuren.some((s) => (s.takes ?? []).length > 0), 'take');
  wert(ms.some((m) => m.taktart[0] === 3 && m.taktart[1] === 4), 'time signature 3/4');
});

// the stored form of a model, as Projekte.schreibe writes it
const gespeichert = (m) => JSON.parse(JSON.stringify(normalisiere(m)));

test('lift: alt-1 equals erwartet-3.json and is a /3 fixpoint', () => {
  const alt = lies('alt-1');
  assert.equal(alt.format, 'cypherdj-projekt/1');
  const r = pruefeProjekt(alt);
  assert.ok('projekt' in r, JSON.stringify(r));
  const erwartet = lies('alt-1', 'erwartet-3.json');
  assert.deepEqual(gespeichert(r.projekt), erwartet);
  assert.equal(erwartet.format, FORMAT);
  assert.deepEqual(erwartet.gruppen, []);
  assert.deepEqual(erwartet.master, { fader_db: 0 });
  const r2 = pruefeProjekt(erwartet);
  assert.ok('projekt' in r2);
  assert.equal(kanonisch(r2.projekt), kanonisch(erwartet));
});

test('lift: alt-2 equals erwartet-3.json; places are [seq, track, loops, track], no strudel group invented', () => {
  const alt = lies('alt-2');
  assert.equal(alt.format, 'cypherdj-projekt/2');
  const r = pruefeProjekt(alt);
  assert.ok('projekt' in r, JSON.stringify(r));
  const erwartet = lies('alt-2', 'erwartet-3.json');
  assert.deepEqual(gespeichert(r.projekt), erwartet);
  // by hand from the doc comment of hebeAufDrei: the SEQ deck claims its place 1, the loop deck without ausgang_platz and platz 1 claims place 3,
  // the free places 2 and 4 take the default layout where the type is still free: place 2 wants track, place 4 wants loops (taken) so it is a track
  assert.deepEqual(erwartet.plaetze.map((e) => e.typ), ['seq', 'track', 'loops', 'track']);
  assert.equal(erwartet.plaetze[0].gruppe, alt.gruppen.find((g) => g.seq).id);
  assert.equal(erwartet.plaetze[2].gruppe, alt.gruppen.find((g) => g.loopdeck).id);
  assert.ok(!erwartet.gruppen.some((g) => g.strudel), 'no strudel group invented');
  assert.ok(!erwartet.gruppen.some((g) => 'platz' in (g.seq ?? {}) || 'ausgang_platz' in (g.loopdeck ?? {})), 'removed fields are gone');
  assert.ok(erwartet.returns.length > 0 && erwartet.returns.every((r) => typeof r.gruppe === 'string'), 'every return has an owner');
  assert.ok('projekt' in pruefeProjekt(erwartet));
});

test('lift: alt-2-produktion changes only the format string', () => {
  const alt = lies('alt-2-produktion');
  assert.equal(alt.format, 'cypherdj-projekt/2');
  const erwartet = lies('alt-2-produktion', 'erwartet-3.json');
  assert.deepEqual({ ...alt, format: FORMAT }, erwartet);
  const r = pruefeProjekt(alt);
  assert.ok('projekt' in r, JSON.stringify(r));
  assert.deepEqual(gespeichert(r.projekt), erwartet);
});

test('lift: lifting an already lifted model gives itself', () => {
  for (const slug of ['alt-1', 'alt-2', 'alt-2-produktion']) {
    const erwartet = lies(slug, 'erwartet-3.json');
    const r = pruefeProjekt(erwartet);
    assert.ok('projekt' in r, `${slug}: ${JSON.stringify(r)}`);
    assert.deepEqual(r.projekt, erwartet, `${slug}: lifting a /3 model changed it`);
  }
});
