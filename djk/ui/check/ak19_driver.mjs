// AK19 driver (routing 1.10): times the transport start against the core's /zustand/arr messages, for the lamp probe in the browser
// (chrome-devtools MCP: a MutationObserver on [data-p="limiter"] with performance.timeOrigin + performance.now(), same host clock as Date.now() here).
//   node check/ak19_driver.mjs --url http://127.0.0.1:52300 [--runden 10] [--aus <json>]
// Per round: stop, wait for the lamp hold to run out, start at beat 0, 2.5 s of material, stop. Per round it records (epoch ms): t_post (request sent),
// t_antwort (HTTP answer), t_lauf (first /zustand/arr with status 1 or 2), t_limiter (first /zustand/arr with limiter_db < -0.1), limiter_db and the
// message cadence. The open project must be the probe project (ak19_setup.mjs). Test instances b, d, e only.
import fs from 'node:fs';
import { parseArgs } from 'node:util';
const { values: opt } = parseArgs({ options: { url: { type: 'string' }, runden: { type: 'string' }, aus: { type: 'string' } } });
if (!opt.url || /:(47300|47100|47200)\b/.test(opt.url)) { process.stderr.write('ak19_treiber: --url of a test instance required (never the operation)\n'); process.exit(2); }
const k = (Number(new globalThis.URL(opt.url).port) - 47300) / 1000;
if (!/^[bde]$/.test(Number.isInteger(k) ? String.fromCharCode(96 + k) : '?')) { process.stderr.write('ak19_treiber: instance b, d or e only\n'); process.exit(2); }
const RUNDEN = Number(opt.runden ?? 10);
const CYPHER = { 'x-djk-quelle': 'cypher', 'content-type': 'application/json' };
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const meldungen = [];
const ac = new AbortController();
const strom = (async () => {
  try {
    const r = await fetch(opt.url + '/strom', { signal: ac.signal });
    const dec = new globalThis.TextDecoder(); let puf = '';
    for await (const s of r.body) {
      puf += dec.decode(s, { stream: true });
      let i;
      while ((i = puf.indexOf('\n\n')) >= 0) {
        const b = puf.slice(0, i); puf = puf.slice(i + 2);
        if (!b.startsWith('data: ')) continue;
        try { const m = JSON.parse(b.slice(6)); if (m.a === '/zustand/arr') meldungen.push({ t: Date.now(), f: m.f }); } catch { /* partial */ }
      }
    }
  } catch { /* aborted */ }
})();
const transport = async (aktion) => {
  const t0 = Date.now();
  const r = await fetch(opt.url + '/proj/transport', { method: 'POST', headers: CYPHER, body: JSON.stringify(aktion === 'start' ? { aktion, beat: 0 } : { aktion }) });
  const j = await r.json().catch(() => null);
  return { t_post: t0, t_antwort: Date.now(), code: r.status, j };
};
await warte(500);
const runden = [];
for (let n = 1; n <= RUNDEN; n++) {
  await transport('stopp'); await warte(1500);
  const von = meldungen.length;
  const s = await transport('start');
  await warte(2500);
  const sp = await transport('stopp');
  await warte(1200);
  const m = meldungen.slice(von);
  const lauf = m.find((x) => x.f.status === 1 || x.f.status === 2);
  const lim = m.find((x) => typeof x.f.limiter_db === 'number' && x.f.limiter_db < -0.1);
  const tt = m.map((x) => x.t);
  const abstand = tt.slice(1).map((t, i) => t - tt[i]);
  runden.push({ n, start_code: s.code, t_post: s.t_post, t_antwort: s.t_antwort, t_stopp_post: sp.t_post, t_lauf: lauf?.t ?? null, t_limiter: lim?.t ?? null, limiter_db_erste: lim?.f.limiter_db ?? null,
    limiter_db_min: m.length ? Math.min(...m.map((x) => (typeof x.f.limiter_db === 'number' ? x.f.limiter_db : 0))) : null, meldungen: m.length,
    abstand_max_ms: abstand.length ? Math.max(...abstand) : null, abstand_med_ms: abstand.length ? [...abstand].sort((a, b) => a - b)[abstand.length >> 1] : null });
}
ac.abort(); await strom;
const aus = opt.aus ?? null;
if (aus) fs.writeFileSync(aus, JSON.stringify({ runden }, null, 1));
for (const r of runden) process.stdout.write(`${JSON.stringify(r)}\n`);
