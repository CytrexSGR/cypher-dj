// Package 1.16 rest U4 (K1, K2): collections on disk. Model table, store, Cypher's rights, busy lock from a second process, atomic
// write (a writer killed between temp file and rename leaves the old file whole).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { pruefePosten, KollektionFehler, MAX_POSTEN, MAX_KOLLEKTIONEN, KOLLEKTION_TEXT } from '../kollektionen/modell.ts';
import { KollektionSpeicher, kollektionenVorgabe } from '../kollektionen/speicher.ts';

const SHA = 'a'.repeat(64), SHA2 = 'b'.repeat(64);
const S1 = { art: 'sample', sha: SHA }, P1 = { art: 'preset', id: 'werk:komp/drum-bus' }, G1 = { art: 'geraet', geraet: 'bk:juno-pad' };
function tmp(t) { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'koll-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; }
function speicher(t) { const ordner = path.join(tmp(t), 'kollektionen'); let n = 0; return { ordner, s: new KollektionSpeicher({ ordner, jetzt: () => new Date(Date.UTC(2026, 10, 4, 12, 0, n++)) }) }; }
const fehlerIst = (code, fehler) => (e) => e instanceof KollektionFehler && e.code === code && e.fehler === fehler;
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

test('model: valid and invalid items (sample sha, preset id, device kind or bk graph)', () => {
  const gut = [S1, P1, G1, ...['rb338', 'surge', 'komp', 'eq', 'saett'].map((geraet) => ({ art: 'geraet', geraet }))];
  for (const p of gut) assert.deepEqual(pruefePosten(p), p, JSON.stringify(p));
  const schlecht = [null, 5, {}, { art: 'sample' }, { art: 'sample', sha: 'A'.repeat(64) }, { art: 'sample', sha: 'a'.repeat(63) }, { art: 'sample', sha: SHA, x: 1 },
    { art: 'preset', id: 'werk:komp' }, { art: 'preset', id: 'x:komp/a' }, { art: 'geraet', geraet: 'hall' }, { art: 'geraet', geraet: 'bk:Gross' }, { art: 'geraet', geraet: 'bk:' },
    { art: 'klang', sha: SHA }];
  for (const p of schlecht) assert.throws(() => pruefePosten(p), (e) => fehlerIst(400, 'posten_ungueltig')(e) && e.posten === p, JSON.stringify(p));
  assert.equal(MAX_POSTEN, 500); assert.equal(MAX_KOLLEKTIONEN, 200);
  for (const t of Object.values(KOLLEKTION_TEXT)) assert.match(t, /^[\x20-\x7e]+$/, 'English texts');
});

test('store: create, add mixed items (duplicates ignored, order kept), remove, rename, delete into the trash, list', (t) => {
  const { s, ordner } = speicher(t);
  assert.deepEqual(s.lege('Dark Stuff', 'andreas'), { slug: 'dark-stuff' });
  assert.throws(() => s.lege('dark stuff', 'andreas'), fehlerIst(409, 'name_vergeben'));
  assert.throws(() => s.lege('  ', 'andreas'), fehlerIst(400, 'name_ungueltig'));
  const r = s.aendere('dark-stuff', { hinzu: [S1, P1, S1, G1, { ...P1 }] }, 'andreas');
  assert.equal(r.anzahl, 3);
  assert.deepEqual(s.lies('dark-stuff').posten, [S1, P1, G1]);
  s.aendere('dark-stuff', { hinzu: [{ art: 'sample', sha: SHA2 }], weg: [P1] }, 'andreas');
  assert.deepEqual(s.lies('dark-stuff').posten, [S1, G1, { art: 'sample', sha: SHA2 }]);
  assert.throws(() => s.aendere('dark-stuff', { hinzu: [{ art: 'nix' }] }, 'andreas'), fehlerIst(400, 'posten_ungueltig'));
  assert.throws(() => s.aendere('dark-stuff', { hinzu: [S1], erwartet: '2000-01-01T00:00:00.000Z' }, 'andreas'), fehlerIst(409, 'veraltet'));
  assert.deepEqual(s.benenne('dark-stuff', 'Darker', 'andreas'), { slug: 'darker' });
  assert.deepEqual(s.liste().map((k) => [k.slug, k.name, k.anzahl]), [['darker', 'Darker', 3]]);
  const datei = JSON.parse(fs.readFileSync(path.join(ordner, 'darker.json'), 'utf8'));
  assert.deepEqual(Object.keys(datei), ['schema', 'name', 'angelegt', 'geaendert', 'posten']);
  s.loesche('darker', 'andreas');
  assert.deepEqual(s.liste(), []);
  assert.equal(fs.readdirSync(path.join(ordner, '.papierkorb')).length, 1);
  assert.throws(() => s.lies('darker'), fehlerIst(404, 'unbekannt'));
  assert.throws(() => s.lies('../x'), fehlerIst(400, 'slug_ungueltig'));
  assert.deepEqual(fs.readdirSync(ordner).filter((n) => !n.startsWith('.')), [], 'no temp file or lock left');
});

test('limits: 500 items per collection, 200 collections', (t) => {
  const { s } = speicher(t);
  s.lege('Big', 'andreas');
  const viele = Array.from({ length: 500 }, (_, i) => ({ art: 'sample', sha: i.toString(16).padStart(64, '0') }));
  assert.equal(s.aendere('big', { hinzu: viele }, 'andreas').anzahl, 500);
  assert.throws(() => s.aendere('big', { hinzu: [{ art: 'sample', sha: 'f'.repeat(64) }] }, 'andreas'), fehlerIst(409, 'zu_viele'));
  assert.equal(s.aendere('big', { hinzu: [viele[0]] }, 'andreas').anzahl, 500, 'negative control: a duplicate does not count');
  for (let i = 1; i < 200; i++) s.lege(`K ${i}`, 'andreas');
  assert.throws(() => s.lege('One Too Many', 'andreas'), fehlerIst(409, 'zu_viele'));
});

test('rights (K2): Cypher creates and adds anywhere; removes, renames, deletes only her own; Andreas\' and damaged files untouched', (t) => {
  const { s, ordner } = speicher(t);
  s.lege('His', 'andreas');
  s.aendere('his', { hinzu: [S1, P1] }, 'andreas');
  const f = path.join(ordner, 'his.json');
  let vorher = sha(f);
  assert.throws(() => s.aendere('his', { weg: [S1] }, 'cypher'), fehlerIst(403, 'nur_andreas_kollektion'));
  assert.throws(() => s.benenne('his', 'Hers', 'cypher'), fehlerIst(403, 'nur_andreas_kollektion'));
  assert.throws(() => s.loesche('his', 'cypher'), fehlerIst(403, 'nur_andreas_kollektion'));
  assert.equal(sha(f), vorher, 'Andreas\' file unchanged after refused Cypher operations');
  // damaged unmarked file
  const k = path.join(ordner, 'kaputt.json');
  fs.writeFileSync(k, '{"schema": 1, "name": ');
  const kv = sha(k);
  assert.throws(() => s.aendere('kaputt', { weg: [S1] }, 'cypher'), fehlerIst(403, 'nur_andreas_kollektion'));
  assert.throws(() => s.loesche('kaputt', 'cypher'), fehlerIst(403, 'nur_andreas_kollektion'));
  assert.equal(sha(k), kv);
  assert.equal(fs.existsSync(path.join(ordner, '.papierkorb')), false);
  assert.deepEqual(s.liste().find((x) => x.slug === 'kaputt'), { slug: 'kaputt', name: 'kaputt', anzahl: 0, geaendert: null, fehler: 'json_kaputt' });
  // negative controls
  assert.equal(s.aendere('his', { hinzu: [G1] }, 'cypher').anzahl, 3, 'Cypher adds to Andreas\' collection');
  assert.deepEqual(s.lege('Mine', 'cypher'), { slug: 'mine' });
  assert.equal(s.lies('mine').autor, 'cypher');
  s.aendere('mine', { hinzu: [S1, P1] }, 'cypher');
  assert.equal(s.aendere('mine', { weg: [S1] }, 'cypher').anzahl, 1, 'Cypher removes from her own');
  assert.deepEqual(s.benenne('mine', 'Mine Too', 'cypher'), { slug: 'mine-too' });
  assert.equal(s.lies('mine-too').autor, 'cypher');
  s.loesche('mine-too', 'cypher');
  s.loesche('kaputt', 'andreas');
  assert.equal(fs.existsSync(k), false, 'Andreas may delete a damaged file');
  vorher = sha(f);
  s.aendere('his', { weg: [G1] }, 'andreas');
  assert.notEqual(sha(f), vorher);
});

test('busy: a second process holding the lock gives kollektion_busy at once', async (t) => {
  const { s, ordner } = speicher(t);
  s.lege('Shared', 'andreas');
  const kind = spawn(process.execPath, ['--input-type=module', '-e', `
    import { nimmSperre } from ${JSON.stringify(path.resolve('sperre.ts'))};
    nimmSperre(${JSON.stringify(path.join(ordner, '.sperre'))}); console.log('ok'); setTimeout(() => {}, 20000);`], { stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(() => kind.kill('SIGKILL'));
  await new Promise((ok) => kind.stdout.once('data', ok));
  const t0 = Date.now();
  assert.throws(() => s.aendere('shared', { hinzu: [S1] }, 'andreas'), fehlerIst(409, 'kollektion_busy'));
  assert.ok(Date.now() - t0 < 500, 'refused at once');
  kind.kill('SIGKILL');
  await new Promise((ok) => kind.once('exit', ok));
  assert.equal(s.aendere('shared', { hinzu: [S1] }, 'andreas').anzahl, 1, 'negative control: a dead holder\'s lock is taken over');
});

test('atomic write: a writer killed between temp file and rename leaves the old file whole', (t) => {
  const { s, ordner } = speicher(t);
  s.lege('Whole', 'andreas');
  s.aendere('whole', { hinzu: [S1] }, 'andreas');
  const f = path.join(ordner, 'whole.json'), vorher = fs.readFileSync(f);
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { KollektionSpeicher } from ${JSON.stringify(path.resolve('kollektionen/speicher.ts'))};
    const s = new KollektionSpeicher({ ordner: ${JSON.stringify(ordner)}, nachTemp: () => process.exit(7) });
    s.aendere('whole', { hinzu: [{ art: 'sample', sha: ${JSON.stringify(SHA2)} }] }, 'andreas');`], { encoding: 'utf8' });
  assert.equal(r.status, 7, r.stderr);
  assert.deepEqual(fs.readFileSync(f), vorher);
  assert.deepEqual(s.lies('whole').posten, [S1]);
});

test('default folder: ~/.config/cypherdj[-<i>]/kollektionen', () => {
  assert.equal(kollektionenVorgabe(''), path.join(os.homedir(), '.config', 'cypherdj', 'kollektionen'));
  assert.equal(kollektionenVorgabe('e'), path.join(os.homedir(), '.config', 'cypherdj-e', 'kollektionen'));
});

test('review: a change that changes nothing never rewrites the file (Cypher re-adding an item to Andreas\' collection, empty lists)', (t) => {
  const { ordner, s } = speicher(t);
  const { slug } = s.lege('Andreas Box', 'andreas');
  const erst = s.aendere(slug, { hinzu: [S1, P1] }, 'andreas');
  const datei = path.join(ordner, `${slug}.json`), vorher = sha(datei);
  // Cypher adds an item that is already there, or sends empty lists: the bytes stay and geaendert does not move
  for (const o of [{ hinzu: [S1] }, { hinzu: [] }, { hinzu: [P1, S1] }, {}]) {
    const r = s.aendere(slug, o, 'cypher');
    assert.deepEqual(r, { anzahl: 2, geaendert: erst.geaendert }, JSON.stringify(o));
    assert.equal(sha(datei), vorher, `file bytes unchanged for ${JSON.stringify(o)}`);
  }
  // so Andreas' stale-check stamp from before still holds: his removal is not refused with veraltet
  assert.equal(s.aendere(slug, { weg: [S1], erwartet: erst.geaendert }, 'andreas').anzahl, 1);
  // negative control: a real addition still writes and moves the stamp
  const neu = s.aendere(slug, { hinzu: [G1] }, 'cypher');
  assert.equal(neu.anzahl, 2);
  assert.notEqual(sha(datei), vorher);
});

test('rename by Andreas takes the Cypher mark (D27): the collection becomes his; Cypher renaming her own keeps it and her delete right', (t) => {
  const { s, ordner } = speicher(t);
  s.lege('Mine', 'cypher');
  assert.equal(s.lies('mine').autor, 'cypher');
  assert.deepEqual(s.benenne('mine', 'Andreas Name', 'andreas'), { slug: 'andreas-name' });
  assert.equal(s.lies('andreas-name').autor, undefined, 'Andreas renaming a marked collection removes the mark');
  assert.equal('autor' in JSON.parse(fs.readFileSync(path.join(ordner, 'andreas-name.json'), 'utf8')), false, 'also on disk');
  assert.throws(() => s.loesche('andreas-name', 'cypher'), fehlerIst(403, 'nur_andreas_kollektion'));
  assert.throws(() => s.aendere('andreas-name', { weg: [S1] }, 'cypher'), fehlerIst(403, 'nur_andreas_kollektion'));
  assert.equal(fs.existsSync(path.join(ordner, 'andreas-name.json')), true);
  s.lege('Same', 'cypher');
  s.benenne('same', 'SAME', 'andreas');
  assert.equal(s.lies('same').autor, undefined, 'same slug: the in-place write drops the mark too');
  // negative control: Cypher renames her own, the mark stays and she may still delete it
  s.lege('Hers', 'cypher');
  s.benenne('hers', 'Hers Renamed', 'cypher');
  assert.equal(s.lies('hers-renamed').autor, 'cypher');
  s.loesche('hers-renamed', 'cypher');
  assert.equal(fs.existsSync(path.join(ordner, 'hers-renamed.json')), false);
  // negative control: Andreas renaming his own unmarked collection stays unmarked
  s.lege('His', 'andreas');
  s.benenne('his', 'His Two', 'andreas');
  assert.equal(s.lies('his-two').autor, undefined);
});
