// Controllers window, follow and presets (page side): what the FOLLOW line says, which presets are enabled, the preset bar and the FOLLOW switch over a tiny fake DOM,
// and a page server that does not know the routes yet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tastenAnsicht, baueTasten, folgenAnsicht, praesetAnsicht, speicherAngebot, bauePresets, baueGeraete, geraeteZeilen, holeFolgenStand } from '../public/register_view.js';

const plaetze = (o = {}) => [{ platz: 2, modell: 'lc3', folgen: true, preset: null, ...o }];
const stand = (fokus, p = plaetze()) => ({ fokus, plaetze: p });
const poly = { kanal: 'erz/6', graph: 'synth-poly', basis: 'erz/6/bk/' };
const opt = { kanalName: (k) => ({ 'erz/6': 'I6' })[k] ?? k };

test('folgenAnsicht: without a focus state (server without the routes) the switch is unavailable and says so', () => {
  const a = folgenAnsicht(null, 2, opt);
  assert.deepEqual([a.verfuegbar, a.folgt], [false, false]);
  assert.match(a.text, /not available/i);
  assert.match(a.titel, /page server/i);
});
test('folgenAnsicht: a place the server does not know a model for cannot follow', () => {
  const a = folgenAnsicht(stand(poly, plaetze({ modell: null })), 2, opt);
  assert.equal(a.verfuegbar, false);
  assert.match(a.text, /not available/i);
  assert.equal(folgenAnsicht(stand(poly, []), 2, opt).verfuegbar, false, 'a place that is not listed');
});
test('folgenAnsicht: switched off says nothing', () => {
  const a = folgenAnsicht(stand(poly, plaetze({ folgen: false })), 2, opt);
  assert.deepEqual([a.verfuegbar, a.folgt, a.text], [true, false, '']);
});
test('folgenAnsicht: follows a synth, with the preset that was applied', () => {
  assert.equal(folgenAnsicht(stand(poly, plaetze({ preset: 'werk:lc3/synth-poly' })), 2, opt).text, 'follows synth-poly on I6 · preset synth-poly');
  assert.equal(folgenAnsicht(stand(poly, plaetze({ preset: 'bank' })), 2, opt).text, 'follows synth-poly on I6 · default bank');
  assert.equal(folgenAnsicht(stand(poly), 2, opt).text, 'follows synth-poly on I6', 'nothing applied yet');
  const mitName = folgenAnsicht(stand(poly, plaetze({ preset: 'nutzer:lc3/my-lead' })), 2, { ...opt, presets: [{ id: 'nutzer:lc3/my-lead', name: 'My lead' }] });
  assert.equal(mitName.text, 'follows synth-poly on I6 · preset My lead');
});
test('folgenAnsicht: a project track is named by the page when it can, else by its id', () => {
  const f = { spur_id: 's3', graph: 'synth-poly', basis: 'spur/2/bk/' };
  assert.equal(folgenAnsicht(stand(f), 2, { ...opt, spurName: (id) => (id === 's3' ? 'Lead' : null) }).text, 'follows synth-poly on Lead');
  assert.equal(folgenAnsicht(stand(f), 2, opt).text, 'follows synth-poly on track s3');
});
test('folgenAnsicht: no synth in front, and a focus without a base says why', () => {
  assert.equal(folgenAnsicht(stand(null), 2, opt).text, 'follows: no synth in front');
  const grund = (g, f = { kanal: 'erz/6', graph: null, basis: null, grund: g }) => folgenAnsicht(stand(f), 2, opt).text;
  assert.match(grund('kein_graph'), /^follows: I6 has no graph loaded$/);
  assert.match(grund('kein_bk', { spur_id: 's4', graph: null, basis: null, grund: 'kein_bk' }), /^follows: track s4 is not a Baukasten synth$/);
  assert.match(grund('slot_ohne_zeile', { spur_id: 's9', graph: 'synth-poly', basis: null, grund: 'slot_ohne_zeile' }), /track s9 .*beyond the controller rows/);
  assert.match(grund('etwas_neues'), /^follows: I6 cannot be followed$/, 'an unknown reason still reads');
});

