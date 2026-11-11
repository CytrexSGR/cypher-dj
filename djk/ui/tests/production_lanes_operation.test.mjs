// Automation Slice 1, task 10 (AK28): the gestures on a lane row, pure (node). One gesture = one command auto_punkte.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LaneGeste, zugBefehl, loeschBefehl, neuBefehl, sperrBefehl, LANEN_TEXT } from '../public/production/lanes_operation.js';
import { wertZuY, punkteNach, laneWert, LANE_HOEHE } from '../public/production/lanes.js';
import { entwurf } from '../public/production/draft.js';

const zeile = { y: 200, h: LANE_HOEHE };
const bx = (b) => b * 10, xb = (x) => x / 10;
const lane = { id: 'a1', ziel: 'fader', punkte: [{ beat: 0, wert: 0 }, { beat: 8, wert: -20 }, { beat: 16, wert: -20 }] };
const neueGeste = (l = lane, raster = 1) => new LaneGeste({ lane: l, zeile, beatZuX: bx, xZuBeat: xb, raster });
const yVon = (db) => wertZuY(zeile, db, 'fader');

test('S1 T10 gesture: a click on a free place sets one point, snapped to the raster, one command', () => {
  const g = neueGeste();
  assert.equal(g.down(40, yVon(-6)), 'leer');
  const r = g.up(40, yVon(-6));
  assert.equal(r.befehle.length, 1);
  assert.deepEqual(r.befehle[0], { befehl: 'auto_punkte', lane_id: 'a1', setze: [{ beat: 4, wert: r.befehle[0].setze[0].wert }] });
  assert.ok(Math.abs(r.befehle[0].setze[0].wert + 6) < 0.01);
});

test('S1 T10 gesture: a click on a place where a point of that beat exists sets nothing (it would replace the point)', () => {
  const g = neueGeste();
  g.down(80, yVon(-6));   // beat 8 has a point, but the click is far from it in y
  assert.deepEqual(g.up(80, yVon(-6)).befehle, []);
});

test('S1 T10 gesture: a twitch below the threshold moves nothing, a drag sends exactly ONE command on pointerup and none before', () => {
  const g = neueGeste();
  const px = 80, py = yVon(-20);
  assert.equal(g.down(px, py), 'punkt');
  assert.equal(g.move(px + 1, py + 1), null, '1 px: below the threshold');
  assert.equal(g.move(px + 2, py), null, '2 px: below the threshold');
  const gesendet = [];                              // what would be sent: only up() returns commands
  const entwuerfe = [g.move(px + 20, py - 5), g.move(px + 30, py - 8), g.move(px + 34, py - 10)];
  assert.ok(entwuerfe.every((e) => e && e.befehl === 'auto_punkte'), 'a draft for each move');
  assert.equal(gesendet.length, 0, 'nothing sent while moving');
  const r = g.up(px + 34, py - 10);
  assert.equal(r.befehle.length, 1, 'exactly one command after pointerup');
  const b = r.befehle[0];
  assert.deepEqual([b.befehl, b.lane_id, b.loesche_von, b.loesche_bis], ['auto_punkte', 'a1', 8, 8]);
  assert.equal(b.setze.length, 1);
  assert.equal(b.setze[0].beat, 11, 'moved by 34 px = 3.4 beats (beat 11.4), snapped to the beat grid: 11');
});

test('S1 T10 gesture: only a twitch gives no command at all on pointerup', () => {
  const g = neueGeste();
  g.down(80, yVon(-20));
  g.move(81, yVon(-20));
  assert.deepEqual(g.up(81, yVon(-20)).befehle, []);
});

test('S1 T10 gesture: dragging over the neighbour clamps to neighbour -/+ 1/16 beat and never pushes it', () => {
  const g = neueGeste(lane, 0);
  g.down(80, yVon(-20));
  g.move(400, yVon(-20));
  const b = g.up(400, yVon(-20)).befehle[0];
  assert.equal(b.setze[0].beat, 16 - 1 / 16);
  const nach = punkteNach(lane.punkte, b);
  assert.deepEqual(nach.map((p) => p.beat), [0, 16 - 1 / 16, 16], 'the neighbour stays at 16');
});

test('S1 T10 gesture: the value is clamped to -200..+6 dB and the beat to 0', () => {
  const g = neueGeste(lane, 0);
  g.down(0, yVon(0));
  g.move(-500, 0);
  const b = g.up(-500, 0).befehle[0];
  assert.equal(b.setze[0].beat, 0);
  assert.equal(b.setze[0].wert, 6);
});

