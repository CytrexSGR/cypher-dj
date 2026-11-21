// A real in-process page server on the test instance with its OWN project folders, so the live container of the instance and the real live project
// stay untouched (pattern of container_source.test.mjs). Used by the container core route tests.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Oberflaeche } from '../../server.ts';
import { schreibeLeerenRing } from './ring.mjs';
import { K, TEST_INSTANZ } from './instance.mjs';

export const hol = (u, o = {}) => fetch(u, { ...o, headers: { connection: 'close', ...(o.headers ?? {}) } });

export async function echterServer(t, praefix = 'es', versatz = 0) {
  const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `${praefix}-${p}-`));
  const bkOrdner = tmp('graphen');
  fs.mkdirSync(path.join(bkOrdner, 'samples'));
  const huellen = path.join(tmp('huellen'), 'huellen'); schreibeLeerenRing(huellen);
  const alt = { inst: process.env.CYPHERDJ_INSTANZ, bk: process.env.CYPHERDJ_BK_ORDNER };
  process.env.CYPHERDJ_INSTANZ = TEST_INSTANZ;
  process.env.CYPHERDJ_BK_ORDNER = bkOrdner;
  const muster = tmp('muster');
  const log = [];   // every log line of the server (an_kern lines carry the sent OSC address and fields)
  const port = 47360 + K + versatz;
  const o = new Oberflaeche({ port, kernPort: 47160 + K + versatz, aboPort: 47210 + K + versatz, leitstandWs: 47260 + K + versatz, bestand: tmp('bestand'), arbeitsbestand: tmp('ab'),
    mutationen: [], loops: tmp('loops'), kits: tmp('kits'), welleCache: tmp('welle'), musterOrdner: muster, hotcueOrdner: tmp('hc'),
    rasterOrdner: tmp('raster'), huellen, wirtOrdner: tmp('wirt'), sammlungen: tmp('sets'), musterBibliothek: tmp('mb'), musterSets: tmp('ms'),
    mediathek: path.join(tmp('med'), 'nix.sqlite'), katalog: path.join(tmp('kat'), 'nix.sqlite'), digitalout: path.join(tmp('do'), 'nix'),
    proj: { wurzel: path.join(tmp('proj'), 'projekte'), arbeitsordner: path.join(tmp('arr'), 'arr') },
    kernPruefmodus: true, geraete: { konfigPfad: path.join(tmp('ger'), 'geraete.json'), kantenPfad: path.join(tmp('ger'), 'kanten'), cacheMs: 0, erkenne: async () => ({ audio: [], midi: [] }) },
    log: (z) => log.push(z) });
  await o.starte();
  t.after(async () => {
    await o.stoppe();
    if (alt.inst === undefined) delete process.env.CYPHERDJ_INSTANZ; else process.env.CYPHERDJ_INSTANZ = alt.inst;
    if (alt.bk === undefined) delete process.env.CYPHERDJ_BK_ORDNER; else process.env.CYPHERDJ_BK_ORDNER = alt.bk;
  });
  const url = `http://127.0.0.1:${port}`;
  const post = (pfad, daten, kopf = {}) => hol(`${url}${pfad}`, { method: 'POST', headers: { 'content-type': 'application/json', ...kopf }, body: JSON.stringify(daten) })
    .then(async (r) => ({ code: r.status, j: await r.json() }));
  const lage = async () => (await hol(`${url}/lage`)).json();
  const projekt = () => o.proj.zugang.offen()?.projekt;
  return { o, url, muster, post, lage, projekt, log };
}
