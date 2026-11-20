// Live dock: the MASTER card (plan 2026-11-19-one-dock-stage-5a, task 8): GLUE and LIMITER at their chips, one window per bus (today's bus strip:
// multiband, limiter, utility) and the SPECTRUM window, which moves the one spectrum view of the page (#spektrum) into its body and back when it closes.
// ctx = { host, fenster, popover, tick(), stand(), karte(id) } (host.js).
import { $, zustand } from '../page_state.js';
import { busStreifenHtml, werkzeugKlickNach } from '../effects.js';
import { bindeWerkzeug, bindeBus, zeigeWerkzeugIn, zeigeLimiter, limiterJetzt, busGrJetzt, masterLimiterJetzt, sendeWerkzeug } from '../effects_view.js';
import { neuerDrehknopf } from '../dock/drehknopf.js';
import { spektrumWert } from './model.js';

const dbText = (db) => (typeof db === 'number' && Number.isFinite(db) ? `${Math.abs(db).toFixed(1)} dB` : '–');

/** GLUE: one large knob on the same action as the front knob of the card (`kleber`, the /griff sender). */
export function glueFlaeche(ctx, anker) {
  const a = ctx.host.aktionen;
  ctx.popover.oeffne(anker, {
    id: 'live:glue', titel: 'GLUE · MASTER', klasse: 'live-glue',
    bauen(koerper) {
      const k = neuerDrehknopf({
        w: 'karte-knopf', name: 'GLUE', titel: 'Master glue compressor', lies: () => a.wert('master', 'kleber'),
        setze: (x) => a.setze('master', 'kleber', x), ende: () => a.ende?.('master', 'kleber'), text: (x) => a.text('master', 'kleber', x), vorgabe: 0,
      });
      k.setAttribute('data-param', 'kleber');
      koerper.append(k);
      k.frisch();
      return { aktualisiere: () => k.frisch() };
    },
  });
}

/** LIMITER: the gain reduction of the master limiter, refreshed with the popover. */
export function limiterFlaeche(ctx, anker) {
  ctx.popover.oeffne(anker, {
    id: 'live:limiter', titel: 'LIMITER · MASTER', klasse: 'live-limiter',
    bauen(koerper) {
      const t = document.createElement('p');
      t.className = 'live-limiter-text';
      t.textContent = 'Gain reduction of the master limiter (after master level)';
      const z = document.createElement('b');
      z.className = 'live-limiter-wert';
      koerper.append(t, z);
      const aktualisiere = () => { z.textContent = dbText(masterLimiterJetzt()); };
      aktualisiere();
      return { aktualisiere };
    },
  });
}

/** A BUS chip: the strip of that bus in a window (`bus` = 'bus/1' … 'bus/4'). */
export function busFlaeche(ctx, bus) {
  const n = bus.split('/')[1];
  ctx.fenster?.oeffne({
    id: `live:bus:${n}`, titel: `BUS ${n}`, untertitel: 'MULTIBAND · LIMITER · UTIL', art: 'live-bus',
    bauen(koerper) {
      const body = document.createElement('div');
      body.className = 'live-bus';
      body.innerHTML = busStreifenHtml(bus, `BUS ${n}`);
      koerper.append(body);
      bindeWerkzeug(body);
      bindeBus(body);
      const aktualisiere = () => {
        const streifen = body.querySelector('.busstreifen') ?? body;
        zeigeWerkzeugIn(streifen, bus);
        zeigeLimiter(limiterJetzt());
        for (const i of body.querySelectorAll('[data-messer]')) {
          const [k, feld] = i.getAttribute('data-messer').split('|');
          const db = busGrJetzt(k, feld);
          i.style.width = `${Math.min(100, ((db ?? 0) / 24) * 100)}%`;
          const z = body.querySelector(`[data-messer-zahl="${k}|${feld}"]`);
          if (z) z.textContent = db === null ? '–' : `${db.toFixed(1)} dB`;
        }
      };
      aktualisiere();
      return { aktualisiere };
    },
  });
}

/** A chip menu entry of a bus: `bus-mb` switches its multiband, `bus-lim` its limiter. */
export async function busAktion(ctx, bus, punkt) {
  const pfad = punkt.aktion === 'bus-mb' ? `${bus}/mb/an` : punkt.aktion === 'bus-lim' ? `${bus}/lim/an` : null;
  if (!pfad) return;
  await sendeWerkzeug(pfad, werkzeugKlickNach(zustand.regler, pfad));
  ctx.tick();
}

/** The SPECTRUM window; with `kanal` the source is set to that channel first. A second call brings the open window to the front. */
export function spektrumFenster(ctx, kanal = null) {
  if (kanal) sendeWerkzeug('spektrum/kanal', spektrumWert(kanal));
  const el = $('#spektrum');
  if (!el) return;
  let heim = null, danach = null;
  ctx.fenster?.oeffne({
    id: 'live:spektrum', titel: 'SPECTRUM', untertitel: kanal ? (ctx.karte(kanal)?.name ?? kanal) : '', art: 'live-spektrum',
    bauen(koerper) {
      heim = el.parentElement; danach = el.nextElementSibling;
      koerper.append(el);
      return {
        zerstoere: () => {
          if (!heim) return;
          if (danach && danach.parentElement === heim) heim.insertBefore(el, danach); else heim.append(el);
        },
      };
    },
  });
}
