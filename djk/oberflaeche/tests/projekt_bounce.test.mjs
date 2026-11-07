// Package 1.14 slice 4 (bounce, N08), unit U1b: regler file and render snapshot (R5, D3), the new state per art (R7 to R9, D6, D7) and the
// freshness check after the render (R6). Pure model, no server, no core.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreListeAus } from '../projekt/befehle.ts';
import { neuesProjekt, pruefeFehler, MAX_SPUREN, sucheSpur } from '../projekt/modell.ts';
import { mergeRegler, mergeWiedergabe, PAN_MITTE_DB } from '../projekt/zusammenfuehren.ts';
import { bouncePlan, bounceRegler, bounceWiedergabe, baueBounceProjekt, pruefeBounceNochGleich, BOUNCE_LANE_NAME } from '../projekt/bounce.ts';

const SHA = 'c'.repeat(64), NEU = 'd'.repeat(64);
const DATEI = { sha256: NEU, pfad: '/tmp/projekt/bounce/bounce-7.wav' };
const lauf = (p, b, quelle = 'andreas') => fuehreListeAus(p, b, { quelle }).projekt;
const spur = (p, id) => sucheSpur(p, id);
const alleClipIds = (p) => p.spuren.flatMap((s) => [...s.clips, ...(s.takes ?? []).flatMap((t) => t.clips)].map((c) => c.id));

// s1 Kick (audio, fader -4.5, pan -0.6, a fader lane, a send to return r1, in group g1, two clips and one take lane), s2 Bass (audio, g1),
// s3 Lead (audio, master), s4 Ziel (audio, empty target)
function projekt() {
  let p = neuesProjekt('T');
  p = lauf(p, ['Kick', 'Bass', 'Lead', 'Ziel'].map((name) => ({ befehl: 'spur_neu', art: 'audio', name })));
  p = lauf(p, [
    { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 8, sha256: SHA, name: 'k1' },
    { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 10, laenge_beats: 6, sha256: SHA, name: 'k2' },
    { befehl: 'clip_neu', spur_id: 's2', art: 'audio', start_beat: 0, laenge_beats: 16, sha256: SHA, name: 'b' },
    { befehl: 'clip_neu', spur_id: 's3', art: 'audio', start_beat: 0, laenge_beats: 8, sha256: SHA, name: 'l' },
  ]);
  p = lauf(p, [{ befehl: 'clip_aendern', clip_id: 'c1', gain_db: -4, fade_ein_beats: 1 }, { befehl: 'clip_aendern', clip_id: 'c2', offset_s: 0.5 }]);
  p = lauf(p, [{ befehl: 'gruppenspur_neu', name: 'G', mitglieder: ['s1', 's2'] }, { befehl: 'gruppenspur_aendern', gruppe_id: 'g1', fader_db: -3 }]);
  p = lauf(p, [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -4.5, pan: -0.6 }, { befehl: 'return_neu', name: 'Hall' }]);
  p = lauf(p, [{ befehl: 'send_setzen', strang_id: 's1', return_id: 'r1', db: -6 }]);
  p = lauf(p, [{ befehl: 'auto_neu', spur_id: 's1', ziel: 'fader', punkte: [{ beat: 0, wert: -4.5 }, { beat: 8, wert: -10 }] }]);
  p = lauf(p, [{ befehl: 'take_neu', spur_id: 's1', name: 'Alt' }]);
  return p;
}
const AN_ORT = { art: 'an_ort', spur_id: 's1' };

