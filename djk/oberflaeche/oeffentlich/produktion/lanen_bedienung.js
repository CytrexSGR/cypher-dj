// PRODUCTION (Automation Slice 1 + 2, AK28): the gestures on a lane row. A pure gesture object (LaneGeste, node-testable) and the wiring to the page
// (bindeLanen). One gesture is ONE command auto_punkte (D9): nothing is sent while the pointer moves (the page shows a draft), exactly one command goes
// out on pointerup. A twitch below ZUG_SCHWELLE px changes nothing (lesson S7 R2).
import { rasterBeats, xZuBeat, beatZuX } from './zeitachse.js';
import { zeilenTabelle, laneZeile, zeileBei } from './layout.js';
import { trefferPunkt, ziehePunkt, setzePunkt, ZUG_SCHWELLE, gezeigteLane, laneMitId, yZuWert, wertZuY, laneWert, bereich, laneSchutz, MAX_PUNKTE } from './lanen.js';

export const LANEN_TEXT = {
  titel: 'Automation',
  neu: '+ Lane',
  neu_titel: 'Add a lane for another target to this track',
  weg_titel: 'Delete the shown lane of this track',
  wahl_titel: 'Target of the shown lane',
  knopf_titel: 'Show automation lanes of this track',
  auto: 'AUTO',
  auto_titel: 'A volume line controls this fader while the project plays',
  voll: 'The line is full: delete a point first',
  gesten: 'Edit automation line',
  neu_label: 'Add automation lane',
  weg_label: 'Delete automation lane',
  sperre: 'Lock the lane: no gesture, hand command or recording can change it',
  entsperre: 'Unlock the lane',
  sperre_label: 'Lock automation lane',
  entsperre_label: 'Unlock automation lane',
  gesperrt: 'That line is locked: unlock it first',
  unbekannt: 'This lane type is not supported by this page',
};

const formFeld = (p) => (p.form && p.form !== 'linear' ? { form: p.form } : {});
const punktFeld = (p) => ({ beat: p.beat, wert: p.wert, ...formFeld(p) });
// a point on a switch lane (mute, solo) is always a jump: only `sprung` points are sent
const mitForm = (lane, p) => (bereich(lane.ziel).nurSprung ? { ...p, form: 'sprung' } : p);

// The command that moves point i of the lane to ziel = {beat, wert}. The range at the old beat is deleted first (both ends inclusive) and the moved point
// is set; a partner point at the same old beat (the other half of a jump) is set again, because the delete takes it along.
export function zugBefehl(lane, i, ziel) {
  const alt = lane.punkte[i];
  const partner = lane.punkte.filter((q, k) => k !== i && q.beat === alt.beat).map(punktFeld).map((p) => mitForm(lane, p));
  return { befehl: 'auto_punkte', lane_id: lane.id, loesche_von: alt.beat, loesche_bis: alt.beat, setze: [mitForm(lane, { ...punktFeld(alt), beat: ziel.beat, wert: ziel.wert }), ...partner] };
}
// The command that deletes point i (its partner at the same beat stays)
export function loeschBefehl(lane, i) {
  const alt = lane.punkte[i];
  if (lane.punkte.length <= 1) return null;
  const partner = lane.punkte.filter((q, k) => k !== i && q.beat === alt.beat).map(punktFeld).map((p) => mitForm(lane, p));
  return { befehl: 'auto_punkte', lane_id: lane.id, loesche_von: alt.beat, loesche_bis: alt.beat, ...(partner.length ? { setze: partner } : {}) };
}
export const neuBefehl = (lane, beat, wert) => ({ befehl: 'auto_punkte', lane_id: lane.id, setze: [mitForm(lane, { beat, wert })] });
// The lock button: one auto_aendern (slice 2, E4)
export const sperrBefehl = (lane) => ({ befehl: 'auto_aendern', lane_id: lane.id, gesperrt: !lane.gesperrt });

