// Strand 11 slice 5 (5.2): POST /szene, live scenes (files in <project folder>/szenen/, not the launcher scenes of project.json).
// Real in-process page server (core is a log, clock set by hand) and a fake wirt socket for the Surge patch.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { echterServer } from './support/echter_server.mjs';
import { belegeTestInstanz } from './support/instance.mjs';
import { pruefeWirtOrdner } from './support/instrument_host_sock.mjs';
import { planeLaden, reglerFuerSzene } from '../szene.ts';

belegeTestInstanz();
const CYPHER = { 'x-djk-quelle': 'cypher' };
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const bis = async (f, ms = 6000) => { for (let i = 0; i < ms / 20 && !(await f()); i++) await warte(20); return f(); };

// fake Surge host: answers zustand with the patch it holds; records every command
async function fakeWirt(t, ordner, gruppe, stand) {
  pruefeWirtOrdner(ordner);
  const zeilen = [];
  const srv = net.createServer((c) => {
    let d = '';
    c.on('data', (b) => {
      d += b;
      if (!d.endsWith('\n')) return;
      const z = JSON.parse(d); zeilen.push(z);
      const antwort = z.befehl === 'zustand' ? { ok: true, xml: '<x/>', patch_b64: stand.patch } : { ok: true };
      if (!c.destroyed) c.end(JSON.stringify(antwort) + '\n');
    });
    c.on('error', () => {});
  });
  await new Promise((ok) => srv.listen(path.join(ordner, `wirt-${gruppe}.sock`), ok));
  t.after(() => srv.close());
  return zeilen;
}

test('reglerFuerSzene drops trim_auto, project rows, cue/pegel and transport; planeLaden ramps continuous rows only, never writes pfl or kill rows', () => {
  const r = reglerFuerSzene({ 'deck/1/fader': -3, 'deck/1/trim_auto': 1, 'spur/1/fader': 0, 'cue/pegel': -12, 'deck/1/transport': 1, 'deck/1/kill/tief': 1 },
    (p) => p.startsWith('spur/'));
  assert.deepEqual(r, { 'deck/1/fader': -3, 'deck/1/kill/tief': 1 });
  const s = { v: 1, takt: 1, muster: { 2: 'a', 3: 'b' }, regler: r, graphen: {} };
  s.regler = { ...r, 'deck/1/pfl': 1, 'deck/2/an': 1 };
  const p = planeLaden(s, { muster: { 2: 'a', 3: 'x' }, regler: { 'deck/1/fader': -10, 'deck/1/kill/tief': 0, 'deck/1/pfl': 0 }, graphen: { 'fx/3': 'g' } }, 4, (x) => x.endsWith('/an'));
  assert.deepEqual(p.muster, [{ strom: 3, text: 'b', versatz: 0 }]);
  assert.deepEqual(p.regler, [{ ziel: 'deck/1/fader', ab_takt: 1, takte: 4, nach: -3 }, { ziel: 'deck/2/an', ab_takt: 1, nach: 1 }]);
  assert.deepEqual(p.graphen, [{ kanal: 'fx/3', name: '' }]);
});

