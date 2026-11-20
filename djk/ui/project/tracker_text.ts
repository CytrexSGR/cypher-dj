// Tracker task 9: the text form of a section (spec 2026-11-18-tracker-design, section 5, plan decision D9). Pure functions, no file access.
//
//   section 03 "drop"  rows 64  lpb 4  ticks 6  from 00 to 0F
//   row | A bass                                 | B lead
//   00  | C-3 64 ... .. . / E-3 64 ... .. .  K12 80 | ... .. ... .. .  ... ..
//   01  | === .. ... .. .  ... ..                 | G-3 7F -25 50 3  ~~~ ..
//
// Head: section number (0-based, as the page counts), name in double quotes, the rows, lpb and ticks of the view, and for a part `from <r> to <r>`
// (rows in hex, both included). Legend: the letters (and names, ignored when writing) of the tracks, in the order of the blocks. Row line: the row
// in hex, then one block per track. A block holds its note columns separated by ` / `, each `NOTE VOL DLY CHN RPT` (`NOTE INS VOL DLY CHN RPT` on a
// track whose device has a slot role: INS is the slot of the note, two decimal digits 01..32, `..` none, only on a note; a track without the role has
// no INS column, as the screen), then for each effect column
// two spaces and `XXX vv`. NOTE: `C-3` (piano roll naming, MIDI 60 = C-3), `...` empty, `===` note off, `lo` a note below C-0 (it can be
// kept, not typed). VOL and the effect value are hex. DLY: signed decimal, a percentage of a sixteenth (`...` none; on a note off the delay of
// its end). CHN chance 01..99, RPT repeats 2..8 (`..` and `.` none). An effect cell is `...` empty, a code of FX_CODES with its value in two
// hex digits (`VIB 46`, `ARP 37`: an effect command, stored in its column), `K01`..`K64` a knob value (jump point of that knob at the row),
// or `~~~` a drawn curve (shown, never written). The head ends with `hidden: <letter> <n> ...` when a track has notes that the projection does
// not show (more than 8 at one time); writing never touches them. `;` starts a comment; blank lines and spacing do not matter.
//
// Writing applies only the rows and tracks (and note columns) that the text names. Every cell is compared with what the projection showed at the
// START; only a cell that differs is written, with the cell builders of the page (public/tracker/eingabe.js) on a working copy of the project
// (the model's own fuehreListeAus), so that a later cell sees the ids and lengths an earlier one left. The automatic column distribution would
// shift under the first change, so before anything is written the notes the projection shows in a column to the right of their stored one get
// that column as `spalte` (same undo step, only when the text changes something). The effect cells of a row of a track: an effect command
// belongs to its column (fx_setzen), the knob values are one set: a knob that the block does not list is removed from that row. At the end the
// written cells are read back; a cell that does not read as the text says is refused (a stale note off of the read text excepted).
// Writing the text that was read gives an empty command list.
import { fuehreListeAus, BefehlFehler } from './commands.ts';
import { grundText } from '../http/reasons.ts';
import type { Projekt } from './model.ts';
import type { GeraetFxFn } from './playback.ts';
// @ts-ignore plain JS modules shared with the page
import { abschnitte, projiziere, trackerEinstellung, tonName, tonAusName, FX_CODES } from '../public/tracker/grid_model.js';
// @ts-ignore plain JS module shared with the page
import { noteSchreiben, notenAus, wertSetzen, zelleLeeren, knopfWert, fxSetzen } from '../public/tracker/eingabe.js';

export class TrackerTextFehler extends Error {
  readonly zeile: number;     // 1-based line of the text, 0 when no line is meant (reading)
  readonly text: string;
  constructor(zeile: number, text: string) { super(zeile > 0 ? `line ${zeile}: ${text}` : text); this.zeile = zeile; this.text = text; }
}
export type Befehl = Record<string, unknown>;
export interface Ergebnis { befehle: Befehl[]; label: string; ohne_aenderung?: true }