test('1b.1 bounceRegler: an_ort is mergeRegler with the track at fader 0, pan 0, mute 0 (pre-mixer, D3); the other arts equal mergeRegler', () => {
  const p = lauf(projekt(), [{ befehl: 'spur_aendern', spur_id: 's1', mute: true }]);
  const r = bounceRegler(p, bouncePlan(p, AN_ORT, 'andreas'));
  assert.deepEqual(r, { ...mergeRegler(p, ['s1']), 'spur/1/fader': 0, 'spur/1/pan': 0, 'spur/1/mute': 0 });
  for (let n = 1; n <= MAX_SPUREN; n++) {
    assert.equal(r[`spur/${n}/mute`], n === 1 ? 0 : 1, `mute ${n}`);
    assert.equal(r[`spur/${n}/solo`], 0, `solo ${n}`);
  }
  assert.deepEqual([r['grp/1/fader'], r['grp/1/pan'], r['grp/1/mute'], r['grp/1/solo']], [0, 0, 0, 0], 'group neutral');
  assert.deepEqual([r['spur/1/send/1'], r['ret/1/mute']], [-200, 1], 'dry: send off, return muted');
  assert.equal(r['pm/fader'], undefined, 'production master neutral');
  const q = projekt();
  const n = bouncePlan(q, { art: 'neue_spur', spur_ids: ['s1'] }, 'andreas');
  assert.deepEqual(bounceRegler(q, n), mergeRegler(q, ['s1']));
  assert.equal(bounceRegler(q, n)['spur/1/fader'], -4.5, 'post-fader for neue_spur');
  const e = bouncePlan(q, { art: 'einfuegen', spur_ids: ['s1', 's3'], von_beat: 0, bis_beat: 8, ziel_spur_id: 's4', ziel_beat: 16 }, 'andreas');
  assert.deepEqual(bounceRegler(q, e), mergeRegler(q, ['s1', 's3']));
});

test('1b.1 bounceWiedergabe: only the sources; an_ort drops the lanes of the source in the copy, the input stays as it was', () => {
  const p = projekt(), vorher = structuredClone(p);
  const w = bounceWiedergabe(p, bouncePlan(p, AN_ORT, 'andreas'));
  assert.deepEqual(w.spuren.map((s) => s.id), ['s1']);
  assert.equal(w.spuren[0].automation, undefined, 'no mixer lanes in the pre-mixer render');
  assert.deepEqual(p, vorher, 'input not mutated');
  const n = bounceWiedergabe(p, bouncePlan(p, { art: 'neue_spur', spur_ids: ['s1'] }, 'andreas'));
  assert.deepEqual(n, mergeWiedergabe(p, ['s1']), 'neue_spur bakes the fader lane (post-fader)');
  assert.equal(n.spuren[0].automation.length, 1);
});

test('1b.2 baueBounceProjekt an_ort (R7): one main clip over the hull with +3.0103 dB, the old clips deep-equal in a new lane, the rest unchanged', () => {
  const p = projekt(), z = bouncePlan(p, AN_ORT, 'andreas');
  const r = baueBounceProjekt(p, z, DATEI);
  assert.equal(pruefeFehler(r.projekt), null);
  const a = spur(p, 's1'), b = spur(r.projekt, 's1');
  assert.equal(b.clips.length, 1);
  const c = b.clips[0];
  assert.deepEqual([c.id, r.clipId, r.spurId], [r.clipId, c.id, 's1']);
  assert.deepEqual([c.art, c.start_beat, c.laenge_beats, c.quelle.sha256, c.quelle.pfad_hinweis, c.name],
    ['audio', 0, 16, NEU, DATEI.pfad, 'Bounce: Kick']);
  assert.equal(c.gain_db, PAN_MITTE_DB);
  assert.ok(Math.abs(c.gain_db - 3.0103) < 1e-4);
  assert.deepEqual([c.offset_s, c.fade_ein_beats, c.fade_aus_beats, c.loop_beats ?? null], [0, 0, 0, null]);
  assert.equal(b.takes.length, 2, 'appended after the existing lane');
  assert.deepEqual(b.takes[0], a.takes[0], 'the other take lanes are deep-equal');
  assert.deepEqual(b.takes[1], { id: r.takeId, name: BOUNCE_LANE_NAME, clips: a.clips }, 'the moved clips, ids and every field');
  for (const k of ['fader_db', 'pan', 'mute', 'solo', 'ausgang', 'sends', 'automation', 'nr', 'name', 'art', 'von']) assert.deepEqual(b[k], a[k], k);
  for (const id of ['s2', 's3', 's4']) assert.deepEqual(spur(r.projekt, id), spur(p, id), id);
  assert.deepEqual([r.projekt.gruppen, r.projekt.returns, r.projekt.master], [p.gruppen, p.returns, p.master]);
  const ids = alleClipIds(r.projekt);
  assert.equal(new Set(ids).size, ids.length, 'every clip id once');
  assert.equal(r.label, 'Bounce in place Kick');
  assert.equal(r.lanesVerworfen, undefined);
  assert.deepEqual(spur(p, 's1').clips.map((x) => x.id), ['c1', 'c2'], 'input not mutated');
});

