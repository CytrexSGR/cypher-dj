// Host learn, page side: LEARN on the Surge panel and the host panels. The real panel renderer over a tiny fake DOM; the keys `<kanal>/host/<name>`
// (adapter.lernPfad), the request a click makes and the markers from the host mappings (public/host_adapter.js hostLern*).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { baueFrontplatte, steuerungen, parameterVon } from '../public/panel.js';
import { surgeAdapter } from '../public/surge_adapter.js';
import { hostAdapter, RB338_HOST_NAME, knobHostName, hostLernStand, hostLernAnfrage, hostZiel, hostSchluessel } from '../public/host_adapter.js';
import { geraetePanel } from '../devices_parameter.ts';

class K {
  constructor(tag) {
    this.tag = tag; this.kinder = []; this.attr = {}; this.ev = {}; this.dataset = {}; this.textContent = ''; this.tabIndex = -1;
    this.style = { vars: {}, setProperty: (k, v) => { this.style.vars[k] = v; } };
    const klassen = new Set();
    this.classList = { add: (c) => klassen.add(c), remove: (c) => klassen.delete(c), toggle: (c, an) => (an ?? !klassen.has(c) ? klassen.add(c) : klassen.delete(c)), contains: (c) => klassen.has(c) };
    this.klassen = klassen;
  }
  setAttribute(k, v) { this.attr[k] = String(v); if (k === 'class') for (const c of String(v).split(' ')) this.classList.add(c); }
  getAttribute(k) { return this.attr[k]; }
  append(...k) { for (const x of k) if (x && typeof x === 'object') x.eltern = this; this.kinder.push(...k); }
  replaceChildren() { this.kinder = []; }
  addEventListener(t, f) { (this.ev[t] ??= []).push(f); }
  setPointerCapture() {}
  focus() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 200, height: 100 }; }
  feuere(t, e = {}) { const ev = { preventDefault() {}, pointerId: 1, button: 0, shiftKey: false, target: this, ...e }; for (const f of this.ev[t] ?? []) f(ev); if (this.eltern && !ev.stopped) this.eltern.feuereWeiter(t, ev); return ev; }
  feuereWeiter(t, ev) { for (const f of this.ev[t] ?? []) f(ev); if (this.eltern && !ev.stopped) this.eltern.feuereWeiter(t, ev); }
  finde(klasse, aus = []) { if (this.klassen.has(klasse)) aus.push(this); for (const k of this.kinder) k.finde(klasse, aus); return aus; }
  alles(aus = []) { aus.push(this); for (const k of this.kinder) k.alles(aus); return aus; }
}
const DOK = { createElement: (t) => new K(t), createElementNS: (_n, t) => new K(t) };
const klick = (z) => { z.feuere('pointerdown', { clientX: 5, clientY: 50 }); z.feuere('pointerup', { clientX: 5, clientY: 50 }); };

function surgePlatte(lernStand) {
  const g = geraetePanel({ art: 'surge' });
  const cut = steuerungen(g.panel).find((c) => parameterVon(c)[0] === 'a_filter1_cutoff');
  assert.ok(cut, 'the shipped Surge panel has a_filter1_cutoff');
  const host = new K('div'), gelernt = [], vergessen = [], kopf = [];
  const adapter = surgeAdapter('bass', { kanal: 'erz/2', parameter: g.parameter, post: async () => ({ ok: true, code: 200, j: {} }) });
  const fp = baueFrontplatte(host, { panel: g.panel, parameter: Object.fromEntries(g.parameter.map((p) => [p.name, p])), adapter, dokument: DOK, lernen: lernStand,
    beiLernen: (p) => gelernt.push(p), beiVergessen: (p) => vergessen.push(p), kopf: (_e, info) => kopf.push(info) });
  const zelle = host.alles().find((e) => e.dataset?.id === cut.id);
  return { fp, zelle, gelernt, vergessen, kopf, adapter };
}
const ZIELE = [{ pfad: 'erz/2/bk/1', kanal: 'erz/2', slot: 1, gruppe: 'bass', art: 'surge', name: 'a_filter1_cutoff', gelernt: true },
  { pfad: 'erz/2/bk/2', kanal: 'erz/2', slot: 2, gruppe: 'bass', art: 'surge', name: 'a_filter1_resonance', gelernt: false },
  { pfad: 'erz/3/bk/1', kanal: 'erz/3', slot: 1, gruppe: 'melodie', art: 'rb338', name: 'Cutoff', gelernt: true }];

test('Surge panel: the adapter has lernPfad only with a channel; the header is told LEARN is possible', () => {
  const g = geraetePanel({ art: 'surge' });
  assert.equal(surgeAdapter('bass', { parameter: g.parameter, post: async () => ({}) }).lernPfad, undefined);
  const a = surgeAdapter('bass', { kanal: 'erz/2', parameter: g.parameter, post: async () => ({}) });
  assert.equal(a.lernPfad('a_filter1_cutoff'), 'erz/2/host/a_filter1_cutoff');
  assert.equal(a.lernPfad('nicht_da'), undefined);
  assert.equal(surgePlatte({ an: false, wartet: null, gelernt: new Set() }).kopf[0].lernen, true);
});

