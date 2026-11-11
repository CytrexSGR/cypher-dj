// PRODUCTION (Automation Slice 1 + 2, AK28): the lanes of a track as a row under the track (one target at a time). Pure functions (browser and node): evaluation (the same
// formula as the core arr_auto.h and the server project/lane.ts, bound by core/tests/data/lane_ref.json), the drawing path, hit testing, and the limits
// of a drag. The gestures live in lanes_operation.js.
import { posVonDb, dbVonPos } from './fader_curve.js';
import { ARTEN, parameterNamen, parameterVon, parameterLabel, makroFaehig, gemapptVon } from './inserts.js';
export const LANE_HOEHE = 48;
export const WERT_MIN = -200, WERT_MAX = 6;          // project limits of the fader (dB); -200 is mute
export const ANZEIGE_MIN = -60;                      // the fader row runs from off (bottom edge) to +6 dB on the fader taper (fader_curve.js); -60 dB sits at 5 % of the height

// Slice 2 (E1, E2): the targets of a lane. The page does not import server code: this table is a copy of ZIEL_BEREICH in project/model.ts and a test
// compares both. min/max: the project limits; anzeigeMin: the bottom edge of the row (only the fader shows less than its range); mittellinie: the guide
// line (0 dB for the fader, the centre for pan); nurSprung: a switch (0 or 1, its points are always `sprung`). The key order is the order of the menu.
export const ZIEL_ANZEIGE = {
  fader: { min: WERT_MIN, max: WERT_MAX, anzeigeMin: ANZEIGE_MIN, label: 'Volume', nurSprung: false, mittellinie: 0 },
  pan: { min: -1, max: 1, anzeigeMin: -1, label: 'Pan', nurSprung: false, mittellinie: 0 },
  mute: { min: 0, max: 1, anzeigeMin: 0, label: 'Mute', nurSprung: true, mittellinie: null },
  solo: { min: 0, max: 1, anzeigeMin: 0, label: 'Solo', nurSprung: true, mittellinie: null },
  'geraet.lautstaerke': { min: 0, max: 1, anzeigeMin: 0, label: 'Device Volume', nurSprung: false, mittellinie: null },
  'geraet.cutoff': { min: 0, max: 1, anzeigeMin: 0, label: 'Cutoff', nurSprung: false, mittellinie: null },
  'geraet.resonanz': { min: 0, max: 1, anzeigeMin: 0, label: 'Resonance', nurSprung: false, mittellinie: null },
  'geraet.env_mod': { min: 0, max: 1, anzeigeMin: 0, label: 'Env Mod', nurSprung: false, mittellinie: null },
  // 1.12 slice 7: the eight knobs of a Baukasten (bk) track
  'geraet.k1': { min: 0, max: 1, anzeigeMin: 0, label: 'Knob 1', nurSprung: false, mittellinie: null },
  'geraet.k2': { min: 0, max: 1, anzeigeMin: 0, label: 'Knob 2', nurSprung: false, mittellinie: null },
  'geraet.k3': { min: 0, max: 1, anzeigeMin: 0, label: 'Knob 3', nurSprung: false, mittellinie: null },
  'geraet.k4': { min: 0, max: 1, anzeigeMin: 0, label: 'Knob 4', nurSprung: false, mittellinie: null },
  'geraet.k5': { min: 0, max: 1, anzeigeMin: 0, label: 'Knob 5', nurSprung: false, mittellinie: null },
  'geraet.k6': { min: 0, max: 1, anzeigeMin: 0, label: 'Knob 6', nurSprung: false, mittellinie: null },
  'geraet.k7': { min: 0, max: 1, anzeigeMin: 0, label: 'Knob 7', nurSprung: false, mittellinie: null },
  'geraet.k8': { min: 0, max: 1, anzeigeMin: 0, label: 'Knob 8', nurSprung: false, mittellinie: null },
};
export const ZIELE = Object.keys(ZIEL_ANZEIGE);
// 1.12 slice 6: the targets of a lane on an insert stage (`insert.<stage id>.<param>`) or a rack macro (`rack.m1..m4`) of the strip. Their range comes from the
// stage's parameter (inserts.js, bound to the contract by tests/production_inserts.test.mjs), so it depends on the project: `setzeKettenZiele(projekt)` (called
// whenever the page takes a project) fills the table that `bereich` reads; a chain target not in it is unknown and its lane is shown dimmed and locked.
// Same pattern as the server regex in project/model.ts (KETTEN_ZIEL).
export const KETTEN_ZIEL = /^(?:insert\.[A-Za-z][A-Za-z0-9_-]{0,31}\.[a-z0-9_]{1,16}(?:\/[a-z0-9_]{1,16})?|rack\.m[1-4])$/;
export const istKettenZiel = (ziel) => typeof ziel === 'string' && KETTEN_ZIEL.test(ziel);
const kettenAnzeige = (q, label) => ({ min: q.min, max: q.max, anzeigeMin: q.min, label, nurSprung: false, mittellinie: null, einheit: q.einheit ?? '' });
// every chain target the project's strips can carry a lane for now (continuous parameters of built-in stages, the four macros of a rack), as a table ziel -> display
export function kettenZieleVon(strang) {
  const aus = new Map();
  (strang?.inserts ?? []).forEach((st, pos) => {
    if (st.art === 'host') return;
    for (const name of parameterNamen(st.art)) {
      const q = parameterVon(st.art, name);
      if (makroFaehig(q)) aus.set(`insert.${st.id}.${name}`, { ...kettenAnzeige(q, `${ARTEN[st.art].kurz} ${pos + 1} · ${parameterLabel(st.art, name)}`), insert: st.id, param: name });
    }
  });
  if (strang?.rack) for (let m = 1; m <= 4; m++) aus.set(`rack.m${m}`, kettenAnzeige({ min: 0, max: 1, einheit: '' }, `Macro ${m}`));
  return aus;
}
let kettenZiele = new Map();
export function setzeKettenZiele(projekt) {
  const neu = new Map();
  const straenge = [...(projekt?.spuren ?? []), ...(projekt?.gruppen ?? []), ...(projekt?.returns ?? []), ...(projekt?.master ? [projekt.master] : [])];
  for (const st of straenge) for (const [z, d] of kettenZieleVon(st)) if (!neu.has(z)) neu.set(z, d);
  kettenZiele = neu;
}
// The range of a target. The target is a REQUIRED argument of every geometry function (a forgotten one throws instead of silently applying the dB rule).
// A target this page does not know (a newer server) gets a plain 0..1 frame and `unbekannt: true`: the lane is shown dimmed and cannot be edited.
export function bereich(ziel) {
  if (typeof ziel !== 'string') throw new TypeError(`lane target expected, got ${typeof ziel}`);
  return ZIEL_ANZEIGE[ziel] ?? kettenZiele.get(ziel) ?? { min: 0, max: 1, anzeigeMin: 0, label: ziel, nurSprung: false, mittellinie: null, unbekannt: true };
}
export const unbekanntesZiel = (lane) => !!lane && !(lane.ziel in ZIEL_ANZEIGE) && !kettenZiele.has(lane.ziel);
// A lane no gesture may change: locked, or of a target this page does not know. The reason is the hint text key of LANEN_TEXT.
export const laneSchutz = (lane) => (lane?.gesperrt ? 'gesperrt' : unbekanntesZiel(lane) ? 'unbekannt' : null);
export const zielLabel = (ziel) => ZIEL_ANZEIGE[ziel]?.label ?? kettenZiele.get(ziel)?.label ?? String(ziel);
export const istGeraetZiel = (ziel) => typeof ziel === 'string' && ziel.startsWith('geraet.');
// does the device of this track own the device target? (the rule of passtGeraetZiel in project/model.ts: RB-338 four parameters, bk the knobs k1..k8)
export const passtGeraetZiel = (ziel, spur) => {
  const g = spur?.art === 'instrument' && spur.geraet?.art === 'intern' ? spur.geraet.name : null;
  return g === 'rb338' ? /^geraet\.(lautstaerke|cutoff|resonanz|env_mod)$/.test(ziel) : g === 'bk' ? /^geraet\.k[1-8]$/.test(ziel) : false;
};
export const MAX_BEAT = 100_000;                     // = project/model.ts MAX_BEAT
export const MAX_PUNKTE = 8192;                      // per lane
export const PUNKT_RADIUS = 5;                       // hit radius of a point in px
export const ZUG_SCHWELLE = 3;                       // px: a twitch of the hand moves nothing
export const NACHBAR_ABSTAND = 1 / 16;               // a dragged point stops this far from its neighbour (beats)
const STUMM_WERT = -200;
const STUMM = -200, STUMM_GRENZE = -120, STUMM_RAMPE = -60;
const FORMEN = ['linear', 's', 'sprung'];

