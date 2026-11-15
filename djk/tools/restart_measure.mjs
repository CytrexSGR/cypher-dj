#!/usr/bin/env node
// Kern restart read-back (backlog card t_7f487235): what comes back of the DJ state after the kern of a TEST instance restarts, and from where.
//
//   node djk/tools/restart_measure.mjs --instanz b --out <dir> [--varianten R1,R2,R3] [--ohne-aufbau]
//
// State before each restart (set through the page routes, like the hand does): the effect graph fx-remix on fx/3; FX3 assigned to deck/1 and pad/2;
// master/pegel -6 dB; pad/1/fader -12 dB, pad/2/fader -9 dB; FX unit 1 off with kind 5 and beats 2; the live container open with one module in slot A;
// one loop box (box 1) loaded. Variants against the same prepared state:
//   R1  systemctl --user restart cypherdj-kern-<X>     (the clean stop)
//   R2  kill -9 of the kern main pid                   (a crash; the unit restarts at once)
//   R3  two restarts of R1 kind, 10 s apart            (does the 30 s lock of the page server's plan hide the second one)
// After each: wait 3 s, read every item back (page view: /lage, /fx/zuweisung, /graphen, /modul/stand, /proj/aktuell; kern view: the state file through
// cypherdj-zustand and the /e/* events of a kern subscription) and again after 12 s; collect the unit journals (kern start message, the page server's
// wiederherstellung*, graph_wieder*, fx_wieder*, box_wieder*, proj_neustart* lines, if the page server writes a log file: djk-start passes no --log, so usually none; the
// kern's replies to the page server's replay then show as /e/fx, /e/graph and /e/loop events of the kern subscription). Output: <out>/neustart.json (all cells) and <out>/neustart_journal_<R>.txt.
// Run only against a test instance (djk-start --instanz <a..i>), never against the live studio.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { KernAnbindung } from '../conductor/src/core.ts';

