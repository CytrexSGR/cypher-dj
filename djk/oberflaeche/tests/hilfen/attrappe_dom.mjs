// A minimal fake DOM for the heads of the track list (bindeKoepfe): enough for createElement, innerHTML, querySelector, events. Not a browser: the real
// behaviour is proven by the browser probes. Every selector gives one element; fire(el, type, props) calls its handlers.
export function neuesElement() {
  const kinder = new Map(), hoerer = new Map(), klassen = new Set(), attr = new Map();
  const el = {
    dataset: {}, style: { setProperty() {} }, children: [], hidden: false, disabled: false, textContent: '', value: '0', min: '-60', max: '6', step: '0.5', className: '',
    classList: { contains: (k) => klassen.has(k), toggle: (k, an) => { const a = an ?? !klassen.has(k); if (a) klassen.add(k); else klassen.delete(k); return a; }, add: (k) => klassen.add(k), remove: (k) => klassen.delete(k) },
    setAttribute: (k, v) => attr.set(k, v), getAttribute: (k) => attr.get(k) ?? null, removeAttribute: (k) => attr.delete(k),
    querySelector(sel) { if (!kinder.has(sel)) kinder.set(sel, neuesElement()); return kinder.get(sel); },
    querySelectorAll: () => [], addEventListener(t, f) { if (!hoerer.has(t)) hoerer.set(t, []); hoerer.get(t).push(f); },
    replaceChildren() {}, insertBefore() {}, remove() {}, focus() {}, blur() {}, appendChild() {},
    fire(t, props = {}) { const e = { type: t, target: el, key: undefined, preventDefault() {}, stopPropagation() {}, ...props }; for (const f of hoerer.get(t) ?? []) f(e); },
  };
  return el;
}
export function installiereDom() {
  const fenster = new Map();
  globalThis.document = { createElement: () => neuesElement(), activeElement: null };
  globalThis.window = { addEventListener: (t, f) => { if (!fenster.has(t)) fenster.set(t, []); fenster.get(t).push(f); } };
  return { fenster: (t) => { for (const f of fenster.get(t) ?? []) f({ type: t }); } };
}
