// A DOM stand-in that is just enough to execute the real oeffentlich/app.js in node (no jsdom in the repo): elements with attributes,
// classes, children, an innerHTML parser for the markup the page builds, a small selector engine (compound selectors with
// tag, .class, #id, [attr], [attr="v"], descendant combinator), listeners, and recording stand-ins for fetch and EventSource.
// Anything the page asks for that is not here fails loudly (TypeError) so the stand-in grows only where a test needs it.
const VOID = new Set(['input', 'br', 'img', 'hr', 'line', 'path', 'rect', 'circle', 'meta', 'link']);
const camel = (k) => k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

export class El {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.attrs = {}; this.children = []; this.parent = null; this.listeners = {}; this.klassen = new Set(); this.eigen = {}; }
  get id() { return this.attrs.id ?? ''; }
  get dataset() {
    const a = this.attrs, attr = (k) => `data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
    return new Proxy({}, { get: (_, k) => a[attr(k)], set: (_, k, v) => { a[attr(k)] = String(v); return true; }, has: (_, k) => attr(k) in a,
      ownKeys: () => Object.keys(a).filter((k) => k.startsWith('data-')).map((k) => camel(k.slice(5))),
      getOwnPropertyDescriptor: (_, k) => ({ enumerable: true, configurable: true, value: a[attr(k)] }) });
  }
  get className() { return [...this.klassen].join(' '); }
  set className(v) { this.klassen = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get classList() {
    const k = this.klassen;
    return { add: (...c) => c.forEach((x) => k.add(x)), remove: (...c) => c.forEach((x) => k.delete(x)), contains: (c) => k.has(c),
      toggle: (c, an) => { const w = an ?? !k.has(c); w ? k.add(c) : k.delete(c); return w; } };
  }
  get value() { return 'value' in this.eigen ? this.eigen.value : (this.attrs.value ?? ''); }
  set value(v) { this.eigen.value = String(v); }
  get disabled() { return 'disabled' in this.attrs; }
  set disabled(v) { v ? this.attrs.disabled = '' : delete this.attrs.disabled; }
  get hidden() { return 'hidden' in this.attrs; }
  set hidden(v) { v ? this.attrs.hidden = '' : delete this.attrs.hidden; }
  get style() { return (this.eigen.style ??= { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' }); }
  get textContent() { return this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join(''); }
  set textContent(t) { this.children = [String(t)]; }
  get innerText() { return this.textContent; }
  get innerHTML() { return this.eigen.html ?? ''; }
  set innerHTML(h) { this.eigen.html = h; this.children = []; for (const c of parse(h)) { if (typeof c !== 'string') c.parent = this; this.children.push(c); } }
  get content() { if (this.tagName !== 'TEMPLATE') return undefined; const c = new El('fragment'); c.children = this.children; return c; }
  cloneNode() { const n = new El(this.tagName.toLowerCase()); n.attrs = { ...this.attrs }; n.klassen = new Set(this.klassen); for (const k of this.children) { if (typeof k === 'string') n.children.push(k); else { const c = k.cloneNode(); c.parent = n; n.children.push(c); } } return n; }
  get isConnected() { let e = this; while (e.parent) e = e.parent; return e === wurzel; }
  get firstChild() { return this.children[0] ?? null; }
  get elemente() { return this.children.filter((c) => typeof c !== 'string'); }
  get nextElementSibling() { const l = this.parent?.elemente ?? []; return l[l.indexOf(this) + 1] ?? null; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'class') this.className = v; }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  hasAttribute(k) { return k in this.attrs; }
  addEventListener(art, f) { (this.listeners[art] ??= []).push(f); }
  removeEventListener() {}
  dispatch(art, ev = {}) { const e = { target: this, preventDefault() {}, stopPropagation() {}, key: '', ...ev }; for (const f of this.listeners[art] ?? []) f(e); for (let p = this.parent; p; p = p.parent) for (const f of p.listeners[art] ?? []) f({ ...e, currentTarget: p }); }
  click() { this.dispatch('click'); }
  append(...k) { for (const c of k) { if (typeof c !== 'string') { c.parent?.entferne(c); c.parent = this; } this.children.push(c); } }
  appendChild(c) { this.append(c); return c; }
  prepend(c) { c.parent = this; this.children.unshift(c); }
  insertBefore(c, ref) { c.parent = this; const i = this.children.indexOf(ref); this.children.splice(i < 0 ? this.children.length : i, 0, c); return c; }
  replaceChildren(...k) { this.children = []; this.append(...k); }
  entferne(c) { this.children = this.children.filter((x) => x !== c); }
  remove() { this.parent?.entferne(this); this.parent = null; }
  focus() { attrappe.aktiv = this; }
  blur() { if (attrappe.aktiv === this) attrappe.aktiv = null; }
  contains(x) { for (let e = x; e; e = e.parent) if (e === this) return true; return false; }
  closest(sel) { for (let e = this; e && e !== wurzel; e = e.parent) if (passt(e, sel)) return e; return null; }
  matches(sel) { return passt(this, sel); }
  querySelectorAll(sel) { return finde(this, sel); }
  querySelector(sel) { return finde(this, sel)[0] ?? null; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 20, right: 100, bottom: 20 }; }
  scrollIntoView() {}
  getContext() { return new Proxy({}, { get: () => () => {}, set: () => true }); }
}

function parse(h) {
  const wurzelKnoten = new El('x'), stapel = [wurzelKnoten];
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[^<>]*?)?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(h))) {
    const oben = stapel.at(-1);
    if (m[5] !== undefined) { oben.children.push(m[5].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')); continue; }
    const tag = m[2].toLowerCase();
    if (m[1]) { if (stapel.length > 1) stapel.pop(); continue; }
    const e = new El(tag);
    for (const a of m[3].matchAll(/([\w:-]+)(?:="([^"]*)"|='([^']*)')?/g)) e.setAttribute(a[1], (a[2] ?? a[3] ?? '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
    e.parent = oben; oben.children.push(e);
    if (!VOID.has(tag) && !m[4]) stapel.push(e);
  }
  const aus = wurzelKnoten.children; wurzelKnoten.children = [];
  return aus;
}
function einfach(e, s) {   // one compound selector: tag.class#id[attr][attr="v"]
  if (/[+>~:*]/.test(s.replace(/\[[^\]]*\]/g, ''))) return false;
  const rest = s.replace(/\[([\w-]+)(?:="([^"]*)")?\]/g, (_, k, v) => { e.__ok &&= k in e.attrs && (v === undefined || e.attrs[k] === v); return ''; });
  const tag = /^[a-z][\w-]*/i.exec(rest)?.[0];
  return (!tag || e.tagName === tag.toUpperCase()) && [...rest.matchAll(/\.([\w-]+)/g)].every((c) => e.klassen.has(c[1])) && [...rest.matchAll(/#([\w-]+)/g)].every((c) => e.attrs.id === c[1]);
}
function passt(e, sel) {
  return sel.split(',').some((teil) => {
    const stufen = teil.trim().split(/\s+/);
    const letzte = stufen.pop();
    e.__ok = true; const ok = einfach(e, letzte) && e.__ok; delete e.__ok;
    if (!ok) return false;
    let p = e.parent;
    for (let i = stufen.length - 1; i >= 0; i--) { while (p && !(p.__ok = true, einfach(p, stufen[i]) && p.__ok)) p = p.parent; delete p?.__ok; if (!p) return false; p = p.parent; }
    return true;
  });
}
function finde(von, sel) {
  const aus = [];
  const geh = (e) => { for (const c of e.children) if (typeof c !== 'string') { if (passt(c, sel)) aus.push(c); geh(c); } };
  geh(von);
  return aus;
}

const wurzel = new El('html');
const body = new El('body'); body.parent = wurzel; wurzel.children.push(body);
export const attrappe = { aktiv: null, anrufe: [], quellen: [], antworten: {}, body, timer: [], erzeugt: new Map() };

const fehlt = new Map();   // selector → detached stand-in for elements the static HTML would have provided
const doc = {
  body, documentElement: wurzel,
  get activeElement() { return attrappe.aktiv; },
  createElement: (t) => new El(t),
  createElementNS: (_n, t) => new El(t),
  querySelector(sel) {
    const e = finde(wurzel, sel)[0];
    if (e) return e;
    if (!fehlt.has(sel)) { const n = new El('div'); const id = /^#([\w-]+)$/.exec(sel)?.[1]; if (id) { n.setAttribute('id', id); n.parent = body; body.children.push(n); } fehlt.set(sel, n); }
    return fehlt.get(sel);
  },
  querySelectorAll: (sel) => finde(wurzel, sel),
  getElementById(id) { return doc.querySelector(`#${id}`); },
  addEventListener() {}, removeEventListener() {},
};