test('S1 T10 gesture: two gestures in a row give both commands, in order', () => {
  const befehle = [];
  for (const [x, dx] of [[80, 10], [160, 5]]) {
    const g = neueGeste();
    g.down(x, yVon(-20));
    g.move(x - dx, yVon(-20));
    befehle.push(...g.up(x - dx, yVon(-20)).befehle);
  }
  assert.equal(befehle.length, 2);
  assert.deepEqual(befehle.map((b) => b.loesche_von), [8, 16]);
});

test('S1 T10 gesture: the jump partner at the same beat stays when one half is dragged or deleted', () => {
  const sprung = { id: 'a2', ziel: 'fader', punkte: [{ beat: 0, wert: 0 }, { beat: 8, wert: -10 }, { beat: 8, wert: -40 }, { beat: 16, wert: -40 }] };
  const z = zugBefehl(sprung, 1, { beat: 6, wert: -10 });
  assert.deepEqual(punkteNach(sprung.punkte, z).map((p) => [p.beat, p.wert]), [[0, 0], [6, -10], [8, -40], [16, -40]]);
  const d = loeschBefehl(sprung, 1);
  assert.deepEqual(punkteNach(sprung.punkte, d).map((p) => [p.beat, p.wert]), [[0, 0], [8, -40], [16, -40]]);
  assert.equal(loeschBefehl({ id: 'a3', punkte: [{ beat: 0, wert: 0 }] }, 0), null, 'the last point stays');
});

test('S1 T10 gesture: the draft shows the same lane the server will hold (entwurf applies auto_punkte)', () => {
  const projekt = { rev: 1, spuren: [{ id: 's1', clips: [], automation: [lane] }] };
  const b = zugBefehl(lane, 1, { beat: 10, wert: -12 });
  const e = entwurf(projekt, [b]);
  assert.deepEqual(e.spuren[0].automation[0].punkte.map((p) => [p.beat, p.wert]), [[0, 0], [10, -12], [16, -20]]);
  assert.deepEqual(projekt.spuren[0].automation[0].punkte.map((p) => p.beat), [0, 8, 16], 'the confirmed state is untouched');
  assert.deepEqual(neuBefehl(lane, 3, -4), { befehl: 'auto_punkte', lane_id: 'a1', setze: [{ beat: 3, wert: -4 }] });
});

test('S1 T10 texts are English: no German words in the new page files or texts', () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'production');
  const woerter = /\b(Lautst[aä]rke|Spur|Hinzuf[uü]gen|L[oö]schen|Linie|Punkt setzen|Fehler|Abbrechen|und|oder|nicht)\b/;
  const texte = Object.values(LANEN_TEXT).join('\n');
  assert.equal(woerter.test(texte), false, texte);
  assert.equal(LANEN_TEXT.knopf_titel, 'Show automation lanes of this track');
  assert.equal(LANEN_TEXT.titel, 'Automation');
  assert.equal(LANEN_TEXT.neu, '+ Lane');
  assert.equal(LANEN_TEXT.auto, 'AUTO');
  for (const f of ['lanes.js', 'lanes_operation.js', 'lanes_tools.js', 'takes.js', 'takes_operation.js']) {
    const quelle = fs.readFileSync(path.join(dir, f), 'utf8');
    const strings = [...quelle.matchAll(/'([^'\n]{12,})'/g)].map((m) => m[1]).filter((s) => !/^[./\w-]+$/.test(s) && !s.startsWith('#'));
    for (const s of strings) assert.equal(/\b(und|oder|nicht|Lautst[aä]rke)\b/.test(s), false, `${f}: ${s}`);
  }
});

// ---------------------------------------------------------------- Automation Slice 2, task 6

const panLane = { id: 'p1', ziel: 'pan', punkte: [{ beat: 0, wert: -1 }, { beat: 8, wert: 1 }] };
const muteLane = { id: 'm1', ziel: 'mute', punkte: [{ beat: 0, wert: 0, form: 'sprung' }, { beat: 8, wert: 1, form: 'sprung' }] };
const yP = (v, z = 'pan') => wertZuY(zeile, v, z);

test('S2 T6 gesture: a pan lane click sets one point with the pan value under the pointer, one command', () => {
  const g = neueGeste(panLane);
  assert.equal(g.down(40, yP(0.5)), 'leer');
  const r = g.up(40, yP(0.5));
  assert.equal(r.befehle.length, 1);
  assert.equal(r.befehle[0].befehl, 'auto_punkte');
  assert.equal(r.befehle[0].lane_id, 'p1');
  assert.equal(r.befehle[0].setze[0].beat, 4);
  assert.ok(Math.abs(r.befehle[0].setze[0].wert - 0.5) < 0.01, `pan ${r.befehle[0].setze[0].wert}`);
  assert.equal(r.befehle[0].setze[0].form, undefined, 'a pan point carries no form');
});

