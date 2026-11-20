// Kraken patch field task 4: GET /proj/steckfeld (the real server with the core stand-in) and the session send of the light pin command
// (a recording core context): /k/arr/stift fields, refusal and stale rev take accepted pins back, packets of REGLER_PAKET, pins after a core restart.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stapel } from './support/media_library.mjs';
import { ruf, anKern } from './support/proj_stack.mjs';
import { pruefKontext, sitzung, warteBis } from './support/proj_context.mjs';
import { REGLER_PAKET } from '../areas/proj/core_path.ts';
import { steckfeldSicht } from '../areas/proj/steckfeld.ts';

const NAMEN = Array.from({ length: 16 }, (_, i) => `n${i + 1}`);
const GRAPH = { format: 'baukasten/2', name: 'steck', stimmen: 1, knoten: [{ id: 'n', art: 'note' },
  { id: 'm', art: 'matrix', zeilen: NAMEN, spalten: NAMEN, stifte: [[0, 0, 0, 0.5], [1, 2, 3, -0.25]] }, { id: 'o', art: 'ausgang' }], kanten: [] };
const OHNE = { format: 'baukasten/2', name: 'ohne', stimmen: 1, knoten: [{ id: 'n', art: 'note' }, { id: 'o', art: 'ausgang' }], kanten: [] };
const fehlerVon = async (p) => { try { await p; } catch (e) { return e; } return null; };

// graph folder with the two graphs; CYPHERDJ_BK_ORDNER restored after the test
function graphen(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'steckfeld-graphen-'));
  fs.writeFileSync(path.join(dir, 'steck.json'), JSON.stringify(GRAPH));
  fs.writeFileSync(path.join(dir, 'ohne.json'), JSON.stringify(OHNE));
  fs.mkdirSync(path.join(dir, 'samples'));
  const alt = process.env.CYPHERDJ_BK_ORDNER;
  process.env.CYPHERDJ_BK_ORDNER = dir;
  t.after(() => { if (alt === undefined) delete process.env.CYPHERDJ_BK_ORDNER; else process.env.CYPHERDJ_BK_ORDNER = alt; fs.rmSync(dir, { recursive: true, force: true }); });
  return dir;
}
const bk = (graph, extra = {}) => ({ art: 'intern', name: 'bk', graph, parameter: {}, ...extra });
// a session with an open project holding the tracks s1 (graph steck), s2 (graph without matrix), s3 (audio)
async function mitSpuren(t, kontext = pruefKontext()) {
  graphen(t);
  const e = sitzung(t, { arrFristMs: 30 }, kontext);
  await e.s.neu('S', 'andreas');
  const r = await e.s.aendern({ rev: 0, label: 'tracks', befehle: [{ befehl: 'spur_neu', art: 'instrument' }, { befehl: 'spur_neu', art: 'instrument' }, { befehl: 'spur_neu', art: 'audio' },
    { befehl: 'spur_aendern', spur_id: 's1', geraet: bk('steck') }, { befehl: 'spur_aendern', spur_id: 's2', geraet: bk('ohne') }] }, 'andreas');
  assert.equal(r.code, 200);
  return { ...e, rev: r.j.rev };
}
const pin = (spurId, satz, zeile, spalte, wert) => ({ befehl: 'geraet_stift_setzen', spur_id: spurId, satz, zeile, spalte, wert });
const stifteVon = (s, id) => s.aktuell().j.projekt.spuren.find((x) => x.id === id).geraet.stifte;

test('steckfeldSicht: own list or the graph pins, copies, and the three refusals', () => {
  const lookup = (g) => (g === 'steck' ? { zeilen: NAMEN, spalten: NAMEN, stifte: [[0, 0, 0, 0.5]] } : null);
  const p = { rev: 4, spuren: [{ id: 's1', geraet: bk('steck') }, { id: 's2', geraet: bk('steck', { stifte: [[1, 1, 1, 1]] }) }, { id: 's3', geraet: bk('ohne') }, { id: 's4' }] };
  assert.deepEqual(steckfeldSicht(p, 's1', lookup), { spur_id: 's1', graph: 'steck', zeilen: NAMEN, spalten: NAMEN, stifte: [[0, 0, 0, 0.5]], eigene: false, rev: 4 });
  const s2 = steckfeldSicht(p, 's2', lookup);
  assert.deepEqual([s2.stifte, s2.eigene], [[[1, 1, 1, 1]], true]);
  s2.stifte[0][3] = 0; assert.equal(p.spuren[1].geraet.stifte[0][3], 1, 'the answer holds copies');
  for (const [id, code, grund] of [['s9', 404, 'spur_unbekannt'], ['s4', 409, 'geraet_falsch'], ['s3', 409, 'kein_steckfeld']]) {
    const e = (() => { try { steckfeldSicht(p, id, lookup); } catch (x) { return x; } })();
    assert.deepEqual([e?.code, e?.fehler], [code, grund], id);
  }
});

