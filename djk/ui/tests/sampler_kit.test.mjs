// Sampler B task 1: kit writer, band proposal, bank numbering, kit name. Temp folders only: the cut is written by hand (no legeSchnitt),
// the kit folder is passed in. Nothing here touches ~/.config/cypherdj.
import test, { after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AUSBLENDE_FRAMES, BANK, BANK_LISTE, ERSTE_NOTE, KLANG_MAX_FRAMES, baender, bankVorschlag, freierKitName, kitMuster, kitVorschlag, legeKit, nummeriere } from '../sampler/kit.ts';
import { SchnittFehler } from '../sampler/schnitt.ts';

const wurzeln = [];
after(() => { for (const r of wurzeln) fs.rmSync(r, { recursive: true, force: true }); });

const f32 = (p) => { const b = fs.readFileSync(p); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); };

// a cut `id` with the given interleaved stereo audio and slice bounds
function schreibeSchnitt(o, id, grenzen, daten, name = 'Amen Break!') {
  fs.mkdirSync(path.join(o.ordner, id), { recursive: true });
  fs.mkdirSync(path.join(o.bk, 'samples'), { recursive: true });
  const frames = grenzen[grenzen.length - 1];
  fs.writeFileSync(path.join(o.ordner, id, 'schnitt.json'), JSON.stringify({
    schema: 1, id, name, quelle: { art: 'loop', ref: 'l' }, bpm: 128, beats: 4, frames, methode: 'raster', grenzen,
    guete: grenzen.slice(1).map(() => ({ staerke: null, raster_abstand_beats: 0 })), erstellt: '2026-11-16T10:00:00Z',
  }));
  fs.writeFileSync(path.join(o.bk, 'samples', `smp-${id}.f32`), Buffer.from(daten.buffer, daten.byteOffset, daten.byteLength));
}

function neu() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'smp-b1-'));
  wurzeln.push(root);
  const o = { ordner: path.join(root, 'sampler'), bk: path.join(root, 'bk'), kits: path.join(root, 'kits') };
  for (const p of Object.values(o)) fs.mkdirSync(p);
  // slice 0: decaying 60 Hz sine, 1: 1 kHz sine, 2: alternating +-0.5 (Nyquist), 3: silence
  const d = new Float32Array(19200 * 2);
  for (let i = 0; i < 4800; i++) {
    const a = 0.8 * Math.exp(-i / 4800) * Math.sin(2 * Math.PI * 60 * i / 48000);
    d[2 * i] = a; d[2 * i + 1] = a;
    const b = 0.8 * Math.sin(2 * Math.PI * 1000 * i / 48000);
    d[2 * (4800 + i)] = b; d[2 * (4800 + i) + 1] = b;
    const h = i % 2 === 0 ? 0.5 : -0.5;
    d[2 * (9600 + i)] = h; d[2 * (9600 + i) + 1] = h;
  }
  schreibeSchnitt(o, 'x-0001', [0, 4800, 9600, 14400, 19200], d);
  return { root, o };
}
const eintraege = (o) => fs.readdirSync(o.kits).sort();
const wirft = (f, code, grund, teil) => {
  assert.throws(f, (e) => { assert.ok(e instanceof SchnittFehler, String(e)); assert.deepEqual([e.code, e.grund], [code, grund]); if (teil) for (const t of [].concat(teil)) assert.ok(e.text.includes(t), e.text); return true; });
};

test('the constants', () => {
  assert.deepEqual([ERSTE_NOTE, KLANG_MAX_FRAMES, AUSBLENDE_FRAMES, BANK_LISTE], [36, 480000, 240, ['bd', 'sd', 'hh', 'cp', 'perc']]);
  assert.ok(BANK.test('bd') && BANK.test('a_1') && !BANK.test('BD') && !BANK.test('9x') && !BANK.test('') && !BANK.test('bd:2') && !BANK.test('a'.repeat(17)));
});

