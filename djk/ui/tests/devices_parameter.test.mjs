// Panels task 5: parameter tables per device kind and the automatic panel.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parameterTabelle, autoPanel, geraetePanel, anzeigeWert, pfadeVon } from '../devices_parameter.ts';
import { pruefePanel, reglerBereiche } from '../graphs.ts';
import { REPO } from '../paths.ts';

const BEISPIELE = path.join(REPO, 'djk', 'instruments', 'modular_dsp', 'demos');
const mitOrdner = (dir, f) => { const alt = process.env.CYPHERDJ_BK_ORDNER; process.env.CYPHERDJ_BK_ORDNER = dir; try { return f(); } finally { if (alt === undefined) delete process.env.CYPHERDJ_BK_ORDNER; else process.env.CYPHERDJ_BK_ORDNER = alt; } };
const graphMitKnobs = (n, extra = {}) => ({ format: 'baukasten/2', name: 'g', stimmen: 1, regler_namen: { 1: 'Cutoff' },
  knoten: [{ id: 'o', art: 'ausgang' }, ...Array.from({ length: n }, (_, i) => ({ id: `k${i + 1}`, art: 'regler', nr: i + 1, min: 0, max: 1 }))], kanten: [], ...extra });
function ordner(graphen) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-'));
  for (const [n, g] of Object.entries(graphen)) fs.writeFileSync(path.join(dir, `${n}.json`), JSON.stringify(g));
  return dir;
}

