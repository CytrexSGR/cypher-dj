// S18 task 3: ONE erzeuger process serves the Baukasten streams 5, 6, 7, 9, 10 (erz/5..7, pad/1, pad/2) with a single
// kern subscriber slot: one hello name, five stream announcements with MIDI targets, per-stream pattern folders,
// a heartbeat file per stream and a refusal of streams outside the table.
import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { kodiere, dekodiere } from '../../contract/mock_core/osc.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const PROZESS = path.join(HIER, '../generator_bk.mjs');
const STROEME = [5, 6, 7, 9, 10];
const warte = (ms) => new Promise((r) => setTimeout(r, ms));

async function starte(t, { strom = STROEME.join(',') } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'erzbk-'));
  for (const s of STROEME) fs.mkdirSync(path.join(tmp, `erzeuger${s}`));
  const kern = dgram.createSocket('udp4');
  await new Promise((r) => kern.bind(0, '127.0.0.1', r));
  const eingang = [];
  let abo = null;
  kern.on('message', (b) => { const m = dekodiere(b); eingang.push(m); if (m.adresse === '/k/hallo') abo = m.werte[1]; });
  const p = spawn(process.execPath, ['--permission', `--allow-fs-read=${path.resolve(HIER, '../..')}`,
    `--allow-fs-read=${process.env.HOME}/strudel`, `--allow-fs-read=${tmp}`, `--allow-fs-write=${tmp}`,
    PROZESS, '--kern-port', String(kern.address().port), '--abo-port', '0', '--strom', strom,
    '--muster-basis', path.join(tmp, 'generator'), '--name', 'erzeuger-bk'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const r = { tmp, kern, eingang, p, log: '' };
  p.stderr.on('data', (d) => { r.log += d; });
  t.after(() => { p.kill('SIGTERM'); kern.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
  for (let i = 0; i < 100 && !abo; i++) await warte(50);
  assert.ok(abo, `no /k/hallo: ${r.log}`);
  r.abo = abo;
  r.uhr = (beat, bpm = 240) => kern.send(kodiere('/uhr', 'hhddd', [0n, process.hrtime.bigint(), beat, bpm, 0]), abo, '127.0.0.1');
  return r;
}
const stroeme = (eingang) => eingang.filter((m) => m.adresse === '/erz/strom').map((m) => m.werte.slice(2));
const fenster = (eingang) => eingang.filter((m) => m.bundle).map((b) => ({ strom: b.elemente[0].werte[0],
  noten: b.elemente.slice(1).map((e) => e.werte[3]) }));

test('one hello name over 2.5 s, five /erz/strom announcements with the MIDI targets of the table', { timeout: 20000 }, async (t) => {
  const x = await starte(t);
  x.uhr(6.0);
  await warte(2500);
  const namen = new Set(x.eingang.filter((m) => m.adresse === '/k/hallo').map((m) => m.werte[0]));
  assert.deepEqual([...namen], ['erzeuger-bk']);                       // 1. a single subscriber slot
  assert.ok(x.eingang.filter((m) => m.adresse === '/k/hallo').length >= 2);   // the hello repeats every second
  assert.deepEqual(stroeme(x.eingang), [                                // 2. (strom, ziel, kanal)
    [5, 'midi:3:1', 'erz/5'], [6, 'midi:3:2', 'erz/6'], [7, 'midi:3:3', 'erz/7'], [9, 'midi:4:1', 'pad/1'], [10, 'midi:4:2', 'pad/2']]);
});

test('a pattern in erzeuger6 produces MIDI notes on stream 6 only; stream 5 stays silent (negative control)', { timeout: 20000 }, async (t) => {
  const x = await starte(t);
  fs.writeFileSync(path.join(x.tmp, 'erzeuger6/strom1.js'), 'note("c3 e3")');
  x.uhr(6.0);
  await warte(1500);
  const f = fenster(x.eingang);
  assert.ok(f.length >= 1, `no window: ${x.log}`);
  // 3. only stream 6 carries events (the planner also sends empty windows for streams without a pattern; they clear the kern queue)
  assert.ok(f.filter((w) => w.noten.length).every((w) => w.strom === 6), JSON.stringify(f));
  assert.ok(f.some((w) => w.strom === 6 && w.noten.includes(48) && w.noten.includes(52)), JSON.stringify(f));   // MIDI note numbers, not kit indices
  assert.ok(f.some((w) => w.strom === 5) && f.filter((w) => w.strom !== 6).every((w) => w.noten.length === 0), JSON.stringify(f));   // negative control: no pattern, no events
});

test('/e/neustart announces all five streams again', { timeout: 20000 }, async (t) => {
  const x = await starte(t);
  x.uhr(6.0);
  await warte(500);
  const vorher = stroeme(x.eingang).length;
  assert.equal(vorher, 5);
  x.kern.send(kodiere('/e/neustart', 'ih', [1, 0n]), x.abo, '127.0.0.1');
  await warte(500);
  assert.equal(stroeme(x.eingang).length, vorher + 5);                              // 4.
});

// S17 race: the kern repeats /e/neustart of the same generation on the next heartbeat; announcing all five streams on
// both let the repeat replace a graph that the page server had restored on erz/5..7 (midi target = empty graph).
test('/e/neustart announces the five streams once per generation, not on the heartbeat repeat', { timeout: 30000 }, async (t) => {
  const x = await starte(t);
  const neustart = (g) => x.kern.send(kodiere('/e/neustart', 'ih', [g, 0n]), x.abo, '127.0.0.1');
  const willkommen = (g) => x.kern.send(kodiere('/k/willkommen', 'iihdds', [1, g, 0n, 0, 240, 'test']), x.abo, '127.0.0.1');
  x.uhr(6.0);
  await warte(500);
  const start = stroeme(x.eingang).length;
  assert.equal(start, 5);
  neustart(1);
  await warte(400);
  assert.equal(stroeme(x.eingang).length, start + 5, 'the first /e/neustart of generation 1 announces all five');
  willkommen(1);                                                                     // heartbeat repeat, same generation
  neustart(1);
  await warte(400);
  assert.equal(stroeme(x.eingang).length, start + 5, 'the repeat must not announce again');
  neustart(2);                                                                       // negative control: a new generation announces
  await warte(400);
  assert.equal(stroeme(x.eingang).length, start + 10, 'generation 2 announces all five');
  willkommen(0);                                                                     // reset rule
  neustart(2);
  await warte(400);
  assert.equal(stroeme(x.eingang).length, start + 15, 'after a /k/willkommen of another generation the same number announces again');
});

test('lebt.json heartbeat per stream folder, fresh after two bars at 240 BPM', { timeout: 20000 }, async (t) => {
  const x = await starte(t);
  x.uhr(6.0);
  await warte(2300);                                                                 // 240 BPM: one bar is 1 s
  for (const s of STROEME) {
    const lebt = JSON.parse(fs.readFileSync(path.join(x.tmp, `erzeuger${s}/lebt.json`), 'utf8'));   // 5.
    assert.equal(lebt.strom, s);
    assert.ok(Math.abs(Date.now() - lebt.zeit) < 3000, `stream ${s}: ${Date.now() - lebt.zeit} ms old`);
  }
});

test('streams outside the table exit 2 with a message (4 is the production, 1 belongs to generator.mjs)', async () => {
  for (const strom of ['4', '1,5', '8', '5,5']) {
    const r = spawnSync(process.execPath, [PROZESS, '--strom', strom, '--abo-port', '0'], { encoding: 'utf8', timeout: 10000 });
    assert.equal(r.status, 2, `--strom ${strom}: exit ${r.status} ${r.stderr}`);
    assert.match(r.stderr, /strom/i);
  }
});

test('a late quittung for stream 7 is logged with the stream number; one for a foreign stream is not', { timeout: 20000 }, async (t) => {
  const x = await starte(t);
  x.uhr(6.0);
  await warte(300);
  x.kern.send(kodiere('/erz/quittung', 'iiiiiii', [7, 12, 0, 0, 0, 3, 0]), x.abo, '127.0.0.1');
  x.kern.send(kodiere('/erz/quittung', 'iiiiiii', [2, 13, 0, 0, 0, 9, 0]), x.abo, '127.0.0.1');
  await warte(300);
  assert.match(x.log, /stream 7: shipment 12: 3 events late/);
  assert.doesNotMatch(x.log, /shipment 13/);
});

// Bug t_bffc3708 (2): `stille` writes `silence` into the pattern folder of every stream. The erzeuger process must then ship the replacing
// window with kappe = 1 (4th field of /erz/fenster) for exactly that stream, so the kern ends the note that is still sounding.
const kappen = (eingang) => eingang.filter((m) => m.bundle).map((b) => ({ strom: b.elemente[0].werte[0], kappe: b.elemente[0].werte[3],
  ab: b.elemente[0].werte[4], n: b.elemente.length - 1 }));

test('held note on stream 6, then silence: the replacing window of stream 6 carries kappe = 1, no other stream does', { timeout: 20000 }, async (t) => {
  const x = await starte(t);
  fs.writeFileSync(path.join(x.tmp, 'erzeuger6/strom1.js'), 'note("c3").slow(4)');   // one note of 16 beats
  x.uhr(6.0);
  await warte(1500);
  assert.ok(kappen(x.eingang).every((w) => w.kappe === 0), 'no kappe while the pattern plays');
  const vorher = x.eingang.length;
  fs.writeFileSync(path.join(x.tmp, 'erzeuger6/strom1.js'), 'silence');
  await warte(1500);
  const danach = kappen(x.eingang.slice(vorher));
  const geschnitten = danach.filter((w) => w.kappe === 1);
  assert.equal(geschnitten.length, 1, JSON.stringify(danach));
  assert.equal(geschnitten[0].strom, 6);
  assert.equal(geschnitten[0].n, 0, 'the silence window has no events');
  assert.equal(geschnitten[0].ab % 4, 0, 'it starts on a bar line');
});

test('a new pattern with notes after the held one sends no kappe (negative control: pattern change alone does not cut)', { timeout: 20000 }, async (t) => {
  const x = await starte(t);
  fs.writeFileSync(path.join(x.tmp, 'erzeuger6/strom1.js'), 'note("c3").slow(4)');
  x.uhr(6.0);
  await warte(1500);
  fs.writeFileSync(path.join(x.tmp, 'erzeuger6/strom1.js'), 'note("e3 g3")');
  await warte(1500);
  assert.ok(kappen(x.eingang).length > 0 && kappen(x.eingang).every((w) => w.kappe === 0), JSON.stringify(kappen(x.eingang).filter((w) => w.kappe)));
});
