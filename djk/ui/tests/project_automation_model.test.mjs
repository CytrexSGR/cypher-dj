// Automation Slice 1, Task 1: Lane im Projektmodell (Prüfung, Zähler, Sicht, Auswertung). Plan 2026-10-31-automation-slice1.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  neuesProjekt, pruefeProjekt, pruefeFehler, lanePruefung, kanonisch, neueId, spurSicht, wiedergabeSicht, setzeFehlendeZaehler,
  FADER_MIN, FADER_MAX, MAX_LANES_PRO_SPUR, MAX_AUTO_PUNKTE, MAX_LANE_PUNKTE, AUTO_ZIELE, ZIEL_BEREICH, RB_VORGABE_NORM,
} from '../project/model.ts';
import { laneWert } from '../project/lane.ts';
import { specProjekt } from './support/project.mjs';

const spur = (n, extra = {}) => ({ id: `s${n}`, nr: n, name: `T${n}`, farbe: '#e0563b', art: 'audio', fader_db: 0, pan: 0, mute: false, solo: false, clips: [], von: 'andreas', ...extra });
const lane = (id = 'a1', punkte = [{ beat: 0, wert: 0 }, { beat: 16, wert: -30 }], extra = {}) => ({ id, ziel: 'fader', punkte, ...extra });
const projekt = (spuren) => { const p = neuesProjekt('T'); p.spuren = spuren; return p; };
const mitLane = (l = lane()) => projekt([spur(1, { automation: [l] })]);

test('S1 T1.1 gültige Lane wird angenommen; in /1 ist automation ein unbekanntes Feld', () => {
  assert.equal(pruefeFehler(mitLane()), null);
  const alt = specProjekt();
  assert.equal(pruefeFehler(alt), null, 'Negativ-Kontrolle: /1 ohne Lane ist gültig');
  alt.spuren[0].automation = [lane()];
  const f = pruefeFehler(alt);
  assert.match(f ?? '', /automation.*unbekanntes Feld/, f);
});

test('S1 T1.2 jede Ablehnung einzeln, jeweils aus dem gültigen Fall durch genau ein geändertes Feld', () => {
  const faelle = [
    ['Ziel wurst', (l) => { l.ziel = 'wurst'; }],
    ['Punkte nicht aufsteigend', (l) => { l.punkte = [{ beat: 8, wert: 0 }, { beat: 4, wert: 0 }]; }],
    ['drei Punkte am gleichen Beat', (l) => { l.punkte = [{ beat: 4, wert: 0 }, { beat: 4, wert: -3 }, { beat: 4, wert: -6 }]; }],
    ['Wert 7', (l) => { l.punkte[1].wert = 7; }],
    ['Wert -201', (l) => { l.punkte[1].wert = -201; }],
    ['Beat -1', (l) => { l.punkte[0].beat = -1; }],
    ['Beat 100001', (l) => { l.punkte[1].beat = 100001; }],
    ['8193 Punkte', (l) => { l.punkte = Array.from({ length: 8193 }, (_, i) => ({ beat: i, wert: 0 })); }],
    ['Lane-Feld farbe', (l) => { l.farbe = '#fff'; }],
    ['Punktfeld x', (l) => { l.punkte[0].x = 1; }],
    ['Form unbekannt', (l) => { l.punkte[1].form = 'rund'; }],
    ['leere Punkteliste', (l) => { l.punkte = []; }],
    ['Wert NaN', (l) => { l.punkte[0].wert = NaN; }],
    ['ID ungültig', (l) => { l.id = 'x/1'; }],
  ];
  for (const [name, mut] of faelle) {
    const l = lane(); mut(l);
    assert.notEqual(pruefeFehler(mitLane(l)), null, `${name} muss abgelehnt werden`);
    assert.equal(pruefeFehler(mitLane(lane())), null, `Gegenprobe zu ${name}: gültig`);
  }
  assert.equal(pruefeFehler(mitLane(lane('a1', [{ beat: 0, wert: 6 }, { beat: 100000, wert: -200 }]))), null, 'Grenzen inklusiv');
  assert.equal(pruefeFehler(mitLane(lane('a1', [{ beat: 4, wert: 0 }, { beat: 4, wert: -3 }]))), null, 'zwei am gleichen Beat: Sprung');
  assert.equal(pruefeFehler(mitLane(lane('a1', Array.from({ length: 8192 }, (_, i) => ({ beat: i, wert: 0 }))))), null, '8192 gültig');
  assert.notEqual(pruefeFehler(projekt([spur(1, { automation: [lane('a1'), lane('a2')] })])), null, 'zwei Lanes auf fader');
  assert.notEqual(pruefeFehler(projekt([spur(1, { automation: [lane('a1')] }), spur(2, { automation: [lane('a1')] })])), null, 'Lane-ID doppelt');
  assert.equal(pruefeFehler(projekt([spur(1, { automation: [lane('a1')] }), spur(2, { automation: [lane('a2')] })])), null);
  assert.deepEqual([...AUTO_ZIELE], ['fader', 'pan', 'mute', 'solo', 'geraet.lautstaerke', 'geraet.cutoff', 'geraet.resonanz', 'geraet.env_mod',
    'geraet.k1', 'geraet.k2', 'geraet.k3', 'geraet.k4', 'geraet.k5', 'geraet.k6', 'geraet.k7', 'geraet.k8']);   // 1.12 slice 7: the bk knobs
  assert.equal(MAX_LANES_PRO_SPUR, 12);
});

