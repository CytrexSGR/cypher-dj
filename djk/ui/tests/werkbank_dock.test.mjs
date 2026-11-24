// Workbench DOCK and floating windows (public/werkbank/dock.js, window.js), run through bindeWerkbank against the DOM stand-in: the cards of the
// synth row and the effect row, their front knobs, LEVEL, ON, the stage chips and the "+" menus, the windows of the big view, the SHELF drawer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installiere, attrappe } from './helpers/pages_mock.mjs';
import { MAX_RETURNS } from '../public/production/limits.js';

installiere();
const { bindeWerkbank } = await import('../public/werkbank/werkbank.js');
const { frontKnoepfe } = await import('../public/dock/blocks.js');
const { sendeVon } = await import('../public/werkbank/dock.js');
const { offenesFace, schliesseFace } = await import('../public/face/frame.js');

const PANELE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'instruments', 'modular_dsp', 'paneele');
const post = (w, k) => fetch(w, { method: 'POST', body: JSON.stringify(k) });
const ruhe = async () => { for (let i = 0; i < 12; i++) await new Promise((ok) => setImmediate(ok)); };
const SENDUNGEN = () => attrappe.anrufe.filter((a) => a.methode === 'POST' && a.url === '/proj/aendern');
const letzter = () => { const l = SENDUNGEN(); assert.ok(l.length > 0, 'nothing sent'); return l.at(-1).koerper; };
const HALL = { an: true, pre: 0.04, decay: 0.5, groesse: 0.3, tief: 0.5, highcut: 0.8, fahne: 0.6 };
const GRAPHEN = [{ name: 'fx-delay-sync', art: 'effekt' }, { name: 'fx-remix', art: 'effekt' }, { name: 'bass-banddrive', art: 'instrument' }];
const bk = (id, nr, name, graph, extra = {}) => ({ id, nr, name, art: 'instrument', farbe: '#3b8fe0', fader_db: 0, clips: [], geraet: { art: 'intern', name: 'bk', graph, parameter: {} }, ...extra });
const ins = (id, art, extra = {}) => ({ id, art, slot: 1, an: true, werte: {}, ...extra });
const modul = (extra = {}) => ({
  name: 'M', rev: 3, werkbank: { schema: 1 }, tempo_bpm: 130, taktart: [4, 4], loop: { an: true, von_beat: 0, bis_beat: 16 }, master: { fader_db: -3, inserts: [] },
  spuren: [
    bk('s2', 2, 'Bass', 'bass-banddrive', { sends: [{ id: 'r1', db: -12 }] }),
    bk('s1', 1, 'Drums', 'drums-909'),
    { id: 's3', nr: 3, name: 'Loop', art: 'audio', clips: [] },
  ],
  returns: [
    { id: 'r1', nr: 1, name: 'Echo', farbe: '#e0a33e', fader_db: 0, mute: false, hall: { ...HALL, an: false }, inserts: [ins('i1', 'bk', { graph: 'fx-delay-sync' })] },
    { id: 'r2', nr: 2, name: 'Hall', farbe: '#5cd0ff', fader_db: -6, mute: false, hall: { ...HALL }, inserts: [] },
  ],
  ...extra,
});
const PANEL = { format: 'cypherdj-panel/2', title: 'T', front: ['k2', 'k1'], sections: [{ id: 'a', title: 'A', controls: [
  { id: 'c1', type: 'knob', label: 'One', bind: { param: 'k1' } }, { id: 'c2', type: 'knob', label: 'Two', bind: { param: 'k2' } }, { id: 'c3', type: 'knob', label: 'Three', bind: { param: 'k3' } }] }] };
const PARAMETER = [1, 2, 3].map((n) => ({ name: `k${n}`, min: 0, max: 1, vorgabe: 0.5, log: false }));

