// Live dock: the pure card model of the EFFECTS tab and its menu entries (no DOM, no I/O).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FX_REITER } from '../public/effects_reiter.js';
import {
  LIVE_KANAELE, FX_INDEX, graphArtVon, liveModell, gestaltLive, knopfBereich, wertVonK, kVonWert,
  chipPunkte, kartenPunkte, wechselWahl, effektWahl, spektrumWert,
} from '../public/live_dock/model.js';

const front8 = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ param: `k${i}`, name: `Knob ${i}`, vorgabe: 0.5 }));
const graphen = [
  { name: 'bass-acid', art: 'instrument', kategorie: 'bass' },
  { name: 'lead-saw', art: 'instrument', kategorie: 'lead' },
  { name: 'echo-tape', art: 'effekt' },
  { name: 'a-very-long-effect-name', art: 'effekt' },
];
function stand(extra = {}) {
  return {
    regler: {}, geladen: {}, graphen, front: { 'lead-saw': front8, 'bass-acid': front8.slice(0, 2) },
    hostNamen: {}, inhalt: { 'deck/1': 'Song A' }, gewaehlt: 'erz/1', limiter: { gebaut: true, grund: '' }, ...extra,
  };
}
function tiefEinfrieren(o) { if (o && typeof o === 'object') { Object.values(o).forEach(tiefEinfrieren); Object.freeze(o); } return o; }
const karte = (m, id) => [...m.zeilen.flatMap((z) => z.karten), ...m.master].find((c) => c.id === id);
const teile = (k) => k.teile.map((t) => t.teil);

test('ten channel cards in D5 order with exact labels and colours, FX3, FX4, one MASTER card', () => {
  const m = liveModell(stand());
  assert.equal(m.zeilen.length, 2);
  assert.deepEqual([m.zeilen[0].key, m.zeilen[0].titel, m.zeilen[0].w], ['kanaele', 'CHANNELS', 'dock-kanaele']);
  assert.deepEqual([m.zeilen[1].key, m.zeilen[1].titel, m.zeilen[1].w], ['fx', 'EFFECTS', 'dock-fx']);
  const kanaele = m.zeilen[0].karten;
  assert.deepEqual(kanaele.map((c) => [c.id, c.kurz, c.name, c.farbe]), [
    ['deck/1', 'A', 'A', 'var(--a)'], ['deck/2', 'B', 'B', 'var(--b)'],
    ['erz/1', 'I1', 'DRUMS', 'var(--c)'], ['erz/2', 'I2', 'BASS', 'var(--c)'], ['erz/3', 'I3', 'MELODY', 'var(--c)'],
    ['erz/5', 'I5', 'I5', 'var(--c)'], ['erz/6', 'I6', 'I6', 'var(--c)'], ['erz/7', 'I7', 'I7', 'var(--c)'],
    ['pad/1', 'L1', 'L1', 'var(--c3)'], ['pad/2', 'L2', 'L2', 'var(--c3)'],
  ]);
  assert.ok(kanaele.every((c) => c.art === 'kanal'));
  const fx = m.zeilen[1].karten;
  assert.deepEqual(fx.map((c) => [c.id, c.kurz, c.name, c.farbe, c.art]), [
    ['fx/3', '3', 'FX3', 'var(--c2)', 'ret'], ['fx/4', '4', 'FX4', 'var(--c2)', 'ret']]);
  assert.equal(m.master.length, 1);
  assert.equal(m.master[0].id, 'master');
  assert.equal(m.master[0].name, 'MASTER');
  assert.equal(m.master[0].art, 'master');
});

test('BASS with an instrument graph: instrument is the subtitle, never a chip', () => {
  const k = karte(liveModell(stand({ geladen: { 'erz/2': 'bass-acid' } })), 'erz/2');
  assert.equal(k.untertitel, 'bass-acid');
  assert.equal(k.untertitelArt, 'instrument');
  assert.deepEqual(teile(k), ['gate', 'komp', 'util']);
  assert.ok(k.teile.every((t) => !/INSERT/i.test(t.text)));
  assert.ok(k.wechsel && k.auf);
  assert.equal(k.plus, null);
  assert.deepEqual(k.knoepfe.map((x) => x.param), ['bk:k1', 'bk:k2']);
  assert.equal(k.knopfGruppe, null);
  assert.equal(k.inhalt.text, '–');
});

