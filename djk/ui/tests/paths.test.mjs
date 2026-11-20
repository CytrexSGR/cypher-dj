// paths.ts (Plan 2026-10-15-d1-s1, Task 7): jede Vorgabe liefert genau den Pfad, den server.ts bis bfdd3983 an seinen 16 Stellen
// selbst baute (Charakterisierung, Werte von dort abgeschrieben). Die Instanz wird bei jedem Aufruf gelesen, nicht beim Import.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import * as P from '../paths.ts';

const H = os.homedir();
const mitInstanz = (i, f) => { const alt = process.env.CYPHERDJ_INSTANZ; if (i === undefined) delete process.env.CYPHERDJ_INSTANZ; else process.env.CYPHERDJ_INSTANZ = i;
  try { return f(); } finally { if (alt === undefined) delete process.env.CYPHERDJ_INSTANZ; else process.env.CYPHERDJ_INSTANZ = alt; } };

test('pfade: Betrieb (ohne Instanz) und Prüfinstanz c liefern die Pfade der Tabelle (frisches HOME: neue Orte, Kern-Arten am alten Link) und die alten Pfade der Instanz', () => {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'pfade-home-'));
  const alteUmg = { HOME: process.env.HOME, HEIM: process.env.CYPHERDJ_HEIM, KIT: process.env.CYPHERDJ_KIT_ORDNER };
  process.env.HOME = h; delete process.env.CYPHERDJ_HEIM; delete process.env.CYPHERDJ_KIT_ORDNER;
  try { betriebUndInstanz(h); } finally { process.env.HOME = alteUmg.HOME; for (const [k, v] of [['CYPHERDJ_HEIM', alteUmg.HEIM], ['CYPHERDJ_KIT_ORDNER', alteUmg.KIT]]) if (v !== undefined) process.env[k] = v; fs.rmSync(h, { recursive: true, force: true }); }
});
function betriebUndInstanz(H) {
  const bild = (i) => mitInstanz(i, () => ({ shm: P.shmOrdner(), raster: P.rasterOrdnerVorgabe(), hotcues: P.hotcueOrdnerVorgabe(), huellen: P.huellenVorgabe(),
    muster: P.musterOrdnerVorgabe(), wirt: P.wirtOrdnerVorgabe(), kits: P.kitsOrdnerVorgabe(), zusatz: P.zusatzKit(), ports: P.ports(),
    loops: P.loopOrdnerVorgabe(P.instanz()), welle: P.welleCacheVorgabe(P.instanz()), ab: P.arbeitsbestandVorgabe(P.instanz()) }));
  assert.deepEqual(bild(undefined), { shm: '/dev/shm/cypherdj', raster: path.join(H, 'cypherdj/werke/korrekturen/raster'), hotcues: path.join(H, 'cypherdj/werke/korrekturen/hotcues'),
    huellen: '/dev/shm/cypherdj/huellen', muster: '/dev/shm/cypherdj/erzeuger', wirt: '/dev/shm/cypherdj', kits: path.join(H, '.config/cypherdj/kits'), zusatz: 'rec',
    ports: { port: 47300, kernPort: 47100, aboPort: 47150, leitstandWs: 47200 }, loops: path.join(H, '.config/cypherdj/loops'),
    welle: path.join(H, '.cache/cypherdj/welle'), ab: '/dev/shm/cypherdj/material' });
  assert.deepEqual(bild('c'), { shm: '/dev/shm/cypherdj-c', raster: '/dev/shm/cypherdj-c/raster', hotcues: '/dev/shm/cypherdj-c/hotcues',
    huellen: '/dev/shm/cypherdj-c/huellen', muster: '/dev/shm/cypherdj-c/erzeuger', wirt: '/dev/shm/cypherdj-c', kits: path.join(H, '.config/cypherdj/kits'), zusatz: 'rec-c',
    ports: { port: 50300, kernPort: 50100, aboPort: 50150, leitstandWs: 50200 }, loops: '/dev/shm/cypherdj-c/loops',
    welle: '/dev/shm/cypherdj-c/welle', ab: '/dev/shm/cypherdj-c/material' });
}

