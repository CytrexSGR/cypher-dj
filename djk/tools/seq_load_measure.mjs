#!/usr/bin/env node
// Slice K, measurement: the load of SEQ decks (Baukasten tracks) with the track pool, read from the kern's own counters.
//
//   node djk/tools/seq_load_measure.mjs --port <page port of a TEST instance> --out <dir> --tag <name> [--zellen a,b,c] [--sekunden 60] [--ohne-decks]
//
// Cells, each `--sekunden` long with the transport running (all through real HTTP against the page server, like seq_measure.mjs):
//   a  two track decks (1 and 3) playing, no SEQ deck
//   b  a + one SEQ deck on place 2   (two patterns on Baukasten graphs = two Baukasten tracks)
//   c  a + SEQ decks on places 2 and 4 (four Baukasten tracks)
// Per cell the kern's /zustand/kern (cb_max_us per 1 s window, 20 Hz) and /zustand/spur_pool (2 Hz: an, modus, blocks_parallel, einheiten_worker,
// einheiten_caller, seriell_summe, haengt, spaet, zurueck) are recorded through the same subscription the leitstand uses. The result is a JSON file
// `<out>/<tag>.json` (cells with max and median of the cb_max windows, the pool counters at start and end and their difference) and the raw JSONL
// `<out>/<tag>_monitor.jsonl`. Run it only against a test instance (djk-start --instanz <a..i>), never against the live studio.
import fs from 'node:fs';
import { KernAnbindung } from '../conductor/src/core.ts';

