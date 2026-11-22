// Session column and cell component (session view S1, lane P1) on the DOM stand-in. No fetch, no studio port.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { installiere } from './helpers/pages_mock.mjs';

installiere({ html: '<body><div id="host"></div></body>' });
const { baueSpalte, zellZustand, spielAnteil } = await import('../public/session/spalte.js');

const lauf0 = () => ({ zelle: null, verwaist: false, ab_beat: 0, versatz_beats: 0, wartend: null, zuletzt: null });
const zelle = (n, extra = {}) => ({ id: `z${n}`, name: `cell ${n}`, farbe: n, art: 'loop', sha256: `sha${n}`, beats: 8, frames: 1000, ...extra });
const spalte = (extra = {}) => ({ spur_id: 's1', kurz: 'C1', name: 'Track one', art: 'audio', deck: 1, spur: 1,
  zellen: [zelle(1), null, zelle(3), { halten: true }, null, null, null, null], lauf: lauf0(), ...extra });
const knoten = (s) => { const n = []; const geh = (e) => { n.push(e); e.children.forEach((c) => typeof c !== 'string' && geh(c)); }; geh(s); return n.length; };
const neu = (opt = {}) => {
  const anrufe = [];
  const wurzel = document.createElement('div');
  const h = baueSpalte(wurzel, { variante: 'voll', beiStart: (i) => anrufe.push(['start', i]), beiStopp: () => anrufe.push(['stopp']),
    beiWahl: (i) => anrufe.push(['wahl', i]), beiAblegen: (i, x) => anrufe.push(['ablegen', i, x]), beiWelleKlick: (a) => anrufe.push(['welle', a]), ...opt });
  return { wurzel, h, anrufe, zelleN: (i) => wurzel.querySelector(`.zelle[data-zelle="${i}"]`) };
};

test('zellZustand maps every cell state', () => {
  const l = (x) => ({ ...lauf0(), ...x });
  assert.equal(zellZustand(spalte({ lauf: l({ zelle: 1 }) }), 0, 4), 'spielt');
  assert.equal(zellZustand(spalte({ lauf: l({ wartend: { zelle: 3, ab_beat: 8 } }) }), 2, 4), 'wartet');
  assert.equal(zellZustand(spalte({ lauf: l({ zelle: 1, wartend: { zelle: null, ab_beat: 8 } }) }), 0, 4), 'stopp_wartet');
  assert.equal(zellZustand(spalte({ lauf: l({ zelle: 1, wartend: { zelle: null, ab_beat: 8 } }) }), 2, 4), 'voll');
  assert.equal(zellZustand(spalte(), 3, 4), 'halten');
  assert.equal(zellZustand(spalte(), 1, 4), 'leer');
  assert.equal(zellZustand(spalte(), 2, 4), 'voll');
  assert.equal(zellZustand(spalte({ lauf: l({ zelle: 1, verwaist: true }) }), 0, 4), 'voll');
});

test('spielAnteil follows ((beat - ab_beat + versatz) mod beats) / beats and is 0 when silent', () => {
  const l = { ...lauf0(), zelle: 1, ab_beat: 10, versatz_beats: 1 };
  assert.equal(spielAnteil(l, zelle(1, { beats: 4 }), 12), 0.75);
  assert.equal(spielAnteil(l, zelle(1, { beats: 4 }), 13), 0);
  assert.equal(spielAnteil(lauf0(), zelle(1, { beats: 4 }), 12), 0);
  assert.equal(spielAnteil(undefined, zelle(1), 12), 0);
  assert.equal(spielAnteil(l, null, 12), 0);
  assert.equal(spielAnteil(l, zelle(1, { beats: 4 }), 5), 0.25, 'before the launch took effect: the start position, as spielPos');
});

test('variante sets data-variante', () => {
  assert.equal(neu({ variante: 'kompakt' }).wurzel.querySelector('.spalte').dataset.variante, 'kompakt');
  assert.equal(neu({ variante: 'voll' }).wurzel.querySelector('.spalte').dataset.variante, 'voll');
  assert.equal(neu({ variante: 'quatsch' }).wurzel.querySelector('.spalte').dataset.variante, 'voll');
});

