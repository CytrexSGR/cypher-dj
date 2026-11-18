// The one grouping module of the instrument pickers (public/instrument_groups.js) and what every picker builds from it: the INSTRUMENTS area, the single
// select with optgroups, the SEQ and workbench instrument menus and the PRODUCTION device browser. The entries are built here (Task 1 delivers `prinzip`
// on GET /graphen in another branch): {name, art, kategorie, prinzip, text, latenz}.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACHSEN, PRINZIPIEN, GRAPH_KATEGORIEN, gruppenVon, gruppeVon, nebenText, mitNeben, sortiere, leseAchse, merkeAchse, beiAchse, andereAchse,
  katSpeicherLesen, katMerken, menuePunkte, oeffneAchsenMenue } from '../public/instrument_groups.js';
import * as effekte from '../public/effects.js';
import { graphWahlHtml, graphWahlOptionen, instrumentWahlHtml, instrumentKategorien } from '../public/effects.js';
import { geraeteHtml, eintraege } from '../public/production/devices_browser.js';
import { instrumentMenue } from '../public/werkbank/tracks.js';
import { katalog } from '../presets/area.ts';

const G = [
  { name: 'ms20-bass', art: 'instrument', regler_namen: {}, kategorie: 'bass', prinzip: 'analog', text: 'Gritty bass.', latenz: 0 },
  { name: 'diode-acid-bass', art: 'instrument', regler_namen: {}, kategorie: 'bass', prinzip: 'analog', text: 'Acid bass.', latenz: 0 },
  { name: 'fm-bass', art: 'instrument', regler_namen: {}, kategorie: 'bass', prinzip: 'fm', latenz: 0 },
  { name: 'drums-909', art: 'instrument', regler_namen: {}, kategorie: 'drums', prinzip: 'drums', latenz: 0 },
  { name: 'saite', art: 'instrument', regler_namen: {}, kategorie: 'keys', prinzip: 'physik', latenz: 0 },
  { name: 'eigen', art: 'instrument', regler_namen: {}, latenz: 0 },                                    // a user graph: no kategorie, no prinzip
  { name: 'rolle-nur', art: 'instrument', regler_namen: {}, kategorie: 'lead', latenz: 0 },             // a role but no type (old install)
  { name: 'unbekannt', art: 'instrument', regler_namen: {}, kategorie: 'zzz', prinzip: 'zzz', latenz: 0 },   // ids the page does not know
  { name: 'fx-bandecho', art: 'effekt', regler_namen: {}, latenz: 0 },
];
const INSTRUMENTE = G.filter((g) => g.art === 'instrument').map((g) => g.name);

const text = (t) => t.replace(/&amp;/g, '&');   // the page escapes the ampersand of "Strings & Bodies"
const optgruppen = (h) => [...h.matchAll(/<optgroup label="([^"]*)">(.*?)<\/optgroup>/gs)].map((m) => ({ name: text(m[1]), optionen: [...m[2].matchAll(/<option value="([^"]*)"([^>]*)>([^<]*)</g)].map((o) => ({ wert: o[1], text: text(o[3]), an: / selected/.test(o[2]) })) }));
const opts = (html, sel) => [...new RegExp(`<select[^>]*class="${sel}"[^>]*>(.*?)</select>`, 's').exec(html)[1].matchAll(/<option value="([^"]*)"([^>]*)>([^<]*)</g)].map((m) => ({ wert: m[1], text: text(m[3]), an: / selected/.test(m[2]) }));

// ---- the module ----
let speicher;
before(() => {
  speicher = new Map();
});
after(() => { delete globalThis.localStorage; });

test('storage default: with nothing stored and no storage at all the axis is "prinzip" (this runs before any test stores one)', () => {
  assert.equal(leseAchse(), 'prinzip');
  globalThis.localStorage = { getItem: (k) => (speicher.has(k) ? speicher.get(k) : null), setItem: (k, v) => speicher.set(k, String(v)) };
  assert.equal(leseAchse(), 'prinzip', 'an empty storage gives the default as well');
});

