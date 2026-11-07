// Target acceptance, package 1.16 rest U3b (T3b.3): applying presets on a TEST INSTANCE with the real core (instances b, d or e only, never f, never the
// operation; the script refuses every other letter). The server only computes the plan (POST /presets/anwenden); pruef/b116_senden.mjs sends it. Call order
// (everything inside the instance locks, see the ledger):
//   1  node pruef/b116_aufbau.mjs --ziel /dev/shm/b116-ziel --katalog-nur
//   2  DJK=<worktree>/djk CYPHERDJ_KATALOG=/dev/shm/b116-ziel/katalog.sqlite djk/start/djk-start --instanz e      (default silent sink, no --ton-frei)
//   3  node pruef/b116_aufbau.mjs --ziel /dev/shm/b116-ziel --instanz e
//   4  flock $CYPHERDJ_ECHTZEIT_SCHLOSS node pruef/abnahme_b116.mjs --url http://127.0.0.1:52300 --aufbau /dev/shm/b116-ziel/aufbau.json \
//        --bau <worktree>/djk/kern/build --instanz e [--ausgabe <folder>] [--nur A1,A3]
// Criteria (plan U3b, spec AK-B16-3, AK-B16-4, AK-B16-5, AK-B16-11):
//   A1  komp preset -> insert. The stage values differ from werk:komp/drum-bus in every mapped row. Apply, send: EXACTLY 8 /e/regler echoes ins/komp/<slot>/<name>
//       carry the preset's values, one per row (deviation from the plan text "exactly 8 echoes": the kern also reports every /k/teil at its START with the old value,
//       so each changed row echoes twice, 16 in total: first the old value, then the preset value); uebersprungen = ['extsc'].
//       Control: the same apply again gives 0 echoes (any value) within 2 s.
//   A2  rb338. dark-dub then bright-open on the track, each exported (POST /proj/export); centroid(bright) > centroid(dark). Control: bright-open again ->
//       the export is bit-identical to the previous bright export.
//   A3  refusals through the consumer. A hall preset on the track (kein_ziel) and the first factory eq preset on the stage (art_nicht_aktiv): the refusal answer goes
//       into sendePlan; a counting proxy sees no /proj/aendern and no /regler request and the project rev is unchanged. Positive control: werk:komp/bus-glue on the
//       stage changes rev by exactly 1 with exactly one /proj/aendern.
//   A4  git diff s4-rack-4a --stat -- djk/kern djk/instrumente djk/vertrag is empty (no core change). Control: the same command on djk/oberflaeche is not empty.
// Return: 0 all OK, 1 at least one FEHL, 2 usage. Only the project of the set-up (slug b116-...) is removed.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { starte, Fehl } from './w3a_ziel.mjs';
import { schwerpunkt } from './a2_messen.mjs';
import { sendePlan } from './b116_senden.mjs';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stderr.write('abnahme_b116: usage: --url <test instance> --aufbau <aufbau.json> --bau <core build folder> [--ausgabe <folder>] [--instanz <b|d|e>] [--nur A1,A3,...]\n');
  process.exit(2);
}
const z = starte('abnahme_b116', 'b116', { bau: { type: 'string' }, nur: { type: 'string' } });
const { AUFBAU: A, CYPHER, notiere, info, instanz, warte } = z;
if (!/^[bde]$/.test(instanz)) { process.stderr.write(`abnahme_b116: instance ${instanz} is not allowed: b, d or e only (never f)\n`); process.exit(2); }
if (!z.opt.bau) { process.stderr.write('abnahme_b116: --bau <core build folder> is required\n'); process.exit(2); }
const NUR = z.opt.nur ? new Set(z.opt.nur.split(',').map((x) => x.trim().toUpperCase())) : null;
const wollen = (k) => !NUR || NUR.has(k);
const HIER = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HIER, '..', '..', '..');
const roh = {};
if (A.slug) z.eigeneSlugs.push(A.slug);

