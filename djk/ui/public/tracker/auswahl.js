// TRACKER (task 5): selection, clipboard, interpolation and transpose as pure functions. No DOM, no I/O, never mutates its input.
// Every operation reads the project through `projiziere` (task 1) at the project's own LPB and returns ONE list of project commands
// (one undo step) or `{ fehler }`; `null` means "nothing to do". Notes of one note column never overlap (lengths run in sounding time,
// `klingStart`); a note is written on its row line, its DLY (versatz) is a field of the note.
//
// Auswahl = { abschnitt_id, spur_von, spur_bis, zeile_von, zeile_bis, spalten: 'eine' | 'spur' | 'alle', spalte?, unterspalte?, fxspalte? }
//   indices into Raster.spuren / Raster rows. 'eine': one note column (`spalte`, with the sub-column `unterspalte` the cursor was in)
//   or, when `unterspalte` is 'fx', one effect column (`fxspalte`), of one track. 'spur': every column of the tracks spur_von..spur_bis.
//   'alle': every track of the section.
// Ablage = { zeilen, spalten, spuren: [{ noten: [{ spalte, zeile, ton, vel, laenge, versatz?, chance?, wdh?, platz? }], knoepfe: [{ zeile, knopf, wert }] }] }
//   one entry per copied track (relative to the first), rows relative to the first copied row; `spalte` is the note column index
//   (relative to the copied column for 'eine'); `wert` is the knob value byte 00..FF (D6).
// Cursor (as in task 1's statusText) = { spur, spalte, zeile, unterspalte, fxspalte? }.
// Ort (a write position, as task 4) = { abschnitt_id, spur_id, spalte, zeile, unterspalte, fxspalte? }.

import { projiziere, klingStart, tonName, byteZuWert } from './grid_model.js';

const EPS = 1e-9;
const rund = (x) => Math.round(x * 1e9) / 1e9;
const fehler = (text) => ({ fehler: text });
const KEIN_CLIP = 'No clip here: type a note first';                       // D7
const NAMEN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const ton_text = (t) => (t >= 24 && t <= 127 ? tonName(t) : `${NAMEN[((t % 12) + 12) % 12]}${Math.floor(t / 12) - 2}`);
const NOTEN_UNTER = ['vol', 'dly', 'chn', 'rpt'];

const raster_von = (p, abschnitt_id) => projiziere(p, { abschnitt_id });
const ist_fx = (c) => c.unterspalte === 'fx' || c.fxspalte !== undefined;

// --- selection ---------------------------------------------------------------------------------------------------------------------------------
// one axis: the edge that is not the anchor moves by d (clamped to 0..max); the anchor is the cursor
function kante(von, bis, anker, d, max) {
  if (anker !== von && anker !== bis) { von = bis = anker; }
  const e = Math.min(max, Math.max(0, (von === anker ? bis : von) + d));
  return [Math.min(anker, e), Math.max(anker, e)];
}

export function erweitere(auswahl, cursor, dz, ds, raster) {
  const id = raster.abschnitt.id;
  const frisch = !auswahl || auswahl.abschnitt_id !== id;
  const w = frisch
    ? { abschnitt_id: id, spur_von: cursor.spur, spur_bis: cursor.spur, zeile_von: cursor.zeile, zeile_bis: cursor.zeile, spalten: 'eine',
      ...(ist_fx(cursor) ? { unterspalte: 'fx', fxspalte: cursor.fxspalte ?? 0 } : { spalte: cursor.spalte ?? 0, unterspalte: cursor.unterspalte ?? 'note' }) }
    : auswahl;
  const [zv, zb] = kante(w.zeile_von, w.zeile_bis, cursor.zeile, dz, raster.zeilen - 1);
  let [sv, sb] = [w.spur_von, w.spur_bis];
  if (w.spalten !== 'alle') [sv, sb] = kante(w.spur_von, w.spur_bis, cursor.spur, ds, raster.spuren.length - 1);
  let spalten = w.spalten;
  if (spalten !== 'alle') {
    if (sv !== sb) spalten = 'spur';
    else if (w.spalte !== undefined || w.unterspalte === 'fx') spalten = 'eine';   // back to one track: the single column again
  }
  return { ...w, spur_von: sv, spur_bis: sb, zeile_von: zv, zeile_bis: zb, spalten };
}