test('speicherAngebot: SAVE FOR <graph> only with a focus that has a base', () => {
  assert.deepEqual(speicherAngebot(stand(poly)), { an: true, graph: 'synth-poly', text: 'SAVE FOR synth-poly', titel: 'Save the assignments that point at synth-poly as its preset for this device' });
  assert.equal(speicherAngebot(stand(null)).an, false);
  assert.equal(speicherAngebot(stand({ kanal: 'erz/6', graph: null, basis: null, grund: 'kein_graph' })).an, false);
  assert.equal(speicherAngebot(null).an, false);
  assert.equal(speicherAngebot(stand(null)).text, 'SAVE FOR SYNTH');
});

const LISTE = [
  { id: 'werk:lc3/synth-poly', name: 'synth-poly', modell: 'lc3', art: 'instrument', graph: 'synth-poly', herkunft: 'werk', eintraege_zahl: 8 },
  { id: 'nutzer:lc3/synth-poly', name: 'synth-poly', modell: 'lc3', art: 'instrument', graph: 'synth-poly', herkunft: 'nutzer', eintraege_zahl: 6 },
  { id: 'werk:lc3/synth-bass', name: 'synth-bass', modell: 'lc3', art: 'instrument', graph: 'synth-bass', herkunft: 'werk', eintraege_zahl: 4 },
  { id: 'nutzer:lc3/dj-filters', name: 'DJ filters', modell: 'lc3', art: 'fest', herkunft: 'nutzer', eintraege_zahl: 5 },
  { id: 'werk:lpd8/synth-poly', name: 'synth-poly', modell: 'lpd8', art: 'instrument', graph: 'synth-poly', herkunft: 'werk', eintraege_zahl: 8 },
];
test('praesetAnsicht: only the presets of the model, factory and user marked, delete only on user presets', () => {
  const z = praesetAnsicht(LISTE, 'lc3', stand(poly), 2);
  assert.deepEqual(z.map((x) => x.id).sort(), ['nutzer:lc3/dj-filters', 'nutzer:lc3/synth-poly', 'werk:lc3/synth-bass', 'werk:lc3/synth-poly']);
  const w = z.find((x) => x.id === 'werk:lc3/synth-poly'), n = z.find((x) => x.id === 'nutzer:lc3/synth-poly');
  assert.deepEqual([w.text, w.loeschbar, n.text, n.loeschbar], ['synth-poly · factory', false, 'synth-poly · yours', true]);
  assert.deepEqual(praesetAnsicht(LISTE, null, stand(poly), 2), [], 'a place without a model has no list');
});
test('praesetAnsicht: an instrument preset of another graph than the focus is disabled with the reason, a fixed one never is', () => {
  const z = praesetAnsicht(LISTE, 'lc3', stand(poly), 2);
  const por = (id) => z.find((x) => x.id === id);
  assert.deepEqual([por('werk:lc3/synth-poly').aus, por('werk:lc3/synth-bass').aus, por('nutzer:lc3/dj-filters').aus], [false, true, false]);
  assert.equal(por('werk:lc3/synth-bass').grund, 'For synth-bass; the synth in front is synth-poly');
  const ohne = praesetAnsicht(LISTE, 'lc3', stand(null), 2);
  assert.deepEqual(ohne.map((x) => [x.id, x.aus]).filter(([, a]) => a).length, 3, 'with nothing in front every instrument preset waits');
  assert.equal(ohne.find((x) => x.id === 'werk:lc3/synth-poly').grund, 'Needs a synth in front');
  assert.equal(praesetAnsicht(LISTE, 'lc3', stand({ kanal: 'erz/6', graph: null, basis: null, grund: 'kein_graph' }), 2).find((x) => x.art === 'instrument').aus, true);
});
test('praesetAnsicht: the preset applied on the place is marked, the usable ones come first', () => {
  const z = praesetAnsicht(LISTE, 'lc3', stand(poly, plaetze({ preset: 'nutzer:lc3/synth-poly' })), 2);
  assert.deepEqual(z.filter((x) => x.aktiv).map((x) => x.id), ['nutzer:lc3/synth-poly']);
  assert.deepEqual(z.map((x) => x.aus), [false, false, false, true], 'the disabled one is last');
});