// One gesture on the lane row. ctx: { lane, zeile, beatZuX, xZuBeat, raster }.
//   down(x, y)  -> 'punkt' (a point was hit) | 'leer' (free place) | 'gesperrt' (the lane is locked: the gesture does nothing at all)
//   move(x, y)  -> the draft command while dragging, or null (below the threshold, or no point hit)
//   up()        -> { befehle: [...] } with exactly the commands to send (one, or none)
export class LaneGeste {
  constructor(ctx) { this.c = ctx; this.x0 = 0; this.y0 = 0; this.i = -1; this.gezogen = false; this.entwurf = null; this.ende = null; }
  down(x, y) {
    this.x0 = x; this.y0 = y; this.gezogen = false; this.entwurf = null; this.ende = null;
    if (laneSchutz(this.c.lane)) { this.i = -1; return 'gesperrt'; }
    this.i = trefferPunkt(this.c.lane.punkte, this.c.zeile, this.c.beatZuX, x, y, this.c.lane.ziel);
    return this.i >= 0 ? 'punkt' : 'leer';
  }
  move(x, y) {
    if (laneSchutz(this.c.lane) || this.i < 0) return null;
    if (!this.gezogen && Math.hypot(x - this.x0, y - this.y0) < ZUG_SCHWELLE) return null;
    this.gezogen = true;
    const z = ziehePunkt(this.c.lane.punkte, this.i, this.c.xZuBeat(x), yZuWert(this.c.zeile, y, this.c.lane.ziel), this.c.raster, this.c.lane.ziel);
    this.ende = z;
    this.entwurf = zugBefehl(this.c.lane, this.i, z);
    return this.entwurf;
  }
  up(x, y) {
    const schutz = laneSchutz(this.c.lane);
    if (schutz) return { befehle: [], hinweis: LANEN_TEXT[schutz] };
    if (this.i >= 0) return { befehle: this.gezogen && this.entwurf ? [this.entwurf] : [], hinweis: null };
    if (Math.hypot(x - this.x0, y - this.y0) >= ZUG_SCHWELLE) return { befehle: [], hinweis: null };   // a drag in the empty: nothing
    const ziel = this.c.lane.ziel, beat = this.c.xZuBeat(x);
    if (bereich(ziel).nurSprung) return this.kippe(beat);
    const neu = setzePunkt(this.c.lane.punkte, beat, yZuWert(this.c.zeile, y, ziel), this.c.raster, ziel);
    if (!neu) return { befehle: [], hinweis: LANEN_TEXT.voll };
    const p = neu.punkte[neu.index];
    if (this.c.lane.punkte.some((q) => q.beat === p.beat)) return { befehle: [], hinweis: null };   // a set point would replace the point at its beat: not by a click
    return { befehle: [neuBefehl(this.c.lane, p.beat, p.wert)], hinweis: null };
  }
  // A click on a switch lane (mute, solo) flips the level from the clicked beat on. The level is read at the SNAPPED beat (the beat the point gets). A point
  // already at that beat is replaced (one point per beat, never a third). Before the first point the first level holds to the left, so a click there
  // adds a point at beat 0 with the old level: only [click, first point) flips.
  kippe(beat) {
    const { lane, raster } = this.c, pk = lane.punkte, ziel = lane.ziel;
    const gerastet = setzePunkt(pk, beat, 0, raster, ziel);
    if (!gerastet) return { befehle: [], hinweis: LANEN_TEXT.voll };
    const b = gerastet.punkte[gerastet.index].beat, alt = Math.round(laneWert(pk, b, ziel));
    const setze = [mitForm(lane, { beat: b, wert: 1 - alt })];
    if (pk.length > 0 && b < pk[0].beat && b > 0) {
      if (pk.length + 2 > MAX_PUNKTE) return { befehle: [], hinweis: LANEN_TEXT.voll };
      setze.unshift(mitForm(lane, { beat: 0, wert: alt }));
    }
    return { befehle: [{ befehl: 'auto_punkte', lane_id: lane.id, setze }], hinweis: null };
  }
}

