// EFFECTS: the compressor face of a channel (the COMP section). The same face as the insert compressor (face/comp.js), fed by the strip's rows: values from
// zustand.regler (the last value the core echoed), writes through setzeKomp (/regler), gain reduction from kompGr (/zustand/komp).
// Import cycle: effects_view.js imports this module and effects_gemeinsam.js imports effects_view.js. Nothing imported from effects_gemeinsam.js is read
// while this module loads: every use sits inside a function that runs later.
import { oeffneFace } from './face/frame.js';
import { baueKompFace, kompParameterTabelle } from './face/comp.js';
import { KOMP_PARAMETER } from './production/inserts.js';
import { KOMP_SCHLUESSEL } from './effects.js';
import { KOMP_SECHS } from './comp_controls_table.js';
import { FX_INDEX, kompGr, kompPegel, kompWert, setzeKomp } from './effects_gemeinsam.js';

const GR_FRIST_MS = 400;   // the freshness rule of the strip (zeigeKomp)
const PEGEL_FRIST_MS = 500;   // the freshness rule of the level reports, as insPegelLesung
const GEBUENDELT_MS = 40;  // the coalescing of a knob move, as the strip's sliders
const NACHZEICHNEN_MS = 850;   // a bit more than the face's own 800 ms of showing the hand's value: then the stored value is drawn again

/** The KompQuelle of the channel compressor of `k` (e.g. 'erz/1'). `beiAntwort(abgelehnt)` (set by the opener) is called after a write settled. */
export function kanalQuelleKomp(k, name) {
  const warte = new Map();   // feld -> {v, timer}
  const quelle = {
    kanal: k, name,
    // the table of the six knobs in real units; labels and units are those of the insert compressor's rows
    parameter: kompParameterTabelle(KOMP_SECHS.map((r) => { const q = KOMP_PARAMETER.find((x) => x.name === r.feld); return { name: r.feld, label: q.label, einheit: q.einheit, min: r.min, max: r.max, vorgabe: r.vorgabe }; })),
    knie: { fest: 6 },
    get: (feld) => { const r = KOMP_SECHS.find((x) => x.feld === feld); return r ? kompWert(k, feld, r.vorgabe) : undefined; },
    set(feld, v) {
      const w = warte.get(feld);
      if (w) { w.v = v; return; }   // a send is already due: it carries the latest value
      const eintrag = { v, timer: setTimeout(async () => {
        warte.delete(feld);
        await quelle.sende(`${k}/komp/${feld}`, eintrag.v);
      }, GEBUENDELT_MS) };
      warte.set(feld, eintrag);
    },
    an: { get: () => kompWert(k, 'an', 0) >= 0.5, set: (b) => quelle.sende(`${k}/komp/an`, b ? 1 : 0) },
    schluessel: {
      // a channel does not offer itself as its own key (the filter of the strip's select)
      optionen: KOMP_SCHLUESSEL.filter(([w]) => w === 0 || w !== FX_INDEX[k] + 1).map(([w, n]) => [w, n]),
      get: () => kompWert(k, 'sc', 0),
      set: (v) => quelle.sende(`${k}/komp/sc`, Number(v)),
    },
    // the reading of the strip: only while the compressor is on; 0 when no fresh frame came (the strip shows GR 0.0 then)
    gr: () => {
      if (kompWert(k, 'an', 0) < 0.5) return null;
      const g = kompGr[k];
      return g && performance.now() - g.t < GR_FRIST_MS ? g.db : 0;
    },
    // the input and output peak of the compressor (T9): only while it is on and a report is fresh (500 ms, as the insert stages)
    pegel: () => {
      if (kompWert(k, 'an', 0) < 0.5) return null;
      const g = kompPegel[k];
      return g && performance.now() - g.t < PEGEL_FRIST_MS ? { ein: g.ein, aus: g.aus } : null;
    },
    /** One write through the existing sender. setzeKomp returns nothing: its answer shows in window.djkGesendet, which it fills for every reply. */
    async sende(pfad, nach) {
      const vorher = window.djkGesendet?.length ?? 0;
      await setzeKomp(pfad, nach);
      const e = (window.djkGesendet?.length ?? 0) > vorher ? window.djkGesendet.at(-1) : null;
      const abgelehnt = !e || e.code !== 200 || e.antwort?.quittung?.status === 6;
      quelle.beiAntwort?.(abgelehnt);
    },
    zerstoere() { for (const w of warte.values()) clearTimeout(w.timer); warte.clear(); quelle.beiAntwort = null; },
  };
  return quelle;
}

/** Opens (or closes, when it is open) the compressor face of the channel k; name is the strip's name (DRUMS). Returns the frame's handle or null. */
export function oeffneKanalFace(k, name) {
  const quelle = kanalQuelleKomp(k, name);
  let bau = null, f = null, signatur = '', nachzeichnenAb = null;
  const lies = () => `${KOMP_SECHS.map((r) => kompWert(k, r.feld, r.vorgabe)).join('|')}|${kompWert(k, 'an', 0)}|${kompWert(k, 'sc', 0)}`;
  const zeichneNeu = () => { signatur = lies(); nachzeichnenAb = null; if (f) f.aktualisiere(); else bau?.aktualisiere(); };
  quelle.beiAntwort = (abgelehnt) => {
    if (!bau) return;
    if (abgelehnt) { bau.verwerfe(); zeichneNeu(); }   // the knob goes back to the last confirmed value
    else nachzeichnenAb = performance.now() + NACHZEICHNEN_MS;
  };
  f = oeffneFace({
    id: `face:kanal:${k}`, titel: 'COMPRESSOR', untertitel: name, akzent: 'orange', an: quelle.an,
    bauen: (inhalt) => {
      bau = baueKompFace(inhalt, quelle);
      signatur = lies();
      return { aktualisiere: () => bau.aktualisiere(), zerstoere: () => { quelle.zerstoere(); bau.zerstoere(); } };
    },
    // per frame: the meter; a stored value that changed (the strip's slider, an echo) or the hand's value that has aged out redraws the knobs
    live: (zeit) => {
      const gedreht = bau?.live(zeit) ?? false;
      const neu = lies() !== signatur || (nachzeichnenAb !== null && performance.now() >= nachzeichnenAb);
      if (neu) zeichneNeu();
      return gedreht || neu;
    },
  });
  if (!f) quelle.zerstoere();   // it was open and is closed now
  return f;
}
