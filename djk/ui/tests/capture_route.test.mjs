// Journey tours, task 2: the /mitschnitt routes on the real Router with a fake recorder (a shell script) and a fake unit runner; no systemd, no core.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Router } from '../http/router.ts';
import { json } from '../http/transport.ts';
import { mitschnittBereich } from '../areas/mitschnitt/area.ts';
import { tmpOrdner } from './support/kit_build.mjs';

const GUT = `#!/bin/sh
while [ $# -gt 0 ]; do case $1 in --aus) A=$2; shift 2;; --stopp) S=$2; shift 2;; *) shift;; esac; done
printf RIFF > "$A"
echo "setmitschnitt: 10 s, peak -12.5 dBFS" >&2
while [ ! -e "$S" ]; do sleep 0.05; done
printf '{"datei":"x","frames":480000,"ok":true,"ereignisse":[{"art":"luecke"},{"art":"luecke"},{"art":"steht"}]}' > "$A.json"
`;
const KAPUTT = `#!/bin/sh
echo "setmitschnitt: out.wav: writing failed" >&2
exit 5
`;
const KEIN_RING = `#!/bin/sh
echo "setmitschnitt: /dev/shm/x/bus: missing or not a ring of version 1" >&2
exit 3
`;

/** A fake of the unit runner: the unit is a child process; stderr goes to the log file like StandardError=append: does. */
function attrappe() {
  const einheiten = new Map();
  const gestartet = [];
  return {
    gestartet,
    async start(unit, programm, args, umgebung, logDatei) {
      gestartet.push({ unit, programm, args, umgebung });
      const log = fs.openSync(logDatei, 'a');
      const e = { code: null, kind: spawn(programm, args, { stdio: ['ignore', 'ignore', log], env: { ...process.env, ...umgebung } }) };
      e.fertig = new Promise((ok) => e.kind.on('exit', (c) => { e.code = c ?? 1; ok(); }));
      fs.closeSync(log);
      einheiten.set(unit, e);
    },
    async aktiv(unit) { const e = einheiten.get(unit); return !!e && e.code === null; },
    async ende(unit) { const e = einheiten.get(unit); if (e) await e.fertig; return e ? e.code : null; },
    async stopp(unit) { const e = einheiten.get(unit); if (e && e.code === null) { e.kind.kill('SIGTERM'); await e.fertig; } },
    raeume() { for (const e of einheiten.values()) if (e.code === null) e.kind.kill('SIGKILL'); },
  };
}