test('the sounds equal their slices except the 240-frame end fade; notes from 36; kit.json last and valid', () => {
  const { o } = neu();
  const r = legeKit({ id: 'x-0001', scheiben: [2, 0], kit: 'brk' }, o);
  assert.deepEqual(r.klaenge.map((k) => [k.scheibe, k.note, k.datei]), [[0, 36, '36.f32'], [2, 37, '37.f32']]);
  const x = f32(path.join(o.bk, 'samples', 'smp-x-0001.f32')), y = f32(path.join(o.kits, 'brk', '36.f32'));
  assert.equal(y.length, 4800 * 2);
  for (let i = 0; i < (4800 - 240) * 2; i++) assert.ok(Object.is(y[i], x[i]), `sample ${i}`);
  assert.equal(y[4799 * 2], 0); assert.equal(y[4799 * 2 + 1], 0);
  assert.ok(Math.abs(y[4560 * 2] - x[4560 * 2] * 239 / 240) < 1e-7);
  // the second sound is slice 2: frames 9600..14400 of the cut
  const z = f32(path.join(o.kits, 'brk', '37.f32'));
  for (let i = 0; i < (4800 - 240) * 2; i++) assert.ok(Object.is(z[i], x[9600 * 2 + i]), `sample ${i}`);
  const j = JSON.parse(fs.readFileSync(path.join(o.kits, 'brk', 'kit.json'), 'utf8'));
  assert.deepEqual([j.schema, j.name, j.klaenge[0].frames, fs.statSync(path.join(o.kits, 'brk', '36.f32')).size], [1, 'brk', 4800, 4800 * 8]);
  assert.deepEqual(j.klaenge.map((k) => [k.note, k.name, k.datei, k.quelle]), [[36, 'bd:0', '36.f32', 'schnitt:x-0001/1'], [37, 'hh:0', '37.f32', 'schnitt:x-0001/3']]);
  assert.ok(!fs.existsSync(path.join(o.kits, 'brk', '.sperre')));
  assert.deepEqual(fs.readdirSync(path.join(o.kits, 'brk')).sort(), ['36.f32', '37.f32', 'kit.json']);
});

test('the fade of a short slice covers half of it; the last frame is 0', () => {
  const { o } = neu();
  const d = new Float32Array(40).fill(-1);
  schreibeSchnitt(o, 'k-0001', [0, 10, 20], d);
  legeKit({ id: 'k-0001', scheiben: [0], kit: 'kurz' }, o);
  const y = f32(path.join(o.kits, 'kurz', '36.f32'));
  assert.equal(y.length, 20);
  const a = 5;   // min(240, floor(10 / 2))
  for (let f = 0; f < 10 - a; f++) assert.equal(y[2 * f], -1);
  for (let j = 0; j < a; j++) assert.ok(Math.abs(y[2 * (10 - a + j)] - -(a - 1 - j) / a) < 1e-7, `fade ${j}`);
  assert.ok(Object.is(y[2 * 9], 0));
});

test('band measurement and proposal by band balance', () => {
  const { o } = neu();
  const x = f32(path.join(o.bk, 'samples', 'smp-x-0001.f32'));
  const b0 = baender(x, 0, 4800), b1 = baender(x, 4800, 9600), b2 = baender(x, 9600, 14400), b3 = baender(x, 14400, 19200);
  assert.ok(b0.tief >= 0.5, JSON.stringify(b0));
  assert.ok(b1.tief < 0.3 && b1.mitte >= 0.3, JSON.stringify(b1));
  assert.ok(b2.hoch >= 0.5, JSON.stringify(b2));
  assert.deepEqual([b3.tief, b3.mitte, b3.hoch, b3.spitze], [0, 0, 0, 0]);
  assert.ok(Math.abs(b0.tief + b0.mitte + b0.hoch - 1) < 1e-9);
  assert.ok(b0.spitze > 0.7 && b0.spitze <= 0.8, String(b0.spitze));
  assert.ok(Math.abs(b1.spitze - 0.8) < 1e-3, String(b1.spitze));
  assert.deepEqual(kitVorschlag('x-0001', [0, 1, 2, 3], o).klaenge.map((k) => k.bank), ['bd', 'sd', 'hh', 'perc']);
  assert.equal(bankVorschlag({ tief: 0.1, mitte: 0.1, hoch: 0.1, spitze: 0.0005 }), 'perc');
  assert.equal(bankVorschlag({ tief: 0.4, mitte: 0.2, hoch: 0.4, spitze: 1 }), 'perc');
  // slices of a full mix are all low-heavy: the share above 5 kHz names the hit on top (values measured on library breaks)
  assert.equal(bankVorschlag({ tief: 0.84, mitte: 0.16, hoch: 0.002, spitze: 0.5 }), 'bd');
  assert.equal(bankVorschlag({ tief: 0.69, mitte: 0.25, hoch: 0.054, spitze: 0.4 }), 'sd');
  assert.equal(bankVorschlag({ tief: 0.78, mitte: 0.13, hoch: 0.087, spitze: 0.4 }), 'hh');
});