test('axes and groups: ACHSEN, the ten types in order with host and Other last, the roles as before', () => {
  assert.deepEqual(ACHSEN, ['prinzip', 'rolle']);
  assert.deepEqual(PRINZIPIEN.map((g) => g.id), ['analog', 'wavetable', 'fm', 'physik', 'granular', 'sampler', 'drums', 'feedback', 'host', 'sonst']);
  assert.deepEqual(PRINZIPIEN.map((g) => g.name), ['Analog', 'Wavetable', 'FM', 'Strings & Bodies', 'Granular', 'Sampler', 'Drum Synthesis', 'Feedback', 'Host (Surge/plugins)', 'Other']);
  assert.deepEqual(GRAPH_KATEGORIEN.map((k) => k.id), ['drums', 'bass', 'lead', 'pad', 'keys', 'textur', 'sampler', 'host', 'sonst']);
  assert.equal(effekte.GRAPH_KATEGORIEN, GRAPH_KATEGORIEN, 'effects.js re-exports the roles, there is one list');
  assert.equal(gruppenVon('prinzip'), PRINZIPIEN);
  assert.equal(gruppenVon('rolle'), GRAPH_KATEGORIEN);
  assert.equal(andereAchse('prinzip'), 'rolle');
  assert.equal(andereAchse('rolle'), 'prinzip');
});

test('gruppeVon: the field of the axis; "sonst" without it or with an id the axis does not know; "host" for the host entry', () => {
  const e = { kategorie: 'bass', prinzip: 'fm' };
  assert.equal(gruppeVon(e, 'prinzip'), 'fm');
  assert.equal(gruppeVon(e, 'rolle'), 'bass');
  assert.equal(gruppeVon({}, 'prinzip'), 'sonst');
  assert.equal(gruppeVon({ kategorie: 'bass' }, 'prinzip'), 'sonst', 'a graph of an old install has a role but no type');
  assert.equal(gruppeVon({ prinzip: 'fm' }, 'rolle'), 'sonst');
  assert.equal(gruppeVon({ kategorie: 'zzz', prinzip: 'zzz' }, 'rolle'), 'sonst', 'an unknown id never drops the entry');
  assert.equal(gruppeVon({ kategorie: 'zzz', prinzip: 'zzz' }, 'prinzip'), 'sonst');
  assert.equal(gruppeVon({ host: true, text: 'Surge XT' }, 'prinzip'), 'host');
  assert.equal(gruppeVon({ host: true }, 'rolle'), 'host');
  assert.equal(gruppeVon({ prinzip: 'host' }, 'prinzip'), 'sonst', 'a file that says "host" is not the host entry');
  assert.equal(gruppeVon(null, 'prinzip'), 'sonst');
  assert.equal(gruppeVon(e, 'nonsense'), 'fm', 'an unknown axis reads as the default');
});

test('nebenText: the short name of the OTHER axis, empty when unknown', () => {
  const e = { kategorie: 'bass', prinzip: 'analog' };
  assert.equal(nebenText(e, 'prinzip'), 'Bass');
  assert.equal(nebenText(e, 'rolle'), 'Analog');
  assert.equal(nebenText({ kategorie: 'bass' }, 'rolle'), '', 'type unknown');
  assert.equal(nebenText({ prinzip: 'physik' }, 'rolle'), 'Strings & Bodies');
  assert.equal(nebenText({}, 'prinzip'), '');
  assert.equal(nebenText({ kategorie: 'zzz' }, 'prinzip'), '');
  assert.equal(nebenText({ host: true }, 'prinzip'), '', 'the host entry has no suffix');
  assert.equal(mitNeben('ms20-bass', e, 'prinzip'), 'ms20-bass · Bass');
  assert.equal(mitNeben('eigen', {}, 'prinzip'), 'eigen');
});

test('sortiere: group order of the axis, inside a group the order of the other axis, then the name; the argument stays as it was', () => {
  const l = [{ name: 'b', prinzip: 'analog', kategorie: 'lead' }, { name: 'a', prinzip: 'analog', kategorie: 'lead' }, { name: 'c', prinzip: 'analog', kategorie: 'bass' },
    { name: 'z', prinzip: 'fm' }, { name: 'y' }, { name: 'd', prinzip: 'analog', kategorie: 'pad' }];
  const kopie = JSON.parse(JSON.stringify(l));
  assert.deepEqual(sortiere(l, 'prinzip').map((e) => e.name), ['c', 'a', 'b', 'd', 'z', 'y'], 'Analog (bass, lead by name, pad), FM, then the entry without a type');
  assert.deepEqual(sortiere(l, 'rolle').map((e) => e.name), ['c', 'a', 'b', 'd', 'z', 'y'], 'bass, lead (a, b), pad, then the two without a role: the typed one before the untyped');
  assert.deepEqual(l, kopie, 'no mutation');
  assert.deepEqual(sortiere(undefined, 'prinzip'), []);
});

