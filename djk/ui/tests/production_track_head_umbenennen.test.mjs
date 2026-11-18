// A project state shown while a track name is being edited must not throw in the track heads: the head keeps its name node (no node swap).
import test from 'node:test';
import assert from 'node:assert/strict';

class El {
  constructor(tag = 'div', cls = '') {
    this.tagName = tag.toUpperCase(); this.className = cls; this.children = []; this.parentElement = null;
    this.dataset = {}; this.attrs = {}; this.hoerer = {}; this.value = ''; this.textContent = ''; this.hidden = false; this.disabled = false; this.title = '';
    const self = this;
    this.style = { setProperty() {}, removeProperty() {} };
    this.classList = {
      toggle(k, an) { const s = new Set(self.className.split(' ').filter(Boolean)); if (an ?? !s.has(k)) s.add(k); else s.delete(k); self.className = [...s].join(' '); },
      contains: (k) => self.className.split(' ').includes(k), add: (k) => self.classList.toggle(k, true), remove: (k) => self.classList.toggle(k, false),
    };
  }
  set innerHTML(html) {
    this.children = [];
    for (const m of html.matchAll(/<(\w+) class="([^"]+)"/g)) this.anhaengen(new El(m[1], m[2]));
  }
  anhaengen(k) { k.parentElement = this; this.children.push(k); return k; }
  append(...k) { for (const x of k) this.anhaengen(x); }
  insertBefore(k, vor) { if (k.parentElement) k.parentElement.children = k.parentElement.children.filter((x) => x !== k); k.parentElement = this; const i = vor ? this.children.indexOf(vor) : -1; if (i < 0) this.children.push(k); else this.children.splice(i, 0, k); return k; }
  replaceWith(n) { const p = this.parentElement; if (!p) return; const i = p.children.indexOf(this); p.children[i] = n; n.parentElement = p; this.parentElement = null; }
  replaceChildren(...k) { this.children = []; for (const x of k) this.anhaengen(x); }
  remove() { const p = this.parentElement; if (p) p.children = p.children.filter((x) => x !== this); this.parentElement = null; }
  querySelector(sel) { const k = sel.slice(1); for (const c of this.children) { if (c.className.split(' ').includes(k)) return c; const t = c.querySelector(sel); if (t) return t; } return null; }
  querySelectorAll(sel) { const k = sel.slice(1), r = []; for (const c of this.children) { if (c.className.split(' ').includes(k)) r.push(c); r.push(...c.querySelectorAll(sel)); } return r; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(t, f) { (this.hoerer[t] ??= []).push(f); }
  feuer(t, e = {}) { for (const f of this.hoerer[t] ?? []) f({ preventDefault() {}, stopPropagation() {}, ...e }); }
  focus() {} select() {}
}

const P = (name) => ({ name: 'P', master: { fader_db: 0 }, gruppen: [], returns: [],
  spuren: [{ id: 's1', name, farbe: '#3b8de0', art: 'audio', fader_db: 0, pan: 0, mute: false, solo: false, clips: [] }] });

test('a track head shown again while its name field is open keeps the name node, and the edit ends cleanly', async () => {
  globalThis.document = { createElement: (t) => new El(t), body: new El() };
  const { bindeKoepfe } = await import('../public/production/track_heads.js');
  const behaelter = new El();
  const gesendet = [];
  const koepfe = bindeKoepfe(behaelter, { aendere: async (l, b) => { gesendet.push(l); return true; }, aendereAus: async () => true });
  koepfe.zeige(P('Kick'));
  const kopf = koepfe.element('s1');
  const name = kopf.querySelector('.p-spurname');
  name.feuer('dblclick');
  assert.ok(kopf.querySelector('.p-namefeld'), 'the rename field is open');
  assert.doesNotThrow(() => koepfe.zeige(P('Renamed')), 'showing a project while the name is being edited must not throw');
  assert.equal(name.textContent, 'Renamed', 'the name node follows the project while the field is open');
  assert.equal(name.hidden, true, 'the name stays hidden while the field is open');
  kopf.querySelector('.p-namefeld').feuer('keydown', { key: 'Escape' });
  assert.equal(kopf.querySelector('.p-namefeld'), null, 'the rename field is gone');
  assert.equal(name.hidden, false, 'the name is visible again');
  assert.deepEqual(gesendet, [], 'Esc sends nothing');
  // Enter with a new name sends the rename
  name.feuer('dblclick');
  const feld = kopf.querySelector('.p-namefeld'); feld.value = 'Snare';
  feld.feuer('keydown', { key: 'Enter' });
  assert.equal(gesendet.length, 1); assert.match(gesendet[0], /Rename track/);
});