test('column has head, strip, eight cells, stop button and zug-slot', () => {
  const { wurzel, h } = neu();
  h.zeichne(spalte(), null);
  for (const s of ['.kopf-spalte', '.jetzt', '.jetzt .kopf-ph', '.stopp', '.zug-slot']) assert.ok(wurzel.querySelector(s), s);
  assert.equal(wurzel.querySelectorAll('.zelle').length, 8);
  assert.equal(wurzel.querySelectorAll('.zelle .mw').length, 8);
  assert.equal(wurzel.querySelector('.kurz').textContent, 'C1');
  assert.equal(wurzel.querySelector('.tname').textContent, 'Track one');
});

test('zeichne shows name, length in bars, colour and state classes', () => {
  const { h, zelleN } = neu();
  h.zeichne(spalte({ lauf: { ...lauf0(), zelle: 1 } }), 3);
  assert.ok(zelleN(1).classList.contains('spielt'));
  assert.ok(zelleN(1).classList.contains('voll'));
  assert.ok(zelleN(2).classList.contains('leer'));
  assert.ok(zelleN(4).classList.contains('halten'));
  assert.ok(zelleN(3).classList.contains('gewaehlt'), 'selected cell');
  assert.equal(zelleN(1).querySelector('.nm').textContent, 'cell 1');
  assert.equal(zelleN(1).querySelector('.kd').textContent, '2');
  assert.equal(zelleN(1).querySelector('.go').textContent, '▶', 'also while playing');
  assert.equal(zelleN(2).querySelector('.go').textContent, '');
  assert.equal(zelleN(2).querySelector('.nm').textContent, '');
});

test('pending start blinks the cell, pending stop the stop button', () => {
  const { h, wurzel, zelleN } = neu();
  h.zeichne(spalte({ lauf: { ...lauf0(), zelle: 1, wartend: { zelle: 3, ab_beat: 8 } } }), null);
  assert.ok(zelleN(3).classList.contains('wartet'));
  h.zeichne(spalte({ lauf: { ...lauf0(), zelle: 1, wartend: { zelle: null, ab_beat: 8 } } }), null);
  assert.ok(zelleN(1).classList.contains('stopp_wartet'));
  assert.ok(wurzel.querySelector('.stopp').classList.contains('wartet'));
  assert.ok(!zelleN(3).classList.contains('wartet'));
});

test('kompakt: click on the play area starts a filled cell only; name selects; stop button stops', () => {
  const { h, zelleN, wurzel, anrufe } = neu({ variante: 'kompakt' });
  h.zeichne(spalte(), null);
  zelleN(3).querySelector('.go').click();
  zelleN(2).querySelector('.go').click();   // the play area of an empty cell selects it as load target (as on main)
  zelleN(4).querySelector('.go').click();   // a hold slot does nothing
  assert.deepEqual(anrufe, [['start', 3], ['wahl', 2]]);
  zelleN(2).querySelector('.nm').click();
  zelleN(1).querySelector('.nm').click();
  assert.deepEqual(anrufe.slice(2), [['wahl', 2], ['wahl', 1]]);
  wurzel.querySelector('.stopp').click();
  assert.deepEqual(anrufe.at(-1), ['stopp']);
});

test('a drop on a cell calls beiAblegen with the cell number and the content', () => {
  const { h, zelleN, anrufe } = neu();
  h.zeichne(spalte(), null);
  const dt = { types: ['application/x-djk-loopquelle'], getData: (t) => (t === 'application/x-djk-loopquelle' ? '{"sha":"abc"}' : '') };
  zelleN(2).dispatch('drop', { dataTransfer: dt });
  assert.deepEqual(anrufe, [['ablegen', 2, { art: 'quelle', quelle: { sha: 'abc' } }]]);
});

test('zeichne with an unknown or missing lauf draws all cells idle without throwing', () => {
  const { h, wurzel } = neu();
  for (const lauf of [undefined, null, {}, { zelle: 99, wartend: { zelle: 77 } }]) {
    assert.doesNotThrow(() => h.zeichne(spalte({ lauf }), null));
    assert.equal(wurzel.querySelectorAll('.zelle.spielt').length, 0);
    assert.equal(wurzel.querySelectorAll('.zelle.wartet').length, 0);
  }
  assert.doesNotThrow(() => h.zeichne(spalte({ zellen: undefined }), null));
  assert.equal(wurzel.querySelectorAll('.zelle.leer').length, 8);
  assert.doesNotThrow(() => h.zeichne(undefined, null));
  assert.doesNotThrow(() => h.position(4));
});

