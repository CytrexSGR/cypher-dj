// Size caps for the decode cache and the wave cache (storage layout A5, task 13). Everything runs in tmp folders.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { deckle, deckleDekodiert, deckleWelle, alleProjekte } from '../project/cache_deckel.ts';
import { DekodierCache } from '../project/decode.ts';
import { WelleCache } from '../wave_cache.ts';
import { Projekte } from '../project/storage.ts';
import { tmpOrdner, specProjekt } from './support/project.mjs';
import { stapel } from './support/media_library.mjs';
import { ruf } from './support/proj_stack.mjs';
import { baueKatalog } from './support/catalog.mjs';

const sha = (c) => c.repeat(64);
const MB = 1024 * 1024;

function datei(ordner, name, groesse, alterS) {
  fs.mkdirSync(ordner, { recursive: true });
  const p = path.join(ordner, name);
  fs.writeFileSync(p, Buffer.alloc(groesse));
  const t = (Date.now() - alterS * 1000) / 1000;
  fs.utimesSync(p, t, t);
  return p;
}
// a project folder with one audio clip carrying `s` and the hint `hinweis`
function projekt(wurzel, slug, s, hinweis) {
  const p = specProjekt();
  p.spuren[0].clips[0].quelle = { sha256: s, pfad_hinweis: hinweis };
  fs.mkdirSync(path.join(wurzel, slug), { recursive: true });
  fs.writeFileSync(path.join(wurzel, slug, 'project.json'), JSON.stringify(p));
  return path.join(wurzel, slug);
}
function aufbau(t) {
  const d = tmpOrdner(t, 'djk-deckel-');
  const arr = path.join(d, 'arr'), audio = path.join(arr, 'audio'), wurzel = path.join(d, 'projekte');
  fs.mkdirSync(audio, { recursive: true }); fs.mkdirSync(wurzel, { recursive: true });
  const logs = [];
  const lauf = (o = {}) => deckleDekodiert({ arbeitsordner: arr, projekte: new Projekte(wurzel), offeneShas: () => new Set(),
    deckel: 2 * MB, log: (z) => logs.push(z), ...o });
  return { d, arr, audio, wurzel, logs, lauf, f32: (s, groesse, alter) => datei(audio, `${s}.f32`, groesse, alter) };
}

test('deletes the oldest until under the cap', (t) => {
  const d = tmpOrdner(t, 'djk-deckel-');
  datei(d, 'a.x', MB, 300); datei(d, 'b.x', MB, 200); datei(d, 'c.x', MB, 100);
  const r = deckle({ ordner: d, muster: /\.x$/, deckel: 2 * MB, geschuetzt: () => false });
  assert.deepEqual(r.geloescht, ['a.x']);
  assert.equal(r.bytes_vorher, 3 * MB); assert.equal(r.bytes_nachher, 2 * MB);
  assert.deepEqual(fs.readdirSync(d).sort(), ['b.x', 'c.x']);
});

test('protected files survive over the cap', (t) => {
  const d = tmpOrdner(t, 'djk-deckel-');
  datei(d, 'a.x', MB, 300); datei(d, 'b.x', MB, 200); datei(d, 'c.x', MB, 100);
  const r = deckle({ ordner: d, muster: /\.x$/, deckel: MB, geschuetzt: (n) => n === 'a.x' });
  assert.deepEqual(r.geloescht, ['b.x', 'c.x']);
  assert.ok(fs.existsSync(path.join(d, 'a.x')));
  assert.equal(r.bytes_nachher, MB);
});

test('all protected: nothing deleted, no throw', (t) => {
  const d = tmpOrdner(t, 'djk-deckel-');
  datei(d, 'a.x', MB, 300); datei(d, 'b.x', MB, 200);
  const r = deckle({ ordner: d, muster: /\.x$/, deckel: 1, geschuetzt: () => true });
  assert.deepEqual(r.geloescht, []);
  assert.deepEqual(fs.readdirSync(d).sort(), ['a.x', 'b.x']);
});

