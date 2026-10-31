// PRODUCTION (Paket 1.13 Warp, Slice 3b): der Sample-Editor im Detailbereich, der zeichnende und zuhörende Teil (gerechnet wird in warp_editor.js). Die Welle liegt in
// Quellzeit, oben die Marker-Leiste in Gelb. Eine Geste ist EIN Befehl: das Ziehen sendet beim Loslassen (bis dahin zeigt das Bild nur die Vorschau), und jede Änderung rechnet
// erst, wenn sie im Schreiber an der Reihe ist (ctx.aendereAus, aus dem Stand mit der passenden rev). Der Marker wird dafür über seinen Beat gefunden, nicht über den Index.
import { neueWellen } from './wellen.js';
import { spalten, zeichneSpalte, SR } from '../welle.js';
import { findeClip } from './entwurf.js';
import { quellSekunde } from './warp.js';
import { neueAnsicht, zoomAnsicht, scrolleAnsicht, markerBei, doppelklick, ziehen, menuPunkte, segmentText, markerText, sZuX, xZuS, transientenPixel, transientenImClip } from './warp_editor.js';
import { oeffneMenue, schliesseMenue } from './kontextmenue.js';

export const LEISTE_HOEHE = 22;
const GELB = '#e0a83b';
const TRANSIENT_VORGABE = 'rgba(160, 165, 175, 0.45)';       // --p-transient in produktion.css (grau, 45 % Deckkraft)
// Slice 4 (T10): die Seite hat /proj/warp bisher nirgends geladen. Alle Transienten der Quelle (Quellsekunden, unabhängig von Markern, Bereich und Fenster: transienten_quelle=1) in einer Anfrage,
// Antwort { warp: { transienten_zahl, transienten } }; die Marker und den Bereich des Clips wendet der Editor selbst an (transientenImClip)
const holeLageVorgabe = (url) => fetch(url).then((r) => (r.ok ? r.json() : null));

