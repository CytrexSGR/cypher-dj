// Controller register, page side: registerZeilen and geraeteZeilen (pure), baueRegister, baueGeraete and baueLernen over a tiny fake DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerZeilen, baueRegister, baueLernen, baueGeraete, namenVon, kacheln, kachelSicht, kachelZaehler, zielZeilen, modulZaehler, zielLabel, falteModule, baueKacheln, baueWaehler, baueZiele, baueWahl, geraeteZeilen } from '../public/register_view.js';

const daten = {
  geraete: [
    { id: 'pult', datei: 'pult.json', rolle: 'basis', eintraege: 2, leds: 0, fehler: null },
    { id: 'lernen-2', datei: 'lernen-2.json', rolle: 'lernen', eintraege: 1, leds: 0, fehler: null },
    { id: 'bruecke', datei: 'bruecke.json', rolle: 'bruecke', eintraege: 1, leds: 0, fehler: null },
    { id: 'apc20', datei: 'apc20.json', rolle: 'inaktiv', eintraege: 1, leds: 0, fehler: null },
    { id: 'kaputt', datei: 'kaputt.json', rolle: 'inaktiv', eintraege: 0, leds: 0, fehler: 'json' },
  ],
  kanten: [
    { geraet: 'pult', besitzer: 'apc20', weg: 'kern', quelle: { typ: 'cc', kanal: 1, nr: 7 }, ziel: 'deck/1/fader', art: 'absolut', kurve: 'fader_db', einheit: 'db' },
    { geraet: 'pult', besitzer: 's8', weg: 'kern', quelle: { typ: 'note', kanal: 13, nr: 10 }, ziel: 'deck/1/pfl', art: 'taste', kurve: null, einheit: 'schalter' },
    { geraet: 'lernen-2', besitzer: 'platz:2', weg: 'kern', quelle: { typ: 'cc', kanal: 16, nr: 13 }, ziel: 'deck/2/filter', art: 'absolut', kurve: null, einheit: 'linear' },
    { geraet: 'apc20', besitzer: null, weg: 'kern', quelle: { typ: 'cc', kanal: 1, nr: 48 }, ziel: 'deck/2/filter', art: 'absolut', kurve: null, einheit: 'linear' },
    { geraet: 'bruecke', besitzer: 's8', weg: 'seite', quelle: { name: 'left touch strip' }, ziel: 'deck/1/scrub', art: 'beruehrung', kurve: null, einheit: null },
  ],
};
const NAMEN = new Map([['apc20', 'Akai APC20'], ['s8', 'Traktor Kontrol S8'], ['platz:2', 'Novation Launch Control 3']]);

test('registerZeilen: only assignments in effect, the device by name, a readable control, learned rows can be deleted', () => {
  const z = registerZeilen(daten, '', { namen: NAMEN });
  assert.equal(z.length, 4, 'the file apc20.json is not loaded: its row is left out');
  assert.deepEqual([z[0].geraet, z[0].loeschbar], ['Novation Launch Control 3', true], 'learned by hand comes first');
  assert.deepEqual(z[1], { besitzer: 'apc20', geraet: 'Akai APC20', quelle: 'CC 7 · ch 1', ziel: 'deck/1/fader', modul: 'Container A', modulId: 'deck/1', art: 'knob', loeschbar: false });
  assert.equal(z[2].quelle, 'Note 10 · ch 13');
  assert.deepEqual([z[3].quelle, z[3].art], ['left touch strip', 'touch']);
});
test('registerZeilen: one device, and the text filter over device, control, target and kind', () => {
  assert.deepEqual(registerZeilen(daten, '', { besitzer: 's8', namen: NAMEN }).map((r) => r.ziel), ['deck/1/pfl', 'deck/1/scrub']);
  assert.deepEqual(registerZeilen(daten, 'deck/1/fader', { namen: NAMEN }).map((r) => r.ziel), ['deck/1/fader']);
  assert.deepEqual(registerZeilen(daten, 'TOUCH', { namen: NAMEN }).map((r) => r.ziel), ['deck/1/scrub']);
  assert.deepEqual(registerZeilen(daten, 'launch', { namen: NAMEN }).map((r) => r.ziel), ['deck/2/filter']);
  assert.deepEqual(registerZeilen(daten, 'filter', { besitzer: 's8', namen: NAMEN }), []);
  assert.deepEqual(registerZeilen({}, ''), []);
});

