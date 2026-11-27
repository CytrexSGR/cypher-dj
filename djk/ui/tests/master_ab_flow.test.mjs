// State machine of the master A/B (areas/proj/master_ab.ts) with fake deps: no server, no render, no core.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MasterAB } from '../areas/proj/master_ab.ts';
import { ProjFehler } from '../areas/proj/session.ts';
import { alsAntwort } from '../areas/proj/output.ts';

const stufe = (art, slot, an) => ({ id: `i${art}${slot}`, art, slot, an, werte: {} });
const projekt = (rev = 3) => ({ rev, master: { fader_db: -2, inserts: [stufe('eq', 1, true), stufe('lim', 1, false)] } });

// a harness: the open project is `h.o`, every sent batch lands in `h.gesendet`
function bau(opt = {}) {
  const h = { o: { slug: 'p', projekt: projekt() }, gesendet: [], schliess: [], stand: [], neustart: [], render: 0, timer: [], log: [] };
  h.zugang = {
    offen: () => h.o,
    hoereMaster: async (zeilen, quelle) => {
      if (opt.hoereFehlt) throw new ProjFehler(409, 'regler_abgelehnt');
      h.gesendet.push({ zeilen: zeilen.map((z) => [z.pfad, z.wert]), quelle });
    },
    beiSchliessen: (f) => h.schliess.push(f),
    beiStand: (f) => h.stand.push(f),
    beiNeustart: (f) => h.neustart.push(f),
  };
  h.ausgabe = {
    analyseVorpruefung: (d) => ({ slug: h.o.slug, rev: h.o.projekt.rev, von: d.von_beat ?? 0, bis: d.bis_beat ?? 16, tempo_bpm: 120 }),
    rendereMasterAB: async () => {
      h.render++;
      if (opt.renderFehlt) throw new ProjFehler(409, 'render_fehler');
      if (opt.waehrendRender) opt.waehrendRender(h);
      return { rev: opt.revRender ?? h.o.projekt.rev, a: { lufs_i: opt.aLufs === undefined ? -9.0 : opt.aLufs }, b: { lufs_i: opt.bLufs ?? -13.8 } };
    },
  };
  h.marke = { datei: null, schreibe: (slug, pfade) => { h.marke.datei = { slug, pfade }; h.marke.vorSenden = h.gesendet.length; },
    loesche: () => { h.marke.datei = null; } };
  h.ab = new MasterAB({ ausgabe: h.ausgabe, zugang: h.zugang, marke: h.marke, quelle: () => 'andreas', log: (z) => h.log.push(z),
    setzeTimer: (f, ms) => { const t = { f, ms }; h.timer.push(t); return t; }, loescheTimer: (t) => { t.weg = true; } });
  return h;
}
const projektZeilen = [['ins/eq/1/an', 1], ['ins/lim/1/an', 0], ['pm/fader', -2]];

test('on: renders once, sends the rows of side A with the cut once, state an', async () => {
  const h = bau();
  const s = await h.ab.steuere({ an: true });
  assert.equal(h.render, 1);
  assert.deepEqual(h.gesendet.map((g) => g.zeilen), [[['ins/eq/1/an', 1], ['ins/lim/1/an', 0], ['pm/fader', -6.8]]]);
  assert.deepEqual([s.an, s.seite, s.zustand, s.leiser, s.ausgleich_db, s.a_lufs, s.b_lufs, s.rev], [true, 'a', 'an', 'a', 4.8, -9, -13.8, 3]);
  assert.match(s.text, /A: processed, turned down 4\.8 dB to match B/);
  assert.deepEqual(h.ab.lage(), s);
});

test('seite b: every stage off, the fader at the project value; seite a again', async () => {
  const h = bau();
  await h.ab.steuere({ an: true });
  const s = await h.ab.steuere({ seite: 'b' });
  assert.deepEqual(h.gesendet.at(-1).zeilen, [['ins/eq/1/an', 0], ['ins/lim/1/an', 0], ['pm/fader', -2]]);
  assert.deepEqual([s.seite, s.zustand], ['b', 'an']);
  assert.match(s.text, /B: master stages bypassed, at project level/);
  await h.ab.steuere({ seite: 'a' });
  assert.deepEqual(h.gesendet.at(-1).zeilen, [['ins/eq/1/an', 1], ['ins/lim/1/an', 0], ['pm/fader', -6.8]]);
});

test('seite without a running A/B is refused', async () => {
  const h = bau();
  await assert.rejects(h.ab.steuere({ seite: 'b' }), (e) => e.grund === 'ab_nicht_an');
  assert.equal(h.gesendet.length, 0);
});