// like z.geladen, but a MIDI clip carries no decode state (null): only audio clips are waited for
z.geladen = async () => {
  const ok = await z.bisWahr(async () => { const s = await z.zustandKurz(); return s.dekodiert.every((d) => d === 'fertig' || d === null || d === undefined) && s.kern?.rev_geladen === s.wiedergabe_rev && s.kern?.status === 0; });
  if (!ok) throw new Fehl(`playback not loaded after 40 s: ${JSON.stringify(await z.zustandKurz())}`);
};
const rev = async () => z.holeRev();
const plan = async (id, ziel) => z.ruf('POST', '/presets/anwenden', { id, ziel }, CYPHER);   // {code, j}

// SSE of the server (/strom): every message with the receive time
function stromLesen() {
  const ac = new AbortController(), meldungen = [];
  const fertig = (async () => {
    try {
      const r = await fetch(z.URL + '/strom', { signal: ac.signal });
      const dec = new globalThis.TextDecoder();
      let puf = '';
      for await (const stueck of r.body) {
        puf += dec.decode(stueck, { stream: true });
        let i;
        while ((i = puf.indexOf('\n\n')) >= 0) {
          const block = puf.slice(0, i);
          puf = puf.slice(i + 2);
          if (!block.startsWith('data: ')) continue;
          try { meldungen.push({ t: Date.now(), ...JSON.parse(block.slice(6)) }); } catch { /* half line */ }
        }
      }
    } catch { /* aborted or server gone */ }
  })();
  return { meldungen, stop: async () => { ac.abort(); await fertig; } };
}
const insEchos = (sse, ab) => sse.meldungen.filter((m) => m.t >= ab && m.a === '/e/regler' && /^ins\/komp\/\d+\/[a-z]+$/.test(m.f?.pfad ?? ''));