test('only matching names are counted and deleted', (t) => {
  const d = tmpOrdner(t, 'djk-deckel-');
  datei(d, 'a.x', MB, 300); datei(d, 'freeze-1.f32', 5 * MB, 900); datei(d, 'wiedergabe-1.json', MB, 900);
  fs.mkdirSync(path.join(d, 'dir.x'));
  fs.symlinkSync(path.join(d, 'a.x'), path.join(d, 'link.x'));
  const r = deckle({ ordner: d, muster: /\.x$/, deckel: 0, geschuetzt: () => false });
  assert.deepEqual(r.geloescht, ['a.x']);
  assert.equal(r.bytes_vorher, MB, 'other names, folders and links do not count');
  assert.ok(fs.existsSync(path.join(d, 'freeze-1.f32')) && fs.existsSync(path.join(d, 'wiedergabe-1.json')) && fs.existsSync(path.join(d, 'dir.x')));
});

test('a reused decode is touched', (t) => {
  const d = tmpOrdner(t, 'djk-deckel-');
  const arr = path.join(d, 'arr');
  const p = datei(path.join(arr, 'audio'), `${sha('1')}.f32`, 16, 3600);
  const c = new DekodierCache(arr);
  const vorher = fs.statSync(p).mtimeMs;
  assert.equal(c.fordereAn(sha('1'), '/nonexistent/x.wav'), 'fertig');
  assert.ok(fs.statSync(p).mtimeMs > vorher + 3000 * 1000, 'mtime moved to now');
  c.beruehre(sha('2'));   // an unknown sha does not throw
});

test('the decode cache caps after construction and after a finished decode', async (t) => {
  const d = tmpOrdner(t, 'djk-deckel-');
  const arr = path.join(d, 'arr'); const aufrufe = [];
  datei(path.join(arr, 'audio'), `${sha('1')}.f32`, 16, 3600);
  const c = new DekodierCache(arr, { deckel: (frisch) => aufrufe.push(frisch) });
  await new Promise((ok) => setImmediate(ok));
  assert.deepEqual(aufrufe, [null]);
  assert.equal(c.fordereAn(sha('3'), '/nonexistent/x.wav'), 'fehler');
});

test('the wave cache caps after a finished wave', async (t) => {
  const d = tmpOrdner(t, 'djk-deckel-');
  const ordner = path.join(d, 'wellen');
  datei(ordner, 'alt-1.welle', MB, 600); datei(ordner, 'alt-2.welle', MB, 500);
  const quelle = datei(d, 'in.bin', 10, 0);
  const skript = path.join(d, 'waveform.py');
  fs.writeFileSync(skript, `import sys\nopen(sys.argv[2], 'wb').write(b'x' * 100)\n`);
  const w = new WelleCache(ordner, 'python3', skript, undefined, { deckel: MB + 200 });
  const ziel = await w.hole({ datei: quelle, schluessel: 'neu-1' });
  assert.ok(fs.existsSync(ziel));
  assert.deepEqual(fs.readdirSync(ordner).sort(), ['alt-2.welle', 'neu-1.welle']);
});

test('deckleWelle counts only finished .welle files', (t) => {
  const d = tmpOrdner(t, 'djk-deckel-');
  datei(d, 'a.welle', MB, 300); datei(d, 'b.welle', MB, 200); datei(d, 'b.welle.123.teil', 5 * MB, 900); datei(d, 'c.welle.neu', 5 * MB, 900);
  const r = deckleWelle({ ordner: d, deckel: MB });
  assert.deepEqual(r.geloescht, ['a.welle']);
  assert.ok(fs.existsSync(path.join(d, 'b.welle.123.teil')) && fs.existsSync(path.join(d, 'c.welle.neu')));
});

test('a sha named by a project is never deleted, also when its source is reachable', (t) => {
  const a = aufbau(t);
  const quelle = datei(a.d, 'quelle.wav', 10, 0);
  a.f32(sha('a'), MB, 900);      // named by a project whose hint points at an existing file: stays
  a.f32(sha('b'), MB, 800);      // named by a project whose source is gone: stays
  projekt(a.wurzel, 'eins', sha('a'), quelle);
  projekt(a.wurzel, 'zwei', sha('b'), path.join(a.d, 'weg.wav'));
  const r = a.lauf({ deckel: 0 });
  assert.deepEqual(r.geloescht, []);
  assert.ok(fs.existsSync(path.join(a.audio, `${sha('a')}.f32`)) && fs.existsSync(path.join(a.audio, `${sha('b')}.f32`)));
});