test('GET /proj/steckfeld in the real server: no project, unknown track, wrong device, no matrix, then the answer before and after a pin', async (t) => {
  graphen(t);
  const { url } = await stapel(t);
  const grund = async (q) => { const r = await ruf(url, 'GET', `/proj/steckfeld?${q}`); return [r.code, r.j.fehler]; };
  assert.deepEqual(await grund('spur_id=s1'), [409, 'kein_projekt']);
  const neu = await ruf(url, 'POST', '/proj/neu', { name: 'Steck' });
  assert.equal(neu.code, 200);
  const a = await ruf(url, 'POST', '/proj/aendern', { rev: neu.j.projekt?.rev ?? 0, label: 'tracks', befehle: [{ befehl: 'spur_neu', art: 'instrument' }, { befehl: 'spur_neu', art: 'instrument' },
    { befehl: 'spur_neu', art: 'audio' }, { befehl: 'spur_aendern', spur_id: 's1', geraet: bk('steck') }, { befehl: 'spur_aendern', spur_id: 's2', geraet: bk('ohne') }] });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.deepEqual(await grund('spur_id=s9'), [404, 'spur_unbekannt']);
  assert.deepEqual(await grund('spur_id=s3'), [409, 'geraet_falsch']);
  assert.deepEqual(await grund('spur_id=s2'), [409, 'kein_steckfeld']);
  assert.deepEqual(await grund(''), [400, 'argument_ungueltig']);
  const vor = await ruf(url, 'GET', '/proj/steckfeld?spur_id=s1');
  assert.equal(vor.code, 200);
  assert.deepEqual({ ...vor.j, rev: undefined }, { spur_id: 's1', graph: 'steck', zeilen: NAMEN, spalten: NAMEN, stifte: [[0, 0, 0, 0.5], [1, 2, 3, -0.25]], eigene: false, rev: undefined });
  const p = await ruf(url, 'POST', '/proj/aendern', { rev: a.j.rev, label: 'pin', befehle: [pin('s1', 0, 5, 5, 0.75)] });
  assert.equal(p.code, 200, JSON.stringify(p.j));
  const nach = await ruf(url, 'GET', '/proj/steckfeld?spur_id=s1');
  assert.deepEqual([nach.j.eigene, nach.j.stifte, nach.j.rev], [true, [[0, 0, 0, 0.5], [0, 5, 5, 0.75], [1, 2, 3, -0.25]], p.j.rev]);
});

test('a light pin: /k/arr/stift with track nr, set, row, column and value; the second pin sends no new playback and bumps the rev', async (t) => {
  const k = pruefKontext();
  const { s, rev } = await mitSpuren(t, k);
  const erste = await s.aendern({ rev, label: 'p1', befehle: [pin('s1', 0, 5, 5, 0.75)] }, 'andreas');   // general path: the defaults are written first
  assert.equal(erste.code, 200);
  assert.deepEqual(stifteVon(s, 's1'), [[0, 0, 0, 0.5], [0, 5, 5, 0.75], [1, 2, 3, -0.25]]);
  k.leere();
  const zweite = await s.aendern({ rev: erste.j.rev, label: 'p2', befehle: [pin('s1', 1, 4, 9, -0.5)] }, 'andreas');
  assert.equal(zweite.code, 200);
  assert.equal(zweite.j.rev, erste.j.rev + 1);
  assert.deepEqual(k.an('/k/arr/stift').map((x) => x.felder), [{ quelle: 'andreas', spur: 1, satz: 1, zeile: 4, spalte: 9, wert: -0.5 }]);
  assert.equal(k.an('/k/arr/laden').length, 0, 'a light pin loads no playback');
  assert.deepEqual(stifteVon(s, 's1').at(-1), [1, 4, 9, -0.5]);
});

test('a refused pin: 409 stift_abgelehnt, project and rev unchanged, accepted pins go back to their old values', async (t) => {
  const k = pruefKontext();
  const { s, rev } = await mitSpuren(t, k);
  const p1 = await s.aendern({ rev, label: 'p1', befehle: [pin('s1', 0, 5, 5, 0.75)] }, 'andreas');
  const vorher = JSON.stringify(stifteVon(s, 's1'));
  k.regel = (adresse, f) => (adresse === '/k/arr/stift' && f.zeile === 7 ? { status: 6, grund: 'ausserhalb_bereich' } : { status: 3, grund: '' });
  k.leere();
  const e = await fehlerVon(s.aendern({ rev: p1.j.rev, label: 'zwei', befehle: [pin('s1', 0, 5, 5, -1), pin('s1', 0, 7, 7, 1)] }, 'andreas'));
  assert.deepEqual([e.code, e.fehler], [409, 'stift_abgelehnt']);
  assert.equal(JSON.stringify(stifteVon(s, 's1')), vorher, 'project unchanged');
  assert.equal(s.aktuell().j.projekt.rev, p1.j.rev);
  const gesendet = k.an('/k/arr/stift').map((x) => [x.felder.zeile, x.felder.spalte, x.felder.wert]);
  assert.deepEqual(gesendet.slice(0, 2), [[5, 5, -1], [7, 7, 1]]);
  assert.deepEqual(gesendet.slice(2), [[5, 5, 0.75]], 'the accepted pin goes back to its old value');
});

