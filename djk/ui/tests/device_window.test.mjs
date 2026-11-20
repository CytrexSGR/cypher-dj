// The device window of a project track (public/device_window.js, device_open.js): which address opens the mode, the opener (window name, size, blocked message),
// the "gone" states, that the window follows the project and tells the page server its track. Fake DOM, no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { geraetFensterSpur, geraetFensterName, geraetFensterMass, oeffneGeraetFenster, kannGeraetFenster, GERAET_FENSTER_TEXT } from '../public/device_open.js';
import { bindeGeraetFenster, geraetFensterLage, folgeZiel } from '../public/device_window.js';
import { neuerFokusSender } from '../public/controller_fokus.js';

test('hash: only #geraet=<id> is the device window, the other windows are not', () => {
  assert.equal(geraetFensterSpur('#geraet=s3'), 's3');
  assert.equal(geraetFensterSpur('#geraet=s%203'), 's 3');
  for (const h of ['#remix', '#controller', '#tablet', '', '#', '#geraet', '#geraet=', '#geraet=%E0%A4%A', undefined, null, 5, '#geraet']) assert.equal(geraetFensterSpur(h), null, String(h));
});

test('opener: window name, address, size up to the screen, focus', () => {
  const aufrufe = []; let fokusiert = 0;
  const w = { focus() { fokusiert++; } };
  const fenster = { open: (...a) => { aufrufe.push(a); return w; } };
  const gemeldet = [];
  assert.equal(oeffneGeraetFenster('s3', (t, f) => gemeldet.push([t, f]), { fenster, schirm: { availWidth: 2560, availHeight: 1400, availLeft: 0, availTop: 0 } }), w);
  assert.deepEqual(aufrufe[0], ['/#geraet=s3', 'djk-geraet', 'popup,width=1500,height=880,left=530,top=260']);
  assert.equal(fokusiert, 1);
  oeffneGeraetFenster('s3', null, { fenster, schirm: { availWidth: 1280, availHeight: 720 } });
  assert.equal(aufrufe[1][1], 'djk-geraet', 'every track names the same window: the browser focuses it and the address turns it');
  assert.match(aufrufe[1][2], /^popup,width=1280,height=720,left=0,top=0$/, 'never bigger than the screen');
  assert.equal(geraetFensterName('s12'), 'djk-geraet', 'one window for every track: it follows the synth in front');
  assert.deepEqual(geraetFensterMass({ availWidth: 3000, availHeight: 2000, availLeft: 100, availTop: 20 }), { B: 1500, H: 880, x: 850, y: 580 });
  assert.equal(gemeldet.length, 0);
});
test('opener: a blocked window is said, nothing opens without a track', () => {
  const gemeldet = [];
  assert.equal(oeffneGeraetFenster('s1', (t, f) => gemeldet.push([t, f]), { fenster: { open: () => null }, schirm: {} }), null);
  assert.deepEqual(gemeldet, [['The browser blocked the window: allow pop-ups for this page', true]]);
  assert.equal(GERAET_FENSTER_TEXT.titel, 'Open this instrument in its own window');
  assert.equal(oeffneGeraetFenster('', null, { fenster: { open() { throw new Error('no'); } } }), null);
});
test('which devices the window can show', () => {
  const g = (geraet) => ({ geraet });
  assert.equal(kannGeraetFenster(g({ art: 'intern', name: 'bk', graph: 'x' })), true);
  assert.equal(kannGeraetFenster(g({ art: 'intern', name: 'rb338' })), true);
  assert.equal(kannGeraetFenster(g({ art: 'wirt', name: 'surge' })), true);
  assert.equal(kannGeraetFenster(g({ art: 'rack' })), true);
  assert.equal(kannGeraetFenster(g({ art: 'wirt', name: 'plugin', plugin: { name: 'X' } })), false);
  assert.equal(kannGeraetFenster(g({ art: 'intern', name: 'kit', kit: 'k' })), false);
  assert.equal(kannGeraetFenster(null), false);
});

test('lage: no project, another project, track gone, ok', () => {
  const spur = { id: 's1', name: 'Lead' }, p = { spuren: [spur] };
  assert.equal(geraetFensterLage({ spurId: 's1', slug0: null, slug: null, projekt: null }).art, 'kein_projekt');
  assert.equal(geraetFensterLage({ spurId: 's1', slug0: 'a', slug: 'b', projekt: p }).art, 'anderes_projekt', 'a track of the same id in another project is not ours');
  assert.equal(geraetFensterLage({ spurId: 's9', slug0: 'a', slug: 'a', projekt: p }).art, 'spur_weg');
  const ok = geraetFensterLage({ spurId: 's1', slug0: 'a', slug: 'a', projekt: p });
  assert.equal(ok.art, 'ok'); assert.equal(ok.spur, spur);
  assert.equal(geraetFensterLage({ spurId: 's1', slug0: null, slug: 'a', projekt: p }).art, 'ok', 'the first project seen is the window\'s project');
});