// first press: the track column of the section (all rows of the cursor's track); second: the whole section
export function allesWahl(auswahl, cursor, raster) {
  const id = raster.abschnitt.id, n = raster.zeilen;
  const alle = { abschnitt_id: id, spur_von: 0, spur_bis: raster.spuren.length - 1, zeile_von: 0, zeile_bis: n - 1, spalten: 'alle' };
  if (auswahl && auswahl.abschnitt_id === id && (auswahl.spalten === 'alle'
    || (auswahl.spalten === 'spur' && auswahl.spur_von === auswahl.spur_bis && auswahl.zeile_von === 0 && auswahl.zeile_bis === n - 1))) return alle;
  return { abschnitt_id: id, spur_von: cursor.spur, spur_bis: cursor.spur, zeile_von: 0, zeile_bis: n - 1, spalten: 'spur' };
}

// the non-empty cells of a selection: { si, art: 'note' | 'fx', c, z, zelle }
function zellen(raster, a) {
  const aus = [];
  for (let si = a.spur_von; si <= a.spur_bis; si++) {
    const rs = raster.spuren[si];
    if (!rs || rs.art === 'audio') continue;
    const eine = a.spalten === 'eine', fx = eine && ist_fx(a);
    const noten = eine ? (fx ? [] : [a.spalte ?? 0]) : rs.notenspalten.map((_, c) => c);
    const fxs = eine ? (fx ? [a.fxspalte ?? 0] : []) : rs.fxspalten.map((_, c) => c);
    for (let z = a.zeile_von; z <= a.zeile_bis; z++) {
      for (const c of noten) { const zelle = rs.notenspalten[c]?.[z]; if (zelle) aus.push({ si, art: 'note', c, z, zelle }); }
      for (const c of fxs) { const zelle = rs.fxspalten[c]?.[z]; if (zelle) aus.push({ si, art: 'fx', c, z, zelle }); }
    }
  }
  return aus;
}

// --- reading: the clipboard ----------------------------------------------------------------------------------------------------------------------
export function kopiere(p, auswahl) {
  const raster = raster_von(p, auswahl.abschnitt_id);
  const eine = auswahl.spalten === 'eine';
  const spuren = Array.from({ length: auswahl.spur_bis - auswahl.spur_von + 1 }, () => ({ noten: [], knoepfe: [] }));
  for (const { si, art, c, z, zelle } of zellen(raster, auswahl)) {
    const t = spuren[si - auswahl.spur_von], zeile = z - auswahl.zeile_von;
    if (art === 'note' && zelle.note) {
      const n = zelle.note;
      t.noten.push({ spalte: eine ? 0 : c, zeile, ton: n.ton, vel: n.vel, laenge: n.laenge,
        ...(n.versatz !== undefined ? { versatz: n.versatz } : {}), ...(n.chance !== undefined ? { chance: n.chance } : {}),
        ...(n.wdh !== undefined ? { wdh: n.wdh } : {}),
        ...(n.platz !== undefined ? { platz: n.platz } : {}) });
    } else if (art === 'fx' && zelle.knopf !== undefined) t.knoepfe.push({ zeile, knopf: zelle.knopf, wert: zelle.wert });
  }
  for (const t of spuren) {
    t.noten.sort((a, b) => a.zeile - b.zeile || a.spalte - b.spalte);
    t.knoepfe.sort((a, b) => a.zeile - b.zeile || a.knopf - b.knopf);
  }
  return { zeilen: auswahl.zeile_bis - auswahl.zeile_von + 1, spalten: auswahl.spalten, spuren };
}
const ablage_leer = (a) => !a || !(a.spuren ?? []).some((t) => t.noten.length > 0 || t.knoepfe.length > 0);