test('a stale rev after the pins were sent takes them back to the open project values', async (t) => {
  const k = pruefKontext();
  const { s, rev } = await mitSpuren(t, k);
  const p1 = await s.aendern({ rev, label: 'p1', befehle: [pin('s1', 0, 5, 5, 0.75)] }, 'andreas');
  let frei = null; let halten = false;
  k.regel = (adresse) => (adresse === '/k/arr/stift' && halten ? new Promise((ok) => { frei = () => ok({ status: 3, grund: '' }); }) : { status: 3, grund: '' });
  halten = true; k.leere();
  const lauf = fehlerVon(s.aendern({ rev: p1.j.rev, label: 'langsam', befehle: [pin('s1', 0, 5, 5, -1)] }, 'andreas'));
  assert.ok(await warteBis(() => frei !== null), 'the pin waits for its receipt');
  halten = false;
  s.offen.projekt = { ...s.offen.projekt, rev: s.offen.projekt.rev + 1 };   // what uebernimm does synchronously while the change waits (the chain is serial otherwise)
  frei();
  const e = await lauf;
  assert.deepEqual([e?.code, e?.fehler], [409, 'rev_veraltet']);
  assert.deepEqual(k.an('/k/arr/stift').map((x) => x.felder.wert).slice(-1), [0.75], 'the open project value is sent back');
});

test(`150 light pins leave in packets of at most REGLER_PAKET (${REGLER_PAKET}) at a time`, async (t) => {
  let offen = 0, spitze = 0;
  const k = pruefKontext();
  const warte = k.warteQuittung;
  k.sende = ((alt) => (adresse, felder) => { const id = alt(adresse, felder); if (adresse === '/k/arr/stift') { offen++; spitze = Math.max(spitze, offen); } return id; })(k.sende);
  k.warteQuittung = async (id, ...r) => { const g = k.gesendet.find((x) => x.id === id); await new Promise((ok) => setImmediate(ok)); if (g.adresse === '/k/arr/stift') offen--; return warte(id, ...r); };
  const { s, rev } = await mitSpuren(t, k);
  const p1 = await s.aendern({ rev, label: 'p1', befehle: [pin('s1', 0, 15, 15, 1)] }, 'andreas');
  k.leere(); spitze = 0; offen = 0;
  const viele = Array.from({ length: 150 }, (_, i) => pin('s1', 1, Math.floor(i / 16), i % 16, 0.5));
  const r = await s.aendern({ rev: p1.j.rev, label: 'viele', befehle: viele }, 'andreas');
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(k.an('/k/arr/stift').length, 150);
  assert.ok(spitze > 1 && spitze <= REGLER_PAKET, `peak ${spitze}`);
});

test('after a core restart the pins of a light pin reach the new core in a freshly translated playback', async (t) => {
  const k = pruefKontext();
  const { s, arr, rev } = await mitSpuren(t, k);
  s.ereignis('/k/willkommen', { generation: 1 });
  const p1 = await s.aendern({ rev, label: 'p1', befehle: [pin('s1', 0, 5, 5, 0.75)] }, 'andreas');
  const p2 = await s.aendern({ rev: p1.j.rev, label: 'p2', befehle: [pin('s1', 1, 4, 9, -0.5)] }, 'andreas');
  assert.equal(p2.code, 200);
  const nrVor = s.aktuell().j.projekt.wiedergabe_rev;
  k.leere();
  s.ereignis('/e/neustart', { generation: 2 });
  assert.ok(await warteBis(() => k.an('/k/arr/laden').length > 0, 2000), 'the new core gets a playback');
  const nr = k.an('/k/arr/laden')[0].felder.nr;
  assert.ok(nr > nrVor, 'translated fresh, not the stored file');
  const w = JSON.parse(fs.readFileSync(path.join(arr, `wiedergabe-${nr}.json`), 'utf8'));
  const spur = JSON.stringify(w).includes('"stifte"') ? w : null;
  assert.ok(spur, 'the playback carries stifte');
  assert.match(JSON.stringify(w), /\[1,4,9,-0\.5\]/, 'with the light pin');
});
