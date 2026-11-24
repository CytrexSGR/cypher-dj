// Upload queue and type routing of the browser (browser plan 2, task 6).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ERLAUBT, pruefeDatei, routeFuerDatei, neueWarteschlange, zusammenfassung } from '../public/browser/einwurf.js';

// a minimal zip with empty entries: local headers, central directory, end record
function zip(namen, { flags = 0, pad = 0 } = {}) {
  const teile = [], zentral = [];
  let versatz = 0;
  for (const n of namen) {
    const nb = Buffer.from(n, 'utf8');
    const lokal = Buffer.alloc(30); lokal.writeUInt32LE(0x04034b50, 0); lokal.writeUInt16LE(flags, 6); lokal.writeUInt16LE(nb.length, 26);
    teile.push(lokal, nb);
    if (pad && n === namen[0]) { teile.push(Buffer.alloc(pad, 1)); versatz += pad; }
    const z = Buffer.alloc(46); z.writeUInt32LE(0x02014b50, 0); z.writeUInt16LE(flags, 8); z.writeUInt16LE(nb.length, 28); z.writeUInt32LE(versatz, 42);
    zentral.push(z, nb);
    versatz += 30 + nb.length;
  }
  const cd = Buffer.concat(zentral);
  const ende = Buffer.alloc(22); ende.writeUInt32LE(0x06054b50, 0); ende.writeUInt16LE(namen.length, 8); ende.writeUInt16LE(namen.length, 10);
  ende.writeUInt32LE(cd.length, 12); ende.writeUInt32LE(versatz, 16);
  return Buffer.concat([...teile, cd, ende]);
}
const blob = (buf, name) => Object.assign(new Blob([buf]), { name });
const datei = (name, size = 10) => ({ name, size, slice: () => new Blob([]) });

test('pruefeDatei: type and size, dot names are fine', () => {
  const a = pruefeDatei({ name: 'a.exe', size: 1 });
  assert.deepEqual([a.ok, a.grund], [false, 'typ']);
  assert.match(a.text, /wav/); assert.match(a.text, /mid/);
  const g = pruefeDatei({ name: 'Kick ä.WAV', size: 2147483649 });
  assert.deepEqual([g.ok, g.grund], [false, 'gross']);
  assert.match(g.text, /2147483649/);
  assert.equal(pruefeDatei({ name: '.hidden Kick ä.wav', size: 10 }).ok, true);
  assert.equal(pruefeDatei({ name: 'preset.json', size: 10 }).ok, true);
  assert.ok(ERLAUBT.includes('zip') && ERLAUBT.includes('midi'));
});

test('routeFuerDatei: plain files, presets and the headers per route', async () => {
  const wav = await routeFuerDatei(datei('.hidden Kick ä.wav'), 'bibliothek');
  assert.equal(wav.url, '/import/datei?name=.hidden%20Kick%20%C3%A4.wav&ziel=bibliothek');
  assert.equal(wav.art, 'audio');
  assert.deepEqual(wav.headers, { 'x-djk-roh': '1', 'Content-Type': 'application/octet-stream' });
  const mid = await routeFuerDatei(datei('kick.mid'));
  assert.deepEqual([mid.art, mid.url.startsWith('/import/datei?')], ['midi', true]);
  const p = await routeFuerDatei(datei('preset.json'));
  assert.deepEqual([p.art, p.url, p.headers], ['preset', '/presets/import', { 'Content-Type': 'application/json' }]);
});

test('routeFuerDatei over zips: project, kit, plain, one folder, deeper, broken, encrypted', async () => {
  const roh = { 'x-djk-roh': '1', 'Content-Type': 'application/octet-stream' };
  const r = async (namen, name = 'x.zip', opt) => routeFuerDatei(blob(zip(namen, opt), name));
  const pr = await r(['project.json', 'audio/a.wav']);
  assert.deepEqual([pr.art, pr.url, pr.headers], ['projekt', '/proj/import_zip', roh]);
  const kit = await r(['kit.json', '1.wav']);
  assert.deepEqual([kit.art, kit.url, kit.headers], ['kit', '/kits/import', roh]);
  assert.equal((await r(['a.wav', 'b.wav'])).art, 'zip');
  assert.equal((await r(['beat/project.json'])).art, 'projekt');
  assert.equal((await r(['x/y/project.json'])).art, 'zip');
  assert.equal((await r(['a/x.wav', 'b/project.json'])).art, 'zip');   // two top folders: as zipwerk.py, not a project
  assert.equal((await r(['beat/', 'beat/project.json'])).art, 'projekt');
  assert.equal((await r(['project.json'], 'x.zip', { flags: 1 })).art, 'zip');
  const kaputt = await routeFuerDatei(blob(Buffer.alloc(40, 7), 'a.zip'));
  assert.deepEqual([kaputt.art, kaputt.url.startsWith('/import/datei?')], ['zip', true]);
  assert.equal((await routeFuerDatei(blob(Buffer.alloc(3), 'tiny.zip'))).art, 'zip');
});

