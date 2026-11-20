// Loop deck M1: model fields (Gruppe.loopdeck, Spur.zellen, Spur.filter), their validation and the helpers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { neuesProjekt, pruefeProjekt, neueId, loopDeckGruppe, loopDeckSpuren, spurSicht, LOOP_RASTER_BEATS } from '../project/model.ts';
import { fuehreListeAus } from '../project/commands.ts';

const kopie = (x) => JSON.parse(JSON.stringify(x));
const lauf = (p, ...b) => fuehreListeAus(p, b).projekt;
const SHA = 'a'.repeat(64);
const zelle = (id, extra = {}) => ({ id, name: 'Loop', farbe: 3, art: 'loop', sha256: SHA, beats: 4, bpm: 120, gain_db: 0, ...extra });

// a live project with one loop deck group (place `platz`) and 4 audio tracks outputting into it
const deck = (platz = 1) => {
  let p = neuesProjekt('ld'); p.live = true;
  for (let i = 1; i <= 4; i++) p = lauf(p, { befehl: 'spur_neu', art: 'audio', name: `L${platz}.${i}` });
  p = lauf(p, { befehl: 'gruppenspur_neu', name: `LOOP ${platz}`, mitglieder: p.spuren.map((s) => s.id) });
  p = kopie(p);
  p.gruppen[0].loopdeck = { platz, raster: 'takt' };
  for (const s of p.spuren) s.zellen = Array.from({ length: 8 }, () => null);
  return p;
};
const fehler = (p) => { const u = pruefeProjekt(kopie(p)); return 'fehler' in u ? u.fehler : null; };
const mut = (platz, f) => { const p = deck(platz); f(p); return fehler(p); };

test('a valid deck with cells and a filter passes and the helpers find it', () => {
  const p = deck(2);
  p.spuren[0].zellen[0] = zelle('z1'); p.spuren[0].zellen[7] = zelle('z2', { art: 'einmal', beats: undefined, bpm: undefined, pfad_hinweis: 'audio/a.wav' });
  delete p.spuren[0].zellen[7].beats; delete p.spuren[0].zellen[7].bpm;
  p.spuren[1].filter = -0.5;
  const u = pruefeProjekt(kopie(p));
  assert.ok('projekt' in u, JSON.stringify(u));
  assert.equal(loopDeckGruppe(u.projekt, 2)?.id, u.projekt.gruppen[0].id);
  assert.equal(loopDeckGruppe(u.projekt, 1), null);
  assert.equal(loopDeckSpuren(u.projekt, u.projekt.gruppen[0]).length, 4);
  assert.deepEqual(LOOP_RASTER_BEATS, { '1/4': 0.25, '1/2': 0.5, '1': 1, takt: 4, '4takte': 16 });
});

test('loopdeck only on a top group of a live project', () => {
  assert.match(mut(1, (p) => { delete p.live; }), /only in the live container/);
  assert.match(mut(1, (p) => { p.gruppen[0].loopdeck.platz = 3; }), /1 or 2 expected/);
  assert.match(mut(1, (p) => { p.gruppen[0].loopdeck.raster = 'x'; }), /raster/);
  assert.match(mut(1, (p) => { p.gruppen.push({ ...kopie(p.gruppen[0]), id: 'g9', nr: 9 }); p.gruppen[0].ausgang = { art: 'gruppe', id: 'g9' }; delete p.gruppen[1].loopdeck; }), /top group/);
});

test('loopdeck, modul and seq exclude each other on one group', () => {
  assert.match(mut(1, (p) => { p.gruppen[0].seq = { schema: 2, platz: 1 }; }), /not several/);
  assert.match(mut(1, (p) => { p.gruppen[0].modul = { quelle_sha256: SHA, titel: 't', fassung: 'f', basis_bpm: 120, von_beat: 0, laenge_beats: 4, bpm: 120, datum: '2026-01-01' }; }), /not several/);
});

