// PRODUCTION (1.12 automation slice 5, plan PLAN-1.12-slices4-5-7.md U10): the ENVELOPES tab of the detail area, pure parts (browser and node).
// A clip envelope is edited like a lane row with the clip as the time frame: the points are normalised to 0..1 of the row (HK_ANZEIGE), the lane
// gestures (LaneGeste, lanePfad of lanes.js) run on that plain 0..1 frame, and every gesture becomes ONE huellkurve_setzen with the whole point list.
// The page does not import server code: HK_ANZEIGE copies the ranges of project/envelope.ts (HK_BEREICH) and a test compares both.
import { lanePfad, punkteNach } from './lanes.js';
import { LaneGeste } from './lanes_operation.js';

// min/max: the stored range; anzeigeMin: the bottom of the row (the gain row shows -60..0 dB like a fader lane, lower values sit at the bottom)
export const HK_ANZEIGE = {
  gain: { min: -200, max: 0, anzeigeMin: -60, label: 'Gain', einheit: 'dB' },
  transpose: { min: -48, max: 48, anzeigeMin: -48, label: 'Transpose', einheit: 'st' },
  spur_fader: { min: -60, max: 6, anzeigeMin: -60, label: 'Track Volume', einheit: 'dB' },
  spur_pan: { min: -2, max: 2, anzeigeMin: -2, label: 'Track Pan', einheit: '' },
  'geraet.cutoff': { min: -1, max: 1, anzeigeMin: -1, label: 'Cutoff', einheit: '' },
  'geraet.resonanz': { min: -1, max: 1, anzeigeMin: -1, label: 'Resonance', einheit: '' },
  'geraet.env_mod': { min: -1, max: 1, anzeigeMin: -1, label: 'Env Mod', einheit: '' },
  'geraet.lautstaerke': { min: -1, max: 1, anzeigeMin: -1, label: 'Device Volume', einheit: '' },
  'geraet.k1': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 1', einheit: '' },
  'geraet.k2': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 2', einheit: '' },
  'geraet.k3': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 3', einheit: '' },
  'geraet.k4': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 4', einheit: '' },
  'geraet.k5': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 5', einheit: '' },
  'geraet.k6': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 6', einheit: '' },
  'geraet.k7': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 7', einheit: '' },
  'geraet.k8': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 8', einheit: '' },
  'geraet.k9': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 9', einheit: '' },
  'geraet.k10': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 10', einheit: '' },
  'geraet.k11': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 11', einheit: '' },
  'geraet.k12': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 12', einheit: '' },
  'geraet.k13': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 13', einheit: '' },
  'geraet.k14': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 14', einheit: '' },
  'geraet.k15': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 15', einheit: '' },
  'geraet.k16': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 16', einheit: '' },
  'geraet.k17': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 17', einheit: '' },
  'geraet.k18': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 18', einheit: '' },
  'geraet.k19': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 19', einheit: '' },
  'geraet.k20': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 20', einheit: '' },
  'geraet.k21': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 21', einheit: '' },
  'geraet.k22': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 22', einheit: '' },
  'geraet.k23': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 23', einheit: '' },
  'geraet.k24': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 24', einheit: '' },
  'geraet.k25': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 25', einheit: '' },
  'geraet.k26': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 26', einheit: '' },
  'geraet.k27': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 27', einheit: '' },
  'geraet.k28': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 28', einheit: '' },
  'geraet.k29': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 29', einheit: '' },
  'geraet.k30': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 30', einheit: '' },
  'geraet.k31': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 31', einheit: '' },
  'geraet.k32': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 32', einheit: '' },
  'geraet.k33': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 33', einheit: '' },
  'geraet.k34': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 34', einheit: '' },
  'geraet.k35': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 35', einheit: '' },
  'geraet.k36': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 36', einheit: '' },
  'geraet.k37': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 37', einheit: '' },
  'geraet.k38': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 38', einheit: '' },
  'geraet.k39': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 39', einheit: '' },
  'geraet.k40': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 40', einheit: '' },
  'geraet.k41': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 41', einheit: '' },
  'geraet.k42': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 42', einheit: '' },
  'geraet.k43': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 43', einheit: '' },
  'geraet.k44': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 44', einheit: '' },
  'geraet.k45': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 45', einheit: '' },
  'geraet.k46': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 46', einheit: '' },
  'geraet.k47': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 47', einheit: '' },
  'geraet.k48': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 48', einheit: '' },
  'geraet.k49': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 49', einheit: '' },
  'geraet.k50': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 50', einheit: '' },
  'geraet.k51': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 51', einheit: '' },
  'geraet.k52': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 52', einheit: '' },
  'geraet.k53': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 53', einheit: '' },
  'geraet.k54': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 54', einheit: '' },
  'geraet.k55': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 55', einheit: '' },
  'geraet.k56': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 56', einheit: '' },
  'geraet.k57': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 57', einheit: '' },
  'geraet.k58': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 58', einheit: '' },
  'geraet.k59': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 59', einheit: '' },
  'geraet.k60': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 60', einheit: '' },
  'geraet.k61': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 61', einheit: '' },
  'geraet.k62': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 62', einheit: '' },
  'geraet.k63': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 63', einheit: '' },
  'geraet.k64': { min: -1, max: 1, anzeigeMin: -1, label: 'Knob 64', einheit: '' },
};
export const HK_TEXT = {
  reiter_clip: 'CLIP',
  reiter_noten: 'NOTES',
  reiter_hk: 'ENVELOPES',
  ziel_titel: 'Envelope target of this clip',
  verknuepft: 'LINKED',
  verknuepft_titel: 'Linked: the envelope repeats with every loop of the clip. Off: it repeats with its own loop length',
  loop: 'LOOP',
  loop_titel: 'Loop length of an unlinked envelope in beats (1/16 up to the clip length), for example 1/2 or 2',
  loop_ungueltig: 'Loop length: 1/16 beat up to the clip length (for example 1/2 or 2)',
  nur_frei: 'Only an unlinked envelope has its own loop length',
  weg: 'Delete envelope',
  weg_titel: 'Delete the envelope of this target from the clip',
  hilfe: 'Click: add a point · drag: move · double click: delete · right click: curve',
  label: 'Edit clip envelope',
  verknuepft_label: 'Link clip envelope',
  frei_label: 'Unlink clip envelope',
  loop_label: 'Clip envelope loop',
  weg_label: 'Delete clip envelope',
};
const LANE_ZIEL = 'geraet.cutoff';                 // a plain 0..1 lane frame of lanes.js: the row of a normalised envelope
const GERAET = ['geraet.cutoff', 'geraet.resonanz', 'geraet.env_mod', 'geraet.lautstaerke'];
const BK_KNOEPFE = Array.from({ length: 64 }, (_, i) => `geraet.k${i + 1}`);   // 1.12 slice 7
const istRb = (spur) => spur?.art === 'instrument' && spur.geraet?.art === 'intern' && spur.geraet.name === 'rb338';
const istBk = (spur) => spur?.art === 'instrument' && spur.geraet?.art === 'intern' && spur.geraet.name === 'bk';
// T10.1: the targets of a clip in menu order (gain on audio, transpose on MIDI, the device targets on MIDI clips of RB-338 tracks (four) and bk tracks (knobs 1 to 64))
export function hkZiele(clip, spur) {
  if (clip?.art === 'audio') return ['gain', 'spur_fader', 'spur_pan'];
  return ['transpose', 'spur_fader', 'spur_pan', ...(istRb(spur) ? GERAET : istBk(spur) ? BK_KNOEPFE : [])];
}

