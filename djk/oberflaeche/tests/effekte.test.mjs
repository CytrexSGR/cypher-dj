// Effekt-Sektion: Kennlinie wie komp_dsp (Gl. 4), Presets der Seite gleich denen des VST3.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { kennlinie, kennlinienPfad, KOMP_PRESETS, AUTO_BEREICH, punktAusStelle, fxInhaltText } from '../oeffentlich/effekte.js';
import { AUTO_BEREICH as SERVER_AUTO, pruefeAutomation } from '../loop_automation.ts';
import { AUTO_VORLAGEN, vorlagePunkte, knobListe, KNOB_GRUPPE, htmlText, bkKnobListe, bkKnobHtml, graphWahlOptionen, graphWahlHtml, sendRueckHtml, lernKnopfHtml, lernStand } from '../oeffentlich/effekte.js';

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

test('Kennlinie: unter dem Knie unverändert, darüber 1/R, Knie stetig (Werte wie komp_dsp/tests/komp.rs)', () => {
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
  const vst = JSON.parse(readFileSync(new URL('../../instrumente/komp/presets/presets.json', import.meta.url), 'utf8'));
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
  assert.equal(graphWahlOptionen('erz/3', GRAPHEN)[0].text, '—');
  const o = graphWahlOptionen('erz/3', GRAPHEN, 'saite');
  assert.deepEqual(o.map((x) => x.gewaehlt), [false, false, true]);
  assert.equal(graphWahlOptionen('erz/3', GRAPHEN, '')[0].gewaehlt, true, 'nothing loaded: "—" is chosen');
  // a loaded graph that is not in the list (file gone) still shows up, so the picker does not lie
  const fremd = graphWahlOptionen('erz/3', GRAPHEN, 'weg');
  assert.deepEqual(fremd.at(-1), { wert: 'weg', text: 'weg', gewaehlt: true });
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
  const app = readFileSync(new URL('../oeffentlich/app.js', import.meta.url), 'utf8');
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
import { bkMarke, bkSpeichernHtml } from '../oeffentlich/effekte.js';

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
import { INSTRUMENT_STROEME, kanalVonStrom, BK_STROEME } from '../../vertrag/stroeme.ts';

test('S18 graphWahlOptionen: erz/5..7 and pad/1..2 list instruments only with "—" first; erz/4, erz/8, erz/1 and master list nothing', () => {
  for (const k of ['erz/5', 'erz/6', 'erz/7', 'pad/1', 'pad/2']) {
    const o = graphWahlOptionen(k, GRAPHEN, '');
    assert.deepEqual(o.map((x) => x.wert), ['', 'sampler-fairlight', 'saite'], k);
    assert.equal(o[0].text, '—', k);
  }
  for (const k of ['erz/4', 'erz/8', 'erz/1', 'master']) assert.deepEqual(graphWahlOptionen(k, GRAPHEN, ''), [], k);
  assert.deepEqual(graphWahlOptionen('deck/1', GRAPHEN, '').map((x) => x.wert), ['', 'fx-bandecho', 'fx-takt-pump'], 'effects stay on decks');
});

test('S18 GRAPH_KANAL_ART: the instrument channels are exactly the ones of the stream table', async () => {
  const { GRAPH_KANAL_ART } = await import('../oeffentlich/effekte.js');
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
  const app = readFileSync(new URL('../oeffentlich/app.js', import.meta.url), 'utf8');
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
