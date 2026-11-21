// Live dock surfaces of the channel compressor (plan 2026-11-19-one-dock-stage-5a, task 6): the COMP chip opens the compressor face of the channel
// (the same face as the FACE button of the strip); its menu holds Bypass/Enable, the key source, the presets and the gain reduction history (a window).
// ctx = { host, fenster, popover, tick(), stand(), karte(id) } (host.js).
import { kompPresetFelder } from '../effects.js';
import { zustand } from '../page_state.js';
import { setzeKomp, kompWert } from '../effects_gemeinsam.js';
import { oeffneKanalFace } from '../effects_face.js';
import { zeichneVerlaufIn } from '../effects_bindung.js';

const nameVon = (ctx, kanal) => ctx.karte(kanal)?.name ?? kanal;

/** A click on the COMP chip: the compressor face of the channel (a second click closes it, as the FACE button does). */
export function kompFlaeche(ctx, kanal) {
  oeffneKanalFace(kanal, nameVon(ctx, kanal));
}

/** A chip menu entry of COMP: `komp-an`, `komp-sc` (wert = key), `komp-preset` (wert = preset name), `komp-verlauf`. */
export async function kompAktion(ctx, kanal, punkt) {
  const a = punkt.aktion;
  if (a === 'komp-an') await setzeKomp(`${kanal}/komp/an`, kompWert(kanal, 'an', 0) >= 0.5 ? 0 : 1);
  else if (a === 'komp-sc') await setzeKomp(`${kanal}/komp/sc`, Number(punkt.wert));
  else if (a === 'komp-preset') {
    for (const [feld, w] of kompPresetFelder(punkt.wert, zustand.plaetze, kanal)) await setzeKomp(`${kanal}/komp/${feld}`, w);
  } else if (a === 'komp-verlauf') verlaufFenster(ctx, kanal);
  ctx.tick();
}

/** The gain reduction of the last 10 s of a channel in a window, redrawn on every refresh of the window layer. */
function verlaufFenster(ctx, kanal) {
  ctx.fenster?.oeffne({
    id: `live:verlauf:${kanal}`, titel: 'GAIN REDUCTION', untertitel: `LAST 10 S · ${nameVon(ctx, kanal)}`, art: 'live-verlauf',
    bauen(koerper) {
      const c = document.createElement('canvas');
      c.className = 'live-verlauf'; c.width = 480; c.height = 100;
      c.setAttribute('aria-label', `Gain reduction of the last 10 seconds, ${nameVon(ctx, kanal)}`);
      koerper.append(c);
      const aktualisiere = () => zeichneVerlaufIn(c, kanal);
      aktualisiere();
      return { aktualisiere };
    },
  });
}
