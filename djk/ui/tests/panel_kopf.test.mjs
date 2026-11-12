// Panel header (public/panel_kopf.js): preset list for a graph, stepping, header markup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { presetsFuer, naechstes, kopfHtml } from '../public/panel_kopf.js';

const eintrag = (herkunft, geraet, slug, name, tags) => ({ herkunft, geraet, slug, name, tags, id: `${herkunft}:${geraet}/${slug}` });
const REGISTER = {
  eintraege: [
    ...['b', 'a', 'c', 'd', 'e', 'f', 'g', 'h'].map((x) => eintrag('werk', 'baukasten', `synth-mono-${x}`, `Mono ${x}`, ['synth-mono'])),
    ...['b', 'a', 'c', 'd', 'e', 'f', 'g', 'h'].map((x) => eintrag('werk', 'baukasten', `drums-909-${x}`, `Drums ${x}`, ['drums-909'])),
    eintrag('werk', 'rb338', 'dark-dub', 'Dark Dub', ['synth-mono']),
  ],
};

test('presetsFuer: only baukasten entries tagged with the graph; factory first, then user, each by name', () => {
  const l = presetsFuer(REGISTER, { art: 'bk', graph: 'synth-mono' });
  assert.equal(l.length, 8);
  assert.deepEqual(l.map((x) => x.name), ['Mono a', 'Mono b', 'Mono c', 'Mono d', 'Mono e', 'Mono f', 'Mono g', 'Mono h']);
  assert.deepEqual(Object.keys(l[0]).sort(), ['herkunft', 'id', 'name']);
  const mit = presetsFuer({ eintraege: [...REGISTER.eintraege, eintrag('nutzer', 'baukasten', 'mein', 'Aaa mine', ['synth-mono'])] }, { art: 'bk', graph: 'synth-mono' });
  assert.equal(mit.length, 9);
  assert.equal(mit[8].id, 'nutzer:baukasten/mein');
  assert.equal(mit[0].herkunft, 'werk');
  assert.deepEqual(presetsFuer(null, { art: 'bk', graph: 'x' }), []);
  assert.deepEqual(presetsFuer(REGISTER, { art: 'sonst' }), []);
});

test('naechstes wraps both ways; an unknown id gives first for +1 and last for -1', () => {
  const l = presetsFuer(REGISTER, { art: 'bk', graph: 'synth-mono' });
  assert.equal(naechstes(l, l[7].id, 1), l[0].id);
  assert.equal(naechstes(l, l[0].id, -1), l[7].id);
  assert.equal(naechstes(l, l[2].id, 1), l[3].id);
  assert.equal(naechstes(l, 'nix', 1), l[0].id);
  assert.equal(naechstes(l, '', -1), l[7].id);
  assert.equal(naechstes([], 'x', 1), '');
});

test('kopfHtml: select.fp-preset with one option per preset, step and save buttons, escaped', () => {
  const l = presetsFuer(REGISTER, { art: 'bk', graph: 'synth-mono' });
  const html = kopfHtml({ titel: 'Synth <Mono>', akzent: '#f80', presets: l, aktiv: l[1].id, lernen: false });
  assert.equal((html.match(/<option/g) ?? []).length, 8);
  assert.match(html, /<select class="fp-preset"/);
  for (const a of ['data-fp-zurueck', 'data-fp-vor', 'data-fp-sichern']) assert.match(html, new RegExp(`<button[^>]*${a}`));
  assert.ok(!html.includes('Synth <Mono>'));
  assert.match(html, /Synth &lt;Mono&gt;/);
  assert.match(html, new RegExp(`<option value="${l[1].id}" selected`));
  assert.doesNotMatch(html, /data-fp-lernen/);
  assert.match(kopfHtml({ titel: 'x', presets: l, lernen: true }), /data-fp-lernen/);
});

