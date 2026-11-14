#!/usr/bin/env node
// SEQ deck, slice 1, measurement 1 (spec 2026-11-14-seq-deck-design, section 10): the time from a step toggle to the sound.
//
//   node djk/tools/seq_measure.mjs --port <page port of a TEST instance> [--platz 2] [--writes 50] [--abstand 400] [--swap 20] [--out FILE] [--ohne-oeffnen-fader]
//
// Everything goes through real HTTP against the page server of the instance, the way the page and the hand tool do it:
//   1. POST /live/oeffnen          opens the live container (the arrangement plays only while its transport runs)
//   2. POST /seq/leeren, /seq/anlegen {platz}   a fresh deck with the default lanes (kick snare clap chh ohh bass)
//   3. POST /seq/text              writes all 96 steps on (six lanes of 16 steps)
//   4. POST /proj/transport {aktion: start}   starts the transport of the live container (what PLAY of the page sends), waits for status 2
//   5. POST /regler deck/N/fader   opens the strip of the deck (the deck is then heard like a deck on its fader)
//   6. `writes` POST /seq/schritt toggles `abstand` ms apart (start to start). A step is toggled off and on again, so the deck holds 95 or 96 steps.
//      Per write: the time from the request sent to the answer received (performance.now), the HTTP status.
//   7. A second series of `swap` writes with a poll: the answer of a write is sent after the core has quitted the load of the playback (status 3,
//      sent in the audio cycle that swaps the playback, core_arr.cpp ARR_LADEN; the session awaits it in kern.laden). To check that and to give the
//      swap itself a number, after the answer the script polls GET /proj/aktuell until kern.rev_geladen (the number of the playback the core
//      plays, /zustand/arr.nr, 50 Hz) equals projekt.wiedergabe_rev, and prints the time from the request to that moment.
//   8. GET /seq/stand and one POST /seq/text round trip are timed and checked.
// Prints one line per write, then median, mean, p95 and maximum per series, and the verdict against the targets (median < 60 ms, maximum < 115 ms).
// The raw numbers go to --out (JSON). Exit code 0 if both targets hold, 1 if one is missed, 2 on a setup failure. The deck is left standing (clear it
// with POST /seq/leeren). Run it only against a test instance (djk-start --instanz <a..i>), never against the live studio.
import fs from 'node:fs';

const arg = (n, v) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? v : process.argv[i + 1]; };
const PORT = Number(arg('port', 0));
if (!PORT || PORT === 47300) { console.error('usage: seq_measure.mjs --port <page port of a test instance> (47300 is the live studio and is refused)'); process.exit(2); }
const BASIS = `http://127.0.0.1:${PORT}`;
const PLATZ = Number(arg('platz', 2)), SCHREIBEN = Number(arg('writes', 50)), ABSTAND = Number(arg('abstand', 400)), SWAP = Number(arg('swap', 20));
const AUS = arg('out', '');
const ZIEL_MEDIAN = 60, ZIEL_MAX = 115;

const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));
async function ruf(methode, pfad, koerper) {
  const t0 = performance.now();
  const r = await fetch(BASIS + pfad, { method: methode, headers: { 'content-type': 'application/json' }, body: koerper === undefined ? undefined : JSON.stringify(koerper) });
  const text = await r.text();
  const ms = performance.now() - t0;
  let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, j, ms, t0, t1: t0 + ms };
}
const aktuell = async () => (await ruf('GET', '/proj/aktuell?noten=zahl')).j;
const fehl = (was, r) => { console.error(`setup failed at ${was}: HTTP ${r.status} ${JSON.stringify(r.j).slice(0, 300)}`); process.exit(2); };
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const quantil = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]; };
const zusammen = (a) => ({ n: a.length, median: median(a), mean: a.reduce((x, y) => x + y, 0) / a.length, p95: quantil(a, 0.95), max: Math.max(...a), min: Math.min(...a) });
const f1 = (x) => x.toFixed(1);

// All 96 steps on: x on the three drum lines, a bass note on every step.
const LAUF = { kick: 'xxxxxxxxxxxxxxxx', snare: 'xxxxxxxxxxxxxxxx', clap: 'xxxxxxxxxxxxxxxx', chh: 'xxxxxxxxxxxxxxxx', ohh: 'xxxxxxxxxxxxxxxx' };
const VOLL = `${Object.entries(LAUF).map(([k, v]) => `${k} ${v}`).join('\n')}\nbass c2 c2 d#2 c2 c2 f2 c2 c2 c2 g2 c2 c2 a#1 c2 c2 f2`;
const anzahlAn = (seq) => seq.folgen[seq.aktiv].zeilen.reduce((n, z) => n + z.schritte.filter((s) => s.an).length, 0);

