// PRODUCTION (Automation Slice 1 + 2, AK28): the gestures on a lane row. A pure gesture object (LaneGeste, node-testable) and the wiring to the page
// (bindeLanen). One gesture is ONE command auto_punkte (D9): nothing is sent while the pointer moves (the page shows a draft), exactly one command goes
// out on pointerup. A twitch below ZUG_SCHWELLE px changes nothing (lesson S7 R2).
import { rasterBeats, xZuBeat, beatZuX } from './zeitachse.js';
import { zeilenTabelle, laneZeile, zeileBei } from './layout.js';
import { takeZeilenVon } from './takes.js';
import { trefferPunkt, ziehePunkt, setzePunkt, ZUG_SCHWELLE, gezeigteLane, laneMitId, yZuWert, wertZuY, laneWert, bereich, laneSchutz, MAX_PUNKTE } from './lanen.js';
import { bereichGriff, freihandPunkte, MAX_BEAT, NACHBAR_ABSTAND } from './lanen.js';
import { oeffneMenue } from './kontextmenue.js';
import { istTextFeld } from './verlauf_anzeige.js';

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
  // 1.12 slice 4: range, menus, handles
  form_linear: 'Linear',
  form_s: 'S-curve',
  form_sprung: 'Jump',
  nur_sprung: 'Mute and solo lines always jump',
  einfuegen: 'Insert shape',
  rampe_auf: 'Ramp up',
  rampe_ab: 'Ramp down',
  sinus: 'Sine',
  dreieck: 'Triangle',
  rechteck: 'Square',
  vereinfachen: 'Simplify',
  punkte_weg: 'Delete points',
  form_label: 'Change automation curve',
  einfuegen_label: 'Insert automation shape',
  vereinfachen_label: 'Simplify automation',
  punkte_weg_label: 'Delete automation points',
  dehnen_label: 'Stretch automation',
  neigen_label: 'Skew automation',
  zeichnen: 'DRAW',
  zeichnen_titel: 'Draw mode (B): drag on a lane to draw the line freehand',
  zeichnen_label: 'Draw automation',
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