export function bindeWarpEditor(ctx, canvas, infoElement, { menue = oeffneMenue, wellen = neueWellen(), holeLage = holeLageVorgabe } = {}) {
  const { st } = ctx;
  const g = canvas.getContext('2d');
  let clipId = null, a = { s0: 0, pxProS: 40 }, schmutzig = true, zug = null, zeiger = null;
  // Fix-Runde Slice 4 (Punkt 3), Schlussrunde Punkt 1: Transienten hängen nur an der Quelle, der Schlüssel ist Clip und Quelle (id|sha). Marker, Versatz, Länge und Loop
  // gehören nicht dazu: die Liste kommt in Quellsekunden und wird bei jedem Bild und jedem Menü über die aktuellen Marker auf den Clip-Bereich abgebildet. Höchstens 8
  // Einträge, der älteste geht zuerst. Ein Ladefehler wird für den Schlüssel gemerkt; ein neuer Versuch erst, wenn der Editor zwischendurch einen anderen Clip gezeigt hat.
  const MAX_TRANS = 8;
  const transLage = new Map(), transFrage = new Set(), transFehler = new Set();          // Schlüssel → Quellsekunden; laufende Anfragen; gescheiterte Schlüssel
  const transSchluessel = (c) => `${c.id}|${c.quelle.sha256}`;
  const begrenze = (menge) => { while (menge.size > MAX_TRANS) menge.delete(menge.keys().next().value); };
  let letzter = null;
  function ladeTransienten(clip) {
    const k = transSchluessel(clip);
    if (k !== letzter) { transFehler.delete(k); letzter = k; }                                // Wechsel des Clips oder der Quelle: ein früherer Fehler gilt nicht mehr
    if (transLage.has(k) || transFrage.has(k) || transFehler.has(k)) return;
    transFrage.add(k);
    Promise.resolve().then(() => holeLage(`/proj/warp?clip_id=${encodeURIComponent(clip.id)}&marker_max=1&transienten_max=32768&transienten_quelle=1`))
      .then((j) => {
        const w = j?.warp ?? j;
        if (!w || !Array.isArray(w.transienten)) { transFehler.add(k); begrenze(transFehler); return; }                    // keine Antwort: Fehler
        if (w.transienten_zahl !== null) { transLage.set(k, w.transienten); begrenze(transLage); }   // null: noch nicht dekodiert, nicht merken
      })
      .catch(() => { transFehler.add(k); begrenze(transFehler); })                                         // Fehler: ohne Transienten zeichnen, keine Meldung
      .finally(() => { transFrage.delete(k); schmutzig = true; });
  }
  // Transienten im Bereich des Clips mit den Markern von jetzt (null: noch nicht geladen); Quantize Audio und das Zeichnen rechnen daraus
  const imClip = (c) => { const l = transLage.get(transSchluessel(c)); return l ? transientenImClip(c, l) : null; };
  const zahlVon = (c) => imClip(c)?.length ?? null;
  const clipJetzt = (p = st.projekt) => { const f = clipId ? findeClip(p, clipId) : null; return f?.clip.art === 'audio' && f.clip.warp ? f.clip : null; };
  const x = (e) => e.offsetX;
  const index = (clip, beat) => clip.warp.marker.findIndex((m) => Math.abs(m[1] - beat) < 1e-6);

  // Für die Browserprobe und die Tests: wo liegt der Marker mit diesem Beat in Fensterpixeln?
  st.editor = {
    ansicht: () => ({ ...a }),
    markerFenster(beat) {
      const clip = clipJetzt(), r = canvas.getBoundingClientRect();
      const i = clip ? index(clip, beat) : -1;
      return i < 0 ? null : { x: r.left + sZuX(a, clip.warp.marker[i][0]), y: r.top + LEISTE_HOEHE / 2 };
    },
    stelleFenster(s, hoehe = 0.6) { const r = canvas.getBoundingClientRect(); return { x: r.left + sZuX(a, s), y: r.top + LEISTE_HOEHE + (r.height - LEISTE_HOEHE) * hoehe }; },
  };

  function zeige(clip) {
    const neu = clip?.art === 'audio' && clip.warp ? clip.id : null;
    if (neu !== clipId) { schliesseMenue(); clipId = neu; zug = null; a = neu ? neueAnsicht(clip, a.pxProS) : a; }
    schmutzig = true;
    if (neu) ladeTransienten(clip);
  }

  function zeichne() {
    const r = canvas.getBoundingClientRect(), w = Math.round(r.width), h = Math.round(r.height);
    if (w === 0 || h === 0) return;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    g.fillStyle = '#0b0d11'; g.fillRect(0, 0, w, h);
    const clip = clipJetzt();
    if (!clip) return;
    const m = clip.warp.marker, hoeheWelle = h - LEISTE_HOEHE;
    const e = wellen.hole(clip.quelle.sha256, () => { schmutzig = true; });
    if (e.welle) {
      g.save(); g.translate(0, LEISTE_HOEHE);
      for (let px = 0; px < w; px++) zeichneSpalte(g, px, hoeheWelle / 2, spalten(e.welle, (xZuS(a, px) * SR) / e.welle.hop, (xZuS(a, px + 1) * SR) / e.welle.hop), e.welle.gain);
      g.restore();
    } else {
      g.fillStyle = '#8a8f98'; g.font = '11px ui-monospace, monospace';
      g.fillText(e.fehler ? `no waveform: ${e.fehler}` : 'loading waveform…', 8, LEISTE_HOEHE + 16);
    }
    // außerhalb des gespielten Stücks: abgedunkelt
    const von = sZuX(a, quellSekunde(m, clip.warp.versatz_beats)), bis = sZuX(a, quellSekunde(m, clip.warp.versatz_beats + clip.laenge_beats));
    g.fillStyle = 'rgba(11,13,17,0.6)';
    if (von > 0) g.fillRect(0, LEISTE_HOEHE, Math.min(w, von), hoeheWelle);
    if (bis < w) g.fillRect(Math.max(0, bis), LEISTE_HOEHE, w - Math.max(0, bis), hoeheWelle);
    g.fillStyle = '#15181e'; g.fillRect(0, 0, w, LEISTE_HOEHE);
    // Punkt 4: alle Transienten in einem Pfad mit einem stroke, höchstens eine Linie je Pixelspalte (transientenPixel dedupliziert), Farbe einmal je Bild
    const tpx = transientenPixel(a, imClip(clip), w);
    if (tpx.length) {
      g.strokeStyle = globalThis.getComputedStyle?.(canvas)?.getPropertyValue('--p-transient')?.trim() || TRANSIENT_VORGABE;
      g.beginPath();
      for (const px of tpx) { g.moveTo(px, LEISTE_HOEHE); g.lineTo(px, h); }
      g.stroke();
    }
    g.font = '10px ui-monospace, monospace';
    m.forEach(([s, beat]) => {
      const gezogen = zug && zug.beat === beat;
      const px = Math.round(sZuX(a, s) + (gezogen && !zug.umschalt ? (zug.dxZeigen ?? 0) : 0)) + 0.5;
      if (px < -40 || px > w + 40) return;
      const eins = Math.abs(beat) < 1e-9;
      g.strokeStyle = gezogen ? '#fff' : GELB; g.globalAlpha = eins ? 0.95 : 0.55;
      g.beginPath(); g.moveTo(px, 0); g.lineTo(px, h); g.stroke(); g.globalAlpha = 1;
      g.fillStyle = gezogen ? '#fff' : GELB;
      g.beginPath(); g.moveTo(px - 4, 0); g.lineTo(px + 4, 0); g.lineTo(px, 8); g.closePath(); g.fill();
      const text = gezogen && zug.umschalt ? String(Math.round(zug.beatNeu * 100) / 100) : markerText(beat);
      if (text) g.fillText(text, px + 5, 17);
    });
    if (zeiger !== null && !zug) { g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(Math.round(zeiger), LEISTE_HOEHE, 1, hoeheWelle); }
  }
  ctx.beimBild.push(() => {
    if (clipId && Math.round(canvas.getBoundingClientRect().width) !== canvas.width) schmutzig = true;   // Fenster geändert: die Bitmap passt nicht mehr
    if (schmutzig && clipId) { schmutzig = false; zeichne(); } });
  ctx.beimProjekt.push(() => { schmutzig = true; });

  const sende = (rechne) => ctx.aendereAus((p) => {
    const clip = clipJetzt(p), r = clip ? rechne(clip) : null;
    return r?.befehle ? { label: r.label, befehle: r.befehle } : null;
  });
  const zeigeInfo = (px) => { infoElement.textContent = clipJetzt() ? `segment ${segmentText(clipJetzt(), a, px)}` : ''; };

  canvas.addEventListener('pointerdown', (e) => {
    const clip = clipJetzt();
    if (e.button !== 0 || !clip) return;
    const i = markerBei(clip.warp.marker, a, x(e));
    if (i < 0) return;
    e.preventDefault(); canvas.setPointerCapture?.(e.pointerId); canvas.focus?.({ preventScroll: true });
    zug = { beat: clip.warp.marker[i][1], x0: x(e), dx: 0, umschalt: e.shiftKey, beatNeu: clip.warp.marker[i][1] };
    schmutzig = true;
  });
  canvas.addEventListener('pointermove', (e) => {
    zeiger = x(e); zeigeInfo(zeiger);
    if (zug) {
      zug.dx = x(e) - zug.x0; zug.umschalt = e.shiftKey;
      const clip = clipJetzt(), i = clip ? index(clip, zug.beat) : -1, gz = i >= 0 ? ziehen(clip, a, i, zug.dx, zug.umschalt) : null;
      zug.beatNeu = gz?.befehle[0].verschiebe[0].neu_beat ?? zug.beat;
      const q = gz?.befehle[0].verschiebe[0].neu_quell_s;                  // die Vorschau zeigt den geklemmten Zielwert
      if (!zug.umschalt) zug.dxZeigen = q != null ? (q - clip.warp.marker[i][0]) * a.pxProS : 0;
    } else {
      const clip = clipJetzt();
      canvas.style.cursor = clip && markerBei(clip.warp.marker, a, zeiger) >= 0 ? 'ew-resize' : 'default';
    }
    schmutzig = true;
  });
  const loslassen = (e) => {
    if (!zug) return;
    const z = zug; zug = null; schmutzig = true;
    canvas.releasePointerCapture?.(e.pointerId);
    if (e.type === 'pointercancel') return;
    const dx = x(e) - z.x0, umschalt = e.shiftKey;
    sende((clip) => { const i = index(clip, z.beat); return i < 0 ? null : ziehen(clip, a, i, dx, umschalt); });
  };
  canvas.addEventListener('pointerup', loslassen);
  canvas.addEventListener('pointercancel', loslassen);
  canvas.addEventListener('pointerleave', () => { zeiger = null; schmutzig = true; });
  canvas.addEventListener('dblclick', (e) => {
    const clip = clipJetzt();
    if (!clip) return;
    const r = doppelklick(clip, a, x(e));
    if (r?.fehler) ctx.melde(r.fehler, true); else if (r) sende((c) => doppelklick(c, a, x(e)));
  });
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const clip = clipJetzt();
    if (!clip) return;
    const px = x(e);
    const zahl = zahlVon(clip);
    menue(menuPunkte(clip, a, px, zahl).map((p) => ({ text: p.text, aus: p.aus, aktion: () => sende((c) => { const q = menuPunkte(c, a, px, zahl).find((y) => y.id === p.id); return q && !q.aus ? { label: q.label, befehle: [q.befehl] } : null; }) })),
      e.clientX, e.clientY);
  });
  canvas.addEventListener('wheel', (e) => {
    if (!clipJetzt()) return;
    e.preventDefault();
    a = e.ctrlKey || e.metaKey ? zoomAnsicht(a, 1.25 ** (-e.deltaY / 100), x(e)) : scrolleAnsicht(a, e.deltaX || e.deltaY);
    schmutzig = true;
  }, { passive: false });

  return { zeige };
}