const arg = (n, v) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? v : process.argv[i + 1]; };
const PORT = Number(arg('port', 0));
if (!PORT || PORT === 47300) { console.error('usage: seq_load_measure.mjs --port <page port of a test instance> --out DIR --tag NAME (47300 is the live studio and is refused)'); process.exit(2); }
const OUT = arg('out', ''), TAG = arg('tag', 'lauf'), SEK = Number(arg('sekunden', 60));
const ZELLEN = arg('zellen', 'a,b,c').split(',');
const DECKS = [[1, '08171164c669381d', 97], [3, '9fe420361439e5cb', 0]];   // track decks of the earlier runs (material id, source beat)
if (!OUT) { console.error('--out DIR is required'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const BASIS = `http://127.0.0.1:${PORT}`, KERN = PORT - 200;
const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));
async function ruf(m, p, b) {
  const r = await fetch(BASIS + p, { method: m, headers: { 'content-type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* not json */ }
  return { status: r.status, j };
}
const muss = (was, r, ok = [200]) => { if (!ok.includes(r.status)) { console.error(`setup failed at ${was}: HTTP ${r.status} ${JSON.stringify(r.j).slice(0, 300)}`); process.exit(2); } return r; };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };

// v2 deck: two patterns, each an instrument track on a Baukasten graph (so one SEQ deck = two Baukasten tracks), a note on every 1/16, one knob lane.
const AN = ['folge drums bk:drums-909 1bar', 'noten d 1/16 ' + 'c2 '.repeat(16).trim(), 'werte k1 1/16 .25 . . . .50 . . . .25 . . . .75 . . .', '',
  'folge bass bk:synth-mono 1bar', 'noten b 1/16 c1 c1 d#1 c1 c1 f1 c1 c1 c1 g1 c1 c1 a#0 c1 c1 f1', 'werte k1 1/16 .25 . . . .50 . . . .25 . . . .75 . . .'].join('\n');

const roh = fs.openSync(`${OUT}/${TAG}_monitor.jsonl`, 'w');
const schreibe = (o) => fs.writeSync(roh, JSON.stringify(o) + '\n');
const kern = new KernAnbindung({ kernPort: KERN, aboPort: KERN + 91, name: 'pruefmonitor' }, {
  nachricht(d, ns) { if (d.adresse === '/zustand/kern' || d.adresse === '/zustand/spur_pool' || d.adresse === '/zustand/arr') schreibe({ t: Date.now(), ns, a: d.adresse, f: d.felder }); },
  gesendet() {}, zustand(z) { schreibe({ t: Date.now(), a: 'verbindung', f: { z } }); }, unlesbar(g) { schreibe({ t: Date.now(), a: 'unlesbar', f: { g } }); },
});
await kern.starte();
await schlaf(2500);

// Set-up. The SEQ decks are created while their strips are closed (seq_anlegen refuses an open channel).
let o = await ruf('POST', '/live/oeffnen', {});
if (o.status === 409 && o.j?.fehler === 'live_laeuft') o = await ruf('POST', '/live/oeffnen', { bestaetigt: true });
muss('/live/oeffnen', o);
for (const platz of [2, 4]) { await ruf('POST', '/regler', { pfad: `deck/${platz}/fader`, nach: -200, takte: 0, ab: 'jetzt' }); await schlaf(200); await ruf('POST', '/seq/leeren', { platz }); }
muss('/proj/transport start', await ruf('POST', '/proj/transport', { aktion: 'start', beat: 0 }));
for (let i = 0; ; i++) { const a = (await ruf('GET', '/proj/aktuell?noten=zahl')).j; if (a?.kern?.status === 2) break; if (i > 100) { console.error('transport did not reach status 2'); process.exit(2); } await schlaf(50); }
if (!process.argv.includes('--ohne-decks')) {
  for (const [deck, mid] of DECKS) muss(`/laden ${deck}`, await ruf('POST', '/laden', { deck, material_id: mid }));
  await schlaf(2500);
  for (const [deck, , qb] of DECKS) muss(`/deck/start ${deck}`, await ruf('POST', '/deck/start', { deck, quell_beat: qb }));
  await schlaf(8000);
  for (const [deck] of DECKS) { await ruf('POST', '/regler', { pfad: `deck/${deck}/trim`, nach: 0, takte: 0, ab: 'jetzt' }); await ruf('POST', '/regler', { pfad: `deck/${deck}/fader`, nach: -6, takte: 0, ab: 'jetzt' }); }
}

async function seqDeck(platz) {
  muss(`/seq/anlegen ${platz}`, await ruf('POST', '/seq/anlegen', { platz }));
  muss(`/seq/text ${platz}`, await ruf('POST', '/seq/text', { platz, text: AN }));
  const st = (await ruf('GET', '/seq/stand')).j?.[String(platz)];
  if (!st || st.folgen.length !== 2 || st.folgen.some((f) => f.stumm)) { console.error(`setup failed: deck ${platz} is not two unmuted patterns: ${JSON.stringify(st?.folgen?.map((f) => [f.name, f.stumm]))}`); process.exit(2); }
  for (const [pfad, nach] of [[`deck/${platz}/trim`, 0], [`deck/${platz}/fader`, -6]]) await ruf('POST', '/regler', { pfad, nach, takte: 0, ab: 'jetzt' });
}
const auswertung = (a, b) => {
  const l = fs.readFileSync(`${OUT}/${TAG}_monitor.jsonl`, 'utf8').split('\n').filter(Boolean).map((x) => JSON.parse(x));
  const k = l.filter((x) => x.a === '/zustand/kern' && x.t >= a && x.t <= b).map((x) => x.f);
  const p0 = l.filter((x) => x.a === '/zustand/spur_pool' && x.t <= a).pop()?.f ?? null;
  const p1 = l.filter((x) => x.a === '/zustand/spur_pool' && x.t <= b).pop()?.f ?? null;
  const diff = p0 && p1 ? Object.fromEntries(Object.keys(p1).filter((n) => !['an', 'modus'].includes(n)).map((n) => [n, Number(p1[n]) - Number(p0[n])])) : null;
  const cb = k.map((f) => Number(f.cb_max_us));
  return { fenster: k.length, cb_max_us_max: cb.length ? Math.max(...cb) : null, cb_max_us_median: median(cb), cb_p99_us_max: k.length ? Math.max(...k.map((f) => Number(f.cb_p99_us))) : null,
    ausgelassene_perioden: k.length ? Math.max(...k.map((f) => Number(f.ausgelassene_perioden))) - Math.min(...k.map((f) => Number(f.ausgelassene_perioden))) : null,
    quantum: k[0]?.quantum ?? null, spur_pool_start: p0, spur_pool_ende: p1, spur_pool_diff: diff };
};

const erg = { tag: TAG, port: PORT, sekunden: SEK, start: new Date().toISOString(), zellen: {} };
try {
  for (const z of ZELLEN) {
    if (z === 'b') await seqDeck(2);
    else if (z === 'c') { if (!ZELLEN.includes('b')) await seqDeck(2); await seqDeck(4); }
    await schlaf(5000);   // settle: the swap and the first notes are over
    // wait up to 3 minutes for the machine to be quiet (loadavg 1 min below 1.5, like the cost lanes); the load is recorded either way
    for (let i = 0; i < 36 && Number(fs.readFileSync('/proc/loadavg', 'utf8').split(' ')[0]) >= 1.5; i++) await schlaf(5000);
    const last0 =fs.readFileSync('/proc/loadavg', 'utf8').split(' ').slice(0, 3).map(Number);
    const a = Date.now(); await schlaf(SEK * 1000); const b = Date.now();
    erg.zellen[z] = { last_vor: last0, ...auswertung(a, b), von: a, bis: b };
    log('cell', z, JSON.stringify({ cb_max: erg.zellen[z].cb_max_us_max, median: erg.zellen[z].cb_max_us_median, pool_an: erg.zellen[z].spur_pool_ende?.an, diff: erg.zellen[z].spur_pool_diff }));
  }
} finally {
  for (const platz of [2, 4]) await ruf('POST', '/regler', { pfad: `deck/${platz}/fader`, nach: -200, takte: 0, ab: 'jetzt' });
  await ruf('POST', '/deck/stopp', { deck: 1 }); await ruf('POST', '/deck/stopp', { deck: 3 });
  erg.ende = new Date().toISOString();
  fs.writeFileSync(`${OUT}/${TAG}.json`, JSON.stringify(erg, null, 1));
  process.exit(0);
}
