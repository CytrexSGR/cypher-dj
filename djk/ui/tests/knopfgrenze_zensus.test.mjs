// Census against stale knob limits. The 8 -> 32 work found its sites by grep and still missed one (ARR_PARAMETER); the 32 -> 64 work found them the same way, so
// this test greps every non-test source of the page, the hand and the Leitstand for the old limit and fails with file and line unless the hit sits on the
// allow-list. Every allow-list entry names the fragment it removes from the line and the reason; what is left of the line is checked again.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const WURZELN = ['djk/ui', 'djk/hand', 'djk/conductor'].map((p) => path.join(REPO, p));
const ENDUNGEN = ['.ts', '.js', '.mjs'];
const AUSGELASSEN = new Set(['node_modules', 'tests', 'ergebnisse', '.git', 'target']);

// the stale limit in its forms: the alternation of the old knob numbers, literal bounds, the old constant
const MUSTER = [/3\[0-2\]/, /nr > 32\b/, /<= 32\b/, /[^<>=-]> 32\b/, /< 33\b/, /\b32 slots/, /1\.\.32\b/, /\bk32\b/, /\bknob32\b/, /BK_REGLER_ZAHL = 32\b/];

// { datei: path suffix, fragment: literal text removed from the line, grund }
const ERLAUBT = [
  // there are 32 tracks (the knob limit does not move them)
  { datei: 'ui/hand_operation.ts', fragment: 'spur\\/([1-9]|[12][0-9]|3[0-2])', grund: 'track mixer paths spur/1..32/*: 32 tracks' },
  { datei: 'ui/areas/proj/mapping.ts', fragment: '(spur)\\/([1-9]|[12][0-9]|3[0-2])', grund: 'SEND_PFAD counts tracks: 32 tracks' },
  { datei: 'ui/public/curves.js', fragment: 'spur\\/(?:[1-9]|[12][0-9]|3[0-2])', grund: 'track patterns spur/1..32 (curves.js:67, :72): 32 tracks' },
  { datei: 'ui/areas/proj/core_path.ts', fragment: 'track number 1..32', grund: 'comment: lane override per track' },
  { datei: 'ui/areas/proj/session.ts', fragment: 'spur(1..32 = track number nr)', grund: 'comment: /e/auto per track' },
  { datei: 'conductor/src/controls_info.ts', fragment: 'n <= 32', grund: 'one row per track slot (spur/1..32/*), not knobs' },
  { datei: 'hand/hand.ts', fragment: 'spur/1..32', grund: 'tool text: track paths' },
  { datei: 'ui/check/acceptance_r3.mjs', fragment: 'i <= 32', grund: 'probe: one command per track' },
  { datei: 'ui/check/acceptance_r8.mjs', fragment: 'i <= 32', grund: 'probe: one command per track' },
  { datei: 'ui/check/acceptance_e3.mjs', fragment: '<1..32,', grund: 'probe usage text: number of tracks' },
  { datei: 'ui/public/app.js', fragment: 'b > 32 ?', grund: 'bars of a long track: grid lines every 4 bars above 32' },
  // name lengths: graph, kit and group names are 1..32 characters
  { datei: '', fragment: '1..32 characters', grund: 'name length of a graph, kit or group' },
  { datei: '', fragment: '_ -, 1..32)', grund: 'graph name length' },
  { datei: '', fragment: '[a-z0-9_-] 1..32', grund: 'kit name length (tool text)' },
  { datei: '', fragment: 'text 1..32', grund: 'group name length (tool text)' },
  // knob 32 as one row of a table that goes on to knob 64 (the tables are pinned to 64 by their own tests)
  { datei: 'ui/public/production/lanes.js', fragment: "'geraet.k32'", grund: 'row of the knob table k1..k64' },
  { datei: 'ui/public/production/envelopes.js', fragment: "'geraet.k32'", grund: 'row of the knob table k1..k64' },
  { datei: 'ui/project/model.ts', fragment: "'geraet.k32'", grund: 'row of the knob table k1..k64' },
  { datei: 'ui/project/insert_key.ts', fragment: "name: 'k32'", grund: 'generated key list k1..k64' },
  { datei: 'conductor/src/insert_controls.ts', fragment: "/k32'", grund: 'generated rows ins/bk/<n>/k1..k64' },
  // comments that describe the 8 -> 32 -> 64 history
  { datei: 'ui/project/model.ts', fragment: 'bk k9..k32', grund: 'comment: the index space of the rack members, k33..k64 follow' },
  { datei: 'ui/project/model.ts', fragment: 'k9..k32 = 17..40', grund: 'comment: GLIED_PARAM_BK9 range, GLIED_PARAM_BK33 follows' },
  { datei: 'ui/project/playback.ts', fragment: 'bk k9..k32', grund: 'comment: the index space of the playback, k33..k64 follow' },
];