// Value of the lane in dB at the project beat: before the first point the first value holds, after the last point the last one. Between two points the
// form of the right one decides (linear | s: 3u^2 - 2u^3 | sprung: the left value holds up to the beat of the right point); two points at one beat make a
// jump. Mute rule like the mixer, ONLY for the fader (it is a dB rule): a ramp from or to a point at or below -120 dB runs towards -60, the point itself is
// exact. Every other target interpolates plainly.
export function laneWert(punkte, beat, ziel) {
  bereich(ziel);                                   // the target is required
  const n = punkte.length;
  if (n === 0) return 0;
  if (!(beat >= punkte[0].beat)) return punkte[0].wert;
  let lo = 0, hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (punkte[mid].beat <= beat) lo = mid; else hi = mid - 1;
  }
  const a = punkte[lo];
  if (lo === n - 1 || beat === a.beat) return a.wert;
  const b = punkte[lo + 1];
  const form = b.form ?? 'linear';
  if (form === 'sprung') return a.wert;
  const u = (beat - a.beat) / (b.beat - a.beat);
  const g = form === 's' ? u * u * (3 - 2 * u) : u;
  let va = a.wert, vb = b.wert;
  if (ziel !== 'fader') return va + (vb - va) * g;
  if (va <= STUMM_GRENZE && vb > STUMM_GRENZE) va = Math.min(STUMM_RAMPE, vb);
  if (vb <= STUMM_GRENZE) vb = va <= STUMM_GRENZE ? STUMM : Math.min(STUMM_RAMPE, va);
  return va + (vb - va) * g;
}

