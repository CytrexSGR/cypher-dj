// PRODUCTION (note editor, slice 1, B7): the block of the audio clip detail around the note editor. The surface itself (public/noten/operation.js) draws the notes and
// the pitch drag on the canvas and reads and writes only through the adapter (notes_adapter.js); this block adds what the surface does not draw:
//   - the render state of the clip (plays the original / rendering / plays the previous edit / plays the edit / the reason of a failed render),
//   - the analysis state (progress while DETECT NOTES runs, then the note of the end: nothing found, little pitched sound, polyphonic source, cancelled, stale),
//   - DETECT NOTES with its progress bar and CANCEL (one detection at a time on the whole server; not while a stem separation runs).
// One surface and one adapter belong to one clip: a change of clip releases the surface (los) and binds a new one. The page hooks are registered once here
// (SSE events and the frame hook); the project changes come from detail.js, which calls zeige(clip) at every change.
import { findeClip } from './draft.js';
import { neuerNotenAdapter, nimmLauf } from './notes_adapter.js';
import { bindeNotenEditor } from '../noten/operation.js';
import { neueWellen } from './waves.js';
import { oeffneMenue, schliesseMenue } from './context_menu.js';

export const NOTEN_TEXT = {
  knopf: 'Detect the notes of this clip: one pitch at a time (for a voice or a melody; a full mix needs a stem first)',
  stems: 'A stem separation is running',
  laeuft: 'A note detection is running',
  dekodiert: 'The audio of this clip is still being prepared',
  staerke: 'Strength of quantise and snap in percent (100: fully onto the grid or the tone)',
  vib: 'Vibrato of the selected notes in percent (100: as sung, 0: flat)',
  drift: 'Drift of the selected notes in percent (100: as sung, 0: flat)',
  frage: 'Detect again? Your note edits on this clip are lost.',
};
const STAERKE_SCHLUESSEL = 'djk.noten.staerke';
const leseStaerke = () => { try { const t = globalThis.localStorage?.getItem(STAERKE_SCHLUESSEL), v = t === null || t === undefined || t === '' ? NaN : Number(t); return Number.isFinite(v) && v >= 0 && v <= 100 ? v : 100; } catch { return 100; } };
const merkeStaerke = (v) => { try { globalThis.localStorage?.setItem(STAERKE_SCHLUESSEL, String(v)); } catch { /* storage unavailable: the value stays for this page only */ } };
// every target field of the contract (ZIEL_FELDER in project/notes_contract.ts): a note with any of them holds an edit
export const ZIEL_FELDER = ['a', 'e', 'ton', 'vib', 'drift', 'formant', 'gain_db'];
const hatZiele = (n) => ZIEL_FELDER.some((f) => n[f] !== undefined);

