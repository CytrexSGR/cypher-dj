// Controller follow: LernSpeicher.ersetzeKnoepfe replaces the knob entries of one place in a single write through the uniqueness rule, and
// LernAblauf.ersetze reloads the kern once for each place whose file changed (same mechanism as setze).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LernSpeicher, LernFehler } from '../areas/learn/store.ts';
import { LernAblauf } from '../areas/learn/flow.ts';

const ordner = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-lernen-ers-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const datei = (d, platz) => path.join(d, platz === 1 ? 'lernen.json' : `lernen-${platz}.json`);
const ziele = (s, platz) => s.lies().zuordnungen.filter((z) => z.platz === platz).map((z) => z.pfad).sort();
const grund = (f) => { try { f(); } catch (e) { return e instanceof LernFehler ? `${e.grund}/${e.code}` : String(e); } return null; };

function platz2(s) {
  s.zuordne({ pfad: 'erz/5/bk/1', kanal: 16, nr: 13, platz: 2 });
  s.zuordne({ pfad: 'erz/5/bk/2', kanal: 16, nr: 14, platz: 2 });
  s.zuordne({ pfad: 'deck/1/fader', kanal: 16, nr: 20, platz: 2 });
  s.zuordne({ pfad: 'deck/1/pfl', kanal: 16, nr: 37, platz: 2, art: 'taste' });
}

test('ersetzeKnoepfe: every bk knob entry of the place goes, the new ones come, deck filters and buttons stay; one write, one .bak of the old file', (t) => {
  const d = ordner(t), s = new LernSpeicher(d);
  platz2(s);
  const vorher = fs.readFileSync(datei(d, 2), 'utf8');
  const r = s.ersetzeKnoepfe(2, [{ pfad: 'spur/3/bk/1', kanal: 16, nr: 13 }, { pfad: 'spur/3/bk/2', kanal: 16, nr: 14 }, { pfad: 'spur/3/bk/3', kanal: 16, nr: 15 }]);
  assert.deepEqual(r.plaetze, [2]);
  assert.deepEqual(r.gesetzt.map((z) => z.pfad), ['spur/3/bk/1', 'spur/3/bk/2', 'spur/3/bk/3']);
  assert.deepEqual(r.kollidiert, []);
  assert.deepEqual(ziele(s, 2), ['deck/1/fader', 'deck/1/pfl', 'spur/3/bk/1', 'spur/3/bk/2', 'spur/3/bk/3']);
  assert.equal(fs.readFileSync(`${datei(d, 2)}.bak`, 'utf8'), vorher, 'the .bak is the file before this one write');
  assert.equal(s.lies().zuordnungen.find((z) => z.pfad === 'deck/1/pfl').art, 'taste');
});

test('ersetzeKnoepfe: an entry of ANOTHER place on a new target goes (one target, one source over all places); that place is reported changed', (t) => {
  const d = ordner(t), s = new LernSpeicher(d);
  s.zuordne({ pfad: 'spur/3/bk/2', kanal: 1, nr: 2, platz: 1 });
  s.zuordne({ pfad: 'deck/2/fader', kanal: 1, nr: 3, platz: 1 });
  platz2(s);
  const r = s.ersetzeKnoepfe(2, [{ pfad: 'spur/3/bk/2', kanal: 16, nr: 13 }]);
  assert.deepEqual(r.plaetze, [1, 2]);
  assert.deepEqual(ziele(s, 1), ['deck/2/fader']);
  assert.deepEqual(ziele(s, 2), ['deck/1/fader', 'deck/1/pfl', 'spur/3/bk/2']);
});

test('ersetzeKnoepfe: a new entry whose control already drives something that stays (a deck filter) is not written and is reported kollidiert', (t) => {
  const d = ordner(t), s = new LernSpeicher(d);
  platz2(s);
  const r = s.ersetzeKnoepfe(2, [{ pfad: 'erz/6/bk/1', kanal: 16, nr: 20 }, { pfad: 'erz/6/bk/2', kanal: 16, nr: 21 }]);
  assert.deepEqual(r.kollidiert.map((z) => z.pfad), ['erz/6/bk/1']);
  assert.deepEqual(r.gesetzt.map((z) => z.pfad), ['erz/6/bk/2']);
  assert.deepEqual(ziele(s, 2), ['deck/1/fader', 'deck/1/pfl', 'erz/6/bk/2']);
});

