// Sperre je Liste (Re-Review N1–N4): nie blockierend warten, verwaist heißt „der Prozess lebt nicht mehr“ (nicht mtime), Symlink und
// kaputte Dateien sind kein Endlos-Fall, Übernahme einer verwaisten Sperre ist atomar. Plan 2026-10-10-mediathek-browser, S2b.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Sammlungen } from '../sammlung.ts';
import { nimmSperre, startzeit, SperreBelegt } from '../sperre.ts';
import { stapel, hole, post, tmpMt } from './hilfen/mediathek.mjs';

const ordner = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-sperre-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const M1 = 'aaaaaaaaaaaaaaaa', M2 = 'bbbbbbbbbbbbbbbb';
// ein lebender Fremdprozess und ein toter (PID existiert nicht mehr)
function fremd(t) {
  const k = spawn('sleep', ['60'], { stdio: 'ignore' });
  t.after(() => { try { process.kill(k.pid, 'SIGTERM'); } catch { /* schon weg */ } });
  return { pid: k.pid, start: startzeit(k.pid) };
}
async function toterPid() {
  const k = spawn('true'); await new Promise((r) => k.on('close', r));
  return k.pid;
}
const sperreVon = (d, slug) => path.join(d, slug, '.sperre');
const zeit = async (f) => { const t0 = performance.now(); let r; try { r = await f(); } catch (e) { r = e; } return [performance.now() - t0, r]; };

test('lebender Fremdprozess hält die Sperre: sofort 409, auch wenn die Datei uralt ist (nach PID, nicht nach der Uhr)', async (t) => {
  const d = ordner(t), s = new Sammlungen(d), slug = s.lege('L', [], 'playlist');
  const f = fremd(t);
  fs.writeFileSync(sperreVon(d, slug), JSON.stringify(f));
  const alt = new Date(Date.now() - 2 * 3600_000); fs.utimesSync(sperreVon(d, slug), alt, alt);
  const [ms, e] = await zeit(() => s.legeHinzu(slug, 'track', M1));
  assert.equal(e.fehler, 'liste_busy'); assert.equal(e.code, 409);
  assert.ok(ms < 50, `sofort, nicht nach 5 s: ${ms.toFixed(1)} ms`);
  assert.equal(s.lies(slug).posten.length, 0);
  assert.ok(fs.existsSync(sperreVon(d, slug)), 'die fremde Sperre bleibt');
});

test('toter Besitzer: die Sperre ist verwaist und wird übernommen, auch bei mtime in der Zukunft (Uhrsprung)', async (t) => {
  const d = ordner(t), s = new Sammlungen(d), slug = s.lege('L', [], 'playlist');
  fs.writeFileSync(sperreVon(d, slug), JSON.stringify({ pid: await toterPid(), start: '12345' }));
  const zukunft = new Date(Date.now() + 3600_000); fs.utimesSync(sperreVon(d, slug), zukunft, zukunft);
  const [ms, r] = await zeit(() => s.legeHinzu(slug, 'track', M1));
  assert.equal(r.schon_drin, false); assert.ok(ms < 200, `${ms.toFixed(1)} ms`);
  assert.deepEqual(fs.readdirSync(path.join(d, slug)).sort(), ['set.json'], 'nichts bleibt liegen');
  // PID-Wiederverwendung: dieselbe PID, andere Startzeit → ebenfalls verwaist
  const f = fremd(t);
  fs.writeFileSync(sperreVon(d, slug), JSON.stringify({ pid: f.pid, start: String(Number(f.start) + 1) }));
  assert.equal(s.legeHinzu(slug, 'track', M2).schon_drin, false, 'andere Startzeit = anderer Prozess');
});

test('kaputte Sperrdateien (Symlink ins Leere, Verzeichnis, Müll, leer) sind verwaist, nie eine Endlosschleife', async (t) => {
  const d = ordner(t), s = new Sammlungen(d), slug = s.lege('L', [], 'playlist');
  const faelle = {
    'Symlink ins Leere': (p) => fs.symlinkSync('/nirgends/hin', p),
    'Symlink auf eine Datei': (p) => { fs.writeFileSync(`${p}.ziel`, JSON.stringify(fremd(t))); fs.symlinkSync(`${p}.ziel`, p); },
    'Verzeichnis': (p) => { fs.mkdirSync(p); fs.writeFileSync(path.join(p, 'x'), 'x'); },
    'Müll': (p) => fs.writeFileSync(p, 'kein json'),
    'leer': (p) => fs.writeFileSync(p, ''),
  };
  let n = 0;
  for (const [name, mach] of Object.entries(faelle)) {
    fs.rmSync(sperreVon(d, slug), { recursive: true, force: true }); fs.rmSync(`${sperreVon(d, slug)}.ziel`, { force: true });
    mach(sperreVon(d, slug));
    const [ms, r] = await zeit(() => s.legeHinzu(slug, 'track', `${'c'.repeat(15)}${(n++).toString(16)}`));
    assert.equal(r.schon_drin, false, `${name}: ${r.message ?? ''}`);
    assert.ok(ms < 500, `${name}: ${ms.toFixed(1)} ms`);
  }
  assert.equal(s.lies(slug).posten.length, 5);
  assert.deepEqual(fs.readdirSync(path.join(d, slug)).sort(), ['set.json', '.sperre.ziel'].sort().filter((x) => fs.existsSync(path.join(d, slug, x))), 'bis auf die Testdatei bleibt nichts liegen');
});