test('S1 T1.3 Gesamtgrenze 65536 Punkte je Projekt', () => {
  const voll = (n) => lane(`a${n}`, Array.from({ length: MAX_LANE_PUNKTE }, (_, i) => ({ beat: i, wert: 0 })));
  const acht = projekt(Array.from({ length: 8 }, (_, i) => spur(i + 1, { automation: [voll(i + 1)] })));
  assert.equal(MAX_AUTO_PUNKTE, 65536);
  assert.equal(pruefeFehler(acht), null, '8 Lanes zu 8192 = 65536 gültig');
  const neun = projekt(Array.from({ length: 9 }, (_, i) => spur(i + 1, { automation: [voll(i + 1)] })));
  assert.match(pruefeFehler(neun) ?? '', /65536/);
});

test('S1 T1.4 Altprojekt ohne Lane bleibt kanonisch gleich; Projekt mit Lane öffnet normalisiert gleich', () => {
  const neu = neuesProjekt('x');
  assert.equal(kanonisch(pruefeProjekt(neu).projekt), kanonisch(neu), 'neues Projekt: Öffnen ändert nichts');
  const g = pruefeProjekt(specProjekt()).projekt;
  assert.equal(kanonisch(pruefeProjekt(g).projekt), kanonisch(g), 'idempotent');
  const p = mitLane();
  const geoeffnet = pruefeProjekt(JSON.parse(JSON.stringify(p))).projekt;
  assert.equal(kanonisch(geoeffnet), kanonisch(p));
  assert.equal(kanonisch(pruefeProjekt(JSON.parse(kanonisch(geoeffnet))).projekt), kanonisch(geoeffnet), 'Speichern, Schließen, Öffnen: gleich');
});

test('S1 T1.5 Lane-Zähler entsteht erst mit der ersten Lane und ändert Projekte ohne Lane nicht', () => {
  const p = projekt([spur(1)]);
  assert.deepEqual(Object.keys(p.naechste_id).sort(), ['clip', 'gruppe', 'spur']);
  assert.equal(neueId(p, 'lane'), 'a1');
  assert.equal(p.naechste_id.lane, 2);
  assert.equal(neueId(p, 'lane'), 'a2');
  assert.equal(neueId(p, 'lane'), 'a3', 'a2 nie eingetragen/gelöscht: der Zähler steigt nur');
  const q = projekt([spur(1, { automation: [lane('a1')] }), spur(2, { automation: [lane('a3')] })]);
  assert.equal(neueId(q, 'lane'), 'a4');
  const roh = neuesProjekt('x'); const vorher = JSON.stringify(roh);
  const geoeffnet = pruefeProjekt(JSON.parse(vorher)).projekt;
  assert.deepEqual(Object.keys(geoeffnet.naechste_id).sort(), ['clip', 'gruppe', 'spur']);
  assert.equal(JSON.stringify(geoeffnet), vorher);
  const alt = pruefeProjekt(specProjekt()).projekt;
  assert.ok(!('lane' in alt.naechste_id), 'setzeFehlendeZaehler legt lane nicht an');
  const z = projekt([spur(1)]); z.naechste_id.lane = 7;
  assert.equal(pruefeProjekt(JSON.parse(JSON.stringify(z))).projekt.naechste_id.lane, 7, 'vorhandener Zähler bleibt');
  setzeFehlendeZaehler(z); assert.equal(z.naechste_id.lane, 7);
  assert.equal(pruefeFehler(z), null);
  z.naechste_id.lane = 0; assert.notEqual(pruefeFehler(z), null, 'lane >= 1');
  z.naechste_id.lane = 2; z.naechste_id.pan = 1; assert.notEqual(pruefeFehler(z), null, 'fremder Schlüssel');
});

