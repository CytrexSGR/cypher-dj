// Workbench SOUND helpers (stage 1 had a SOUND column here: its tiles are the cards of dock.js, its device area is the big view of window.js).
// What stays is the plumbing that several of them share:
//   - the panel source (ctx.panelQuelle): the graph list and the panel of a Baukasten effect, fetched once and kept;
//   - the floating faces of the native inserts and their stream readings (ctx.insertFaceOeffnen);
//   - the instrument exchange of a track (ctx.instrumentWechsel(spurId, anker): the menu of CHANGE);
//   - the sound host div[data-w="klang"] with the cut strip of a sampler track (schnitt_streifen.js, schnitt_tone.js) and the kit dialog (schnitt_kit.js).
//     The host is hidden and sits in the workbench root; the big view of an instrument track moves it into its window (window.js).
// UI texts English.
import { wechselBefehle } from '../seq_field.js';
import { oeffneInstrumentMenue } from './tracks.js';
import { oeffneMenue } from '../production/context_menu.js';
import {
  insGrAufnehmen, insPegelAufnehmen,
} from '../production/inserts.js';
import { bindeInsertFace } from '../production/insert_face.js';
import { bindeSchnittStreifen } from './schnitt_streifen.js';
import { bindeSchnittTon } from './schnitt_tone.js';
import { neuePanelQuelle } from '../dock/panel_source.js';

export const KLANG_TEXT = { wechsel: '\u21c4 CHANGE', wechselTitel: 'Change the instrument of this track; the notes stay' };

export function bindeKlang(ctx) {
  const { st, $ } = ctx;
  const host = $('klang');
  host.innerHTML = '<div class="w-schnitt" data-w="schnitt" hidden></div>';
  ctx.klangHost = host;
  const gr = {}, pegel = {};   // the readings of /e/ins_gr and /e/stufe_pegel, read by an open device face
  const faces = bindeInsertFace(ctx, () => gr, () => pegel);
  ctx.insertFaceOeffnen = (strang, insert) => faces.oeffne(strang, insert);   // the dock and the big view open the floating faces of the native stages
  ctx.panelQuelle ??= neuePanelQuelle(ctx);
  ctx.beimEreignis.push((a, f) => {
    if (a === '/e/ins_gr') insGrAufnehmen(gr, f, performance.now());
    else if (a === '/e/stufe_pegel') insPegelAufnehmen(pegel, f, performance.now());
  });
  const spurVon = (id) => (st.projekt?.spuren ?? []).find((s) => s.id === id && s.art === 'instrument') ?? null;

  // Instrument exchange (the SEQ deck's wechselBefehle): the notes of the pattern clip stay; knob lanes the new device does not have go after a question.
  ctx.instrumentWechsel = async (spurId, anker) => {
    const spur = spurVon(spurId); if (!spur) return;
    const r = anker.getBoundingClientRect();
    const [g, kits] = await Promise.all([ctx.holeGet('/graphen'), ctx.holeGet('/proj/kits')]);
    const alt = spur.geraet;
    oeffneInstrumentMenue(g?.j?.graphen, kits?.j?.kits, alt?.art === 'intern' && alt.name === 'bk' ? alt.graph : undefined, (e) => tausche(spur.id, e),
      (punkte) => (ctx.oeffneMenue ?? oeffneMenue)(punkte, r.left, r.bottom));
  };
  async function tausche(id, eintrag) {
    const spur = spurVon(id); if (!spur) return;
    const clip = (spur.clips ?? []).find((c) => c.art === 'midi') ?? null;
    const w = wechselBefehle(spur, clip, eintrag.geraet, ctx.info?.(spur) ?? null);
    if (w.meldung) { ctx.melde(w.meldung, true); return; }
    if (!w.befehle.length) return;
    if (w.frage && !(await ctx.frage(w.frage))) return;
    await ctx.aendere(`Instrument ${spur.name}: ${eintrag.text}`, w.befehle);
  }
  bindeSchnittStreifen(ctx, $('schnitt'));   // sampler A1 task 8: the strip of a sampler cut (shown for a slice track only)
  bindeSchnittTon(ctx, $('schnitt'));        // sampler C task 5: TO TONE on the strip, the ROOT box of a tone track (after the strip: it resets schnittAktionen)
}