test('one group per place; place n and module slot n exclude each other', () => {
  assert.match(mut(1, (p) => { p.gruppen.push({ ...kopie(p.gruppen[0]), id: 'g9', nr: 9 }); }), /duplicate/);
  assert.match(mut(1, (p) => {
    p.gruppen.push({ id: 'g9', nr: 9, name: 'M', farbe: '#112233', fader_db: 0, pan: 0, mute: false, solo: false, gefaltet: false,
      modul: { quelle_sha256: SHA, titel: 't', fassung: 'f', basis_bpm: 120, von_beat: 0, laenge_beats: 4, bpm: 120, datum: '2026-01-01', slot: 'A' } });
  }), /module slot/);
  // slot B does not collide with place 1
  assert.equal(mut(1, (p) => {
    p.gruppen.push({ id: 'g9', nr: 9, name: 'M', farbe: '#112233', fader_db: 0, pan: 0, mute: false, solo: false, gefaltet: false,
      modul: { quelle_sha256: SHA, titel: 't', fassung: 'f', basis_bpm: 120, von_beat: 0, laenge_beats: 4, bpm: 120, datum: '2026-01-01', slot: 'B' } });
  }), null);
});

test('exactly 4 audio member tracks without clips', () => {
  assert.match(mut(1, (p) => { p.spuren[3].ausgang = undefined; delete p.spuren[3].ausgang; }), /exactly 4 member tracks/);
  assert.match(mut(1, (p) => { p.spuren[3].art = 'instrument'; p.spuren[3].geraet = { art: 'intern', name: 'bk', graph: 'drums-909', parameter: {} }; delete p.spuren[3].zellen; }), /not an audio track/);
  assert.match(mut(1, (p) => { p.spuren[0].clips.push({ id: 'c1', art: 'audio', name: 'c1', start_beat: 0, laenge_beats: 4, quelle: { sha256: SHA, pfad_hinweis: '' }, dekodiert: 'nein', offset_s: 0, gain_db: 0, fade_ein_beats: 0, fade_aus_beats: 0 }); }), /has clips/);
});

test('zellen: exactly 8 entries, each null or a valid cell', () => {
  assert.match(mut(1, (p) => { p.spuren[0].zellen.pop(); }), /array of 8/);
  const bad = (f) => mut(1, (p) => { p.spuren[0].zellen[0] = zelle('z1'); f(p.spuren[0].zellen[0]); });
  assert.match(bad((z) => { z.name = ''; }), /name/);
  assert.match(bad((z) => { z.name = 'x'.repeat(65); }), /name/);
  assert.match(bad((z) => { z.farbe = 16; }), /farbe/);
  assert.match(bad((z) => { z.farbe = 1.5; }), /farbe/);
  assert.match(bad((z) => { z.sha256 = 'abc'; }), /sha256/);
  assert.match(bad((z) => { delete z.beats; }), /beats/);
  assert.match(bad((z) => { z.beats = 0.1; }), /beats/);
  assert.match(bad((z) => { z.beats = 4.1; }), /multiple of 0.25/);
  assert.match(bad((z) => { z.beats = 64.25; }), /beats/);
  assert.match(bad((z) => { delete z.bpm; }), /bpm/);
  assert.match(bad((z) => { z.bpm = 59; }), /bpm/);
  assert.match(bad((z) => { z.gain_db = 13; }), /gain_db/);
  assert.match(bad((z) => { z.gain_db = -61; }), /gain_db/);
  assert.match(bad((z) => { z.pfad_hinweis = '../x.wav'; }), /pfad_hinweis/);
  assert.match(bad((z) => { z.pfad_hinweis = '/abs/x.wav'; }), /pfad_hinweis/);
  assert.equal(bad((z) => { z.beats = 64; z.pfad_hinweis = 'audio/x.wav'; }), null);
});

test('zellen and filter are refused on other tracks; filter range', () => {
  const plain = () => { let p = neuesProjekt('x'); p.live = true; p = lauf(p, { befehl: 'spur_neu', art: 'audio', name: 'A' }); return kopie(p); };
  let p = plain(); p.spuren[0].zellen = Array.from({ length: 8 }, () => null);
  assert.match(fehler(p), /only on a track of a loop deck group/);
  p = plain(); p.spuren[0].filter = 0.5;
  assert.match(fehler(p), /only on a track of a loop deck group/);
  assert.match(mut(1, (q) => { q.spuren[0].filter = 1.5; }), /filter/);
});

test('cell ids are unique in the project; neueId knows the counter zelle', () => {
  assert.match(mut(1, (p) => { p.spuren[0].zellen[0] = zelle('z1'); p.spuren[2].zellen[5] = zelle('z1'); }), /duplicate/);
  const p = deck(1); p.spuren[0].zellen[0] = zelle('z4');
  assert.equal(neueId(p, 'zelle'), 'z5');
  assert.equal(p.naechste_id.zelle, 6);
  assert.equal(fehler(p), null);
  p.naechste_id.zelle = 0;
  assert.match(fehler(p), /naechste_id\.zelle/);
});