test('LEARN on the Surge panel: a click makes POST /lernen/host {kanal, name}; the armed control again cancels; right click forgets through /lernen/host/loeschen', () => {
  const { zelle, gelernt, vergessen } = surgePlatte({ an: true, wartet: null, gelernt: new Set() });
  klick(zelle);
  assert.deepEqual(gelernt, ['erz/2/host/a_filter1_cutoff']);
  assert.deepEqual(hostLernAnfrage(gelernt[0], [], null), { pfad: '/lernen/host', daten: { kanal: 'erz/2', name: 'a_filter1_cutoff' } });
  assert.deepEqual(hostLernAnfrage(gelernt[0], ZIELE, 'erz/2/bk/2'), { pfad: '/lernen/host', daten: { kanal: 'erz/2', name: 'a_filter1_cutoff' } }, 'another slot is armed: arm this one');
  assert.deepEqual(hostLernAnfrage(gelernt[0], ZIELE, 'erz/2/bk/1'), { pfad: '/lernen', daten: { pfad: null } }, 'armed again: cancel');
  zelle.feuere('contextmenu');
  assert.deepEqual(vergessen, ['erz/2/host/a_filter1_cutoff']);
  assert.deepEqual(hostZiel(vergessen[0]), { kanal: 'erz/2', name: 'a_filter1_cutoff' });
});

test('markers: fp-gelernt for a learned host mapping, fp-wartet for the armed slot, nothing for the other channel; learn mode off: no clicks', () => {
  const x = surgePlatte(hostLernStand(ZIELE, null, 'erz/2', true));
  assert.ok(x.zelle.classList.contains('fp-gelernt'));
  assert.ok(!x.zelle.classList.contains('fp-wartet'));
  x.fp.setzeLernen(hostLernStand(ZIELE, 'erz/2/bk/1', 'erz/2', true));
  assert.ok(x.zelle.classList.contains('fp-wartet'));
  x.fp.setzeLernen(hostLernStand([{ ...ZIELE[0], gelernt: false }], null, 'erz/2', true));
  assert.ok(!x.zelle.classList.contains('fp-gelernt'), 'a mapping without CC is not marked as learned');
  const andere = surgePlatte(hostLernStand(ZIELE.filter((z) => z.kanal === 'erz/3'), null, 'erz/2', true));
  assert.ok(!andere.zelle.classList.contains('fp-gelernt'));
  const aus = surgePlatte(hostLernStand(ZIELE, null, 'erz/2', false));
  klick(aus.zelle);
  assert.deepEqual(aus.gelernt, []);
  assert.deepEqual(hostLernStand(ZIELE, null, 'erz/2', true).gelernt, new Set(['erz/2/host/a_filter1_cutoff']));
  assert.equal(hostSchluessel(ZIELE[2]), 'erz/3/host/Cutoff');
});

test('host adapters (RB-338, Cypher Modular knobs): lernPfad is the host name key, only with a channel and only for known parameters', () => {
  const rb = hostAdapter({ gruppe: 'melodie', kanal: 'erz/3', hostName: (p) => RB338_HOST_NAME[p] ?? null, post: async () => ({}) });
  assert.equal(rb.lernPfad('cutoff'), 'erz/3/host/Cutoff');
  assert.equal(rb.lernPfad('env_mod'), 'erz/3/host/Env Mod');
  assert.equal(rb.lernPfad('nix'), undefined);
  assert.equal(hostAdapter({ gruppe: 'bass', kanal: 'erz/2', hostName: knobHostName, post: async () => ({}) }).lernPfad('k3'), 'erz/2/host/Knob 3');
  assert.equal(hostAdapter({ gruppe: 'bass', hostName: knobHostName, post: async () => ({}) }).lernPfad, undefined);
  assert.deepEqual(hostZiel('erz/3/host/Env Mod'), { kanal: 'erz/3', name: 'Env Mod' });
});

test('app.js wiring: the three host panels get the channel and the host learn options; the production views offer no LEARN', () => {
  const app = fs.readFileSync(path.join(import.meta.dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(app, /surgeAdapter\(gruppe, \{ kanal: k,/);
  assert.equal([...app.matchAll(/hostAdapter\(\{ gruppe, kanal: k,/g)].length, 2);
  assert.match(app, /\.\.\.hostLernOpt\(k\) \}\);/);
  assert.match(app, /lernSchicken\(a\.pfad, a\.daten\)/);
  for (const f of ['plugin_panel.js', 'device_view.js', 'plugin_device.js', 'inserts.js']) {
    assert.doesNotMatch(fs.readFileSync(path.join(import.meta.dirname, '..', 'public', 'production', f), 'utf8'), /beiLernen\s*[:(]|lernPfad\s*[:=]\s*\(/, f);
  }
});
