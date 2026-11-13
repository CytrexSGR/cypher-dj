// Devices task 7: `device.ts pruefen` and `device.ts neu`, run as the real command on the repo and on temp copies (--wurzel).
import baseTest from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO, HIER } from '../paths.ts';
import { pfadeVon } from '../devices_parameter.ts';
import { OHNE_DOKU } from './support/devices_doku.mjs';

const test = (name, fn) => baseTest(name, { skip: OHNE_DOKU }, fn);   // the tool checks the register against the device documents

const TOOL = path.join(HIER, 'tool', 'device.ts');
const lauf = (...args) => spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8', cwd: HIER });

/** A copy of the parts of the repo the tool reads: graphs, panels, register, docs, factory presets. */
function kopie() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geraet-'));
  const von = pfadeVon(REPO), nach = pfadeVon(dir);
  fs.mkdirSync(nach.bk, { recursive: true });
  for (const sub of ['demos', 'paneele']) fs.cpSync(path.join(von.bk, sub), path.join(nach.bk, sub), { recursive: true });
  fs.copyFileSync(von.register, nach.register);
  fs.copyFileSync(von.kategorien, nach.kategorien);
  fs.cpSync(von.doku, nach.doku, { recursive: true });
  fs.cpSync(von.werkPresets, nach.werkPresets, { recursive: true });
  fs.mkdirSync(path.dirname(nach.surge), { recursive: true }); fs.copyFileSync(von.surge, nach.surge);
  return { dir, P: nach };
}