test('project revision changed: seite is refused with ab_veraltet and the project rows are sent', async () => {
  const h = bau();
  await h.ab.steuere({ an: true });
  h.o = { slug: 'p', projekt: projekt(4) };
  assert.equal(h.ab.lage().zustand, 'veraltet');
  await assert.rejects(h.ab.steuere({ seite: 'b' }), (e) => e.grund === 'ab_veraltet' && alsAntwort(e).code === 409);
  assert.deepEqual(h.gesendet.at(-1).zeilen, projektZeilen);
  assert.deepEqual([h.ab.lage().an, h.ab.lage().zustand], [false, 'aus']);
});

test('off: the project rows are sent (own switches, own fader), state aus', async () => {
  const h = bau();
  await h.ab.steuere({ an: true });
  await h.ab.steuere({ seite: 'b' });
  const s = await h.ab.steuere({ an: false });
  assert.deepEqual(h.gesendet.at(-1).zeilen, projektZeilen);
  assert.deepEqual([s.an, s.seite, s.zustand], [false, null, 'aus']);
});

test('a project change while on (stand hook) restores the rows of the new project at once', async () => {
  const h = bau();
  await h.ab.steuere({ an: true });
  await h.ab.steuere({ seite: 'b' });
  h.o = { slug: 'p', projekt: { rev: 4, master: { fader_db: -1, inserts: [stufe('eq', 1, false)] } } };
  for (const f of h.stand) f(h.o.projekt);
  await new Promise((ok) => setImmediate(ok));
  assert.deepEqual(h.gesendet.at(-1).zeilen, [['ins/eq/1/an', 0], ['pm/fader', -1]]);
  assert.equal(h.ab.lage().zustand, 'aus');
});

test('project close while on: the rows of the closing project are restored, state aus', async () => {
  const h = bau();
  await h.ab.steuere({ an: true });
  await h.ab.steuere({ seite: 'b' });
  for (const f of h.schliess) f('p');
  await new Promise((ok) => setImmediate(ok));
  assert.deepEqual(h.gesendet.at(-1).zeilen, projektZeilen);
  assert.equal(h.ab.lage().zustand, 'aus');
});

test('a stand hook with the same revision does nothing (A/B itself writes no project)', async () => {
  const h = bau();
  await h.ab.steuere({ an: true });
  const n = h.gesendet.length;
  for (const f of h.stand) f(h.o.projekt);
  await new Promise((ok) => setImmediate(ok));
  assert.equal(h.gesendet.length, n);
  assert.equal(h.ab.lage().zustand, 'an');
});

test('idle end: without a request the rows are restored', async () => {
  const h = bau();
  await h.ab.steuere({ an: true });
  const t = h.timer.filter((x) => !x.weg).at(-1);
  assert.ok(t, 'a timer is armed while on');
  t.f();
  await new Promise((ok) => setImmediate(ok));
  assert.deepEqual(h.gesendet.at(-1).zeilen, projektZeilen);
  assert.equal(h.ab.lage().zustand, 'aus');
});

test('render error: state fehler with the text, no rows sent, the error passes through', async () => {
  const h = bau({ renderFehlt: true });
  await assert.rejects(h.ab.steuere({ an: true }), (e) => e.grund === 'render_fehler');
  assert.equal(h.gesendet.length, 0);
  const s = h.ab.lage();
  assert.deepEqual([s.an, s.zustand], [false, 'fehler']);
  assert.ok(s.text.length > 0);
});

test('the project changed during the measurement: ab_veraltet, nothing sent', async () => {
  const h = bau({ waehrendRender: (x) => { x.o = { slug: 'p', projekt: projekt(9) }; }, revRender: 3 });
  await assert.rejects(h.ab.steuere({ an: true }), (e) => e.grund === 'ab_veraltet');
  assert.equal(h.gesendet.length, 0);
  assert.equal(h.ab.lage().zustand, 'aus');
});

test('hoereMaster refusing: the error passes through, a restore is tried, state is not on', async () => {
  const h = bau({ hoereFehlt: true });
  await assert.rejects(h.ab.steuere({ an: true }), (e) => e.grund === 'regler_abgelehnt');
  assert.deepEqual([h.ab.lage().an, h.ab.lage().zustand], [false, 'fehler']);
});