// Wiring to the page. The lane rows live on the surface of the arrangement ('flaeche'); a pointer event whose y lies in a lane row is ours, every other
// one goes on to the clip handling (this binder is registered before bindeClips).
export function bindeLanen(ctx) {
  const { st, $ } = ctx;
  const flaeche = $('flaeche'), ueber = $('ueber');
  let auswahl = null;                         // {laneId, beat}: the point Entf deletes
  const tabelle = () => zeilenTabelle(st.projekt?.spuren.length ?? 0, ctx.offeneLanen());
  const laneAn = (e) => {
    if (!st.projekt || e.target !== ueber) return null;
    const z = zeileBei(tabelle(), e.offsetY);
    if (!z || z.art !== 'lane') return null;
    const spur = (st.projektEntwurf ?? st.projekt).spuren[z.spur], lane = gezeigteLane(spur, st.laneZiel?.get(spur.id));
    return lane ? { z, spur, lane } : { z, spur, lane: null };
  };
  const geste = (t) => new LaneGeste({ lane: t.lane, zeile: t.z, beatZuX: (b) => beatZuX(st.ansicht, b), xZuBeat: (x) => xZuBeat(st.ansicht, x), raster: rasterBeats(st.raster) });
  flaeche.addEventListener('pointerdown', (e) => {
    const t = laneAn(e);
    if (!t || e.button !== 0) return;
    e.stopImmediatePropagation();
    if (!t.lane) return;
    const schutz = laneSchutz(t.lane);
    if (schutz) { ctx.melde(LANEN_TEXT[schutz], true); return; }   // locked or unknown target: no gesture, nothing is sent
    ueber.focus({ preventScroll: true });
    const g = geste(t), art = g.down(e.offsetX, e.offsetY);
    auswahl = art === 'punkt' ? { laneId: t.lane.id, beat: t.lane.punkte[g.i].beat, index: g.i } : null;
    const zug = ctx.zug.beginne();
    ueber.setPointerCapture(e.pointerId);
    const bewege = (m) => {
      const b = g.move(m.offsetX, m.offsetY);
      if (b) zug.bewege(() => ({ label: LANEN_TEXT.gesten, befehle: [b] }));
    };
    const los = () => { ueber.removeEventListener('pointermove', bewege); ueber.removeEventListener('pointerup', ende); ueber.removeEventListener('pointercancel', abbruch); };
    const abbruch = () => { los(); zug.verwirf(); };
    const ende = (m) => {
      los();
      const r = g.up(m.offsetX, m.offsetY);
      if (r.hinweis) ctx.melde(r.hinweis, true);
      if (r.befehle.length === 0) { zug.verwirf(); return; }
      zug.bewege(() => ({ label: LANEN_TEXT.gesten, befehle: r.befehle }));
      zug.lass();
    };
    ueber.addEventListener('pointermove', bewege);
    ueber.addEventListener('pointerup', ende);
    ueber.addEventListener('pointercancel', abbruch);
  }, true);
  ueber.addEventListener('dblclick', (e) => {
    const t = laneAn(e);
    if (!t) return;
    e.stopImmediatePropagation();
    if (!t.lane || laneSchutz(t.lane)) return;
    const i = trefferPunkt(t.lane.punkte, t.z, (b) => beatZuX(st.ansicht, b), e.offsetX, e.offsetY, t.lane.ziel);
    const b = i >= 0 ? loeschBefehl(t.lane, i) : null;
    if (b) ctx.aendere(LANEN_TEXT.gesten, [b]);
  }, true);
  ueber.addEventListener('keydown', (e) => {
    if ((e.key !== 'Delete' && e.key !== 'Backspace') || !auswahl || !st.projekt) return;
    const lane = laneMitId(st.projekt, auswahl.laneId)?.lane;
    const i = lane && !laneSchutz(lane) ? lane.punkte.findIndex((q) => q.beat === auswahl.beat) : -1;
    const b = i >= 0 ? loeschBefehl(lane, i) : null;
    if (!b) return;
    e.preventDefault(); e.stopImmediatePropagation();
    auswahl = null;
    ctx.aendere(LANEN_TEXT.gesten, [b]);
  }, true);

  // Overlay: the selected point
  const g2 = ueber.getContext('2d');
  ctx.beimBild.push(() => {
    const p = st.projektEntwurf ?? st.projekt;
    if (!p || !auswahl) return;
    const spur = p.spuren.findIndex((s) => (s.automation ?? []).some((l) => l.id === auswahl.laneId));
    const z = spur >= 0 ? laneZeile(tabelle(), spur) : null, lane = spur >= 0 ? laneMitId(p, auswahl.laneId)?.lane : null;
    const q = lane?.punkte.find((x) => x.beat === auswahl.beat);
    if (!z || !q || gezeigteLane(p.spuren[spur], st.laneZiel?.get(p.spuren[spur].id))?.id !== lane.id) return;
    g2.strokeStyle = '#ffffff'; g2.lineWidth = 2;
    g2.beginPath(); g2.arc(beatZuX(st.ansicht, q.beat), wertZuY(z, q.wert, lane.ziel), 6, 0, Math.PI * 2); g2.stroke(); g2.lineWidth = 1;
  });
}
