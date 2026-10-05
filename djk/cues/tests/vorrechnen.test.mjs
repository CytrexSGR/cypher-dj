// Vorrechnen im Hintergrund: höchstens 2 Prozesse gleichzeitig, jeder mit nice 19; danach liegt jede Welle im Cache.
// Beobachtet über ps (Stichprobe alle 15 ms). Muss-Treffer: mindestens ein Prozess wurde gesehen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CueServer } from '../server.ts';
import { mp3, tmpOrdner } from './hilfen.mjs';

test('Vorrechnen: <= 2 Prozesse, nice 19, alle Wellen danach im Cache, Aus-Schalter hält an', async (t) => {
  const d = tmpOrdner(t);
  const wurzel = path.join(d, 'musik');
  for (let i = 0; i < 8; i++) mp3(path.join(wurzel, `${i}_T_Mix.mp3`), { f: 80 + i * 100, dauer: 150, meta: { TBPM: '128' } });
  // Lastgrenze hoch: der Test prüft Prozesszahl und nice, nicht die Last der Maschine (die prüft der nächste Test)
  const s = new CueServer({ port: 0, wurzel, nml: null, daten: path.join(d, 'daten'), cache: path.join(d, 'cache'), lastGrenze: 1000 });
  await s.starte();
  t.after(() => s.stoppe());
  const marke = path.join(d, 'cache', 'welle');
  await fetch(`http://127.0.0.1:${s.port}/api/vorrechnen`, { method: 'POST' });
  let maxGleichzeitig = 0; const nices = new Set(); let gesehen = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    const ps = execFileSync('ps', ['-eo', 'ni=,args='], { encoding: 'utf8' }).split('\n').filter((z) => z.includes('welle.ts') && z.includes(marke));
    maxGleichzeitig = Math.max(maxGleichzeitig, ps.length);
    for (const z of ps) { nices.add(z.trim().split(/\s+/)[0]); gesehen++; }
    const st = await (await fetch(`http://127.0.0.1:${s.port}/api/status`)).json();
    if (!st.vorrechnen.laeuft) break;
    await new Promise((r) => setTimeout(r, 15));
  }
  const st = (await (await fetch(`http://127.0.0.1:${s.port}/api/status`)).json()).vorrechnen;
  assert.ok(gesehen > 0, 'Muss-Treffer: kein Rechenprozess beobachtet, Stichprobe blind');
  assert.ok(maxGleichzeitig <= 2, `gleichzeitig ${maxGleichzeitig}`);
  assert.deepEqual([...nices], ['19']);
  assert.deepEqual({ fertig: st.fertig, gesamt: st.gesamt, fehler: st.fehler }, { fertig: 8, gesamt: 8, fehler: 0 });
  assert.equal(fs.readdirSync(marke).filter((f) => f.endsWith('.welle')).length, 8);
  // Negativ-Kontrolle: zweiter Lauf hat nichts mehr zu tun
  await fetch(`http://127.0.0.1:${s.port}/api/vorrechnen`, { method: 'POST' });
  await new Promise((r) => setTimeout(r, 200));
  const st2 = (await (await fetch(`http://127.0.0.1:${s.port}/api/status`)).json()).vorrechnen;
  assert.deepEqual({ gesamt: st2.gesamt, laeuft: st2.laeuft }, { gesamt: 0, laeuft: false });
});

test('Lastbremse: über der Grenze startet kein Rechenprozess, Status meldet die Pause; Aus-Schalter beendet', async (t) => {
  const d = tmpOrdner(t);
  const wurzel = path.join(d, 'musik');
  mp3(path.join(wurzel, '0_T_Mix.mp3'), { f: 80, dauer: 5 });
  const s = new CueServer({ port: 0, wurzel, nml: null, daten: path.join(d, 'daten'), cache: path.join(d, 'cache'), lastGrenze: -1 });
  await s.starte();
  t.after(() => s.stoppe());
  await fetch(`http://127.0.0.1:${s.port}/api/vorrechnen`, { method: 'POST' });
  await new Promise((r) => setTimeout(r, 1500));
  const st = (await (await fetch(`http://127.0.0.1:${s.port}/api/status`)).json()).vorrechnen;
  assert.deepEqual({ laeuft: st.laeuft, pausiert_last: st.pausiert_last, fertig: st.fertig }, { laeuft: true, pausiert_last: true, fertig: 0 });
  assert.deepEqual(fs.readdirSync(path.join(d, 'cache', 'welle')), []);
  await fetch(`http://127.0.0.1:${s.port}/api/vorrechnen?an=0`, { method: 'POST' });
  await new Promise((r) => setTimeout(r, 800));
  assert.equal((await (await fetch(`http://127.0.0.1:${s.port}/api/status`)).json()).vorrechnen.laeuft, false);
});
