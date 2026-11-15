#!/usr/bin/env node
// Level excess when stems arrive in an open live module (card t_7e463bcc): where do the +5.6 dB for about 70 ms come from.
//
//   node djk/tools/stems_sprung_measure.mjs --instanz b --out <dir> [--lauf V0,V0,V0,V1,V2]
//
// Runs, each on a fresh recording of the master (cypherdj-setmitschnitt reads the kern's audio ring, nothing goes to a sound card):
//   V0  deck loop of 32 beats exported into slot A, the strip pad/1 opened 2 s after the export, stems arrive while it sounds (cell c4 of the old run)
//   V1  (needs a module with stems and a playing open strip, so it follows a V0 run) the Loop track's mute goes false, then true, through POST /proj/aendern
//   V2  like V0, but the Loop track is muted right after the export, before the stems arrive (only the stems themselves can be heard at the swap)
// Analysis in this tool: the master is periodic with P = 32 beats (tempo 128 BPM: 720000 frames), so the level of 2 ms blocks is compared with the block one period later
// (V0, V2: the stems-only state) or one period earlier (V1). The sample of the swap is the `ist_sample` of the kern's receipt (status 3) of the playback load,
// seen on the kern subscription. Output: <out>/<tag>_<n>.json per run (+ the master recording, the monitor JSONL and the project track list).
// Run it only against a test instance (djk-start --instanz <a..i>), never against the live studio.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { KernAnbindung } from '../conductor/src/core.ts';