test('ersetzeKnoepfe: the same result again changes nothing: no place reported, no write, no .bak, no new file', (t) => {
  const d = ordner(t), s = new LernSpeicher(d);
  const neu = [{ pfad: 'erz/5/bk/1', kanal: 16, nr: 13 }, { pfad: 'erz/5/bk/2', kanal: 16, nr: 14 }];
  assert.deepEqual(s.ersetzeKnoepfe(3, []).plaetze, [], 'an empty table that stays empty is not created');
  assert.equal(fs.existsSync(datei(d, 3)), false);
  assert.deepEqual(s.ersetzeKnoepfe(3, neu).plaetze, [3]);
  assert.deepEqual(s.ersetzeKnoepfe(3, neu).plaetze, []);
  assert.equal(fs.existsSync(`${datei(d, 3)}.bak`), false, 'only the first write existed: nothing to back up, and the second call wrote nothing');
});

test('ersetzeKnoepfe: an entry the server did not write (art relativ) survives, also on a bk target', (t) => {
  const d = ordner(t), s = new LernSpeicher(d);
  s.zuordne({ pfad: 'erz/5/bk/1', kanal: 16, nr: 13, platz: 2 });
  const j = JSON.parse(fs.readFileSync(datei(d, 2), 'utf8'));
  j.eintraege.push({ nachricht: { typ: 'cc', kanal: 16, nr: 99 }, ziel: 'erz/5/bk/7', art: 'relativ' });
  fs.writeFileSync(datei(d, 2), JSON.stringify(j));
  s.ersetzeKnoepfe(2, [{ pfad: 'erz/6/bk/1', kanal: 16, nr: 13 }]);
  const e = JSON.parse(fs.readFileSync(datei(d, 2), 'utf8')).eintraege;
  assert.deepEqual(e.map((x) => x.ziel), ['erz/5/bk/7', 'erz/6/bk/1']);
});

test('ersetzeKnoepfe: a damaged file on any place refuses the whole change and is never overwritten', (t) => {
  const d = ordner(t), s = new LernSpeicher(d);
  platz2(s);
  fs.writeFileSync(datei(d, 4), '{ broken');
  const vorher = fs.readFileSync(datei(d, 2), 'utf8');
  assert.equal(grund(() => s.ersetzeKnoepfe(2, [{ pfad: 'erz/6/bk/1', kanal: 16, nr: 40 }])), 'lernen_datei_kaputt/409');
  assert.equal(fs.readFileSync(datei(d, 4), 'utf8'), '{ broken');
  assert.equal(fs.readFileSync(datei(d, 2), 'utf8'), vorher);
});

test('ersetzeKnoepfe with alle: every learn entry of the place is replaced (a fest preset), foreign entries stay, other places lose only the doubled targets', (t) => {
  const d = ordner(t), s = new LernSpeicher(d);
  platz2(s);
  s.zuordne({ pfad: 'deck/2/fader', kanal: 1, nr: 3, platz: 1 });
  const r = s.ersetzeKnoepfe(2, [{ pfad: 'deck/2/fader', kanal: 16, nr: 13 }, { pfad: 'deck/2/pfl', kanal: 16, nr: 37, art: 'taste' }], 'alle');
  assert.deepEqual(r.plaetze, [1, 2]);
  assert.deepEqual(ziele(s, 2), ['deck/2/fader', 'deck/2/pfl']);
  assert.deepEqual(ziele(s, 1), []);
});

// ---- the flow ----

function ablauf(t, quittung = { status: 3, grund: '' }, mehr = true) {
  const d = ordner(t);
  const sendet = [], verteilt = [];
  let id = 100;
  const ctx = { sende: (a, f) => { sendet.push({ a, f }); return ++id; }, warteQuittung: async () => (typeof quittung === 'function' ? quittung() : quittung),
    quelle: () => 'andreas', kiGestoppt: () => false, verteile: (e) => verteilt.push(e), log: () => {} };
  const speicher = new LernSpeicher(d);
  const a = new LernAblauf(ctx, speicher, { zeit: { setzen: () => ({}), loeschen: () => {} } });
  if (mehr) a.ereignis('/zustand/ein', { verbunden: 0x200 });   // proof that the kern knows the places 2..8
  return { d, a, speicher, sendet, verteilt };
}
const mappings = (x) => x.sendet.filter((s) => s.a === '/k/mapping').map((s) => s.f.geraet);