// value <-> y inside a lane row (zeile = {y, h}); 3 px of air above and below
const LUFT = 3;
export const wertZuY = (zeile, wert, ziel) => {
  const { min, max, anzeigeMin } = bereich(ziel);
  // the fader row uses the fader taper (the same as the slider of the track head); every other target is linear
  const t = ziel === 'fader' ? posVonDb(Math.min(max, Math.max(min, wert))) : (Math.min(max, Math.max(anzeigeMin, wert)) - anzeigeMin) / (max - anzeigeMin);
  return zeile.y + LUFT + (1 - t) * (zeile.h - 2 * LUFT);
};
// a switch (mute, solo) has two levels: the upper half of the row is 1, the lower half 0
export const yZuWert = (zeile, y, ziel) => {
  const { min, max, anzeigeMin, nurSprung } = bereich(ziel);
  const t = 1 - (y - zeile.y - LUFT) / (zeile.h - 2 * LUFT);
  // the fader: back through the taper. On the lane the axis ends at -60 dB: the bottom 5 % band is -60, never off; off (-200) only at or below the very bottom edge (t <= 0)
  const w = ziel === 'fader' ? (t <= 0 ? STUMM_WERT : Math.max(ANZEIGE_MIN, dbVonPos(Math.min(1, t)))) : Math.min(max, Math.max(min, anzeigeMin + t * (max - anzeigeMin)));
  if (ziel === 'fader') return w;
  return nurSprung ? (w >= 0.5 ? 1 : 0) : w;
};

// Polyline of the lane over the pixel columns 0..breite as [[x, y], ...]: a sample every 2 px plus the points themselves, so that a jump (two points at
// one beat) is a vertical edge. beatZuX / xZuBeat: the view of the time axis.
export function lanePfad(punkte, zeile, beatZuX, xZuBeat, breite, ziel) {
  if (punkte.length === 0) return [];
  const nurSprung = bereich(ziel).nurSprung;
  const stuetz = [];                              // [beat, wert-left, wert-right]
  for (let x = 0; x <= breite; x += 2) { const b = xZuBeat(x), w = laneWert(punkte, b, ziel); stuetz.push([b, w, w]); }
  const b0 = xZuBeat(0), b1 = xZuBeat(breite);
  for (let k = 0; k < punkte.length; k++) {
    const p = punkte[k];
    if (p.beat < b0 || p.beat > b1) continue;
    const links = k > 0 && punkte[k - 1].beat === p.beat;         // second point of a jump: the first one is drawn with it
    if (links) continue;
    const rechts = k + 1 < punkte.length && punkte[k + 1].beat === p.beat ? punkte[k + 1].wert : p.wert;
    // a switch changes its level exactly at the point: the edge is vertical, not a slope over the last 2 px column
    const vorher = nurSprung && k > 0 ? punkte[k - 1].wert : p.wert;
    stuetz.push([p.beat, nurSprung ? vorher : p.wert, rechts]);
  }
  stuetz.sort((a, b) => a[0] - b[0]);
  const pfad = [];
  for (const [b, links, rechts] of stuetz) {
    const x = beatZuX(b);
    pfad.push([x, wertZuY(zeile, links, ziel)]);
    if (rechts !== links) pfad.push([x, wertZuY(zeile, rechts, ziel)]);
  }
  return pfad;
}

