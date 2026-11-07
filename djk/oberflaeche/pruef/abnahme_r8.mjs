// Acceptance 1.10 slices 5 to 8, first form (U0): the open time of the MAXIMAL routing project on the real core of a test instance. U13 extends this file with keys and
// insert lanes. Never against the live set; against a running page server with the built core of the checkout the server runs in:
//   DJK=<worktree>/djk <worktree>/djk/start/djk-start --instanz b --arr1          (silent)
//   node pruef/abnahme_r8.mjs --url http://127.0.0.1:49300 [--ausgabe <dir>] [--runden 2]
// The maximal project: 32 tracks (one MIDI clip each), 8 groups of 4 tracks, 4 returns with a Hall, all sends (32 tracks and 8 groups to each of the 4 returns), every
// insert pool full (12 compressors, the eq, the saturator; the eq with shaped bands), the 4 racks of 4c with 16 mappings each and their 16 macro values, faders, pans and
// solos set. Per round (default 2) the maximal project is opened right after a small one (4 tracks) and the small one right after the maximal one; the wall time of POST /proj/oeffnen is compared.
// The server sends the same control list for any project (every pool slot, used or not), so the open time is a function of the number of controls (packets of 100), not of the project.
// Reported per open: HTTP code, wall ms, number of controls sent, refused (regler_fehler), without core, not sent (regler_nicht_gesendet). The control list the server sends
// (alleRegler of the project) is written to <ausgabe>/regler-maximal.tsv for the offline replay (stellwerk bewegt_spitze), because the core does not report the number of moving
// controls over any interface: `bewegt` (MAX_BEWEGT 256) is measured offline on the real Stellwerk with exactly this list and the server's packets of 100.
// Stop signals of the plan (E16, U0 task 5): open time above 400 ms (read both as the difference and as the absolute time of the maximal project), any refused or unsent control. Exit 0 all OK, 1 at least one FEHL or stop signal, 2 call error.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { alleRegler, erz4Soll } from '../bereiche/proj/abbildung.ts';
import { insertWertParameter } from '../projekt/modell.ts';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const { values: opt } = parseArgs({ options: { url: { type: 'string' }, ausgabe: { type: 'string' }, runden: { type: 'string' } } });
const aufrufFehler = (t) => { process.stderr.write(`abnahme_r8: ${t}\n`); process.exit(2); };
if (!opt.url) aufrufFehler('Aufruf: --url <http://127.0.0.1:port> [--ausgabe <Ordner>] [--runden <n>]');
if (/:(47300|47100|47200)\b/.test(opt.url)) aufrufFehler('nie gegen den Betrieb (47300): eine Prüfinstanz wählen');
const port = Number(new globalThis.URL(opt.url).port);
const k = (port - 47300) / 1000;
const instanz = Number.isInteger(k) && k >= 1 && k <= 9 ? String.fromCharCode(96 + k) : undefined;
if (!instanz || /^[afghi]$/.test(instanz)) aufrufFehler(`Instanz ${instanz ?? '?'} (Port ${port}) ist nicht erlaubt: a, f, g, h, i sind tabu`);
const RUNDEN = Math.max(1, Number(opt.runden ?? 2));
const zwei = (n) => String(n).padStart(2, '0');
const d0 = new Date();
const zeit = `${d0.getFullYear()}${zwei(d0.getMonth() + 1)}${zwei(d0.getDate())}T${zwei(d0.getHours())}${zwei(d0.getMinutes())}${zwei(d0.getSeconds())}`;
const ORDNER = opt.ausgabe ? path.resolve(opt.ausgabe.replace(/^~(?=\/|$)/, os.homedir())) : path.join(HIER, 'ergebnisse', `${zeit}-abnahme-r8`);
fs.mkdirSync(ORDNER, { recursive: true });
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const zeilen = [];
let fehl = 0;
const notiere = (kz, ok, text) => { if (!ok) fehl++; zeilen.push(`${ok ? 'OK  ' : 'FEHL'} ${kz}: ${text}`); process.stdout.write(`${ok ? 'OK  ' : 'FEHL'} ${kz}: ${text}\n`); };
const info = (text) => { zeilen.push(`INFO ${text}`); process.stdout.write(`INFO ${text}\n`); };