// --- writing: notes of one track -----------------------------------------------------------------------------------------------------------------
// loesche: Map(note id -> clip id). neu: [{ sp (note column index), abs (written beat), ton, vel, laenge (wanted), versatz?, chance?, wdh?, platz? }].
// A note of a clip without it goes into a new section-wide clip (one clip_neu). In every column that gets a new note the sounding note before
// it is cut where the new one sounds, the new one stops at the next note of the column (or its clip end, or its wanted length).
function schreibe_noten(p, raster, si, loesche, neu) {
  const rs = raster.spuren[si];
  const spur = p.spuren.find((s) => s.id === rs.spur_id);
  const clips = spur.clips.filter((c) => c.art === 'midi');
  const ab = raster.abschnitt;
  const echt = new Map();
  const note_von = (c, id) => { let m = echt.get(c.id); if (!m) echt.set(c.id, (m = new Map(c.noten.map((n) => [n.id, n])))); return m.get(id); };
  const schleife = (c) => fehler(`Clip "${c.name}" loops: remove the loop in PRODUCTION first`);
  const virtuell = { id: null, start_beat: ab.von_beat, laenge_beats: ab.laenge_beats, noten: [] };
  const reihen = new Map();
  for (const sp of new Set(neu.map((n) => n.sp))) {
    const items = [];
    for (const zelle of rs.notenspalten[sp] ?? []) {
      const m = zelle?.note;
      if (!m) continue;
      const c = clips.find((x) => x.id === m.clip_id);
      if (c.loop_beats != null) return schleife(c);
      if (loesche.has(m.id)) continue;
      const n = note_von(c, m.id);
      items.push({ neu: false, id: n.id, clip: c, klang: c.start_beat + klingStart(n), laenge: n.laenge });
    }
    reihen.set(sp, items);
  }
  for (const n of neu) {
    const deckt = clips.filter((c) => n.abs >= c.start_beat - EPS && n.abs < c.start_beat + c.laenge_beats - EPS);
    const schl = deckt.find((c) => c.loop_beats != null);
    if (schl) return schleife(schl);
    const clip = deckt[0] ?? virtuell;
    const klang = n.abs + (n.versatz ?? 0) / 100 * 0.25;
    if (!(klang < clip.start_beat + clip.laenge_beats - EPS)) return fehler('A note would start after the end of its clip');
    reihen.get(n.sp).push({ neu: true, n, clip, klang, laenge: n.laenge });
  }
  const aendere = new Map();                                                // clip id -> [{ id, laenge }]
  const geschrieben = new Map();                                            // clip (object) -> [note bodies]
  for (const [sp, items] of reihen) {
    items.sort((a, b) => a.klang - b.klang || (a.neu ? 1 : 0) - (b.neu ? 1 : 0));
    for (let i = 0; i < items.length; i++) {
      const it = items[i], next = items[i + 1];
      const clipEnde = it.clip.start_beat + it.clip.laenge_beats;
      if (next && next.klang - it.klang <= EPS && (it.neu || next.neu)) return fehler('Two notes of one column would sound at the same time');
      if (!it.neu) {
        const ende = it.klang + Math.min(it.laenge, clipEnde - it.klang);
        if (next?.neu && ende > next.klang + EPS) {
          if (!aendere.has(it.clip.id)) aendere.set(it.clip.id, []);
          aendere.get(it.clip.id).push({ id: it.id, laenge: rund(next.klang - it.klang) });
        }
        continue;
      }
      const laenge = rund(Math.min(it.laenge, clipEnde - it.klang, next ? next.klang - it.klang : Infinity));
      const n = it.n;
      if (!(laenge > EPS)) return fehler('A note would get no length');
      if (!geschrieben.has(it.clip)) geschrieben.set(it.clip, []);
      geschrieben.get(it.clip).push({ beat: rund(n.abs - it.clip.start_beat), laenge, ton: n.ton, vel: n.vel,
        ...(sp > 0 ? { spalte: sp + 1 } : {}), ...(n.versatz ? { versatz: n.versatz } : {}),
        ...(n.chance !== undefined ? { chance: n.chance } : {}), ...(n.wdh !== undefined ? { wdh: n.wdh } : {}),
        ...(n.platz !== undefined ? { platz: n.platz } : {}) });
    }
  }
  const befehle = [];
  const neuClip = geschrieben.get(virtuell);
  if (neuClip) befehle.push({ befehl: 'clip_neu', spur_id: spur.id, art: 'midi', start_beat: virtuell.start_beat, laenge_beats: virtuell.laenge_beats, noten: neuClip });
  const weg = new Map();
  for (const [id, clipId] of loesche) { if (!weg.has(clipId)) weg.set(clipId, []); weg.get(clipId).push(id); }
  for (const [clip_id, ids] of weg) befehle.push({ befehl: 'noten_loeschen', clip_id, ids });
  for (const [clip_id, liste] of aendere) befehle.push({ befehl: 'noten_aendern', clip_id, noten: liste });
  for (const [clip, liste] of geschrieben) if (clip !== virtuell) befehle.push({ befehl: 'noten_neu', clip_id: clip.id, noten: liste });
  return { befehle };
}

