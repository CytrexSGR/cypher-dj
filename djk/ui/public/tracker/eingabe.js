// TRACKER (task 4): cell entry as pure command builders. No DOM, no I/O, never mutates its input. Every builder takes (p, ort, ...) and returns
// { label, befehle } (one undo step of project commands), { fehler } (a refusal text, nothing to write) or null (nothing to do).
// ort = { abschnitt_id, spur_id, spalte, zeile, unterspalte, fxspalte?, lpb? }; spalte is the 0-based note column of the grid (stored on a
// note as `spalte` = index + 1, and only for index >= 1); lpb defaults to the project's tracker setting.
// Time model (as in the projection): a note sits in the row of its WRITTEN beat; versatz moves only the sound (klingStart). Lengths and ends
// are in sounding time, so the notes of one column never overlap. Notes are found through the projection, so a note that was pushed to
// another column there is edited in that column. Looped clips: only the first copy (rows before loop_beats) can be edited.

import { abschnitte, klingStart, projiziere, trackerEinstellung, tonName, byteZuWert, wertZuByte, zeileVon, FX_CODES, FX_MAX_SPALTE } from './grid_model.js';

const EPS = 1e-9;
const r9 = (x) => Math.round(x * 1e9) / 1e9;
const fehler = (text) => ({ fehler: text });
const GRUND_KEIN_CLIP = 'No clip here: type a note first';

// --- context ------------------------------------------------------------------------------------------------------------------------------
function kontext(p, ort) {
  const spur = (p?.spuren ?? []).find((s) => s.id === ort?.spur_id);
  if (!spur) return fehler(`Unknown track ${ort?.spur_id}`);
  if (spur.art === 'audio') return fehler('Audio track: it takes no notes or knob values');
  const lpb = ort.lpb ?? trackerEinstellung(p).lpb;
  let r;
  try { r = projiziere(p, { abschnitt_id: ort.abschnitt_id, lpb }); } catch { return fehler(`Unknown section ${ort.abschnitt_id}`); }
  const sp = r.spuren.find((s) => s.spur_id === spur.id);
  if (!Number.isInteger(ort.zeile) || ort.zeile < 0 || ort.zeile >= r.zeilen) return fehler('The row lies outside the section');
  const c = ort.spalte ?? 0;
  if (!Number.isInteger(c) || c < 0 || c > 7) return fehler('Note column 1..8 expected');
  return { spur, lpb, ab: r.abschnitt, zeilen: r.zeilen, sp, c, zeile: ort.zeile, linie: r.abschnitt.von_beat + ort.zeile / lpb, zl: 1 / lpb };
}

const kopieEnde = (cl) => cl.start_beat + (cl.loop_beats ?? cl.laenge_beats);

// the first MIDI clip of the track whose time covers a beat; { clip } or { fehler }
function clipUeber(spur, abs) {
  const clip = spur.clips.find((c) => c.art === 'midi' && c.start_beat <= abs + EPS && abs < c.start_beat + c.laenge_beats - EPS);
  if (!clip) return null;
  if (clip.loop_beats != null && abs - clip.start_beat >= clip.loop_beats - EPS) return fehler('This row lies in a repeated loop copy: edit the first copy');
  return clip;
}

