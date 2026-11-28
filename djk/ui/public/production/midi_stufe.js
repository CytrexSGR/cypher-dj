// MIDI FX strip of an instrument track (strand 7, task 1.5): pure part. Values of the controls from a track, the body of `midi_stufe_setzen`
// for a control change. The strip edits the project field `Spur.midi` (project/model.ts, MidiStufe); the other stages of the object stay as they are.
import { SKALEN, SKALA_TEXT, TON_NAMEN } from '../harmonie.js';

export const MIDI_STUFE_TEXT = {
  titel: 'MIDI FX',
  an: 'On', aus: 'Off',
  an_titel: 'Switch the whole MIDI FX chain on or off (settings are kept)',
  arp: 'Arp', arp_titel: 'Switch the arpeggiator on or off',
  muster: 'Pattern', rate: 'Rate', hz: 'Hz', oktaven: 'Octaves', gate: 'Gate',
  frei: 'Free',
  label: 'MIDI FX',
  akkord: 'Chord', akkord_titel: 'Add chord tones to every note (section on = stage active)',
  akkord_aus: 'Off', akkord_frei: 'Custom', akkord_frei_titel: 'Intervals in semitones, e.g. 4 7 11 (-24..24, not 0, up to 6)',
  skala: 'Scale', skala_titel: 'Fit every note to a scale (section on = stage active)',
  skala_projekt: 'Project key', skala_eigene: 'Root + scale',
  velocity: 'Velocity', velocity_titel: 'Shape the velocity (section on = stage active)',
  kurve: 'Curve', zufall: 'Random', fest: 'Fixed', fest_aus: 'Off',
  chance: 'Chance', chance_titel: 'Play each note with this probability (section on = stage active)',
  saat: 'Seed', saat_titel: 'Draw a new random seed (random, chance and velocity random)',
};
export const AKKORD_VORGABEN = [
  ['major', 'Major', [4, 7]], ['minor', 'Minor', [3, 7]], ['sus2', 'Sus2', [2, 7]], ['sus4', 'Sus4', [5, 7]],
  ['7', '7', [4, 7, 10]], ['m7', 'm7', [3, 7, 10]], ['maj7', 'maj7', [4, 7, 11]], ['power', 'Power (5th)', [7]], ['oktave', 'Octave', [12]],
];
export const AKKORD_AUS = 'aus', AKKORD_FREI = 'frei';
export const SKALA_WAHL = Object.keys(SKALEN).map((k) => [k, SKALA_TEXT[k]]);
export const GRUNDTON_WAHL = TON_NAMEN.map((t, i) => [String(i), t]);
export const SAAT_MAX = 4294967295;
export const ARP_MUSTER_WAHL = [['up', 'Up'], ['down', 'Down'], ['updown', 'Up-Down'], ['downup', 'Down-Up'], ['played', 'As Played'], ['random', 'Random'], ['chord', 'Chord']];
export const ARP_RATE_WAHL = [['1/2', '1/2'], ['1/4', '1/4'], ['1/4t', '1/4T'], ['1/8', '1/8'], ['1/8t', '1/8T'], ['1/16', '1/16'], ['1/16t', '1/16T'], ['1/32', '1/32']];
export const RATE_FREI = 'frei';
export const HZ_MIN = 0.5, HZ_MAX = 40, GATE_MIN = 5, GATE_MAX = 100;
const ARP_VORGABE = { muster: 'up', sync: true, rate: '1/16', oktaven: 1, gate: 0.5 };
const HZ_VORGABE = 8;

/** The track carries a MIDI stage only on instrument tracks. */
export const kannMidiStufe = (spur) => spur?.art === 'instrument';

/** Control values of a track: { aus, arpAn, muster, rate ('1/16'.. or 'frei'), hz, oktaven, gate (percent) }. Without a stage: chain on, arp off, defaults. */
export function stufeVonSpur(spur) {
  const m = spur?.midi, a = m?.arp, v = a ?? ARP_VORGABE;
  return {
    aus: m?.aus === true,
    arpAn: !!a,
    muster: v.muster,
    rate: v.sync === false ? RATE_FREI : v.rate,
    hz: v.sync === false ? v.hz : HZ_VORGABE,
    oktaven: v.oktaven,
    gate: Math.round(v.gate * 100),
  };
}

const klemme = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** The arp object of the values (the project shape: sync true with `rate`, or sync false with `hz`). */
function arpVon(w) {
  const gate = klemme(w.gate, GATE_MIN, GATE_MAX) / 100, oktaven = klemme(Math.round(w.oktaven), 1, 4);
  return w.rate === RATE_FREI
    ? { muster: w.muster, sync: false, hz: klemme(w.hz, HZ_MIN, HZ_MAX), oktaven, gate }
    : { muster: w.muster, sync: true, rate: w.rate, oktaven, gate };
}