test('S1 T1.6 spurSicht(s, false) ist mit und ohne Lane bit-gleich; wiedergabeSicht unterscheidet sich', () => {
  const ohne = spur(1), mit = spur(1, { automation: [lane()] });
  assert.equal(JSON.stringify(spurSicht(mit, false)), JSON.stringify(spurSicht(ohne, false)), 'Freeze-Schlüssel unberührt');
  assert.notEqual(kanonisch(wiedergabeSicht(projekt([mit]))), kanonisch(wiedergabeSicht(projekt([ohne]))));
  assert.equal(kanonisch(spurSicht(spur(1, { automation: [] }))), kanonisch(spurSicht(ohne)), 'leere Liste = keine Lane');
  const geaendert = spur(1, { automation: [lane('a1', [{ beat: 0, wert: 0 }, { beat: 16, wert: -20 }])] });
  assert.notEqual(kanonisch(spurSicht(geaendert)), kanonisch(spurSicht(mit)), 'anderer Punkt: andere Sicht');
});

test('S1 T1.7 laneWert gegen Handwerte', () => {
  const lin = [{ beat: 4, wert: 0 }, { beat: 20, wert: -30 }];
  assert.equal(laneWert(lin, 12, 'fader'), -15);
  assert.equal(laneWert(lin, 4, 'fader'), 0); assert.equal(laneWert(lin, 20, 'fader'), -30);
  assert.equal(laneWert(lin, 0, 'fader'), 0, 'vor dem ersten Punkt gilt dessen Wert'); assert.equal(laneWert(lin, 99, 'fader'), -30, 'danach der letzte');
  const s = [{ beat: 0, wert: 0 }, { beat: 16, wert: -30, form: 's' }];
  assert.ok(Math.abs(laneWert(s, 8, 'fader') - -15) < 1e-12, 's: Mitte ist Mitte');
  assert.ok(Math.abs(laneWert(s, 4, 'fader') - (-30 * (3 * 0.0625 - 2 * 0.015625))) < 1e-12, 's bei u=0.25');
  assert.notEqual(laneWert(s, 4, 'fader'), laneWert([{ beat: 0, wert: 0 }, { beat: 16, wert: -30 }], 4, 'fader'), 'Negativ-Kontrolle: s ist nicht linear');
  const sp = [{ beat: 0, wert: -10 }, { beat: 8, wert: -10 }, { beat: 8, wert: 0 }, { beat: 16, wert: 0 }];
  assert.equal(laneWert(sp, 8 - 1e-9, 'fader'), -10); assert.equal(laneWert(sp, 8, 'fader'), 0, 'ab dem Beat gilt der rechte Wert');
  const sprungForm = [{ beat: 0, wert: -10 }, { beat: 8, wert: 0, form: 'sprung' }];
  assert.equal(laneWert(sprungForm, 7.999, 'fader'), -10, 'Form sprung hält den linken Wert'); assert.equal(laneWert(sprungForm, 8, 'fader'), 0);
  const stumm = [{ beat: 0, wert: -30 }, { beat: 2, wert: -200 }];
  assert.equal(laneWert(stumm, 1, 'fader'), -45, 'Rampe nach stumm läuft intern bis -60');
  assert.equal(laneWert(stumm, 2, 'fader'), -200, 'der Punkt selbst liefert -200');
  const aus = [{ beat: 0, wert: -200 }, { beat: 2, wert: 0 }];
  assert.equal(laneWert(aus, 0, 'fader'), -200); assert.equal(laneWert(aus, 1, 'fader'), -30, 'Rampe von stumm startet bei -60');
  assert.equal(laneWert([{ beat: 0, wert: -200 }, { beat: 2, wert: -200 }], 1, 'fader'), -200);
  assert.equal(laneWert([{ beat: 3, wert: -7 }], 0, 'fader'), -7);
});

