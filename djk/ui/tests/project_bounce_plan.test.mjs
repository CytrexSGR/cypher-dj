// Package 1.14 slice 4 (bounce, N08), unit U1a: the merge with one source, the hull with tolerance, bouncePlan for the three arts and its
// refusals (spec R2, R3, D4, D5, D8, D11, D12). Pure model, no server, no core.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';
import { mergePlan, MergeFehler } from '../project/merge.ts';
import { bouncePlan, huelle, BOUNCE_LANE_NAME, BOUNCE_MAX_BEATS } from '../project/bounce.ts';
import { EXPORT_MAX_BEATS } from '../areas/proj/output.ts';

const SHA = 'c'.repeat(64);
const lauf = (p, b, quelle = 'andreas') => fuehreListeAus(p, b, { quelle }).projekt;
const grund = (f) => { try { f(); } catch (e) { assert.ok(e instanceof MergeFehler, String(e)); return e.grund; } return null; };
// two audio tracks s1 (Kick), s2 (Bass) with a clip 0..16 each
function projekt(quelle = 'andreas') {
  let p = neuesProjekt('T');
  p = lauf(p, ['Kick', 'Bass'].map((name) => ({ befehl: 'spur_neu', art: 'audio', name })), quelle);
  for (const id of ['s1', 's2']) p = lauf(p, [{ befehl: 'clip_neu', spur_id: id, art: 'audio', start_beat: 0, laenge_beats: 16, sha256: SHA, name: id }], quelle);
  return p;
}

test('1a.1 mergePlan with option {min: 1, praefix}: one source is enough and the name has the prefix; without the option one track is refused', () => {
  const p = projekt();
  const z = mergePlan(p, { spur_ids: ['s1'], von_beat: 0, bis_beat: 4 }, 'andreas', { min: 1, praefix: 'Bounce: ' });
  assert.deepEqual([z.spurIds, z.name, z.index], [['s1'], 'Bounce: Kick', 1]);
  assert.equal(grund(() => mergePlan(p, { spur_ids: ['s1'], von_beat: 0, bis_beat: 4 }, 'andreas')), 'argument_ungueltig');
  assert.equal(mergePlan(p, { spur_ids: ['s1', 's2'], von_beat: 0, bis_beat: 4 }, 'andreas').name, 'Merge: Kick + Bass', 'default prefix');
  assert.equal(grund(() => mergePlan(p, { spur_ids: [], von_beat: 0, bis_beat: 4 }, 'andreas', { min: 1 })), 'argument_ungueltig', 'zero tracks');
});

const c = (start, ende) => ({ start_beat: start, laenge_beats: ende - start });
test('1a.2 hull with tolerance EPS (D4): float ends do not round one beat up, fractional edges round outwards, no clips gives null', () => {
  assert.deepEqual(huelle([c(0, 4), c(4, 8 + 1e-12)]), { von: 0, bis: 8 });
  assert.deepEqual(huelle([c(4 - 1e-12, 6), c(6, 8)]), { von: 4, bis: 8 }, 'a first start just below 4 gives 4');
  assert.deepEqual(huelle([c(0.5, 7.5)]), { von: 0, bis: 8 });
  assert.deepEqual(huelle([c(8, 8.000000000000002), c(2, 5)]), { von: 2, bis: 8 }, 'the order of the clips does not matter');
  assert.equal(huelle([]), null);
  assert.equal(BOUNCE_LANE_NAME, 'Before bounce');
  assert.equal(BOUNCE_MAX_BEATS, EXPORT_MAX_BEATS, 'the bounce range limit is the export range limit (R3)');
});