test('S2 T6 gesture: a pan drag is clamped to -1..+1 and sends one command', () => {
  const g = neueGeste(panLane, 0);
  g.down(80, yP(1));
  g.move(80, -500);
  const b = g.up(80, -500).befehle[0];
  assert.equal(b.setze[0].wert, 1);
  g.down(80, yP(1));
  g.move(80, 5000);
  assert.equal(g.up(80, 5000).befehle[0].setze[0].wert, -1);
});

test('S2 T6 gesture: a click on a mute lane toggles: the new point flips the level that holds there, and it is a jump', () => {
  const g = neueGeste(muteLane);
  assert.equal(g.down(120, yP(1, 'mute')), 'leer');            // beat 12: the level is 1 (muted) since beat 8
  const r = g.up(120, yP(1, 'mute'));
  assert.deepEqual(r.befehle, [{ befehl: 'auto_punkte', lane_id: 'm1', setze: [{ beat: 12, wert: 0, form: 'sprung' }] }]);
  const g2 = neueGeste(muteLane);
  g2.down(40, yP(0, 'mute'));                                   // beat 4: the level is 0
  assert.deepEqual(g2.up(40, yP(0, 'mute')).befehle[0].setze, [{ beat: 4, wert: 1, form: 'sprung' }]);
});

test('S2 T6 gesture: every point sent on a mute or solo lane is a jump, also a drag, a partner and neuBefehl', () => {
  const alle = [];
  for (const z of ['mute', 'solo']) {
    const l = { id: `x${z}`, ziel: z, punkte: [{ beat: 0, wert: 0 }, { beat: 8, wert: 1 }, { beat: 8, wert: 0 }] };   // points without form: normalised by the server, not trusted here
    const g = neueGeste(l, 0);
    g.down(0, yP(0, z)); g.move(20, yP(1, z));
    alle.push(...g.up(20, yP(1, z)).befehle, loeschBefehl(l, 1), neuBefehl(l, 3, 1));
  }
  const punkte = alle.flatMap((b) => b.setze ?? []);
  assert.ok(punkte.length >= 6, `${punkte.length} points`);
  assert.deepEqual([...new Set(punkte.map((q) => q.form))], ['sprung']);
});

test('S2 T6 gesture: dragging a mute point lands on 0 or 1 only', () => {
  const g = neueGeste(muteLane, 0);
  g.down(80, yP(1, 'mute'));
  g.move(100, yP(0.4, 'mute') + 3);
  const b = g.up(100, yP(0.4, 'mute') + 3).befehle[0];
  assert.ok(b.setze[0].wert === 0 || b.setze[0].wert === 1, String(b.setze[0].wert));
});

test('S2 T6 gesture: a locked lane sends nothing, whatever the gesture is (click, drag, click on a point)', () => {
  const zu = { ...panLane, gesperrt: true };
  for (const [x0, y0, x1, y1] of [[40, yP(0.5), 40, yP(0.5)], [0, yP(-1), 60, yP(0.3)], [80, yP(1), 80, yP(1)]]) {
    const g = neueGeste(zu);
    assert.equal(g.down(x0, y0), 'gesperrt');
    assert.equal(g.move(x1, y1), null);
    const r = g.up(x1, y1);
    assert.deepEqual(r.befehle, [], `gesture from ${x0},${y0}`);
    assert.equal(r.hinweis, LANEN_TEXT.gesperrt);
  }
  const offen = neueGeste(panLane);                              // positive control: the same click on the unlocked lane does send
  offen.down(40, yP(0.5));
  assert.equal(offen.up(40, yP(0.5)).befehle.length, 1);
});

test('S2 T6 lock button: sperrBefehl sends auto_aendern with the opposite of the state, and gesperrt: false unlocks', () => {
  assert.deepEqual(sperrBefehl(panLane), { befehl: 'auto_aendern', lane_id: 'p1', gesperrt: true });
  assert.deepEqual(sperrBefehl({ ...panLane, gesperrt: true }), { befehl: 'auto_aendern', lane_id: 'p1', gesperrt: false });
});

test('S2 T6 texts: the new texts are English', () => {
  const woerter = /\b(Sperre|gesperrt|Spur|Linie|und|oder|nicht|Entsperren)\b/;
  for (const [k, v] of Object.entries(LANEN_TEXT)) assert.equal(woerter.test(v), false, `${k}: ${v}`);
  assert.equal(LANEN_TEXT.gesperrt, 'That line is locked: unlock it first');
});

