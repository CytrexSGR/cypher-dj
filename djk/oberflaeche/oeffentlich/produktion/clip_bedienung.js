// PRODUCTION (D1 V2): Clips im Arrangement bedienen (Spec A2): wählen (Klick, Umschalt/Strg+Klick mehrere), verschieben
// (auch auf eine andere Spur gleicher Art), Ränder kürzen, Fades an den oberen Ecken ziehen, Strg+D duplizieren, Strg+E an der
// Startmarke teilen, Entf löschen, Doppelklick ins Leere einer Instrument-Spur legt einen MIDI-Clip an. Ein Zug schickt beim
// Loslassen genau EINE Änderung (ein Verlaufseintrag, Undo nimmt den ganzen Zug zurück); bis dahin zeigt das Arrangement den
// Entwurf (st.projektEntwurf, entwurf.js). Tasten nur, solange die Spurfläche den Fokus hat: so bleiben ↑/↓, Leertaste, S
// und L dem Browser links (app.js bindeSchublade). Gibt ctx.zug (Zug-Lauf) und die Auswahl an die Piano-Roll weiter.
// Clip-Loop (Spec 6.17): Strg+L schaltet den Loop der gewählten Clips (loop_beats = Länge bzw. null), danach zieht die rechte Kante die
// Länge; die Überlagerung zeigt jede Wiederholung als Kachel mit Trennstrich. Teilen und links kürzen sind bei Loop-Clips gesperrt.
import { xZuBeat, rasterBeats } from './zeitachse.js';
import { CLIP_KOPF, clipKasten, sichtbar, spurIndexBei } from './layout.js';
import { neueClipIds, neuerZugLauf, findeClip } from './entwurf.js';
import { trefferClip, fadePunkte, istZug, zugBefehle, zugLabel, teile, dupliziere, loesche, neuerMidiClip, CLIP_TEXT, istLoop, schalteLoop, loopImWeg, kacheln } from './clips.js';

