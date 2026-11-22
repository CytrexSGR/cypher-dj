// Session view M1: Projekt.session, Zelle.raster and the { halten: true } slot in the model.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { neuesProjekt, pruefeProjekt, istHalten, loopDeckGruppe, sessionRaster, sessionSzenen, alleZellen, kanonisch, TEMPO_MIN, TEMPO_MAX } from '../project/model.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { uebersetze } from '../project/playback.ts';
import { Projekte } from '../project/storage.ts';

const kopie = (x) => JSON.parse(JSON.stringify(x));
const SHA = 'a'.repeat(64);
const zelle = (id, extra = {}) => ({ id, name: 'Loop', farbe: 3, art: 'loop', sha256: SHA, beats: 4, bpm: 120, gain_db: 0, ...extra });
const live = () => {
  let p = neuesProjekt('sess'); p.live = true; p.plaetze = [{ typ: 'leer' }, { typ: 'leer' }, { typ: 'leer' }, { typ: 'leer' }];
  p = fuehreListeAus(p, [{ befehl: 'loopdeck_neu', platz: 1 }]).projekt;
  return fuehreListeAus(p, [{ befehl: 'loopdeck_neu', platz: 2 }]).projekt;
};
const szenen = () => Array.from({ length: 8 }, (_, i) => ({ id: `sz${i + 1}`, name: '', farbe: 0 }));
const mitSession = (f) => { const p = kopie(live()); p.session = { raster: 'takt', szenen: szenen() }; f?.(p); return p; };
const fehler = (p) => { const u = pruefeProjekt(kopie(p)); return 'fehler' in u ? u.fehler : null; };

test('session on a live project validates; raster must be a LoopRaster', () => {
  assert.equal(fehler(mitSession()), null);
  for (const r of ['1/4', '1/2', '1', 'takt', '4takte']) assert.equal(fehler(mitSession((p) => { p.session.raster = r; })), null, r);
  assert.match(fehler(mitSession((p) => { p.session.raster = '1/8'; })), /session\.raster/);
  assert.match(fehler(mitSession((p) => { delete p.session.raster; })), /session\.raster/);
});

test('session on a production project is refused', () => {
  const p = neuesProjekt('prod'); p.session = { raster: 'takt', szenen: szenen() };
  assert.match(fehler(p), /session/);
  const q = mitSession(); delete q.live; delete q.plaetze; delete q.gruppen; q.gruppen = []; q.spuren = [];
  assert.match(fehler(q), /session/);
});

test('szenen needs exactly 8 Szene entries; fields and ranges are checked; unknown fields refused', () => {
  assert.match(fehler(mitSession((p) => { p.session.szenen.pop(); })), /session\.szenen/);
  assert.match(fehler(mitSession((p) => { p.session.szenen.push({ id: 'sz9', name: '', farbe: 0 }); })), /session\.szenen/);
  assert.match(fehler(mitSession((p) => { delete p.session.szenen; })), /session\.szenen/);
  const ok = (f) => assert.equal(fehler(mitSession((p) => f(p.session.szenen[3]))), null);
  const nein = (f, re) => assert.match(fehler(mitSession((p) => f(p.session.szenen[3]))), re);
  ok((s) => { s.name = 'x'.repeat(32); s.farbe = 15; s.bpm = TEMPO_MIN; s.takte = 1; s.folge = 'loop'; });
  ok((s) => { s.bpm = TEMPO_MAX; s.takte = 256; s.folge = 'weiter'; });
  ok((s) => { s.folge = 'stopp'; });
  ok((s) => { s.folge = { sprung: 1 }; });
  ok((s) => { s.folge = { sprung: 8 }; });
  nein((s) => { s.name = 'x'.repeat(33); }, /name/);
  nein((s) => { s.name = 5; }, /name/);
  nein((s) => { s.farbe = 16; }, /farbe/);
  nein((s) => { s.farbe = -1; }, /farbe/);
  nein((s) => { s.farbe = 1.5; }, /farbe/);
  nein((s) => { s.bpm = TEMPO_MIN - 1; }, /bpm/);
  nein((s) => { s.bpm = TEMPO_MAX + 1; }, /bpm/);
  nein((s) => { s.takte = 0; }, /takte/);
  nein((s) => { s.takte = 257; }, /takte/);
  nein((s) => { s.takte = 1.5; }, /takte/);
  nein((s) => { s.folge = 'zurueck'; }, /folge/);
  nein((s) => { s.folge = { sprung: 0 }; }, /folge/);
  nein((s) => { s.folge = { sprung: 9 }; }, /folge/);
  nein((s) => { s.folge = { sprung: 2, x: 1 }; }, /folge/);
  nein((s) => { s.folge = null; }, /folge/);
  nein((s) => { s.extra = 1; }, /extra/);
  nein((s) => { delete s.id; }, /id/);
  nein((s) => { s.id = 'x'; }, /id/);
  assert.match(fehler(mitSession((p) => { p.session.szenen[5].id = 'sz1'; })), /duplicate/);
  assert.match(fehler(mitSession((p) => { p.session.extra = 1; })), /session\.extra/);
});