function el(tag) {
  const e = { tag, kinder: [], klassen: new Set(), attr: {}, dataset: {}, ev: {}, textContent: '', value: '',
    classList: { add: (c) => e.klassen.add(c), toggle: (c, an) => { if (an) e.klassen.add(c); else e.klassen.delete(c); } },
    append(...k) { e.kinder.push(...k); }, replaceChildren(...k) { e.kinder = k; }, setAttribute(n, v) { e.attr[n] = String(v); },
    addEventListener(n, f) { (e.ev[n] ??= []).push(f); },
    alle(aus = []) { aus.push(e); for (const k of e.kinder) k.alle?.(aus); return aus; } };
  return e;
}
test('baueLernen: LEARN posts the typed target, CANCEL posts null while armed, the status names the controllers', () => {
  const dok = globalThis.document; globalThis.document = { createElement: el };
  try {
    const gesendet = [];
    const opt = { wert: '', ziele: async () => [], schicken: (p, d) => gesendet.push([p, d]) };
    const wurzel = el('div');
    baueLernen(wurzel, { zuordnungen: [], wartet: null, controller: [{ platz: 1, name: 'LPD8' }, { platz: 2, name: 'LC3 1' }] }, opt);
    const alle = wurzel.alle();
    alle.find((x) => x.klassen.has('reg-ziel')).value = ' deck/1/filter ';
    const knopf = alle.find((x) => x.klassen.has('reg-learn'));
    assert.equal(knopf.textContent, 'LEARN');
    knopf.ev.click[0]();
    assert.deepEqual(gesendet, [['/lernen', { pfad: 'deck/1/filter' }]]);
    assert.equal(alle.find((x) => x.klassen.has('reg-status')).textContent, 'then move a knob on LPD8 or LC3 1');
    baueLernen(wurzel, { zuordnungen: [], wartet: { pfad: 'deck/1/filter' }, controller: [] }, opt);
    const k2 = wurzel.alle().find((x) => x.klassen.has('reg-learn'));
    assert.equal(k2.textContent, 'CANCEL');
    k2.ev.click[0]();
    assert.deepEqual(gesendet[1], ['/lernen', { pfad: null }]);
  } finally { globalThis.document = dok; }
});
test('baueRegister: one table row per assignment with its target as data-ziel, DELETE only on learned rows, damaged files named, an empty text without rows', () => {
  const dok = globalThis.document; globalThis.document = { createElement: el };
  try {
    const wurzel = el('div'), geloescht = [];
    baueRegister(wurzel, registerZeilen(daten, '', { namen: NAMEN }), { fehler: daten.geraete.filter((g) => g.fehler), loesche: (p) => geloescht.push(p) });
    const alle = wurzel.alle();
    const zeilen = alle.filter((x) => x.tag === 'tr' && x.klassen.has('reg-zeile'));
    assert.deepEqual(zeilen.map((x) => x.attr['data-ziel']), ['deck/2/filter', 'deck/1/fader', 'deck/1/pfl', 'deck/1/scrub']);
    const weg = alle.filter((x) => x.tag === 'button' && x.textContent === 'DELETE');
    assert.equal(weg.length, 1);
    weg[0].ev.click[0]();
    assert.deepEqual(geloescht, ['deck/2/filter']);
    assert.deepEqual(alle.filter((x) => x.klassen.has('reg-fehler')).map((x) => x.textContent), ['kaputt.json: does not parse']);
    baueRegister(wurzel, [], { leer: 'Nothing matches the filter' });
    assert.deepEqual(wurzel.alle().filter((x) => x.klassen.has('reg-leer')).map((x) => x.textContent), ['Nothing matches the filter']);
  } finally { globalThis.document = dok; }
});
test('baueGeraete: a click picks the device (All devices picks none), the picked one is marked, ADD and REMOVE post without picking', () => {
  const dok = globalThis.document; globalThis.document = { createElement: el };
  try {
    const wurzel = el('div'), gewaehlt = [], gesendet = [];
    const zeilen = [
      { art: 'platz', schluessel: 'platz:2', platz: 2, name: 'Novation Launch Control 3', da: true, zustand: 'connected', weg: 'learn input 2', anzahl: '1 learned', hinweis: '', entfernen: true, wechsel: null },
      { art: 'frei', schluessel: null, platz: null, name: 'Keystation 49', da: true, zustand: 'connected, no place yet', weg: 'learn input', anzahl: '', hinweis: '', port: 'a:b' },
      { art: 'katalog', schluessel: 's8', platz: null, name: 'Traktor Kontrol S8', da: false, zustand: 'not connected', weg: 'desk bridge', anzahl: '49 assigned', hinweis: '' },
    ];
    baueGeraete(wurzel, zeilen, { auswahl: 's8', waehle: (s) => gewaehlt.push(s), schicken: (d) => gesendet.push(d) });
    const reihen = wurzel.alle().filter((x) => x.klassen.has('reg-geraet'));
    assert.deepEqual(reihen.map((x) => x.klassen.has('an')), [false, false, false, true]);
    reihen[0].ev.click[0](); reihen[1].ev.click[0]();
    assert.deepEqual(gewaehlt, [null, 'platz:2']);
    assert.equal(reihen[2].ev.click, undefined, 'a device without a place has nothing to show');
    const knoepfe = wurzel.alle().filter((x) => x.tag === 'button');
    assert.deepEqual(knoepfe.map((x) => x.textContent), ['REMOVE', 'ADD']);
    knoepfe[0].ev.click[0](); knoepfe[1].ev.click[0]();
    assert.deepEqual(gesendet, [{ platz: 2, port: null }, { port: 'a:b' }]);
    assert.deepEqual([...namenVon(zeilen)], [['platz:2', 'Novation Launch Control 3'], ['s8', 'Traktor Kontrol S8']]);
  } finally { globalThis.document = dok; }
});