export function bindeClips(ctx) {
  const { st, $ } = ctx;
  const ueber = $('ueber'), flaeche = $('flaeche');
  st.auswahl = [];            // gewählte clip_ids; die letzte ist die, die der Detailbereich zeigt
  st.projektEntwurf = null;   // Entwurf während eines Zugs (zeitachse_bedienung.js zeichnet ihn statt st.projekt)
  ctx.beimAuswahl = [];
  ueber.tabIndex = 0;
  ueber.title = 'Click: select clip, start marker · drag: move · edges: trim · top corners: fade · Del · Ctrl+D duplicate · Ctrl+E split at marker · Ctrl+L loop on/off · double click on an instrument track: new MIDI clip · wheel: scroll · Ctrl+wheel: zoom';

  ctx.setzeAuswahl = (ids) => {
    const neu = [...new Set(ids)];
    if (neu.length === st.auswahl.length && neu.every((x, i) => x === st.auswahl[i])) return;
    st.auswahl = neu;
    for (const h of ctx.beimAuswahl) h(st.auswahl);
  };
  // Züge (auch die der Piano-Roll) laufen über ctx.zug (entwurf.js neuerZugLauf, Spec 6.34): Entwurf nur Anzeige, beim Loslassen EINE Änderung
  ctx.zug = neuerZugLauf({
    stand: () => st.projekt,
    zeige: (p) => { st.projektEntwurf = p; },
    sende: (rechne) => ctx.aendereMit(rechne),          // Spec 6.34: gerechnet, wenn die Anfrage an der Reihe ist, mit genau dessen rev
  });
  // Nach einer Änderung, die neue Clips bringt (Duplizieren, Teilen, Anlegen), wandert die Auswahl auf die neuen.
  // V2 Fix-Runde 2 H1 (Spec 6.34): befehleAus(p) rechnet aus dem Stand beim Senden (ctx.aendereAus), nicht beim Tastendruck; ein Zug davor,
  // der noch unterwegs ist, steckt dann schon in p (vorher landete Strg+D hinter der alten Lage). label(befehle) → Text.
  async function aendereUndWaehle(label, befehleAus) {
    let alt = null;
    const ok = await ctx.aendereAus((p) => { const b = befehleAus(p); alt = p; return b.length ? { label: label(b), befehle: b } : null; });
    if (ok && alt) ctx.setzeAuswahl(neueClipIds(alt, st.projekt));
  }

  // Zeiger: im Einfangen auf der Fläche, damit die Griffe vor transport.js entscheiden (preventDefault: Startmarke bleibt)
  flaeche.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target !== ueber || !st.projekt) return;
    ueber.focus({ preventScroll: true });
    const t = trefferClip(st.projekt, st.ansicht, e.offsetX, e.offsetY);
    if (!t) { ctx.zug.beginne().verwirf(); if (!(e.shiftKey || e.ctrlKey || e.metaKey)) ctx.setzeAuswahl([]); return; }   // Klick ins Leere: auch ein Klick ohne Ziehen (6.34)
    if (t.zone !== 'mitte') e.preventDefault();
    const id = t.clip.id, gewaehlt = st.auswahl.includes(id);
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      if (gewaehlt) { ctx.setzeAuswahl(st.auswahl.filter((x) => x !== id)); return; }
      ctx.setzeAuswahl([...st.auswahl, id]);
    } else if (!gewaehlt) ctx.setzeAuswahl([id]);
    else ctx.setzeAuswahl([...st.auswahl.filter((x) => x !== id), id]);
    beginneZug(e, t, gewaehlt && !(e.shiftKey || e.ctrlKey || e.metaKey));
  }, true);

  function beginneZug(e, t, warGewaehlt) {
    const p0 = st.projekt, x0 = e.offsetX, y0 = e.offsetY, b0 = xZuBeat(st.ansicht, x0), auswahl = [...st.auswahl];
    const zug = ctx.zug.beginne();
    let gezogen = false;
    ueber.setPointerCapture(e.pointerId);
    const bewege = (m) => {
      if (!gezogen && !istZug(m.offsetX - x0, m.offsetY - y0)) return;
      gezogen = true;
      const zi = spurIndexBei(m.offsetY, p0.spuren.length), dBeat = xZuBeat(st.ansicht, m.offsetX) - b0, dSpur = zi < 0 ? 0 : zi - t.spurIndex, raster = rasterBeats(st.raster);
      // Spec 6.34: aus dem Stand p, der gezeigt bzw. gesendet wird (nicht aus p0): derselbe Clip dort, dieselbe Bewegung der Maus
      zug.bewege((p) => {
        const f = findeClip(p, t.clip.id);
        const befehle = f ? zugBefehle(p, { ...t, clip: f.clip, spur: f.spur, spurIndex: f.spurIndex }, auswahl, dBeat, dSpur, raster, p.tempo_bpm) : [];
        return { label: zugLabel(t.zone, befehle), befehle };
      });
    };
    const los = () => {
      ueber.removeEventListener('pointermove', bewege);
      ueber.removeEventListener('pointerup', ende);
      ueber.removeEventListener('pointercancel', abbruch);
      abbrechen = null;
    };
    // V2 Fix F7 (Spec 6.34): pointercancel und Esc verwerfen den Entwurf, ohne zu senden; das Loslassen danach tut nichts mehr
    const abbruch = () => { los(); zug.verwirf(); };
    abbrechen = abbruch;
    const ende = () => {
      los();
      if (!gezogen) { zug.verwirf(); if (warGewaehlt) ctx.setzeAuswahl([t.clip.id]); return; }
      if (t.zone === 'links' && istLoop(t.clip)) ctx.melde(CLIP_TEXT.loop_links, true);   // Spec 6.17: der Loop beginnt am Clip-Anfang
      zug.lass();
    };
    ueber.addEventListener('pointermove', bewege);
    ueber.addEventListener('pointerup', ende);
    ueber.addEventListener('pointercancel', abbruch);
  }
  let abbrechen = null;                                   // Abbruch des laufenden Zugs (Esc), sonst null

  ueber.addEventListener('dblclick', async (e) => {
    if (!st.projekt || trefferClip(st.projekt, st.ansicht, e.offsetX, e.offsetY)) return;
    const r = neuerMidiClip(st.projekt, spurIndexBei(e.offsetY, st.projekt.spuren.length), xZuBeat(st.ansicht, e.offsetX), rasterBeats(st.raster));
    if (r.fehler) { ctx.melde(CLIP_TEXT[r.fehler], true); return; }
    aendereUndWaehle(() => 'Add MIDI clip', () => [r.befehl]);   // Spur und Beat, auf die die Person gezeigt hat (fest)
  });

  ctx.clipAktion = (aktion) => {
    const ids = st.auswahl;
    if (!st.projekt || ids.length === 0) return false;
    if (aktion === 'loeschen') {                                  // V2 Fix F6: erst die Antwort, die Auswahl geht nur bei Erfolg
      ctx.aendere(ids.length === 1 ? 'Delete clip' : `Delete ${ids.length} clips`, loesche(ids)).then((ok) => { if (ok) ctx.setzeAuswahl(st.auswahl.filter((id) => !ids.includes(id))); });
      return true;
    }
    const wahl = [...ids];                                        // die Auswahl beim Drücken; die Lagen aus dem Stand beim Senden (H1)
    if (aktion === 'duplizieren') { aendereUndWaehle((b) => (b.length === 1 ? 'Duplicate clip' : `Duplicate ${b.length} clips`), (p) => dupliziere(p, wahl)); return true; }
    if (aktion === 'teilen') {
      const beat = st.start, b = teile(st.projekt, ids, beat), loop = loopImWeg(st.projekt, ids, beat);   // Meldungen aus dem gezeigten Stand
      if (b.length === 0) { ctx.melde(loop ? CLIP_TEXT.loop_teilen : CLIP_TEXT.nichts_zu_teilen, true); return true; }
      aendereUndWaehle((x) => (x.length === 1 ? 'Split clip' : `Split ${x.length} clips`), (p) => teile(p, wahl, beat));
      if (loop) ctx.melde(CLIP_TEXT.loop_teilen, true);           // die übrigen sind geteilt, die Loop-Clips nicht
      return true;
    }
    if (aktion === 'loop') {                                       // Spec 6.17: alle gewählten nach dem Zustand des zuletzt gewählten
      ctx.aendereAus((p) => {                                      // H1: loop_beats = Länge im Stand beim Senden (ein Kürzen davor zählt mit)
        const cs = p.spuren.flatMap((s) => s.clips).filter((c) => wahl.includes(c.id));
        if (cs.length === 0) return null;
        const an = !istLoop(cs.find((c) => c.id === wahl.at(-1)) ?? cs[0]);
        const b = cs.filter((c) => istLoop(c) !== an).map(schalteLoop);
        return b.length ? { label: an ? 'Loop on' : 'Loop off', befehle: b } : null;
      });
      return true;
    }
    return false;
  };
  // Tasten der Spurfläche; behandelte Tasten gehen nicht weiter an app.js (Library) und nicht an den Browser (Strg+D, Strg+E)
  const TASTEN = {
    delete: () => ctx.clipAktion('loeschen'), backspace: () => ctx.clipAktion('loeschen'), escape: () => ctx.setzeAuswahl([]),
    'strg+d': () => ctx.clipAktion('duplizieren'), 'strg+e': () => ctx.clipAktion('teilen'), 'strg+l': () => ctx.clipAktion('loop'),
    'strg+a': () => ctx.setzeAuswahl(st.projekt.spuren.flatMap((s) => s.clips.map((c) => c.id))),
  };
  ueber.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && abbrechen) { e.preventDefault(); e.stopPropagation(); abbrechen(); return; }   // Esc während eines Zugs: nur der Zug
    if (!st.projekt || e.altKey || e.shiftKey) return;
    const f = TASTEN[`${e.ctrlKey || e.metaKey ? 'strg+' : ''}${e.key.toLowerCase()}`];
    if (!f) return;
    e.preventDefault(); e.stopPropagation();
    f();
  });

  // Auswahl bereinigen, wenn Clips verschwinden (Undo, Cypher, Löschen); ein neuer Serverstand verwirft den Entwurf, wenn kein Zug läuft (6.34)
  ctx.beimProjekt.push((p) => {
    ctx.zug.neuerStand();
    const da = new Set((p?.spuren ?? []).flatMap((s) => s.clips.map((c) => c.id)));
    if (st.auswahl.some((id) => !da.has(id))) ctx.setzeAuswahl(st.auswahl.filter((id) => da.has(id)));
  });

  // Überlagerung: Fade-Linien aller Audio-Clips, Rahmen und Griffe der gewählten (nach arrangement.js, das sie löscht)
  const g = ueber.getContext('2d');
  ctx.beimBild.push(() => {
    const p = st.projektEntwurf ?? st.projekt;
    if (!p) return;
    const a = st.ansicht, w = ueber.width;
    const auswahl = new Set(st.auswahl);   // V2 Fix-Runde 2 H8 (Klasse F4): einmal je Bild, nicht includes je Clip (2000 gewählt: 2003 Aufrufe je Bild)
    p.spuren.forEach((spur, i) => {
      for (const c of spur.clips) {
        const k = clipKasten(a, i, c);
        if (!sichtbar(k, w)) continue;
        const gewaehlt = auswahl.has(c.id);
        if (istLoop(c)) zeichneKacheln(g, k, c, a, w);
        if (c.art === 'audio' && (c.fade_ein_beats > 0 || c.fade_aus_beats > 0 || gewaehlt)) zeichneFades(g, k, c, a, gewaehlt);
        if (gewaehlt) { g.strokeStyle = '#ffffff'; g.lineWidth = 2; g.strokeRect(k.x + 1, k.y + 1, Math.max(0, k.w - 2), k.h - 2); g.lineWidth = 1; }
      }
    });
  });
}

