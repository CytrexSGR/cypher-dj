// Session view M5: sessionStand, the pure stand of the session view (containers A..D with the loop deck columns).
import test from 'node:test';
import assert from 'node:assert/strict';
import { neuesProjekt, loopDeckGruppe, loopDeckSpuren, sessionSzenen } from '../project/model.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { sessionStand } from '../areas/live/session_state.ts';

const SHA = 'a'.repeat(64);
const Z = (extra = {}) => ({ name: 'Loop', farbe: 3, art: 'loop', sha256: SHA, beats: 4, bpm: 120, gain_db: 0, ...extra });
const live = () => { const p = neuesProjekt('x'); p.live = true; p.plaetze = [{ typ: 'leer' }, { typ: 'leer' }, { typ: 'leer' }, { typ: 'leer' }]; return p; };
const lauf = (p, ...b) => fuehreListeAus(p, b).projekt;
const leerLauf = () => ({ zelle: null, verwaist: false, ab_beat: 0, versatz_beats: 0, wartend: null, zuletzt: null });
const UHR = { beat: 12.5, bpm: 126 };
const frames = (sha) => (sha === SHA ? 96000 : null);
const stand = (p, l = leerLauf) => sessionStand(p, l, frames, UHR);

function zwei() {
  let p = lauf(lauf(live(), { befehl: 'loopdeck_neu', platz: 1 }), { befehl: 'loopdeck_neu', platz: 2 });
  const sp = p.spuren.filter((s) => s.zellen);
  p = lauf(p, { befehl: 'zelle_setzen', spur_id: sp[0].id, index: 2, zelle: Z({ name: 'a' }) }, { befehl: 'zelle_setzen', spur_id: sp[5].id, index: 8, zelle: Z({ name: 'b', sha256: 'b'.repeat(64) }) },
    { befehl: 'zelle_halten', spur_id: sp[1].id, index: 3, an: true });
  return p;
}

test('containers come in place order A..D with a letter; a loops container has 4 columns named <letter><1..4>', () => {
  const p = zwei();   // decks land on places 3 and 4 (C, D)
  const s = stand(p);
  assert.deepEqual(s.container.map((c) => [c.buchstabe, c.typ]), [['A', 'leer'], ['B', 'leer'], ['C', 'loops'], ['D', 'loops']]);
  assert.deepEqual(s.container[2].spalten.map((x) => x.kurz), ['C1', 'C2', 'C3', 'C4']);
  assert.deepEqual(s.container[3].spalten.map((x) => [x.kurz, x.deck, x.spur]), [['D1', 2, 1], ['D2', 2, 2], ['D3', 2, 3], ['D4', 2, 4]]);
  const g1 = loopDeckGruppe(p, 1);
  assert.deepEqual(s.container[2].spalten.map((x) => x.spur_id), loopDeckSpuren(p, g1).map((x) => x.id));
  assert.equal(s.container[2].name, g1.name);
  const sp = s.container[2].spalten[0];
  assert.deepEqual([sp.art, sp.fader_db, sp.mute, sp.filter, sp.lauf], ['audio', 0, false, 0, leerLauf()]);
  assert.equal(sp.zellen.length, 8);
  assert.equal(sp.zellen[1].name, 'a');
  assert.equal(sp.zellen[1].frames, 96000);
  assert.deepEqual([s.beat, s.bpm, s.raster], [12.5, 126, 'takt']);
  assert.ok('effekt' in sp && 'send' in sp && 'eq' in sp && 'kill' in sp);
  assert.deepEqual(sp.fx, { 1: false, 2: false, 3: false });
});

test('the mirror state of a column comes from the lauf function', () => {
  const p = zwei();
  const id = p.spuren.filter((x) => x.zellen)[0].id;
  const l = { ...leerLauf(), zelle: 2, ab_beat: 8 };
  const s = stand(p, (sid) => (sid === id ? l : leerLauf()));
  assert.deepEqual(s.container[2].spalten[0].lauf, l);
  assert.deepEqual(s.container[2].spalten[1].lauf, leerLauf());
});

test('halten slots pass through as { halten: true } and empty slots are null', () => {
  const s = stand(zwei());
  const z = s.container[2].spalten[1].zellen;
  assert.deepEqual(z[2], { halten: true });
  assert.equal(z[0], null);
  assert.equal(s.container[3].spalten[1].zellen[7].name, 'b');
});