test('geraeteZeilen: places first, a detected controller without a place gets ADD, known devices are listed plugged in or not, DAW ports and desk devices are not offered', async () => {
  const { geraeteZeilen } = await import('../public/register_view.js');
  const register = { katalog: [
    { id: 'apc20', name: 'Akai APC20', weg: 'pult', midi: 'APC20', da: true, eintraege: 29, rueckweg: 'LEDs', hinweis: '' },
    { id: 's8', name: 'Traktor Kontrol S8', weg: 'pult', midi: null, da: false, eintraege: 49, rueckweg: 'LEDs, two screens', hinweis: '' },
    { id: 'lpd8', name: 'Akai LPD8', weg: 'lernen', midi: 'LPD8', da: true, eintraege: 0, rueckweg: 'none', hinweis: '' },
    { id: 'lc3', name: 'Novation Launch Control 3', weg: 'lernen', midi: 'LC3', da: true, eintraege: 0, rueckweg: 'encoder LEDs, display', rueckweg_port: 'DAW', hinweis: '' },
  ] };
  const geraete = { controller: [{ platz: 1, port: 'Midi-Bridge:LPD8: MIDI 1 (capture)', name: 'LPD8', da: true, verbunden: true }],
    quellen: { midi: [
      { port: 'Midi-Bridge:LPD8: MIDI 1 (capture)', alias: 'LPD8:MIDI 1' }, { port: 'Midi-Bridge:Akai APC20: MIDI 1 (capture)', alias: '' },
      { port: 'Midi-Bridge:LC3 1: DAW In (capture)', alias: '' }, { port: 'Midi-Bridge:LC3 1: MIDI In (capture)', alias: '' },
      { port: 'Midi-Bridge:Midi Through: Port-0 (capture)', alias: '' }, { port: 'Midi-Bridge:Keystation: MIDI 1 (capture)', alias: 'Keystation 49:MIDI 1' },
    ] } };
  const lern = { zuordnungen: [{ pfad: 'fx/3/bk/4', kanal: 1, nr: 2, platz: 1 }, { pfad: 'fx/3/bk/5', kanal: 1, nr: 3, platz: 1 }] };
  const z = geraeteZeilen(register, geraete, lern, 2);
  assert.deepEqual(z.map((x) => [x.art, x.name, x.zustand]), [
    ['platz', 'Akai LPD8', 'connected'],
    ['frei', 'Novation Launch Control 3', 'connected, no place yet'],
    ['frei', 'Keystation 49', 'connected, no place yet'],
    ['katalog', 'Akai APC20', 'connected'],
    ['katalog', 'Traktor Kontrol S8', 'not connected'],
    ['tablet', 'Tablet', '2 paired'],
  ]);
  assert.equal(z[0].anzahl, '2 learned');
  assert.equal(z[0].entfernen, false, 'place 1 is the MIDI input of the Devices page');
  assert.equal(z[1].port, 'Midi-Bridge:LC3 1: MIDI In (capture)');
  assert.equal(z[3].anzahl, '29 assigned');
  assert.deepEqual([z[0].schluessel, z[1].schluessel, z[3].schluessel, z[5].schluessel], ['platz:1', null, 'apc20', null]);
  const nach = geraeteZeilen(register, { ...geraete, controller: [...geraete.controller, { platz: 2, port: 'Midi-Bridge:LC3 1: MIDI In (capture)', name: 'LC3 1', da: true, verbunden: null }] }, lern, null);
  assert.deepEqual(nach.slice(0, 2).map((x) => [x.platz, x.name, x.entfernen, x.weg]), [[1, 'Akai LPD8', false, 'learn input 1'], [2, 'Novation Launch Control 3', true, 'learn input 2']]);
  assert.ok(!nach.some((x) => x.art === 'tablet'), 'unknown pairing state: no tablet row');
  assert.deepEqual([nach[1].wechsel.text, nach[1].wechsel.port], ['LEDS + DISPLAY', 'Midi-Bridge:LC3 1: DAW In (capture)'], 'the place can move to the feedback port');
  assert.equal(nach[0].wechsel, null);
});

test('U6 SICHTEN has no studio entry: the views are DJ, LIVE and PRODUCTION; a stream outside the alias streams is in no view', async () => {
  const { SICHTEN, modulVon } = await import('../public/register_view.js');
  assert.deepEqual(SICHTEN.map((x) => x.id), ['dj', 'live', 'production']);
  assert.ok(!SICHTEN.some((x) => x.module.some((m) => /^erz\/(5|6|7)$/.test(m) && x.id !== 'live')), 'the instrument streams belong to the live view only');
  assert.equal(modulVon('erz/5/fader').name, 'Stream 5', 'no I5..I7 instrument names');
});

test('U6 the module list of a container view names the container letter; the DJ view shows all four, the LIVE view the loop containers C and D', async () => {
  const { modulVon, SICHTEN } = await import('../public/register_view.js');
  assert.deepEqual(['deck/1', 'deck/2', 'pad/1', 'pad/2'].map((p) => modulVon(`${p}/fader`).name), ['Container A', 'Container B', 'Container C', 'Container D']);
  assert.deepEqual(['deck/1', 'deck/2', 'pad/1', 'pad/2'].map((p) => modulVon(`${p}/fader`).id), ['deck/1', 'deck/2', 'pad/1', 'pad/2']);
  for (const c of ['deck/1', 'deck/2', 'pad/1', 'pad/2']) assert.ok(SICHTEN.find((x) => x.id === 'dj').module.includes(c), `dj shows ${c}`);
  for (const c of ['pad/1', 'pad/2']) assert.ok(SICHTEN.find((x) => x.id === 'live').module.includes(c), `live shows ${c}`);
  assert.ok(!SICHTEN.find((x) => x.id === 'live').module.includes('deck/1'), 'live keeps showing no player container');
});

test('modules and views: a target belongs to a module by its path; a picked module or view keeps only its assignments', async () => {
  const { modulVon } = await import('../public/register_view.js');
  assert.deepEqual(['deck/2/eq/tief', 'pad/1/fader', 'erz/1/fader', 'erz/6/bk/3', 'fx/3/bk/4', 'xfader', 'spur/4/fader'].map((p) => modulVon(p).name),
    ['Container B', 'Container C', 'Drums', 'Stream 6', 'FX3 Remix', 'Crossfader', 'Track 4']);
  assert.deepEqual(registerZeilen(daten, '', { modul: 'deck/2' }).map((r) => r.ziel), ['deck/2/filter']);
  assert.deepEqual(registerZeilen(daten, '', { sicht: 'dj' }).length, 4);
  assert.deepEqual(registerZeilen(daten, '', { sicht: 'production' }), []);
  assert.deepEqual(registerZeilen(daten, 'container a').map((r) => r.ziel), ['deck/1/fader', 'deck/1/pfl', 'deck/1/scrub'], 'the text filter knows the module name');
});

