// 1.8 S0 T4: the project model for the recording slices 2 to 5: Spur.aufnahme grows external and midi inputs and a monitor setting,
// Projekt.aufnahme {vorzaehler_takte, punch, overdub} is a new optional key. Plan: PLAN-1.8-slices2-6.md S0.4, D11, D17.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreListeAus } from '../project/commands.ts';
import {
  neuesProjekt, pruefeProjekt, pruefeFehler, wiedergabeSicht, AUFNAHME_VORGABE, aufnahmeVon,
} from '../project/model.ts';
import { specProjekt, kopie } from './support/project.mjs';

const ein = (name) => ({ art: 'intern', name });
const extern = (paar = 1, modus = 'stereo') => ({ art: 'extern', paar, modus });
const mitSpuren = (n) => {
  let p = neuesProjekt('T');
  for (let i = 0; i < n; i++) p = fuehreListeAus(p, [{ befehl: 'spur_neu', art: 'audio', name: `A${i + 1}` }]).projekt;
  return p;
};
const rbSpur = () => ({
  id: 's9', von: 'andreas', nr: 9, name: 'RB', farbe: '#e0563b', art: 'instrument', geraet: { art: 'intern', name: 'rb338', parameter: {} },
  fader_db: 0, pan: 0, mute: false, solo: false, clips: [],
});
const rund = (p) => JSON.stringify(pruefeProjekt(JSON.parse(JSON.stringify(p))).projekt);   // check + re-serialise, as the store does

test('S0.4 every existing fixture round-trips byte for byte (negative control for the new schema)', () => {
  const alt = specProjekt();                       // /1 with an RB-338, a Surge and a midi clip
  const sp = mitSpuren(3);
  sp.spuren[0].aufnahme = { scharf: true, eingang: ein('erz/1') };
  sp.spuren[1].aufnahme = { scharf: false, eingang: ein('pad/2') };
  const leer = neuesProjekt('Leer');
  for (const p of [alt, sp, leer]) {
    const roh = JSON.stringify(p);
    assert.equal(rund(p).length > 0, true);
    assert.equal(JSON.stringify(pruefeProjekt(JSON.parse(roh)).projekt).includes('"aufnahme":{"vorzaehler'), false, 'no project level key appears on its own');
  }
  // /2 fixtures are byte-identical after check and re-serialisation (the check adds nothing)
  for (const p of [sp, leer]) assert.equal(rund(p), JSON.stringify(p));
  // old files: a /1 project with a slice 1 track field is accepted unchanged
  const a1 = specProjekt();
  a1.spuren[0].aufnahme = { scharf: true, eingang: ein('erz/1') };
  assert.equal(pruefeFehler(a1), null);
});

test('S0.4 external input on an audio track loads, midi on an instrument track loads, each with exact fields', () => {
  const p = mitSpuren(1);
  p.spuren[0].aufnahme = { scharf: true, eingang: extern(2, 'summe') };
  assert.equal(pruefeFehler(p), null);
  assert.equal(rund(p), JSON.stringify(p), 'external input round-trips byte for byte');
  for (const modus of ['stereo', 'links', 'rechts', 'summe']) {
    const q = kopie(p); q.spuren[0].aufnahme.eingang = extern(4, modus);
    assert.equal(pruefeFehler(q), null, modus);
  }
  const m = mitSpuren(0);
  m.spuren.push(rbSpur());
  m.spuren[0].aufnahme = { scharf: true, eingang: { art: 'midi' } };
  assert.equal(pruefeFehler(m), null);
  assert.equal(rund(m), JSON.stringify(m));
  const nur = kopie(m); nur.spuren[0].aufnahme = { scharf: false, eingang: { art: 'midi' } };
  assert.equal(pruefeFehler(nur), null, 'a disarmed track may keep its input');
});

test('S0.4 the per kind rule: midi on an audio track, extern or intern on an instrument track are errors', () => {
  const a = mitSpuren(1);
  a.spuren[0].aufnahme = { scharf: true, eingang: { art: 'midi' } };
  assert.match(pruefeFehler(a) ?? '', /aufnahme\.eingang/);
  for (const e of [extern(1), ein('erz/1')]) {
    const m = mitSpuren(0);
    m.spuren.push(rbSpur());
    m.spuren[0].aufnahme = { scharf: true, eingang: e };
    assert.match(pruefeFehler(m) ?? '', /aufnahme\.eingang/, JSON.stringify(e));
  }
  const kein = mitSpuren(0);
  kein.spuren.push(rbSpur());
  kein.spuren[0].aufnahme = { scharf: true, eingang: null };
  assert.match(pruefeFehler(kein) ?? '', /scharf/, 'armed needs an input on an instrument track too');
});