test('routeFuerDatei reads slices only, never the whole file', async () => {
  const b = blob(zip(['project.json'], { pad: 300000 }), 'big.zip');   // the directory lies inside the tail
  const slices = [];
  const orig = b.slice.bind(b);
  b.slice = (s, e) => { slices.push([s, e]); return orig(s, e); };
  b.arrayBuffer = () => { throw new Error('whole file read'); };
  assert.equal((await routeFuerDatei(b)).art, 'projekt');
  assert.ok(slices.length <= 2);
  // a long comment pushes the directory out of the tail: two slices, the second exactly the directory
  const kommentar = Buffer.alloc(65535, 0x20);
  const z = zip(['kit.json']); const ende = z.subarray(z.length - 22); ende.writeUInt16LE(kommentar.length, 20);
  const lang = blob(Buffer.concat([z, kommentar]), 'c.zip');
  const sl2 = []; const o2 = lang.slice.bind(lang); lang.slice = (s, e) => { sl2.push([s, e]); return o2(s, e); };
  lang.arrayBuffer = () => { throw new Error('whole file read'); };
  const rr = await routeFuerDatei(lang);
  assert.ok(sl2.length <= 2);
  assert.ok(['zip', 'kit'].includes(rr.art));   // a comment longer than the tail hides the end record: plain zip is the safe answer
});

function fake(opt = {}) {
  const s = { aktiv: 0, max: 0, urls: [], headers: [] };
  s.sende = async (d, route) => {
    s.aktiv++; s.max = Math.max(s.max, s.aktiv); s.urls.push(route.url); s.headers.push(route.headers);
    await new Promise((ok) => setImmediate(ok));
    s.aktiv--;
    return opt.antwort?.(d, route) ?? { status: 200, j: { ok: true, art: route.art } };
  };
  return s;
}
const dateien = (n, name = (i) => `f${i}.wav`) => Array.from({ length: n }, (_, i) => datei(name(i)));

test('queue: 20 files, at most 2 at a time, all done', async () => {
  const f = fake();
  const q = neueWarteschlange({ sende: f.sende, beiAenderung() {} });
  q.fuegeHinzu(dateien(20), 'bibliothek');
  await q.sobaldLeer();
  assert.deepEqual([q.stand().fertig, q.stand().gesamt, q.stand().laeuft, f.max], [20, 20, false, 2]);
});

test('queue: 2,000 files finish and the concurrency stays 2', async () => {
  const f = fake();
  const q = neueWarteschlange({ sende: f.sende, beiAenderung() {} });
  q.fuegeHinzu(dateien(2000));
  await q.sobaldLeer();
  assert.deepEqual([q.stand().gesamt, q.stand().fertig, f.max], [2000, 2000, 2]);
});

test('queue: a 413 lists that file, the others complete; refused files never start an upload', async () => {
  const f = fake({ antwort: (d) => (d.name === 'f3.wav' ? { status: 413, j: { text: 'too big' } } : { status: 200, j: {} }) });
  const q = neueWarteschlange({ sende: f.sende, beiAenderung() {} });
  q.fuegeHinzu([...dateien(6), datei('virus.exe')]);
  await q.sobaldLeer();
  const s = q.stand();
  assert.deepEqual([s.fertig, s.gesamt], [7, 7]);
  assert.deepEqual(s.fehler.map((x) => x.name).sort(), ['f3.wav', 'virus.exe']);
  assert.equal(s.fehler.find((x) => x.name === 'f3.wav').text, 'too big');
  assert.equal(f.urls.length, 6);
});