// Which point lies under (x, y)? The nearest within PUNKT_RADIUS wins; -1 if none. beatZuX as above.
export function trefferPunkt(punkte, zeile, beatZuX, x, y, ziel) {
  let best = -1, bestD = PUNKT_RADIUS * PUNKT_RADIUS + 1;
  for (let i = 0; i < punkte.length; i++) {
    const dx = beatZuX(punkte[i].beat) - x, dy = wertZuY(zeile, punkte[i].wert, ziel) - y, d = dx * dx + dy * dy;
    if (d < bestD) { best = i; bestD = d; }
  }
  return best;
}

const klemme = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const runde = (x, n = 1e6) => Math.round(x * n) / n;
const gerastet = (beat, raster) => (raster > 0 ? Math.round(beat / raster) * raster : beat);

// The value of a drag or a new point: inside the range of the target; a switch takes only 0 or 1
const wertKlemmt = (wert, ziel) => {
  const { min, max, nurSprung } = bereich(ziel);
  const w = klemme(wert, min, max);
  return nurSprung ? (w >= 0.5 ? 1 : 0) : runde(w, 1e3);
};

// The new position of the dragged point i: raster on the beat, the range of the target (the fader: -200..+6 dB) and 0..MAX_BEAT, and it never passes its neighbours: it stops
// NACHBAR_ABSTAND before or after them (the order of the points never changes by a drag).
export function ziehePunkt(punkte, i, beat, wert, raster, ziel) {
  const lo = i > 0 ? punkte[i - 1].beat + NACHBAR_ABSTAND : 0;
  const hi = i < punkte.length - 1 ? punkte[i + 1].beat - NACHBAR_ABSTAND : MAX_BEAT;
  return { beat: runde(klemme(gerastet(beat, raster), Math.min(lo, hi), Math.max(lo, hi))), wert: wertKlemmt(wert, ziel) };
}

// A new point at (beat, wert) on a free place: the lane after the insertion, sorted by beat (a new point goes after an old one at the same beat), and the
// index of the new point. null when the lane is full.
export function setzePunkt(punkte, beat, wert, raster, ziel) {
  if (punkte.length >= MAX_PUNKTE) return null;
  const b = runde(klemme(gerastet(beat, raster), 0, MAX_BEAT)), w = wertKlemmt(wert, ziel);
  let i = punkte.length;
  while (i > 0 && punkte[i - 1].beat > b) i--;
  const neu = [...punkte.slice(0, i), { beat: b, wert: w }, ...punkte.slice(i)];
  return { punkte: neu, index: i };
}

// Delete point i; the last point of a lane cannot be deleted (a lane has at least one point; the whole lane goes with auto_loeschen)
export const loeschePunkt = (punkte, i) => (punkte.length <= 1 || i < 0 || i >= punkte.length ? null : punkte.filter((_, k) => k !== i));

export const formGueltig = (f) => FORMEN.includes(f);
// 1.12 S3 task 5: the lane line turns orange while the hand overrides its field (list: auto_uebersteuert of the server). UEBER_FARBE is the one source of
// the orange: production.js writes it into the CSS variable --ueber, the stylesheet only uses var(--ueber).
export const UEBER_FARBE = '#ff8a1f';
export const laneLinienFarbe = (farbe, liste, spurId, ziel) => (Array.isArray(liste) && liste.some((x) => x.spur_id === spurId && x.ziel === ziel) ? UEBER_FARBE : farbe);
// the lane of a track for one target, or null
export const laneFuer = (spur, ziel) => (spur?.automation ?? []).find((l) => l.ziel === ziel) ?? null;
export const faderLane = (spur) => laneFuer(spur, 'fader');
// does a lane of this track play right now? (shows AUTO at the fader of the track head)
export const hatLane = (spur) => faderLane(spur) !== null;
// The lane the open row shows: the chosen target if the track has it, else the volume lane (as in slice 1), else the first lane, else null.
// wahl: the target the user picked (page state, not in the project).
export const gezeigteLane = (spur, wahl) => laneFuer(spur, wahl) ?? faderLane(spur) ?? (spur?.automation ?? [])[0] ?? null;
// The targets a track can still get a lane for, in menu order: no target twice, `geraet.*` only on a track whose device owns the parameter (RB-338: four, bk: knobs 1 to 8)
// 1.12 slice 6: then the chain targets of the track's own stages and rack that have no lane and are not driven by a macro (one writer per parameter)
export const freieZiele = (spur) => [
  ...ZIELE.filter((z) => !laneFuer(spur, z) && (!istGeraetZiel(z) || passtGeraetZiel(z, spur))),
  ...[...kettenZieleVon(spur)].filter(([z, d]) => !laneFuer(spur, z) && (d.insert === undefined || gemapptVon(spur, d.insert, d.param) === null)).map(([z]) => z),
];
// the lane with this id in the project, with its track, or null
export function laneMitId(projekt, id) {
  for (const spur of projekt?.spuren ?? []) { const lane = (spur.automation ?? []).find((l) => l.id === id); if (lane) return { spur, lane }; }
  return null;
}

