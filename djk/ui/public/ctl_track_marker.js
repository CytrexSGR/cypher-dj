// Which project track the controllers drive right now, marked on its track head in PRODUCTION (2026-11-18, Andreas: "weiß aber nicht ob ich noch im richtigen
// kanal bin da der aktive kanal nicht hervorgehoben wird"). The server's controller focus (controller_fokus event, GET /controller/fokus) names the track; the
// mark is one generated style rule on its id, so it survives every rebuild of the heads. Only while a controller place follows the focus (FOLLOW on a place).
// UI texts English.

/** The CSS for the mark of track `spurId` (null: none). The id is checked: only plain track ids like s12 go into the selector. Pure. */
export function ctlMarkeStil(spurId) {
  if (typeof spurId !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(spurId)) return '';
  const k = `.p-kopf[data-spur="${spurId}"]`;
  return `${k} { box-shadow: inset 0 0 0 2px #ffd60a; }\n`
    + `${k}::after { content: "CTL"; position: absolute; top: 2px; right: 3px; font-size: 9px; font-weight: 800; letter-spacing: .06em; line-height: 1;`
    + ` padding: 1px 3px; border-radius: 2px; background: #ffd60a; color: #000; pointer-events: none; }\n`;
}

/** The track the mark goes on from a controller focus state ({ fokus: { spur_id }, plaetze: [{ folgen }] }), or null. Pure. */
export function ctlMarkeSpur(stand) {
  const id = stand?.fokus?.spur_id;
  const folgt = (stand?.plaetze ?? []).some((p) => p?.folgen === true);
  return folgt && typeof id === 'string' && id !== '' ? id : null;
}

/** stream.js: a controller_fokus event (or the body of GET /controller/fokus) moves the mark. */
export function zeigeCtlMarke(stand, dok = globalThis.document) {
  if (!dok?.head) return;
  let e = dok.getElementById('ctl-spur-marke');
  if (!e) { e = dok.createElement('style'); e.id = 'ctl-spur-marke'; dok.head.append(e); }
  const css = ctlMarkeStil(ctlMarkeSpur(stand));
  if (e.textContent !== css) e.textContent = css;
}
