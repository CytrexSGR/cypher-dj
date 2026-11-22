// The stylesheets are well formed: balanced braces and no declaration outside a rule. A declaration left outside a rule (an orphan `border: ...; }`)
// is read as part of the NEXT rule's selector, which then is invalid and silently dropped (found 2026-11-22: the greyed EXPORT key).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const alle = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? alle(path.join(d, e.name)) : e.name.endsWith('.css') ? [path.join(d, e.name)] : []));

/** Returns the problems found: { zeile, text } for a stray `}`, a declaration or `}` in a selector, or an unbalanced end. */
export function pruefeCss(text) {
  const ohne = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const probleme = [];
  let tiefe = 0, vorspann = '', zeile = 1, vorspannZeile = 1;
  for (const z of ohne) {
    if (z === '\n') zeile++;
    if (z === '{') {
      if (tiefe === 0) {
        const v = vorspann.trim();
        if (/[;}]/.test(v) && !v.startsWith('@')) probleme.push({ zeile: vorspannZeile, text: `selector holds ; or }: ${v.slice(0, 80)}` });
        else if (v.startsWith('@') && /[;}]/.test(v.replace(/^@[^;]*;/, ''))) probleme.push({ zeile: vorspannZeile, text: `at-rule holds ; or }: ${v.slice(0, 80)}` });
        vorspann = '';
      }
      tiefe++;
    } else if (z === '}') {
      if (tiefe === 0) { probleme.push({ zeile, text: 'closing brace without an opening one' }); vorspann = ''; } else tiefe--;
      if (tiefe === 0) vorspann = '';
    } else if (tiefe === 0) { if (!vorspann.trim()) vorspannZeile = zeile; vorspann += z; if (z === ';' && vorspann.trim().startsWith('@')) vorspann = ''; }
  }
  if (tiefe !== 0) probleme.push({ zeile, text: `unbalanced: ${tiefe} brace(s) still open at the end` });
  return probleme;
}

test('the checker sees an orphan declaration in front of a rule', () => {
  assert.equal(pruefeCss('a { color: red; }\n  border: 1px solid; }\n.b:disabled { opacity: .3; }').length, 1);
  assert.equal(pruefeCss('a { color: red; }\n.b { x: y; }').length, 0);
  assert.equal(pruefeCss('@media (min-width: 1px) { a { color: red; } }\n@import url(x.css);\nb { c: d; }').length, 0);
  assert.equal(pruefeCss('a { color: red;').length, 1);
});

for (const datei of alle(PUBLIC)) {
  test(`${path.relative(PUBLIC, datei)} is well formed`, () => {
    assert.deepEqual(pruefeCss(fs.readFileSync(datei, 'utf8')), []);
  });
}
