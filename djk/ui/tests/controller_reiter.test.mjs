// UI polish task 6 (Nr. 15 tab label, Nr. 30, Nr. 20 CSS, placeholder contrast): index.html and the style sheets are read as text, the stand-in has no layout.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const lies = (...p) => fs.readFileSync(path.join(PUBLIC, ...p), 'utf8');
const html = lies('index.html');

test('the CONTROLLERS tab reads "CONTROLLERS ↗" with the title that says it opens its own window; the data hook is unchanged', () => {
  const m = html.match(/<button data-bereich="controller"[^>]*>([^<]*)<\/button>/);
  assert.ok(m, 'the tab exists with its data hook');
  assert.equal(m[1], 'CONTROLLERS ↗');
  assert.match(m[0], /title="Opens the controller list in its own window"/);
});

test('off is dimmed and labelled "off", never struck through', () => {
  const css = lies('dock', 'dock.css');
  assert.ok(!/\.w-chip-teil\.aus \{[^}]*line-through/.test(css), 'no strike-through');
  assert.match(css, /\.w-chip-teil\.aus \{ opacity: \.6; \}/);
  assert.match(css, /\.w-chip-teil\.aus::after \{ content: 'off';/);
});

test('the select of the preset filters is wide enough for "Any character" (15ch, up to 24ch)', () => {
  assert.match(lies('presets.css'), /\.preset-bfilter select \{ min-width: 15ch; max-width: 24ch; \}/);
});

// WCAG contrast of the placeholder colour against the field background of the dark theme
const luma = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const kontrast = (a, b) => { const [x, y] = [luma(a), luma(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('the placeholder colour is --dim on --panel2 at 4.5:1 or more, and fully opaque', () => {
  const css = lies('style.css');
  assert.match(css, /input::placeholder, textarea::placeholder \{ color: var\(--dim\); opacity: 1; \}/);
  const token = (n) => css.match(new RegExp(`--${n}: (#[0-9a-f]{6})`))[1];
  assert.ok(kontrast(token('dim'), token('panel2')) >= 4.5, `contrast ${kontrast(token('dim'), token('panel2')).toFixed(2)}`);
});