const f = (zeile: number, text: string): TrackerTextFehler => new TrackerTextFehler(zeile, text);
const zwei = (n: number): string => String(n).padStart(2, '0');
const hex = (n: number): string => n.toString(16).toUpperCase().padStart(2, '0');
const bereinigt = (s: string): string => String(s ?? '').replace(/"/g, "'").replace(/;/g, ',').replace(/\|/g, '/');

// ---------- cell state (what the projection shows, and what a text cell says) ----------
type Zustand = { note: string; ins: number | null; vol: number | null; dly: number | null; chn: number | null; rpt: number | null };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const zustandVon = (z: any): Zustand => {
  const n = z?.note;
  if (n) {
    return { note: n.ton < 24 ? 'lo' : tonName(n.ton), ins: n.platz ?? null, vol: n.vel, dly: n.versatz || null, chn: n.chance ?? null, rpt: n.wdh ?? null };
  }
  if (z?.aus) return { note: '===', ins: null, vol: null, dly: z.aus.dly || null, chn: null, rpt: null };
  return { note: '...', ins: null, vol: null, dly: null, chn: null, rpt: null };
};
const dlyText = (v: number | null): string => (v === null ? '...' : `${v < 0 ? '-' : '+'}${String(Math.abs(v)).padStart(2, '0')}`);
const zelleText = (s: Zustand, ins = false): string => [s.note.padEnd(3), ...(ins ? [s.ins === null ? '..' : zwei(s.ins)] : []),
  s.vol === null ? '..' : hex(s.vol), dlyText(s.dly),
  s.chn === null ? '..' : zwei(s.chn), s.rpt === null ? '.' : String(s.rpt)].join(' ');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fxZelle = (x: any): string => (!x ? '... ..' : x.kurve ? '~~~ ..'
  : `${x.code !== undefined ? x.code : `K${zwei(x.knopf)}`} ${hex(x.wert)}`);

// ---------- reading ----------
export interface LiesOptionen { abschnitt_id: string; von?: number; bis?: number; spuren?: string[] }

// the roles of a device as the page gets them (projiziere's `rollen`): only a Baukasten graph has any, from the device register
const rollenVon = (gf?: GeraetFxFn) => (geraet: { art?: string; name?: string; graph?: string } | undefined) =>
  (gf && geraet?.art === 'intern' && geraet.name === 'bk' && geraet.graph !== undefined ? gf(geraet.graph).rollen : null);
// the letters of the tracks that show the INS column
function insBuchstaben(p: Projekt, gf?: GeraetFxFn): Set<string> {
  try {
    const spuren: { ins?: boolean; buchstabe: string }[] = projiziere(p, { rollen: rollenVon(gf) }).spuren;
    return new Set(spuren.filter((s) => s.ins).map((s) => s.buchstabe));
  }
  catch { return new Set(); }
}

export function liesBereich(p: Projekt, o: LiesOptionen, gf?: GeraetFxFn): string {
  const ab = abschnitte(p).find((a: { id: string }) => a.id === o.abschnitt_id);
  if (!ab) throw f(0, `unknown section ${o.abschnitt_id}`);
  const r = projiziere(p, { abschnitt_id: ab.id, rollen: rollenVon(gf) });
  const von = o.von ?? 0, bis = o.bis ?? r.zeilen - 1;
  if (!Number.isInteger(von) || !Number.isInteger(bis) || von < 0 || bis < von || bis >= r.zeilen) {
    throw f(0, `rows ${von}..${bis} do not fit the section (rows 0..${r.zeilen - 1}, von <= bis)`);
  }
  const alle = r.spuren.filter((s: { art: string }) => s.art === 'instrument');
  for (const b of o.spuren ?? []) {
    if (!alle.some((s: { buchstabe: string }) => s.buchstabe === b)) throw f(0, `track ${b} does not exist or is an audio track`);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const spuren: any[] = alle.filter((s: any) => o.spuren === undefined || o.spuren.includes(s.buchstabe));
  const teil = von !== 0 || bis !== r.zeilen - 1;
  const bereich = teil ? `  from ${hex(von)} to ${hex(bis)}` : '';
  const verdeckt = spuren.filter((s) => s.verdeckt > 0).map((s) => `${s.buchstabe} ${s.verdeckt}`).join(' ');
  const kopf = `section ${zwei(ab.nr)} "${bereinigt(ab.name)}"  rows ${r.zeilen}  lpb ${r.lpb}  ticks ${r.ticks}${bereich}`
    + (verdeckt ? `  hidden: ${verdeckt}` : '');
  const breite = spuren.map((s) => s.notenspalten.length * (s.ins ? 18 : 15) + (s.notenspalten.length - 1) * 3 + s.fxspalten.length * 8);
  const legende = `row | ${spuren.map((s, i) => `${s.buchstabe} ${bereinigt(s.name)}`.padEnd(i === spuren.length - 1 ? 0 : breite[i])).join(' | ')}`.trimEnd();
  const zeilen = [kopf, legende];
  for (let z = von; z <= bis; z++) {
    const bloecke = spuren.map((s) => {
      const sp = s.notenspalten.map((col: unknown[]) => zelleText(zustandVon(col[z]), s.ins === true)).join(' / ');
      return sp + s.fxspalten.map((col: unknown[]) => `  ${fxZelle(col[z])}`).join('');
    });
    zeilen.push(`${hex(z).padEnd(4)}| ${bloecke.join(' | ')}`.trimEnd());
  }
  return `${zeilen.join('\n')}\n`;
}

// ---------- parsing ----------
type Wunsch = Omit<Zustand, 'ins'> & { ton: number | null; ins?: number | null };   // ins undefined: the track has no INS column
type FxWunsch = { art: 'leer' | 'kurve' | 'knopf' | 'code'; knopf: number; wert: number; code?: string };
type Block = { spalten: Wunsch[]; fx: FxWunsch[] };
interface Kopf { zeile: number; nr: number; name?: string; rows: number; lpb: number; ticks: number; von?: number; bis?: number }
interface Geparst { kopf: Kopf; legende: { buchstabe: string; zeile: number }[]; zeilen: { zeile: number; nr: number; bloecke: Block[] }[] }

const KOPF = new RegExp('^section\\s+(\\d+)(?:\\s+"([^"]*)")?\\s+rows\\s+(\\d+)\\s+lpb\\s+(\\d+)\\s+ticks\\s+(\\d+)'
  + '(?:\\s+from\\s+([0-9A-Fa-f]+)\\s+to\\s+([0-9A-Fa-f]+))?(?:\\s+hidden:(?:\\s+[A-Z]{1,2}\\s+\\d+)*)?$');
const MAX_SPALTEN = 8;

function wunsch(t: string[], zeile: number, ins: boolean): Wunsch {
  const [n, i, v, d, c, r] = ins ? t : [t[0], undefined, ...t.slice(1)];
  let ton: number | null = null, note: string;
  if (n === '...' || n === '===' || n === 'lo') note = n;
  else { ton = tonAusName(n); if (ton === null) throw f(zeile, `note ${n} expected (C-0 to G-8, ... empty, === note off, lo)`); note = tonName(ton); }
  if (i !== undefined && i !== '..' && !(/^\d{1,2}$/.test(i) && Number(i) >= 1 && Number(i) <= 32)) throw f(zeile, `INS ${i}: a slot 01..32 or .. expected`);
  if (v !== '..' && !/^[0-9A-Fa-f]{2}$/.test(v)) throw f(zeile, `VOL ${v}: two hex digits or .. expected`);
  if (d !== '...' && !/^[+-]?\d{1,3}$/.test(d)) throw f(zeile, `DLY ${d}: a signed number or ... expected`);
  if (c !== '..' && !/^\d{1,2}$/.test(c)) throw f(zeile, `CHN ${c}: a number of two digits or .. expected`);
  if (r !== '.' && !/^\d$/.test(r)) throw f(zeile, `RPT ${r}: one digit or . expected`);
  const insTeil = i === undefined ? {} : { ins: i === '..' ? null : Number(i) };
  const w: Wunsch = { note, ton, ...insTeil, vol: v === '..' ? null : parseInt(v, 16), dly: d === '...' || Number(d) === 0 ? null : Number(d),
    chn: c === '..' ? null : Number(c), rpt: r === '.' ? null : Number(r) };
  if (note !== 'lo' && ton === null && w.ins != null) throw f(zeile, 'INS needs a note');
  if (note === '...' && (w.vol !== null || w.dly !== null || w.chn !== null || w.rpt !== null)) throw f(zeile, 'VOL, DLY, CHN and RPT need a note');
  if (note === '===' && (w.vol !== null || w.chn !== null || w.rpt !== null)) throw f(zeile, 'a note off takes only a delay (DLY)');
  return w;
}
function fxWunsch(code: string, wert: string, zeile: number): FxWunsch {
  if (code === '...' && wert === '..') return { art: 'leer', knopf: 0, wert: 0 };
  if (code === '~~~' && wert === '..') return { art: 'kurve', knopf: 0, wert: 0 };
  const big = code.toUpperCase();
  const m = /^K(\d\d)$/.exec(big);
  if (!m && !FX_CODES.includes(big)) throw f(zeile, `effect ${code}: ${FX_CODES.join(' ')}, K01 to K64 (knob value), ... or ~~~ expected`);
  if (m && (Number(m[1]) < 1 || Number(m[1]) > 64)) throw f(zeile, `effect ${code}: knob K01 to K64 expected`);
  if (!/^[0-9A-Fa-f]{2}$/.test(wert)) throw f(zeile, `effect value ${wert}: two hex digits expected`);
  if (!m) return { art: 'code', knopf: 0, wert: parseInt(wert, 16), code: big };
  return { art: 'knopf', knopf: Number(m[1]), wert: parseInt(wert, 16) };
}
function blockParse(text: string, zeile: number, ins: boolean): Block {
  const t = text.trim().split(/\s+/).filter((x) => x !== '');
  if (t.length === 0) throw f(zeile, 'an empty track block');
  const spalten: Wunsch[] = [];
  let i = 0;
  for (;;) {
    const breit = ins ? 6 : 5, g = t.slice(i, i + breit);
    if (g.length < breit || g.includes('/')) throw f(zeile, `a note column is NOTE${ins ? ' INS' : ''} VOL DLY CHN RPT`);
    spalten.push(wunsch(g, zeile, ins));
    i += breit;
    if (t[i] === '/') { i++; continue; }
    break;
  }
  if (spalten.length > MAX_SPALTEN) throw f(zeile, `at most ${MAX_SPALTEN} note columns`);
  const rest = t.slice(i);
  if (rest.length % 2 !== 0 || rest.includes('/')) throw f(zeile, 'an effect column is XXX vv (after the note columns, no / between them)');
  const fx: FxWunsch[] = [];
  for (let k = 0; k < rest.length; k += 2) fx.push(fxWunsch(rest[k], rest[k + 1], zeile));
  return { spalten, fx };
}

function parse(text: string, hatIns: Set<string>): Geparst {
  let kopf: Kopf | null = null;
  let legende: Geparst['legende'] | null = null;
  const zeilen: Geparst['zeilen'] = [];
  const gesehen = new Set<number>();
  text.split(/\r?\n/).forEach((roh, i) => {
    const nr = i + 1, z = roh.replace(/;.*$/, '').trim();
    if (z === '') return;
    if (kopf === null) {
      const m = KOPF.exec(z);
      if (!m) throw f(nr, 'the head line `section <nr> "<name>"  rows <n>  lpb <n>  ticks <n>` expected');
      kopf = { zeile: nr, nr: Number(m[1]), ...(m[2] !== undefined ? { name: m[2] } : {}), rows: Number(m[3]), lpb: Number(m[4]), ticks: Number(m[5]),
        ...(m[6] !== undefined ? { von: parseInt(m[6], 16), bis: parseInt(m[7], 16) } : {}) };
      return;
    }
    if (legende === null) {
      if (!/^row\s*(\|.*)?$/.test(z)) throw f(nr, 'the legend line `row | <letter> <name> | ...` expected');
      legende = [];
      for (const zelle of z.split('|').slice(1)) {
        const m = /^([A-Z]{1,2})(?:\s.*)?$/.exec(zelle.trim());
        if (!m) throw f(nr, `legend entry "${zelle.trim()}": a track letter and its name expected`);
        if (legende.some((l) => l.buchstabe === m[1])) throw f(nr, `track ${m[1]} is listed twice`);
        legende.push({ buchstabe: m[1], zeile: nr });
      }
      return;
    }
    const m = /^([0-9A-Fa-f]+)\s*\|(.*)$/.exec(z);
    if (!m) throw f(nr, 'a row line `<row hex> | <block> | <block>` expected');
    const reihe = parseInt(m[1], 16);
    const teile = m[2].split('|');
    if (legende.length === 0 ? m[2].trim() !== '' : teile.length !== legende.length) {
      throw f(nr, `${legende.length} track block(s) expected (as the legend lists), found ${teile.length}`);
    }
    if (gesehen.has(reihe)) throw f(nr, `row ${hex(reihe)} is given twice`);
    gesehen.add(reihe);
    zeilen.push({ zeile: nr, nr: reihe, bloecke: legende.length === 0 ? [] : teile.map((b, bi) => blockParse(b, nr, hatIns.has(legende![bi].buchstabe))) });
  });
  if (kopf === null) throw f(1, 'the text is empty: a head line `section <nr> ...` expected');
  return { kopf, legende: legende ?? [], zeilen };
}

// ---------- writing ----------
export function schreibeBereich(p: Projekt, text: string, gf?: GeraetFxFn): Ergebnis {
  const rollen = rollenVon(gf);
  const g = parse(text, insBuchstaben(p, gf));
  const k = g.kopf;
  const ab = abschnitte(p)[k.nr];
  if (!ab) throw f(k.zeile, `section ${zwei(k.nr)} does not exist in the project`);
  if (k.name !== undefined && k.name !== bereinigt(ab.name)) {
    throw f(k.zeile, `section ${zwei(k.nr)} is named "${bereinigt(ab.name)}" now, not "${k.name}": read it again`);
  }
  const e = trackerEinstellung(p);
  if (k.lpb !== e.lpb) throw f(k.zeile, `the text has lpb ${k.lpb}, the project has lpb ${e.lpb}: read it again`);
  let r = projiziere(p, { abschnitt_id: ab.id, lpb: e.lpb, rollen });
  if (k.rows !== r.zeilen) throw f(k.zeile, `the text has rows ${k.rows}, the section has rows ${r.zeilen}: read it again`);
  const spuren = g.legende.map((l) => {
    const s = r.spuren.find((x: { buchstabe: string }) => x.buchstabe === l.buchstabe);
    if (!s) throw f(l.zeile, `track ${l.buchstabe} does not exist in the project`);
    if (s.art !== 'instrument') throw f(l.zeile, `track ${l.buchstabe} is an audio track: it takes no notes or knob values`);
    return s.spur_id as string;
  });
  const reihen = [...g.zeilen].sort((a, b) => a.nr - b.nr);
  for (const z of reihen) {
    if (z.nr >= r.zeilen) throw f(z.zeile, `row ${hex(z.nr)} lies outside the section (rows 00 to ${hex(r.zeilen - 1)})`);
    if (k.von !== undefined && k.bis !== undefined && (z.nr < k.von || z.nr > k.bis)) {
      throw f(z.zeile, `row ${hex(z.nr)} lies outside from ${hex(k.von)} to ${hex(k.bis)}`);
    }
  }

  // pin: a note the projection shows to the right of its stored column keeps that column, so that the cells below do not shift it
  const pins: Befehl[] = [];
  for (const spurId of new Set(spuren)) {
    const sp = r.spuren.find((x: { spur_id: string }) => x.spur_id === spurId);
    const clips = new Map((p.spuren.find((x) => x.id === spurId)?.clips ?? []).map((c) => [c.id, c]));
    const je = new Map<string, { id: string; spalte: number }[]>();
    sp.notenspalten.forEach((col: unknown[], c: number) => col.forEach((z) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const n = (z as any)?.note;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const clip: any = n ? clips.get(n.clip_id) : undefined;
      if (!n || c < 1 || !clip || (clip.loop_beats != null && n.beat_abs - clip.start_beat >= clip.loop_beats - 1e-9)) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (clip.noten.find((x: any) => x.id === n.id)?.spalte === c + 1) return;
      if (!je.has(clip.id)) je.set(clip.id, []);
      je.get(clip.id)!.push({ id: n.id, spalte: c + 1 });
    }));
    for (const [clip_id, noten] of je) pins.push({ befehl: 'noten_aendern', clip_id, noten });
  }
  const anfang = r;
  const hatAnfang = (spurId: string, c: number, zeile: number): Zustand => zustandVon(
    anfang.spuren.find((s: { spur_id: string }) => s.spur_id === spurId).notenspalten[c]?.[zeile] ?? null);
  let draft = p;
  let gepinnt = pins.length === 0;
  // the pins go in before the first builder runs, never for a text that changes nothing
  const d = (): Projekt => { if (!gepinnt) { draft = fuehreListeAus(draft, pins).projekt; gepinnt = true; } return draft; };
  let schmutzig = true;
  const befehle: Befehl[] = [];
  const frisch = (): typeof r => { if (schmutzig) { r = projiziere(draft, { abschnitt_id: ab.id, lpb: e.lpb, rollen }); schmutzig = false; } return r; };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wende = (res: any, zeile: number): void => {
    if (!res) return;
    if (res.fehler) throw f(zeile, String(res.fehler));
    try { draft = fuehreListeAus(draft, res.befehle).projekt; } catch (x) {
      if (x instanceof BefehlFehler) throw f(zeile, `${grundText(x.grund)}${x.detail ? ` (${x.detail})` : ''}`);
      throw x;
    }
    befehle.push(...res.befehle);
    schmutzig = true;
  };
  const sicht = (spurId: string) => frisch().spuren.find((s: { spur_id: string }) => s.spur_id === spurId);

  for (const z of reihen) {
    z.bloecke.forEach((bl, bi) => {
      const spurId = spuren[bi];
      const basis = { abschnitt_id: ab.id, spur_id: spurId, zeile: z.nr, lpb: e.lpb };
      bl.spalten.forEach((w, c) => {
        const ort = { ...basis, spalte: c, unterspalte: 'note' };
        const jetzt = (): Zustand => zustandVon(sicht(spurId).notenspalten[c]?.[z.nr] ?? null);
        let hat = hatAnfang(spurId, c, z.nr);
        if (w.note !== hat.note) {
          if (w.note === '...') wende(zelleLeeren(d(), ort), z.zeile);
          else if (w.note === '===') {
            const res = notenAus(d(), ort);
            if (!res) throw f(z.zeile, 'note off where no note sounds');
            wende(res, z.zeile);
          } else if (w.ton === null) throw f(z.zeile, 'a note below C-0 cannot be typed (lo stays as it is)');
          else wende(noteSchreiben(d(), ort, w.ton, w.vol !== null ? { vel: w.vol } : {}), z.zeile);
          hat = jetzt();
        }
        for (const feld of ['ins', 'vol', 'chn', 'rpt', 'dly'] as const) {
          if (hat.note === '...') break;
          if (feld !== 'dly' && hat.note === '===') continue;
          const soll = w[feld];
          if (soll === undefined || (feld === 'vol' && soll === null) || soll === hat[feld]) continue;
          wende(wertSetzen(d(), { ...ort, unterspalte: feld }, feld, soll), z.zeile);
          hat = jetzt();
        }
      });
      if (bl.fx.length === 0) return;
      // effect commands: a column that holds one the text does not name there is cleared, a differing one is set
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fxJetzt = (i: number): any => (sicht(spurId).fxspalten as any[][])[i]?.[z.nr];
      bl.fx.forEach((x, i) => { if (x.art !== 'code' && fxJetzt(i)?.code !== undefined) wende(fxSetzen(d(), { ...basis, fxspalte: i }, null, 0), z.zeile); });
      bl.fx.forEach((x, i) => {
        if (x.art !== 'code') return;
        const j = fxJetzt(i);
        if (j?.code !== x.code || j?.wert !== x.wert) wende(fxSetzen(d(), { ...basis, fxspalte: i }, x.code as string, x.wert), z.zeile);
      });
      const soll = new Map<number, number>();
      for (const x of bl.fx) {
        if (x.art !== 'knopf') continue;
        if (soll.has(x.knopf)) throw f(z.zeile, `knob K${zwei(x.knopf)} is given twice in this row`);
        soll.set(x.knopf, x.wert);
      }
      const ist = new Map<number, number>();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const col of sicht(spurId).fxspalten as any[][]) { const x = col[z.nr]; if (x && !x.kurve && x.code === undefined) ist.set(x.knopf, x.wert); }
      const ortFx = { ...basis, spalte: 0, unterspalte: 'fx' };
      for (const [knopf, wert] of soll) if (ist.get(knopf) !== wert) wende(knopfWert(d(), ortFx, knopf, wert), z.zeile);
      for (const knopf of ist.keys()) if (!soll.has(knopf)) wende(knopfWert(d(), ortFx, knopf, null), z.zeile);
    });
  }
  const label = `Text: section ${zwei(k.nr)}${ab.name ? ` "${bereinigt(ab.name)}"` : ''}`;
  if (befehle.length === 0) return { befehle, label, ohne_aenderung: true as const };
  // read back: every written cell must read as the text says (a note off over a note that is gone, a column that shifted)
  const fertig = projiziere(draft, { abschnitt_id: ab.id, lpb: e.lpb, rollen });
  for (const z of reihen) {
    z.bloecke.forEach((bl, bi) => bl.spalten.forEach((w, c) => {
      const sp = fertig.spuren.find((s: { spur_id: string }) => s.spur_id === spuren[bi]);
      const got = zustandVon(sp.notenspalten[c]?.[z.nr] ?? null);
      const insOk = w.ins === undefined || got.ins === w.ins || w.note === '===';
      const gleich = got.note === w.note && got.dly === w.dly && insOk && (w.note === '...' || w.note === '===' || (got.chn === w.chn && got.rpt === w.rpt
        && (w.vol === null || got.vol === w.vol)));
      // a note off that the read text carried stays in the text when its note was cut or removed by another cell: stale, not an error
      if (gleich || (w.note === '===' && hatAnfang(spuren[bi], c, z.nr).note === '===')) return;
      throw f(z.zeile, w.note === '===' ? 'note off where no note sounds'
        : `this cell cannot be written as given, it would read ${zelleText(got, w.ins !== undefined)}`);
    }));
  }
  return { befehle: [...pins, ...befehle], label };
}