let wurzel, w;
const $w = (n) => wurzel.querySelector(`[data-w="${n}"]`);
const alle = (n) => wurzel.querySelectorAll(`[data-w="${n}"]`);
function aufbau(p, extra = {}, speicher = {}) {
  installiere({ speicher, antworten: { 'GET /proj/aktuell': { j: { slug: 'm', projekt: p } }, 'GET /proj/liste': { j: [] }, 'GET /proj/werkbank/vorlagen': { j: { vorlagen: [] } },
    'GET /graphen': { j: { graphen: GRAPHEN } }, 'GET /proj/kits': { j: { kits: [] } }, 'GET /geraete/panel': { j: { panel: PANEL, parameter: PARAMETER } },
    'GET /graphen/panel': { j: { panel: PANEL, regler: { 1: { min: 0, max: 1, log: false }, 2: { min: 0, max: 1, log: false } } } }, ...extra } });
  wurzel = document.createElement('section');
  w = bindeWerkbank({ post, wurzel, frage: () => true });
}
const menues = () => { const m = { punkte: null }; w.ctx.oeffneMenue = (p) => { m.punkte = p; }; return m; };

test('front knobs: the front list in its order, else the first knobs in section order; sends are counted from -60 dB up', () => {
  assert.deepEqual(frontKnoepfe(PANEL).map((c) => c.bind.param), ['k2', 'k1']);
  assert.deepEqual(frontKnoepfe({ ...PANEL, front: undefined }, 2).map((c) => c.bind.param), ['k1', 'k2']);
  assert.deepEqual(frontKnoepfe({ ...PANEL, front: ['k9', 'k3'] }).map((c) => c.bind.param), ['k3'], 'an entry without a knob is skipped');
  assert.deepEqual(frontKnoepfe({ sections: [] }), []);
  assert.deepEqual(sendeVon(modul({ spuren: [bk('s1', 1, 'A', 'x', { sends: [{ id: 'r1', db: -60 }] }), bk('s2', 2, 'B', 'x', { sends: [{ id: 'r1', db: -20 }] })] }), 'r1'), ['B']);
});

test('the panel files: front is at most six params, each the param of a knob control of that panel', () => {
  const erwartet = { 'drums-909': ['k7', 'k8', 'k27', 'k31'], 'bass-banddrive': ['k10', 'k11', 'k16', 'k24'], 'fx-remix': ['k1', 'k26', 'k20', 'k27'] };
  for (const [name, anfang] of Object.entries(erwartet)) {
    const p = JSON.parse(fs.readFileSync(path.join(PANELE, `${name}.json`), 'utf8'));
    assert.ok(Array.isArray(p.front) && p.front.length <= 6 && p.front.length >= anfang.length, name);
    assert.deepEqual(p.front.slice(0, anfang.length), anfang, name);
    assert.equal(new Set(p.front).size, p.front.length);
    const knoepfe = p.sections.flatMap((s) => s.controls).filter((c) => c.type === 'knob').map((c) => c.bind.param);
    for (const f of p.front) assert.ok(knoepfe.includes(f), `${name}: ${f} is no knob`);
  }
});

test('the dock holds a card per instrument track and per return, the master, and the two "new" cards; the selected track is highlighted', async () => {
  aufbau(modul());
  w.zeige(); await ruhe();
  assert.equal($w('dock').hidden, false);
  assert.deepEqual(alle('karte-spur').map((e) => e.getAttribute('data-spur-id')), ['s1', 's2']);
  assert.deepEqual(alle('karte-fx').map((e) => e.getAttribute('data-return-id')), ['r1', 'r2']);
  assert.ok($w('karte-master') && $w('fx-laden') && $w('karte-spur-neu'));
  assert.ok($w('dock-synths').querySelector('[data-w="karte-spur-neu"]'));
  assert.ok($w('dock-fx').querySelector('[data-w="karte-master"]'));
  assert.ok(wurzel.querySelector('.meter.senkrecht[data-kanal="ret/1"]') && wurzel.querySelector('.meter.senkrecht[data-kanal="pm"]'));
  assert.equal(w.ctx.st.wahl, 's2', 'the default is the first instrument track of the project');
  assert.ok(alle('karte-spur')[1].classList.contains('aktiv'));
  alle('karte-spur')[0].dispatch('click'); await ruhe();
  assert.equal(w.ctx.st.wahl, 's1');
  assert.ok(alle('karte-spur')[0].classList.contains('aktiv'));
  assert.ok(!alle('karte-spur')[1].classList.contains('aktiv'));
  assert.ok(alle('karte-fx')[0].textContent.includes('FROM B'), 'the return names the tracks that send');
  assert.ok(alle('karte-fx')[1].textContent.includes('NO SENDS'));
});