test('the axis: stored under djk-instrument-achse, listeners hear a change only, an unknown value is refused', () => {
  const gehoert = [];
  beiAchse((a) => gehoert.push(a));
  merkeAchse('rolle');
  assert.equal(speicher.get('djk-instrument-achse'), 'rolle');
  assert.equal(leseAchse(), 'rolle');
  merkeAchse('rolle');
  merkeAchse('quatsch');
  assert.equal(leseAchse(), 'rolle');
  merkeAchse('prinzip');
  assert.deepEqual(gehoert, ['rolle', 'prinzip'], 'one call per change, none for the same value or an invalid one');
  speicher.set('djk-instrument-achse', 'kaputt');
  assert.equal(leseAchse(), 'prinzip', 'a bad stored value is ignored (here the choice of this page load, the type)');
});

test('the axis without a usable storage still holds for this page load (every access throws)', () => {
  const alt = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  try {
    merkeAchse('rolle');
    assert.equal(leseAchse(), 'rolle');
    merkeAchse('prinzip');
    assert.equal(leseAchse(), 'prinzip');
  } finally { globalThis.localStorage = alt; }
});

test('remembered group per channel and axis: the old string value is the role, objects keep both axes, garbage is dropped', () => {
  assert.deepEqual(katSpeicherLesen('{"erz/5":"bass","erz/6":{"prinzip":"fm","rolle":"lead"},"erz/7":{"prinzip":3},"pad/1":7,"pad/2":[1]}'),
    { 'erz/5': { rolle: 'bass' }, 'erz/6': { prinzip: 'fm', rolle: 'lead' }, 'erz/7': {} });
  assert.deepEqual(katSpeicherLesen(null), {});
  assert.deepEqual(katSpeicherLesen('not json'), {});
  assert.deepEqual(katSpeicherLesen('[1]'), {});
  const a = { 'erz/5': { rolle: 'bass' } };
  const b = katMerken(a, 'erz/5', 'prinzip', 'analog');
  assert.deepEqual(b, { 'erz/5': { rolle: 'bass', prinzip: 'analog' } });
  assert.deepEqual(a, { 'erz/5': { rolle: 'bass' } }, 'the old memory is not changed');
  assert.deepEqual(katMerken({}, 'erz/6', 'rolle', 'lead'), { 'erz/6': { rolle: 'lead' } });
});

// ---- single select with optgroups ----
test('single picker: grouped by type by default; option text is name + role, the value stays the graph name; Off first and ungrouped', () => {
  const h = graphWahlHtml('erz/5', G, 'ms20-bass');
  assert.match(h, /<select class="graphwahl"[^>]*><option value="">Off<\/option><optgroup label="Analog">/);
  const gr = optgruppen(h);
  assert.deepEqual(gr.map((x) => x.name), ['Analog', 'FM', 'Strings & Bodies', 'Drum Synthesis', 'Other']);
  assert.deepEqual(gr[0].optionen, [{ wert: 'diode-acid-bass', text: 'diode-acid-bass · Bass', an: false }, { wert: 'ms20-bass', text: 'ms20-bass · Bass', an: true }]);
  assert.deepEqual(gr.at(-1).optionen.map((o) => o.wert), ['rolle-nur', 'eigen', 'unbekannt'], 'no type, or a type the page does not know: under Other (the one with a known role first, then by name)');
  assert.deepEqual(gr.at(-1).optionen.map((o) => o.text), ['rolle-nur · Lead', 'eigen', 'unbekannt']);
  assert.equal(h, graphWahlHtml('erz/5', G, 'ms20-bass', undefined, 'prinzip'), 'the default axis is the type');
});

test('single picker: by role the groups are the old ones, the text carries the type', () => {
  const h = graphWahlHtml('erz/5', G, 'ms20-bass', undefined, 'rolle');
  const gr = optgruppen(h);
  assert.deepEqual(gr.map((x) => x.name), ['Drums', 'Bass', 'Lead', 'Keys & Plucks', 'Other']);
  assert.deepEqual(gr[1].optionen.map((o) => o.text), ['diode-acid-bass · Analog', 'ms20-bass · Analog', 'fm-bass · FM'], 'inside a group by the type order, then by name');
  assert.deepEqual(gr.at(-1).optionen.map((o) => o.wert), ['eigen', 'unbekannt']);
});

test('single picker: no instrument is ever dropped, on both axes, with a graph that has no prinzip or ids nobody knows', () => {
  for (const achse of ACHSEN) {
    const alle = optgruppen(graphWahlHtml('erz/5', G, '', undefined, achse)).flatMap((x) => x.optionen.map((o) => o.wert));
    assert.deepEqual([...alle].sort(), [...INSTRUMENTE].sort(), achse);
  }
  const ohne = optgruppen(graphWahlHtml('erz/5', [{ name: 'alt', art: 'instrument', regler_namen: {} }], '', undefined, 'prinzip'));
  assert.deepEqual(ohne.map((x) => [x.name, x.optionen.map((o) => o.wert)]), [['Other', ['alt']]]);
});