// every editable note of one note column of the track, over all sections, sorted by sounding start
function spaltenNoten(p, k) {
  const clips = new Map(k.spur.clips.map((c) => [c.id, c]));
  const aus = [];
  for (const ab of abschnitte(p)) {
    const sp = ab.id === k.ab.id ? k.sp : projiziere(p, { abschnitt_id: ab.id, lpb: k.lpb }).spuren.find((s) => s.spur_id === k.spur.id);
    const spalte = sp?.notenspalten[k.c];
    if (!spalte) continue;
    spalte.forEach((z, zeile) => {
      const n = z?.note;
      if (!n) return;
      const clip = clips.get(n.clip_id);
      if (clip.loop_beats != null && n.beat_abs - clip.start_beat >= clip.loop_beats - EPS) return;   // a loop copy
      const gespeichert = clip.noten.find((x) => x.id === n.id);
      const klang = Math.max(clip.start_beat, n.beat_abs + (n.versatz ?? 0) / 100 * 0.25);
      aus.push({ id: n.id, clip_id: clip.id, clip, ton: n.ton, vel: n.vel, versatz: n.versatz, chance: n.chance, wdh: n.wdh, platz: n.platz, spalte: gespeichert.spalte, beat: gespeichert.beat,
        schrift: n.beat_abs, klang, laenge: n.laenge, ende: klang + n.laenge, kopieEnde: kopieEnde(clip), zeile, abschnitt: ab.id });
    });
  }
  return aus.sort((a, b) => a.klang - b.klang);
}

// --- command assembly ---------------------------------------------------------------------------------------------------------------------
function sammler() {
  const aendern = new Map(), loeschen = new Map();
  return {
    aendern(clip_id, id, felder) {
      if (!aendern.has(clip_id)) aendern.set(clip_id, new Map());
      aendern.get(clip_id).set(id, { ...(aendern.get(clip_id).get(id) ?? {}), ...felder });
    },
    loeschen(clip_id, id) { if (!loeschen.has(clip_id)) loeschen.set(clip_id, []); loeschen.get(clip_id).push(id); },
    befehle() {
      const b = [];
      for (const [clip_id, m] of aendern) b.push({ befehl: 'noten_aendern', clip_id, noten: [...m].map(([id, f]) => ({ id, ...f })) });
      for (const [clip_id, ids] of loeschen) b.push({ befehl: 'noten_loeschen', clip_id, ids });
      return b;
    },
  };
}
const spalteFeld = (c) => (c >= 1 ? { spalte: c + 1 } : {});

