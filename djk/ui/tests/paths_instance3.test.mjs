// Test instance isolation, part 3: the page server hands projBereich a mediathek PATH (not the function), and the kit writers refuse the owner's kit folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Oberflaeche } from '../server.ts';
import { mediathekVorgabe } from '../media_library.ts';
import { ablageOrte } from '../paths.ts';
import { legeKitAusAudio, kitMitKlang } from '../sampler/kit.ts';
import { kitSchreibGrund } from '../sampler/bk_schutz.ts';
import { installiereKitOrdner, benenneKitUm, kopiereKit, loescheKit } from '../project/kit_storage.ts';
import { K, TEST_INSTANZ, serverInstanzSetzen } from './support/instance.mjs';

const mitEnv = (kv, f) => {
  const alt = {}; for (const k of Object.keys(kv)) alt[k] = process.env[k];
  for (const [k, v] of Object.entries(kv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  const fertig = () => { for (const [k, v] of Object.entries(alt)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
  try { const r = f(); if (r && typeof r.then === 'function') return r.finally(fertig); fertig(); return r; } catch (e) { fertig(); throw e; }
};

test('Oberflaeche without a mediathek option: projBereich gets the default path as a string (regression: the function itself was passed)', (t) => {
  serverInstanzSetzen(t);   // the server under test takes the test instance (stapel_instanz rule)
  const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
  mitEnv({ CYPHERDJ_INSTANZ: TEST_INSTANZ, CYPHERDJ_MEDIATHEK: undefined, CYPHERDJ_KATALOG: undefined }, () => {
    const o = new Oberflaeche({ port: 47300 + K, kernPort: 47100 + K, aboPort: 47150 + K, leitstandWs: 47200 + K, bestand: tmp('i3-bestand-'), arbeitsbestand: tmp('i3-ab-'),
      mutationen: [], loops: tmp('i3-loops-'), kits: tmp('i3-kits-'), welleCache: tmp('i3-welle-'), musterOrdner: tmp('i3-muster-'), hotcueOrdner: tmp('i3-hc-'),
      rasterOrdner: tmp('i3-raster-'), huellen: path.join(tmp('i3-huellen-'), 'huellen'), wirtOrdner: tmp('i3-wirt-'), sammlungen: tmp('i3-sets-'),
      musterBibliothek: tmp('i3-mb-'), musterSets: tmp('i3-ms-'), digitalout: path.join(tmp('i3-do-'), 'nix'), kernPruefmodus: true, log: () => {} });
    t.after(() => { try { o.proj.sitzung.schliesse?.(); } catch { /* best effort */ } });
    const p = o.proj.sitzung.mediathekPfad;
    assert.equal(typeof p, 'string');
    assert.equal(p, mediathekVorgabe());
    assert.equal(p, `/dev/shm/cypherdj-${TEST_INSTANZ}/mediathek/mediathek.sqlite`);
  });
});

test('kit writers: a test instance may not write into the owner kit folder (configured or old default); its own folder and the live studio are fine', async () => {
  const h = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-i3-')));
  try {
    await mitEnv({ HOME: h, CYPHERDJ_INSTANZ: 'e', CYPHERDJ_KIT_ORDNER: undefined, CYPHERDJ_KITS: undefined }, async () => {
      const orte = ablageOrte('kits');
      for (const echt of [orte.alt, orte.neu].filter((x) => x)) {
        assert.match(kitSchreibGrund(echt) ?? '', /owner's kit folder/);
        assert.match(kitSchreibGrund(path.join(echt, 'unter')) ?? '', /owner's kit folder/);
      }
      const daten = new Float32Array(2000);
      const echt = orte.alt || orte.neu;
      assert.throws(() => legeKitAusAudio({ name: 'x', daten, scheiben: [{ von: 0, bis: 500 }], quelle: 'test' }, { kits: echt }), { grund: 'kit_ordner_fehlt', code: 409 });
      assert.throws(() => legeKitAusAudio({ name: 'x', daten, scheiben: [{ von: 0, bis: 500 }], quelle: 'test' }), { grund: 'kit_ordner_fehlt', code: 409 });
      assert.throws(() => kitMitKlang({ kit: 'k', ton: 36, daten, quelle: 't' }, {}), { grund: 'kit_ordner_fehlt' });
      await assert.rejects(installiereKitOrdner(h, 'wunsch'), { grund: 'kit_ordner_fehlt' });
      assert.ok(!fs.existsSync(echt), 'nothing was created in the owner folder');
      const eigen = path.join(h, 'eigene-kits');
      const r = legeKitAusAudio({ name: 'x', daten, scheiben: [{ von: 0, bis: 500 }], quelle: 'test' }, { kits: eigen });
      assert.ok(fs.existsSync(path.join(eigen, r.kit, 'kit.json')));
      mitEnv({ CYPHERDJ_KIT_ORDNER: path.join(h, 'per-env') }, () => assert.equal(kitSchreibGrund(path.join(h, 'per-env')), null));
    });
    mitEnv({ HOME: h, CYPHERDJ_INSTANZ: undefined, CYPHERDJ_KIT_ORDNER: undefined }, () => {
      assert.equal(kitSchreibGrund(ablageOrte('kits').alt || ablageOrte('kits').neu), null);   // live studio: unchanged
    });
  } finally { fs.rmSync(h, { recursive: true, force: true }); }
});

test('kit management: rename, copy and delete refuse the owner kit folder for a test instance (kit stays untouched)', async () => {
  const h = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-i3v-')));
  try {
    const daten = new Float32Array(2000);
    let name = '';
    await mitEnv({ HOME: h, CYPHERDJ_INSTANZ: undefined, CYPHERDJ_KIT_ORDNER: undefined, CYPHERDJ_KITS: undefined }, async () => {
      const o = ablageOrte('kits');
      name = legeKitAusAudio({ name: 'verw', daten, scheiben: [{ von: 0, bis: 500 }], quelle: 'test' }, { kits: o.alt || o.neu }).kit;
    });
    await mitEnv({ HOME: h, CYPHERDJ_INSTANZ: 'e', CYPHERDJ_KIT_ORDNER: undefined, CYPHERDJ_KITS: undefined }, async () => {
      const w = ablageOrte('kits').alt || ablageOrte('kits').neu;
      const vorher = fs.readdirSync(w).sort();
      assert.throws(() => benenneKitUm(name, 'neuer'), { grund: 'kit_ordner_fehlt', code: 409 });
      await assert.rejects(kopiereKit(name, null), { grund: 'kit_ordner_fehlt', code: 409 });
      assert.throws(() => loescheKit(name), { grund: 'kit_ordner_fehlt', code: 409 });
      assert.deepEqual(fs.readdirSync(w).sort(), vorher);
    });
    await mitEnv({ HOME: h, CYPHERDJ_INSTANZ: undefined, CYPHERDJ_KIT_ORDNER: undefined, CYPHERDJ_KITS: undefined }, async () => {
      assert.deepEqual(await kopiereKit(name, null), { name: `${name}-2` });   // live studio: unchanged
    });
  } finally { fs.rmSync(h, { recursive: true, force: true }); }
});