test('1b.2 baueBounceProjekt an_ort on a track without take lanes: the first lane is Before bounce', () => {
  let p = projekt(); p = lauf(p, [{ befehl: 'take_loeschen', spur_id: 's1', take_id: 't1' }]);
  const r = baueBounceProjekt(p, bouncePlan(p, AN_ORT, 'andreas'), DATEI);
  assert.deepEqual(spur(r.projekt, 's1').takes.map((t) => t.name), [BOUNCE_LANE_NAME]);
  assert.equal(pruefeFehler(r.projekt), null);
});

test('1b.2 baueBounceProjekt neue_spur with one source (R8): new track below the source, in its group, sends taken over, the source muted', () => {
  const p = projekt(), z = bouncePlan(p, { art: 'neue_spur', spur_ids: ['s1'] }, 'andreas');
  const r = baueBounceProjekt(p, z, DATEI);
  assert.equal(pruefeFehler(r.projekt), null);
  assert.deepEqual(r.projekt.spuren.map((s) => s.id), ['s1', r.spurId, 's2', 's3', 's4']);
  const n = spur(r.projekt, r.spurId);
  assert.deepEqual([n.name, n.ausgang, n.sends, n.clips.length, n.clips[0].id, n.clips[0].gain_db, n.clips[0].start_beat, n.clips[0].laenge_beats],
    ['Bounce: Kick', { art: 'gruppe', id: 'g1' }, [{ id: 'r1', db: -6 }], 1, r.clipId, PAN_MITTE_DB, 0, 16]);
  assert.equal(spur(r.projekt, 's1').mute, true);
  assert.deepEqual([r.label, r.lanesVerworfen, r.takeId], ['Bounce Kick', 0, undefined]);
});

test('1b.2 mutation guard: a moved clip id used twice is caught by pruefeFehler (the uniqueness check is live)', () => {
  const p = projekt(), r = baueBounceProjekt(p, bouncePlan(p, AN_ORT, 'andreas'), DATEI);
  const kaputt = structuredClone(r.projekt);
  spur(kaputt, 's1').clips[0].id = 'c1';
  assert.notEqual(pruefeFehler(kaputt), null);
});

// target s4 with clips [0,6), [6,10), [10,14), each with gain, fades and an offset; a take lane on the target
function zielProjekt() {
  let p = projekt();
  p = lauf(p, [
    { befehl: 'clip_neu', spur_id: 's4', art: 'audio', start_beat: 0, laenge_beats: 6, sha256: SHA, name: 'z1' },
    { befehl: 'clip_neu', spur_id: 's4', art: 'audio', start_beat: 6, laenge_beats: 4, sha256: SHA, name: 'z2' },
    { befehl: 'clip_neu', spur_id: 's4', art: 'audio', start_beat: 10, laenge_beats: 4, sha256: SHA, name: 'z3' },
  ]);
  const [z1, z2, z3] = spur(p, 's4').clips.map((c) => c.id);
  p = lauf(p, [
    { befehl: 'clip_aendern', clip_id: z1, gain_db: -2, fade_ein_beats: 5, fade_aus_beats: 1, offset_s: 0.25 },
    { befehl: 'clip_aendern', clip_id: z2, gain_db: -1, fade_ein_beats: 1, fade_aus_beats: 1, offset_s: 0.1 },
    { befehl: 'clip_aendern', clip_id: z3, gain_db: 2, fade_ein_beats: 1, fade_aus_beats: 3, offset_s: 1 },
    { befehl: 'take_neu', spur_id: 's4', name: 'Zieltake' },
  ]);
  return { p, z1, z2, z3 };
}
const EIN = { art: 'einfuegen', spur_ids: ['s1', 's3'], von_beat: 0, bis_beat: 8, ziel_spur_id: 's4', ziel_beat: 4 };