// --- notes --------------------------------------------------------------------------------------------------------------------------------
export function noteSchreiben(p, ort, ton, { vel, akkord, platz } = {}) {
  if (!Number.isInteger(ton) || ton < 24 || ton > 127) return fehler('Note out of range: C-0 to G-8 can be typed');
  if (vel !== undefined && !(Number.isInteger(vel) && vel >= 1 && vel <= 127)) return fehler('Velocity 1..127 expected');
  if (platz !== undefined && !(Number.isInteger(platz) && platz >= 1 && platz <= 32)) return fehler('Slot 1..32 expected');
  const k = kontext(p, ort);
  if (k.fehler) return k;
  let c = k.c;
  if (akkord) {
    const belegt = (i) => k.sp.notenspalten[i]?.[k.zeile]?.note !== undefined;
    const reihe = [...Array(8 - c).keys()].map((i) => c + i).concat([...Array(c).keys()]);
    const frei = reihe.find((i) => !belegt(i));
    if (frei === undefined) return fehler('All 8 note columns are used in this row');
    c = frei;
  }
  const kc = { ...k, c };
  const col = spaltenNoten(p, kc);
  const eigene = col.find((n) => n.abschnitt === k.ab.id && n.zeile === k.zeile) ?? null;
  const label = `Note ${tonName(ton)}`;
  let clip;
  if (eigene) clip = eigene.clip;
  else { clip = clipUeber(k.spur, k.linie); if (clip?.fehler) return clip; }
  const andere = col.filter((n) => n !== eigene);
  const gleich = andere.find((n) => Math.abs(n.klang - k.linie) <= EPS);
  if (gleich) return fehler('A delayed note of an earlier row already sounds at this row line');
  const prev = [...andere].reverse().find((n) => n.klang < k.linie - EPS) ?? null;
  const next = andere.find((n) => n.klang > k.linie + EPS) ?? null;
  const sam = sammler();
  const deckt = prev && prev.ende > k.linie + EPS;
  if (deckt) sam.aendern(prev.clip_id, prev.id, { laenge: r9(k.linie - prev.klang) });

  if (eigene) {
    const beat = r9(k.linie - clip.start_beat);
    if (beat < -EPS) return fehler('The row line lies before the start of the clip');
    const ende = eigene.ende;
    let laenge = r9(ende - k.linie);
    if (laenge <= EPS) {
      laenge = r9(Math.min(eigene.laenge, (next ? next.klang : eigene.kopieEnde) - k.linie, eigene.kopieEnde - k.linie));
      if (laenge <= EPS) return fehler('The note would have no length here');
    }
    const f = {};
    if (eigene.ton !== ton) f.ton = ton;
    if (Math.abs(beat - eigene.beat) > EPS) f.beat = Math.max(0, beat);
    if (vel !== undefined && vel !== eigene.vel) f.vel = vel;
    if (platz !== undefined && platz !== eigene.platz) f.platz = platz;
    if (eigene.versatz !== undefined) f.versatz = null;
    if (c >= 1 && eigene.spalte !== c + 1) f.spalte = c + 1;   // the note shown in a column to the right of its stored one keeps that place
    if (Math.abs(laenge - eigene.laenge) > EPS) f.laenge = laenge;
    if (Object.keys(f).length > 0) sam.aendern(eigene.clip_id, eigene.id, f);
    const befehle = sam.befehle();
    return befehle.length === 0 ? null : { label, befehle, spalte: c };
  }

  const start = clip ? clip.start_beat : k.ab.von_beat;
  const limit = clip ? kopieEnde(clip) : k.ab.von_beat + k.ab.laenge_beats;
  let ende = limit;
  if (next && next.klang < ende) ende = next.klang;
  if (deckt && prev.ende < ende) ende = prev.ende;
  const laenge = r9(ende - k.linie);
  if (laenge <= EPS) return fehler('The note would have no length here');
  const note = { beat: r9(k.linie - start), laenge, ton, vel: vel ?? 100, ...spalteFeld(c), ...(platz !== undefined ? { platz } : {}) };
  const neu = clip ? { befehl: 'noten_neu', clip_id: clip.id, noten: [note] }
    : { befehl: 'clip_neu', spur_id: k.spur.id, art: 'midi', start_beat: k.ab.von_beat, laenge_beats: k.ab.laenge_beats, noten: [note] };
  return { label, befehle: [...sam.befehle(), neu], spalte: c };
}

export function notenAus(p, ort) {
  const k = kontext(p, ort);
  if (k.fehler) return k;
  const col = spaltenNoten(p, k);
  const eigene = col.find((n) => n.abschnitt === k.ab.id && n.zeile === k.zeile) ?? null;
  const klingt = col.find((n) => n !== eigene && n.klang < k.linie - EPS && n.ende > k.linie + EPS) ?? null;
  if (!klingt && !eigene) return null;
  const sam = sammler();
  if (klingt) sam.aendern(klingt.clip_id, klingt.id, { laenge: r9(k.linie - klingt.klang) });
  if (eigene) sam.loeschen(eigene.clip_id, eigene.id);      // a note off replaces the note that starts in the cell
  return { label: 'Note off', befehle: sam.befehle() };
}

// --- values -------------------------------------------------------------------------------------------------------------------------------
const WERTE = {
  vol: { feld: 'vel', min: 1, max: 127, name: 'Velocity', klar: null },
  chn: { feld: 'chance', min: 1, max: 99, name: 'Chance', klar: 'Clear chance' },
  rpt: { feld: 'wdh', min: 2, max: 8, name: 'Repeat', klar: 'Clear repeat' },
  ins: { feld: 'platz', min: 1, max: 32, name: 'Slot', klar: 'Clear slot' },
};

