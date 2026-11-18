// S19 (MIDI learn): the flow with a fake BereichKontext (records sende and verteile, scripted warteQuittung) and a fake timer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LernSpeicher } from '../areas/learn/store.ts';
import { LernAblauf } from '../areas/learn/flow.ts';

function aufbau(t, quittung = { status: 3, grund: '' }) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-lernen-ab-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const sendet = [], verteilt = [];
  let id = 100;
  const ctx = { sende: (a, f) => { sendet.push({ a, f }); return ++id; }, warteQuittung: async () => (typeof quittung === 'function' ? quittung() : quittung),
    quelle: () => 'andreas', kiGestoppt: () => false, verteile: (e) => verteilt.push(e), log: () => {} };
  const timer = [];
  const zeit = { setzen: (f, ms) => { const h = { f, ms, weg: false }; timer.push(h); return h; }, loeschen: (h) => { h.weg = true; } };
  const speicher = new LernSpeicher(d);
  const a = new LernAblauf(ctx, speicher, { zeit });
  const idArm = () => sendet.filter((s) => s.a === '/k/lernen' && s.f.an === 1).length;
  return { d, a, speicher, sendet, verteilt, timer, idArm, datei: path.join(d, 'lernen.json') };
}
const still = () => new Promise((r) => setTimeout(r, 20));
const gelernt = (id, o = {}) => ({ id, quelle: 1, kanal: 1, nr: 74, wert: 64, belegt: 0, ...o });
const stand = (v) => v.map((e) => e.f.stand);

test('S19 ablauf: arm, capture, write, reload, quittung 3: the file is written, the kern is asked to reload, the pages hear "fertig"', async (t) => {
  const x = aufbau(t);
  x.a.scharf('erz/5/bk/3');
  assert.deepEqual(x.sendet[0], { a: '/k/lernen', f: { an: 1 } });
  assert.deepEqual(x.a.lage(), { pfad: 'erz/5/bk/3', frist_ms: 20000 });
  assert.equal(x.timer[0].ms, 20000);
  x.a.ereignis('/e/gelernt', gelernt(101));
  await still();
  assert.deepEqual(x.speicher.lies().zuordnungen, [{ pfad: 'erz/5/bk/3', kanal: 1, nr: 74, platz: 1 }]);
  assert.deepEqual(x.sendet[1], { a: '/k/mapping', f: { geraet: 'lernen' } });
  assert.deepEqual(x.verteilt.at(-1), { a: 'lernen', f: { stand: 'fertig', pfad: 'erz/5/bk/3', kanal: 1, nr: 74, platz: 1 } });
  assert.equal(x.a.lage(), null);
  assert.ok(x.timer[0].weg, 'the timer is cleared');
});

test('S19 ablauf: a stale id (an earlier arming) is ignored: nothing written, still armed', async (t) => {
  const x = aufbau(t);
  x.a.scharf('erz/5/bk/3');     // id 101
  x.a.scharf('deck/1/bk/2');    // id 102 replaces it
  x.a.ereignis('/e/gelernt', gelernt(101));
  await still();
  assert.ok(!fs.existsSync(x.datei));
  assert.equal(x.a.lage().pfad, 'deck/1/bk/2');
  x.a.ereignis('/e/gelernt', gelernt(102));   // control: the current id is taken
  await still();
  assert.deepEqual(x.speicher.lies().zuordnungen, [{ pfad: 'deck/1/bk/2', kanal: 1, nr: 74, platz: 1 }]);
});

test('S19 ablauf: a CC from hand_in gives the English hand_in text and writes nothing; a CC the console mapping also uses (belegt) is learned on its place all the same', async (t) => {
  const x = aufbau(t);
  x.a.scharf('erz/5/bk/3');
  x.a.ereignis('/e/gelernt', gelernt(101, { quelle: 0 }));
  await still();
  assert.ok(!fs.existsSync(x.datei));
  assert.deepEqual([x.verteilt.at(-1).f.stand, x.verteilt.at(-1).f.text], ['hand_in', 'this controller is mapped on hand_in; choose it as MIDI input under Devices']);
  x.a.scharf('erz/5/bk/4');
  x.a.ereignis('/e/gelernt', gelernt(102, { belegt: 1, nr: 14 }));
  await still();
  assert.ok(fs.existsSync(x.datei), 'the place has its own port and table: learned');
  assert.ok(!x.verteilt.some((e) => e.f?.stand === 'belegt'));
});

test('S19 ablauf: the kern refuses the file (quittung 6 pruefung): the previous .bak comes back, stand abgelehnt with the reason; no answer keeps the file (ohne_antwort)', async (t) => {
  const x = aufbau(t, { status: 6, grund: 'pruefung' });
  x.speicher.zuordne({ pfad: 'deck/1/bk/2', kanal: 2, nr: 10 });
  const alt = fs.readFileSync(x.datei, 'utf8');
  x.a.scharf('erz/5/bk/3');
  x.a.ereignis('/e/gelernt', gelernt(101));
  await still();
  assert.equal(fs.readFileSync(x.datei, 'utf8'), alt, 'the old file is back');
  assert.deepEqual([x.verteilt.at(-1).f.stand, x.verteilt.at(-1).f.grund], ['abgelehnt', 'pruefung']);
  const y = aufbau(t, null);
  y.a.scharf('erz/5/bk/3');
  y.a.ereignis('/e/gelernt', gelernt(101));
  await still();
  assert.deepEqual(y.speicher.lies().zuordnungen, [{ pfad: 'erz/5/bk/3', kanal: 1, nr: 74, platz: 1 }], 'kept: the kern loads it at its next start');
  assert.equal(y.verteilt.at(-1).f.stand, 'ohne_antwort');
});

