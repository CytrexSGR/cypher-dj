// TRACKER (task 1): the pure projection of a project into tracker rows, columns and cell texts. No DOM, no I/O, never mutates its input.
// Browser and node (the text form of a later task imports it). Rows: row r of a section starts at von_beat + r / lpb. A note lies in
// the row of its written start (n.beat of its copy; a DLY (versatz) moves the sound inside its row and past it, never the row of the
// note), its end (sounding time, versatz included) shows as `===` in the row that contains it. Knob envelopes of jump points on row
// lines show as effect entries, every other envelope as a curve.

export const LPB_WERTE = [2, 3, 4, 6, 8, 12, 16];
export const LPB_VORGABE = 4;
export const TICKS_VORGABE = 6;
export const ABSCHNITT_VORGABE_BEATS = 16;
const EPS = 1e-9;
const MAX_NOTENSPALTEN = 8;
const NAMEN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const KNOPF_ZIEL = /^geraet\.k([1-9]\d?)$/;
// the effect commands of the plan (task 12 stores them in MidiClip.fx; the unrolling is project/fx_ausrollen.ts)
export const FX_CODES = Object.freeze(['ARP', 'SLU', 'SLD', 'GLD', 'VIB', 'TRM', 'VSL', 'LVL', 'RTG', 'PAN', 'OFS', 'REV']);
export const FX_MAX_SPALTE = 3;

export function trackerEinstellung(p) {
  const t = p?.tracker;
  return {
    lpb: LPB_WERTE.includes(t?.lpb) ? t.lpb : LPB_VORGABE,
    ticks: Number.isInteger(t?.ticks) && t.ticks >= 1 && t.ticks <= 64 ? t.ticks : TICKS_VORGABE,
  };
}

export function abschnitte(p) {
  const liste = p?.tracker?.abschnitte;
  const aus = [];
  if (Array.isArray(liste) && liste.length > 0) {
    let von = 0;
    liste.forEach((a, nr) => { aus.push({ id: a.id, nr, name: a.name ?? '', von_beat: von, laenge_beats: a.laenge_beats }); von += a.laenge_beats; });
    return aus;
  }
  let ende = 0;
  for (const s of p?.spuren ?? []) for (const c of s.clips ?? []) ende = Math.max(ende, c.start_beat + c.laenge_beats);
  const n = Math.max(1, Math.ceil(ende / ABSCHNITT_VORGABE_BEATS - EPS));
  for (let nr = 0; nr < n; nr++) aus.push({ id: `a${nr + 1}`, nr, name: '', von_beat: nr * ABSCHNITT_VORGABE_BEATS, laenge_beats: ABSCHNITT_VORGABE_BEATS });
  return aus;
}

// the sounding start of a note in clip beats: versatz is a percentage of a sixteenth
export const klingStart = (n) => n.beat + (n.versatz ?? 0) / 100 * 0.25;

// the row that contains a beat (relative to the section start); schief = not on a row line
export function zeileVon(beatImAbschnitt, lpb) {
  const x = beatImAbschnitt * lpb, r = Math.round(x);
  if (Math.abs(beatImAbschnitt - r / lpb) <= EPS) return { zeile: r, schief: false };
  return { zeile: Math.floor(x), schief: true };
}