test('pfade: Instanz zur Laufzeit gelesen; ungültige Instanz wirft mit dem alten Wortlaut; leer ist der Betrieb', () => {
  assert.equal(mitInstanz('b', () => P.shmOrdner()), '/dev/shm/cypherdj-b');
  assert.equal(mitInstanz(undefined, () => P.shmOrdner()), '/dev/shm/cypherdj');
  assert.equal(mitInstanz('', () => P.versatz()), 0);
  assert.equal(P.versatz('i'), 9000);
  assert.throws(() => mitInstanz('z', () => P.ports()), { message: 'CYPHERDJ_INSTANZ=z: erlaubt sind a bis i (ROADMAP Z2)' });
});

test('pfade: Repo-Pfade zeigen in dieses Repo (server.ts liegt in HIER)', () => {
  assert.equal(path.join(P.HIER, 'server.ts'), path.resolve(import.meta.dirname, '..', 'server.ts'));
  assert.equal(P.REPO, path.resolve(import.meta.dirname, '..', '..', '..'));
  assert.deepEqual(P.REPO_PFADE, { bestand: path.join(P.REPO, 'bestand'), sammlungen: path.join(P.REPO, 'bibliothek', 'sets'),
    musterBibliothek: path.join(P.REPO, 'bibliothek', 'muster'), musterSets: path.join(P.REPO, 'sets'), musterStarter: path.join(P.REPO, 'djk', 'starter', 'muster'),
    werkstatt: path.join(P.REPO, 'djk', 'workshop'),
    djkMuster: path.join(P.REPO, 'djk', 'generator', 'djk-muster'), djkKlang: path.join(P.REPO, 'djk', 'hosts', 'carla', 'djk-klang'),
    surgeBereiche: path.join(P.REPO, 'djk', 'hosts', 'carla', 'surge_bereiche.json'), welleSkript: path.join(P.HIER, 'waveform.py') });
});

test('pfade: CYPHERDJ_KIT_ORDNER ersetzt den Kit-Ordner der Konfiguration, leer zählt als nicht gesetzt (Paket 1.9 T2.0)', () => {
  const alt = process.env.CYPHERDJ_KIT_ORDNER;
  const mit = (w, f) => { if (w === undefined) delete process.env.CYPHERDJ_KIT_ORDNER; else process.env.CYPHERDJ_KIT_ORDNER = w; try { return f(); } finally { if (alt === undefined) delete process.env.CYPHERDJ_KIT_ORDNER; else process.env.CYPHERDJ_KIT_ORDNER = alt; } };
  assert.equal(mit('/tmp/kits-d', () => P.kitsOrdnerVorgabe()), '/tmp/kits-d');
  assert.equal(mit('/tmp/kits-d', () => mitInstanz('d', () => P.kitsOrdnerVorgabe())), '/tmp/kits-d');
  // negative control: without the variable (or empty) the configured folder, unchanged
  assert.equal(mit(undefined, () => P.kitsOrdnerVorgabe()), path.join(H, '.config/cypherdj/kits'));
  assert.equal(mit('', () => P.kitsOrdnerVorgabe()), path.join(H, '.config/cypherdj/kits'));
});

// ---- storage table (djk/config/ablage.json) ----
import fs from 'node:fs';
const mitEnv = (kv, f) => { const alt = {}; for (const k of Object.keys(kv)) { alt[k] = process.env[k]; if (kv[k] === undefined) delete process.env[k]; else process.env[k] = kv[k]; }
  try { return f(); } finally { for (const k of Object.keys(alt)) { if (alt[k] === undefined) delete process.env[k]; else process.env[k] = alt[k]; } } };
const ALT = (H) => ({ projekte: `${H}/cypherdj-projekte`, module: `${H}/.config/cypherdj/module`, sampler: `${H}/.config/cypherdj/sampler`, presets: `${H}/.config/cypherdj/presets`,
  klaenge: `${H}/.config/cypherdj/klaenge`, kollektionen: `${H}/.config/cypherdj/kollektionen`, raster: `${H}/.config/cypherdj/raster`, hotcues: `${H}/.config/cypherdj/hotcues`,
  kits: `${H}/.config/cypherdj/kits`, loops: `${H}/.config/cypherdj/loops`, geraete: `${H}/.config/cypherdj/baukasten` });
const ENVS = ['CYPHERDJ_HEIM', 'CYPHERDJ_MODULE', 'CYPHERDJ_SAMPLER', 'CYPHERDJ_KLAENGE', 'CYPHERDJ_KIT_ORDNER', 'CYPHERDJ_BK_ORDNER'];
const ohneEnv = Object.fromEntries(ENVS.map((k) => [k, undefined]));
const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ablage-home-'));
const neuTabelle = () => ({ ...JSON.parse(fs.readFileSync(path.join(P.REPO, 'djk', 'config', 'ablage.json'), 'utf8')), vorgabe: 'neu' });