test('S19 ablauf: the deadline disarms the kern and tells the pages; a capture after that is ignored; a new generation (/e/neustart) ends the arming without sending', async (t) => {
  const x = aufbau(t);
  x.a.scharf('erz/5/bk/3');
  x.timer[0].f();   // 20 s are over
  assert.deepEqual(x.sendet.at(-1), { a: '/k/lernen', f: { an: 0 } });
  assert.equal(x.verteilt.at(-1).f.stand, 'abgelaufen');
  assert.equal(x.a.lage(), null);
  x.a.ereignis('/e/gelernt', gelernt(101));
  await still();
  assert.ok(!fs.existsSync(x.datei));
  const y = aufbau(t);
  y.a.ereignis('/e/neustart', { generation: 3 });
  y.a.scharf('erz/5/bk/3');
  const n = y.sendet.length;
  y.a.ereignis('/e/neustart', { generation: 3 });   // control: the same generation (a re-announce) keeps it armed
  assert.notEqual(y.a.lage(), null);
  y.a.ereignis('/e/neustart', { generation: 4 });
  assert.equal(y.a.lage(), null);
  assert.equal(y.sendet.length, n, 'nothing sent: the new kern is not armed');
  assert.equal(y.verteilt.at(-1).f.stand, 'abgelaufen');
});

test('S19 ablauf: abbrechen disarms (an 0) and tells the pages; loesche removes the entry and reloads the table', async (t) => {
  const x = aufbau(t);
  x.a.scharf('erz/5/bk/3');
  x.a.abbrechen();
  assert.deepEqual(x.sendet.at(-1), { a: '/k/lernen', f: { an: 0 } });
  assert.equal(x.verteilt.at(-1).f.stand, 'abgebrochen');
  x.speicher.zuordne({ pfad: 'erz/5/bk/3', kanal: 1, nr: 74 });
  const n = x.sendet.length;
  await x.a.loesche('erz/5/bk/3');
  assert.deepEqual(x.speicher.lies().zuordnungen, []);
  assert.deepEqual(x.sendet.slice(n), [{ a: '/k/mapping', f: { geraet: 'lernen' } }]);
  assert.equal(x.verteilt.at(-1).f.stand, 'geloescht');
});

test('controller places: a capture from midi_ein_2 (quelle 2) writes lernen-2.json and reloads the device lernen-2; place 1 is not reloaded', async (t) => {
  const x = aufbau(t);
  x.a.scharf('deck/2/fader');
  x.a.ereignis('/e/gelernt', gelernt(101, { quelle: 2 }));
  await still();
  assert.deepEqual(x.speicher.lies().zuordnungen, [{ pfad: 'deck/2/fader', kanal: 1, nr: 74, platz: 2 }]);
  assert.deepEqual(x.sendet.filter((s) => s.a === '/k/mapping').map((s) => s.f.geraet), ['lernen-2']);
  assert.deepEqual(x.verteilt.at(-1), { a: 'lernen', f: { stand: 'fertig', pfad: 'deck/2/fader', kanal: 1, nr: 74, platz: 2 } });
});

test('controller places: without proof that the kern knows the places 2..8 the name lernen-2 is never sent (an older kern would load it as base mapping)', async (t) => {
  const x = aufbau(t);
  x.speicher.zuordne({ pfad: 'deck/2/fader', kanal: 1, nr: 7, platz: 2 });   // a file from an earlier run
  await x.a.loesche('deck/2/fader');
  assert.deepEqual(x.sendet.filter((s) => s.a === '/k/mapping'), [], 'kept for the next kern start');
  assert.equal(x.verteilt.at(-1).f.stand, 'geloescht');
  x.speicher.zuordne({ pfad: 'deck/2/fader', kanal: 1, nr: 7, platz: 2 });
  x.a.ereignis('/zustand/ein', { verbunden: 1 << 9 });   // midi_ein_2 is linked: this kern has the eight inputs
  await x.a.loesche('deck/2/fader');
  assert.deepEqual(x.sendet.filter((s) => s.a === '/k/mapping').map((s) => s.f.geraet), ['lernen-2']);
});

test('direct assignment of a pad: setze writes a note "taste" entry, reloads the table of its place and tells the pages; a refused reload restores the file', async (t) => {
  const x = aufbau(t);
  await x.a.setze('deck/1/pfl', 1, 36, 1, { typ: 'note', art: 'taste' });
  assert.deepEqual(JSON.parse(fs.readFileSync(x.datei, 'utf8')).eintraege, [{ nachricht: { typ: 'note', kanal: 1, nr: 36 }, ziel: 'deck/1/pfl', art: 'taste' }]);
  assert.deepEqual(x.sendet.filter((s) => s.a === '/k/mapping').map((s) => s.f.geraet), ['lernen']);
  assert.deepEqual(x.verteilt.at(-1), { a: 'lernen', f: { stand: 'fertig', pfad: 'deck/1/pfl', kanal: 1, nr: 36, platz: 1 } });
  // the kern refuses the table (status 4): the previous file comes back and the caller hears why
  const y = aufbau(t, { status: 4, grund: 'falsche_art' });
  y.speicher.zuordne({ pfad: 'deck/1/filter', kanal: 16, nr: 13 });
  const vorher = fs.readFileSync(y.datei, 'utf8');
  await assert.rejects(y.a.setze('deck/1/cue', 1, 37, 1, { typ: 'note', art: 'taste' }), (e) => e.grund === 'lernen_abgelehnt' && e.code === 409);
  assert.equal(fs.readFileSync(y.datei, 'utf8'), vorher, 'restored');
});
