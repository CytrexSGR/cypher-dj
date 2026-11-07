// AK19 set-up (routing 1.10): builds the two probe projects on a TEST INSTANCE page server (instances b, d, e) and leaves the HOT one open.
//   node pruef/ak19_aufbau.mjs --url http://127.0.0.1:52300 [--oeffne ak19-heiss|ak19-leise]
// ak19-heiss: 8 RB-338 style instrument tracks, same pitch (24), all faders +6 dB, master +6 dB, loop 0..8, 128 BPM: the set limiter engages.
// ak19-leise: 2 tracks (36 and 43), faders -12 dB, master 0 dB: the set limiter stays out (negative control).
// Prints one JSON line {heiss, leise} with the slugs. The probe projects carry the prefix ak19- (slug ak19-...-<time>); only those are ever removed.
import { parseArgs } from 'node:util';
const { values: opt } = parseArgs({ options: { url: { type: 'string' }, oeffne: { type: 'string' } } });
if (!opt.url || /:(47300|47100|47200)\b/.test(opt.url)) { process.stderr.write('ak19_aufbau: --url of a test instance required (never the operation)\n'); process.exit(2); }
const k = (Number(new globalThis.URL(opt.url).port) - 47300) / 1000;
if (!/^[bde]$/.test(Number.isInteger(k) ? String.fromCharCode(96 + k) : '?')) { process.stderr.write('ak19_aufbau: instance b, d or e only\n'); process.exit(2); }
const CYPHER = { 'x-djk-quelle': 'cypher' };
const ruf = async (m, p, body, h = {}) => {
  const r = await fetch(opt.url + p, { method: m, headers: { 'content-type': 'application/json', ...h }, body: m === 'GET' ? undefined : JSON.stringify(body ?? {}) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { code: r.status, j };
};
const aendern = async (label, befehle) => {
  const rev = (await ruf('GET', '/proj/aktuell?nur=rev')).j.rev;
  const r = await ruf('POST', '/proj/aendern', { rev, label, befehle }, CYPHER);
  if (r.code !== 200) throw new Error(`${label}: ${r.code} ${JSON.stringify(r.j)}`);
};
const noten = (ton, n) => Array.from({ length: n }, (_, i) => ({ beat: i, laenge: 0.5, ton, vel: 110 }));
const bauen = async (name, toene, fader, master) => {
  const n = await ruf('POST', '/proj/neu', { name: `${name}-${Date.now()}` }, CYPHER);
  if (n.code !== 200) throw new Error(`/proj/neu ${n.code} ${JSON.stringify(n.j)}`);
  await aendern(`${name} tracks`, [{ befehl: 'tempo_setzen', bpm: 128 }, ...toene.map((_, i) => ({ befehl: 'spur_neu', art: 'instrument', name: `P${i + 1}` }))]);
  const ids = (await ruf('GET', '/proj/aktuell')).j.projekt.spuren.map((s) => s.id);
  const b = ids.map((id, i) => ({ befehl: 'clip_neu', spur_id: id, art: 'midi', start_beat: 0, laenge_beats: 8, noten: noten(toene[i], 8) }));
  b.push({ befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 8 });
  for (const id of ids) b.push({ befehl: 'spur_aendern', spur_id: id, fader_db: fader });
  if (master !== 0) b.push({ befehl: 'master_aendern', fader_db: master });
  await aendern(`${name} clips and faders`, b);
  return (await ruf('GET', '/proj/aktuell')).j.slug;
};
const heiss = await bauen('ak19-heiss', Array(8).fill(24), 6, 6);
const leise = await bauen('ak19-leise', [36, 43], -12, 0);
const offen = opt.oeffne === 'ak19-leise' ? leise : heiss;
const o = await ruf('POST', '/proj/oeffnen', { slug: offen }, CYPHER);
if (o.code !== 200) throw new Error(`/proj/oeffnen ${o.code} ${JSON.stringify(o.j)}`);
process.stdout.write(`${JSON.stringify({ heiss, leise, offen })}\n`);
