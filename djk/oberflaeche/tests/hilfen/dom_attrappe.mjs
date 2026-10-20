// Kleine DOM-Attrappe für Seitenmodule ohne Browser (Paket 1.18, S3-Fix W1): gerade genug für oeffentlich/produktion/freeze_export.js
// (createElement, classList.toggle, querySelector auf .p-kopf/.p-freeze, append, before, addEventListener, dataset, CSS.escape).
// Kein HTML-Parser: innerHTML wird gemerkt, die Elemente, die ctx.$ liefert, legt der Test vorher an.
export function element(tag = 'div') {
  const e = {
    tag, className: '', textContent: '', title: '', disabled: false, innerHTML: '', dataset: {}, attribute: {}, kinder: [], klassen: new Set(), ereignisse: {},
    classList: {
      toggle(k, an) { const m = an === undefined ? !e.klassen.has(k) : !!an; if (m) e.klassen.add(k); else e.klassen.delete(k); return m; },
      contains: (k) => e.klassen.has(k),
    },
    append(...k) { for (const x of k) { x.eltern = e; e.kinder.push(x); } },
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
