// Effekt-Sektion: Kennlinie wie komp_dsp (Gl. 4), Presets der Seite gleich denen des VST3.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GERAETE } from '../presets/devices.ts';
import { WERK_FELDER, WERK_STREIFEN, werkText, werkzeugStreifenHtml, werkzeugKlickNach, werkzeugAnfrage, setzeWerkzeug,
  BUS_FELDER, BUS_KANAELE, busStreifenHtml, limiterZustand, LIMITER_GRUND, mixAufnehmen, mixLesung, MIX_FRIST_MS,
  GATE_KANAELE, gateAufnehmen, mixAblaufIn, MIX_FELDER } from '../public/effects.js';
import { kanalArtVon, kernGeraetAnfragen, kernGeraetWerte } from '../public/presets.js';
import { kennlinie, kennlinienPfad, KOMP_PRESETS, AUTO_BEREICH, punktAusStelle, fxInhaltText } from '../public/effects.js';
import { AUTO_BEREICH as SERVER_AUTO, pruefeAutomation } from '../loop_automation.ts';
import { AUTO_VORLAGEN, vorlagePunkte, knobListe, KNOB_GRUPPE, htmlText, bkKnobListe, bkKnobHtml, graphWahlOptionen, graphWahlHtml, instrumentWahlHtml, instrumentKategorien, hostName, GRAPH_KATEGORIEN, sendRueckHtml, lernKnopfHtml, lernStand } from '../public/effects.js';

test('Baukasten S2 knobListe: nur gemeldete Knobs, Namen aus dem Graphen, sonst „Knob n“; Surge ohne Knobs → leer', () => {
  const l = knobListe({ Volume: 0.75, 'Knob 1': 0.25, 'Knob 2': 1.5, 'Knob 8': 0 }, { 'Knob 1': 'Cutoff' });
  assert.deepEqual(l, [
    { nr: 1, param: 'Knob 1', name: 'Cutoff', wert: 0.25 },
    { nr: 2, param: 'Knob 2', name: 'Knob 2', wert: 1 },
    { nr: 8, param: 'Knob 8', name: 'Knob 8', wert: 0 },
  ]);
  assert.deepEqual(knobListe({ volume: -12, a_filter1_cutoff: 0.4 }), []);
  assert.deepEqual(knobListe(undefined), []);
  assert.deepEqual(knobListe({ 'Knob 3': 'x', 'Knob 4': NaN }), []);
  assert.deepEqual(KNOB_GRUPPE, { 'erz/2': 'bass', 'erz/3': 'melodie' });
});

test('Kennlinie: unter dem Knie unverändert, darüber 1/R, Knie stetig (Werte wie comp_dsp/tests/komp.rs)', () => {
  assert.equal(kennlinie(-40, -20, 4, 10), -40);
  assert.ok(Math.abs(kennlinie(0, -20, 4, 10) - -15) < 1e-9);
  assert.ok(Math.abs(kennlinie(-20, -20, 4, 10) - (-20 - 0.9375)) < 1e-9);
  assert.ok(Math.abs(kennlinie(-15, -20, 4, 10) - (-20 + 5 / 4)) < 1e-9);
  assert.ok(Math.abs(kennlinie(-16, -20, 4, 0) - -19) < 1e-9);
});

test('Kennlinienpfad: 121 Punkte, beginnt links unten, Makeup hebt', () => {
  const p = kennlinienPfad(-20, 4, 0, 120, 84);
  assert.equal(p.split(' L').length, 121);
  assert.ok(p.startsWith('M0.0,84.0'));
  assert.notEqual(kennlinienPfad(-20, 4, 6, 120, 84), p);
});

test('Presets der Seite = Presets des VST3; Sidechain = Schlüssel DRUMS (5), sonst ausdrücklich 0', () => {
  const vst = JSON.parse(readFileSync(new URL('../../instruments/comp/presets/presets.json', import.meta.url), 'utf8'));
  const feld = { thresh: 'schwelle', ratio: 'ratio', attack: 'attack', release: 'release', makeup: 'makeup', mix: 'mix' };
  const alle = Object.entries(vst).filter(([n]) => !n.startsWith('_'));
  assert.deepEqual(Object.keys(KOMP_PRESETS).sort(), alle.map(([n]) => n).sort());
  for (const [n, w] of alle) {
    for (const [a, b] of Object.entries(feld)) assert.equal(KOMP_PRESETS[n][b], w[a], `${n} ${b}`);
    assert.equal(KOMP_PRESETS[n].sc, w.extsc ? 5 : 0, `${n} sc`);
  }
});

test('Automation: Bereiche der Seite = Bereiche des Servers; Punkt aus der Stelle gerastet und begrenzt', () => {
  assert.deepEqual(AUTO_BEREICH, SERVER_AUTO);
  assert.deepEqual(punktAusStelle(0, 0, 480, 120, 8, [-60, 0]), [0, 0]);
  assert.deepEqual(punktAusStelle(240, 120, 480, 120, 8, [-60, 0]), [4, -60]);
  assert.deepEqual(punktAusStelle(479, 60, 480, 120, 8, [-1, 1]), [7.75, 0]);   // nie auf beats selbst
});

test('Inhalt je Kanal aus der Lage: Deck, Strudel mit Klang, Box, leer', () => {
  const lage = { decks: [{ deck: 1, status: 3, titel: 'Uppermost', camelot: '1A' }, { deck: 2, status: 0 }],
    boxen: { 1: { status: 3, name: 'komp-roh-drums', beats: 8 } },
    studio: { stroeme: [{ strom: 1, autonom: true, text_kurz: 'stack(s("bd*4"))' }, { strom: 2, autonom: false, text_kurz: 'silence' }], klang: { bass: 'vst3:rb338' } } };
  assert.equal(fxInhaltText('deck/1', lage), '▶ Uppermost · 1A');
  assert.equal(fxInhaltText('deck/2', lage), 'empty');
  assert.equal(fxInhaltText('pad/1', lage), '▶ komp-roh-drums · 8 beats');
  assert.equal(fxInhaltText('pad/2', lage), 'empty');
  assert.equal(fxInhaltText('erz/1', lage), '▶ stack(s("bd*4"))');
  assert.equal(fxInhaltText('erz/2', lage), 'rb338 · silence · AUTO off');
});

test('Automations-Vorlagen: jede passt zu ihrem Ziel und besteht die Prüfung des Servers, auf 1 bis 32 Durchgängen', () => {
  let n = 0;
  for (const [pfad, liste] of Object.entries(AUTO_VORLAGEN)) {
    assert.ok(pfad in SERVER_AUTO, pfad);
    for (const v of liste) for (const beats of [1, 4, 8, 32]) for (const d of [1, 8, 32]) {
      const punkte = vorlagePunkte(v, beats * d);
      const r = pruefeAutomation([{ pfad, punkte, durchgaenge: d }], beats);
      assert.ok('automation' in r, `${pfad} ${v.name} ${beats}x${d}: ${JSON.stringify(r)}`);
      n++;
    }
  }
  assert.ok(n > 200);
  // Gegenprobe: ein Wert außerhalb des Bereichs fällt durch
  assert.ok('fehler' in pruefeAutomation([{ pfad: 'send/2', punkte: vorlagePunkte({ punkte: [[0, -70]] }, 8) }], 8));
});