test('1b.3 baueBounceProjekt einfuegen (R9, D6): the target is cut by the clip_teilen rules and overwritten over [4,12)', () => {
  const { p, z1, z2, z3 } = zielProjekt();
  const r = baueBounceProjekt(p, bouncePlan(p, EIN, 'andreas'), DATEI);
  assert.equal(pruefeFehler(r.projekt), null);
  const vor = spur(p, 's4'), nach = spur(r.projekt, 's4');
  assert.deepEqual(nach.clips.map((c) => [c.start_beat, c.start_beat + c.laenge_beats]), [[0, 4], [4, 12], [12, 14]]);
  const [links, neu, rechts] = nach.clips;
  const alt1 = vor.clips.find((c) => c.id === z1), alt3 = vor.clips.find((c) => c.id === z3);
  assert.deepEqual([links.id, links.start_beat, links.gain_db, links.offset_s, links.fade_ein_beats, links.fade_aus_beats],
    [z1, 0, alt1.gain_db, alt1.offset_s, Math.min(alt1.fade_ein_beats, 4), 0], 'left part of [0,6)');
  assert.notEqual(rechts.id, z3, 'the right part of [10,14) has a new id');
  assert.ok(!vor.clips.some((c) => c.id === rechts.id));
  assert.deepEqual([rechts.start_beat, rechts.gain_db, rechts.fade_ein_beats, rechts.fade_aus_beats, rechts.offset_s],
    [12, alt3.gain_db, 0, Math.min(alt3.fade_aus_beats, 2), Math.round((alt3.offset_s + 2 * 60 / p.tempo_bpm) * 1e9) / 1e9], 'right part of [10,14)');
  assert.ok(!nach.clips.some((c) => c.id === z2 || c.id === z3), '[6,10) and the inner part of [10,14) are gone');
  assert.deepEqual([neu.id, neu.gain_db, neu.quelle.sha256, neu.name, neu.laenge_beats], [r.clipId, PAN_MITTE_DB, NEU, 'Bounce: Kick + Lead', 8]);
  assert.deepEqual(nach.takes, vor.takes, 'take lanes of the target unchanged');
  for (const id of ['s1', 's2', 's3']) assert.deepEqual(spur(r.projekt, id), spur(p, id), `source ${id} unchanged`);
  assert.deepEqual([r.spurId, r.label, r.takeId, r.lanesVerworfen], ['s4', 'Paste bounced audio to Ziel', undefined, undefined]);
  const ids = alleClipIds(r.projekt);
  assert.equal(new Set(ids).size, ids.length);
});

test('1b.3 negative control: paste over [6,10) exactly cuts nothing; [0,6) and [10,14) stay deep-equal', () => {
  const { p, z1, z3 } = zielProjekt();
  const r = baueBounceProjekt(p, bouncePlan(p, { ...EIN, von_beat: 0, bis_beat: 4, ziel_beat: 6 }, 'andreas'), DATEI);
  const vor = spur(p, 's4'), nach = spur(r.projekt, 's4');
  assert.deepEqual(nach.clips.map((c) => [c.start_beat, c.laenge_beats]), [[0, 6], [6, 4], [10, 4]]);
  assert.deepEqual(nach.clips[0], vor.clips.find((c) => c.id === z1));
  assert.deepEqual(nach.clips[2], vor.clips.find((c) => c.id === z3));
});

