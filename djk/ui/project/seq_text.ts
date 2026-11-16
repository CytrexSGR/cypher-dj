// SEQ deck v2 (spec 2026-11-14-seq-deck-design, section 7): the text of a pattern. One head line, then one line per lane:
//   folge bass  bk:bassmusik  2bar
//   noten bass       1/16  c1 ~ . c1 . . d#1 ~ . . c1 . g0 ~ ~ . | c1 ~ . c2 . . d#1 ~ . . f1 . g1 ~ . a#0
//   werte vel        1/16  120 . . 64 . . 100 . . . 70 . 115 . . .
//   werte k3         1/16  .25 . . .30 . . .55 . . . .35 . .80 . . .    ; Cutoff
//   kurve k4         sinus .08 .92 je 3/4bar   ; Resonance
//   noten kick 36    1/16  x...x...x.o.x...
// Three jobs: `schreibeFolgeText` writes a pattern, `leseFolgeText` parses a text into heads and lanes (pure, no ids, no project), `folgeBefehle` plans
// the command list that makes the project say what the text says. The planner runs the lane writers of public/seq_logic.js one after the other on a
// working copy of the project (the model's own fuehreListeAus), so every lane sees what the lanes before it left; for a pattern that does not exist
// yet the content of the copy goes into ONE seq_folge_neu, so a text writes a whole pattern or nothing. Pure functions, no file access.
// Cell numbers in messages count from 0, like the cells of the logic.
//
// Grammar notes (the spec fixes the first three; the rest is the reader's decision):
//  - head `folge <name> [<instrument>] [<length>]`: a name with spaces is in double quotes; instrument `bk:<graph>`, `kit:<kit>`, `rb338`; length `2bar`,
//    `3/4bar`, `6b`. For a pattern that exists, instrument and length are optional: another length acts like the pattern length control, another
//    instrument is refused.
//  - a `werte` line on an envelope target may end in `je <length>` (the own length of the envelope, like `kurve`); `werte vel` and `werte len` (with
//    `@<lane id>` when the pattern has several note lanes) are fields of the notes of a note lane and are merged into its cells.
//  - `kurve <target> <shape> <from> <to> [stufen N] [saat N] [je <length>]` or `kurve <target> punkte <beat>:<value>[@s|@sprung] ... [je <length>]`.
//  - a velocity lane wins over `x X o`; a length lane wins over `~`.
import { fuehreListeAus, BefehlFehler } from './commands.ts';
import { seqFolgen } from './seq.ts';
import type { Geraet, MidiClip, Projekt, Spur } from './model.ts';
import {
  SeqFehler, abgeleiteteZeilen, folgeSicht, kurveBefehle, formPunkte, laengeBefehle, musterLaenge, neueZeilenId, zeileBefehle, zeilenSetzenBefehle,
  zielErlaubt, zielName, reglerSchluessel, reglerZiel, geraetArt,
  // @ts-ignore plain JS module shared with the page
} from '../public/seq_logic.js';
// @ts-ignore plain JS module of the piano roll
import { tonName } from '../public/production/pianoroll.js';

export type Urteil = { grund: string; text: string };
export type Befehl = Record<string, unknown>;
export interface FolgeInfo {
  art: string; regler: { nr: number | string; name: string; vorgabe: number }[]; klaenge: { ton: number; name: string }[];
  /** Set for the generated sampler device `smp-<id>` (D11): the cut it plays; the workbench draws it as a SLICE grid.
   *  `laengen_beats[i]` = length of slice i. */
  schnitt?: { id: string; scheiben: number; laengen_beats: number[] };
}

