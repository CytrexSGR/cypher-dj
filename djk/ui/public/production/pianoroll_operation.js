// PRODUCTION (D1 V2): Piano-Roll im Detailbereich bedienen und zeichnen (Spec A3): Doppelklick setzt eine Note, the right mouse button deletes one,
// Ziehen verschiebt (Beat und Ton), der rechte Rand zieht die Länge, Ziehen im Leeren wählt per Rechteck, unten die Velocity-Spur.
// Shift+click selects the range from the note selected last, Ctrl+click adds a note to the selection or takes it out (2026-11-17).
// Tasten bei Fokus auf der Roll: Pfeile (Raster bzw. Halbton, Umschalt: Oktave),
// Entf, Strg+A, Q (auf 1/16 quantisieren), Esc. Ein Zug ist EINE Änderung (noten_aendern), Pfeiltasten fasst strip.js zusammen.
// Die Roll zeigt den Clip aus st.projektEntwurf ?? st.projekt; ein Zug rechnet aus dem bestätigten Stand beim Zeigen bzw. Senden (Spec 6.34).
// V2 Fix-Runde 2 H1: ebenso Tasten, Quantisieren, VEL, Löschen der Auswahl und neue Noten (ctx.aendereAus): gerechnet, wenn die Anfrage an der
// Reihe ist, aus genau dem Stand, dessen rev mitgeht; vorher rechneten sie beim Tastendruck, und ein Zug davor, der noch unterwegs war, ging verloren.
import { rasterBeats, beatsProTakt, RASTER, linien } from './timeline.js';
import { findeClip } from './draft.js';
import { istZug } from './clips.js';
import { neuerSammler } from './strip.js';
import {
  TASTEN_BREITE, TON_HOEHE, VEL_HOEHE, LAENGEN, QUANT, tonName, istSchwarz, zeilen, beatZuRx, rxZuBeat, yZuTon, imRaster, inVelSpur,
  neueRollAnsicht, scrolleTon, scrolleBeat, zoomRoll, notenKasten, trefferNote, trefferVel, velZuY, yZuVel, neueNote, verschiebeNoten,
  dehneNoten, velocityNoten, quantisiere, rechteckAuswahl, bereichAuswahl, tastenSchritt, auswahlVel, notenLabel,
} from './pianoroll.js';
import { TON_NAMEN, SKALEN, SKALA_TEXT, tonartOk, tonartText, inSkala, istGrundton, akkord, inTonart, umkehrung, arpeggio, passendeTonarten } from '../harmonie.js';

const LEISTE = `<div class="p-roll-leiste">
  <label>SNAP <select data-r="raster" title="Snap grid of the piano roll"></select></label>
  <label>NOTE <select data-r="laenge" title="Length of new notes"></select></label>
  <label>VEL <input data-r="vel" inputmode="numeric" size="4" autocomplete="off" title="Velocity of the selected notes, 1 to 127: Enter sets it"></label>
  <button data-r="quant" title="Quantize the selected notes (or all) to 1/16 (Q)">QUANTIZE 1/16</button>
  <label>KEY <select data-r="grundton" title="Root of the project key: its pitches are marked in the roll"></select><select data-r="skala" title="Scale of the project key"></select></label>
  <button data-r="finde" title="Find the key that fits the notes of this clip and set it">FIND</button>
  <button data-r="fit" title="Move the selected notes (or all) that lie outside the key to the nearest pitch of the key">FIT</button>
  <button data-r="inv-ab" title="Inversion: the highest note of every chord an octave down (selection or all)">INV▼</button>
  <button data-r="inv-auf" title="Inversion: the lowest note of every chord an octave up (selection or all)">INV▲</button>
  <button data-r="arp" title="Arpeggio: every chord of the selection (or of the clip) becomes single notes on the snap grid">ARP</button>
  <span class="p-roll-hilfe">Double click: add a note · right button: delete · Alt+double click: chord · drag: move · right edge: length · drag empty: select · Shift+click: range · Ctrl+click: add · arrows · Del · Ctrl+A · Q</span>
</div>
<canvas class="p-roll" data-r="roll" tabindex="0" aria-label="Piano roll"></canvas>`;