async function stapel(t, o = {}) {
  const d = tmpOrdner(t, 'mitschnitt-');
  const skript = path.join(d, 'recorder.sh');
  fs.writeFileSync(skript, o.skript ?? GUT, { mode: 0o755 });
  const laeufer = o.laeufer ?? attrappe();
  t.after(() => laeufer.raeume?.());
  let kern = true;
  const log = [];
  const bau = () => mitschnittBereich({ log: (z) => log.push(z) }, {
    ordner: () => path.join(d, 'aufnahmen'), zustandsDatei: path.join(d, 'shm', 'mitschnitt.json'), programm: () => skript,
    instanz: 'c', kernDa: () => kern, laeufer, anlaufMs: 300, stoppWarteMs: 3000, jetzt: () => new Date(2026, 10, 23, 14, 5, 9),
  });
  const server = (bereich) => {
    const router = new Router();
    router.melde(bereich);
    const s = http.createServer(async (q, a) => {
      const url = new URL(q.url ?? '/', 'http://127.0.0.1');
      const r = router.finde(q.method ?? '', url.pathname);
      if (!r) return json(a, 404, { fehler: 'keine_route' });
      await r.handler(q, a, url);
    });
    return new Promise((ok) => s.listen(0, '127.0.0.1', () => { t.after(() => s.close()); ok(s.address().port); }));
  };
  const rufer = (port) => ({
    stand: async () => { const r = await fetch(`http://127.0.0.1:${port}/mitschnitt/stand`); return { code: r.status, j: await r.json() }; },
    post: async (pfad, body) => { const r = await fetch(`http://127.0.0.1:${port}${pfad}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) }); return { code: r.status, j: await r.json() }; },
  });
  const port = await server(bau());
  return { d, laeufer, log, ...rufer(port), setzeKern: (v) => { kern = v; }, neuerBereich: async () => rufer(await server(bau())) };
}

test('start, a second start, stand with the peak, stop with the end numbers, stop again', async (t) => {
  const s = await stapel(t);
  const a = await s.post('/mitschnitt/start', { name: 'mein-set' });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.equal(a.j.ok, true);
  assert.equal(a.j.datei, path.join(s.d, 'aufnahmen', 'mein-set.wav'));
  assert.equal(s.laeufer.gestartet.length, 1);
  assert.equal(s.laeufer.gestartet[0].unit, 'cypherdj-setmitschnitt-c');
  assert.equal(s.laeufer.gestartet[0].umgebung.CYPHERDJ_INSTANZ, 'c');
  const b = await s.post('/mitschnitt/start', {});
  assert.deepEqual([b.code, b.j.grund, b.j.ok], [409, 'mitschnitt_laeuft', false]);
  assert.match(b.j.text, /already running/);
  assert.equal(s.laeufer.gestartet.length, 1, 'no second unit');
  const st = await s.stand();
  assert.equal(st.j.laeuft, true);
  assert.equal(st.j.datei, a.j.datei);
  assert.equal(st.j.spitze_db, -12.5);
  assert.equal(typeof st.j.sekunden, 'number');
  const z = await s.post('/mitschnitt/stopp');
  assert.equal(z.code, 200, JSON.stringify(z.j));
  assert.deepEqual([z.j.datei, z.j.sekunden, z.j.luecken, z.j.spruenge], [a.j.datei, 10, 2, 0]);
  assert.ok(fs.existsSync(a.j.datei));
  assert.equal((await s.stand()).j.laeuft, false);
  const z2 = await s.post('/mitschnitt/stopp');
  assert.deepEqual([z2.code, z2.j.grund], [409, 'kein_mitschnitt']);
});

test('without a name the file is named after the date and time; an existing name gets a suffix', async (t) => {
  const s = await stapel(t);
  const a = await s.post('/mitschnitt/start');
  assert.equal(path.basename(a.j.datei), '2026-11-23_14-05-09.wav');
  await s.post('/mitschnitt/stopp');
  const b = await s.post('/mitschnitt/start', {});
  assert.equal(path.basename(b.j.datei), '2026-11-23_14-05-09-2.wav', 'the first recording stays');
  await s.post('/mitschnitt/stopp');
});

test('stand before the first peak line has no spitze_db', async (t) => {
  const s = await stapel(t, { skript: GUT.replace('echo "setmitschnitt: 10 s, peak -12.5 dBFS" >&2\n', '') });
  await s.post('/mitschnitt/start', {});
  const st = await s.stand();
  assert.equal(st.j.laeuft, true);
  assert.equal('spitze_db' in st.j, false);
  await s.post('/mitschnitt/stopp');
});

test('a core reported as not running: 503 kern_fehlt and no unit started', async (t) => {
  const s = await stapel(t);
  s.setzeKern(false);
  const r = await s.post('/mitschnitt/start', {});
  assert.deepEqual([r.code, r.j.grund], [503, 'kern_fehlt']);
  assert.equal(s.laeufer.gestartet.length, 0);
});

test('a recorder that exits 3 right away (no ring) is kern_fehlt too, exit 5 is mitschnitt_fehler with the log line', async (t) => {
  const a = await stapel(t, { skript: KEIN_RING });
  const r = await a.post('/mitschnitt/start', {});
  assert.deepEqual([r.code, r.j.grund], [503, 'kern_fehlt']);
  assert.match(r.j.detail, /not a ring/);
  assert.equal((await a.stand()).j.laeuft, false, 'no state is left behind');
  const b = await stapel(t, { skript: KAPUTT });
  const f = await b.post('/mitschnitt/start', {});
  assert.deepEqual([f.code, f.j.grund], [500, 'mitschnitt_fehler']);
  assert.equal(f.j.detail, 'setmitschnitt: out.wav: writing failed');
  assert.equal((await b.stand()).j.laeuft, false);
});

test('a page restart (a new Bereich over the same state file) sees the running recording and stops it', async (t) => {
  const s = await stapel(t);
  const a = await s.post('/mitschnitt/start', { name: 'neustart' });
  const neu = await s.neuerBereich();
  const st = await neu.stand();
  assert.equal(st.j.laeuft, true);
  assert.equal(st.j.datei, a.j.datei);
  const z = await neu.post('/mitschnitt/stopp');
  assert.equal(z.code, 200, JSON.stringify(z.j));
  assert.equal(z.j.sekunden, 10);
  assert.equal((await s.stand()).j.laeuft, false);
});

test('a stale state file (the unit is gone) is removed and reads as not running', async (t) => {
  const s = await stapel(t);
  fs.mkdirSync(path.join(s.d, 'shm'), { recursive: true });
  const zf = path.join(s.d, 'shm', 'mitschnitt.json');
  fs.writeFileSync(zf, JSON.stringify({ unit: 'cypherdj-setmitschnitt-c', datei: '/x/y.wav', seit: '2026-11-23T00:00:00.000Z', start_ms: 0 }));
  assert.equal((await s.stand()).j.laeuft, false);
  assert.equal(fs.existsSync(zf), false);
});

test('a bad name is 400 name_ungueltig and nothing is started', async (t) => {
  const s = await stapel(t);
  for (const name of ['../x', 'A', '', 'a b', 'x'.repeat(41), 5]) {
    const r = await s.post('/mitschnitt/start', { name });
    assert.deepEqual([r.code, r.j.grund], [400, 'name_ungueltig'], String(name));
    assert.match(r.j.text, /1 to 40 characters/);
  }
  assert.equal(s.laeufer.gestartet.length, 0);
});

test('a recording that has no end file after the stop is mitschnitt_fehler', async (t) => {
  const s = await stapel(t, { skript: GUT.replace(/printf '\{.*\n/, '') });
  await s.post('/mitschnitt/start', {});
  const z = await s.post('/mitschnitt/stopp');
  assert.deepEqual([z.code, z.j.grund], [500, 'mitschnitt_fehler']);
});
