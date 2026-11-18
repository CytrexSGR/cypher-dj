// A project update (SSE, a write answer, a take event) while a group name is being edited must not throw in the gruppen hook:
// the head keeps its name node (no node swap), so the views stay current and the writer is never left stuck.
import test from 'node:test';
import assert from 'node:assert/strict';

class El {
  constructor(tag = 'div', cls = '') {
    this.tagName = tag.toUpperCase(); this.className = cls; this.children = []; this.parentElement = null;
    this.dataset = {}; this.attrs = {}; this.hoerer = {}; this.value = ''; this.textContent = ''; this.hidden = false; this.disabled = false;
    const self = this;
    this.style = { setProperty() {}, removeProperty() {} };
    this.classList = { toggle(k, an) { const s = new Set(self.className.split(' ').filter(Boolean)); if (an ?? !s.has(k)) s.add(k); else s.delete(k); self.className = [...s].join(' '); } };
  }
  set innerHTML(html) {
    this.children = [];
    for (const m of html.matchAll(/<(\w+) class="([^"]+)"/g)) this.anhaengen(new El(m[1], m[2]));
  }
  append(...k) { for (const x of k) this.anhaengen(x); }
  anhaengen(k) { k.parentElement = this; this.children.push(k); return k; }
  insertBefore(k, vor) { if (k.parentElement) k.parentElement.children = k.parentElement.children.filter((x) => x !== k); k.parentElement = this; const i = vor ? this.children.indexOf(vor) : -1; if (i < 0) this.children.push(k); else this.children.splice(i, 0, k); return k; }
  replaceWith(n) { const p = this.parentElement; if (!p) return; const i = p.children.indexOf(this); p.children[i] = n; n.parentElement = p; this.parentElement = null; }
  replaceChildren(...k) { this.children = []; for (const x of k) this.anhaengen(x); }
  remove() { const p = this.parentElement; if (p) p.children = p.children.filter((x) => x !== this); this.parentElement = null; }
  querySelector(sel) { const k = sel.slice(1); for (const c of this.children) { if (c.className.split(' ').includes(k)) return c; const t = c.querySelector(sel); if (t) return t; } return null; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(t, f) { (this.hoerer[t] ??= []).push(f); }
  feuer(t, e = {}) { for (const f of this.hoerer[t] ?? []) f({ preventDefault() {}, stopPropagation() {}, ...e }); }
  focus() {} select() {}
}

const G = (rev, name = 'Drums') => ({ rev, name: 'P', master: { fader_db: 0 }, spuren: [],
  gruppen: [{ id: 'g1', nr: 1, name, farbe: '#3b8de0', fader_db: 0, pan: 0, mute: false, solo: false, gefaltet: false }] });

async function aufbau() {
  globalThis.document = { createElement: (t) => new El(t) };
  const { bindeGruppen } = await import('../public/production/groups.js');
  const { neuerSchreiber } = await import('../public/production/writer.js');
  const els = { 'mixer-gruppen': new El(), mixer: new El(), 'neu-gruppe': new El(), 'pm-fader': new El('input'), 'pm-wert': new El() };
  new El().anhaengen(els['pm-fader']);
  const ctx = { $: (k) => els[k], st: { projekt: null }, beimProjekt: [] };
  let rev = 1;
  const gesendet = [];
  ctx.schreiber = neuerSchreiber({
    holeJson: async (weg, k) => { gesendet.push(k.label); rev++; return { status: 200, j: { rev, projekt: G(rev) } }; },
    beiProjekt: (slug, p) => { ctx.st.projekt = p; for (const h of ctx.beimProjekt) h(p); },
    beiFehler: () => {},
  });
  ctx.aendere = (l, b, s) => ctx.schreiber.aendere(l, b, s);
  ctx.aendereAus = () => Promise.resolve(false);
  bindeGruppen(ctx);
  ctx.st.projekt = G(1); ctx.schreiber.setze('p', 1);
  for (const h of ctx.beimProjekt) h(G(1));
  return { ctx, els, gesendet };
}

test('a project update while a group name is being edited does not throw, and the writer keeps sending', async () => {
  const unbehandelt = [];
  const fang = (e) => unbehandelt.push(e);
  process.on('unhandledRejection', fang);
  try {
    const { ctx, els, gesendet } = await aufbau();
    const kopf = els['mixer-gruppen'].children[0];
    kopf.querySelector('.p-spurname').feuer('dblclick');   // rename field opens
    assert.ok(kopf.querySelector('.p-namefeld'), 'the rename field is open');
    const name = kopf.querySelector('.p-spurname');
    assert.doesNotThrow(() => { for (const h of ctx.beimProjekt) h(G(2, 'Renamed')); }, 'the gruppen hook must not throw while the name is being edited');
    assert.equal(name.textContent, 'Renamed', 'the name node follows the project while the field is open');
    assert.equal(name.hidden, true, 'the name stays hidden while the field is open');
    // the writer path: a write answered while the field is open, then a later change must still be sent
    ctx.aendere('Master volume', [{ befehl: 'master_aendern', fader_db: -1 }]);
    await new Promise((ok) => setTimeout(ok, 20));
    const zweite = ctx.aendere('Master volume', [{ befehl: 'master_aendern', fader_db: -2 }]);
    const ergebnis = await Promise.race([zweite, new Promise((ok) => setTimeout(() => ok('haengt'), 200))]);
    assert.equal(ergebnis, true, `the second change is sent and answered (sent: ${JSON.stringify(gesendet)}, unhandled: ${unbehandelt.map(String)})`);
    kopf.querySelector('.p-namefeld').feuer('keydown', { key: 'Escape' });   // the edit ends without a change
    assert.equal(kopf.querySelector('.p-namefeld'), null, 'the rename field is gone');
    assert.equal(name.hidden, false, 'the name is visible again');
    assert.equal(name.textContent, 'Drums', 'the name shows the last server state (the writer answers carried the old name)');
    assert.equal(gesendet.includes('Rename group'), false, 'Esc sends no rename');
  } finally { process.off('unhandledRejection', fang); }
});