test('a decode no project names is deleted, oldest first', (t) => {
  const a = aufbau(t);
  const quelle = datei(a.d, 'quelle.wav', 10, 0);
  a.f32(sha('a'), MB, 900); a.f32(sha('b'), MB, 800); a.f32(sha('c'), MB, 700); a.f32(sha('d'), MB, 600);
  projekt(a.wurzel, 'eins', sha('b'), quelle);
  const r = a.lauf({ deckel: 2 * MB });
  assert.deepEqual(r.geloescht, [`${sha('a')}.f32`, `${sha('c')}.f32`], 'a and c are the oldest unnamed; stops once under the cap');
  assert.ok(fs.existsSync(path.join(a.audio, `${sha('b')}.f32`)) && fs.existsSync(path.join(a.audio, `${sha('d')}.f32`)));
});

test('a sha used only by a linked project is protected', (t) => {
  const a = aufbau(t);
  const pruefen = path.join(a.d, 'pruefen'); fs.mkdirSync(pruefen);
  const echt = projekt(pruefen, 'ver', sha('a'), '/media/tester/unplugged/x.wav');
  fs.symlinkSync(echt, path.join(a.wurzel, 'ver'));
  a.f32(sha('a'), MB, 900);
  a.f32(sha('b'), MB, 800);
  assert.deepEqual(a.lauf({ deckel: 0 }).geloescht, [`${sha('b')}.f32`], 'read through the link: a stays, the unnamed b goes');
  assert.equal(alleProjekte(new Projekte(a.wurzel)).length, 1, 'the linked project is listed');
  fs.rmSync(path.join(a.wurzel, 'ver'));
  assert.deepEqual(a.lauf({ deckel: 0 }).geloescht, [`${sha('a')}.f32`], 'without the link nothing names a');
});

test('the open project, the frisch sha and a wiedergabe file protect their shas', (t) => {
  const a = aufbau(t);
  for (const c of 'abcd') a.f32(sha(c), MB, 900 - c.charCodeAt(0));
  const noch = (s) => fs.existsSync(path.join(a.audio, `${s}.f32`));
  fs.writeFileSync(path.join(a.arr, 'wiedergabe-7.json'), JSON.stringify({ clips: [{ sha256: sha('b') }] }));
  const r = a.lauf({ deckel: 0, offeneShas: () => new Set([sha('a')]), frisch: sha('c') });
  assert.deepEqual(r.geloescht, [`${sha('d')}.f32`]);
  assert.ok(noch(sha('a')) && noch(sha('b')) && noch(sha('c')));
  assert.ok(fs.existsSync(path.join(a.arr, 'wiedergabe-7.json')));
});

test('all protected: nothing deleted and one log line per start', (t) => {
  const a = aufbau(t);
  a.f32(sha('a'), 2 * MB, 900); a.f32(sha('b'), 2 * MB, 800);
  projekt(a.wurzel, 'eins', sha('a'), '/x/a.wav'); projekt(a.wurzel, 'zwei', sha('b'), '/x/b.wav');
  const gemeldet = new Set();
  for (let i = 0; i < 3; i++) assert.deepEqual(a.lauf({ deckel: MB, gemeldet }).geloescht, []);
  assert.deepEqual(a.logs, [{ typ: 'cache_deckel_voll', ordner: a.audio, bytes_geschuetzt: 4 * MB, bytes_gesamt: 4 * MB }]);
  assert.equal(fs.readdirSync(a.audio).length, 2);
});

test('at or under the cap the run returns at once and reads no project', (t) => {
  const a = aufbau(t);
  a.f32(sha('a'), MB, 900);
  fs.mkdirSync(path.join(a.wurzel, 'kaputt')); fs.writeFileSync(path.join(a.wurzel, 'kaputt', 'project.json'), '{ not json');
  const r = a.lauf({ deckel: MB });
  assert.deepEqual([r.geloescht, r.bytes_vorher, r.bytes_nachher], [[], MB, MB], 'exactly at the cap counts as under');
  assert.deepEqual(a.logs, [], 'the unreadable project was never looked at');
  assert.equal(a.lauf({ deckel: MB - 1 }), null, 'over the cap the same project stops the run');
});