test('ersetze: ONE kern reload for each place whose file changed, nothing for an unchanged table; the pages hear "ersetzt" once', async (t) => {
  const x = ablauf(t);
  x.speicher.zuordne({ pfad: 'spur/3/bk/2', kanal: 1, nr: 2, platz: 1 });
  const r = await x.a.ersetze(2, [{ pfad: 'spur/3/bk/2', kanal: 16, nr: 13 }, { pfad: 'spur/3/bk/3', kanal: 16, nr: 14 }]);
  assert.equal(r.stand, 'fertig');
  assert.deepEqual(mappings(x), ['lernen', 'lernen-2']);
  assert.deepEqual(x.verteilt.map((e) => e.f.stand), ['ersetzt']);
  const n = x.sendet.length;
  const wieder = await x.a.ersetze(2, [{ pfad: 'spur/3/bk/2', kanal: 16, nr: 13 }, { pfad: 'spur/3/bk/3', kanal: 16, nr: 14 }]);
  assert.equal(wieder.stand, 'fertig');
  assert.equal(x.sendet.length, n, 'no second reload');
  assert.equal(x.verteilt.length, 1, 'and no second event');
});

test('ersetze: the kern refuses the table: the files are put back, the answer is abgelehnt, and the old tables are reloaded', async (t) => {
  const x = ablauf(t, { status: 4, grund: 'ziel_unbekannt' });
  x.speicher.zuordne({ pfad: 'erz/5/bk/1', kanal: 16, nr: 13, platz: 2 });
  const vorher = fs.readFileSync(datei(x.d, 2), 'utf8');
  const r = await x.a.ersetze(2, [{ pfad: 'spur/3/bk/1', kanal: 16, nr: 13 }]);
  assert.deepEqual([r.stand, r.grund], ['abgelehnt', 'ziel_unbekannt']);
  assert.equal(fs.readFileSync(datei(x.d, 2), 'utf8'), vorher);
  assert.equal(x.verteilt.at(-1).f.stand, 'abgelehnt');
});

test('ersetze: a place 2..8 without proof that the kern knows it keeps the file and is not reloaded (the kern loads it at its next start)', async (t) => {
  const x = ablauf(t, { status: 3, grund: '' }, false);
  const r = await x.a.ersetze(3, [{ pfad: 'erz/5/bk/1', kanal: 16, nr: 13 }]);
  assert.equal(r.stand, 'fertig');
  assert.deepEqual(mappings(x), []);
  assert.deepEqual(ziele(x.speicher, 3), ['erz/5/bk/1']);
});

test('ersetze: a damaged learn file rejects with lernen_datei_kaputt (409) and the kern is not asked', async (t) => {
  const x = ablauf(t);
  fs.writeFileSync(datei(x.d, 1), '{ broken');
  await assert.rejects(() => x.a.ersetze(2, [{ pfad: 'erz/5/bk/1', kanal: 16, nr: 13 }]), (e) => e.grund === 'lernen_datei_kaputt' && e.code === 409);
  assert.deepEqual(mappings(x), []);
});

test('step entries: stufen is written with a taste entry on a knob row, read back, and replaced with the other knob entries of the place', async () => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const { LernSpeicher } = await import('../areas/learn/store.ts');
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-stufen-'));
  const s = new LernSpeicher(ordner);
  s.ersetzeKnoepfe(2, [{ pfad: 'spur/1/bk/14', kanal: 1, nr: 37, art: 'taste', stufen: 3 }, { pfad: 'spur/1/bk/1', kanal: 1, nr: 13 }]);
  const roh = JSON.parse(fs.readFileSync(s.pfad(2), 'utf8')).eintraege;
  assert.deepEqual(roh[0], { nachricht: { typ: 'cc', kanal: 1, nr: 37 }, ziel: 'spur/1/bk/14', art: 'taste', stufen: 3 });
  assert.equal(roh[1].stufen, undefined);
  assert.deepEqual(s.lies().zuordnungen.find((z) => z.nr === 37), { pfad: 'spur/1/bk/14', kanal: 1, nr: 37, platz: 2, art: 'taste', stufen: 3 });
  s.ersetzeKnoepfe(2, [{ pfad: 'spur/2/bk/1', kanal: 1, nr: 13 }]);
  assert.deepEqual(s.lies().zuordnungen.map((z) => z.pfad), ['spur/2/bk/1'], 'the step entry goes with the knob entries');
  fs.rmSync(ordner, { recursive: true, force: true });
});