const bericht = { start: new Date().toISOString(), port: PORT, platz: PLATZ, abstand_ms: ABSTAND, last: null, setup: {}, schreiben: null, swap: null, stand: null, text: null, ziel: { median_ms: ZIEL_MEDIAN, max_ms: ZIEL_MAX } };
const last = () => fs.readFileSync('/proc/loadavg', 'utf8').split(' ').slice(0, 3).map(Number);
bericht.last = { vorher: last() };

// 1 and 2: container, deck
let r = await ruf('POST', '/live/oeffnen', {});
if (r.status === 409 && r.j?.fehler === 'live_laeuft') r = await ruf('POST', '/live/oeffnen', { bestaetigt: true });
if (r.status !== 200) fehl('/live/oeffnen', r);
bericht.setup.oeffnen_ms = r.ms;
r = await ruf('GET', '/seq/stand');
if (r.status !== 200) fehl('/seq/stand', r);
// seq_anlegen is refused while the channel is open (kanal_offen): close the strip of the place first (a rerun leaves it open)
{ const z = await ruf('POST', '/regler', { pfad: `deck/${PLATZ}/fader`, nach: -200, takte: 0, ab: 'jetzt' }); if (z.status !== 200) fehl('/regler fader close', z); await schlaf(300); }
if (r.j[String(PLATZ)]) { const l = await ruf('POST', '/seq/leeren', { platz: PLATZ }); if (l.status !== 200) fehl('/seq/leeren', l); }
r = await ruf('POST', '/seq/anlegen', { platz: PLATZ });
if (r.status !== 200) fehl('/seq/anlegen', r);
bericht.setup.anlegen_ms = r.ms;
console.log(`deck created on place ${PLATZ} in ${f1(r.ms)} ms, lanes: ${r.j.seq.folgen[r.j.seq.aktiv].zeilen.map((z) => z.id).join(' ')}`);

// 3: all steps on
r = await ruf('POST', '/seq/text', { platz: PLATZ, text: VOLL });
if (r.status !== 200) fehl('/seq/text (fill)', r);
bericht.setup.fuellen_ms = r.ms;
const voll = anzahlAn(r.j.seq);
bericht.setup.schritte_an = voll;
console.log(`filled in ${f1(r.ms)} ms, steps on: ${voll}`);
if (voll !== 96) { console.error(`expected 96 steps on, got ${voll}`); process.exit(2); }

// 4: transport
r = await ruf('POST', '/proj/transport', { aktion: 'start', beat: 0 });
if (r.status !== 200 || !r.j?.ok) fehl('/proj/transport start', r);
bericht.setup.transport_ms = r.ms;
for (let i = 0; ; i++) {
  const a = await aktuell();
  if (a?.kern?.status === 2) break;
  if (i > 100) { console.error('transport did not reach status 2'); process.exit(2); }
  await schlaf(50);
}
console.log(`transport running (start answered in ${f1(r.ms)} ms)`);

// 5: open the strip of the deck
if (!process.argv.includes('--ohne-oeffnen-fader')) {
  for (const [pfad, nach] of [[`deck/${PLATZ}/trim`, 0], [`deck/${PLATZ}/fader`, -6]]) {
    const g = await ruf('POST', '/regler', { pfad, nach, takte: 0, ab: 'jetzt' });
    if (g.status !== 200) fehl(`/regler ${pfad}`, g);
  }
  console.log(`deck/${PLATZ} trim 0, fader -6 dB`);
}
await schlaf(1000);

// A toggle of one step: off, then on again, over 25 steps spread over the six lanes, so the deck stays at 95 or 96 steps.
const ZEILEN = Object.keys(LAUF).concat('bass');
const ziel = (i) => { const k = i >> 1; return { zeile: ZEILEN[k % ZEILEN.length], schritt: (k * 5) % 16 }; };
async function schreibe(i) {
  const z = ziel(i);
  return ruf('POST', '/seq/schritt', { platz: PLATZ, ...z, an: i % 2 === 1 });
}
async function reihe(n, abstand, nachher) {
  const zeiten = [], zeilen = [];
  const t00 = performance.now();
  for (let i = 0; i < n; i++) {
    const warte = t00 + i * abstand - performance.now();
    if (warte > 0) await schlaf(warte);
    const w = await schreibe(i);
    const eintrag = { i, ms: w.ms, status: w.status, rev: w.j?.rev ?? null };
    if (w.status !== 200) eintrag.fehler = w.j;
    if (nachher) Object.assign(eintrag, await nachher(w));
    zeiten.push(w.ms); zeilen.push(eintrag);
    console.log(`write ${String(i + 1).padStart(2)}: ${f1(w.ms).padStart(6)} ms  HTTP ${w.status}  rev ${eintrag.rev}${eintrag.geladen_ms !== undefined ? `  swap seen after ${f1(eintrag.geladen_ms)} ms` : ''}`);
  }
  return { zeilen, zusammen: zusammen(zeiten) };
}

