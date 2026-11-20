// Acceptance of stage 5a (plan 2026-11-19-one-dock-stage-5a, task 11): the rows of the spec's "nothing lost" table of the EFFECTS tab, tried once in the real
// page in headless Chrome against the page stub, NOT against the running app. The stub answers 404 for the live routes, so a script installed before the page
// loads answers /graphen, /graphen/panel, /lage, /regler, /graph, /griff, /loop/automation and the focus in the page and records every POST; readings
// (/zustand/komp, /zustand/mix, /zustand/arr) are injected through the stub's event stream. Screenshots go to ~/messungen/2026-11-19-one-dock-5a/.
// What the stub cannot show: real levels on the meters, gain reduction from audio, sound, the host areas of Surge XT, RB-338 and Cypher Modular (they need a
// running instrument host behind /klang), the core's real refusals, the load time of a large graph. Without google-chrome the tests are skipped.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { starteSeite, warte } from '../check/page_mock.mjs';

const CHROME = fs.existsSync('/usr/bin/google-chrome');
const AUS = path.join(os.homedir(), 'messungen/2026-11-19-one-dock-5a');
const sse = (s, a, f) => s.post('/attrappe/sse', { a, f });
const knob = (n) => ({ id: `k${n}`, type: 'knob', label: `Knob ${n}`, bind: { param: `k${n}` }, default: 0.5 });
const PANEL = { format: 'cypherdj-panel/2', geraet: { art: 'bk', graph: 'bass-acid' }, title: 'bass-acid', akzent: 'orange',
  sections: [{ id: 's1', title: 'KNOBS', cols: 4, controls: [1, 2, 3, 4, 5, 6, 7, 8].map(knob) }], front: ['k1', 'k2', 'k3', 'k4', 'k5', 'k6'] };
const GRAPHEN = [
  { name: 'bass-acid', art: 'instrument', kategorie: 'bass', prinzip: 'subtraktiv', regler_namen: {} },
  { name: 'lead-saw', art: 'instrument', kategorie: 'lead', prinzip: 'subtraktiv', regler_namen: {} },
  { name: 'echo-tape', art: 'effekt', kategorie: 'delay', regler_namen: {} },
];
const LAGE = { decks: [{ deck: 1, status: 2, titel: 'Night Drive' }], boxen: { 1: { name: 'acid-loop', beats: 16, status: 3 } }, studio: { stroeme: [] } };
const VORHER = `(() => {
  window.__gesendet = [];
  const f = window.fetch.bind(window);
  const json = (j) => Promise.resolve(new Response(JSON.stringify(j), { status: 200, headers: { 'content-type': 'application/json' } }));
  window.fetch = (u, o = {}) => {
    const w = String(u).replace(location.origin, '');
    if (o.method === 'POST') { let body = null; try { body = JSON.parse(o.body); } catch {} window.__gesendet.push({ w, body }); }
    if (w === '/graphen') return json({ graphen: ${JSON.stringify(GRAPHEN)}, geladen: { 'erz/2': 'bass-acid', 'deck/1': 'echo-tape' } });
    if (w.startsWith('/graphen/panel')) return json(w.includes('bass-acid') ? { panel: ${JSON.stringify(PANEL)}, regler: {} } : { panel: null });
    if (w === '/lage') return json(${JSON.stringify(LAGE)});
    if (w.startsWith('/loop/automation')) return json(o.method === 'POST' ? { ok: true } : { automation: [] });
    if (/^\\/(regler|griff|graph|controller\\/fokus)$/.test(w)) return json({ quittung: { status: 0 } });
    return f(u, o);
  };
})();`;

