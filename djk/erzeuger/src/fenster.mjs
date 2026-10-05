// Ereignisse eines Muster-Plans im Beat-Fenster [a, b) und die Teilung auf Bundles (Plan 2026-09-27).
// 1 Zyklus = 1 Takt = 4 Beats (wie proben/06-erzeuger-muster/uhr/sender.mjs).
import { noteFuer } from './kit.mjs';
import { SCOPE } from './strudel.mjs';
import { ERZ_PARAMETER } from '../../vertrag/osc_adressen.ts';

// Scheibe 3 (§4.8 Parameter-Schwanz): Strudel-Felder, die als Paar (nr, wert) an /erz/ev gehen, mit ihrer Vorgabe.
// Ein neuer Parameter ist hier eine Zeile und im Kern ein case; der Vertrag bekommt nur einen Code.
const PARAMETER = [['begin', 0], ['end', 1]];
// Strudel-Felder, die der Erzeuger heute versteht (Rest wird gemeldet, nicht still verschluckt)
const BEKANNT = new Set(['s', 'n', 'gain', 'velocity', 'note', 'freq', ...PARAMETER.map(([k]) => k)]);

// Bundle-Rechnung in Bytes (§2: höchstens 1 400): Kopf 16, /erz/fenster 4 + 68, /erz/ev 4 + 56 + 10 je Paar
// (Typen-Zeichenkette auf 4 Bytes gerundet). Ein /erz/ev ohne Schwanz: 60 Bytes.
export const BUNDLE_MAX = 1400;
export const EV_BUDGET = BUNDLE_MAX - 16 - (4 + 68);
export const evGroesse = (e) => {
  const k = e.param?.length ?? 0;
  return 4 + 8 + ((8 + 2 * k + 4) & ~3) + 36 + 8 * k;
};

// Studio S5: MIDI-Note aus einem Strudel-Wert (note als Zahl oder Name, freq, sonst n ohne s); außerhalb 0..127 → null.
export function midiNote(v) {
  if (v == null || typeof v !== 'object') return null;
  let x = v.note ?? (v.freq != null ? SCOPE.freqToMidi(Number(v.freq)) : (v.s == null ? v.n : undefined));
  if (typeof x === 'string') x = SCOPE.noteToMidi(x);
  x = Math.round(Number(x));
  return Number.isInteger(x) && x >= 0 && x <= 127 ? x : null;
}

export function ereignisse(plan, kit, a, b) {
  const evs = [];
  const unbekannt = new Set();
  const felder = new Set();
  for (let k = 0; k < plan.length; k++) {
    const sa = Math.max(a, plan[k].ab);
    const sb = Math.min(b, k + 1 < plan.length ? plan[k + 1].ab : Infinity);
    if (sa >= sb || !plan[k].muster) continue;
    for (const h of plan[k].muster.queryArc(sa / 4, sb / 4)) {
      if (!h.hasOnset()) continue;
      const beat = Number(h.whole.begin) * 4;
      if (beat < sa - 1e-9 || beat >= sb - 1e-9) continue;
      const note = kit?.midi ? midiNote(h.value) : noteFuer(kit, h.value);
      if (note == null) {
        unbekannt.add(String(h.value?.s ?? JSON.stringify(h.value)));
        continue;
      }
      const g = kit?.midi   // Studio S5: wie Strudels MIDI-Ausgabe (midi.mjs:387): velocity (0,9) × gain
        ? Number(h.value?.velocity ?? 0.9) * Number(h.value?.gain ?? 1)
        : Number(h.value?.gain ?? h.value?.velocity ?? 1);
      const param = [];
      for (const [name, vorgabe] of PARAMETER) {
        const w = Number(h.value?.[name]);
        if (Number.isFinite(w) && w !== vorgabe) param.push([ERZ_PARAMETER[name], w]);
      }
      if (h.value && typeof h.value === 'object') for (const f of Object.keys(h.value)) if (!BEKANNT.has(f) && !f.startsWith('_')) felder.add(f);  // _slices u. a.: Strudel-intern
      evs.push({ beat, note, dauer: Number(h.whole.end - h.whole.begin) * 4,
        velocity: Math.min(1, Math.max(0, Number.isFinite(g) ? g : 1)), muster: plan[k].nr, param });
    }
  }
  evs.sort((x, y) => x.beat - y.beat || x.note - y.note);
  return { evs, unbekannt, felder };
}

// [a, b) in lückenlose Teilfenster, deren /erz/ev zusammen höchstens budget Bytes haben; geschnitten wird nur zwischen
// verschiedenen Beats.
export function teile(evs, a, b, budget = EV_BUDGET) {
  const out = [];
  let ab = a;
  let i = 0;
  while (i < evs.length) {
    let j = i;
    let summe = 0;
    let schnitt = -1;  // letzter Index, vor dem geschnitten werden darf (Beatwechsel)
    while (j < evs.length && summe + evGroesse(evs[j]) <= budget) {
      summe += evGroesse(evs[j]);
      ++j;
      if (j < evs.length && evs[j].beat !== evs[j - 1].beat) schnitt = j;
    }
    if (j === evs.length) break;
    if (schnitt <= i) throw new Error(`Ereignisse passen auf Beat ${evs[i].beat} nicht in ein Bundle`);
    out.push({ ab, bis: evs[schnitt].beat, evs: evs.slice(i, schnitt) });
    ab = evs[schnitt].beat;
    i = schnitt;
  }
  out.push({ ab, bis: b, evs: evs.slice(i) });
  return out;
}