test('kopfHtml: the LEARN toggle shows its state (aria-pressed, class an) and is escaped-free of other markup', () => {
  const aus = kopfHtml({ titel: 'x', lernen: true, lernAn: false }), an = kopfHtml({ titel: 'x', lernen: true, lernAn: true });
  assert.match(aus, /data-fp-lernen[^>]*aria-pressed="false"/);
  assert.match(an, /class="fp-knopf-klein an"[^>]*data-fp-lernen[^>]*aria-pressed="true"/);
  assert.doesNotMatch(kopfHtml({ titel: 'x', lernen: false, lernAn: true }), /data-fp-lernen/);
});

// ---- fake DOM: one delegated listener pair on the host must survive redraws ----
import fs from 'node:fs';
import { baueKopf, standardBeschreibung, tagVonGraph } from '../public/panel_kopf.js';
import { TAG } from '../presets/model.ts';
import { pruefeBeschreibung, ladeVokabular } from '../presets/vocabulary.ts';

function fakeHost() {
  const h = { l: {}, html: '', addEventListener(t, f) { (this.l[t] ??= []).push(f); }, set innerHTML(v) { this.html = v; }, get innerHTML() { return this.html; },
    querySelector() { return null; } };
  const feuer = (typ, ziel) => { for (const f of h.l[typ] ?? []) f({ target: ziel }); };
  const knopf = (a) => ({ closest: (sel) => (sel === 'button' ? { hasAttribute: (x) => x === a } : null) });
  const auswahl = (value) => ({ closest: (sel) => (sel === 'select.fp-preset' ? { value } : null) });
  return { h, klick: (a) => feuer('click', knopf(a)), waehle: (v) => feuer('change', auswahl(v)) };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('baueKopf: after an apply through the select, forward steps still work (listeners survive the redraw)', async () => {
  const l = presetsFuer(REGISTER, { art: 'bk', graph: 'synth-mono' });
  const { h, klick, waehle } = fakeHost();
  let aktiv = '';
  const angewendet = [], meldungen = [];
  baueKopf(h, { titel: 'T', geraet: { art: 'bk', graph: 'synth-mono' }, register: () => REGISTER, aktiv: () => aktiv,
    anwenden: async (id) => { angewendet.push(id); aktiv = id; return { ok: true, text: 'ok' }; }, sichern: async () => ({ ok: true, text: 's' }), melde: (t, f) => meldungen.push([t, f]) });
  waehle(l[0].id); await tick();
  klick('data-fp-vor'); await tick();
  klick('data-fp-vor'); await tick();
  klick('data-fp-zurueck'); await tick();
  assert.deepEqual(angewendet, [l[0].id, l[1].id, l[2].id, l[1].id]);
  assert.equal(h.l.click.length, 1, 'no listener pile-up');
});

test('baueKopf: SAVE asks for a name and passes it on; an empty name does nothing; a refusal is shown as an error', async () => {
  const { h, klick } = fakeHost();
  const namen = [], meldungen = [];
  let antwort = 'Mine';
  baueKopf(h, { titel: 'T', geraet: { art: 'bk', graph: 'synth-mono' }, register: () => REGISTER, aktiv: () => '', frage: () => antwort,
    anwenden: async () => ({ ok: false, text: 'no' }), sichern: async (n) => { namen.push(n); return { ok: false, text: 'refused' }; }, melde: (t, f) => meldungen.push([t, f]) });
  klick('data-fp-sichern'); await tick();
  antwort = '  ';
  klick('data-fp-sichern'); await tick();
  assert.deepEqual(namen, ['Mine']);
  assert.deepEqual(meldungen, [['refused', true]]);
});

test('standardBeschreibung: drums graph gets drums/kit, synth-mono lead/mono; all pass the real vocabulary check', () => {
  const vok = ladeVokabular();
  for (const [g, art, unter] of [['drums-909', 'drums', 'kit'], ['synth-mono', 'lead', 'mono'], ['pad-x', 'pad', 'atmosphere'], ['bass-1', 'bass', 'sub'], ['unbekannt', 'lead', 'mono']]) {
    const b = standardBeschreibung(g, 'erz/6', vok.inhalt);
    assert.deepEqual([b.art, b.unterart], [art, unter], g);
    assert.deepEqual(pruefeBeschreibung(b, vok), [], g);
  }
  assert.deepEqual(standardBeschreibung('drums-909', 'erz/6', null).art, 'drums');
});

test('baueKopf: LEARN click calls umschalten once, the redrawn button is pressed when an() is true; still one click listener after several redraws', async () => {
  const { h, klick } = fakeHost();
  let an = false, n = 0;
  baueKopf(h, { titel: 'T', geraet: { art: 'bk', graph: 'synth-mono' }, register: () => REGISTER, aktiv: () => '', anwenden: async () => ({ ok: true, text: '' }),
    sichern: async () => ({ ok: true, text: '' }), melde: () => {}, lernen: { an: () => an, umschalten: () => { n++; an = !an; } } });
  assert.match(h.html, /data-fp-lernen/);
  assert.doesNotMatch(h.html, /data-fp-lernen[^>]*aria-pressed="true"/);
  klick('data-fp-lernen');
  assert.equal(n, 1);
  assert.match(h.html, /<button[^>]*data-fp-lernen[^>]*aria-pressed="true"|<button[^>]*aria-pressed="true"[^>]*data-fp-lernen/);
  klick('data-fp-lernen'); klick('data-fp-lernen');
  assert.equal(n, 3);
  assert.equal(h.l.click.length, 1);
});

test('tagVonGraph: lower case, _ to -, cut to 24, always a valid store tag; presetsFuer matches with the same tag', () => {
  assert.equal(tagVonGraph('a_b'), 'a-b');
  const lang = 'abcdefghij_klmnopqrst_uvwxyz_123456';
  const t = tagVonGraph(lang.slice(0, 32));
  assert.equal(t.length, 24);
  assert.ok(TAG.test(t));
  assert.ok(TAG.test(tagVonGraph('a_b')));
  assert.equal(tagVonGraph('_x'), '');
  assert.equal(tagVonGraph(''), '');
  const reg = { eintraege: [eintrag('nutzer', 'baukasten', 'x', 'X', ['a-b']), eintrag('nutzer', 'baukasten', 'y', 'Y', [t])] };
  assert.deepEqual(presetsFuer(reg, { art: 'bk', graph: 'a_b' }).map((p) => p.name), ['X']);
  assert.deepEqual(presetsFuer(reg, { art: 'bk', graph: lang.slice(0, 32) }).map((p) => p.name), ['Y']);
});

test('standardBeschreibung: synth-neuro is a bass, synth-poly a pad, both valid', () => {
  const vok = ladeVokabular();
  for (const [g, art] of [['synth-neuro', 'bass'], ['synth-poly', 'pad']]) {
    const b = standardBeschreibung(g, 'erz/6', vok.inhalt);
    assert.equal(b.art, art, g);
    assert.deepEqual(pruefeBeschreibung(b, vok), [], g);
  }
});

test('baueKopf: neu() redraws the LEARN toggle from the outside state (409 kein_midi_eingang clears the mode)', () => {
  const { h } = fakeHost();
  let an = true;
  const kopf = baueKopf(h, { titel: 'T', geraet: { art: 'bk', graph: 'synth-mono' }, register: () => REGISTER, aktiv: () => '', anwenden: async () => ({ ok: true, text: '' }),
    sichern: async () => ({ ok: true, text: '' }), melde: () => {}, lernen: { an: () => an, umschalten: () => {} } });
  assert.match(h.html, /aria-pressed="true"/);
  an = false;
  kopf.neu();
  assert.match(h.html, /aria-pressed="false"/);
  assert.doesNotMatch(h.html, /aria-pressed="true"/);
});

test('presetsFuer: an rb338 device gets every rb338 entry (no graph tag), factory first, then user', () => {
  const mit = { eintraege: [...REGISTER.eintraege, eintrag('nutzer', 'rb338', 'mein', 'Aaa mine', []), eintrag('werk', 'rb338', 'acid', 'Acid', [])] };
  const l = presetsFuer(mit, { art: 'rb338' });
  assert.deepEqual(l.map((x) => x.id), ['werk:rb338/acid', 'werk:rb338/dark-dub', 'nutzer:rb338/mein']);
  assert.deepEqual(presetsFuer(REGISTER, { art: 'rb338' }).map((x) => x.name), ['Dark Dub']);
});
