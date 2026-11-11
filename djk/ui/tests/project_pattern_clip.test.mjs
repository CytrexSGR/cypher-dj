// strudel-clip: the command clip_aus_muster (project/commands.ts) with the real Strudel side (generator/src/pattern_ereignisse.mjs) and the mapping table.
// Expected numbers are worked out by hand: velocity = round(127 * v), RB-338 cutoff 800 Hz = the plugin default, pan p in 0..1 -> 2p - 1, gain g -> 20 log10 g dB.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreListeAus, BefehlFehler } from '../project/commands.ts';
import { pruefeProjekt, kanonisch } from '../project/model.ts';
import { wende } from '../project/patch.ts';
import { rbNorm } from '../project/rb_mapping.ts';
import { musterZuEreignissen } from '../../generator/src/pattern_ereignisse.mjs';
import { specProjekt, kopie, ohneAbgeleitetes } from './support/project.mjs';

// a small kit in the shape of kit.json: bd:0..2 on notes 0..2, hh:0..1 on 3..4 (a bank of one: sd on 5)
const KLAENGE = [['bd:0', 0], ['bd:1', 1], ['bd:2', 2], ['hh:0', 3], ['hh:1', 4], ['sd:0', 5]].map(([name, note]) => ({ name, note }));
const kitKlaenge = (n) => (n === 'minikit' ? KLAENGE : null);
const meldungen = [];
const ctx = { musterUebersetze: musterZuEreignissen, kitKlaenge, musterMeldung: (m) => meldungen.push(m) };

function projekt() {
  const p = specProjekt(); p.format = 'cypherdj-projekt/2'; p.gruppen = []; p.master = { fader_db: 0 };
  p.spuren[1].geraet = { art: 'intern', name: 'rb338', parameter: {} };   // s2 = RB-338 bass
  p.spuren.push({ id: 's4', nr: 4, name: 'Kit', farbe: '#3b8de0', art: 'instrument', geraet: { art: 'intern', name: 'kit', kit: 'minikit' },
    fader_db: 0, pan: 0, mute: false, solo: false, clips: [] });
  return p;
}
const lauf = (p, befehle) => fuehreListeAus(p, befehle, ctx);
const clipVon = (r, spur) => r.projekt.spuren.find((s) => s.id === spur).clips.at(-1);
const lehntAb = (fn, grund, text) => assert.throws(fn, (e) => e instanceof BefehlFehler && e.grund === grund && (!text || text.test(e.detail)), `expected ${grund}: ${text ?? ''}`);
const nah = (a, b, eps = 1e-4) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const ohneId = (c) => ({ ...c, id: undefined, noten: c.noten.map((n) => ({ ...n, id: undefined })) });

