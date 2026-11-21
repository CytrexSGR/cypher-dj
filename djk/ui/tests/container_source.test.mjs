// Container core M5: the session tells the core what feeds each of the four containers (/k/container/quelle: 0 empty, 1 player, 2 module).
// Session level (recording core double of output_setup.mjs), plus the /lage report on the real in-process server.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { containerQuellen } from '../project/playback.ts';
import { neuesProjekt } from '../project/model.ts';
import { liveAufbau } from './support/live_module.mjs';
import { warteBis } from './support/proj_context.mjs';
import { Oberflaeche } from '../server.ts';
import { schreibeLeerenRing } from './support/ring.mjs';
import { K, TEST_INSTANZ, belegeTestInstanz } from './support/instance.mjs';

belegeTestInstanz();

const quellen = (r) => r.protokoll.gesendet.filter((g) => g.adresse === '/k/container/quelle');
const felder = (g) => ({ container: g.felder.container, art: g.felder.art });

test('containerQuellen maps track 1, leer 0, others 2; a production project sends nothing (null)', () => {
  const p = neuesProjekt('x'); p.live = true;
  p.plaetze = [{ typ: 'track' }, { typ: 'leer' }, { typ: 'seq', gruppe: 'g1' }, { typ: 'stems', gruppe: 'g2' }];
  assert.deepEqual(containerQuellen(p), [1, 0, 2, 2]);
  p.plaetze = [{ typ: 'loops', gruppe: 'g1' }, { typ: 'strudel', gruppe: 'g2' }, { typ: 'track' }, { typ: 'leer' }];
  assert.deepEqual(containerQuellen(p), [2, 2, 1, 0]);
  assert.equal(containerQuellen(neuesProjekt('prod')), null, 'a production project has no places');
});

test('opening a live project sends four container quelle messages; a second open with the same state sends none', async (t) => {
  const r = await liveAufbau(t);
  assert.deepEqual(quellen(r).map(felder), [1, 2, 3, 4].map((container) => ({ container, art: 1 })));
  for (const g of quellen(r)) assert.deepEqual([g.felder.quelle, typeof g.id], ['andreas', 'number']);
  assert.equal((await r.s.liveOeffnen('andreas')).code, 200);
  assert.equal(quellen(r).length, 4, 'already open: nothing new');
  await r.s.schliessen('andreas');
  assert.equal((await r.s.liveOeffnen('andreas')).code, 200);
  assert.equal(quellen(r).length, 4, 'reopened with the same state the core already has: nothing new');
});

test('platz_setzen track -> seq sends one message for that container, after the playback swap', async (t) => {
  const r = await liveAufbau(t);
  const n0 = r.protokoll.gesendet.length;
  await r.aendern([{ befehl: 'platz_setzen', platz: 2, typ: 'seq' }]);
  const neu = r.protokoll.gesendet.slice(n0);
  assert.deepEqual(neu.filter((g) => g.adresse === '/k/container/quelle').map(felder), [{ container: 2, art: 2 }]);
  const ordnung = neu.map((g) => g.adresse).filter((a) => a === '/k/arr/laden' || a === '/k/container/quelle');
  assert.deepEqual(ordnung, ['/k/arr/laden', '/k/container/quelle'], 'the module exists first');
});

test('seq -> track sends quelle before the playback swap', async (t) => {
  const r = await liveAufbau(t);
  await r.aendern([{ befehl: 'platz_setzen', platz: 2, typ: 'seq' }]);
  const n0 = r.protokoll.gesendet.length;
  await r.aendern([{ befehl: 'platz_setzen', platz: 2, typ: 'track' }]);
  const neu = r.protokoll.gesendet.slice(n0);
  assert.deepEqual(neu.filter((g) => g.adresse === '/k/container/quelle').map(felder), [{ container: 2, art: 1 }]);
  const ordnung = neu.map((g) => g.adresse).filter((a) => a === '/k/arr/laden' || a === '/k/container/quelle');
  assert.deepEqual(ordnung, ['/k/container/quelle', '/k/arr/laden'], 'the group is dropped last');
});

