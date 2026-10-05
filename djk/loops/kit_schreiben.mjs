// MVP 2 Scheibe 3 (E2, SCHNITTSTELLEN §4.8 kit:<a>+<b>): ein gespeicherter Loop wird zum Klang im Zusatz-Kit, das der
// Erzeuger zusammen mit dem Basis-Kit spielt (s("bd rec0")). Geschrieben wird nur ins Zusatz-Kit; der Erzeuger sieht
// die geänderte kit.json und meldet den Strom neu an, der Kern lädt dann beide Kits (ohne Neustart).
// Genutzt von djk-loop kit und vom Seiten-Server (→ STRUDEL).
import fs from 'node:fs';
import path from 'node:path';

const MAX_FRAMES = 480000;  // Kit-Grenze (§4.8): 10 s je Klang
const NAME = /^[a-z][a-z0-9_]{0,15}$/;

const lies = (ordner) => {
  try { return JSON.parse(fs.readFileSync(path.join(ordner, 'kit.json'), 'utf8')); } catch { return null; }
};
const bank = (name) => name.split(':')[0];

// Sperre je Zusatz-Kit (Abschluss-Review Scheibe 3 Fund 3: CLI und Seite zugleich verloren Einträge). mkdir ist
// atomar; eine Sperre älter als 10 s gilt als liegengeblieben (abgestürzter Schreiber) und wird übernommen.
function mitSperre(ordner, fn) {
  fs.mkdirSync(ordner, { recursive: true });
  const sperre = path.join(ordner, '.sperre');
  const bis = Date.now() + 5000;
  for (;;) {
    try { fs.mkdirSync(sperre); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(sperre).mtimeMs > 10000) { fs.rmdirSync(sperre); continue; } } catch { continue; }
      if (Date.now() > bis) throw new Error(`Kit ${ordner} ist gesperrt (${sperre})`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  try { return fn(); } finally { fs.rmdirSync(sperre); }
}

export function loopZuKlang(auftrag) {
  return mitSperre(path.join(auftrag.kitsOrdner, auftrag.zusatz), () => schreibe(auftrag));
}

function schreibe({ loopOrdner, kitsOrdner, basis, zusatz, loop, klang }) {
  const quelle = path.join(loopOrdner, loop);
  let lj;
  try { lj = JSON.parse(fs.readFileSync(path.join(quelle, 'loop.json'), 'utf8')); } catch {
    throw new Error(`Loop fehlt oder unlesbar: ${quelle}`);
  }
  const frames = Number(lj.frames);
  if (!Number.isInteger(frames) || frames <= 0) throw new Error(`Loop ${loop}: frames ${lj.frames}`);
  if (frames > MAX_FRAMES) throw new Error(`Loop ${loop}: ${frames} Frames, länger als 10 s (Kit-Grenze)`);
  const kb = lies(path.join(kitsOrdner, basis));
  if (!kb) throw new Error(`Basis-Kit ${basis} fehlt`);
  const zOrdner = path.join(kitsOrdner, zusatz);
  const kz = lies(zOrdner) ?? { schema: 1, name: zusatz, klaenge: [] };
  const baenkeBasis = new Set(kb.klaenge.map((k) => bank(k.name)));
  const baenkeZusatz = new Set(kz.klaenge.map((k) => bank(k.name)));
  let name = klang;
  if (name === undefined) {
    let i = 0;
    while (baenkeZusatz.has(`rec${i}`) || baenkeBasis.has(`rec${i}`)) ++i;
    name = `rec${i}`;
  }
  if (!NAME.test(name)) throw new Error(`Name ${name}: [a-z][a-z0-9_]{0,15}`);
  if (baenkeBasis.has(name)) throw new Error(`${name} ist im Kit ${basis} schon ein Klang`);
  if (baenkeZusatz.has(name)) throw new Error(`${name} gibt es im Kit ${zusatz} schon`);
  const belegt = new Set([...kb.klaenge, ...kz.klaenge].map((k) => k.note));
  let note = 0;
  while (belegt.has(note)) ++note;
  if (note > 127) throw new Error('keine freie Note mehr (128 Klänge in beiden Kits)');
  const datei = `${name}_0.f32`;
  const tmp = path.join(zOrdner, `.${datei}.${process.pid}.neu`);
  const v = Number.isInteger(lj.versatz_frames) ? ((lj.versatz_frames % frames) + frames) % frames : 0;
  if (v === 0) fs.copyFileSync(path.join(quelle, lj.datei ?? 'loop.f32'), tmp);
  else {   // Plan Grid (D8): so beginnt der Klang auf der Takt-Eins, die Andreas im Loop gerichtet hat
    const roh = fs.readFileSync(path.join(quelle, lj.datei ?? 'loop.f32'));
    fs.writeFileSync(tmp, Buffer.concat([roh.subarray(v * 8), roh.subarray(0, v * 8)]));
  }
  fs.renameSync(tmp, path.join(zOrdner, datei));
  kz.klaenge.push({ note, name: `${name}:0`, datei, frames, quelle: `loop:${loop}` });
  const tmpJ = path.join(zOrdner, `.kit.json.${process.pid}.neu`);
  fs.writeFileSync(tmpJ, JSON.stringify(kz, null, 1));
  fs.renameSync(tmpJ, path.join(zOrdner, 'kit.json'));
  return { klang: name, note };
}
