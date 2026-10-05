// Wellenform der Seite (Plan 2026-09-27-djk-oberflaeche-welle, Spec E4). Daten: GET /welle (Kopf DJKW v1, 4 Bytes je
// Spalte: Spitze, tief, mittel, hoch). Zeichnen: Kacheln je Zoomstufe (Prototyp 5f47db8: p99 0,2 ms je Ansicht).
export const SR = 48000;

export function leseWelle(buf) {
  const v = new DataView(buf);
  const magic = String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3));
  if (magic !== 'DJKW' || v.getUint32(4, true) !== 1) throw new Error('keine DJKW-v1-Welle');
  const spaltenZahl = v.getUint32(12, true);
  const daten = new Uint8Array(buf, 16, spaltenZahl * 4);
  // Maßstab je Band (p98 → volle Höhe): sonst drückt der Bass Mitten und Höhen zu einem Strich (Blick 2026-09-27)
  const gain = [1, 1, 1, 1];
  for (let b = 1; b < 4; b++) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < spaltenZahl; i++) hist[daten[i * 4 + b]]++;
    let n = 0, p98 = 255;
    for (let v = 0; v < 256; v++) { n += hist[v]; if (n >= 0.98 * spaltenZahl) { p98 = v; break; } }
    gain[b] = p98 > 0 ? 255 / p98 : 1;
  }
  return { hop: v.getUint32(8, true), spalten: spaltenZahl, daten, gain };
}

// Spalten [a, b): Spitze als Maximum, Bänder als Mittel (Maximum färbt bei weitem Zoom alles hell, Prototyp).
export function spalten(w, a, b) {
  a = Math.max(0, Math.floor(a)); b = Math.min(w.spalten, Math.max(a + 1, Math.floor(b)));
  if (a >= w.spalten) return [0, 0, 0, 0];
  let p = 0, t = 0, m = 0, h = 0;
  for (let i = a; i < b; i++) {
    const o = i * 4, d = w.daten;
    if (d[o] > p) p = d[o];
    t += d[o + 1]; m += d[o + 2]; h += d[o + 3];
  }
  const n = b - a;
  return [p, Math.round(t / n), Math.round(m / n), Math.round(h / n)];
}

// Kopf zwischen gedrosselten Meldungen (Spec E4): Beat = b0 + (t − t0)·bpm/60 000 + Fehler, der über 200 ms eingeholt
// wird. Abweichung > 0,5 Beat (Sprung, Cue, Laden) wird sofort übernommen.
export class Kopf {
  constructor() { this.b0 = 0; this.t0 = 0; this.rate = 0; this.fehler = 0; this.laeuft = false; }
  melde(beat, bpm, t, laeuft) {
    const erwartet = this.beat(t);
    const neueRate = laeuft ? bpm / 60000 : 0;
    if (!this.laeuft || !laeuft || Math.abs(beat - erwartet) > 0.5) { this.b0 = beat; this.fehler = 0; }
    else { this.b0 = erwartet; this.fehler = beat - erwartet; }
    this.t0 = t; this.rate = neueRate; this.laeuft = laeuft;
  }
  beat(t) {
    const dt = Math.max(0, t - this.t0);
    return this.b0 + dt * this.rate + this.fehler * Math.min(1, dt / 200);
  }
}