// ---- the window itself ----
class K {
  constructor(tag) {
    this.tag = tag; this.kinder = []; this.attr = {}; this.ev = {}; this.dataset = {}; this.textContent = ''; this.hidden = false; this.className = '';
    this.style = { setProperty() {} };
    const klassen = new Set(); this.klassen = klassen;
    this.classList = { add: (c) => klassen.add(c), remove: (c) => klassen.delete(c), toggle: (c, an) => (an ?? !klassen.has(c) ? klassen.add(c) : klassen.delete(c)), contains: (c) => klassen.has(c) };
  }
  setAttribute(k, v) { this.attr[k] = String(v); }
  append(...k) { this.kinder.push(...k); }
  replaceChildren(...k) { this.kinder = [...k]; }
  addEventListener(t, f) { (this.ev[t] ??= []).push(f); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 200, height: 100 }; }
}
const DOK = { createElement: (t) => new K(t), createElementNS: (_n, t) => new K(t), title: '' };
const warte = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const PANEL = { format: 'cypherdj-panel/2', geraet: { art: 'bk', graph: 'synth-mono' }, title: 'T', sections: [{ id: 's', title: 'S', cols: 3, controls: [{ id: 'c5', type: 'knob', label: 'c5', bind: { param: 'k5' } }] }] };
const TABELLE = [{ name: 'k5', min: 20, max: 2000, log: true, vorgabe: 0.5 }];
const BK = { art: 'intern', name: 'bk', graph: 'synth-mono', parameter: {} };
const spurMit = (id, geraet) => ({ id, nr: 1, name: `T-${id}`, art: 'instrument', geraet, clips: [] });

function aufbau(geraet = BK, weitere = [], panel = PANEL) {
  const z = { slug: 'a', rev: 1, name: 'A', spuren: [spurMit('s1', geraet), ...weitere] };
  const holeGet = async (weg) => {
    if (weg === '/proj/aktuell') return z.slug === null ? { status: 200, j: { projekt: null } } : { status: 200, j: { slug: z.slug, projekt: { rev: z.rev, name: z.name, spuren: z.spuren } } };
    if (weg.startsWith('/geraete/panel')) return { status: 200, j: { panel, parameter: TABELLE } };
    if (weg === '/presets/register') return { status: 200, j: { register: { eintraege: [] } } };
    return { status: 404, j: null };
  };
  const gesendet = [], gemeldet = [];
  const sender = neuerFokusSender({ senden: async (b) => { gesendet.push(b); return { status: 200 }; } });
  const wurzel = new K('section');
  const post = async (weg, k) => { gesendet.push([weg, k]); return { status: 200, json: async () => ({ rev: z.rev + 1, projekt: { rev: z.rev + 1, name: z.name, spuren: z.spuren } }) }; };
  const f = bindeGeraetFenster({ spurId: 's1', folgt: true, zu: false, post, holeGet, wurzel, dokument: DOK, fokus: sender, zeitgeber: { setTimeout: () => 0, clearTimeout() {} }, ansichtOpt: { kopfBauer: () => ({ neu() {} }) } });
  const hinweis = () => wurzel.kinder[0].kinder[5].textContent;
  const nachladen = async (rev) => { z.rev = rev; f.ereignis('proj', { slug: z.slug ?? 'a', rev }); await warte(80); };
  return { z, f, wurzel, gesendet, sender, hinweis, nachladen, gemeldet };
}

test('window: shows the track and tells the page server its track when it loads and when it gets the focus', async () => {
  const a = aufbau();
  await warte(20);
  assert.equal(a.f.lage().art, 'ok');
  assert.equal(a.wurzel.kinder[0].kinder[0].textContent, 'T-s1', 'the title line names the track');
  assert.equal(a.wurzel.kinder[0].kinder[1].textContent, 'Baukasten · synth-mono', 'and the instrument');
  assert.equal(a.wurzel.classList.contains('gf-weg'), false);
  await warte(0);
  assert.deepEqual(a.gesendet.filter((x) => !Array.isArray(x)), [{ spur_id: 's1' }]);
  assert.equal(DOK.title, 'T-s1 · Baukasten · synth-mono');
  a.gesendet.length = 0;
  assert.equal(a.sender.erneut(), true, 'the browser focus: the window sends its track again, whatever the server has');
  await warte(0);
  assert.deepEqual(a.gesendet, [{ spur_id: 's1' }]);
});