test('single picker: the loaded instrument is selected on both axes; one that is not in the list stays, under Other', () => {
  for (const achse of ACHSEN) {
    const sel = optgruppen(graphWahlHtml('erz/5', G, 'fm-bass', undefined, achse)).flatMap((x) => x.optionen).filter((o) => o.an).map((o) => o.wert);
    assert.deepEqual(sel, ['fm-bass'], achse);
    const weg = optgruppen(graphWahlHtml('erz/5', G, 'geloescht', undefined, achse));
    assert.equal(weg.at(-1).name, 'Other', achse);
    assert.ok(weg.at(-1).optionen.some((o) => o.wert === 'geloescht' && o.an), achse);
  }
});

test('single picker: the host entry of erz/2 and erz/3 stays first and ungrouped, effects stay flat with no optgroup', () => {
  assert.match(graphWahlHtml('erz/2', G, '', 'Cypher Modular'), /<option value="" selected>Cypher Modular<\/option><optgroup/);
  assert.ok(!graphWahlHtml('deck/1', G, '').includes('optgroup'));
  assert.ok(!graphWahlHtml('deck/1', G, '', undefined, 'rolle').includes('optgroup'));
  assert.equal(graphWahlHtml('erz/1', G, ''), '');
  assert.ok(!graphWahlHtml('erz/5', G, '').includes('graphachse'), 'no axis control in the single select: it follows the page-wide choice');
});

test('graphWahlOptionen marks the host entry; the other entries carry kategorie and prinzip as the file gave them', () => {
  const o = graphWahlOptionen('erz/3', G, '', 'Surge XT');
  assert.deepEqual(o[0], { wert: '', text: 'Surge XT', gewaehlt: true, host: true });
  const ms = o.find((x) => x.wert === 'ms20-bass');
  assert.equal(ms.kategorie, 'bass'); assert.equal(ms.prinzip, 'analog');
  assert.equal(o.find((x) => x.wert === 'eigen').prinzip, undefined);
});

// ---- INSTRUMENTS area ----
test('INSTRUMENTS area: TYPE and ROLE buttons first, then the group select, the instrument select and the description line', () => {
  const h = instrumentWahlHtml('erz/5', G, 'ms20-bass');
  assert.match(h, /^<span class="graphachsen"[^>]*><button type="button" class="graphachse" data-graphachse="erz\/5" data-achse="prinzip" aria-pressed="true">TYPE<\/button><button type="button" class="graphachse" data-graphachse="erz\/5" data-achse="rolle" aria-pressed="false">ROLE<\/button><\/span><select class="graphkat"/);
  assert.ok(h.indexOf('<select class="graphkat"') < h.indexOf('<select class="graphwahl"') && h.indexOf('<select class="graphwahl"') < h.indexOf('graphtext'));
  const r = instrumentWahlHtml('erz/5', G, 'ms20-bass', undefined, undefined, 'rolle');
  assert.match(r, /data-achse="prinzip" aria-pressed="false">TYPE<\/button><button[^>]*data-achse="rolle" aria-pressed="true">ROLE</);
});

test('INSTRUMENTS area: groups of the axis; only groups that hold a graph; the loaded instrument\'s group is the one shown, on both axes', () => {
  const t = instrumentWahlHtml('erz/5', G, 'fm-bass', undefined, null, 'prinzip');
  assert.deepEqual(opts(t, 'graphkat').map((o) => o.text), ['Analog', 'FM', 'Strings & Bodies', 'Drum Synthesis', 'Other']);
  assert.deepEqual(opts(t, 'graphkat').filter((o) => o.an).map((o) => o.wert), ['fm']);
  assert.deepEqual(opts(t, 'graphwahl'), [{ wert: '', text: 'Off', an: false }, { wert: 'fm-bass', text: 'fm-bass · Bass', an: true }]);
  const r = instrumentWahlHtml('erz/5', G, 'fm-bass', undefined, null, 'rolle');
  assert.deepEqual(opts(r, 'graphkat').map((o) => o.text), ['Drums', 'Bass', 'Lead', 'Keys & Plucks', 'Other']);
  assert.deepEqual(opts(r, 'graphkat').filter((o) => o.an).map((o) => o.wert), ['bass']);
  assert.deepEqual(opts(r, 'graphwahl').map((o) => o.wert), ['', 'diode-acid-bass', 'ms20-bass', 'fm-bass'], 'Off, then the group sorted by type (Analog before FM), by name');
  assert.deepEqual(opts(r, 'graphwahl').filter((o) => o.an).map((o) => o.wert), ['fm-bass']);
  assert.equal(instrumentKategorien('erz/5', G, 'fm-bass', null, 'prinzip').gewaehlt, 'fm');
  assert.equal(instrumentKategorien('erz/5', G, 'fm-bass', null, 'rolle').gewaehlt, 'bass');
});