test('BASS with nothing loaded and host Surge XT: host name as subtitle, no knobs', () => {
  const k = karte(liveModell(stand({ hostNamen: { 'erz/2': 'Surge XT' } })), 'erz/2');
  assert.equal(k.untertitel, 'Surge XT');
  assert.deepEqual(k.knoepfe, []);
  assert.deepEqual(k.teile.map((t) => t.text), ['GATE', 'COMP', 'UTIL']);
  const leer = karte(liveModell(stand()), 'erz/3');
  assert.equal(leer.untertitel, 'Surge XT');
  assert.equal(karte(liveModell(stand({ hostNamen: { 'erz/3': 'Pianoteq' } })), 'erz/3').untertitel, 'Pianoteq');
});

test('BASS with an effect graph (remix case): the effect is a chip, the subtitle says No instrument', () => {
  const k = karte(liveModell(stand({ geladen: { 'erz/2': 'echo-tape' } })), 'erz/2');
  assert.deepEqual(teile(k), ['insert', 'gate', 'komp', 'util']);
  assert.equal(k.teile[0].text, 'echo-tape');
  assert.equal(k.teile[0].art, 'effekt');
  assert.equal(k.teile[0].titel, 'Effect echo-tape on BASS');
  assert.equal(k.untertitel, 'No instrument');
  assert.equal(k.untertitelArt, 'instrument');
  assert.ok(k.wechsel);
  assert.deepEqual(k.knoepfe, []);
});

test('instrument channel without any host name: No instrument', () => {
  const k = karte(liveModell(stand()), 'erz/5');
  assert.equal(k.untertitel, 'No instrument');
  assert.ok(k.wechsel && k.auf);
});

test('deck A: effect chip first, plus.aus follows the loaded effect, subtitle is what plays, COMP knobs', () => {
  const mit = karte(liveModell(stand({ geladen: { 'deck/1': 'echo-tape' } })), 'deck/1');
  assert.deepEqual(teile(mit), ['insert', 'gate', 'komp', 'util']);
  assert.equal(mit.plus.aus, true);
  assert.match(mit.plus.titel, /one effect/);
  const leer = karte(liveModell(stand()), 'deck/1');
  assert.deepEqual(teile(leer), ['gate', 'komp', 'util']);
  assert.equal(leer.plus.aus, false);
  assert.equal(leer.plus.titel, 'Add an effect to this channel');
  assert.equal(leer.untertitel, 'Song A');
  assert.equal(leer.untertitelArt, 'inhalt');
  assert.equal(leer.inhalt, null);
  assert.ok(!leer.wechsel && !leer.auf);
  assert.deepEqual(leer.knoepfe.map((x) => x.param), ['komp/schwelle', 'komp/ratio', 'komp/mix']);
  assert.equal(leer.knopfGruppe, 'COMP');
  assert.equal(leer.knoepfe[0].titel, 'Compressor threshold of A');
  assert.equal(karte(liveModell(stand()), 'deck/2').untertitel, '–');
});

test('an effect graph name is cut for the chip', () => {
  const k = karte(liveModell(stand({ geladen: { 'deck/1': 'a-very-long-effect-name' } })), 'deck/1');
  assert.equal(k.teile[0].text, 'a-very-lon…');
  assert.match(k.teile[0].titel, /a-very-long-effect-name/);
});

test('DRUMS has no plus and no wechsel', () => {
  const k = karte(liveModell(stand()), 'erz/1');
  assert.equal(k.plus, null);
  assert.equal(k.wechsel, false);
  assert.equal(k.auf, false);
});

test('I5 with lead-saw: six knobs bk:k1 to bk:k6; an instrument graph on any channel is the subtitle', () => {
  const k = karte(liveModell(stand({ geladen: { 'erz/5': 'lead-saw' } })), 'erz/5');
  assert.deepEqual(k.knoepfe.map((x) => x.param), ['bk:k1', 'bk:k2', 'bk:k3', 'bk:k4', 'bk:k5', 'bk:k6']);
  assert.equal(k.knoepfe[0].titel, 'Knob 1 of I5');
  assert.equal(k.knoepfe[0].vorgabe, 0.5);
  const deck = karte(liveModell(stand({ geladen: { 'deck/1': 'lead-saw' } })), 'deck/1');
  assert.equal(deck.untertitel, 'lead-saw');
  assert.equal(deck.untertitelArt, 'instrument');
  assert.deepEqual(teile(deck), ['gate', 'komp', 'util']);
});