// ---------------------------------------------------------------------------------------------------------------------------------------------
// A1
const DRUM_BUS = { schwelle: -18, ratio: 4, knie: 6, attack: 30, release: 100, makeup: 3, mix: 1, schp: 90 };   // the plan's table (AK-B16-3), checked below against the server's plan
async function a1() {
  const p0 = (await z.aktuell()).projekt;
  const ins = p0.spuren.flatMap((s) => s.inserts ?? []).find((i) => i.id === A.insert_id);
  if (!ins) throw new Fehl(`stage ${A.insert_id} not in the project`);
  const gleiche = Object.keys(DRUM_BUS).filter((k) => ins.werte[k] === DRUM_BUS[k]);
  notiere('A1/Vor the stage differs from drum-bus in every mapped row', gleiche.length === 0, `stage ${JSON.stringify(ins.werte)}; rows equal to drum-bus: ${gleiche.join(', ') || 'none'} (a row that is equal sends no echo and would hide a missing mapping)`);
  const sse = stromLesen();
  await warte(800);
  try {
    const t0 = Date.now();
    const antwort = await plan('werk:komp/drum-bus', { art: 'insert', insert_id: A.insert_id });
    if (antwort.code !== 200) throw new Fehl(`POST /presets/anwenden -> ${z.grundVon(antwort)}`);
    const werte = antwort.j.befehle?.[0]?.werte ?? {};
    notiere('A1/Plan the plan carries the 8 mapped rows with the plan table values, extsc skipped',
      JSON.stringify(Object.entries(werte).sort()) === JSON.stringify(Object.entries(DRUM_BUS).sort()) && JSON.stringify(antwort.j.uebersprungen) === '["extsc"]',
      `weg ${antwort.j.weg}, werte ${JSON.stringify(werte)}, uebersprungen ${JSON.stringify(antwort.j.uebersprungen)}`);
    const r = await sendePlan(z.URL, antwort, await rev(), { kopf: CYPHER });
    await warte(2000);
    const e = insEchos(sse, t0);
    const slot = String(ins.slot), alt = ins.werte;
    const nameVon = (m) => m.f.pfad.split('/').pop();
    const nah = (a, b) => Math.abs(a - b) <= 1e-3 * Math.max(1, Math.abs(b));
    // the kern reports a /k/teil at its start (the value BEFORE, ablauf.cpp "immer bei Teilstart", stellwerk melder.cpp) and at its end (the new value):
    // one stage row changed = two echoes. The echoes that carry the NEW value are the proof of arrival: exactly 8, one per mapped row.
    const neu = e.filter((m) => nah(m.f.wert, DRUM_BUS[nameVon(m)] ?? Number.NaN));
    const vorher = e.filter((m) => !neu.includes(m));
    const jeZeile = Object.keys(DRUM_BUS).every((k) => e.filter((m) => nameVon(m) === k).length === 2
      && neu.filter((m) => nameVon(m) === k).length === 1 && vorher.filter((m) => nameVon(m) === k).length === 1);
    const reihenfolge = Object.keys(DRUM_BUS).every((k) => e.filter((m) => nameVon(m) === k)[0] && nah(e.filter((m) => nameVon(m) === k)[0].f.wert, alt[k]));
    const stimmt = neu.length === 8 && e.every((m) => m.f.pfad.split('/')[2] === slot) && jeZeile && reihenfolge;
    roh.a1 = { sende: { ok: r.ok, gesendet: r.gesendet }, echos: e.map((m) => ({ pfad: m.f.pfad, wert: m.f.wert, ms: m.t - t0 })), neu: neu.length, vorher: vorher.length };
    notiere('A1 komp preset on an insert: exactly 8 core echoes carry the new value, one per mapped row', r.ok && neu.length === 8 && stimmt,
      `sendePlan ok=${r.ok} (${r.gesendet} request); new-value echoes ${neu.length}: ${neu.map((m) => `${nameVon(m)}=${m.f.wert}`).join(' ')}`);
    notiere('A1 every mapped row reports twice, first its old value (part start), then the preset value (part end); no other path',
      vorher.length === 8 && e.length === 16 && jeZeile && reihenfolge,
      `${e.length} echoes in total on ins/komp/${slot}/*: ${vorher.length} old-value (${vorher.map((m) => `${nameVon(m)}=${m.f.wert}`).join(' ')}) before their row's new-value echo`);
    // control: the same apply again changes nothing, so the core hears nothing
    const t1 = Date.now();
    const nochmal = await plan('werk:komp/drum-bus', { art: 'insert', insert_id: A.insert_id });
    const r2 = await sendePlan(z.URL, nochmal, await rev(), { kopf: CYPHER });
    await warte(2000);
    const e2 = insEchos(sse, t1);
    roh.a1.kontrolle = { sende: { ok: r2.ok, gesendet: r2.gesendet, grund: r2.grund }, echos: e2.length };
    notiere('A1/NK the same apply again: 0 echoes within 2 s', r2.ok && e2.length === 0, `sendePlan ok=${r2.ok} (${r2.gesendet} request${r2.grund ? `, ${r2.grund}` : ''}); echoes ${e2.length}`);
  } finally { await sse.stop(); }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// A2
function einsatzRel(l) {   // onset for sources of any level: 4 % of the peak of the first 20000 frames after the first non-zero sample
  let i0 = 0;
  while (i0 < l.length && Math.abs(l[i0]) < 1e-7) i0++;
  let mx = 0;
  for (let i = i0; i < Math.min(l.length, i0 + 20000); i++) mx = Math.max(mx, Math.abs(l[i]));
  for (let i = i0; i < l.length; i++) if (Math.abs(l[i]) > 0.04 * mx) return i;
  return -1;
}
const sha = (f32) => crypto.createHash('sha256').update(Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength)).digest('hex').slice(0, 16);
async function wendeAn(id, spurId) {
  const antwort = await plan(id, { art: 'spur', spur_id: spurId });
  if (antwort.code !== 200) throw new Fehl(`apply ${id} -> ${z.grundVon(antwort)}`);
  const r = await sendePlan(z.URL, antwort, await rev(), { kopf: CYPHER });
  if (!r.ok) throw new Fehl(`send ${id} -> ${r.grund}`);
  return antwort.j;
}
async function messe(name) {
  const w = await z.exportiere(0, A.laenge_beats ?? 4, name);
  const e = einsatzRel(w.l);
  const peak = w.l.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
  const c = e >= 0 ? schwerpunkt(w.l, e, 16384) : Number.NaN;
  return { w, e, peak, c, sha: sha(w.l) };
}
async function a2() {
  await z.ruf('POST', '/proj/transport', { aktion: 'stopp' }, CYPHER).catch(() => null);
  const dunkelPlan = await wendeAn('werk:rb338/dark-dub', A.rb_spur_id);
  const dunkel = await messe('a2-dark-dub');
  const hell1Plan = await wendeAn('werk:rb338/bright-open', A.rb_spur_id);
  const hell = await messe('a2-bright-open');
  roh.a2 = { dunkel: { c: dunkel.c, peak: dunkel.peak, sha: dunkel.sha, e: dunkel.e, geraet: dunkelPlan.befehle[0].geraet }, hell: { c: hell.c, peak: hell.peak, sha: hell.sha, e: hell.e, geraet: hell1Plan.befehle[0].geraet } };
  notiere('A2 rb338: both exports sound (peak above 0.01)', dunkel.peak > 0.01 && hell.peak > 0.01, `dark-dub peak ${dunkel.peak.toFixed(4)}, bright-open peak ${hell.peak.toFixed(4)}`);
  notiere('A2 rb338: centroid(bright-open) > centroid(dark-dub)', hell.c > dunkel.c, `dark-dub ${dunkel.c.toFixed(1)} Hz, bright-open ${hell.c.toFixed(1)} Hz (x${(hell.c / dunkel.c).toFixed(2)})`);
  await wendeAn('werk:rb338/bright-open', A.rb_spur_id);
  const nochmal = await messe('a2-bright-open-2');
  notiere('A2/NK bright-open applied again: export bit-identical to the previous bright export', nochmal.sha === hell.sha && Buffer.compare(Buffer.from(nochmal.w.l.buffer), Buffer.from(hell.w.l.buffer)) === 0,
    `sha256(L)[0:16] ${hell.sha} -> ${nochmal.sha}`);
  notiere('A2/NK the two different presets are NOT bit-identical (the comparison can fail)', dunkel.sha !== hell.sha, `dark ${dunkel.sha}, bright ${hell.sha}`);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// A3: counting proxy in front of the instance
async function proxy() {
  const zaehler = {};
  const server = http.createServer(async (q, a) => {
    const chunks = []; for await (const c of q) chunks.push(c);
    zaehler[`${q.method} ${q.url}`] = (zaehler[`${q.method} ${q.url}`] ?? 0) + 1;
    const r = await fetch(z.URL + q.url, { method: q.method, headers: { 'content-type': q.headers['content-type'] ?? 'application/json', ...(q.headers['x-djk-quelle'] ? { 'x-djk-quelle': q.headers['x-djk-quelle'] } : {}) }, body: q.method === 'GET' ? undefined : Buffer.concat(chunks) });
    const t = Buffer.from(await r.arrayBuffer());
    a.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? 'application/json' }); a.end(t);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${server.address().port}`, zaehler, schliesse: () => new Promise((ok) => server.close(ok)) };
}
const ersterEintrag = async (geraet) => {
  const l = await z.ruf('GET', `/presets?geraet=${geraet}&herkunft=werk`);
  const e = (l.j?.eintraege ?? l.j)?.[0];
  if (!e) throw new Fehl(`no factory ${geraet} preset listed: ${JSON.stringify(l.j).slice(0, 200)}`);
  return `werk:${e.geraet}/${e.slug}`;
};
async function a3() {
  const hall = await ersterEintrag('hall'), eq = await ersterEintrag('eq');
  const px = await proxy();
  try {
    const r0 = await rev();
    const faelle = [['hall on the track', hall, { art: 'spur', spur_id: A.rb_spur_id }, /kein_ziel/], ['eq on the stage', eq, { art: 'insert', insert_id: A.insert_id }, /art_nicht_aktiv/]];
    for (const [name, id, ziel, muster] of faelle) {
      const antwort = await plan(id, ziel);
      const r = await sendePlan(px.url, antwort, await rev(), { kopf: CYPHER });
      const schreibend = (px.zaehler['POST /proj/aendern'] ?? 0) + (px.zaehler['POST /regler'] ?? 0);
      const r1 = await rev();
      roh[`a3_${name}`] = { antwort: antwort.j, sende: { ok: r.ok, gesendet: r.gesendet, grund: r.grund }, zaehler: { ...px.zaehler }, rev: [r0, r1] };
      notiere(`A3 ${name} (${id}): refused, nothing sent, rev unchanged`, antwort.code >= 400 && !r.ok && r.gesendet === 0 && muster.test(JSON.stringify(antwort.j)) && schreibend === 0 && r1 === r0,
        `answer ${antwort.code} ${antwort.j?.fehler}; sendePlan ok=${r.ok} gesendet=${r.gesendet} (${r.grund}); proxy saw /proj/aendern ${px.zaehler['POST /proj/aendern'] ?? 0}, /regler ${px.zaehler['POST /regler'] ?? 0}; rev ${r0} -> ${r1}`);
    }
    // positive control: a valid plan goes through the same consumer and the same proxy
    const gut = await plan('werk:komp/bus-glue', { art: 'insert', insert_id: A.insert_id });
    const vor = await rev();
    const r = await sendePlan(px.url, gut, vor, { kopf: CYPHER });
    const nach = await rev();
    roh.a3_kontrolle = { antwort: gut.j, sende: { ok: r.ok, gesendet: r.gesendet }, zaehler: { ...px.zaehler }, rev: [vor, nach] };
    notiere('A3/PK a valid plan (komp bus-glue on the stage): exactly one /proj/aendern and rev + 1', gut.code === 200 && r.ok && px.zaehler['POST /proj/aendern'] === 1 && nach === vor + 1,
      `answer ${gut.code}; sendePlan ok=${r.ok}; proxy /proj/aendern ${px.zaehler['POST /proj/aendern'] ?? 0}; rev ${vor} -> ${nach}`);
  } finally { await px.schliesse(); }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
function a4() {
  const git = (...args) => spawnSync('git', ['-C', REPO, ...args], { encoding: 'utf8' });
  const kern = git('diff', 's4-rack-4a', '--stat', '--', 'djk/kern', 'djk/instrumente', 'djk/vertrag');
  const status = git('status', '--porcelain', '--', 'djk/kern', 'djk/instrumente', 'djk/vertrag');
  const kontrolle = git('diff', 's4-rack-4a', '--stat', '--', 'djk/oberflaeche');
  roh.a4 = { kern_diff: kern.stdout, kern_status: status.stdout, rc: [kern.status, status.status, kontrolle.status], kontrolle_zeilen: kontrolle.stdout.trim().split('\n').length };
  notiere('A4 no core change: git diff s4-rack-4a --stat over djk/kern djk/instrumente djk/vertrag is empty', kern.status === 0 && kern.stdout.trim() === '' && status.stdout.trim() === '',
    `diff output ${JSON.stringify(kern.stdout.trim())}, working tree status ${JSON.stringify(status.stdout.trim())}`);
  notiere('A4/NK the same command over djk/oberflaeche is not empty (the diff can see this branch)', kontrolle.status === 0 && kontrolle.stdout.trim() !== '', `last line: ${kontrolle.stdout.trim().split('\n').at(-1)}`);
}

let abbruch = null;
for (const [k, f] of [['A1', a1], ['A2', a2], ['A3', a3], ['A4', async () => a4()]]) {
  if (!wollen(k)) continue;
  z.punkt = k;
  try { await f(); } catch (e) { abbruch = e; notiere(`${k} aborted`, false, e instanceof Fehl ? e.message : (e.stack ?? String(e))); }
}
fs.writeFileSync(path.join(z.ORDNER, 'rohdaten.json'), JSON.stringify(roh, null, 1));
await z.ende('b116 apply presets (U3b)', /^b116-/);
void abbruch;