const URL = opt.url;
const ruf = async (methode, weg, koerper, kopf = {}) => {
  const r = await fetch(URL + weg, methode === 'GET' ? { headers: kopf } : { method: 'POST', headers: { 'content-type': 'application/json', ...kopf }, body: JSON.stringify(koerper ?? {}) });
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = { text: t }; }
  return { code: r.status, j };
};
class Fehl extends Error {}
const grundVon = (r) => `${r.code} ${r.j?.fehler ?? r.j?.grund ?? ''}${r.j?.text ? `: ${r.j.text}` : ''}`.trim();
const erwarte200 = (weg, r) => { if (r.code !== 200) throw new Fehl(`${weg} → ${grundVon(r)}`); return r; };
const holeRev = async () => erwarte200('/proj/aktuell?nur=rev', await ruf('GET', '/proj/aktuell?nur=rev')).j.rev;
const aktuell = async () => erwarte200('/proj/aktuell', await ruf('GET', '/proj/aktuell')).j;
const projektJetzt = async () => (await aktuell()).projekt;
const aendern = async (label, befehle) => {
  for (let von = 0; von < befehle.length; von += 100) {   // at most 100 commands per call
    const teil = befehle.slice(von, von + 100);
    erwarte200(`/proj/aendern (${label} ${von})`, await ruf('POST', '/proj/aendern', { rev: await holeRev(), label: `${label} ${von}`, befehle: teil }, { 'x-djk-quelle': 'cypher' }));
  }
};
const bisWahr = async (f, ms = 8000) => { for (let t = 0; t < ms; t += 100) { if (await f()) return true; await warte(100); } return false; };
const warteAufKern = async () => {
  if (!(await bisWahr(async () => typeof (await ruf('GET', '/lage')).j?.uhr?.bpm === 'number', 8000))) throw new Fehl('kein Kern: /lage meldet keine Uhr');
  return (await ruf('GET', '/lage')).j.uhr.bpm;
};
const eigeneSlugs = [];
const neuesProjekt = async (name) => {
  const r = erwarte200('/proj/neu', await ruf('POST', '/proj/neu', { name: `${name}-${zeit}` }));
  const slug = r.j.slug ?? r.j.projekt?.slug;
  if (!slug) throw new Fehl(`/proj/neu ohne slug: ${JSON.stringify(r.j).slice(0, 200)}`);
  eigeneSlugs.push(slug);
  return slug;
};

// ---- the maximal project. The insert layout is the one of the cost lane arr32voll (kosten_arr.cpp): 12 compressors, the eq on track 6, the saturator on group 1.
const KOMP_VB = [['schwelle', -40, -20], ['ratio', 2, 8], ['knie', 0, 12], ['attack', 1, 30], ['release', 60, 300], ['makeup', 0, 6], ['mix', 0.7, 1], ['schp', 0, 120]];
const EQ_GAIN = [0, 0, 3, 2, -3, 4, -2.5, 3];
const EQ_FREQ = [40, 18000, 120, 9000, 250, 1000, 3500, 7000];
const MAKRO_WERTE = [0.25, 0.5, 0.75, 1.0];
const KETTEN = [   // strip id → stages in order [art, sc]
  ['s1', [['komp']]], ['s2', [['komp']]], ['s3', [['komp', 1]]], ['s5', [['komp', 2], ['komp']]], ['s6', [['eq']]], ['s25', [['komp'], ['komp']]],
  ['g1', [['komp'], ['komp'], ['saett']]], ['r1', [['komp']]], ['r2', [['komp']]], ['master', [['komp']]],
];
const RACKS = ['s5', 's6', 's25', 'g1'];   // the strips with a rack: 16 mappings each