test('track, stems, strudel, seq and leer containers have no columns and carry their name', () => {
  let p = live();
  p.plaetze = [{ typ: 'track' }, { typ: 'leer' }, { typ: 'leer' }, { typ: 'leer' }];
  p = lauf(p, { befehl: 'seq_anlegen', platz: 2 });
  const s = stand(p);
  assert.deepEqual(s.container.map((c) => c.typ), ['track', 'seq', 'leer', 'leer']);
  for (const c of s.container) assert.deepEqual(c.spalten, []);
  assert.equal(s.container[1].name, p.gruppen.find((g) => g.seq).name);
  assert.equal(s.container[0].name, '');
  for (const typ of ['strudel', 'stems']) {
    const q = JSON.parse(JSON.stringify(p));
    q.gruppen.push({ ...q.gruppen[0], id: 'gx', name: `G ${typ}`, seq: undefined, ...(typ === 'strudel' ? { strudel: {} } : {}) });
    q.plaetze[2] = { typ, gruppe: 'gx' };
    const c = stand(q).container[2];
    assert.deepEqual([c.typ, c.name, c.spalten], [typ, `G ${typ}`, []]);
  }
});

test('a parked deck is listed in geparkt, not in a container', () => {
  const p = zwei();
  p.plaetze[3] = { typ: 'leer' };   // deck 2 loses its place
  const s = stand(p);
  assert.deepEqual(s.container.map((c) => c.typ), ['leer', 'leer', 'loops', 'leer']);
  assert.equal(s.geparkt.length, 1);
  assert.equal(s.geparkt[0].length, 4);
  assert.equal(s.geparkt[0][0].deck, 2);
  assert.deepEqual(stand(live()).geparkt, []);
});

test('szenen are the 8 scenes of sessionSzenen and raster is the session grid; a production project gives null', () => {
  let p = zwei();
  assert.deepEqual(stand(p).szenen, sessionSzenen(p));
  p = lauf(p, { befehl: 'szene_aendern', zeile: 2, name: 'Drop', bpm: 130 }, { befehl: 'session_aendern', raster: '1' });
  const s = stand(p);
  assert.equal(s.szenen.length, 8);
  assert.equal(s.szenen[1].name, 'Drop');
  assert.equal(s.raster, '1');
  assert.equal(sessionStand(neuesProjekt('prod'), leerLauf, frames, UHR), null);
  assert.equal(sessionStand(undefined, leerLauf, frames, UHR), null);
  const ohneUhr = sessionStand(p, leerLauf, frames, null);
  assert.equal(ohneUhr.beat, null);
});

test('a column carries nr (the project track number), solo and arm from the project track', () => {
  let p = zwei();
  const sp = p.spuren.filter((x) => x.zellen);
  p = lauf(p, { befehl: 'spur_aendern', spur_id: sp[1].id, solo: true });
  const alle = stand(p).container[2].spalten;
  const roh = p.spuren.filter((x) => x.zellen).slice(0, 4);
  assert.deepEqual(alle.map((c) => c.nr), roh.map((x) => x.nr));
  assert.ok(alle.every((c) => Number.isInteger(c.nr) && c.nr >= 1));
  assert.deepEqual(alle.map((c) => c.solo), [false, true, false, false]);
  assert.deepEqual(alle.map((c) => c.arm), [false, false, false, false]);
  p.spuren.find((x) => x.id === sp[2].id).aufnahme = { scharf: true, eingang: { art: 'intern', quelle: 'master' } };
  assert.deepEqual(stand(p).container[2].spalten.map((c) => c.arm), [false, false, true, false]);
  assert.equal(stand(p).geparkt.length, 0);
});

test('rueckgaenge: per column, which returns (HALL, DELAY) the deck has, the rule of the translator for send targets', () => {
  const p = zwei();   // decks 1 and 2; the stand only reads r.loopdeck of a return
  const ret = (platz, art) => ({ id: `r${platz}${art}`, nr: 1, name: art, loopdeck: { platz, art } });
  p.returns = [ret(1, 'hall'), ret(1, 'delay'), ret(2, 'hall')];
  const s = stand(p), spalten = (st, i) => st.container[i].spalten.map((c) => c.rueckgaenge);
  assert.deepEqual(spalten(s, 2), Array(4).fill({ hall: true, delay: true }));
  assert.deepEqual(spalten(s, 3), Array(4).fill({ hall: true, delay: false }), 'deck 2 has no DELAY return');
  p.returns = p.returns.filter((x) => !(x.loopdeck.platz === 1 && x.loopdeck.art === 'hall'));
  assert.deepEqual(spalten(stand(p), 2), Array(4).fill({ hall: false, delay: true }), 'only deck 1 loses its HALL');
  assert.deepEqual(spalten(stand(p), 3), Array(4).fill({ hall: true, delay: false }));
  delete p.returns;
  assert.deepEqual(spalten(stand(p), 2)[0], { hall: false, delay: false }, 'a project without returns');
});
