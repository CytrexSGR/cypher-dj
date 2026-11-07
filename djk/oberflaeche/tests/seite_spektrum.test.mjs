// 1.15 A7b: the spectrum view in the real oeffentlich/app.js on the DOM stand-in (tests/helfer/seiten_attrappe.mjs): the select sends /regler
// spektrum/kanal, the echo and the state snapshot move the select without sending, /zustand/spektrum frames feed the info line (the peak band), a
// frame of the wrong source is ignored, and the view goes to "no reading" after 500 ms without a frame (a real timer, no event needed).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { installiere, attrappe, sendeStrom } from './helfer/seiten_attrappe.mjs';

const HIER = new URL('..', import.meta.url);
const RAHMEN = JSON.parse(fs.readFileSync(new URL('tests/fixtures/spektrum_rahmen.json', HIER), 'utf8'));
const von = (hz) => RAHMEN.find((r) => r.hz === hz);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const info = () => attrappe.body.querySelector('#spektrum-info').textContent;
const wahl = () => attrappe.body.querySelector('#spektrum-quelle');
const reglerAufrufe = (ab) => attrappe.anrufe.slice(ab).filter((a) => a.url === '/regler').map((a) => a.koerper);

before(async () => {
  installiere({ html: fs.readFileSync(new URL('oeffentlich/index.html', HIER), 'utf8'), speicher: {}, antworten: { 'GET /bestand': { j: [] }, 'GET /loops': { j: [] } } });
  await import('../oeffentlich/app.js');
  await pause(40);
});

test('A7b the view is built: 20 sources in the select, off selected, nothing sent', () => {
  assert.equal(wahl().children.length, 20);
  assert.equal(wahl().value, '0');
  assert.equal(info(), 'Pick a source to see its spectrum');
  assert.deepEqual(attrappe.anrufe.filter((a) => a.url === '/regler'), [], 'building sends no /regler');
});

test('A7b picking a source sends spektrum/kanal; a frame of that source shows its peak band', async () => {
  const ab = attrappe.anrufe.length;
  wahl().value = '5';   // erz/1
  wahl().dispatch('change');
  await pause(10);
  assert.deepEqual(reglerAufrufe(ab), [{ pfad: 'spektrum/kanal', nach: 5, ab: 'jetzt' }]);
  assert.equal(info(), 'ERZ 1: no reading', 'selected, no frame yet');
  sendeStrom('/zustand/spektrum', { kanal: 'erz/1', rahmen: 7, pegel: von(100).pegel });
  assert.match(info(), /^ERZ 1: peak 99 Hz at -2\.\d dB · frame 7$/, '100 Hz probe');
  sendeStrom('/zustand/spektrum', { kanal: 'erz/1', rahmen: 8, pegel: von(5000).pegel });
  assert.match(info(), /^ERZ 1: peak 5\.0 kHz at 0\.0 dB · frame 8$/, '5 kHz probe');
});

test('A7b a frame of another source is ignored; a malformed one is ignored', () => {
  sendeStrom('/zustand/spektrum', { kanal: 'erz/2', rahmen: 99, pegel: von(1000).pegel });
  assert.match(info(), /frame 8$/, 'erz/2 is not the selection');
  sendeStrom('/zustand/spektrum', { kanal: 'erz/1', rahmen: 100, pegel: '1,2,3' });
  assert.match(info(), /frame 8$/, 'not 29 integers');
});

test('A7b the echo of the kern moves the select without sending; a new source forgets the old reading', () => {
  const ab = attrappe.anrufe.length;
  sendeStrom('/e/regler', { pfad: 'spektrum/kanal', wert: 6 });   // erz/2
  assert.equal(wahl().value, '6');
  assert.equal(info(), 'ERZ 2: no reading');
  assert.deepEqual(reglerAufrufe(ab), [], 'the echo sends nothing back');
  sendeStrom('/zustand/spektrum', { kanal: 'erz/2', rahmen: 1, pegel: von(1000).pegel });
  assert.match(info(), /^ERZ 2: peak 1\.0 kHz at 0\.0 dB · frame 1$/);
});

test('A7b the state snapshot sets the selector; selector 0 shows the hint', () => {
  sendeStrom('stand', { regler: { 'spektrum/kanal': 19 }, decks: {}, geladen: {}, loops: {}, fx: [null, null], fxZuweisung: [{}, {}] });
  assert.equal(wahl().value, '19');
  assert.equal(info(), 'MASTER: no reading');
  sendeStrom('/e/regler', { pfad: 'spektrum/kanal', wert: 0 });
  assert.equal(info(), 'Pick a source to see its spectrum');
});

test('A7b without a frame for 500 ms the view says "no reading" by itself', async () => {
  sendeStrom('/e/regler', { pfad: 'spektrum/kanal', wert: 5 });
  sendeStrom('/zustand/spektrum', { kanal: 'erz/1', rahmen: 3, pegel: von(1000).pegel });
  assert.match(info(), /peak 1\.0 kHz/);
  await pause(620);
  assert.equal(info(), 'ERZ 1: no reading');
});