test('zeichne twice with the same state does not grow the DOM', () => {
  const { h, wurzel } = neu();
  h.zeichne(spalte(), 1);
  const a = knoten(wurzel);
  for (let i = 0; i < 5; i++) h.zeichne(spalte(), 1);
  assert.equal(knoten(wurzel), a);
});

test('position moves the playhead and progress bar of the playing cell, entferne removes the column', () => {
  const { h, wurzel, zelleN } = neu();
  h.zeichne(spalte({ lauf: { ...lauf0(), zelle: 1, ab_beat: 0 }, zellen: [zelle(1, { beats: 4 }), null, null, null, null, null, null, null] }), null);
  h.position(1);
  assert.equal(wurzel.querySelector('.kopf-ph').style.left, '25%');
  assert.equal(zelleN(1).querySelector('.prog').style.width, '25%');
  h.entferne();
  assert.equal(wurzel.querySelector('.spalte'), null);
});

const ohneBeats = (extra = {}) => zelle(1, { beats: undefined, frames: 96000, ...extra });   // 2 s of audio
test('a cell without beats takes its length from frames at the cell or passed tempo', () => {
  // 2 s at 120 bpm = 4 beats = 1 bar
  const lauf = { ...lauf0(), zelle: 1, ab_beat: 0 };
  assert.equal(spielAnteil(lauf, ohneBeats({ bpm: 120 }), 1), 0.25);
  assert.equal(spielAnteil(lauf, ohneBeats(), 1, 120), 0.25);
  const { h, wurzel, zelleN } = neu();
  h.zeichne(spalte({ lauf, zellen: [ohneBeats({ bpm: 120 }), null, null, null, null, null, null, null] }), null);
  assert.equal(zelleN(1).querySelector('.kd').textContent, '1');
  h.position(2);
  assert.equal(wurzel.querySelector('.kopf-ph').style.left, '50%');
  assert.ok(!wurzel.querySelector('.kopf-ph').hidden);
  const b = neu();
  b.h.zeichne(spalte({ lauf, zellen: [ohneBeats(), null, null, null, null, null, null, null] }), null, 120);
  b.h.position(1, 120);
  assert.equal(b.wurzel.querySelector('.kopf-ph').style.left, '25%');
});

test('a one-shot clamps at 1 instead of wrapping', () => {
  const lauf = { ...lauf0(), zelle: 1, ab_beat: 0 };
  assert.equal(spielAnteil(lauf, zelle(1, { beats: 4, art: 'einmal' }), 9), 1);
  assert.equal(spielAnteil(lauf, zelle(1, { beats: 4 }), 9), 0.25);
});

test('position(null) or a silent column hides the playhead', () => {
  const { h, wurzel } = neu();
  h.zeichne(spalte({ lauf: { ...lauf0(), zelle: 1 }, zellen: [zelle(1, { beats: 4 }), null, null, null, null, null, null, null] }), null);
  h.position(1);
  assert.ok(!wurzel.querySelector('.kopf-ph').hidden);
  h.position(null);
  assert.ok(wurzel.querySelector('.kopf-ph').hidden);
  h.position(1);
  h.zeichne(spalte(), null);
  h.position(1);
  assert.ok(wurzel.querySelector('.kopf-ph').hidden);
});

