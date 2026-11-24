// Raw offline render of a factory preset or device, the way the page's preview builds it (djk/ui/presets/prelisten.ts), without its normalisation.
//   node render_preset.mjs --preset <werk:geraet/slug> | --graph <bk effect graph> | --geraet rb338  --aus <out.wav>  [--eingang <in.wav>] [--graphordner DIR]
// An effect (comp, eq, sat, bk effect graph) needs --eingang: an audio track whose clip is that file, the effect applied as a new insert by the same
// plan the PRESETS page uses. An instrument (rb338, bk graph) gets a MIDI clip of three notes C2, C3, C4 of 1 s each at velocity 100 plus 1 s tail.
// Runs the server's code in-process; no page server, no instance. Exit 0 = written, 3 = this preset cannot be placed by the project render
// (reason on stdout, a skip and not a fault), 1 = a fault (message on stderr).
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fuehreListeAus } from '../../ui/project/commands.ts';
import { neuesProjekt } from '../../ui/project/model.ts';
import { rendereProjektDatei } from '../../ui/project/render_file.ts';
import { planeAnwendung } from '../../ui/presets/apply.ts';
import { PresetSpeicher } from '../../ui/presets/store.ts';
import { leseStarterWav } from '../../ui/presets/prelisten.ts';

const BPM = 128;
const SPUR = 'preview';
const SKIP = 3;
const HALL_NACHLAUF_S = 2;
// The return strip's Hall takes six values 0..1 (the core's arr_hall_einstellung, djk/core/src/arr_returns.cpp:19-33); the plugin preset holds the
// real units, so each is inverted through the same curve. What a return does not carry (early, high decay, low cut, diffusion, width, duck, freeze,
// kill, FFT size) is fixed by the core; `mix` becomes the send level (the return is wet only).
const klemme = (v) => Math.min(1, Math.max(0, v));
const hallVon = (w) => ({
  pre: klemme(w.pre / 250), decay: klemme(Math.log(w.decay / 0.1) / Math.log(300)), groesse: klemme((w.size - 5) / 195),
  tief: klemme(Math.log(w.lowx / 0.25) / Math.log(16)), highcut: klemme(Math.log(w.highcut / 1000) / Math.log(22)), fahne: klemme((w.tail + 24) / 36),
});
const sendDb = (w) => Math.max(-40, Math.min(0, 20 * Math.log10(Math.max(w.mix, 0.01))));
const BEATS_PRO_S = BPM / 60;

const { values: a } = parseArgs({ options: { preset: { type: 'string' }, graph: { type: 'string' }, geraet: { type: 'string' }, aus: { type: 'string' },
  eingang: { type: 'string' }, graphordner: { type: 'string' }, werk: { type: 'string' } } });
const skip = (grund) => { process.stdout.write(`${grund}\n`); process.exit(SKIP); };
if (!a.aus || [a.preset, a.graph, a.geraet].filter(Boolean).length !== 1) { process.stderr.write('usage: --preset ID | --graph NAME | --geraet rb338, --aus FILE [--eingang FILE] [--werk FACTORY_DIR]\n'); process.exit(2); }

let preset;                                   // what planeAnwendung takes
if (a.preset) {
  const m = /^(werk|nutzer):([a-z0-9-]+)\/(.+)$/.exec(a.preset);
  if (!m) { process.stderr.write('bad preset id\n'); process.exit(2); }
  const p = new PresetSpeicher({ nutzer: path.join(os.tmpdir(), 'werkscheck-kein-nutzer'), ...(a.werk ? { werk: path.resolve(a.werk) } : {}) }).lies(m[1], m[2], m[3]);
  preset = { id: a.preset, name: p.name, geraet: p.geraet, typ: p.geraet_typ, ...(p.graph ? { graph: p.graph } : {}), werte: p.werte, ...(p.stifte ? { stifte: p.stifte } : {}) };
} else if (a.graph) {
  preset = { id: `werk:baukasten/${a.graph}`, name: a.graph, geraet: 'baukasten', typ: a.eingang ? 'effekt' : 'instrument', graph: a.graph, werte: {} };
} else {
  if (a.geraet !== 'rb338') { process.stderr.write('--geraet knows rb338\n'); process.exit(2); }
  preset = { id: '', name: 'rb338', geraet: 'rb338', typ: 'instrument', werte: {} };
}
const effekt = preset.typ === 'effekt' || Boolean(a.eingang);   // a modular preset file may sit in the instrument list while its graph is an effect
if (effekt && !a.eingang) { process.stderr.write('an effect needs --eingang\n'); process.exit(2); }