test('Doppel-Übernahme: räumt B eine verwaiste Sperre ab, nachdem A sie schon übernommen hat, bleibt A Besitzer und B bekommt 409', async (t) => {
  const d = ordner(t), p = path.join(d, '.sperre');
  fs.writeFileSync(p, JSON.stringify({ pid: await toterPid(), start: '1' }));
  const f = fremd(t);   // „A“: ein lebender Prozess, der zwischen B's Urteil und B's Abräumen die Sperre übernimmt
  let freigabeA = null;
  const haken = { nachUrteil: () => { fs.rmSync(p); fs.writeFileSync(p, JSON.stringify(f)); freigabeA = true; } };
  assert.throws(() => nimmSperre(p, haken), SperreBelegt, 'B sieht die lebende Sperre von A');
  assert.ok(freigabeA);
  assert.deepEqual(JSON.parse(fs.readFileSync(p, 'utf8')), f, 'die Sperre von A liegt unverändert wieder da (zurückgelegt, nicht entfernt)');
  assert.deepEqual(fs.readdirSync(d).sort(), ['.sperre'], 'kein „.tot“-Rest');
  // Negativkontrolle: ohne Dazwischenkommen übernimmt B die verwaiste Sperre normal
  fs.rmSync(p); fs.writeFileSync(p, JSON.stringify({ pid: await toterPid(), start: '1' }));
  const frei = nimmSperre(p); assert.equal(JSON.parse(fs.readFileSync(p, 'utf8')).pid, process.pid); frei();
  assert.deepEqual(fs.readdirSync(d), []);
});

test('Server: während eine Fremdsperre liegt, antworten andere Routen in unter 50 ms (nichts blockiert), das POST wird nach kurzem Warten 409', async (t) => {
  const m = tmpMt(t), d = ordner(t), s0 = new Sammlungen(d), slug = s0.lege('L', [], 'playlist');
  const s = await stapel(t, { mediathek: m.db, sammlungen: d });
  const f = fremd(t);
  fs.writeFileSync(sperreVon(d, slug), JSON.stringify(f));
  const mid = (await import('./hilfen/mediathek.mjs')).mid;
  const lang = post(s.url, `/sammlungen/${slug}/posten`, { art: 'track', material_id: mid(5) });   // wartet asynchron, blockiert nicht
  const dauern = [];
  for (let i = 0; i < 8; i++) { const [ms] = await zeit(() => hole(s.url, '/sammlungen')); dauern.push(ms); await new Promise((r) => setTimeout(r, 10)); }
  const r = await lang;
  assert.equal(r.code, 409); assert.equal(r.j.fehler, 'liste_busy');
  assert.ok(Math.max(...dauern) < 50, `GET /sammlungen während der Sperre: ${dauern.map((x) => x.toFixed(1)).join(' ')} ms`);
  // Gegenprobe: ohne Sperre geht dasselbe POST sofort
  fs.rmSync(sperreVon(d, slug));
  assert.equal((await post(s.url, `/sammlungen/${slug}/posten`, { art: 'track', material_id: mid(5) })).code, 201);
});

test('Server: eine Sperre, die gleich frei wird, kostet keinen Fehler (kurze asynchrone Wiederholung)', async (t) => {
  const m = tmpMt(t), d = ordner(t), s0 = new Sammlungen(d), slug = s0.lege('L', [], 'playlist');
  const s = await stapel(t, { mediathek: m.db, sammlungen: d });
  fs.writeFileSync(sperreVon(d, slug), JSON.stringify(fremd(t)));
  const mid = (await import('./hilfen/mediathek.mjs')).mid;
  const r = post(s.url, `/sammlungen/${slug}/posten`, { art: 'track', material_id: mid(5) });
  setTimeout(() => fs.rmSync(sperreVon(d, slug), { force: true }), 40);
  assert.equal((await r).code, 201);
});

test('zwei Prozesse schreiben je 200 Posten in dieselbe Liste: 400 von 400, auch mit einer verwaisten Sperre am Anfang', async (t) => {
  const d = ordner(t), s = new Sammlungen(d), slug = s.lege('Rennen', [], 'playlist');
  fs.writeFileSync(sperreVon(d, slug), JSON.stringify({ pid: await toterPid(), start: '1' }));
  const lauf = (praefix) => new Promise((ok, fehler) => {
    const k = spawn(process.execPath, [new URL('./hilfen/sammlung_schreiber.mjs', import.meta.url).pathname, d, slug, praefix, '200'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = ''; k.stderr.on('data', (x) => { err += x; });
    k.on('close', (c) => (c === 0 ? ok() : fehler(new Error(`Schreiber ${praefix} rc ${c}: ${err}`))));
  });
  await Promise.all([lauf('aa'), lauf('bb')]);
  const p = s.lies(slug).posten;
  assert.equal(p.length, 400); assert.equal(new Set(p.map((x) => x.id)).size, 400); assert.equal(new Set(p.map((x) => x.material_id)).size, 400);
  assert.deepEqual(fs.readdirSync(path.join(d, slug)).sort(), ['set.json']);
});