test('the proposal lists notes, names, sizes and the kit name; it reads only', () => {
  const { o } = neu();
  const v = kitVorschlag('x-0001', [3, 0], o);
  assert.equal(v.kit, 'amen-break');
  assert.deepEqual(v.klaenge.map((k) => [k.scheibe, k.note, k.bank, k.name, k.frames, k.sekunden, k.zu_lang]), [[0, 36, 'bd', 'bd:0', 4800, 0.1, false], [3, 37, 'perc', 'perc:0', 4800, 0.1, false]]);
  assert.deepEqual(Object.keys(v.klaenge[0].baender).sort(), ['hoch', 'mitte', 'tief']);
  assert.deepEqual(eintraege(o), []);
});

test('numbering is contiguous per bank in slice order', () => {
  assert.deepEqual(nummeriere(['bd', 'sd', 'bd', 'hh', 'bd']), ['bd:0', 'sd:0', 'bd:1', 'hh:0', 'bd:2']);
  assert.deepEqual(nummeriere([]), []);
});

test('banks given by the user are numbered on write', () => {
  const { o } = neu();
  const r = legeKit({ id: 'x-0001', scheiben: [0, 1, 2], banken: ['bd', 'sd', 'bd'], kit: 'drei' }, o);
  assert.deepEqual(r.klaenge.map((k) => k.name), ['bd:0', 'sd:0', 'bd:1']);
  // banks pair with the slices as given, then both are sorted
  const q = legeKit({ id: 'x-0001', scheiben: [2, 0], banken: ['hh', 'bd'], kit: 'zwei' }, o);
  assert.deepEqual(q.klaenge.map((k) => [k.scheibe, k.name]), [[0, 'bd:0'], [2, 'hh:0']]);
});

test('kit name: default from the cut name, next free, existing refused (review focus 2)', () => {
  const { o } = neu();
  assert.equal(freierKitName('Amen Break!', o), 'amen-break');
  fs.mkdirSync(path.join(o.kits, 'amen-break'));                    // a stray folder without kit.json
  fs.writeFileSync(path.join(o.kits, 'amen-break', 'stray.txt'), 'keep');
  assert.equal(freierKitName('Amen Break!', o), 'amen-break-2');
  assert.equal(kitVorschlag('x-0001', [0], o).kit, 'amen-break-2');
  assert.equal(freierKitName('', o), 'kit');
  assert.equal(freierKitName('!!!', o), 'kit');
  assert.equal(freierKitName('Ä'.repeat(40) + 'abc', o), 'abc');
  assert.equal(freierKitName('x'.repeat(40), o), 'x'.repeat(28));
  assert.equal(freierKitName(`${'x'.repeat(27)}!y`, o), `${'x'.repeat(27)}`);   // cut to 28 characters, then trimmed of "-"
  wirft(() => legeKit({ id: 'x-0001', scheiben: [0], kit: 'amen-break' }, o), 409, 'kit_vorhanden');
  assert.deepEqual(fs.readdirSync(path.join(o.kits, 'amen-break')), ['stray.txt']);
  assert.equal(fs.readFileSync(path.join(o.kits, 'amen-break', 'stray.txt'), 'utf8'), 'keep');
  // an existing kit stays as it is, too
  legeKit({ id: 'x-0001', scheiben: [0], kit: 'erst' }, o);
  const vorher = fs.readFileSync(path.join(o.kits, 'erst', 'kit.json'), 'utf8');
  wirft(() => legeKit({ id: 'x-0001', scheiben: [1, 2], kit: 'erst' }, o), 409, 'kit_vorhanden');
  assert.equal(fs.readFileSync(path.join(o.kits, 'erst', 'kit.json'), 'utf8'), vorher);
  // without a given name the next free one is taken
  const r = legeKit({ id: 'x-0001', scheiben: [0] }, o);
  assert.equal(r.kit, 'amen-break-2');
  assert.ok(fs.existsSync(path.join(o.kits, 'amen-break-2', 'kit.json')));
});