test('kit track: s("bd*4, ~ hh ~ hh") puts bd (note 0) on every beat and hh (note 3) on beats 1 and 3, full velocity, one bar, origin stored', () => {
  const p = projekt();
  const r = lauf(p, [{ befehl: 'clip_aus_muster', spur_id: 's4', start_beat: 8, code: 's("bd*4, ~ hh ~ hh")' }]);
  const c = clipVon(r, 's4');
  assert.equal(c.art, 'midi'); assert.equal(c.start_beat, 8); assert.equal(c.laenge_beats, 4); assert.equal(c.loop_beats, undefined);
  const raster = c.noten.map((n) => [n.beat, n.ton, n.laenge, n.vel]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  assert.deepEqual(raster, [[0, 0, 1, 127], [1, 0, 1, 127], [1, 3, 1, 127], [2, 0, 1, 127], [3, 0, 1, 127], [3, 3, 1, 127]]);
  assert.equal(c.muster.code, 's("bd*4, ~ hh ~ hh")'); assert.match(c.muster.abdruck, /^[0-9a-f]{32}$/);
  assert.ok('projekt' in pruefeProjekt(JSON.parse(JSON.stringify(r.projekt))), 'the project with the generated clip is valid');
  // one undo step: the reverse patch gives the old project back
  assert.deepEqual(ohneAbgeleitetes(wende(r.projekt, r.zurueck)), ohneAbgeleitetes(p));
});

test('kit sounds: bd:2 is the third bd, a number beyond the bank wraps like in the studio (hh:3 of two hh = hh:1), a bank of one ignores n', () => {
  const c = clipVon(lauf(projekt(), [{ befehl: 'clip_aus_muster', spur_id: 's4', start_beat: 0, code: 's("bd:2 hh:3 sd:7 bd")' }]), 's4');
  assert.deepEqual(c.noten.map((n) => n.ton), [2, 4, 5, 0]);
});

test('kit track: gain wins over velocity like in the studio (gain ?? velocity ?? 1): gain 0.5 gives 64', () => {
  const c = clipVon(lauf(projekt(), [{ befehl: 'clip_aus_muster', spur_id: 's4', start_beat: 0, code: 's("bd hh:1").gain("<0.5>")' }]), 's4');
  assert.deepEqual(c.noten.map((n) => n.vel), [64, 64]);   // round(0.5 * 127) = 64 (63.5 rounds up)
});

test('RB-338 track: note("gs1 ~ gs1 b1").velocity("<0.8 1>") is G#1 = 32 and B1 = 35 over two bars, velocity 102 then 127', () => {
  const c = clipVon(lauf(projekt(), [{ befehl: 'clip_aus_muster', spur_id: 's2', start_beat: 16, code: 'note("gs1 ~ gs1 b1").velocity("<0.8 1>")' }]), 's2');
  assert.equal(c.laenge_beats, 8);
  assert.deepEqual(c.noten.map((n) => [n.beat, n.ton, n.vel]), [[0, 32, 102], [2, 32, 102], [3, 35, 102], [4, 32, 127], [6, 32, 127], [7, 35, 127]]);
});

test('instrument velocity defaults like the studio MIDI path: no velocity = 0.9 gives 114, velocity times gain', () => {
  const c = clipVon(lauf(projekt(), [{ befehl: 'clip_aus_muster', spur_id: 's2', start_beat: 16, code: 'note("c3 e3").gain("<0.5 1>").velocity("<1 0.5>")' }]), 's2');
  assert.deepEqual(c.noten.map((n) => n.vel), [64, 64, 64, 64]);   // 1 * 0.5 -> 64 ; 0.5 * 1 ... both rounds to 64 (63.5)
  const d = clipVon(lauf(projekt(), [{ befehl: 'clip_aus_muster', spur_id: 's2', start_beat: 40, code: 'note("c3")' }]), 's2');
  assert.equal(d.noten[0].vel, 114);   // round(0.9 * 127) = 114
});

test('takte longer than the repetition: a loop is set and only one period of notes is written', () => {
  const c = clipVon(lauf(projekt(), [{ befehl: 'clip_aus_muster', spur_id: 's2', start_beat: 0, takte: 4, code: 'note("c3 e3")' }]), 's2');
  assert.equal(c.laenge_beats, 16); assert.equal(c.loop_beats, 4);
  assert.deepEqual(c.noten.map((n) => [n.beat, n.ton, n.laenge]), [[0, 48, 2], [2, 52, 2]]);
});

test('without takte the clip is as long as the pattern takes to repeat: <c3 e3> is two bars, no loop needed', () => {
  const c = clipVon(lauf(projekt(), [{ befehl: 'clip_aus_muster', spur_id: 's2', start_beat: 0, code: 'note("<c3 e3>")' }]), 's2');
  assert.equal(c.laenge_beats, 8); assert.equal(c.loop_beats, undefined);
  assert.deepEqual(c.noten.map((n) => [n.beat, n.ton, n.laenge]), [[0, 48, 4], [4, 52, 4]]);
});

test('refusals: a sound the kit lacks lists the sounds it has; s() on a synth, note() on a kit, an audio track, a broken pattern (line), nothing is created', () => {
  const p = projekt();
  lehntAb(() => lauf(p, [{ befehl: 'clip_aus_muster', spur_id: 's4', start_beat: 0, code: 's("bd cowbell")' }]), 'klang_unbekannt', /"cowbell".*minikit.*bd:0-2, hh:0-1, sd/);
  lehntAb(() => lauf(p, [{ befehl: 'clip_aus_muster', spur_id: 's2', start_beat: 0, code: 's("bd hh")' }]), 'muster_ziel_passt_nicht', /kit track/);
  lehntAb(() => lauf(p, [{ befehl: 'clip_aus_muster', spur_id: 's4', start_beat: 0, code: 'note("c3 e3")' }]), 'muster_ziel_passt_nicht', /sound name/);
  lehntAb(() => lauf(p, [{ befehl: 'clip_aus_muster', spur_id: 's1', start_beat: 0, code: 's("bd")' }]), 'art_passt_nicht');
  lehntAb(() => lauf(p, [{ befehl: 'clip_aus_muster', spur_id: 's2', start_beat: 0, code: 'note("c3 e3")\n.add(' }]), 'muster_fehler', /^Zeile 2/);
  lehntAb(() => lauf(p, [{ befehl: 'clip_aus_muster', spur_id: 's2', start_beat: 0, code: 'note("c3")\n.fooBar(1)' }]), 'muster_fehler', /^Zeile 2, Spalte \d+: .*fooBar/);
  lehntAb(() => lauf(p, [{ befehl: 'clip_aus_muster', spur_id: 's9', start_beat: 0, code: 's("bd")' }]), 'spur_unbekannt');
  lehntAb(() => lauf(p, [{ befehl: 'clip_aus_muster', spur_id: 's2', clip_id: 'c2', code: 'note("c3")' }]), 'argument_ungueltig');
  lehntAb(() => lauf(p, [{ befehl: 'clip_aus_muster', spur_id: 's2', start_beat: 0 }]), 'argument_ungueltig');
  lehntAb(() => lauf(p, [{ befehl: 'clip_aus_muster', spur_id: 's2', start_beat: 0, code: 'note("c3")', takte: -1 }]), 'argument_ungueltig');
  lehntAb(() => lauf(p, [{ befehl: 'clip_aus_muster', spur_id: 's2', start_beat: 0, code: 'note("c3")', foo: 1 }]), 'argument_unbekannt');
  // the whole list is void when one command fails (all or nothing): the first command's clip does not stay
  lehntAb(() => lauf(p, [{ befehl: 'clip_aus_muster', spur_id: 's2', start_beat: 0, code: 'note("c3")' }, { befehl: 'clip_aus_muster', spur_id: 's2', start_beat: 8, code: 'note(' }]), 'muster_fehler');
  assert.equal(p.spuren[1].clips.length, 1, 'the input project is untouched');
});

test('a kit track whose kit is unknown to the server is kit_unbekannt; a server without translator refuses clearly', () => {
  const p = projekt(); p.spuren[3].geraet.kit = 'fehlt';
  lehntAb(() => lauf(p, [{ befehl: 'clip_aus_muster', spur_id: 's4', start_beat: 0, code: 's("bd")' }]), 'kit_unbekannt');
  lehntAb(() => fuehreListeAus(projekt(), [{ befehl: 'clip_aus_muster', spur_id: 's2', start_beat: 0, code: 'note("c3")' }], {}), 'muster_nicht_verfuegbar');
});

test('cutoff on an RB-338 clip: 800 Hz is the track value, so the envelope is 0 there; 5000 Hz is norm 1, relative to the track value; points are steps', () => {
  const c = clipVon(lauf(projekt(), [{ befehl: 'clip_aus_muster', spur_id: 's2', start_beat: 0, code: 'note("c3 e3 g3").cutoff("800 5000 40")' }]), 's2');
  assert.equal(c.huellkurven.length, 1);
  const h = c.huellkurven[0];
  assert.equal(h.ziel, 'geraet.cutoff');
  const basis = rbNorm('cutoff', 800);
  nah(h.punkte[0].wert, 0); nah(h.punkte[1].wert, 1 - basis); nah(h.punkte[2].wert, 0 - basis);
  assert.deepEqual(h.punkte.map((q) => q.form), [undefined, 'sprung', 'sprung']);
  nah(h.punkte[1].beat, 4 / 3, 1e-5);
});

test('cutoff signal: sine.range(200,2000).slow(4) becomes linear points at the note starts (no form key), and lpf is the same field', () => {
  const c = clipVon(lauf(projekt(), [{ befehl: 'clip_aus_muster', spur_id: 's2', start_beat: 0, code: 'note("c3*4").lpf(sine.range(200,2000).slow(4))' }]), 's2');
  const h = c.huellkurven[0];
  assert.equal(c.laenge_beats, 16);
  assert.equal(h.punkte.length, 16);
  assert.ok(h.punkte.every((q) => q.form === undefined), 'a continuous control has linear segments');
  // bar position 0: sin 0 -> 1100 Hz; bar 1 start (beat 4): sin(pi/2) -> 2000 Hz
  nah(h.punkte[0].wert, rbNorm('cutoff', 1100) - rbNorm('cutoff', 800));
  nah(h.punkte[4].wert, rbNorm('cutoff', 2000) - rbNorm('cutoff', 800));
});

test('pan: 0..1 maps to -1..1 relative to the track pan; a track at pan 0.5 shifts the envelope by that', () => {
  const p = projekt();
  const c = clipVon(lauf(p, [{ befehl: 'clip_aus_muster', spur_id: 's2', start_beat: 0, code: 'note("c3 e3").pan("<0 1>")' }]), 's2');
  assert.equal(c.huellkurven[0].ziel, 'spur_pan');
  assert.deepEqual(c.huellkurven[0].punkte.map((q) => q.wert), [-1, -1, 1, 1]);   // four notes over two bars: bar 0 pan 0 -> -1, bar 1 pan 1 -> +1
  p.spuren[1].pan = 0.5;
  const d = clipVon(lauf(p, [{ befehl: 'clip_aus_muster', spur_id: 's2', start_beat: 0, code: 'note("c3 e3").pan("<0 1>")' }]), 's2');
  assert.deepEqual(d.huellkurven[0].punkte.map((q) => q.wert), [-1.5, -1.5, 0.5, 0.5]);   // -1 - 0.5 and 1 - 0.5
});

test('gain as a continuous signal becomes a spur_fader envelope in dB (the notes then keep full velocity); a patterned gain stays per note', () => {
  const c = clipVon(lauf(projekt(), [{ befehl: 'clip_aus_muster', spur_id: 's4', start_beat: 0, code: 's("bd*4").gain(sine.range(0.5,1).slow(4))' }]), 's4');
  assert.equal(c.noten.length, 16); assert.ok(c.noten.every((n) => n.vel === 127));   // four bars of four hits
  const h = c.huellkurven[0];
  assert.equal(h.ziel, 'spur_fader');
  nah(h.punkte[0].wert, 20 * Math.log10(0.75), 1e-3);   // sine at 0 is the middle of the range: 0.75
  const k = clipVon(lauf(projekt(), [{ befehl: 'clip_aus_muster', spur_id: 's4', start_beat: 0, code: 's("bd*2").gain("<0.5 1>")' }]), 's4');
  assert.equal(k.huellkurven, undefined);
  assert.equal(k.muster.ohne_ziel, undefined);
});

test('fields without a target are reported, not swallowed: room, delay, s on an instrument; cutoff on a kit track (no RB-338)', () => {
  meldungen.length = 0;
  const a = clipVon(lauf(projekt(), [{ befehl: 'clip_aus_muster', spur_id: 's2', start_beat: 0, code: 'note("c3").s("sawtooth").room(0.4).delay(0.2)' }]), 's2');
  assert.deepEqual(a.muster.ohne_ziel, ['delay', 'room', 's']);
  assert.deepEqual(meldungen.at(-1).ohne_ziel, ['delay', 'room', 's']);
  const k = clipVon(lauf(projekt(), [{ befehl: 'clip_aus_muster', spur_id: 's4', start_beat: 0, code: 's("bd").lpf(900).pan(0.2)' }]), 's4');
  assert.deepEqual(k.muster.ohne_ziel, ['cutoff']);
  assert.equal(k.huellkurven.length, 1);                       // pan has a target on every track
  assert.ok(meldungen.at(-1).hinweise.some((h) => /geraet\.cutoff.*RB-338/.test(h)));
  assert.deepEqual(meldungen.at(-1).huellkurven, ['spur_pan']);
});

test('generating again from the origin gives the same clip (same notes, loop, envelopes); hand edits are replaced when asked for; the clip keeps id and place', () => {
  const p = projekt();
  const code = 'note("c3 e3 g3").cutoff(sine.range(300,3000).slow(2)).room(0.3)';
  const r1 = lauf(p, [{ befehl: 'clip_aus_muster', spur_id: 's2', start_beat: 4, takte: 6, code }]);
  const c1 = clipVon(r1, 's2');
  assert.equal(c1.loop_beats, 8);
  const edit = lauf(r1.projekt, [{ befehl: 'noten_loeschen', clip_id: c1.id, ids: c1.noten.slice(0, 2).map((n) => n.id) }, { befehl: 'clip_aendern', clip_id: c1.id, start_beat: 12 }]);
  assert.equal(clipVon(edit, 's2').noten.length, c1.noten.length - 2);
  lehntAb(() => lauf(edit.projekt, [{ befehl: 'clip_aus_muster', clip_id: c1.id }]), 'handarbeit_vorhanden', /changed by hand/);
  const r2 = lauf(edit.projekt, [{ befehl: 'clip_aus_muster', clip_id: c1.id, ueberschreiben: true }]);
  const c2 = clipVon(r2, 's2');
  assert.equal(c2.id, c1.id); assert.equal(c2.start_beat, 12);
  assert.deepEqual(ohneId({ ...c2, start_beat: 4 }), ohneId(c1));
  assert.equal(r2.projekt.spuren[1].clips.length, r1.projekt.spuren[1].clips.length, 'no second clip');
  // a clip without origin cannot be generated again without code; with code it takes the pattern over and keeps its length
  lehntAb(() => lauf(p, [{ befehl: 'clip_aus_muster', clip_id: 'c2' }]), 'muster_fehlt');
  const r3 = lauf(p, [{ befehl: 'clip_aus_muster', clip_id: 'c2', code: 'note("c3 e3")' }]);
  const c3 = r3.projekt.spuren[1].clips[0];
  assert.equal(c3.laenge_beats, 16); assert.equal(c3.loop_beats, 4); assert.equal(c3.muster.code, 'note("c3 e3")');
});

test('clip_teilen drops the origin of both halves (a cut clip is no longer what the pattern makes); clip_duplizieren keeps it', () => {
  const r = lauf(projekt(), [{ befehl: 'clip_aus_muster', spur_id: 's2', start_beat: 16, code: 'note("c3 e3 g3 c4")' }]);
  const id = clipVon(r, 's2').id;
  const t = lauf(r.projekt, [{ befehl: 'clip_teilen', clip_id: id, beat: 18 }]);
  const clips = t.projekt.spuren[1].clips.filter((c) => c.start_beat >= 16);
  assert.equal(clips.length, 2);
  assert.ok(clips.every((c) => c.muster === undefined));
  const d = lauf(r.projekt, [{ befehl: 'clip_duplizieren', clip_id: id }]);
  assert.ok(d.projekt.spuren[1].clips.filter((c) => c.start_beat >= 16).every((c) => c.muster?.code === 'note("c3 e3 g3 c4")'));
});

test('one list, several patterns, one step: a kit clip and a bass clip together, the report names each', () => {
  meldungen.length = 0;
  const r = lauf(projekt(), [
    { befehl: 'clip_aus_muster', spur_id: 's4', start_beat: 0, code: 's("bd*4")' },
    { befehl: 'clip_aus_muster', spur_id: 's2', start_beat: 16, code: 'note("c2*4").cutoff(1200)' },
  ]);
  assert.equal(meldungen.length, 2);
  assert.deepEqual(meldungen.map((m) => [m.spur_id, m.noten_zahl, m.takte, m.loop_beats]), [['s4', 4, 1, null], ['s2', 4, 1, null]]);
  assert.ok(r.vor.length > 0);
});

test('model: muster is checked on load (code text, ohne_ziel list, no foreign key)', () => {
  const r = lauf(projekt(), [{ befehl: 'clip_aus_muster', spur_id: 's2', start_beat: 16, code: 'note("c3")' }]);
  const ok = JSON.parse(JSON.stringify(r.projekt));
  assert.ok('projekt' in pruefeProjekt(ok));
  for (const kaputt of [{ code: '' }, { code: 'x', foo: 1 }, { code: 'x', ohne_ziel: [] }, { code: 'x', ohne_ziel: [3] }, 'text']) {
    const q = kopie(ok); q.spuren[1].clips.at(-1).muster = kaputt;
    assert.ok(!('projekt' in pruefeProjekt(q)), JSON.stringify(kaputt));
  }
  const eins = kopie(ok); eins.format = 'cypherdj-projekt/1';
  assert.ok(!('projekt' in pruefeProjekt(eins)), 'muster exists only from /2 on');
});

test('hand work is not replaced silently: a changed note, a changed or added envelope, a new pattern over it all refuse; ueberschreiben replaces; an untouched or only moved clip generates again', () => {
  const p = projekt();
  const code = 'note("c3 e3 g3 c4").cutoff(sine.range(300,3000).slow(2))';
  const r1 = lauf(p, [{ befehl: 'clip_aus_muster', spur_id: 's2', start_beat: 0, takte: 2, code }]);
  const c = clipVon(r1, 's2');
  // untouched: generates again without the flag; moving or resizing the clip is no hand work on notes or envelopes
  lauf(r1.projekt, [{ befehl: 'clip_aus_muster', clip_id: c.id }]);
  const verschoben = lauf(r1.projekt, [{ befehl: 'clip_aendern', clip_id: c.id, start_beat: 32 }]);
  lauf(verschoben.projekt, [{ befehl: 'clip_aus_muster', clip_id: c.id }]);
  // each kind of hand work
  const edits = {
    'a note is changed': [{ befehl: 'noten_aendern', clip_id: c.id, noten: [{ id: c.noten[0].id, ton: c.noten[0].ton + 2 }] }],
    'a note is added': [{ befehl: 'noten_neu', clip_id: c.id, noten: [{ beat: 3.5, laenge: 0.25, ton: 60, vel: 90 }] }],
    'an envelope is added': [{ befehl: 'huellkurve_setzen', clip_id: c.id, ziel: 'spur_pan', punkte: [{ beat: 0, wert: 0.2 }, { beat: 4, wert: -0.2 }] }],
    'the generated envelope is deleted': [{ befehl: 'huellkurve_loeschen', clip_id: c.id, ziel: 'geraet.cutoff' }],
  };
  for (const [was, b] of Object.entries(edits)) {
    let e;
    try { e = lauf(r1.projekt, b); } catch (x) { assert.fail(`${was}: the edit command itself failed: ${x.grund} ${x.detail}`); }
    lehntAb(() => lauf(e.projekt, [{ befehl: 'clip_aus_muster', clip_id: c.id }]), 'handarbeit_vorhanden', /changed by hand/);
    lehntAb(() => lauf(e.projekt, [{ befehl: 'clip_aus_muster', clip_id: c.id, code: 'note("c3")' }]), 'handarbeit_vorhanden');
    const neu = lauf(e.projekt, [{ befehl: 'clip_aus_muster', clip_id: c.id, ueberschreiben: true }]);
    assert.deepEqual(ohneId(clipVon(neu, 's2')), ohneId(c), `${was}: replaced by the pattern again`);
  }
  lehntAb(() => lauf(r1.projekt, [{ befehl: 'clip_aus_muster', clip_id: c.id, ueberschreiben: 'ja' }]), 'argument_ungueltig');
  // a duplicate carries the same fingerprint: it generates again without the flag
  const d = lauf(r1.projekt, [{ befehl: 'clip_duplizieren', clip_id: c.id, ziel_beat: 64 }]);
  const kopieClip = d.projekt.spuren[1].clips.find((x) => x.id !== c.id && x.muster);
  lauf(d.projekt, [{ befehl: 'clip_aus_muster', clip_id: kopieClip.id }]);
  // the project with the fingerprint on it is valid, and a malformed fingerprint is not
  assert.ok('projekt' in pruefeProjekt(JSON.parse(JSON.stringify(r1.projekt))));
  const q = kopie(JSON.parse(JSON.stringify(r1.projekt))); q.spuren[1].clips.at(-1).muster.abdruck = 'zz';
  assert.ok(!('projekt' in pruefeProjekt(q)), 'a malformed fingerprint is refused on load');
});

test('notes that touch end exactly where the next begins: beat and end are rounded together (no 1e-6 overlap) for thirteenths and slow triplets', () => {
  for (const [code, mindestens] of [['note("c3 c3 c3 c3 c3 c3 c3 c3 c3 c3 c3 c3 c3")', 13], ['note("c3*3").slow(1.7)', 15], ['note("c3 c3 c3 c3 c3 c3 c3").slow(3)', 7]]) {
    const c = clipVon(lauf(projekt(), [{ befehl: 'clip_aus_muster', spur_id: 's2', start_beat: 0, takte: 8, code }]), 's2');
    const n = [...c.noten].sort((x, y) => x.beat - y.beat);
    assert.ok(n.length >= mindestens, `${code}: ${n.length} notes`);
    for (let i = 1; i < n.length; i++) assert.ok(n[i - 1].beat + n[i - 1].laenge <= n[i].beat + 1e-9, `${code}: overlap at note ${i}: ${n[i - 1].beat} + ${n[i - 1].laenge} > ${n[i].beat}`);
  }
});