async function baueMaximalprojekt() {
  const slug = await neuesProjekt('r8-max');
  const bpm = 128;
  const b1 = [{ befehl: 'tempo_setzen', bpm }];
  for (let i = 0; i < 32; i++) b1.push({ befehl: 'spur_neu', art: 'instrument', name: `T${i + 1}` });
  await aendern('R8 tracks', b1);
  const b2 = [];
  for (let g = 0; g < 8; g++) b2.push({ befehl: 'gruppenspur_neu', mitglieder: [1, 2, 3, 4].map((x) => `s${g * 4 + x}`) });
  for (let r = 0; r < 4; r++) b2.push({ befehl: 'return_neu' });
  for (let i = 1; i <= 32; i++) b2.push({ befehl: 'spur_aendern', spur_id: `s${i}`, fader_db: -1 - (i % 5), pan: ((i % 7) - 3) / 10, solo: i % 3 === 0 });
  await aendern('R8 groups, returns, faders', b2);
  const b3 = [];
  for (let r = 1; r <= 4; r++) {
    for (let i = 1; i <= 32; i++) b3.push({ befehl: 'send_setzen', strang_id: `s${i}`, return_id: `r${r}`, db: -10 });
    for (let g = 1; g <= 8; g++) b3.push({ befehl: 'send_setzen', strang_id: `g${g}`, return_id: `r${r}`, db: -9 });
  }
  await aendern('R8 sends', b3);
  const b4 = [];
  for (let i = 1; i <= 32; i++) {
    const noten = Array.from({ length: 8 }, (_, n) => ({ beat: n, laenge: 0.5, ton: 36 + ((n + i) % 24), vel: 100 }));
    b4.push({ befehl: 'clip_neu', spur_id: `s${i}`, art: 'midi', start_beat: 0, laenge_beats: 8, noten });
  }
  await aendern('R8 clips', b4);
  const b5 = [];
  for (const [strang, stufen] of KETTEN) {
    stufen.forEach(([art, sc], pos) => {
      const c = { befehl: 'insert_setzen', strang_id: strang, pos, art };
      if (sc) c.sc = sc;
      if (art === 'komp') c.werte = { schwelle: -30, ratio: 4, mix: 1 };
      if (art === 'eq') {
        c.werte = { out: 0 };
        for (let m = 1; m <= 8; m++) { c.werte[`b${m}/an`] = 1; c.werte[`b${m}/gain`] = EQ_GAIN[m - 1]; c.werte[`b${m}/freq`] = EQ_FREQ[m - 1]; }
      }
      if (art === 'saett') c.werte = { drive: 12 };
      b5.push(c);
    });
  }
  await aendern('R8 inserts', b5);
  // racks: ids of the stages from the project
  const p = await projektJetzt();
  const strang = (id) => (id === 'master' ? p.master : id.startsWith('s') ? p.spuren.find((x) => x.id === id) : id.startsWith('g') ? p.gruppen.find((x) => x.id === id) : p.returns.find((x) => x.id === id));
  const b6 = [];
  for (const id of RACKS) {
    const st = strang(id).inserts;
    const makros = [{ ziel: [] }, { ziel: [] }, { ziel: [] }, { ziel: [] }];
    if (st[0].art === 'eq') {
      const z = (param, von, bis, m) => makros[m].ziel.push({ insert: st[0].id, param, von, bis });
      z('out', -1, 1, 0); z('b1/q', 0.5, 1.5, 1);
      for (let m = 1; m <= 8; m++) z(`b${m}/gain`, EQ_GAIN[m - 1] - 2, EQ_GAIN[m - 1] + 2, m % 4);
      for (let m = 3; m <= 8; m++) z(`b${m}/freq`, EQ_FREQ[m - 1] * 0.8, EQ_FREQ[m - 1] * 1.25, (m + 1) % 4);
    } else {
      for (let s = 0; s < 2; s++) KOMP_VB.forEach(([param, von, bis], pi) => makros[pi % 4].ziel.push({ insert: st[s].id, param, von, bis }));
    }
    b6.push({ befehl: 'rack_setzen', strang_id: id, makros });
  }
  await aendern('R8 racks', b6);
  const b7 = [];
  for (const id of RACKS) MAKRO_WERTE.forEach((w, n) => b7.push({ befehl: 'rack_makro', strang_id: id, nr: n + 1, wert: w }));
  await aendern('R8 macro values', b7);
  return slug;
}