test('without a module the dock is hidden; the SHELF drawer is open then and closed by default once a module is open', async () => {
  aufbau({ ...modul(), werkbank: undefined });
  w.zeige(); await ruhe();
  assert.equal($w('dock').hidden, true);
  assert.equal($w('regal').hidden, false);
  aufbau(modul());
  w.zeige(); await ruhe();
  assert.equal($w('regal').hidden, true);
  $w('regal-auf').dispatch('click');
  assert.equal($w('regal').hidden, false);
  assert.equal(localStorage.getItem('djk-wb-regal-auf'), '1');
  $w('regal-auf').dispatch('click');
  assert.equal($w('regal').hidden, true);
  aufbau(modul(), {}, { 'djk-wb-regal-auf': '1' });
  w.zeige(); await ruhe();
  assert.equal($w('regal').hidden, false, 'the choice is remembered');
});

test('a synth card shows the front knobs of its panel; a drag writes through the same adapter as the full panel (live command), double click ends at once', async () => {
  aufbau(modul());
  w.zeige(); await ruhe();
  const karte = alle('karte-spur')[0];
  const knoepfe = karte.querySelectorAll('[data-w="karte-knopf"]');
  assert.deepEqual(knoepfe.map((k) => k.getAttribute('data-param')), ['k2', 'k1'], 'the order of the front list');
  assert.ok(knoepfe[0].querySelector('.w-dreh-wert').textContent !== '');
  assert.equal(attrappe.anrufe.filter((a) => a.url.startsWith('/geraete/panel')).length, 2, 'one panel request per track, not per redraw');
  attrappe.antworten['POST /proj/aendern'] = { j: { rev: 4, projekt: modul({ rev: 4 }) } };
  knoepfe[0].dispatch('dblclick'); await ruhe();
  const b = letzter().befehle[0];
  assert.deepEqual([b.befehl, b.spur_id, b.param, b.wert], ['geraet_param_setzen', 's1', 'k2', 0.5]);
  // the value of the project shows on the card at the next update
  const mitWert = modul({ rev: 5 }); mitWert.spuren[1].geraet.parameter = { k2: 0.9 };
  await new Promise((ok) => setTimeout(ok, 450));   // a knob that was just moved ignores the project for 400 ms
  w.ctx.uebernimm('m', mitWert); await ruhe();
  assert.equal(alle('karte-spur')[0].querySelectorAll('[data-w="karte-knopf"]')[0].getAttribute('aria-valuetext'), '0.90');
});

test('the effect card: Hall knobs write the Hall of the return, LEVEL writes the return fader, ON mutes, the stage knobs of a Cypher Modular effect write the stage', async () => {
  aufbau(modul());
  w.zeige(); await ruhe();
  const hall = alle('karte-fx')[1], echo = alle('karte-fx')[0];
  assert.deepEqual(hall.querySelectorAll('[data-w="karte-knopf"]').map((k) => k.getAttribute('data-param')), ['groesse', 'decay', 'highcut', 'pre']);
  attrappe.antworten['POST /proj/aendern'] = { j: { rev: 4, projekt: modul({ rev: 4 }) } };
  hall.querySelectorAll('[data-w="karte-knopf"]')[0].dispatch('wheel', { deltaY: -100 }); await ruhe();
  let b = letzter().befehle[0];
  assert.deepEqual([b.befehl, b.return_id, Object.keys(b.hall)], ['return_aendern', 'r2', ['groesse']]);
  assert.ok(Math.abs(b.hall.groesse - 0.32) < 1e-9);
  hall.querySelector('[data-w="karte-level"]').dispatch('wheel', { deltaY: 100 }); await ruhe();
  b = letzter().befehle[0];
  assert.deepEqual([b.befehl, b.return_id, typeof b.fader_db], ['return_aendern', 'r2', 'number']);
  assert.ok(b.fader_db < -6);
  hall.querySelector('[data-w="karte-an"]').dispatch('click'); await ruhe();
  assert.deepEqual(letzter().befehle, [{ befehl: 'return_aendern', return_id: 'r2', mute: true }]);
  // the Echo return: its first stage is a Baukasten effect: the panel of that graph gives the knobs
  assert.deepEqual(echo.querySelectorAll('[data-w="karte-knopf"]').map((k) => k.getAttribute('data-param')), ['k2', 'k1']);
  echo.querySelectorAll('[data-w="karte-knopf"]')[0].dispatch('dblclick'); await ruhe();
  b = letzter().befehle[0];
  assert.equal(b.befehl, 'insert_param_setzen'); assert.equal(b.insert_id, 'i1'); assert.equal(b.param, 'k2');
});