// --- Automation slice 2, task 1: targets pan, mute, solo, geraet.*; lock ---------------------------------------------------------------
const rbSpur = (n, extra = {}) => spur(n, { art: 'instrument', geraet: { art: 'intern', name: 'rb338', parameter: {} }, ...extra });
const wirtSpur = (n, extra = {}) => spur(n, { art: 'instrument', geraet: { art: 'wirt', name: 'surge', slot: 1 }, freeze: null, ...extra });
const ziellane = (ziel, punkte, extra = {}) => ({ id: 'a1', ziel, punkte, ...extra });
const GUELTIG = {
  fader: [{ beat: 0, wert: -6 }, { beat: 8, wert: 0 }],
  pan: [{ beat: 0, wert: -1 }, { beat: 8, wert: 1 }],
  mute: [{ beat: 0, wert: 0, form: 'sprung' }, { beat: 8, wert: 1, form: 'sprung' }],
  solo: [{ beat: 0, wert: 0, form: 'sprung' }, { beat: 8, wert: 1 }],
  'geraet.lautstaerke': [{ beat: 0, wert: 0 }, { beat: 8, wert: 1 }],
  'geraet.cutoff': [{ beat: 0, wert: 0.2 }, { beat: 8, wert: 0.9 }],
  'geraet.resonanz': [{ beat: 0, wert: 0 }, { beat: 8, wert: 1 }],
  'geraet.env_mod': [{ beat: 0, wert: 0.4 }, { beat: 8, wert: 0.5 }],
};

test('S2 T1.1 each of the 8 targets accepts a valid lane (negative control); ranges are pinned', () => {
  for (const [ziel, pk] of Object.entries(GUELTIG)) {
    assert.equal(pruefeFehler(projekt([rbSpur(1, { automation: [ziellane(ziel, pk)] })])), null, `${ziel} valid on an internal track`);
  }
  assert.deepEqual(Object.keys(ZIEL_BEREICH), [...AUTO_ZIELE]);
  assert.deepEqual(ZIEL_BEREICH.fader, { min: FADER_MIN, max: FADER_MAX, nurSprung: false }, 'the fader range is the shared constants');
  assert.deepEqual(ZIEL_BEREICH.pan, { min: -1, max: 1, nurSprung: false });
  assert.deepEqual(ZIEL_BEREICH.mute, { min: 0, max: 1, nurSprung: true });
  assert.deepEqual(ZIEL_BEREICH.solo, { min: 0, max: 1, nurSprung: true });
  assert.deepEqual(ZIEL_BEREICH['geraet.cutoff'], { min: 0, max: 1, nurSprung: false });
  // eight lanes on one internal track are valid, the limit 12 stays
  const alle = AUTO_ZIELE.filter((z) => !/^geraet\.k[1-8]$/.test(z)).map((z, i) => ({ ...ziellane(z, GUELTIG[z]), id: `a${i + 1}` }));   // the RB-338 track: the bk knobs are not its targets
  assert.equal(pruefeFehler(projekt([rbSpur(1, { automation: alle })])), null, 'all 8 targets on one track');
  assert.equal(MAX_LANES_PRO_SPUR, 12);
});