test('a cell change hides the playhead until the next position; a still playing cell keeps its bar under a pending launch', () => {
  const zs = [zelle(1, { beats: 4 }), zelle(2, { beats: 4 }), null, null, null, null, null, null];
  const { h, wurzel, zelleN } = neu();
  h.zeichne(spalte({ zellen: zs, lauf: { ...lauf0(), zelle: 1 } }), null);
  h.position(1);
  assert.equal(zelleN(1).querySelector('.prog').style.width, '25%');
  h.zeichne(spalte({ zellen: zs, lauf: { ...lauf0(), zelle: 1, wartend: { zelle: 1, ab_beat: 8 } } }), null);
  assert.equal(zelleN(1).querySelector('.prog').style.width, '25%', 'no flicker');
  assert.ok(!wurzel.querySelector('.kopf-ph').hidden);
  h.zeichne(spalte({ zellen: zs, lauf: { ...lauf0(), zelle: 2, ab_beat: 8 } }), null);
  assert.ok(wurzel.querySelector('.kopf-ph').hidden, 'new cell: no playhead at the old place');
  assert.equal(zelleN(1).querySelector('.prog').style.width, '0');
  h.position(9);
  assert.equal(wurzel.querySelector('.kopf-ph').style.left, '25%');
});

test('position puts .kopf-ph at spielAnteil * 100 %', () => {
  const { h, wurzel } = neu();
  const l = { ...lauf0(), zelle: 2, ab_beat: 4, versatz_beats: 0 };
  h.zeichne(spalte({ lauf: l, zellen: [null, zelle(2, { beats: 8 }), null, null, null, null, null, null] }), null);
  h.position(10);
  assert.equal(wurzel.querySelector('.kopf-ph').style.left, `${spielAnteil(l, zelle(2, { beats: 8 }), 10) * 100}%`);
  assert.equal(wurzel.querySelector('.kopf-ph').style.left, '75%');
});

test('thumbnails go into the .mw slots once per sha and the playing cell fills the .jetzt strip', async () => {
  const aufrufe = [];
  const { h, wurzel, zelleN } = neu({ daumen: (sha, b, hh) => { aufrufe.push(sha); const k = document.createElement('canvas'); k.dataset.sha = sha; return Promise.resolve(k); } });
  const s = spalte({ lauf: { ...lauf0(), zelle: 1 } });
  h.zeichne(s, null);
  await new Promise((ok) => setImmediate(ok));
  assert.equal(zelleN(1).querySelector('.mw canvas').dataset.sha, 'sha1');
  assert.equal(zelleN(3).querySelector('.mw canvas').dataset.sha, 'sha3');
  assert.equal(wurzel.querySelector('.jetzt-wv canvas').dataset.sha, 'sha1');
  const n = aufrufe.length, knoten0 = wurzel.querySelectorAll('canvas').length;
  h.zeichne(s, null); h.zeichne(s, null);
  await new Promise((ok) => setImmediate(ok));
  assert.equal(aufrufe.length, n, 'same sha: not asked again');
  assert.equal(wurzel.querySelectorAll('canvas').length, knoten0);
  h.zeichne(spalte({ lauf: { ...lauf0(), zelle: 3 } }), null);
  await new Promise((ok) => setImmediate(ok));
  assert.equal(wurzel.querySelector('.jetzt-wv canvas').dataset.sha, 'sha3');
  h.zeichne(spalte(), null);
  assert.equal(wurzel.querySelectorAll('.jetzt-wv canvas').length, 0, 'silent: strip empty');
});

test('kompakt: cell background click starts a filled cell and selects an empty one; the handle opens the menu without starting; halten does nothing', () => {
  const { h, zelleN, anrufe } = neu({ variante: 'kompakt', beiMenue: (i, k) => anrufe.push(['menue', i, k.dataset.zelle]) });
  h.zeichne(spalte(), null);
  zelleN(1).click(); zelleN(2).click(); zelleN(4).click();
  assert.deepEqual(anrufe, [['start', 1], ['wahl', 2]]);
  anrufe.length = 0;
  assert.equal(zelleN(1).querySelector('.griff').hidden, false);
  assert.equal(zelleN(2).querySelector('.griff').hidden, true);
  zelleN(1).querySelector('.griff').click();
  assert.deepEqual(anrufe, [['menue', 1, '1']], 'the handle does not start the cell');
  zelleN(1).dispatch('contextmenu');
  zelleN(2).dispatch('contextmenu');
  assert.deepEqual(anrufe.slice(1), [['menue', 1, '1']], 'an empty cell has no menu');
});

