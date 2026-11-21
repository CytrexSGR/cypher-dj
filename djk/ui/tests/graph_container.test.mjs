// Container core M9: instrument graphs run on the stream (/erz/strom without a channel, knob rows strom/<n>/bk/<k>), effect graphs on erz/<n> become a bk
// insert on the strom track of the strudel module. Real in-process page server on its own project folders; the core is a log that acknowledges every
// message (pattern of controls_alias_route.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { echterServer } from './support/echter_server.mjs';
import { belegeTestInstanz } from './support/instance.mjs';
import { schreibeLebt, setzeAutonom, schreibeStatus } from '../../generator/src/pattern_state.mjs';
import { stromSpur } from '../project/model.ts';

belegeTestInstanz();
const CYPHER = { 'x-djk-quelle': 'cypher' };
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const bis = async (f, ms = 3000) => { for (let i = 0; i < ms / 20 && !(await f()); i++) await warte(20); return f(); };
const INST = { format: 'baukasten/2', name: 'inst', stimmen: 1, regler_namen: { 1: 'Rate', 3: 'Tone' }, knoten: [
  { id: 'n', art: 'note' }, { id: 'a', art: 'regler', nr: 1, min: 0, max: 1, vorgabe: 0.25 }, { id: 'b', art: 'regler', nr: 3, min: 0, max: 1, vorgabe: 0.75 }, { id: 'o', art: 'ausgang' }], kanten: [] };
const EFF = { format: 'baukasten/2', name: 'eff', stimmen: 1, knoten: [{ id: 'e', art: 'eingang' }, { id: 'o', art: 'ausgang' }], kanten: [] };
const EFF2 = { ...EFF, name: 'eff2' };

const LADEN = new Set(['/erz/strom', '/k/kanal/graph']);
const meldungen = (s) => s.log.filter((z) => z.typ === 'an_kern' && (LADEN.has(z.adresse) || z.adresse === '/k/teil'));
const ladungen = (s) => meldungen(s).filter((z) => LADEN.has(z.adresse));
const ack = (o, f, status) => o.vomKern({ adresse: '/q', felder: { id: f.id, quelle: f.quelle, status, ist_sample: 0, ist_beat: 0, grund: '' } });

// live project (strudel module at place 3), graphs written into the graph folder, a core that acknowledges every message right away
async function aufbau(t, versatz, { modul = true, spuren = [] } = {}) {
  const s = await echterServer(t, 'gc', versatz);
  const dir = process.env.CYPHERDJ_BK_ORDNER;
  for (const [n, g] of [['inst', INST], ['eff', EFF], ['eff2', EFF2]]) fs.writeFileSync(path.join(dir, `${n}.json`), JSON.stringify(g));
  Object.defineProperty(s.o.kern, 'zustand', { get: () => 'verbunden', configurable: true });
  const orig = s.o.kern.sende.bind(s.o.kern);
  s.o.kern.sende = (adresse, f) => {
    const r = orig(adresse, f);
    if (adresse === '/k/teil' || LADEN.has(adresse)) setTimeout(() => { for (const st of [1, 3]) ack(s.o, f, st); }, 5);
    return r;
  };
  // the heartbeat of the multi-stream erzeuger is only fresh for 6 s: every graph call renews it first
  const lebt = () => { for (const n of [5, 6, 9, 10]) { fs.mkdirSync(`${s.muster}${n}`, { recursive: true }); schreibeLebt(`${s.muster}${n}`, { strom: n, ziel: 'x' }); } };
  lebt();
  s.lebt = lebt;
  assert.equal((await s.post('/live/oeffnen', {})).code, 200);
  if (!modul) await aendere(s, [{ befehl: 'platz_setzen', platz: 3, typ: 'leer' }]);
  for (const n of spuren) await aendere(s, [{ befehl: 'strom_spur_neu', strom: n }]);
  s.log.length = 0;
  s.graph = (daten, kopf = {}) => { lebt(); return s.post('/graph', daten, kopf); };
  return s;
}
async function aendere(s, befehle) {
  const r = await s.o.proj.sitzung.aendern({ rev: s.projekt().rev, label: 'test', befehle }, 'andreas');
  assert.equal(r.code, 200, JSON.stringify(r.j));
}
const bkInsert = (s, n) => (stromSpur(s.projekt(), n)?.inserts ?? []).find((i) => i.art === 'bk');

