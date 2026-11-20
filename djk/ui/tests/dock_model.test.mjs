// The pure card model of the shared dock (public/dock/model.js): labels, rows, sends, FROM, latency and the rebuild key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { masterLevelSchreiben, produktionKurz, produktionZuege, sendKurz, latenzVon, masterLatenz, dockModell, dockGestalt } from '../public/dock/model.js';
import { pdcRechnen, msText, streifenText, latenzZeile } from '../public/production/pdc.js';

const ins = (id, art, extra = {}) => ({ id, art, slot: 1, an: true, werte: {}, ...extra });
const projekt = () => ({
  spuren: [
    { id: 's1', nr: 1, art: 'instrument', name: 'Bass', farbe: '#111', geraet: { art: 'intern', name: 'kit', kit: 'K1' }, inserts: [ins('i1', 'komp')], sends: [{ id: 'r1', db: -12 }] },
    { id: 's2', nr: 2, art: 'instrument', name: 'Lead', farbe: '#222', geraet: { art: 'wirt', plugin: { name: 'Surge' } }, inserts: [], sends: [{ id: 'r1', db: -60 }] },
    { id: 's3', nr: 3, art: 'audio', name: 'Vox', farbe: '#333', inserts: [] },
  ],
  gruppen: [
    { id: 'g1', nr: 1, name: 'Drums', farbe: '#aa0000', fader_db: -3, pan: 0.1, mute: false, solo: false, inserts: [ins('gi1', 'komp'), ins('gi2', 'host', { plugin: { name: 'Fab' } })], sends: [{ id: 'r1', db: -12 }, { id: 'r2', db: -6 }] },
    { id: 'g2', nr: 2, name: 'Kick', farbe: '#00aa00', fader_db: 0, pan: 0, mute: true, solo: false, inserts: [], ausgang: { art: 'gruppe', id: 'g1' } },
  ],
  returns: [
    { id: 'r2', nr: 2, name: 'Spring reverb', farbe: '#0000aa', fader_db: -2, pan: 0, mute: false, solo: false, pre: true, hall: { an: false }, inserts: [ins('ri1', 'bk', { graph: 'fx-federhall' })] },
    { id: 'r1', nr: 1, name: 'Echo', farbe: '#ffaa00', fader_db: 0, pan: 0, mute: false, solo: false, hall: { an: true }, inserts: [] },
  ],
  master: { fader_db: -1, inserts: [ins('mi1', 'lim')] },
});
const frier = (o) => { Object.values(o).forEach((v) => { if (v && typeof v === 'object') frier(v); }); return Object.freeze(o); };
const PROD = { gruppen: true, sends: true, mischer: true, stufenFenster: false };
const AUS = { gruppen: false, sends: false, mischer: false, stufenFenster: false };
const prodHost = (p) => ({ zuege: produktionZuege, kurz: produktionKurz, schalter: PROD });

test('produktionKurz: track number, G, R and M', () => {
  const p = projekt();
  assert.equal(produktionKurz(p, 's2'), '2');
  assert.equal(produktionKurz(p, 'g1'), 'G1');
  assert.equal(produktionKurz(p, 'r2'), 'R2');
  assert.equal(produktionKurz(p, 'master'), 'M');
});

test('PRODUCTION: track cards in project order, audio subtitle, nested group after its parent', () => {
  const p = projekt();
  const m = dockModell(p, prodHost(p));
  assert.deepEqual(m.spuren.map((s) => s.id), ['s1', 's2', 's3']);
  assert.equal(m.spuren[2].audio, true);
  assert.equal(m.spuren[2].untertitel, 'Audio');
  assert.equal(m.spuren[0].untertitel, 'Kit · K1');
  assert.deepEqual(m.spuren[0].teile, [{ teil: 'i1', text: 'COMPRESSOR', an: true, art: 'komp', slot: 1 }]);
  assert.deepEqual(m.gruppen.map((g) => [g.id, g.tiefe]), [['g1', 0], ['g2', 1]]);
  assert.deepEqual(m.gruppen[1].balken, ['#aa0000']);
  assert.deepEqual(m.gruppen[0].balken, []);
  assert.equal(m.gruppen[0].ausgangText, '→ Master');
  assert.equal(m.gruppen[1].ausgangText, '→ Drums');
  assert.equal(m.gruppen[1].ausgang, 'g1');
  assert.equal(m.gruppen[0].teile.length, 2);
  assert.equal(m.gruppen[0].kurz, 'G1');
  assert.equal(m.master.kurz, 'M');
  assert.equal(m.master.teile[0].text, 'LIMITER');
  assert.equal(m.master.fader_db, -1);
});

