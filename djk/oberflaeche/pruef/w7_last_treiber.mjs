// Load driver for the slice 7 load measurement (AK26 style): merges four tracks over 32 beats back to back on a TEST INSTANCE, measuring the render
// time (POST until the answer) and the decode time (answer until the new clip is decoded), one undo after every merge. Optional --stems: one real stems run
// (CPU) on a separate track in parallel, to see what the two do to each other. Started by w7_last.sh next to the kernel load run; no gate of its own.
//   node pruef/w7_last_treiber.mjs --url http://127.0.0.1:53300 --aufbau aufbau.json --instanz f --dauer-s 210 --jsonl out.jsonl [--stems]
import fs from 'node:fs';
import { starte } from './w3a_ziel.mjs';

const z = starte('w7_last_treiber', 'w7l', { 'dauer-s': { type: 'string' }, jsonl: { type: 'string' }, stems: { type: 'boolean' } });
const { AUFBAU: A, CYPHER, aendern, aktuell } = z;
const aus = z.opt.jsonl;
const schreibe = (o) => { if (aus) fs.appendFileSync(aus, `${JSON.stringify(o)}\n`); };
const ende = Date.now() + Number(z.opt['dauer-s'] ?? 210) * 1000;
const spur = (p, id) => p.spuren.find((s) => s.id === id);

await z.neuesProjekt('last');
await z.setzeTempo(A.bpm);
await aendern('last 1', Array.from({ length: 5 }, (_, i) => ({ befehl: 'spur_neu', art: 'audio', name: i === 0 ? 'Quelle' : `Q${i}` })), CYPHER);
const ids = (await aktuell()).projekt.spuren.map((s) => s.id);
await aendern('last 2', ids.map((id) => ({ befehl: 'clip_neu', spur_id: id, art: 'audio', start_beat: 0, laenge_beats: 64, sha256: A.sha,
  warp: 'auto' })), CYPHER);
await z.geladen();
const quellen = ids.slice(1);
schreibe({ art: 'aufbau', spuren: ids });

let stemsErgebnis = null;
async function stemsLauf() {
  const p = (await aktuell()).projekt, clip = spur(p, ids[0]).clips[0];
  const t0 = Date.now();
  const r = await z.ruf('POST', '/proj/stems', { clip_id: clip.id, von_beat: A.von_beat, bis_beat: A.bis_beat }, CYPHER);
  if (r.code !== 200) { stemsErgebnis = { start: z.grundVon(r) }; schreibe({ art: 'stems', ...stemsErgebnis }); return; }
  for (;;) {
    const st = (await aktuell()).stems;
    if (st?.auftrag_id === r.j.auftrag_id && st.zustand !== 'laeuft') {
      stemsErgebnis = { zustand: st.zustand, grund: st.grund ?? null, dauer_s: (Date.now() - t0) / 1000 };
      schreibe({ art: 'stems', ...stemsErgebnis }); return;
    }
    await z.warte(500);
  }
}
const stemsTask = z.opt.stems ? (async () => { await z.warte(5000); await stemsLauf(); })() : Promise.resolve();

let n = 0;
while (Date.now() < ende) {
  const t0 = Date.now();
  const r = await z.ruf('POST', '/proj/zusammenfuehren?antwort=kurz', { spur_ids: quellen, von_beat: A.von_beat, bis_beat: A.bis_beat }, CYPHER);
  const t1 = Date.now();
  if (r.code !== 200) { schreibe({ art: 'merge', n: ++n, ok: false, grund: z.grundVon(r), render_s: (t1 - t0) / 1000 }); await z.warte(2000); continue; }
  let dekod = null;
  for (let t = 0; t < 30000; t += 50) {
    const c = spur((await aktuell()).projekt, r.j.spur_id)?.clips[0];
    if (c?.dekodiert === 'fertig') { dekod = (Date.now() - t1) / 1000; break; }
    await z.warte(50);
  }
  schreibe({ art: 'merge', n: ++n, ok: true, render_s: (t1 - t0) / 1000, dekod_s: dekod });
  const u = await z.ruf('POST', '/proj/undo', { rev: await z.holeRev() }, CYPHER);
  if (u.code !== 200) schreibe({ art: 'undo', grund: z.grundVon(u) });
  await z.warte(1000);
}
await stemsTask;
schreibe({ art: 'ende', merges: n, stems: stemsErgebnis });
process.exit(0);