// ---- the device layouts, the module view and "free only" ----
const LC3 = [
  ...Array.from({ length: 16 }, (_, i) => ({ name: `Enc ${i + 1}`, typ: 'cc', kanal: 16, nr: 13 + i, art: 'knob', zeile: i < 8 ? 1 : 2, spalte: (i % 8) + 1 })),
  ...Array.from({ length: 8 }, (_, i) => ({ name: `Btn ${i + 1}`, typ: 'cc', kanal: 16, nr: 37 + i, kanal_daw: 1, art: 'button', zeile: 3, spalte: i + 1 })),
];
const LPD8 = [
  { name: 'K1', typ: 'cc', kanal: 1, nr: 1, art: 'knob', zeile: 1, spalte: 1 }, { name: 'K2', typ: 'cc', kanal: 1, nr: 2, art: 'knob', zeile: 1, spalte: 2 },
  { name: 'Pad 1', typ: 'note', kanal: 10, nr: 36, art: 'pad', zeile: 2, spalte: 1 },
];
const LERN = [
  { pfad: 'deck/2/filter', kanal: 16, nr: 13, platz: 2, name: 'deck/2/filter' },
  { pfad: 'erz/6/bk/3', kanal: 16, nr: 14, platz: 2, name: 'erz/6 Cutoff' },
  { pfad: 'deck/1/trim', kanal: 1, nr: 40, platz: 2, name: 'deck/1/trim' },       // a button of the DAW port (channel 1)
  { pfad: 'master/pegel', kanal: 3, nr: 99, platz: 2, name: 'master/pegel' },     // a CC the layout does not have
  { pfad: 'fx/3/bk/4', kanal: 1, nr: 2, platz: 1, name: 'fx/3 Sub 1' },
];
const ZIELE = [
  { pfad: 'deck/1/fader' }, { pfad: 'deck/1/filter' }, { pfad: 'deck/1/trim' }, { pfad: 'deck/2/filter' }, { pfad: 'deck/2/fader' },
  { pfad: 'fx/3/bk/4', name: 'Sub 1' }, { pfad: 'fx/3/bk/5' }, { pfad: 'xfader' }, { pfad: 'master/pegel' }, { pfad: 'erz/6/bk/3', name: 'Cutoff' },
];

test('kacheln: a tile per control of the layout, its target from the learn table of THAT place, a CC outside the layout becomes an extra tile', () => {
  const k = kacheln(LC3, LERN, { platz: 2, namen: new Map([['erz/6/bk/3', 'Cutoff']]) });
  assert.equal(k.length, 25, '24 controls and one extra');
  const enc1 = k.find((x) => x.name === 'Enc 1'), enc2 = k.find((x) => x.name === 'Enc 2'), enc3 = k.find((x) => x.name === 'Enc 3');
  assert.deepEqual([enc1.ziel, enc1.label, enc1.modul, enc1.zuweisbar], ['deck/2/filter', 'Filter', 'Container B', true]);
  assert.deepEqual([enc2.ziel, enc2.label, enc2.modul], ['erz/6/bk/3', 'Cutoff', 'Stream 6'], 'the graph knob name');
  assert.deepEqual([enc3.ziel, enc3.label], [null, ''], 'free');
  assert.deepEqual([enc1.zeile, enc1.spalte, k.find((x) => x.name === 'Enc 9').zeile, k.find((x) => x.name === 'Enc 9').spalte], [1, 1, 2, 1]);
  const btn4 = k.find((x) => x.name === 'Btn 4');
  assert.deepEqual([btn4.ziel, btn4.kanal], ['deck/1/trim', 1], 'a button learned on the DAW channel is found, with the channel it sends');
  const extra = k.filter((x) => x.extra);
  assert.deepEqual(extra.map((x) => [x.name, x.ziel, x.zeile, x.spalte]), [['CC 99 · ch 3', 'master/pegel', 4, 1]], 'after the layout, in a row of its own');
  assert.equal(k.some((x) => x.ziel === 'fx/3/bk/4'), false, 'the learn table of place 1 is another device');
  assert.deepEqual(kachelZaehler(k), { frei: 21, gesamt: 25 }, '24 + 1 extra assignable, four assigned');
});
test('kacheln: the channel an assignment sends follows the port of the place; a pad is a tile like a knob and counts', () => {
  const frei = (daw) => kacheln(LC3, [], { platz: 2, daw }).find((x) => x.name === 'Btn 1');
  assert.deepEqual([frei(false).kanal, frei(true).kanal], [16, 1]);
  assert.equal(kacheln(LC3, [], { platz: 2, daw: true }).find((x) => x.name === 'Enc 1').kanal, 16, 'encoders keep their channel');
  const l = kacheln(LPD8, [{ pfad: 'fx/3/bk/4', kanal: 1, nr: 2, platz: 1 }], { platz: 1 });
  assert.deepEqual(l.map((x) => [x.name, x.ziel, x.zuweisbar]), [['K1', null, true], ['K2', 'fx/3/bk/4', true], ['Pad 1', null, true]]);
  assert.deepEqual(kachelZaehler(l), { frei: 2, gesamt: 3 }, 'the pad is counted');
});
test('kachelSicht: free only keeps the free assignable controls; a view hides the assigned tiles of other modules; the text finds control, module and target', () => {
  const k = kacheln(LC3, LERN, { platz: 2 });
  const frei = kachelSicht(k, { nurFrei: true });
  assert.equal(frei.length, 21);
  assert.ok(frei.every((x) => !x.ziel));
  const dj = kachelSicht(k, { sicht: 'dj' }).filter((x) => x.ziel).map((x) => x.ziel);
  assert.deepEqual(dj.sort(), ['deck/1/trim', 'deck/2/filter', 'master/pegel'], 'erz/6 is not in the DJ view');
  assert.equal(kachelSicht(k, { sicht: 'dj' }).filter((x) => !x.ziel).length, 21, 'free tiles stay');
  assert.deepEqual(kachelSicht(k, { filter: 'container b' }).map((x) => x.name), ['Enc 1']);
  assert.deepEqual(kachelSicht(k, { filter: 'btn 4' }).map((x) => x.name), ['Btn 4']);
  assert.deepEqual(kachelSicht(k, { filter: 'CC 14' }).map((x) => x.name), ['Enc 2']);
});