test('returns in number order with sends per strip, main stage text and FROM (the -60 dB edge counts as off)', () => {
  const p = projekt();
  const m = dockModell(p, prodHost(p));
  assert.deepEqual(m.effekte.map((r) => r.id), ['r1', 'r2']);
  assert.deepEqual(m.effekte[0].von, ['1', 'G1']);
  assert.deepEqual(m.effekte[1].von, ['G1']);
  assert.equal(m.effekte[0].hauptText, 'Hall');
  assert.equal(m.effekte[0].haupt.teil, 'hall');
  assert.equal(m.effekte[1].hauptText, 'fx-federhall');
  assert.equal(m.effekte[1].pre, true);
  assert.deepEqual(m.spuren[0].sends.map((s) => [s.return_id, s.name, s.kurz, s.db]), [['r1', 'Echo', 'Echo', -12], ['r2', 'Spring reverb', 'Sprin…', -200]]);
  assert.equal(m.spuren[1].sends[0].db, -60);
  assert.equal(m.gruppen[0].sends.length, 2);
});

test('without returns every sends is empty and FROM is empty', () => {
  const p = projekt(); p.returns = [];
  const m = dockModell(p, prodHost(p));
  assert.deepEqual(m.effekte, []);
  for (const s of [...m.spuren, ...m.gruppen]) assert.deepEqual(s.sends, []);
});

test('STUDIO input: instrument tracks with letters, no groups, no sends, FROM uses letters', () => {
  const p = projekt();
  const zuege = (q) => q.spuren.filter((s) => s.art === 'instrument').map((s, i) => ({ id: s.id, kurz: 'AB'[i], name: s.name, farbe: s.farbe }));
  const m = dockModell(p, { zuege, kurz: (q, id) => (id.startsWith('r') ? `FX${id.slice(1)}` : id), schalter: AUS });
  assert.deepEqual(m.spuren.map((s) => s.kurz), ['A', 'B']);
  assert.deepEqual(m.gruppen, []);
  for (const s of m.spuren) assert.deepEqual(s.sends, []);
  assert.deepEqual(m.effekte[0].von, ['A']);
  assert.equal(m.effekte[0].kurz, 'FX1');
});

test('sendKurz cuts to six characters', () => {
  assert.equal(sendKurz('Echo'), 'Echo');
  assert.equal(sendKurz('Sixsix'), 'Sixsix');
  assert.equal(sendKurz('Spring reverb'), 'Sprin…');
});

test('latenzVon: limiter chain in ms, only a Baukasten stage unknown, none empty', () => {
  const p = projekt();
  p.spuren[0].inserts = [ins('a', 'lim')];
  p.spuren[1].inserts = [ins('b', 'bk', { graph: 'g' })];
  const pdc = pdcRechnen(p);
  assert.equal(latenzVon(pdc, 's1').text, msText(86));
  assert.equal(latenzVon(pdc, 's1').titel, streifenText(pdc.streifen.s1));
  assert.equal(latenzVon(pdc, 's2').text, '? ms');
  assert.equal(latenzVon(pdc, 's3').text, '');
  assert.equal(latenzVon(pdc, 'nirgends').text, '');
});

test('masterLatenz: total when above zero, else empty; title is the latency line', () => {
  const p = projekt();
  const pdc = pdcRechnen(p);
  const l = masterLatenz(p, pdc, null, null);
  assert.equal(l.text, msText(pdc.gesamt));
  assert.equal(l.titel, latenzZeile(p));
  const q = projekt(); q.master.inserts = []; q.spuren[0].inserts = [];
  assert.equal(masterLatenz(q, pdcRechnen(q), null, null).text, '');
});

test('dockGestalt changes with a bypass or a rename, not with fader, pan, mute, solo, send or latency', () => {
  const gestalt = (p) => dockGestalt(dockModell(p, prodHost(p)));
  const base = gestalt(projekt());
  const a = projekt(); a.spuren[0].inserts[0].an = false;
  assert.notEqual(gestalt(a), base);
  const b = projekt(); b.gruppen[0].name = 'Perc';
  assert.notEqual(gestalt(b), base);
  const c = projekt(); c.spuren[0].sends[0].db = -3; c.gruppen[0].fader_db = -20; c.gruppen[0].pan = -1; c.gruppen[1].mute = false; c.gruppen[0].solo = true;
  c.returns[0].fader_db = -9; c.master.fader_db = -5;
  assert.equal(gestalt(c), base);
  const d = projekt(); d.spuren[1].inserts = [ins('x', 'lim')];   // latency alone is not enough, but a chip is: check the key sees chips
  assert.notEqual(gestalt(d), base);
  const e = projekt(); e.spuren[0].inserts[0].werte = { k1: 1 }; e.master.inserts[0].werte = { k1: 1 };
  assert.equal(gestalt(e), base);
});

test('a deep-frozen project does not throw and is not changed', () => {
  const p = frier(projekt());
  const m = dockModell(p, prodHost(p));
  assert.equal(m.spuren.length, 3);
  assert.doesNotThrow(() => dockGestalt(m));
});

test('masterLevelSchreiben: PRODUCTION uses label and key of the old master panel, STUDIO keeps its own', () => {
  assert.deepEqual(masterLevelSchreiben({ mischer: true }), { label: 'Master volume', schluessel: 'pm:fader' });
  assert.deepEqual(masterLevelSchreiben({ mischer: false }), { label: 'Volume master', schluessel: 'master:fader' });
  assert.deepEqual(masterLevelSchreiben(undefined), { label: 'Volume master', schluessel: 'master:fader' });
});