export function zeichneSpalte(g, x, mitte, spalte, gain = [1, 1, 1, 1]) {
  // Farbton stufenlos aus dem Schwerpunkt der (je Band normierten) Bänder wie Traktor: Bass rot → gelb → grün →
  // cyan → blau-violett für Höhen. Höhe = Spitze; innen ein hellerer Kern in derselben Farbe aus dem Bass-Anteil.
  const [p, t0, m0, h0] = spalte;
  if (p === 0) return;
  const t = Math.min(255, t0 * gain[1]), m = Math.min(255, m0 * gain[2]), h = Math.min(255, h0 * gain[3]);
  const k = (v) => (v / 255) ** 3;                         // hoch 3: das stärkste Band bestimmt den Ton deutlicher
  const c = (0.5 * k(m) + k(h)) / (k(t) + k(m) + k(h) + 1e-9);   // 0 = nur Bass, 1 = nur Höhen
  const ton = c * 270;                                     // 0 rot … 60 gelb … 120 grün … 190 cyan … 270 violett
  const hoehe = mitte - 2, y = (p / 255) * hoehe;
  g.fillStyle = `hsl(${ton | 0},100%,${(40 + 18 * (p / 255)) | 0}%)`;
  g.fillRect(x, mitte - y, 1, 2 * y);
  const yk = y * Math.min(1, t / 255) * 0.6;
  if (yk > 1) { g.fillStyle = `hsla(${ton | 0},100%,75%,0.55)`; g.fillRect(x, mitte - yk, 1, 2 * yk); }
}

const KACHEL = 2048;
const KACHELN_MAX = 8;       // je Ansicht höchstens 8 Kacheln (sichtbar sind 1–2); ohne Deckel 116 MB je Deck (Review F8)

// Laufansicht: Kopf fest in der Mitte, Welle läuft; Raster aus ersterSchlagFrame und framesProBeat, Takt-Eins bei eins.
export class Laufansicht {
  constructor(canvas) { this.c = canvas; this.g = canvas.getContext('2d'); this.w = null; this.takte = 16; this.kacheln = new Map(); this.schluessel = ''; }
  setzeWelle(w, raster) { this.w = w; this.raster = raster; this.kacheln = new Map(); }
  kachel(i, fpp, hoehe) {
    const s = `${fpp}|${hoehe}`;
    if (s !== this.schluessel) { this.kacheln = new Map(); this.schluessel = s; }
    let k = this.kacheln.get(i);
    if (k) return k;
    k = new OffscreenCanvas(KACHEL, hoehe);
    const g = k.getContext('2d'), mitte = hoehe / 2, w = this.w;
    for (let x = 0; x < KACHEL; x++) {
      const f0 = (i * KACHEL + x) * fpp;
      if (f0 < 0 || f0 >= w.spalten * w.hop) continue;
      zeichneSpalte(g, x, mitte, spalten(w, f0 / w.hop, (f0 + fpp) / w.hop), w.gain);
    }
    this.kacheln.set(i, k);
    if (this.kacheln.size > KACHELN_MAX) this.kacheln.delete(this.kacheln.keys().next().value);  // Review F8: älteste raus
    return k;
  }
  // kopf: ohne Angabe steht der Kopf in der Mitte und die Welle läuft (Deck); mit Angabe steht die Welle um `frame`
  // still und der Kopf wandert zum Frame `kopf` (Loop-Zelle wie Traktors Remix-Slots, Abweichung vom Plan T4, intern).
  // marken: [{frame, farbe}] (Plan E9: Hotcues), als 2-px-Strich über die volle Höhe
  zeichne(frame, kopf = null, marken = []) {
    const c = this.c, r = c.getBoundingClientRect();
    if (c.width !== Math.round(r.width) || c.height !== Math.round(r.height)) { c.width = Math.round(r.width); c.height = Math.round(r.height); }
    const g = this.g, w = c.width, hh = c.height;
    g.fillStyle = '#0b0d11'; g.fillRect(0, 0, w, hh);
    if (!this.w || w === 0) return;
    const { ersterSchlagFrame: s0, framesProBeat: fpb, eins } = this.raster;
    const fenster = this.takte * 4 * fpb, fpp = fenster / w, links = frame - fenster / 2, px = links / fpp;
    for (let i = Math.floor(px / KACHEL); i * KACHEL < px + w; i++) if (i >= 0) g.drawImage(this.kachel(i, fpp, hh), Math.round(i * KACHEL - px), 0);
    const k0 = Math.ceil((links - s0) / fpb), k1 = Math.floor((links + fenster - s0) / fpb);
    g.font = '11px ui-monospace, monospace';
    for (let k = k0; k <= k1; k++) {
      const x = Math.round((s0 + k * fpb - links) / fpp) + 0.5, e = ((k - eins) % 4 + 4) % 4 === 0;
      if (!e && fpp > fpb / 6) continue;
      g.strokeStyle = e ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.12)';
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, hh); g.stroke();
      if (e && k >= eins) { g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillText(String(Math.floor((k - eins) / 4) + 1), x + 3, 12); }
    }
    for (const m of marken) {   // Loop (bis): Bereich halbtransparent; Nummer im Kästchen oben an der Marke
      const mx = (m.frame - links) / fpp;
      if (m.bis !== undefined) {
        const bx = (m.bis - links) / fpp;
        if (bx > 0 && mx < w) { g.fillStyle = m.bereich ?? m.farbe; g.fillRect(Math.max(0, mx), 0, Math.min(w, bx) - Math.max(0, mx), hh); }
      }
      if (mx < -2 || mx > w + 2) continue;
      g.fillStyle = m.farbe; g.fillRect((mx | 0) - 1, 0, 2, hh);
      if (m.text) marke(g, m, mx | 0, 14);
    }
    const kx = kopf === null ? w / 2 : (kopf - links) / fpp;
    g.fillStyle = '#fff'; g.fillRect((kx | 0) - 1, 0, 2, hh);
  }
}