export function wertSetzen(p, ort, unterspalte, wert) {
  const k = kontext(p, ort);
  if (k.fehler) return k;
  const col = spaltenNoten(p, k);
  const eigene = col.find((n) => n.abschnitt === k.ab.id && n.zeile === k.zeile) ?? null;
  const aus = k.sp.notenspalten[k.c]?.[k.zeile]?.aus ?? null;
  const ganz = (min, max, text) => (wert === null || (Number.isInteger(wert) && wert >= min && wert <= max) ? null : fehler(text));
  if (unterspalte === 'vol' || unterspalte === 'chn' || unterspalte === 'rpt' || unterspalte === 'ins') {
    const w = WERTE[unterspalte];
    if (wert === null && w.klar === null) return fehler('Velocity cannot be cleared');
    const f = ganz(w.min, w.max, `${w.name} ${w.min}..${w.max} expected`);
    if (f) return f;
    if (!eigene) return fehler('No note in this cell');
    const alt = eigene[unterspalte === 'vol' ? 'vel' : w.feld];
    if (wert === null ? alt === undefined : alt === wert) return null;
    return { label: wert === null ? w.klar : `${w.name} ${wert}`,
      befehle: [{ befehl: 'noten_aendern', clip_id: eigene.clip_id, noten: [{ id: eigene.id, [w.feld]: wert }] }] };
  }
  if (unterspalte !== 'dly') return fehler(`Unknown column ${String(unterspalte)}`);

  if (eigene) {                                              // delay of a note: the start sounds later or earlier, the end stays
    if (wert !== null && !(Number.isInteger(wert) && wert >= -95 && wert <= 95 && wert !== 0)) return fehler('Delay -95..95 without 0 expected (clear the field to remove it)');
    if ((eigene.versatz ?? 0) === (wert ?? 0)) return null;
    const neuKlang = eigene.schrift + (wert ?? 0) / 100 * 0.25;
    if (neuKlang < eigene.clip.start_beat - EPS) return fehler('The delay would reach before the start of the clip');
    const laenge = r9(eigene.ende - neuKlang);
    if (laenge <= EPS) return fehler('The delay would leave the note with no length');
    const i = col.indexOf(eigene);
    const prev = i > 0 ? col[i - 1] : null;
    const sam = sammler();
    if (prev) {
      if (neuKlang <= prev.klang + EPS) return fehler('The delay would move the note before the previous note of its column');
      if (prev.ende > neuKlang + EPS) sam.aendern(prev.clip_id, prev.id, { laenge: r9(neuKlang - prev.klang) });
    }
    sam.aendern(eigene.clip_id, eigene.id, { versatz: wert, laenge });
    return { label: wert === null ? 'Clear delay' : `Delay ${wert}`, befehle: sam.befehle() };
  }
  if (aus) {                                                 // delay of a note off: the end of the note that ends here
    const w = wert ?? 0, maxi = 400 / k.lpb;
    if (!Number.isInteger(w) || w < 0 || w > maxi + EPS) return fehler(`Note off delay 0..${Math.floor(maxi + EPS)} expected (percent of a sixteenth, at most one row)`);
    const a = col.find((n) => n.id === aus.note_id);
    if (!a) return null;
    if (Math.abs(w - aus.dly) < 0.5) return null;
    const ende = k.linie + w / 100 * 0.25;
    const laenge = r9(ende - a.klang);
    if (laenge <= EPS) return fehler('The note would have no length');
    if (ende > a.kopieEnde + EPS) return fehler('The note would end behind its clip');
    const next = col.find((n) => n.klang > a.klang + EPS);
    if (next && ende > next.klang + EPS) return fehler('The note would run into the next note of its column');
    return { label: `Delay ${w}`, befehle: [{ befehl: 'noten_aendern', clip_id: a.clip_id, noten: [{ id: a.id, laenge }] }] };
  }
  return fehler('No note or note off in this cell');
}