// Loop-Kacheln (Spec 6.17): jede Wiederholung hinter dem ersten Durchlauf leicht abgedunkelt, mit Trennstrich an ihrem Anfang.
// Gerechnet werden nur die Kacheln im sichtbaren Bereich der Fläche (Breite w), ohne Deckel (V2 Fix F5).
function zeichneKacheln(g, k, c, a, w) {
  const oben = k.y + CLIP_KOPF, unten = k.y + k.h;
  for (const t of kacheln(c, a.beat0, a.beat0 + w / a.pxProBeat)) {
    if (t.start === c.start_beat) continue;                         // der erste Durchlauf bleibt ohne Trennstrich

    const x = k.x + (t.start - c.start_beat) * a.pxProBeat;
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x, oben, t.laenge * a.pxProBeat, unten - oben);
    g.strokeStyle = 'rgba(255,255,255,0.8)'; g.beginPath(); g.moveTo(Math.round(x) + 0.5, oben); g.lineTo(Math.round(x) + 0.5, unten); g.stroke();
  }
}

function zeichneFades(g, k, c, a, gewaehlt) {
  const f = fadePunkte(k, c, a), oben = k.y + CLIP_KOPF, unten = k.y + k.h;
  g.fillStyle = 'rgba(0,0,0,0.35)';
  if (c.fade_ein_beats > 0) { g.beginPath(); g.moveTo(k.x, oben); g.lineTo(f.ein, oben); g.lineTo(k.x, unten); g.closePath(); g.fill(); }
  if (c.fade_aus_beats > 0) { g.beginPath(); g.moveTo(f.aus, oben); g.lineTo(k.x + k.w, oben); g.lineTo(k.x + k.w, unten); g.closePath(); g.fill(); }
  g.strokeStyle = '#e8e8ec';
  if (c.fade_ein_beats > 0) { g.beginPath(); g.moveTo(k.x, unten); g.lineTo(f.ein, oben); g.stroke(); }
  if (c.fade_aus_beats > 0) { g.beginPath(); g.moveTo(f.aus, oben); g.lineTo(k.x + k.w, unten); g.stroke(); }
  if (gewaehlt) {
    g.fillStyle = '#ffb020';
    g.fillRect(Math.round(f.ein) - 3, k.y + 2, 6, 6);
    g.fillRect(Math.round(f.aus) - 3, k.y + 2, 6, 6);
  }
}