test('window: track deleted says so and shows no panel, it comes back when the track exists again', async () => {
  const a = aufbau();
  await warte(20);
  a.z.spuren = [];
  await a.nachladen(2);
  assert.equal(a.f.lage().art, 'spur_weg');
  assert.equal(a.hinweis(), 'This track is not in the project any more');
  assert.equal(a.wurzel.classList.contains('gf-weg'), true, 'the panel is hidden: nothing to click');
  assert.equal(a.sender.erneut(), false, 'a gone track claims no controller focus');
  a.z.spuren = [spurMit('s1', BK)];
  await a.nachladen(3);
  assert.equal(a.f.lage().art, 'ok');
  assert.equal(a.hinweis(), '');
  assert.equal(a.wurzel.classList.contains('gf-weg'), false);
});

test('window: another project says so, even with a track of the same id; the own project brings it back', async () => {
  const a = aufbau();
  await warte(20);
  a.z.slug = 'b'; a.z.rev = 7;
  a.f.ereignis('proj', { slug: 'b', rev: 7 }); await warte(80);
  assert.equal(a.f.lage().art, 'anderes_projekt');
  assert.equal(a.hinweis(), 'Another project is open. This window belongs to "a"');
  assert.equal(a.wurzel.classList.contains('gf-weg'), true);
  a.z.slug = 'a'; a.z.rev = 8;
  a.f.ereignis('proj', { slug: 'a', rev: 8 }); await warte(80);
  assert.equal(a.f.lage().art, 'ok');
});

test('window: no project open', async () => {
  const a = aufbau();
  await warte(20);
  a.z.slug = null;
  a.f.ereignis('neustart'); a.f.ereignis('stand', {}); a.f.ereignis('stand', {}); await warte(80);
  assert.equal(a.f.lage().art, 'kein_projekt');
  assert.equal(a.hinweis(), 'No project is open');
});

test('window: a device without a view shows the text of the main page', async () => {
  const a = aufbau({ art: 'intern', name: 'kit', kit: 'k' });
  await warte(20);
  assert.equal(a.f.lage().art, 'ok');
  assert.equal(a.wurzel.kinder[2].kinder[0].kinder[0].textContent, 'This device has no panel.');   // kinder: header, controller strip, panel
});

test('window: a knob dragged here writes the project like the main page (one spur_aendern/geraet_param_setzen path, same labels)', async () => {
  const a = aufbau();
  await warte(20);
  const ad = a.f.ctx;
  assert.equal(typeof ad.aendere, 'function'); assert.equal(typeof ad.aendereAus, 'function');
  const ok = await ad.aendereAus((p) => ({ label: 'T-s1: c5', befehle: [{ befehl: 'geraet_param_setzen', spur_id: 's1', param: 'k5', wert: 0.7 }] }));
  assert.equal(ok, true);
  const sendung = a.gesendet.find((x) => Array.isArray(x) && x[0] === '/proj/aendern');
  assert.deepEqual(sendung[1], { rev: 1, label: 'T-s1: c5', befehle: [{ befehl: 'geraet_param_setzen', spur_id: 's1', param: 'k5', wert: 0.7 }] });
});