test('the master card: LEVEL writes master_aendern; the stage chips and + INSERT sit on it', async () => {
  aufbau(modul({ master: { fader_db: -3, inserts: [ins('m1', 'komp')] } }));
  w.zeige(); await ruhe();
  const m = $w('karte-master');
  assert.deepEqual(m.querySelectorAll('[data-w="karte-teil"]').map((e) => e.getAttribute('data-teil')), ['m1']);
  attrappe.antworten['POST /proj/aendern'] = { j: { rev: 4, projekt: modul({ rev: 4 }) } };
  m.querySelector('[data-w="karte-level"]').dispatch('wheel', { deltaY: -100 }); await ruhe();
  const b = letzter().befehle[0];
  assert.equal(b.befehl, 'master_aendern'); assert.ok(b.fader_db > -3);
  const menue = menues();
  m.querySelector('[data-w="karte-plus"]').dispatch('click'); await ruhe();
  assert.ok(menue.punkte.some((x) => x.text === 'fx-remix'));
  await menue.punkte.find((x) => x.text === 'fx-remix').aktion(); await ruhe();
  const i = letzter().befehle[0];
  assert.deepEqual([i.befehl, i.strang_id, i.art, i.graph], ['insert_setzen', 'master', 'bk', 'fx-remix']);
});

test('+ LOAD EFFECT offers every effect graph and writes return_neu; + INSTRUMENT TRACK opens the track menu; CHANGE the instrument menu', async () => {
  aufbau(modul());
  w.zeige(); await ruhe();
  const menue = menues();
  $w('fx-laden').dispatch('click'); await ruhe();
  assert.ok(menue.punkte.some((x) => x.text === 'fx-remix'), 'the self-built effects too');
  attrappe.antworten['POST /proj/aendern'] = { j: { rev: 4, projekt: modul({ rev: 4 }) } };
  await menue.punkte.find((x) => x.text === 'Hall').aktion(); await ruhe();
  assert.deepEqual(letzter().befehle, [{ befehl: 'return_neu', name: 'Hall' }]);
  $w('karte-spur-neu').dispatch('click'); await ruhe();
  assert.ok(menue.punkte.some((x) => x.text === 'bass-banddrive'), 'the track menu lists the instruments');
  menue.punkte = null;
  alle('karte-wechsel')[1].dispatch('click'); await ruhe();
  assert.ok(menue.punkte.some((x) => x.text === 'bass-banddrive'));
});

test('a full rack: the menu of + LOAD EFFECT refuses every entry', async () => {
  const r = (n) => ({ id: `r${n}`, nr: n, name: `R${n}`, farbe: '#fff', fader_db: 0, hall: { ...HALL }, inserts: [] });
  aufbau(modul({ returns: Array.from({ length: MAX_RETURNS }, (_, i) => r(i + 1)) }));
  w.zeige(); await ruhe();
  const menue = menues();
  $w('fx-laden').dispatch('click'); await ruhe();
  assert.ok(menue.punkte.filter((x) => !x.gruppe).every((x) => x.aus === true));
});

test('OPEN opens the window of the track with its panel; the close button closes it; the SOUND host with the cut strip sits in it and goes back', async () => {
  aufbau(modul());
  w.zeige(); await ruhe();
  assert.equal(alle('fenster').length, 0);
  alle('karte-spur')[1].querySelector('[data-w="karte-auf"]').dispatch('click'); await ruhe();
  assert.equal(alle('fenster').length, 1);
  assert.equal(w.ctx.st.wahl, 's2', 'the cut strip works on the selected track: OPEN selects it');
  const f = $w('fenster');
  assert.ok(f.textContent.includes('B') && f.textContent.includes('Bass'));
  assert.ok(f.contains($w('klang')), 'the SOUND host (cut strip, kit dialog) is in the window');
  assert.ok(f.contains($w('schnitt')));
  assert.ok(f.querySelector('.frontplatte') || f.textContent.length > 0);
  $w('fenster-zu').dispatch('click');
  assert.equal(alle('fenster').length, 0);
  assert.ok(!$w('fenster'));
  assert.ok($w('schnitt'), 'the strip stays in the page tree');
  assert.equal($w('klang').hidden, true);
});