test('rb338: the seven #[id] names of lib.rs in file order', () => {
  const src = fs.readFileSync(path.join(REPO, 'djk', 'instruments', 'rb338', 'src', 'lib.rs'), 'utf8');
  const ids = [...src.matchAll(/#\[id = "([^"]+)"\]/g)].map((m) => m[1]);
  assert.equal(ids.length, 7);
  assert.deepEqual(parameterTabelle({ art: 'rb338' }).map((p) => p.name), ids);
});

test('surge: every key of surge_bereiche.json', () => {
  const t = parameterTabelle({ art: 'surge' });
  assert.equal(t.length, 359);
  assert.ok(t.every((p) => p.label && p.max >= p.min && p.vorgabe >= 0 && p.vorgabe <= 1));
});

test('bk: k<n> in knob order, labels from regler_namen with the Knob n fallback; unknown graph gives []', () => {
  const dir = ordner({ g: graphMitKnobs(3) });
  mitOrdner(dir, () => {
    const t = parameterTabelle({ art: 'bk', graph: 'g' });
    assert.deepEqual(t.map((p) => [p.name, p.label]), [['k1', 'Cutoff'], ['k2', 'Knob 2'], ['k3', 'Knob 3']]);
    assert.deepEqual(parameterTabelle({ art: 'bk', graph: 'gibt-es-nicht' }), []);
  });
});

test('auto panel of a 20-knob graph: sections of 8, 8, 4, passes pruefePanel', () => {
  const dir = ordner({ g20: graphMitKnobs(20) });
  mitOrdner(dir, () => {
    const geraet = { art: 'bk', graph: 'g20' };
    const p = autoPanel(geraet, parameterTabelle(geraet), 'G20');
    assert.deepEqual(p.sections.map((s) => s.controls.length), [8, 8, 4]);
    assert.equal(p.sections[0].title, 'KNOBS 1-8');
    assert.deepEqual(pruefePanel(p, 'g20', reglerBereiche(JSON.parse(fs.readFileSync(path.join(dir, 'g20.json'), 'utf8')))), []);
  });
});

test('a parameter with stufen becomes a selector; accent by family', () => {
  const p = autoPanel({ art: 'rb338' }, parameterTabelle({ art: 'rb338' }), 'RB-338');
  const w = p.sections[0].controls.find((c) => c.bind.param === 'wellenform');
  assert.equal(w.type, 'selector');
  assert.deepEqual(w.options, ['Saw', 'Square']);
  assert.equal(p.akzent, 'gelb');
  assert.equal(autoPanel({ art: 'surge' }, parameterTabelle({ art: 'surge' }), 'Surge').akzent, 'gruen');
  const dir = ordner({ 'drums-x': graphMitKnobs(1), 'synth-neuro': graphMitKnobs(1), 'fx-x': graphMitKnobs(1), lead: graphMitKnobs(1),
    eff: graphMitKnobs(1, { knoten: [{ id: 'e', art: 'eingang' }, { id: 'k', art: 'regler', nr: 1, min: 0, max: 1 }] }) });
  mitOrdner(dir, () => {
    const a = (graph) => autoPanel({ art: 'bk', graph }, [], 'x').akzent;
    assert.deepEqual(['drums-x', 'synth-neuro', 'fx-x', 'lead', 'eff'].map(a), ['rot', 'violett', 'tuerkis', 'orange', 'tuerkis']);
  });
});

test('a broken panel file answers quelle auto with the file problems in fehler', () => {
  const dir = ordner({ g: graphMitKnobs(2) });
  fs.mkdirSync(path.join(dir, 'panels'));
  fs.writeFileSync(path.join(dir, 'panels', 'g.json'), '{ kaputt');
  mitOrdner(dir, () => {
    const r = geraetePanel({ art: 'bk', graph: 'g' });
    assert.equal(r.quelle, 'auto');
    assert.match(r.fehler[0], /not valid JSON/);
    assert.equal(r.panel.sections[0].controls.length, 2);
    assert.equal(r.parameter.length, 2);
  });
});

test('every shipped graph with regler nodes gets an auto panel that passes pruefePanel (79)', () => {
  mitOrdner(BEISPIELE, () => {
    let n = 0;
    for (const d of fs.readdirSync(BEISPIELE).filter((x) => x.endsWith('.json'))) {
      const name = d.slice(0, -5);
      const regler = reglerBereiche(JSON.parse(fs.readFileSync(path.join(BEISPIELE, d), 'utf8')));
      if (!Object.keys(regler).length) continue;
      const g = { art: 'bk', graph: name };
      const p = autoPanel(g, parameterTabelle(g), name);
      assert.deepEqual(pruefePanel(p, name, regler), [], name);
      n++;
    }
    assert.equal(n, 79);
  });
});

test('rb338 table: defaults and display mapping come from rb_abbildung (volume default -12 dB, cutoff at 0.5 is 350 Hz)', () => {
  const t = Object.fromEntries(parameterTabelle({ art: 'rb338' }).map((p) => [p.name, p]));
  assert.ok(Math.abs(anzeigeWert(t.lautstaerke, t.lautstaerke.vorgabe) + 12) < 1e-6, 'volume default displays -12 dB');
  assert.ok(Math.abs(anzeigeWert(t.cutoff, 0.5) - 350) <= 1, 'cutoff at 0.5 displays 350 Hz');
  assert.ok(Math.abs(anzeigeWert(t.cutoff, t.cutoff.vorgabe) - 800) < 1e-6);
  assert.ok(Math.abs(anzeigeWert(t.decay, t.decay.vorgabe) - 0.6) < 1e-9);
  assert.equal(anzeigeWert(t.lautstaerke, 1), 0);
  assert.ok(Math.abs(anzeigeWert(t.lautstaerke, 0) + 48) < 1e-6);
  assert.equal(anzeigeWert({ name: 'x', label: 'x', min: 20, max: 20000, log: true, vorgabe: 0.5 }, 0.5).toFixed(3), '632.456', 'log without skew is geometric');
  // the shipped hand panel starts every knob where the plug-in does
  const panel = JSON.parse(fs.readFileSync(path.join(pfadeVon().paneele, 'rb338.json'), 'utf8'));
  for (const c of panel.sections.flatMap((s) => s.controls)) {
    const p = t[c.bind.param];
    const erwartet = p.stufen ? Math.round(p.vorgabe * (p.stufen.length - 1)) : p.vorgabe;
    assert.ok(Math.abs(c.default - erwartet) < 1e-3, `${c.bind.param}: default ${c.default} vs ${erwartet}`);
  }
});

test('geraetePanel serves the hand panels of rb338 and surge (quelle datei) and falls back to auto when the file is missing or invalid', () => {
  const dir = ordner({});
  fs.mkdirSync(path.join(dir, 'panels'));
  mitOrdner(dir, () => {
    for (const art of ['rb338', 'surge']) {
      const leer = geraetePanel({ art });
      assert.equal(leer.quelle, 'auto', `${art}: no file`);
      assert.deepEqual(leer.fehler, []);
      fs.copyFileSync(path.join(pfadeVon().paneele, `${art}.json`), path.join(dir, 'panels', `${art}.json`));
      const r = geraetePanel({ art });
      assert.equal(r.quelle, 'datei', art);
      assert.equal(r.panel.akzent, art === 'rb338' ? 'gelb' : 'gruen');
      assert.deepEqual(r.fehler, []);
    }
    const kaputt = JSON.parse(fs.readFileSync(path.join(dir, 'panels', 'rb338.json'), 'utf8'));
    kaputt.sections[0].controls[0].bind = { param: 'nope' };
    fs.writeFileSync(path.join(dir, 'panels', 'rb338.json'), JSON.stringify(kaputt));
    const k = geraetePanel({ art: 'rb338' });
    assert.equal(k.quelle, 'auto');
    assert.match(k.fehler[0], /parameter nope is not defined by the device/);
    fs.writeFileSync(path.join(dir, 'panels', 'rb338.json'), JSON.stringify({ ...kaputt, geraet: { art: 'surge' }, sections: JSON.parse(fs.readFileSync(path.join(pfadeVon().paneele, 'rb338.json'), 'utf8')).sections }));
    assert.match(geraetePanel({ art: 'rb338' }).fehler.join('|'), /belongs to "rb338"/);
    fs.writeFileSync(path.join(dir, 'panels', 'rb338.json'), '{ kaputt');
    assert.match(geraetePanel({ art: 'rb338' }).fehler[0], /not valid JSON/);
  });
});

test('RB338_PARAM_NAMEN (the one source for the server) are the FloatParam/BoolParam names of lib.rs', async () => {
  const { RB338_PARAM_NAMEN } = await import('../devices_parameter.ts');
  const src = fs.readFileSync(path.join(REPO, 'djk', 'instruments', 'rb338', 'src', 'lib.rs'), 'utf8');
  const namen = [...src.matchAll(/(?:FloatParam|BoolParam)::new\("([^"]+)"/g)].map((m) => m[1]);
  assert.equal(namen.length, 7);
  assert.deepEqual([...RB338_PARAM_NAMEN].sort(), namen.sort());
});