// ---- DOM
function el(tag) {
  const e = { tag, kinder: [], klassen: new Set(), attr: {}, dataset: {}, ev: {}, textContent: '', value: '', disabled: false,
    classList: { add: (c) => e.klassen.add(c), toggle: (c, an) => { if (an) e.klassen.add(c); else e.klassen.delete(c); } },
    append(...k) { e.kinder.push(...k); }, replaceChildren(...k) { e.kinder = k; }, setAttribute(n, v) { e.attr[n] = String(v); if (n === 'disabled') e.disabled = true; },
    addEventListener(n, f) { (e.ev[n] ??= []).push(f); },
    alle(aus = []) { aus.push(e); for (const k of e.kinder) k.alle?.(aus); return aus; } };
  return e;
}
const mitDom = (f) => { const dok = globalThis.document; globalThis.document = { createElement: el }; try { return f(); } finally { globalThis.document = dok; } };
const knoepfe = (w) => w.alle().filter((x) => x.tag === 'button');
const finde = (w, t) => knoepfe(w).find((x) => x.textContent === t);

test('bauePresets: SAVE FOR, SAVE AS and a LOAD chip per preset; a disabled preset does not load, DELETE only on user presets', () => mitDom(() => {
  const w = el('div'), g = [];
  const ansicht = { verfuegbar: true, speichern: speicherAngebot(stand(poly)), zeilen: praesetAnsicht(LISTE, 'lc3', stand(poly), 2) };
  bauePresets(w, ansicht, { speichereFuer: () => g.push('fuer'), speichereAls: () => g.push('als'), lade: (id) => g.push(['lade', id]), loesche: (id) => g.push(['weg', id]) });
  const namen = knoepfe(w).map((x) => x.textContent);
  assert.equal(namen[0], 'SAVE FOR synth-poly');
  assert.equal(namen[1], 'SAVE AS');
  assert.equal(namen.filter((t) => t === 'DELETE').length, 2, 'two user presets');
  assert.ok(namen.includes('synth-bass · factory'));
  finde(w, 'SAVE FOR synth-poly').ev.click[0]();
  finde(w, 'SAVE AS').ev.click[0]();
  finde(w, 'synth-poly · factory').ev.click[0]();
  const aus = finde(w, 'synth-bass · factory');
  assert.equal(aus.disabled, true);
  assert.equal(aus.attr.title, 'For synth-bass; the synth in front is synth-poly');
  const weg = knoepfe(w).filter((x) => x.textContent === 'DELETE');
  weg[0].ev.click[0]();
  assert.deepEqual(g.slice(0, 3), ['fuer', 'als', ['lade', 'werk:lc3/synth-poly']]);
  assert.deepEqual(g[3], ['weg', weg[0].attr['data-preset']]);
  assert.ok(g[3][1].startsWith('nutzer:'));
}));
test('bauePresets: SAVE FOR is disabled without a focus base, and says what it needs', () => mitDom(() => {
  const w = el('div');
  bauePresets(w, { verfuegbar: true, speichern: speicherAngebot(stand(null)), zeilen: [] }, {});
  const b = knoepfe(w)[0];
  assert.deepEqual([b.textContent, b.disabled], ['SAVE FOR SYNTH', true]);
  assert.ok(w.alle().some((x) => x.klassen.has('reg-leer') || x.klassen.has('reg-bedienung')), 'an empty list says so');
}));
test('bauePresets: a page server without the routes shows one short line and no buttons', () => mitDom(() => {
  const w = el('div');
  bauePresets(w, { verfuegbar: false, text: 'Presets are not available on this page server yet', speichern: speicherAngebot(null), zeilen: [] }, {});
  assert.equal(knoepfe(w).length, 0);
  assert.ok(w.alle().some((x) => x.textContent === 'Presets are not available on this page server yet'));
}));
test('bauePresets: the applied preset chip is marked', () => mitDom(() => {
  const w = el('div');
  const s = stand(poly, plaetze({ preset: 'werk:lc3/synth-poly' }));
  bauePresets(w, { verfuegbar: true, speichern: speicherAngebot(s), zeilen: praesetAnsicht(LISTE, 'lc3', s, 2) }, {});
  assert.equal(finde(w, 'synth-poly · factory').klassen.has('an'), true);
  assert.equal(finde(w, 'synth-poly · yours').klassen.has('an'), false);
}));