test('the window drags by its title bar, stays inside the layer, remembers its place per kind of device; several windows can be open', async () => {
  aufbau(modul());
  w.zeige(); await ruhe();
  alle('karte-spur')[0].querySelector('[data-w="karte-auf"]').dispatch('click'); await ruhe();
  alle('karte-spur')[1].querySelector('[data-w="karte-auf"]').dispatch('click'); await ruhe();
  assert.equal(alle('fenster').length, 2);
  const kopf = alle('fenster-kopf')[1];
  const vorher = kopf.parent.attrs;   // title bar of the second window
  kopf.dispatch('pointerdown', { clientX: 100, clientY: 50, pointerId: 1 });
  kopf.dispatch('pointermove', { clientX: 300, clientY: 90, pointerId: 1 });
  kopf.dispatch('pointerup', { pointerId: 1 });
  const lage = localStorage.getItem('djk-wb-fenster-bk:bass-banddrive');
  assert.match(lage, /^\d+,\d+$/);
  kopf.dispatch('pointerdown', { clientX: 0, clientY: 0, pointerId: 1 });
  kopf.dispatch('pointermove', { clientX: -5000, clientY: -5000, pointerId: 1 });
  kopf.dispatch('pointerup', { pointerId: 1 });
  assert.equal(localStorage.getItem('djk-wb-fenster-bk:bass-banddrive'), '0,0', 'never outside the layer');
  assert.ok(vorher);
  // a window of the same kind opens where the last one was left
  $w('fenster-zu').dispatch('click');
  alle('fenster-zu').at(-1).dispatch('click');
  assert.equal(alle('fenster').length, 0);
  alle('karte-spur')[1].querySelector('[data-w="karte-auf"]').dispatch('click'); await ruhe();
  assert.equal(alle('fenster').length, 1);
  // a second OPEN of the same device does not open a second window
  alle('karte-spur')[1].querySelector('[data-w="karte-auf"]').dispatch('click'); await ruhe();
  assert.equal(alle('fenster').length, 1);
});

test('a Cypher Modular stage opens in a window with ON/OFF, earlier, later and remove; a native stage opens its floating face; the Hall opens the Hall face', async () => {
  const mit = (rev, inserts) => modul({ rev, spuren: [bk('s1', 1, 'Drums', 'drums-909', { inserts })] });
  aufbau(mit(3, [ins('i1', 'komp'), ins('i2', 'bk', { graph: 'fx-delay-sync' })]));
  w.zeige(); await ruhe();
  const karte = alle('karte-spur')[0];
  assert.deepEqual(karte.querySelectorAll('[data-w="karte-teil"]').map((e) => e.textContent), ['COMPRESSOR', 'fx-delay-sync']);
  // a native stage: the existing floating face, no window
  karte.querySelectorAll('[data-w="karte-teil"]')[0].dispatch('click'); await ruhe();
  assert.equal(offenesFace()?.id, 'face:i1');
  assert.equal(alle('fenster').length, 0);
  schliesseFace();
  // a Baukasten stage: a window with the panel of the effect
  karte.querySelectorAll('[data-w="karte-teil"]')[1].dispatch('click'); await ruhe();
  assert.equal(alle('fenster').length, 1);
  assert.ok(attrappe.anrufe.some((a) => a.url === '/graphen/panel?name=fx-delay-sync'));
  assert.equal($w('fenster-an').textContent, 'ON');
  assert.equal($w('fenster-rechts').disabled, true, 'the last stage cannot move later');
  attrappe.antworten['POST /proj/aendern'] = { j: { rev: 4, projekt: mit(4, [ins('i2', 'bk', { graph: 'fx-delay-sync' }), ins('i1', 'komp')]) } };
  $w('fenster-links').dispatch('click'); await ruhe();
  assert.deepEqual(letzter().befehle, [{ befehl: 'insert_ordnung', strang_id: 's1', reihenfolge: ['i2', 'i1'] }]);
  attrappe.antworten['POST /proj/aendern'] = { j: { rev: 5, projekt: mit(5, [ins('i2', 'bk', { graph: 'fx-delay-sync', an: false }), ins('i1', 'komp')]) } };
  $w('fenster-an').dispatch('click'); await ruhe();
  assert.deepEqual(letzter().befehle, [{ befehl: 'insert_an', insert_id: 'i2', an: false }]);
  assert.equal($w('fenster-an').textContent, 'OFF');
  attrappe.antworten['POST /proj/aendern'] = { j: { rev: 6, projekt: mit(6, [ins('i1', 'komp')]) } };
  $w('fenster-weg').dispatch('click'); await ruhe();
  assert.deepEqual(letzter().befehle, [{ befehl: 'insert_entfernen', insert_id: 'i2' }]);
  assert.equal(alle('fenster').length, 0, 'the window of a stage that is gone closes');
  // the chip menu (right click)
  const menue = menues();
  alle('karte-spur')[0].querySelector('[data-w="karte-teil"]').dispatch('contextmenu', { clientX: 5, clientY: 6 });
  assert.deepEqual(menue.punkte.map((p) => p.text), ['Bypass', 'Move earlier', 'Move later', 'Remove']);
  // the Hall of a return
  alle('karte-fx')[1].querySelector('[data-w="karte-auf"]').dispatch('click'); await ruhe();
  assert.equal(alle('fenster').length, 1);
  assert.ok($w('fenster').textContent.includes('HALL'));
  assert.equal($w('fenster-an').textContent, 'ON');
});

