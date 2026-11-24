// Workbench task 4: the track list (tracks.js) and the instrument info cache (info.js). The region is run through bindeWerkbank against the DOM
// stand-in (tests/helpers/pages_mock.mjs); the pure functions are called directly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installiere, attrappe } from './helpers/pages_mock.mjs';

installiere();
const { bindeWerkbank } = await import('../public/werkbank/werkbank.js');
const { spurZeilen, rasterArt, neueSpurBefehl, MAX_SPUREN_MODUL } = await import('../public/werkbank/tracks.js');
const { faderText } = await import('../public/dock/drehknopf.js');
const { MAX_WERKBANK_SPUREN } = await import('../project/werkbank.ts');
const { reglerVonDb, dbVonRegler } = await import('../public/production/fader_curve.js');
const { neuerInfoSpeicher, INFO_WARTEN_MS, geraetSchluessel } = await import('../public/werkbank/info.js');

const bk = (nr, graph, id = `s${nr}`) => ({ id, nr, name: `T${nr}`, farbe: '#2fd6c3', art: 'instrument', geraet: { art: 'intern', name: 'bk', graph, parameter: {} }, clips: [] });
const kit = (nr) => ({ id: `s${nr}`, nr, name: `K${nr}`, farbe: '#ff8800', art: 'instrument', geraet: { art: 'intern', name: 'kit', kit: 'k1', parameter: {} }, clips: [] });
const audio = (nr) => ({ id: `a${nr}`, nr, name: `A${nr}`, farbe: '#888888', art: 'audio', clips: [] });
const projektMit = (spuren) => ({ name: 'M', rev: 1, werkbank: { schema: 1 }, tempo_bpm: 130, taktart: [4, 4], loop: { an: true, von_beat: 0, bis_beat: 16 }, spuren });

test('spurZeilen: instrument tracks by nr with letters; others counted', () => {
  const z = spurZeilen(projektMit([bk(2, 'drums-909'), audio(1), bk(1, 'bass-banddrive')]), () => null);
  assert.deepEqual(z.zeilen.map((x) => [x.buchstabe, x.nr]), [['A', 1], ['B', 2]]);
  assert.equal(z.andere, 1);
});

test('spurZeilen: a ninth track shows its number; the chip is empty while the info loads', () => {
  const spuren = Array.from({ length: 9 }, (_, i) => bk(i + 1, 'bass-banddrive'));
  const z = spurZeilen(projektMit(spuren), (s) => (s.nr === 1 ? { art: 'bk', regler: [], klaenge: [] } : null));
  assert.equal(z.zeilen[7].buchstabe, 'H');
  assert.equal(z.zeilen[8].buchstabe, '9');
  assert.equal(z.zeilen[0].art, 'note');
  assert.equal(z.zeilen[1].art, null);
});

test('rasterArt: kit and drum graph are drum, a synth is note', () => {
  assert.equal(rasterArt(kit(1), null), 'drum');
  assert.equal(rasterArt(bk(1, 'drums-909'), { klaenge: [{ ton: 36, name: 'Kick' }] }), 'drum');
  assert.equal(rasterArt(bk(2, 'bass-banddrive'), { klaenge: [] }), 'note');
});

test('rasterArt: a cut is slice before any other rule', () => {
  assert.equal(rasterArt(bk(1, 'smp-x'), { klaenge: [{ ton: 0, name: '1' }], schnitt: { id: 'x', scheiben: 1, laengen_beats: [4] } }), 'slice');
  assert.equal(rasterArt(bk(1, 'drums-909'), { klaenge: [{ ton: 36, name: 'Kick' }], schnitt: { id: 'x', scheiben: 1, laengen_beats: [4] } }), 'slice');
  assert.equal(rasterArt(bk(1, 'smp-x'), { klaenge: [{ ton: 0, name: '1' }] }), 'drum', 'without the cut it stays a drum grid');
  const z = spurZeilen(projektMit([bk(1, 'smp-x')]), () => ({ art: 'bk', regler: [], klaenge: [{ ton: 0, name: '1' }], schnitt: { id: 'x', scheiben: 1, laengen_beats: [4] } }));
  assert.equal(z.zeilen[0].art, 'slice');
});