async function seite(t, breite = 1920, hoehe = 1080) {
  const s = await starteSeite({ breite, hoehe });
  t.after(() => s.stoppe());
  await s.b.sende('Page.addScriptToEvaluateOnNewDocument', { source: VORHER });
  await s.b.oeffne(s.url); await warte(1500);
  await sse(s, '/e/loop', { box: 1, name: 'acid-loop', beats: 16, status: 3 });
  for (const [pfad, wert] of Object.entries({ 'erz/1/komp/an': 1, 'erz/1/komp/schwelle': -24, 'erz/1/gate/an': 1 })) await sse(s, '/e/regler', { pfad, wert });
  await s.b.klick('[data-bereich="effekte"]');
  await warte(2300);   // one /lage round (every 2 s) for what plays
  return s;
}
const gesendet = (s, w) => s.w(`window.__gesendet.filter((x) => x.w === ${JSON.stringify(w)}).map((x) => x.body)`);
const leere = (s) => s.w('window.__gesendet.length = 0');
const karte = (id) => `document.querySelector('#live-dock [data-strang="${id}"]')`;
const chip = (id, teil) => `${karte(id)}.querySelector('[data-teil="${teil}"]')`;
const bild = (s, name) => { fs.mkdirSync(AUS, { recursive: true }); return s.b.bild(path.join(AUS, `${name}.png`)); };
async function menue(s, ziel, text) {
  await s.w(`${ziel}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 400, clientY: 400 }))`);
  await warte(100);
  const punkte = await s.w(`[...document.querySelectorAll('.p-menue li')].map((x) => x.textContent.trim())`);
  const ok = await s.w(`(() => { const b = [...document.querySelectorAll('.p-menue button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true; })()`);
  assert.equal(ok, true, `menu entry ${text} in ${JSON.stringify(punkte)}`);
  await warte(250);
  return punkte;
}

test('the tab: rows, instrument as subtitle, effect as chip, no INSERT label; what plays; meter and dB text on every channel card', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t);
  assert.equal(await s.w(`document.querySelectorAll('[data-w="dock-kanaele"] [data-w="karte-live"]').length`), 10);
  assert.deepEqual(await s.w(`[...document.querySelectorAll('[data-w="dock-fx"] [data-w="karte-live"]')].map((e) => e.dataset.strang)`), ['fx/3', 'fx/4']);
  assert.equal(await s.w(`document.querySelectorAll('[data-w="dock-master"] [data-strang="master"]').length`), 1);
  const texte = await s.w(`[...document.querySelectorAll('#live-dock *')].filter((e) => !e.children.length && /INSERT/.test(e.textContent)).map((e) => e.textContent.trim())`);
  assert.ok(texte.every((x) => x === '+ INSERT'), `only + INSERT buttons carry the word: ${JSON.stringify(texte)}`);
  assert.equal(await s.w(`${karte('erz/2')}.querySelector('.w-karte-instrument').textContent`), 'bass-acid', 'BASS: the instrument is the subtitle');
  assert.ok(await s.w(`!!${karte('erz/2')}.querySelector('[data-w="karte-wechsel"]')`), 'CHANGE beside it');
  assert.deepEqual(await s.w(`[...${karte('erz/2')}.querySelectorAll('[data-w="karte-teil"]')].map((b) => b.dataset.teil)`), ['gate', 'komp', 'util']);
  assert.equal(await s.w(`${chip('deck/1', 'insert')}.textContent`), 'echo-tape', 'A: the effect is a chip named like the effect');
  assert.deepEqual(await s.w(`(() => { const p = ${karte('deck/1')}.querySelector('[data-w="karte-plus"]'); return [p.disabled, p.title]; })()`), [true, 'This channel holds one effect: change or remove it on its chip']);
  assert.match(await s.w(`${karte('deck/1')}.querySelector('[data-w="karte-untertitel"]').textContent`), /Night Drive/, 'the deck title is the subtitle of A');
  assert.match(await s.w(`${karte('pad/1')}.querySelector('.w-karte-was').textContent`), /acid-loop/, 'L1 shows the loop beside its instrument');
  for (const id of ['deck/1', 'deck/2', 'erz/1', 'erz/2', 'erz/3', 'erz/5', 'erz/6', 'erz/7', 'pad/1', 'pad/2']) {
    assert.ok(await s.w(`!!${karte(id)}.querySelector('.meter.senkrecht[data-kanal="${id}"]') && !!${karte(id)}.querySelector('[data-fxpegel="${id}"]')`), `${id} meter and dB text`);
  }
  await bild(s, 'reiter');
});