test('INSTRUMENTS area: a graph without prinzip is under Other (and under its role on the other axis); it is selected there when loaded', () => {
  const t = instrumentWahlHtml('erz/5', G, 'eigen', undefined, null, 'prinzip');
  assert.deepEqual(opts(t, 'graphkat').filter((o) => o.an).map((o) => o.wert), ['sonst']);
  assert.deepEqual(opts(t, 'graphwahl').filter((o) => o.an).map((o) => o.wert), ['eigen']);
  assert.deepEqual(opts(t, 'graphwahl').map((o) => o.wert), ['', 'rolle-nur', 'eigen', 'unbekannt'], 'Off plus everything the file did not type: nothing dropped');
  const rolleNur = instrumentWahlHtml('erz/5', G, 'rolle-nur', undefined, null, 'prinzip');
  assert.deepEqual(opts(rolleNur, 'graphkat').filter((o) => o.an).map((o) => o.wert), ['sonst'], 'a role but no type: Other when grouped by type');
  assert.deepEqual(opts(instrumentWahlHtml('erz/5', G, 'rolle-nur', undefined, null, 'rolle'), 'graphkat').filter((o) => o.an).map((o) => o.wert), ['lead']);
  for (const achse of ACHSEN) {
    const ids = opts(instrumentWahlHtml('erz/5', G, '', undefined, null, achse), 'graphkat').map((o) => o.wert);
    const alle = ids.flatMap((id) => opts(instrumentWahlHtml('erz/5', G, '', undefined, id, achse), 'graphwahl').map((o) => o.wert)).filter((v) => v !== '');
    assert.deepEqual([...new Set(alle)].sort(), [...INSTRUMENTE].sort(), `${achse}: browsing every group reaches every instrument`);
  }
});

test('INSTRUMENTS area: the remembered group shows when nothing is loaded, the loaded graph beats it; the host group is first for an empty erz/3 on both axes', () => {
  const o = instrumentWahlHtml('erz/5', G, '', undefined, 'fm', 'prinzip');
  assert.deepEqual(opts(o, 'graphkat').filter((x) => x.an).map((x) => x.wert), ['fm'], 'nothing loaded: the remembered group');
  assert.deepEqual(opts(o, 'graphwahl').map((x) => [x.wert, x.an]), [['', true], ['fm-bass', false]]);
  const anders = instrumentWahlHtml('erz/5', G, 'ms20-bass', undefined, 'fm', 'prinzip');
  assert.deepEqual(opts(anders, 'graphkat').filter((x) => x.an).map((x) => x.wert), ['fm'], 'browsed to another group while ms20-bass is loaded');
  assert.match(anders, /<option value="" disabled selected hidden>Choose/, 'a group that does not hold the loaded graph shows Choose');
  assert.deepEqual(opts(instrumentWahlHtml('erz/5', G, 'ms20-bass', undefined, 'zzz', 'prinzip'), 'graphkat').filter((x) => x.an).map((x) => x.wert), ['analog'], 'a remembered id this axis does not offer: the loaded graph decides');
  for (const achse of ACHSEN) {
    const h = instrumentWahlHtml('erz/3', G, '', 'Surge XT', null, achse);
    assert.deepEqual(opts(h, 'graphkat').filter((x) => x.an).map((x) => x.wert), ['host'], achse);
    assert.deepEqual(opts(h, 'graphwahl'), [{ wert: '', text: 'Surge XT', an: true }], achse);
    assert.equal(opts(h, 'graphkat').at(-1).wert, 'sonst');
    assert.equal(opts(h, 'graphkat').at(-2).wert, 'host');
    const geladen = instrumentWahlHtml('erz/3', G, 'saite', 'Surge XT', null, achse);
    assert.deepEqual(opts(geladen, 'graphkat').filter((x) => x.an).map((x) => x.wert), [achse === 'prinzip' ? 'physik' : 'keys'], 'a loaded graph wins over the host');
  }
});