// ---------------------------------------------------------------- Automation Slice 2, task 6, fix round 1

const punkteVon = (b) => b.setze.map((q) => [q.beat, q.wert, q.form]);
const klick = (l, beat, raster = 0, v = 0) => { const g = neueGeste(l, raster); g.down(beat * 10, yP(v, l.ziel)); return g.up(beat * 10, yP(v, l.ziel)); };
const schalter = (punkte, ziel = 'mute') => ({ id: 'w1', ziel, punkte: punkte.map(([beat, wert]) => ({ beat, wert, form: 'sprung' })) });

test('S2 T6 fix 2a: a switch click reads the level at the SNAPPED beat (points 0 and 3.5, grid 2, click at 3.4: the level at 4 is already 1, so it flips to 0)', () => {
  const l = schalter([[0, 0], [3.5, 1]]);
  const r = klick(l, 3.4, 2);
  assert.deepEqual(punkteVon(r.befehle[0]), [[4, 0, 'sprung']]);
  const l2 = schalter([[0, 0], [3.5, 1]]);                 // control: unsnapped grid reads at 3.4, where the level is still 0: flips to 1
  assert.deepEqual(punkteVon(klick(l2, 3.4, 0).befehle[0]), [[3.4, 1, 'sprung']]);
});

test('S2 T6 fix 2b: a click left of the first point adds a point at beat 0 with the old level, so only [click, first point) flips', () => {
  const l = schalter([[8, 1], [16, 0]]);                   // the first level (1) holds to the left of beat 8
  const r = klick(l, 4, 1);
  assert.deepEqual(punkteVon(r.befehle[0]), [[0, 1, 'sprung'], [4, 0, 'sprung']]);
  const nach = punkteNach(l.punkte, r.befehle[0]);
  assert.deepEqual(nach.map((p) => [p.beat, p.wert]), [[0, 1], [4, 0], [8, 1], [16, 0]]);
  assert.equal(laneWert(nach, 2, 'mute'), 1, 'left of the click the old level is unchanged');
  assert.equal(laneWert(nach, 5, 'mute'), 0, 'between click and first point it flipped');
  assert.equal(laneWert(nach, 9, 'mute'), 1, 'from the first point on nothing changed');
  assert.deepEqual(punkteVon(klick(l, 0, 1).befehle[0]), [[0, 0, 'sprung']], 'a click at beat 0 needs no extra point');
  const nachFirst = klick(schalter([[0, 0], [8, 1]]), 4, 1);
  assert.equal(nachFirst.befehle[0].setze.length, 1, 'negative control: a click between points sends one point');
});

test('S2 T6 fix 2c: a click on the beat of an existing point on the other level replaces it (flip from that beat), never a third point', () => {
  const l = schalter([[0, 0], [8, 1]]);
  const r = klick(l, 8, 1);
  assert.deepEqual(punkteVon(r.befehle[0]), [[8, 0, 'sprung']]);
  const nach = punkteNach(l.punkte, r.befehle[0]);
  assert.deepEqual(nach.map((p) => [p.beat, p.wert]), [[0, 0], [8, 0]]);
  const sprung = schalter([[0, 0], [8, 0], [8, 1]]);       // a jump of two points at one beat: still at most two, here replaced by one
  assert.ok(punkteNach(sprung.punkte, klick(sprung, 8, 1, 0.5).befehle[0]).filter((p) => p.beat === 8).length <= 2);
});

test('S2 T6 fix 4: a lane of an unknown target takes no gesture and shows the "not supported" hint', () => {
  const fremd = { id: 'x1', ziel: 'geraet.zukunft', punkte: [{ beat: 0, wert: 0.5 }, { beat: 8, wert: 0.2 }] };
  const g = neueGeste(fremd);
  assert.equal(g.down(40, yP(0.5, 'geraet.cutoff')), 'gesperrt');
  assert.equal(g.move(60, yP(0.1, 'geraet.cutoff')), null);
  const r = g.up(60, yP(0.1, 'geraet.cutoff'));
  assert.deepEqual(r.befehle, []);
  assert.equal(r.hinweis, 'This lane type is not supported by this page');
  assert.equal(LANEN_TEXT.unbekannt, 'This lane type is not supported by this page');
});

// ---------------------------------------------------------------- 1.12 automation slice 4 (plan PLAN-1.12-slices4-5-7.md, unit U4)
import { punktMenue, bereichMenue, formBefehl, bereichLoeschBefehl, LanenWahl } from '../public/production/lanes_operation.js';
import { bereichGriff } from '../public/production/lanes.js';
import { fuehreAus } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';