export function installiere({ antworten = {}, speicher = {}, html = '' } = {}) {
  body.children = []; if (html) body.innerHTML = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)[\s\S]*?<\/\1>/g, '').replace(/^[\s\S]*?<body[^>]*>/, '').replace(/<\/body>[\s\S]*$/, '');
  attrappe.antworten = antworten; attrappe.anrufe.length = 0; attrappe.quellen.length = 0; fehlt.clear();
  const ls = new Map(Object.entries(speicher));
  const g = globalThis;
  g.window = g; g.document = doc;
  g.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
  Object.defineProperty(g, 'navigator', { value: { userAgent: 'node', clipboard: {} }, configurable: true, writable: true });
  g.location = { href: 'http://127.0.0.1/', protocol: 'http:', host: '127.0.0.1', hostname: '127.0.0.1', origin: 'http://127.0.0.1' };
  g.CSS = { escape: (s) => String(s) };
  g.getComputedStyle = () => ({ getPropertyValue: () => '' });
  g.matchMedia = () => ({ matches: false, addEventListener() {} });
  g.requestAnimationFrame = () => 0; g.cancelAnimationFrame = () => {};
  g.addEventListener = () => {}; g.removeEventListener = () => {};
  g.setInterval = () => 0; g.clearInterval = () => {};   // no timers: a test drives the state case itself, nothing heals in the background
  g.ResizeObserver = class { observe() {} disconnect() {} };
  g.IntersectionObserver = g.ResizeObserver; g.MutationObserver = g.ResizeObserver;
  g.EventSource = class { constructor(u) { this.url = u; attrappe.quellen.push(this); } close() {} };
  g.WebSocket = class { constructor(u) { this.url = u; } send() {} close() {} };
  g.confirm = () => true; g.prompt = () => null;
  g.fetch = async (url, opt = {}) => {
    const methode = opt.method ?? 'GET';
    const koerper = opt.body ? JSON.parse(opt.body) : undefined;
    attrappe.anrufe.push({ url: String(url), methode, koerper });
    const a = attrappe.antworten[`${methode} ${String(url).split('?')[0]}`];
    const { code = 200, j = {} } = typeof a === 'function' ? a(koerper) : (a ?? {});
    return { status: code, ok: code >= 200 && code < 300, json: async () => j, text: async () => JSON.stringify(j), headers: { get: () => null } };
  };
  return attrappe;
}
export const sendeStrom = (a, f) => attrappe.quellen.at(-1).onmessage({ data: JSON.stringify({ a, f }) });