test('szene: save, change two patterns, a fader and the Surge patch, laden restores them as one Cypher track; versatz lands in strom<n>.von.json', async (t) => {
  const s = await echterServer(t, 'sz', 7);
  s.o.kern.uhr = { beat: 16, bpm: 128, mono_ns: 0 };   // bar 5
  assert.equal((await s.post('/live/oeffnen', {})).code, 200);
  const surge = { patch: 'QUFB' };
  const zeilen = await fakeWirt(t, s.o.opt.wirtOrdner, 'bass', surge);
  for (const [strom, text] of [[2, 'note("c2")'], [3, 'note("e3")']]) {
    const r = await s.post('/strudel', { strom, text });
    assert.equal(r.code, 200, JSON.stringify(r.j));
  }
  s.o.stand.regler['deck/1/fader'] = -10;
  s.o.stand.regler['master/pegel'] = -3;
  let r = await s.post('/szene', { aktion: 'sichern', name: 'a' }, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual([r.j.takt, r.j.muster, r.j.klang], [5, [2, 3], ['bass']]);
  r = await s.post('/szene', { aktion: 'sichern', name: 'a' }, CYPHER);
  assert.deepEqual([r.code, r.j.fehler], [409, 'szene_vorhanden']);
  assert.equal((await s.post('/szene', { aktion: 'ersetzen', name: 'a' }, CYPHER)).code, 200, 'ersetzen replaces');
  // change two patterns, a fader, the master level (a raise of 17 dB back would need a ramp) and the Surge patch
  for (const [strom, text] of [[2, 'note("d2")'], [3, 'note("f3")']]) assert.equal((await s.post('/strudel', { strom, text })).code, 200);
  s.o.stand.regler['deck/1/fader'] = -3;
  s.o.stand.regler['master/pegel'] = -20;
  surge.patch = 'QkJC';
  s.o.kern.uhr = { beat: 40, bpm: 128, mono_ns: 0 };   // bar 11
  s.log.length = 0;
  zeilen.length = 0;
  r = await s.post('/szene', { aktion: 'laden', name: 'a' }, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const anker = r.j.anker_takt;
  assert.ok(anker >= 11, String(anker));
  assert.deepEqual(r.j.muster, [2, 3]);
  assert.ok(r.j.regler.includes('deck/1/fader'), JSON.stringify(r.j));
  assert.ok(r.j.ausgelassen.some((x) => x.ziel === 'master/pegel' && x.grund === 'nur_rampe'), JSON.stringify(r.j.ausgelassen));
  assert.deepEqual(r.j.klang, ['bass']);
  const lauf = s.o.spuren.get('szene-a');
  assert.ok(lauf, 'internal track runs');
  assert.equal(lauf.quelle, 'cypher');
  const stroeme = lauf.fahrten.filter((f) => f.ziel.startsWith('strom:'));
  assert.deepEqual(stroeme.map((f) => [f.ziel, f.muster]), [['strom:2', 'note("c2")'], ['strom:3', 'note("e3")']]);
  const teil = s.log.find((z) => z.typ === 'an_kern' && z.adresse === '/k/teil' && z.felder?.plan === 'spur:szene-a' && z.felder?.pfad === 'deck/1/fader');
  assert.ok(teil, JSON.stringify(s.log.filter((z) => z.adresse === '/k/teil')));
  assert.equal(teil.felder.nach, -10);
  const setze = zeilen.filter((z) => z.befehl === 'setze');
  assert.equal(setze.length, 1, JSON.stringify(zeilen));
  assert.deepEqual([setze[0].patch_b64, setze[0].spur], ['QUFB', 'szene-a']);
  const ordner = s.o.proj.zugang.offen().ordner;
  assert.ok(fs.existsSync(path.join(ordner, 'szenen', '_vor_laden.json')), '_vor_laden saved first');
  // the pattern timer writes the stored text with versatz = anker_takt - takt at save
  s.o.kern.uhr = { beat: 4 * (anker - 1) - 2, bpm: 128, mono_ns: 0 };
  assert.ok(await bis(() => s.log.filter((z) => z.typ === 'spur_muster').length >= 2), 'pattern moves fired');
  for (const z of s.log.filter((x) => x.typ === 'spur_muster')) assert.equal(z.code, 200, JSON.stringify(z));
  const von = JSON.parse(fs.readFileSync(path.join(s.muster + '2', 'strom1.von.json'), 'utf8'));
  assert.equal(von.versatz, anker - 5);
  assert.equal(fs.readFileSync(path.join(s.muster + '2', 'strom1.js'), 'utf8').includes('note("c2")'), true);
  // liste, zeige, loeschen, unknown name
  const liste = (await s.post('/szene', { aktion: 'liste' }, CYPHER)).j.szenen.map((x) => x.name);
  assert.deepEqual(liste, ['_vor_laden', 'a']);
  const zeige = (await s.post('/szene', { aktion: 'zeige', name: 'a' }, CYPHER)).j.szene;
  assert.equal(zeige.muster['2'], 'note("c2")');
  assert.deepEqual(zeige.klang.bass, { art: 'surge', patch_bytes: 3 }, 'zeige leaves the patch out, shows its length');
  assert.equal((await s.post('/szene', { aktion: 'loeschen', name: 'a' }, CYPHER)).code, 200);
  assert.ok(!fs.existsSync(path.join(ordner, 'szenen', 'a.json')));
  r = await s.post('/szene', { aktion: 'laden', name: 'a' }, CYPHER);
  assert.deepEqual([r.code, r.j.fehler], [404, 'szene_unbekannt']);
  assert.equal((await s.post('/szene', { aktion: 'zeige', name: 'Böse' })).code, 400);
});

test('szene: laden sends the stored FX unit, assignment and routing back at the anchor, as Cypher, a changed unit is restored', async (t) => {
  const s = await echterServer(t, 'szfx', 8);
  s.o.kern.uhr = { beat: 16, bpm: 128, mono_ns: 0 };
  assert.equal((await s.post('/live/oeffnen', {})).code, 200);
  const unit = (o) => ({ einheit: 1, art: 5, beats: 2, wet: 0.4, param1: 0.1, param2: 0.2, param3: 0.3, an: 1, ...o });
  s.o.vomKern({ adresse: '/e/fx', felder: unit({}) });
  s.o.vomKern({ adresse: '/e/fx/zuweisung', felder: { einheit: 1, kanal: 'deck/1', an: 1 } });
  s.o.vomKern({ adresse: '/e/fx/routing', felder: { routing: 1 } });
  assert.equal((await s.post('/szene', { aktion: 'sichern', name: 'fx' }, CYPHER)).code, 200);
  // change all three: unit 1 off with other settings, the assignment off, the routing back to post fader
  s.o.vomKern({ adresse: '/e/fx', felder: unit({ an: 0, wet: 0.9, art: 3 }) });
  s.o.vomKern({ adresse: '/e/fx/zuweisung', felder: { einheit: 1, kanal: 'deck/1', an: 0 } });
  s.o.vomKern({ adresse: '/e/fx/routing', felder: { routing: 0 } });
  s.log.length = 0;
  const r = await s.post('/szene', { aktion: 'laden', name: 'fx' }, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual([...r.j.fx].sort(), ['fx:1', 'routing', 'zuweisung:1:deck/1'], JSON.stringify(r.j));
  assert.equal(r.j.fx_ab_takt, r.j.anker_takt);
  assert.ok(!r.j.ausgelassen.some((x) => x.ziel.startsWith('fx')), JSON.stringify(r.j.ausgelassen));
  const an = (adr) => s.log.filter((z) => z.typ === 'an_kern' && z.adresse === adr);
  // B7: nothing before the anchor, the FX go out when the core beat reaches it
  await warte(200);
  assert.equal(an('/k/fx').length, 0, 'not before the anchor');
  s.o.kern.uhr = { beat: 4 * (r.j.anker_takt - 1), bpm: 128, mono_ns: 0 };
  assert.ok(await bis(() => s.log.some((z) => z.typ === 'szene_fx')), 'FX at the anchor');
  const f = an('/k/fx');
  assert.equal(f.length, 1, JSON.stringify(f));
  assert.deepEqual([f[0].felder.einheit, f[0].felder.art, f[0].felder.wet, f[0].felder.an, f[0].felder.quelle], [1, 5, 0.4, 1, 'cypher']);
  assert.deepEqual([an('/k/fx/zuweisung')[0].felder.kanal, an('/k/fx/zuweisung')[0].felder.an], ['deck/1', 1]);
  assert.equal(an('/k/fx/routing')[0].felder.routing, 1);
});

test('szene: a restore whose versatz is negative (saved later than it is restored) writes the pattern with --versatz=<n>', async (t) => {
  const s = await echterServer(t, 'szneg', 9);
  s.o.kern.uhr = { beat: 40, bpm: 128, mono_ns: 0 };   // bar 11
  assert.equal((await s.post('/live/oeffnen', {})).code, 200);
  assert.equal((await s.post('/strudel', { strom: 2, text: 'note("c2")' })).code, 200);
  assert.equal((await s.post('/szene', { aktion: 'sichern', name: 'n' }, CYPHER)).code, 200);
  assert.equal((await s.post('/strudel', { strom: 2, text: 'note("d2")' })).code, 200);
  s.o.kern.uhr = { beat: 16, bpm: 128, mono_ns: 0 };   // bar 5: the anchor lies before the saved bar
  s.log.length = 0;
  const r = await s.post('/szene', { aktion: 'laden', name: 'n' }, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.ok(r.j.anker_takt < 11);
  s.o.kern.uhr = { beat: 4 * (r.j.anker_takt - 1) - 1, bpm: 128, mono_ns: 0 };
  assert.ok(await bis(() => s.log.some((z) => z.typ === 'spur_muster')), 'pattern move fired');
  const z = s.log.find((x) => x.typ === 'spur_muster');
  assert.equal(z.code, 200, JSON.stringify(z));
  const von = JSON.parse(fs.readFileSync(path.join(s.muster + '2', 'strom1.von.json'), 'utf8'));
  assert.equal(von.versatz, r.j.anker_takt - 11);
  assert.ok(fs.readFileSync(path.join(s.muster + '2', 'strom1.js'), 'utf8').includes('note("c2")'));
});

test('szene: _vor_stille is not written over silence (schon_still); _vor_stille and _vor_laden keep three generations', async (t) => {
  const s = await echterServer(t, 'szrot', 10);
  s.o.kern.uhr = { beat: 16, bpm: 128, mono_ns: 0 };
  assert.equal((await s.post('/live/oeffnen', {})).code, 200);
  const ordner = s.o.proj.zugang.offen().ordner;
  const lies = (n) => JSON.parse(fs.readFileSync(path.join(ordner, 'szenen', `${n}.json`), 'utf8'));
  for (const text of ['note("c2")', 'note("d2")', 'note("e2")', 'note("f2")']) {
    assert.equal((await s.post('/strudel', { strom: 2, text })).code, 200);
    const r = await s.post('/szene', { aktion: 'sichern', name: '_vor_stille' }, CYPHER);
    assert.equal(r.code, 200, JSON.stringify(r.j));
  }
  assert.deepEqual(['_vor_stille', '_vor_stille-1', '_vor_stille-2'].map((n) => lies(n).muster['2']), ['note("f2")', 'note("e2")', 'note("d2")']);
  assert.ok(!fs.existsSync(path.join(ordner, 'szenen', '_vor_stille-3.json')));
  assert.equal((await s.post('/strudel', { strom: 2, text: 'silence' })).code, 200);
  const r = await s.post('/szene', { aktion: 'sichern', name: '_vor_stille' }, CYPHER);
  assert.deepEqual([r.code, r.j.geschrieben, r.j.grund], [200, false, 'schon_still']);
  assert.equal(lies('_vor_stille').muster['2'], 'note("f2")', 'the good state stays');
  // _vor_laden rotates on every laden
  for (let i = 0; i < 3; i++) assert.equal((await s.post('/szene', { aktion: 'laden', name: '_vor_stille' }, CYPHER)).code, 200);
  const liste = (await s.post('/szene', { aktion: 'liste' }, CYPHER)).j.szenen.map((x) => x.name);
  assert.deepEqual(liste, ['_vor_laden', '_vor_laden-1', '_vor_laden-2', '_vor_stille', '_vor_stille-1', '_vor_stille-2']);
});

test('szene: a body aktion that differs from x-djk-aktion is refused (aktion_passt_nicht)', async (t) => {
  const s = await echterServer(t, 'szakt', 11);
  assert.equal((await s.post('/live/oeffnen', {})).code, 200);
  const r = await s.post('/szene', { aktion: 'loeschen', name: 'a' }, { ...CYPHER, 'x-djk-werkzeug': 'szene', 'x-djk-aktion': 'liste' });
  assert.deepEqual([r.code, r.j.fehler], [403, 'aktion_passt_nicht']);
  assert.equal((await s.post('/szene', { aktion: 'liste' }, { ...CYPHER, 'x-djk-werkzeug': 'szene', 'x-djk-aktion': 'liste' })).code, 200);
});

test('szene: a graph change whose acknowledgement takes long still restores patterns and controls; Surge setze carries the patterns\' anchor', async (t) => {
  const s = await echterServer(t, 'szack', 12);
  s.o.kern.uhr = { beat: 16, bpm: 128, mono_ns: 0 };
  assert.equal((await s.post('/live/oeffnen', {})).code, 200);
  const surge = { patch: 'QUFB' };
  const zeilen = await fakeWirt(t, s.o.opt.wirtOrdner, 'bass', surge);
  assert.equal((await s.post('/strudel', { strom: 2, text: 'note("c2")' })).code, 200);
  s.o.stand.regler['deck/1/fader'] = -10;
  s.o.stand.graphen_geladen = { ...s.o.stand.graphen_geladen, 'fx/3': 'hall' };
  assert.equal((await s.post('/szene', { aktion: 'sichern', name: 'g' }, CYPHER)).code, 200);
  assert.equal((await s.post('/strudel', { strom: 2, text: 'note("d2")' })).code, 200);
  s.o.stand.regler['deck/1/fader'] = -3;
  s.o.stand.graphen_geladen = Object.fromEntries(Object.entries(s.o.stand.graphen_geladen).filter(([k]) => k !== 'fx/3'));
  surge.patch = 'QkJC';
  s.o.kern.uhr = { beat: 40, bpm: 128, mono_ns: 0 };
  const gesehen = [];
  // fake core: the graph acknowledgement comes after 600 ms, the clock went on by two bars meanwhile
  s.o.graphSetzen = async (d) => {
    gesehen.push(d);
    await warte(600);
    s.o.kern.uhr = { beat: 48.5, bpm: 128, mono_ns: 4e9 };
    return { code: 200, j: { ok: true } };
  };
  zeilen.length = 0;
  const r = await s.post('/szene', { aktion: 'laden', name: 'g' }, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual(gesehen, [{ kanal: 'fx/3', name: 'hall', vorgaben: false }]);
  assert.deepEqual(r.j.graphen, ['fx/3']);
  assert.ok(r.j.anker_takt >= 14, String(r.j.anker_takt));   // after the late ack: beat 48.5 is bar 13, anchor is bar 14 or later
  assert.deepEqual(r.j.muster, [2]);
  assert.ok(r.j.regler.includes('deck/1/fader'), JSON.stringify(r.j));
  assert.ok(!r.j.ausgelassen.some((x) => x.ziel.startsWith('spur:')), JSON.stringify(r.j.ausgelassen));
  const setze = zeilen.filter((z) => z.befehl === 'setze');
  assert.equal(setze.length, 1, JSON.stringify(zeilen));
  const anker = 4 * (r.j.anker_takt - 1);
  assert.ok(Math.abs(setze[0].ab - (4 + (anker - 48.5) * 60 / 128)) < 1e-9, `${setze[0].ab}`);
  assert.equal(s.o.spuren.get('szene-g').offen[0].ab_beat, anker, 'the pattern moves at the same anchor');
});