const mitBereich = (l, bereich, raster = 1) => new LaneGeste({ lane: l, zeile, beatZuX: bx, xZuBeat: xb, raster, bereich });

test('S4 T4.2 range: a drag in the empty selects a snapped range and sends nothing; a click still sets a point; Esc clears', () => {
  const g = neueGeste(lane, 1);
  assert.equal(g.down(21, yVon(-40)), 'leer');
  assert.equal(g.move(22, yVon(-40)), null, 'below the threshold');
  assert.equal(g.move(58, yVon(-40)), null, 'a range sends no draft command');
  assert.deepEqual(g.bereich, { von: 2, bis: 6 });
  assert.deepEqual(g.up(58, yVon(-40)), { befehle: [], hinweis: null, bereich: { von: 2, bis: 6 } });
  const r = neueGeste(lane, 1);                         // dragged right to left: the range is the same
  r.down(58, yVon(-40)); r.move(21, yVon(-40));
  assert.deepEqual(r.up(21, yVon(-40)).bereich, { von: 2, bis: 6 });
  const k = neueGeste(lane, 1);                         // negative control: a click without movement still sets one point
  k.down(40, yVon(-6));
  assert.equal(k.up(40, yVon(-6)).befehle.length, 1);
  const z = neueGeste(lane, 1);                         // a drag that snaps to an empty range selects nothing
  z.down(21, yVon(-40)); z.move(24, yVon(-40));
  assert.equal(z.up(24, yVon(-40)).bereich, undefined);
  const w = new LanenWahl();
  w.setze('a1', { von: 2, bis: 6 });
  assert.deepEqual(w.fuer('a1'), { von: 2, bis: 6 }); assert.equal(w.fuer('a2'), null);
  assert.equal(w.taste('x'), false); assert.deepEqual(w.fuer('a1'), { von: 2, bis: 6 }, 'another key keeps the range');
  assert.equal(w.taste('Escape'), true); assert.equal(w.fuer('a1'), null);
  const zu = mitBereich({ ...lane, gesperrt: true }, null);
  assert.equal(zu.down(21, yVon(-40)), 'gesperrt'); zu.move(58, yVon(-40));
  assert.equal(zu.up(58, yVon(-40)).bereich, undefined, 'no range on a locked lane');
});

test('S4 T4.3 point menu: Linear / S-curve / Jump; one auto_punkte that keeps the partner; disabled on mute; hint on a locked lane', () => {
  const sprung = { id: 'a2', ziel: 'fader', punkte: [{ beat: 0, wert: 0 }, { beat: 8, wert: -10 }, { beat: 8, wert: -40, form: 'sprung' }, { beat: 16, wert: -40, form: 's' }] };
  const m = punktMenue(sprung, 1);
  assert.deepEqual(m.map((x) => x.text), ['Linear', 'S-curve', 'Jump']);
  assert.equal(m[0].aus, true, 'the current form (linear) is disabled');
  assert.ok(m.slice(1).every((x) => !x.aus && x.befehl.befehl === 'auto_punkte'));
  const s = m[1].befehl;
  assert.deepEqual(s, formBefehl(sprung, 1, 's'));
  assert.deepEqual(punkteNach(sprung.punkte, s), [{ beat: 0, wert: 0 }, { beat: 8, wert: -10, form: 's' }, { beat: 8, wert: -40, form: 'sprung' }, { beat: 16, wert: -40, form: 's' }]);
  assert.deepEqual(punkteNach(sprung.punkte, punktMenue(sprung, 3)[0].befehl).at(-1), { beat: 16, wert: -40 }, 'Linear drops the form key');
  assert.ok(punktMenue(sprung, 3)[1].aus, 'the current form is shown disabled');
  const mu = punktMenue(muteLane, 1);
  assert.equal(mu.length, 3); assert.ok(mu.every((x) => x.aus && !x.befehl), 'mute: all three disabled');
  const zu = punktMenue({ ...sprung, gesperrt: true }, 1);
  assert.deepEqual(zu, [{ text: LANEN_TEXT.gesperrt, aus: true }]);
  // server round trip: the command is accepted and changes only the form
  let p = fuehreAus(neuesProjekt('T'), { befehl: 'spur_neu', art: 'audio', name: 'A' }).projekt;
  p = fuehreAus(p, { befehl: 'auto_neu', spur_id: 's1', ziel: 'fader', punkte: sprung.punkte }).projekt;
  const id = p.spuren[0].automation[0].id;
  const nach = fuehreAus(p, formBefehl({ ...sprung, id }, 1, 'sprung')).projekt.spuren[0].automation[0].punkte;
  assert.deepEqual(nach, [{ beat: 0, wert: 0 }, { beat: 8, wert: -10, form: 'sprung' }, { beat: 8, wert: -40, form: 'sprung' }, { beat: 16, wert: -40, form: 's' }]);
});