// 1.12 slice 4 (D2): the form of the segment INTO point i; its partner at the same beat is set again (zugBefehl), linear is sent without a form key
export function formBefehl(lane, i, form) {
  const b = zugBefehl(lane, i, lane.punkte[i]);
  const { beat, wert } = b.setze[0];
  b.setze[0] = form === 'linear' ? { beat, wert } : { beat, wert, form };
  return b;
}
// Delete the points in the range; when that would take every point of the lane (a lane keeps at least one), one point at von with the lane value
// there stays, so the lane keeps its value before the range (one command, one undo step)
export function bereichLoeschBefehl(lane, { von, bis }) {
  const b = { befehl: 'auto_punkte', lane_id: lane.id, loesche_von: von, loesche_bis: bis };
  if (lane.punkte.every((q) => q.beat >= von && q.beat <= bis)) b.setze = [mitForm(lane, { beat: von, wert: laneWert(lane.punkte, von, lane.ziel) })];
  return b;
}
// The menus as pure lists [{ text, aus?, gruppe?, befehl?, label? }]; a locked lane gets one disabled line with the hint and sends nothing
const gesperrtMenue = (lane) => { const s = laneSchutz(lane); return s ? [{ text: LANEN_TEXT[s], aus: true }] : null; };
export function punktMenue(lane, i) {
  const zu = gesperrtMenue(lane);
  if (zu) return zu;
  const jetzt = lane.punkte[i].form ?? 'linear', nurSprung = bereich(lane.ziel).nurSprung;
  return ['linear', 's', 'sprung'].map((form) => {
    const text = LANEN_TEXT[`form_${form}`];
    if (nurSprung) return { text, aus: true, titel: LANEN_TEXT.nur_sprung };
    return form === jetzt ? { text, aus: true } : { text, befehl: formBefehl(lane, i, form), label: LANEN_TEXT.form_label };
  });
}
export function bereichMenue(lane, wahl) {
  const zu = gesperrtMenue(lane);
  if (zu) return zu;
  const r = { lane_id: lane.id, von_beat: wahl.von, bis_beat: wahl.bis }, nurSprung = bereich(lane.ziel).nurSprung;
  const formen = ['rampe_auf', 'rampe_ab', 'sinus', 'dreieck', 'rechteck'].map((form) => (nurSprung && form !== 'rechteck'
    ? { text: LANEN_TEXT[form], aus: true, titel: LANEN_TEXT.nur_sprung }
    : { text: LANEN_TEXT[form], befehl: { befehl: 'auto_form', ...r, form }, label: LANEN_TEXT.einfuegen_label }));
  return [{ text: LANEN_TEXT.einfuegen, gruppe: true }, ...formen,
    { text: LANEN_TEXT.vereinfachen, befehl: { befehl: 'auto_vereinfachen', ...r }, label: LANEN_TEXT.vereinfachen_label },
    { text: LANEN_TEXT.punkte_weg, befehl: bereichLoeschBefehl(lane, wahl), label: LANEN_TEXT.punkte_weg_label }];
}
// The selected range of the page (page state only, never saved): one range on one lane at a time; Esc clears it
export class LanenWahl {
  constructor() { this.laneId = null; this.bereich = null; }
  setze(laneId, b) { this.laneId = laneId; this.bereich = b; }
  leere() { this.laneId = null; this.bereich = null; }
  fuer(laneId) { return laneId !== null && laneId === this.laneId ? this.bereich : null; }
  taste(key) { if (key !== 'Escape' || !this.bereich) return false; this.leere(); return true; }
}
// 1.12 slice 4 (D1): the change of a freehand stroke f = freihandPunkte(...): one auto_punkte that replaces [von, bis]; with the grid off the server
// then simplifies the range (auto_vereinfachen; a staircase drawn with the grid on is sent alone, simplify would collapse it)
export function freihandBefehle(lane, f, raster) {
  const b = [{ befehl: 'auto_punkte', lane_id: lane.id, loesche_von: f.von, loesche_bis: f.bis, setze: f.punkte.map((q) => mitForm(lane, q)) }];
  if (!(raster > 0) && f.bis > f.von) b.push({ befehl: 'auto_vereinfachen', lane_id: lane.id, von_beat: f.von, bis_beat: f.bis });
  return b;
}
// The draw mode of the page (D1): key B or the DRAW button in a lane head toggles it; page state only, never saved
export const zeichenModus = {
  an: false, hoerer: new Set(),
  setze(an) { if (this.an === an) return; this.an = an; for (const h of this.hoerer) h(an); },
  umschalten() { this.setze(!this.an); },
};
const rastere = (beat, raster) => Math.round(Math.min(MAX_BEAT, Math.max(0, raster > 0 ? Math.round(beat / raster) * raster : beat)) * 1e6) / 1e6;