// --- writing: knob values (jump points of geraet.k<n>), collected per clip and target -----------------------------------------------------------
function knopf_plan(p, raster) {
  const gruppen = new Map();
  const deckend = (si, z) => {
    const spur = p.spuren.find((s) => s.id === raster.spuren[si].spur_id);
    const abs = raster.abschnitt.von_beat + z / raster.lpb;
    const clip = spur.clips.find((c) => c.art === 'midi' && abs >= c.start_beat - EPS && abs < c.start_beat + c.laenge_beats - EPS);
    return clip ? { clip, beat: rund(abs - clip.start_beat) } : null;
  };
  const gruppe = (clip, ziel) => {
    const k = `${clip.id}|${ziel}`;
    if (!gruppen.has(k)) {
      const hk = (clip.huellkurven ?? []).find((h) => h.ziel === ziel);
      gruppen.set(k, { clip, ziel, hk, punkte: (hk?.punkte ?? []).map((q) => ({ ...q })), geaendert: false });
    }
    return gruppen.get(k);
  };
  return {
    setze(si, knopf, z, byte) {
      const d = deckend(si, z);
      if (!d) return fehler(KEIN_CLIP);
      const g = gruppe(d.clip, `geraet.k${knopf}`);
      g.punkte = g.punkte.filter((q) => Math.abs(q.beat - d.beat) > EPS);
      g.punkte.push({ beat: d.beat, wert: byteZuWert(byte), form: 'sprung' });
      g.punkte.sort((a, b) => a.beat - b.beat);
      g.geaendert = true;
      return null;
    },
    entferne(si, knopf, z) {
      const d = deckend(si, z);
      if (!d) return;
      const g = gruppe(d.clip, `geraet.k${knopf}`), vorher = g.punkte.length;
      g.punkte = g.punkte.filter((q) => !(Math.abs(q.beat - d.beat) <= EPS && q.form === 'sprung'));
      if (g.punkte.length !== vorher) g.geaendert = true;
    },
    befehle() {
      const aus = [];
      for (const g of gruppen.values()) {
        if (!g.geaendert) continue;
        if (g.punkte.length === 0) { if (g.hk) aus.push({ befehl: 'huellkurve_loeschen', clip_id: g.clip.id, ziel: g.ziel }); continue; }
        aus.push({ befehl: 'huellkurve_setzen', clip_id: g.clip.id, ziel: g.ziel, punkte: g.punkte,
          ...(g.hk?.verknuepft === false ? { verknuepft: false } : {}), ...(g.hk?.loop_beats !== undefined ? { loop_beats: g.hk.loop_beats } : {}) });
      }
      return aus;
    },
  };
}