test('COMP chip follows komp/an; its title carries the key source', () => {
  const aus = karte(liveModell(stand()), 'erz/1').teile.find((t) => t.teil === 'komp');
  assert.equal(aus.an, false);
  assert.equal(aus.gr, true);
  assert.equal(aus.grSkala, 24);
  assert.equal(aus.titel, 'Compressor of DRUMS');
  const an = karte(liveModell(stand({ regler: { 'erz/1/komp/an': 1, 'erz/1/komp/sc': 6 } })), 'erz/1').teile.find((t) => t.teil === 'komp');
  assert.equal(an.an, true);
  assert.match(an.titel, /KEY BASS/);
  const gate = karte(liveModell(stand({ regler: { 'erz/1/gate/an': 1 } })), 'erz/1').teile.find((t) => t.teil === 'gate');
  assert.deepEqual([gate.an, gate.gr, gate.grSkala], [true, true, 60]);
  const util = karte(liveModell(stand()), 'erz/1').teile.find((t) => t.teil === 'util');
  assert.deepEqual([util.an, util.gr], [true, false]);
});

test('channel cards carry meter, level text, menu and the chosen flag', () => {
  const m = liveModell(stand({ gewaehlt: 'erz/2' }));
  const b = karte(m, 'erz/2');
  assert.deepEqual([b.meter, b.pegelText, b.menue, b.aktiv], ['erz/2', true, true, true]);
  assert.equal(karte(m, 'erz/1').aktiv, false);
});

test('FX3 and FX4: effect cards without chips', () => {
  const m = liveModell(stand({ geladen: { 'fx/3': 'echo-tape' }, front: { 'echo-tape': front8 } }));
  const a = karte(m, 'fx/3'), b = karte(m, 'fx/4');
  assert.deepEqual([a.untertitel, a.untertitelArt, a.wechsel, a.auf], ['echo-tape', 'effekt', true, true]);
  assert.deepEqual([b.untertitel, b.untertitelArt, b.wechsel, b.auf], ['No effect', 'effekt', true, false]);
  assert.deepEqual(a.teile, []);
  assert.equal(a.plus, null);
  assert.equal(a.knoepfe.length, 4);
  assert.deepEqual([a.meter, a.pegelText, a.menue], [null, false, false]);
});

test('MASTER: effect chip, GLUE, LIMITER, four bus chips in a BUS section, glue knob', () => {
  const m = liveModell(stand({ geladen: { master: 'echo-tape' }, regler: { 'master/kleber': 0.3, 'bus/2/mb/an': 1 } }));
  const k = m.master[0];
  assert.deepEqual(teile(k), ['insert', 'glue', 'limiter', 'bus/1', 'bus/2', 'bus/3', 'bus/4']);
  assert.equal(k.kurz, '');
  assert.equal(k.teile.find((t) => t.teil === 'glue').an, true);
  const lim = k.teile.find((t) => t.teil === 'limiter');
  assert.deepEqual([lim.an, lim.gr, lim.grSkala], [true, true, 24]);
  assert.deepEqual(k.teile.filter((t) => t.teil.startsWith('bus/')).map((t) => [t.text, t.abschnitt, t.an, t.art]),
    [['BUS 1', 'BUS', false, 'bus'], ['BUS 2', 'BUS', true, 'bus'], ['BUS 3', 'BUS', false, 'bus'], ['BUS 4', 'BUS', false, 'bus']]);
  assert.equal(k.plus.aus, true);
  assert.deepEqual(k.knoepfe, [{ param: 'kleber', name: 'GLUE', titel: 'Master glue compressor', vorgabe: 0 }]);
  assert.deepEqual([k.auf, k.meter, k.menue], [true, 'master', false]);
  const leer = liveModell(stand()).master[0];
  assert.equal(leer.teile.find((t) => t.teil === 'glue').an, false);
  assert.ok(!leer.teile.some((t) => t.teil === 'insert'));
  assert.equal(leer.plus.aus, false);
  const lim2 = liveModell(stand({ regler: { 'bus/3/lim/an': 1 } })).master[0].teile.find((t) => t.teil === 'bus/3');
  assert.equal(lim2.an, true);
});

test('graphArtVon: empty is null, own art, unknown name takes the channel kind', () => {
  assert.equal(graphArtVon('erz/2', '', graphen), null);
  assert.equal(graphArtVon('erz/2', 'echo-tape', graphen), 'effekt');
  assert.equal(graphArtVon('deck/1', 'lead-saw', graphen), 'instrument');
  assert.equal(graphArtVon('erz/2', 'unbekannt', graphen), 'instrument');
  assert.equal(graphArtVon('deck/1', 'unbekannt', graphen), 'effekt');
  assert.equal(graphArtVon('erz/1', 'unbekannt', graphen), null);
});