const DATEN = {
  geraete: [{ id: 'lernen', rolle: 'lernen' }, { id: 'lernen-2', rolle: 'lernen' }, { id: 'pult', rolle: 'basis' }],
  kanten: [
    { geraet: 'lernen', besitzer: 'platz:1', quelle: { typ: 'cc', kanal: 1, nr: 2 }, ziel: 'fx/3/bk/4', art: 'absolut' },
    { geraet: 'lernen-2', besitzer: 'platz:2', quelle: { typ: 'cc', kanal: 16, nr: 13 }, ziel: 'deck/2/filter', art: 'absolut' },
    { geraet: 'pult', besitzer: 'apc20', quelle: { typ: 'cc', kanal: 1, nr: 7 }, ziel: 'deck/1/fader', art: 'absolut' },
    { geraet: 'pult', besitzer: 's8', quelle: { typ: 'note', kanal: 13, nr: 10 }, ziel: 'deck/1/pfl', art: 'taste' },
  ],
};
test('zielZeilen: every learnable target of a module, free or with its owner; an assigned target outside the list (a switch) is listed too', () => {
  const NA = new Map([['platz:1', 'Akai LPD8'], ['platz:2', 'Novation Launch Control 3'], ['apc20', 'Akai APC20'], ['s8', 'Traktor Kontrol S8']]);
  const z = zielZeilen(ZIELE, DATEN, { modul: 'deck/1', namen: NA });
  assert.deepEqual(z.map((x) => [x.pfad, x.frei, x.geraet, x.quelle]), [
    ['deck/1/fader', false, 'Akai APC20', 'CC 7 · ch 1'], ['deck/1/filter', true, '', ''], ['deck/1/trim', true, '', ''], ['deck/1/pfl', false, 'Traktor Kontrol S8', 'Note 10 · ch 13']]);
  assert.deepEqual(z.map((x) => x.label), ['Fader', 'Filter', 'Trim', 'PFL']);
  assert.deepEqual(zielZeilen(ZIELE, DATEN, { modul: 'deck/1', nurFrei: true }).map((x) => x.pfad), ['deck/1/filter', 'deck/1/trim'], 'free only');
  assert.deepEqual(z.map((x) => x.lernbar), [true, true, true, false], 'the switch is listed but not learnable');
  assert.deepEqual(zielZeilen(ZIELE, DATEN, { modul: 'fx/3', namen: NA }).map((x) => [x.pfad, x.label, x.frei, x.geraet]), [['fx/3/bk/4', 'Sub 1', false, 'Akai LPD8'], ['fx/3/bk/5', 'Knob 5', true, '']]);
  assert.deepEqual(zielZeilen(ZIELE, DATEN, { filter: 'launch', namen: NA }).map((x) => x.pfad), ['deck/2/filter'], 'the text filter knows the owner');
  assert.deepEqual(zielZeilen(ZIELE, DATEN, { filter: 'sub 1' }).map((x) => x.pfad), ['fx/3/bk/4'], 'and the knob name');
  assert.deepEqual(zielZeilen(ZIELE, DATEN, { sicht: 'production' }).map((x) => x.pfad), ['master/pegel'], 'a view keeps its modules');
  assert.deepEqual(zielZeilen([], {}, {}), []);
});
test('modulZaehler: one chip per module with how many targets are free; free only drops full modules; the view limits the modules', () => {
  const m = modulZaehler(ZIELE, DATEN, {});
  assert.deepEqual(m.map((x) => [x.id, x.anzahl]), [['deck/1', '2 of 3 free'], ['deck/2', '1 of 2 free'], ['erz/6', '1 of 1 free'], ['fx/3', '1 of 2 free'], ['xfader', '1 of 1 free'], ['master', '1 of 1 free']]);
  assert.deepEqual(modulZaehler(ZIELE, DATEN, { nurFrei: true }).map((x) => x.id), ['deck/1', 'deck/2', 'erz/6', 'fx/3', 'xfader', 'master']);
  assert.equal(modulZaehler([], DATEN, {}).find((x) => x.id === 'deck/1').anzahl, '2 assigned', 'only assigned switches and no learnable target');
  const alles = [{ pfad: 'deck/2/filter' }];
  assert.deepEqual(modulZaehler(alles, DATEN, { nurFrei: true }).map((x) => x.id), [], 'every target of deck/2 is assigned');
  assert.deepEqual(modulZaehler(ZIELE, DATEN, { sicht: 'live' }).map((x) => x.id), ['erz/6', 'fx/3', 'master']);
});
test('zielLabel: a knob name wins, a graph knob without one is "Knob n", other targets are put into words', () => {
  assert.deepEqual(['deck/1/eq/tief', 'deck/1/komp/schwelle', 'deck/1/send/2', 'fx/1/rueckkopplung', 'master/pegel', 'xfader', 'erz/5/bk/12', 'spur/3/fader'].map((p) => zielLabel(p)),
    ['EQ low', 'Comp threshold', 'Send 2', 'Feedback', 'Level', 'Crossfader', 'Knob 12', 'Fader']);
  assert.equal(zielLabel('erz/5/bk/12', 'Cutoff'), 'Cutoff');
});
test('geraeteZeilen: a place with a layout shows how many of its controls are free, the DAW port is noted', () => {
  const register = { katalog: [{ id: 'lc3', name: 'Novation Launch Control 3', weg: 'lernen', midi: 'LC3', da: true, rueckweg: '', rueckweg_port: 'DAW', hinweis: '', regler: LC3 },
    { id: 'lpd8', name: 'Akai LPD8', weg: 'lernen', midi: 'LPD8', da: true, rueckweg: '', hinweis: '' }] };
  const geraete = { controller: [{ platz: 1, port: 'Midi-Bridge:LPD8: MIDI 1 (capture)', name: 'LPD8', da: true, verbunden: true }, { platz: 2, port: 'Midi-Bridge:LC3 1: DAW In (capture)', name: 'LC3 1', da: true, verbunden: true }], quellen: { midi: [] } };
  const z = geraeteZeilen(register, geraete, { zuordnungen: LERN });
  assert.deepEqual([z[0].anzahl, z[0].regler], ['1 learned', null], 'a device without a layout counts what it learned');
  assert.deepEqual([z[1].anzahl, z[1].daw, z[1].regler.length], ['21 of 25 free', true, 24]);
});