const arbeit = fs.mkdtempSync(path.join(os.tmpdir(), 'werkscheck-arbeit-'));
const kit = path.join(arbeit, 'kit'); fs.mkdirSync(kit);
const abschluss = (code) => { fs.rmSync(arbeit, { recursive: true, force: true }); process.exit(code); };
try {
  const p0 = neuesProjekt('werkscheck'); p0.tempo_bpm = BPM;
  let projekt, bisBeat;
  if (effekt) {
    const wav = leseStarterWav(a.eingang);
    if (!wav) throw new Error(`input ${a.eingang} is not a 32-bit float stereo 48 kHz WAV`);
    const sha = crypto.createHash('sha256').update(wav.daten).digest('hex');
    fs.mkdirSync(path.join(arbeit, 'audio'), { recursive: true });
    fs.writeFileSync(path.join(arbeit, 'audio', `${sha}.f32`), wav.daten);
    const r1 = fuehreListeAus(p0, [{ befehl: 'spur_neu', art: 'audio', name: SPUR }]);
    const spur = r1.projekt.spuren.find((s) => s.name === SPUR);
    bisBeat = wav.frames * BPM / (48000 * 60);
    const r2 = fuehreListeAus(r1.projekt, [{ befehl: 'clip_neu', spur_id: spur.id, art: 'audio', start_beat: 0, laenge_beats: bisBeat, sha256: sha, name: 'eingang' }]);
    if (preset.geraet === 'hall') {
      // A reverb preset has no insert target: the project's reverb is the Hall of a return strip (a send from the track, the return into the master).
      const r3 = fuehreListeAus(r2.projekt, [{ befehl: 'return_neu', name: 'werkscheck hall', hall: hallVon(preset.werte) }]);
      const ret = r3.projekt.returns[0];
      projekt = fuehreListeAus(r3.projekt, [{ befehl: 'send_setzen', strang_id: spur.id, return_id: ret.id, db: sendDb(preset.werte) }]).projekt;
      bisBeat += HALL_NACHLAUF_S * BEATS_PRO_S;       // 2 s of silence after the input for the tail
    } else {
      let anw;
      try { anw = planeAnwendung(preset, { art: 'insert_neu', strang_id: spur.id }, r2.projekt); } catch (e) {
        if (e?.fehler === 'kein_ziel' || e?.fehler === 'geraet_passt_nicht') skip(`cannot be placed: ${e.fehler}`);
        throw e;
      }
      if (anw.weg !== 'proj') skip('cannot be placed: not a project edit');
      projekt = fuehreListeAus(r2.projekt, anw.befehle).projekt;
    }
    for (const s of projekt.spuren) for (const c of s.clips) if (c.art === 'audio') c.dekodiert = 'fertig';
  } else {
    const geraet = preset.geraet === 'rb338' ? { art: 'intern', name: 'rb338', parameter: {} } : { art: 'intern', name: 'bk', graph: preset.graph, parameter: {} };
    const r1 = fuehreListeAus(p0, [{ befehl: 'spur_neu', art: 'instrument', name: SPUR, geraet }]);
    const spur = r1.projekt.spuren.find((s) => s.name === SPUR);
    const note = BEATS_PRO_S;                       // 1 s in beats
    bisBeat = 4 * note;                              // three notes, 1 s tail
    const noten = [36, 48, 60].map((ton, i) => ({ beat: i * note, laenge: note, ton, vel: 100 }));
    const r2 = fuehreListeAus(r1.projekt, [{ befehl: 'clip_neu', spur_id: spur.id, art: 'midi', start_beat: 0, laenge_beats: bisBeat, noten }]);
    projekt = r2.projekt;
    if (a.preset) {
      let anw;
      try { anw = planeAnwendung(preset, { art: 'spur', spur_id: spur.id }, r2.projekt); } catch (e) {
        if (e?.fehler === 'kein_ziel' || e?.fehler === 'geraet_passt_nicht') skip(`cannot be placed: ${e.fehler}`);
        throw e;
      }
      if (anw.weg !== 'proj') skip('cannot be placed: not a project edit');
      projekt = fuehreListeAus(r2.projekt, anw.befehle).projekt;
    }
  }
  const ziel = path.join(arbeit, 'out.wav');
  const r = await rendereProjektDatei({ projekt, ziel, vonBeat: 0, bisBeat, arbeitsOrdner: arbeit, timeoutMs: 240_000,
    env: { CYPHERDJ_BK_ORDNER: a.graphordner ?? path.join(arbeit, 'graphen'), CYPHERDJ_KIT_ORDNER: kit } });
  fs.mkdirSync(path.dirname(path.resolve(a.aus)), { recursive: true });
  fs.copyFileSync(r.datei, a.aus);
  abschluss(0);
} catch (e) {
  process.stderr.write(`${e?.message ?? e}\n`);
  abschluss(1);
}
