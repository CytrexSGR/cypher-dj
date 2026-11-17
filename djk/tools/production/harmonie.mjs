#!/usr/bin/env node
// Harmony on the command line (2026-11-17): the helpers of ui/public/harmonie.js for whoever writes notes without the page (the production skill).
//   harmonie.mjs folge --tonart a:minor --stufen 1,6,7,1 [--oktave 3] [--takte 1] [--toene 3] [--arp up|down|updown] [--schritt 0.25] [--bass-oktave 1]
//       a chord progression on steps of the key, led so that common tones stay; prints the notes for noten_neu: chords, an arpeggio of them, the
//       bass on the roots, and the two checks of the method (common tones between neighbours, root in the first and the last chord)
//   harmonie.mjs passt --datei <project.json> --clip <clip id>      the keys that fit the notes of a clip, best first
//   harmonie.mjs passt < notes.json                                 the same for a note list [{beat, laenge, ton}] on stdin
// Output is JSON on stdout; a wrong argument is a line on stderr and exit 2.
import fs from 'node:fs';
import { SKALEN, TON_NAMEN, tonartFehler, tonartText, stufenAkkord, fuehre, arpeggio, passendeTonarten, ARP_MODI } from '../../ui/public/harmonie.js';

const ab = (text) => { process.stderr.write(`harmonie: ${text}\n`); process.exit(2); };
const [, , was, ...rest] = process.argv;
const arg = {};
for (let i = 0; i < rest.length; i += 2) { if (!rest[i].startsWith('--') || rest[i + 1] === undefined) ab(`argument ${rest[i]}: --name value expected`); arg[rest[i].slice(2)] = rest[i + 1]; }
const zahl = (k, vorgabe, min, max) => { if (arg[k] === undefined) return vorgabe; const n = Number(arg[k]); if (!Number.isFinite(n) || n < min || n > max) ab(`--${k}: a number ${min}..${max} expected`); return n; };
const TON_NAME = (t) => `${TON_NAMEN[t % 12]}${Math.floor(t / 12) - 2}`;

function tonartVon(text) {
  const [g, sk = 'minor'] = String(text ?? '').split(':');
  const grundton = TON_NAMEN.findIndex((n) => n.toLowerCase() === g.toLowerCase());
  const t = { grundton, skala: sk };
  if (grundton < 0) ab(`--tonart: root ${TON_NAMEN.join(' ')} and a scale expected, as a:minor (scales: ${Object.keys(SKALEN).join(', ')})`);
  const f = tonartFehler(t);
  if (f) ab(f);
  return t;
}

if (was === 'folge') {
  const t = tonartVon(arg.tonart);
  const stufen = String(arg.stufen ?? '').split(',').map(Number);
  if (!stufen.length || stufen.some((s) => !Number.isInteger(s) || s < 1 || s > 14)) ab('--stufen: steps of the key as 1,6,7,1 expected');
  const oktave = zahl('oktave', 3, 0, 6), takte = zahl('takte', 1, 0.25, 16), anzahl = zahl('toene', 3, 2, 5), schritt = zahl('schritt', 0.25, 0.0625, 4);
  const bassOktave = zahl('bass-oktave', 1, -1, 4), modus = arg.arp ?? 'up';
  if (!ARP_MODI.includes(modus)) ab(`--arp: ${ARP_MODI.join(', ')} expected`);
  const laenge = takte * 4, akkorde = [], noten = [], bass = [];
  let vorher = [];
  stufen.forEach((stufe, i) => {
    const roh = stufenAkkord(t, stufe, oktave, anzahl), toene = fuehre(vorher, roh);
    akkorde.push({ stufe, toene, namen: toene.map(TON_NAME), gemeinsam: toene.filter((x) => vorher.includes(x)).length });
    for (const ton of toene) noten.push({ beat: i * laenge, laenge, ton, vel: 100 });
    bass.push({ beat: i * laenge, laenge, ton: (bassOktave + 2) * 12 + (roh[0] % 12), vel: 100 });
    vorher = toene;
  });
  const arp = arpeggio(noten.map((n, i) => ({ ...n, id: `x${i}` })), schritt, modus).neu;
  const wurzel = (a) => a.toene.some((x) => x % 12 === t.grundton);
  process.stdout.write(`${JSON.stringify({
    tonart: tonartText(t), laenge_beats: stufen.length * laenge, akkorde,
    pruefung: { gemeinsame_toene: akkorde.slice(1).map((a) => a.gemeinsam), grundton_im_ersten_und_letzten: wurzel(akkorde[0]) && wurzel(akkorde[akkorde.length - 1]) },
    noten: { akkorde: noten, arp, bass },
  }, null, 1)}\n`);
} else if (was === 'passt') {
  let noten;
  if (arg.datei) {
    const p = JSON.parse(fs.readFileSync(arg.datei, 'utf8'));
    const clip = (p.spuren ?? []).flatMap((s) => s.clips ?? []).find((c) => c.id === arg.clip);
    if (!clip || clip.art !== 'midi') ab(`--clip: no MIDI clip ${arg.clip} in ${arg.datei}`);
    noten = clip.noten;
  } else noten = JSON.parse(fs.readFileSync(0, 'utf8'));
  if (!Array.isArray(noten)) ab('a note list [{beat, laenge, ton}] expected');
  process.stdout.write(`${JSON.stringify(passendeTonarten(noten, 5).map((x) => ({ ...x, name: tonartText({ grundton: x.grundton, skala: x.skala }) })), null, 1)}\n`);
} else ab('usage: harmonie.mjs folge --tonart a:minor --stufen 1,6,7,1 | harmonie.mjs passt --datei <project.json> --clip <id>');
