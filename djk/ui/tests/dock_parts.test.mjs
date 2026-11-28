// The chip menu, the key source menu and the chip state of the dock (pure).
import test from 'node:test';
import assert from 'node:assert/strict';
import { installiere } from './helpers/pages_mock.mjs';

installiere();
const { chipMenuePunkte, schluesselPunkte, chipZustand } = await import('../public/dock/parts.js');
const { schluesselGruppen } = await import('../public/production/key_choice.js');

const ins = (id, art, extra = {}) => ({ id, art, slot: 1, an: true, werte: {}, ...extra });
const strang = (inserts) => ({ id: 's1', name: 'T1', inserts });
const texte = (p) => p.map((x) => x.text);

test('compressor first of three: Move earlier is off, Key source is there', () => {
  const s = strang([ins('k1', 'komp'), ins('e1', 'eq'), ins('l1', 'lim')]);
  const p = chipMenuePunkte(s, s.inserts[0], { lage: null });
  assert.deepEqual(texte(p), ['Bypass', 'Move earlier', 'Move later', 'Key source…', 'Remove']);
  assert.equal(p[1].aus, true);
  assert.ok(!p[2].aus);
  assert.deepEqual(p.map((x) => x.aktion), ['an', 'links', 'rechts', 'schluessel', 'weg']);
});

test('a bypassed stage offers Enable, the last one cannot move later', () => {
  const s = strang([ins('k1', 'komp'), ins('l1', 'lim', { an: false })]);
  const p = chipMenuePunkte(s, s.inserts[1], { lage: null });
  assert.equal(p[0].text, 'Enable');
  assert.equal(p.find((x) => x.text === 'Move later').aus, true);
  assert.ok(!p.find((x) => x.text === 'Move earlier').aus);
});

test('a view without the key menu (STUDIO) gets no Key source entry', () => {
  const s = strang([ins('k1', 'komp')]);
  assert.ok(!texte(chipMenuePunkte(s, s.inserts[0], { lage: null, schluessel: false })).includes('Key source…'));
});

test('limiter has no key source', () => {
  const s = strang([ins('l1', 'lim')]);
  assert.ok(!texte(chipMenuePunkte(s, s.inserts[0], { lage: null })).includes('Key source…'));
});

test('plugin stage: NATIVE WINDOW, Close native window while open', () => {
  const s = strang([ins('h1', 'host', { plugin: { name: 'Fine EQ' } })]);
  const zu = chipMenuePunkte(s, s.inserts[0], { lage: { status: 'bereit', fenster: false } });
  assert.deepEqual(texte(zu), ['Bypass', 'Move earlier', 'Move later', 'NATIVE WINDOW', 'Remove']);
  assert.equal(zu[3].aktion, 'fenster');
  const auf = chipMenuePunkte(s, s.inserts[0], { lage: { status: 'bereit', fenster: true } });
  assert.equal(auf[3].text, 'Close native window');
});

test('the Hall chip keeps only Bypass or Enable', () => {
  assert.deepEqual(chipMenuePunkte(null, { art: 'hall', an: true }, {}).map((x) => [x.text, x.aktion]), [['Bypass', 'hall']]);
  assert.deepEqual(texte(chipMenuePunkte(null, { art: 'hall', an: false }, {})), ['Enable']);
});

test('WINDOW ↗ in the chip menu only with the fenster switch, before Remove; the Hall chip never gets it', () => {
  const s = strang([ins('k1', 'komp'), ins('e1', 'saett')]);
  assert.ok(!texte(chipMenuePunkte(s, s.inserts[1], { lage: null })).includes('WINDOW ↗'), 'off by default (STUDIO)');
  const p = chipMenuePunkte(s, s.inserts[1], { lage: null, fenster: true });
  assert.deepEqual(texte(p), ['Bypass', 'Move earlier', 'Move later', 'WINDOW ↗', 'Remove']);
  assert.equal(p.find((x) => x.text === 'WINDOW ↗').aktion, 'zielfenster');
  assert.deepEqual(texte(chipMenuePunkte(null, { art: 'hall', an: true }, { fenster: true })), ['Bypass']);
});

test('schluesselPunkte: group headings, a locked option off with its reason, the current value marked', () => {
  const gruppen = schluesselGruppen([
    { quelle: 'spur', nr: 2, punkt: 'pre', erlaubt: true },
    { quelle: 'spur', nr: 3, punkt: 'post', erlaubt: false, text: 'Would loop' },
    { quelle: 'ret', nr: 1, punkt: 'post', erlaubt: true },
  ], { spuren: [{ nr: 2, name: 'Kick' }, { nr: 3, name: 'Bass' }], returns: [{ nr: 1, name: 'Hall' }] });
  const p = schluesselPunkte(gruppen, 'spur:2:pre');
  assert.deepEqual(p.filter((x) => x.gruppe).map((x) => x.text), ['Tracks', 'Returns']);
  const gesperrt = p.find((x) => x.wert === 'spur:3:post');
  assert.equal(gesperrt.aus, true);
  assert.equal(gesperrt.titel, 'Would loop');
  assert.ok(p.find((x) => x.wert === 'spur:2:pre').text.startsWith('✓ '));
  assert.ok(!p.find((x) => x.wert === 'own').text.startsWith('✓ '));
});

test('chipZustand: a missing plugin host', () => {
  const z = chipZustand(ins('h1', 'host'), { status: 'fehlt', grund: 'not installed', latenz: 0, gemessen: false }, null);
  assert.equal(z.status, 'fehlt');
  assert.ok(z.titel.startsWith('Missing: not installed'));
  assert.ok(z.titel.includes('Estimated latency'));
  assert.equal(z.marke, null);
});

test('chipZustand: measured latency has no estimate wording; unknown host', () => {
  const z = chipZustand(ins('h1', 'host'), { status: 'bereit', latenz: 480, gemessen: true }, null);
  assert.equal(z.status, 'bereit');
  assert.ok(z.titel.includes('10.0 ms') && !z.titel.includes('Estimated'));
  assert.equal(chipZustand(ins('h1', 'host'), null, null).status, 'unbekannt');
});

test('chipZustand: the preset mark only for a stage set by a preset; no status for a native stage', () => {
  const m = { text: 'Warm', titel: 'Preset Warm', geaendert: true };
  assert.deepEqual(chipZustand(ins('k1', 'komp', { preset: 'x' }), null, m).marke, m);
  assert.equal(chipZustand(ins('k1', 'komp'), null, m).marke, null);
  assert.equal(chipZustand(ins('k1', 'komp'), null, null).status, null);
});