test('INSTRUMENTS area: switching the axis keeps the loaded instrument selected (same value, the other group), and the escaped control texts hold', () => {
  for (const name of ['ms20-bass', 'saite', 'drums-909', 'eigen', 'unbekannt']) {
    for (const achse of ACHSEN) {
      const h = instrumentWahlHtml('erz/6', G, name, undefined, null, achse);
      assert.deepEqual(opts(h, 'graphwahl').filter((x) => x.an).map((x) => x.wert), [name], `${name} on ${achse}`);
      assert.ok(!/disabled selected hidden/.test(h), `${name} on ${achse}: not "Choose"`);
    }
  }
  assert.match(instrumentWahlHtml('erz/5', [{ name: '<b>', art: 'instrument', kategorie: 'bass', prinzip: 'fm', regler_namen: {} }], ''), /&lt;b&gt; · Bass/);
});

// ---- menus (SEQ and workbench) ----
const WAHL = [
  { gruppe: 'Baukasten', text: 'ms20-bass', name: 'ms20-bass', geraet: { art: 'intern', name: 'bk', graph: 'ms20-bass' } },
  { gruppe: 'Baukasten', text: 'fm-bass', name: 'fm-bass', geraet: { art: 'intern', name: 'bk', graph: 'fm-bass' } },
  { gruppe: 'Baukasten', text: 'eigen', name: 'eigen', geraet: { art: 'intern', name: 'bk', graph: 'eigen' } },
  { gruppe: 'Baukasten', text: 'saite', name: 'saite', geraet: { art: 'intern', name: 'bk', graph: 'saite' } },
  { gruppe: 'Kit', text: '909 (12)', name: '909', geraet: { art: 'intern', name: 'kit', kit: '909' } },
  { gruppe: 'RB-338', text: 'RB-338', name: 'RB-338', geraet: { art: 'intern', name: 'rb338', parameter: {} } },
];
const kopf = (punkte) => punkte.filter((p) => p.gruppe).map((p) => p.text);

test('menu: the last entry switches the axis (Enter on a fresh menu still picks the first instrument); headers are the groups of the axis without "Baukasten ·"; kit and RB-338 stay in their own groups at the end', () => {
  const p = menuePunkte(WAHL, G, 'prinzip', () => {}, () => {});
  assert.equal(p.at(-1).text, 'Group by role');
  assert.ok(!p.at(-1).gruppe);
  assert.ok(p[0].gruppe && !p[1].gruppe && p[1].text === 'ms20-bass · Bass', 'the first item that takes the focus is an instrument');
  assert.deepEqual(kopf(p), ['Analog', 'FM', 'Strings & Bodies', 'Other', 'Kit', 'RB-338', 'View']);
  assert.deepEqual(p.slice(0, -1).filter((x) => !x.gruppe).map((x) => x.text), ['ms20-bass · Bass', 'fm-bass · Bass', 'saite · Keys & Plucks', 'eigen', '909 (12)', 'RB-338']);
  const r = menuePunkte(WAHL, G, 'rolle', () => {}, () => {});
  assert.equal(r.at(-1).text, 'Group by type');
  assert.deepEqual(kopf(r), ['Bass', 'Keys & Plucks', 'Other', 'Kit', 'RB-338', 'View']);
  assert.deepEqual(r.slice(0, -1).filter((x) => !x.gruppe).map((x) => x.text), ['ms20-bass · Analog', 'fm-bass · FM', 'saite · Strings & Bodies', 'eigen', '909 (12)', 'RB-338'],
    'inside Bass the type order (Analog before FM) is the sort key');
});

test('menu: a click runs the action with the entry of the picker list (device untouched); the last entry runs the switch; entries without graph info stay in Other', () => {
  const gewaehlt = [];
  let umgeschaltet = 0;
  const p = menuePunkte(WAHL, [], 'prinzip', (e) => gewaehlt.push(e), () => { umgeschaltet++; });
  assert.deepEqual(kopf(p), ['Other', 'Kit', 'RB-338', 'View'], 'no graph info: all four Baukasten entries under Other, none dropped');
  p.filter((x) => !x.gruppe).forEach((x) => x.aktion());
  assert.equal(umgeschaltet, 1);
  assert.deepEqual(gewaehlt.map((e) => e.text), ['eigen', 'fm-bass', 'ms20-bass', 'saite', '909 (12)', 'RB-338'], 'sorted by name inside Other, then kit and RB-338');
  assert.deepEqual(gewaehlt.find((e) => e.name === 'ms20-bass').geraet, { art: 'intern', name: 'bk', graph: 'ms20-bass' });
  assert.equal(gewaehlt.find((e) => e.name === 'ms20-bass').text, 'ms20-bass', 'the entry keeps its plain text (the label of a command uses it)');
  assert.deepEqual(menuePunkte(undefined, undefined, 'prinzip', () => {}, () => {}).map((x) => x.text), ['View', 'Group by role'], 'nothing to pick: only the switch under its header');
});

