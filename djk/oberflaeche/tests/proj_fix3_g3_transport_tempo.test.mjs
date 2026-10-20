// D1 S2-Integration, dritte Fix-Runde G3 (Spec 6.32): Ein Freeze ist ein Transport-Lauf; Start, Laden und eine Tempo-Rampe brechen ihn ab oder
// verändern die Datei. Während der Freeze-Sperre antworten der Transport-Start über /proj und POST /tempo (Studio-Route und Werkzeug tempo) mit
// 409 beschaeftigt, ohne /k/arr/start und ohne /k/tempo/rampe. Stopp bleibt erlaubt (bricht den Freeze bewusst ab).
// Beleg vorher: Spec-Re-Review W4 (Start unter Sperre schickt /k/tempo/rampe, tempo_rampe_unter_sperre 1).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { projBereich } from '../bereiche/proj/bereich.ts';
import { pruefKontext, warteBis } from './hilfen/proj_kontext.mjs';
import { tmpOrdner } from './hilfen/projekt.mjs';
import { stapel } from './hilfen/mediathek.mjs';
import { ruf, CYPHER, anKern } from './hilfen/proj_stapel.mjs';

function aufbau(t, opt = {}) {
  const k = pruefKontext();
  const d = tmpOrdner(t, 'djk-g3-');
  const b = projBereich(k, { wurzel: path.join(d, 'projekte'), arbeitsordner: path.join(d, 'arr'), arrFristMs: 30, ...opt });
  t.after(() => b.sitzung.schliesse());
  return { k, b, s: b.sitzung };
}
const n = (e, a) => e.k.an(a).length;
const ergebnis = async (p) => { try { const r = await p; return { code: r.code, j: r.j }; } catch (x) { return { code: x.code, fehler: x.fehler, text: x.extra?.text }; } };

for (const mitSperre of [true, false]) {
  test(`G3/W4 /proj/transport start bei abweichendem Master-Tempo (mitSperre=${mitSperre})`, async (t) => {
    const e = aufbau(t, { uhrStillMs: 100 });
    await e.s.neu('Eins', 'andreas');            // Projekttempo 120
    e.s.ereignis('/uhr', { beat: 2, bpm: 128 });
    e.k.leere();
    const frei = mitSperre ? e.b.zugang.sperreLaden() : () => {};
    const r = await ergebnis(e.s.transport({ aktion: 'start' }, 'andreas'));
    const m = { mitSperre, code: r.code, fehler: r.fehler ?? r.j?.tempo?.fehler, rampe: n(e, '/k/tempo/rampe'), start: n(e, '/k/arr/start') };
    frei();
    console.log(`G3 W4 ${JSON.stringify(m)}`);
    if (mitSperre) {
      assert.deepEqual([m.code, m.fehler], [409, 'beschaeftigt']);
      assert.match(r.text, /freeze/);
      assert.deepEqual([m.rampe, m.start], [0, 0], 'weder /k/tempo/rampe noch /k/arr/start unter der Sperre');
    } else {
      assert.equal(m.rampe, 1, 'Negativ-Kontrolle: ohne Sperre geht die Rampe');
      assert.equal(m.code, 503, 'die Uhr steht (kein Kern), das Warten bricht wie bisher ab');
    }
  });
}

for (const mitSperre of [true, false]) {
  test(`G3 /proj/transport start bei gleichem Tempo (mitSperre=${mitSperre}): gesperrt 409 ohne Start, sonst 200 mit 1x /k/arr/start`, async (t) => {
    const e = aufbau(t);
    await e.s.neu('Eins', 'andreas');
    e.s.ereignis('/uhr', { beat: 2, bpm: 120 });
    e.k.leere();
    const frei = mitSperre ? e.b.zugang.sperreLaden() : () => {};
    const r = await ergebnis(e.s.transport({ aktion: 'start', beat: 4 }, 'andreas'));
    const m = { mitSperre, code: r.code, fehler: r.fehler, start: n(e, '/k/arr/start'), rampe: n(e, '/k/tempo/rampe') };
    frei();
    console.log(`G3 start ${JSON.stringify(m)}`);
    assert.deepEqual(m, mitSperre ? { mitSperre, code: 409, fehler: 'beschaeftigt', start: 0, rampe: 0 }
      : { mitSperre, code: 200, fehler: undefined, start: 1, rampe: 0 });
  });
}

test('G3 Sperre kommt, während der Start auf das Rampen-Ende wartet: 409 beschaeftigt, kein /k/arr/start', async (t) => {
  const e = aufbau(t, { uhrStillMs: 2000 });
  await e.s.neu('Eins', 'andreas');
  e.s.ereignis('/uhr', { beat: 2, bpm: 128 });
  e.k.leere();
  const p = ergebnis(e.s.transport({ aktion: 'start' }, 'andreas'));
  assert.ok(await warteBis(() => n(e, '/k/tempo/rampe') > 0, 1000), 'Rampe gesendet');
  const frei = e.b.zugang.sperreLaden();
  const ende = e.k.an('/k/tempo/rampe')[0].felder;
  e.s.ereignis('/uhr', { beat: ende.ab_beat + ende.dauer_beats + 1, bpm: 120 });   // Rampe fertig
  const r = await p;
  const m = { code: r.code, fehler: r.fehler, start: n(e, '/k/arr/start') };
  frei();
  console.log(`G3 Sperre während der Rampe ${JSON.stringify(m)}`);
  assert.deepEqual(m, { code: 409, fehler: 'beschaeftigt', start: 0 });
});

test('G3 Stopp bleibt während der Sperre erlaubt: 200, 1x /k/arr/stopp', async (t) => {
  const e = aufbau(t);
  await e.s.neu('Eins', 'andreas');
  e.k.leere();
  const frei = e.b.zugang.sperreLaden();
  const r = await ergebnis(e.s.transport({ aktion: 'stopp' }, 'andreas'));
  const m = { code: r.code, stopp: n(e, '/k/arr/stopp') };
  frei();
  assert.deepEqual(m, { code: 200, stopp: 1 });
});

// POST /tempo des Seiten-Servers (Studio-Route; das Werkzeug tempo von djk-hand ruft genau sie). Stapel mit Kern-Attrappe (Prüfinstanz).
test('G3 POST /tempo während der Sperre: 409 beschaeftigt in der Fehlerform der Route, kein /k/tempo/rampe; nach der Freigabe 200', async (t) => {
  const { o, log, url } = await stapel(t);
  const zugang = o.proj.zugang;
  const frei = zugang.sperreLaden();
  const a = await ruf(url, 'POST', '/tempo', { bpm: 130 });
  const c = await ruf(url, 'POST', '/tempo', { bpm: 131 }, CYPHER);
  const unter = anKern(log, '/k/tempo/rampe').length;
  frei();
  const b = await ruf(url, 'POST', '/tempo', { bpm: 132 });
  const nach = anKern(log, '/k/tempo/rampe').length;
  console.log(`G3 POST /tempo ${JSON.stringify({ andreas: [a.code, a.j], cypher: [c.code, c.j.fehler], unter, frei: [b.code, b.j.ok], nach })}`);
  assert.equal(a.code, 409); assert.equal(a.j.fehler, 'beschaeftigt'); assert.match(a.j.text, /freeze/);
  assert.deepEqual([c.code, c.j.fehler], [409, 'beschaeftigt'], 'auch für Cypher (Werkzeug tempo)');
  assert.equal(unter, 0, 'kein /k/tempo/rampe unter der Sperre');
  assert.deepEqual([b.code, b.j.ok, nach], [200, true, 1], 'Negativ-Kontrolle: nach der Freigabe genau eine Rampe');
});
