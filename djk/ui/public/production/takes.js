// 1.14 Comping, slice 1, task 7: take rows on the production page. Pure functions (browser and node): which take rows are visible, the copy rule of the
// derived highlight (spec R6) and the body of the audition request (R8). The row geometry is layout.js (zeilenTabelle), the heads takes_operation.js.
// Page words: "take lane" for the user, `take` in the code, never `lane` (that word means automation on this page).
import { warpAn } from './warp.js';

export const TAKE_TEXT = {
  knopf_titel: 'Show the take lanes of this track',
  hoeren_titel: 'Audition this take (click again to go back to the track)',
  hoeren_label: 'Audition',
  name_titel: 'Double click, Enter or F2 to rename the take lane',
  name_label: 'Take lane name',
  umbenennen: 'Rename take lane',
  loeschen: 'Delete take lane',
  ganz: 'Use Whole Lane',                 // 1.14 slice 4 (spec D2): comp_waehlen over the lane's clip hull, the restore after a bounce in place
  ganz_leer: 'The take lane is empty',
};

const EPS = 1e-6;                         // beats, R6 (splits round to 1e-9 per step)

export const hatTakes = (spur) => (spur?.art === 'audio' || spur?.art === 'instrument') && Array.isArray(spur.takes) && spur.takes.length > 0;

// Track index -> number of take rows shown. The T button state lives in the page (st.takeOffen, a Set of spur ids, like st.laneOffen); a project without
// takes (every old file) gives an empty Map, so the row table is the one of today. projekt: the state that is drawn (the draft while a gesture runs).
export function takeZeilenVon(st, projekt = st?.projekt) {
  const m = new Map(), offen = st?.takeOffen;
  if (!offen || !offen.size) return m;
  (projekt?.spuren ?? []).forEach((s, i) => { if (offen.has(s.id) && hatTakes(s)) m.set(i, s.takes.length); });
  return m;
}

// Strand 7 (D10), mirrors project/takes.ts: notes as absolute tuples [beat, ton, vel, laenge]; a loop clip is unrolled over its span.
function absoluteNoten(c) {
  const aus = [], ende = c.start_beat + c.laenge_beats, l = c.loop_beats ?? null;
  for (let k = 0; ; k++) {
    const schub = l === null ? 0 : k * l;
    if (l === null ? k > 0 : schub >= c.laenge_beats - 1e-9) break;
    for (const n of c.noten ?? []) {
      const b = c.start_beat + schub + n.beat;
      if (n.beat >= (l ?? c.laenge_beats) - 1e-9 || b >= ende - 1e-9) continue;
      aus.push([b, n.ton, n.vel, n.laenge]);
    }
  }
  return aus;
}
const nachNote = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3];
function notenImBereich(c, von, bis) {
  const ende = Math.min(bis, c.start_beat + c.laenge_beats);
  return absoluteNoten(c).filter(([b]) => b >= von - 1e-9 && b < bis - 1e-9).map(([b, ton, vel, l]) => [b, ton, vel, Math.min(l, ende - b)]).sort(nachNote);
}
// The main clip holds, over its own span, the same absolute notes the take holds there (lengths cut at the end of the main clip).
function istMidiTakeKopie(haupt, take) {
  const von = haupt.start_beat, bis = haupt.start_beat + haupt.laenge_beats;
  const x = notenImBereich(haupt, von, bis), y = notenImBereich(take, von, bis);
  return x.length === y.length && x.every((a, i) => a.every((v, k) => Math.abs(v - y[i][k]) <= EPS));
}

const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Is the main clip a copy of (a part of) the take clip, same material at the same place on the take's own timeline? R6, mirrors project/takes.ts istTakeKopie:
// same sha; main.start_beat - take.start_beat == (main.offset_s - take.offset_s) * bpm / 60 within 1e-6 beats. Warp clips (both warped, equal markers)
// compare versatz_beats instead of offset_s; a warp on one side only is no copy; loop clips never count. Ranges are not looked at here (genutzteBereiche).
export function istTakeKopie(haupt, take, bpm) {
  if (haupt?.art === 'midi' && take?.art === 'midi') return istMidiTakeKopie(haupt, take);   // strand 7 D10
  if (haupt?.art !== 'audio' || take?.art !== 'audio') return false;
  if (haupt.quelle?.sha256 !== take.quelle?.sha256) return false;
  if (haupt.loop_beats || take.loop_beats) return false;
  const abstand = haupt.start_beat - take.start_beat;
  if (warpAn(haupt) !== warpAn(take)) return false;
  if (warpAn(haupt)) return gleich(haupt.warp.marker, take.warp.marker) && Math.abs(abstand - (haupt.warp.versatz_beats - take.warp.versatz_beats)) <= EPS;
  return Math.abs(abstand - ((haupt.offset_s - take.offset_s) * bpm) / 60) <= EPS;
}

// The regions of the take lanes the main lane uses right now: [{take_id, von, bis}] in beats, derived (R6), never stored. Per take in the order of
// spur.takes, regions ascending; regions of one take that touch are merged. A moved main clip simply stops matching.
export function genutzteBereiche(spur, bpm) {
  const aus = [];
  for (const take of spur?.takes ?? []) {
    const teile = [];
    for (const tc of take.clips ?? []) {
      for (const mc of spur.clips ?? []) {
        if (!istTakeKopie(mc, tc, bpm)) continue;
        const von = Math.max(mc.start_beat, tc.start_beat), bis = Math.min(mc.start_beat + mc.laenge_beats, tc.start_beat + tc.laenge_beats);
        if (bis > von) teile.push([von, bis]);
      }
    }
    teile.sort((a, b) => a[0] - b[0]);
    const reihe = [];
    for (const t of teile) {
      const l = reihe.at(-1);
      if (l && t[0] <= l[1] + 1e-9) l[1] = Math.max(l[1], t[1]); else reihe.push([...t]);
    }
    for (const [von, bis] of reihe) aus.push({ take_id: take.id, von, bis });
  }
  return aus;
}

// Body of POST /proj/take_vorhoeren (R8): the lit take is switched off, any other one on. vorhoeren: {spur_id: take_id} from /proj/aktuell
export const vorhoerenKoerper = (vorhoeren, spurId, takeId) => ({ spur_id: spurId, take_id: vorhoeren?.[spurId] === takeId ? null : takeId });
