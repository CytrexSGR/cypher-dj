// Live dock: the graph slot of a channel and the returns FX3 and FX4 (plan 2026-11-19-one-dock-stage-5a, task 7). An instrument is changed by CHANGE
// and opened by OPEN; an effect is added by + INSERT, opened by its chip and changed or removed from the chip menu; FX3 and FX4 change and open their
// effect the same way. The window shows today's knob area of the channel (bindeBkKnobs: front panel or sliders with LEARN, preset header, host areas)
// under the picker of the channel; the page rebuilds every .sendzeile row itself when a graph changes (baueSendKnobs), this window included.
// ctx = { host, fenster, popover, tick(), stand(), karte(id) } (host.js).
import { menuePunkte, oeffneAchsenMenue } from '../instrument_groups.js';
import { waehleGraph, zeigeGraphWahl, graphenGeladen } from '../graphs_view.js';
import { bindeBkKnobs } from '../learn_view.js';
import { wechselWahl, effektWahl } from './model.js';

const unten = (anker) => { const r = anker?.getBoundingClientRect?.() ?? { left: 0, bottom: 0 }; return [r.left, r.bottom]; };
const nachher = async (ctx, p) => { await p; ctx.tick(); };

/** The flat effect menu of a slot at the anchor: the loaded one greyed, Remove last (not from + INSERT). */
function effektMenue(ctx, kanal, anker, mitWeg = true) {
  const stand = ctx.stand();
  const punkte = effektWahl(kanal, stand).filter((x) => mitWeg || x.wert !== '')
    .map((x) => ({ text: x.text, aus: x.aus, aktion: () => nachher(ctx, waehleGraph(kanal, x.wert)) }));
  if (!punkte.length) { ctx.host.melde('No effect graph to load here'); return; }
  ctx.host.oeffneMenue(punkte, ...unten(anker));
}

/** CHANGE: the instruments of the channel grouped by role or type (the menu of PRODUCTION and STUDIO); on FX3 and FX4 the effects. */
export function wechsel(ctx, karte, anker) {
  const kanal = karte.id, stand = ctx.stand();
  if (!stand) return;
  if (karte.art === 'ret') { effektMenue(ctx, kanal, anker); return; }
  oeffneAchsenMenue(
    (achse, umschalten) => menuePunkte(wechselWahl(kanal, stand), stand.graphen, achse, (e) => nachher(ctx, waehleGraph(kanal, e.name)), umschalten, stand.geladen?.[kanal]),
    (punkte) => ctx.host.oeffneMenue(punkte, ...unten(anker)),
  );
}

/** The window of a slot: picker on top, the knob area below. id `live:inst:<kanal>` for an instrument, `live:fx:<kanal>` for an effect. */
function slotFenster(ctx, kanal, art) {
  const karte = ctx.karte(kanal);
  const name = () => graphenGeladen[kanal] || karte?.untertitel || kanal;
  return ctx.fenster?.oeffne({
    id: `live:${art === 'live-inst' ? 'inst' : 'fx'}:${kanal}`, titel: name(), untertitel: karte?.name ?? kanal, art,
    bauen(koerper) {
      const zeile = document.createElement('div');
      zeile.className = 'sendzeile live-graph';
      zeile.setAttribute('data-kanal', kanal);
      const platz = document.createElement('div');
      platz.className = 'graphplatz';
      platz.setAttribute('data-graphplatz', kanal);
      const liste = document.createElement('div');
      liste.className = 'bkliste';
      zeile.append(platz, liste);
      koerper.append(zeile);
      bindeBkKnobs(zeile, kanal);
      zeigeGraphWahl();
      return {
        aktualisiere: () => {
          zeile.querySelector('.bkliste')?._fp?.aktualisiere?.();
          // the window title follows the loaded name (the frame holds the body and the title bar)
          const t = koerper.parentElement?.querySelector?.('[data-w="fenster-titel"]');
          if (t && t.textContent !== name()) t.textContent = name();
        },
      };
    },
  });
}

/** OPEN on a channel card (its instrument) or on FX3, FX4 (their effect). */
export function auf(ctx, karte) {
  slotFenster(ctx, karte.id, karte.art === 'ret' ? 'live-fx' : 'live-inst');
}
/** A click on the effect chip of a channel: the same window as OPEN of a return. */
export function effektFlaeche(ctx, kanal, anker) {
  slotFenster(ctx, kanal, 'live-fx');
}
/** A chip menu entry of the effect chip: change it (flat menu at the chip) or remove it. */
export function effektAktion(ctx, kanal, punkt, anker) {
  if (punkt.aktion === 'effekt-wechsel') effektMenue(ctx, kanal, anker);
  else if (punkt.aktion === 'effekt-weg') nachher(ctx, waehleGraph(kanal, ''));
}
/** + INSERT: the effects to load into the slot of the channel. */
export function plus(ctx, kanal, anker) {
  effektMenue(ctx, kanal, anker, false);
}