test('menu switch: stores the other axis, redraws the pickers that listen, and reopens the same menu with the other grouping; nothing else happens', () => {
  merkeAchse('prinzip');
  const gehoert = [];
  beiAchse((a) => gehoert.push(a));
  const offen = [];
  oeffneAchsenMenue((achse, um) => menuePunkte(WAHL, G, achse, () => assert.fail('no instrument is chosen by the switch'), um), (punkte) => offen.push(punkte));
  assert.equal(offen.length, 1);
  assert.equal(offen[0].at(-1).text, 'Group by role');
  offen[0].at(-1).aktion();
  assert.equal(offen.length, 2, 'the menu opened again');
  assert.equal(offen[1].at(-1).text, 'Group by type');
  assert.deepEqual(kopf(offen[1]), ['Bass', 'Keys & Plucks', 'Other', 'Kit', 'RB-338', 'View']);
  assert.equal(leseAchse(), 'rolle');
  assert.ok(gehoert.includes('rolle'), 'a picker listening to the axis is told');
  offen[1].at(-1).aktion();
  assert.equal(offen.length, 3);
  assert.equal(leseAchse(), 'prinzip');
});

test('workbench instrument menu: the same grouping, the latency rule of geraetWahl unchanged, the switch last', () => {
  const graphen = [...G, { name: 'langsam', art: 'instrument', regler_namen: {}, kategorie: 'lead', prinzip: 'analog', latenz: 64 }];
  const gewaehlt = [];
  const p = instrumentMenue(graphen, [{ name: '909', klaenge: 12 }], undefined, (e) => gewaehlt.push(e), 'prinzip', () => {});
  assert.equal(p.at(-1).text, 'Group by role');
  assert.deepEqual(kopf(p), ['Analog', 'FM', 'Strings & Bodies', 'Drum Synthesis', 'Other', 'Kit', 'RB-338', 'View']);
  assert.ok(!p.some((x) => /langsam/.test(x.text)), 'a graph with latency is not offered for a live-played pattern');
  const mit = instrumentMenue(graphen, [], 'langsam', () => {}, 'rolle', () => {});
  assert.ok(mit.some((x) => /^langsam/.test(x.text)), 'the graph the pattern already plays stays in its own menu');
  assert.deepEqual(kopf(mit), ['Drums', 'Bass', 'Lead', 'Keys & Plucks', 'Other', 'RB-338', 'View']);
  p.find((x) => x.text === 'drums-909').aktion();   // drums is a group on both axes: no " · Drums" behind an instrument that sits under Drum Synthesis
  assert.equal(gewaehlt[0].geraet.graph, 'drums-909');
  assert.ok(!p.some((x) => x.text?.startsWith('Baukasten')), 'no "Baukasten ·" prefix any more');
});