// a richer project: s1 Kick, s2 Bass in group g1; s3 Lead at master; s4 an RB-338 instrument track; s5 an empty audio track (target)
function reich(quelle = 'andreas') {
  let p = neuesProjekt('T');
  p = lauf(p, ['Kick', 'Bass', 'Lead'].map((name) => ({ befehl: 'spur_neu', art: 'audio', name })), quelle);
  p = lauf(p, [{ befehl: 'spur_neu', art: 'instrument', name: 'Acid', geraet: { art: 'intern', name: 'rb338' } }], quelle);
  p = lauf(p, [{ befehl: 'spur_neu', art: 'audio', name: 'Ziel' }], quelle);
  p = lauf(p, [{ befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0.5, laenge_beats: 7.5, sha256: SHA, name: 'k1' },
    { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 8, laenge_beats: 4, sha256: SHA, name: 'k2' },
    { befehl: 'clip_neu', spur_id: 's2', art: 'audio', start_beat: 4, laenge_beats: 16, sha256: SHA, name: 'b' },
    { befehl: 'clip_neu', spur_id: 's3', art: 'audio', start_beat: 0, laenge_beats: 4, sha256: SHA, name: 'l' },
    { befehl: 'clip_neu', spur_id: 's4', art: 'midi', start_beat: 0, laenge_beats: 4, noten: [{ beat: 0, laenge: 1, ton: 60, vel: 90 }] },
    { befehl: 'clip_neu', spur_id: 's5', art: 'audio', start_beat: 0, laenge_beats: 8, loop_beats: 2, sha256: SHA, name: 'loop' }], quelle);
  p = lauf(p, [{ befehl: 'gruppenspur_neu', name: 'G', mitglieder: ['s1', 's2'] }], quelle);
  return p;
}

test('1a.3 bouncePlan an_ort: source, hull range, name, no target (R2, D4)', () => {
  const z = bouncePlan(reich(), { art: 'an_ort', spur_id: 's1' }, 'andreas');
  assert.deepEqual([z.art, z.spurIds, z.von, z.bis, z.name, z.quelle, z.ziel, z.merge], ['an_ort', ['s1'], 0, 12, 'Bounce: Kick', 'andreas', undefined, undefined]);
});

test('1a.3 bouncePlan neue_spur: spur_ids or gruppe_id, range defaults to the hull of the sources, the merge plan with one source (D5)', () => {
  const p = reich();
  const z = bouncePlan(p, { art: 'neue_spur', spur_ids: ['s1'] }, 'andreas');
  assert.deepEqual([z.spurIds, z.von, z.bis, z.name, z.merge.name, z.merge.ausgang, z.merge.index], [['s1'], 0, 12, 'Bounce: Kick', 'Bounce: Kick', 'g1', 1]);
  const g = bouncePlan(p, { art: 'neue_spur', gruppe_id: 'g1' }, 'andreas');
  assert.deepEqual([g.spurIds, g.von, g.bis, g.name], [['s1', 's2'], 0, 20, 'Bounce: Kick + Bass'], 'group bounce: members in track order, hull of both');
  const r = bouncePlan(p, { art: 'neue_spur', spur_ids: ['s1', 's2'], von_beat: 2, bis_beat: 10 }, 'andreas');
  assert.deepEqual([r.von, r.bis, r.merge.ausserhalb], [2, 10, true], 'a given range wins; content outside it is noted (merge D8)');
});

test('1a.3 bouncePlan einfuegen: sources, range, target and beat (R2, D6)', () => {
  const z = bouncePlan(reich(), { art: 'einfuegen', spur_ids: ['s1', 's3'], von_beat: 0, bis_beat: 4, ziel_spur_id: 's5', ziel_beat: 8 }, 'andreas');
  assert.deepEqual([z.spurIds, z.von, z.bis, z.ziel, z.name, z.merge], [['s1', 's3'], 0, 4, { spurId: 's5', beat: 8 }, 'Bounce: Kick + Lead', undefined]);
});