const REG = { katalog: [{ id: 'lc3', name: 'Novation Launch Control 3', weg: 'lernen', midi: 'Launch Control 3', regler: [{ name: 'Enc 1', typ: 'cc', kanal: 1, nr: 1, art: 'knob', zeile: 1, spalte: 1 }] }], kanten: [] };
const GER = { controller: [{ platz: 2, port: 'Midi-Bridge:Launch Control 3: MIDI In (capture)', name: 'LC3', da: true, verbunden: true }], quellen: { midi: [] } };
test('geraeteZeilen: a place carries the catalogue id of its device as model', () => {
  const z = geraeteZeilen(REG, GER, { zuordnungen: [] });
  assert.equal(z[0].modell, 'lc3');
  assert.equal(geraeteZeilen(REG, { ...GER, controller: [{ ...GER.controller[0], port: 'Unknown thing' }] }, { zuordnungen: [] })[0].modell, null);
});
test('baueGeraete: the FOLLOW switch and the follow line sit with the port buttons; the switch posts the opposite', () => mitDom(() => {
  const w = el('div'), g = [];
  const zeilen = geraeteZeilen(REG, GER, { zuordnungen: [] }).map((z) => ({ ...z, folgen: folgenAnsicht(stand(poly), 2, opt) }));
  baueGeraete(w, zeilen, { schicken: () => {}, folge: (platz, an) => g.push([platz, an]) });
  const f = finde(w, 'FOLLOW');
  assert.equal(f.klassen.has('an'), true);
  assert.equal(f.attr['aria-pressed'], 'true');
  assert.ok(w.alle().some((x) => x.textContent === 'follows synth-poly on I6'));
  f.ev.click[0]();
  assert.deepEqual(g, [[2, false]]);
  const aus = zeilen.map((z) => ({ ...z, folgen: folgenAnsicht(stand(poly, plaetze({ folgen: false })), 2, opt) }));
  baueGeraete(w, aus, { schicken: () => {}, folge: (platz, an) => g.push([platz, an]) });
  const f2 = finde(w, 'FOLLOW');
  assert.equal(f2.klassen.has('an'), false);
  f2.ev.click[0]();
  assert.deepEqual(g[1], [2, true]);
}));
test('baueGeraete: without the routes FOLLOW is disabled and the row says why; a device without a layout gets no switch', () => mitDom(() => {
  const w = el('div');
  const zeilen = geraeteZeilen(REG, GER, { zuordnungen: [] }).map((z) => ({ ...z, folgen: folgenAnsicht(null, 2, opt) }));
  baueGeraete(w, zeilen, { schicken: () => {}, folge: () => assert.fail('must not post') });
  const f = finde(w, 'FOLLOW');
  assert.equal(f.disabled, true);
  f.ev.click?.[0]?.();
  assert.ok(w.alle().some((x) => /not available/i.test(x.textContent)));
  baueGeraete(w, geraeteZeilen(REG, GER, { zuordnungen: [] }), { schicken: () => {} });
  assert.equal(finde(w, 'FOLLOW'), undefined, 'no folgen on the row: no switch (an older caller)');
}));