// --- paste ---------------------------------------------------------------------------------------------------------------------------------------
// Overlay paste: empty clipboard cells leave the target alone, a pasted note replaces the note of its target cell. Notes keep their copied length
// (cut at the next note of the column), their DLY and the fields CHN and RPT; they sit on row lines.
export function einsetzen(p, ort, ablage) {
  if (ablage_leer(ablage)) return fehler('The clipboard is empty');
  let raster;
  try { raster = raster_von(p, ort.abschnitt_id); } catch (e) { return fehler(e.message); }
  const s0 = raster.spuren.findIndex((s) => s.spur_id === ort.spur_id);
  if (s0 < 0) return fehler(`Unknown track ${ort.spur_id}`);
  if (s0 + ablage.spuren.length > raster.spuren.length) return fehler('Not enough tracks to paste');
  const z0 = ort.zeile ?? 0;
  if (z0 + ablage.zeilen > raster.zeilen) return fehler('Paste would pass the section end');
  const basis = ablage.spalten === 'eine' ? (ort.spalte ?? 0) : 0;
  const plan = knopf_plan(p, raster);
  const befehle = [];
  for (let k = 0; k < ablage.spuren.length; k++) {
    const t = ablage.spuren[k], si = s0 + k, rs = raster.spuren[si];
    if (t.noten.length === 0 && t.knoepfe.length === 0) continue;
    if (rs.art === 'audio') return fehler(`Track ${rs.buchstabe} is an audio track: it holds no notes`);
    const loesche = new Map(), neu = [];
    for (const n of t.noten) {
      const sp = basis + n.spalte, zeile = z0 + n.zeile;
      if (sp > 7) return fehler('Paste would pass note column 8');
      const alt = rs.notenspalten[sp]?.[zeile]?.note;
      if (alt) loesche.set(alt.id, alt.clip_id);
      neu.push({ sp, abs: raster.abschnitt.von_beat + zeile / raster.lpb, ton: n.ton, vel: n.vel, laenge: n.laenge,
        ...(n.versatz !== undefined ? { versatz: n.versatz } : {}), ...(n.chance !== undefined ? { chance: n.chance } : {}),
        ...(n.wdh !== undefined ? { wdh: n.wdh } : {}),
        ...(n.platz !== undefined ? { platz: n.platz } : {}) });
    }
    if (neu.length > 0) {
      const r = schreibe_noten(p, raster, si, loesche, neu);
      if (r.fehler) return r;
      befehle.push(...r.befehle);
    }
    for (const q of t.knoepfe) { const f = plan.setze(si, q.knopf, z0 + q.zeile, q.wert); if (f) return f; }
  }
  befehle.push(...plan.befehle());
  return befehle.length === 0 ? null : { label: 'Paste', befehle };
}

// the commands that remove every note and knob point of a selection
function loesch_befehle(p, raster, auswahl) {
  const befehle = [];
  const plan = knopf_plan(p, raster);
  const proSpur = new Map();
  for (const { si, art, z, zelle } of zellen(raster, auswahl)) {
    if (art === 'note' && zelle.note) {
      if (!proSpur.has(si)) proSpur.set(si, new Map());
      proSpur.get(si).set(zelle.note.id, zelle.note.clip_id);
    } else if (art === 'fx' && zelle.knopf !== undefined) plan.entferne(si, zelle.knopf, z);
  }
  for (const [si, loesche] of proSpur) befehle.push(...schreibe_noten(p, raster, si, loesche, []).befehle);
  befehle.push(...plan.befehle());
  return befehle;
}

export function ausschneiden(p, auswahl) {
  const raster = raster_von(p, auswahl.abschnitt_id);
  const befehle = loesch_befehle(p, raster, auswahl);
  if (befehle.length === 0) return null;
  return { ablage: kopiere(p, auswahl), label: 'Cut', befehle };
}

export function duplizieren(p, auswahl) {
  const raster = raster_von(p, auswahl.abschnitt_id);
  const n = auswahl.zeile_bis - auswahl.zeile_von + 1;
  if (auswahl.zeile_bis + n >= raster.zeilen) return fehler('Duplicate would pass the section end');
  const ablage = kopiere(p, auswahl);
  if (ablage_leer(ablage)) return null;
  const ort = { abschnitt_id: auswahl.abschnitt_id, spur_id: raster.spuren[auswahl.spur_von].spur_id, zeile: auswahl.zeile_bis + 1,
    spalte: auswahl.spalte ?? 0, unterspalte: auswahl.unterspalte ?? 'note', ...(auswahl.fxspalte !== undefined ? { fxspalte: auswahl.fxspalte } : {}) };
  const r = einsetzen(p, ort, ablage);
  return r && !r.fehler ? { ...r, label: 'Duplicate' } : r;
}

// --- interpolation -------------------------------------------------------------------------------------------------------------------------------
const FELD = { vol: ['vel', (n) => n.vel], dly: ['versatz', (n) => n.versatz ?? 0], chn: ['chance', (n) => n.chance], rpt: ['wdh', (n) => n.wdh] };
const lerp = (a, b, t) => Math.round(a + (b - a) * t);