test('only a filled cell is draggable and the host writes the drag', () => {
  const g = [];
  const { h, zelleN } = neu({ beiZiehen: (i) => g.push(i) });
  h.zeichne(spalte(), null);
  assert.equal(zelleN(1).getAttribute('draggable'), 'true');
  assert.equal(zelleN(2).getAttribute('draggable'), 'false');
  zelleN(1).dispatch('dragstart'); zelleN(2).dispatch('dragstart');
  assert.deepEqual(g, [1]);
});

test('frames null marks the cell as loading', () => {
  const { h, zelleN } = neu();
  h.zeichne(spalte({ zellen: [zelle(1, { frames: null }), zelle(2), null, null, null, null, null, null] }), null);
  assert.ok(zelleN(1).classList.contains('laedt'));
  assert.ok(!zelleN(2).classList.contains('laedt'));
  assert.match(zelleN(1).title, /still loading/);
});

test('the now-playing strip carries seven slice marks and a click at 40 % calls beiWelleKlick(0.4)', () => {
  const { h, wurzel, anrufe } = neu();
  h.zeichne(spalte({ lauf: { ...lauf0(), zelle: 1 } }), null);
  const marken = wurzel.querySelectorAll('.jetzt .marke');
  assert.equal(marken.length, 7);
  assert.deepEqual(marken.map((m) => m.style.left), ['12.5%', '25%', '37.5%', '50%', '62.5%', '75%', '87.5%']);
  wurzel.querySelector('.jetzt').dispatch('click', { clientX: 40 });   // the stand-in strip is 100 px wide at 0
  assert.deepEqual(anrufe, [['welle', 0.4]]);
  wurzel.querySelector('.jetzt').dispatch('click', { clientX: 400 });
  wurzel.querySelector('.jetzt').dispatch('click', { clientX: -5 });
  assert.deepEqual(anrufe.slice(1), [['welle', 1], ['welle', 0]], 'clamped to 0..1');
});

test('a one-shot has no slices: the marks hide while it plays', () => {
  const { h, wurzel } = neu();
  const zs = [zelle(1, { art: 'einmal' }), zelle(2), null, null, null, null, null, null];
  h.zeichne(spalte({ zellen: zs, lauf: { ...lauf0(), zelle: 1 } }), null);
  assert.ok(wurzel.querySelector('.jetzt').classList.contains('einmal'));
  h.zeichne(spalte({ zellen: zs, lauf: { ...lauf0(), zelle: 2 } }), null);
  assert.ok(!wurzel.querySelector('.jetzt').classList.contains('einmal'));
});

test('kompakt: every cell is reachable by Tab and Enter or Space act like a click', () => {
  const { h, zelleN, anrufe } = neu({ variante: 'kompakt' });
  h.zeichne(spalte(), null);
  for (let i = 1; i <= 8; i++) assert.equal(zelleN(i).getAttribute('tabindex'), '0', `cell ${i}`);
  zelleN(2).dispatch('keydown', { key: 'Enter' });
  zelleN(1).dispatch('keydown', { key: ' ' });
  zelleN(1).dispatch('keydown', { key: 'a' });
  assert.deepEqual(anrufe, [['wahl', 2], ['start', 1]]);
});

test('right-click is caught on every cell, the menu opens for a filled one only', () => {
  const { h, zelleN, anrufe } = neu({ beiMenue: (i) => anrufe.push(['menue', i]) });
  h.zeichne(spalte(), null);
  const gefangen = [];
  for (const i of [1, 2]) zelleN(i).dispatch('contextmenu', { preventDefault: () => gefangen.push(i) });
  assert.deepEqual(gefangen, [1, 2]);
  assert.deepEqual(anrufe, [['menue', 1]]);
});

test('the stop button has a tooltip and the pending stop shows without animation too (class wartet)', () => {
  const { h, wurzel } = neu();
  h.zeichne(spalte({ lauf: { ...lauf0(), zelle: 1, wartend: { zelle: null, ab_beat: 8 } } }), null);
  assert.match(wurzel.querySelector('.stopp').title, /next grid point/);
  const css = fs.readFileSync(new URL('../public/session/spalte.css', import.meta.url), 'utf8');
  assert.match(css, /prefers-reduced-motion: reduce\)[^]*\.stopp\.wartet[^}]*background/);
  assert.match(css, /\.mw canvas \{[^}]*width: 100%[^}]*height: 100%/);
});