const GITTER: Record<string, number> = { '1/4': 1, '1/8': 0.5, '1/16': 0.25, '1/32': 0.125 };
const GITTER_TEXT = new Map<number, string>(Object.entries(GITTER).map(([t, v]) => [v, t]));
const BAND_VEL = { o: 60, x: 100, X: 127 } as const;
const NOTEN_NAME = /^([a-gA-G])([#b]?)(-?\d+)$/;
const SEMITON: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const ZAHL = /^-?(\d+\.?\d*|\.\d+)$/;
const LAENGE = /^(\d+(?:\.\d+)?)(bar|b)$|^(\d+)\/(\d+)bar$/;
const INSTRUMENT = /^(bk:[a-z0-9_-]{1,32}|kit:[a-z0-9_-]{1,32}|rb338|surge|plugin|rack|none)$/i;
const FORMEN_TEXT = ['sinus', 'dreieck', 'saege', 'saege_ab', 'rechteck', 'rampe', 'zufall'];
const EPS = 1e-9;

const urteil = (text: string): Urteil => ({ grund: 'argument_ungueltig', text });

// ---------- writing ----------
export function geraetText(g: Geraet | undefined): string {
  if (g?.art === 'intern') return g.name === 'bk' ? `bk:${g.graph}` : g.name === 'kit' ? `kit:${g.kit}` : 'rb338';
  if (g?.art === 'wirt') return g.name === 'surge' ? 'surge' : 'plugin';
  if (g?.art === 'rack') return 'rack';
  return 'none';
}
// `bk:<graph>`, `kit:<kit>`, `rb338` as the device a new pattern gets (what seq_folge_neu takes); other instruments are not made from text.
export function geraetVonText(t: string): Geraet {
  const x = /^(bk|kit):(.+)$/i.exec(t);
  if (x) return (x[1].toLowerCase() === 'bk' ? { art: 'intern', name: 'bk', graph: x[2], parameter: {} } : { art: 'intern', name: 'kit', kit: x[2] }) as Geraet;
  if (t.toLowerCase() === 'rb338') return { art: 'intern', name: 'rb338', parameter: {} } as Geraet;
  throw new SeqFehler('argument_ungueltig', `instrument ${t}: a pattern is made with bk:<graph>, kit:<kit> or rb338`);
}

function zahlText(x: number, stellen: number): string {
  let s = (Math.round(x * 10 ** stellen) / 10 ** stellen).toFixed(stellen);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  if (s === '-0') s = '0';
  return s.replace(/^(-?)0\./, '$1.');
}
export function laengeText(beats: number): string {
  if (Math.abs(beats / 4 - Math.round(beats / 4)) < EPS) return `${Math.round(beats / 4)}bar`;
  if (beats < 4) {                                              // a part of a bar: 1/4bar, 1/2bar, 3/4bar, else beats
    const m = [2, 4].find((d) => Math.abs(beats * d / 4 - Math.round(beats * d / 4)) < EPS);
    if (m) return `${Math.round(beats * m / 4)}/${m}bar`;
  }
  return `${zahlText(beats, 4).replace(/^(-?)\./, '$10.')}b`;
}
export const bandVon = (vel: number): 'o' | 'x' | 'X' => (vel <= 79 ? 'o' : vel <= 110 ? 'x' : 'X');
const notenName = (ton: number): string => String(tonName(ton)).toLowerCase();
const namenText = (n: string): string => (/[\s";]/.test(n) ? `"${n.replace(/"/g, "'")}"` : n);
const gitterText = (t: number): string => GITTER_TEXT.get(t) ?? '1/16';

// ties of a pitched cell as the text writes them: none below 1.5 cells, else round(length) - 1, not past the end and not into the next note
function bindungen(zellen: { an: boolean; noten: { laenge: number }[] }[], i: number, teiler: number): number {
  const z = zellen[i];
  if (!z.an) return 0;
  const l = (z.noten as { laenge: number; ton: number }[]).reduce((a, b) => (b.ton < a.ton ? b : a)).laenge / teiler;
  const soll = l < 1.5 ? 0 : Math.round(l) - 1;
  let n = 0;
  while (n < soll && i + n + 1 < zellen.length && !zellen[i + n + 1].an) n++;
  return n;
}
function mitTakten(teile: string[], proTakt: number, gruppe: number, sep: string): string {
  let s = '';
  teile.forEach((t, i) => {
    s += t;
    if (i === teile.length - 1) return;
    if ((i + 1) % proTakt === 0) s += ' | ';
    else if ((i + 1) % gruppe === 0) s += sep;
  });
  return s;
}
function zielText(ziel: string): string {
  if (ziel === 'transpose') return 'transpose';
  if (ziel === 'spur_fader') return 'fader';
  if (ziel === 'spur_pan') return 'pan';
  const nr = reglerSchluessel(ziel);
  return typeof nr === 'number' ? `k${nr}` : String(nr ?? ziel);
}

// The pattern as text: head and every lane of the clip (explicit and derived, ids as the page shows them). A pattern without a clip is its head.
export function schreibeFolgeText(spur: Spur, clip: MidiClip | null, info: FolgeInfo): string {
  const kopf = `folge ${namenText(spur.name)}  ${geraetText(spur.geraet)}  ${laengeText(musterLaenge(clip))}`;
  if (!clip) return kopf;
  const sicht = folgeSicht(spur, clip, info);
  const zeilen = sicht.zeilen.map((z: any) => {
    const proTakt = Math.max(1, Math.round(4 / (z.teiler ?? 0.25)));
    if (z.art === 'noten') {
      const kopfZ = `noten ${z.id}${z.ton !== undefined ? ` ${z.ton}` : ''}  ${gitterText(z.teiler)}  `;
      if (z.ton !== undefined) {
        const zeichen = z.zellen.map((c: any) => (c.an ? bandVon(c.vel) : '.'));
        const name = (info.klaenge ?? []).find((k) => k.ton === z.ton)?.name;
        return kopfZ + mitTakten(zeichen, proTakt, 4, ' ') + (name ? `   ; ${name}` : '');
      }
      const tokens: string[] = z.zellen.map(() => '.');
      z.zellen.forEach((c: any, i: number) => {
        if (!c.an) return;
        tokens[i] = [...new Set((c.noten as { ton: number }[]).map((n) => n.ton))].sort((a, b) => a - b).map(notenName).join('+');
        const b = bindungen(z.zellen, i, z.teiler);
        for (let k = 1; k <= b; k++) tokens[i + k] = '~';
      });
      return kopfZ + mitTakten(tokens, proTakt, 1, ' ');
    }
    const je = z.eigen_laenge ? `  je ${laengeText(z.laenge_beats)}` : '';
    if (z.art === 'werte' && (z.ziel === 'vel' || z.ziel === 'laenge')) {
      const t = z.ziel === 'vel' ? 'vel' : 'len';
      const zellen = z.zellen.map((c: any) => (c.da ? (z.ziel === 'vel' ? String(Math.round(c.wert)) : zahlText(c.wert, 2)) : '.'));
      return `werte ${t}${z.von !== undefined ? `@${z.von}` : ''}  ${gitterText(z.teiler)}  ${mitTakten(zellen, proTakt, 1, ' ')}`;
    }
    const name = zielName(z.ziel, info);
    const komm = reglerSchluessel(z.ziel) !== null ? `   ; ${z.kein_regler ? 'no such knob' : name}` : '';
    if (z.art === 'werte') {
      const zellen = z.zellen.map((c: any) => (c.da || c.naht ? zahlText(c.wert, 2) : '.'));
      return `werte ${zielText(z.ziel)}  ${gitterText(z.teiler)}  ${mitTakten(zellen, proTakt, 1, ' ')}${je}${komm}`;
    }
    if (z.form) {
      const f = z.form;
      const extra = `${f.stufen !== undefined ? ` stufen ${f.stufen}` : ''}${f.saat !== undefined ? ` saat ${f.saat}` : ''}`;
      return `kurve ${zielText(z.ziel)}  ${f.art} ${zahlText(f.von, 4)} ${zahlText(f.bis, 4)}${extra}${je}${komm}`;
    }
    const formText = (p: any): string => (p.form === 's' ? '@s' : p.form === 'sprung' ? '@sprung' : '');
    const punkte = z.punkte.map((p: any) => `${zahlText(p.beat, 4)}:${zahlText(p.wert, 4)}${formText(p)}`).join(' ');
    return `kurve ${zielText(z.ziel)}  punkte${punkte ? ` ${punkte}` : ''}${je}${komm}`;
  });
  return [kopf, ...zeilen].join('\n');
}

// ---------- parsing (pure: heads and lanes, no ids) ----------
type Token = { t: string; quoted: boolean };
export interface GeparstKopf { name: string; instrument: string | null; beats: number | null; nr: number }
export type NotenToken = { an: false } | { an: true; band: 'o' | 'x' | 'X' };
export type TonToken = { art: 'rest' } | { art: 'bindung' } | { art: 'note'; toene: number[] };
export type GeparstZiel = { text: string; quoted: boolean; von: string | null };
export type GeparstZeile =
  | { art: 'noten'; nr: number; id: string; note: string | null; teiler: number; trigger: NotenToken[] | null; getont: TonToken[] | null }
  | { art: 'werte'; nr: number; ziel: GeparstZiel; teiler: number; zellen: (number | null)[]; je: number | null }
  | { art: 'kurve'; nr: number; ziel: GeparstZiel; form: { art: string; von: number; bis: number; stufen?: number; saat?: number } | null;
      punkte: { beat: number; wert: number; form?: string }[] | null; je: number | null };
export interface GeparsteFolge { kopf: GeparstKopf; zeilen: GeparstZeile[] }

// words of a line: double quotes keep spaces in a word, `;` outside quotes starts a comment
function worte(zeile: string): Token[] {
  const aus: Token[] = [];
  let i = 0;
  const n = zeile.length;
  while (i < n) {
    const c = zeile[i];
    if (c === ';') break;
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"') {
      const e = zeile.indexOf('"', i + 1);
      if (e < 0) { aus.push({ t: zeile.slice(i + 1), quoted: true }); break; }
      aus.push({ t: zeile.slice(i + 1, e), quoted: true });
      i = e + 1;
      continue;
    }
    let j = i;
    while (j < n && !/\s/.test(zeile[j]) && zeile[j] !== ';') j++;
    aus.push({ t: zeile.slice(i, j), quoted: false });
    i = j;
  }
  return aus;
}
function laengeVon(t: string): number | null {
  const m = LAENGE.exec(t);
  if (!m) return null;
  if (m[1] !== undefined) return Number(m[1]) * (m[2] === 'bar' ? 4 : 1);
  const d = Number(m[4]);
  return d > 0 ? (Number(m[3]) / d) * 4 : null;
}
function tonVonName(t: string): number | null {
  const m = NOTEN_NAME.exec(t);
  if (!m) return null;
  const ton = (Number(m[3]) + 2) * 12 + (SEMITON[m[1].toLowerCase()] as number) + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return ton >= 0 && ton <= 127 ? ton : null;
}

// text -> the patterns it names, or a refusal that names the line (and lane and cell). Cell counts and targets are checked against the data by folgeBefehle.
export function leseFolgeText(text: string): GeparsteFolge[] | Urteil {
  if (typeof text !== 'string') return urteil('text: the pattern text expected');
  const folgen: GeparsteFolge[] = [];
  const namen = new Set<string>();
  const zeilen = text.split(/\r?\n/);
  for (let ln = 0; ln < zeilen.length; ln++) {
    const nr = ln + 1;
    const w = worte(zeilen[ln]);
    if (!w.length) continue;
    const wort = w[0].t.toLowerCase();
    const vorLane = (m: string): Urteil => urteil(`line ${nr}: ${m}`);
    if (wort === 'folge') {
      if (w.length < 2) return vorLane('folge needs a pattern name');
      const name = w[1].t;
      if (!name.trim()) return vorLane('the pattern name is empty');
      if (name.length > 80) return vorLane('the pattern name has at most 80 characters');
      if (namen.has(name.toLowerCase())) return vorLane(`pattern ${name} is named twice in this text (names are unique ignoring case)`);
      namen.add(name.toLowerCase());
      const kopf: GeparstKopf = { name, instrument: null, beats: null, nr };
      for (const x of w.slice(2)) {
        if (INSTRUMENT.test(x.t) && kopf.instrument === null) kopf.instrument = x.t;
        else if (laengeVon(x.t) !== null && kopf.beats === null) kopf.beats = laengeVon(x.t) as number;
        else return vorLane(`pattern ${name}: ${x.t} is neither an instrument (bk:<graph>, kit:<kit>, rb338) nor a length (2bar, 3/4bar, 6b)`);
      }
      if (kopf.beats !== null && (!(kopf.beats >= 0.125) || kopf.beats > 64 || Math.abs(kopf.beats * 8 - Math.round(kopf.beats * 8)) > EPS)) {
        return vorLane(`pattern ${name}: the length takes a multiple of 0.125 beat up to 64 beats`);
      }
      folgen.push({ kopf, zeilen: [] });
      continue;
    }
    const f = folgen[folgen.length - 1];
    if (!f) return vorLane(`${w[0].t}: the text starts with a head line, folge <name> <instrument> <length>`);
    if (wort === 'noten') {
      const r = leseNoten(w, nr);
      if ('grund' in r) return r;
      f.zeilen.push(r);
    } else if (wort === 'werte') {
      const r = leseWerte(w, nr);
      if ('grund' in r) return r;
      f.zeilen.push(r);
    } else if (wort === 'kurve') {
      const r = leseKurve(w, nr);
      if ('grund' in r) return r;
      f.zeilen.push(r);
    } else return vorLane(`${w[0].t}: a line starts with folge, noten, werte or kurve`);
  }
  if (!folgen.length) return urteil('the text holds no pattern (folge <name> <instrument> <length>)');
  return folgen;
}

function leseNoten(w: Token[], nr: number): Extract<GeparstZeile, { art: 'noten' }> | Urteil {
  if (w.length < 3) return urteil(`line ${nr}: noten <lane id> [<note>] <grid> <cells> expected`);
  const id = w[1].t;
  let i = 2;
  let note: string | null = null;
  if (!(w[i].t in GITTER)) { note = w[i].t; i++; }
  const g = w[i]?.t;
  if (g === undefined || !(g in GITTER)) {
    return urteil(`line ${nr} (lane ${id}): the grid 1/4, 1/8, 1/16 or 1/32 expected after the lane id${note === null ? '' : ' and note'}`);
  }
  const teiler = GITTER[g] as number;
  const rest = w.slice(i + 1).map((x) => x.t).join(' ').replace(/\|/g, ' ');
  if (note !== null) {
    const zeichen = [...rest.replace(/\s/g, '')];
    const trigger: NotenToken[] = [];
    for (let c = 0; c < zeichen.length; c++) {
      const z = zeichen[c];
      if (z === '.') trigger.push({ an: false });
      else if (z === 'x' || z === 'X' || z === 'o') trigger.push({ an: true, band: z });
      else return urteil(`line ${nr}: lane ${id}, cell ${c}: ${z} is no hit (. rest, x hit, X accent, o ghost)`);
    }
    return { art: 'noten', nr, id, note, teiler, trigger, getont: null };
  }
  const tokens = rest.split(/\s+/).filter(Boolean);
  const getont: TonToken[] = [];
  for (let c = 0; c < tokens.length; c++) {
    const t = tokens[c];
    if (t === '.') getont.push({ art: 'rest' });
    else if (t === '~') {
      const davor = getont[c - 1];
      if (!davor || davor.art === 'rest') return urteil(`line ${nr}: lane ${id}, cell ${c}: ~ lengthens the note before it, and there is none`);
      getont.push({ art: 'bindung' });
    } else {
      const toene: number[] = [];
      for (const teil of t.split('+')) {
        const ton = tonVonName(teil);
        if (ton === null) return urteil(`line ${nr}: lane ${id}, cell ${c}: ${teil} is no note (a name like c1, d#2, ab0 within 0..127, . rest, ~ tie)`);
        toene.push(ton);
      }
      getont.push({ art: 'note', toene });
    }
  }
  return { art: 'noten', nr, id, note: null, teiler, trigger: null, getont };
}

function zielWort(w: Token): GeparstZiel {
  if (!w.quoted) {
    const at = w.t.indexOf('@');
    if (at > 0) return { text: w.t.slice(0, at), quoted: false, von: w.t.slice(at + 1) };
  }
  return { text: w.t, quoted: w.quoted, von: null };
}
function leseJe(w: Token[], ab: number, nr: number, wo: string): { je: number | null; bis: number } | Urteil {
  const i = w.findIndex((x, k) => k >= ab && !x.quoted && x.t.toLowerCase() === 'je');
  if (i < 0) return { je: null, bis: w.length };
  const l = w[i + 1] ? laengeVon(w[i + 1].t) : null;
  if (l === null || w.length > i + 2) return urteil(`line ${nr} (${wo}): je takes one length (2bar, 3/4bar, 6b) at the end of the line`);
  if (!(l >= 0.0625) || l > 64) return urteil(`line ${nr} (${wo}): the length of an envelope takes 0.0625 to 64 beats`);
  return { je: l, bis: i };
}

function leseWerte(w: Token[], nr: number): Extract<GeparstZeile, { art: 'werte' }> | Urteil {
  if (w.length < 3) return urteil(`line ${nr}: werte <target> <grid> <cells> expected`);
  const ziel = zielWort(w[1]);
  let i = 2;
  if (w[i] && !w[i].quoted && w[i].t.startsWith('@')) { ziel.von = w[i].t.slice(1); i++; }
  const g = w[i]?.t;
  if (g === undefined || w[i].quoted || !(g in GITTER)) {
    return urteil(`line ${nr} (lane ${ziel.text}): the grid 1/4, 1/8, 1/16 or 1/32 expected after the target (a knob name with spaces needs double quotes)`);
  }
  const je = leseJe(w, i + 1, nr, `lane ${ziel.text}`);
  if ('grund' in je) return je;
  const tokens = w.slice(i + 1, je.bis).map((x) => x.t).join(' ').replace(/\|/g, ' ').split(/\s+/).filter(Boolean);
  const zellen: (number | null)[] = [];
  for (let c = 0; c < tokens.length; c++) {
    const t = tokens[c];
    if (t === '.') zellen.push(null);
    else if (ZAHL.test(t)) zellen.push(Number(t));
    else return urteil(`line ${nr}: lane ${ziel.text}, cell ${c}: ${t} is neither a number nor . (no value)`);
  }
  return { art: 'werte', nr, ziel, teiler: GITTER[g] as number, zellen, je: je.je };
}

function leseKurve(w: Token[], nr: number): Extract<GeparstZeile, { art: 'kurve' }> | Urteil {
  if (w.length < 3) return urteil(`line ${nr}: kurve <target> <shape> <from> <to> | punkte <beat>:<value> ... expected`);
  const ziel = zielWort(w[1]);
  const wo = `lane ${ziel.text}`;
  const art = w[2].t.toLowerCase();
  const je = leseJe(w, 3, nr, wo);
  if ('grund' in je) return je;
  const rest = w.slice(3, je.bis);
  if (art === 'punkte') {
    const punkte: { beat: number; wert: number; form?: string }[] = [];
    for (let c = 0; c < rest.length; c++) {
      const m = /^(-?(?:\d+\.?\d*|\.\d+)):(-?(?:\d+\.?\d*|\.\d+))(?:@(s|sprung))?$/.exec(rest[c].t);
      if (!m) return urteil(`line ${nr}: ${wo}, point ${c}: ${rest[c].t} is not beat:value (optionally @s or @sprung)`);
      punkte.push({ beat: Number(m[1]), wert: Number(m[2]), ...(m[3] ? { form: m[3] } : {}) });
    }
    return { art: 'kurve', nr, ziel, form: null, punkte, je: je.je };
  }
  if (!FORMEN_TEXT.includes(art)) return urteil(`line ${nr} (${wo}): ${w[2].t} is no shape (${FORMEN_TEXT.join(', ')}) and not punkte`);
  const von = rest[0] && ZAHL.test(rest[0].t) ? Number(rest[0].t) : null, bis = rest[1] && ZAHL.test(rest[1].t) ? Number(rest[1].t) : null;
  if (von === null || bis === null) return urteil(`line ${nr} (${wo}): the shape ${art} needs a from and a to value`);
  const form: { art: string; von: number; bis: number; stufen?: number; saat?: number } = { art, von, bis };
  for (let k = 2; k < rest.length; k += 2) {
    const sch = rest[k].t.toLowerCase(), v = rest[k + 1]?.t;
    if ((sch !== 'stufen' && sch !== 'saat') || v === undefined || !/^\d+$/.test(v)) {
      return urteil(`line ${nr} (${wo}): after the values only stufen <n>, saat <n> and je <length> may follow (${rest[k].t})`);
    }
    form[sch] = Number(v);
  }
  return { art: 'kurve', nr, ziel, form, punkte: null, je: je.je };
}

// ---------- planning ----------
export interface FolgeOptionen { stumm: boolean; geraetInfo(g: Geraet): FolgeInfo }

const wo = (z: string, c?: number): string => `lane ${z}${c === undefined ? '' : `, cell ${c}`}`;
function fehl(text: string, grund = 'argument_ungueltig'): never { throw new SeqFehler(grund, text); }

function fuehre(st: { w: Projekt }, befehle: Befehl[], name: string): void {
  if (!befehle.length) return;
  try { st.w = fuehreListeAus(st.w, befehle).projekt; } catch (e) {
    if (e instanceof BefehlFehler) throw new SeqFehler(e.grund, `pattern ${name}: ${e.message}`);
    throw e;
  }
}

function tonVonWort(t: string, info: FolgeInfo, ort: string): number {
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    if (n > 127) fehl(`${ort}: note ${t} is above 127`);
    return n;
  }
  const k = (info.klaenge ?? []).find((x) => x.name.toLowerCase() === t.toLowerCase());
  if (k) return k.ton;
  const n = tonVonName(t);
  if (n !== null) return n;
  return fehl(`${ort}: ${t} is neither a note number, a note name nor a sound of the instrument`);
}

// the target a text word names: {ziel, von?}
function zielVonText(z: GeparstZiel, info: FolgeInfo, ort: string): { ziel: string; von: string | null } {
  const k = z.text;
  if (!z.quoted) {
    const kl = k.toLowerCase();
    if (kl === 'vel') return { ziel: 'vel', von: z.von };
    if (kl === 'len' || kl === 'laenge') return { ziel: 'laenge', von: z.von };
    if (z.von !== null) fehl(`${ort}: only vel and len name a note lane with @`);
    if (kl === 'transpose') return { ziel: 'transpose', von: null };
    if (kl === 'fader') return { ziel: 'spur_fader', von: null };
    if (kl === 'pan') return { ziel: 'spur_pan', von: null };
    const m = /^k(\d+)$/.exec(kl);
    if (m) {
      const nr = Number(m[1]);
      const alle = info.regler ?? [];
      // on a Baukasten instrument k1..k64 is always a target (the model allows it); the graph may lack the knob, then the readback says so
      if (nr < 1 || nr > 64 || (info.art !== 'bk' && alle.length > 0 && !alle.some((r) => r.nr === nr))) {
        const liste = alle.map((r) => (typeof r.nr === 'number' ? `k${r.nr} ${r.name}` : `${r.nr} (${r.name})`)).join(', ');
        fehl(`${ort}: unknown knob ${k}${alle.length ? ` (this instrument has ${liste})` : ''}`);
      }
      return { ziel: reglerZiel(nr), von: null };
    }
  } else if (z.von !== null) fehl(`${ort}: only vel and len name a note lane with @`);
  const gleich = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
  const treffer = (info.regler ?? []).filter((r) => gleich(r.name, k) || (typeof r.nr === 'string' && gleich(r.nr, k)));
  if (treffer.length === 1) return { ziel: reglerZiel(treffer[0].nr), von: null };
  if (treffer.length > 1) fehl(`${ort}: the knob name ${k} is ambiguous, use k<n>`);
  const namen = (info.regler ?? []).map((r) => (typeof r.nr === 'number' ? `k${r.nr} ${r.name}` : `${r.nr} (${r.name})`));
  const hinweis = namen.length ? ` (this instrument has ${namen.join(', ')}; a name with spaces goes in double quotes)` : ' (this instrument has no knobs)';
  return fehl(`${ort}: unknown knob ${k}${hinweis}`);
}

const gleichPunkte = (a: { beat: number; wert: number; form?: string }[], b: { beat: number; wert: number; form?: string }[]): boolean => {
  const r = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
  const gleichPunkt = (p: any, q: any): boolean => r(p.beat, 4) === r(q.beat, 4) && r(p.wert, 4) === r(q.wert, 4)
    && (p.form ?? 'linear') === (q.form ?? 'linear');
  return a.length === b.length && a.every((p, i) => gleichPunkt(p, b[i]));
};

// Plans one pattern on the working copy; returns the commands it wrote (they also ran on the copy).
function planeFolge(st: { w: Projekt }, spurId: string, f: GeparsteFolge, info: FolgeInfo, laenge: number | null): Befehl[] {
  const name = f.kopf.name;
  const cmds: Befehl[] = [];
  const lauf = (b: Befehl[]): void => { fuehre(st, b, name); cmds.push(...b); };
  const spurW = (): Spur => st.w.spuren.find((s) => s.id === spurId) as Spur;
  const clipW = (): MidiClip => spurW().clips[0] as MidiClip;
  const sicht = (): any[] => folgeSicht(spurW(), clipW(), info).zeilen;
  const kontext = <T,>(fn: () => T, _zeile = ''): T => {
    try { return fn(); } catch (e) {
      if (e instanceof SeqFehler && !e.message.includes(`pattern ${name}`)) throw new SeqFehler(e.grund, `pattern ${name}: ${e.message}`);
      throw e;
    }
  };
  if (laenge !== null) kontext(() => lauf(laengeBefehle(spurW(), clipW(), laenge)), '');

  // lanes: the descriptor after the text. Existing lanes keep their place, the text's lanes are matched by id (note lanes) or target (the others).
  const finale: any[] = abgeleiteteZeilen(spurW(), clipW(), info).map((z: any) => ({ ...z }));
  const explizit = new Set<string>((clipW().seq?.zeilen ?? []).map((z: { id: string }) => z.id));
  const abgeleitet = new Set<string>(finale.filter((z) => !explizit.has(z.id)).map((z) => z.id));
  // a derived lane the text leaves as it is stays derived (it is not written into the descriptor): reading a text back never makes lanes explicit, and
  // the limit of 32 stored lanes does not touch lanes that are only a view of the notes
  for (const z of finale) if (!explizit.has(z.id)) Object.defineProperty(z, 'orig', { value: JSON.stringify(z), enumerable: false });
  const notenText = f.zeilen.filter((z): z is Extract<GeparstZeile, { art: 'noten' }> => z.art === 'noten');
  const tonVon = new Map<string, number | undefined>();
  const gesehenId = new Map<string, number>(), gesehenTon = new Map<string, { id: string; nr: number }>();
  for (const tl of notenText) {
    const ort = `pattern ${name}: ${wo(tl.id)}, line ${tl.nr}`;
    const ton = tl.note !== null ? tonVonWort(tl.note, info, ort) : undefined;
    // a lane id or a pitch in the text twice would silently drop one of the lines: refused with both line numbers
    if (gesehenId.has(tl.id)) fehl(`${ort}: the lane id ${tl.id} is written twice in this pattern (also line ${gesehenId.get(tl.id)})`);
    gesehenId.set(tl.id, tl.nr);
    const tonKey = String(ton);
    const schon = gesehenTon.get(tonKey);
    if (schon) fehl(`${ort}: ${ton === undefined ? 'the pitched notes have' : `note ${ton} has`} the lane ${schon.id} in line ${schon.nr} already`);
    gesehenTon.set(tonKey, { id: tl.id, nr: tl.nr });
    tonVon.set(tl.id, ton);
    let da = finale.find((z) => z.id === tl.id);
    if (!da) {
      // another lane already shows these notes: a derived lane (t36, noten) is only a view, the text's id takes its place; an explicit lane keeps its id
      const gleiche = finale.find((z) => z.art === 'noten' && z.ton === ton && (explizit.has(z.id) || abgeleitet.has(z.id)));
      if (gleiche) {
        if (explizit.has(gleiche.id)) {
          const was = ton === undefined ? 'the pitched notes already have' : `note ${ton} already has`;
          fehl(`${ort}: ${was} the lane ${gleiche.id}; write that id`);
        }
        abgeleitet.delete(gleiche.id);
        gleiche.id = tl.id;
        da = gleiche;
      }
    }
    if (da) {
      if (da.art !== 'noten') fehl(`${ort}: that id belongs to a ${da.art === 'werte' ? 'value' : 'curve'} lane`);
      if (da.ton !== ton) {
        const was = da.ton === undefined ? 'the pitched notes' : `note ${da.ton}`;
        fehl(`${ort}: the lane holds ${was}; the note of a lane does not change, add a lane with another id`);
      }
      da.teiler = tl.teiler;
    } else finale.push({ id: tl.id, art: 'noten', teiler: tl.teiler, ...(ton !== undefined ? { ton } : {}) });
  }
  const notenZeilen = () => finale.filter((z) => z.art === 'noten');
  type Auf = { tl: Extract<GeparstZeile, { art: 'werte' | 'kurve' }>; ziel: string; von: string | null; zl: any };
  const aufgeloest: Auf[] = [];
  const zielGesehen = new Map<string, number>(), velGesehen = new Map<string, number>();
  for (const tl of f.zeilen) {
    if (tl.art === 'noten') continue;
    const ort = `pattern ${name}: ${wo(tl.ziel.text)}, line ${tl.nr}`;
    const { ziel, von } = zielVonText(tl.ziel, info, ort);
    if (ziel !== 'vel' && ziel !== 'laenge') {
      const schon = zielGesehen.get(ziel);
      if (schon !== undefined) fehl(`${ort}: the target ${tl.ziel.text} is written twice in this pattern (also line ${schon})`);
      zielGesehen.set(ziel, tl.nr);
    }
    if (ziel === 'vel' || ziel === 'laenge') {
      if (tl.art === 'kurve') fehl(`${ort}: ${ziel === 'vel' ? 'velocity' : 'length'} is a value lane, not a curve`);
      const ns = notenZeilen();
      const q = von !== null ? ns.find((z) => z.id === von) : ns.length === 1 ? ns[0] : null;
      if (!q) {
        const was = von !== null ? `${von} is no note lane of this pattern`
          : ns.length ? 'the pattern has several note lanes, name one with @<lane id>' : 'the pattern has no note lane to read';
        fehl(`${ort}: ${was}`);
      }
      if (tl.teiler !== q.teiler) {
        fehl(`${ort}: a ${ziel === 'vel' ? 'velocity' : 'length'} lane runs on the grid of its note lane ${q.id} (${gitterText(q.teiler)})`);
      }
      const velKey = `${ziel}@${q.id}`;
      if (velGesehen.has(velKey)) {
        const was = ziel === 'vel' ? 'velocity' : 'length';
        fehl(`${ort}: the ${was} lane of note lane ${q.id} is written twice in this pattern (also line ${velGesehen.get(velKey)})`);
      }
      velGesehen.set(velKey, tl.nr);
      let zl = finale.find((z) => z.art === 'werte' && z.ziel === ziel && (z.von ?? (ns.length === 1 ? ns[0].id : null)) === q.id);
      if (!zl) {
        zl = { id: neueZeilenId({ art: 'werte', ziel }, finale), art: 'werte', teiler: q.teiler, ziel, ...(ns.length > 1 ? { von: q.id } : {}) };
        finale.push(zl);
      }
      aufgeloest.push({ tl, ziel, von: q.id, zl });
      continue;
    }
    if (!zielErlaubt(ziel, spurW(), info)) fehl(`${ort}: this instrument (${geraetText(spurW().geraet)}) has no target ${tl.ziel.text}`, 'huellkurve_ziel');
    const idx = finale.findIndex((z) => z.art !== 'noten' && z.ziel === ziel);
    const neu = tl.art === 'werte' ? { art: 'werte', teiler: tl.teiler, ziel } : { art: 'kurve', ziel };
    let zl: any;
    if (idx >= 0) {
      const alt = finale[idx];
      if (alt.art === neu.art) { zl = alt; if (tl.art === 'werte') zl.teiler = tl.teiler; } else { zl = { id: alt.id, ...neu }; finale[idx] = zl; }
    } else { zl = { id: neueZeilenId(neu, finale), ...neu }; finale.push(zl); }
    aufgeloest.push({ tl, ziel, von: null, zl });
  }
  const zuSchreiben = finale.filter((z) => z.orig === undefined || z.orig !== JSON.stringify(z));
  kontext(() => lauf(zeilenSetzenBefehle(spurW(), clipW(), zuSchreiben, info)), '');

  // note lanes, with the velocity and length lanes merged into their cells
  const P = (): number => musterLaenge(clipW());
  const zahlZellen = (teiler: number): number => Math.max(1, Math.ceil(P() / teiler - EPS));
  const noteIds = new Set<string>([...notenText.map((z) => z.id), ...aufgeloest.filter((a) => a.von !== null).map((a) => a.von as string)]);
  for (const id of noteIds) {
    const zl = finale.find((z) => z.id === id);
    const tl = notenText.find((z) => z.id === id);
    const n = zahlZellen(zl.teiler);
    const velA = aufgeloest.find((a) => a.von === id && a.ziel === 'vel');
    const lenA = aufgeloest.find((a) => a.von === id && a.ziel === 'laenge');
    for (const a of [velA, lenA]) {
      const z = a ? (a.tl as Extract<GeparstZeile, { art: 'werte' }>).zellen : [];
      if (a && z.length !== n) fehl(`pattern ${name}: ${wo(a.tl.ziel.text)}: ${z.length} cells found, ${n} expected (line ${a.tl.nr})`);
    }
    const feld = (a: Auf | undefined, c: number): number | null => (a ? (a.tl as Extract<GeparstZeile, { art: 'werte' }>).zellen[c] ?? null : null);
    const bestand = sicht().find((z) => z.id === id);
    const spezi: any[] = [];
    const velWert = (c: number): number | undefined => {
      const v = feld(velA, c);
      if (v === null) return undefined;
      const r = Math.round(v);
      if (r < 1 || r > 127) fehl(`pattern ${name}: ${wo(velA!.tl.ziel.text, c)}: velocity takes 1..127 (line ${velA!.tl.nr})`);
      return r;
    };
    const lenWert = (c: number): number | undefined => {
      const v = feld(lenA, c);
      if (v === null) return undefined;
      if (!(v > 0)) fehl(`pattern ${name}: ${wo(lenA!.tl.ziel.text, c)}: length takes a number of cells above 0 (line ${lenA!.tl.nr})`);
      return v;
    };
    const ohneNote = (c: number, a: Auf | undefined): never =>
      fehl(`pattern ${name}: ${wo(a!.tl.ziel.text, c)}: the note lane ${id} has no note in this cell (line ${a!.tl.nr})`);
    if (!tl) {
      for (let c = 0; c < n; c++) {
        const vel = velWert(c), laenge = lenWert(c);
        const nur = (vel !== undefined ? { vel } : {}), nurLaenge = (laenge !== undefined ? { laenge } : {});
        spezi.push(vel === undefined && laenge === undefined ? undefined : { nurFelder: true, ...nur, ...nurLaenge });
      }
    } else if (tl.trigger) {
      if (tl.trigger.length !== n) fehl(`pattern ${name}: ${wo(id)}: ${tl.trigger.length} cells found, ${n} expected (line ${tl.nr})`);
      tl.trigger.forEach((tok, c) => {
        const vel = velWert(c), laenge = lenWert(c);
        if (!tok.an) { if (vel !== undefined) ohneNote(c, velA); if (laenge !== undefined) ohneNote(c, lenA); spezi.push({ an: false }); return; }
        const alt = bestand?.zellen?.[c];
        const s: any = { an: true };
        if (vel !== undefined) s.vel = vel;
        else if (!(alt?.an && bandVon(alt.vel) === tok.band)) s.vel = BAND_VEL[tok.band];
        if (laenge !== undefined) s.laenge = laenge;
        spezi.push(s);
      });
    } else {
      const tok = tl.getont as TonToken[];
      if (tok.length !== n) fehl(`pattern ${name}: ${wo(id)}: ${tok.length} cells found, ${n} expected (line ${tl.nr})`);
      for (let c = 0; c < n; c++) {
        const t = tok[c];
        const vel = velWert(c), laenge = lenWert(c);
        if (t.art !== 'note') { if (vel !== undefined) ohneNote(c, velA); if (laenge !== undefined) ohneNote(c, lenA); spezi.push({ an: false }); continue; }
        let k = 0;
        while (c + k + 1 < n && tok[c + k + 1].art === 'bindung') k++;
        const alt = bestand?.zellen?.[c];
        const toeneAlt = JSON.stringify([...new Set(alt?.noten.map((x: any) => x.ton))].sort((a: any, b: any) => a - b));
        const gleicheTone = alt?.an && toeneAlt === JSON.stringify([...new Set(t.toene)].sort((a, b) => a - b));
        const s: any = { an: true, toene: t.toene };
        if (vel !== undefined) s.vel = vel;
        if (laenge !== undefined) s.laenge = laenge;
        else if (!(gleicheTone && bindungen(bestand.zellen, c, zl.teiler) === k)) s.laenge = k + 1;
        spezi.push(s);
      }
    }
    kontext(() => lauf(zeileBefehle(spurW(), clipW(), zl, spezi, info)), id);
  }

  // envelope lanes
  for (const a of aufgeloest) {
    if (a.ziel === 'vel' || a.ziel === 'laenge') continue;
    const hk = (clipW().huellkurven ?? []).find((h: any) => h.ziel === a.ziel);
    const zl = finale.find((z) => z.id === a.zl.id);
    const ort = `pattern ${name}: ${wo(a.tl.ziel.text)}`;
    const eigen = a.tl.je === null ? undefined : a.tl.je;
    const L = a.tl.je ?? (hk && hk.verknuepft === false ? hk.loop_beats : P());
    if (a.tl.art === 'werte') {
      const zellen = a.tl.zellen;
      const erwartet = Math.max(1, Math.ceil(L / zl.teiler - EPS));
      if (zellen.length !== erwartet) {
        fehl(`${ort}: ${zellen.length} cells found, ${erwartet} expected for ${laengeText(L)} on ${gitterText(zl.teiler)} (line ${a.tl.nr})`);
      }
      kontext(() => lauf(zeileBefehle(spurW(), clipW(), zl, zellen, info, { eigen_laenge: eigen })), a.zl.id);
      continue;
    }
    const bestand = sicht().find((z) => z.id === zl.id);
    const eigenAlt = hk && hk.verknuepft === false ? hk.loop_beats : null;
    const gleicheLaenge = eigen === undefined || (eigenAlt !== null && Math.abs(eigen - eigenAlt) < EPS);
    if (a.tl.form) {
      const form: any = { ...a.tl.form };
      const f0 = bestand?.form;
      const dasselbe = f0 && f0.art === form.art && f0.von === form.von && f0.bis === form.bis && f0.stufen === form.stufen && f0.saat === form.saat;
      if (dasselbe && gleicheLaenge) continue;
      const pk = kontext(() => formPunkte(form, L), a.zl.id);
      kontext(() => lauf(kurveBefehle(spurW(), clipW(), zl, pk, info, form, eigen)), a.zl.id);
    } else {
      const pk = a.tl.punkte as { beat: number; wert: number; form?: string }[];
      if (bestand && gleichPunkte(bestand.punkte, pk) && gleicheLaenge) continue;
      kontext(() => lauf(kurveBefehle(spurW(), clipW(), zl, pk, info, undefined, eigen)), a.zl.id);
    }
  }
  // the descriptor commands are whole replacements: only the last one of a clip counts
  const nurSicht = (b: Befehl): boolean => b.befehl === 'clip_aendern' && 'seq' in b && Object.keys(b).length === 3;
  const letzte = new Map<unknown, number>();
  cmds.forEach((b, i) => { if (nurSicht(b)) letzte.set(b.clip_id, i); });
  return cmds.filter((b, i) => !nurSicht(b) || letzte.get(b.clip_id) === i);
}

// The command list that makes the project say what the patterns of the text say; ONE list for all patterns (one undo step). A pattern of the deck
// is matched by name (ignoring case): its lanes are written, lanes the text does not name stay. An unknown name is a new pattern (seq_folge_neu with
// the whole content, muted when opt.stumm). Throws SeqFehler (lane and cell in the message); nothing is returned for a text that does not fit.
export function folgeBefehle(p: Projekt, gruppeId: string, folgen: GeparsteFolge[], opt: FolgeOptionen): Befehl[] {
  const st = { w: p };
  const out: Befehl[] = [];
  const gruppe = (st.w.gruppen ?? []).find((g) => g.id === gruppeId);
  if (!gruppe) fehl(`group ${gruppeId} is no SEQ deck`, 'seq_fehlt');
  for (const f of folgen) {
    const bestehend = seqFolgen(st.w, gruppe!).find((x) => x.spur.name.toLowerCase() === f.kopf.name.toLowerCase());
    const name = f.kopf.name;
    if (bestehend) {
      const spur = bestehend.spur;
      if (!bestehend.editierbar) fehl(`pattern ${spur.name}: it is arranged in PRODUCTION and is not edited here`);
      if (f.kopf.instrument !== null && f.kopf.instrument.toLowerCase() !== geraetText(spur.geraet).toLowerCase()) {
        fehl(`pattern ${spur.name}: it plays ${geraetText(spur.geraet)}, the head says ${f.kopf.instrument}; `
          + 'the instrument of a pattern is changed on the page');
      }
      const info = opt.geraetInfo(spur.geraet as Geraet);
      const clip = bestehend.clip;
      if (!clip) {
        // no clip yet: the clip comes with the first write, so it is one clip_neu with the notes and the descriptor (no envelopes)
        fuehre(st, [{ befehl: 'clip_neu', spur_id: spur.id, art: 'midi', name: spur.name, start_beat: 0, laenge_beats: 64,
          loop_beats: f.kopf.beats ?? 4 }], name);
        planeFolge(st, spur.id, f, info, null);
        const c = (st.w.spuren.find((s) => s.id === spur.id) as Spur).clips[0] as MidiClip;
        if (c.huellkurven?.length) fehl(`pattern ${spur.name}: it has no clip yet; write the notes first, envelopes need the clip`);
        out.push({ befehl: 'clip_neu', spur_id: spur.id, art: 'midi', name: spur.name, start_beat: 0, laenge_beats: 64, loop_beats: c.loop_beats,
          ...(c.noten.length ? { noten: c.noten.map(({ beat, laenge, ton, vel }) => ({ beat, laenge, ton, vel })) } : {}), ...(c.seq ? { seq: c.seq } : {}) });
        continue;
      }
      const laenge = f.kopf.beats !== null && Math.abs(f.kopf.beats - musterLaenge(clip)) > EPS ? f.kopf.beats : null;
      out.push(...planeFolge(st, spur.id, f, info, laenge));
    } else {
      if (f.kopf.instrument === null) fehl(`pattern ${name}: a new pattern needs an instrument in its head (bk:<graph>, kit:<kit> or rb338)`);
      const geraet = geraetVonText(f.kopf.instrument as string);
      const kopf: Befehl = { befehl: 'seq_folge_neu', gruppe_id: gruppeId, name, geraet, ...(f.kopf.beats !== null ? { loop_beats: f.kopf.beats } : {}),
        ...(opt.stumm ? { stumm: true } : {}) };
      fuehre(st, [kopf], name);
      const spur = st.w.spuren[st.w.spuren.length - 1];
      const info = opt.geraetInfo(spur.geraet as Geraet);
      planeFolge(st, spur.id, f, info, null);
      const c = (st.w.spuren.find((s) => s.id === spur.id) as Spur).clips[0] as MidiClip;
      out.push({ ...kopf,
        ...(c.noten.length ? { noten: c.noten.map(({ beat, laenge, ton, vel }) => ({ beat, laenge, ton, vel })) } : {}),
        ...(c.seq ? { seq: c.seq } : {}),
        ...(c.huellkurven?.length ? {
          huellkurven: c.huellkurven.map((h) => ({ ziel: h.ziel, punkte: h.punkte, ...(h.verknuepft === false ? { verknuepft: false } : {}),
            ...(h.loop_beats !== undefined ? { loop_beats: h.loop_beats } : {}) })) } : {}) });
    }
  }
  return out;
}

export { geraetArt };