test('only the pattern is touched: freeze files, wiedergabe files, foreign names stay', (t) => {
  const a = aufbau(t);
  datei(a.audio, 'freeze-1.f32', 3 * MB, 900); datei(a.audio, 'notiz.txt', MB, 900); datei(a.audio, `${sha('a')}.123.teil`, MB, 900);
  a.f32(sha('a'), MB, 900);
  const r = a.lauf({ deckel: 0 });
  assert.deepEqual(r.geloescht, [`${sha('a')}.f32`]);
  assert.deepEqual(fs.readdirSync(a.audio).sort(), ['freeze-1.f32', 'notiz.txt', `${sha('a')}.123.teil`].sort());
});

test('an unreadable project folder stops the run, logged once per start', (t) => {
  const a = aufbau(t);
  a.f32(sha('a'), MB, 900);
  projekt(a.wurzel, 'gut', sha('f'), '/x/z.wav');
  fs.mkdirSync(path.join(a.wurzel, 'kaputt')); fs.writeFileSync(path.join(a.wurzel, 'kaputt', 'project.json'), '{ not json');
  const gemeldet = new Set();
  assert.equal(a.lauf({ deckel: 0, gemeldet }), null);
  assert.equal(a.lauf({ deckel: 0, gemeldet }), null);
  assert.ok(fs.existsSync(path.join(a.audio, `${sha('a')}.f32`)), 'nothing was deleted');
  assert.deepEqual(a.logs, [{ typ: 'cache_deckel_projekt_unlesbar', slug: 'kaputt' }]);
});

test('a project folder without rights stops the run', (t) => {
  if (process.getuid?.() === 0) return t.skip('root ignores modes');
  const a = aufbau(t);
  a.f32(sha('a'), MB, 900);
  const ordner = projekt(a.wurzel, 'zu', sha('f'), '/x/z.wav');
  fs.chmodSync(path.join(ordner, 'project.json'), 0o000);
  t.after(() => { try { fs.chmodSync(path.join(ordner, 'project.json'), 0o644); } catch { /* the folder is already gone */ } });
  assert.equal(a.lauf({ deckel: 0 }), null);
  assert.ok(fs.existsSync(path.join(a.audio, `${sha('a')}.f32`)));
});

test('a dangling project link stops the run', (t) => {
  const a = aufbau(t);
  a.f32(sha('a'), MB, 900);
  fs.symlinkSync(path.join(a.d, 'pruefen-weg'), path.join(a.wurzel, 'ver'));
  assert.equal(a.lauf({ deckel: 0 }), null);
  assert.ok(fs.existsSync(path.join(a.audio, `${sha('a')}.f32`)));
});

test('a missing projects root counts as no projects', (t) => {
  const a = aufbau(t);
  a.f32(sha('a'), MB, 900);
  const r = a.lauf({ projekte: new Projekte(path.join(a.d, 'gibtsnicht')), deckel: 0 });
  assert.deepEqual(r.geloescht, [`${sha('a')}.f32`]);
});

test('opening a project touches the existing decodes of its clips', async (t) => {
  const d = tmpOrdner(t, 'djk-deckel-');
  const s = sha('e'), audio = path.join(d, 'arr', 'audio');
  const f = datei(audio, `${s}.f32`, 16, 7200);
  const { url } = await stapel(t, { katalog: baueKatalog(d, []), proj: { wurzel: path.join(d, 'proj'), arbeitsordner: path.join(d, 'arr') } });
  await ruf(url, 'POST', '/proj/neu', { name: 'Beruehrt' });
  assert.equal((await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'audio', name: 'G' }] })).code, 200);
  const slug = (await ruf(url, 'GET', '/proj/liste')).j[0].slug;
  const datei2 = path.join(d, 'proj', slug, 'project.json');
  const j = JSON.parse(fs.readFileSync(datei2, 'utf8'));
  j.spuren[0].clips = [{ id: 'c9', art: 'audio', name: 'c9', start_beat: 0, laenge_beats: 4, quelle: { sha256: s, pfad_hinweis: '' }, dekodiert: 'nein',
    offset_s: 0, gain_db: 0, fade_ein_beats: 0, fade_aus_beats: 0 }];
  j.naechste_id.clip = 10;
  fs.writeFileSync(datei2, JSON.stringify(j));
  const vorher = fs.statSync(f).mtimeMs;
  assert.equal((await ruf(url, 'POST', '/proj/oeffnen', { slug })).code, 200);
  assert.ok(fs.statSync(f).mtimeMs > vorher + 3600 * 1000, 'mtime moved to now by the open');
});