// --- clear ---------------------------------------------------------------------------------------------------------------------------------
// remove the jump points at the row line of one knob; the envelope goes when it is empty
function knopfEntfernen(k, knopf) {
  const ziel = `geraet.k${knopf}`;
  const befehle = [];
  for (const clip of k.spur.clips) {
    if (clip.art !== 'midi') continue;
    const hk = (clip.huellkurven ?? []).find((h) => h.ziel === ziel);
    if (!hk) continue;
    const rel = k.linie - clip.start_beat;
    const rest = hk.punkte.filter((q) => Math.abs(q.beat - rel) > EPS);
    if (rest.length === hk.punkte.length) continue;
    if (rest.length === 0) befehle.push({ befehl: 'huellkurve_loeschen', clip_id: clip.id, ziel });
    else befehle.push({ befehl: 'huellkurve_setzen', clip_id: clip.id, ziel, punkte: rest.map((q) => ({ ...q })),
      ...(hk.verknuepft === false ? { verknuepft: false } : {}), ...(hk.loop_beats !== undefined ? { loop_beats: hk.loop_beats } : {}) });
  }
  return befehle.length === 0 ? null : { label: 'Clear cell', befehle };
}

// --- effect commands -----------------------------------------------------------------------------------------------------------------------
// the stored entries (first copy of a clip) that the projection shows in the cell of the row and effect column: [{ clip, e }]; an entry off the row
// line of the current LPB belongs to the row that holds it
function fxImFeld(k, spalte) {
  const aus = [];
  for (const clip of k.spur.clips) {
    if (clip.art !== 'midi' || !Array.isArray(clip.fx)) continue;
    for (const e of clip.fx) {
      if (e.spalte !== spalte || e.beat < -EPS || e.beat >= clip.laenge_beats - EPS || (clip.loop_beats != null && e.beat >= clip.loop_beats - EPS)) continue;
      const rel = clip.start_beat + e.beat - k.ab.von_beat;
      if (rel >= -EPS && zeileVon(rel, k.lpb).zeile === k.zeile) aus.push({ clip, e });
    }
  }
  return aus;
}
// fx_setzen commands per clip: entries = [{ clip, eintrag }]
function fxBefehle(eintraege) {
  const je = new Map();
  for (const { clip, eintrag } of eintraege) { if (!je.has(clip.id)) je.set(clip.id, []); je.get(clip.id).push(eintrag); }
  return [...je].map(([clip_id, l]) => ({ befehl: 'fx_setzen', clip_id, eintraege: l }));
}
const fxLoeschen = (liste) => liste.map(({ clip, e }) => ({ clip, eintrag: { beat: e.beat, spalte: e.spalte, code: null } }));
const hex2 = (w) => w.toString(16).toUpperCase().padStart(2, '0');

// code: a mnemonic of FX_CODES and wert 0..255, or code null (remove the entries of the cell). ort.fxspalte is the effect column 0..3.
export function fxSetzen(p, ort, code, wert) {
  const k = kontext(p, ort);
  if (k.fehler) return k;
  const spalte = ort.fxspalte ?? 0;
  if (!Number.isInteger(spalte) || spalte < 0 || spalte > FX_MAX_SPALTE) return fehler('Effect commands stand in the first four effect columns');
  const alt = fxImFeld(k, spalte);
  if (code === null) return alt.length === 0 ? null : { label: 'Clear cell', befehle: fxBefehle(fxLoeschen(alt)) };
  if (!FX_CODES.includes(code)) return fehler(`Unknown effect: ${String(code).toUpperCase()} (${FX_CODES.join(' ')})`);
  if (!Number.isInteger(wert) || wert < 0 || wert > 255) return fehler('Effect value 00..FF expected');
  const clip = clipUeber(k.spur, k.linie);
  if (!clip) return fehler(GRUND_KEIN_CLIP);
  if (clip.fehler) return clip;
  const beat = r9(k.linie - clip.start_beat);
  if (alt.length === 1 && alt[0].clip === clip && Math.abs(alt[0].e.beat - beat) <= EPS && alt[0].e.code === code && alt[0].e.wert === wert) return null;
  const weg = alt.filter(({ clip: c, e }) => c !== clip || Math.abs(e.beat - beat) > EPS);   // an off-line entry of the cell goes, the new one stands on the row line
  return { label: `Effect ${code} ${hex2(wert)}`, befehle: fxBefehle([...fxLoeschen(weg), { clip, eintrag: { beat, spalte, code, wert } }]) };
}