test('instrument graph on erz/5 sends /erz/strom with strom 5 and without kanal', async (t) => {
  const s = await aufbau(t, 1);
  const r = await s.graph({ kanal: 'erz/5', name: 'inst' });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const l = ladungen(s);
  assert.equal(l.length, 1);
  assert.equal(l[0].adresse, '/erz/strom');
  assert.deepEqual({ ...l[0].felder, id: 0 }, { id: 0, quelle: 'andreas', strom: 5, ziel: 'bk:inst' });
  assert.equal('kanal' in l[0].felder, false);
  assert.equal(r.j.hinweis, 'kein_strudel_modul', 'no strom track reads stream 5: the answer says so (a hint, not a refusal)');
});

test('the instrument hint is absent once a strom track reads the stream', async (t) => {
  const s = await aufbau(t, 2, { spuren: [5] });
  const r = await s.graph({ kanal: 'erz/5', name: 'inst' });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal('hinweis' in r.j, false);
});

test('the knob defaults are written to strom/5/bk/<k>', async (t) => {
  const s = await aufbau(t, 3);
  const r = await s.graph({ kanal: 'erz/5', name: 'inst' });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const zeilen = Object.fromEntries(meldungen(s).filter((z) => z.adresse === '/k/teil').map((z) => [z.felder.pfad, z.felder.nach]));
  assert.deepEqual(zeilen, { 'strom/5/bk/1': 0.25, 'strom/5/bk/3': 0.75 });
});

test('instrument graph on pad/1 is 400 ausserhalb_bereich (was valid); deck/3 is 400 ausserhalb_bereich', async (t) => {
  const s = await aufbau(t, 4);
  for (const [kanal, name] of [['pad/1', 'inst'], ['pad/2', 'inst'], ['deck/3', 'eff'], ['deck/4', 'eff']]) {
    const r = await s.graph({ kanal, name });
    assert.deepEqual([r.code, r.j.fehler], [400, 'ausserhalb_bereich'], kanal);
  }
  assert.equal(meldungen(s).length, 0, 'nothing reached the core');
});

test('effect graph on erz/2 becomes a bk insert on the strom track (project step, undo removes it); nothing goes to the core', async (t) => {
  const s = await aufbau(t, 5);
  const rev0 = s.projekt().rev;
  const r = await s.graph({ kanal: 'erz/2', name: 'eff' });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const i = bkInsert(s, 2);
  assert.equal(i?.graph, 'eff', 'the strom track of stream 2 was created and carries the insert');
  assert.equal(ladungen(s).length, 0, 'no /k/kanal/graph and no /erz/strom: the insert is a project edit');
  assert.equal(r.j.insert_id, i.id);
  const u = await s.post('/proj/undo', { rev: s.projekt().rev });
  assert.equal(u.code, 200, JSON.stringify(u.j));
  assert.equal(bkInsert(s, 2), undefined, 'undo removes the insert');
  assert.ok(s.projekt().rev > rev0);
  // removal: name '' removes the insert as one step
  assert.equal((await s.graph({ kanal: 'erz/2', name: 'eff' })).code, 200);
  const w = await s.graph({ kanal: 'erz/2', name: '' });
  assert.deepEqual([w.code, w.j.entfernt], [200, true], JSON.stringify(w.j));
  assert.equal(bkInsert(s, 2), undefined);
  const nochmal = await s.graph({ kanal: 'erz/2', name: '' });
  assert.equal(nochmal.code, 200);
  assert.notEqual(nochmal.j.entfernt, true, 'removing what is not there is a no-op');
  // loading another effect replaces the insert instead of stacking a second one
  await s.graph({ kanal: 'erz/2', name: 'eff' });
  await s.graph({ kanal: 'erz/2', name: 'eff2' });
  assert.deepEqual((stromSpur(s.projekt(), 2).inserts ?? []).filter((x) => x.art === 'bk').map((x) => x.graph), ['eff2']);
});

test('effect graph on erz/2 without a strudel module: 409 kein_strudel_modul, project and core untouched', async (t) => {
  const s = await aufbau(t, 6, { modul: false });
  const rev0 = s.projekt().rev;
  const r = await s.graph({ kanal: 'erz/2', name: 'eff' });
  assert.deepEqual([r.code, r.j.fehler], [409, 'kein_strudel_modul'], JSON.stringify(r.j));
  assert.equal(s.projekt().rev, rev0);
  assert.equal(meldungen(s).length, 0);
});