test('baueKacheln: one tile per control at its place, free or with target; assigned tiles have CHANGE and REMOVE, a free tile (knob or pad) opens the picker', () => {
  const dok = globalThis.document; globalThis.document = { createElement: el };
  try {
    const wurzel = el('div'), ereignisse = [];
    const ks = kacheln([...LPD8, { name: 'K3', typ: 'cc', kanal: 1, nr: 3, art: 'knob', zeile: 1, spalte: 3 }], [{ pfad: 'fx/3/bk/4', kanal: 1, nr: 2, platz: 1 }], { platz: 1, namen: new Map([['fx/3/bk/4', 'Sub 1']]) });
    baueKacheln(wurzel, ks, { geraet: 'Akai LPD8', oeffne: (k) => ereignisse.push(['oeffne', k.name]), entferne: (k) => ereignisse.push(['entferne', k.ziel]) });
    const t = wurzel.alle().filter((x) => x.klassen.has('reg-kachel'));
    assert.deepEqual(t.map((x) => x.attr['data-kachel']), ['cc:1', 'cc:2', 'note:36', 'cc:3']);
    assert.deepEqual(t.map((x) => [x.klassen.has('frei'), x.klassen.has('belegt'), x.klassen.has('aus')]), [[true, false, false], [false, true, false], [true, false, false], [true, false, false]]);
    assert.equal(t[1].attr['data-ziel'], 'fx/3/bk/4');
    assert.equal(t[1].attr['data-info'], 'Akai LPD8 · K2 → FX3 Remix · fx/3/bk/4');
    const texte = (x) => x.alle().filter((y) => y.klassen.has('reg-kachel-ziel')).map((y) => y.textContent);
    assert.deepEqual(t.map(texte), [['free'], ['FX3 Remix · Sub 1'], ['free'], ['free']]);
    assert.deepEqual(t[1].alle().filter((y) => y.tag === 'button').map((y) => y.textContent), ['CHANGE', 'REMOVE']);
    t[0].ev.click[0](); t[2].ev.click[0]();
    t[1].alle().filter((y) => y.textContent === 'REMOVE')[0].ev.click[0]({ stopPropagation() {} });
    assert.deepEqual(ereignisse, [['oeffne', 'K1'], ['oeffne', 'Pad 1'], ['entferne', 'fx/3/bk/4']], 'a pad opens the picker like a knob; REMOVE does not open it');
  } finally { globalThis.document = dok; }
});
test('baueKacheln: the picker of the open tile sits in the grid; baueWaehler lists the targets, a click assigns, the search refills only the list', () => {
  const dok = globalThis.document; globalThis.document = { createElement: el };
  try {
    const wurzel = el('div'), gewaehlt = [], suchen = [];
    const ks = kacheln(LPD8, [], { platz: 1 });
    let panel = null;
    baueKacheln(wurzel, ks, { offen: ks[0], fuelle: (p, k) => { panel = p; baueWaehler(p, k, {
      module: modulZaehler(ZIELE, DATEN, {}), modul: 'deck/1', suche: '', beiSuche: (t) => suchen.push(t),
      ziele: (text) => zielZeilen(ZIELE, DATEN, { modul: text ? undefined : 'deck/1', filter: text }),
      waehleModul: (id) => gewaehlt.push(['modul', id]), setze: (z) => gewaehlt.push(['setze', z.pfad]), schliesse: () => gewaehlt.push(['zu']) }); } });
    assert.ok(wurzel.alle().some((x) => x.klassen.has('reg-waehler')), 'the panel is a child of the grid');
    const knoepfe = () => panel.alle().filter((x) => x.klassen.has('reg-wahlziel'));
    assert.deepEqual(knoepfe().map((x) => x.alle().filter((y) => y.klassen.has('reg-wahlziel-name'))[0].textContent), ['Filter', 'Trim', 'Fader'], 'free targets first, then the assigned ones; PFL is not among the assignable targets here and is not offered');
    assert.deepEqual(knoepfe().map((x) => x.klassen.has('belegt')), [false, false, true]);
    knoepfe()[1].ev.click[0]();
    const chip = panel.alle().find((x) => x.tag === 'button' && x.textContent.startsWith('Container B'));
    chip.ev.click[0]();
    panel.alle().find((x) => x.textContent === 'CLOSE').ev.click[0]({ stopPropagation() {} });
    assert.deepEqual(gewaehlt, [['setze', 'deck/1/trim'], ['modul', 'deck/2'], ['zu']]);
    const suche = panel.alle().find((x) => x.klassen.has('reg-waehler-suche'));
    suche.value = 'cutoff';
    suche.ev.input[0]();
    assert.deepEqual(suchen, ['cutoff']);
    assert.deepEqual(knoepfe().map((x) => x.alle().filter((y) => y.klassen.has('reg-wahlziel-name'))[0].textContent), ['Cutoff'], 'with a module picked the search stays in it');
    baueWaehler(panel, ks[0], { module: [], modul: null, suche: 'cutoff', ziele: (t) => zielZeilen(ZIELE, DATEN, { filter: t }) });
    assert.deepEqual(knoepfe().map((x) => x.alle().filter((y) => y.klassen.has('reg-wahlziel-name'))[0].textContent), ['Stream 6 · Cutoff'], 'without a module it spans all modules, with the module name');
    baueWaehler(panel, ks[0], { module: [], modul: null, ziele: () => [] });
    assert.deepEqual(panel.alle().filter((x) => x.klassen.has('reg-leer')).map((x) => x.textContent), ['Pick a module above, or type to search every module']);
  } finally { globalThis.document = dok; }
});
test('baueZiele: assigned rows name device and control, free rows have LEARN (armed: "move a knob…"), ASSIGN opens the menu of the free controls of the picked device', () => {
  const dok = globalThis.document; globalThis.document = { createElement: el };
  try {
    const wurzel = el('div'), got = [];
    const zeilen = zielZeilen(ZIELE, DATEN, { modul: 'deck/1', namen: new Map([['apc20', 'Akai APC20']]) });
    const opt = { wartet: null, freie: [{ name: 'K3', typ: 'cc', kanal: 1, nr: 3 }], geraet: 'Akai LPD8', menue: null,
      lerne: (p) => got.push(['lerne', p]), oeffneMenue: (p) => got.push(['menue', p]), zuweisen: (p, k) => got.push(['zuweisen', p, k.name]), loesche: (p) => got.push(['loesche', p]) };
    baueZiele(wurzel, zeilen, opt);
    const rz = () => wurzel.alle().filter((x) => x.tag === 'tr' && x.klassen.has('reg-zeile'));
    assert.deepEqual(rz().map((x) => x.attr['data-ziel']), ['deck/1/fader', 'deck/1/filter', 'deck/1/trim', 'deck/1/pfl']);
    assert.deepEqual(rz().map((x) => x.klassen.has('reg-frei')), [false, true, true, false]);
    const knoepfe = (x) => x.alle().filter((y) => y.tag === 'button').map((y) => y.textContent);
    assert.deepEqual(rz().map(knoepfe), [[], ['LEARN', 'ASSIGN'], ['LEARN', 'ASSIGN'], []], 'a desk assignment is not deletable here');
    assert.ok(rz()[0].alle().some((x) => x.textContent === 'Akai APC20 · CC 7 · ch 1'));
    rz()[1].alle().find((x) => x.textContent === 'LEARN').ev.click[0]({ stopPropagation() {} });
    rz()[1].alle().find((x) => x.textContent === 'ASSIGN').ev.click[0]({ stopPropagation() {} });
    baueZiele(wurzel, zeilen, { ...opt, wartet: 'deck/1/filter', menue: 'deck/1/trim' });
    assert.deepEqual(rz().map(knoepfe)[1], ['move a knob…', 'ASSIGN']);
    assert.equal(rz()[1].alle().find((x) => x.textContent === 'move a knob…').klassen.has('an'), true);
    const menue = wurzel.alle().find((x) => x.klassen.has('reg-menue'));
    menue.alle().find((x) => x.textContent === 'K3').ev.click[0]({ stopPropagation() {} });
    assert.deepEqual(got, [['lerne', 'deck/1/filter'], ['menue', 'deck/1/filter'], ['zuweisen', 'deck/1/trim', 'K3']]);
    baueZiele(wurzel, zeilen, { ...opt, freie: [] });
    assert.deepEqual(rz().map(knoepfe)[1], ['LEARN'], 'without a device with free controls there is no ASSIGN');
    baueZiele(wurzel, [], { leer: 'Every target of this module is assigned' });
    assert.deepEqual(wurzel.alle().filter((x) => x.klassen.has('reg-leer')).map((x) => x.textContent), ['Every target of this module is assigned']);
  } finally { globalThis.document = dok; }
});
test('baueWahl: the module chips carry "<free> of <all> free"; the picked chip is marked, a second click releases it', () => {
  const dok = globalThis.document; globalThis.document = { createElement: el };
  try {
    const wurzel = el('div'), w = [];
    baueWahl(wurzel, modulZaehler(ZIELE, DATEN, {}), { sicht: 'dj', modul: 'deck/2', waehle: (x) => w.push(x) });
    const chips = wurzel.alle().filter((x) => x.tag === 'button').map((x) => x.textContent);
    assert.ok(chips.includes('Container A · 2 of 3 free') && chips.includes('DJ'));
    const b = wurzel.alle().find((x) => x.textContent === 'Container B · 1 of 2 free');
    assert.equal(b.klassen.has('an'), true);
    b.ev.click[0]();
    wurzel.alle().find((x) => x.textContent === 'Container A · 2 of 3 free').ev.click[0]();
    wurzel.alle().find((x) => x.textContent === 'DJ').ev.click[0]();
    assert.deepEqual(w, [{ modul: null }, { modul: 'deck/1' }, { sicht: null }]);
  } finally { globalThis.document = dok; }
});