test('spurSicht includes zellen, omits filter (a control row) and omits zellen when absent', () => {
  const p = deck(1); p.spuren[0].zellen[0] = zelle('z1'); p.spuren[0].filter = 0.25;
  const s = spurSicht(p.spuren[0]);
  assert.equal(s.zellen.length, 8); assert.ok(!('filter' in s), 'the filter is not playback');
  const q = spurSicht(neuesSpur());
  assert.ok(!('zellen' in q) && !('filter' in q));
  function neuesSpur() { const x = lauf(neuesProjekt('y'), { befehl: 'spur_neu', art: 'audio', name: 'A' }); return x.spuren[0]; }
});

test('a project without loop decks validates exactly as before', () => {
  let p = neuesProjekt('plain');
  p = lauf(p, { befehl: 'spur_neu', art: 'audio', name: 'A' }, { befehl: 'gruppenspur_neu', name: 'G' });
  const u = pruefeProjekt(kopie(p));
  assert.ok('projekt' in u, JSON.stringify(u));
  assert.deepEqual(u.projekt.spuren.map((s) => Object.keys(s).sort()), p.spuren.map((s) => Object.keys(s).sort()));
  assert.ok(!('zelle' in u.projekt.naechste_id));
  assert.ok(!('zellen' in spurSicht(u.projekt.spuren[0])));
});

test('loopdeck.ausgang_platz: optional 1..4; two loop decks never share a channel; a module slot or an unmuted SEQ deck on the channel excludes the deck', () => {
  assert.equal(mut(1, (p) => { p.gruppen[0].loopdeck.ausgang_platz = 4; }), null);
  assert.match(mut(1, (p) => { p.gruppen[0].loopdeck.ausgang_platz = 5; }), /1\.\.4 expected/);
  assert.match(mut(1, (p) => { p.gruppen[0].loopdeck.ausgang_platz = 'a'; }), /1\.\.4 expected/);
  const zwei = (a1, a2) => {
    let p = deck(1); p = lauf(p, ...[1, 2, 3, 4].map((i) => ({ befehl: 'spur_neu', art: 'audio', name: `L2.${i}` })));
    p = lauf(p, { befehl: 'gruppenspur_neu', name: 'LOOP 2', mitglieder: p.spuren.slice(4).map((s) => s.id) });
    p = kopie(p);
    p.gruppen[1].loopdeck = { platz: 2, raster: 'takt' };
    for (const s of p.spuren.slice(4)) s.zellen = Array.from({ length: 8 }, () => null);
    if (a1) p.gruppen[0].loopdeck.ausgang_platz = a1;
    if (a2) p.gruppen[1].loopdeck.ausgang_platz = a2;
    return fehler(p);
  };
  assert.equal(zwei(), null);
  assert.equal(zwei(4, 3), null, 'swapped pads');
  assert.equal(zwei(1, 2), null, 'both on the top row (deck/1, deck/2)');
  assert.match(zwei(4, null), /duplicate \(place 4\)/, 'deck 1 on place 4 and deck 2 on its default (4)');
  assert.match(zwei(null, 3), /duplicate \(place 3\)/);
  assert.match(mut(1, (p) => {   // deck 1 on place 4 = pad/2, module slot B = pad/2
    p.gruppen[0].loopdeck.ausgang_platz = 4;
    p.gruppen.push({ id: 'g9', nr: 9, name: 'M', farbe: '#112233', fader_db: 0, pan: 0, mute: false, solo: false, gefaltet: false,
      modul: { quelle_sha256: SHA, titel: 't', fassung: 'f', basis_bpm: 120, von_beat: 0, laenge_beats: 4, bpm: 120, datum: '2026-01-01', slot: 'B' } });
  }), /channel 2 is taken by a module slot/);
  // a SEQ deck on place 1 (deck/1) and a loop deck shown in place 1: refused; a muted (parked) SEQ deck does not count
  const seq = (mute) => mut(1, (p) => {
    p.gruppen[0].loopdeck.ausgang_platz = 1;
    p.gruppen.push({ id: 'g9', nr: 9, name: 'S', farbe: '#112233', fader_db: 0, pan: 0, mute, solo: false, gefaltet: false, seq: { schema: 2, platz: 1 } });
  });
  assert.match(seq(false), /channel 3 is taken by a SEQ deck/);
  assert.equal(seq(true), null);
});