test('1b.3 paste onto an empty target and beyond its clips: one clip at ziel_beat', () => {
  const p = projekt();
  const r = baueBounceProjekt(p, bouncePlan(p, { ...EIN, ziel_beat: 32 }, 'andreas'), DATEI);
  assert.deepEqual(spur(r.projekt, 's4').clips.map((c) => [c.start_beat, c.laenge_beats, c.gain_db]), [[32, 8, PAN_MITTE_DB]]);
  assert.equal(spur(r.projekt, 's4').takes, undefined, 'no take lane appears on the target');
});

test('1b.4 pruefeBounceNochGleich (R6): changes of sources, take lanes (an_ort) and target (einfuegen) give a reason; dekodiert does not', () => {
  const p = projekt();
  const za = bouncePlan(p, AN_ORT, 'andreas');
  assert.equal(pruefeBounceNochGleich(p, za), null, 'negative control: unchanged');
  assert.equal(pruefeBounceNochGleich(lauf(p, [{ befehl: 'clip_aendern', clip_id: 'c1', gain_db: -5 }]), za), 'veraltet', 'source clip');
  assert.equal(pruefeBounceNochGleich(lauf(p, [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -1 }]), za), 'veraltet', 'source fader');
  assert.equal(pruefeBounceNochGleich(lauf(p, [{ befehl: 'take_loeschen', spur_id: 's1', take_id: 't1' }]), za), 'veraltet', 'take lane gone');
  assert.equal(pruefeBounceNochGleich(lauf(p, [{ befehl: 'take_neu', spur_id: 's1' }]), za), 'veraltet', 'take lane added');
  const dek = structuredClone(p); spur(dek, 's1').clips[0].dekodiert = 'fertig';
  assert.equal(pruefeBounceNochGleich(dek, za), null, 'a dekodiert change is no change');
  const voll = structuredClone(p);
  for (let i = 2; i <= 32; i++) spur(voll, 's1').takes.push({ id: `t${i}`, name: `T${i}`, clips: [] });
  assert.equal(pruefeBounceNochGleich(voll, za), 'takes_voll');
  assert.equal(pruefeBounceNochGleich(lauf(p, [{ befehl: 'spur_loeschen', spur_id: 's1' }]), za), 'veraltet', 'track gone');

  const zn = bouncePlan(p, { art: 'neue_spur', spur_ids: ['s1'] }, 'andreas');
  assert.equal(pruefeBounceNochGleich(p, zn), null);
  assert.equal(pruefeBounceNochGleich(lauf(p, [{ befehl: 'spur_aendern', spur_id: 's1', pan: 0 }]), zn), 'veraltet');
  const vieleSpuren = lauf(p, Array.from({ length: MAX_SPUREN - p.spuren.length }, (_, i) => ({ befehl: 'spur_neu', art: 'audio', name: `x${i}` })));
  assert.equal(pruefeBounceNochGleich(vieleSpuren, zn), 'merge_keine_spur_frei');

  const { p: q, z2 } = zielProjekt();
  const ze = bouncePlan(q, EIN, 'andreas');
  assert.equal(pruefeBounceNochGleich(q, ze), null);
  assert.equal(pruefeBounceNochGleich(lauf(q, [{ befehl: 'clip_aendern', clip_id: z2, gain_db: 0 }]), ze), 'veraltet', 'target clip');
  assert.equal(pruefeBounceNochGleich(lauf(q, [{ befehl: 'clip_aendern', clip_id: 'c4', gain_db: 1 }]), ze), 'veraltet', 'source s3 clip');
  const dekZ = structuredClone(q); spur(dekZ, 's4').clips[0].dekodiert = 'fertig';
  assert.equal(pruefeBounceNochGleich(dekZ, ze), null, 'a dekodiert change of the target is no change');
  const loop = lauf(q, [{ befehl: 'clip_aendern', clip_id: z2, loop_beats: 2 }, { befehl: 'clip_aendern', clip_id: z2, start_beat: 10 }]);
  assert.equal(pruefeBounceNochGleich(loop, ze), 'ersetzen_loop', 'a loop clip moved onto the paste edge 12');
});