test('1a.3 bouncePlan refusals with their codes (R2, R3, D8, D11, D12)', () => {
  const p = reich();
  const E = { art: 'einfuegen', spur_ids: ['s1'], von_beat: 0, bis_beat: 4, ziel_spur_id: 's5', ziel_beat: 8 };
  const voll = structuredClone(p);
  voll.spuren[0].takes = Array.from({ length: 32 }, (_, i) => ({ id: `t${i + 1}`, name: `Take ${i + 1}`, clips: [] }));
  const lang = lauf(p, [{ befehl: 'clip_neu', spur_id: 's3', art: 'audio', start_beat: 1000, laenge_beats: 40, sha256: SHA, name: 'weit' }]);
  const leer = lauf(p, [{ befehl: 'gruppenspur_neu', name: 'H' }]);
  const faelle = [
    [p, {}, 'argument_ungueltig', 'no art'],
    [p, { art: 'irgendwo', spur_id: 's1' }, 'argument_ungueltig', 'unknown art'],
    [p, { art: 'an_ort', spur_id: 's1', von_beat: 0 }, 'argument_ungueltig', 'an_ort takes no range'],
    [p, { art: 'an_ort' }, 'argument_ungueltig', 'an_ort without spur_id'],
    [p, { art: 'an_ort', spur_id: 'nope' }, 'spur_unbekannt', 'unknown track'],
    [p, { art: 'an_ort', spur_id: 's4' }, 'bounce_nur_audio', 'instrument track in place (D8)'],
    [p, { art: 'an_ort', spur_id: 's5x' }, 'spur_unbekannt', 'unknown track'],
    [lauf(p, [{ befehl: 'spur_neu', art: 'audio', name: 'Leer' }]), { art: 'an_ort', spur_id: 's6' }, 'merge_leer', 'no clips: nothing to bounce'],
    [lang, { art: 'an_ort', spur_id: 's3' }, 'export_bereich', 'hull over 1024 beats'],
    [voll, { art: 'an_ort', spur_id: 's1' }, 'takes_voll', '32 take lanes (D7)'],
    [p, { art: 'neue_spur' }, 'argument_ungueltig', 'neither spur_ids nor gruppe_id'],
    [p, { art: 'neue_spur', spur_ids: ['s1'], gruppe_id: 'g1' }, 'argument_ungueltig', 'both spur_ids and gruppe_id'],
    [p, { art: 'neue_spur', gruppe_id: 'g9' }, 'gruppe_unbekannt', 'unknown group'],
    [leer, { art: 'neue_spur', gruppe_id: 'g2' }, 'merge_leer', 'group without members'],
    [p, { art: 'neue_spur', spur_ids: ['s1', 's3'] }, 'merge_gruppen', 'group and master (merge rule)'],
    [p, { art: 'neue_spur', spur_ids: ['s1'], von_beat: 0, bis_beat: 2000 }, 'export_bereich', 'range over 1024 beats'],
    [p, { art: 'neue_spur', spur_ids: ['s1'], von_beat: -1, bis_beat: 4 }, 'export_bereich', 'range before beat 0'],
    [p, { art: 'neue_spur', spur_ids: ['s1'], ziel_beat: 3 }, 'argument_ungueltig', 'neue_spur takes no target'],
    [p, { ...E, spur_ids: [] }, 'argument_ungueltig', 'no source'],
    [p, { ...E, spur_ids: ['s1', 's1'] }, 'argument_ungueltig', 'source twice'],
    [p, { ...E, von_beat: undefined }, 'argument_ungueltig', 'einfuegen needs von_beat'],
    [p, { ...E, ziel_beat: undefined }, 'argument_ungueltig', 'einfuegen needs ziel_beat'],
    [p, { ...E, ziel_beat: -1 }, 'argument_ungueltig', 'ziel_beat below 0'],
    [p, { ...E, ziel_beat: 100_000 - 2 }, 'argument_ungueltig', 'end beyond MAX_BEAT'],
    [p, { ...E, ziel_spur_id: 'nope' }, 'spur_unbekannt', 'unknown target'],
    [p, { ...E, spur_ids: ['nope'] }, 'spur_unbekannt', 'unknown source'],
    [p, { ...E, ziel_spur_id: 's4' }, 'bounce_ziel_art', 'target is an instrument track'],
    [p, { ...E, ziel_beat: 1 }, 'ersetzen_loop', 'the loop clip [0,8) of the target crosses beat 1'],
    [p, { ...E, ziel_beat: 6 }, 'ersetzen_loop', 'the loop clip [0,8) has the paste start 6 strictly inside'],
    [p, { ...E, von_beat: 4, bis_beat: 4 }, 'export_bereich', 'empty range'],
    [p, { ...E, extra: 1 }, 'argument_ungueltig', 'unknown field'],
  ];
  for (const [proj, d, code, was] of faelle) assert.equal(grund(() => bouncePlan(proj, d, 'andreas')), code, was);
  // an exact edge of the loop clip is no crossing (negative control): paste at 8 (the loop clip ends there) passes
  assert.equal(bouncePlan(p, E, 'andreas').ziel.beat, 8);
  assert.equal(bouncePlan(p, { ...E, ziel_beat: 12 }, 'andreas').ziel.beat, 12);
});