test('refusals write nothing (review focus 1, 3)', () => {
  const { o } = neu();
  // slice 0 of this cut is 480 001 frames (the proposal marks it, the writer refuses it)
  schreibeSchnitt(o, 'l-0001', [0, 480001, 480011], new Float32Array(480011 * 2), 'Long');
  const lang = kitVorschlag('l-0001', [0, 1], o);
  assert.deepEqual(lang.klaenge.map((k) => k.zu_lang), [true, false]);
  wirft(() => legeKit({ id: 'l-0001', scheiben: [1, 0], kit: 'lang' }, o), 400, 'klang_zu_lang', ['slice 1', '10.0 s']);
  const nichts = () => assert.deepEqual(eintraege(o), []);
  nichts();
  const schlecht = (a, grund = 'argument_ungueltig', code = 400, text) => { wirft(() => legeKit({ id: 'x-0001', ...a }, o), code, grund, text); nichts(); };
  schlecht({ scheiben: [0, 1], banken: ['BD', 'sd'] });
  schlecht({ scheiben: [0, 1], banken: ['bd:2', 'sd'] }, 'argument_ungueltig', 400, 'the number is given in slice order: write the bank only');
  schlecht({ scheiben: [0, 1], banken: ['', 'sd'] });
  schlecht({ scheiben: [0, 1], banken: ['9x', 'sd'] });
  schlecht({ scheiben: [0, 1], banken: [7, 'sd'] });
  schlecht({ scheiben: [0, 1], banken: ['bd'] });                 // wrong length
  schlecht({ scheiben: [] });
  schlecht({ scheiben: [1, 1] });
  schlecht({ scheiben: [9] });
  schlecht({ scheiben: [-1] });
  schlecht({ scheiben: [0.5] });
  schlecht({ scheiben: 'x' });
  schlecht({ scheiben: [0], kit: 'A b' });
  schlecht({ scheiben: [0], kit: '' });
  schlecht({ scheiben: [0], kit: '../x' });
  schlecht({ scheiben: [0], kit: 7 });
  wirft(() => legeKit({ id: 'nope-1', scheiben: [0] }, o), 404, 'schnitt_unbekannt');
  wirft(() => legeKit({ id: '../x', scheiben: [0] }, o), 404, 'schnitt_unbekannt');
  wirft(() => kitVorschlag('nope-1', [0], o), 404, 'schnitt_unbekannt');
  wirft(() => kitVorschlag('x-0001', [4], o), 400, 'argument_ungueltig');
  nichts();
});

test('a cut whose audio is missing or too short is refused before anything is written', () => {
  const { o } = neu();
  fs.rmSync(path.join(o.bk, 'samples', 'smp-x-0001.f32'));
  wirft(() => legeKit({ id: 'x-0001', scheiben: [0] }, o), 404, 'schnitt_unbekannt');
  fs.writeFileSync(path.join(o.bk, 'samples', 'smp-x-0001.f32'), Buffer.alloc(8000));
  wirft(() => legeKit({ id: 'x-0001', scheiben: [0] }, o), 422, 'format_falsch');
  assert.deepEqual(eintraege(o), []);
});