const runde = (x) => Math.round(x * 1000) / 1000;
const norm = (wert, ziel) => { const { max, anzeigeMin } = HK_ANZEIGE[ziel]; return Math.min(1, Math.max(0, (wert - anzeigeMin) / (max - anzeigeMin))); };
export const normiert = (punkte, ziel) => punkte.map((q) => ({ ...q, wert: norm(q.wert, ziel) }));
const kopf = (clip, hk, ziel) => ({ befehl: 'huellkurve_setzen', clip_id: clip.id, ziel,
  ...(hk?.verknuepft === false ? { verknuepft: false } : {}), ...(hk?.loop_beats !== undefined ? { loop_beats: hk.loop_beats } : {}) });
// The huellkurve_setzen of one lane gesture command (auto_punkte on the normalised row): the command is applied to the stored points; a set point
// takes its value back from 0..1, unless it is an untouched stored point (its normalised value unchanged), which keeps its exact value. null: nothing.
export function hkBefehl(clip, hk, laneBefehl, ziel = hk?.ziel) {
  if (!laneBefehl) return null;
  const alt = hk?.punkte ?? [];
  const { max, anzeigeMin } = HK_ANZEIGE[ziel];
  const zurueck = (q) => {
    const war = alt.find((x) => x.beat === q.beat && norm(x.wert, ziel) === q.wert);
    return { ...q, wert: war ? war.wert : runde(anzeigeMin + q.wert * (max - anzeigeMin)) };
  };
  const b = { ...laneBefehl, ...(laneBefehl.setze ? { setze: laneBefehl.setze.map(zurueck) } : {}) };
  const punkte = punkteNach(alt, b);
  return punkte.length ? { ...kopf(clip, hk, ziel), punkte } : null;
}
// T10.3: one gesture on the envelope row. ctx: { clip, hk (or null), ziel, zeile, beatZuX, xZuBeat (clip beats), raster }. up() -> { befehle, hinweis }.
export function hkGeste(ctx) {
  const lane = { id: 'hk', ziel: LANE_ZIEL, punkte: normiert(ctx.hk?.punkte ?? [], ctx.ziel) };
  const g = new LaneGeste({ lane, zeile: ctx.zeile, beatZuX: ctx.beatZuX, xZuBeat: ctx.xZuBeat, raster: ctx.raster });
  return {
    down: (x, y) => g.down(x, y),
    move: (x, y) => hkBefehl(ctx.clip, ctx.hk, g.move(x, y), ctx.ziel),
    up: (x, y) => {
      const r = g.up(x, y);
      return { befehle: r.befehle.map((b) => hkBefehl(ctx.clip, ctx.hk, b, ctx.ziel)).filter(Boolean), hinweis: r.hinweis };
    },
    get i() { return g.i; },
    lane,
  };
}
export const hkPfad = (hk, zeile, beatZuX, xZuBeat, breite) => lanePfad(normiert(hk.punkte, hk.ziel), zeile, beatZuX, xZuBeat, breite, LANE_ZIEL);