test('ablage: every kind resolves to its old place while vorgabe is alt', () => {
  mitEnv(ohneEnv, () => {
    const altTabelle = { ...neuTabelle(), vorgabe: 'alt' };
    const got = Object.fromEntries(P.ablageArten().map((a) => [a, P.ablageOrdner(a, { tabelle: altTabelle })]));
    assert.deepEqual(got, ALT(H));
    assert.equal(P.ablageArten().length, 11);
  });
});

test('ablage: env override wins, empty counts as unset', () => {
  mitEnv({ ...ohneEnv, CYPHERDJ_KIT_ORDNER: '/tmp/k' }, () => assert.equal(P.ablageOrdner('kits'), '/tmp/k'));
  mitEnv({ ...ohneEnv, CYPHERDJ_KIT_ORDNER: '' }, () => assert.equal(P.ablageOrdner('kits'), path.join(H, '.config/cypherdj/kits')));
  mitEnv({ ...ohneEnv, CYPHERDJ_KIT_ORDNER: '/tmp/k' }, () => assert.equal(P.ablageOrdner('kits', { tabelle: neuTabelle() }), '/tmp/k'));
});

test('ablage: CYPHERDJ_HEIM moves neu, relative is refused', () => {
  mitEnv({ ...ohneEnv, CYPHERDJ_HEIM: '/tmp/h/' }, () => {
    assert.equal(P.ablageOrte('kits').neu, '/tmp/h/werke/kits');
    assert.equal(P.heimOrdner(), '/tmp/h');
    assert.equal(P.festerPfad('quellen'), '/tmp/h/quellen.toml');
    assert.equal(P.festerPfad('referenzen'), '/tmp/h/werke/referenzen');
    assert.equal(P.referenzOrdnerVorgabe(''), '/tmp/h/werke/referenzen');
    assert.equal(P.referenzOrdnerVorgabe('c'), '/dev/shm/cypherdj-c/referenzen');
  });
  mitEnv({ ...ohneEnv, CYPHERDJ_HEIM: 'rel' }, () => assert.throws(() => P.ablageOrte('kits'), { message: 'CYPHERDJ_HEIM must be an absolute path' }));
  mitEnv({ ...ohneEnv, CYPHERDJ_HEIM: '  ' }, () => assert.throws(() => P.heimOrdner(), { message: 'CYPHERDJ_HEIM must be an absolute path' }));
  mitEnv({ ...ohneEnv, CYPHERDJ_HEIM: '' }, () => assert.equal(P.heimOrdner(), path.join(H, 'cypherdj')));
});

test('ablage: vorgabe neu aborts when alt is a link to a missing target (moved home, disk absent)', () => {
  const t = neuTabelle();
  mitEnv(ohneEnv, () => {
    const h = tmpHome(); const alt = path.join(h, '.config', 'cypherdj', 'presets');
    fs.mkdirSync(path.dirname(alt), { recursive: true }); fs.symlinkSync(path.join(h, 'platte', 'heim', 'werke', 'presets'), alt);
    mitEnv({ HOME: h }, () => assert.throws(() => P.ablageOrdner('presets', { tabelle: t, log: () => {} }), /is the disk mounted/));
  });
});

test('ablage: vorgabe neu picks a real alt, else neu', () => {
  const t = neuTabelle();
  mitEnv(ohneEnv, () => {
    const alt = (h) => path.join(h, '.config', 'cypherdj', 'presets'), neu = (h) => path.join(h, 'cypherdj', 'werke', 'presets');
    const opt = { tabelle: t, log: () => {} };
    const h1 = tmpHome(); fs.mkdirSync(alt(h1), { recursive: true });                       // unmigrated
    mitEnv({ HOME: h1 }, () => assert.equal(P.ablageOrdner('presets', opt), alt(h1)));
    const h2 = tmpHome(); fs.mkdirSync(neu(h2), { recursive: true }); fs.mkdirSync(path.dirname(alt(h2)), { recursive: true }); fs.symlinkSync(neu(h2), alt(h2)); // migrated
    mitEnv({ HOME: h2 }, () => assert.equal(P.ablageOrdner('presets', opt), neu(h2)));
    const h3 = tmpHome();                                                                   // fresh
    mitEnv({ HOME: h3 }, () => assert.equal(P.ablageOrdner('presets', opt), neu(h3)));
    const h4 = tmpHome(); fs.mkdirSync(neu(h4), { recursive: true }); fs.writeFileSync(path.join(neu(h4), 'a'), 'x'); // nur_neu
    mitEnv({ HOME: h4 }, () => assert.equal(P.ablageOrdner('presets', opt), neu(h4)));
    const h5 = tmpHome();                                                                   // kern kinds stay at alt
    mitEnv({ HOME: h5 }, () => assert.equal(P.ablageOrdner('kits', opt), path.join(h5, '.config/cypherdj/kits')));
  });
});