test('S4 T4.4 range menu: five shapes, Simplify, Delete points; each one command with the range; delete of every point keeps one', () => {
  const m = bereichMenue(lane, { von: 2, bis: 12 });
  assert.deepEqual(m.map((x) => x.text), ['Insert shape', 'Ramp up', 'Ramp down', 'Sine', 'Triangle', 'Square', 'Simplify', 'Delete points']);
  assert.equal(m[0].gruppe, true); assert.equal(m[0].befehl, undefined);
  assert.deepEqual(m.slice(1, 6).map((x) => x.befehl), ['rampe_auf', 'rampe_ab', 'sinus', 'dreieck', 'rechteck']
    .map((form) => ({ befehl: 'auto_form', lane_id: 'a1', von_beat: 2, bis_beat: 12, form })));
  assert.deepEqual(m[6].befehl, { befehl: 'auto_vereinfachen', lane_id: 'a1', von_beat: 2, bis_beat: 12 });
  assert.deepEqual(m[7].befehl, { befehl: 'auto_punkte', lane_id: 'a1', loesche_von: 2, loesche_bis: 12 }, 'only some points: no setze (negative control)');
  const mu = bereichMenue(muteLane, { von: 0, bis: 4 });
  assert.deepEqual(mu.filter((x) => x.befehl?.befehl === 'auto_form').map((x) => x.befehl.form), ['rechteck'], 'mute: Square only');
  assert.ok(mu.slice(1, 5).every((x) => x.aus));
  assert.deepEqual(bereichMenue({ ...lane, gesperrt: true }, { von: 2, bis: 12 }), [{ text: LANEN_TEXT.gesperrt, aus: true }]);
  // all points of a 5-point lane in the range: one command, the server keeps one point at von with the lane value there
  const fuenf = { id: 'a1', ziel: 'fader', punkte: [{ beat: 2, wert: -10 }, { beat: 4, wert: -20 }, { beat: 6, wert: 0 }, { beat: 8, wert: -5 }, { beat: 10, wert: -7 }] };
  const b = bereichLoeschBefehl(fuenf, { von: 1, bis: 11 });
  assert.deepEqual(b, { befehl: 'auto_punkte', lane_id: 'a1', loesche_von: 1, loesche_bis: 11, setze: [{ beat: 1, wert: -10 }] });
  let p = fuehreAus(neuesProjekt('T'), { befehl: 'spur_neu', art: 'audio', name: 'A' }).projekt;
  p = fuehreAus(p, { befehl: 'auto_neu', spur_id: 's1', ziel: 'fader', punkte: fuenf.punkte }).projekt;
  assert.deepEqual(fuehreAus(p, b).projekt.spuren[0].automation[0].punkte, [{ beat: 1, wert: -10 }]);
  assert.equal(laneWert([{ beat: 1, wert: -10 }], 0, 'fader'), laneWert(fuenf.punkte, 0, 'fader'), 'the value before the range is kept');
});

test('S4 T4.5 stretch handle: dragging the right edge drafts and sends one auto_dehnen; release without movement sends nothing', () => {
  const bereich = { von: 2, bis: 8 };
  assert.equal(bereichGriff(bereich, zeile, bx, 80, zeile.y + 30), 'dehnen');
  assert.equal(bereichGriff(bereich, zeile, bx, 80, zeile.y + 2), 'neigen');
  assert.equal(bereichGriff(bereich, zeile, bx, 20, zeile.y + 2), 'neigen');
  assert.equal(bereichGriff(bereich, zeile, bx, 50, zeile.y + 30), null);
  assert.equal(bereichGriff(null, zeile, bx, 80, zeile.y + 30), null);
  const g = mitBereich(lane, bereich);
  assert.equal(g.down(80, zeile.y + 30), 'griff');
  const d = g.move(120, zeile.y + 30);
  assert.deepEqual(d, { befehl: 'auto_dehnen', lane_id: 'a1', von_beat: 2, bis_beat: 8, neu_bis_beat: 12 });
  assert.deepEqual(g.up(120, zeile.y + 30).befehle, [d]);
  const n = mitBereich(lane, bereich);
  n.down(80, zeile.y + 30); n.move(81, zeile.y + 30);
  assert.deepEqual(n.up(81, zeile.y + 30).befehle, [], 'a twitch sends nothing');
  const s = mitBereich(lane, bereich);
  s.down(80, zeile.y + 30); s.move(10, zeile.y + 30);
  assert.equal(s.up(10, zeile.y + 30).befehle[0].neu_bis_beat, 3, 'the new end stays one grid step after von');
});