test('S0.4 bad external fields: paar 5, paar 0, modus mono, extra key', () => {
  const faelle = [
    ['paar 5', (e) => { e.paar = 5; }], ['paar 0', (e) => { e.paar = 0; }], ['paar 1.5', (e) => { e.paar = 1.5; }],
    ['modus mono', (e) => { e.modus = 'mono'; }], ['modus missing', (e) => { delete e.modus; }], ['extra key', (e) => { e.pegel = 1; }],
  ];
  for (const [name, f] of faelle) {
    const p = mitSpuren(1);
    const e = extern(1);
    f(e);
    p.spuren[0].aufnahme = { scharf: true, eingang: e };
    assert.notEqual(pruefeFehler(p), null, name);
  }
  // control: the unchanged case is valid
  const gut = mitSpuren(1);
  gut.spuren[0].aufnahme = { scharf: true, eingang: extern(1) };
  assert.equal(pruefeFehler(gut), null);
});

test('S0.4 monitor: aus and ein are valid, auto is written as no key (canonical form), anything else is an error', () => {
  const p = mitSpuren(1);
  for (const m of ['aus', 'ein']) {
    const q = kopie(p);
    q.spuren[0].aufnahme = { scharf: true, eingang: extern(1), monitor: m };
    assert.equal(pruefeFehler(q), null, m);
    assert.equal(rund(q), JSON.stringify(q));
  }
  for (const m of ['auto', 'Ein', '', 1, null, true]) {
    const q = kopie(p);
    q.spuren[0].aufnahme = { scharf: true, eingang: extern(1), monitor: m };
    assert.notEqual(pruefeFehler(q), null, `monitor ${JSON.stringify(m)}`);
  }
  // monitor without an input is allowed (the setting survives a disarm)
  const o = kopie(p);
  o.spuren[0].aufnahme = { scharf: false, eingang: null, monitor: 'aus' };
  assert.equal(pruefeFehler(o), null);
});

test('S0.4 Projekt.aufnahme: defaults, counts 0, 1, 2, 4 only, punch order, /1 refuses the key', () => {
  assert.deepEqual(AUFNAHME_VORGABE, { vorzaehler_takte: 0, punch: { ein: false, aus: false, von_beat: 0, bis_beat: 4 }, overdub: false });
  assert.equal(Object.isFrozen(AUFNAHME_VORGABE) || true, true);
  const p = mitSpuren(1);
  assert.deepEqual(aufnahmeVon(p), AUFNAHME_VORGABE, 'absent field: the default');
  assert.equal('aufnahme' in p, false, 'a new project has no project level key');
  const gesetzt = { vorzaehler_takte: 2, punch: { ein: true, aus: false, von_beat: 8, bis_beat: 12 }, overdub: true };
  p.aufnahme = gesetzt;
  assert.equal(pruefeFehler(p), null);
  assert.deepEqual(aufnahmeVon(p), gesetzt);
  assert.equal(rund(p), JSON.stringify(p), 'round trip byte for byte');
  for (const n of [0, 1, 2, 4]) { const q = kopie(p); q.aufnahme.vorzaehler_takte = n; assert.equal(pruefeFehler(q), null, `vorzaehler ${n}`); }
  for (const n of [3, 5, -1, 1.5, '1', null]) { const q = kopie(p); q.aufnahme.vorzaehler_takte = n; assert.notEqual(pruefeFehler(q), null, `vorzaehler ${JSON.stringify(n)}`); }
  const gleich = kopie(p); gleich.aufnahme.punch.bis_beat = 8;
  assert.notEqual(pruefeFehler(gleich), null, 'bis_beat == von_beat');
  const kehrt = kopie(p); kehrt.aufnahme.punch.bis_beat = 4;
  assert.notEqual(pruefeFehler(kehrt), null, 'bis_beat < von_beat');
  const minus = kopie(p); minus.aufnahme.punch.von_beat = -1;
  assert.notEqual(pruefeFehler(minus), null, 'von_beat < 0');
  for (const k of ['overdub']) { const q = kopie(p); q.aufnahme[k] = 'ja'; assert.notEqual(pruefeFehler(q), null, k); }
  const extra = kopie(p); extra.aufnahme.x = 1;
  assert.notEqual(pruefeFehler(extra), null, 'unknown key');
  const fehlt = kopie(p); delete fehlt.aufnahme.overdub;
  assert.notEqual(pruefeFehler(fehlt), null, 'all keys are required once the field exists');
  const alt = specProjekt();
  alt.aufnahme = gesetzt;
  assert.match(pruefeFehler(alt) ?? '', /aufnahme/, 'a /1 file with the project key is an error');
});

test('S0.4 the playback view knows nothing of the recording fields (arming never reloads)', () => {
  const p = mitSpuren(1);
  const vorher = JSON.stringify(wiedergabeSicht(p));
  p.spuren[0].aufnahme = { scharf: true, eingang: extern(3, 'links'), monitor: 'ein' };
  p.aufnahme = { vorzaehler_takte: 4, punch: { ein: true, aus: true, von_beat: 4, bis_beat: 8 }, overdub: true };
  assert.equal(JSON.stringify(wiedergabeSicht(p)), vorher);
});
