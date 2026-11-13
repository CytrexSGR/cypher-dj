// DJ view places, plan task 7 (decision 10, spec correction c): the exception `eigenePad` of /regler (a box with only Cypher's own sound) ends
// while a module occupies the slot of that channel; otherwise Cypher could open a channel that now carries a module. Real page server on the
// test instance, the live container with a module in slot A. Slot B stays empty (the exception still works there).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Oberflaeche } from '../server.ts';
import { schreibeLeerenRing } from './support/ring.mjs';
import { K, TEST_INSTANZ, belegeTestInstanz } from './support/instance.mjs';
import { schreibeLebt } from '../../generator/src/pattern_state.mjs';
import { kanalOffen } from '../hand_operation.ts';

belegeTestInstanz();
const hol = (u, o = {}) => fetch(u, { ...o, headers: { connection: 'close', ...(o.headers ?? {}) } });
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const bis = async (f, ms = 3000) => { for (let i = 0; i < ms / 20 && !(await f()); i++) await warte(20); return f(); };
const INST = { format: 'baukasten/2', name: 'inst', stimmen: 1, regler_namen: { 1: 'Rate' }, knoten: [{ id: 'n', art: 'note' }, { id: 'o', art: 'ausgang' }], kanten: [] };

async function stapel(t) {
  const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
  const bk = tmp('kofen-bk-'); fs.writeFileSync(path.join(bk, 'inst.json'), JSON.stringify(INST)); fs.mkdirSync(path.join(bk, 'samples'));
  const huellen = path.join(tmp('kofen-huellen-'), 'huellen'); schreibeLeerenRing(huellen);
  const log = [];
  const alt = { inst: process.env.CYPHERDJ_INSTANZ, bk: process.env.CYPHERDJ_BK_ORDNER };
  process.env.CYPHERDJ_INSTANZ = TEST_INSTANZ;
  process.env.CYPHERDJ_BK_ORDNER = bk;
  const muster = tmp('kofen-muster-');
  const o = new Oberflaeche({ port: 47300 + K, kernPort: 47100 + K, aboPort: 47150 + K, leitstandWs: 47200 + K, bestand: tmp('kofen-bestand-'), arbeitsbestand: tmp('kofen-ab-'),
    mutationen: [], loops: tmp('kofen-loops-'), kits: tmp('kofen-kits-'), welleCache: tmp('kofen-welle-'), musterOrdner: muster, hotcueOrdner: tmp('kofen-hc-'),
    rasterOrdner: tmp('kofen-raster-'), huellen, wirtOrdner: tmp('kofen-wirt-'), sammlungen: tmp('kofen-sets-'), musterBibliothek: tmp('kofen-mb-'), musterSets: tmp('kofen-ms-'),
    mediathek: path.join(tmp('kofen-med-'), 'nix.sqlite'), katalog: path.join(tmp('kofen-kat-'), 'nix.sqlite'), digitalout: path.join(tmp('kofen-do-'), 'nix'),
    proj: { wurzel: path.join(tmp('kofen-proj-'), 'projekte'), arbeitsordner: path.join(tmp('kofen-arr-'), 'arr') },   // own project folder: the live container of the instance stays untouched
    kernPruefmodus: true, geraete: { konfigPfad: path.join(tmp('kofen-ger-'), 'geraete.json'), kantenPfad: path.join(tmp('kofen-ger-'), 'kanten'), cacheMs: 0, erkenne: async () => ({ audio: [], midi: [] }) },
    log: (z) => log.push(z) });
  await o.starte();
  t.after(async () => {
    await o.stoppe();
    if (alt.inst === undefined) delete process.env.CYPHERDJ_INSTANZ; else process.env.CYPHERDJ_INSTANZ = alt.inst;
    if (alt.bk === undefined) delete process.env.CYPHERDJ_BK_ORDNER; else process.env.CYPHERDJ_BK_ORDNER = alt.bk;
  });
  const url = `http://127.0.0.1:${47300 + K}`;
  const post = (pfad, daten, kopf = {}) => hol(`${url}${pfad}`, { method: 'POST', headers: { 'content-type': 'application/json', ...kopf }, body: JSON.stringify(daten) }).then(async (r) => ({ code: r.status, j: await r.json() }));
  return { o, url, log, muster, post };
}

test('pure rule: PFL is not part of kanalOffen; only trim + fader above -26 dB opens a channel', () => {
  assert.equal(kanalOffen({ 'pad/1/trim': 0, 'pad/1/fader': -200, 'pad/1/pfl': 1 }, 'pad/1'), false);
  assert.equal(kanalOffen({ 'pad/1/trim': 0, 'pad/1/fader': -26 }, 'pad/1'), false);
  assert.equal(kanalOffen({ 'pad/1/trim': 0, 'pad/1/fader': -25.9 }, 'pad/1'), true);
});

