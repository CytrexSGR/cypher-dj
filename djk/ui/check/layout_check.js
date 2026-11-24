// Layout audit of the page, run in Chrome. Classic script: no import, no export.
// Check protocol (every view task, at 1920x1080 AND 1366x768 on a test instance, never port 47300):
//  1. viewport by chrome-devtools `emulate` (1920x1080x1 and 1366x768x1; resize_page does not set the height); screenshots
//     ~/messungen/2026-11-23-ui-polish/<task>/<view>-1920.png and -1366.png; console errors by list_console_messages types ["error"].
//  2. audit call: evaluate_script `() => { <this file>; return layoutPruefung(document, { paare: [['#mischer', '#deck-c']] }); }`.
//  3. rect numbers of the touched elements by getBoundingClientRect, written into the task report beside the audit JSON.
//  4. a view is done when its lists hold no entry or each remaining entry is explained.
function layoutPruefung(doc, opt) {
  opt = opt || {};
  const minZiel = opt.minZiel || 20, minZeichen = opt.minZeichen || 8;
  const WOERTER = ['Baukasten', 'Komp', 'Saett', 'mitschnitt', 'leer', 'Sättigung', 'Kompressor', 'Hinweis', 'Fehler', 'Bibliothek', 'Spur'];
  const win = doc.defaultView;
  const vw = win.innerWidth, vh = win.innerHeight;
  const alle = Array.from(doc.querySelectorAll('*'));

  // the rectangle as the person sees it: cut by every scrolling ancestor (overflow auto or scroll). A cell that is scrolled out of its column
  // lies geometrically under the key below it, but nothing is covered; a half visible cell counts with its visible part.
  const rechteck = (e) => {
    const r = e.getBoundingClientRect();
    let l = r.left, t = r.top, rr = r.right, b = r.bottom;
    for (let p = e.parentElement; p && p !== doc.body && p !== doc.documentElement; p = p.parentElement) {
      const s = win.getComputedStyle(p);
      if (!s || !/(^|\|)(auto|scroll)($|\|)/.test(`${s.overflowX}|${s.overflowY}`)) continue;
      const c = p.getBoundingClientRect();
      l = Math.max(l, c.left); t = Math.max(t, c.top); rr = Math.min(rr, c.right); b = Math.min(b, c.bottom);
    }
    return { left: l, top: t, right: Math.max(rr, l), bottom: Math.max(b, t), width: Math.max(rr - l, 0), height: Math.max(b - t, 0) };
  };
  const sichtbar = (e) => {
    if (e.hidden) return false;
    const r = rechteck(e);
    if (!(r.width > 0 && r.height > 0)) return false;
    const s = win.getComputedStyle(e);
    return s.display !== 'none' && s.visibility !== 'hidden';
  };
  const attr = (e, n) => e.getAttribute(n);
  // a transparent ::before with negative inset enlarges the hit area without changing the look (plan, global rules): it counts for the hit area
  // and its overflow is not a cut-off text
  const trefferZusatz = (e) => {
    try {
      const p = win.getComputedStyle(e, '::before');
      if (p && p.content && p.content !== 'none' && p.position === 'absolute') {
        const px = (v) => (parseFloat(v) < 0 ? -parseFloat(v) : 0);
        return { w: px(p.left) + px(p.right), h: px(p.top) + px(p.bottom), r: px(p.right) };
      }
    } catch (_) { /* a stand-in without pseudo-element styles: no extra area */ }
    return { w: 0, h: 0, r: 0 };
  };
  const sel = (e) => {
    const tag = e.tagName.toLowerCase();
    if (e.id) return `${tag}#${e.id}`;
    const k = typeof e.className === 'string' ? e.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.') : '';
    return k ? `${tag}.${k}` : tag;
  };
  const eigenerText = (e) => {
    if (e.childNodes) {
      let t = '';
      for (const n of Array.from(e.childNodes)) if (n.nodeType === 3) t += n.textContent;
      return t.replace(/\s+/g, ' ').trim();
    }
    return !e.children || e.children.length === 0 ? (e.textContent || '').replace(/\s+/g, ' ').trim() : '';
  };
  const interaktiv = (e) => {
    const t = e.tagName;
    if (t === 'BUTTON' || t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA') return !(t === 'INPUT' && attr(e, 'type') === 'hidden');
    const role = attr(e, 'role');
    return (t === 'A' && attr(e, 'href') !== null) || role === 'button' || role === 'slider';
  };
  const ueberschnitt = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
  const enthaelt = (a, b) => a.left <= b.left && a.top <= b.top && a.right >= b.right && a.bottom >= b.bottom;

  const res = { viewport: { w: vw, h: vh }, abgeschnitten: [], ausserhalb: [], klein: [], ueberlappt: [], ohneName: [], deutsch: [] };
  const sicht = alle.filter(sichtbar);

  for (const e of sicht) {
    const text = eigenerText(e);
    if (text && e.scrollWidth - trefferZusatz(e).r > e.clientWidth) {
      const titel = attr(e, 'title') || attr(e, 'aria-label') || '';
      const sichtbarZeichen = Math.floor(e.clientWidth / (e.scrollWidth / text.length));
      const mitTitel = titel.trim() === text;
      if (!(mitTitel && sichtbarZeichen >= minZeichen)) res.abgeschnitten.push({ sel: sel(e), text, sichtbar: sichtbarZeichen, mitTitel });
    }
  }

  const bedien = sicht.filter(interaktiv);
  for (const e of bedien) {
    const r = rechteck(e);
    if (r.left < 0 || r.top < 0 || r.right > vw || r.bottom > vh) res.ausserhalb.push({ sel: sel(e) });
    if (/^(BUTTON|INPUT|SELECT)$/.test(e.tagName) || ['button', 'slider'].includes(attr(e, 'role'))) {
      const zu = trefferZusatz(e);
      if (r.width + zu.w < minZiel || r.height + zu.h < minZiel) res.klein.push({ sel: sel(e), w: Math.round(r.width), h: Math.round(r.height) });
    }
  }
  for (let i = 0; i < bedien.length; i++) {
    for (let j = i + 1; j < bedien.length; j++) {
      const a = rechteck(bedien[i]), b = rechteck(bedien[j]);
      if (ueberschnitt(a, b) && !enthaelt(a, b) && !enthaelt(b, a)) res.ueberlappt.push({ a: sel(bedien[i]), b: sel(bedien[j]) });
    }
  }
  for (const [sa, sb] of opt.paare || []) {
    const ea = doc.querySelector(sa), eb = doc.querySelector(sb);
    if (ea && eb && sichtbar(ea) && sichtbar(eb) && ueberschnitt(rechteck(ea), rechteck(eb))) res.ueberlappt.push({ a: sa, b: sb });
  }

  for (const e of sicht) {
    if (!/^(INPUT|SELECT|TEXTAREA)$/.test(e.tagName) || (e.tagName === 'INPUT' && attr(e, 'type') === 'hidden')) continue;
    const id = e.id;
    const mitFuer = id && doc.querySelector(`label[for="${id}"]`);
    if (!(mitFuer || (e.closest && e.closest('label')) || attr(e, 'aria-label') || attr(e, 'title'))) res.ohneName.push({ sel: sel(e) });
  }

  const regeln = WOERTER.map((w) => [w, new RegExp(`(^|[^\\p{L}])${w}($|[^\\p{L}])`, 'u')]);
  for (const e of sicht) {
    const quellen = [eigenerText(e), attr(e, 'title'), attr(e, 'placeholder'), attr(e, 'aria-label')];
    for (const q of quellen) {
      if (!q) continue;
      const treffer = regeln.find(([, re]) => re.test(q));
      if (treffer) { res.deutsch.push({ sel: sel(e), wort: treffer[0] }); break; }
    }
  }
  return res;
}
if (typeof globalThis !== 'undefined') globalThis.layoutPruefung = layoutPruefung;
