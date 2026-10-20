// PRODUCTION (D1 V1): Zeitachse bedienen und zeichnen. Ansicht (Zoom, Scroll), Raster-Wahl GRID, FOLLOW-Schalter,
// Rad (Rad: waagrecht · Strg+Rad: Zoom um den Zeiger · Umschalt+Rad: Spuren) und das Arrangement-Canvas. Zoom, Raster
// und FOLLOW sind Bequemlichkeit je Browser (localStorage), nie Projektdaten (L7).
import { neueAnsicht, zoomUm, scrolle, RASTER, RASTER_VORGABE, PX_PRO_BEAT_VORGABE } from './zeitachse.js';
import { SPUR_HOEHE } from './layout.js';
import { neueWellen } from './wellen.js';
import { Arrangement } from './arrangement.js';

export function bindeZeitachse(ctx) {
  const { st, $ } = ctx;
  st.ansicht = { ...neueAnsicht(), pxProBeat: Number(ctx.lies('djk-prod-zoom', PX_PRO_BEAT_VORGABE)) || PX_PRO_BEAT_VORGABE };
  st.raster = ctx.lies('djk-prod-raster', RASTER_VORGABE);
  st.follow = ctx.lies('djk-prod-follow', 'an') !== 'aus';
  st.geist = null;          // Ablage-Geist beim Ziehen (ablage.js)
  st.loopEntwurf = null;    // Loop-Klammer während des Ziehens (transport.js)
  const arr = new Arrangement({ lineal: $('lineal'), spuren: $('spuren'), ueber: $('ueber'), wellen: neueWellen() });
  ctx.breite = () => arr.breite();     // vom ResizeObserver des Zeichners, keine Messung je Bild (FOLLOW fragt jedes Bild)
  ctx.setzeAnsicht = (a) => { st.ansicht = a; ctx.merke('djk-prod-zoom', String(a.pxProBeat)); };
  const zeigeFollow = () => { $('follow').classList.toggle('an', st.follow); $('follow').setAttribute('aria-pressed', String(st.follow)); };
  ctx.setzeFollow = (an) => { st.follow = an; ctx.merke('djk-prod-follow', an ? 'an' : 'aus'); zeigeFollow(); };
  zeigeFollow();
  $('follow').addEventListener('click', () => ctx.setzeFollow(!st.follow));
  for (const r of RASTER) { const o = document.createElement('option'); o.value = r.wert; o.textContent = r.text; $('raster').append(o); }
  if (!RASTER.some((r) => r.wert === st.raster)) st.raster = RASTER_VORGABE;
  $('raster').value = st.raster;
  $('raster').addEventListener('change', () => { st.raster = $('raster').value; ctx.merke('djk-prod-raster', st.raster); });
  $('zoom-ein').addEventListener('click', () => ctx.setzeAnsicht(zoomUm(st.ansicht, 1.5, ctx.breite() / 2)));
  $('zoom-aus').addEventListener('click', () => ctx.setzeAnsicht(zoomUm(st.ansicht, 1 / 1.5, ctx.breite() / 2)));
  const rad = (e) => {
    e.preventDefault();
    if (e.ctrlKey) { ctx.setzeAnsicht(zoomUm(st.ansicht, e.deltaY < 0 ? 1.15 : 1 / 1.15, e.offsetX)); return; }
    if (e.shiftKey) { $('koerper').scrollTop += e.deltaY; return; }
    st.ansicht = scrolle(st.ansicht, e.deltaX || e.deltaY);
    if (st.follow) ctx.setzeFollow(false);
  };
  $('ueber').addEventListener('wheel', rad, { passive: false });
  $('lineal').addEventListener('wheel', rad, { passive: false });
  ctx.beimProjekt.push((p) => { $('flaeche').style.height = `${(p?.spuren.length ?? 0) * SPUR_HOEHE}px`; });
  ctx.beimBild.push(() => arr.bild({ ansicht: st.ansicht, projekt: st.projektEntwurf ?? st.projekt, loop: st.loopEntwurf ?? st.projekt?.loop ?? null,
    kopfBeat: st.kopfBeat, startBeat: st.start, geist: st.geist }));
}
