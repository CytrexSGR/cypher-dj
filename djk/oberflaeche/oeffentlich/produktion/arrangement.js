// PRODUCTION (D1 V1): Arrangement als Canvas 2D (Spec 2.11). Drei Flächen: Lineal (jedes Bild, billig), Spuren
// (statisch: Raster, Loop-Bereich, Clips mit Welle oder Notenvorschau; nur neu bei Änderung von Projekt, Ansicht,
// Größe oder einer angekommenen Welle) und Überlagerung (jedes Bild: Abspielkopf, Startmarke, Ablage-Geist).
// Zeichenvokabular und Wellendaten aus welle.js (spalten, zeichneSpalte), kein WebGL.
import { linien, beatZuX } from './zeitachse.js';
import { SPUR_HOEHE, LOOP_ZONE, CLIP_KOPF, clipKasten, sichtbar, quellSpalten, notenKaesten } from './layout.js';
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
  bild({ ansicht, projekt, loop, kopfBeat, startBeat, geist }) {
    if (this.passe(this.s) | this.passe(this.u)) this.schmutzig = true;
    this.passe(this.l);
    if (this.schmutzig || this.letzte.ansicht !== ansicht || this.letzte.projekt !== projekt) {
      this.schmutzig = false; this.letzte = { ansicht, projekt };
      this.zeichneSpuren(ansicht, projekt);
    }
    this.zeichneLineal(ansicht, loop, kopfBeat, startBeat);
    this.zeichneUeber(ansicht, kopfBeat, startBeat, geist);
  }
  zeichneSpuren(a, p) {
    const g = this.gs, w = this.s.width, h = this.s.height;
    g.fillStyle = '#0b0d11'; g.fillRect(0, 0, w, h);
    if (!p) return;
    p.spuren.forEach((_, i) => { g.fillStyle = i % 2 ? '#12141a' : '#0f1116'; g.fillRect(0, i * SPUR_HOEHE, w, SPUR_HOEHE); });
    if (p.loop) {
      const x0 = beatZuX(a, p.loop.von_beat), x1 = beatZuX(a, p.loop.bis_beat);
      g.fillStyle = p.loop.an ? 'rgba(47,214,195,0.07)' : 'rgba(255,255,255,0.025)'; g.fillRect(x0, 0, x1 - x0, h);
    }
    for (const l of linien(a, w)) {
      g.strokeStyle = l.takt ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.05)';
      g.beginPath(); g.moveTo(Math.round(l.x) + 0.5, 0); g.lineTo(Math.round(l.x) + 0.5, h); g.stroke();
    }
    g.strokeStyle = '#2a2d36';
    p.spuren.forEach((_, i) => { const y = (i + 1) * SPUR_HOEHE - 0.5; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); });
    p.spuren.forEach((spur, i) => {
      for (const c of spur.clips) {
        const k = clipKasten(a, i, c);
        if (sichtbar(k, w)) this.zeichneClip(g, k, spur, c, a, p, w);
      }
    });
  }
  zeichneClip(g, k, spur, c, a, p, w) {
    const f = HEX.test(spur.farbe) ? spur.farbe : '#8a8d98';
    g.fillStyle = alpha(f, '30'); g.fillRect(k.x, k.y, k.w, k.h);
    g.fillStyle = f; g.fillRect(k.x, k.y, k.w, CLIP_KOPF);
    g.strokeStyle = c.dekodiert === 'fehler' ? '#ff5a1f' : f; g.lineWidth = 1; g.strokeRect(k.x + 0.5, k.y + 0.5, Math.max(0, k.w - 1), k.h - 1);
    g.save(); g.beginPath(); g.rect(k.x, k.y, k.w, k.h); g.clip();
    g.font = '11px system-ui, sans-serif'; g.fillStyle = '#0e0f12'; g.fillText(c.name ?? '', k.x + 4, k.y + 11);
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
          const [sa, sb] = quellSpalten(c, p.tempo_bpm, e.welle.hop, a.pxProBeat, x - k.x);
          if (sa >= e.welle.spalten) break;
          zeichneSpalte(g, x, mitte, spalten(e.welle, sa, sb), e.welle.gain);
        }
      } else if (e.fehler) unten('no waveform');
    }
    g.restore();
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
  zeichneUeber(a, kopfBeat, startBeat, geist) {
    const g = this.gu, w = this.u.width, h = this.u.height;
    g.clearRect(0, 0, w, h);
    if (geist && geist.spur >= 0) {
      g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(0, geist.spur * SPUR_HOEHE, w, SPUR_HOEHE);
      g.fillStyle = '#ffb020'; g.fillRect(Math.round(geist.x) - 1, geist.spur * SPUR_HOEHE, 2, SPUR_HOEHE);
    }
    if (kopfBeat !== null) { g.fillStyle = '#fff'; g.fillRect(Math.round(beatZuX(a, kopfBeat)) - 1, 0, 2, h); return; }
    const xs = Math.round(beatZuX(a, startBeat)) + 0.5;
    g.strokeStyle = 'rgba(255,176,32,0.7)'; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(xs, 0); g.lineTo(xs, h); g.stroke(); g.setLineDash([]);
  }
}