// 6: the 50 writes
console.log(`\n== ${SCHREIBEN} writes, ${ABSTAND} ms apart`);
bericht.schreiben = await reihe(SCHREIBEN, ABSTAND);
const fehler = bericht.schreiben.zeilen.filter((z) => z.status !== 200).length;
const z1 = bericht.schreiben.zusammen;
console.log(`answer time: median ${f1(z1.median)} ms, mean ${f1(z1.mean)} ms, p95 ${f1(z1.p95)} ms, max ${f1(z1.max)} ms, min ${f1(z1.min)} ms, ${fehler} not 200`);

// 7: the swap seen from outside
console.log(`\n== ${SWAP} writes with a poll for the swap (rev_geladen == wiedergabe_rev)`);
if (SWAP > 0) {
  bericht.swap = await reihe(SWAP, ABSTAND, async (w) => {
    if (w.status !== 200) return {};
    for (let k = 0; k < 400; k++) {
      const a = await aktuell();
      if (a?.kern?.rev_geladen === a?.projekt?.wiedergabe_rev) return { geladen_ms: performance.now() - w.t0, nachlauf_ms: performance.now() - w.t1, abfragen: k + 1 };
      await schlaf(3);
    }
    return { geladen_ms: null, nachlauf_ms: null, abfragen: 400 };
  });
  const g = bericht.swap.zeilen.filter((z) => z.geladen_ms != null).map((z) => z.geladen_ms);
  const nach = bericht.swap.zeilen.filter((z) => z.nachlauf_ms != null).map((z) => z.nachlauf_ms);
  if (g.length) {
    bericht.swap.geladen = zusammen(g); bericht.swap.nachlauf = zusammen(nach);
    const sofort = bericht.swap.zeilen.filter((z) => z.abfragen === 1).length;
    bericht.swap.sofort_gesehen = sofort;
    console.log(`request to swap seen: median ${f1(bericht.swap.geladen.median)} ms, max ${f1(bericht.swap.geladen.max)} ms; the swap was already visible at the first poll after the answer in ${sofort} of ${g.length}`);
  }
}

// 8: stand and a text round trip
r = await ruf('GET', '/seq/stand');
const stand = r.j?.[String(PLATZ)];
bericht.stand = { status: r.status, ms: r.ms, schritte_an: stand ? anzahlAn(stand.seq) : null, text_zeilen: stand ? stand.text.split('\n').length : null };
console.log(`\nGET /seq/stand: HTTP ${r.status} in ${f1(r.ms)} ms, steps on ${bericht.stand.schritte_an}, text lines ${bericht.stand.text_zeilen}`);
const text = stand.text.replace(/^kick .*$/m, 'kick x...x...x...x...');
r = await ruf('POST', '/seq/text', { platz: PLATZ, text });
const nachText = r.j?.seq ? anzahlAn(r.j.seq) : null;
bericht.text = { status: r.status, ms: r.ms, schritte_an_danach: nachText };
console.log(`POST /seq/text (kick lane rewritten to 4 hits): HTTP ${r.status} in ${f1(r.ms)} ms, steps on afterwards ${nachText}`);

bericht.last.nachher = last();
bericht.ende = new Date().toISOString();
const schlecht = z1.median >= ZIEL_MEDIAN || z1.max >= ZIEL_MAX || fehler > 0;
bericht.urteil = { median_ok: z1.median < ZIEL_MEDIAN, max_ok: z1.max < ZIEL_MAX, fehler };
console.log(`\ntargets: median < ${ZIEL_MEDIAN} ms: ${bericht.urteil.median_ok ? 'met' : 'MISSED'} (${f1(z1.median)}); maximum < ${ZIEL_MAX} ms: ${bericht.urteil.max_ok ? 'met' : 'MISSED'} (${f1(z1.max)})`);
console.log(`load average ${bericht.last.vorher.join(' ')} before, ${bericht.last.nachher.join(' ')} after`);
if (AUS) { fs.writeFileSync(AUS, JSON.stringify(bericht, null, 1)); console.log(`raw numbers: ${AUS}`); }
process.exit(schlecht ? 1 : 0);
