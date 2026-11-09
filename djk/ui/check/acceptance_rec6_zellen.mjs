// 1.8 T10, the two cells on a test instance with the REAL core: count-in, punch and overdub project fields now act on every start of a recording, also on
// proj_strom_aufnehmen (it starts through /proj/aufnahme, reads the beat after the start and waits 4 * takte beats). The calls go through the REAL djk-hand
// (MCP over stdio) against the page server of the instance, so the tools are exercised as Cypher uses them.
//   Cell 1  count-in 1 bar, punch off: erz/1 through proj_aufnahme (start answers after the count-in, take present, clip placed) and a stream bounce through
//           proj_strom_aufnehmen (erz/2, graph + pattern): take present, clip placed, the stream wait ends, the track is disarmed again.
//   Cell 2  the same with punch.ein true: a defined result each time, never a hang: placed inside the range (the front of the take is cut at the range start)
//           or a named reason (punch_leer, the range does not touch the take).
// Instance b, d or e only; the caller holds flock /dev/shm/cypherdj-instanz-<i>.flock and, nested inside, the real-time lock (wrapper in the evidence folder):
//   node check/acceptance_rec6_zellen.mjs --url http://127.0.0.1:5<port> [--instanz d] [--ausgabe <folder>] [--bruch punch]
// --bruch punch (deliberate break of cell 2): the punch fields are NOT set before the recordings of cell 2, so the clip is not cut and starts at the take start;
// the cell must then say FEHL. Exit 0 all OK, 1 at least one FEHL, 2 usage. Only its own project (slug rec10-...) is removed at the end.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const HAND_DIR = path.resolve(HIER, '..', '..', 'hand');
const { values: opt } = parseArgs({ options: { url: { type: 'string' }, instanz: { type: 'string', default: 'd' }, ausgabe: { type: 'string' }, bruch: { type: 'string' } } });
if (!opt.url || !/^[bde]$/.test(opt.instanz) || (opt.bruch !== undefined && opt.bruch !== 'punch')) {
  process.stderr.write('abnahme_rec6_zellen: usage: --url <page of the test instance> [--instanz b|d|e] [--ausgabe <folder>] [--bruch punch]\n'); process.exit(2);
}
const { Client } = await import(path.join(HAND_DIR, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'));
const { StdioClientTransport } = await import(path.join(HAND_DIR, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js'));

const ORDNER = path.resolve((opt.ausgabe ?? path.join(HIER, 'ergebnisse', `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}-rec6`)).replace(/^~(?=\/|$)/, os.homedir()));
fs.mkdirSync(ORDNER, { recursive: true });
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const zeilen = [], roh = {};
let fehl = 0;
const notiere = (k, ok, text) => { if (!ok) fehl++; zeilen.push(`${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}`); process.stdout.write(`${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}\n`); };
const info = (t) => { zeilen.push(`INFO ${t}`); process.stdout.write(`INFO ${t}\n`); };
const j = (x) => JSON.stringify(x);

const c = new Client({ name: 'rec6', version: '0' });
await c.connect(new StdioClientTransport({ command: process.execPath, args: ['--no-warnings', path.join(HAND_DIR, 'hand.ts'), '--seite', opt.url.replace(/\/$/, '')] }));
// a tool call with a hard limit: a hang is a FEHL of the cell, not a hung script
const GRENZE_MS = 150_000;
async function ruft(name, args, grenze = GRENZE_MS) {
  const t0 = Date.now();
  const r = await Promise.race([c.callTool({ name, arguments: args }), warte(grenze).then(() => ({ haengt: true }))]);
  const ms = Date.now() - t0;
  if (r.haengt) return { haengt: true, ms };
  let j0; try { j0 = JSON.parse(r.content[0].text); } catch { j0 = { text: r.content[0].text }; }
  return { fehler: !!r.isError, j: j0, ms };
}
const muss = async (name, args) => { const r = await ruft(name, args); if (r.haengt || r.fehler) throw new Error(`${name} ${j(args)}: ${r.haengt ? 'hangs' : j(r.j)}`); return r.j; };
const lage = async () => (await muss('proj_lage', {})).projekt;
const aendern = async (label, befehle) => muss('proj_aendern', { rev: (await lage()).rev, label, befehle });
const clipsVon = async (name) => (await lage()).spuren.find((s) => s.name === name)?.clips ?? [];
// peak of a take file (WAV, float or 16 bit) in dBFS, null if unreadable
function spitzeDb(datei) {
  try {
    const b = fs.readFileSync(datei);
    const d = b.indexOf('data'); const fmt = b.readUInt16LE(20);
    const roh0 = b.subarray(d + 8);
    let m = 0;
    if (fmt === 3) { const f = new Float32Array(roh0.buffer.slice(roh0.byteOffset, roh0.byteOffset + (roh0.length & ~3))); for (const x of f) m = Math.max(m, Math.abs(x)); }
    else for (let i = 0; i + 1 < roh0.length; i += 2) m = Math.max(m, Math.abs(roh0.readInt16LE(i)) / 32768);
    return m > 0 ? 20 * Math.log10(m) : -200;
  } catch { return null; }
}

let slug = null;
try {
  const graphen = (await muss('graphen', {})).graphen ?? [];
  const graph = graphen.find((g) => g.art === 'instrument')?.name;
  info(`graphs ${graphen.map((g) => `${g.name}(${g.art})`).join(' ')}; the bounce uses ${graph}`);
  if (!graph) throw new Error('no instrument graph on this instance');
  const neu = await muss('proj_neu', { name: `rec10-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}` });
  slug = neu.slug;
  await aendern('setup', [{ befehl: 'tempo_setzen', bpm: 120 }, { befehl: 'spur_neu', art: 'audio', name: 'Tap' }]);
  const tap = (await lage()).spuren.find((s) => s.name === 'Tap');
  const setze = (label, felder) => aendern(label, [{ befehl: 'aufnahme_setzen', ...felder }]);
  const armTap = (an) => aendern(an ? 'arm Tap' : 'disarm Tap', [{ befehl: 'spur_aendern', spur_id: tap.id, arm: an, ...(an ? { eingang: { art: 'intern', name: 'erz/1' } } : {}) }]);
  const STROM = { strom: 2, graph, code: 'note("c2 e2 g2 c3")' };
  const beatsPunktAus = { ein: false, aus: false, von_beat: 4, bis_beat: 8 };

  // ---------- cell 1: count-in 1 bar, punch off ----------
  await setze('count-in 1', { vorzaehler_takte: 1, punch: beatsPunktAus, overdub: false });
  await armTap(true);
  {
    const s = await ruft('proj_aufnahme', { aktion: 'start' });
    const t0 = Date.now();
    await warte(2500);
    const p = await ruft('proj_aufnahme', { aktion: 'stopp' });
    roh.z1_proj = { start: s, stopp: p };
    const take = p.j?.takes?.[0];
    const clips = await clipsVon('Tap');
    notiere('Z1a proj_aufnahme, count-in 1 bar: the start answers only after the count-in', !s.haengt && !s.fehler && s.j.aufnahme === 'laeuft' && s.ms >= 1500, `start answered after ${s.ms} ms (4 beats at 120 BPM = 2000 ms), ${j(s.j).slice(0, 220)}`);
    notiere('Z1b proj_aufnahme: take present and placed', !p.haengt && !p.fehler && !!take && !take.fehler && take.frames > 0 && clips.length === 1 && clips[0].art === 'audio',
      `take ${j(take)?.slice(0, 260)}; clips on Tap ${clips.length}${clips[0] ? ` start_beat ${clips[0].start_beat} length ${clips[0].laenge_beats}` : ''}; stopp after ${Date.now() - t0} ms`);
    notiere('Z1c the take starts at the transport start, not inside the count-in', clips.length === 1 && Math.abs(clips[0].start_beat) < 0.01, `clip start_beat ${clips[0]?.start_beat}`);
  }
  await armTap(false);
  {
    const r = await ruft('proj_strom_aufnehmen', { spur: 'Bass', ...STROM, takte: 1 });
    roh.z1_strom = r;
    const clips = await clipsVon('Bass');
    const sp = (await lage()).spuren.find((s) => s.name === 'Bass');
    const peak = r.j?.take?.datei ? spitzeDb(r.j.take.datei) : null;
    notiere('Z1d proj_strom_aufnehmen (count-in 1 bar, punch off): the call ends (no hang), take present, clip placed', !r.haengt && !r.fehler && r.j.take?.frames > 0 && clips.length === 1,
      `${r.haengt ? 'HANGS' : `answered after ${r.ms} ms`}; ${j(r.haengt ? null : (r.fehler ? r.j : { take: r.j.take, clip_id: r.j.clip_id })).slice(0, 300)}; clips on Bass ${clips.length}${clips[0] ? ` start_beat ${clips[0].start_beat} length ${clips[0].laenge_beats}` : ''}`);
    notiere('Z1e the stream track is disarmed again', sp?.aufnahme?.scharf !== true, `Bass aufnahme ${j(sp?.aufnahme)}`);
    info(`INFO take peak of the stream bounce: ${peak === null ? 'not readable' : `${peak.toFixed(1)} dBFS`} (not a criterion: the pattern may or may not sound on this instance)`);
  }

  // ---------- cell 2: punch.ein ----------
  if (opt.bruch !== 'punch') await setze('punch in 4 to 8', { vorzaehler_takte: 1, punch: { ein: true, aus: false, von_beat: 4, bis_beat: 8 } });
  else info('BRUCH punch: the punch fields are not set before cell 2');
  await armTap(true);
  {
    // a take of about 10 beats (count-in, then the transport runs): the front is cut at beat 4
    const s = await ruft('proj_aufnahme', { aktion: 'start', von_beat: 0 });
    await warte(5200);
    const p = await ruft('proj_aufnahme', { aktion: 'stopp' });
    roh.z2_proj = { start: s, stopp: p };
    const take = p.j?.takes?.[0];
    const clips = await clipsVon('Tap');
    const neuer = clips.filter((k) => k.start_beat > 0.5);
    const dauer = take?.frames ? take.frames / 48000 * 2 : null;   // beats at 120 BPM
    notiere('Z2a proj_aufnahme with punch.ein 4..8: defined result (placed inside the range, or a named reason), no hang',
      !p.haengt && !s.haengt && ((!!take && !take.fehler && neuer.length === 1 && Math.abs(neuer[0].start_beat - 4) < 0.02) || (!!take?.fehler && /punch_leer/.test(take.fehler))),
      `take ${j(take)?.slice(0, 320)}; clips on Tap (start_beat/length) ${j(clips.map((k) => [k.start_beat, k.laenge_beats]))}${dauer ? `, the take is ${dauer.toFixed(1)} beats` : ''}`);
    // the range that does not touch the take: punch_leer, the raw file is kept
    if (opt.bruch !== 'punch') await setze('punch far away', { punch: { ein: true, aus: false, von_beat: 64, bis_beat: 68 } });
    const s2 = await ruft('proj_aufnahme', { aktion: 'start', von_beat: 0 });
    await warte(2500);
    const p2 = await ruft('proj_aufnahme', { aktion: 'stopp' });
    const t2 = p2.j?.takes?.[0];
    roh.z2_leer = { start: s2, stopp: p2 };
    notiere('Z2b proj_aufnahme with a punch range that misses the take: the named reason punch_leer, nothing placed, raw file kept', !p2.haengt && !!t2 && /punch_leer/.test(String(t2.fehler ?? '')) && !!t2.datei && fs.existsSync(t2.datei),
      `take ${j(t2)?.slice(0, 300)}`);
  }
  await armTap(false);
  {
    if (opt.bruch !== 'punch') await setze('punch in 4 to 8 again', { vorzaehler_takte: 1, punch: { ein: true, aus: false, von_beat: 4, bis_beat: 8 } });
    const r = await ruft('proj_strom_aufnehmen', { spur: 'Bass2', ...STROM, takte: 2 });
    roh.z2_strom = r;
    const clips = await clipsVon('Bass2');
    const sp = (await lage()).spuren.find((s) => s.name === 'Bass2');
    notiere('Z2c proj_strom_aufnehmen with punch.ein 4..8: the call ends, the clip is placed inside the range (front cut at beat 4) or the named reason punch_leer', !r.haengt
      && ((!r.fehler && clips.length === 1 && Math.abs(clips[0].start_beat - 4) < 0.02) || (r.fehler && r.j.fehler === 'punch_leer')),
      `${r.haengt ? 'HANGS' : `answered after ${r.ms} ms`}; ${j(r.haengt ? null : (r.fehler ? r.j : { take: r.j.take, clip_id: r.j.clip_id })).slice(0, 320)}; clips on Bass2 ${j(clips.map((k) => [k.start_beat, k.laenge_beats]))}`);
    notiere('Z2d the stream track is disarmed again', sp?.aufnahme?.scharf !== true, `Bass2 aufnahme ${j(sp?.aufnahme)}`);
    if (opt.bruch !== 'punch') await setze('punch far away', { punch: { ein: true, aus: false, von_beat: 64, bis_beat: 68 } });
    const r2 = await ruft('proj_strom_aufnehmen', { spur: 'Bass3', ...STROM, takte: 1 });
    roh.z2_strom_leer = r2;
    const sp3 = (await lage()).spuren.find((s) => s.name === 'Bass3');
    notiere('Z2e proj_strom_aufnehmen with a range that misses the take: the call ends with a named reason (punch_leer) and disarms the track', !r2.haengt && r2.fehler === true && /punch_leer/.test(j(r2.j)) && sp3?.aufnahme?.scharf !== true,
      `${r2.haengt ? 'HANGS' : `answered after ${r2.ms} ms`}; ${j(r2.j).slice(0, 320)}; Bass3 aufnahme ${j(sp3?.aufnahme)}`);
  }
  // back to the neutral settings (own project, removed below)
  await setze('neutral', { vorzaehler_takte: 0, punch: beatsPunktAus });
} catch (e) {
  notiere('ABORT', false, e.stack ?? String(e));
} finally {
  try { await c.close(); } catch { /* gone */ }
  if (slug && /^rec10-/.test(slug)) {
    const ordner = `/dev/shm/cypherdj-${opt.instanz}/projekte/${slug}`;
    try { fs.rmSync(ordner, { recursive: true, force: true }); info(`project ${slug} removed (${ordner})`); } catch (e) { info(`project ${slug} not removed: ${e.message}`); }
  }
}
fs.writeFileSync(path.join(ORDNER, 'rohdaten.json'), JSON.stringify(roh, null, 2));
fs.writeFileSync(path.join(ORDNER, 'bericht.md'), `# T10 cells (instance ${opt.instanz}${opt.bruch ? `, break ${opt.bruch}` : ''})\n\n${zeilen.join('\n')}\n`);
process.stdout.write(`\n${fehl === 0 ? 'ALLES OK' : `${fehl} FEHL`}\n`);
process.exit(fehl === 0 ? 0 : 1);
