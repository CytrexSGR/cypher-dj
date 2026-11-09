// A8 fix round 1: the real public/app.js executed against the DOM stand-in (tests/helpers/pages_mock.mjs), fetch and EventSource
// recorded. Pins what the source-text checks in effects.test.mjs cannot: the strips send nothing while the page builds, the state case of
// the stream fills the Gate/Utility strips (a running gate must not read "off" after load or reconnect), and the preset glue of app.js
// (SAVE CURRENT / APPLY of a kern device) talks to /regler and /presets with the right fields.
import { test, before, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { installiere, attrappe, sendeStrom } from './helpers/pages_mock.mjs';
import { GERAETE } from '../presets/devices.ts';
import { planeAnwendung } from '../presets/apply.ts';

const HIER = new URL('..', import.meta.url);
const INHALT = JSON.parse(fs.readFileSync(new URL('presets/vokabular.json', HIER), 'utf8')).inhalt;
const GATE_PRESET = { schema: 1, name: 'Tight Gate', geraet_typ: 'effekt', geraet: 'gate', werte: { an: true, schwelle: -35, release: 60 },
  beschreibung: { art: 'compressor', unterart: 'channel', charakter: ['tight'], genre: [], einsatz: ['mixdown'], energie: 2, text: 'Tight gate.' }, tags: [], notiz: '', angelegt: '2026-11-03T10:00:00.000Z', geaendert: '2026-11-03T10:00:00.000Z', verworfen: [] };
const KOMP_PRESET = { ...GATE_PRESET, name: 'Plain Komp', geraet: 'komp', werte: { thresh: -20, ratio: 3 } };
const eintrag = (p, slug) => ({ herkunft: 'nutzer', geraet: p.geraet, geraet_typ: 'effekt', slug, name: p.name, tags: [], geaendert: p.geaendert, beschreibung: p.beschreibung, familie: 'effekt' });
let streifen;

before(async () => {
  installiere({
    html: fs.readFileSync(new URL('public/index.html', HIER), 'utf8'),
    speicher: { 'djk-bereich': 'presets' },
    antworten: {
      'GET /bestand': { j: [] }, 'GET /loops': { j: [] },
      'GET /presets/geraete': { j: JSON.parse(JSON.stringify(GERAETE)) },
      'GET /presets/vokabular': { j: { version: 2, pruefsumme: 'x', inhalt: INHALT, anzahl: {} } },
      'GET /presets': { j: [eintrag(GATE_PRESET, 'tight-gate'), eintrag(KOMP_PRESET, 'plain-komp')] },
      'GET /presets/nutzer/gate/tight-gate': { j: GATE_PRESET },
      'GET /presets/nutzer/komp/plain-komp': { j: KOMP_PRESET },
      // 1.16 U3b: a channel target is applied from the SERVER plan; the stand-in answers with the real planeAnwendung, so the page and the server stay pinned
      'POST /presets/anwenden': (k) => {
        const p = { 'nutzer:gate/tight-gate': GATE_PRESET, 'nutzer:komp/plain-komp': KOMP_PRESET }[k.id];
        try { return { j: planeAnwendung({ ...p, id: k.id }, k.ziel, null) }; } catch (e) { return { code: e.code ?? 500, j: { fehler: e.fehler ?? e.message, text: e.text } }; }
      },
      'POST /presets': { code: 201, j: { herkunft: 'nutzer', geraet: 'gate', slug: 'my-gate', geaendert: '2026-11-03T11:00:00.000Z' } },
    },
  });
  streifen = attrappe.anrufe;
  await import('../public/app.js');
  await new Promise((r) => setTimeout(r, 60));   // the preset panel loads its lists
});

const strip = (k) => attrappe.body.querySelector(`.fxstreifen[data-kanal="${k}"]`);
const regler = (k, feld) => strip(k).querySelector(`input[data-werk-pfad="${k}/${feld}"]`);
const knopf = (k, feld) => strip(k).querySelector(`button[data-werk-pfad="${k}/${feld}"]`);

test('A8 building the page (the real app.js) builds 10 strips with Gate and Utility and sends no /regler', () => {
  assert.equal(attrappe.body.querySelectorAll('.fxstreifen').length, 10);
  assert.equal(attrappe.body.querySelectorAll('.fxstreifen .fxwerk-gate').length, 10);
  assert.equal(attrappe.body.querySelectorAll('.fxstreifen .fxwerk-util').length, 10);
  assert.deepEqual(attrappe.anrufe.filter((a) => a.url === '/regler' || a.methode !== 'GET'), [], 'nothing but reads while building');
  assert.ok(attrappe.anrufe.some((a) => a.url === '/graphen'), 'positive control: the build did run and fetch');
});

test('A8 the state case of the stream fills the Gate and Utility strips (a running gate is not shown as off after load or reconnect)', () => {
  assert.equal(knopf('erz/1', 'gate/an').getAttribute('aria-pressed'), 'false', 'before the state: off (default)');
  assert.equal(regler('erz/1', 'gate/schwelle').value, '-40');
  sendeStrom('stand', { regler: { 'erz/1/gate/an': 1, 'erz/1/gate/schwelle': -28, 'erz/1/gate/release': 250, 'erz/1/util/dc': 1, 'erz/1/util/breite': 150,
    'erz/1/util/bassmono': 120, 'deck/1/util/tausch': 1 }, decks: {}, geladen: {}, loops: {}, fx: [null, null], fxZuweisung: [{}, {}] });
  assert.equal(knopf('erz/1', 'gate/an').getAttribute('aria-pressed'), 'true');
  assert.ok(knopf('erz/1', 'gate/an').classList.contains('an'));
  assert.equal(regler('erz/1', 'gate/schwelle').value, '-28');
  assert.equal(regler('erz/1', 'gate/schwelle').nextElementSibling.textContent, '-28 dB');
  assert.equal(regler('erz/1', 'gate/release').value, '250');
  assert.equal(regler('erz/1', 'util/breite').value, '150');
  assert.equal(regler('erz/1', 'util/bassmono').nextElementSibling.textContent, '120 Hz');
  assert.ok(knopf('erz/1', 'util/dc').classList.contains('an'));
  assert.ok(knopf('deck/1', 'util/tausch').classList.contains('an'));
  // negative control: a channel and a switch the state does not mention stay at their defaults
  assert.equal(knopf('erz/2', 'gate/an').getAttribute('aria-pressed'), 'false');
  assert.equal(regler('erz/2', 'gate/schwelle').value, '-40');
  assert.ok(!knopf('erz/1', 'util/phase_l').classList.contains('an'));
});


// ---- A8b: the BUS panel through the real app.js -------------------------------------------------------------------------------------
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const bus = (k) => attrappe.body.querySelector(`.busstreifen[data-kanal="${k}"]`);
const bregler = (k, feld) => bus(k).querySelector(`input[data-werk-pfad="${k}/${feld}"]`);
const bknopf = (k, feld) => bus(k).querySelector(`button[data-werk-pfad="${k}/${feld}"]`);
const reglerAufrufe = (von) => attrappe.anrufe.slice(von).filter((a) => a.url === '/regler').map((a) => a.koerper);
const balken = (k, feld) => attrappe.body.querySelector(`[data-messer="${k}|${feld}"]`).style.width;
const zahl = (k, feld) => attrappe.body.querySelector(`[data-messer-zahl="${k}|${feld}"]`).textContent;
const LIM = ['lim/an', 'lim/decke', 'lim/abklingen'];
let jetztFalsch = 1000;

test('A8b building the page builds the BUS panel with four strips and sends nothing; the limiter controls are disabled with the reason', () => {
  assert.equal(attrappe.body.querySelectorAll('.buspanel').length, 1);
  assert.equal(attrappe.body.querySelectorAll('.busstreifen').length, 4);
  assert.equal(attrappe.body.querySelectorAll('.busstreifen .fxwerk-util').length, 4, 'the Utility block of A8 on every bus');
  assert.equal(attrappe.body.querySelectorAll('.busstreifen .fxwerk-gate').length, 0, 'no gate on buses (D2)');
  assert.deepEqual(attrappe.anrufe.filter((a) => a.url === '/regler' || a.methode !== 'GET'), [], 'nothing but reads while building');
  for (const k of ['bus/1', 'bus/4']) {
    for (const f of LIM) assert.ok(bus(k).querySelector(`[data-werk-pfad="${k}/${f}"]`).disabled, `${k} ${f} disabled while /lage has no kanal_limiter`);
    assert.ok(!bknopf(k, 'mb/an').disabled && !bregler(k, 'mb/grenze_tief').disabled && !bknopf(k, 'util/dc').disabled, 'negative control: multiband and utility are enabled');
    assert.equal(bus(k).querySelector('[data-lim-grund]').textContent, 'limiter not built (kanal_limiter_vorhalt_ms = 0)');
    assert.ok(!bus(k).querySelector('[data-lim-grund]').hidden, 'the reason is visible');
  }
});

test('A8b /lage with kanal_limiter {gebaut: true, latenz_samples} enables the limiter controls; absent or false disables them again', async () => {
  const effekte = () => attrappe.body.querySelector('[data-bereich="effekte"]');
  const andere = () => attrappe.body.querySelector('[data-bereich="library"]');
  const offen = async (lage) => { attrappe.antworten['GET /lage'] = { j: lage }; andere().click(); effekte().click(); await pause(60); };
  await offen({ kanal_limiter: { gebaut: true, latenz_samples: 96 } });
  for (const f of LIM) assert.ok(!bus('bus/2').querySelector(`[data-werk-pfad="bus/2/${f}"]`).disabled, `${f} enabled`);
  assert.equal(bus('bus/2').querySelector('[data-lim-grund]').textContent, 'latency 96 samples');
  await offen({ kanal_limiter: { gebaut: false, latenz_samples: 0 } });
  for (const f of LIM) assert.ok(bus('bus/2').querySelector(`[data-werk-pfad="bus/2/${f}"]`).disabled, `${f} disabled when gebaut is false`);
  assert.equal(bus('bus/2').querySelector('[data-lim-grund]').textContent, 'limiter not built (kanal_limiter_vorhalt_ms = 0)');
  await offen({ kanal_limiter: { gebaut: true } });
  assert.ok(!bknopf('bus/3', 'lim/an').disabled);
  assert.ok(bus('bus/3').querySelector('[data-lim-grund]').hidden, 'built without a latency: no text');
  await offen({});
  assert.ok(bknopf('bus/3', 'lim/an').disabled, 'the field absent: disabled');
  // a disabled limiter control sends nothing
  const von = attrappe.anrufe.length;
  bknopf('bus/3', 'lim/an').click();
  const r = bregler('bus/3', 'lim/decke'); r.value = '-6'; r.dispatch('input');
  await pause(80);
  assert.deepEqual(reglerAufrufe(von), [], 'disabled limiter controls send nothing');
  // enabled again: they send
  await offen({ kanal_limiter: { gebaut: true, latenz_samples: 48 } });
  const von2 = attrappe.anrufe.length;
  bknopf('bus/3', 'lim/an').click();
  r.value = '-6'; r.dispatch('input');
  await pause(80);
  assert.deepEqual(reglerAufrufe(von2), [{ pfad: 'bus/3/lim/an', nach: 1, ab: 'jetzt' }, { pfad: 'bus/3/lim/decke', nach: -6, ab: 'jetzt' }]);
});

test('A8b bus controls: a switch click sends the other 0/1, a slider sends its value after 40 ms, an echo moves the control without sending', async () => {
  const von = attrappe.anrufe.length;
  bknopf('bus/1', 'mb/an').click();
  bknopf('bus/1', 'util/dc').click();
  bknopf('bus/1', 'mb/mitte/umgehen').click();
  const r = bregler('bus/1', 'mb/tief/schwelle'); r.value = '-20'; r.dispatch('input');
  assert.equal(r.nextElementSibling.textContent, '-20 dB', 'the text follows at once');
  assert.deepEqual(reglerAufrufe(von).map((b) => b.pfad), ['bus/1/mb/an', 'bus/1/util/dc', 'bus/1/mb/mitte/umgehen'], 'the slider waits 40 ms');
  await pause(80);
  assert.deepEqual(reglerAufrufe(von), [{ pfad: 'bus/1/mb/an', nach: 1, ab: 'jetzt' }, { pfad: 'bus/1/util/dc', nach: 1, ab: 'jetzt' }, { pfad: 'bus/1/mb/mitte/umgehen', nach: 1, ab: 'jetzt' },
    { pfad: 'bus/1/mb/tief/schwelle', nach: -20, ab: 'jetzt' }]);
  // echoes: the kern answers; the controls follow and nothing is sent back
  const nach = attrappe.anrufe.length;
  // each echo is asserted alone: a later echo of a path the page does handle re-renders the whole strip and would hide a missing branch
  sendeStrom('/e/regler', { pfad: 'bus/1/mb/an', wert: 1 });
  assert.equal(bknopf('bus/1', 'mb/an').getAttribute('aria-pressed'), 'true');
  assert.ok(bknopf('bus/1', 'mb/an').classList.contains('an'));
  sendeStrom('/e/regler', { pfad: 'bus/1/mb/grenze_tief', wert: 350 });
  assert.equal(bregler('bus/1', 'mb/grenze_tief').value, '350');
  assert.equal(bregler('bus/1', 'mb/grenze_tief').nextElementSibling.textContent, '350 Hz');
  sendeStrom('/e/regler', { pfad: 'bus/1/mb/hoch/ratio', wert: 4 });
  assert.equal(bregler('bus/1', 'mb/hoch/ratio').value, '4');
  sendeStrom('/e/regler', { pfad: 'bus/1/lim/decke', wert: -1.5 });
  assert.equal(bregler('bus/1', 'lim/decke').nextElementSibling.textContent, '-1.5 dB');
  sendeStrom('/e/regler', { pfad: 'bus/1/util/breite', wert: 80 });
  assert.equal(bregler('bus/1', 'util/breite').value, '80');
  await pause(80);
  assert.deepEqual(reglerAufrufe(nach), [], 'an echo is not sent back');
  // the switch is now on (by the echo): the next click sends 0
  bknopf('bus/1', 'mb/an').click();
  assert.deepEqual(reglerAufrufe(nach), [{ pfad: 'bus/1/mb/an', nach: 0, ab: 'jetzt' }], 'a click on a switch that is on sends 0');
  // negative control: another bus is not touched by the echo of bus 1
  assert.equal(bknopf('bus/2', 'mb/an').getAttribute('aria-pressed'), 'false');
  assert.equal(bregler('bus/2', 'mb/grenze_tief').value, '200');
});

test('A8b the per-band block and the whole panel fold; both start as the spec says (bands collapsed, panel open); folding sends nothing', () => {
  const block = () => attrappe.body.querySelector('[data-baender="bus/2"]'), knopf = () => attrappe.body.querySelector('[data-baender-knopf="bus/2"]');
  const von = attrappe.anrufe.length;
  assert.ok(block().hidden, 'collapsed by default');
  assert.equal(knopf().getAttribute('aria-expanded'), 'false');
  knopf().click();
  assert.ok(!block().hidden);
  assert.equal(knopf().getAttribute('aria-expanded'), 'true');
  assert.ok(attrappe.body.querySelector('[data-baender="bus/3"]').hidden, 'negative control: the band block of another bus stays collapsed');
  knopf().click();
  assert.ok(block().hidden);
  const reihe = attrappe.body.querySelector('.busreihe'), pk = attrappe.body.querySelector('.bus-panel-knopf');
  assert.ok(!reihe.hidden);
  pk.click();
  assert.ok(reihe.hidden);
  pk.click();
  assert.ok(!reihe.hidden);
  assert.deepEqual(attrappe.anrufe.slice(von), []);
});

test('A8b meters: /zustand/mix drives the three band meters and the limiter meter of a bus; 500 ms without an event resets them (fake clock)', async () => {
  mock.method(performance, 'now', () => jetztFalsch);
  try {
    jetztFalsch = 1000;
    sendeStrom('/zustand/mix', { kanal: 'bus/1', gate_db: 9, mb_tief_db: 6, mb_mitte_db: 12, mb_hoch_db: -3, lim_db: 24 });
    assert.equal(balken('bus/1', 'mb_tief_db'), '25%');
    assert.equal(zahl('bus/1', 'mb_tief_db'), '6.0 dB');
    assert.equal(balken('bus/1', 'mb_mitte_db'), '50%');
    assert.equal(zahl('bus/1', 'mb_hoch_db'), '0.0 dB', 'a negative reduction is clamped to 0');
    assert.equal(zahl('bus/1', 'lim_db'), '24.0 dB');
    assert.equal(balken('bus/1', 'lim_db'), '100%');
    assert.equal(zahl('bus/2', 'mb_tief_db'), '–', 'negative control: a bus without an event shows no reading');
    // non-finite and wrong channels do not disturb
    sendeStrom('/zustand/mix', { kanal: 'bus/1', mb_tief_db: Number.NaN, mb_mitte_db: null });
    sendeStrom('/zustand/mix', { kanal: 'deck/1', gate_db: 5, mb_tief_db: 7 });
    sendeStrom('/zustand/mix', { kanal: 'bus/7', mb_tief_db: 7 });
    assert.equal(zahl('bus/1', 'mb_tief_db'), '6.0 dB', 'NaN is ignored: the old reading stays');
    // just under 500 ms the reading is still there (another bus's event re-renders all meters), at 500 ms it is gone
    jetztFalsch = 1499;
    sendeStrom('/zustand/mix', { kanal: 'bus/2', mb_tief_db: 3 });
    assert.equal(zahl('bus/1', 'mb_tief_db'), '6.0 dB', '499 ms: still shown');
    assert.equal(zahl('bus/2', 'mb_tief_db'), '3.0 dB');
    jetztFalsch = 1500;
    sendeStrom('/zustand/mix', { kanal: 'bus/2', mb_tief_db: 3 });
    assert.equal(zahl('bus/1', 'mb_tief_db'), '–', '500 ms without an event: no reading');
    assert.equal(balken('bus/1', 'mb_tief_db'), '0%');
    assert.equal(zahl('bus/1', 'lim_db'), '–');
    assert.equal(zahl('bus/2', 'mb_tief_db'), '3.0 dB', 'the bus that kept reporting keeps its reading');
    // without any further event the page resets by itself (timer scheduled for the expiry)
    jetztFalsch = 2100;
    await pause(560);
    assert.equal(zahl('bus/2', 'mb_tief_db'), '–', 'the timer reset the meter with no event');
    assert.equal(balken('bus/2', 'mb_tief_db'), '0%');
  } finally { mock.restoreAll(); }
});

test('A6 meters: gate_db of /zustand/mix drives the gate meter of a source channel (scale 60 dB); a bus, erz/8 and non-finite values do not; 500 ms reset (fake clock)', async () => {
  const gb = (k) => attrappe.body.querySelector(`[data-messer="${k}|gate_db"]`)?.style.width;
  const gz = (k) => attrappe.body.querySelector(`[data-messer-zahl="${k}|gate_db"]`)?.textContent;
  for (const k of ['deck/1', 'deck/2', 'erz/1', 'erz/2', 'erz/3', 'erz/5', 'erz/6', 'erz/7', 'pad/1', 'pad/2'])
    assert.ok(strip(k).querySelector(`.fxwerk-gate [data-messer="${k}|gate_db"]`), `${k}: the gate strip has its meter`);
  for (const k of ['bus/1', 'bus/2', 'bus/3', 'bus/4']) assert.equal(attrappe.body.querySelector(`[data-messer="${k}|gate_db"]`), null, `negative control: no gate meter on ${k} (D2)`);
  mock.method(performance, 'now', () => jetztFalsch);
  try {
    jetztFalsch = 5000;
    assert.equal(gz('erz/1'), '–', 'before any event: no reading');
    sendeStrom('/zustand/mix', { kanal: 'erz/1', gate_db: 30, mb_tief_db: 0, mb_mitte_db: 0, mb_hoch_db: 0, lim_db: 0 });
    assert.equal(gz('erz/1'), '30.0 dB');
    assert.equal(gb('erz/1'), '50%', '30 dB of the 60 dB scale');
    sendeStrom('/zustand/mix', { kanal: 'erz/1', gate_db: 80 });
    assert.equal(gz('erz/1'), '80.0 dB', 'the number shows the real value');
    assert.equal(gb('erz/1'), '100%', 'the bar is capped');
    assert.equal(gz('pad/2'), '–', 'a channel without an event shows no reading');
    sendeStrom('/zustand/mix', { kanal: 'erz/1', gate_db: Number.NaN });
    sendeStrom('/zustand/mix', { kanal: 'bus/1', gate_db: 12 });
    sendeStrom('/zustand/mix', { kanal: 'erz/8', gate_db: 12 });
    assert.equal(gz('erz/1'), '80.0 dB', 'NaN is ignored: the old reading stays');
    assert.equal(attrappe.body.querySelector('[data-messer-zahl="erz/8|gate_db"]'), null, 'erz/8 has no gate meter');
    sendeStrom('/zustand/mix', { kanal: 'deck/1', gate_db: -4 });
    assert.equal(gz('deck/1'), '0.0 dB', 'a negative reduction is clamped to 0');
    jetztFalsch = 5499;
    sendeStrom('/zustand/mix', { kanal: 'pad/2', gate_db: 6 });
    assert.equal(gz('erz/1'), '80.0 dB', '499 ms: still shown');
    jetztFalsch = 5500;
    sendeStrom('/zustand/mix', { kanal: 'pad/2', gate_db: 6 });
    assert.equal(gz('erz/1'), '–', '500 ms without an event: no reading');
    assert.equal(gb('erz/1'), '0%');
    assert.equal(gz('pad/2'), '6.0 dB', 'the channel that kept reporting keeps its reading');
    jetztFalsch = 6100;
    await pause(560);
    assert.equal(gz('pad/2'), '–', 'the timer reset the meter with no event');
  } finally { mock.restoreAll(); }
});

test('A8 the existing Gate and Utility strips: switch click, slider input and the /e/regler echo reach the right paths without sending back', async () => {
  const von = attrappe.anrufe.length;
  knopf('erz/2', 'gate/an').click();
  knopf('pad/1', 'util/tausch').click();
  const r = regler('erz/2', 'gate/release'); r.value = '300'; r.dispatch('input');
  assert.equal(r.nextElementSibling.textContent, '300 ms');
  await pause(80);
  assert.deepEqual(reglerAufrufe(von), [{ pfad: 'erz/2/gate/an', nach: 1, ab: 'jetzt' }, { pfad: 'pad/1/util/tausch', nach: 1, ab: 'jetzt' }, { pfad: 'erz/2/gate/release', nach: 300, ab: 'jetzt' }]);
  const nach = attrappe.anrufe.length;
  sendeStrom('/e/regler', { pfad: 'erz/2/gate/schwelle', wert: -55 });
  sendeStrom('/e/regler', { pfad: 'erz/2/gate/an', wert: 1 });
  sendeStrom('/e/regler', { pfad: 'pad/1/util/bassmono', wert: 90 });
  assert.equal(regler('erz/2', 'gate/schwelle').value, '-55');
  assert.equal(regler('erz/2', 'gate/schwelle').nextElementSibling.textContent, '-55 dB');
  assert.ok(knopf('erz/2', 'gate/an').classList.contains('an'));
  assert.equal(regler('pad/1', 'util/bassmono').nextElementSibling.textContent, '90 Hz');
  await pause(80);
  assert.deepEqual(reglerAufrufe(nach), [], 'an echo is not sent back');
  assert.ok(!knopf('erz/3', 'gate/an').classList.contains('an'), 'negative control: another channel is not touched');
});

const hauptfeld = () => attrappe.body.querySelector('#presets');
const waehleGeraet = (id) => hauptfeld().dispatch('change', { target: { dataset: { presetFeld: 'geraet' }, value: id } });
const aktion = (a, id) => hauptfeld().querySelectorAll(`button[data-preset-aktion="${a}"]`).find((b) => !id || b.dataset.presetId === id);

test('A8 APPLY of a gate preset through app.js sends one /regler per field on the picked channel, none of the compressor fields', async () => {
  waehleGeraet('gate');
  const b = aktion('anwenden', 'nutzer/gate/tight-gate');
  assert.ok(b && !b.disabled, 'a source channel is picked: Gate can be applied');
  const von = attrappe.anrufe.length;
  b.click();
  await new Promise((r) => setTimeout(r, 60));
  const regel = attrappe.anrufe.slice(von).filter((a) => a.url === '/regler');
  assert.deepEqual(regel.map((a) => a.koerper), [
    { pfad: 'erz/1/gate/schwelle', nach: -35, ab: 'jetzt' }, { pfad: 'erz/1/gate/release', nach: 60, ab: 'jetzt' }, { pfad: 'erz/1/gate/an', nach: 1, ab: 'jetzt' }]);
  assert.ok(!regel.some((a) => a.koerper.pfad.includes('/komp/')));
  assert.match(hauptfeld().querySelector('.preset-meldung').textContent, /Applied Tight Gate \(channel DRUMS\)/);
});

test('A8 negative control: a compressor preset is still applied to the compressor, not as a kern device', async () => {
  waehleGeraet('komp');
  const b = aktion('anwenden', 'nutzer/komp/plain-komp');
  assert.ok(b && !b.disabled);
  const von = attrappe.anrufe.length;
  b.click();
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(attrappe.anrufe.slice(von).filter((a) => a.url === '/regler').map((a) => [a.koerper.pfad, a.koerper.nach]), [['erz/1/komp/schwelle', -20], ['erz/1/komp/ratio', 3]]);
});

test('A8 multiband (bus only) cannot be applied or saved from the page: the strips are source channels', () => {
  waehleGeraet('multiband');
  assert.ok(hauptfeld().querySelectorAll('button[data-preset-aktion="anwenden"]').every((b) => b.disabled));
  assert.ok(aktion('speichern').disabled, 'no bus values to save from a source channel');
});

test('A8 SAVE CURRENT of a gate reads the live values of the picked channel and posts them as booleans and numbers', async () => {
  waehleGeraet('gate');
  const feld = (k) => hauptfeld().querySelector(`[data-preset-entwurf="${k}"]`);
  const eingabe = { name: 'My Gate', tags: '', art: 'compressor', unterart: 'channel', charakter: 'tight', genre: '', einsatz: 'mixdown', energie: '2', text: 'My gate for the drums.' };
  for (const [k, v] of Object.entries(eingabe)) feld(k).value = v;
  const von = attrappe.anrufe.length;
  const b = aktion('speichern');
  assert.ok(b && !b.disabled);
  b.click();
  await new Promise((r) => setTimeout(r, 60));
  const post = attrappe.anrufe.slice(von).find((a) => a.url === '/presets' && a.methode === 'POST');
  assert.ok(post, 'a POST /presets was sent');
  assert.equal(post.koerper.geraet, 'gate');
  assert.deepEqual(post.koerper.werte, { an: true, schwelle: -28, release: 250 }, 'only what the kern reported for erz/1: switch as boolean');
});

// ---- review (MINOR): the refusal behaviour of the preset glue in app.js (host.anwenden) -----------------------------------------------
// The stand-in answers with the real planeAnwendung, so the refusal text is the server's own. A test sets an answer for one request and
// puts the old one back, so the tests above and below do not see it.
function mitAntwort(schluessel, antwort, lauf) {
  const alt = attrappe.antworten[schluessel];
  attrappe.antworten[schluessel] = antwort;
  return Promise.resolve(lauf()).finally(() => { attrappe.antworten[schluessel] = alt; });
}
const reglerKoerper = (von) => attrappe.anrufe.slice(von).filter((a) => a.url === '/regler').map((a) => a.koerper);

test('review: a server refusal of POST /presets/anwenden shows "Not applied" with the server text and sends no /regler', async () => {
  waehleGeraet('komp');
  // the refusal is the real one: the kern compressor sits on source channels only, so the server refuses a bus target
  let verweigert;
  try { planeAnwendung({ ...KOMP_PRESET, id: 'nutzer:komp/plain-komp' }, { art: 'kanal', kanal: 'bus/1' }, null); } catch (e) { verweigert = e; }
  assert.ok(verweigert, 'the real plan refuses a komp preset on a bus');
  await mitAntwort('POST /presets/anwenden', () => ({ code: verweigert.code ?? 400, j: { fehler: verweigert.fehler ?? verweigert.message, text: verweigert.text } }), async () => {
    const von = attrappe.anrufe.length;
    aktion('anwenden', 'nutzer/komp/plain-komp').click();
    await new Promise((r) => setTimeout(r, 60));
    assert.ok(attrappe.anrufe.slice(von).some((a) => a.url === '/presets/anwenden'), 'the plan was asked for');
    assert.deepEqual(reglerKoerper(von), [], 'a refused plan sends nothing');
    const m = hauptfeld().querySelector('.preset-meldung').textContent;
    assert.match(m, /^Not applied: /);
    assert.match(m, /channel kind does not carry the device/, 'the server text reaches the panel');
  });
  // negative control: the same click with the normal answer applies
  const von2 = attrappe.anrufe.length;
  aktion('anwenden', 'nutzer/komp/plain-komp').click();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(reglerKoerper(von2).length, 2);
  assert.match(hauptfeld().querySelector('.preset-meldung').textContent, /^Applied Plain Komp/);
});

test('review: a refusal of the 2nd /regler request stops the apply: the 3rd is never sent and the panel shows "Not applied"', async () => {
  waehleGeraet('gate');
  let n = 0;
  await mitAntwort('POST /regler', () => { n++; return n === 2 ? { code: 400, j: { fehler: 'no' } } : { j: { quittung: { status: 0 } } }; }, async () => {
    const von = attrappe.anrufe.length;
    aktion('anwenden', 'nutzer/gate/tight-gate').click();
    await new Promise((r) => setTimeout(r, 60));
    // Review 1.15: the on switch of a preset that switches the tool ON goes last, so the refusal of the 2nd request leaves the tool off, not on with half the values
    assert.deepEqual(reglerKoerper(von).map((k) => k.pfad), ['erz/1/gate/schwelle', 'erz/1/gate/release'], 'the 3rd request (the on switch) is not sent');
    assert.match(hauptfeld().querySelector('.preset-meldung').textContent, /^Not applied: Tool control refused: no/);
  });
  // negative control: without a refusal all three go out and the panel says Applied
  const von2 = attrappe.anrufe.length;
  aktion('anwenden', 'nutzer/gate/tight-gate').click();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(reglerKoerper(von2).length, 3);
  assert.match(hauptfeld().querySelector('.preset-meldung').textContent, /^Applied Tight Gate/);
});