test('gestaltLive: values do not change it, a loaded graph does', () => {
  const a = gestaltLive(liveModell(stand()));
  assert.equal(typeof a, 'string');
  const werte = stand({ regler: { 'deck/1/komp/an': 1, 'deck/1/gate/an': 1, 'master/kleber': 0.5 }, gewaehlt: 'pad/1', inhalt: { 'deck/1': '▶ other' } });
  assert.equal(gestaltLive(liveModell(werte)), a);
  assert.equal(gestaltLive(liveModell(stand({ geladen: { 'deck/1': 'echo-tape' } }))) === a, false);
  assert.equal(gestaltLive(liveModell(stand({ geladen: { 'erz/5': 'lead-saw' } }))) === a, false);
});

test('chipPunkte: komp of DRUMS', () => {
  const s = stand({ regler: { 'erz/1/komp/sc': 6, 'erz/1/komp/an': 1 } });
  const k = karte(liveModell(s), 'erz/1');
  const p = chipPunkte(k, 'komp', s);
  assert.equal(p[0].text, 'Bypass');
  assert.equal(p[0].aktion, 'komp-an');
  const sc = p.filter((x) => x.aktion === 'komp-sc');
  assert.ok(!sc.some((x) => /DRUMS/.test(x.text)));
  assert.deepEqual(sc.map((x) => x.text), ['own signal', '✓ BASS', 'MELODY', 'A', 'B', 'L1', 'L2']);
  assert.deepEqual(sc.map((x) => x.wert), [0, 6, 7, 1, 2, 13, 14]);
  assert.ok(p.some((x) => x.gruppe && x.text === 'Key source'));
  const pre = p.filter((x) => x.aktion === 'komp-preset');
  assert.equal(pre.length, 6);
  assert.ok(pre.some((x) => x.wert === 'Kick Sidechain' && x.text === 'Kick Sidechain'));
  assert.equal(p[p.length - 1].aktion, 'komp-verlauf');
  assert.equal(p[p.length - 1].text, 'Gain reduction history');
  assert.equal(chipPunkte(k, 'komp', stand())[0].text, 'Enable');
  assert.equal(chipPunkte(k, 'komp', stand()).find((x) => x.aktion === 'komp-sc' && x.wert === 0).text, '✓ own signal');
});

test('chipPunkte: gate, util, insert, bus, glue, limiter', () => {
  const s = stand({ regler: { 'erz/2/util/phase_l': 1, 'erz/2/gate/an': 1 }, limiter: { gebaut: false, grund: 'limiter not built (x)' } });
  const m = liveModell(s);
  const b = karte(m, 'erz/2');
  assert.deepEqual(chipPunkte(b, 'gate', s).map((x) => [x.text, x.aktion]), [['Bypass', 'gate-an']]);
  assert.equal(chipPunkte(karte(m, 'erz/1'), 'gate', s)[0].text, 'Enable');
  assert.deepEqual(chipPunkte(b, 'util', s).map((x) => [x.text, x.aktion, x.wert]), [
    ['✓ Ø L', 'util-schalter', 'util/phase_l'], ['Ø R', 'util-schalter', 'util/phase_r'],
    ['SWAP', 'util-schalter', 'util/tausch'], ['DC', 'util-schalter', 'util/dc']]);
  assert.deepEqual(chipPunkte(b, 'insert', s).map((x) => [x.text, x.aktion]), [['Change effect…', 'effekt-wechsel'], ['Remove', 'effekt-weg']]);
  const ms = karte(m, 'master');
  const bus = chipPunkte(ms, 'bus/2', s);
  assert.deepEqual(bus.map((x) => x.aktion), ['bus-mb', 'bus-lim']);
  assert.equal(bus[0].text, 'MULTIBAND on');
  assert.equal(bus[1].aus, true);
  assert.equal(bus[1].titel, 'limiter not built (x)');
  assert.equal(bus[0].aus, undefined);
  const s2 = stand({ regler: { 'bus/2/mb/an': 1, 'bus/2/lim/an': 1 } });
  const bus2 = chipPunkte(ms, 'bus/2', s2);
  assert.deepEqual(bus2.map((x) => x.text), ['MULTIBAND off', 'LIMITER off']);
  assert.equal(bus2[1].aus, undefined);
  assert.deepEqual(chipPunkte(ms, 'glue', s), []);
  assert.deepEqual(chipPunkte(ms, 'limiter', s), []);
});