test('holeFolgenStand: 404 on the focus route means a server without it (null), another failure keeps the old state, an answer is taken', async () => {
  const antwort = (status, j) => async () => ({ ok: status < 300, status, json: async () => j });
  assert.deepEqual(await holeFolgenStand(antwort(200, { fokus: null, plaetze: [] }), 'alt'), { stand: { fokus: null, plaetze: [] }, fehlt: false });
  assert.deepEqual(await holeFolgenStand(antwort(404, { fehler: 'nicht_gefunden' }), 'alt'), { stand: null, fehlt: true });
  assert.deepEqual(await holeFolgenStand(antwort(500, {}), 'alt'), { stand: 'alt', fehlt: false });
  assert.deepEqual(await holeFolgenStand(async () => { throw new Error('offline'); }, 'alt'), { stand: 'alt', fehlt: false });
  assert.deepEqual(await holeFolgenStand(async () => ({ ok: true, status: 200, json: async () => { throw new Error('x'); } }), 'alt'), { stand: 'alt', fehlt: false }, 'an unparsable answer');
});

// ---- the KEYS line (plan N1) ----
const mitTasten = (tasten) => ({ fokus: null, plaetze: [], tasten });
const nameOpt = { kanalName: (k) => ({ 'erz/6': 'I6' })[k] ?? k, spurName: (id) => ({ s3: 'Lead' })[id] ?? null };
test('tastenAnsicht: names the track or channel the keys go to', () => {
  assert.equal(tastenAnsicht(mitTasten({ an: true, ziel: { spur_id: 's3' } }), nameOpt).text, 'KEYS \u2192 Lead');
  assert.equal(tastenAnsicht(mitTasten({ an: true, ziel: { spur_id: 's7' } }), nameOpt).text, 'KEYS \u2192 track s7', 'a track the page has no name for');
  assert.equal(tastenAnsicht(mitTasten({ an: true, ziel: { kanal: 'erz/6' } }), nameOpt).text, 'KEYS \u2192 I6');
  assert.equal(tastenAnsicht(mitTasten({ an: true, ziel: { kanal: 'erz/6' } })).text, 'KEYS \u2192 erz/6', 'without name helpers');
});
test('tastenAnsicht: no target says why; off says off; every reason of the server reads', () => {
  const a = (grund) => tastenAnsicht(mitTasten({ an: true, ziel: null, grund }), nameOpt).text;
  assert.equal(a('kein_fokus'), 'KEYS \u2192 none: no synth in front');
  assert.match(a('kein_instrument'), /not an instrument/);
  assert.match(a('keine_senke'), /no sound path/);
  assert.match(a('kein_ziel'), /takes no keys/);
  assert.match(a('kern_alt'), /core cannot play keys on live channels/);
  assert.equal(a('etwas_neues'), 'KEYS \u2192 none: no target', 'an unknown reason still reads');
  const aus = tastenAnsicht(mitTasten({ an: false, ziel: null }), nameOpt);
  assert.deepEqual([aus.an, aus.text], [false, 'KEYS off']);
});
test('tastenAnsicht: a server without the field (or without the route at all) gives no line', () => {
  assert.equal(tastenAnsicht(null), null);
  assert.equal(tastenAnsicht({ fokus: null, plaetze: [] }), null, 'an older page server');
  assert.equal(tastenAnsicht({ tasten: 'ja' }), null);
  assert.equal(tastenAnsicht({ tasten: { ziel: null } }), null, 'the switch state is missing');
});
test('baueTasten: one line with the KEYS switch that asks for the opposite; nothing for no line', () => mitDom(() => {
  const w = el('div'), g = [];
  baueTasten(w, tastenAnsicht(mitTasten({ an: true, ziel: { spur_id: 's3' } }), nameOpt), { schalte: (an) => g.push(an) });
  assert.ok(w.alle().some((x) => x.textContent === 'KEYS \u2192 Lead'));
  const k = finde(w, 'KEYS');
  assert.deepEqual([k.klassen.has('an'), k.attr['aria-pressed']], [true, 'true']);
  k.ev.click[0]();
  baueTasten(w, tastenAnsicht(mitTasten({ an: false, ziel: null }), nameOpt), { schalte: (an) => g.push(an) });
  const k2 = finde(w, 'KEYS');
  assert.deepEqual([k2.klassen.has('an'), k2.attr['aria-pressed']], [false, 'false']);
  k2.ev.click[0]();
  assert.deepEqual(g, [false, true]);
  baueTasten(w, null, {});
  assert.equal(finde(w, 'KEYS'), undefined);
}));