test('S2 T1.2 rejections of the new targets, each one field away from a valid lane', () => {
  const faelle = [
    ['unknown target geraet.decay', 'ziel_unbekannt', () => ziellane('geraet.decay', GUELTIG['geraet.cutoff'])],
    ['unknown target geraet.wellenform', 'ziel_unbekannt', () => ziellane('geraet.wellenform', GUELTIG['geraet.cutoff'])],
    ['unknown target geraet.accent', 'ziel_unbekannt', () => ziellane('geraet.accent', GUELTIG['geraet.cutoff'])],
    ['unknown target wurst', 'ziel_unbekannt', () => ziellane('wurst', GUELTIG.fader)],
    ['pan 1.2', 'argument_ungueltig', () => ziellane('pan', [{ beat: 0, wert: 1.2 }])],
    ['pan -1.2', 'argument_ungueltig', () => ziellane('pan', [{ beat: 0, wert: -1.2 }])],
    ['mute 0.5', 'argument_ungueltig', () => ziellane('mute', [{ beat: 0, wert: 0.5 }])],
    ['solo 2', 'argument_ungueltig', () => ziellane('solo', [{ beat: 0, wert: 2 }])],
    ['mute point form linear', 'punkte_ungueltig', () => ziellane('mute', [{ beat: 0, wert: 0, form: 'linear' }, { beat: 8, wert: 1, form: 'sprung' }])],
    ['solo point form s', 'punkte_ungueltig', () => ziellane('solo', [{ beat: 0, wert: 0, form: 's' }])],
    ['geraet.cutoff 1.5', 'argument_ungueltig', () => ziellane('geraet.cutoff', [{ beat: 0, wert: 1.5 }])],
    ['geraet.cutoff -0.1', 'argument_ungueltig', () => ziellane('geraet.cutoff', [{ beat: 0, wert: -0.1 }])],
    ['pan points falling', 'punkte_ungueltig', () => ziellane('pan', [{ beat: 8, wert: 0 }, { beat: 4, wert: 0 }])],
    ['mute three at one beat', 'punkte_ungueltig', () => ziellane('mute', [{ beat: 4, wert: 0 }, { beat: 4, wert: 1 }, { beat: 4, wert: 0 }])],
    ['geraet.cutoff 8193 points', 'zu_gross', () => ziellane('geraet.cutoff', Array.from({ length: 8193 }, (_, i) => ({ beat: i, wert: 0.5 })))],
  ];
  for (const [name, grund, bau] of faelle) {
    const f = pruefeFehler(projekt([rbSpur(1, { automation: [bau()] })]));
    assert.notEqual(f, null, `${name} must be rejected`);
    assert.match(f, /^spuren\[0\]\.automation\[0\]/, `${name}: the project path names the lane: ${f}`);
    assert.ok(f.includes(lanePruefung(bau()).text), `${name}: the project path carries the lane text: ${f}`);
  }
  // the reason of the lane check itself (the command path uses it)
  for (const [name, grund, bau] of faelle) assert.equal(lanePruefung(bau())?.grund, grund, `${name}: reason`);
  // negative control: the valid siblings pass the same lane check
  for (const [z, pk] of Object.entries(GUELTIG)) assert.equal(lanePruefung(ziellane(z, pk)), null, `control ${z}`);
  // 65537 points in a project: eight full lanes (65536) are valid, one more point on a ninth track is not
  const voll = (n, ziel) => ({ id: `a${n}`, ziel, punkte: Array.from({ length: MAX_LANE_PUNKTE }, (_, i) => ({ beat: i, wert: 0.5 })) });
  const zielV = ['geraet.cutoff', 'geraet.resonanz', 'geraet.env_mod', 'geraet.lautstaerke'];
  const acht = Array.from({ length: 8 }, (_, i) => rbSpur(i + 1, { automation: [voll(i + 1, zielV[i % 4])] }));
  assert.equal(pruefeFehler(projekt(acht)), null, '8 x 8192 = 65536 valid');
  const neunte = rbSpur(9, { automation: [{ id: 'a9', ziel: 'geraet.cutoff', punkte: [{ beat: 0, wert: 0.5 }] }] });
  assert.match(pruefeFehler(projekt([...acht, neunte])) ?? '', /65536/, '65537 points are rejected');
});

test('S2 T1.3 geraet.* only on internal tracks (also when a project file is opened)', () => {
  const l = ziellane('geraet.cutoff', GUELTIG['geraet.cutoff']);
  assert.equal(pruefeFehler(projekt([rbSpur(1, { automation: [l] })])), null, 'internal track: valid');
  for (const [name, s] of [['audio track', spur(1, { automation: [l] })], ['host track', wirtSpur(1, { automation: [l] })]]) {
    const f = pruefeFehler(projekt([s]));
    assert.match(f ?? '', /geraet\.cutoff/, `${name}: ${f}`);
    assert.equal(pruefeProjekt(JSON.parse(JSON.stringify(projekt([s])))).fehler !== undefined, true, `${name}: opening is rejected`);
  }
  assert.equal(pruefeFehler(projekt([wirtSpur(1, { automation: [ziellane('pan', GUELTIG.pan)] })])), null, 'control: pan on a host track is fine');
  assert.equal(pruefeFehler(projekt([spur(1, { automation: [ziellane('mute', GUELTIG.mute)] })])), null, 'control: mute on an audio track is fine');
});

test('S2 T1.12 geraet.* only on the RB-338 device: a bk track refuses them, an rb338 track keeps them', () => {
  const l = ziellane('geraet.cutoff', GUELTIG['geraet.cutoff']);
  const bkSpur = (n, extra = {}) => spur(n, { art: 'instrument', geraet: { art: 'intern', name: 'bk', graph: 'juno-pad', parameter: {} }, ...extra });
  assert.equal(pruefeFehler(projekt([rbSpur(1, { automation: [l] })])), null, 'control: rb338 track accepts the lane');
  const f = pruefeFehler(projekt([bkSpur(1, { automation: [l] })]));
  assert.match(f ?? '', /geraet\.cutoff/, `bk track: ${f}`);
  assert.equal(pruefeProjekt(JSON.parse(JSON.stringify(projekt([bkSpur(1, { automation: [l] })])))).fehler !== undefined, true, 'opening is rejected');
  assert.equal(pruefeFehler(projekt([bkSpur(1, { automation: [ziellane('pan', GUELTIG.pan)] })])), null, 'control: pan on a bk track is fine');
});