test('ablage: beide stays at alt and warns once', () => {
  mitEnv(ohneEnv, () => {
    const h = tmpHome(); const alt = path.join(h, '.config/cypherdj/presets'), neu = path.join(h, 'cypherdj/werke/presets');
    fs.mkdirSync(alt, { recursive: true }); fs.mkdirSync(neu, { recursive: true }); fs.writeFileSync(path.join(neu, 'x.json'), '{}');
    const log = []; const opt = { tabelle: neuTabelle(), log: (e) => log.push(e), gewarnt: new Set() };
    mitEnv({ HOME: h }, () => { assert.equal(P.ablageOrdner('presets', opt), alt); assert.equal(P.ablageOrdner('presets', opt), alt); });
    assert.deepEqual(log, [{ typ: 'ablage_beide', art: 'presets', alt, neu }]);
  });
});

test('ablage: every module default equals the table', async () => {
  const { graphenOrdner } = await import('../graphs.ts');
  const { samplerOrdner } = await import('../sampler/schnitt.ts');
  const { modulBasis } = await import('../project/module_storage.ts');
  const { projektWurzelVorgabe } = await import('../project/storage.ts');
  const { nutzerVorgabe } = await import('../presets/store.ts');
  const { kollektionenVorgabe } = await import('../collections/store.ts');
  const { eigeneOrdner, werkOrdner } = await import('../areas/proj/surge_patches.ts');
  const { INDEX_VORGABE } = await import('../plugins/index.ts');
  const { MEDIATHEK_VORGABE } = await import('../media_library.ts');
  const env = { ...ohneEnv, CYPHERDJ_INSTANZ: undefined, CYPHERDJ_MEDIATHEK: undefined, CYPHERDJ_SURGE_PATCHES: undefined, CYPHERDJ_PLUGIN_INDEX: undefined, CYPHERDJ_ANALYSE: undefined };
  mitEnv(env, () => {
    assert.equal(graphenOrdner(), P.ablageOrdner('geraete'));
    assert.equal(samplerOrdner(), P.ablageOrdner('sampler'));
    assert.equal(modulBasis(), P.ablageOrdner('module'));
    assert.equal(projektWurzelVorgabe(''), P.ablageOrdner('projekte'));
    assert.equal(nutzerVorgabe(''), P.ablageOrdner('presets'));
    assert.equal(kollektionenVorgabe(''), P.ablageOrdner('kollektionen'));
    assert.equal(eigeneOrdner(), P.ablageOrdner('klaenge'));
    assert.equal(werkOrdner(), P.festerPfad('surge_werk'));
    assert.equal(INDEX_VORGABE(), P.festerPfad('plugin_index'));
    assert.equal(P.rasterOrdnerVorgabe(''), P.ablageOrdner('raster'));
    assert.equal(P.hotcueOrdnerVorgabe(''), P.ablageOrdner('hotcues'));
    assert.equal(P.loopOrdnerVorgabe(''), P.ablageOrdner('loops'));
    assert.equal(P.analyseVorgabe(''), P.festerPfad('analyse'));
    assert.equal(MEDIATHEK_VORGABE, path.join(H, '.local/share/cypherdj/mediathek/mediathek.sqlite'));
    // an empty value counts as unset for every storage variable
    const hl = tmpHome();                                                                   // fresh HOME: vorgabe neu, geraete is a core kind
    mitEnv({ HOME: hl, CYPHERDJ_SAMPLER: '', CYPHERDJ_MODULE: '', CYPHERDJ_KLAENGE: '', CYPHERDJ_BK_ORDNER: '', CYPHERDJ_PLUGIN_INDEX: '' }, () => {
      assert.equal(samplerOrdner(), path.join(hl, 'cypherdj/werke/sampler'));
      assert.equal(modulBasis(), path.join(hl, 'cypherdj/werke/module'));
      assert.equal(eigeneOrdner(), path.join(hl, 'cypherdj/werke/klaenge'));
      assert.equal(graphenOrdner(), path.join(hl, '.config/cypherdj/baukasten'));
      assert.equal(INDEX_VORGABE(), P.festerPfad('plugin_index'));
    });
    // CYPHERDJ_HEIM plus a test table with vorgabe neu: projects follow, kern kinds stay
    const h = tmpHome();
    mitEnv({ HOME: h, CYPHERDJ_HEIM: '/tmp/h' }, () => {
      const opt = { tabelle: neuTabelle(), log: () => {} };
      assert.equal(projektWurzelVorgabe('', opt), '/tmp/h/werke/projekte');
      assert.equal(nutzerVorgabe('', opt), '/tmp/h/werke/presets');
      assert.equal(P.kitsOrdnerVorgabe(opt), path.join(h, '.config/cypherdj/kits'));
    });
    // instance paths unchanged
    assert.equal(projektWurzelVorgabe('c'), '/dev/shm/cypherdj-c/projekte');
    assert.ok(nutzerVorgabe('c').endsWith('.config/cypherdj-c/presets'));
    assert.ok(kollektionenVorgabe('c').endsWith('.config/cypherdj-c/kollektionen'));
    assert.equal(P.rasterOrdnerVorgabe('c'), '/dev/shm/cypherdj-c/raster');
    assert.equal(P.loopOrdnerVorgabe('c'), '/dev/shm/cypherdj-c/loops');
  });
});

