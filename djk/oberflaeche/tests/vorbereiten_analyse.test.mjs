// Paket 1.13 Warp, Slice 3a (Task 11): Vorbereiter im Analyse-Modus (zusatzArgs, bei, Status analysiert) und der Adapter WerkstattAnalyse. Attrappen-Einleser sind
// Shell-Skripte, die die Ergebniszeile von werkstatt.einzeln schreiben (Format: djk/werkstatt/werkstatt/einzeln.py).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Vorbereiter } from '../mediathek.ts';
import { WerkstattAnalyse } from '../bereiche/proj/analyse.ts';

const tmpDir = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-va-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const skript = (dir, koerper) => { const p = path.join(dir, 'einleser.sh'); fs.writeFileSync(p, `#!/bin/sh\n${koerper}\n`, { mode: 0o755 }); return p; };
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const bis = async (f, ms = 5000) => { const t0 = Date.now(); for (;;) { const r = f(); if (r) return r; if (Date.now() - t0 > ms) assert.fail('Bedingung nicht eingetreten'); await warte(20); } };
const MID = '0123456789abcdef', SHA = MID + 'f'.repeat(48);

test('Vorbereiter im Analyse-Modus: zusatzArgs hinter --bestand, analysiert ist Erfolg, bei meldet das Ende genau einmal', async (t) => {
  const d = tmpDir(t), args = path.join(d, 'args.txt');
  const sh = skript(d, `printf '%s\\n' "$@" > '${args}'\necho '{"status": "analysiert", "material_id": "${MID}"}'`);
  const enden = [];
  const v = new Vorbereiter({ python: sh, cwd: d, bestand: path.join(d, 'ablage'), zusatzArgs: ['--nur-analyse'], bei: (mid, st) => enden.push([mid, st.status]) });
  t.after(() => v.stoppe());
  assert.equal(v.starte(MID, '/q.wav', 'T'), 'gestartet');
  await bis(() => enden.length === 1);
  await warte(100);
  assert.deepEqual(enden, [[MID, 'analysiert']]);
  assert.equal(v.stand(MID).status, 'analysiert');
  const a = fs.readFileSync(args, 'utf8').trim().split('\n');
  assert.equal(a.at(-1), '--nur-analyse'); assert.equal(a[a.indexOf('--bestand') + 1], path.join(d, 'ablage'));
});

test('Negativ-Kontrolle: ohne zusatzArgs kein --nur-analyse; ein fehlgeschlagener Lauf meldet fehler mit Grund an bei; bei darf werfen, ohne den Vorbereiter zu stören', async (t) => {
  const d = tmpDir(t), args = path.join(d, 'args.txt');
  const sh = skript(d, `printf '%s\\n' "$@" > '${args}'\necho '{"status": "fehler", "material_id": "", "grund": "RuntimeError: kaputt"}'\nexit 1`);
  const enden = [];
  const v = new Vorbereiter({ python: sh, cwd: d, bestand: d, bei: (mid, st) => { enden.push([st.status, st.grund]); throw new Error('bei wirft'); } });
  t.after(() => v.stoppe());
  v.starte(MID, '/q.wav', 'T');
  await bis(() => enden.length === 1);
  assert.deepEqual(enden, [['fehler', 'RuntimeError: kaputt']]);
  assert.ok(!fs.readFileSync(args, 'utf8').includes('--nur-analyse'));
  assert.equal(v.starte(MID, '/q.wav', 'T'), 'gestartet', 'der Vorbereiter lebt weiter');
});

test('WerkstattAnalyse: ein Lauf zugleich, dieselbe sha doppelt = ein Lauf mit beiden Rückrufen, ausgelastet für eine zweite sha; Ende ok bei analysiert und vorhanden, nicht ok bei fehler', async (t) => {
  const d = tmpDir(t), go = path.join(d, 'go');
  const sh = skript(d, `while [ ! -f '${go}' ]; do sleep 0.05; done\necho '{"status": "analysiert", "material_id": "${MID}"}'`);
  const a = new WerkstattAnalyse({ python: sh, cwd: d, ablage: path.join(d, 'ablage') });
  t.after(() => a.stoppe());
  const enden = [];
  assert.equal(a.starte(SHA, '/musik/stück.wav', (e) => enden.push(['a', e])), 'gestartet');
  assert.equal(a.starte(SHA, '/musik/stück.wav', (e) => enden.push(['b', e])), 'laeuft');
  assert.equal(a.starte('1'.repeat(64), '/musik/x.wav', () => assert.fail('ausgelastet startet nie')), 'ausgelastet');
  fs.writeFileSync(go, '');
  await bis(() => enden.length === 2);
  assert.deepEqual(enden, [['a', { ok: true }], ['b', { ok: true }]]);
  assert.equal(a.starte('1'.repeat(64), '/musik/x.wav', () => {}), 'gestartet', 'der Platz ist wieder frei');
});

test('WerkstattAnalyse: Ende mit fehler gibt ok false und den Grund', async (t) => {
  const d = tmpDir(t);
  const sh = skript(d, `echo '{"status": "fehler", "material_id": "", "grund": "RuntimeError: In RhythmExtractor2013.compute"}'\nexit 1`);
  const a = new WerkstattAnalyse({ python: sh, cwd: d, ablage: path.join(d, 'ablage') });
  t.after(() => a.stoppe());
  const enden = [];
  a.starte(SHA, '/musik/mix.wav', (e) => enden.push(e));
  await bis(() => enden.length === 1);
  assert.deepEqual(enden, [{ ok: false, grund: 'RuntimeError: In RhythmExtractor2013.compute' }]);
});