test('Baukasten S2 htmlText: Knob-Namen aus der Graphdatei gehen als Text, nicht als HTML auf die Seite (Review F2)', () => {
  assert.equal(htmlText('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(htmlText(`a"b'c&d`), 'a&quot;b&#39;c&amp;d');
  assert.equal(htmlText('Cutoff'), 'Cutoff');
});

test('S5r bkKnobListe: eight graph knobs per channel with a graph, value from the control state (default 0.5), none for host channels', () => {
  const l = bkKnobListe('deck/2', { 'deck/2/bk/3': 0.8, 'deck/2/bk/4': 7, 'deck/1/bk/1': 0.1, 'deck/2/bk/5': 'x' });
  assert.deepEqual(l.map((k) => k.pfad), [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `deck/2/bk/${n}`));
  assert.deepEqual(l.map((k) => k.name), [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `Knob ${n}`));
  assert.deepEqual(l.map((k) => k.wert), [0.5, 0.5, 0.8, 1, 0.5, 0.5, 0.5, 0.5]);   // 7 is clamped, 'x' falls back to the default
  assert.equal(bkKnobListe('pad/1', undefined).length, 8);
  assert.equal(bkKnobListe('erz/1', {}).length, 8);
  // channels with an instrument host block (Knob 1..8 through /klang) and channels without a graph get none
  for (const k of ['erz/2', 'erz/3', 'erz/4', 'bus/1', 'master']) assert.deepEqual(bkKnobListe(k, {}), [], k);
});

// 64 knobs: the legacy slider field shows as many rows as the graph defines, 8 to 64
test('64 knobs bkKnobListe: row count follows the highest named knob (8 at least, 64 at most); knob 9, 32 and 64 have their paths', () => {
  const n = (g) => bkKnobListe('deck/1', {}, { graph: g }).length;
  assert.equal(n({ name: 'a', regler_namen: {} }), 8);
  assert.equal(n({ name: 'a', regler_namen: { 1: 'x', 8: 'y' } }), 8);
  assert.equal(n({ name: 'a', regler_namen: { 9: 'nine' } }), 9);
  assert.equal(n({ name: 'a', regler_namen: { 1: 'x', 17: 'seventeen' } }), 17);
  assert.equal(n({ name: 'a', regler_namen: { 32: 'last' } }), 32);
  assert.equal(n({ name: 'a', regler_namen: { 33: 'first of the upper half', 48: 'x' } }), 48);
  assert.equal(n({ name: 'a', regler_namen: { 64: 'last' } }), 64);
  assert.equal(n({ name: 'a', regler_namen: { 65: 'over', 0: 'zero' } }), 8, 'outside 1..64 does not count');
  assert.equal(n({ name: 'a', regler_namen: {}, regler: { 12: { min: 0, max: 1, log: false } } }), 12, 'the knob ranges of a panel answer count too');
  assert.equal(bkKnobListe('deck/1', {}, { graph: null }).length, 8, 'no graph info: 1..8 as before');
  const l = bkKnobListe('erz/5', { 'erz/5/bk/9': 0.2, 'erz/5/bk/32': 0.9, 'erz/5/bk/64': 0.4 }, { graph: { name: 'a', regler_namen: { 64: 'Last' } } });
  assert.deepEqual([l[8].pfad, l[8].wert, l[8].name], ['erz/5/bk/9', 0.2, 'Knob 9']);
  assert.deepEqual([l[31].pfad, l[31].wert, l[31].name], ['erz/5/bk/32', 0.9, 'Knob 32']);
  assert.deepEqual([l[63].pfad, l[63].wert, l[63].name], ['erz/5/bk/64', 0.4, 'Last']);
  assert.equal(new Set(l.map((k) => k.pfad)).size, 64);
});

// ---- Baukasten S12 task 3: graph picker and named graph knobs --------------------------------------------------------------
const GRAPHEN = [
  { name: 'sampler-fairlight', art: 'instrument', regler_namen: { 1: 'Rate', 2: 'Reverse (top third)' } },
  { name: 'saite', art: 'instrument', regler_namen: {} },
  { name: 'fx-bandecho', art: 'effekt', regler_namen: { 1: 'Time' } },
  { name: 'fx-takt-pump', art: 'effekt', regler_namen: {} },
];

test('S12 bkKnobListe: erz/3 with a loaded graph shows eight knobs named from regler_namen, others "Knob n"; without a graph none (Surge knobs stay)', () => {
  const g = { name: 's', regler_namen: { 1: 'Rate' } };
  const l = bkKnobListe('erz/3', { 'erz/3/bk/2': 0.25 }, { graph: g });
  assert.equal(l.length, 8);
  assert.equal(l[0].name, 'Rate');
  assert.equal(l[1].name, 'Knob 2');
  assert.equal(l[1].wert, 0.25);
  assert.equal(l[0].pfad, 'erz/3/bk/1');
  assert.deepEqual(bkKnobListe('erz/3', {}), [], 'no graph: the Surge knobs stay');
  assert.deepEqual(bkKnobListe('erz/3', {}, { graph: null }), []);
  assert.equal(bkKnobListe('erz/2', {}, { graph: g }).length, 8);
  assert.equal(bkKnobListe('deck/1', {}, { graph: g })[0].name, 'Rate', 'effect channels name their knobs too');
  assert.equal(bkKnobListe('deck/1', {})[0].name, 'Knob 1', 'a channel without graph info keeps the plain names');
  // S14: the send returns fx/3, fx/4 have eight kern knobs fx/<n>/bk/1..8 (flipped from [] in S12)
  const f3 = bkKnobListe('fx/3', { 'fx/3/bk/2': 0.8 }, { graph: g });
  assert.deepEqual(f3.map((x) => x.pfad), Array.from({ length: 8 }, (_, i) => `fx/3/bk/${i + 1}`));
  assert.equal(f3[0].name, 'Rate');
  assert.equal(f3[1].name, 'Knob 2');
  assert.equal(f3[1].wert, 0.8);
  const f4 = bkKnobListe('fx/4', {});
  assert.deepEqual(f4.map((x) => [x.name, x.wert]), Array.from({ length: 8 }, (_, i) => [`Knob ${i + 1}`, 0.5]), 'no graph info: plain names at the default');
  assert.deepEqual(bkKnobListe('fx/2', {}), [], 'fx/2 is the hall: no graph knobs');
  assert.deepEqual(bkKnobListe('fx/1', {}, { graph: g }), []);
});

test('S14 sendRueckHtml: SEND RETURNS block without the fixed-at-0.5 label, one row per return with a picker place and a knob list', () => {
  const html = sendRueckHtml();
  assert.ok(html.includes('SEND RETURNS'), html);
  assert.ok(!/fixed at 0\.5/.test(html), html);
  for (const k of ['fx/3', 'fx/4']) {
    const zeile = new RegExp(`<div class="sendzeile" data-kanal="${k}">[\\s\\S]*?</div>\\s*<div class="bkliste"></div>\\s*</div>`).exec(html);
    assert.ok(zeile, `${k}: row with data-kanal and bkliste in ${html}`);
    assert.ok(zeile[0].includes(`data-graphplatz="${k}"`), zeile[0]);
  }
  assert.equal((html.match(/class="bkliste"/g) ?? []).length, 2);
  assert.ok(html.includes('RETURN 3') && html.includes('RETURN 4'));
  assert.equal((sendRueckHtml(['fx/3']).match(/class="sendzeile"/g) ?? []).length, 1, 'one row per kanal given (negative control)');
});

test('S12 bkKnobHtml: a hostile knob name arrives escaped in the label text and in aria-label', () => {
  const html = bkKnobHtml({ nr: 1, pfad: 'erz/3/bk/1', name: '<img onerror=x>"\'', wert: 0.5 }, 'erz/3');
  assert.ok(!html.includes('<img'), html);
  assert.ok(html.includes('&lt;img onerror=x&gt;&quot;&#39;'), html);
  const aria = /aria-label="([^"]*)"/.exec(html);
  assert.ok(aria && !/[<>]/.test(aria[1]) && aria[1].includes('&quot;'), html);
  assert.ok(html.startsWith('<label>') && html.endsWith('</label>'));
  assert.ok(html.includes('data-bk="erz/3/bk/1"') && html.includes('value="0.5"') && html.includes('>0.50</output>'), html);
  assert.ok(bkKnobHtml({ nr: 2, pfad: 'deck/1/bk/2', name: 'Cutoff', wert: 1 }, 'deck/1').includes('>Cutoff<input'), 'harmless name unchanged');
});

test('S12 graphWahlOptionen: first option "—", instruments only on erz/2, erz/3, effects only on deck and fx returns, none on erz/1', () => {
  const namen = (k, geladen) => graphWahlOptionen(k, GRAPHEN, geladen).map((o) => o.wert);
  assert.deepEqual(namen('erz/3'), ['', 'sampler-fairlight', 'saite']);
  assert.deepEqual(namen('erz/2'), ['', 'sampler-fairlight', 'saite']);
  assert.deepEqual(namen('deck/1'), ['', 'fx-bandecho', 'fx-takt-pump']);
  assert.deepEqual(namen('fx/3'), ['', 'fx-bandecho', 'fx-takt-pump']);
  assert.deepEqual(namen('fx/4'), ['', 'fx-bandecho', 'fx-takt-pump']);
  assert.deepEqual(namen('erz/1'), [], 'stream 1 is a drum kit: no instrument picker');
  assert.deepEqual(namen('master'), []);
  assert.equal(graphWahlOptionen('erz/3', GRAPHEN)[0].text, 'Surge XT', 'the empty entry of erz/2, erz/3 is the host');
  assert.equal(graphWahlOptionen('deck/1', GRAPHEN)[0].text, '—', 'effects keep the dash');
  const o = graphWahlOptionen('erz/3', GRAPHEN, 'saite');
  assert.deepEqual(o.map((x) => x.gewaehlt), [false, false, true]);
  assert.equal(graphWahlOptionen('erz/3', GRAPHEN, '')[0].gewaehlt, true, 'nothing loaded: the host entry is chosen');
  // a loaded graph that is not in the list (file gone) still shows up, so the picker does not lie
  const fremd = graphWahlOptionen('erz/3', GRAPHEN, 'weg');
  assert.deepEqual(fremd.at(-1), { wert: 'weg', text: 'weg', gewaehlt: true, kategorie: 'sonst' });
});

test('S12 graphWahlHtml: option texts and values are escaped', () => {
  const html = graphWahlHtml('deck/1', [{ name: '<b>x', art: 'effekt', regler_namen: {} }], '');
  assert.ok(html.startsWith('<select') && html.includes('data-graphwahl="deck/1"'), html);
  assert.ok(!html.includes('<b>'), html);
  assert.ok(html.includes('&lt;b&gt;x'), html);
  assert.equal(graphWahlHtml('erz/1', GRAPHEN, ''), '', 'no picker where no graph can go');
});

// S14: the wiring in app.js is DOM code that no unit test runs; this pins by text that the pieces are connected (the live
// behaviour was not measured in a browser in this slice, see docs/architecture/stand/baukasten-s14.md)
test('S14 app.js wiring (text check): the block comes from sendRueckHtml, the knobs are bound after every graph refresh and follow /e/regler', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.ok(/send\.innerHTML = sendRueckHtml\(\);/.test(app));
  assert.ok(!/fixed at 0\.5/.test(app));
  const rumpf = (name) => { const i = app.indexOf(`function ${name}(`); assert.ok(i >= 0, name); return app.slice(i, app.indexOf('\n}\n', i)); };
  for (const f of ['baueFxStreifen', 'holeGraphen', 'setzeGraphenGeladen']) assert.ok(rumpf(f).includes('baueSendKnobs();'), `${f} binds the send knobs`);
  assert.ok(/if \(\/\^fx\\\/\[34\]\\\/bk\\\/\/\.test\(f\.pfad\)\) zeigeSendKnobs\(\);/.test(app), '/e/regler refreshes the send knobs');
});

// ---- S19: learn button and badge on the graph knobs ----

test('S19 lernKnopfHtml: a free knob gets an enabled M button with the data-lern path and the learn tooltip', () => {
  const h = lernKnopfHtml('erz/5/bk/3', null, { midi: true, wartet: null });
  assert.match(h, /<button[^>]*data-lern="erz\/5\/bk\/3"/);
  assert.match(h, />M<\/button>/);
  assert.match(h, /title="Learn: click, then move a knob on your MIDI controller"/);
  assert.doesNotMatch(h, /disabled/);
  assert.doesNotMatch(h, /data-lern-weg/);
  assert.doesNotMatch(h, /class="[^"]*wartet/);
});

test('S19 lernKnopfHtml: a learned knob shows the badge "CC74 ch1" and a remove control that names the path', () => {
  const h = lernKnopfHtml('erz/5/bk/3', { kanal: 1, nr: 74 }, { midi: true, wartet: null });
  assert.match(h, /class="lern-badge"[^>]*>CC74 ch1</);
  assert.match(h, /data-lern-weg="erz\/5\/bk\/3"/);
  assert.match(h, /title="[^"]*erz\/5\/bk\/3[^"]*"/);
});

test('S19 lernKnopfHtml: without a MIDI input the button is disabled and says where to assign one', () => {
  const h = lernKnopfHtml('erz/5/bk/3', null, { midi: false, wartet: null });
  assert.match(h, /disabled/);
  assert.match(h, /title="Assign a MIDI input under Devices first"/);
});

test('S19 lernKnopfHtml: the waiting knob blinks and asks for a move; another knob is not waiting', () => {
  const h = lernKnopfHtml('erz/5/bk/3', null, { midi: true, wartet: 'erz/5/bk/3' });
  assert.match(h, /class="lern wartet"/);
  assert.match(h, /move a knob…/);
  assert.doesNotMatch(h, /disabled/);
  const andere = lernKnopfHtml('erz/5/bk/4', null, { midi: true, wartet: 'erz/5/bk/3' });
  assert.doesNotMatch(andere, /wartet/);
});

test('S19 lernKnopfHtml: a hostile path does not break out of the attributes (the function does not trust its input)', () => {
  const pfad = 'erz/5/bk/3"><img onerror=x>';
  for (const h of [lernKnopfHtml(pfad, null, { midi: true, wartet: null }), lernKnopfHtml(pfad, { kanal: 1, nr: 74 }, { midi: true, wartet: pfad })]) {
    assert.doesNotMatch(h, /<img/);
    assert.doesNotMatch(h, /"><img/);
    assert.ok(h.includes('&quot;'), 'the quote is escaped');
  }
});

test('S19 lernStand: the assignment of a path, or null', () => {
  const z = [{ pfad: 'erz/5/bk/3', kanal: 1, nr: 74 }, { pfad: 'deck/1/bk/2', kanal: 2, nr: 10 }];
  assert.deepEqual(lernStand(z, 'deck/1/bk/2'), z[1]);
  assert.equal(lernStand(z, 'deck/1/bk/9'), null);
  assert.equal(lernStand(undefined, 'deck/1/bk/2'), null);
});

// S17: the saved/differs marker of the graph picker and the SAVE SOUND button (pure functions, no polling)
import { bkMarke, bkSpeichernHtml } from '../public/effects.js';

test('64 knobs bkMarke: an old 8-number entry reads knobs 9..64 as 0.5 (or the graph vorgabe); a moved knob 9, 32 or 64 differs; a stored 64 array compares all', () => {
  const live = (o = {}) => ({ ...Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`erz/2/bk/${i + 1}`, 0.5])), ...o });
  const alt = [{ id: 'erz2', graph: 'juno', regler: Array(8).fill(0.5) }];
  assert.equal(bkMarke('erz/2', alt, 'juno', live()), 'gespeichert');
  assert.equal(bkMarke('erz/2', alt, 'juno', live({ 'erz/2/bk/9': 0.7 })), 'abweichend', 'knob 9 moved against an old entry');
  assert.equal(bkMarke('erz/2', alt, 'juno', live({ 'erz/2/bk/32': 0.1 })), 'abweichend', 'knob 32 moved against an old entry');
  const voll = Array(32).fill(0.5); voll[31] = 0.1;
  assert.equal(bkMarke('erz/2', [{ id: 'erz2', graph: 'juno', regler: voll }], 'juno', live({ 'erz/2/bk/32': 0.1 })), 'gespeichert');
  assert.equal(bkMarke('erz/2', [{ id: 'erz2', graph: 'juno', regler: voll }], 'juno', live()), 'abweichend');
  assert.equal(bkMarke('erz/2', alt, 'juno', live({ 'erz/2/bk/64': 0.1 })), 'abweichend', 'knob 64 moved against an old entry');
  // a knob the stored array does not carry reads as the graph's vorgabe, not as 0.5
  const bereiche = { 28: { vorgabe: 0.25 } };
  assert.equal(bkMarke('erz/2', alt, 'juno', live({ 'erz/2/bk/28': 0.25 }), bereiche), 'gespeichert');
  assert.equal(bkMarke('erz/2', alt, 'juno', live({ 'erz/2/bk/28': 0.25 })), 'abweichend', 'without the ranges the old 0.5 reading stays');
  assert.equal(bkMarke('erz/2', alt, 'juno', live({ 'erz/2/bk/28': 0.5 }), bereiche), 'abweichend');
});

test('S17 T5.1 bkMarke: no entry gives nothing, equal gives saved, any difference gives abweichend', () => {
  const alle = (w) => Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`erz/2/bk/${i + 1}`, w]));
  const gesp = [{ id: 'erz2', graph: 'juno', regler: Array(8).fill(0.5) }];
  assert.equal(bkMarke('erz/2', null, 'juno', alle(0.5)), '', 'no project');
  assert.equal(bkMarke('erz/2', [], 'juno', alle(0.5)), '', 'no entry');
  assert.equal(bkMarke('erz/3', gesp, 'juno', alle(0.5)), '', 'entry of another channel only');
  assert.equal(bkMarke('erz/2', gesp, 'juno', alle(0.5)), 'gespeichert');
  assert.equal(bkMarke('erz/2', gesp, 'juno', { ...alle(0.5), 'erz/2/bk/4': 0.51 }), 'abweichend', 'one knob off by 0.01');
  assert.equal(bkMarke('erz/2', gesp, 'juno', { ...alle(0.5), 'erz/2/bk/4': 0.5004 }), 'gespeichert', 'within 0.0005');
  assert.equal(bkMarke('erz/2', gesp, 'other', alle(0.5)), 'abweichend', 'another graph');
  assert.equal(bkMarke('erz/2', gesp, '', alle(0.5)), 'abweichend', 'nothing loaded');
  assert.equal(bkMarke('erz/2', gesp, undefined, alle(0.5)), 'abweichend');
  const unbekannt = alle(0.5); delete unbekannt['erz/2/bk/6'];
  assert.equal(bkMarke('erz/2', gesp, 'juno', unbekannt), 'gespeichert', 'an unknown live value is not a difference on the page');
  delete unbekannt['erz/2/bk/1']; unbekannt['erz/2/bk/2'] = 0.9;
  assert.equal(bkMarke('erz/2', gesp, 'juno', unbekannt), 'abweichend', 'a known difference still counts');
  assert.equal(bkMarke('fx/3', [{ id: 'fx3', graph: 'echo', regler: Array(8).fill(0.5) }], 'echo', {}), 'gespeichert', 'a channel without kern knobs compares the graph only');
});

test('S17 T5.2 bkSpeichernHtml: button only with a project and a loaded graph; marker text; the channel is escaped', () => {
  assert.equal(bkSpeichernHtml('erz/2', '', false, 'juno'), '', 'no project');
  assert.equal(bkSpeichernHtml('erz/2', '', true, ''), '', 'no graph loaded');
  assert.equal(bkSpeichernHtml('erz/2', '', true, undefined), '');
  const h = bkSpeichernHtml('erz/2', '', true, 'juno');
  assert.match(h, /<button[^>]*data-bkmerken="erz\/2"[^>]*>SAVE SOUND<\/button>/);
  assert.ok(!h.includes('bkmarke'), 'no marker without an entry');
  assert.match(bkSpeichernHtml('erz/2', 'gespeichert', true, 'juno'), /<span class="bkmarke gespeichert">saved<\/span>/);
  assert.match(bkSpeichernHtml('erz/2', 'abweichend', true, 'juno'), /<span class="bkmarke abweichend">differs from project<\/span>/);
  const boese = bkSpeichernHtml('"><img src=x>', '', true, 'juno');
  assert.ok(!boese.includes('<img'), boese);
  assert.ok(boese.includes('&quot;&gt;&lt;img'), boese);
});

// ---- Baukasten S18 task 7: erz/5..7 and the pads take instruments; the page strips follow the stream table -----------------------
import { INSTRUMENT_STROEME, kanalVonStrom, BK_STROEME } from '../../contract/streams.ts';

test('S18 graphWahlOptionen: erz/5..7 and pad/1..2 list instruments only with "—" first; erz/4, erz/8, erz/1 and master list nothing', () => {
  for (const k of ['erz/5', 'erz/6', 'erz/7', 'pad/1', 'pad/2']) {
    const o = graphWahlOptionen(k, GRAPHEN, '');
    assert.deepEqual(o.map((x) => x.wert), ['', 'sampler-fairlight', 'saite'], k);
    assert.equal(o[0].text, 'Off', k);
  }
  for (const k of ['erz/4', 'erz/8', 'erz/1', 'master']) assert.deepEqual(graphWahlOptionen(k, GRAPHEN, ''), [], k);
  assert.deepEqual(graphWahlOptionen('deck/1', GRAPHEN, '').map((x) => x.wert), ['', 'fx-bandecho', 'fx-takt-pump'], 'effects stay on decks');
});

test('S18 GRAPH_KANAL_ART: the instrument channels are exactly the ones of the stream table', async () => {
  const { GRAPH_KANAL_ART } = await import('../public/effects.js');
  const instrumente = Object.entries(GRAPH_KANAL_ART).filter(([, a]) => a === 'instrument').map(([k]) => k).sort();
  assert.deepEqual(instrumente, INSTRUMENT_STROEME.map(kanalVonStrom).sort());
  assert.deepEqual(instrumente, ['erz/2', 'erz/3', 'erz/5', 'erz/6', 'erz/7', 'pad/1', 'pad/2']);
});

test('S18 bkKnobListe: erz/6 and pad/2 name their eight knobs from the loaded graph; erz/4 and erz/8 have none', () => {
  const g = GRAPHEN[0];
  const l = bkKnobListe('erz/6', { 'erz/6/bk/2': 0.25 }, { graph: g });
  assert.equal(l.length, 8);
  assert.deepEqual([l[0].name, l[1].name, l[1].wert, l[2].name], ['Rate', 'Reverse (top third)', 0.25, 'Knob 3']);
  assert.equal(bkKnobListe('pad/2', {}, { graph: g })[0].name, 'Rate');
  assert.equal(bkKnobListe('erz/6', {}).length, 8, 'without a graph info the plain names (no host block on erz/5..7)');
  for (const k of ['erz/4', 'erz/8']) assert.deepEqual(bkKnobListe(k, {}, { graph: g }), [], k);
});

test('S18 app.js: the strip list and the mixer index of every Baukasten channel follow the stream table (mixer index = stream + 3, pads 12, 13)', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const kanaele = [...app.match(/const FX_KANAELE = \[(.*)\];/)[1].matchAll(/\['([a-z]+\/\d)', '([^']+)'\]/g)].map((m) => m[1]);
  const index = Object.fromEntries([...app.match(/const FX_INDEX = \{(.*?)\};/)[1].matchAll(/'([a-z]+\/\d)': (\d+)/g)].map((m) => [m[1], Number(m[2])]));
  for (const s of [...INSTRUMENT_STROEME, 1]) {
    const k = kanalVonStrom(s);
    assert.ok(kanaele.includes(k), `${k} has a strip`);
    if (k.startsWith('erz/')) assert.equal(index[k], s + 3, `${k}: mixer index is stream + 3`);
  }
  assert.deepEqual([index['pad/1'], index['pad/2']], [12, 13]);
  for (const s of BK_STROEME) assert.ok(kanaele.includes(kanalVonStrom(s)), `stream ${s}`);
  assert.ok(!kanaele.includes('erz/4') && !kanaele.includes('erz/8'), 'erz/4 (production) and erz/8 have no strip');
});

// ---- A8: Gate and Utility strips on the FX page, and kern device presets ---------------------------------------------------------
const APP = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const KOPF_ZEILEN = [...readFileSync(new URL('../../core/signalbox/include/cypherdj/signalbox/tool_controls.h', import.meta.url), 'utf8')
  .matchAll(/^\s*\{WzTool::(\w+), "([a-z_/]+)", (-?[\d.]+)f?, (-?[\d.]+)f?, (-?[\d.]+)f?, KurvenTyp::(\w+), \d+, (true|false), WzKanalart::(\w+)\},$/gm)]
  .map((m) => ({ tool: m[1], suffix: m[2], min: Number(m[3]), max: Number(m[4]), vorgabe: Number(m[5]), kurve: m[6], ganz: m[7] === 'true', kanalart: m[8] }));
const FX_KAN = [...APP.match(/const FX_KANAELE = \[(.*)\];/)[1].matchAll(/\['([a-z]+\/\d)', '([^']+)'\]/g)].map((m) => [m[1], m[2]]);

test('A8 the strip fields carry the ranges and defaults of the header, and every strip field is a row for source channels', () => {
  assert.equal(KOPF_ZEILEN.length, 44, 'the regex read the whole header');
  assert.equal(Object.keys(WERK_FELDER).length, 16, 'gate 9 + utility 7');
  for (const [suffix, f] of Object.entries(WERK_FELDER)) {
    const z = KOPF_ZEILEN.find((x) => x.suffix === suffix);
    assert.ok(z, `${suffix} is a header row`);
    assert.deepEqual([f.min, f.max, f.vorgabe], [z.min, z.max, z.vorgabe], suffix);
    assert.deepEqual([f.kurve, f.ganz], [z.kurve, z.ganz], `${suffix}: curve and integer flag`);
    assert.ok(['quellen', 'quellen_busse'].includes(z.kanalart), `${suffix} exists on source channels`);
  }
  for (const s of WERK_STREIFEN) for (const suffix of [s.an, ...s.regler.map((r) => r.feld), ...s.schalter.map((x) => x.feld)].filter(Boolean)) assert.ok(suffix in WERK_FELDER, suffix);
});

test('A8 the page builds a Gate and a Utility strip for each of the FX_KANAELE channels and sends nothing while building', () => {
  assert.equal(FX_KAN.length, 10);
  const gesendet = [];
  const echt = globalThis.fetch;
  globalThis.fetch = async (...a) => { gesendet.push(a); return { status: 200, json: async () => ({}) }; };
  try {
    for (const [k, name] of FX_KAN) {
      const html = werkzeugStreifenHtml(k, name);
      assert.equal((html.match(/class="fxwerk fxwerk-gate"/g) ?? []).length, 1, `${k} gate strip`);
      assert.equal((html.match(/class="fxwerk fxwerk-util"/g) ?? []).length, 1, `${k} utility strip`);
      const pfade = [...html.matchAll(/data-werk-pfad="([^"]+)"/g)].map((m) => m[1]);
      assert.ok(pfade.length >= 9, `${k}: ${pfade.length} controls`);
      for (const p of pfade) {
        assert.ok(p.startsWith(`${k}/`), p);
        assert.ok(KOPF_ZEILEN.some((z) => z.suffix === p.slice(k.length + 1)), `${p} is a controller row`);
      }
      assert.ok(pfade.includes(`${k}/gate/an`) && pfade.includes(`${k}/gate/schwelle`) && pfade.includes(`${k}/util/breite`) && pfade.includes(`${k}/util/dc`), k);
    }
  } finally { globalThis.fetch = echt; }
  assert.deepEqual(gesendet, [], 'building the strips sends nothing');
  // the page wires the strips into the same loop that builds the compressor strips, and sends through the shared helper
  assert.match(APP, /\+ werkzeugStreifenHtml\(k, name\)/);
  assert.match(APP, /setzeWerkzeug\(fetch, /);
  assert.ok(!/gate\/an.*FX_KANAELE|FX_KANAELE.*deck\/3/.test(APP), 'no channel outside FX_KANAELE is added by hand');
  // negative control: a harmless name goes through, a hostile one is escaped
  assert.ok(!werkzeugStreifenHtml('deck/1', '<img onerror=x>').includes('<img'));
});

test('A8 bass mono reads "off" only at 0 or below; 1..19 act as 20 Hz like the library clamp (utility.cpp:56)', () => {
  assert.equal(werkText('util/bassmono', 0), 'off');
  assert.equal(werkText('util/bassmono', 0.5), '20 Hz');
  assert.equal(werkText('util/bassmono', 1), '20 Hz');
  assert.equal(werkText('util/bassmono', 120), '120 Hz');
});

test('A8 a strip control sends /regler with ab "jetzt" like the compressor, a switch toggles from the live value, a failure is reported', async () => {
  assert.deepEqual(werkzeugAnfrage('erz/1/gate/schwelle', -30), { pfad: 'erz/1/gate/schwelle', nach: -30, ab: 'jetzt' });
  assert.equal(werkzeugKlickNach({ 'erz/1/gate/an': 0 }, 'erz/1/gate/an'), 1);
  assert.equal(werkzeugKlickNach({ 'erz/1/gate/an': 1 }, 'erz/1/gate/an'), 0);
  assert.equal(werkzeugKlickNach({}, 'erz/1/util/dc'), 1, 'no live value yet: the default is off, so the click switches on');
  const gesendet = [];
  const ok = async (url, o) => { gesendet.push([url, JSON.parse(o.body)]); return { status: 200, json: async () => ({ quittung: { status: 1 } }) }; };
  assert.deepEqual(await setzeWerkzeug(ok, 'pad/1/util/breite', 150), { ok: true });
  assert.deepEqual(gesendet, [['/regler', { pfad: 'pad/1/util/breite', nach: 150, ab: 'jetzt' }]]);
  const abgelehnt = async () => ({ status: 200, json: async () => ({ quittung: { status: 6, grund: 'out of range' } }) });
  assert.deepEqual(await setzeWerkzeug(abgelehnt, 'pad/1/util/breite', 999), { ok: false, text: 'Tool control refused: out of range' });
  const tot = async () => { throw new Error('ECONNREFUSED'); };
  assert.deepEqual(await setzeWerkzeug(tot, 'pad/1/util/breite', 1), { ok: false, text: 'Page server unreachable: ECONNREFUSED' });
  const http400 = async () => ({ status: 400, json: async () => ({ fehler: 'pfad_unbekannt' }) });
  assert.deepEqual(await setzeWerkzeug(http400, 'bus/9/util/dc', 1), { ok: false, text: 'Tool control refused: pfad_unbekannt' });
});

test('A8 channel kind of a path and the kern device preset: one /regler per field, switches as 0/1, a wrong channel kind is refused', () => {
  assert.deepEqual(['deck/1', 'erz/4', 'erz/7', 'pad/2', 'bus/3', 'master', 'fx/3', 'erz/8', 'erz/9', 'bus/5'].map(kanalArtVon),
    ['quelle', 'quelle', 'quelle', 'quelle', 'bus', null, null, null, null, null], 'erz/8 is cue only and has no tool rows (D2)');
  const gate = GERAETE.find((g) => g.id === 'gate'), util = GERAETE.find((g) => g.id === 'utility');
  const mb = GERAETE.find((g) => g.id === 'multiband'), lim = GERAETE.find((g) => g.id === 'kanal-limiter');
  const r = kernGeraetAnfragen(gate, { an: true, schwelle: -35, sc: 5 }, 'erz/1');
  assert.deepEqual(r.anfragen, [
    { pfad: 'erz/1/gate/schwelle', nach: -35, ab: 'jetzt' }, { pfad: 'erz/1/gate/sc', nach: 5, ab: 'jetzt' }, { pfad: 'erz/1/gate/an', nach: 1, ab: 'jetzt' }]);
  assert.equal(r.fehler, undefined);
  assert.match(kernGeraetAnfragen(gate, { an: true }, 'erz/8').fehler, /erz\/8/);
  assert.deepEqual(kernGeraetAnfragen(gate, { an: false }, 'pad/2').anfragen, [{ pfad: 'pad/2/gate/an', nach: 0, ab: 'jetzt' }]);
  // utility works on both kinds; multiband and limiter on buses only; gate on sources only
  assert.equal(kernGeraetAnfragen(util, { breite: 150 }, 'bus/2').anfragen[0].pfad, 'bus/2/util/breite');
  assert.equal(kernGeraetAnfragen(util, { breite: 150 }, 'deck/1').anfragen[0].pfad, 'deck/1/util/breite');
  assert.equal(kernGeraetAnfragen(mb, { tief_schwelle: -20, mitte_umgehen: true }, 'bus/1').anfragen.map((a) => `${a.pfad}=${a.nach}`).join(), 'bus/1/mb/tief/schwelle=-20,bus/1/mb/mitte/umgehen=1');
  assert.equal(kernGeraetAnfragen(lim, { decke: -1 }, 'bus/4').anfragen[0].pfad, 'bus/4/lim/decke');
  for (const [g, kanal, wort] of [[gate, 'bus/1', 'source'], [mb, 'deck/1', 'bus'], [lim, 'erz/1', 'bus'], [gate, 'master', 'channel']]) {
    const x = kernGeraetAnfragen(g, { an: true }, kanal);
    assert.deepEqual(x.anfragen, [], `${g.id} on ${kanal}`);
    assert.match(x.fehler, new RegExp(wort), x.fehler);
  }
  // a plugin device is not a kern device: no requests, an explanation
  assert.deepEqual(kernGeraetAnfragen(GERAETE.find((g) => g.id === 'komp'), { thresh: -10 }, 'deck/1').anfragen, []);
  // unknown names in a stored preset are reported, not sent
  assert.deepEqual(kernGeraetAnfragen(gate, { schwelle: -35, alt: 1 }, 'deck/1').uebrig, ['alt']);
});

test('A8 SAVE CURRENT of a kern device reads the live values of the channel; a missing value is skipped; a wrong channel kind gives null', () => {
  const gate = GERAETE.find((g) => g.id === 'gate'), mb = GERAETE.find((g) => g.id === 'multiband');
  const stand = { 'erz/1/gate/an': 1, 'erz/1/gate/schwelle': -33, 'erz/1/gate/hold': Number.NaN };
  assert.deepEqual(kernGeraetWerte(gate, 'erz/1', (p) => stand[p]), { an: true, schwelle: -33 });
  assert.equal(kernGeraetWerte(gate, 'erz/1', () => undefined), null, 'nothing known: nothing to save');
  assert.equal(kernGeraetWerte(mb, 'erz/1', () => 0), null, 'multiband has no source channel');
  assert.deepEqual(Object.keys(kernGeraetWerte(mb, 'bus/1', () => 0)).length, 24);
});

// ---- A8b: bus panel (multiband, limiter, utility per bus) and its meters ------------------------------------------------------------
const BUS_ZEILEN = KOPF_ZEILEN.filter((z) => z.kanalart === 'busse');
const BUS_PFADE = (html) => [...html.matchAll(/data-werk-pfad="([^"]+)"/g)].map((m) => m[1]);

test('A8b the bus fields are exactly the 27 bus-only header rows (multiband 24, limiter 3), ranges and defaults equal in both directions', () => {
  assert.equal(BUS_ZEILEN.length, 27, 'the header has 24 multiband + 3 limiter rows for buses');
  assert.equal(Object.keys(BUS_FELDER).length, 27);
  for (const z of BUS_ZEILEN) {
    const f = BUS_FELDER[z.suffix];
    assert.ok(f, `${z.suffix} is a page field`);
    assert.deepEqual([f.min, f.max, f.vorgabe, f.kurve, f.ganz], [z.min, z.max, z.vorgabe, z.kurve, z.ganz], z.suffix);
  }
  for (const suffix of Object.keys(BUS_FELDER)) assert.ok(BUS_ZEILEN.some((z) => z.suffix === suffix), `${suffix} is a header row`);
  for (const [suffix, f] of Object.entries(BUS_FELDER)) if (!f.ganz) assert.ok(f.schritt > 0 && f.schritt <= f.max - f.min, `${suffix}: a slider step`);
  assert.deepEqual(BUS_KANAELE, ['bus/1', 'bus/2', 'bus/3', 'bus/4']);
});

test('A8b the bus strips: mb/an, lim/an, lim/decke, lim/abklingen, 3 x 7 band knobs, both crossovers, the Utility block; no gate; nothing sent', () => {
  assert.equal(BUS_KANAELE.length, 4, 'four strips to loop over (no vacuous green)');
  const gesendet = [];
  const echt = globalThis.fetch;
  globalThis.fetch = async (...a) => { gesendet.push(a); return { status: 200, json: async () => ({}) }; };
  try {
    for (const k of BUS_KANAELE) {
      const html = busStreifenHtml(k, k.toUpperCase());
      const pfade = BUS_PFADE(html);
      for (const p of pfade) { assert.ok(p.startsWith(`${k}/`), p); assert.ok(BUS_ZEILEN.concat(KOPF_ZEILEN).some((z) => z.suffix === p.slice(k.length + 1)), `${p} is a header row`); }
      for (const suffix of ['mb/an', 'lim/an', 'lim/decke', 'lim/abklingen', 'mb/grenze_tief', 'mb/grenze_hoch']) assert.ok(pfade.includes(`${k}/${suffix}`), `${k} ${suffix}`);
      for (const b of ['tief', 'mitte', 'hoch']) for (const f of ['schwelle', 'ratio', 'attack', 'release', 'knie', 'makeup', 'umgehen']) assert.ok(pfade.includes(`${k}/mb/${b}/${f}`), `${k} ${b} ${f}`);
      for (const f of ['balance', 'breite', 'bassmono', 'phase_l', 'phase_r', 'tausch', 'dc']) assert.ok(pfade.includes(`${k}/util/${f}`), `${k} util ${f}`);
      assert.equal(pfade.length, 6 + 21 + 7 + 0, `${k}: 6 main + 21 band + 7 utility controls`);
      assert.ok(!pfade.some((p) => p.includes('/gate/')), 'no gate on buses (D2)');
      assert.match(html, /data-baender="bus\/\d"[^>]*hidden/, 'the per-band block is collapsed by default');
    }
  } finally { globalThis.fetch = echt; }
  assert.deepEqual(gesendet, []);
  assert.ok(!busStreifenHtml('bus/1', '<img onerror=x>').includes('<img'), 'a hostile name is escaped');
});

test('A8b the limiter controls are built disabled with the reason (the /lage field is absent until the kern delivers it)', () => {
  const html = busStreifenHtml('bus/2', 'BUS 2');
  for (const f of ['lim/an', 'lim/decke', 'lim/abklingen']) assert.match(html, new RegExp(`(data-werk-pfad="bus/2/${f}"[^>]*disabled|disabled[^>]*data-werk-pfad="bus/2/${f}")`), f);
  assert.ok(html.includes(LIMITER_GRUND));
  assert.equal(LIMITER_GRUND, 'limiter not built (kanal_limiter_vorhalt_ms = 0)');
  assert.ok(!/data-werk-pfad="bus\/2\/mb\/an"[^>]*disabled/.test(html), 'negative control: the multiband switch is not disabled');
});

test('A8b limiterZustand: only gebaut === true enables the limiter; absent, false, wrong types and garbage keep it disabled with the reason', () => {
  assert.deepEqual(limiterZustand({ kanal_limiter: { gebaut: true, latenz_samples: 96 } }), { gebaut: true, latenzSamples: 96, grund: '' });
  assert.deepEqual(limiterZustand({ kanal_limiter: { gebaut: true } }), { gebaut: true, latenzSamples: null, grund: '' });
  for (const lage of [undefined, null, {}, { kanal_limiter: null }, { kanal_limiter: {} }, { kanal_limiter: { gebaut: false, latenz_samples: 0 } },
    { kanal_limiter: { gebaut: 1 } }, { kanal_limiter: { gebaut: 'true' } }, { kanal_limiter: true }]) {
    assert.deepEqual(limiterZustand(lage), { gebaut: false, latenzSamples: null, grund: LIMITER_GRUND }, JSON.stringify(lage));
  }
  assert.equal(limiterZustand({ kanal_limiter: { gebaut: true, latenz_samples: -3 } }).latenzSamples, null, 'a nonsense latency is not shown');
});

test('A8b meters: reductions >= 0, negative clamped to 0, non-finite ignored, other channels ignored, a reading expires after 500 ms (fake clock)', () => {
  assert.equal(MIX_FRIST_MS, 500);
  const stand = {};
  assert.equal(mixAufnehmen(stand, { kanal: 'bus/1', gate_db: 0, mb_tief_db: 3.5, mb_mitte_db: -2, mb_hoch_db: Number.NaN, lim_db: 6 }, 1000), true);
  assert.equal(mixLesung(stand, 'bus/1', 'mb_tief_db', 1000), 3.5);
  assert.equal(mixLesung(stand, 'bus/1', 'mb_mitte_db', 1000), 0, 'negative clamped to 0');
  assert.equal(mixLesung(stand, 'bus/1', 'mb_hoch_db', 1000), null, 'NaN ignored: no reading');
  assert.equal(mixLesung(stand, 'bus/1', 'lim_db', 1000), 6);
  assert.equal(mixLesung(stand, 'bus/1', 'mb_tief_db', 1499.9), 3.5, 'still fresh just under 500 ms');
  assert.equal(mixLesung(stand, 'bus/1', 'mb_tief_db', 1500), null, 'no event for 500 ms: no reading');
  assert.equal(mixLesung(stand, 'bus/2', 'mb_tief_db', 1000), null, 'a bus that never reported has no reading');
  for (const f of [{ kanal: 'deck/1', mb_tief_db: 4 }, { kanal: 'bus/9', mb_tief_db: 4 }, { kanal: 'bus/1/x', mb_tief_db: 4 }, { mb_tief_db: 4 }]) assert.equal(mixAufnehmen({}, f, 0), false, JSON.stringify(f));
  assert.equal(mixAufnehmen(stand, { kanal: 'bus/1', mb_tief_db: Infinity, mb_mitte_db: '7' }, 1100), true);
  assert.equal(mixLesung(stand, 'bus/1', 'mb_tief_db', 1100), 3.5, 'Infinity is ignored and does not refresh the old reading');
  assert.equal(mixLesung(stand, 'bus/1', 'mb_mitte_db', 1100), 0, 'a string is not a number: the old reading stays');
});

test('A6 gate meters: only the 13 live source channels count, reductions >= 0, non-finite ignored, 500 ms expiry, the next expiry is reported', () => {
  assert.equal(GATE_KANAELE.length, 13);
  assert.ok(!GATE_KANAELE.includes('erz/8') && !GATE_KANAELE.some((k) => k.startsWith('bus/')), 'no gate on erz/8 or the buses (D2)');
  const stand = {};
  assert.equal(gateAufnehmen(stand, { kanal: 'erz/4', gate_db: 12.5 }, 1000), true);
  assert.equal(mixLesung(stand, 'erz/4', 'gate_db', 1000), 12.5);
  assert.equal(gateAufnehmen(stand, { kanal: 'erz/4', gate_db: -3 }, 1100), true);
  assert.equal(mixLesung(stand, 'erz/4', 'gate_db', 1100), 0, 'negative clamped to 0');
  assert.equal(gateAufnehmen(stand, { kanal: 'erz/4', gate_db: Number.NaN }, 1200), true);
  assert.equal(mixLesung(stand, 'erz/4', 'gate_db', 1200), 0, 'NaN ignored: the old reading stays');
  assert.equal(mixLesung(stand, 'erz/4', 'gate_db', 1600), null, '500 ms after the last accepted reading (1100): none');
  for (const f of [{ kanal: 'bus/1', gate_db: 4 }, { kanal: 'erz/8', gate_db: 4 }, { kanal: 'deck/5', gate_db: 4 }, { kanal: 'erz/1/x', gate_db: 4 }, { gate_db: 4 }])
    assert.equal(gateAufnehmen({}, f, 0), false, JSON.stringify(f));
  const st2 = {};
  gateAufnehmen(st2, { kanal: 'pad/1', gate_db: 5 }, 2000);
  assert.equal(mixAblaufIn(st2, 2100, GATE_KANAELE, ['gate_db']), 400, 'the page schedules its reset 400 ms later');
  assert.equal(mixAblaufIn(st2, 2100), null, 'the bus defaults do not see a source channel (A8b behaviour unchanged)');
});

test('A6 the page reads /zustand/mix with the field names of the contract (osc.json), in its order', () => {
  const osc = JSON.parse(readFileSync(new URL('../../contract/osc.json', import.meta.url), 'utf8'));
  const a = osc.adressen.find((x) => x.adresse === '/zustand/mix');
  assert.ok(a, '/zustand/mix is in the contract');
  assert.equal(a.typen, ',sfffff');
  assert.deepEqual(a.felder.map((x) => x.name), ['kanal', 'gate_db', ...MIX_FELDER]);
});

test('A8b werkText for the new fields', () => {
  assert.equal(werkText('mb/grenze_tief', 200), '200 Hz');
  assert.equal(werkText('mb/tief/schwelle', -12), '-12 dB');
  assert.equal(werkText('mb/mitte/ratio', 4), '4.0:1');
  assert.equal(werkText('mb/hoch/makeup', 3), '+3.0 dB');
  assert.equal(werkText('mb/hoch/attack', 2.5), '2.5 ms');
  assert.equal(werkText('lim/decke', -0.3), '-0.3 dB');
  assert.equal(werkText('lim/abklingen', 80), '80 ms');
});

test('A8b the built controls carry exactly the ranges of the header rows (no narrower, no wider), switches are 0/1 buttons', () => {
  for (const k of BUS_KANAELE) {
    const html = busStreifenHtml(k, k);
    const eingaben = [...html.matchAll(/<input type="range" data-werk-pfad="([^"]+)" min="([^"]+)" max="([^"]+)" step="([^"]+)" value="([^"]+)"/g)];
    const knoepfe = [...html.matchAll(/<button[^>]*data-werk-pfad="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(eingaben.length, 2 + 18 + 2 + 3 + 0, `${k}: crossovers 2, band knobs 18, limiter 2, utility sliders 3`);
    for (const [, pfad, min, max, schritt, wert] of eingaben) {
      const z = KOPF_ZEILEN.find((x) => x.suffix === pfad.slice(k.length + 1));
      assert.ok(z, pfad);
      assert.deepEqual([Number(min), Number(max), Number(wert)], [z.min, z.max, z.vorgabe], pfad);
      assert.ok(!z.ganz && Number(schritt) > 0, `${pfad}: a continuous row with a step`);
    }
    for (const pfad of knoepfe) assert.equal(KOPF_ZEILEN.find((x) => x.suffix === pfad.slice(k.length + 1)).kurve, 'schalter', `${pfad} is a switch row`);
    assert.equal(knoepfe.length, 1 + 3 + 1 + 4, `${k}: mb/an, 3 band bypass, lim/an, 4 utility switches`);
  }
});

// ---- Instrument picker by category ------------------------------------------------------------------------------------------------
const INST = [
  { name: 'drums-909', art: 'instrument', regler_namen: {}, kategorie: 'drums', text: '909-style drum kit; MIDI notes pick the drums.' },
  { name: 'diode-acid-bass', art: 'instrument', regler_namen: {}, kategorie: 'bass', text: 'Acid bass.' },
  { name: 'ms20-bass', art: 'instrument', regler_namen: {}, kategorie: 'bass', text: 'Gritty "MS-20" <bass>.' },
  { name: 'eigen', art: 'instrument', regler_namen: {} },
  { name: 'fx-bandecho', art: 'effekt', regler_namen: {} },
];
const opts = (html, sel) => [...new RegExp(`<select[^>]*class="${sel}"[^>]*>(.*?)</select>`, 's').exec(html)[1].matchAll(/<option value="([^"]*)"([^>]*)>([^<]*)</g)].map((m) => ({ wert: m[1], text: m[3], an: / selected/.test(m[2]) }));

test('category picker: two selects, the instrument list is filtered by the category of the loaded graph', () => {
  const h = instrumentWahlHtml('erz/5', INST, 'ms20-bass');
  assert.deepEqual(opts(h, 'graphkat').map((o) => o.text), ['Drums', 'Bass', 'Other'], 'only categories that hold a graph; no host on erz/5');
  assert.deepEqual(opts(h, 'graphkat').filter((o) => o.an).map((o) => o.wert), ['bass']);
  assert.deepEqual(opts(h, 'graphwahl'), [{ wert: '', text: 'Off', an: false }, { wert: 'diode-acid-bass', text: 'diode-acid-bass', an: false }, { wert: 'ms20-bass', text: 'ms20-bass', an: true }]);
  assert.ok(!h.includes('fx-bandecho') && !h.includes('drums-909'), 'no effects, no other category');
  assert.match(h, /data-graphkat="erz\/5"/);
  assert.match(h, /data-graphwahl="erz\/5"/);
});

test('category picker: one description line for the chosen instrument, escaped; Off and Choose have their own lines', () => {
  assert.match(instrumentWahlHtml('erz/5', INST, 'ms20-bass'), /<span class="graphtext" data-graphtext="erz\/5">Gritty &quot;MS-20&quot; &lt;bass&gt;\.<\/span>/);
  assert.match(instrumentWahlHtml('erz/5', INST, ''), /graphtext[^>]*>No instrument loaded on this channel\.</);
  const gewaehlt = instrumentWahlHtml('erz/5', INST, 'ms20-bass', undefined, 'drums');   // browsed to another category: nothing of it is chosen yet
  assert.match(gewaehlt, /<option value="" disabled selected hidden>Choose/);
  assert.deepEqual(opts(gewaehlt, 'graphwahl').map((o) => o.text), ['Choose…', 'Off', 'drums-909']);
  assert.match(gewaehlt, /graphtext[^>]*><\/span>/, 'no description for "Choose"');
});

test('category picker: erz/2 and erz/3 offer the host as an instrument (Surge XT, or the real host), Off elsewhere; the host line says who plays', () => {
  const h = instrumentWahlHtml('erz/3', INST, '');
  assert.deepEqual(opts(h, 'graphkat').filter((o) => o.an).map((o) => o.wert), ['host'], 'nothing loaded: the host category');
  assert.deepEqual(opts(h, 'graphkat').map((o) => o.text), ['Drums', 'Bass', 'Host (Surge/plugins)', 'Other']);
  assert.deepEqual(opts(h, 'graphwahl'), [{ wert: '', text: 'Surge XT', an: true }]);
  assert.match(h, /graphtext[^>]*>Surge XT plays this channel; no Baukasten graph is loaded\.</);
  const m = instrumentWahlHtml('erz/2', INST, '', 'Cypher Modular');
  assert.deepEqual(opts(m, 'graphwahl'), [{ wert: '', text: 'Cypher Modular', an: true }]);
  const bass = instrumentWahlHtml('erz/2', INST, '', 'Surge XT', 'bass');   // in another category the host is not listed: no Off there
  assert.deepEqual(opts(bass, 'graphwahl').map((o) => o.text), ['Choose…', 'diode-acid-bass', 'ms20-bass']);
  assert.ok(!opts(instrumentWahlHtml('erz/5', INST, ''), 'graphwahl').some((o) => o.text === 'Surge XT'));
  assert.deepEqual(opts(instrumentWahlHtml('erz/3', INST, 'ms20-bass'), 'graphkat').filter((o) => o.an).map((o) => o.wert), ['bass'], 'a loaded graph wins over host');
});

test('hostName: plugin name, vst3:/sfz: suffix, else Surge XT', () => {
  assert.equal(hostName({ art: 'lv2' }), 'Surge XT');
  assert.equal(hostName({ art: 'vst3:CypherModular' }), 'CypherModular');
  assert.equal(hostName({ art: 'sfz:piano.sfz' }), 'piano.sfz');
  assert.equal(hostName({ art: 'vst3:x', plugin: 'Cypher Modular' }), 'Cypher Modular');
  assert.equal(hostName(null), 'Surge XT');
  assert.equal(hostName({ art: 7 }), 'Surge XT');
});

test('single picker: instruments grouped by <optgroup> with the empty entry first, effects flat', () => {
  const h = graphWahlHtml('erz/5', INST, 'ms20-bass');
  assert.match(h, /<select class="graphwahl"[^>]*><option value="">Off<\/option><optgroup label="Drums">/);
  assert.deepEqual([...h.matchAll(/<optgroup label="([^"]*)">/g)].map((m) => m[1]), ['Drums', 'Bass', 'Other']);
  assert.match(h, /<optgroup label="Bass"><option value="diode-acid-bass">diode-acid-bass<\/option><option value="ms20-bass" selected>/);
  assert.ok(!graphWahlHtml('deck/1', INST, '').includes('optgroup'));
  assert.match(graphWahlHtml('erz/2', INST, '', 'Cypher Modular'), /<option value="" selected>Cypher Modular<\/option>/);
  assert.deepEqual(GRAPH_KATEGORIEN.map((k) => k.id), ['drums', 'bass', 'lead', 'pad', 'keys', 'textur', 'host', 'sonst']);
  assert.equal(instrumentKategorien('erz/5', INST, '').gewaehlt, 'drums');
});
