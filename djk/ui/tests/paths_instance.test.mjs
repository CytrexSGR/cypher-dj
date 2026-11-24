// A test instance (CYPHERDJ_INSTANZ a..i) keeps every store in its own /dev/shm folder when no env variable names one; the live studio (empty instance)
// resolves exactly as before. Table-driven over every storage kind (djk/config/ablage.json) and every fixed name.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as P from '../paths.ts';

const FEST = ['mediathek', 'analyse', 'bibliothek_konfig', 'surge_werk', 'plugin_index', 'umgebung', 'pruefen', 'quellen', 'referenzen'];
// Kept on the real place on purpose (reason in the inventory): core kinds (the kern reads the one real folder, djk-start passes the env), read-only machine data.
const BLEIBT_ECHT = new Set(['kits', 'loops', 'surge_werk', 'umgebung']);

// Values of the live studio, computed with the code before the change (fresh HOME, no env). <H> = HOME, <R> = the repo.
const BETRIEB_ARTEN = { projekte: '<H>/cypherdj/werke/projekte', module: '<H>/cypherdj/werke/module', sampler: '<H>/cypherdj/werke/sampler',
  presets: '<H>/cypherdj/werke/presets', klaenge: '<H>/cypherdj/werke/klaenge', kollektionen: '<H>/cypherdj/werke/sammlungen/kollektionen',
  raster: '<H>/cypherdj/werke/korrekturen/raster', hotcues: '<H>/cypherdj/werke/korrekturen/hotcues', kits: '<H>/.config/cypherdj/kits',
  loops: '<H>/.config/cypherdj/loops', geraete: '<H>/.config/cypherdj/baukasten', loopsets: '<H>/cypherdj/werke/loopsets', bestand: '<H>/cypherdj/werke/bestand',
  sammlungen: '<R>/bibliothek/sets', muster: '<R>/bibliothek/muster', journal: '<H>/cypherdj/journal', importe: '<H>/cypherdj/werke/importe', mitschnitte: '<H>/cypherdj/werke/mitschnitte' };
const BETRIEB_FEST = { mediathek: '<H>/.local/share/cypherdj/mediathek/mediathek.sqlite', analyse: '<H>/werkstatt/cypher-dj-analyse',
  bibliothek_konfig: '<H>/.config/cypherdj/bibliothek.json', surge_werk: '<H>/.local/share/cypherdj/surge-daten/usr/share/surge-xt/patches_factory',
  plugin_index: '<H>/.local/state/cypherdj/plugins/index.json', umgebung: '<H>/.config/cypherdj/umgebung.env', pruefen: '<H>/cypherdj/pruefen',
  quellen: '<H>/cypherdj/quellen.toml', referenzen: '<H>/cypherdj/werke/referenzen' };

function mitUmgebung(h, instanz, extra, f) {
  const alt = { ...process.env };
  for (const k of Object.keys(process.env)) if (k.startsWith('CYPHERDJ_')) delete process.env[k];
  process.env.HOME = h;
  if (instanz !== undefined) process.env.CYPHERDJ_INSTANZ = instanz;
  Object.assign(process.env, extra);
  try { return f(); } finally { for (const k of Object.keys(process.env)) if (!(k in alt)) delete process.env[k]; Object.assign(process.env, alt); }
}
const alle = () => ({ arten: Object.fromEntries(P.ablageArten().map((a) => [a, P.ablageOrdner(a)])), fest: Object.fromEntries(FEST.map((n) => [n, P.festerPfad(n)])) });
const frischesHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pfade-inst-'));

test('instanz paths: the table is covered completely (a new kind or name must be added here)', () => {
  assert.deepEqual(P.ablageArten().sort(), Object.keys(BETRIEB_ARTEN).sort());
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(P.REPO, 'djk/config/ablage.json'), 'utf8')).fest).sort(), [...FEST].sort());
});