test('a sha only the undo history names is never deleted', (t) => {
  const a = aufbau(t);
  const ordner = projekt(a.wurzel, 'eins', sha('a'), '/x/a.wav');
  fs.writeFileSync(path.join(ordner, 'undo.jsonl'),
    `${JSON.stringify({ rev: 2, art: 'aendern', vor: { clips: [{ quelle: { sha256: sha('b'), pfad_hinweis: '/x/b.wav' } }] } })}\n`
    + `${JSON.stringify({ rev: 3, art: 'undo', bezug: 2, nach: { quelle: { sha256: sha('c') } } })}\n`);
  for (const c of 'abcd') a.f32(sha(c), MB, 900 - c.charCodeAt(0));
  const r = a.lauf({ deckel: 0 });
  assert.deepEqual(r.geloescht, [`${sha('d')}.f32`], 'b (clip deleted, only the history) and c (undo/redo entry) stay');
});

test('a sha in the history of a linked project is never deleted', (t) => {
  const a = aufbau(t);
  const pruefen = path.join(a.d, 'pruefen'); fs.mkdirSync(pruefen);
  const echt = projekt(pruefen, 'ver', sha('a'), '/x/a.wav');
  fs.writeFileSync(path.join(echt, 'undo.jsonl'), `{"vor":"${sha('b')}"}\n`);
  fs.symlinkSync(echt, path.join(a.wurzel, 'ver'));
  a.f32(sha('b'), MB, 900); a.f32(sha('c'), MB, 800);
  assert.deepEqual(a.lauf({ deckel: 0 }).geloescht, [`${sha('c')}.f32`]);
});

test('a hash that sits across a read chunk border is still found', (t) => {
  const a = aufbau(t);
  const ordner = projekt(a.wurzel, 'eins', sha('a'), '/x/a.wav');
  fs.writeFileSync(path.join(ordner, 'undo.jsonl'), ' '.repeat(256 * 1024 - 20) + sha('b') + '\n');
  a.f32(sha('b'), MB, 900);
  assert.deepEqual(a.lauf({ deckel: 0 }).geloescht, []);
});

test('an unreadable undo history stops the run', (t) => {
  const a = aufbau(t);
  const ordner = projekt(a.wurzel, 'eins', sha('a'), '/x/a.wav');
  fs.mkdirSync(path.join(ordner, 'undo.jsonl'));   // opens, but cannot be read: also true for root
  a.f32(sha('d'), MB, 900);
  assert.equal(a.lauf({ deckel: 0 }), null);
  assert.ok(fs.existsSync(path.join(a.audio, `${sha('d')}.f32`)));
  assert.deepEqual(a.logs, [{ typ: 'cache_deckel_projekt_unlesbar', slug: 'eins' }]);
});

test('a project without undo.jsonl is no error', (t) => {
  const a = aufbau(t);
  projekt(a.wurzel, 'eins', sha('a'), '/x/a.wav');
  a.f32(sha('d'), MB, 900);
  assert.deepEqual(a.lauf({ deckel: 0 }).geloescht, [`${sha('d')}.f32`]);
});

test('after a run that deleted nothing over the cap the next full run waits 10 minutes', (t) => {
  const a = aufbau(t);
  projekt(a.wurzel, 'eins', sha('a'), '/x/a.wav');
  a.f32(sha('a'), 2 * MB, 900);
  let jetzt = 1_000_000; const sperre = { bis: 0 };
  const lauf = () => a.lauf({ deckel: MB, sperre, jetzt: () => jetzt });
  assert.deepEqual(lauf().geloescht, []);
  const neu = a.f32(sha('d'), MB, 800);   // unnamed: deletable, but no full run happens inside the window
  jetzt += 9 * 60_000;
  assert.deepEqual(lauf().geloescht, []);
  assert.ok(fs.existsSync(neu));
  jetzt += 2 * 60_000;
  assert.deepEqual(lauf().geloescht, [`${sha('d')}.f32`], 'after 10 minutes the full run happens again');
  assert.equal(sperre.bis, 0, 'a run that deleted something sets no lock');
  a.f32(sha('e'), MB, 700);
  assert.deepEqual(lauf().geloescht, [`${sha('e')}.f32`], 'no lock: the next run is full at once');
});