test('eigenePad ends while a module occupies the slot: pad/1/fader stays kein_hoerschein with a graph on the box; pad/2 (empty slot) still opens', async (t) => {
  const { o, url, log, muster, post } = await stapel(t);
  const cypher = { 'x-djk-quelle': 'cypher' };
  const teile = () => log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/teil' && /^pad\//.test(z.felder.pfad));
  const regler = (pfad) => post('/regler', { pfad, nach: -6, takte: 0 }, cypher);
  // an instrument graph on pad/1 and pad/2 (live streams 9 and 10): Cypher's own sound, the old exception
  for (const strom of [9, 10]) { fs.mkdirSync(`${muster}${strom}`, { recursive: true }); schreibeLebt(`${muster}${strom}`, { strom, ziel: 'x' }, Date.now()); }
  const sendungen = () => log.filter((z) => z.typ === 'an_kern' && (z.adresse === '/erz/strom' || z.adresse === '/k/kanal/graph'));
  for (const kanal of ['pad/1', 'pad/2']) {
    const n0 = sendungen().length;
    const p = post('/graph', { kanal, name: 'inst' }, cypher);
    assert.ok(await bis(() => sendungen().length > n0), 'the graph command reaches the kern');
    const s = sendungen().at(-1);
    o.vomKern({ adresse: '/q', felder: { id: s.felder.id, quelle: s.felder.quelle, status: 1, ist_sample: 0, ist_beat: 0, grund: '' } });
    o.vomKern({ adresse: '/q', felder: { id: s.felder.id, quelle: s.felder.quelle, status: 3, ist_sample: 0, ist_beat: 0, grund: '' } });
    assert.equal((await p).code, 200);
  }
  // slot A holds a module (a bare module group is enough for the rule)
  assert.equal((await post('/live/oeffnen', {})).code, 200);
  const rev = () => hol(`${url}/proj/aktuell`).then((r) => r.json()).then((j) => j.projekt.rev);
  const a = await post('/proj/aendern', { rev: await rev(), label: 'group', befehle: [{ befehl: 'gruppenspur_neu', name: 'A · T' }] });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  const gid = a.j.projekt?.gruppen?.[0]?.id ?? (await hol(`${url}/proj/aktuell`).then((r) => r.json())).projekt.gruppen[0].id;
  const m = await post('/proj/aendern', { rev: await rev(), label: 'module', befehle: [{ befehl: 'modul_setzen', gruppe_id: gid,
    modul: { quelle_sha256: 'c'.repeat(64), titel: 'T', fassung: 'f1', basis_bpm: 124, von_beat: 0, laenge_beats: 16, bpm: 124, datum: '2026-11-13', slot: 'A' } }] });
  assert.equal(m.code, 200, JSON.stringify(m.j));
  const n0 = teile().length;
  let r = await regler('pad/1/fader');
  assert.deepEqual([r.code, r.j.fehler], [409, 'kein_hoerschein'], 'a module occupies slot A: Cypher cannot open pad/1');
  assert.equal(teile().length, n0, 'nothing was sent to the kern');
  // slot B is empty: the exception of the own graph still works
  const p = regler('pad/2/fader');
  assert.ok(await bis(() => teile().length === n0 + 1), 'pad/2 opens for Cypher with its own graph');
  const s = teile().at(-1);
  o.vomKern({ adresse: '/q', felder: { id: s.felder.id, quelle: s.felder.quelle, status: 2, ist_sample: 0, ist_beat: 0, grund: '' } });
  assert.equal((await p).code, 200);
});

// Fix round 1, finding 2: a planned or running ramp of Cypher on pad/N counts as open for the module gate
test('a planned ramp of Cypher on pad/2 makes the channel open for the module gate (modul_setzen through /proj/aendern is kanal_offen); without it the same call goes through', async (t) => {
  const { o, url, log, post } = await stapel(t);
  const cypher = { 'x-djk-quelle': 'cypher' };
  assert.equal((await post('/live/oeffnen', {})).code, 200);
  const rev = () => hol(`${url}/proj/aktuell`).then((r) => r.json()).then((j) => j.projekt.rev);
  const alle = () => hol(`${url}/proj/aktuell`).then((r) => r.json()).then((j) => j.projekt.gruppen);
  assert.equal((await post('/proj/aendern', { rev: await rev(), label: 'groups', befehle: [{ befehl: 'gruppenspur_neu', name: 'G1' }, { befehl: 'gruppenspur_neu', name: 'G2' }] })).code, 200);
  const [g1, g2] = (await alle()).map((g) => g.id);
  const modul = (slot) => ({ quelle_sha256: 'c'.repeat(64), titel: 'T', fassung: 'f1', basis_bpm: 124, von_beat: 0, laenge_beats: 16, bpm: 124, datum: '2026-11-13', slot });
  const setze = async (id, slot) => post('/proj/aendern', { rev: await rev(), label: 'm', befehle: [{ befehl: 'modul_setzen', gruppe_id: id, modul: modul(slot) }] }, cypher);
  assert.equal(o.kanalGeoeffnet('pad/2'), false, 'nothing planned: closed');
  // Cypher plans a ramp on pad/2 (a move that stays closed: -40 dB); it is planned until its beat has passed
  const teile = () => log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/teil' && z.felder.pfad === 'pad/2/fader');
  const p = post('/regler', { pfad: 'pad/2/fader', nach: -40, takte: 8, ab: 'phrase' }, cypher);
  assert.ok(await bis(() => teile().length === 1), 'the ramp reaches the kern');
  assert.equal(o.kanalGeoeffnet('pad/2'), true, 'a planned or running ramp counts as open');
  const e = await setze(g2, 'B');
  assert.deepEqual([e.code, e.j.fehler], [409, 'kanal_offen'], JSON.stringify(e.j));
  assert.equal((await setze(g1, 'A')).code, 200, 'slot A has no ramp: accepted');
  const s = teile()[0];
  o.vomKern({ adresse: '/q', felder: { id: s.felder.id, quelle: s.felder.quelle, status: 2, ist_sample: 0, ist_beat: 0, grund: '' } });
  await p;
});