// Linear between the first and the last selected row of one sub-column. VOL, DLY, CHN, RPT: only rows that hold a note change, both end rows
// need a value. Knob value: both end rows hold the same knob, every row between gets a jump point (a ramp over empty rows is the use).
export function interpoliere(p, auswahl) {
  const raster = raster_von(p, auswahl.abschnitt_id);
  const z0 = auswahl.zeile_von, z1 = auswahl.zeile_bis, si = auswahl.spur_von;
  const falsch = fehler('Select a VOL, DLY, CHN, RPT or knob column to interpolate');
  if (auswahl.spalten !== 'eine' || auswahl.spur_von !== auswahl.spur_bis) return falsch;
  const rs = raster.spuren[si];
  if (!rs || rs.art === 'audio' || !(ist_fx(auswahl) || NOTEN_UNTER.includes(auswahl.unterspalte))) return falsch;
  if (z1 <= z0) return null;
  const beide = fehler('The first and last selected rows both need a value');
  if (ist_fx(auswahl)) {
    const sp = rs.fxspalten[auswahl.fxspalte ?? 0] ?? [];
    const a = sp[z0], b = sp[z1];
    if (a?.knopf === undefined || b?.knopf === undefined || a.knopf !== b.knopf) return beide;
    const plan = knopf_plan(p, raster);
    let geaendert = false;
    for (let z = z0 + 1; z < z1; z++) {
      if (sp[z]?.kurve) continue;
      const f = plan.setze(si, a.knopf, z, lerp(a.wert, b.wert, (z - z0) / (z1 - z0)));
      if (f) return f;
      geaendert = true;
    }
    return geaendert ? { label: `Interpolate knob ${a.knopf}`, befehle: plan.befehle() } : null;
  }
  const u = auswahl.unterspalte;
  if (!NOTEN_UNTER.includes(u)) return falsch;
  const [feld, wert] = FELD[u];
  const sp = rs.notenspalten[auswahl.spalte ?? 0] ?? [];
  const a = sp[z0]?.note, b = sp[z1]?.note;
  if (!a || !b || wert(a) === undefined || wert(b) === undefined) return beide;
  const proClip = new Map();
  for (let z = z0 + 1; z < z1; z++) {
    const n = sp[z]?.note;
    if (!n) continue;
    const v = lerp(wert(a), wert(b), (z - z0) / (z1 - z0));
    if (v === wert(n)) continue;
    if (!proClip.has(n.clip_id)) proClip.set(n.clip_id, new Map());
    proClip.get(n.clip_id).set(n.id, { id: n.id, [feld]: feld === 'versatz' && v === 0 ? null : v });
  }
  if (proClip.size === 0) return null;
  return { label: `Interpolate ${u.toUpperCase()}`,
    befehle: [...proClip].map(([clip_id, m]) => ({ befehl: 'noten_aendern', clip_id, noten: [...m.values()] })) };
}

// --- transpose -----------------------------------------------------------------------------------------------------------------------------------
// x: an Auswahl or an Ort (one cell). A note that would leave 0..127 refuses the whole step and is named.
export function transponiere(p, x, d) {
  if (!Number.isInteger(d) || d === 0) return null;
  const raster = raster_von(p, x.abschnitt_id);
  const noten = new Map();                                                  // id -> { clip_id, ton }
  if ('spur_von' in x) {
    for (const { art, zelle } of zellen(raster, x)) if (art === 'note' && zelle.note) noten.set(zelle.note.id, zelle.note);
  } else {
    const si = raster.spuren.findIndex((s) => s.spur_id === x.spur_id);
    const n = raster.spuren[si]?.notenspalten[x.spalte ?? 0]?.[x.zeile]?.note;
    if (n) noten.set(n.id, n);
  }
  if (noten.size === 0) return null;
  const proClip = new Map();
  for (const n of noten.values()) {
    const neu = n.ton + d;
    if (neu < 0 || neu > 127) return fehler(`${ton_text(n.ton)} transposed by ${d > 0 ? '+' : ''}${d} would leave 0..127`);
    if (!proClip.has(n.clip_id)) proClip.set(n.clip_id, []);
    proClip.get(n.clip_id).push({ id: n.id, ton: neu });
  }
  return { label: `Transpose ${d > 0 ? '+' : ''}${d}`, befehle: [...proClip].map(([clip_id, liste]) => ({ befehl: 'noten_aendern', clip_id, noten: liste })) };
}
