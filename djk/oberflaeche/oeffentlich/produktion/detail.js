// PRODUCTION (D1 V2): Detailbereich unten (Spec A1 „Detailbereich unten“, A2, A3). Er zeigt den zuletzt gewählten Clip:
// einen Audio-Clip mit Name, Start, Länge, Gain, Fades und Offset (jedes Feld ein clip_aendern, Enter oder Verlassen schickt),
// einen MIDI-Clip mit der Piano-Roll (pianoroll_bedienung.js). SPLIT, DUPLICATE und DELETE wirken wie Strg+E, Strg+D und Entf
// im Arrangement (clip_bedienung.js ctx.clipAktion), LOOP wie Strg+L (Spec 6.17: loop_beats = Länge bzw. null). Eine eingefrorene Spur sagt,
// dass Notenänderungen den Freeze verwerfen.
import { findeClip } from './entwurf.js';
import { feldBefehl, zahlText, FELDER } from './clips.js';
import { positionText } from './zeitachse.js';
import { bindeRolle } from './pianoroll_bedienung.js';
import { warpAnzeige } from './warp.js';

// Gain-Regler: Bereich aus FELDER.gain_db (Spec 6.27, −96..+24 dB), sonst schnitte er Werte ab (V2 Fix F8: vorher −36..+12, +20 dB zeigte 12)
const GERUEST = `<div class="p-detail-kopf"><span data-d="titel">CLIP</span><span class="p-detail-info" data-d="info"></span>
  <span class="p-detail-knoepfe"><button data-d="loop" aria-pressed="false" title="Loop the clip: repeat it up to its length, then drag the right edge (Ctrl+L)" disabled>LOOP</button><button data-d="teilen" title="Split the selected clips at the start marker (Ctrl+E)" disabled>SPLIT</button><button data-d="duplizieren" title="Duplicate the selected clips behind themselves (Ctrl+D)" disabled>DUPLICATE</button><button data-d="loeschen" title="Delete the selected clips (Del)" disabled>DELETE</button></span></div>
<div class="p-detail-leer" data-d="leer">No clip selected. Click a clip; double click on an instrument track makes a MIDI clip.</div>
<div class="p-clip-audio" data-d="audio" hidden>
  <label>NAME <input data-f="name" maxlength="80" autocomplete="off"></label>
  <label>START <input data-f="start_beat" inputmode="decimal" autocomplete="off"> <output data-d="startpos"></output></label>
  <label>LENGTH <input data-f="laenge_beats" inputmode="decimal" autocomplete="off"> beats</label>
  <label>GAIN <input data-d="gainregler" type="range" min="${FELDER.gain_db.min}" max="${FELDER.gain_db.max}" step="0.1" title="Clip gain (double click: 0 dB)"> <input data-f="gain_db" inputmode="decimal" autocomplete="off"> dB</label>
  <label>FADE IN <input data-f="fade_ein_beats" inputmode="decimal" autocomplete="off"> beats</label>
  <label>FADE OUT <input data-f="fade_aus_beats" inputmode="decimal" autocomplete="off"> beats</label>
  <label data-d="offsetl">OFFSET <input data-f="offset_s" inputmode="decimal" autocomplete="off"> s</label>
  <label data-d="versatzl" hidden>OFFSET <input data-f="versatz_beats" inputmode="decimal" autocomplete="off" title="Which beat of the warp plays at the clip start"> beats</label>
  <div class="p-warp" data-d="warp">
    <button data-d="warpknopf" aria-pressed="false" title="Warp: play the clip in the project tempo. RE-PITCH: the pitch follows the tempo, like a record">WARP</button>
    <span class="p-warp-modus" data-d="warpmodus"></span><span class="p-warp-info" data-d="warpinfo"></span>
  </div>
</div>
<div class="p-clip-midi" data-d="midi" hidden></div>`;
const LABEL = { name: 'Rename clip', start_beat: 'Move clip', laenge_beats: 'Clip length', gain_db: 'Clip gain', fade_ein_beats: 'Fade in', fade_aus_beats: 'Fade out', offset_s: 'Clip offset', versatz_beats: 'Clip offset' };