test("sessionSzenen of a live project without session gives 8 scenes named '' with colour 0", () => {
  const p = live();
  const s = sessionSzenen(p);
  assert.equal(s.length, 8);
  assert.ok(s.every((x) => x.name === '' && x.farbe === 0 && x.bpm === undefined));
  assert.equal(new Set(s.map((x) => x.id)).size, 8);
  assert.equal(p.session, undefined, 'reading writes nothing');
  assert.equal(sessionSzenen(mitSession((q) => { q.session.szenen[2].name = 'Drop'; }))[2].name, 'Drop');
  assert.equal(sessionSzenen(undefined).length, 8);
});

test('a slot { halten: true } passes pruefeZellen; { halten: false } and { halten: true, name } are refused', () => {
  const p = live(); p.spuren[0].zellen[2] = { halten: true }; p.spuren[1].zellen[0] = zelle('z1');
  assert.equal(fehler(p), null);
  assert.ok(istHalten(p.spuren[0].zellen[2]) && !istHalten(null) && !istHalten(p.spuren[1].zellen[0]) && !istHalten({ halten: false }) && !istHalten(undefined));
  const q = live(); q.spuren[0].zellen[2] = { halten: false };
  assert.match(fehler(q), /zellen\[2\]/);
  const r = live(); r.spuren[0].zellen[2] = { halten: true, name: 'x' };
  assert.match(fehler(r), /zellen\[2\]/);
  const s = live(); s.spuren[0].zellen[2] = {};
  assert.match(fehler(s), /zellen\[2\]/);
});

test("a cell raster must be a LoopRaster; 'ende' is refused in S1", () => {
  const ok = live(); ok.spuren[0].zellen[0] = zelle('z1', { raster: '1/2' });
  assert.equal(fehler(ok), null);
  for (const r of ['ende', '1/8', 4, null]) {
    const p = live(); p.spuren[0].zellen[0] = zelle('z1', { raster: r });
    assert.match(fehler(p), /raster/, String(r));
  }
});

test('without a session block sessionRaster reads the raster of the first loop deck that has one', () => {
  const p = live();   // two decks, no session block
  assert.equal(p.session, undefined);
  assert.equal(sessionRaster(p), 'takt');
  const alt = JSON.parse(JSON.stringify(p));
  for (const n of [1, 2]) loopDeckGruppe(alt, n).loopdeck.raster = '1';
  assert.equal(sessionRaster(alt), '1', 'an old project whose decks are on grid 1: SESSION and the DJ place launch on the same grid');
  const nur2 = JSON.parse(JSON.stringify(p));
  loopDeckGruppe(nur2, 2).loopdeck.raster = '1/2';
  assert.equal(sessionRaster(nur2), 'takt', 'the first deck decides');
  alt.session = { raster: '4takte', szenen: sessionSzenen(alt) };
  assert.equal(sessionRaster(alt), '4takte', 'the session block wins');
});

test('sessionRaster is takt without session and equals session.raster with it', () => {
  assert.equal(sessionRaster(live()), 'takt');
  assert.equal(sessionRaster(neuesProjekt('x')), 'takt');
  assert.equal(sessionRaster(mitSession((p) => { p.session.raster = '1/4'; })), '1/4');
});

test('a halten slot never reaches the translator as a cell, nor the cell iterators', () => {
  const p = live(); p.spuren[0].zellen[0] = { halten: true }; p.spuren[0].zellen[1] = zelle('z1'); p.spuren[1].zellen[0] = { halten: true };
  const w = uebersetze(p, { nr: 1, audioOrdner: '/a', frames: () => 48000 });
  assert.deepEqual(w.spuren[0].zellen.map((z) => z.index), [2]);
  assert.deepEqual(w.spuren[1].zellen, []);
  assert.deepEqual([...alleZellen(p)].map((z) => z.id), ['z1']);
  // the id counter ignores a halten slot
  const q = fuehreListeAus(p, [{ befehl: 'zelle_setzen', spur_id: p.spuren[2].id, index: 1, zelle: { name: 'N', farbe: 1, art: 'loop', sha256: SHA, beats: 4, bpm: 120, gain_db: 0 } }]).projekt;
  assert.equal(q.spuren[2].zellen[0].id, 'z2');
});

test('a project written with session and halten slots round-trips through save and load unchanged', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sess-m1-'));
  try {
    const ps = new Projekte(d);
    const { slug } = ps.lege('rt', { live: true });
    let p = ps.lies(slug);
    p = fuehreListeAus(p, [{ befehl: 'loopdeck_neu', platz: 1 }]).projekt;
    p = kopie(p);
    p.session = { raster: '1/2', szenen: szenen() };
    p.session.szenen[1] = { id: 'sz2', name: 'Break', farbe: 7, bpm: 130, takte: 8, folge: { sprung: 3 } };
    const sp = p.spuren;
    sp[0].zellen[0] = zelle('z1', { raster: '1' }); sp[0].zellen[1] = { halten: true }; sp[1].zellen[7] = { halten: true };
    assert.equal(fehler(p), null);
    ps.speichere(slug, p);
    const q = ps.lies(slug);
    assert.equal(kanonisch(q), kanonisch(p));
    assert.deepEqual(q.session, p.session);
    assert.deepEqual(q.spuren[0].zellen[1], { halten: true });
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
