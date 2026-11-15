// A small fake DOM for the device-face modules (face/*.js) without a browser: elements with attributes, children, classes, events and a document double that
// counts its listeners. Not a browser: the look and the real events are proven by tests/production_face_comp.test.mjs in Chrome.
export class FE {
  constructor(tag, doc) {
    this.tag = tag; this.ownerDocument = doc; this.kinder = []; this.attr = {}; this.ev = {}; this.dataset = {}; this.textContent = ''; this.hidden = false; this.tabIndex = -1;
    this.style = { vars: {}, setProperty: (k, v) => { this.style.vars[k] = v; } };
    this.klassen = new Set();
    this.classList = {
      add: (c) => this.klassen.add(c), remove: (c) => this.klassen.delete(c), contains: (c) => this.klassen.has(c),
      toggle: (c, an) => { const m = an === undefined ? !this.klassen.has(c) : !!an; if (m) this.klassen.add(c); else this.klassen.delete(c); return m; },
    };
  }
  setAttribute(k, v) { this.attr[k] = String(v); if (k === 'class') for (const c of String(v).split(' ')) if (c) this.klassen.add(c); }
  getAttribute(k) { return this.attr[k] ?? null; }
  removeAttribute(k) { delete this.attr[k]; }
  append(...k) { for (const x of k) if (x && typeof x === 'object') { x.eltern = this; this.kinder.push(x); } }
  replaceChildren(...k) { this.kinder = []; this.append(...k); }
  remove() { if (this.eltern) { this.eltern.kinder = this.eltern.kinder.filter((x) => x !== this); this.eltern = null; } }
  addEventListener(t, f) { (this.ev[t] ??= []).push(f); }
  removeEventListener(t, f) { this.ev[t] = (this.ev[t] ?? []).filter((x) => x !== f); }
  setPointerCapture() {}
  focus() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 200, height: 100 }; }
  feuere(t, e = {}) { const ev = { type: t, preventDefault() {}, target: this, ...e }; for (const f of this.ev[t] ?? []) f(ev); return ev; }
  alles(aus = []) { aus.push(this); for (const k of this.kinder) k.alles(aus); return aus; }
  finde(klasse) { return this.alles().filter((e) => e.klassen.has(klasse)); }
}

/** A document double: createElement(NS), a body, and keydown (any event) listeners counted per type with their capture flag. */
export function neuesDokument() {
  const dok = {
    zaehler: { add: {}, remove: {} }, hoerer: [],
    createElement: (t) => new FE(t, dok), createElementNS: (_n, t) => new FE(t, dok),
    addEventListener(t, f, o) { dok.zaehler.add[t] = (dok.zaehler.add[t] ?? 0) + 1; dok.hoerer.push({ t, f, o }); },
    removeEventListener(t, f, o) { dok.zaehler.remove[t] = (dok.zaehler.remove[t] ?? 0) + 1; const i = dok.hoerer.findIndex((h) => h.t === t && h.f === f && !!h.o === !!o); if (i >= 0) dok.hoerer.splice(i, 1); },
    /** dispatches a key like the browser: capture listeners first; stopImmediatePropagation stops the rest */
    taste(key) {
      let gestoppt = false;
      const e = { type: 'keydown', key, stopImmediatePropagation() { gestoppt = true; }, preventDefault() {} };
      for (const h of [...dok.hoerer.filter((x) => x.t === 'keydown' && x.o), ...dok.hoerer.filter((x) => x.t === 'keydown' && !x.o)]) { if (gestoppt) break; h.f(e); }
      return gestoppt;
    },
  };
  dok.body = new FE('body', dok);
  return dok;
}