test('card in front, PRESETS channel, focus and its survival across a reload; front knobs write', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t);
  await leere(s);
  await s.w(`${karte('erz/1')}.querySelector('.w-karte-name').click()`);
  await warte(300);
  assert.equal(await s.w(`${karte('erz/1')}.classList.contains('aktiv')`), true);
  assert.ok((await gesendet(s, '/controller/fokus')).some((f) => f.kanal === 'erz/1'), 'focus erz/1');
  assert.equal(await s.w(`localStorage.getItem('djk-fx-reiter')`), 'erz/1', 'the PRESETS channel is stored');
  await leere(s);
  // front knobs: THR of A writes deck/1/komp/schwelle; knob 1 of BASS writes erz/2/bk/1
  for (const [id, param] of [['deck/1', 'komp/schwelle'], ['erz/2', 'bk:k1']]) {
    await s.w(`${karte(id)}.querySelector('[data-param="${param}"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))`);
  }
  await warte(300);
  const pfade = (await gesendet(s, '/regler')).map((b) => b.pfad);
  assert.ok(pfade.includes('deck/1/komp/schwelle') && pfade.includes('erz/2/bk/1'), JSON.stringify(pfade));
  await s.b.oeffne(s.url); await warte(1500);
  await s.b.klick('[data-bereich="effekte"]'); await warte(400);
  assert.equal(await s.w(`${karte('erz/1')}.classList.contains('aktiv')`), true, 'the choice survives a reload');
});

test('effect and instrument windows; CHANGE menus of BASS and FX3; + INSERT on B', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t);
  await s.w(`${chip('deck/1', 'insert')}.click()`); await warte(400);
  assert.ok(await s.w(`!!document.querySelector('[data-fenster-id="live:fx:deck/1"] [data-graphplatz="deck/1"]')`), 'effect window with the picker');
  await s.w(`${karte('erz/2')}.querySelector('[data-w="karte-auf"]').click()`); await warte(500);
  assert.ok(await s.w(`!!document.querySelector('[data-fenster-id="live:inst:erz/2"] .frontplatte, [data-fenster-id="live:inst:erz/2"] .fp-kopf')`), 'OPEN shows the front panel');
  await bild(s, 'fenster');
  await s.w(`${karte('erz/2')}.querySelector('[data-w="karte-wechsel"]').click()`); await warte(200);
  const p = await s.w(`[...document.querySelectorAll('.p-menue li')].map((x) => x.textContent.trim())`);
  assert.ok(p.some((x) => x.startsWith('lead-saw')) && /^Group by/.test(p.at(-1)), JSON.stringify(p));
  await leere(s);
  await s.w(`[...document.querySelectorAll('.p-menue button')].find((b) => b.textContent.startsWith('lead-saw')).click()`); await warte(300);
  assert.deepEqual(await gesendet(s, '/graph'), [{ kanal: 'erz/2', name: 'lead-saw' }]);
  await s.w(`${karte('fx/3')}.querySelector('[data-w="karte-wechsel"]').click()`); await warte(200);
  assert.deepEqual(await s.w(`[...document.querySelectorAll('.p-menue button')].map((b) => b.textContent.trim())`), ['echo-tape'], 'FX3 lists the effects');
  await s.w(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  await s.w(`${karte('deck/2')}.querySelector('[data-w="karte-plus"]').click()`); await warte(200);
  assert.deepEqual(await s.w(`[...document.querySelectorAll('.p-menue button')].map((b) => b.textContent.trim())`), ['echo-tape'], '+ INSERT on B');
});

test('GATE, COMP, UTIL: popovers, face, GR in the title, menus with ✓, key without own channel, presets, history', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t);
  const gr = setInterval(() => { sse(s, '/zustand/komp', { kanal: 'erz/1', gr_db: 7.5 }).catch(() => {}); sse(s, '/zustand/mix', { kanal: 'erz/1', gate_db: 12 }).catch(() => {}); }, 100);
  t.after(() => clearInterval(gr));
  await warte(400);
  assert.match(await s.w(`${chip('erz/1', 'komp')}.title`), /GR 7\.5 dB/);
  assert.notEqual(await s.w(`${chip('erz/1', 'komp')}.querySelector('.w-chip-gr').style.width`), '0%', 'the GR bar moves');
  await s.w(`${chip('erz/1', 'gate')}.click()`); await warte(300);
  assert.deepEqual(await s.w(`[...document.querySelectorAll('.w-live-popover label')].map((l) => l.firstChild.textContent.trim())`), ['THR', 'RANGE', 'REL']);
  assert.match(await s.w(`document.querySelector('.w-live-popover [data-messer-zahl="erz/1|gate_db"]').textContent`), /12\.0 dB/);
  await bild(s, 'gate');
  await s.w(`${chip('erz/1', 'gate')}.click()`); await warte(100);
  await s.w(`${chip('erz/1', 'util')}.click()`); await warte(300);
  assert.deepEqual(await s.w(`[...document.querySelectorAll('.w-live-popover .werk-schalter button')].map((b) => b.textContent)`), ['Ø L', 'Ø R', 'SWAP', 'DC']);
  await s.w(`${chip('erz/1', 'util')}.click()`); await warte(100);
  await s.w(`${chip('erz/1', 'komp')}.click()`); await warte(400);
  assert.equal(await s.w(`document.querySelectorAll('.p-face[data-face="face:kanal:erz/1"]').length`), 1, 'the face');
  await s.w(`${chip('erz/1', 'komp')}.click()`); await warte(200);
  const punkte = await menue(s, chip('erz/1', 'komp'), 'Gain reduction history');
  assert.ok(!punkte.includes('DRUMS') && punkte.includes('BASS'), 'key source without the own channel');
  assert.ok(punkte.includes('Bypass'), 'the compressor is on: Bypass');
  assert.equal(await s.w(`document.querySelectorAll('[data-fenster-id="live:verlauf:erz/1"] canvas').length`), 1);
  await sse(s, '/e/regler', { pfad: 'erz/1/util/phase_l', wert: 1 });
  await warte(200);
  const u = await menue(s, chip('erz/1', 'util'), 'DC');
  assert.ok(u.includes('✓ Ø L'), JSON.stringify(u));
});