test('SEQ and workbench code use the module: the menus carry the switch and read the axis when they open', () => {
  const lies = (n) => readFileSync(new URL(`../public/${n}`, import.meta.url), 'utf8');
  const seq = lies('seq_view.js');
  assert.match(seq, /from '\.\/instrument_gruppen\.js'/);
  assert.equal((seq.match(/oeffneAchsenMenue\(/g) ?? []).length, 2, 'the + pattern menu and the instrument exchange menu');
  assert.doesNotMatch(seq, /function menuePunkte/, 'no second grouping in the SEQ page');
  assert.match(lies('werkbank/tracks.js'), /oeffneAchsenMenue\(/);
  for (const n of ['werkbank/tracks.js', 'werkbank/sound.js']) assert.match(lies(n), /oeffneInstrumentMenue\(/, `${n} opens its menu through the one helper`);
});

// ---- PRODUCTION device browser ----
const KAT = katalog(G);
test('catalogue: instrument rows carry kategorie and prinzip when the graph has them, nothing invented when it has not', () => {
  const rows = KAT.instrumente;
  assert.deepEqual(rows.slice(0, 2).map((r) => r.geraet), ['rb338', 'surge']);
  assert.deepEqual(rows.find((r) => r.graph === 'ms20-bass'), { geraet: 'bk', titel: 'ms20-bass', ziel: 'spur_neu', graph: 'ms20-bass', kategorie: 'bass', prinzip: 'analog' });
  assert.deepEqual(rows.find((r) => r.graph === 'eigen'), { geraet: 'bk', titel: 'eigen', ziel: 'spur_neu', graph: 'eigen' });
  assert.deepEqual(rows.find((r) => r.graph === 'rolle-nur'), { geraet: 'bk', titel: 'rolle-nur', ziel: 'spur_neu', graph: 'rolle-nur', kategorie: 'lead' });
  assert.deepEqual(katalog([{ name: 'x', art: 'instrument' }]).instrumente[2], { geraet: 'bk', titel: 'x', ziel: 'spur_neu', graph: 'x' }, 'an entry without both is byte for byte as before');
  assert.ok(KAT.effekte.every((e) => !('prinzip' in e)));
});

const zeilen = (h) => [...h.matchAll(/<li data-geraet-i="(\d+)"[^>]*>(.*?)<\/li>/gs)].map((m) => ({ i: Number(m[1]), html: m[2], name: /geraete-name">([^<]*)</.exec(m[2])?.[1] }));
const ueberschriften = (h) => [...h.matchAll(/<h5[^>]*>([^<]*)<\/h5>/g)].map((m) => text(m[1]));

test('device browser: RB-338 and Surge first, then h5 groups of the axis inside the INSTRUMENTS list; the entry without prinzip is under Other', () => {
  const h = geraeteHtml(KAT, 'prinzip');
  assert.deepEqual(ueberschriften(h), ['Analog', 'FM', 'Strings & Bodies', 'Drum Synthesis', 'Other']);
  const inst = h.split('<h4>EFFECTS</h4>')[0];
  assert.match(inst, /INSTRUMENTS<\/h4><ul class="geraete-liste"><li data-geraet-i="0"[^>]*>.*?RB-338.*?<li data-geraet-i="1"[^>]*>.*?Surge.*?<li class="geraete-gruppe"><h5>Analog<\/h5><\/li>/s);
  const ohne = inst.slice(inst.indexOf('<h5>Other</h5>'));
  assert.ok(['eigen', 'rolle-nur', 'unbekannt'].every((n) => ohne.includes(`>${n}<`)), 'nothing dropped');
  assert.equal(geraeteHtml(KAT), h, 'the default axis is the type');
  const r = geraeteHtml(KAT, 'rolle');
  assert.deepEqual(ueberschriften(r), ['Drums', 'Bass', 'Lead', 'Keys & Plucks', 'Other']);
  assert.match(r, /geraete-neben">· Analog</);
  assert.match(h, /geraete-neben">· Bass</);
});

test('device browser: data-geraet-i counts in display order and eintraege() lists the entries in that same order, so a drop finds its entry on both axes', () => {
  for (const achse of ACHSEN) {
    const h = geraeteHtml(KAT, achse);
    const z = zeilen(h);
    const e = eintraege(KAT, achse);
    assert.equal(z.length, e.length, achse);
    assert.deepEqual(z.map((x) => x.i), z.map((_, i) => i), `${achse}: indices run 0..n in the order shown`);
    assert.deepEqual(z.map((x) => x.name), e.map((x) => x.titel), `${achse}: row n is entry n`);
  }
  assert.notDeepEqual(eintraege(KAT, 'prinzip').map((x) => x.titel), eintraege(KAT, 'rolle').map((x) => x.titel), 'the order does follow the axis');
});

test('device browser without graphs or with a catalogue of the old shape: no group heading, as before', () => {
  const h = geraeteHtml({ instrumente: [{ geraet: 'rb338', titel: 'RB-338', ziel: 'spur_neu' }, { geraet: 'surge', titel: 'Surge', ziel: 'spur_neu' }], effekte: [] }, 'prinzip');
  assert.deepEqual(ueberschriften(h), []);
  assert.match(geraeteHtml(null), /Loading/);
});

test('page code: the pickers read the axis, the TYPE/ROLE click stores it and sends nothing', () => {
  const lies = (n) => readFileSync(new URL(`../public/${n}`, import.meta.url), 'utf8');
  const bindung = lies('effects_bindung.js');
  const block = /button\.graphachse[\s\S]{0,400}/.exec(bindung)?.[0] ?? '';
  assert.match(block, /merkeAchse\(/);
  assert.doesNotMatch(block, /postJson|waehleGraph|fetch/, 'switching the axis sends nothing');
  assert.match(lies('graphs_view.js'), /beiAchse\(/, 'the pickers redraw when the axis changes');
  assert.match(lies('collections.js'), /geraeteZeilen\(katalog, leseAchse\(\)\)\[Number\(e\.target\?\.closest\?\.\('\[data-geraet-i\]'\)/, 'the right click on a device row finds its entry in display order');
});