export function zelleLeeren(p, ort) {
  const k = kontext(p, ort);
  if (k.fehler) return k;
  const u = ort.unterspalte ?? 'note';
  if (ort.fxspalte !== undefined || u === 'fx') {
    const fx = k.sp.fxspalten[ort.fxspalte ?? 0]?.[k.zeile];
    if (!fx) return null;
    if (fx.kurve) return fehler('Drawn curve: edit it in PRODUCTION');
    if (fx.code !== undefined) return fxSetzen(p, ort, null, 0);
    return knopfEntfernen(k, fx.knopf);
  }
  if (u === 'vol') return fehler('Velocity cannot be cleared');
  if (u === 'dly' || u === 'chn' || u === 'rpt' || u === 'ins') {
    const r = wertSetzen(p, { ...ort, unterspalte: u }, u, null);
    return r && !r.fehler ? { ...r, label: 'Clear cell' } : r;
  }
  if (u !== 'note') return fehler(`Unknown column ${String(u)}`);
  const col = spaltenNoten(p, k);
  const eigene = col.find((n) => n.abschnitt === k.ab.id && n.zeile === k.zeile) ?? null;
  const aus = k.sp.notenspalten[k.c]?.[k.zeile]?.aus ?? null;
  const sam = sammler();
  // the note that ran into the deleted note (or the note off) lasts up to the next start of the column, at most to its clip end
  const verlaengere = (n) => {
    const next = col.find((x) => x !== eigene && x.klang > n.klang + EPS);
    const ende = Math.min(next ? next.klang : Infinity, n.kopieEnde);
    if (ende > n.ende + EPS) sam.aendern(n.clip_id, n.id, { laenge: r9(ende - n.klang) });
  };
  if (eigene) {
    sam.loeschen(eigene.clip_id, eigene.id);
    const prev = [...col].reverse().find((n) => n !== eigene && n.klang < eigene.klang - EPS);
    if (prev && prev.ende >= eigene.klang - EPS) verlaengere(prev);
  } else if (aus) {
    const a = col.find((n) => n.id === aus.note_id);
    if (a) verlaengere(a);
  }
  const befehle = sam.befehle();
  // R10: a clip whose last note goes and that holds nothing else (no effect commands, no clip envelopes) is removed, with its linked copies
  // (they share the content and would be empty too), so that clearing a track in the tracker leaves no empty clip in every section
  if (eigene) {
    const clip = k.spur.clips.find((c) => c.id === eigene.clip_id);
    if (clip && (clip.noten ?? []).length === 1 && !(clip.fx ?? []).length && !(clip.huellkurven ?? []).length) {
      const weg = clip.verbund ? k.spur.clips.filter((c) => c.verbund === clip.verbund) : [clip];
      for (const c of weg) befehle.push({ befehl: 'clip_loeschen', clip_id: c.id });
    }
  }
  return befehle.length === 0 ? null : { label: 'Clear cell', befehle };
}