test('one graph per stream: an effect on a stream with an instrument graph is 409 belegt, and the reverse', async (t) => {
  const s = await aufbau(t, 7, { spuren: [3] });
  assert.equal((await s.graph({ kanal: 'erz/3', name: 'inst' })).code, 200);
  let r = await s.graph({ kanal: 'erz/3', name: 'eff' });
  assert.deepEqual([r.code, r.j.fehler], [409, 'belegt'], JSON.stringify(r.j));
  assert.equal(bkInsert(s, 3), undefined);
  assert.equal((await s.graph({ kanal: 'erz/3', name: '' })).code, 200, 'take the instrument off');
  assert.equal((await s.graph({ kanal: 'erz/3', name: 'eff' })).code, 200);
  r = await s.graph({ kanal: 'erz/3', name: 'inst' });
  assert.deepEqual([r.code, r.j.fehler], [409, 'belegt'], 'the insert holds the stream now');
});

test('effect graph on deck/2 and pad/2 still goes to /k/kanal/graph', async (t) => {
  const s = await aufbau(t, 8);
  for (const kanal of ['deck/2', 'pad/2']) {
    const r = await s.graph({ kanal, name: 'eff' });
    assert.equal(r.code, 200, JSON.stringify(r.j));
    const l = ladungen(s).at(-1);
    assert.equal(l.adresse, '/k/kanal/graph');
    assert.deepEqual({ ...l.felder, id: 0 }, { id: 0, quelle: 'andreas', kanal, name: 'eff' });
  }
});

test('kein_midi_strom for an instrument graph on erz/1 keeps its text; auto_aus and kein_erzeuger are unchanged', async (t) => {
  const s = await aufbau(t, 9);
  let r = await s.graph({ kanal: 'erz/1', name: 'inst' });
  assert.deepEqual([r.code, r.j.fehler], [400, 'kein_midi_strom']);
  assert.match(r.j.text, /^stream 1 runs a drum kit: its notes are kit indices, an instrument graph would get them as MIDI notes$/);
  setzeAutonom(`${s.muster}6`, false);
  r = await s.graph({ kanal: 'erz/6', name: 'inst' }, CYPHER);
  assert.deepEqual([r.code, r.j.fehler, r.j.strom], [409, 'auto_aus', 6]);
  fs.rmSync(`${s.muster}5/lebt.json`);
  r = await s.post('/graph', { kanal: 'erz/5', name: 'inst' });
  assert.deepEqual([r.code, r.j.fehler, r.j.strom], [409, 'kein_erzeuger', 5]);
  assert.equal(ladungen(s).length, 0);
  fs.mkdirSync(`${s.muster}3`, { recursive: true });
  schreibeStatus(`${s.muster}3`, { nr: 1, noten: 'kit' });
  r = await s.graph({ kanal: 'erz/3', name: 'inst' }, CYPHER);
  assert.deepEqual([r.code, r.j.fehler], [400, 'kein_midi_strom'], 'the kit-mode check of a stream stays');
});

test('restore after a core restart replays instrument graphs on streams and container-strip effects but not strom-track inserts', async (t) => {
  const s = await aufbau(t, 10, { spuren: [2] });
  const neustart = (generation) => s.o.vomKern({ adresse: '/e/neustart', felder: { generation, sample: 0 } });
  neustart(1);
  assert.equal((await s.graph({ kanal: 'erz/5', name: 'inst' })).code, 200);
  assert.equal((await s.graph({ kanal: 'deck/2', name: 'eff' })).code, 200);
  assert.equal((await s.graph({ kanal: 'erz/2', name: 'eff' })).code, 200);
  assert.equal(bkInsert(s, 2)?.graph, 'eff');
  const n0 = ladungen(s).length;
  s.lebt();   // the 6 s heartbeat of the erzeuger of stream 5 must be fresh when the replay runs
  neustart(2);
  assert.ok(await bis(() => ladungen(s).length >= n0 + 2, 5000), 'both replays arrive');
  await warte(700);
  const neu = ladungen(s).slice(n0).map((z) => [z.adresse, z.adresse === '/erz/strom' ? z.felder.ziel : z.felder.name]).sort();
  assert.deepEqual(neu, [['/erz/strom', 'bk:inst'], ['/k/kanal/graph', 'eff']], 'the strom-track insert is not replayed: the project translator carries it');
  assert.equal(bkInsert(s, 2)?.graph, 'eff', 'the insert is still in the project');
});

test('alias erz/5/bk/3 resolves to strom/5/bk/3 for the instrument graph', async (t) => {
  const s = await aufbau(t, 11, { spuren: [5] });
  assert.equal((await s.graph({ kanal: 'erz/5', name: 'inst' })).code, 200);
  s.log.length = 0;
  const r = await s.post('/regler', { pfad: 'erz/5/bk/3', nach: 0.4 }, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const teil = s.log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/teil').at(-1);
  assert.equal(teil?.felder.pfad, 'strom/5/bk/3');
});