test('a thumbnail that failed is asked for again at the next zeichne, one that arrived is not', async () => {
  let n = 0;
  const { h, wurzel } = neu({ daumen: (sha) => (++n === 1 ? Promise.resolve(null) : Promise.resolve(document.createElement('canvas'))) });
  const s = spalte({ zellen: [zelle(1), null, null, null, null, null, null, null] });
  h.zeichne(s, null);
  await new Promise((ok) => setImmediate(ok));
  assert.equal(n, 1);
  h.zeichne(s, null);
  await new Promise((ok) => setImmediate(ok));
  assert.equal(n, 2, 'failed: asked again');
  h.zeichne(s, null);
  await new Promise((ok) => setImmediate(ok));
  assert.equal(n, 2, 'arrived: not asked again');
  assert.equal(wurzel.querySelectorAll('.mw canvas').length, 1);
});

test('voll: a click on the cell body selects, the play button starts, a double click on the body starts', () => {
  const { h, zelleN, anrufe } = neu({ variante: 'voll' });
  h.zeichne(spalte(), null);
  zelleN(1).click(); zelleN(1).querySelector('.nm').click(); zelleN(1).querySelector('.mw').click(); zelleN(2).click();
  assert.deepEqual(anrufe, [['wahl', 1], ['wahl', 1], ['wahl', 1], ['wahl', 2]], 'body clicks select, never start');
  anrufe.length = 0;
  zelleN(1).querySelector('.go').click(); zelleN(2).querySelector('.go').click(); zelleN(4).querySelector('.go').click();
  assert.deepEqual(anrufe, [['start', 1], ['wahl', 2]], 'play starts a filled cell; an empty one only selects; hold does nothing');
  anrufe.length = 0;
  zelleN(3).dispatch('dblclick', { target: zelleN(3) }); zelleN(2).dispatch('dblclick', { target: zelleN(2) }); zelleN(4).dispatch('dblclick', { target: zelleN(4) });
  assert.deepEqual(anrufe, [['start', 3]], 'double click on a filled body starts; empty and hold do not');
});

test('voll: Enter or Space launch a filled cell and select an empty one', () => {
  const { h, zelleN, anrufe } = neu({ variante: 'voll' });
  h.zeichne(spalte(), null);
  zelleN(1).dispatch('keydown', { key: 'Enter' }); zelleN(2).dispatch('keydown', { key: ' ' });
  assert.deepEqual(anrufe, [['start', 1], ['wahl', 2]]);
});

test('kompakt: a double click starts nothing extra', () => {
  const { h, zelleN, anrufe } = neu({ variante: 'kompakt' });
  h.zeichne(spalte(), null);
  zelleN(1).dispatch('dblclick', { target: zelleN(1) });
  assert.deepEqual(anrufe, []);
});

test('a launch on the playing cell stops its track (toggle); a pending stop or a pending start launches again', () => {
  for (const variante of ['voll', 'kompakt']) {
    const { h, zelleN, anrufe } = neu({ variante });
    h.zeichne(spalte({ lauf: { ...lauf0(), zelle: 1 } }), null);
    zelleN(1).querySelector('.go').click(); zelleN(3).querySelector('.go').click();
    assert.deepEqual(anrufe, [['stopp'], ['start', 3]], `${variante}: playing cell stops, another cell launches`);
    anrufe.length = 0;
    if (variante === 'voll') {
      zelleN(1).dispatch('dblclick', { target: zelleN(1) }); zelleN(1).dispatch('keydown', { key: 'Enter' });
      assert.deepEqual(anrufe, [['stopp'], ['stopp']], 'double click and Enter on the playing cell stop too');
      anrufe.length = 0;
    }
    h.zeichne(spalte({ lauf: { ...lauf0(), zelle: 1, wartend: { zelle: null, ab_beat: 8 } } }), null);
    zelleN(1).querySelector('.go').click();
    h.zeichne(spalte({ lauf: { ...lauf0(), zelle: 1, wartend: { zelle: 3, ab_beat: 8 } } }), null);
    zelleN(3).querySelector('.go').click();
    assert.deepEqual(anrufe, [['start', 1], ['start', 3]], `${variante}: pending stop and pending start launch`);
  }
});
