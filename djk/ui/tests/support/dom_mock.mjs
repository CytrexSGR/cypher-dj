// Kleine DOM-Attrappe für Seitenmodule ohne Browser (Paket 1.18, S3-Fix W1): gerade genug für public/production/freeze_export.js
// (createElement, classList.toggle, querySelector auf .p-kopf/.p-freeze, append, before, addEventListener, dataset, CSS.escape).
// Kein HTML-Parser: innerHTML wird gemerkt, die Elemente, die ctx.$ liefert, legt der Test vorher an.
// Since the modulator markers (strand 6) the head list starts an animation frame loop (mod_display.js neueSchleife) as soon as a head has a marker element;
// this stand-in finds an element for every selection, so every importer needs frames. Node has none: no frame ever runs here.
globalThis.requestAnimationFrame ??= () => 1;
globalThis.cancelAnimationFrame ??= () => {};
export function element(tag = 'div') {
  const e = {
    tag, className: '', textContent: '', title: '', disabled: false, innerHTML: '', dataset: {}, attribute: {}, kinder: [], klassen: new Set(), ereignisse: {},
    classList: {
      toggle(k, an) { const m = an === undefined ? !e.klassen.has(k) : !!an; if (m) e.klassen.add(k); else e.klassen.delete(k); return m; },
      contains: (k) => e.klassen.has(k),
    },
    append(...k) { for (const x of k) { x.eltern = e; e.kinder.push(x); } },
    replaceChildren(...k) { e.kinder = []; for (const x of k) { x.eltern = e; e.kinder.push(x); } },   // 1.10: Ausgang-Wahl im Spurkopf (track_heads.js zeigeWerte)
    before() {}, remove() { if (e.eltern) e.eltern.kinder = e.eltern.kinder.filter((x) => x !== e); },
    addEventListener(n, f) { (e.ereignisse[n] ??= []).push(f); },
    setAttribute(n, v) { e.attribute[n] = String(v); },
    // nur die zwei Auswahlen, die freeze_export.js braucht: `.p-freeze` (Kind) und `.p-kopf[data-spur="…"]` (Kopf der Spur)
    querySelector(sel) {
      const m = /^\.p-kopf\[data-spur="(.*)"\]$/.exec(sel);
      if (m) return e.kinder.find((x) => x.dataset.spur === m[1] && x.klassen.has('p-kopf')) ?? null;
      const k = sel.replace(/^\./, '');
      return e.kinder.find((x) => x.className.split(' ').includes(k)) ?? null;
    },
  };
  return e;
}

// Setzt document und CSS für die Dauer eines Tests; gibt eine Funktion zum Zurücksetzen zurück
export function installiereDom() {
  const alt = { document: globalThis.document, CSS: globalThis.CSS };
  globalThis.document = { createElement: (t) => element(t) };
  globalThis.CSS = { escape: (s) => String(s) };
  return () => { globalThis.document = alt.document; globalThis.CSS = alt.CSS; };
}