test('pruefen on the repo exits 0', () => {
  const r = lauf('pruefen');
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('pruefen on a copy without paneele/synth-poly.json exits 1 and names it', () => {
  const { dir, P } = kopie();
  try {
    assert.equal(lauf('pruefen', '--wurzel', dir).status, 0, 'positive control: the copy is complete');
    fs.rmSync(path.join(P.paneele, 'synth-poly.json'));
    const r = lauf('pruefen', '--wurzel', dir);
    assert.equal(r.status, 1);
    assert.ok(r.stdout.split('\n').includes('synth-poly: no panel'), r.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('pruefen reports a doc missing, a panel binding an unknown parameter, a preset of a missing graph and a preset with a knob too many', () => {
  const { dir, P } = kopie();
  try {
    fs.rmSync(path.join(P.doku, 'GERAET-drums-909.md'));
    const pf = path.join(P.paneele, 'synth-mono.json');
    const panel = JSON.parse(fs.readFileSync(pf, 'utf8')); panel.sections[0].controls[0].bind = { param: 'k99' };
    fs.writeFileSync(pf, JSON.stringify(panel));
    const preset = fs.readdirSync(P.werkPresets).find((d) => d.startsWith('fx-') ) ?? fs.readdirSync(P.werkPresets)[0];
    const pp = path.join(P.werkPresets, preset);
    const p = JSON.parse(fs.readFileSync(pp, 'utf8')); p.graph = 'gibt-es-nicht';
    fs.writeFileSync(path.join(P.werkPresets, 'x-fehlt.preset.json'), JSON.stringify(p));
    const q = JSON.parse(fs.readFileSync(path.join(P.werkPresets, 'drums-808-trap.preset.json'), 'utf8')); q.graph = 'fx-filter-regler'; q.werte = { knob1: 0.5, knob5: 0.5 };
    fs.writeFileSync(path.join(P.werkPresets, 'x-zuviel.preset.json'), JSON.stringify(q));
    const r = lauf('pruefen', '--wurzel', dir);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^drums-909: no doc file/m);
    assert.match(r.stdout, /^synth-mono: panel: control "[^"]*": parameter k99 is not defined by the device$/m);
    assert.match(r.stdout, /^preset x-fehlt\.preset\.json: graph "gibt-es-nicht" does not exist$/m);
    assert.match(r.stdout, /^preset x-zuviel\.preset\.json: knob5 is no knob of graph fx-filter-regler \(it has 1,2\)$/m);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('pruefen reports an instrument graph without a category; neu copies the category with "Copy of" and fails clean', () => {
  const { dir, P } = kopie();
  try {
    const kat = JSON.parse(fs.readFileSync(P.kategorien, 'utf8'));
    delete kat['synth-mono'];
    kat['drums-808'].kategorie = 'blech';
    kat['drums-909'].text = 'x'.repeat(91);
    fs.writeFileSync(P.kategorien, JSON.stringify(kat));
    const r = lauf('pruefen', '--wurzel', dir);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /^synth-mono: instrument graph without a category in kategorien\.json$/m);
    assert.match(r.stdout, /^kategorien\.json: drums-808: kategorie must be one of /m);
    assert.match(r.stdout, /^kategorien\.json: drums-909: text must be 1\.\.90 characters$/m);
    fs.rmSync(P.kategorien);
    assert.match(lauf('pruefen', '--wurzel', dir).stdout, /kategorien\.json is missing/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const k = kopie();
  try {
    const n = lauf('neu', 'test-geraet', '--von', 'synth-mono', '--wurzel', k.dir);
    assert.equal(n.status, 0, n.stdout + n.stderr);
    const kat = JSON.parse(fs.readFileSync(k.P.kategorien, 'utf8'));
    assert.equal(kat['test-geraet'].kategorie, kat['synth-mono'].kategorie);
    assert.ok(kat['test-geraet'].text.startsWith('Copy of synth-mono: ') && kat['test-geraet'].text.length <= 90, kat['test-geraet'].text);
    assert.equal(Object.keys(kat).length, 54);
  } finally { fs.rmSync(k.dir, { recursive: true, force: true }); }
});

test('neu test-geraet --von synth-mono writes graph, panel, doc and register entry; pruefen then exits 0; refusals', () => {
  const { dir, P } = kopie();
  try {
    const r = lauf('neu', 'test-geraet', '--von', 'synth-mono', '--wurzel', dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const quelle = JSON.parse(fs.readFileSync(path.join(P.beispiele, 'synth-mono.json'), 'utf8'));
    const graph = JSON.parse(fs.readFileSync(path.join(P.beispiele, 'test-geraet.json'), 'utf8'));
    assert.deepEqual({ ...graph, name: quelle.name }, quelle, 'the graph is a copy but for its name');
    const panel = JSON.parse(fs.readFileSync(path.join(P.paneele, 'test-geraet.json'), 'utf8'));
    assert.equal(panel.format, 'cypherdj-panel/2');
    assert.deepEqual(panel.geraet, { art: 'bk', graph: 'test-geraet' });
    assert.equal(panel.title, 'test-geraet');
    assert.equal(panel.akzent, 'orange', 'family and accent come from the register entry of the source');
    const doc = fs.readFileSync(path.join(P.doku, 'GERAET-test-geraet.md'), 'utf8');
    assert.match(doc, /^# GERAET-test-geraet/);
    assert.match(doc, /\| Cutoff \| `k1` \|/, 'the knob map is generated from the panel');
    const reg = JSON.parse(fs.readFileSync(P.register, 'utf8'));
    assert.deepEqual(reg.at(-1), { name: 'test-geraet', art: 'bk', familie: 'mono', akzent: 'orange', doku: 'docs/presets/devices/GERAET-test-geraet.md' });
    const p = lauf('pruefen', '--wurzel', dir);
    assert.equal(p.status, 0, p.stdout);
    // --familie overrides family and accent
    const f = lauf('neu', 'test-fx', '--von', 'fx-filter-regler', '--familie', 'neuro', '--wurzel', dir);
    assert.equal(f.status, 0, f.stderr);
    assert.equal(JSON.parse(fs.readFileSync(P.register, 'utf8')).at(-1).akzent, 'violett');
    assert.equal(lauf('pruefen', '--wurzel', dir).status, 0);
    // refusals write nothing
    const nochmal = lauf('neu', 'test-geraet', '--von', 'synth-mono', '--wurzel', dir);
    assert.equal(nochmal.status, 1);
    assert.match(nochmal.stderr, /exists already/);
    const unbekannt = lauf('neu', 'noch-eins', '--von', 'gibt-es-nicht', '--wurzel', dir);
    assert.equal(unbekannt.status, 1);
    assert.match(unbekannt.stderr, /unknown source graph/);
    assert.ok(!fs.existsSync(path.join(P.beispiele, 'noch-eins.json')));
    const ohneFamilie = lauf('neu', 'noch-zwei', '--von', 'fx-phaser', '--wurzel', dir);   // an effect graph is not in the register
    assert.equal(ohneFamilie.status, 1);
    assert.match(ohneFamilie.stderr, /--familie is needed/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('neu refuses a register that does not parse and leaves it byte-identical, with nothing else written; --wurzel without a value is a usage error', () => {
  const { dir, P } = kopie();
  try {
    fs.writeFileSync(P.register, '[ {"name": "drums-909", ');   // cut off
    const vorher = fs.readFileSync(P.register);
    const r = lauf('neu', 'test-geraet', '--von', 'synth-mono', '--wurzel', dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /register .* cannot be read/);
    assert.ok(fs.readFileSync(P.register).equals(vorher), 'the register is byte-identical');
    assert.ok(!fs.existsSync(path.join(P.beispiele, 'test-geraet.json')) && !fs.existsSync(path.join(P.paneele, 'test-geraet.json')) && !fs.existsSync(path.join(P.doku, 'GERAET-test-geraet.md')));
    fs.writeFileSync(P.register, '{"not": "a list"}');
    assert.equal(lauf('neu', 'test-geraet', '--von', 'synth-mono', '--wurzel', dir).status, 1);
    const u = lauf('pruefen', '--wurzel');
    assert.equal(u.status, 2);
    assert.match(u.stderr, /--wurzel needs a value[\s\S]*usage:/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('neu takes back what it wrote when a later step fails (the doc folder is read-only), and the register stays as it was', () => {
  const { dir, P } = kopie();
  try {
    fs.chmodSync(P.doku, 0o555);   // writing the doc fails after graph and panel were written
    if (process.getuid?.() === 0) return;   // root ignores the mode
    const vorher = fs.readFileSync(P.register);
    const r = lauf('neu', 'test-geraet', '--von', 'synth-mono', '--wurzel', dir);
    assert.equal(r.status, 1);
    assert.ok(!fs.existsSync(path.join(P.beispiele, 'test-geraet.json')) && !fs.existsSync(path.join(P.paneele, 'test-geraet.json')), 'graph and panel are removed again');
    assert.ok(fs.readFileSync(P.register).equals(vorher));
    assert.deepEqual(fs.readdirSync(P.beispiele).filter((d) => d.includes('.tmp-')), []);
    assert.match(r.stderr, /EACCES/);
  } finally { fs.chmodSync(P.doku, 0o755); fs.rmSync(dir, { recursive: true, force: true }); }
});

// Decision 9 of the surfaces plan: a hand panel of a bk device never shows a bare number. A knob or fader with format raw (or none) needs `unit`
// or `"einheitlos": true`. Hand panel files only; auto panels and pruefePanel are untouched.
function einheitenFehler(ordner) {
  const f = [];
  for (const datei of fs.readdirSync(ordner).filter((d) => d.endsWith('.json'))) {
    const p = JSON.parse(fs.readFileSync(path.join(ordner, datei), 'utf8'));
    if (p.geraet?.art !== 'bk' && p.format !== 'baukasten-panel/1') continue;
    for (const s of p.sections ?? []) for (const c of s.controls ?? []) {
      if (c.type !== 'knob' && c.type !== 'fader') continue;
      if ((c.format === undefined || c.format === 'raw') && !c.unit && c.einheitlos !== true) f.push(`${datei}: ${s.id}.${c.id} has no unit`);
    }
  }
  return f;
}

test('unit rule: every bk hand panel knob and fader has a format, a unit or einheitlos', () => {
  assert.deepEqual(einheitenFehler(pfadeVon(REPO).paneele), []);
});

test('unit rule negative control: a raw knob without unit in a temporary copy fails; unit and einheitlos fix it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'einheit-'));
  try {
    const knob = { id: 'k', type: 'knob', label: 'K', bind: { param: 'k1' }, format: 'raw' };
    const schreibe = (c) => fs.writeFileSync(path.join(dir, 'x.json'), JSON.stringify({ format: 'cypherdj-panel/2', geraet: { art: 'bk', graph: 'x' }, sections: [{ id: 's', controls: [c] }] }));
    schreibe(knob);
    assert.deepEqual(einheitenFehler(dir), ['x.json: s.k has no unit']);
    schreibe({ ...knob, format: undefined });
    assert.equal(einheitenFehler(dir).length, 1);
    schreibe({ ...knob, unit: 'st' });
    assert.deepEqual(einheitenFehler(dir), []);
    schreibe({ ...knob, einheitlos: true });
    assert.deepEqual(einheitenFehler(dir), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Task 8 of the surfaces plan: every instrument graph listed in kategorien.json has a hand panel in paneele/ (auto panels stay for effects and new
// graphs). OHNE_PANEL lists the graphs that are exempt, each with the reason; the list must only name graphs that really have no panel.
// It is empty since saege-ladder got knobs and a plate (the last graph without regler nodes).
const OHNE_PANEL = {};

test('coverage: every graph in kategorien.json has a hand panel in paneele/ (exemptions are explicit and still true)', () => {
  const P = pfadeVon(REPO);
  const kat = Object.keys(JSON.parse(fs.readFileSync(P.kategorien, 'utf8')));
  assert.ok(kat.length >= 50, 'positive control: kategorien.json lists the instruments');
  const fehlt = kat.filter((n) => !fs.existsSync(path.join(P.paneele, `${n}.json`)) && !(n in OHNE_PANEL));
  assert.deepEqual(fehlt, [], 'instrument graphs without a hand panel');
  const falsch = Object.keys(OHNE_PANEL).filter((n) => fs.existsSync(path.join(P.paneele, `${n}.json`)) || !kat.includes(n));
  assert.deepEqual(falsch, [], 'exempt graphs that have a panel or are not instruments');
});