// One gesture on the lane row. ctx: { lane, zeile, beatZuX, xZuBeat, raster }.
//   down(x, y)  -> 'punkt' (a point was hit) | 'leer' (free place) | 'gesperrt' (the lane is locked: the gesture does nothing at all)
//   move(x, y)  -> the draft command while dragging, or null (below the threshold, or no point hit)
//   up()        -> { befehle: [...] } with exactly the commands to send (one, or none)
export class LaneGeste {
  // 1.12 slice 4: ctx.bereich (the selected range of this lane, or null) adds the handles: down() -> 'griff', a drag drafts one auto_dehnen or
  // auto_neigen; a drag in the empty selects a range (up() returns { bereich }) and sends nothing.
  constructor(ctx) {
    this.c = ctx; this.x0 = 0; this.y0 = 0; this.i = -1; this.dy = 0; this.gezogen = false; this.entwurf = null; this.ende = null;
    this.griff = null; this.bereich = null; this.pfad = null;
  }
  down(x, y) {
    this.x0 = x; this.y0 = y; this.gezogen = false; this.entwurf = null; this.ende = null; this.griff = null; this.bereich = null;
    if (laneSchutz(this.c.lane)) { this.i = -1; return 'gesperrt'; }
    this.pfad = null;
    if (this.c.zeichnen) { this.i = -1; this.pfad = [this.probe(x, y)]; return 'zeichnen'; }    // draw mode: points are drawn over, not grabbed
    this.griff = bereichGriff(this.c.bereich ?? null, this.c.zeile, this.c.beatZuX, x, y);
    if (this.griff) { this.i = -1; return 'griff'; }
    this.i = trefferPunkt(this.c.lane.punkte, this.c.zeile, this.c.beatZuX, x, y, this.c.lane.ziel);
    // grip offset: grabbing a point below or above its centre does not move its value (the drag follows y - dy)
    this.dy = this.i >= 0 ? y - wertZuY(this.c.zeile, this.c.lane.punkte[this.i].wert, this.c.lane.ziel) : 0;
    return this.i >= 0 ? 'punkt' : 'leer';
  }
  move(x, y) {
    if (laneSchutz(this.c.lane)) return null;
    if (!this.gezogen && Math.hypot(x - this.x0, y - this.y0) < ZUG_SCHWELLE) return null;
    if (this.griff) { this.gezogen = true; this.entwurf = this.griffBefehl(x, y); return this.entwurf; }
    if (this.pfad) {
      this.gezogen = true; this.pfad.push(this.probe(x, y));
      const f = freihandPunkte(this.pfad, this.c.raster, this.c.lane.ziel, this.c.lane.punkte);
      this.entwurf = f ? freihandBefehle(this.c.lane, f, this.c.raster)[0] : null;
      return this.entwurf;
    }
    if (this.i < 0) {                          // a drag in the empty: the range between the snapped beats (empty when both snap to one beat)
      const a = rastere(this.c.xZuBeat(this.x0), this.c.raster), b = rastere(this.c.xZuBeat(x), this.c.raster);
      this.bereich = a === b ? null : { von: Math.min(a, b), bis: Math.max(a, b) };
      return null;
    }
    this.gezogen = true;
    const z = ziehePunkt(this.c.lane.punkte, this.i, this.c.xZuBeat(x), yZuWert(this.c.zeile, y - this.dy, this.c.lane.ziel), this.c.raster, this.c.lane.ziel);
    this.ende = z;
    this.entwurf = zugBefehl(this.c.lane, this.i, z);
    return this.entwurf;
  }
  up(x, y) {
    const schutz = laneSchutz(this.c.lane);
    if (schutz) return { befehle: [], hinweis: LANEN_TEXT[schutz] };
    if (this.i >= 0 || this.griff) {
      const r = { befehle: this.gezogen && this.entwurf ? [this.entwurf] : [], hinweis: null };
      // a stretch ends the shape at the new end: the selected range follows, so the next skew or insert works on what is shown (probe 2026-11-05)
      if (this.griff === 'dehnen' && r.befehle.length > 0) r.bereich = { von: this.c.bereich.von, bis: r.befehle[0].neu_bis_beat };
      return r;
    }
    if (this.pfad && this.gezogen) {
      const f = freihandPunkte(this.pfad, this.c.raster, this.c.lane.ziel, this.c.lane.punkte);
      return f ? { befehle: freihandBefehle(this.c.lane, f, this.c.raster), hinweis: null, label: LANEN_TEXT.zeichnen_label } : { befehle: [], hinweis: LANEN_TEXT.voll };
    }
    if (Math.hypot(x - this.x0, y - this.y0) >= ZUG_SCHWELLE) {      // a drag in the empty: a range (slice 4), never a command
      return this.bereich ? { befehle: [], hinweis: null, bereich: this.bereich } : { befehle: [], hinweis: null };
    }
    const ziel = this.c.lane.ziel, beat = this.c.xZuBeat(x);
    if (bereich(ziel).nurSprung) return this.kippe(beat);
    const neu = setzePunkt(this.c.lane.punkte, beat, yZuWert(this.c.zeile, y, ziel), this.c.raster, ziel);
    if (!neu) return { befehle: [], hinweis: LANEN_TEXT.voll };
    const p = neu.punkte[neu.index];
    if (this.c.lane.punkte.some((q) => q.beat === p.beat)) return { befehle: [], hinweis: null };   // a set point would replace the point at its beat: not by a click
    return { befehle: [neuBefehl(this.c.lane, p.beat, p.wert)], hinweis: null };
  }
  probe(x, y) { return { x, beat: this.c.xZuBeat(x), wert: yZuWert(this.c.zeile, y, this.c.lane.ziel) }; }
  // The command of a handle drag: stretch moves the right edge (snapped, at least one grid step after von); skew maps the vertical drag to
  // faktor -1..1 (half the row height = 1, up is positive). null while the drag would change nothing.
  griffBefehl(x, y) {
    const w = this.c.bereich, r = { befehl: '', lane_id: this.c.lane.id, von_beat: w.von, bis_beat: w.bis };
    if (this.griff === 'dehnen') {
      const neu = Math.max(rastere(this.c.xZuBeat(x), this.c.raster), w.von + (this.c.raster > 0 ? this.c.raster : NACHBAR_ABSTAND));
      return neu === w.bis ? null : { ...r, befehl: 'auto_dehnen', neu_bis_beat: neu };
    }
    const f = Math.round(Math.min(1, Math.max(-1, -(y - this.y0) / (this.c.zeile.h / 2))) * 1000) / 1000;
    return f === 0 ? null : { ...r, befehl: 'auto_neigen', faktor: f };
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
  const wahl = new LanenWahl();               // 1.12 slice 4: the selected range (one lane at a time)
  const tabelle = () => zeilenTabelle(st.projekt?.spuren.length ?? 0, ctx.offeneLanen(), takeZeilenVon(st));
  const laneAn = (e) => {
    if (!st.projekt || e.target !== ueber) return null;
    const z = zeileBei(tabelle(), e.offsetY);
    if (!z || z.art !== 'lane') return null;
    const spur = (st.projektEntwurf ?? st.projekt).spuren[z.spur], lane = gezeigteLane(spur, st.laneZiel?.get(spur.id));
    return lane ? { z, spur, lane } : { z, spur, lane: null };
  };
  const geste = (t) => new LaneGeste({ lane: t.lane, zeile: t.z, beatZuX: (b) => beatZuX(st.ansicht, b), xZuBeat: (x) => xZuBeat(st.ansicht, x), raster: rasterBeats(st.raster),
    bereich: wahl.fuer(t.lane.id), zeichnen: zeichenModus.an });
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
    const label = () => (g.pfad ? LANEN_TEXT.zeichnen_label : g.griff === 'dehnen' ? LANEN_TEXT.dehnen_label : g.griff === 'neigen' ? LANEN_TEXT.neigen_label : LANEN_TEXT.gesten);
    const bewege = (m) => {
      const b = g.move(m.offsetX, m.offsetY);
      if (b) zug.bewege(() => ({ label: label(), befehle: [b] }));
      else if (g.griff && g.gezogen) zug.bewege(() => ({ label: label(), befehle: [] }));   // the drag went back to no change: no draft
      if (g.bereich) wahl.setze(t.lane.id, g.bereich);                                      // the range follows the pointer
    };
    const los = () => { ueber.removeEventListener('pointermove', bewege); ueber.removeEventListener('pointerup', ende); ueber.removeEventListener('pointercancel', abbruch); };
    const abbruch = () => { los(); zug.verwirf(); };
    const ende = (m) => {
      los();
      const r = g.up(m.offsetX, m.offsetY);
      if (r.hinweis) ctx.melde(r.hinweis, true);
      if (r.bereich) wahl.setze(t.lane.id, r.bereich);
      else if (art !== 'griff') wahl.leere();                    // a click or a point drag ends the range
      if (r.befehle.length === 0) { zug.verwirf(); return; }
      zug.bewege(() => ({ label: r.label ?? label(), befehle: r.befehle }));
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
  // 1.12 slice 4 (D1): key B toggles the draw mode (not while a text field has the focus, not with a modifier, only while this tab is shown)
  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() !== 'b' || e.ctrlKey || e.metaKey || e.altKey || istTextFeld(e.target) || !st.projekt || !st.sichtbar) return;
    e.preventDefault();
    zeichenModus.umschalten();
  });
  zeichenModus.hoerer.add((an) => { ueber.style.cursor = an ? 'crosshair' : ''; });
  // 1.12 slice 4 (D2): right click on a point: the form of its segment; inside the selected range: shapes, simplify, delete
  ueber.addEventListener('contextmenu', (e) => {
    const t = laneAn(e);
    if (!t) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (!t.lane) return;
    const i = laneSchutz(t.lane) ? -1 : trefferPunkt(t.lane.punkte, t.z, (b) => beatZuX(st.ansicht, b), e.offsetX, e.offsetY, t.lane.ziel);
    const w = wahl.fuer(t.lane.id), beat = xZuBeat(st.ansicht, e.offsetX);
    const punkte = i >= 0 ? punktMenue(t.lane, i) : w && beat >= w.von && beat <= w.bis ? bereichMenue(t.lane, w) : laneSchutz(t.lane) ? punktMenue(t.lane, 0) : null;
    if (!punkte) return;
    oeffneMenue(punkte.map((p) => ({ text: p.text, aus: p.aus || !p.befehl, gruppe: p.gruppe, titel: p.titel,
      aktion: () => { if (p.befehl) ctx.aendere(p.label, [p.befehl]); } })), e.clientX, e.clientY);
  }, true);
  ueber.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && wahl.taste('Escape')) { e.stopImmediatePropagation(); return; }
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
    // 1.12 slice 4: the selected range with its handles (skew: the top corners, stretch: the right edge)
    const ort = p && wahl.laneId ? laneMitId(p, wahl.laneId) : null;
    const si = ort ? p.spuren.indexOf(ort.spur) : -1, zw = si >= 0 ? laneZeile(tabelle(), si) : null;
    if (zw && gezeigteLane(ort.spur, st.laneZiel?.get(ort.spur.id))?.id === wahl.laneId) {
      const xl = beatZuX(st.ansicht, wahl.bereich.von), xr = beatZuX(st.ansicht, wahl.bereich.bis);
      g2.fillStyle = 'rgba(224, 168, 59, 0.16)'; g2.fillRect(xl, zw.y, xr - xl, zw.h);
      g2.fillStyle = '#e0a83b';
      g2.fillRect(xl - 3, zw.y, 6, 6); g2.fillRect(xr - 3, zw.y, 6, 6);                // skew handles
      g2.fillRect(xr - 2, zw.y + 10, 4, zw.h - 14);                                   // stretch handle
    } else if (wahl.laneId && !ort) wahl.leere();                                      // the lane is gone
    if (!p || !auswahl) return;
    const spur = p.spuren.findIndex((s) => (s.automation ?? []).some((l) => l.id === auswahl.laneId));
    const z = spur >= 0 ? laneZeile(tabelle(), spur) : null, lane = spur >= 0 ? laneMitId(p, auswahl.laneId)?.lane : null;
    const q = lane?.punkte.find((x) => x.beat === auswahl.beat);
    if (!z || !q || gezeigteLane(p.spuren[spur], st.laneZiel?.get(p.spuren[spur].id))?.id !== lane.id) return;
    g2.strokeStyle = '#ffffff'; g2.lineWidth = 2;
    g2.beginPath(); g2.arc(beatZuX(st.ansicht, q.beat), wertZuY(z, q.wert, lane.ziel), 6, 0, Math.PI * 2); g2.stroke(); g2.lineWidth = 1;
  });
}