export function bindeDetail(ctx) {
  const { st, $ } = ctx;
  const sek = $('detail');
  sek.innerHTML = GERUEST;
  const d = (n) => sek.querySelector(`[data-d="${n}"]`);
  const felder = [...sek.querySelectorAll('[data-f]')];
  const rolle = bindeRolle(ctx, d('midi'));
  const gezeigt = () => (st.auswahl.length ? findeClip(st.projekt, st.auswahl.at(-1)) : null);

  for (const [knopf, aktion] of [['loop', 'loop'], ['teilen', 'teilen'], ['duplizieren', 'duplizieren'], ['loeschen', 'loeschen']]) d(knopf).addEventListener('click', () => ctx.clipAktion(aktion));
  for (const f of felder) {
    f.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') f.blur(); if (e.key === 'Escape') { zeige(true); f.blur(); } });
    f.addEventListener('change', () => {
      const t = gezeigt();
      if (!t) return;
      const feld = f.dataset.f;
      if (feld === 'name') {
        const v = f.value.trim();
        if (v && v !== t.clip.name) ctx.aendere(LABEL.name, [{ befehl: 'clip_aendern', clip_id: t.clip.id, name: v }]); else zeige(true);
        return;
      }
      const r = feldBefehl(t.clip, feld, f.value);
      if (r.fehler) { ctx.melde(r.fehler, true); zeige(true); return; }
      if (r.befehl) ctx.aendere(LABEL[feld], [r.befehl]);
    });
  }
  // Paket 1.13: WARP schaltet den Warp des gewählten Audio-Clips; ohne Warp-Daten holt warp_auto sie aus der Library (der Server meldet kein_tempo, wenn dort nichts steht)
  d('warpknopf').addEventListener('click', () => {
    const t = gezeigt();
    if (!t || t.clip.art !== 'audio') return;
    const w = t.clip.warp;
    if (!w) ctx.aendere('Warp clip', [{ befehl: 'warp_auto', clip_id: t.clip.id }]);
    else ctx.aendere(w.an ? 'Warp off' : 'Warp on', [{ befehl: 'warp_setzen', clip_id: t.clip.id, an: !w.an }]);
  });
  const regler = d('gainregler');
  // V2 Fix-Runde 2 H6: ein neuer Serverstand überschreibt den Regler nur nicht, solange er bedient wird (Zeiger gedrückt oder Eingabe läuft);
  // bloßer Fokus schützt nicht mehr (vorher zeigte ein Regler mit Fokus weiter den alten Wert, −6-dB-Clip mit 12). Danach zeigt er den Serverwert.
  let bedient = false, wertBeimDruck = null;
  const zeigeGain = () => { const t = gezeigt(); if (t?.clip.art === 'audio') regler.value = String(t.clip.gain_db); };
  regler.addEventListener('pointerdown', () => { bedient = true; wertBeimDruck = regler.value; });
  regler.addEventListener('input', () => { bedient = true; sek.querySelector('[data-f="gain_db"]').value = regler.value; });
  // Loslassen (auch außerhalb des Reglers): ohne Bewegung kommt kein change, also gleich den Serverwert; mit Bewegung schickt change den Wert
  const los = () => { if (!bedient) return; bedient = false; if (regler.value === wertBeimDruck) zeigeGain(); };
  window.addEventListener('pointerup', los, true);
  window.addEventListener('pointercancel', los, true);
  const sendeGain = () => {
    bedient = false;
    const t = gezeigt();
    if (!t) return;
    const r = feldBefehl(t.clip, 'gain_db', regler.value);
    if (r.befehl) ctx.aendere(LABEL.gain_db, [r.befehl]); else zeigeGain();
  };
  regler.addEventListener('change', sendeGain);
  regler.addEventListener('dblclick', () => { regler.value = '0'; sendeGain(); });

  // erzwungen: auch ein Feld mit Fokus wird überschrieben (Esc, abgelehnte Eingabe)
  function zeige(erzwungen = false) {
    const t = gezeigt();
    for (const k of ['loop', 'teilen', 'duplizieren', 'loeschen']) d(k).disabled = !t;
    const loop = t?.clip.loop_beats != null;
    d('loop').classList.toggle('an', loop); d('loop').setAttribute('aria-pressed', String(loop));
    d('leer').hidden = !!t;
    d('audio').hidden = t?.clip.art !== 'audio';
    d('midi').hidden = t?.clip.art !== 'midi';
    if (!t) { d('titel').textContent = 'CLIP'; d('info').textContent = ''; rolle.zeige(null); return; }
    const c = t.clip, frozen = t.spur.freeze ? ' · FROZEN: changing notes unfreezes the track' : '';
    d('titel').textContent = c.art === 'audio' ? 'AUDIO CLIP' : 'MIDI CLIP';
    d('info').textContent = `${c.name} · ${t.spur.name} · bar ${positionText(c.start_beat)} · ${zahlText(c.laenge_beats)} beats${c.loop_beats != null ? ` · loop ${zahlText(c.loop_beats)} beats` : ''}${st.auswahl.length > 1 ? ` · ${st.auswahl.length} selected` : ''}${frozen}`;
    if (c.art === 'midi') { rolle.zeige(c.id); return; }
    rolle.zeige(null);
    for (const f of felder) {
      if (!erzwungen && document.activeElement === f) continue;
      f.value = f.dataset.f === 'name' ? c.name : zahlText(f.dataset.f === 'versatz_beats' ? (c.warp?.versatz_beats ?? 0) : c[f.dataset.f]);
    }
    const wa = warpAnzeige(c);
    d('warpknopf').classList.toggle('an', wa.an); d('warpknopf').setAttribute('aria-pressed', String(wa.an));
    d('warpmodus').textContent = wa.vorhanden ? wa.modus : '';
    d('warpinfo').textContent = !wa.vorhanden ? 'no tempo set: WARP asks the library' : [wa.herkunft, wa.bpm ? `${wa.bpm} BPM` : '', wa.downbeatFrage ? 'downbeat?' : ''].filter(Boolean).join(' · ');
    d('offsetl').hidden = wa.an; d('versatzl').hidden = !wa.an;                 // gewarpt zählt der Versatz in Beats, nicht offset_s
    if (!bedient) regler.value = String(c.gain_db);                 // H6: nur während der Bedienung nicht
    d('startpos').textContent = `bar ${positionText(c.start_beat)}`;
  }
  ctx.beimAuswahl.push(() => zeige());
  ctx.beimProjekt.push(() => zeige());
  zeige();
}
