// pfade.ts (Plan 2026-10-15-d1-s1, Task 7): jede Vorgabe liefert genau den Pfad, den server.ts bis bfdd3983 an seinen 16 Stellen
// selbst baute (Charakterisierung, Werte von dort abgeschrieben). Die Instanz wird bei jedem Aufruf gelesen, nicht beim Import.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import * as P from '../pfade.ts';

const H = os.homedir();
const mitInstanz = (i, f) => { const alt = process.env.CYPHERDJ_INSTANZ; if (i === undefined) delete process.env.CYPHERDJ_INSTANZ; else process.env.CYPHERDJ_INSTANZ = i;
  try { return f(); } finally { if (alt === undefined) delete process.env.CYPHERDJ_INSTANZ; else process.env.CYPHERDJ_INSTANZ = alt; } };

test('pfade: Betrieb (ohne Instanz) und Prüfinstanz c liefern die alten Pfade', () => {
  const bild = (i) => mitInstanz(i, () => ({ shm: P.shmOrdner(), raster: P.rasterOrdnerVorgabe(), hotcues: P.hotcueOrdnerVorgabe(), huellen: P.huellenVorgabe(),
    muster: P.musterOrdnerVorgabe(), wirt: P.wirtOrdnerVorgabe(), kits: P.kitsOrdnerVorgabe(), zusatz: P.zusatzKit(), ports: P.ports(),
    loops: P.loopOrdnerVorgabe(P.instanz()), welle: P.welleCacheVorgabe(P.instanz()), ab: P.arbeitsbestandVorgabe(P.instanz()) }));
  assert.deepEqual(bild(undefined), { shm: '/dev/shm/cypherdj', raster: path.join(H, '.config/cypherdj/raster'), hotcues: path.join(H, '.config/cypherdj/hotcues'),
    huellen: '/dev/shm/cypherdj/huellen', muster: '/dev/shm/cypherdj/erzeuger', wirt: '/dev/shm/cypherdj', kits: path.join(H, '.config/cypherdj/kits'), zusatz: 'rec',
    ports: { port: 47300, kernPort: 47100, aboPort: 47150, leitstandWs: 47200 }, loops: path.join(H, '.config/cypherdj/loops'),
    welle: path.join(H, '.cache/cypherdj/welle'), ab: '/dev/shm/cypherdj/material' });
  assert.deepEqual(bild('c'), { shm: '/dev/shm/cypherdj-c', raster: '/dev/shm/cypherdj-c/raster', hotcues: '/dev/shm/cypherdj-c/hotcues',
    huellen: '/dev/shm/cypherdj-c/huellen', muster: '/dev/shm/cypherdj-c/erzeuger', wirt: '/dev/shm/cypherdj-c', kits: path.join(H, '.config/cypherdj/kits'), zusatz: 'rec-c',
    ports: { port: 50300, kernPort: 50100, aboPort: 50150, leitstandWs: 50200 }, loops: '/dev/shm/cypherdj-c/loops',
    welle: '/dev/shm/cypherdj-c/welle', ab: '/dev/shm/cypherdj-c/material' });
});

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
    musterBibliothek: path.join(P.REPO, 'bibliothek', 'muster'), musterSets: path.join(P.REPO, 'sets'), werkstatt: path.join(P.REPO, 'djk', 'werkstatt'),
    djkMuster: path.join(P.REPO, 'djk', 'erzeuger', 'djk-muster'), djkKlang: path.join(P.REPO, 'djk', 'wirte', 'carla', 'djk-klang'),
    surgeBereiche: path.join(P.REPO, 'djk', 'wirte', 'carla', 'surge_bereiche.json'), welleSkript: path.join(P.HIER, 'welle.py') });
});