const arg = (n, v) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? v : process.argv[i + 1]; };
const X = arg('instanz', '');
if (!/^[b-i]$/.test(X)) { console.error('usage: stems_sprung_measure.mjs --instanz <b..i> --out DIR (instance a and the live studio are refused)'); process.exit(2); }
const K = X.charCodeAt(0) - 96;
const PORT = 47300 + 1000 * K, KERN = 47100 + 1000 * K;
const OUT = arg('out', '');
if (!OUT) { console.error('--out DIR is required'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const LAEUFE = arg('lauf', 'V0,V0,V0,V1,V2').split(',');
const BAU = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'core', 'build');
const MATERIAL = '08171164c669381d';
const FS = 48000, P = 32 * 60 / 128 * FS;   // 720000 frames
const BASIS = `http://127.0.0.1:${PORT}`;
const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));
async function ruf(m, p, b) {
  const r = await fetch(BASIS + p, { method: m, headers: { 'content-type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* not json */ }
  return { status: r.status, j };
}
const muss = (was, r) => { if (r.status !== 200) { console.error(`failed at ${was}: HTTP ${r.status} ${JSON.stringify(r.j).slice(0, 300)}`); process.exit(2); } return r; };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const regler = (pfad, nach, takte = 0) => ruf('POST', '/regler', { pfad, nach, takte, ab: 'jetzt' });
const aendere = async (label, befehle) => { const rev = (await ruf('GET', '/proj/aktuell?nur=rev')).j.rev; return ruf('POST', '/proj/aendern', { rev, label, befehle }); };

// kern subscription: clock, receipts, playback numbers, mute events
const ev = [];
const kern = new KernAnbindung({ kernPort: KERN, aboPort: KERN + 91, name: 'pruefmonitor' }, {
  nachricht(d, ns) {
    const a = d.adresse;
    if (a === '/uhr' || a === '/zustand/kern' || a === '/zustand/arr' || a === '/q' || (a === '/e/regler' && /^(spur|grp)\//.test(String(d.felder.pfad)))) {
      const f = { ...d.felder }; for (const k of Object.keys(f)) if (typeof f[k] === 'bigint') f[k] = Number(f[k]);
      ev.push({ t: Date.now(), ns: Number(ns), a, f });
    }
  },
  gesendet() {}, zustand() {}, unlesbar() {},
});
await kern.starte();
await schlaf(2000);

// ---- master recording ----
let rec = null;
async function recStart(tag) {
  const wav = path.join(OUT, `${tag}_master.wav`), stopp = path.join(OUT, `${tag}_stopp`);
  for (const f of [wav, wav + '.json', stopp]) try { fs.unlinkSync(f); } catch { /* none */ }
  execFileSync('systemd-run', ['--user', '--quiet', `--unit=cypherdj-setmitschnitt-${X}`, `--setenv=CYPHERDJ_INSTANZ=${X}`, '-p', 'Nice=5', path.join(BAU, 'cypherdj-setmitschnitt'), '--aus', wav, '--stopp', stopp, '--max-minuten', '20']);
  rec = { wav, stopp };
  await schlaf(2500);
}
async function recStop() {
  fs.writeFileSync(rec.stopp, '');
  const aktiv = () => { try { return execFileSync('systemctl', ['--user', 'is-active', `cypherdj-setmitschnitt-${X}.service`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() === 'active'; } catch { return false; } };
  for (let i = 0; i < 40 && aktiv(); i++) await schlaf(500);
  try { execFileSync('systemctl', ['--user', 'stop', `cypherdj-setmitschnitt-${X}.service`], { stdio: 'ignore' }); } catch { /* already gone */ }
  try { fs.unlinkSync(rec.stopp); } catch { /* none */ }
}
function lies(wav) {
  const b = fs.readFileSync(wav); let i = 12;
  while (b.toString('latin1', i, i + 4) !== 'data') i += 8 + b.readUInt32LE(i + 4) + (b.readUInt32LE(i + 4) & 1);
  const off = i + 8, n = Math.floor((b.length - off) / 8), x = new Float32Array(n * 2);
  for (let k = 0; k < n * 2; k++) x[k] = b.readFloatLE(off + k * 4);
  return { x, n, s0: JSON.parse(fs.readFileSync(wav + '.json', 'utf8')).s0 };
}
const rms = (x, a, len) => { let s = 0; for (let k = a * 2; k < (a + len) * 2; k++) s += x[k] * x[k]; return Math.sqrt(s / (len * 2)); };
const db = (v) => 20 * Math.log10(v + 1e-9);

// ---- module handling ----
async function modulStand() { return (await ruf('GET', '/modul/stand')).j ?? {}; }
async function warteStems(t0, limitS = 400) {
  while ((Date.now() - t0) / 1000 < limitS) {
    const s = (await modulStand()).A ?? {}; const st = s.stems?.stems;
    if (st === 'fertig' || st === 'fehler') return { st, s: (Date.now() - t0) / 1000, t: Date.now(), detail: s.stems };
    await schlaf(250);
  }
  return { st: null, s: limitS, t: Date.now() };
}
async function leereA() {
  const s = (await modulStand()).A; if (!s) return;
  await ruf('POST', '/modul/leeren', { slot: 'A', takte: 0 });
  for (let i = 0; i < 300; i++) { const z = ((await modulStand()).leeren ?? {}).A ?? {}; if (z.zustand === 'fertig' || z.zustand === 'fehler' || z.zustand === 'abgebrochen' || !(await modulStand()).A) break; await schlaf(200); }
  await schlaf(3000);
}
async function spurListe() {
  const p = (await ruf('GET', '/proj/aktuell')).j?.projekt; if (!p) return null;
  return { tempo_bpm: p.tempo_bpm, spuren: p.spuren.map((s) => ({ id: s.id, name: s.name, mute: s.mute, fader_db: s.fader_db, ausgang: s.ausgang ?? null, geraet: s.geraet ? 'instrument' : null,
    clips: (s.clips ?? []).map((c) => ({ name: c.name, warp: c.warp ?? null })) })), gruppen: p.gruppen.map((g) => ({ id: g.id, name: g.name, fader_db: g.fader_db, mute: g.mute, ausgang: g.ausgang ?? null })) };
}
const loopId = (l) => l?.spuren.find((s) => s.name === 'Loop')?.id;
// the receipt (status 3) of the playback load nearest after `t` minus 3 s
function ladeQuittung(t0, t1) {
  const q = ev.filter((e) => e.a === '/q' && Number(e.f.status) === 3 && e.t >= t0 && e.t <= t1);
  return q;
}
async function aufbau() {
  // deck 3 playing its loop (needed for the export), project tempo 128: container opened with the deck standing, deck started after
  muss('laden', await ruf('POST', '/laden', { deck: 3, material_id: MATERIAL })); await schlaf(2500);
  let o = await ruf('POST', '/live/oeffnen', {});
  if (o.status === 409 && o.j?.fehler === 'live_laeuft') o = await ruf('POST', '/live/oeffnen', { bestaetigt: true });
  muss('/live/oeffnen', o);
  muss('/deck/start', await ruf('POST', '/deck/start', { deck: 3, quell_beat: 97 })); await schlaf(7000);
  muss('/deck/loop', await ruf('POST', '/deck/loop', { deck: 3, laenge: 32, raster: 4 })); await schlaf(1000);
  await regler('pad/1/fader', -200); await regler('erz/4/fader', 0);
}

// ---- analysis ----
function blockReihe(x, n, von, bis, versatz) {   // ratio of the block level at i against the block at i+versatz, per 2 ms block
  const out = [];
  for (let i = von; i + 96 <= bis; i += 96) {
    if (i + versatz < 0 || i + versatz + 96 > n) continue;
    const a = rms(x, i, 96), b = rms(x, i + versatz, 96);
    out.push({ i, a_db: db(a), b_db: db(b), ratio_db: db(a) - db(b) });
  }
  return out;
}
function excess(reihe, sStar, schwelle = 1.5) {   // first cluster of blocks above the threshold at or after sStar - 100 ms (gaps up to 4 blocks)
  const heiss = reihe.filter((r) => r.ratio_db > schwelle && r.b_db > -60 && r.i >= sStar - 4800);
  if (!heiss.length) return { gefunden: false };
  let ende = 0; for (let k = 1; k < heiss.length; k++) { if (heiss[k].i - heiss[k - 1].i > 5 * 96) break; ende = k; }
  const c = heiss.slice(0, ende + 1);
  return { gefunden: true, start_ms_nach_swap: (c[0].i - sStar) / 48, ende_ms_nach_swap: (c[c.length - 1].i + 96 - sStar) / 48, dauer_ms: (c[c.length - 1].i + 96 - c[0].i) / 48,
    spitze_db: Math.max(...c.map((r) => r.ratio_db)), mittel_db: c.reduce((s, r) => s + r.ratio_db, 0) / c.length, bloecke: c.length };
}
const median = (a) => { const s = [...a].sort((p, q) => p - q); return s[s.length >> 1]; };

// ---- runs ----
let nr = 0, letztesV0 = null, aufgebaut = false;
for (const art of LAEUFE) {
  nr++; const tag = `${art}_${nr}`; const erg = { tag, art, start: new Date().toISOString() };
  log('run', tag);
  if (art === 'V0' || art === 'V2') {
    if (!aufgebaut) { await aufbau(); aufgebaut = true; }
    else {   // clear slot A, start the deck loop again (the export needs a running deck loop)
      await leereA();
      muss('/deck/start', await ruf('POST', '/deck/start', { deck: 3, quell_beat: 97 })); await schlaf(7000);
      muss('/deck/loop', await ruf('POST', '/deck/loop', { deck: 3, laenge: 32, raster: 4 })); await schlaf(1000);
    }
    await regler('pad/1/fader', -200);
    await recStart(tag);
    await schlaf(2000);
    const tE = Date.now();
    muss('/modul/export', await ruf('POST', '/modul/export', { deck: 3, slot: 'A' }));
    erg.export_ms = Date.now() - tE;
    await ruf('POST', '/deck/stopp', { deck: 3 });
    if (art === 'V2') {   // the Loop track muted before the stems exist
      const l = await spurListe(); const id = loopId(l);
      if (!id) { console.error('no Loop track after the export'); process.exit(2); }
      muss('mute Loop', await aendere('mute Loop before the stems', [{ befehl: 'spur_aendern', spur_id: id, mute: true }]));
    }
    muss('transport', await ruf('POST', '/proj/transport', { aktion: 'start', beat: 0 }));
    await schlaf(Math.max(0, 2000 - (Date.now() - tE)));
    await regler('pad/1/fader', 0);
    erg.pad_offen_ms = Date.now() - tE;
    const st = await warteStems(tE); erg.stems = st; log(tag, 'stems', st.st, st.s.toFixed(1), 's');
    const tFertig = st.t;
    await schlaf(24000);    // one period (15 s) after the swap plus the settling
    erg.projekt_nach = await spurListe();
    erg.kern = ev.filter((e) => e.a === '/zustand/kern').slice(-1)[0]?.f ?? null;
    await recStop();
    fs.writeFileSync(path.join(OUT, `${tag}_monitor.jsonl`), ev.filter((e) => e.t >= tE - 3000).map((e) => JSON.stringify(e)).join('\n'));
    // analysis
    const { x, n, s0 } = lies(rec.wav); erg.master_frames = n; erg.s0 = s0;
    // The swap is the receipt (status 3) of the playback load: it is the one that comes together with the change of the playback number on /zustand/arr
    // (the kern sends further status 3 receipts for the mixer commands the page server sends after the load; they share their ist_sample in groups).
    const qs = ladeQuittung(tFertig - 4000, tFertig + 1500); erg.quittungen_status3 = qs.map((q) => ({ dt_ms: q.t - tFertig, ist_sample: q.f.ist_sample, id: q.f.id }));
    const arr = ev.filter((e) => e.a === '/zustand/arr' && e.t >= tFertig - 4000 && e.t <= tFertig + 1500);
    const wechsel = []; for (const e of arr) if (wechsel.length === 0 || wechsel[wechsel.length - 1].nr !== e.f.nr) wechsel.push({ nr: e.f.nr, t: e.t });
    erg.arr_nr_wechsel = wechsel.map((w) => ({ nr: w.nr, dt_ms: w.t - tFertig }));
    const anzahl = new Map(); for (const q of qs) anzahl.set(q.f.ist_sample, (anzahl.get(q.f.ist_sample) ?? 0) + 1);
    // the stems load is the last change of the playback number that is not later than the poll that saw the stems done (+ one poll)
    const wStems = wechsel.filter((w, k) => k > 0 && w.t <= tFertig + 300).pop();
    const kand = wStems ? qs.filter((q) => Math.abs(q.t - wStems.t) <= 40 && anzahl.get(q.f.ist_sample) === 1) : [];
    const swap = kand.length ? kand[0].f.ist_sample : null; erg.swap_kandidaten = kand.map((q) => q.f.ist_sample);
    const mu = ev.filter((e) => e.a === '/e/regler' && /\/mute$/.test(String(e.f.pfad)) && e.f.halter === 'andreas' && e.t >= tFertig - 1000 && e.t <= tFertig + 1500);
    erg.mute_ereignisse = mu.map((e) => ({ dt_ms: e.t - tFertig, pfad: e.f.pfad, wert: e.f.wert, sample_nach_swap: swap === null ? null : e.f.sample - swap, ms_nach_swap: swap === null ? null : (e.f.sample - swap) / 48 }));
    const alle = ev.filter((e) => e.a === '/q' && Number(e.f.status) === 3 && swap !== null && Math.abs(e.f.ist_sample - swap) < 12000);
    erg.quittungen_um_swap_ms = [...new Set(alle.map((e) => +((e.f.ist_sample - swap) / 48).toFixed(1)))].sort((p, q) => p - q);
    if (swap === null) { erg.fehler = 'no status 3 receipt near the stems arrival'; }
    else {
      const sStar = swap - s0; erg.swap_sample = swap; erg.swap_index = sStar; erg.swap_s_im_master = sStar / FS;
      const reihe = blockReihe(x, n, sStar - FS, sStar + FS, P);       // against the same phase one period later
      erg.excess_gegen_periode_spaeter = excess(reihe, sStar);
      erg.ratio_ab_swap_ms = reihe.filter((r) => r.i >= sStar - 960 && r.i <= sStar + 14400).map((r) => ({ ms: Math.round((r.i - sStar) / 48), ratio_db: +r.ratio_db.toFixed(2), a_db: +r.a_db.toFixed(1), b_db: +r.b_db.toFixed(1) }));
      erg.ratio_ruhe_median_db = median(reihe.filter((r) => r.i > sStar + 4 * FS / 10 && r.b_db > -60).map((r) => r.ratio_db));
      erg.vorher_pegel_db = db(rms(x, Math.max(0, sStar - 4800), 4800));
      // sample-level check: largest difference to one period later in the first 200 ms
      let maxd = 0, maxx = 0; for (let k = sStar; k < sStar + 9600 && k + P < n; k++) { for (let c = 0; c < 2; c++) { maxd = Math.max(maxd, Math.abs(x[k * 2 + c] - x[(k + P) * 2 + c])); maxx = Math.max(maxx, Math.abs(x[(k + P) * 2 + c])); } }
      erg.erste_200ms_max_diff = maxd; erg.erste_200ms_referenz_spitze = maxx;
    }
    log(tag, JSON.stringify(erg.excess_gegen_periode_spaeter ?? erg.fehler));
    letztesV0 = art === 'V0' || art === 'V2' ? tag : null;
  } else if (art === 'V1') {
    if (letztesV0 === null) { console.error('V1 needs a module with stems from a V0 run before it'); process.exit(2); }
    const l = await spurListe(); const id = loopId(l);
    await recStart(tag);
    await schlaf(P / FS * 1000 + 6000);          // steady stems-only state for one period plus margin
    const mutes = () => ev.filter((e) => e.a === '/e/regler' && /\/mute$/.test(String(e.f.pfad)));
    const n0 = mutes().length; const tU = Date.now();
    muss('unmute', await aendere('unmute Loop', [{ befehl: 'spur_aendern', spur_id: id, mute: false }]));
    await schlaf(5000);
    const tM = Date.now();
    muss('mute', await aendere('mute Loop', [{ befehl: 'spur_aendern', spur_id: id, mute: true }]));
    await schlaf(4000);
    erg.projekt = await spurListe();
    await recStop();
    fs.writeFileSync(path.join(OUT, `${tag}_monitor.jsonl`), ev.filter((e) => e.t >= tU - 3000).map((e) => JSON.stringify(e)).join('\n'));
    const { x, n, s0 } = lies(rec.wav); erg.s0 = s0;
    const mu = mutes().filter((e) => e.t >= tU);   // mute events of all tracks; the Loop track is the one whose value changes at our two moments
    erg.mute_ereignisse = mu.map((e) => ({ dt_ms: e.t - tU, pfad: e.f.pfad, wert: e.f.wert, sample: e.f.sample }));
    const evU = mu.find((e) => e.t >= tU && Number(e.f.wert) === 0 && e.t < tM), evM = mu.find((e) => e.t >= tM && Number(e.f.wert) === 1);
    // a change that went through as a regler has its own sample; a change that reloaded the playback shows as the receipt (status 3) of the load
    const q3 = (a, b) => ev.find((e) => e.a === '/q' && Number(e.f.status) === 3 && e.t >= a && e.t < b);
    const q = (e, a, b) => (e ? e.f.sample - s0 : (q3(a, b) ? q3(a, b).f.ist_sample - s0 : null));
    erg.quelle_unmute = evU ? 'regler' : 'quittung'; erg.quelle_mute = evM ? 'regler' : 'quittung';
    const sU = q(evU, tU, tM), sM = q(evM, tM, tM + 3000); erg.sample_unmute = sU; erg.sample_mute = sM;
    const reihe = (s0i) => blockReihe(x, n, s0i - 4800, s0i + FS * 3 / 2, -P);       // against the same phase one period earlier (stems-only state)
    function uebergang(s, auf) {
      if (s === null) return null;
      const r = reihe(s), spaeter = median(r.filter((b) => b.i >= s + FS * 6 / 10 && b.i <= s + FS * 14 / 10).map((b) => b.ratio_db)), vorher = median(r.filter((b) => b.i < s - 960).map((b) => b.ratio_db));
      const ziel = auf ? spaeter : 0;   // after the mute the level must come back to the reference (0 dB); after the unmute it goes to its new steady level
      const k = r.find((b) => b.i >= s && Math.abs(b.ratio_db - ziel) < 1.0 && r.filter((c) => c.i >= b.i && c.i < b.i + 960).every((c) => Math.abs(c.ratio_db - ziel) < 1.5));
      return { vorher_ratio_db: vorher, spaeter_ratio_db: spaeter, einschwingen_ms: k ? (k.i - s) / 48 : null,
        max_ratio_db_ab_ereignis: Math.max(...r.filter((b) => b.i >= s).map((b) => b.ratio_db)), verlauf: r.filter((b) => b.i >= s - 960 && b.i <= s + 14400).map((b) => ({ ms: Math.round((b.i - s) / 48), ratio_db: +b.ratio_db.toFixed(2) })) };
    }
    erg.unmute = uebergang(sU, true); erg.mute = uebergang(sM, false);
    log(tag, 'unmute settle ms', erg.unmute?.einschwingen_ms, 'mute settle ms', erg.mute?.einschwingen_ms);
    letztesV0 = null;
  } else { console.error('unknown run ' + art); continue; }
  fs.writeFileSync(path.join(OUT, `${tag}.json`), JSON.stringify(erg, null, 1));
}
try { await ruf('POST', '/deck/stopp', { deck: 3 }); } catch { /* ignore */ }
process.exit(0);