test('S4 T4.5 probe finding: after a stretch the selected range follows the new end (the next skew or insert works on what is shown)', () => {
  const g = mitBereich(lane, { von: 2, bis: 8 });
  g.down(80, zeile.y + 30); g.move(120, zeile.y + 30);
  assert.deepEqual(g.up(120, zeile.y + 30).bereich, { von: 2, bis: 12 }, 'the range now ends where the stretched shape ends');
  const n = mitBereich(lane, { von: 2, bis: 8 });
  n.down(80, zeile.y + 30); n.move(81, zeile.y + 30);
  assert.equal(n.up(81, zeile.y + 30).bereich, undefined, 'negative control: a twitch leaves the range alone');
  const k = mitBereich(lane, { von: 2, bis: 8 });
  k.down(80, zeile.y + 2); k.move(80, zeile.y + 2 - zeile.h / 4);
  assert.equal(k.up(80, zeile.y + 2 - zeile.h / 4).bereich, undefined, 'negative control: a skew keeps the range');
});

test('S4 T4.6 skew handle: vertical drag maps to faktor -1..1 (half the row height = 1), draft while dragging, one auto_neigen', () => {
  const g = mitBereich(lane, { von: 2, bis: 8 });
  assert.equal(g.down(80, zeile.y + 2), 'griff');
  const d = g.move(80, zeile.y + 2 - zeile.h / 4);
  assert.deepEqual(d, { befehl: 'auto_neigen', lane_id: 'a1', von_beat: 2, bis_beat: 8, faktor: 0.5 });
  assert.equal(g.move(80, zeile.y + 2 + zeile.h * 3).faktor, -1, 'clamped');
  assert.deepEqual(g.up(80, zeile.y + 2 + zeile.h * 3).befehle, [{ befehl: 'auto_neigen', lane_id: 'a1', von_beat: 2, bis_beat: 8, faktor: -1 }]);
  const n = mitBereich(lane, { von: 2, bis: 8 });
  n.down(80, zeile.y + 2);
  assert.deepEqual(n.up(80, zeile.y + 2).befehle, [], 'release without movement');
});

// ---------------------------------------------------------------- 1.12 automation slice 4, unit U5: freehand (D1)
import { freihandPunkte, MAX_PUNKTE as MAX_P } from '../public/production/lanes.js';
import { freihandBefehle } from '../public/production/lanes_operation.js';
import { fuehreListeAus } from '../project/commands.ts';
import { wende } from '../project/patch.ts';
import { ohneAbgeleitetes } from './support/project.mjs';

const strich = (x0, x1, wertVon) => {   // pointer samples every 1 px from x0 to x1 (10 px per beat)
  const pfad = [];
  for (let x = x0; x0 <= x1 ? x <= x1 : x >= x1; x += x0 <= x1 ? 1 : -1) pfad.push({ x, beat: xb(x), wert: wertVon(xb(x)) });
  return pfad;
};

test('S4 T5.1 freihandPunkte: grid on -> one sprung point per grid step; grid off -> one linear point per 2 px; capped', () => {
  const pfad = strich(20, 60, (b) => -b * 5);                  // beats 2..6
  const an = freihandPunkte(pfad, 1, 'fader');
  assert.deepEqual(an, { von: 2, bis: 6, punkte: [2, 3, 4, 5, 6].map((b) => ({ beat: b, wert: -b * 5, form: 'sprung' })) });
  const aus = freihandPunkte(pfad, 0, 'fader');
  assert.equal(aus.punkte.length, 21, '40 px -> a point every 2 px');
  assert.ok(aus.punkte.every((q) => !('form' in q)), 'linear points carry no form');
  assert.deepEqual([aus.von, aus.bis], [2, 6]);
  const rueck = freihandPunkte(strich(60, 20, (b) => -b), 0, 'fader');   // drawn right to left: sorted by beat
  assert.deepEqual(rueck.punkte.map((q) => q.beat), aus.punkte.map((q) => q.beat));
  const klemm = freihandPunkte(strich(0, 10, () => 50), 1, 'fader');
  assert.ok(klemm.punkte.every((q) => q.wert === 6), 'values clamped to the target range');
  // the cap counts the points that stay outside the range
  const voll = Array.from({ length: MAX_P - 3 }, (_, i) => ({ beat: 100 + i, wert: 0 }));
  assert.equal(freihandPunkte(pfad, 1, 'fader', voll), null, '5 new + 8189 outside > 8192');
  assert.notEqual(freihandPunkte(strich(20, 40, () => 0), 1, 'fader', voll), null, '3 new + 8189 = 8192 fits');
  assert.equal(freihandPunkte([pfad[0]], 0, 'fader').punkte.length, 1);
});