import fs from 'node:fs';
const quelle = (d) => fs.readFileSync(new URL(`../public/${d}`, import.meta.url), 'utf8');
test('app.js: the device window starts before the focus sender, and is one of the windows that send the focus', () => {
  const app = quelle('app.js');
  assert.match(app, /if \(!controllerFenster && !remixFenster\) \{ fokus\.verbinde\(\(f\) => jsonPost\('\/controller\/fokus', f\)\); bindeFensterFokus\(\); \}/, 'the gate excludes only the Controllers and Remix windows');
  assert.ok(app.indexOf('starteGeraetFenster(jsonPost)') > 0 && app.indexOf('starteGeraetFenster(jsonPost)') < app.indexOf('fokus.verbinde'), 'its source is registered before the page asks its sources');
  assert.match(app, /if \(!geraetFensterSpurId\) try \{ setzeProduktion/, 'no second project writer in the window');
  assert.match(quelle('stream.js'), /geraetFensterEreignis\(a, f\)/, 'the stream reaches the window mode');
});
test('every OPEN ↗ control calls the one opener', () => {
  for (const d of ['production/track_heads.js', 'production/detail.js', 'dock/karten.js', 'dock/window.js', 'seq_view.js']) assert.match(quelle(d), /oeffneGeraetFenster\(/, d);
});

test('controller strip: the knobs of the catalogue device in hardware layout with the knob each one drives; free controls stay, an unknown CC comes last', async () => {
  const { controllerBelegung } = await import('../public/device_window.js');
  const katalog = [{ id: 'lc3', name: 'Launch Control', weg: 'lernen', midi: 'LC3', regler: [
    { name: 'Enc 1', typ: 'cc', kanal: 1, nr: 13, kanal_daw: 16, art: 'knob', zeile: 1, spalte: 1 },
    { name: 'Enc 2', typ: 'cc', kanal: 1, nr: 14, kanal_daw: 16, art: 'knob', zeile: 1, spalte: 2 },
    { name: 'Btn 1', typ: 'cc', kanal: 1, nr: 37, art: 'button', zeile: 3, spalte: 1 }] }];
  const controller = [{ platz: 1, port: 'LPD8', name: 'LPD8' }, { platz: 2, port: 'Midi-Bridge:LC3 1: MIDI In (capture)', name: 'LC3 1' }];
  const zuordnungen = [
    { pfad: 'spur/1/bk/63', kanal: 16, nr: 14, platz: 2, name: 'Bass Clean sub', box: 3 },
    { pfad: 'spur/1/bk/7', kanal: 1, nr: 99, platz: 2 },
    { pfad: 'spur/2/bk/1', kanal: 1, nr: 13, platz: 2, name: 'Other Cutoff' },
    { pfad: 'deck/1/fader', kanal: 1, nr: 1, platz: 1 }];
  const b = controllerBelegung({ zuordnungen, katalog, controller, basis: 'spur/1/bk/', spurName: 'Bass' });
  assert.deepEqual(b, [{ platz: 2, geraet: 'Launch Control', zellen: [
    { regler: 'Enc 1', kurz: '1', zeile: 1, spalte: 1, knopf: null, name: '' },
    { regler: 'Enc 2', kurz: '2', zeile: 1, spalte: 2, knopf: 63, name: 'Clean sub', box: 3 },
    { regler: 'Btn 1', kurz: 'B1', zeile: 3, spalte: 1, knopf: null, name: '' },
    { regler: 'CC 99', kurz: 'CC99', zeile: 0, spalte: 1, knopf: 7, name: 'Knob 7' }] }]);
  const taste = controllerBelegung({ zuordnungen: [{ pfad: 'spur/1/bk/14', kanal: 0, nr: 37, platz: 2, art: 'taste', stufen: 3, name: 'Bass Osc1 wave' }], katalog, controller, basis: 'spur/1/bk/', spurName: 'Bass' })[0].zellen;
  assert.deepEqual(taste[2], { regler: 'Btn 1', kurz: 'B1', zeile: 3, spalte: 1, knopf: 14, name: 'Osc1 wave' }, 'a button that steps a selector, on any channel (0)');
  const mit = (z) => controllerBelegung({ zuordnungen: z, katalog, controller, basis: 'spur/1/bk/', spurName: 'Bass' })[0].zellen;
  assert.equal(mit([{ pfad: 'spur/1/bk/7', kanal: 1, nr: 99, platz: 2, box: 0 }])[3].box, 0, 'box 0 is a box, an unknown CC carries it too');
  assert.equal('box' in mit([{ pfad: 'spur/1/bk/7', kanal: 1, nr: 99, platz: 2 }])[2], false, 'no box from the server: the page counts the sections itself');
  assert.equal('box' in mit([{ pfad: 'spur/1/bk/7', kanal: 1, nr: 99, platz: 2, box: -1 }])[2], false);
  assert.match(quelle('device_window.js'), /boxVonKnopf\.get\(z\.dataset\.param\)/, 'markiere() takes the colour from the server index before counting sections');
  assert.deepEqual(controllerBelegung({ zuordnungen, katalog, controller, basis: null }), []);
  assert.deepEqual(controllerBelegung({ zuordnungen, katalog, controller, basis: 'spur/5/bk/' }), [], 'a place without entries on this track is not listed');
});


test('FOLLOW: the window turns to the track the controller focus moves to, not to a live channel or a track without a view; off pins it', async () => {
  const a = aufbau(BK, [{ ...spurMit('s2', { ...BK, graph: 'synth-poly' }), nr: 2, name: 'T-s2' }, { ...spurMit('s3', null), nr: 3, art: 'audio' }]);
  await warte(20);
  a.gesendet.length = 0;
  a.f.ereignis('controller_fokus', { fokus: { kanal: 'erz/5' }, plaetze: [] });
  assert.equal(a.f.spur(), 's1', 'a live channel: the window stays');
  a.f.ereignis('controller_fokus', { fokus: { spur_id: 's3' }, plaetze: [] });
  assert.equal(a.f.spur(), 's1', 'a track without a view: the window stays');
  a.f.ereignis('controller_fokus', { fokus: { spur_id: 's2', graph: 'synth-poly' }, plaetze: [] });
  assert.equal(a.f.spur(), 's2');
  assert.equal(a.wurzel.kinder[0].kinder[0].textContent, 'T-s2', 'the title line names the new track');
  assert.equal(a.f.lage().spur.id, 's2');
  await warte(0);
  assert.deepEqual(a.gesendet.filter((x) => !Array.isArray(x)), [], 'following the focus sends no focus back');
  assert.equal(a.sender.erneut(), true);
  await warte(0);
  assert.deepEqual(a.gesendet.filter((x) => !Array.isArray(x)), [{ spur_id: 's2' }], 'the browser focus on the window: its new track');
  a.gesendet.length = 0;
  a.f.wechsle('s1', true);
  await warte(0);
  assert.deepEqual(a.gesendet.filter((x) => !Array.isArray(x)), [{ spur_id: 's1' }], 'OPEN ↗ of another track (the address): the window tells its new track');
  const knopf = a.wurzel.kinder[0].kinder[2];
  assert.equal(knopf.textContent, 'FOLLOW');
  knopf.ev.click[0]();
  assert.equal(a.f.folgt(), false);
  a.f.ereignis('controller_fokus', { fokus: { spur_id: 's2' }, plaetze: [] });
  assert.equal(a.f.spur(), 's1', 'FOLLOW off: the window keeps its track');
});

test('folgeZiel: pure rules', () => {
  const projekt = { spuren: [spurMit('s1', BK), spurMit('s2', BK)] };
  assert.equal(folgeZiel({ folgt: true, fokus: { spur_id: 's2' }, spurId: 's1', projekt }), 's2');
  assert.equal(folgeZiel({ folgt: false, fokus: { spur_id: 's2' }, spurId: 's1', projekt }), null);
  assert.equal(folgeZiel({ folgt: true, fokus: { spur_id: 's1' }, spurId: 's1', projekt }), null);
  assert.equal(folgeZiel({ folgt: true, fokus: { spur_id: 's9' }, spurId: 's1', projekt }), null);
  assert.equal(folgeZiel({ folgt: true, fokus: null, spurId: 's1', projekt }), null);
});


test('the strip folds: the class on the root hides its rows and the knob numbers, the head line keeps a button to open it again', async () => {
  const a = aufbau();
  await warte(20);
  assert.equal(a.f.zu(), false);
  assert.equal(a.wurzel.classList.contains('gf-ctl-zu'), false);
});


test('controller state: a program of another page turns the panel there, but never away from the Cabinet page (all: true); stepping still works', async () => {
  const panel = { format: 'cypherdj-panel/2', geraet: { art: 'bk', graph: 'synth-mono' }, title: 'T', pages: [{ id: 'rack', title: 'Cabinet', all: true }, { id: 'east', title: 'East' }, { id: 'mod', title: 'Mod' }],
    sections: [{ id: 'a', title: 'A', page: 'east', controls: [{ id: 'c5', type: 'knob', label: 'c5', bind: { param: 'k5' } }] },
      { id: 'b', title: 'B', page: 'mod', controls: [{ id: 'c6', type: 'knob', label: 'c6', bind: { param: 'k6' } }] }] };
  const a = aufbau(BK, [], panel);
  await warte(20);
  const alle = (e, aus = []) => { aus.push(e); for (const k of e.kinder ?? []) alle(k, aus); return aus; };
  const aus = (id) => alle(a.wurzel).find((e) => e.dataset?.sektion === id).klassen.has('fp-aus');
  const reiter = (text) => alle(a.wurzel).find((e) => e.tag === 'button' && e.textContent === text);
  assert.deepEqual([aus('a'), aus('b')], [false, false], 'the window opens on the Cabinet: every section shows');
  a.f.ereignis('controller_fokus', { fokus: { spur_id: 's1', seite: 'mod' }, plaetze: [] });
  assert.deepEqual([aus('a'), aus('b')], [false, false], 'a program of the page Mod does not turn the Cabinet away');
  reiter('East').ev.click[0]();
  assert.deepEqual([aus('a'), aus('b')], [false, true], 'positive control: on the page East the sections of other pages are off');
  a.f.ereignis('controller_fokus', { fokus: { spur_id: 's1', seite: 'mod' }, plaetze: [] });
  assert.deepEqual([aus('a'), aus('b')], [true, false], 'on any other page the program still turns the panel to its page');
});