test('a command that changes no place sends no container message', async (t) => {
  const r = await liveAufbau(t);
  const n0 = quellen(r).length;
  await r.aendern([{ befehl: 'platz_setzen', platz: 3, typ: 'track' }]);
  assert.equal(quellen(r).length, n0);
});

test('a core restart replays the four messages', async (t) => {
  const r = await liveAufbau(t);
  await r.aendern([{ befehl: 'platz_setzen', platz: 4, typ: 'seq' }]);
  const n0 = quellen(r).length, g0 = r.protokoll.gesendet.length;
  r.vomKern('/k/willkommen', { generation: 1 });
  r.vomKern('/e/neustart', { generation: 2, sample: 0n });
  assert.ok(await warteBis(() => quellen(r).length >= n0 + 4, 5000), 'four messages after the restart');
  assert.deepEqual(quellen(r).slice(n0, n0 + 4).map(felder), [{ container: 1, art: 1 }, { container: 2, art: 1 }, { container: 3, art: 1 }, { container: 4, art: 2 }]);
  const nach = r.protokoll.gesendet.slice(g0).map((g) => g.adresse);
  assert.ok(nach.indexOf('/k/arr/laden') >= 0 && nach.indexOf('/k/arr/laden') < nach.indexOf('/k/container/quelle'), 'the playback is loaded again before the sources');
});

test('a refused quelle (status 6) surfaces as kern_lehnt_ab; the core state is not reported as changed', async (t) => {
  const r = await liveAufbau(t);
  const sende = r.ctx.sende;
  r.ctx.sende = (adresse, f) => { const id = sende(adresse, f); if (adresse === '/k/container/quelle') r.zustand.quittungen.set(id, { status: 6, grund: 'ausserhalb_bereich' }); return id; };
  // module direction: the core refuses the source after the swap, so the swap is taken back and the project stands on the old state
  const plaetzeVorher = JSON.stringify(r.projekt().plaetze);
  const x = await r.s.aendern({ rev: r.projekt().rev, label: 'Test', befehle: [{ befehl: 'platz_setzen', platz: 2, typ: 'seq' }] }, 'andreas');
  assert.deepEqual([x.code, x.j.fehler, x.j.container], [409, 'kern_lehnt_ab', 2]);
  assert.equal(JSON.stringify(r.projekt().plaetze), plaetzeVorher, 'the places are back on the old state');
  assert.equal(JSON.stringify(x.j.projekt.plaetze), plaetzeVorher, 'the answer carries the restored project');
  assert.equal(JSON.stringify(r.s.offen?.projekt?.plaetze ?? r.projekt().plaetze), plaetzeVorher);
  assert.deepEqual(r.s.lage.container, [1, 1, 1, 1], 'what the core reported stays');
  // quelle-first direction: nothing changes in the project when the core refuses
  r.ctx.sende = sende;
  await r.aendern([{ befehl: 'platz_setzen', platz: 3, typ: 'seq' }]);
  r.ctx.sende = (adresse, f2) => { const id = sende(adresse, f2); if (adresse === '/k/container/quelle') r.zustand.quittungen.set(id, { status: 6, grund: 'x' }); return id; };
  const rev = r.projekt().rev, typ = r.projekt().plaetze[2].typ;
  const g = await r.fehl(() => r.aendern([{ befehl: 'platz_setzen', platz: 3, typ: 'track' }]));
  assert.deepEqual(g, { code: 409, fehler: 'kern_lehnt_ab' });
  assert.deepEqual([r.projekt().rev, r.projekt().plaetze[2].typ], [rev, typ], 'the project did not change');
});

test('KernLage keeps the container state the core reports; a new core starts with every container on its player', async (t) => {
  const r = await liveAufbau(t);
  r.vomKern('/e/container/quelle', { container: 3, art: 2 });
  assert.deepEqual(r.s.lage.container, [1, 1, 2, 1]);
  r.vomKern('/k/willkommen', { generation: 1 });
  r.vomKern('/e/neustart', { generation: 2, sample: 0n });
  assert.deepEqual(r.s.lage.container, [1, 1, 1, 1]);
});