// --- pull up / push down ---------------------------------------------------------------------------------------------------------------------
// Only the note column of the cell changes. Pull up deletes the notes written in the row and moves the later ones of the section one row up
// (a note sounding across the row is cut by the row); push down moves them one row down (a note sounding across the row gets longer), what
// passes the end of the section or of its clip is deleted (D8), `verworfen` counts it.
function verschieben(p, ort, ein) {
  const k = kontext(p, ort);
  if (k.fehler) return k;
  const col = spaltenNoten(p, k);
  const sam = sammler();
  let verworfen = 0;
  for (const n of col) {
    const imAb = n.abschnitt === k.ab.id;
    if (!ein) {
      if (imAb && n.zeile === k.zeile) sam.loeschen(n.clip_id, n.id);
      else if (imAb && n.zeile > k.zeile) {
        const beat = r9(n.beat - k.zl);
        if (beat < -EPS) return fehler(`A note of clip ${n.clip_id} cannot move up: the clip starts at its row`);
        sam.aendern(n.clip_id, n.id, { beat: Math.max(0, beat) });
      } else if (n.klang < k.linie - EPS && n.ende > k.linie + EPS) {
        const ende = n.ende > k.linie + k.zl + EPS ? n.ende - k.zl : k.linie;
        sam.aendern(n.clip_id, n.id, { laenge: r9(ende - n.klang) });
      }
    } else if (imAb && n.zeile >= k.zeile) {
      const beat = r9(n.beat + k.zl);
      if (n.schrift - k.ab.von_beat + k.zl >= k.ab.laenge_beats - EPS || beat >= n.kopieEnde - n.clip.start_beat - EPS) { sam.loeschen(n.clip_id, n.id); verworfen += 1; }
      else sam.aendern(n.clip_id, n.id, { beat });
    } else if (n.klang < k.linie - EPS && n.ende > k.linie + EPS) {
      const laenge = r9(Math.min(n.laenge + k.zl, n.kopieEnde - n.klang));
      if (laenge > n.laenge + EPS) sam.aendern(n.clip_id, n.id, { laenge });
    }
  }
  const befehle = sam.befehle();
  if (befehle.length === 0) return null;
  return { label: ein ? 'Push down' : 'Pull up', befehle, ...(ein ? { verworfen } : {}) };
}
export const zeileEntfernen = (p, ort) => verschieben(p, ort, false);
export const zeileEinfuegen = (p, ort) => verschieben(p, ort, true);

// --- knob values ---------------------------------------------------------------------------------------------------------------------------
// a jump point (form sprung) of geraet.k<knopf> at the row line; the whole point list of that envelope is written (huellkurve_setzen)
export function knopfWert(p, ort, knopf, wert) {
  const k = kontext(p, ort);
  if (k.fehler) return k;
  if (!Number.isInteger(knopf) || knopf < 1 || knopf > 64) return fehler('Knob 1..64 expected');
  if (wert === null) return knopfEntfernen(k, knopf);
  if (!Number.isInteger(wert) || wert < 0 || wert > 255) return fehler('Knob value 00..FF expected');
  const clip = clipUeber(k.spur, k.linie);
  if (!clip) return fehler(GRUND_KEIN_CLIP);
  if (clip.fehler) return clip;
  const ziel = `geraet.k${knopf}`;
  const hk = (clip.huellkurven ?? []).find((h) => h.ziel === ziel);
  if (hk && !hk.punkte.every((q) => q.form === 'sprung' && !zeileVon(clip.start_beat + q.beat - k.ab.von_beat, k.lpb).schief)) {
    return fehler(`Knob ${knopf} has a drawn curve in this clip: edit it in PRODUCTION`);
  }
  const rel = r9(k.linie - clip.start_beat);
  const alt = (hk?.punkte ?? []).filter((q) => Math.abs(q.beat - rel) <= EPS);
  if (alt.length > 0 && wertZuByte(alt[alt.length - 1].wert) === wert) return null;
  const punkte = (hk?.punkte ?? []).filter((q) => Math.abs(q.beat - rel) > EPS).map((q) => ({ ...q }));
  punkte.push({ beat: rel, wert: byteZuWert(wert), form: 'sprung' });
  punkte.sort((a, b) => a.beat - b.beat);                  // stable: points at equal beats keep their order
  return { label: `Knob ${knopf}`, befehle: [{ befehl: 'huellkurve_setzen', clip_id: clip.id, ziel, punkte,
    ...(hk?.verknuepft === false ? { verknuepft: false } : {}), ...(hk?.loop_beats !== undefined ? { loop_beats: hk.loop_beats } : {}) }] };
}