test('unnamed graph knobs: a free knob no graph names is left out on request, an assigned or named one stays, a search still finds it, the chips do not count it', () => {
  const z = (o) => zielZeilen(ZIELE, DATEN, { modul: 'fx/3', namen: new Map(), ...o }).map((x) => x.pfad);
  assert.deepEqual(z({}), ['fx/3/bk/4', 'fx/3/bk/5']);
  assert.deepEqual(z({ namenlose: false }), ['fx/3/bk/4'], 'bk/5 is free and has no name');
  assert.deepEqual(z({ namenlose: false, filter: 'knob 5' }), ['fx/3/bk/5'], 'a search reaches it');
  const chip = (o) => modulZaehler(ZIELE, DATEN, o).find((x) => x.id === 'fx/3').anzahl;
  assert.deepEqual([chip({}), chip({ namenlose: false })], ['1 of 2 free', '0 of 1 free']);
});

test('falteModule: more than four chips of a family become one chip with the sums; an opened family or the family of the picked module stays unfolded', () => {
  const c = (id, frei, gesamt) => ({ id, name: id, frei, gesamt, anzahl: `${frei} of ${gesamt} free` });
  const chips = [c('deck/1', 2, 3), ...[1, 2, 3, 4, 5, 6].map((n) => c(`spur/${n}`, n === 2 ? 5 : 6, 6)), c('grp/1', 6, 6), c('grp/2', 6, 6), c('master', 1, 2)];
  assert.deepEqual(falteModule(chips).map((x) => [x.id, x.name, x.anzahl]),
    [['deck/1', 'deck/1', '2 of 3 free'], ['familie:spur', 'Tracks 1–6', '35 of 36 free'], ['grp/1', 'grp/1', '6 of 6 free'], ['grp/2', 'grp/2', '6 of 6 free'], ['master', 'master', '1 of 2 free']]);
  const auf = falteModule(chips, new Set(['spur'])).map((x) => x.id);
  assert.deepEqual(auf.slice(1, 4), ['familie:spur', 'spur/1', 'spur/2']);
  assert.equal(falteModule(chips, new Set(['spur'])).find((x) => x.id === 'familie:spur').name, 'Tracks ▾');
  assert.equal(falteModule(chips, new Set(), 'spur/4').some((x) => x.id === 'spur/4'), true, 'the picked module is never folded away');
});