// D1: the naming of the piano roll (MIDI 60 = C-3); MIDI 24..127 = C-0..G-8, below 24 `lo `
export function tonName(ton) {
  if (ton < 24) return 'lo ';
  if (ton > 127) return 'hi ';
  const n = NAMEN[ton % 12], oct = Math.floor(ton / 12) - 2;
  return n.length === 1 ? `${n}-${oct}` : `${n}${oct}`;
}
// the real name of any pitch in the piano roll's writing (status line of a note below the grid range)
const echterName = (ton) => `${NAMEN[ton % 12]}${Math.floor(ton / 12) - 2}`;
export function tonAusName(text) {
  const m = /^([A-Ga-g])([#-]?)(\d)$/.exec(String(text).trim());
  if (!m) return null;
  const basis = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase()] + (m[2] === '#' ? 1 : 0);
  const ton = basis + 12 * (Number(m[3]) + 2);
  return ton >= 24 && ton <= 127 ? ton : null;
}

// D6: knob value byte 00..FF <-> envelope offset -1..+1 (80 = 0)
export const byteZuWert = (vv) => (vv <= 128 ? (vv - 128) / 128 : (vv - 128) / 127);
export const wertZuByte = (w) => Math.min(255, Math.max(0, Math.round(w < 0 ? w * 128 + 128 : w * 127 + 128)));

const buchstabe = (i) => (i < 26 ? String.fromCharCode(65 + i) : `A${String.fromCharCode(65 + (i - 26) % 26)}`);
const pad = (n, w, z = '0') => String(n).padStart(w, z);

function geraetText(s) {
  const g = s.geraet;
  if (s.art !== 'instrument' || !g) return '';
  if (g.art === 'rack') return 'Rack';
  if (g.art === 'intern') return g.name === 'bk' ? g.graph : g.name === 'kit' ? `KIT · ${g.kit}` : 'RB-338';
  return g.plugin ? g.plugin.name : 'Surge';
}

// every sounding copy of a note of a MIDI clip (the loop rule of fuerAusgerollteNoten): f(basisBeat, kopieEnde, kopie)
function fuerKopien(c, f) {
  const ende = c.start_beat + c.laenge_beats, loop = c.loop_beats ?? null;
  if (loop === null) { f(c.start_beat, ende, 0); return; }
  for (let k = 0; k * loop < c.laenge_beats - EPS; k++) f(c.start_beat + k * loop, Math.min(c.start_beat + k * loop + loop, ende), k);
}

function notenInAbschnitt(spur, ab, lpb, zeilen) {
  const starts = [];
  for (const c of spur.clips ?? []) {
    if (c.art !== 'midi') continue;
    const loop = c.loop_beats ?? null;
    fuerKopien(c, (basis, kopieEnde, k) => {
      for (const n of c.noten ?? []) {
        if (loop !== null && !(n.beat < loop)) continue;                 // from loop_beats on a note is silent
        let klang = basis + klingStart(n);
        if (k === 0 && klang < c.start_beat) klang = c.start_beat;
        if (!(klang < kopieEnde)) continue;
        const schrift = basis + n.beat;                                   // the written start decides the row
        const rel = schrift - ab.von_beat;
        if (rel < -EPS) continue;
        const { zeile, schief } = zeileVon(rel, lpb);
        if (zeile >= zeilen) continue;
        const laenge = Math.min(n.laenge, kopieEnde - klang);
        starts.push({ n, clip: c, zeile: Math.max(0, zeile), schief, klang, laenge, ende: klang + laenge, kopieEnde, schrift });
      }
    });
  }
  starts.sort((a, b) => a.schrift - b.schrift || a.n.ton - b.n.ton || (a.n.id < b.n.id ? -1 : a.n.id > b.n.id ? 1 : 0));
  return starts;
}

function notenSpalten(spur, ab, lpb, zeilen) {
  const starts = notenInAbschnitt(spur, ab, lpb, zeilen);
  const spalten = [[]];
  const frei = (sp, z) => spalten[sp]?.[z] == null || spalten[sp][z].note === undefined;
  // a column never shows two sounding notes: a note whose sounding time overlaps a note already placed in the column moves to the next free one
  // (only the notes already placed in the column are compared: the lists per column keep this from being quadratic over the whole track)
  const imSpalte = [];
  const klingt = (sp, s) => (imSpalte[sp] ?? []).some((t) => t.klang < s.ende - EPS && s.klang < t.ende - EPS);
  let verdeckt = 0;
  for (const s of starts) {
    let sp = Math.min(MAX_NOTENSPALTEN, Math.max(1, s.n.spalte ?? 1)) - 1;
    while (sp < MAX_NOTENSPALTEN && (!frei(sp, s.zeile) || klingt(sp, s))) sp++;
    if (sp >= MAX_NOTENSPALTEN) { verdeckt++; continue; }                // all 8 columns are taken at that time: the note is not shown
    while (spalten.length <= sp) spalten.push([]);
    const zelle = spalten[sp][s.zeile] ?? (spalten[sp][s.zeile] = {});
    zelle.note = { id: s.n.id, clip_id: s.clip.id, ton: s.n.ton, vel: s.n.vel,
      ...(s.n.versatz !== undefined ? { versatz: s.n.versatz } : {}), ...(s.n.chance !== undefined ? { chance: s.n.chance } : {}),
      ...(s.n.wdh !== undefined ? { wdh: s.n.wdh } : {}), ...(s.n.platz !== undefined ? { platz: s.n.platz } : {}),
      beat_abs: s.schrift, laenge: s.laenge };
    if (s.schief) zelle.schief = true;
    s.spalte = sp;
    (imSpalte[sp] ??= []).push(s);
  }
  // ends
  const platziert = starts.filter((s) => s.spalte !== undefined);
  for (const s of platziert) {
    if (s.ende >= s.kopieEnde - EPS) continue;                            // the clip (or loop copy) end ends it
    const folgt = imSpalte[s.spalte].some((t) => t !== s && Math.abs(t.klang - s.ende) <= EPS);
    if (folgt) continue;                                                  // the next note of the column starts exactly there
    const rel = s.ende - ab.von_beat;
    if (rel >= zeilen / lpb - EPS) continue;                              // the end lies behind the section
    const { zeile } = zeileVon(rel, lpb);
    if (zeile === s.zeile) continue;                                      // D4: ends inside its own start row
    const dly = Math.round((rel - zeile / lpb) / 0.25 * 100);
    const zelle = spalten[s.spalte][zeile] ?? (spalten[s.spalte][zeile] = {});
    if (zelle.aus === undefined) zelle.aus = { note_id: s.n.id, clip_id: s.clip.id, dly };
    if (dly !== 0 && zelle.note === undefined) zelle.schief = true;      // D4: tinted when off the row line (a note start in the cell is not tinted by it)
  }
  return { spalten: spalten.map((sp) => Array.from({ length: zeilen }, (_, z) => sp[z] ?? null)), verdeckt };
}

// effect columns: curves first (a column of their own), then the jump points left to right per row
function fxSpalten(spur, ab, lpb, zeilen) {
  const spalten = [];
  const spalte = (i) => { while (spalten.length <= i) spalten.push(Array.from({ length: zeilen }, () => null)); return spalten[i]; };
  const endeAb = ab.von_beat + ab.laenge_beats;
  const reihen = [];                                                       // { knopf, von, bis } curves, { knopf, zeile, wert } jumps
  const sprunge = [];
  for (const c of spur.clips ?? []) {
    if (c.art !== 'midi') continue;
    const clipEnde = c.start_beat + c.laenge_beats;
    for (const hk of c.huellkurven ?? []) {
      const m = KNOPF_ZIEL.exec(hk.ziel);
      if (!m || Number(m[1]) > 64 || !(hk.punkte?.length > 0)) continue;
      const knopf = Number(m[1]);
      const nurSprung = hk.punkte.every((q) => q.form === 'sprung' && !zeileVon(c.start_beat + q.beat - ab.von_beat, lpb).schief);
      if (nurSprung) {
        for (const q of hk.punkte) {
          const abs = c.start_beat + q.beat, rel = abs - ab.von_beat;
          if (abs >= clipEnde - EPS || rel < -EPS) continue;
          const { zeile } = zeileVon(rel, lpb);
          if (zeile < zeilen) sprunge.push({ knopf, zeile, wert: wertZuByte(q.wert) });
        }
      } else {
        const von = Math.max(c.start_beat, ab.von_beat), bis = Math.min(clipEnde, endeAb);
        if (!(bis > von)) continue;
        reihen.push({ knopf, von: Math.floor((von - ab.von_beat) * lpb + EPS), bis: Math.ceil((bis - ab.von_beat) * lpb - EPS) - 1 });
      }
    }
  }
  // effect commands (MidiClip.fx) fill their stored column; an entry off the new row lines (after an LPB change) stays in the row that holds it, tinted
  const befehle = [];
  for (const c of spur.clips ?? []) {
    if (c.art !== 'midi' || !Array.isArray(c.fx)) continue;
    const loop = c.loop_beats ?? null;
    fuerKopien(c, (basis, kopieEnde) => {
      for (const e of c.fx) {
        if (typeof e?.code !== 'string' || !Number.isInteger(e.spalte) || e.spalte < 0 || e.spalte > FX_MAX_SPALTE || !Number.isFinite(e.wert)) continue;
        if (loop !== null && !(e.beat < loop)) continue;                  // from loop_beats on an entry is silent
        const abs = basis + e.beat, rel = abs - ab.von_beat;
        if (!(abs < kopieEnde - EPS) || rel < -EPS) continue;
        const { zeile, schief } = zeileVon(rel, lpb);
        if (zeile < zeilen) befehle.push({ zeile, spalte: e.spalte, code: e.code, wert: e.wert, schief, abs });
      }
    });
  }
  befehle.sort((a, b) => (b.schief ? 1 : 0) - (a.schief ? 1 : 0));        // an entry on the row line wins over an off-line one of the same cell
  for (const b of befehle) spalte(b.spalte)[b.zeile] = { code: b.code, wert: b.wert, ...(b.schief ? { schief: true, beat_abs: b.abs } : {}) };
  for (const k of reihen) {
    let i = 0;
    for (;; i++) { const sp = spalte(i); let leer = true; for (let z = k.von; z <= k.bis; z++) if (sp[z] !== null) { leer = false; break; } if (leer) break; }
    const sp = spalte(i);
    for (let z = k.von; z <= Math.min(k.bis, zeilen - 1); z++) sp[z] = { kurve: true };
  }
  sprunge.sort((a, b) => a.zeile - b.zeile || a.knopf - b.knopf);
  for (const j of sprunge) {
    const gleich = spalten.find((sp) => sp[j.zeile]?.knopf === j.knopf);
    if (gleich) { gleich[j.zeile] = { knopf: j.knopf, wert: j.wert }; continue; }   // the later point of a knob in a row wins
    let i = 0; while (spalte(i)[j.zeile] !== null) i++;
    spalten[i][j.zeile] = { knopf: j.knopf, wert: j.wert };
  }
  return spalten;
}

// Does a command do anything on the device of the track? bend and pegel are instance inputs of a Baukasten graph (ADR 040), so ARP SLU SLD GLD VIB TRM
// VSL LVL need one; RTG (more note starts) and PAN (a track lane) act on every device; OFS and REV need the role of the graph. rollen(geraet) ->
// { start?, rueckwaerts?, slot? } | null gives the roles; without it the roles are unknown and nothing is claimed about OFS and REV.
function fxOhneWirkung(geraet, code, rollen) {
  const graph = geraet?.art === 'intern' && geraet.name === 'bk';
  if (code === 'RTG' || code === 'PAN') return false;
  if (!graph) return true;
  if (code !== 'OFS' && code !== 'REV') return false;
  if (typeof rollen !== 'function') return false;
  const r = rollen(geraet) ?? {};
  return (code === 'OFS' ? r.start : r.rueckwaerts) === undefined;
}

export function projiziere(p, { abschnitt_id, lpb, rollen } = {}) {
  const liste = abschnitte(p);
  const ab = abschnitt_id === undefined ? liste[0] : liste.find((a) => a.id === abschnitt_id);
  if (!ab) throw new Error(`unknown section: ${abschnitt_id}`);
  const e = trackerEinstellung(p);
  const rl = lpb ?? e.lpb;
  const zeilen = Math.round(ab.laenge_beats * rl);
  const spuren = (p.spuren ?? []).map((s, i) => {
    const audio = s.art === 'audio';
    const geraet = s.geraet;
    const basis = geraet?.art === 'intern' && geraet.name === 'bk' ? geraet.parameter ?? {} : {};
    const fx = audio ? [] : fxSpalten(s, ab, rl, zeilen);
    for (const sp of fx) sp.forEach((z, i) => { if (z?.code !== undefined && fxOhneWirkung(geraet, z.code, rollen)) sp[i] = { ...z, ohne: true }; });
    if (!audio && fx.length === 0) fx.push(Array.from({ length: zeilen }, () => null));
    const clips = [];
    const noten = audio ? { spalten: [], verdeckt: 0 } : notenSpalten(s, ab, rl, zeilen);
    if (audio) {
      for (const c of s.clips ?? []) {
        const rel = c.start_beat - ab.von_beat;
        if (rel < -EPS || rel >= ab.laenge_beats - EPS) continue;
        const { zeile } = zeileVon(rel, rl);
        if (zeile < zeilen) clips.push({ zeile, name: c.name });
      }
    }
    return { spur_id: s.id, buchstabe: buchstabe(i), name: s.name, art: audio ? 'audio' : 'instrument', geraet_text: geraetText(s),
      bk: geraet?.art === 'intern' && geraet.name === 'bk', knopf_basis: basis,
      ...(!audio && typeof rollen === 'function' && (rollen(geraet) ?? {}).slot !== undefined ? { ins: true } : {}),
      notenspalten: noten.spalten, ...(noten.verdeckt > 0 ? { verdeckt: noten.verdeckt } : {}), fxspalten: fx, clips };
  });
  return { abschnitt: ab, lpb: rl, ticks: e.ticks, zeilen, spuren };
}

// --- cell texts ------------------------------------------------------------------------------------------------------------------------------
const vorz = (v) => (v < 0 ? '-' : ' ') + pad(Math.abs(v), 2);
const dlyWert = (z) => (z?.note ? z.note.versatz : z?.aus ? z.aus.dly : undefined);

export function zellText(zelle, unterspalte, zahlen) {
  const n = zelle?.note;
  switch (unterspalte) {
    case 'note': return n ? tonName(n.ton) : zelle?.aus ? '===' : '...';
    case 'vol': return n ? (zahlen === 'dec' ? pad(n.vel, 3) : pad(n.vel.toString(16).toUpperCase(), 2)) : zahlen === 'dec' ? '...' : '..';
    case 'dly': { const v = dlyWert(zelle); return v === undefined || v === 0 ? '...' : Math.abs(v) >= 100 ? String(v) : vorz(v); }
    case 'chn': return n?.chance !== undefined ? pad(n.chance, 2) : '..';
    case 'rpt': return n?.wdh !== undefined ? String(n.wdh) : '.';
    case 'ins': return n?.platz !== undefined ? pad(n.platz, 2) : '..';
    default: return '';
  }
}

export function fxText(fx, zahlen) {
  const breit = zahlen === 'dec';
  if (!fx) return breit ? '... ...' : '... ..';
  if (fx.kurve) return breit ? '~~~ ...' : '~~~ ..';
  if (fx.code !== undefined) return `${fx.code} ${breit ? pad(fx.wert, 3) : pad(Math.trunc(fx.wert).toString(16).toUpperCase(), 2)}`;
  return `K${pad(fx.knopf, 2)} ${breit ? pad(fx.wert, 3) : pad(fx.wert.toString(16).toUpperCase(), 2)}`;
}

// --- effect texts: the same units as project/fx_ausrollen.ts (ADR 040); a row is 1/lpb beat, a tick 1/(lpb * ticks) --------------------------------------
const ggt = (a, b) => (b === 0 ? a : ggt(b, a % b));
const bruch = (n, d) => { const g = ggt(n, d); return g === d ? String(n / g) : `${n / g}/${d / g}`; };
const halbtoene = (n, d) => `${bruch(n, d)} semitone${n > d ? 's' : ''}`;
const tick = (n) => `${n} tick${n === 1 ? '' : 's'}`;

export function fxBeschreibung(code, wert) {
  const w = Math.trunc(wert) & 255, x = w >> 4, y = w & 15;
  switch (code) {
    case 'ARP': return `arpeggio, one jump per tick through +0, +${x} and +${y} semitones`;
    case 'SLU': return w === 0 ? 'no slide' : `slide up ${halbtoene(w, 16)} per tick from the second tick`;
    case 'SLD': return w === 0 ? 'no slide' : `slide down ${halbtoene(w, 16)} per tick from the second tick`;
    case 'GLD': return w === 0 ? 'glide to this note, at the speed of the last GLD' : `glide to this note, ${halbtoene(w, 16)} per tick`;
    case 'VIB': case 'TRM': {
      const name = code === 'VIB' ? 'vibrato' : 'tremolo';
      if (x === 0 && y === 0) return `${name}, speed and depth unchanged`;
      const tiefe = code === 'VIB' ? `depth ${y}/8 semitone` : `depth ${y}/16 of the level`;
      return `${name}, ${x > 0 ? `speed ${x}/64 of a cycle per tick` : 'speed unchanged'}, ${y > 0 ? tiefe : 'depth unchanged'}`;
    }
    case 'VSL': return x > 0 ? `volume slide up ${x}/64 of the level per tick` : y > 0 ? `volume slide down ${y}/64 of the level per tick` : 'no volume slide';
    case 'LVL': return `level ${Math.round(w / 255 * 100)} % of the output, until the next new note`;
    case 'RTG': return y > 0 ? `retrigger the sounding note every ${tick(y)} inside the row` : 'no retrigger';
    case 'PAN': {
      const p = w === 255 ? 1 : (w - 128) / 128, pct = Math.round(Math.abs(p) * 100);
      return pct === 0 ? 'pan centre' : `pan ${p < 0 ? 'left' : 'right'} ${pct} %`;
    }
    case 'OFS': return `sample start at ${w}/256 of the sample`;
    case 'REV': return w === 1 ? 'play the sample backwards' : 'play the sample forwards (only 01 reverses)';
    default: return '';
  }
}

const SPALTEN_NAME = { note: 'NOTE', vol: 'VOL', dly: 'DLY', chn: 'CHN', rpt: 'RPT', ins: 'INS', fx: 'FX' };
const zwei = (x) => (Math.round(x * 100) / 100).toFixed(2);
const mitVorzeichen = (x) => `${x < 0 ? '-' : '+'}${zwei(Math.abs(x))}`;

/** opt.platzZahl: the real number of slots of the bank the cursor's track plays (when the view knows it), else 32 is named. */
export function statusText(raster, cursor, zahlen, opt = {}) {
  const s = raster?.spuren?.[cursor.spur];
  if (!s) return '';
  const kopf = `${s.buchstabe} ${s.name}, row ${pad(cursor.zeile, 2)}`;
  if (s.art === 'audio') {
    const c = s.clips.find((x) => x.zeile === cursor.zeile);
    return `${kopf}, ${c ? `audio clip "${c.name}" starts here` : 'audio track'}`;
  }
  const fxZiel = cursor.fxspalte !== undefined || cursor.unterspalte === 'fx';
  const u = fxZiel ? 'fx' : cursor.unterspalte;
  const wo = `${kopf}, ${SPALTEN_NAME[u] ?? ''}: `;
  if (fxZiel) {
    const fx = s.fxspalten[cursor.fxspalte ?? 0]?.[cursor.zeile];
    if (!fx) return `${wo}empty`;
    if (fx.kurve) return `${wo}drawn curve, edit it in PRODUCTION`;
    if (fx.code !== undefined) {
      const text = `${wo}${fxText(fx, zahlen)} = ${fxBeschreibung(fx.code, fx.wert)}`;
      const beat = fx.schief ? `; off the row line at beat ${zwei(fx.beat_abs)}, retyping puts it on the row line` : '';
      return `${text}${beat}${fx.ohne ? '; no effect on this device' : ''}`;
    }
    const off = byteZuWert(fx.wert), basis = s.knopf_basis?.[`k${fx.knopf}`] ?? 0.5;
    return `${wo}knob ${fx.knopf} offset ${mitVorzeichen(off)} (track knob ${zwei(basis)} -> ${zwei(Math.min(1, Math.max(0, basis + off)))})`;
  }
  const z = s.notenspalten[cursor.spalte]?.[cursor.zeile] ?? null;
  const n = z?.note;
  switch (u) {
    case 'note':
      if (n && z.schief) return `${wo}off the grid at beat ${zwei(n.beat_abs)}; retyping puts it on the row line`;
      if (n) return `${wo}${n.ton < 24 ? `${echterName(n.ton)} (MIDI ${n.ton}, below the grid range)` : `${tonName(n.ton)} (MIDI ${n.ton})`}`;
      return `${wo}${z?.aus ? 'note off' : 'empty'}`;
    case 'vol': return `${wo}${n ? `velocity ${n.vel} of 127` : 'empty'}`;
    case 'dly':
      if (n) return `${wo}${n.versatz ? `delay ${n.versatz < 0 ? '-' : '+'}${Math.abs(n.versatz)} % of a sixteenth (${zwei(Math.abs(n.versatz) / 100 * 0.25)} beat)`.replace(/\(/, `(${n.versatz < 0 ? '-' : ''}`) : 'no delay'}`;
      if (z?.aus) return `${wo}${z.aus.dly === 0 ? 'note off on the row line' : `note off ${Math.abs(z.aus.dly)} % of a sixteenth ${z.aus.dly < 0 ? 'before' : 'after'} the row line`}`;
      return `${wo}no delay`;
    case 'chn': return `${wo}${n?.chance !== undefined ? `plays with chance ${n.chance} %` : 'always plays'}`;
    case 'rpt': return `${wo}${n?.wdh !== undefined ? `${n.wdh} hits spread over the note length (at least a sixteenth); for hits inside one row put a note off on the next row` : 'single hit'}`;
    case 'ins': return `${wo}${n ? (n.platz !== undefined ? `slot ${n.platz} of ${opt.platzZahl ?? 32}${opt.platzZahl !== undefined && n.platz > opt.platzZahl ? ` (the bank has ${opt.platzZahl} slots: it plays slot ${opt.platzZahl})` : ''}` : 'no slot set, plays the slot the knob stands on') : 'empty'}`;
    default: return '';
  }
}

// The roles of a device for projiziere(..., { rollen }), from the entries of GET /graphen (`rollen` per graph, from the device register).
// rollenVonGraphen(liste) -> (geraet) => { slot?, start?, rueckwaerts? } | null; a track that is not a Baukasten graph, or a graph without roles: null.
export function rollenVonGraphen(liste) {
  const nachName = new Map((Array.isArray(liste) ? liste : []).filter((g) => g?.rollen).map((g) => [g.name, g.rollen]));
  return (geraet) => (geraet?.art === 'intern' && geraet.name === 'bk' ? nachName.get(geraet.graph) ?? null : null);
}
