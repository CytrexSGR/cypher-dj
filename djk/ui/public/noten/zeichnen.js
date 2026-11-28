// NOTEN (note editor, N16): drawing of the editor surface into a 2d context it is given. No DOM; everything it needs comes through its arguments.
// Order: background, faint waveform, shade outside the audible range, semitone rows (black keys darker), beat grid (bar lines brighter), notes at their target
// pitch with the detected pitch as a faint outline where edited, pitch line, selection, drag preview, key column with the name at every C.
import { TASTEN_BREITE, TON_HOEHE, sZuX, xZuS, tonZuY, notenKasten, rasterLinien, kurvePunkte, tonName, istSchwarz } from './view.js';

const FARBE = {
  hintergrund: '#0b0d11', zeileWeiss: '#171a21', zeileSchwarz: '#11141a', zeileC: '#2a2f39', welle: 'rgba(150, 160, 175, 0.22)', schatten: 'rgba(11, 13, 17, 0.6)',
  takt: 'rgba(255, 255, 255, 0.28)', schlag: 'rgba(255, 255, 255, 0.10)', note: '#4fb3a5', notenRand: 'rgba(0, 0, 0, 0.45)', ursprung: 'rgba(255, 255, 255, 0.35)',
  kurve: 'rgba(255, 255, 255, 0.85)', auswahl: '#ffffff', vorschau: 'rgba(255, 255, 255, 0.35)', vorschauText: '#ffffff',
  tasteWeiss: '#d9dce2', tasteSchwarz: '#20242b', tasteText: '#20242b', tasteTrenner: '#0b0d11',
};
const bearbeitet = (n) => n.ton !== undefined && n.ton !== n.qton;
const mitTon = (n, ton) => ({ ...n, ton });