test('S2 T1.4 lock: gesperrt is true or absent; slice 1 projects stay byte for byte the same', () => {
  const l = lane('a1', undefined, { gesperrt: true });
  assert.equal(pruefeFehler(mitLane(l)), null, 'gesperrt: true is valid');
  for (const v of [false, 'ja', 1, null]) assert.notEqual(pruefeFehler(mitLane(lane('a1', undefined, { gesperrt: v }))), null, `gesperrt: ${JSON.stringify(v)} is rejected`);
  const s1 = mitLane();
  const roh = JSON.stringify(s1);
  assert.equal(JSON.stringify(pruefeProjekt(JSON.parse(roh)).projekt), roh, 'a slice 1 project round-trips byte for byte');
  assert.equal(kanonisch(pruefeProjekt(JSON.parse(roh)).projekt), kanonisch(s1));
  assert.equal(kanonisch(spurSicht(mitLane(l).spuren[0])), kanonisch(spurSicht(s1.spuren[0])), 'the lock is not part of the playback view');
});

test('S2 T1.5 mute and solo points without form are stored as sprung when a project is opened', () => {
  const p = projekt([spur(1, { automation: [ziellane('mute', [{ beat: 0, wert: 0 }, { beat: 8, wert: 1 }]), { ...ziellane('solo', [{ beat: 0, wert: 1 }]), id: 'a2' }] })]);
  const g = pruefeProjekt(JSON.parse(JSON.stringify(p)));
  assert.equal(g.fehler, undefined);
  assert.deepEqual(g.projekt.spuren[0].automation[0].punkte, [{ beat: 0, wert: 0, form: 'sprung' }, { beat: 8, wert: 1, form: 'sprung' }]);
  assert.deepEqual(g.projekt.spuren[0].automation[1].punkte, [{ beat: 0, wert: 1, form: 'sprung' }]);
  const f = pruefeProjekt(JSON.parse(JSON.stringify(projekt([spur(1, { automation: [lane()] })]))));
  assert.equal(f.projekt.spuren[0].automation[0].punkte[0].form, undefined, 'control: fader points stay without form');
});

test('S2 T1.6 RB_VORGABE_NORM pins the normalised RB defaults (inverse of the Rust mapping)', () => {
  // djk/instruments/rb_dsp/src/parameter.rs: Def::wert :47-52 (Schief: norm^(1/faktor)*(max-min)+min), db_zu_faktor :58, schief :61,
  // schief_pegel :63-69, defs() :72, entries :74-87. resonanz 0.3 and env_mod 0.4 are Linear 0..1 (direct); cutoff 800 Hz is Schief 40..5000,
  // faktor 2^-2; lautstaerke -12 dB is Schief 10^(-48/20)..1 with faktor schief_pegel(-48, 0).
  assert.equal(RB_VORGABE_NORM.resonanz, 0.3); assert.equal(RB_VORGABE_NORM.env_mod, 0.4);
  const cutoff = ((800 - 40) / (5000 - 40)) ** 0.25;
  assert.ok(Math.abs(RB_VORGABE_NORM.cutoff - cutoff) < 1e-12, String(RB_VORGABE_NORM.cutoff));
  assert.ok(Math.abs(RB_VORGABE_NORM.cutoff - 0.6256) < 1e-3, 'hand value ~0.6256');
  // independent hand value, worked out from schief_pegel(-48, 0) at -12 dB (not the formula of the implementation)
  assert.ok(Math.abs(RB_VORGABE_NORM.lautstaerke - 0.71034) < 1e-4, `lautstaerke: ${RB_VORGABE_NORM.lautstaerke}`);
  const vorC = RB_VORGABE_NORM.cutoff ** 4 * (5000 - 40) + 40;
  assert.ok(Math.abs(vorC - 800) < 1e-9, `cutoff maps back to 800 Hz: ${vorC}`);
});

test('S2 T1.7 laneWert needs the target: the dB mute rule is for fader only', () => {
  const pk = [{ beat: 0, wert: -200 }, { beat: 2, wert: 0 }];
  assert.equal(laneWert(pk, 1, 'fader'), -30, 'fader: the ramp from mute starts at -60');
  assert.equal(laneWert(pk, 1, 'pan'), -100, 'other targets interpolate the raw values');
});