// T10.2: LINKED on or off (off gets an own loop: 4 beats or the clip length when shorter); the LOOP field of an unlinked envelope
export function verknuepftBefehl(clip, hk, an) {
  const { befehl, clip_id, ziel } = kopf(clip, hk, hk.ziel);
  if (an) return { befehl, clip_id, ziel, punkte: hk.punkte };
  return { befehl, clip_id, ziel, punkte: hk.punkte, verknuepft: false, loop_beats: Math.min(4, clip.laenge_beats) };
}
const zahlAus = (t) => {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+(?:\.\d+)?))?\s*$/.exec(String(t));
  if (!m) return NaN;
  return m[2] === undefined ? Number(m[1]) : Number(m[1]) / Number(m[2]);
};
export function loopBefehl(clip, hk, text) {
  if (hk.verknuepft !== false) return { fehler: HK_TEXT.nur_frei };
  const v = zahlAus(text);
  if (!Number.isFinite(v) || v < 1 / 16 || v > clip.laenge_beats + 1e-9) return { fehler: HK_TEXT.loop_ungueltig };
  if (v === hk.loop_beats) return {};
  return { befehl: { ...kopf(clip, hk, hk.ziel), punkte: hk.punkte, loop_beats: v } };
}
export const loopText = (v) => (v < 1 && Number.isInteger(1 / v) ? `1/${1 / v}` : String(v));

// T10.4: page state of the tab: which tab is open (kept when another clip is chosen) and the chosen target per clip
export class HkWahl {
  constructor() { this.reiter = 'clip'; this.proClip = new Map(); }
  setzeReiter(r) { this.reiter = r; }
  waehle(clipId, ziel) { this.proClip.set(clipId, ziel); }
  ziel(clip, spur) {
    const erlaubt = hkZiele(clip, spur), gewaehlt = this.proClip.get(clip.id);
    if (erlaubt.includes(gewaehlt)) return gewaehlt;
    return (clip.huellkurven ?? []).map((h) => h.ziel).find((z) => erlaubt.includes(z)) ?? erlaubt[0];
  }
}