// The effect of one auto_punkte command on a point list (the same rule as project/commands.ts: first delete the range, both ends inclusive and each end
// optional, then set; a set point replaces every point at its beat; the result is sorted by beat, stable). Used for the draft while a point is dragged.
export function punkteNach(punkte, befehl) {
  const von = befehl.loesche_von, bis = befehl.loesche_bis, setze = befehl.setze ?? [];
  const imBereich = (q) => (von !== undefined || bis !== undefined) && (von === undefined || q.beat >= von) && (bis === undefined || q.beat <= bis);
  const bleibt = punkte.filter((q) => !imBereich(q) && !setze.some((n) => n.beat === q.beat));
  return [...bleibt, ...setze].map((q, i) => ({ q, i })).sort((x, y) => x.q.beat - y.q.beat || x.i - y.i).map((x) => x.q);
}

// Indices of the tracks whose lane row is open. offen: a Set of track ids kept in the page state (not in the project: it survives a reload of the
// project from the server, and a track that is gone simply drops out).
export const offeneIndizes = (projekt, offen) => (projekt && offen && offen.size ? projekt.spuren.flatMap((s, i) => (offen.has(s.id) ? [i] : [])) : []);

// 1.12 slice 4 (D2): the handles of a selected range {von, bis} on a lane row. A strip of GRIFF_BREITE px around either edge in the top band of the row
// (GRIFF_OBEN px) is the skew handle; the same strip at the right edge below that band is the stretch handle. null: no handle under (x, y).
export const GRIFF_BREITE = 5, GRIFF_OBEN = 8;
export function bereichGriff(wahl, zeile, beatZuX, x, y) {
  if (!wahl || y < zeile.y || y > zeile.y + zeile.h) return null;
  const xl = beatZuX(wahl.von), xr = beatZuX(wahl.bis), oben = y <= zeile.y + GRIFF_OBEN;
  if (oben && (Math.abs(x - xl) <= GRIFF_BREITE || Math.abs(x - xr) <= GRIFF_BREITE)) return 'neigen';
  if (!oben && Math.abs(x - xr) <= GRIFF_BREITE) return 'dehnen';
  return null;
}

// 1.12 slice 4 (D1): the points of a freehand stroke. pfad: the pointer samples [{x, beat, wert}] in drawing order. Grid on (raster > 0): one point per
// grid step from the first to the last step the stroke touches, with the value of the sample nearest to the step, form `sprung` (a staircase like the
// draw mode of Live). Grid off: one linear point per 2 px of pointer travel, sorted by beat (a later sample at the same beat wins). Values are clamped to
// the target range. bestehend: the lane points now; the stroke replaces those in [von, bis], the others count against MAX_PUNKTE: beyond it, null.
export function freihandPunkte(pfad, raster, ziel, bestehend = []) {
  if (!pfad.length) return null;
  const beatVon = (b) => runde(klemme(b, 0, MAX_BEAT));
  let punkte;
  if (raster > 0) {
    const beats = pfad.map((q) => q.beat), k0 = Math.round(Math.min(...beats) / raster), k1 = Math.round(Math.max(...beats) / raster);
    punkte = [];
    for (let k = k0; k <= k1; k++) {
      const g = beatVon(k * raster);
      let best = pfad[0];
      for (const q of pfad) if (Math.abs(q.beat - g) < Math.abs(best.beat - g)) best = q;
      punkte.push({ beat: g, wert: wertKlemmt(best.wert, ziel), form: 'sprung' });
    }
  } else {
    const gewaehlt = [pfad[0]];
    for (const q of pfad) if (Math.abs(q.x - gewaehlt[gewaehlt.length - 1].x) >= 2) gewaehlt.push(q);
    const proBeat = new Map();
    for (const q of gewaehlt) proBeat.set(beatVon(q.beat), wertKlemmt(q.wert, ziel));
    punkte = [...proBeat].sort((a, b) => a[0] - b[0]).map(([beat, wert]) => ({ beat, wert }));
  }
  const von = punkte[0].beat, bis = punkte[punkte.length - 1].beat;
  const aussen = bestehend.filter((q) => q.beat < von || q.beat > bis).length;
  return punkte.length + aussen > MAX_PUNKTE ? null : { von, bis, punkte };
}
