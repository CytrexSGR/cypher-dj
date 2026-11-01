// Automation Slice 1, task 10 (AK28): the gestures on a lane row, pure (node). One gesture = one command auto_punkte.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LaneGeste, zugBefehl, loeschBefehl, neuBefehl, sperrBefehl, LANEN_TEXT } from '../oeffentlich/produktion/lanen_bedienung.js';
import { wertZuY, punkteNach, laneWert, LANE_HOEHE } from '../oeffentlich/produktion/lanen.js';
import { entwurf } from '../oeffentlich/produktion/entwurf.js';

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
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'oeffentlich', 'produktion');
  const woerter = /\b(Lautst[aä]rke|Spur|Hinzuf[uü]gen|L[oö]schen|Linie|Punkt setzen|Fehler|Abbrechen|und|oder|nicht)\b/;
  const texte = Object.values(LANEN_TEXT).join('\n');
  assert.equal(woerter.test(texte), false, texte);
  assert.equal(LANEN_TEXT.knopf_titel, 'Show automation lanes of this track');
  assert.equal(LANEN_TEXT.titel, 'Automation');
  assert.equal(LANEN_TEXT.neu, '+ Lane');
  assert.equal(LANEN_TEXT.auto, 'AUTO');
  for (const f of ['lanen.js', 'lanen_bedienung.js']) {
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