test('kartenPunkte: Spectrum for channels, Loop automation for the pads only', () => {
  const m = liveModell(stand());
  const l1 = kartenPunkte(karte(m, 'pad/1'));
  assert.ok(l1.some((x) => x.text === 'Loop automation…' && x.aktion === 'automation' && x.wert === 1));
  assert.ok(l1.some((x) => x.text === 'Spectrum' && x.aktion === 'spektrum'));
  assert.equal(kartenPunkte(karte(m, 'pad/2')).find((x) => x.aktion === 'automation').wert, 2);
  const a = kartenPunkte(karte(m, 'deck/1'));
  assert.ok(!a.some((x) => x.text === 'Loop automation…'));
  assert.ok(a.some((x) => x.aktion === 'spektrum'));
});

test('wechselWahl and effektWahl', () => {
  const s = stand();
  const w = wechselWahl('erz/2', s);
  assert.deepEqual(w[w.length - 1], { gruppe: 'No graph', text: 'Surge XT', name: '' });
  assert.deepEqual(w.slice(0, -1).map((x) => [x.gruppe, x.text, x.name]), [['Baukasten', 'bass-acid', 'bass-acid'], ['Baukasten', 'lead-saw', 'lead-saw']]);
  assert.equal(wechselWahl('erz/5', s).at(-1).text, 'Off');
  assert.equal(wechselWahl('erz/2', stand({ hostNamen: { 'erz/2': 'Pianoteq' } })).at(-1).text, 'Pianoteq');
  const e = effektWahl('deck/1', stand({ geladen: { 'deck/1': 'echo-tape' } }));
  assert.deepEqual(e.find((x) => x.wert === 'echo-tape'), { text: 'echo-tape', wert: 'echo-tape', aus: true });
  assert.equal(e.find((x) => x.wert === 'a-very-long-effect-name').aus, false);
  assert.deepEqual(e.at(-1), { text: 'Remove', wert: '', aus: false });
  assert.ok(!effektWahl('deck/1', s).some((x) => x.text === 'Remove'));
  assert.ok(!e.some((x) => x.wert === 'lead-saw'));
});

test('knob conversions', () => {
  const k = kVonWert('komp/schwelle', -18);
  assert.ok(Math.abs(k - 0.7) < 1e-9);
  assert.ok(Math.abs(wertVonK('komp/schwelle', k) + 18) < 1e-9);
  assert.equal(kVonWert('komp/schwelle', -100), 0);
  assert.equal(kVonWert('komp/schwelle', 10), 1);
  assert.equal(wertVonK('komp/ratio', 0), 1);
  assert.equal(wertVonK('komp/ratio', 1), 20);
  assert.equal(knopfBereich('kleber').text(0), 'OFF');
  assert.equal(knopfBereich('kleber').text(0.5), '50%');
  assert.deepEqual([knopfBereich('kleber').min, knopfBereich('kleber').max], [0, 1]);
  assert.equal(knopfBereich('komp/ratio').text(4), '4.0:1');
  assert.equal(knopfBereich('bk:k1'), null);
  assert.equal(knopfBereich('komp/gibtsnicht'), null);
});

test('spektrumWert', () => {
  assert.equal(spektrumWert('deck/1'), 1);
  assert.equal(spektrumWert('erz/1'), 5);
  assert.equal(spektrumWert('nichts'), 0);
});

test('LIVE_KANAELE and FX_INDEX are bound to FX_REITER', () => {
  const ids = FX_REITER.map((r) => r.id).filter((id) => id !== 'master' && id !== 'sends' && id !== 'bus');
  assert.deepEqual(LIVE_KANAELE.map(([id]) => id), ids);
  assert.deepEqual(Object.keys(FX_INDEX), ids);
  assert.deepEqual(LIVE_KANAELE.map(([, , name]) => name), FX_REITER.filter((r) => ids.includes(r.id)).map((r) => r.text));
});

test('a deep-frozen snapshot does not throw', () => {
  const s = tiefEinfrieren(stand({ geladen: { 'erz/2': 'bass-acid', 'deck/1': 'echo-tape', master: 'echo-tape' }, regler: { 'erz/1/komp/an': 1 } }));
  const m = liveModell(s);
  gestaltLive(m);
  for (const c of [...m.zeilen.flatMap((z) => z.karten), ...m.master]) {
    kartenPunkte(c);
    for (const t of c.teile) chipPunkte(c, t.teil, s);
  }
  wechselWahl('erz/2', s);
  effektWahl('deck/1', s);
});