test('instanz paths: the live studio (empty instance) resolves exactly as before', () => {
  const h = frischesHome();
  try {
    const r = mitUmgebung(h, undefined, {}, alle);
    const ein = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.replace('<H>', h).replace('<R>', P.REPO)]));
    // a checkout that still holds the owner's legacy stores (<R>/bestand, <R>/sets/djk) resolves to them: derive the expectation the same way
    const erwartet = ein(BETRIEB_ARTEN);
    if (fs.existsSync(path.join(P.REPO, 'bestand'))) erwartet.bestand = path.join(P.REPO, 'bestand');
    if (fs.existsSync(path.join(P.REPO, 'sets/djk'))) erwartet.journal = path.join(P.REPO, 'sets/djk');
    assert.deepEqual(r.arten, erwartet);
    assert.deepEqual(r.fest, ein(BETRIEB_FEST));
    assert.deepEqual(mitUmgebung(h, '', {}, alle), r);   // an empty variable is the live studio too
  } finally { fs.rmSync(h, { recursive: true, force: true }); }
});

test('instanz paths: instance e without env override keeps every store under its own /dev/shm folder (reasoned exceptions only)', () => {
  const h = frischesHome();
  try {
    const r = mitUmgebung(h, 'e', {}, alle);
    const alleWege = { ...r.arten, ...r.fest };
    for (const [name, p] of Object.entries(alleWege)) {
      if (BLEIBT_ECHT.has(name)) continue;
      assert.ok(p.startsWith('/dev/shm/cypherdj-e/'), `${name}: ${p} is not under /dev/shm/cypherdj-e/`);
      assert.ok(!p.startsWith(h) && !p.startsWith(P.REPO), `${name}: ${p} points into the home folder or the repo`);
    }
    // the exceptions still resolve to the real place, so a changed exception shows up here
    for (const name of BLEIBT_ECHT) assert.equal(alleWege[name], (BETRIEB_ARTEN[name] ?? BETRIEB_FEST[name]).replace('<H>', h), name);
    // the same instance, other letter: its own folder
    assert.equal(mitUmgebung(h, 'b', {}, () => P.ablageOrdner('sampler')), '/dev/shm/cypherdj-b/sampler');
    assert.equal(mitUmgebung(h, 'e', {}, () => P.festerPfad('mediathek')), '/dev/shm/cypherdj-e/mediathek/mediathek.sqlite');
    // an empty env variable counts as unset
    assert.equal(mitUmgebung(h, 'e', { CYPHERDJ_SAMPLER: '', CYPHERDJ_MEDIATHEK: '' }, () => P.ablageOrdner('sampler')), '/dev/shm/cypherdj-e/sampler');
  } finally { fs.rmSync(h, { recursive: true, force: true }); }
});

test('instanz paths: an env override wins over the instance folder, for every kind and name that has a variable', () => {
  const h = frischesHome();
  try {
    const tab = JSON.parse(fs.readFileSync(path.join(P.REPO, 'djk/config/ablage.json'), 'utf8'));
    let n = 0;
    for (const [art, z] of Object.entries(tab.arten)) if (z.env) { n++; assert.equal(mitUmgebung(h, 'e', { [z.env]: `/tmp/ueber/${art}` }, () => P.ablageOrdner(art)), `/tmp/ueber/${art}`, art); }
    for (const [name, z] of Object.entries(tab.fest)) if (z.env) { n++; assert.equal(mitUmgebung(h, 'e', { [z.env]: `/tmp/ueber/${name}` }, () => P.festerPfad(name)), `/tmp/ueber/${name}`, name); }
    assert.ok(n >= 15, `only ${n} overrides exercised`);
  } finally { fs.rmSync(h, { recursive: true, force: true }); }
});

test('instanz paths: the stores that already lived in /dev/shm keep their folders', () => {
  const h = frischesHome();
  try {
    mitUmgebung(h, 'e', {}, () => {
      assert.equal(P.loopOrdnerVorgabe('e'), '/dev/shm/cypherdj-e/loops');
      assert.equal(P.importeOrdnerVorgabe('e'), '/dev/shm/cypherdj-e/importe');
      assert.equal(P.rasterOrdnerVorgabe('e'), '/dev/shm/cypherdj-e/raster');
      assert.equal(P.hotcueOrdnerVorgabe('e'), '/dev/shm/cypherdj-e/hotcues');
      assert.equal(P.referenzOrdnerVorgabe('e'), '/dev/shm/cypherdj-e/referenzen');
      assert.equal(P.analyseVorgabe('e'), null);
    });
  } finally { fs.rmSync(h, { recursive: true, force: true }); }
});