export function bindeNoten(ctx, behaelter, knopfBehaelter, { wellen = neueWellen(), menue = oeffneMenue, schliesse = schliesseMenue, bindeEditor = bindeNotenEditor, frage = (t) => globalThis.confirm?.(t) ?? false } = {}) {
  const { st } = ctx;
  const q = (el, n) => el.querySelector(`[data-d="${n}"]`);
  const canvas = q(behaelter, 'notencanvas'), stand = q(behaelter, 'notenstand'), analyseEl = q(behaelter, 'notenanalyse');
  const knopf = q(knopfBehaelter, 'notenknopf'), balken = q(knopfBehaelter, 'notenbalken'), abbruch = q(knopfBehaelter, 'notenabbruch');
  const staerkeFeld = q(knopfBehaelter, 'notenstaerke');
  const formFelder = { vib: q(knopfBehaelter, 'notenvib'), drift: q(knopfBehaelter, 'notendrift') };
  const auswahl = { ids: [], anker: null };           // the selection of the surface (beiAuswahl)
  const kurven = new Map(), lage = { laufend: null };      // shared by the adapters of this block: the curve cache and the detection that runs
  let staerkeProzent = leseStaerke();
  if (staerkeFeld) { staerkeFeld.value = String(staerkeProzent); staerkeFeld.title = NOTEN_TEXT.staerke; }
  let clipId = null, slug = null, adapter = null, editor = null, stemsAn = false;

  const laufend = () => (lage.laufend && lage.laufend.slug === st.slug && lage.laufend.zustand === 'laeuft' ? lage.laufend : null);
  const clipJetzt = () => (clipId ? findeClip(st.projekt, clipId)?.clip ?? null : null);

  // the two factor sliders: shown with a selection, the value is the anchor note's factor; the release of a slider is one op
  function formZeige() {
    const clip = clipJetzt(), da = new Set((clip?.audio_noten?.liste ?? []).map((x) => x.id));
    const ids = auswahl.ids.filter((id) => da.has(id));
    const anker = clip?.audio_noten?.liste.find((x) => x.id === (ids.includes(auswahl.anker) ? auswahl.anker : ids[ids.length - 1]));
    for (const [feld, el] of Object.entries(formFelder)) {
      if (!el) continue;
      (el.closest?.('.p-noten-form') ?? el).hidden = ids.length === 0;
      el.title = NOTEN_TEXT[feld];
      if (anker) el.value = String(Math.round((anker[feld] ?? 1) * 100));
    }
  }

  function rendere() {
    formZeige();
    const sicht = adapter && clipId ? adapter.lies() : null;
    if (!sicht) {
      stand.textContent = ''; analyseEl.textContent = '';
      balken.hidden = true; abbruch.hidden = true; knopf.disabled = true;
      return;
    }
    stand.textContent = sicht.render.text;
    stand.classList.toggle('fehler', sicht.render.zustand === 'fehler');
    const lauf = laufend(), eigene = sicht.analyse;
    const dieseLaeuft = lauf?.clip_id === clipId || (eigene?.zustand === 'laeuft' && !lauf);
    if (lauf) {
      balken.hidden = false; abbruch.hidden = false;
      balken.value = lauf.prozent ?? 0; balken.title = lauf.stufe ? `stage: ${lauf.stufe}` : '';
    } else { balken.hidden = true; abbruch.hidden = true; balken.value = 0; balken.title = ''; }
    if (dieseLaeuft) analyseEl.textContent = `Detecting notes… ${Math.round((lauf ?? eigene).prozent ?? 0)} %`;
    else analyseEl.textContent = eigene && eigene.zustand !== 'laeuft' ? eigene.text : '';
    analyseEl.classList.toggle('fehler', !dieseLaeuft && eigene?.zustand === 'fehler');
    const clip = clipJetzt();
    const grund = stemsAn ? NOTEN_TEXT.stems : lauf || eigene?.zustand === 'laeuft' ? NOTEN_TEXT.laeuft : clip && clip.dekodiert !== 'fertig' ? NOTEN_TEXT.dekodiert : null;
    knopf.disabled = grund !== null;
    knopf.title = grund ?? NOTEN_TEXT.knopf;
  }

  function loese() {
    const gebunden = adapter !== null;
    editor?.los(); adapter?.ende();
    auswahl.ids = []; auswahl.anker = null;
    editor = null; adapter = null; clipId = null; slug = null;
    if (gebunden) schliesse();                     // only the menu of this block's surface: a foreign open menu stays
  }

  // detail.js calls this at every change of the project and of the selection: the clip to show, or null (no clip, a MIDI clip, another mode of the detail)
  function zeige(clip) {
    const audio = clip?.art === 'audio';
    behaelter.hidden = !audio; knopfBehaelter.hidden = !audio;
    if (!audio) { loese(); rendere(); return; }
    stemsAn = st.stems?.zustand === 'laeuft';
    // clip ids repeat across projects and the selection survives a project change: the binding belongs to project and clip
    if (clip.id === clipId && st.slug === slug && adapter) { adapter.projektNeu(); return; }
    loese();
    clipId = clip.id; slug = st.slug;
    adapter = neuerNotenAdapter(ctx, clip.id, { wellen, kurven, lage });
    adapter.setzeStaerke?.(staerkeProzent / 100);
    adapter.abonniere(rendere);
    auswahl.ids = []; auswahl.anker = null;
    editor = bindeEditor(canvas, adapter, { menue, beiAuswahl: (ids, anker) => { auswahl.ids = ids; auswahl.anker = anker; formZeige(); } });
    adapter.ladeZustand().catch(() => {});
    rendere();
    editor.zeige();
  }

  knopf.addEventListener('click', async () => {
    const clip = clipJetzt();
    if (knopf.disabled || !clip || !adapter) return;
    const liste = clip.audio_noten?.liste ?? [];
    if (liste.some(hatZiele) && !frage(NOTEN_TEXT.frage)) return;
    await adapter.schreibe({ art: 'erkennen', ...(liste.length > 0 ? { neu: true } : {}) });
  });
  staerkeFeld?.addEventListener('input', () => {
    const v = Number(staerkeFeld.value);
    if (staerkeFeld.value === '' || !Number.isFinite(v)) return;
    staerkeProzent = Math.min(100, Math.max(0, v));
    merkeStaerke(staerkeProzent);
    adapter?.setzeStaerke?.(staerkeProzent / 100);
  });
  for (const [feld, el] of Object.entries(formFelder)) {
    if (!el) continue;
    el.addEventListener('change', async () => {
      const v = Number(el.value);
      if (el.value === '' || !Number.isFinite(v) || !adapter) return;
      const ids = [...auswahl.ids];
      if (ids.length === 0) return;
      await adapter.schreibe({ art: 'form', ids, [feld]: Math.min(4, Math.max(0, v / 100)) });
    });
  }
  abbruch.addEventListener('click', async () => { if (adapter) await adapter.schreibe({ art: 'abbrechen' }); });

  // SSE: the stand `noten` (any clip: the run is one for the whole server) and `noten_render`. A failed detection is also said in the message line, the block
  // may belong to another clip by then.
  ctx.beimEreignis.push((a, f) => {
    if (a !== 'proj' || !f || (!f.noten && !f.noten_render)) return;
    if (f.noten && f.noten.slug === st.slug) {
      nimmLauf(lage, f.noten, st.slug);
      if (f.noten.zustand === 'fehler') ctx.melde(f.noten.grund && !(f.noten.grund === 'noten_fehler' && f.noten.text) ? ctx.fehlerText({ j: { fehler: f.noten.grund } }) : (f.noten.text ?? 'The note detection failed'), true);
    }
    adapter?.ereignis(a, f);
    rendere();
  });
  // The page gives no hook for the ticks of a stem separation: the frame hook sees st.stems. It also redraws the surface when the box of the canvas changed.
  ctx.beimBild.push(() => {
    if (!clipId) return;
    const s = st.stems?.zustand === 'laeuft';
    if (s !== stemsAn) { stemsAn = s; rendere(); }
    if (typeof canvas.getBoundingClientRect === 'function') {
      const w = Math.round(canvas.getBoundingClientRect().width);
      if (w > 0 && w !== canvas.width) editor?.zeige();
    }
  });

  return { zeige };
}