// ---- the shipped table says vorgabe neu (storage layout task 14) ----
import { execFileSync } from 'node:child_process';

test('ablage: vorgabe neu: production defaults are the new places, core kinds stay at the link', () => {
  assert.equal(JSON.parse(fs.readFileSync(path.join(P.REPO, 'djk', 'config', 'ablage.json'), 'utf8')).vorgabe, 'neu');
  mitEnv({ ...ohneEnv, CYPHERDJ_INSTANZ: undefined }, () => {
    const h = tmpHome();                                                                    // fresh install: nothing exists yet
    mitEnv({ HOME: h }, () => {
      for (const a of P.ablageArten()) {
        const o = P.ablageOrte(a);
        assert.equal(P.ablageOrdner(a), o.kern ? o.alt : o.neu, a);
        assert.ok(o.neu.startsWith(path.join(h, 'cypherdj', 'werke') + '/'), a);
      }
      assert.equal(P.ablageOrdner('projekte'), path.join(h, 'cypherdj/werke/projekte'));
      assert.equal(P.ablageOrdner('raster'), path.join(h, 'cypherdj/werke/korrekturen/raster'));
      assert.equal(P.ablageOrdner('kits'), path.join(h, '.config/cypherdj/kits'));
      assert.equal(P.ablageOrdner('loops'), path.join(h, '.config/cypherdj/loops'));
      assert.equal(P.ablageOrdner('geraete'), path.join(h, '.config/cypherdj/baukasten'));
    });
  });
});

test('ablage: an already moved home (old places are links) resolves every kind to the same real folder in TS and Python', () => {
  mitEnv({ ...ohneEnv, CYPHERDJ_INSTANZ: undefined }, () => {
    const h = tmpHome();
    mitEnv({ HOME: h }, () => {
      for (const a of P.ablageArten()) {                                                    // state after the move: neu is real, alt is a link
        const o = P.ablageOrte(a);
        fs.mkdirSync(o.neu, { recursive: true }); fs.writeFileSync(path.join(o.neu, 'marker'), a);
        fs.mkdirSync(path.dirname(o.alt), { recursive: true }); fs.symlinkSync(o.neu, o.alt);
      }
      const penv = { PATH: process.env.PATH, HOME: h, PYTHONPATH: path.join(P.REPO, 'djk'), PYTHONSAFEPATH: '1' };
      for (const a of P.ablageArten()) {
        const o = P.ablageOrte(a);
        const vorher = fs.realpathSync(o.alt);                                              // what the old default reached
        assert.equal(fs.realpathSync(P.ablageOrdner(a)), vorher, `ts ${a}`);
        const py = execFileSync('python3', ['-m', 'ablage', 'pfad', a], { env: penv, encoding: 'utf8' }).trim();
        assert.equal(fs.realpathSync(py), vorher, `python ${a}`);
        assert.equal(fs.readFileSync(path.join(P.ablageOrdner(a), 'marker'), 'utf8'), a);
      }
    });
  });
});