// ---- the report of the project: what the plan calls the maximal project, counted from the stored project
function zaehle(p) {
  const strang = [...p.spuren, ...(p.gruppen ?? []), ...(p.returns ?? []), ...(p.master ? [p.master] : [])];
  const inserts = strang.flatMap((s) => s.inserts ?? []);
  const racks = strang.filter((s) => s.rack);
  return {
    spuren: p.spuren.length, gruppen: (p.gruppen ?? []).length, returns: (p.returns ?? []).length,
    sends: strang.reduce((n, s) => n + (s.sends ?? []).length, 0),
    komp: inserts.filter((x) => x.art === 'komp').length, eq: inserts.filter((x) => x.art === 'eq').length, saett: inserts.filter((x) => x.art === 'saett').length,
    racks: racks.length, mappings: racks.map((s) => s.rack.makros.reduce((n, m) => n + m.ziel.length, 0)),
  };
}

async function oeffne(slug) {
  const t0 = Date.now();
  const r = await ruf('POST', '/proj/oeffnen', { slug });
  const ms = Date.now() - t0;
  const kern = r.j?.kern ?? {};
  return { code: r.code, ms, regler: kern.regler, fehler: kern.regler_fehler?.length, ohneKern: kern.regler_ohne_kern, nichtGesendet: kern.regler_nicht_gesendet };
}