test('geraetSchluessel names the device, not the track', () => {
  assert.equal(geraetSchluessel(bk(1, 'drums-909')), 'bk:drums-909');
  assert.equal(geraetSchluessel(kit(1)), 'kit:k1');
  assert.equal(geraetSchluessel({ id: 'x', geraet: { art: 'intern', name: 'rb338' } }), 'rb338');
  assert.equal(geraetSchluessel({ id: 'x', geraet: { art: 'wirt', name: 'surge' } }), 'anderes:x');
});

test('the info store asks once per device and again after INFO_WARTEN_MS when it failed', async () => {
  const gefragt = []; let antwort = { status: 409, j: { fehler: 'kein_projekt' } }, neu = 0, t = 1000;
  const speicher = neuerInfoSpeicher(async (weg) => { gefragt.push(weg); return antwort; }, () => { neu++; }, () => t);
  const a = bk(1, 'drums-909'), b = bk(2, 'drums-909', 'sB');
  assert.equal(speicher.info(a), null, 'nothing known yet');
  assert.equal(speicher.info(b), null, 'a second track of the graph does not ask again');
  assert.deepEqual(gefragt, ['/seq/geraet?spur_id=s1']);
  await new Promise((ok) => setImmediate(ok));
  assert.equal(neu, 1);
  assert.deepEqual(speicher.info(a), { art: 'bk', regler: [], klaenge: [] }, 'a failure is an empty info');
  assert.equal(gefragt.length, 1);
  t += INFO_WARTEN_MS - 1;
  speicher.info(a);
  assert.equal(gefragt.length, 1, 'not yet');
  t += 1;
  antwort = { status: 200, j: { art: 'bk', regler: [{ nr: 1, name: 'Tune', vorgabe: 0.5 }], klaenge: [{ ton: 36, name: 'Kick' }] } };
  speicher.info(a);
  assert.equal(gefragt.length, 2, 'asked again');
  await new Promise((ok) => setImmediate(ok));
  assert.equal(speicher.info(a).klaenge.length, 1);
  speicher.vergiss();
  speicher.info(a);
  assert.equal(gefragt.length, 3, 'vergiss() drops the cache');
});

test('the info store keeps the cut of a sampler device', async () => {
  const schnitt = { id: 'x', scheiben: 2, laengen_beats: [2, 2] };
  const speicher = neuerInfoSpeicher(async () => ({ status: 200, j: { art: 'bk', regler: [], klaenge: [{ ton: 0, name: '1' }, { ton: 1, name: '2' }], schnitt } }), () => {});
  const a = bk(1, 'smp-x');
  speicher.info(a);
  await new Promise((ok) => setImmediate(ok));
  assert.deepEqual(speicher.info(a).schnitt, schnitt);
});

// ---- the region ----
const post = (w, k) => fetch(w, { method: 'POST', body: JSON.stringify(k) });
const ruhe = async () => { for (let i = 0; i < 12; i++) await new Promise((ok) => setImmediate(ok)); };
const GETS = (weg) => attrappe.anrufe.filter((a) => a.methode === 'GET' && a.url.split('?')[0] === weg);
let wurzel, w;
function aufbau(projekt, speicher = {}) {
  installiere({
    speicher,
    antworten: {
      'GET /proj/aktuell': { j: { slug: 'm1', projekt } },
      'GET /proj/liste': { j: [] },
      'GET /proj/werkbank/vorlagen': { j: { vorlagen: [] } },
      'GET /seq/geraet': (_k) => ({ j: { art: 'bk', regler: [], klaenge: [] } }),
      'GET /geraete/panel': { j: {} },
    },
  });
  wurzel = document.createElement('section');
  w = bindeWerkbank({ post, wurzel, frage: () => true });
}
const zeilen = () => wurzel.querySelectorAll('[data-w="spur"]');