test('S4 T5.2 draw mode: a drag with grid off sends [auto_punkte, auto_vereinfachen], with grid on [auto_punkte] only; a click sets one point', () => {
  const zeichne = (raster) => new LaneGeste({ lane, zeile, beatZuX: bx, xZuBeat: xb, raster, zeichnen: true });
  const g = zeichne(0);
  assert.equal(g.down(20, yVon(-10)), 'zeichnen');
  let d = null;
  for (let x = 21; x <= 60; x++) d = g.move(x, yVon(-10 - (x - 20) / 4)) ?? d;
  assert.equal(d.befehl, 'auto_punkte', 'the draft is the auto_punkte part');
  const r = g.up(60, yVon(-20));
  assert.equal(r.label, 'Draw automation');
  assert.deepEqual(r.befehle.map((b) => b.befehl), ['auto_punkte', 'auto_vereinfachen']);
  assert.deepEqual(r.befehle[1], { befehl: 'auto_vereinfachen', lane_id: 'a1', von_beat: r.befehle[0].loesche_von, bis_beat: r.befehle[0].loesche_bis });
  const h = zeichne(0.25);
  h.down(0, yVon(-10));
  for (let x = 1; x <= 40; x++) h.move(x, yVon(-10 - x / 4));
  const s = h.up(40, yVon(-20));
  assert.equal(s.label, 'Draw automation');
  assert.deepEqual(s.befehle.map((b) => b.befehl), ['auto_punkte'], 'grid on: exactly [auto_punkte] (D1)');
  assert.equal(s.befehle[0].setze.length, 17, 'beats 0..4 at grid 1/4');
  assert.ok(s.befehle[0].setze.every((q) => q.form === 'sprung'));
  const k = zeichne(1);                                   // a click in draw mode sets one point, as outside draw mode
  k.down(40, yVon(-6));
  assert.deepEqual(k.up(40, yVon(-6)).befehle.map((b) => [b.befehl, b.setze.length]), [['auto_punkte', 1]]);
  const zu = new LaneGeste({ lane: { ...lane, gesperrt: true }, zeile, beatZuX: bx, xZuBeat: xb, raster: 0, zeichnen: true });
  assert.equal(zu.down(20, yVon(-10)), 'gesperrt'); zu.move(60, yVon(-10));
  assert.deepEqual(zu.up(60, yVon(-10)).befehle, []);
  // server round trip of the grid-on stroke: one sprung point per step stays (count equal to the steps sent)
  let p = fuehreAus(neuesProjekt('T'), { befehl: 'spur_neu', art: 'audio', name: 'A' }).projekt;
  p = fuehreAus(p, { befehl: 'auto_neu', spur_id: 's1', ziel: 'fader', punkte: lane.punkte }).projekt;
  const neu = fuehreListeAus(p, s.befehle).projekt.spuren[0].automation[0].punkte;
  assert.equal(neu.filter((q) => q.beat >= 0 && q.beat <= 4 && q.form === 'sprung').length, 17);
});

test('S4 T5.3 a 400 px freehand stroke (grid off) over a fader lane is one change: one undo step restores the lane deep equal', () => {
  let p = fuehreAus(neuesProjekt('T'), { befehl: 'spur_neu', art: 'audio', name: 'A' }).projekt;
  p = fuehreAus(p, { befehl: 'auto_neu', spur_id: 's1', ziel: 'fader', punkte: lane.punkte }).projekt;
  const g = new LaneGeste({ lane: p.spuren[0].automation[0], zeile, beatZuX: bx, xZuBeat: xb, raster: 0, zeichnen: true });
  g.down(10, yVon(-30));
  for (let x = 11; x <= 410; x++) g.move(x, yVon(-30 + 20 * Math.sin(x / 30)));
  const befehle = g.up(410, yVon(-30)).befehle;
  assert.deepEqual(befehle.map((b) => b.befehl), ['auto_punkte', 'auto_vereinfachen']);
  assert.equal(typeof freihandBefehle, 'function');
  const r = fuehreListeAus(p, befehle);
  const nach = r.projekt.spuren[0].automation[0].punkte;
  assert.ok(nach.length > 3 && nach.length < 201, `simplified on the server: ${nach.length} points from 201 samples`);
  assert.equal(ohneAbgeleitetes(wende(r.projekt, r.zurueck)), ohneAbgeleitetes(p), 'one undo step restores the lane');
});
