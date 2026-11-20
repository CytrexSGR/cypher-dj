// Live dock surfaces of GATE and UTIL (plan 2026-11-19-one-dock-stage-5a, task 5): a click on the chip opens today's strip controls in a popover at the chip
// (the same markup and the same 40 ms sender as the strips of the tab); the chip menus switch the gate and the utility switches.
// ctx = { host, fenster, popover, tick(), stand(), karte(id) } (host.js).
import { zustand } from '../page_state.js';
import { werkzeugStreifenHtml, werkzeugKlickNach, GATE_SKALA_DB } from '../effects.js';
import { bindeWerkzeug, zeigeWerkzeugIn, sendeWerkzeug, gateGrJetzt } from '../effects_view.js';

const TITEL = { gate: 'GATE', util: 'UTIL' };

/** A click on the GATE or UTIL chip of a channel: its controls in a popover at the chip (a second click closes it). */
export function werkzeugFlaeche(ctx, kanal, teil, anker) {
  const name = ctx.karte(kanal)?.name ?? kanal;
  ctx.popover.oeffne(anker, {
    id: `live:${teil}:${kanal}`, titel: `${TITEL[teil] ?? teil.toUpperCase()} · ${name}`, klasse: 'live-werkzeug',
    bauen(koerper) {
      const body = document.createElement('div');
      body.className = 'live-werkzeug-koerper';
      body.setAttribute('data-kanal', kanal);
      body.innerHTML = werkzeugStreifenHtml(kanal, name, [teil]);
      koerper.append(body);
      bindeWerkzeug(body);
      const aktualisiere = () => {
        zeigeWerkzeugIn(body, kanal);
        const i = body.querySelector(`[data-messer="${kanal}|gate_db"]`), z = body.querySelector(`[data-messer-zahl="${kanal}|gate_db"]`);
        if (i && z) {
          const db = gateGrJetzt(kanal);
          i.style.width = `${Math.min(100, ((db ?? 0) / GATE_SKALA_DB) * 100)}%`;
          z.textContent = db === null ? '–' : `${db.toFixed(1)} dB`;
        }
      };
      aktualisiere();
      return { aktualisiere };
    },
  });
}

/** A chip menu entry of GATE or UTIL: `gate-an` switches the gate, `util-schalter` the utility switch named by `punkt.wert`. */
export async function werkzeugAktion(ctx, kanal, punkt) {
  const pfad = punkt.aktion === 'gate-an' ? `${kanal}/gate/an` : punkt.aktion === 'util-schalter' ? `${kanal}/${punkt.wert}` : null;
  if (!pfad) return;
  await sendeWerkzeug(pfad, werkzeugKlickNach(zustand.regler, pfad));
  ctx.tick();
}