export function zeichne(g, a, sicht, ui) {
  const { breite, hoehe } = ui, auswahl = new Set(ui.auswahl ?? []);
  g.fillStyle = FARBE.hintergrund; g.fillRect(0, 0, breite, hoehe);
  g.save();
  g.beginPath(); g.rect(TASTEN_BREITE, 0, Math.max(0, breite - TASTEN_BREITE), hoehe); g.clip();   // notes and waveform never reach into the key column

  const unterste = Math.floor(a.tonOben) - Math.ceil(hoehe / TON_HOEHE) - 1;
  const zeile = (t) => tonZuY(a, t) - TON_HOEHE / 2;
  for (let t = Math.floor(a.tonOben) + 1; t >= unterste; t--) {
    if (t < 0 || t > 127) continue;
    g.fillStyle = istSchwarz(t) ? FARBE.zeileSchwarz : FARBE.zeileWeiss;
    g.fillRect(TASTEN_BREITE, zeile(t), breite - TASTEN_BREITE, TON_HOEHE);
    if (t % 12 === 0) { g.fillStyle = FARBE.zeileC; g.fillRect(TASTEN_BREITE, zeile(t) + TON_HOEHE - 1, breite - TASTEN_BREITE, 1); }
  }

  zeichneWelle(g, a, sicht, breite, hoehe);
  const von = sZuX(a, sicht.hoerbarS[0]), bis = sZuX(a, sicht.hoerbarS[1]);
  g.fillStyle = FARBE.schatten;
  if (von > TASTEN_BREITE) g.fillRect(TASTEN_BREITE, 0, Math.min(breite, von) - TASTEN_BREITE, hoehe);
  if (bis < breite) g.fillRect(Math.max(TASTEN_BREITE, bis), 0, breite - Math.max(TASTEN_BREITE, bis), hoehe);

  const linien = rasterLinien(sicht.raster, a, breite);
  for (const takt of [false, true]) {
    g.strokeStyle = takt ? FARBE.takt : FARBE.schlag; g.lineWidth = 1;
    g.beginPath();
    for (const l of linien) if (l.takt === takt) { const x = Math.round(l.x) + 0.5; g.moveTo(x, 0); g.lineTo(x, hoehe); }
    g.stroke();
  }

  const noten = sicht.noten ?? [];
  for (const n of noten) {                                   // the detected pitch as a faint outline, only where the note was edited
    if (!bearbeitet(n)) continue;
    const k = notenKasten(a, mitTon(n, n.qton));
    g.strokeStyle = FARBE.ursprung; g.strokeRect(k.x + 0.5, k.y + 0.5, k.w - 1, k.h - 1);
  }
  for (const n of noten) {
    const k = notenKasten(a, n);
    if (k.x > breite || k.x + k.w < TASTEN_BREITE) continue;
    g.globalAlpha = 0.55 + 0.45 * Math.max(0, Math.min(1, n.p ?? 1));
    g.fillStyle = FARBE.note; g.fillRect(k.x, k.y, k.w, k.h);
    g.globalAlpha = 1;
    g.fillStyle = FARBE.notenRand; g.fillRect(k.x, k.y + k.h - 1, k.w, 1);
  }
  if (sicht.kurve) {
    g.strokeStyle = FARBE.kurve; g.lineWidth = 1;
    g.beginPath();
    for (const n of noten) {
      const k = notenKasten(a, n);
      if (k.x > breite || k.x + k.w < TASTEN_BREITE) continue;
      const p = kurvePunkte(sicht.kurve, n, a);
      p.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
    }
    g.stroke();
  }
  g.strokeStyle = FARBE.auswahl; g.lineWidth = 1;
  for (const n of noten) if (auswahl.has(n.id)) { const k = notenKasten(a, n); g.strokeRect(k.x - 0.5, k.y - 0.5, k.w + 1, k.h + 1); }
  if (ui.zug && ui.zug.um !== 0) {
    g.fillStyle = FARBE.vorschau;
    let zeigt = null;
    for (const n of noten) {
      if (!ui.zug.ids.includes(n.id)) continue;
      const neu = (n.ton ?? n.qton) + ui.zug.um, k = notenKasten(a, mitTon(n, neu));
      g.fillRect(k.x, k.y, k.w, k.h);
      zeigt ??= { k, neu };
    }
    if (zeigt) {
      g.font = '10px ui-monospace, monospace'; g.fillStyle = FARBE.vorschauText;
      g.fillText(`${tonName(Math.round(zeigt.neu))} ${zeigt.neu.toFixed(2)}`, zeigt.k.x + zeigt.k.w + 4, zeigt.k.y + TON_HOEHE - 1);
    }
  }
  if (ui.zeit?.length) {                                      // time drag preview: moved notes and neighbours that follow, with the pitch line along the new map
    g.fillStyle = FARBE.vorschau; g.strokeStyle = FARBE.vorschauText;
    for (const n of ui.zeit) {
      const k = notenKasten(a, n);
      g.fillRect(k.x, k.y, k.w, k.h);
      const p = kurvePunkte(sicht.kurve, n, a);
      if (p.length) { g.beginPath(); p.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y))); g.stroke(); }
    }
  }
  g.restore();

  g.font = '8px ui-monospace, monospace';
  for (let t = Math.floor(a.tonOben) + 1; t >= unterste; t--) {
    if (t < 0 || t > 127) continue;
    g.fillStyle = istSchwarz(t) ? FARBE.tasteSchwarz : FARBE.tasteWeiss;
    g.fillRect(0, zeile(t), TASTEN_BREITE - 1, TON_HOEHE);
    if (t % 12 === 0) { g.fillStyle = FARBE.tasteText; g.fillText(tonName(t), 2, zeile(t) + TON_HOEHE - 1); }
  }
  g.fillStyle = FARBE.tasteTrenner; g.fillRect(TASTEN_BREITE - 1, 0, 1, hoehe);
}

// The waveform behind the notes, faint, only where the source exists; one column per pixel, vertically over the whole height
function zeichneWelle(g, a, sicht, breite, hoehe) {
  if (!sicht.welle || !(sicht.quelleS > 0)) return;
  const s0 = Math.max(0, xZuS(a, TASTEN_BREITE)), s1 = Math.min(sicht.quelleS, xZuS(a, breite));
  if (!(s1 > s0)) return;
  const x0 = sZuX(a, s0), x1 = sZuX(a, s1), n = Math.max(1, Math.round(x1 - x0)), breiteSpalte = (x1 - x0) / n, mitte = hoehe / 2;
  const spalten = sicht.welle.hole(s0, s1, n) ?? [];
  g.fillStyle = FARBE.welle;
  spalten.forEach(([lo, hi], i) => {
    const y0 = mitte - Math.max(lo, hi) * mitte, y1 = mitte - Math.min(lo, hi) * mitte;
    g.fillRect(x0 + i * breiteSpalte, y0, Math.max(1, breiteSpalte), Math.max(1, y1 - y0));
  });
}