export function bindeRolle(ctx, behaelter) {
  const { st } = ctx;
  behaelter.innerHTML = LEISTE;
  const r = (n) => behaelter.querySelector(`[data-r="${n}"]`);
  const cv = r('roll'), g = cv.getContext('2d');
  st.rolle = { clipId: null, ansicht: null, auswahl: [], rechteck: null,
    raster: ctx.lies('djk-prod-rollraster', 'sechzehntel'), laenge: Number(ctx.lies('djk-prod-notenlaenge', '0.25')) || 0.25 };
  for (const x of RASTER) r('raster').append(new Option(x.text, x.wert));
  for (const x of LAENGEN) r('laenge').append(new Option(x.text, String(x.wert)));
  r('raster').value = st.rolle.raster; r('laenge').value = String(st.rolle.laenge);
  // the key of the project (public/harmonie.js): "–" as the root means no key
  r('grundton').append(new Option('–', ''));
  TON_NAMEN.forEach((x, i) => r('grundton').append(new Option(x, String(i))));
  for (const k of Object.keys(SKALEN)) r('skala').append(new Option(SKALA_TEXT[k], k));
  r('skala').value = 'minor';
  const tonart = () => { const t = (st.projektEntwurf ?? st.projekt)?.tonart; return tonartOk(t) ? t : null; };
  let gezeigteTonart = '';
  function zeigeTonart() {
    const t = tonart(), k = t ? `${t.grundton}:${t.skala}` : '';
    if (k === gezeigteTonart) return;
    gezeigteTonart = k;
    r('grundton').value = t ? String(t.grundton) : '';
    if (t) r('skala').value = t.skala;
  }
  const setzeTonart = () => {
    const g = r('grundton').value;
    if (g === '') { if (tonart()) ctx.aendere('Key off', [{ befehl: 'tonart_setzen', aus: true }]); return; }
    ctx.aendere('Key', [{ befehl: 'tonart_setzen', grundton: Number(g), skala: r('skala').value }]);
  };
  r('grundton').addEventListener('change', setzeTonart);
  r('skala').addEventListener('change', setzeTonart);
  r('raster').addEventListener('change', () => { st.rolle.raster = r('raster').value; ctx.merke('djk-prod-rollraster', st.rolle.raster); });
  r('laenge').addEventListener('change', () => { st.rolle.laenge = Number(r('laenge').value); ctx.merke('djk-prod-notenlaenge', r('laenge').value); });

  const gezeigt = () => { const f = findeClip(st.projektEntwurf ?? st.projekt, st.rolle.clipId); return f?.clip.art === 'midi' ? f : null; };
  const bestaetigt = () => { const f = findeClip(st.projekt, st.rolle.clipId); return f?.clip.art === 'midi' ? f : null; };
  const takt = () => beatsProTakt((st.projektEntwurf ?? st.projekt)?.taktart);   // the meter of the project: BAR snap and the bar lines follow it
  const raster = () => rasterBeats(st.rolle.raster, takt());
  // noten_aendern am Clip clipId, rechne(clip) → Notenänderungen aus dem Stand beim Senden (H1); keine Änderung: nichts senden
  const notenMit = (was, clipId, rechne) => ctx.aendereAus((p) => {
    const f = findeClip(p, clipId), noten = f?.clip.art === 'midi' ? rechne(f.clip) : [];
    return noten.length ? { label: notenLabel(was, noten.length), befehle: [{ befehl: 'noten_aendern', clip_id: clipId, noten }] } : null;
  });
  function waehle(ids) { st.rolle.auswahl = [...new Set(ids)]; zeigeVel(); }
  function zeigeVel() { const f = bestaetigt(); if (f && document.activeElement !== r('vel')) r('vel').value = auswahlVel(f.clip, st.rolle.auswahl); }
  function passe() {
    const b = cv.getBoundingClientRect(), w = Math.round(b.width), h = Math.round(b.height);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  }

  // --- Zeiger ---
  cv.addEventListener('pointerdown', (e) => {
    const f = bestaetigt();
    if (e.button !== 0 || !f) return;
    cv.focus({ preventScroll: true });
    const x = e.offsetX, y = e.offsetY, a = st.rolle.ansicht;
    if (inVelSpur(x, y, cv.height)) { const n = trefferVel(f.clip, a, x, st.rolle.auswahl); if (n) velZug(e, f.clip, n, ctx.zug.beginne()); return; }
    if (!imRaster(x, y, cv.height)) return;
    const t = trefferNote(f.clip, a, x, y), mehr = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!t) { ctx.zug.beginne().verwirf(); if (!mehr) waehle([]); rechteckZug(e, f.clip, mehr); return; }   // Rechteck: kein Zug, der Entwurf geht (6.34)
    const id = t.note.id, gewaehlt = st.rolle.auswahl.includes(id);
    if (e.shiftKey) {   // Shift: the range from the note selected last to this one (2026-11-17); the anchor stays first in the list
      const anker = st.rolle.anker && f.clip.noten.some((n) => n.id === st.rolle.anker) ? st.rolle.anker : st.rolle.auswahl.at(-1) ?? id;
      st.rolle.anker = anker;
      waehle(bereichAuswahl(f.clip, anker, id));
      return;
    }
    st.rolle.anker = id;
    if (mehr) {   // Ctrl: this note joins the selection or leaves it
      if (gewaehlt) { waehle(st.rolle.auswahl.filter((z) => z !== id)); return; }
      waehle([...st.rolle.auswahl, id]);
    } else if (!gewaehlt) waehle([id]);
    notenZug(e, f.clip, t, gewaehlt && !mehr, ctx.zug.beginne());
  });
  // V2 Fix F7 (Spec 6.34): pointercancel und Esc (rollAbbruch) beenden einen Zug über abbruch statt ende, also ohne zu senden
  let rollAbbruch = null;
  function fange(e, bewege, ende, abbruch = () => {}) {
    cv.setPointerCapture(e.pointerId);
    const weg = () => { cv.removeEventListener('pointermove', bewege); cv.removeEventListener('pointerup', los); cv.removeEventListener('pointercancel', ab); rollAbbruch = null; };
    const los = () => { weg(); ende(); };
    const ab = () => { weg(); abbruch(); };
    rollAbbruch = ab;
    cv.addEventListener('pointermove', bewege);
    cv.addEventListener('pointerup', los);
    cv.addEventListener('pointercancel', ab);
  }
  // Ein Notenzug als {label, befehle} (ctx.zug, draft.js neuerZugLauf). Spec 6.34: gerechnet aus dem Stand p, der gezeigt bzw. gesendet
  // wird, nicht aus dem Stand beim pointerdown; fehlt der Clip dort, gibt es nichts zu senden.
  const notenBefehle = (was, clip, noten) => ({ label: notenLabel(was, noten.length), befehle: noten.length ? [{ befehl: 'noten_aendern', clip_id: clip.id, noten }] : [] });
  const imStand = (p, id, rechne) => { const f = findeClip(p, id); return f?.clip.art === 'midi' ? rechne(f.clip) : { label: '', befehle: [] }; };
  function notenZug(e, clip, t, warGewaehlt, zug) {
    const a = st.rolle.ansicht, x0 = e.offsetX, y0 = e.offsetY, ids = [...st.rolle.auswahl];
    let gezogen = false;
    fange(e, (m) => {
      if (!gezogen && !istZug(m.offsetX - x0, m.offsetY - y0)) return;
      gezogen = true;
      const dBeat = (m.offsetX - x0) / a.pxProBeat, dTon = Math.round((y0 - m.offsetY) / TON_HOEHE), r = raster();
      zug.bewege((p) => imStand(p, clip.id, (c) => (t.zone === 'rand' ? notenBefehle('Length of', c, dehneNoten(c, ids, t.note.id, dBeat, r))
        : notenBefehle('Move', c, verschiebeNoten(c, ids, t.note.id, dBeat, dTon, r)))));
    }, () => {
      if (!gezogen) { zug.verwirf(); if (warGewaehlt) waehle([t.note.id]); return; }
      zug.lass();
    }, () => zug.verwirf());
  }
  function rechteckZug(e, clip, mehr) {
    const x0 = e.offsetX, y0 = e.offsetY, basis = mehr ? [...st.rolle.auswahl] : [];
    fange(e, (m) => {
      if (!st.rolle.rechteck && !istZug(m.offsetX - x0, m.offsetY - y0)) return;
      st.rolle.rechteck = { x0, y0, x1: m.offsetX, y1: m.offsetY };
      waehle([...basis, ...rechteckAuswahl(clip, st.rolle.ansicht, x0, y0, m.offsetX, m.offsetY)]);
    }, () => { st.rolle.rechteck = null; }, () => { st.rolle.rechteck = null; });
  }
  function velZug(e, clip, n, zug) {
    const ids = st.rolle.auswahl.includes(n.id) ? [...st.rolle.auswahl] : [n.id];
    const setze = (m) => { const v = yZuVel(m.offsetY, cv.height); zug.bewege((p) => imStand(p, clip.id, (c) => notenBefehle('Velocity of', c, velocityNoten(c, ids, n.id, v)))); };
    setze(e);
    fange(e, setze, () => zug.lass(), () => zug.verwirf());
  }
  // The right mouse button deletes: the note under it, or the whole selection when that note is part of it
  cv.addEventListener('contextmenu', (e) => {
    const f = bestaetigt();
    if (!f || !imRaster(e.offsetX, e.offsetY, cv.height)) return;
    e.preventDefault();
    const t = trefferNote(f.clip, st.rolle.ansicht, e.offsetX, e.offsetY);
    if (!t) return;
    const ids = st.rolle.auswahl.includes(t.note.id) ? [...st.rolle.auswahl] : [t.note.id];
    waehle([]);
    ctx.aendere(notenLabel('Delete', ids.length), [{ befehl: 'noten_loeschen', clip_id: f.clip.id, ids }]);
  });
  cv.addEventListener('dblclick', async (e) => {
    const f = bestaetigt();
    if (!f || !imRaster(e.offsetX, e.offsetY, cv.height)) return;
    const a = st.rolle.ansicht, t = trefferNote(f.clip, a, e.offsetX, e.offsetY);
    if (t) return;   // a note stays on a double click (2026-11-17: the right mouse button deletes)
    const beat = rxZuBeat(a, e.offsetX), ton = yZuTon(a, e.offsetY), r = raster(), laenge = st.rolle.laenge, clipId = f.clip.id;
    let id = null;   // ID aus dem S2-Projekt-Zähler (6.28) des Stands beim Senden (H1): zwei schnelle Doppelklicks bekommen zwei IDs
    let ids = [];
    const toene = e.altKey ? akkord(ton, tonart()) : [ton];   // Alt: the chord of the key on this pitch (a minor triad without a key)
    const ok = await ctx.aendereAus((p) => {
      if (!findeClip(p, clipId)) return null;
      const n = neueNote(p, beat, ton, r, laenge);
      const nr = Number(n.id.slice(1));
      const noten = toene.map((t, i) => ({ ...n, id: `n${nr + i}`, ton: t }));
      id = n.id; ids = noten.map((x) => x.id);
      return { label: e.altKey ? 'Add chord' : notenLabel('Add', 1), befehle: [{ befehl: 'noten_neu', clip_id: clipId, noten }] };
    });
    if (ok) waehle(ids);
  });
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const a = st.rolle.ansicht;
    if (!a) return;
    if (e.ctrlKey) st.rolle.ansicht = zoomRoll(a, e.deltaY < 0 ? 1.15 : 1 / 1.15, e.offsetX);
    else if (e.shiftKey) st.rolle.ansicht = scrolleBeat(a, e.deltaY);
    else st.rolle.ansicht = scrolleTon(a, e.deltaY < 0 ? 2 : -2, cv.height);
  }, { passive: false });

  // --- Tasten und Werkzeugleiste ---
  // Pfeiltasten: die Summe der gestauten Schritte (strip.js) wird erst gerechnet, wenn sie im Schreiber an der Reihe ist (H1), und zwar für die Noten,
  // die beim Drücken gewählt waren (D1 S3 Auftrag 16 c: wer zwischen Drücken und Senden anders wählt, verschiebt nicht die neue Auswahl)
  const sammler = neuerSammler((d, mit) => notenMit('Move', mit.clipId, (c) => verschiebeNoten(c, mit.ids, mit.ids.at(-1), d.dBeat ?? 0, d.dTon ?? 0, 0)));
  function loescheAuswahl(clip) {
    const ids = st.rolle.auswahl.filter((id) => clip.noten.some((n) => n.id === id));
    if (ids.length === 0) return;
    waehle([]);
    ctx.aendereAus((p) => {
      const f = findeClip(p, clip.id), da = f ? ids.filter((id) => f.clip.noten.some((n) => n.id === id)) : [];
      return da.length ? { label: notenLabel('Delete', da.length), befehle: [{ befehl: 'noten_loeschen', clip_id: clip.id, ids: da }] } : null;
    });
  }
  // Quantisieren: die Auswahl beim Drücken, die Lagen aus dem Stand beim Senden (H1); liegt dort schon alles auf dem Raster, nur die Meldung
  function quant(clip) {
    const ids = [...st.rolle.auswahl];
    notenMit('Quantize', clip.id, (c) => {
      const noten = quantisiere(c, ids, QUANT);
      if (noten.length === 0) ctx.melde('Already on the 1/16 grid');
      return noten;
    });
  }
  cv.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && rollAbbruch) { e.preventDefault(); e.stopPropagation(); rollAbbruch(); return; }   // Esc während eines Zugs: nur der Zug
    const f = bestaetigt();
    if (!f || e.altKey) return;
    const strg = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    const schritt = strg ? null : tastenSchritt(e.key, e.shiftKey, raster());
    if (schritt) { if (st.rolle.auswahl.length) sammler.schritt(schritt, { clipId: st.rolle.clipId, ids: [...st.rolle.auswahl] }); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && !strg) loescheAuswahl(f.clip);
    else if (strg && k === 'a') waehle(f.clip.noten.map((n) => n.id));
    else if (!strg && k === 'q') quant(f.clip);
    else if (e.key === 'Escape') waehle([]);
    else if (!(strg && k === 'd')) return;                 // Strg+D: kein Lesezeichen, sonst nichts
    e.preventDefault(); e.stopPropagation();
  });
  r('quant').addEventListener('click', () => { const f = bestaetigt(); if (f) quant(f.clip); });
  // Harmony tools: on the selected notes, or on all notes of the clip when none is selected
  const wirk = (c, ids) => (ids.length ? c.noten.filter((n) => ids.includes(n.id)) : c.noten);
  r('finde').addEventListener('click', () => {
    const f = bestaetigt(), e = f ? passendeTonarten(f.clip.noten, 3) : [];
    if (!e.length) { ctx.melde('No notes to read a key from', true); return; }
    const name = (x) => tonartText({ grundton: x.grundton, skala: x.skala }), auch = e.slice(1).filter((x) => x.anteil >= e[0].anteil - 1e-9).map(name);
    ctx.aendere('Key', [{ befehl: 'tonart_setzen', grundton: e[0].grundton, skala: e[0].skala }]);
    ctx.melde(`Key set to ${name(e[0])}: ${Math.round(e[0].anteil * 100)} % of the notes fit${auch.length ? ` (fits as well: ${auch.join(', ')})` : ''}`);
  });
  r('fit').addEventListener('click', () => {
    const f = bestaetigt(), t = tonart(), ids = [...st.rolle.auswahl];
    if (!f) return;
    if (!t) { ctx.melde('Set a key first (KEY)', true); return; }
    notenMit('Fit to key', f.clip.id, (c) => { const x = inTonart(wirk(c, ids), t); if (!x.length) ctx.melde('Every note lies in the key'); return x; });
  });
  const kehre = (richtung) => { const f = bestaetigt(), ids = [...st.rolle.auswahl]; if (f) notenMit('Invert', f.clip.id, (c) => umkehrung(wirk(c, ids), richtung)); };
  r('inv-ab').addEventListener('click', () => kehre(-1));
  r('inv-auf').addEventListener('click', () => kehre(1));
  r('arp').addEventListener('click', () => {
    const f = bestaetigt(), ids = [...st.rolle.auswahl], schritt = raster() > 0 ? raster() : QUANT;
    if (!f) return;
    const clipId = f.clip.id;
    waehle([]);
    ctx.aendereAus((p) => {
      const g = findeClip(p, clipId);
      if (g?.clip.art !== 'midi') return null;
      const a = arpeggio(wirk(g.clip, ids), schritt, 'up');
      if (!a.loeschen.length) { ctx.melde('Arpeggio needs notes that start together (a chord)', true); return null; }
      return { label: 'Arpeggio', befehle: [{ befehl: 'noten_loeschen', clip_id: clipId, ids: a.loeschen }, { befehl: 'noten_neu', clip_id: clipId, noten: a.neu }] };
    });
  });
  r('vel').addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key !== 'Enter') return;
    const f = bestaetigt(), v = Number(r('vel').value);
    if (!f || st.rolle.auswahl.length === 0) return;
    if (!(Number.isInteger(v) && v >= 1 && v <= 127)) { ctx.melde('Velocity: 1 to 127', true); return; }
    const ids = new Set(st.rolle.auswahl);
    notenMit('Velocity of', f.clip.id, (c) => c.noten.filter((n) => ids.has(n.id) && n.vel !== v).map((n) => ({ id: n.id, vel: v })));
    r('vel').blur();
  });

  // --- Zeichnen (jedes Bild, solange sichtbar). Gemessen (probe_clips 6.7, Instanz i, kopfloser Chrome, 16.10.): 5000 Noten, alle gewählt,
  // p50 13,7 ms mit auswahl.includes je Note (quadratisch), mit der Auswahl als Set je Bild p50 2,4 ms, p99 3,3 ms; 3 Noten p50 0,1 ms ---
  function zeichne() {
    zeigeTonart();
    const f = gezeigt();
    if (!f || behaelter.hidden || !st.rolle.ansicht) return;
    passe();
    const a = st.rolle.ansicht, w = cv.width, h = cv.height, c = f.clip, unten = h - VEL_HOEHE, key = tonart();
    g.fillStyle = '#0b0d11'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < zeilen(h) + 1; i++) {
      const t = a.tonOben - i, y = i * TON_HOEHE;
      if (t < 0 || y >= unten) break;
      // with a key: its pitches are lit, the root carries the accent, the pitches outside step back; without a key the rows follow the keyboard
      g.fillStyle = !key ? (istSchwarz(t) ? '#101217' : '#161920') : istGrundton(t, key) ? '#3a2f14' : inSkala(t, key) ? '#1b2231' : '#0b0c10';
      g.fillRect(TASTEN_BREITE, y, w - TASTEN_BREITE, TON_HOEHE);
      g.fillStyle = istSchwarz(t) ? '#2a2d36' : '#c9c9cf'; g.fillRect(0, y, TASTEN_BREITE - 2, TON_HOEHE - 1);
      if (key && inSkala(t, key)) { g.fillStyle = istGrundton(t, key) ? '#ffb020' : '#5b8cff'; g.fillRect(TASTEN_BREITE - 6, y + 1, 4, TON_HOEHE - 3); }
      if (t % 12 === 0) { g.fillStyle = '#0e0f12'; g.font = '8px system-ui, sans-serif'; g.fillText(tonName(t), 2, y + TON_HOEHE - 1); }
    }
    for (const l of linien({ beat0: a.beat0, pxProBeat: a.pxProBeat }, w - TASTEN_BREITE, takt())) {
      g.strokeStyle = l.takt ? 'rgba(255,255,255,0.18)' : l.haupt ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.04)';
      const x = Math.round(TASTEN_BREITE + l.x) + 0.5;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, unten); g.stroke();
    }
    const xe = beatZuRx(a, c.loop_beats != null ? Math.min(c.loop_beats, c.laenge_beats) : c.laenge_beats);   // Spec 6.17: Noten ab loop_beats klingen nicht
    if (xe < w) { g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(Math.max(TASTEN_BREITE, xe), 0, w - xe, unten); }
    g.save(); g.beginPath(); g.rect(TASTEN_BREITE, 0, w - TASTEN_BREITE, h); g.clip();
    const gewaehlt = new Set(st.rolle.auswahl);                     // V2 Fix F4: einmal je Bild, nicht includes je Note
    for (const n of c.noten) {
      const k = notenKasten(a, n), gew = gewaehlt.has(n.id);
      g.fillStyle = gew ? '#ffffff' : f.spur.farbe; g.fillRect(k.x, k.y, k.w, k.h);
      g.strokeStyle = gew ? '#ffb020' : key && !inSkala(n.ton, key) ? '#ff5a5a' : '#0b0d11'; g.strokeRect(k.x + 0.5, k.y + 0.5, Math.max(0, k.w - 1), k.h - 1);   // red edge: outside the key
      const vx = Math.round(k.x) + 0.5, vy = velZuY(n.vel, h);
      g.strokeStyle = gew ? '#ffffff' : f.spur.farbe; g.beginPath(); g.moveTo(vx, h - 2); g.lineTo(vx, vy); g.stroke();
      g.fillStyle = g.strokeStyle; g.fillRect(vx - 2.5, vy - 2, 5, 4);
    }
    g.restore();
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(TASTEN_BREITE, unten, w - TASTEN_BREITE, 1);
    const q = st.rolle.rechteck;
    if (q) { g.strokeStyle = '#ffb020'; g.setLineDash([4, 3]); g.strokeRect(Math.min(q.x0, q.x1) + 0.5, Math.min(q.y0, q.y1) + 0.5, Math.abs(q.x1 - q.x0), Math.abs(q.y1 - q.y0)); g.setLineDash([]); }
  }
  ctx.beimBild.push(zeichne);

  return {
    // Detailbereich zeigt einen MIDI-Clip (oder null); ein anderer Clip bekommt eine frische Ansicht und keine Auswahl
    zeige(clipId) {
      if (clipId !== st.rolle.clipId) {
        st.rolle.clipId = clipId; st.rolle.auswahl = []; st.rolle.ansicht = null;
        const f = bestaetigt();
        if (f) { passe(); st.rolle.ansicht = neueRollAnsicht(f.clip, cv.width || 800, cv.height || 200); }
      }
      const f = bestaetigt();
      if (f) { st.rolle.auswahl = st.rolle.auswahl.filter((id) => f.clip.noten.some((n) => n.id === id)); zeigeVel(); }
    },
  };
}