// ---- /lage on the real in-process server (pattern of reverb_pool_state.test.mjs) ----
const hol = (u, o = {}) => fetch(u, { ...o, headers: { connection: 'close', ...(o.headers ?? {}) } });
async function realerServer(t) {
  const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
  const bkOrdner = tmp('cq-graphen-');
  fs.mkdirSync(path.join(bkOrdner, 'samples'));
  const huellen = path.join(tmp('cq-huellen-'), 'huellen'); schreibeLeerenRing(huellen);
  const alt = { inst: process.env.CYPHERDJ_INSTANZ, bk: process.env.CYPHERDJ_BK_ORDNER };
  process.env.CYPHERDJ_INSTANZ = TEST_INSTANZ;
  process.env.CYPHERDJ_BK_ORDNER = bkOrdner;
  const o = new Oberflaeche({ port: 47360 + K, kernPort: 47160 + K, aboPort: 47210 + K, leitstandWs: 47260 + K, bestand: tmp('cq-bestand-'), arbeitsbestand: tmp('cq-ab-'),
    mutationen: [], loops: tmp('cq-loops-'), kits: tmp('cq-kits-'), welleCache: tmp('cq-welle-'), musterOrdner: tmp('cq-muster-'), hotcueOrdner: tmp('cq-hc-'),
    rasterOrdner: tmp('cq-raster-'), huellen, wirtOrdner: tmp('cq-wirt-'), sammlungen: tmp('cq-sets-'), musterBibliothek: tmp('cq-mb-'), musterSets: tmp('cq-ms-'),
    mediathek: path.join(tmp('cq-med-'), 'nix.sqlite'), katalog: path.join(tmp('cq-kat-'), 'nix.sqlite'), digitalout: path.join(tmp('cq-do-'), 'nix'),
    proj: { wurzel: path.join(tmp('cq-proj-'), 'projekte'), arbeitsordner: path.join(tmp('cq-arr-'), 'arr') },   // own project folder: the live container of the instance stays untouched
    kernPruefmodus: true, geraete: { konfigPfad: path.join(tmp('cq-ger-'), 'geraete.json'), kantenPfad: path.join(tmp('cq-ger-'), 'kanten'), cacheMs: 0, erkenne: async () => ({ audio: [], midi: [] }) },
    log: () => {} });
  await o.starte();
  t.after(async () => {
    await o.stoppe();
    if (alt.inst === undefined) delete process.env.CYPHERDJ_INSTANZ; else process.env.CYPHERDJ_INSTANZ = alt.inst;
    if (alt.bk === undefined) delete process.env.CYPHERDJ_BK_ORDNER; else process.env.CYPHERDJ_BK_ORDNER = alt.bk;
  });
  return { o, url: `http://127.0.0.1:${47360 + K}` };
}

test('GET /lage carries plaetze and container; without a live project plaetze is null', { timeout: 60000 }, async (t) => {
  const { o, url } = await realerServer(t);
  const lage = async () => (await hol(`${url}/lage`)).json();
  let l = await lage();
  assert.equal(l.plaetze, null, 'no project open');
  assert.deepEqual(l.container, [{ art: 'player' }, { art: 'player' }, { art: 'player' }, { art: 'player' }]);
  o.vomKern({ adresse: '/e/container/quelle', felder: { container: 3, art: 2 } });
  o.vomKern({ adresse: '/e/container/quelle', felder: { container: 4, art: 0 } });
  l = await lage();
  assert.deepEqual(l.container.map((c) => c.art), ['player', 'player', 'modul', 'leer']);
  assert.equal('platz_kanal' in l, false, 'the platz kanal report is gone');
});

test('GET /lage: a live project reports its four places', { timeout: 60000 }, async (t) => {
  const { o, url } = await realerServer(t);
  const lage = async () => (await hol(`${url}/lage`)).json();
  assert.equal((await o.proj.sitzung.liveOeffnen('andreas')).code, 200);
  let l = await lage();
  assert.equal(l.plaetze.length, 4);
  assert.deepEqual(l.plaetze.map((p) => p.typ), ['track', 'track', 'strudel', 'track']);
  assert.deepEqual(l.plaetze[2], { typ: 'strudel', gruppe: o.proj.sitzung.aktuell().j.projekt.plaetze[2].gruppe });
});