test('banks: a device with banks shows one bank on its channel, a CC learned in another bank is its own tile there and no extra tile here, the device row counts all banks', () => {
  const regler = [{ name: 'Pad 1', typ: 'note', kanal: 1, nr: 36, art: 'pad', zeile: 1, spalte: 1 }, { name: 'K1', typ: 'cc', kanal: 1, nr: 1, art: 'knob', zeile: 1, spalte: 2 }, { name: 'K2', typ: 'cc', kanal: 1, nr: 2, art: 'knob', zeile: 1, spalte: 3 }];
  const baenke = [{ name: 'Program 1', kanal: 1, noten: [36] }, { name: 'Program 2', kanal: 2, noten: [35] }];
  const lern = [{ pfad: 'deck/1/filter', kanal: 2, nr: 1, platz: 1 }, { pfad: 'deck/2/filter', kanal: 9, nr: 50, platz: 1 }];
  const b1 = kacheln(regler, lern, { platz: 1, baenke, bank: 0 }), b2 = kacheln(regler, lern, { platz: 1, baenke, bank: 1 });
  assert.deepEqual(b1.map((k) => [k.name, k.kanal, k.nr, k.ziel]), [['Pad 1', 1, 36, null], ['K1', 1, 1, null], ['K2', 1, 2, null], ['CC 50 · ch 9', 9, 50, 'deck/2/filter']]);
  assert.deepEqual(b2.map((k) => [k.name, k.kanal, k.nr, k.ziel]), [['Pad 1', 2, 35, null], ['K1', 2, 1, 'deck/1/filter'], ['K2', 2, 2, null], ['CC 50 · ch 9', 9, 50, 'deck/2/filter']]);
  const zeilen = geraeteZeilen({ katalog: [{ id: 'lpd8', name: 'Akai LPD8', weg: 'lernen', midi: 'LPD8', regler, baenke, bedienung: 'PROGRAM picks the bank' }], kanten: [] },
    { controller: [{ platz: 1, port: 'Midi-Bridge:LPD8: MIDI 1 (capture)', name: 'LPD8', da: true, verbunden: true }], quellen: { midi: [] } }, { zuordnungen: lern });
  assert.deepEqual([zeilen[0].anzahl, zeilen[0].baenke.length, zeilen[0].bedienung], ['5 of 8 free', 2, 'PROGRAM picks the bank'], 'two banks of a pad and two knobs, each with the extra CC: five of them free');
});

test('baueKacheln: bank chips above the tiles pick a bank, the line about the other controls sits below', () => {
  const dok = globalThis.document; globalThis.document = { createElement: el };
  try {
    const wurzel = el('div'), w = [];
    baueKacheln(wurzel, kacheln(LPD8, [], { platz: 1 }), { baenke: [{ id: 0, name: 'Program 1 (ch 1)', anzahl: '8 of 8 free', frei: 8 }, { id: 1, name: 'Program 2 (ch 2)', anzahl: '7 of 8 free', frei: 7 }], bank: 0, waehleBank: (i) => w.push(i), bedienung: 'PROGRAM picks the bank' });
    const chip = (t) => wurzel.alle().find((x) => x.tag === 'button' && x.textContent === t);
    assert.equal(chip('Program 1 (ch 1) · 8 of 8 free').klassen.has('an'), true);
    chip('Program 2 (ch 2) · 7 of 8 free').ev.click[0]();
    chip('Program 1 (ch 1) · 8 of 8 free').ev.click[0]();
    assert.deepEqual(w, [1], 'a click on the picked bank keeps it');
    assert.ok(wurzel.alle().some((x) => x.textContent === 'PROGRAM picks the bank'));
  } finally { globalThis.document = dok; }
});