/**
 * The command for the values of the controls. `bisher` is the stage object the track has now (other stages stay in it); the result replaces it.
 * Returns { befehl, spur_id, midi } or null when there is nothing to send (no stage left and not bypassed: the object is removed, `midi: null`).
 */
export function koerper(spurId, w, bisher = null) {
  const m = {};
  for (const k of Object.keys(bisher ?? {})) if (k !== 'aus' && k !== 'arp') m[k] = structuredClone(bisher[k]);
  if (w.arpAn) m.arp = arpVon(w);
  kettenStufen(w, bisher, m);
  const stufen = Object.keys(m).some((k) => k !== 'saat');
  if (w.aus && stufen) m.aus = true;
  return { befehl: 'midi_stufe_setzen', spur_id: spurId, midi: stufen ? m : null };
}

/** Undo step label of a gesture. */
export const midiStufeLabel = (was) => `${MIDI_STUFE_TEXT.label}: ${was}`;

/** The suffix of the track head device label: ' · ARP' while an arp is on and the chain is not bypassed. */
export const arpKopfText = (spur) => (spur?.midi?.arp && spur.midi.aus !== true ? ' · ARP' : '');


// --- Chord, Scale, Velocity, Chance, Seed (task 3.2). The page writes such a stage only while its section is on. ---

/** Intervals from custom text ('4 7 11' or '4, 7, 11'): a list that passes the project check, or null. */
export function intervalleLesen(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  const iv = t.split(/[\s,;]+/).map(Number);
  if (iv.length < 1 || iv.length > 6 || iv.some((v) => !Number.isInteger(v) || v < -24 || v > 24 || v === 0) || new Set(iv).size !== iv.length) return null;
  return iv;
}

const gleichListe = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Chain control values of a track: chord (menu key 'aus', a preset key or 'frei', custom text), scale, velocity, chance, seed. */
export function kettenVonSpur(spur) {
  const m = spur?.midi, iv = m?.akkord?.intervalle, sk = m?.skala, v = m?.velocity;
  const vorgabe = iv ? AKKORD_VORGABEN.find((p) => gleichListe(p[2], iv)) : null;
  const eigene = sk && !sk.quelle ? sk : { grundton: 0, skala: 'minor' };
  return {
    akkord: iv ? (vorgabe ? vorgabe[0] : AKKORD_FREI) : AKKORD_AUS,
    akkordText: iv ? iv.join(' ') : '',
    skalaAn: !!sk, skalaQuelle: sk?.quelle === 'projekt' ? 'projekt' : 'eigene', grundton: eigene.grundton, skala: eigene.skala,
    velAn: !!v, kurve: v?.kurve ?? 0, zufall: v?.zufall ?? 0, fest: v?.fest ?? 0,
    chanceAn: m?.chance !== undefined, chance: m?.chance ?? 100,
    saat: m?.saat ?? 0,
  };
}

/** A new seed: integer 0..4294967295 (`zufall` returns [0,1)). */
export const neueSaat = (zufall = Math.random) => Math.floor(zufall() * (SAAT_MAX + 1));

/** The chain stages of the values, as members of the stage object. Members of `w` that are undefined leave the stage of `bisher` as it is. */
function kettenStufen(w, bisher, m) {
  if (w.akkord !== undefined) {
    delete m.akkord;
    const iv = w.akkord === AKKORD_AUS ? null
      : w.akkord === AKKORD_FREI ? intervalleLesen(w.akkordText) ?? bisher?.akkord?.intervalle ?? null
      : AKKORD_VORGABEN.find((p) => p[0] === w.akkord)?.[2] ?? null;
    if (iv) m.akkord = { intervalle: [...iv] };
  }
  if (w.skalaAn !== undefined) {
    delete m.skala;
    if (w.skalaAn) {
      m.skala = w.skalaQuelle === 'projekt' ? { quelle: 'projekt' }
        : { grundton: klemme(Math.round(w.grundton ?? 0), 0, 11), skala: Object.hasOwn(SKALEN, w.skala) ? w.skala : 'minor' };
    }
  }
  if (w.velAn !== undefined) {
    delete m.velocity;
    if (w.velAn) {
      m.velocity = { kurve: klemme(Number(w.kurve) || 0, -1, 1), zufall: klemme(Math.round(Number(w.zufall) || 0), 0, 64) };
      const fest = Math.round(Number(w.fest) || 0);
      if (fest >= 1) m.velocity.fest = klemme(fest, 1, 127);
    }
  }
  if (w.chanceAn !== undefined) {
    delete m.chance;
    if (w.chanceAn) m.chance = klemme(Math.round(Number.isFinite(Number(w.chance)) ? Number(w.chance) : 100), 0, 100);
  }
  if (w.saat !== undefined) {
    delete m.saat;
    const n = Math.round(Number(w.saat) || 0);
    if (n >= 1) m.saat = klemme(n, 1, SAAT_MAX);
  }
}
