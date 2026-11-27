// PRODUCTION master meter: the pure functions of public/production/master_meter.js (no DOM, no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import { MM_MS, lufsText, korrText, balkenAnteil, decke, zielLufs, ueberNeu, meterZustand, abstandText, iTitel, playStart, abAnzeige, abEndet, AB_TITEL, vektorOffen, vektorPollt } from '../public/production/master_meter.js';
import { dialogVorgabe, speicherInhalt } from '../public/production/export_dialog.js';

const gespeichert = (ziel) => ({ ...speicherInhalt(dialogVorgabe(null, null)), ziel });

test('poll rate is 10 Hz', () => assert.equal(MM_MS, 100));

test('lufsText: one decimal, real minus, dash for nothing', () => {
  assert.equal(lufsText(-9.84), '−9.8');
  assert.equal(lufsText(null), '–');
  assert.equal(lufsText(undefined), '–');
  assert.equal(lufsText(NaN), '–');
});

test('korrText: two decimals with sign', () => {
  assert.equal(korrText(0.823), '+0.82');
  assert.equal(korrText(-0.1), '−0.10');
  assert.equal(korrText(0), '0.00');
  assert.equal(korrText(null), '–');
});

test('balkenAnteil: -40..0 LUFS onto 0..1', () => {
  assert.equal(balkenAnteil(null), 0);
  assert.equal(balkenAnteil(-40), 0);
  assert.equal(balkenAnteil(-60), 0);
  assert.equal(balkenAnteil(-20), 0.5);
  assert.equal(balkenAnteil(0), 1);
  assert.equal(balkenAnteil(5), 1);
});

test('decke and zielLufs follow the stored export target', () => {
  assert.equal(decke(null), 0);
  assert.equal(decke(gespeichert('aus')), 0);
  assert.equal(decke(gespeichert('streaming')), -1);
  assert.equal(decke(gespeichert('spitze')), -1);
  assert.equal(zielLufs(null), null);
  assert.equal(zielLufs(gespeichert('streaming')), -14);
  assert.equal(zielLufs(gespeichert('spitze')), null);
});

test('ueberNeu latches', () => {
  assert.equal(ueberNeu(false, -0.5, -1), true);
  assert.equal(ueberNeu(true, -5, -1), true);
  assert.equal(ueberNeu(false, -200, 0), false);
  assert.equal(ueberNeu(false, undefined, 0), false);
});

test('meterZustand', () => {
  const alt = { ueber: false, decke: -1 };
  const leer = { m: '–', s: '–', i: '–', abstand: '', tp: '–', korr: '–', ueber: false, leer: true };
  assert.deepEqual(meterZustand({ leer: true }, alt), leer);
  assert.deepEqual(meterZustand({ leer: false, steht: true, lufs_m: -9 }, alt), leer);
  assert.deepEqual(meterZustand({ leer: true }, { ueber: true, decke: -1 }), { ...leer, ueber: true });
  const z = meterZustand({ leer: false, steht: false, lufs_m: -9.84, lufs_s: null, tp_dbtp: -3, tp_max_dbtp: -0.4, korrelation: 0.5 }, alt);
  assert.deepEqual(z, { m: '−9.8', s: '–', i: '–', abstand: '', tp: '−0.4', korr: '+0.50', ueber: true, leer: false });
  assert.equal(meterZustand({ leer: false, steht: false, tp_max_dbtp: -200 }, alt).tp, '–');
});

test('integrated loudness and its distance to the target', () => {
  const j = { leer: false, steht: false, lufs_m: -9, lufs_s: -9, lufs_i: -11.24, tp_max_dbtp: -3, korrelation: 1 };
  const z = meterZustand(j, { ueber: false, decke: -1, ziel: -14 });
  assert.equal(z.i, '−11.2'); assert.equal(z.abstand, '+2.8');
  assert.equal(meterZustand(j, { ueber: false, decke: -1, ziel: null }).abstand, '');
  assert.equal(meterZustand({ ...j, lufs_i: null }, { ueber: false, decke: -1, ziel: -14 }).i, '–');
  assert.equal(abstandText(-15.5, -14), '−1.5');
  assert.equal(iTitel(j, -14), 'Integrated loudness since RESET or since PLAY · target −14.0 LUFS');
  assert.match(iTitel({ ...j, luecke_s: 12.4 }, null), /not measured: 12 s \(the page was hidden\)/);
});

test('playStart: only not-2 to 2', () => {
  assert.equal(playStart(0, 2), true);
  assert.equal(playStart(undefined, 2), false, 'unknown old status (page just loaded): no reset');
  assert.equal(playStart(null, 2), false);
  assert.equal(playStart(1, 2), true);
  assert.equal(playStart(2, 2), false);
  assert.equal(playStart(2, 0), false);
});

test('abAnzeige: one state to button, pressed and side', () => {
  assert.deepEqual(abAnzeige(null), { knopf: 'A/B', gedrueckt: false, seite: null, titel: AB_TITEL, abgeglichen: true });
  assert.deepEqual(abAnzeige({ zustand: 'aus', an: false }).gedrueckt, false);
  const m = abAnzeige({ zustand: 'misst' });
  assert.equal(m.knopf, 'MEASURING…'); assert.equal(m.gedrueckt, false);
  const a = abAnzeige({ zustand: 'an', an: true, seite: 'a', text: 'B is 1.2 dB louder: B is turned down' });
  assert.deepEqual([a.knopf, a.gedrueckt, a.seite, a.titel], ['A/B', true, 'a', 'B is 1.2 dB louder: B is turned down']);
  assert.equal(abAnzeige({ zustand: 'an', seite: 'b' }).seite, 'b');
  const v = abAnzeige({ zustand: 'veraltet', an: true, seite: 'b', text: 'The project changed' });
  assert.equal(v.gedrueckt, true); assert.equal(v.titel, 'The project changed');
  const u = abAnzeige({ zustand: 'an', an: true, seite: 'a', abgeglichen: false, text: 'not level-matched: the loop range is silent; A: processed, at project level' });
  assert.equal(u.abgeglichen, false); assert.match(u.titel, /^not level-matched/);
  assert.equal(abAnzeige({ zustand: 'an', an: true, seite: 'a' }).abgeglichen, true);
  const f = abAnzeige({ zustand: 'fehler', text: 'No master stage' });
  assert.deepEqual([f.gedrueckt, f.seite, f.titel], [false, null, 'No master stage']);
});

test('abEndet: another project or another revision ends A/B', () => {
  const lage = { an: true, rev: 7 };
  assert.equal(abEndet(lage, { rev: 7 }, false), false);
  assert.equal(abEndet(lage, { rev: 8 }, false), true);
  assert.equal(abEndet(lage, { rev: 7 }, true), true);
  assert.equal(abEndet(null, { rev: 8 }, true), false);
  assert.equal(abEndet({ an: false }, { rev: 8 }, true), false);
});

test('vektorOffen: click toggles, Escape and close shut, anything else keeps', () => {
  assert.equal(vektorOffen(false, 'klick'), true);
  assert.equal(vektorOffen(true, 'klick'), false);
  assert.equal(vektorOffen(true, 'escape'), false);
  assert.equal(vektorOffen(false, 'escape'), false);
  assert.equal(vektorOffen(true, 'schliessen'), false);
  assert.equal(vektorOffen(true, 'x'), true);
});

test('vektorPollt: poll only when open and visible', () => {
  assert.equal(vektorPollt(true, true), true);
  assert.equal(vektorPollt(true, false), false);
  assert.equal(vektorPollt(false, true), false);
  assert.equal(vektorPollt(false, false), false);
});
