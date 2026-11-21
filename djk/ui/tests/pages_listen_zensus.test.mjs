// Census (container core, lane U, U1): no page module outside kanaele.js and pult.js names a mixer source channel as a quoted literal. It finds
// whole paths ('erz/2/fader', `pad/1/eq`) and the prefixes a path is built from (`erz/${n}/fader`, 'pad/' + n, 'deck/', 'strom/').
// OFFEN lists the files that still do; the tasks that clear a file remove it from the list in the same commit. Built paths seen since W3 are listed
// with the reason they stay for now (they need the alias resolver of lane M: U5/U6/U11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const PUBLIC = new URL('../public/', import.meta.url).pathname;
// Every page module is clean: U5 cleared the stream and player strips, U6 the effects lists, the registers and the module places.
const OFFEN = [];

const dateien = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? dateien(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));
// Comments and string quoting are read by a small scanner, so a quote inside a comment is not a literal and `//` inside a string is not a comment.
function literale(text) {
  const aus = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); i = e < 0 ? text.length : e + 2; continue; }
    if (c === '\'' || c === '"' || c === '`') {
      let j = i + 1; let s = '';
      while (j < text.length && text[j] !== c) { if (text[j] === '\\') { s += text[j + 1]; j += 2; } else { s += text[j]; j++; } }
      aus.push(s); i = j + 1; continue;
    }
    i++;
  }
  return aus;
}
// a whole path of a channel that is gone, or the head of a built path: `erz/${n}/...`, 'pad/' + n (the literal is just the prefix), 'deck/', 'strom/'
const KANAL = /^(erz\/\d+|pad\/[12]|deck\/[34])(\/|$)|^(erz|pad|deck|strom)\/(\$\{.*)?$/;
const treffer_ = (text) => literale(text).filter((s) => KANAL.test(s));
const rel = (f) => path.relative(PUBLIC, f);
const FREI = new Set(['kanaele.js', 'pult.js']);

test('no page module outside kanaele.js and pult.js names a mixer source channel as a quoted literal', () => {
  const treffer = {};   // file -> literals
  for (const f of dateien(PUBLIC)) {
    const n = rel(f);
    if (FREI.has(n)) continue;
    const l = treffer_(fs.readFileSync(f, 'utf8'));
    if (l.length) treffer[n] = l;
  }
  const unerlaubt = Object.keys(treffer).filter((n) => !OFFEN.includes(n));
  assert.deepEqual(unerlaubt.map((n) => `${n}: ${treffer[n].slice(0, 3)}`), [], 'new literal outside the open list');
  const sauber = OFFEN.filter((n) => !treffer[n]);
  assert.deepEqual(sauber, [], 'file is clean: remove it from OFFEN');
});

test('the census list shrinks only: every entry is a real file', () => {
  for (const n of OFFEN) assert.ok(fs.existsSync(path.join(PUBLIC, n)), n);
});

test('the census sees built paths: a template with a variable and a concatenated prefix are hits (mutation proof)', () => {
  assert.deepEqual(treffer_('const a = `erz/${n}/fader`;'), ['erz/${n}/fader']);
  assert.deepEqual(treffer_("const b = 'pad/' + n;"), ['pad/']);
  assert.deepEqual(treffer_("const c = 'deck/' + n + '/fader';"), ['deck/']);
  assert.deepEqual(treffer_('const d = `strom/${s}`;'), ['strom/${s}']);
  assert.deepEqual(treffer_("const e = 'erz/3/fader';"), ['erz/3/fader'], 'the whole literal still counts');
  // negative controls: unrelated literals and comments are no hits
  assert.deepEqual(treffer_("const f = 'padding/' + n; const g = 'erzeuger/1'; // erz/${n}/fader\nconst h = 'deck/1/fader';"), [], 'padding/, erzeuger/, a comment and a live container path');
  // the same mutation applied to a clean page module turns the census red for exactly that file
  const sauber = fs.readFileSync(path.join(PUBLIC, 'slots.js'), 'utf8');
  assert.deepEqual(treffer_(sauber), [], 'slots.js is clean before the mutation');
  assert.deepEqual(treffer_(`${sauber}\nconst x = \`erz/\${n}/fader\`;`), ['erz/${n}/fader']);
  assert.deepEqual(treffer_(`${sauber}\nconst y = 'pad/' + n;`), ['pad/']);
});