const arg = (n, v) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? v : process.argv[i + 1]; };
const X = arg('instanz', '');
if (!/^[b-i]$/.test(X)) { console.error('usage: restart_measure.mjs --instanz <b..i> --out DIR (instance a and the live studio are refused)'); process.exit(2); }
const K = X.charCodeAt(0) - 96;                         // a = 1
const PORT = 47300 + 1000 * K, KERN = 47100 + 1000 * K;
const OUT = arg('out', '');
if (!OUT) { console.error('--out DIR is required'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const VARIANTEN = arg('varianten', 'R1,R2,R3').split(',');
const BASIS = `http://127.0.0.1:${PORT}`;
const EINHEIT = `cypherdj-kern-${X}`, OBERFLAECHE = `cypherdj-oberflaeche-${X}`;
const LOOPS = `/dev/shm/cypherdj-${X}/loops`;
const ZUSTAND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'core', 'build', 'cypherdj-zustand');
const MATERIAL = '08171164c669381d';
const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));
async function ruf(m, p, b) {
  const r = await fetch(BASIS + p, { method: m, headers: { 'content-type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* not json */ }
  return { status: r.status, j };
}
const muss = (was, r) => { if (r.status !== 200) { console.error(`setup failed at ${was}: HTTP ${r.status} ${JSON.stringify(r.j).slice(0, 300)}`); process.exit(2); } return r; };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sh = (cmd, args, env) => { try { return execFileSync(cmd, args, { encoding: 'utf8', env: { ...process.env, ...env } }); } catch (e) { return `ERROR ${e.status}: ${e.stdout ?? ''}${e.stderr ?? ''}`; } };

// kern subscription: events of the kern in the order they arrive (restart replays show up here)
const ereignisse = [];
const kern = new KernAnbindung({ kernPort: KERN, aboPort: KERN + 91, name: 'pruefmonitor' }, {
  nachricht(d) { if (/^\/e\/(regler|fx|graph|loop|neustart|halter)/.test(d.adresse)) ereignisse.push({ t: Date.now(), a: d.adresse, f: d.felder }); },
  gesendet() {}, zustand() {}, unlesbar() {},
});
await kern.starte();
// the page server's own event stream (/strom): its restore announces itself there (a: 'wiederherstellung', also the skip with its reason)
const strom = [];
(async () => {
  const r = await fetch(BASIS + '/strom');
  const dec = new TextDecoder(); let rest = '';
  for await (const chunk of r.body) {
    rest += dec.decode(chunk, { stream: true });
    let i; while ((i = rest.indexOf('\n\n')) >= 0) {
      const block = rest.slice(0, i); rest = rest.slice(i + 2);
      const line = block.split('\n').find((l) => l.startsWith('data: '));
      if (line) { try { const o = JSON.parse(line.slice(6)); if (/wieder|neustart|proj_|graph|fx|box/i.test(String(o.a))) strom.push({ t: Date.now(), ...o }); } catch { /* not json */ } }
    }
  }
})().catch(() => {});

// ---- set-up ----
const ERWARTET = { graph: 'fx-remix', fx3: ['deck/1', 'pad/2'], regler: { 'master/pegel': -6, 'pad/1/fader': -12, 'pad/2/fader': -9 }, fx1: { art: 5, beats: 2, an: 0 }, box1: 'neustart-probe' };
function loopAnlegen() {
  const beats = 4, frames = beats * 22500, dir = path.join(LOOPS, ERWARTET.box1);
  fs.mkdirSync(dir, { recursive: true });
  const f32 = Buffer.alloc(frames * 8);
  for (let i = 0; i < frames; i++) { const s = 0.2 * Math.sin(2 * Math.PI * 110 * i / 48000); f32.writeFloatLE(s, i * 8); f32.writeFloatLE(s, i * 8 + 4); }
  fs.writeFileSync(path.join(dir, 'loop.f32'), f32);
  fs.writeFileSync(path.join(dir, 'loop.json'), JSON.stringify({ schema: 1, beats, bpm: 128, frames, datei: 'loop.f32', quelle: 'neustart_messen', erstellt: new Date().toISOString() }));
}
async function setzeZustand(mitContainer) {
  if (mitContainer) {
    muss('laden', await ruf('POST', '/laden', { deck: 3, material_id: MATERIAL })); await schlaf(2500);
    let o = await ruf('POST', '/live/oeffnen', {});
    if (o.status === 409 && o.j?.fehler === 'live_laeuft') o = await ruf('POST', '/live/oeffnen', { bestaetigt: true });
    muss('/live/oeffnen', o);
    muss('/deck/start', await ruf('POST', '/deck/start', { deck: 3, quell_beat: 97 })); await schlaf(7000);
    muss('/deck/loop', await ruf('POST', '/deck/loop', { deck: 3, laenge: 32, raster: 4 })); await schlaf(1000);
    muss('/modul/export', await ruf('POST', '/modul/export', { deck: 3, slot: 'A' }));
    await ruf('POST', '/deck/stopp', { deck: 3 });
    loopAnlegen();
  }
  muss('graph', await ruf('POST', '/graph', { kanal: 'fx/3', name: ERWARTET.graph }));
  for (const kanal of ERWARTET.fx3) muss(`fx3 ${kanal}`, await ruf('POST', '/fx/zuweisung', { einheit: 3, kanal, an: true }));
  for (const [pfad, nach] of Object.entries(ERWARTET.regler)) muss(pfad, await ruf('POST', '/regler', { pfad, nach, takte: 0, ab: 'jetzt' }));
  muss('fx1', await ruf('POST', '/fx', { einheit: 1, art: 5, beats: 2, wet: 0.3, param1: 0.1, param2: 0.2, param3: 0.3, an: false }));
  muss('box laden', await ruf('POST', '/loop', { aktion: 'laden', box: 1, name: ERWARTET.box1 }));
  await schlaf(2000);
}

// ---- read-back ----
async function lies() {
  const lage = (await ruf('GET', '/lage')).j ?? {};
  const fz = (await ruf('GET', '/fx/zuweisung')).j ?? [];
  const gr = (await ruf('GET', '/graphen')).j ?? {};
  const ms = (await ruf('GET', '/modul/stand')).j ?? {};
  const pa = (await ruf('GET', '/proj/aktuell?noten=zahl')).j ?? {};
  const regler = lage.regler ?? {};
  const rb = (pfad) => { const v = regler[pfad]; return typeof v === 'number' && Math.abs(v - ERWARTET.regler[pfad]) < 0.05; };
  const fx1 = lage.fx?.[0] ?? null;
  const zust = (() => { try { return JSON.parse(sh(ZUSTAND, [], { CYPHERDJ_INSTANZ: X })); } catch { return null; } })();
  const werte = {
    graph_fx3: gr.geladen?.['fx/3'] ?? null, fx3_zuweisung: Object.keys(fz[2] ?? {}).filter((k) => fz[2][k]).sort(),
    regler: Object.fromEntries(Object.keys(ERWARTET.regler).map((p) => [p, regler[p] ?? null])),
    fx1, box1: lage.boxen?.['1'] ?? null,
    live_container: { slug: pa.slug ?? null, offen: !!pa.projekt, modul_A: ms.A ?? null },
    kern_zustand: zust ? { stand: zust.stand, generation: zust.generation, befehle: zust.befehle?.length ?? null, n_grund: zust.n_grund } : null,
  };
  const zurueck = {
    graph_fx3: werte.graph_fx3 === ERWARTET.graph,
    fx3_zuweisung: JSON.stringify(werte.fx3_zuweisung) === JSON.stringify([...ERWARTET.fx3].sort()),
    master_pegel: rb('master/pegel'), pad1_fader: rb('pad/1/fader'), pad2_fader: rb('pad/2/fader'),
    fx1_art: fx1 !== null && fx1.art === 5 && fx1.beats === 2 && fx1.an === 0,
    live_container: werte.live_container.offen && werte.live_container.modul_A !== null,
    loop_box1: werte.box1 !== null && (werte.box1.name === ERWARTET.box1) && Number(werte.box1.status) >= 1,
  };
  return { werte, zurueck };
}
// kern events worth keeping: the replay of the items under test (regler of the set-up, graphs that are not empty, FX, loop boxes, the restart itself)
const wichtig = (e) => e.a === '/e/neustart' || e.a === '/e/fx/routing' || e.a.startsWith('/e/fx') || e.a.startsWith('/e/loop')
  || (e.a === '/e/graph' && e.f.name !== '') || (/^\/e\/(regler|halter)$/.test(e.a) && (Object.hasOwn(ERWARTET.regler, e.f.pfad) || /^fx\/|^deck\/3\/trim$|^keylock$/.test(String(e.f.pfad))));
const hauptPid = () => Number(sh('systemctl', ['--user', 'show', '-p', 'MainPID', '--value', EINHEIT]).trim());
const journal = (seitS) => sh('journalctl', ['--user', '-u', EINHEIT, '-u', OBERFLAECHE, '--since', `@${seitS}`, '-o', 'cat', '--no-pager']);

const erg = { instanz: X, start: new Date().toISOString(), zustand_vorher: null, varianten: {} };
log('set-up');
await setzeZustand(!process.argv.includes('--ohne-aufbau'));
erg.zustand_vorher = await lies();
log('before', JSON.stringify(erg.zustand_vorher.zurueck));
let erstes = true;
for (const v of VARIANTEN) {
  if (!erstes) {   // 35 s apart so the 30 s lock of one variant never covers the next; the state is set again (kern state is gone after a restart)
    await schlaf(35000);
    if (v !== 'R4') await setzeZustand(false);   // R4 deliberately continues from what R3 left (does a skipped plan lose the state for good)
  }
  erstes = false;
  const vorher = await lies();
  const seit = Math.floor(Date.now() / 1000) - 1;
  const t0 = Date.now(), n0 = ereignisse.length, s0 = strom.length;
  const pid0 = hauptPid();
  const schritte = [];
  if (v === 'R1') { sh('systemctl', ['--user', 'restart', EINHEIT]); schritte.push('restart'); }
  else if (v === 'R2') { process.kill(pid0, 'SIGKILL'); schritte.push('kill -9 ' + pid0); }
  else if (v === 'R3') { sh('systemctl', ['--user', 'restart', EINHEIT]); schritte.push('restart 1'); await schlaf(10000); sh('systemctl', ['--user', 'restart', EINHEIT]); schritte.push('restart 2'); }
  else if (v === 'R4') { sh('systemctl', ['--user', 'restart', EINHEIT]); schritte.push('restart after R3, state not set again'); }
  else { console.error('unknown variant ' + v); continue; }
  const tEnde = Date.now();
  await schlaf(3000);
  const nach3 = await lies();
  await schlaf(9000);
  const nach12 = await lies();
  const j = journal(seit);
  fs.writeFileSync(path.join(OUT, `neustart_journal_${v}.txt`), j);
  const zeilen = j.split('\n');
  erg.varianten[v] = {
    schritte, pid_vorher: pid0, pid_nachher: hauptPid(), vorher: vorher.zurueck, nach_3s: nach3, nach_12s: nach12.zurueck,
    kern_start: zeilen.filter((l) => /Betrieb|Zustand|Absturzschleife|neue Zeitachse|continu|fortgesetzt|ohne Zustand|Wiederaufnahme/i.test(l)).slice(0, 12),
    strom_ereignisse: strom.slice(s0).filter((e) => e.a !== 'lage').map((e) => ({ dt_ms: e.t - t0, a: e.a, f: e.f })).slice(0, 80),
    server_zeilen: zeilen.filter((l) => /wiederherstellung|graph_wieder|fx_wieder|box_wieder|proj_neustart/.test(l)).map((l) => l.slice(0, 300)),
    kern_ereignisse_nach_neustart: ereignisse.slice(n0).filter((e) => e.t >= t0).filter(wichtig).map((e) => ({ dt_ms: e.t - t0, a: e.a, f: e.f })),
  };
  log(v, JSON.stringify(nach3.zurueck));
}
fs.writeFileSync(path.join(OUT, 'neustart.json'), JSON.stringify(erg, null, 1));
process.exit(0);