test('MASTER: GLUE, LIMITER reading, BUS 1 window (bands fold, limiter greyed with the reason), spectrum; loop automation; leaving the tab closes everything', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await seite(t);
  const arr = setInterval(() => sse(s, '/zustand/arr', { nr: 1, status: 2, limiter_db: -4 }).catch(() => {}), 100);
  t.after(() => clearInterval(arr));
  await s.w(`${chip('master', 'limiter')}.click()`); await warte(400);
  assert.match(await s.w(`document.querySelector('.w-live-popover .live-limiter-wert').textContent`), /4\.0 dB/);
  await s.w(`${chip('master', 'glue')}.click()`); await warte(200);
  await leere(s);
  await s.w(`document.querySelector('.w-live-popover [data-param="kleber"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))`);
  await warte(300);
  assert.ok((await gesendet(s, '/griff')).length >= 1, 'GLUE goes to /griff');
  await s.w(`${chip('master', 'bus/1')}.click()`); await warte(400);
  const bus = `document.querySelector('[data-fenster-id="live:bus:1"]')`;
  assert.equal(await s.w(`${bus}.querySelector('[data-werk-pfad="bus/1/lim/an"]').disabled`), true, 'limiter greyed while not built');
  assert.match(await s.w(`${bus}.querySelector('[data-lim-grund]').textContent`), /not built/);
  await s.w(`${bus}.querySelector('[data-baender-knopf="bus/1"]').click()`); await warte(100);
  assert.equal(await s.w(`${bus}.querySelector('[data-baender="bus/1"]').hidden`), false, 'BANDS unfold');
  await s.w(`${karte('master')}.querySelector('[data-w="karte-auf"]').click()`); await warte(400);
  assert.ok(await s.w(`!!document.querySelector('[data-fenster-id="live:spektrum"] #spektrum-quelle') && !!document.querySelector('[data-fenster-id="live:spektrum"] #spektrum-leinwand')`));
  await menue(s, `${karte('pad/1')}.querySelector('.w-karte-name')`, 'Loop automation…');
  const auto = `document.querySelector('[data-fenster-id="live:auto:1"]')`;
  assert.match(await s.w(`${auto}.querySelector('.autoname').textContent`), /acid-loop/);
  await s.w(`(() => { const v = ${auto}.querySelector('.autovorlage'); v.value = '0'; v.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await leere(s);
  await s.w(`${auto}.querySelector('.autospeichern').click()`); await warte(300);
  const auf = await gesendet(s, '/loop/automation');
  assert.equal(auf.length, 1, 'SAVE posts the automation');
  assert.equal(auf[0].name, 'acid-loop');
  await bild(s, 'master');
  await s.w(`${chip('erz/1', 'gate')}.click()`); await warte(200);
  await s.b.klick('[data-bereich="library"]'); await warte(300);
  assert.equal(await s.w(`document.querySelectorAll('#live-fenster [data-w="fenster"], .w-live-popover').length`), 0, 'leaving closes windows and popover');
  assert.ok(await s.w(`!!document.querySelector('.spektrum-heim > #spektrum')`), 'the spectrum is back home');
  await s.b.klick('[data-bereich="effekte"]'); await warte(200);
  assert.equal(await s.w(`document.querySelectorAll('#live-dock [data-w="karte-live"]').length`), 13, 'coming back shows the cards at once');
});