test('queue: a 404 on /import/datei stops after one call; a 404 on /kits/import marks only the kit zip', async () => {
  const f = fake({ antwort: () => ({ status: 404, j: null }) });
  const q = neueWarteschlange({ sende: f.sende, beiAenderung() {} });
  q.fuegeHinzu(dateien(10));
  await q.sobaldLeer();
  assert.equal(f.urls.length, 1);
  assert.match(q.stand().fehler[0].text, /not available/);
  assert.equal(q.stand().laeuft, false);
  assert.deepEqual([q.stand().fehler.length, q.stand().nichtGesendet.length, q.stand().fertig], [1, 9, 10]);

  const k = fake({ antwort: (d, route) => (route.url.startsWith('/kits/') ? { status: 404, j: null } : { status: 200, j: {} }) });
  const q2 = neueWarteschlange({ sende: k.sende, beiAenderung() {} });
  q2.fuegeHinzu([blob(zip(['kit.json', '1.wav']), 'k.zip'), ...dateien(5)]);
  await q2.sobaldLeer();
  assert.equal(k.urls.length, 6);
  assert.deepEqual(q2.stand().fehler.map((x) => x.name), ['k.zip']);
  assert.match(q2.stand().fehler[0].text, /kit import/);
});

test('queue: the sent URL carries the encoded name, headers reach sende, results carry slug and renamed kits', async () => {
  const f = fake({ antwort: (d, route) => ({ status: 200, j: route.art === 'projekt' ? { ok: true, slug: 'p1', kits_umbenannt: ['a'] } : { ok: true, sha256: 'ab', art: 'audio' } }) });
  const q = neueWarteschlange({ sende: f.sende, beiAenderung() {} });
  q.fuegeHinzu([datei('.hidden Kick ä.wav'), blob(zip(['project.json']), 'p.zip')], 'bibliothek');
  await q.sobaldLeer();
  assert.ok(f.urls.some((u) => u.includes('name=.hidden%20Kick%20%C3%A4.wav')));
  assert.ok(f.headers.every((h) => h['x-djk-roh'] === '1'));
  const e = q.ergebnisse();
  assert.deepEqual(e.find((x) => x.art === 'projekt'), { art: 'projekt', name: 'p.zip', slug: 'p1', kits_umbenannt: ['a'] });
  assert.equal(e.find((x) => x.art === 'audio').sha256, 'ab');
});

test('probe A: 404 on /import/datei, 10 wavs: one call, 1 failed, 9 not sent, the line says 0 of 10 added', async () => {
  const f = fake({ antwort: () => ({ status: 404, j: null }) });
  const q = neueWarteschlange({ sende: f.sende, beiAenderung() {} });
  q.fuegeHinzu(dateien(10));
  await q.sobaldLeer();
  const s = q.stand();
  assert.deepEqual([f.urls.length, s.fehler.length, s.nichtGesendet.length, s.fertig, s.gesamt], [1, 1, 9, 10, 10]);
  const z = zusammenfassung(s);
  assert.match(z.text, /^0 of 10 files added/);
  assert.match(z.text, /1 failed/); assert.match(z.text, /9 not sent: Import is not available/);
  assert.equal(z.fehler, true);
});

test('probe C: a 404 on /import/datei blocks only that route, the preset file still goes', async () => {
  const f = fake({ antwort: (d, route) => (route.url.startsWith('/import/datei') ? { status: 404, j: null } : { status: 200, j: { ok: true } }) });
  const q = neueWarteschlange({ sende: f.sende, beiAenderung() {} });
  q.fuegeHinzu([datei('a.wav'), datei('b.wav'), datei('p.json'), datei('c.wav')]);
  await q.sobaldLeer();
  const s = q.stand();
  assert.ok(f.urls.includes('/presets/import'));
  assert.deepEqual([s.fehler.length, s.nichtGesendet.length, q.ergebnisse().length], [1, 2, 1]);
  assert.match(zusammenfassung(s).text, /^1 of 4 files added/);
});

test('probe D: abbrechen does not leave the queue halted; unstarted files are not sent, the running upload is aborted', async () => {
  let abgebrochen = 0;
  const sende = (d, route, signal) => new Promise((ok, nein) => { signal.addEventListener('abort', () => { abgebrochen++; nein(new Error('aborted')); }); });
  const q = neueWarteschlange({ sende, beiAenderung() {} });
  q.fuegeHinzu(dateien(5));
  await new Promise((ok) => setImmediate(ok));
  q.abbrechen();
  await q.sobaldLeer();
  assert.equal(abgebrochen, 1);
  const s = q.stand();
  assert.deepEqual([s.fertig, s.gesamt, s.nichtGesendet.length, s.fehler.length], [5, 5, 5, 0]);
  const f = fake();
  const q2 = neueWarteschlange({ sende: f.sende, beiAenderung() {} });
  q2.fuegeHinzu(dateien(3)); q2.abbrechen(); await q2.sobaldLeer();
  q2.fuegeHinzu(dateien(4)); await q2.sobaldLeer();
  assert.deepEqual([q2.stand().fertig, q2.stand().gesamt, q2.ergebnisse().length], [4, 4, 4]);
});