test('refusals: no project, no stage, master fader lane, already measuring, unknown field', async () => {
  const h = bau();
  h.o = null;
  await assert.rejects(h.ab.steuere({ an: true }), (e) => e.grund === 'kein_projekt' && alsAntwort(e).code === 409);
  h.o = { slug: 'p', projekt: { rev: 1, master: { fader_db: 0 } } };
  await assert.rejects(h.ab.steuere({ an: true }), (e) => e.grund === 'keine_stufe' && alsAntwort(e).code === 409);
  h.o = { slug: 'p', projekt: { rev: 1, master: { fader_db: 0, inserts: [stufe('eq', 1, true)], automation: [{ id: 'l', ziel: 'fader', punkte: [] }] } } };
  await assert.rejects(h.ab.steuere({ an: true }), (e) => e.grund === 'master_lane' && alsAntwort(e).code === 409);
  h.o = { slug: 'p', projekt: projekt() };
  await assert.rejects(h.ab.steuere({ gibtsnicht: 1 }), (e) => e.grund === 'argument_ungueltig');
  await assert.rejects(h.ab.steuere({}), (e) => e.grund === 'argument_ungueltig');
  let frei;
  h.ausgabe.rendereMasterAB = () => new Promise((ok) => { frei = () => ok({ rev: 3, a: { lufs_i: -9 }, b: { lufs_i: -9 } }); });
  const lauf = h.ab.steuere({ an: true });
  await new Promise((ok) => setImmediate(ok));
  assert.equal(h.ab.lage().zustand, 'misst');
  await assert.rejects(h.ab.steuere({ an: true }), (e) => e.grund === 'beschaeftigt');
  frei(); await lauf;
  assert.equal(h.ab.lage().zustand, 'an');
});

test('marker: written before the first row is sent, with the rows and the project, gone after every ending path', async () => {
  const pfade = ['ins/eq/1/an', 'ins/lim/1/an', 'pm/fader'];
  const wege = {
    off: (h) => h.ab.steuere({ an: false }),
    'stale seite': async (h) => { h.o = { slug: 'p', projekt: projekt(4) }; await h.ab.steuere({ seite: 'b' }).catch(() => {}); },
    'stand hook': async (h) => { h.o = { slug: 'p', projekt: projekt(4) }; for (const f of h.stand) f(h.o.projekt); },
    'close hook': async (h) => { for (const f of h.schliess) f('p'); },
    idle: async (h) => { h.timer.filter((x) => !x.weg).at(-1).f(); },
  };
  for (const [name, weg] of Object.entries(wege)) {
    const h = bau();
    await h.ab.steuere({ an: true });
    assert.deepEqual(h.marke.datei, { slug: 'p', pfade }, name);
    assert.equal(h.marke.vorSenden, 0, `${name}: written before the first row was sent`);
    await weg(h);
    await new Promise((ok) => setImmediate(ok));
    assert.equal(h.marke.datei, null, `${name}: marker removed`);
  }
});

test('marker: no marker after a render error; it stays when the rows cannot be put back', async () => {
  const r = bau({ renderFehlt: true });
  await assert.rejects(r.ab.steuere({ an: true }));
  assert.equal(r.marke.datei, null);
  const h = bau({ hoereFehlt: true });
  await assert.rejects(h.ab.steuere({ an: true }));
  assert.ok(h.marke.datei, 'the restore failed too: a restart must still put the rows back');
});

test('a side without loudness or a difference over 24 dB: still on, but not level-matched and the text says so', async () => {
  let h = bau({ aLufs: null });
  let s = await h.ab.steuere({ an: true });
  assert.equal(s.zustand, 'an'); assert.equal(s.abgeglichen, false);
  assert.match(s.text, /^not level-matched: the loop range is silent/);
  h = bau({ aLufs: -5, bLufs: -40 });
  s = await h.ab.steuere({ an: true });
  assert.equal(s.abgeglichen, false);
  assert.match(s.text, /^not level-matched: the difference is over 24 dB/);
  assert.equal((await bau().ab.steuere({ an: true })).abgeglichen, true);
  assert.equal(h.ab.lage().abgeglichen, false);
  await h.ab.steuere({ an: false });
  assert.equal(h.ab.lage().abgeglichen, true);
});

test('core restart while on: A/B ends with the text, no rows are sent, the marker is gone', async () => {
  const h = bau();
  await h.ab.steuere({ an: true });
  const n = h.gesendet.length;
  assert.ok(h.marke.datei);
  h.neustart.forEach((f) => f());
  const s = h.ab.lage();
  assert.equal(s.zustand, 'aus'); assert.equal(s.an, false);
  assert.equal(s.text, 'A/B ended: the audio engine restarted');
  assert.equal(h.gesendet.length, n, 'no rows are sent back');
  assert.equal(h.marke.datei, null);
  h.neustart.forEach((f) => f());   // off: nothing happens
  assert.equal(h.ab.lage().text, 'A/B ended: the audio engine restarted');
});