test('1a.3 bouncePlan einfuegen: a Surge source with unfrozen notes gives merge_freeze_noetig', () => {
  let p = lauf(reich(), [{ befehl: 'spur_neu', art: 'instrument', name: 'Surge', geraet: { art: 'wirt' } }]);
  p = lauf(p, [{ befehl: 'clip_neu', spur_id: 's6', art: 'midi', start_beat: 0, laenge_beats: 8, noten: [{ beat: 0, laenge: 1, ton: 60, vel: 90 }] }]);
  const E = { art: 'einfuegen', spur_ids: ['s6'], von_beat: 0, bis_beat: 4, ziel_spur_id: 's5', ziel_beat: 8 };
  assert.equal(grund(() => bouncePlan(p, E, 'andreas')), 'merge_freeze_noetig');
  assert.equal(grund(() => bouncePlan(p, { art: 'neue_spur', spur_ids: ['s6'] }, 'andreas')), 'merge_freeze_noetig', 'inherited from mergePlan');
});

test('1a.3 rights (D11): Cypher may not bounce or paste onto a track of Andreas, nor use one as a to-new-track source; reading it for paste is fine', () => {
  let p = reich('andreas');                                                       // s1..s5 von andreas
  p = lauf(p, [{ befehl: 'spur_neu', art: 'audio', name: 'Mein' }], 'cypher');   // s6 von cypher
  p = lauf(p, [{ befehl: 'clip_neu', spur_id: 's6', art: 'audio', start_beat: 0, laenge_beats: 4, sha256: SHA, name: 'm' }], 'cypher');
  const faelle = [
    { art: 'an_ort', spur_id: 's1' },
    { art: 'neue_spur', spur_ids: ['s1'] },
    { art: 'neue_spur', gruppe_id: 'g1' },
    { art: 'einfuegen', spur_ids: ['s6'], von_beat: 0, bis_beat: 4, ziel_spur_id: 's5', ziel_beat: 8 },
  ];
  for (const d of faelle) {
    assert.equal(grund(() => bouncePlan(p, d, 'cypher')), 'merge_andreas_spur', JSON.stringify(d));
    assert.equal(grund(() => bouncePlan(p, d, 'andreas')), null, `negative control, Andreas: ${JSON.stringify(d)}`);
  }
  assert.equal(bouncePlan(p, { art: 'an_ort', spur_id: 's6' }, 'cypher').spurIds[0], 's6', 'own track in place');
  assert.deepEqual(bouncePlan(p, { art: 'einfuegen', spur_ids: ['s1'], von_beat: 0, bis_beat: 4, ziel_spur_id: 's6', ziel_beat: 8 }, 'cypher').ziel,
    { spurId: 's6', beat: 8 }, 'a track of Andreas as a paste source is allowed');
});
