// TRACKER view, the tracker bar (plan 2026-11-18-tracker.md, task 2). In this task only the column switches (VOL DLY CHN RPT FX), HEX/DEC, FOLLOW and the
// AUDIO fold act here; PLAY, STOP, PATTERN/SONG, BPM, LPB, OCT, STEP and EDIT are enabled and wired by operation.js (task 6); SAVE MODULE and
// MODULES are present and disabled here, regal.js enables and wires them (task 23); TO DJ likewise (zu_dj.js); TICKS (a selector 1..24, task 17) is enabled by operation.js. Every item carries data-t: play, stopp, modus, bpm, lpb, ticks, okt, schritt, edit, follow, sp-vol, sp-dly, sp-chn,
// sp-rpt, sp-fx, zahlen, audio, module, speichern, zu-dj-platz (the SEQ place of TO DJ, wired by zu_dj.js), zu-dj, plus name (the project name). ctx.beimZeichnen refreshes the values and the pressed states.
import { trackerEinstellung, LPB_WERTE } from './grid_model.js';
import { PLAETZE } from '../module_after_seq.js';

export const KOPF_TEXT = {
  play: 'Play from the start of the section (Space); Enter plays from the cursor row',
  stopp: 'Stop the transport',
  modus: 'PATTERN plays the selected section in a loop, SONG plays the whole project',
  bpm: 'Tempo in BPM', lpb: 'Lines per beat: how many rows make one beat', ticks: 'Ticks per row for effect commands',
  okt: 'Octave of the lower keyboard row', schritt: 'Rows the cursor advances after a note', edit: 'Edit mode: typing writes into the grid',
  follow: 'FOLLOW: the grid scrolls with the play line and the section of the play head is selected',
  zahlen: 'Row numbers and values in hex or decimal',
  audio: 'Show or fold the audio tracks',
  speichern: 'Save the project as a tracker module', module: 'Open the shelf of the tracker modules', zuDj: 'Send the section to the DJ view: it becomes patterns of the SEQ deck of the chosen place',
  zuDjPlatz: 'SEQ place',
};

const SPALTEN = [['vol', 'VOL', 'Show the velocity sub-column'], ['dly', 'DLY', 'Show the delay sub-column'], ['chn', 'CHN', 'Show the chance sub-column'],
  ['rpt', 'RPT', 'Show the repeat sub-column'], ['fx', 'FX', 'Show the effect columns']];

export function bindeKopf(ctx) {
  const { st, $ } = ctx;
  const k = $('kopf');
  const el = (tag, klasse, t) => { const e = document.createElement(tag); if (klasse) e.className = klasse; if (t) e.setAttribute('data-t', t); return e; };
  const knopf = (t, text, titel, { aus = false } = {}) => {
    const b = el('button', 't-knopf', t); b.setAttribute('type', 'button'); b.textContent = text; b.setAttribute('title', titel); b.setAttribute('aria-pressed', 'false');
    if (aus) b.disabled = true;
    return b;
  };
  const feld = (t, beschriftung, titel, wert) => {
    const l = el('label', 't-feld'); const s = document.createElement('span'); s.textContent = beschriftung;
    const i = el('input', 't-eingabe', t); i.setAttribute('type', 'text'); i.setAttribute('title', titel); i.setAttribute('aria-label', beschriftung); i.value = wert; i.disabled = true;
    l.append(s, i);
    return l;
  };

  const wahlFeld = (t, beschriftung, titel, werte) => {
    const l = el('label', 't-feld'); const sp = document.createElement('span'); sp.textContent = beschriftung;
    const s = el('select', 't-eingabe', t); s.setAttribute('title', titel); s.setAttribute('aria-label', beschriftung); s.disabled = true;
    for (const n of werte) { const o = document.createElement('option'); o.setAttribute('value', String(n)); o.textContent = String(n); s.append(o); }
    l.append(sp, s);
    return l;
  };

  const name = el('span', 't-projektname', 'name');
  const transport = el('span', 't-gruppe');
  transport.append(knopf('play', 'PLAY', KOPF_TEXT.play, { aus: true }), knopf('stopp', 'STOP', KOPF_TEXT.stopp, { aus: true }), knopf('modus', 'PATTERN', KOPF_TEXT.modus, { aus: true }));
  const werte = el('span', 't-gruppe');
  werte.append(feld('bpm', 'BPM', KOPF_TEXT.bpm, ''), wahlFeld('lpb', 'LPB', KOPF_TEXT.lpb, LPB_WERTE), wahlFeld('ticks', 'TICKS', KOPF_TEXT.ticks, Array.from({ length: 24 }, (_, i) => i + 1)),
    feld('okt', 'OCT', KOPF_TEXT.okt, '3'), feld('schritt', 'STEP', KOPF_TEXT.schritt, '1'));
  const edit = knopf('edit', 'EDIT', KOPF_TEXT.edit, { aus: true });
  const follow = knopf('follow', 'FOLLOW', KOPF_TEXT.follow);
  const spalten = el('span', 't-gruppe');
  for (const [u, text, titel] of SPALTEN) { const b = knopf(`sp-${u}`, text, titel); b.addEventListener('click', () => { st.spaltenAn[u] = !st.spaltenAn[u]; ctx.zeichne(); }); spalten.append(b); }
  const zahlen = knopf('zahlen', 'HEX', KOPF_TEXT.zahlen);
  zahlen.removeAttribute('aria-pressed');
  zahlen.addEventListener('click', () => { st.zahlen = st.zahlen === 'hex' ? 'dec' : 'hex'; ctx.zeichne(); });
  const audio = knopf('audio', 'AUDIO', KOPF_TEXT.audio);
  audio.addEventListener('click', () => { st.audioAn = !st.audioAn; ctx.merke('djk-tr-audio', st.audioAn ? '1' : 'zu'); ctx.zeichne(); });
  follow.addEventListener('click', () => { st.follow = !st.follow; ctx.zeichne(); });
  const ziel = el('span', 't-gruppe t-rechts');
  const djPlatz = el('select', 't-eingabe', 'zu-dj-platz');
  djPlatz.setAttribute('title', KOPF_TEXT.zuDjPlatz); djPlatz.setAttribute('aria-label', KOPF_TEXT.zuDjPlatz); djPlatz.disabled = true;
  for (const n of PLAETZE) { const o = document.createElement('option'); o.setAttribute('value', String(n)); o.textContent = `SEQ ${n}`; djPlatz.append(o); }
  ziel.append(knopf('module', 'MODULES', KOPF_TEXT.module, { aus: true }), knopf('speichern', 'SAVE MODULE', KOPF_TEXT.speichern, { aus: true }), djPlatz, knopf('zu-dj', 'TO DJ', KOPF_TEXT.zuDj, { aus: true }));
  k.append(name, transport, werte, edit, follow, spalten, zahlen, audio, ziel);

  const setze = (t, an) => { const b = $(t); if (b) { b.setAttribute('aria-pressed', String(an)); b.classList.toggle('an', an); } };
  ctx.beimZeichnen.push(() => {
    const p = st.projekt;
    name.textContent = p?.name ?? '';
    if (p) {
      const e = trackerEinstellung(p);
      $('bpm').value = String(p.tempo_bpm ?? ''); $('lpb').value = String(e.lpb); $('ticks').value = String(e.ticks);
    }
    for (const [u] of SPALTEN) setze(`sp-${u}`, st.spaltenAn[u] === true);
    setze('follow', st.follow); setze('audio', st.audioAn);
    $('zahlen').textContent = st.zahlen === 'dec' ? 'DEC' : 'HEX';
  });
}