function dateien(wurzel, aus = []) {
  for (const e of fs.readdirSync(wurzel, { withFileTypes: true })) {
    if (AUSGELASSEN.has(e.name)) continue;
    const p = path.join(wurzel, e.name);
    if (e.isDirectory()) dateien(p, aus);
    else if (ENDUNGEN.includes(path.extname(e.name))) aus.push(p);
  }
  return aus;
}

/** Hits of `muster` in `liste` that the allow-list does not cover: [{datei, zeile, text}]. */
export function treffer(liste, erlaubt = ERLAUBT, wurzel = REPO) {
  const aus = [];
  for (const d of liste) {
    const rel = path.relative(wurzel, d);
    const zeilen = fs.readFileSync(d, 'utf8').split('\n');
    zeilen.forEach((z, i) => {
      let rest = z;
      for (const e of erlaubt) if (rel.endsWith(e.datei) && rest.includes(e.fragment)) rest = rest.split(e.fragment).join('');
      if (MUSTER.some((m) => m.test(rest))) aus.push({ datei: rel, zeile: i + 1, text: z.trim().slice(0, 160) });
    });
  }
  return aus;
}

test('census: no source under oberflaeche, hand and leitstand carries the old knob limit outside the allow-list', () => {
  const alle = WURZELN.flatMap((w) => dateien(w));
  assert.ok(alle.length > 100, `the walk finds the sources (${alle.length})`);
  const offen = treffer(alle);
  assert.deepEqual(offen, [], `stale knob limit (file:line):\n${offen.map((t) => `  ${t.datei}:${t.zeile}  ${t.text}`).join('\n')}`);
});

test('census: every allow-list entry is used (a stale entry would hide a later hit)', () => {
  const alle = WURZELN.flatMap((w) => dateien(w));
  const text = new Map(alle.map((d) => [path.relative(REPO, d), fs.readFileSync(d, 'utf8')]));
  for (const e of ERLAUBT) {
    assert.ok(e.grund && e.grund.length > 5, `entry ${e.fragment} has a reason`);
    const benutzt = [...text].some(([rel, t]) => rel.endsWith(e.datei) && t.includes(e.fragment));
    assert.ok(benutzt, `allow-list entry "${e.fragment}" (${e.datei || 'any file'}) matches nothing: remove it`);
  }
});

test('census negative control: a temporary file with the stale alternation and with k32 fails, the allow-list does not cover it', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zensus-'));
  try {
    const f = path.join(tmp, 'knopf.js');
    fs.writeFileSync(f, ["const a = /^bk\\/([1-9]|[12][0-9]|3[0-2])$/;", 'for (let nr = 1; nr <= 32; nr++) {}', "const k = 'geraet.k32';", 'if (nr > 32) {}', 'const fine = 64;', 'if (n > 32) {}', 'while (i < 33) {}', 'const t = "all 32 slots";'].join('\n'));
    const h = treffer([f], ERLAUBT, tmp);
    assert.deepEqual(h.map((x) => x.zeile), [1, 2, 3, 4, 6, 7, 8], JSON.stringify(h));
    // positive control: the same text with the knob limit at 64 passes
    fs.writeFileSync(f, ["const a = /^bk\\/([1-9]|[1-5][0-9]|6[0-4])$/;", 'for (let nr = 1; nr <= 64; nr++) {}'].join('\n'));
    assert.deepEqual(treffer([f], ERLAUBT, tmp), []);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
