// node --test tests/vorlage.test.mjs: die Vorlage proben/09-ki-steuerung/stellwerk.mjs bleibt grün (12 von 12, als
// unveränderte Kopie unter vorlage/), und fünf ihrer Tests laufen in Vertragsform gegen die Attrappe (Regler in dB statt Gain 0..1, Beats statt Takt-Objekte, Hand über /test/hand mit
// erstem Wert als Stellung, Tempo als Rampe über 1 Beat statt Sprung). Plan der Vorlage: ab Takt 17 über 8 Takte
// ausblenden, Bass aus auf Takt 21; hier deck/1/eq/mitte 0 -> −24 dB ab Beat 64 über 32 Beats, deck/1/kill/tief an bei Beat 80.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { fahre } from '../folgen_schnell.mjs';
import { sende, erwarte, wert, hand, teil, q } from './hilfe.mjs';

const T = (takt) => (takt - 1) * 90000;
const gruen = (r) => assert.ok(r.ok, r.fehler.join('\n'));
const PLAN = [
  sende(T(9), teil(1, 'cypher', 'p1', 0, 'deck/1/eq/mitte', 64, 32, -24)),
  sende(T(9), teil(2, 'cypher', 'p1', 1, 'deck/1/kill/tief', 80, 0, 1)),
];

test('Vorlage 1: ohne Handgriff läuft der Plan vollständig, Bass aus genau auf Takt 21', () => {
  const r = fahre([...PLAN,
    wert(T(17), 'deck/1/eq/mitte', 0), wert(T(19), 'deck/1/eq/mitte', -6), wert(T(21), 'deck/1/eq/mitte', -12),
    wert(T(21) - 1, 'deck/1/kill/tief', 0), wert(T(21), 'deck/1/kill/tief', 1),
    wert(T(25), 'deck/1/eq/mitte', -24), erwarte(T(25), q(1, 'cypher', 3, T(25))),
  ]);
  gruen(r);
});

test('Vorlage 2: Handgriff bei Takt 19 beendet nur den eq/mitte-Teil am selben Sample, Bass aus läuft weiter', () => {
  const r = fahre([...PLAN,
    hand(T(19) - 2812, 'deck/1/eq/mitte', 0.5),
    ...Array.from({ length: 10 }, (_, k) => hand(T(19) + k * 1406, 'deck/1/eq/mitte', 0.54 + 0.01 * k)),
    erwarte(T(19), q(1, 'cypher', 7, T(19), 'hand')),
    wert(T(19) - 1, 'deck/1/eq/mitte', -6, 1e-3),
    wert(T(21), 'deck/1/kill/tief', 1),
    erwarte(T(21), q(2, 'cypher', 3, T(21))),
  ]);
  gruen(r);
  const w = r.kern.r.get('deck/1/eq/mitte').wert;
  assert.ok(w > -6, `Hand hat übernommen (Wert ${w}), der Plan wäre bei −24`);
});

test('Vorlage 7: Tempo 132 ab Takt 18 (als Rampe über 1 Beat): Bass aus und Rampenende bleiben auf ihrem Beat', () => {
  const T1 = (1 * 60) / ((128 + 132) / 2) * 48000;                  // Rampe über 1 Beat in Samples
  const s80 = Math.round(1530000 + T1 + (11 * 60 * 48000) / 132);
  const s96 = Math.round(1530000 + T1 + (27 * 60 * 48000) / 132);
  const r2 = fahre([...PLAN, sende(T(10), ['/k/tempo/rampe', 'hsddd', 3, 'leitstand', 68, 132, 1]),
    wert(s80 - 1, 'deck/1/kill/tief', 0), wert(s80, 'deck/1/kill/tief', 1), erwarte(s96, q(1, 'cypher', 3, s96))]);
  gruen(r2);
});

test('Vorlage 10: Hand und Planschritt am selben Sample, die Hand gewinnt', () => {
  const r = fahre([
    sende(T(9), teil(1, 'cypher', 'p1', 0, 'deck/1/eq/hoch', 80, 0, -20)),
    hand(T(20), 'deck/1/eq/hoch', 0.5),
    hand(T(21), 'deck/1/eq/hoch', 0.99),
    erwarte(T(21), q(1, 'cypher', 7, T(21), 'hand')),
  ]);
  gruen(r);
  assert.ok(r.kern.r.get('deck/1/eq/hoch').wert > 0, 'Hand, nicht Plan (Plan wäre −20)');
});

test('Vorlage 12: Rampe startet am Ist-Wert, ohne Sprung', () => {
  const r = fahre([
    sende(T(5), teil(1, 'cypher', 'p0', 0, 'deck/1/eq/mitte', 32, 0, -3)),
    sende(T(9), teil(2, 'cypher', 'p1', 0, 'deck/1/eq/mitte', 64, 32, -24)),
    wert(T(17), 'deck/1/eq/mitte', -3),
    wert(T(17) + 1, 'deck/1/eq/mitte', -3 - 21 / (32 * 22500), 1e-9),
  ]);
  gruen(r);
});

// Die übrigen sieben Vorlage-Tests haben in der Attrappe ihr Gegenstück an anderer Stelle: 3 bis 5 vergleichen naive
// Bauarten, die die Attrappe nicht hat (Blockraster, kein Schiedsrichter, ganzer Plan fällt); 6 (Übernahmearten) trägt
// hand.test.mjs mit der skalierten Übernahme aus §7.2; 8 und 11 (Verriegelung) tragen hoerschein.test.mjs (I3a, alle
// Gründe); 9 (Kopplung) trägt invarianten.test.mjs (Gegenprobe a1 mit Gruppe basstausch).
const VORLAGE = new URL('../vorlage/', import.meta.url).pathname;
const SHA = {
  'stellwerk.mjs': '89914e0c5d2673798ae390d8ff2d927a46ec6c7607ee64c3fb0f949388791009',
  'szenario.mjs': 'f6d2f413b2babae81c478e841438574e1ea91a887b38c59baab3d2ccdaf916e0',
  'stellwerk.test.mjs': '1ecfd40d38951a41c05d2bddc1fcabbf3e9f4ee249a1f050b2c93a48f3818ee0',
};

test('Vorlage unverändert (sha256 wie proben/09-ki-steuerung am 2026-09-23) und ihre 12 Tests grün', () => {
  for (const [datei, sha] of Object.entries(SHA)) {
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(VORLAGE + datei)).digest('hex'), sha, datei);
  }
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;                  // sonst meldet das innere node --test an den äußeren Lauf statt als TAP
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'stellwerk.test.mjs'], { cwd: VORLAGE, encoding: 'utf8', env });
  assert.match(r.stdout, /^# tests 12$/m, r.stdout.slice(-400));
  assert.match(r.stdout, /^# pass 12$/m, r.stdout.slice(-400));
  assert.match(r.stdout, /^# fail 0$/m);
});