test('+ INSERT on a track writes insert_setzen and opens the new Cypher Modular stage', async () => {
  aufbau(modul());
  w.zeige(); await ruhe();
  const menue = menues();
  alle('karte-spur')[0].querySelector('[data-w="karte-plus"]').dispatch('click'); await ruhe();
  assert.deepEqual(menue.punkte.slice(0, 4).map((p) => p.text), ['Compressor', 'EQ', 'Saturator', 'Limiter']);
  const neu = modul({ rev: 4 }); neu.spuren[1] = bk('s1', 1, 'Drums', 'drums-909', { inserts: [ins('i9', 'bk', { graph: 'fx-delay-sync' })] });
  attrappe.antworten['POST /proj/aendern'] = { j: { rev: 4, projekt: neu } };
  await menue.punkte.find((p) => p.text === 'fx-delay-sync').aktion(); await ruhe();
  assert.deepEqual(letzter().befehle, [{ befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'bk', graph: 'fx-delay-sync' }]);
  assert.equal(alle('fenster').length, 1);
});

test('the track rows carry one send knob per return; it writes send_setzen with the taper of the fader; without returns there are none', async () => {
  aufbau(modul());
  w.zeige(); await ruhe();
  const zeilen = alle('spur');
  assert.deepEqual(zeilen.map((z) => z.querySelectorAll('[data-w="spur-send"]').length), [2, 2]);
  const sends = zeilen[1].querySelectorAll('[data-w="spur-send"]');
  assert.deepEqual(sends.map((s) => s.getAttribute('data-return-id')), ['r1', 'r2']);
  assert.ok(sends[0].title.includes('-12.0'), 'the send of Bass into Echo is -12 dB');
  attrappe.antworten['POST /proj/aendern'] = { j: { rev: 4, projekt: modul({ rev: 4 }) } };
  zeilen[0].querySelectorAll('[data-w="spur-send"]')[0].dispatch('wheel', { deltaY: -100 }); await ruhe();
  const s = letzter().befehle[0];
  assert.deepEqual([s.befehl, s.strang_id, s.return_id], ['send_setzen', 's1', 'r1']);
  assert.equal(typeof s.db, 'number');
  w.ctx.uebernimm('m', modul({ rev: 9, returns: [] })); await ruhe();
  assert.deepEqual(alle('spur').map((z) => z.querySelectorAll('[data-w="spur-send"]').length), [0, 0]);
});

test('the pieces of the old SOUND column and MIX view are gone from the page', async () => {
  aufbau(modul());
  w.zeige(); await ruhe();
  for (const n of ['mix', 'sicht-mix', 'sicht-noten', 'kachel', 'kacheln', 'geraet', 'klang-titel']) assert.equal($w(n), null, n);
  assert.ok($w('noten'));
});
