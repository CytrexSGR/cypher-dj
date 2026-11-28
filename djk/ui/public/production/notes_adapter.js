// PRODUCTION (note editor, slice 1, B7): the adapter of the clip detail between the host-neutral surface (public/noten/, contract contract.js) and the page.
// lies() builds Sicht from what the page already holds (st.projekt: the clip's audio_noten, warp, key, tempo) and two reads (GET /proj/noten for the state at
// the start, GET /proj/noten/kurve for the pitch curve, cached per source and curve id). schreibe() turns the ops of the surface into project commands that are
// computed when the writer's turn comes (ctx.aendereAus: a note or clip that is gone by then sends nothing) or into calls of the detection routes.
// One adapter belongs to one clip. The block (notes_block.js) owns the page hooks and hands the project changes and SSE events to the current adapter
// (projektNeu, ereignis); ende() ends it when the clip changes.
import { findeClip } from './draft.js';
import { beatBeiQuelle, quellSekunde, warpAn } from './warp.js';
import { beatsProTakt } from './timeline.js';
import { rasteEin, tonartOk } from '../harmonie.js';
import { spalten, SR } from '../wave.js';

export const RENDER_TEXT = {
  quelle: 'plays the original', rechnet: 'rendering…', alt: 'plays the previous edit while rendering', bereit: 'plays the edit',
};
export const KEINE_NOTEN_TEXT = 'No notes found in this clip.';
// The page map says "stems" for these two reasons; here they belong to a note detection
const ABBRUCH_TEXT = { zu_spaet: 'The notes are already placed: use undo to remove them', kein_auftrag: 'No note detection with this id is running' };
const MAX_KURVEN = 8;
const zahl = (x) => typeof x === 'number' && Number.isFinite(x);

/** The detection that runs, for the whole server (one at a time): `lage.laufend` follows the SSE stand `noten` of the open project, whatever clip it names. */
export function nimmLauf(lage, noten, slug) {
  if (!noten || noten.slug !== slug) return;
  if (noten.zustand === 'laeuft') lage.laufend = noten;
  else if (lage.laufend && lage.laufend.auftrag_id === noten.auftrag_id) lage.laufend = null;
}

/** Marker list of a clip whose warp is on and usable, else null. */
const warpMarker = (clip) => (warpAn(clip) && Array.isArray(clip.warp.marker) && clip.warp.marker.length >= 2 ? clip.warp.marker : null);

