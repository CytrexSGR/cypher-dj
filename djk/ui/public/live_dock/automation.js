// Live dock: the loop automation editor of L1 and L2 in a window (plan 2026-11-19-one-dock-stage-5a, task 9), opened from the card menu. The markup
// is the one of the tab's detail (autoBereichHtml), wired by bindeAutomation, which loads and saves through /loop/automation as before.
// ctx = { host, fenster, popover, tick(), stand(), karte(id) } (host.js).
import { autoBereichHtml } from '../effects.js';
import { bindeAutomation } from '../effects_bindung.js';
import { zustand } from '../page_state.js';

/** The loop automation window of pad box 1 or 2. */
export function automationFenster(ctx, box) {
  ctx.fenster?.oeffne({
    id: `live:auto:${box}`, titel: 'LOOP AUTOMATION', untertitel: `L${box}`, art: 'live-auto',
    bauen(koerper) {
      // review 2026-11-19 (MAJOR): the window follows the loop of its box; a new loop (/e/loop) rebuilds the editor, so SAVE never writes
      // the old loop's curves under a stale name
      const schluessel = () => { const l = zustand.loops[box]; return `${l?.name ?? ''}|${Number(l?.beats) || 0}`; };
      let gebunden = null;
      const aufbauen = () => {
        koerper.textContent = '';
        const d = document.createElement('div');
        d.className = 'live-auto';
        d.innerHTML = autoBereichHtml();
        koerper.append(d);
        bindeAutomation(d, Number(box));
        gebunden = schluessel();
      };
      aufbauen();
      return { aktualisiere: () => { if (schluessel() !== gebunden) aufbauen(); } };
    },
  });
}