async function lauf8() {
  await warteAufKern();
  const slugMax = await baueMaximalprojekt();
  const pMax = await projektJetzt();
  const z = zaehle(pMax);
  info(`maximal project ${slugMax}: ${JSON.stringify(z)}`);
  notiere('maximal project built as specified', z.spuren === 32 && z.gruppen === 8 && z.returns === 4 && z.sends === 160 && z.komp === 12 && z.eq === 1 && z.saett === 1 && z.racks === 4 && z.mappings.every((n) => n === 16),
    `tracks ${z.spuren}, groups ${z.gruppen}, returns ${z.returns}, sends ${z.sends} (expected 160), stages komp ${z.komp} eq ${z.eq} saett ${z.saett} (12/1/1), racks ${z.racks} with mappings ${z.mappings.join(',')} (16 each)`);
  // the list the server sends on a switch by the hand of Andreas: erz/4 neutral first, then every mixer control (sitzung.ts synchronisiere). It does NOT depend on the size of the
  // project: every track, group, return, send, insert pool slot and rack slot is sent, used or not, so a small project sends the same number of controls.
  const regler = [...erz4Soll('andreas'), ...alleRegler(pMax)];
  fs.writeFileSync(path.join(ORDNER, 'regler-maximal.tsv'), regler.map((r) => `${r.pfad}\t${r.wert}`).join('\n') + '\n');
  const nIns = regler.filter((r) => r.pfad.startsWith('ins/')).length, nRack = regler.filter((r) => r.pfad.startsWith('rack/')).length;
  info(`control list of the project written (${regler.length} controls, of them ins/ ${nIns}, rack/ ${nRack}) → regler-maximal.tsv; packets of 100: ${Math.ceil(regler.length / 100)}`);
  const slugKlein = await neuesProjekt('r8-klein');
  await aendern('R8 small', [{ befehl: 'tempo_setzen', bpm: 128 }, ...Array.from({ length: 4 }, (_, i) => ({ befehl: 'spur_neu', art: 'instrument', name: `K${i + 1}` }))]);
  await warte(500);
  // Opening the project that is already open and loaded is a shortcut ("wiederanlauf": the core wins, no controls are sent). That is what a "small project opens in 22 ms" reads
  // like; it is reported once, but the comparison is made between two real switches: maximal after small, small after maximal.
  const kurz = await oeffne(slugKlein);
  info(`already-open shortcut (the small project is open and loaded, nothing is sent): ${JSON.stringify(kurz)}`);
  const diff = [];
  for (let n = 1; n <= RUNDEN; n++) {
    await warte(1500);
    const gr = await oeffne(slugMax);
    await warte(1500);
    const kl = await oeffne(slugKlein);
    const d = gr.ms - kl.ms;
    diff.push(d);
    info(`open round ${n}: maximal ${JSON.stringify(gr)}`);
    info(`open round ${n}: small   ${JSON.stringify(kl)}`);
    for (const [name, o] of [['maximal', gr], ['small', kl]])
      notiere(`open round ${n} ${name}: every control arrives (HTTP 200, ${regler.length} controls, none refused, none without core, none unsent)`,
        o.code === 200 && o.regler === regler.length && o.fehler === 0 && o.ohneKern === 0 && o.nichtGesendet === 0,
        `code ${o.code}, controls ${o.regler} of ${regler.length}, refused ${o.fehler}, without core ${o.ohneKern}, not sent ${o.nichtGesendet}`);
    info(`open round ${n}: ${gr.ms} ms for ${Math.ceil(regler.length / 100)} packets = ${(gr.ms / Math.ceil(regler.length / 100)).toFixed(0)} ms per packet`);
    notiere(`open round ${n}: gate AK27 (maximal at most 500 ms longer than small)`, d <= 500, `${gr.ms} ms against ${kl.ms} ms, difference ${d} ms`);
    notiere(`open round ${n}: stop signal of the plan, difference reading (difference above 400 ms)`, d <= 400, `difference ${d} ms`);
    notiere(`open round ${n}: stop signal of the plan, absolute reading (open time of the maximal project above 400 ms)`, gr.ms <= 400, `${gr.ms} ms (load average 1 min ${fs.readFileSync('/proc/loadavg', 'utf8').split(' ')[0]})`);
  }
  info(`open time differences (ms): ${diff.join(', ')}; the 4a reference is 230 ms (381 controls, one sample, against the already-open shortcut)`);
  await ruf('POST', '/proj/oeffnen', { slug: slugKlein });
}

try {
  await lauf8();
} catch (e) {
  if (e instanceof Fehl) notiere('Aufbau/Öffnen', false, e.message); else notiere('ABBRUCH', false, `${e.stack ?? String(e)}`);
} finally {
  const wurzel = path.join('/dev/shm', `cypherdj-${instanz}`, 'projekte');
  for (const slug of eigeneSlugs) {
    const d = path.join(wurzel, slug);
    if (!/^r8-(max|klein)-\d{8}t\d{6}/i.test(slug)) { info(`slug ${slug} is not from this script, not deleted`); continue; }
    try { if (fs.existsSync(d)) { fs.rmSync(d, { recursive: true, force: true }); info(`project ${d} deleted: ${fs.existsSync(d) ? 'NO, still there' : 'yes'}`); } }
    catch (e) { notiere('cleanup', false, e.message); }
  }
}
fs.writeFileSync(path.join(ORDNER, 'bericht-r8.md'), `# Acceptance 1.10 slices 5 to 8, first form ${zeit} (${URL}, instance ${instanz})\n\n${zeilen.join('\n')}\n`);
process.stdout.write(`\n${fehl === 0 ? 'ALLES OK' : `${fehl} FEHL`} · report ${path.join(ORDNER, 'bericht-r8.md')}\n`);
process.exit(fehl === 0 ? 0 : 1);
