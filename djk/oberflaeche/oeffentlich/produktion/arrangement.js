// PRODUCTION (D1 V1): Arrangement als Canvas 2D (Spec 2.11). Drei Flächen: Lineal (jedes Bild, billig), Spuren
// (statisch: Raster, Loop-Bereich, Clips mit Welle oder Notenvorschau; nur neu bei Änderung von Projekt, Ansicht,
// Größe oder einer angekommenen Welle) und Überlagerung (jedes Bild: Abspielkopf, Startmarke, Ablage-Geist).
// Zeichenvokabular und Wellendaten aus welle.js (spalten, zeichneSpalte), kein WebGL.
import { linien, beatZuX } from './zeitachse.js';
import { SPUR_HOEHE, LOOP_ZONE, CLIP_KOPF, clipKasten, sichtbar, welleSpalteFuer, notenKaesten, zeilenTabelle, spurZeile } from './layout.js';
import { genutzteBereiche } from './takes.js';
import { lanePfad, wertZuY, gezeigteLane, bereich, laneSchutz, laneLinienFarbe } from './lanen.js';
import { stemsBalkenListe, stummDecke } from './stems.js';
import { spalten, zeichneSpalte } from '../welle.js';

const HEX = /^#[0-9a-f]{6}$/i;
const alpha = (f, a) => (HEX.test(f) ? f + a : `rgba(140,140,150,0.25)`);