export function neuerNotenAdapter(ctx, clipId, { wellen, kurven = new Map(), lage = { laufend: null } } = {}) {
  const { st } = ctx;
  const hoerer = new Set(), ich = Symbol('adapter'), wartet = new Set();
  const weg = `clip_id=${encodeURIComponent(clipId)}`;
  let beendet = false, staerke = 1, render = { zustand: 'quelle' }, analyse = null, renderEreignis = false, analyseEreignis = false;

  const melde = () => { if (beendet) return; for (const f of [...hoerer]) { try { f(); } catch (e) { console.error('note editor adapter: subscriber threw', e); } } };
  const clipJetzt = (p = st.projekt) => { const f = p ? findeClip(p, clipId) : null; return f?.clip.art === 'audio' ? f.clip : null; };

  // ---- the curve: one read per source and curve id, shared by the adapters of the block (a failure is tried again by the next adapter only)
  function kurveFuer(clip) {
    const feld = clip.audio_noten;
    if (!feld) return null;
    const key = `${clip.quelle.sha256}|${feld.kurve}`;
    const e = kurven.get(key);
    if (e?.zustand === 'da') return e;
    if (e?.zustand === 'laedt') {                                  // another adapter asked already (same source, the clip was changed): wait for its answer
      if (!wartet.has(key)) { wartet.add(key); e.versprechen.then(melde, melde); }
      return null;
    }
    if (e && e.von === ich) return null;
    const eintrag = { zustand: 'laedt', von: ich, versprechen: null };
    eintrag.versprechen = Promise.resolve().then(() => ctx.holeGet(`/proj/noten/kurve?${weg}`)).then((r) => {
      const ok = r?.status === 200 && r.j?.kurve === feld.kurve && Array.isArray(r.j.ct) && r.j.hop_s > 0;
      kurven.delete(key);
      kurven.set(key, ok ? { zustand: 'da', hopS: r.j.hop_s, ct: r.j.ct } : { zustand: 'fehler', von: ich });
      for (const [k, v] of kurven) { if (kurven.size <= MAX_KURVEN) break; if (v.zustand === 'da') kurven.delete(k); }
    }).catch(() => { kurven.set(key, { zustand: 'fehler', von: ich }); }).finally(melde);
    kurven.set(key, eintrag);
    return null;
  }

  // ---- Sicht
  function lies() {
    const clip = clipJetzt(), p = st.projekt;
    const w = clip ? wellen.hole(clip.quelle.sha256, melde) : { welle: null, fehler: null };
    const k = clip ? kurveFuer(clip) : null;
    const kurve = k ? { hopS: k.hopS, ct: k.ct } : null;
    const quelleS = w.welle ? (w.welle.spalten * w.welle.hop) / SR : w.fehler && kurve ? kurve.ct.length * kurve.hopS : 0;
    const marker = clip ? warpMarker(clip) : null, versatz = marker ? (clip.warp.versatz_beats ?? 0) : 0;
    const bpm = p?.tempo_bpm, tempoOk = zahl(bpm) && bpm > 0;
    let hoerbarS = [0, 0], raster = null;
    if (clip && marker) {
      hoerbarS = [quellSekunde(marker, versatz), quellSekunde(marker, versatz + clip.laenge_beats)];
      raster = { beatBeiS: (s) => clip.start_beat + beatBeiQuelle(marker, s) - versatz, sBeiBeat: (b) => quellSekunde(marker, b - clip.start_beat + versatz) };
    } else if (clip) {
      const o = clip.offset_s ?? 0;
      if (tempoOk) {
        hoerbarS = [o, o + (clip.laenge_beats * 60) / bpm];
        raster = { beatBeiS: (s) => clip.start_beat + ((s - o) * bpm) / 60, sBeiBeat: (b) => o + ((b - clip.start_beat) * 60) / bpm };
      } else hoerbarS = [o, o];
    }
    if (raster) raster.beatsProTakt = beatsProTakt(p?.taktart);
    const tonart = p?.tonart;
    return {
      staerke, quelleS, hoerbarS, noten: clip?.audio_noten?.liste ?? [], kurve, raster,
      welle: w.welle ? { hole: (s0, s1, n) => welleSpalten(w.welle, s0, s1, n) } : null,
      rasteTonart: tonartOk(tonart) ? (t) => rasteEin(t, tonart) : null,
      render: { zustand: render.zustand, text: renderText(render) },
      analyse: analyse ? { ...analyse, text: analyseText(analyse) } : null,
    };
  }
  // n (min, max) pairs in -1..1: the page waveform keeps one peak per column, drawn mirrored
  function welleSpalten(w, s0, s1, n) {
    const aus = [], hop = w.hop;
    for (let i = 0; i < n; i++) {
      const a = ((s0 + ((s1 - s0) * i) / n) * SR) / hop, b = ((s0 + ((s1 - s0) * (i + 1)) / n) * SR) / hop;
      const spitze = spalten(w, a, b)[0] / 255;
      aus.push([-spitze, spitze]);
    }
    return aus;
  }
  const grundText = (grund) => ctx.fehlerText({ j: { fehler: grund } });
  function renderText(r) {
    if (r.zustand === 'fehler') return r.grund ? grundText(r.grund) : (r.text ?? 'The note edit could not be rendered');
    return RENDER_TEXT[r.zustand] ?? '';
  }
  function analyseText(a) {
    if (a.zustand === 'fertig') return a.hinweis === 'keine_noten' ? KEINE_NOTEN_TEXT : a.hinweis ? (a.text ?? '') : '';
    if (a.zustand === 'fehler') {
      // noten_fehler has two ends on the server (nothing changed / saved but not loaded): only the stand's text tells them apart
      if (a.grund === 'noten_fehler' && a.text) return a.text.charAt(0).toUpperCase() + a.text.slice(1);
      return a.grund ? grundText(a.grund) : (a.text ?? '');
    }
    if (a.zustand === 'abgebrochen' || a.zustand === 'veraltet') return a.text ?? (a.grund ? grundText(a.grund) : '');
    return '';
  }

  // ---- writes
  // rechne(clip) → commands | null; the stand is the one of the writer's turn. A local refusal is said with the text of its reason; when the writer itself
  // refused, the page has said it already (writer.js beiFehler).
  async function aendere(label, rechne) {
    if (beendet) return { ok: false, grund: 'beendet', text: '' };
    let grund = null;
    const ok = await ctx.aendereAus((p) => {
      const clip = clipJetzt(p);
      if (!clip) { grund = 'clip_unbekannt'; return null; }
      if (!clip.audio_noten) { grund = 'keine_audio_noten'; return null; }
      const r = rechne(clip);
      if (typeof r === 'string') { grund = r; return null; }
      return { label: typeof label === 'function' ? label(clip) : label, befehle: r };
    });
    if (ok) return { ok: true };
    if (grund === null) return { ok: false, grund: 'abgelehnt', text: '' };
    const text = grundText(grund);
    if (grund !== 'clip_unbekannt') ctx.melde(text, true);
    return { ok: false, grund, text };
  }
  const alleDa = (clip, ids) => { const da = new Set(clip.audio_noten.liste.map((n) => n.id)); return ids.every((id) => da.has(id)); };
  async function ruf(wegPfad, koerper) {
    if (beendet) return { ok: false, grund: 'beendet', text: '' };
    const r = await ctx.holeJson(wegPfad, koerper);
    if (r.status === 200) return { ok: true };
    const code = r.j?.fehler ?? r.j?.grund ?? 'fehler';
    const text = wegPfad.endsWith('/abbrechen') && ABBRUCH_TEXT[code] ? ABBRUCH_TEXT[code] : ctx.fehlerText(r);
    // the run this page still shows is gone on the server (a lost SSE event): drop it, the button comes back
    if (wegPfad.endsWith('/abbrechen') && code === 'kein_auftrag') { lage.laufend = null; if (analyse?.zustand === 'laeuft') analyse = null; melde(); }
    ctx.melde(text, true);
    return { ok: false, grund: code, text };
  }
  function schreibe(op) {
    switch (op?.art) {
      case 'ton':
        return aendere('Note pitch', (clip) => (alleDa(clip, op.ids) ? [{ befehl: 'audio_noten_aendern', clip_id: clipId, ids: op.ids, ton_um: op.um }] : 'noten_unbekannt'));
      case 'zeit':
        return aendere('Note time', (clip) => (alleDa(clip, op.ids) ? [{ befehl: 'audio_noten_aendern', clip_id: clipId, ids: op.ids, zeit_um: op.um_s }] : 'noten_unbekannt'));
      case 'kante':
        return aendere('Note edge', (clip) => (alleDa(clip, [op.id])
          ? [{ befehl: 'audio_noten_aendern', clip_id: clipId, ids: [op.id], ...(op.a !== undefined ? { a: op.a } : { e: op.e }) }] : 'noten_unbekannt'));
      case 'raster': {
        const stufe = op.staerke === undefined ? 1 : op.staerke;
        const felder = { ...(op.zeit !== undefined ? { zeit: op.zeit } : {}), ...(op.ton !== undefined ? { ton: op.ton } : {}), staerke: stufe };
        return aendere(op.ton === undefined ? 'Quantise notes' : op.zeit === undefined ? 'Snap notes' : 'Quantise and snap notes',
          (clip) => (op.ids && !alleDa(clip, op.ids) ? 'noten_unbekannt'
            : [{ befehl: 'audio_noten_raster', clip_id: clipId, ...(op.ids ? { ids: op.ids } : {}), ...felder }]));
      }
      case 'form': {
        const f = { ...(zahl(op.vib) ? { vib: op.vib } : {}), ...(zahl(op.drift) ? { drift: op.drift } : {}) };
        if (!op.ids?.length || Object.keys(f).length === 0) return Promise.resolve({ ok: false, grund: 'argument_ungueltig', text: '' });
        return aendere(op.drift === undefined ? 'Note vibrato' : op.vib === undefined ? 'Note drift' : 'Note vibrato and drift',
          (clip) => (alleDa(clip, op.ids) ? [{ befehl: 'audio_noten_aendern', clip_id: clipId, ids: op.ids, ...f }] : 'noten_unbekannt'));
      }
      case 'zuruecksetzen':
        return aendere(op.ids?.length === 1 ? 'Reset note' : 'Reset notes',
          (clip) => (op.ids && !alleDa(clip, op.ids) ? 'noten_unbekannt' : [{ befehl: 'audio_noten_zuruecksetzen', clip_id: clipId, ...(op.ids ? { ids: op.ids } : {}) }]));
      case 'entfernen':
        return aendere('Remove notes', () => [{ befehl: 'audio_noten_entfernen', clip_id: clipId }]);
      case 'erkennen':
        return ruf('/proj/noten/erkennen', op.neu ? { clip_id: clipId, neu: true } : { clip_id: clipId });
      case 'abbrechen': {
        const l = lage.laufend;
        if (!l || l.slug !== st.slug || l.zustand !== 'laeuft') return Promise.resolve({ ok: false, grund: 'kein_auftrag', text: 'No note detection is running' });
        return ruf('/proj/noten/abbrechen', { auftrag_id: l.auftrag_id });
      }
      default:
        return Promise.resolve({ ok: false, grund: 'argument_ungueltig', text: '' });
    }
  }

  // ---- state: the start (GET /proj/noten) and the two SSE fields; a newer SSE state is never overwritten by an older answer
  async function ladeZustand() {
    const r = await ctx.holeGet(`/proj/noten?${weg}`);
    if (beendet || r?.status !== 200 || r.j?.clip_id !== clipId) return;
    let geaendert = false;
    if (!renderEreignis) { render = r.j.render?.zustand ? r.j.render : { zustand: 'quelle' }; geaendert = true; }
    if (!analyseEreignis && r.j.analyse) { analyse = r.j.analyse; if (analyse.zustand === 'laeuft' && !lage.laufend) lage.laufend = analyse; geaendert = true; }
    if (geaendert) melde();
  }
  function ereignis(a, f) {
    if (beendet || a !== 'proj' || !f) return;
    const n = f.noten, rd = f.noten_render;
    nimmLauf(lage, n, st.slug);
    if (n && n.clip_id === clipId && n.slug === st.slug) { analyse = n; analyseEreignis = true; melde(); }
    if (rd && rd.clip_id === clipId && rd.slug === st.slug) { render = rd; renderEreignis = true; melde(); }
  }

  return {
    lies, schreibe,
    /** the strength of quantise and snap in 0..1 (the field of the block), read back as `Sicht.staerke` */
    setzeStaerke(x) { if (zahl(x)) staerke = Math.min(1, Math.max(0, x)); },
    abonniere(f) { hoerer.add(f); return () => { hoerer.delete(f); }; },
    ladeZustand, ereignis, projektNeu: melde,
    ende() { beendet = true; hoerer.clear(); },
  };
}