test('a write that fails after mkdir leaves no kit folder behind', () => {
  const { o } = neu();
  let n = 0;
  const echt = fs.renameSync;
  const m = mock.method(fs, 'renameSync', (...a) => { if (++n === 2) throw new Error('disk full'); return echt(...a); });
  try { assert.throws(() => legeKit({ id: 'x-0001', scheiben: [0, 1, 2], kit: 'halb' }, o), /disk full/); } finally { m.mock.restore(); }
  assert.deepEqual(eintraege(o), []);
  // the kit.json rename failing (the last step) leaves nothing, too
  n = 0;
  const m2 = mock.method(fs, 'renameSync', (...a) => { if (String(a[1]).endsWith('kit.json')) throw new Error('no kit.json'); return echt(...a); });
  try { assert.throws(() => legeKit({ id: 'x-0001', scheiben: [0], kit: 'halb' }, o), /no kit.json/); } finally { m2.mock.restore(); }
  assert.deepEqual(eintraege(o), []);
  // the name is free again afterwards
  assert.equal(legeKit({ id: 'x-0001', scheiben: [0], kit: 'halb' }, o).kit, 'halb');
});

test('the lock: a kit folder is invisible without kit.json; the writer waits for no one on a fresh folder', () => {
  const { o } = neu();
  const orig = fs.writeFileSync;
  let gesehen = null;
  const m = mock.method(fs, 'writeFileSync', (p, ...a) => { if (String(p).includes('kit.json')) gesehen = fs.existsSync(path.join(o.kits, 'sehen', '.sperre')); return orig(p, ...a); });
  try { legeKit({ id: 'x-0001', scheiben: [0], kit: 'sehen' }, o); } finally { m.mock.restore(); }
  assert.equal(gesehen, true);                                       // the lock is held while kit.json is written
  assert.ok(!fs.existsSync(path.join(o.kits, 'sehen', '.sperre')));
});

test('limits of count and size', () => {
  const { o } = neu();
  const n = 93;   // notes 36..128 would pass 127
  const d = new Float32Array(n * 4 * 2);
  schreibeSchnitt(o, 'm-0001', Array.from({ length: n + 1 }, (_, k) => k * 4), d, 'Many');
  wirft(() => legeKit({ id: 'm-0001', scheiben: Array.from({ length: n }, (_, k) => k) }, o), 400, 'argument_ungueltig', 'note');
  assert.deepEqual(eintraege(o), []);
});

test('the kit folder follows CYPHERDJ_KIT_ORDNER when no folder is passed', () => {
  const { o, root } = neu();
  const alt = process.env.CYPHERDJ_KIT_ORDNER;
  process.env.CYPHERDJ_KIT_ORDNER = path.join(root, 'env-kits');
  try {
    const r = legeKit({ id: 'x-0001', scheiben: [0], kit: 'envk' }, { ordner: o.ordner, bk: o.bk });
    assert.equal(r.kit, 'envk');
    assert.ok(fs.existsSync(path.join(root, 'env-kits', 'envk', 'kit.json')));
    assert.equal(freierKitName('envk', { ordner: o.ordner, bk: o.bk }), 'envk-2');
  } finally { if (alt === undefined) delete process.env.CYPHERDJ_KIT_ORDNER; else process.env.CYPHERDJ_KIT_ORDNER = alt; }
});

test('kitMuster: the hits sit where the slices sit in the cut, one step long, sorted by beat', () => {
  const raster = { methode: 'raster', beats: 16, frames: 1600, grenzen: [0, 400, 800, 1200, 1600] };
  assert.deepEqual(kitMuster(raster, [{ scheibe: 2, note: 36 }, { scheibe: 0, note: 37 }]), { beats: 16,
    noten: [{ beat: 0, laenge: 0.25, ton: 37, vel: 100 }, { beat: 8, laenge: 0.25, ton: 36, vel: 100 }] });
  const treffer = { methode: 'anschlag', beats: 8, frames: 800, grenzen: [0, 110, 430, 800] };
  assert.deepEqual(kitMuster(treffer, [{ scheibe: 1, note: 36 }]).noten, [{ beat: 1.1, laenge: 0.25, ton: 36, vel: 100 }], 'a hit cut keeps the beat of its bound');
});