test('the track list shows a row per instrument track with letter, name, chip and instrument text; the first is selected', async () => {
  aufbau(projektMit([bk(1, 'drums-909'), bk(2, 'bass-banddrive'), audio(1)]));
  w.zeige(); await ruhe();
  const z = zeilen();
  assert.equal(z.length, 2);
  assert.equal(z[0].querySelector('[data-w="spur-buchstabe"]').textContent, 'A');
  assert.equal(z[0].querySelector('[data-w="spur-name"]').textContent, 'T1');
  assert.equal(z[0].querySelector('[data-w="spur-geraet"]').textContent, 'Cypher Modular · drums-909');
  assert.ok(z[0].classList.contains('aktiv'));
  assert.ok(!z[1].classList.contains('aktiv'));
  assert.equal(w.ctx.st.wahl, 's1');
  assert.ok(wurzel.querySelector('[data-w="spuren"]').textContent.includes('1 other track'));
});

test('selecting a track shows its panel wide and remembers the choice per module', async () => {
  aufbau(projektMit([bk(1, 'drums-909'), bk(2, 'bass-banddrive')]));
  w.zeige(); await ruhe();
  // the dock cards load the panel of every track once (their front knobs); selecting a track asks for nothing more
  assert.deepEqual(GETS('/geraete/panel').map((a) => a.url).sort(), ['/geraete/panel?art=bk&graph=bass-banddrive', '/geraete/panel?art=bk&graph=drums-909']);
  zeilen()[1].dispatch('click'); await ruhe();
  assert.equal(w.ctx.st.wahl, 's2');
  assert.equal(localStorage.getItem('djk-wb-wahl-m1'), 's2');
  assert.equal(GETS('/geraete/panel').length, 2);
  assert.ok(zeilen()[1].classList.contains('aktiv'));
  assert.ok(wurzel.querySelectorAll('[data-w="karte-spur"]')[1].classList.contains('aktiv'), 'the card of the track is highlighted too');
  // a reload (new view over the same storage) keeps B
  aufbau(projektMit([bk(1, 'drums-909'), bk(2, 'bass-banddrive')]), { 'djk-wb-wahl-m1': 's2' });
  w.zeige(); await ruhe();
  assert.equal(w.ctx.st.wahl, 's2');
  assert.ok(zeilen()[1].classList.contains('aktiv'));
});

test('ctx.info is the cache: one request per graph, the chip follows the answer', async () => {
  aufbau(projektMit([bk(1, 'drums-909'), bk(2, 'drums-909')]));
  attrappe.antworten['GET /seq/geraet'] = { j: { art: 'bk', regler: [], klaenge: [{ ton: 36, name: 'Kick' }] } };
  w.zeige(); await ruhe();
  assert.equal(GETS('/seq/geraet').length, 1);
  assert.equal(zeilen()[0].querySelector('[data-w="spur-art"]').textContent, 'DRUM');
  assert.equal(w.ctx.info(w.ctx.st.projekt.spuren[1]).klaenge.length, 1);
});

// ---- task 9: level, mute, solo, meter, add and delete ----
const bkG = (graph) => ({ art: 'intern', name: 'bk', graph, parameter: {} });
const modulMit = (namen, loop = { an: true, von_beat: 0, bis_beat: 16 }) => ({ ...projektMit(namen.map((n, i) => ({ ...bk(i + 1, 'bass-banddrive'), name: n, fader_db: -6, mute: false, solo: false }))), loop });
const AENDERN = (p) => ({ j: { rev: p.rev + 1, projekt: { ...p, rev: p.rev + 1 } } });
const posts = () => attrappe.anrufe.filter((a) => a.methode === 'POST' && a.url === '/proj/aendern');
const reihe = (i) => zeilen()[i];
const teilVon = (r, n) => r.querySelector(`[data-w="${n}"]`);

test('faderText', () => {
  assert.deepEqual([faderText(-6), faderText(-200), faderText(3.25)], ['-6.0 dB', '-inf', '+3.3 dB']);
});