export class Arrangement {
  constructor({ lineal, spuren, ueber, wellen }) {
    this.l = lineal; this.s = spuren; this.u = ueber; this.wellen = wellen;
    this.gl = lineal.getContext('2d'); this.gs = spuren.getContext('2d'); this.gu = ueber.getContext('2d');
    this.schmutzig = true; this.letzte = { ansicht: null, projekt: null };
    this.groesse = new Map();
    this.beobachter = typeof ResizeObserver === 'function'
      ? new ResizeObserver((eintraege) => { for (const e of eintraege) this.groesse.set(e.target, { w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }); })
      : null;
    for (const c of [lineal, spuren, ueber]) { this.messe(c); this.beobachter?.observe(c); }
  }
  // Größen der drei Flächen: vom ResizeObserver gefüttert, nicht aus getBoundingClientRect in jedem Bild (das erzwingt ein Layout).
  // Ein Bild lang gilt noch die alte Größe, wenn sich das Fenster gerade ändert. Ohne ResizeObserver wird wie früher je Bild gemessen.
  messe(c) { const r = c.getBoundingClientRect(); this.groesse.set(c, { w: Math.round(r.width), h: Math.round(r.height) }); }
  breite() { return this.groesse.get(this.u)?.w ?? this.u.width; }
  passe(c) {
    if (!this.beobachter) this.messe(c);
    const g = this.groesse.get(c);
    if (!g || (c.width === g.w && c.height === g.h)) return false;
    c.width = g.w; c.height = g.h;
    return true;
  }
  // loop: die gezeigte Klammer (beim Ziehen der Entwurf, sonst projekt.loop)
  bild({ ansicht, projekt, loop, kopfBeat, startBeat, geist, stems = null, lanen = [], laneZiel = null, ueber = [], takeZeilen = new Map() }) {
    // the key holds the target each open row shows, so that a new choice redraws
    const tab = zeilenTabelle(projekt?.spuren?.length ?? 0, lanen, takeZeilen), schluessel = lanen.join(',') + '#' + [...takeZeilen].join(';') + (laneZiel ? '|' + lanen.map((i) => laneZiel.get(projekt?.spuren?.[i]?.id) ?? '').join(',') : '') + '|' + ueber.map((x) => `${x.spur_id}:${x.ziel}`).join(',');   // open lane rows (Automation S1); none = the old fixed grid
    this.laneZiel = laneZiel; this.ueber = ueber;
    if (this.passe(this.s) | this.passe(this.u)) this.schmutzig = true;
    this.passe(this.l);
    if (this.schmutzig || this.letzte.ansicht !== ansicht || this.letzte.projekt !== projekt || this.letzte.lanen !== schluessel) {
      this.schmutzig = false; this.letzte = { ansicht, projekt, lanen: schluessel };
      this.zeichneSpuren(ansicht, projekt, tab);
    }
    this.zeichneLineal(ansicht, loop, kopfBeat, startBeat);
    this.zeichneUeber(ansicht, kopfBeat, startBeat, geist, projekt, stems, tab);
  }
  zeichneSpuren(a, p, tab = zeilenTabelle(p?.spuren?.length ?? 0)) {
    const g = this.gs, w = this.s.width, h = this.s.height;
    g.fillStyle = '#0b0d11'; g.fillRect(0, 0, w, h);
    if (!p) return;
    for (const z of tab) { g.fillStyle = z.art === 'lane' ? '#0d1014' : z.art === 'take' ? '#0c0e12' : z.spur % 2 ? '#12141a' : '#0f1116'; g.fillRect(0, z.y, w, z.h); }
    if (p.loop) {
      const x0 = beatZuX(a, p.loop.von_beat), x1 = beatZuX(a, p.loop.bis_beat);
      g.fillStyle = p.loop.an ? 'rgba(47,214,195,0.07)' : 'rgba(255,255,255,0.025)'; g.fillRect(x0, 0, x1 - x0, h);
    }
    for (const l of linien(a, w)) {
      g.strokeStyle = l.takt ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.05)';
      g.beginPath(); g.moveTo(Math.round(l.x) + 0.5, 0); g.lineTo(Math.round(l.x) + 0.5, h); g.stroke();
    }
    g.strokeStyle = '#2a2d36';
    for (const z of tab) { const y = z.y + z.h - 0.5; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    p.spuren.forEach((spur, i) => {
      for (const c of spur.clips) {
        const k = clipKasten(a, i, c, spurZeile(tab, i).y);
        if (sichtbar(k, w)) this.zeichneClip(g, k, spur, c, a, p, w);
      }
    });
    this.zeichneTakes(g, a, p, tab, w);
    this.zeichneLanen(g, a, p, tab, w, this.laneZiel);
  }
  // 1.14 Comping: the clips of every visible take row; the regions the main lane uses right now (genutzteBereiche, derived) in the track colour, the rest grey
  zeichneTakes(g, a, p, tab, w) {
    const genutzt = new Map();
    for (const z of tab) {
      if (z.art !== 'take') continue;
      const spur = p.spuren[z.spur], take = spur?.takes?.[z.take];
      if (!take) continue;
      if (!genutzt.has(z.spur)) genutzt.set(z.spur, genutzteBereiche(spur, p.tempo_bpm));
      const bereiche = genutzt.get(z.spur).filter((r) => r.take_id === take.id), grau = { ...spur, farbe: '#8a8d98', freeze: null }, farbig = { ...spur, freeze: null };
      for (const c of take.clips) {
        const k = { x: beatZuX(a, c.start_beat), y: z.y + 1, w: c.laenge_beats * a.pxProBeat, h: z.h - 2 };
        if (!sichtbar(k, w)) continue;
        this.zeichneClip(g, k, grau, c, a, p, w);
        for (const r of bereiche) {
          const x0 = Math.max(k.x, beatZuX(a, r.von)), x1 = Math.min(k.x + k.w, beatZuX(a, r.bis));
          if (x1 <= x0) continue;
          g.save(); g.beginPath(); g.rect(x0, z.y, x1 - x0, z.h); g.clip();
          this.zeichneClip(g, k, farbig, c, a, p, w);
          g.restore();
        }
      }
    }
  }
  // Automation S1 + S2: the line of every open lane row (the target the row shows): the guide (0 dB, the pan centre, the two levels of a switch), the line,
  // the points. A locked lane is drawn dimmed.
  zeichneLanen(g, a, p, tab, w, laneZiel = null) {
    for (const z of tab) {
      if (z.art !== 'lane') continue;
      const spur = p.spuren[z.spur], lane = gezeigteLane(spur, laneZiel?.get(spur.id)), ziel = lane?.ziel ?? 'fader', b = bereich(ziel);   // an empty row frames like the fader (slice 1)
      g.strokeStyle = 'rgba(255,255,255,0.10)';
      const leitlinien = b.nurSprung ? [0, 1] : b.mittellinie === null ? [] : [b.mittellinie];
      for (const v of leitlinien) { g.beginPath(); const y0 = Math.round(wertZuY(z, v, ziel)) + 0.5; g.moveTo(0, y0); g.lineTo(w, y0); g.stroke(); }
      if (!lane) continue;
      const f = laneLinienFarbe(HEX.test(spur.farbe) ? spur.farbe : '#2fd6c3', this.ueber, spur.id, lane.ziel);   // orange while the hand overrides the field
      if (laneSchutz(lane)) g.globalAlpha = 0.35;     // locked or a target this page does not know: dimmed
      const pfad = lanePfad(lane.punkte, z, (x) => beatZuX(a, x), (x) => a.beat0 + x / a.pxProBeat, w, ziel);
      g.strokeStyle = f; g.lineWidth = 1.5; g.beginPath();
      pfad.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke(); g.lineWidth = 1;
      g.fillStyle = f;
      for (const q of lane.punkte) { const x = beatZuX(a, q.beat); if (x < -6 || x > w + 6) continue; g.beginPath(); g.arc(x, wertZuY(z, q.wert, ziel), 3.5, 0, Math.PI * 2); g.fill(); }
      g.globalAlpha = 1;
    }
  }
  zeichneClip(g, k, spur, c, a, p, w) {
    const f = HEX.test(spur.farbe) ? spur.farbe : '#8a8d98';
    g.fillStyle = alpha(f, '30'); g.fillRect(k.x, k.y, k.w, k.h);
    g.fillStyle = f; g.fillRect(k.x, k.y, k.w, CLIP_KOPF);
    g.strokeStyle = c.dekodiert === 'fehler' ? '#ff5a1f' : f; g.lineWidth = 1; g.strokeRect(k.x + 0.5, k.y + 0.5, Math.max(0, k.w - 1), k.h - 1);
    g.save(); g.beginPath(); g.rect(k.x, k.y, k.w, k.h); g.clip();
    g.font = '11px system-ui, sans-serif'; g.fillStyle = '#0e0f12'; g.fillText(c.stumm ? `${c.name ?? ''} (muted)` : (c.name ?? ''), k.x + 4, k.y + 11);
    const unten = (text) => { g.fillStyle = 'rgba(232,232,236,0.7)'; g.fillText(text, k.x + 4, k.y + CLIP_KOPF + 14); };
    if (spur.freeze) {
      g.strokeStyle = alpha(f, '60');
      for (let x = k.x - k.h; x < k.x + k.w; x += 8) { g.beginPath(); g.moveTo(x, k.y + k.h); g.lineTo(x + k.h, k.y + CLIP_KOPF); g.stroke(); }
      unten('FROZEN');
    } else if (c.art === 'midi') {
      g.fillStyle = f;
      for (const n of notenKaesten(c, k, a.pxProBeat)) g.fillRect(n.x, n.y, n.w, n.h);
    } else if (c.dekodiert !== 'fertig') {
      unten(c.dekodiert === 'fehler' ? 'decode failed' : 'decoding…');
    } else {
      const e = this.wellen.hole(c.quelle.sha256, () => { this.schmutzig = true; });
      if (e.welle) {
        const mitte = (k.h - CLIP_KOPF) / 2, x0 = Math.max(0, Math.floor(k.x)), x1 = Math.min(w, Math.ceil(k.x + k.w));
        g.translate(0, k.y + CLIP_KOPF);
        for (let x = x0; x < x1; x++) {
          // Paket 1.13: hinter dem Ende der Quelle bricht nur der ungewarpte Clip ab; ein gewarpter Loop-Clip überspringt die Stille und zeichnet die nächste Kopie
          const r = welleSpalteFuer(c, p.tempo_bpm, e.welle.hop, a.pxProBeat, x - k.x, e.welle.spalten);
          if (r === 'ende') break;
          if (r === 'leer') continue;
          zeichneSpalte(g, x, mitte, spalten(e.welle, r[0], r[1]), e.welle.gain);
        }
      } else if (e.fehler) unten('no waveform');
    }
    g.restore();
    const decke = stummDecke(k, c);
    if (decke) { g.fillStyle = decke.farbe; g.fillRect(decke.x, decke.y, decke.w, decke.h); }
  }
  zeichneLineal(a, loop, kopfBeat, startBeat) {
    const g = this.gl, w = this.l.width, h = this.l.height;
    g.fillStyle = '#14161c'; g.fillRect(0, 0, w, h);
    if (loop) {
      const x0 = beatZuX(a, loop.von_beat), x1 = beatZuX(a, loop.bis_beat);
      g.fillStyle = loop.an ? '#2fd6c3' : '#4a4e5a'; g.fillRect(x0, 1, x1 - x0, LOOP_ZONE - 2);
      g.fillStyle = '#e8e8ec'; g.fillRect(x0, 0, 2, LOOP_ZONE); g.fillRect(x1 - 2, 0, 2, LOOP_ZONE);
    }
    g.font = '11px ui-monospace, monospace';
    for (const l of linien(a, w)) {
      const x = Math.round(l.x) + 0.5;
      g.strokeStyle = l.haupt ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.2)';
      g.beginPath(); g.moveTo(x, l.haupt ? LOOP_ZONE : h - 5); g.lineTo(x, h); g.stroke();
      if (l.text) { g.fillStyle = 'rgba(232,232,236,0.8)'; g.fillText(l.text, x + 3, h - 4); }
    }
    const xs = beatZuX(a, startBeat);
    g.fillStyle = '#ffb020'; g.beginPath(); g.moveTo(xs - 5, LOOP_ZONE); g.lineTo(xs + 5, LOOP_ZONE); g.lineTo(xs, LOOP_ZONE + 7); g.closePath(); g.fill();
    if (kopfBeat !== null) { g.fillStyle = '#fff'; g.fillRect(Math.round(beatZuX(a, kopfBeat)) - 1, 0, 2, h); }
  }
  zeichneUeber(a, kopfBeat, startBeat, geist, p = null, stems = null, tab = zeilenTabelle(p?.spuren?.length ?? 0)) {
    const g = this.gu, w = this.u.width, h = this.u.height;
    g.clearRect(0, 0, w, h);
    const gz = geist && geist.spur >= 0 ? spurZeile(tab, geist.spur) : null;
    if (gz) {
      g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(0, gz.y, w, SPUR_HOEHE);
      g.fillStyle = '#ffb020'; g.fillRect(Math.round(geist.x) - 1, gz.y, 2, SPUR_HOEHE);
    }
    // Slice 6 (D13): Fortschrittsbalken am Clip, dessen Stems laufen (die Überlagerung zeichnet jedes Bild: kein Nachladen, kein schmutzig)
    for (const b of stemsBalkenListe(p, stems, (i, c) => clipKasten(a, i, c, spurZeile(tab, i).y))) { g.fillStyle = '#2fd6c3'; g.fillRect(b.x, b.y, b.w, b.h); }
    if (kopfBeat !== null) { g.fillStyle = '#fff'; g.fillRect(Math.round(beatZuX(a, kopfBeat)) - 1, 0, 2, h); return; }
    const xs = Math.round(beatZuX(a, startBeat)) + 0.5;
    g.strokeStyle = 'rgba(255,176,32,0.7)'; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(xs, 0); g.lineTo(xs, h); g.stroke(); g.setLineDash([]);
  }
}