// Nummer einer Marke als farbiges Kästchen oben rechts am Strich (Traktor: Cue-Nummer im Fenster)
function marke(g, m, x, h) {
  const b = g.measureText(m.text).width + 6;
  g.fillStyle = m.farbe; g.fillRect(x + 1, 0, b, h);
  g.fillStyle = '#0e0f12'; g.fillText(m.text, x + 4, h - 3);
}

// Übersicht: ganzer Track einmal je Breite vorgezeichnet, gespielter Teil abgedunkelt, Fenster der Laufansicht als Rahmen.
// Plan E9: gesamte Länge in Frames (für Klick → Quell-Beat)
export const laengeFrames = (w) => w.spalten * w.hop;

export class Uebersicht {
  constructor(canvas) { this.c = canvas; this.g = canvas.getContext('2d'); this.w = null; this.bild = null; }
  setzeWelle(w) { this.w = w; this.bild = null; }
  zeichne(frame, fensterFrames, marken = []) {
    const c = this.c, r = c.getBoundingClientRect();
    if (c.width !== Math.round(r.width) || c.height !== Math.round(r.height)) { c.width = Math.round(r.width); c.height = Math.round(r.height); this.bild = null; }
    const g = this.g, w = c.width, hh = c.height;
    g.clearRect(0, 0, w, hh);
    if (!this.w || w === 0) return;
    if (!this.bild) {
      this.bild = new OffscreenCanvas(w, hh);
      const b = this.bild.getContext('2d'), mitte = hh / 2, spp = this.w.spalten / w;
      for (let x = 0; x < w; x++) {
        zeichneSpalte(b, x, mitte, spalten(this.w, x * spp, (x + 1) * spp), this.w.gain);
      }
    }
    g.drawImage(this.bild, 0, 0);
    const gesamt = this.w.spalten * this.w.hop, x = (frame / gesamt) * w, fx = (fensterFrames / gesamt) * w;
    g.fillStyle = 'rgba(11,13,17,0.55)'; g.fillRect(0, 0, x, hh);
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.strokeRect(x - fx / 2, 0.5, fx, hh - 1);
    for (const m of marken) {
      const mx = (m.frame / gesamt) * w | 0;
      if (m.bis !== undefined) { g.fillStyle = m.bereich ?? m.farbe; g.fillRect(mx, 0, Math.max(2, (m.bis / gesamt) * w - mx), hh); }
      g.fillStyle = m.farbe; g.fillRect(mx - 1, 0, 2, hh);
      if (m.text) { g.font = '10px ui-monospace, monospace'; marke(g, m, mx, 11); }
    }
    g.fillStyle = '#fff'; g.fillRect(x - 1, 0, 2, hh);
  }
}
