// Golden of the unchanged 4/4 behaviour (plan studio-taktart T1): the fixtures were recorded from the code BEFORE the meter change.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fensterAusgabe, planerAusgabe } from './fixtures/taktart_4_korpus.mjs';

const fixture = (n) => JSON.parse(fs.readFileSync(fileURLToPath(new URL(`fixtures/${n}`, import.meta.url)), 'utf8'));
const rund = (x) => JSON.parse(JSON.stringify(x));

test('ereignisse(): 12 patterns over three windows equal the 4/4 golden (events, dauer, unknown sounds, fields)', () => {
  assert.deepEqual(rund(fensterAusgabe()), fixture('taktart_4_fenster.json'));
});

test('Planer.takt(0..3): the bundle bytes of two patterns equal the 4/4 golden, dauer values included', () => {
  assert.deepEqual(planerAusgabe(), fixture('taktart_4_planer.json'));
});