test('neueSpurBefehl names freely and refuses the ninth', () => {
  const rb = { art: 'intern', name: 'rb338', parameter: {} };
  assert.deepEqual(neueSpurBefehl(modulMit(['Bass']), { name: 'Bass', geraet: bkG('bass-banddrive') }), { befehl: 'werkbank_spur_neu', name: 'Bass 2', geraet: bkG('bass-banddrive'), loop_beats: 16 });
  assert.equal(neueSpurBefehl(modulMit(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']), { name: 'X', geraet: rb }), null);
  assert.equal(MAX_SPUREN_MODUL, MAX_WERKBANK_SPUREN);
  // the pattern length follows the module length; a module without a length gets 16
  assert.equal(neueSpurBefehl(modulMit(['A'], { an: true, von_beat: 0, bis_beat: 8 }), { name: 'X', geraet: rb }).loop_beats, 8);
  assert.equal(neueSpurBefehl(modulMit(['A'], { an: false, von_beat: 0, bis_beat: 8 }), { name: 'X', geraet: rb }).loop_beats, 16);
  // other tracks do not count against the limit
  const p = modulMit(['A']); p.spuren.push(audio(1));
  assert.ok(neueSpurBefehl(p, { name: 'X', geraet: rb }));
});

test('each row has a level slider, M, S and a meter; the slider shows the stored level', async () => {
  const p = modulMit(['Drums', 'Bass']); p.spuren[1].fader_db = 0; p.spuren[1].mute = true;
  aufbau(p); w.zeige(); await ruhe();
  const r = reihe(1);
  const f = teilVon(r, 'spur-fader');
  assert.equal(f.value, String(reglerVonDb(0)));
  assert.equal(f.getAttribute('max'), '1000');
  assert.equal(f.getAttribute('step'), '5');
  assert.equal(teilVon(r, 'spur-faderwert').textContent, '0.0 dB');
  assert.equal(teilVon(reihe(0), 'spur-faderwert').textContent, '-6.0 dB');
  assert.equal(teilVon(r, 'spur-mute').getAttribute('aria-pressed'), 'true');
  assert.equal(teilVon(r, 'spur-solo').getAttribute('aria-pressed'), 'false');
  const m = r.querySelector('.meter');
  assert.equal(m.getAttribute('data-kanal'), 'spur/2');
  assert.ok(m.classList.contains('waagrecht'));
  assert.ok(m.querySelector('i'));
});

test('level, mute and solo write spur_aendern; the fader coalesces per track', async () => {
  const p = modulMit(['Drums', 'Bass']);
  aufbau(p); attrappe.antworten['POST /proj/aendern'] = AENDERN(p);
  w.zeige(); await ruhe();
  const f = teilVon(reihe(0), 'spur-fader');
  f.value = String(reglerVonDb(-12)); f.dispatch('input');
  f.value = String(reglerVonDb(-9)); f.dispatch('input');
  f.value = String(reglerVonDb(-3)); f.dispatch('input');
  await ruhe();
  const k = posts().map((a) => a.koerper);
  assert.equal(k.length, 2, 'the first goes out at once, the two after it coalesce into one');
  assert.equal(k.at(-1).label, 'Volume Drums');
  assert.deepEqual(k.at(-1).befehle.map((b) => [b.befehl, b.spur_id]), [['spur_aendern', 's1']]);
  assert.ok(Math.abs(k.at(-1).befehle[0].fader_db - dbVonRegler(reglerVonDb(-3))) < 1e-9);
  // another track: its own key, so it does not replace the first
  attrappe.anrufe.length = 0;
  teilVon(reihe(1), 'spur-mute').dispatch('click'); await ruhe();
  assert.deepEqual(posts().at(-1).koerper.befehle, [{ befehl: 'spur_aendern', spur_id: 's2', mute: true }]);
  assert.equal(posts().at(-1).koerper.label, 'Mute Bass');
  teilVon(reihe(1), 'spur-solo').dispatch('click'); await ruhe();
  assert.deepEqual(posts().at(-1).koerper.befehle, [{ befehl: 'spur_aendern', spur_id: 's2', solo: true }]);
  // double click: back to 0 dB
  attrappe.anrufe.length = 0;
  teilVon(reihe(0), 'spur-fader').dispatch('dblclick'); await ruhe();
  assert.equal(posts().at(-1).koerper.befehle[0].fader_db, 0);
});

test('a pressed M sends mute false', async () => {
  const p = modulMit(['Drums']); p.spuren[0].mute = true;
  aufbau(p); attrappe.antworten['POST /proj/aendern'] = AENDERN(p);
  w.zeige(); await ruhe();
  teilVon(reihe(0), 'spur-mute').dispatch('click'); await ruhe();
  assert.deepEqual(posts().at(-1).koerper.befehle, [{ befehl: 'spur_aendern', spur_id: 's1', mute: false }]);
});

test('delete asks; "no" sends nothing, "yes" sends spur_loeschen', async () => {
  const p = modulMit(['Drums', 'Bass']);
  const fragen = [];
  aufbau(p); attrappe.antworten['POST /proj/aendern'] = AENDERN(p);
  w.zeige(); await ruhe();
  w.ctx.frage = (t) => { fragen.push(t); return false; };
  teilVon(reihe(1), 'spur-loeschen').dispatch('click'); await ruhe();
  assert.deepEqual(fragen, ['Delete track Bass with its pattern?']);
  assert.equal(posts().length, 0);
  w.ctx.frage = (t) => { fragen.push(t); return true; };
  teilVon(reihe(1), 'spur-loeschen').dispatch('click'); await ruhe();
  assert.deepEqual(posts().at(-1).koerper.befehle, [{ befehl: 'spur_loeschen', spur_id: 's2' }]);
  assert.equal(posts().at(-1).koerper.label, 'Delete track Bass');
});

test('+ INSTRUMENT TRACK opens the instrument menu; a choice sends werkbank_spur_neu and selects the new track', async () => {
  const p = modulMit(['Bass']);
  aufbau(p);
  attrappe.antworten['GET /graphen'] = { j: { graphen: [{ art: 'instrument', name: 'bass-banddrive' }, { art: 'instrument', name: 'drums-909' }] } };
  attrappe.antworten['GET /proj/kits'] = { j: { kits: [] } };
  const neuP = modulMit(['Bass']); neuP.spuren.push({ ...bk(2, 'bass-banddrive', 'sNeu'), name: 'bass-banddrive' });
  attrappe.antworten['POST /proj/aendern'] = AENDERN(neuP);
  w.zeige(); await ruhe();
  let punkte = null;
  w.ctx.oeffneMenue = (liste) => { punkte = liste; };
  const knopf = wurzel.querySelector('[data-w="spur-neu"]');
  assert.equal(knopf.textContent, '+ INSTRUMENT TRACK');
  assert.ok(!knopf.disabled);
  knopf.dispatch('click'); await ruhe();
  const eintrag = punkte.find((x) => x.text === 'bass-banddrive');
  assert.ok(eintrag, 'the Cypher Modular graphs are listed');
  assert.equal(posts().length, 0, 'opening the menu sends nothing');
  eintrag.aktion(); await ruhe();
  assert.deepEqual(posts().at(-1).koerper.befehle, [{ befehl: 'werkbank_spur_neu', name: 'bass-banddrive', geraet: { art: 'intern', name: 'bk', graph: 'bass-banddrive' }, loop_beats: 16 }]);
  assert.equal(w.ctx.st.wahl, 'sNeu');
});

test('at eight instrument tracks the add button is disabled with its title', async () => {
  aufbau(modulMit(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']));
  w.zeige(); await ruhe();
  const knopf = wurzel.querySelector('[data-w="spur-neu"]');
  assert.ok(knopf.disabled);
  assert.equal(knopf.getAttribute('title'), 'A module holds 8 instrument tracks');
  let offen = false; w.ctx.oeffneMenue = () => { offen = true; };
  knopf.dispatch('click'); await ruhe();
  assert.ok(!offen);
});

test('a row keeps its controls across a project change and follows the new values', async () => {
  const p = modulMit(['Drums']);
  aufbau(p); w.zeige(); await ruhe();
  const f = teilVon(reihe(0), 'spur-fader');
  const neu = modulMit(['Drums']); neu.rev = 2; neu.spuren[0].fader_db = 0; neu.spuren[0].solo = true;
  w.ctx.uebernimm('m1', neu); await ruhe();
  assert.ok(teilVon(reihe(0), 'spur-fader') === f, 'the same slider element');
  assert.equal(f.value, String(reglerVonDb(0)));
  assert.equal(teilVon(reihe(0), 'spur-solo').getAttribute('aria-pressed'), 'true');
  assert.equal(reihe(0).querySelectorAll('.meter').length, 1);
});
