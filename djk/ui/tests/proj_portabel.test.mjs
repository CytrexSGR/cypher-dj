// Browser plan 5, tasks 5 to 7: collect the kits, export and import a project as one zip. Temp folders only (own kit folder, own project root).
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Router } from '../http/router.ts';
import { json, quelleAusKopf } from '../http/transport.ts';
import { portabelBereich } from '../areas/proj/portabel_routes.ts';
import { Projekte } from '../project/storage.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { exportiereProjekt, importiereProjektZip, projektAusserhalb, raeumeProjektReste } from '../project/project_zip.ts';
import { sammleKitsEin } from '../project/kits_einsammeln.ts';
import { listeKitsAlle, kitInhaltHash } from '../project/kit_storage.ts';
import { schreibeKit, schreibeZip, tmpOrdner } from './support/kit_build.mjs';

const gerat = (kit) => ({ art: 'intern', name: 'kit', kit });
const projektMit = (...kits) => ({ spuren: kits.map((k, i) => ({ id: `s${i}`, geraet: gerat(k) })) });
const aufbau = (t) => {
  const d = tmpOrdner(t, 'portabel-');
  const kits = path.join(d, 'kits'), po = path.join(d, 'projekt');
  fs.mkdirSync(kits); fs.mkdirSync(po);
  return { d, kits, po };
};

// ---- task 5: collect the kits ----

test('collect copies the kits a project names into kits/<name>', async (t) => {
  const { kits, po } = aufbau(t);
  schreibeKit(path.join(kits, 'drums')); schreibeKit(path.join(kits, 'perc'), { noten: [40] }); schreibeKit(path.join(kits, 'unused'));
  const r = await sammleKitsEin({ projekt: projektMit('drums', 'perc'), projektOrdner: po, kitsOrdner: kits });
  assert.deepEqual(r, { kopiert: ['drums', 'perc'], schon_da: [], fehlt: [] });
  assert.equal(await kitInhaltHash(path.join(po, 'kits', 'drums')), await kitInhaltHash(path.join(kits, 'drums')));
  assert.deepEqual(fs.readdirSync(path.join(po, 'kits')).sort(), ['drums', 'perc']);
});

test('a second collect reports schon_da and copies nothing', async (t) => {
  const { kits, po } = aufbau(t);
  schreibeKit(path.join(kits, 'drums'));
  await sammleKitsEin({ projekt: projektMit('drums'), projektOrdner: po, kitsOrdner: kits });
  const m = fs.statSync(path.join(po, 'kits', 'drums', 'kit.json')).mtimeMs;
  const r = await sammleKitsEin({ projekt: projektMit('drums'), projektOrdner: po, kitsOrdner: kits });
  assert.deepEqual(r, { kopiert: [], schon_da: ['drums'], fehlt: [] });
  assert.equal(fs.statSync(path.join(po, 'kits', 'drums', 'kit.json')).mtimeMs, m);
});

test('a kit missing in the global folder is listed in fehlt and collect still succeeds', async (t) => {
  const { kits, po } = aufbau(t);
  schreibeKit(path.join(kits, 'da'));
  const r = await sammleKitsEin({ projekt: projektMit('weg', 'da', '../x'), projektOrdner: po, kitsOrdner: kits });
  assert.deepEqual(r, { kopiert: ['da'], schon_da: [], fehlt: ['weg'] });
});

test('a project without kit tracks adds no kits folder', async (t) => {
  const { kits, po } = aufbau(t);
  const r = await sammleKitsEin({ projekt: { spuren: [{ id: 'a', geraet: { art: 'intern', name: 'rb338' } }] }, projektOrdner: po, kitsOrdner: kits });
  assert.deepEqual(r, { kopiert: [], schon_da: [], fehlt: [] });
  assert.equal(fs.existsSync(path.join(po, 'kits')), false);
});

test('a replaced project kit moves to kits/.alt-<time> and listeKitsAlle does not list it', async (t) => {
  const { kits, po } = aufbau(t);
  schreibeKit(path.join(kits, 'k'), { fuell: 0.1 });
  schreibeKit(path.join(po, 'kits', 'k'), { fuell: 0.5 });
  const r = await sammleKitsEin({ projekt: projektMit('k'), projektOrdner: po, kitsOrdner: kits });
  assert.deepEqual(r.kopiert, ['k']);
  assert.equal(await kitInhaltHash(path.join(po, 'kits', 'k')), await kitInhaltHash(path.join(kits, 'k')));
  const alt = fs.readdirSync(path.join(po, 'kits')).filter((n) => n.startsWith('.alt-'));
  assert.equal(alt.length, 1);
  assert.equal(fs.existsSync(path.join(po, 'kits', alt[0], 'k', 'kit.json')), true);
  assert.deepEqual(listeKitsAlle(po, { kitsOrdner: kits }).filter((z) => z.quelle === 'projekt').map((z) => z.name), ['k']);
});

test('a copy that does not fit (injected frei) answers platte_voll and leaves no partial folder', async (t) => {
  const { kits, po } = aufbau(t);
  schreibeKit(path.join(kits, 'k'));
  await assert.rejects(sammleKitsEin({ projekt: projektMit('k'), projektOrdner: po, kitsOrdner: kits, frei: () => 1000 }), (e) => e.code === 507 && e.grund === 'platte_voll');
  assert.equal(fs.existsSync(path.join(po, 'kits')), false);
});

// ---- tasks 6 and 7: export and import of a project ----

const SHA = crypto.createHash('sha256').update('kick-bytes').digest('hex');   // the real sha of the audio file baueProjekt writes
const ROH = { 'x-djk-roh': '1', 'content-type': 'application/octet-stream' };
const hand = { 'x-djk-quelle': 'cypher' };

/** A real stored project in `<d>/projekte`: a kit track for `kit`, an audio track with one clip (sha SHA) and a Surge track whose freeze is set. */
function baueProjekt(d, { kit = 'drums', clip = true, freeze = true, wurzel = path.join(d, 'projekte') } = {}) {
  const projekte = new Projekte(wurzel);
  const { slug, projekt } = projekte.lege('Song');
  const opt = { kitDa: () => true };
  let p = fuehreListeAus(projekt, [{ befehl: 'spur_neu', art: 'instrument', geraet: gerat(kit) }], opt).projekt;
  if (clip) {
    p = fuehreListeAus(p, [{ befehl: 'spur_neu', art: 'audio', name: 'Drums' }], opt).projekt;
    p = fuehreListeAus(p, [{ befehl: 'clip_neu', spur_id: p.spuren.at(-1).id, art: 'audio', start_beat: 0, laenge_beats: 1, sha256: SHA }], opt).projekt;
  }
  if (freeze) {
    p = fuehreListeAus(p, [{ befehl: 'spur_neu', art: 'instrument', geraet: { art: 'wirt', name: 'surge', slot: 1 } }], opt).projekt;
    p.spuren.at(-1).freeze = { datei: 'freeze-1-5.f32', sha256: 'cd'.repeat(32), frames: 48000, kennung: 5 };
  }
  projekte.speichere(slug, p);
  const ordner = path.join(wurzel, slug);
  if (clip) { fs.mkdirSync(path.join(ordner, 'audio'), { recursive: true }); fs.writeFileSync(path.join(ordner, 'audio', `kick-${SHA.slice(0, 8)}.wav`), 'kick-bytes'); }
  return { projekte, slug, ordner, wurzel, projekt: projekte.lies(slug) };
}
const namenImZip = (zip) => JSON.parse(execFileSync('python3', ['-I', '-c', 'import sys,json,zipfile\nprint(json.dumps(zipfile.ZipFile(sys.argv[1]).namelist()))', zip], { encoding: 'utf8' }));
const wurzelListe = (w) => (fs.existsSync(w) ? fs.readdirSync(w).sort() : []);

// a server around the portable routes: the open project is whatever `offen` returns
async function stapelPortabel(t, { offen = null, quellPfad = () => null, kits, maxBytes, frei, mitKit = offen !== null } = {}) {
  const d = tmpOrdner(t, 'portabel-r-');
  const wurzel = path.join(d, 'projekte');
  const kitsOrdner = kits ?? path.join(d, 'kits');
  fs.mkdirSync(kitsOrdner, { recursive: true });
  if (mitKit) schreibeKit(path.join(kitsOrdner, 'drums'));   // baueProjekt names the kit `drums`; the export takes it from the kit folder
  const router = new Router();
  let quelle = 'andreas', port = 0;
  const zustand = { offen };
  router.melde(portabelBereich({ log: () => {}, quelle: () => quelle }, { offen: () => zustand.offen }, { projekteWurzel: () => wurzel, quellPfad, kitsOrdner, port: () => port, maxBytes, frei }));
  const server = http.createServer(async (q, a) => {
    quelle = quelleAusKopf(q);
    const url = new URL(q.url ?? '/', 'http://127.0.0.1');
    const r = router.finde(q.method ?? '', url.pathname);
    if (!r) return json(a, 404, { fehler: 'keine_route' });
    await r.handler(q, a, url);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  port = server.address().port;
  t.after(() => server.close());
  const ruf = async (methode, pfad, o = {}) => {
    const r = await fetch(`http://127.0.0.1:${port}${pfad}`, { method: methode, headers: o.kopf, body: o.body });
    const buf = Buffer.from(await r.arrayBuffer());
    const j = (r.headers.get('content-type') ?? '').includes('json') ? JSON.parse(buf.toString('utf8')) : null;
    return { code: r.status, j, buf, kopf: r.headers };
  };
  return { d, wurzel, kitsOrdner, port, ruf, zustand };
}
const offenVon = (b) => ({ slug: b.slug, ordner: b.ordner, projekt: b.projekt });

// ---- task 6 ----

test('export of a collected project holds project.json, audio/, kits/ and no .versionen/', async (t) => {
  const { d, kits } = aufbau(t);
  schreibeKit(path.join(kits, 'drums'));
  const b = baueProjekt(d);
  await sammleKitsEin({ projekt: b.projekt, projektOrdner: b.ordner, kitsOrdner: kits });
  fs.mkdirSync(path.join(b.ordner, '.versionen', 'v1'), { recursive: true }); fs.writeFileSync(path.join(b.ordner, '.versionen', 'v1', 'project.json'), '{}');
  const zip = path.join(d, 'out.zip');
  await exportiereProjekt({ ordner: b.ordner, zip });
  const n = namenImZip(zip);
  assert.ok(n.includes('project.json') && n.includes(`audio/kick-${SHA.slice(0, 8)}.wav`) && n.includes('kits/drums/kit.json') && n.includes('undo.jsonl'), n.join(','));
  assert.equal(n.some((x) => x.startsWith('.versionen')), false);
});

test('.versionen, .papierkorb, aufnahmen/.laufend-x.json and kits/.alt-x are not in the zip while aufnahmen/take.wav is', async (t) => {
  const { d, kits } = aufbau(t);
  schreibeKit(path.join(kits, 'drums'));
  const b = baueProjekt(d, { clip: false, freeze: false });
  for (const f of ['.versionen/a.json', '.papierkorb/x/y.json', 'aufnahmen/.laufend-x.json', 'aufnahmen/take.wav', 'kits/.alt-1/k/kit.json', 'kits/.einspielen-ab/kit.json', 'x.teil', '.sperre']) {
    fs.mkdirSync(path.dirname(path.join(b.ordner, f)), { recursive: true }); fs.writeFileSync(path.join(b.ordner, f), 'x');
  }
  const zip = path.join(d, 'out.zip');
  await exportiereProjekt({ ordner: b.ordner, zip, kitsOrdner: kits });
  assert.deepEqual(namenImZip(zip).sort(), ['aufnahmen/take.wav', 'kits/drums/36.f32', 'kits/drums/37.f32', 'kits/drums/kit.json', 'project.json', 'undo.jsonl']);
});

test('a source with a collected copy in audio/ counts as collected although quellPfad still resolves to the original', (t) => {
  const { d } = aufbau(t);
  const b = baueProjekt(d, { freeze: false });
  const original = path.join(d, 'draussen.wav'); fs.writeFileSync(original, 'x');
  assert.deepEqual(projektAusserhalb({ projekt: b.projekt, projektOrdner: b.ordner, quellPfad: () => original }), []);
  fs.rmSync(path.join(b.ordner, 'audio'), { recursive: true });
  assert.deepEqual(projektAusserhalb({ projekt: b.projekt, projektOrdner: b.ordner, quellPfad: () => original }), [original]);
  assert.deepEqual(projektAusserhalb({ projekt: b.projekt, projektOrdner: b.ordner, quellPfad: () => null }), [], 'a missing source does not block');
  const innen = path.join(b.ordner, 'media', 'k.wav'); fs.mkdirSync(path.dirname(innen), { recursive: true }); fs.writeFileSync(innen, 'x');
  assert.deepEqual(projektAusserhalb({ projekt: b.projekt, projektOrdner: b.ordner, quellPfad: () => innen }), [], 'a path inside the folder is collected');
});

test('a loop cell source outside the folder and not collected is listed, and the same cell collected passes', (t) => {
  const { d } = aufbau(t);
  const ordner = path.join(d, 'pj'); fs.mkdirSync(ordner);
  const original = path.join(d, 'loop.wav'); fs.writeFileSync(original, 'x');
  const projekt = { spuren: [{ id: 'a', clips: [], zellen: [{ id: 'z1', sha256: SHA, pfad_hinweis: 'loop.wav' }, null] }] };
  const q = (sha) => (sha === SHA ? original : null);
  assert.deepEqual(projektAusserhalb({ projekt, projektOrdner: ordner, quellPfad: q }), [original]);
  fs.mkdirSync(path.join(ordner, 'audio')); fs.writeFileSync(path.join(ordner, 'audio', `loop-${SHA.slice(0, 8)}.wav`), 'x');
  assert.deepEqual(projektAusserhalb({ projekt, projektOrdner: ordner, quellPfad: q }), []);
});

test('route: export of an uncollected project is 409 nicht_eingesammelt with the count; collected, a missing source and a symlinked folder export', async (t) => {
  const { d } = aufbau(t);
  const b = baueProjekt(d, { freeze: false });
  fs.rmSync(path.join(b.ordner, 'audio'), { recursive: true });
  const original = path.join(d, 'draussen.wav'); fs.writeFileSync(original, 'x');
  const s = await stapelPortabel(t, { offen: offenVon(b), quellPfad: () => original });
  const nein = await s.ruf('GET', `/proj/export_zip?slug=${b.slug}`);
  assert.deepEqual([nein.code, nein.j.grund, nein.j.fehler], [409, 'nicht_eingesammelt', 'nicht_eingesammelt']);
  assert.match(nein.j.text, /^1 audio file .*collect all first/);
  assert.deepEqual(wurzelListe(s.wurzel), [], 'no temp folder stays');
  s.zustand.offen = offenVon(b);
  // the file is missing now: it does not block
  const s2 = await stapelPortabel(t, { offen: offenVon(b), quellPfad: () => null });
  const ja = await s2.ruf('GET', `/proj/export_zip?slug=${b.slug}`);
  assert.equal(ja.code, 200);
  assert.equal(ja.kopf.get('content-disposition'), `attachment; filename="${b.slug}.cypherdj.zip"`);
  assert.equal(ja.buf.subarray(0, 2).toString(), 'PK');
  // the project folder is a symlink
  const link = path.join(d, 'link'); fs.symlinkSync(b.ordner, link);
  const s3 = await stapelPortabel(t, { offen: { ...offenVon(b), ordner: link }, quellPfad: () => null });
  assert.equal((await s3.ruf('GET', `/proj/export_zip?slug=${b.slug}`)).code, 200);
});

test('route: the download is a zip with POSIX paths, and the temp zip is gone after the answer', async (t) => {
  const { d } = aufbau(t);
  const b = baueProjekt(d, { freeze: false });
  const s = await stapelPortabel(t, { offen: offenVon(b) });
  const r = await s.ruf('GET', `/proj/export_zip?slug=${b.slug}`);
  assert.equal(r.code, 200);
  const zip = path.join(d, 'got.zip'); fs.writeFileSync(zip, r.buf);
  const n = namenImZip(zip);
  assert.ok(n.includes(`audio/kick-${SHA.slice(0, 8)}.wav`) && n.every((x) => !x.includes('\\') && !x.startsWith('/')));
  await new Promise((ok) => setTimeout(ok, 200));   // the server removes its temp folder when the response closes
  assert.deepEqual(wurzelListe(s.wurzel), []);
});

test('route: another slug is 409 projekt_nicht_offen, no open project too', async (t) => {
  const { d } = aufbau(t);
  const b = baueProjekt(d, { freeze: false });
  const s = await stapelPortabel(t, { offen: offenVon(b) });
  assert.deepEqual([(await s.ruf('GET', '/proj/export_zip?slug=anderes')).code, (await s.ruf('GET', '/proj/export_zip?slug=anderes')).j.grund], [409, 'projekt_nicht_offen']);
  s.zustand.offen = null;
  assert.equal((await s.ruf('GET', `/proj/export_zip?slug=${b.slug}`)).j.grund, 'projekt_nicht_offen');
});

test('route: non-owner is 403 nur_andreas, a foreign Host 421 falscher_host, the tablet is shut out', async (t) => {
  const { d } = aufbau(t);
  const b = baueProjekt(d, { freeze: false });
  const s = await stapelPortabel(t, { offen: offenVon(b) });
  const h = await s.ruf('GET', `/proj/export_zip?slug=${b.slug}`, { kopf: hand });
  assert.deepEqual([h.code, h.j.grund], [403, 'nur_andreas']);
  const fremd = await new Promise((ok) => http.get({ host: '127.0.0.1', port: s.port, path: `/proj/export_zip?slug=${b.slug}`, headers: { host: 'evil.example' } }, (res) => {
    let x = ''; res.on('data', (c) => { x += c; }); res.on('end', () => ok({ code: res.statusCode, j: JSON.parse(x) }));
  }));
  assert.deepEqual([fremd.code, fremd.j.grund], [421, 'falscher_host']);
  const { tabletVerboten } = await import('../http/coupling.ts');
  assert.equal(tabletVerboten('GET', '/proj/export_zip'), true);
  assert.equal(tabletVerboten('POST', '/proj/import_zip'), true);
});

test('route: no free space (injected) is 507 platte_voll and no temp zip stays', async (t) => {
  const { d } = aufbau(t);
  const b = baueProjekt(d, { freeze: false });
  const s = await stapelPortabel(t, { offen: offenVon(b), frei: () => 1000 });
  const r = await s.ruf('GET', `/proj/export_zip?slug=${b.slug}`);
  assert.deepEqual([r.code, r.j.grund], [507, 'platte_voll']);
  assert.deepEqual(wurzelListe(s.wurzel), []);
});

// ---- task 7 ----

/** The zip of a stored project (kits collected from `kits`), plus the target: another project root and kit folder. */
async function zipVonProjekt(t, { kitFuell = 0.1 } = {}) {
  const d = tmpOrdner(t, 'portabel-i-');
  const quellKits = path.join(d, 'quell-kits'), zielKits = path.join(d, 'ziel-kits'), zielWurzel = path.join(d, 'ziel-projekte');
  fs.mkdirSync(quellKits); fs.mkdirSync(zielKits);
  schreibeKit(path.join(quellKits, 'drums'), { fuell: kitFuell });
  const b = baueProjekt(d);
  await sammleKitsEin({ projekt: b.projekt, projektOrdner: b.ordner, kitsOrdner: quellKits });
  const zip = path.join(d, 'song.cypherdj.zip');
  await exportiereProjekt({ ordner: b.ordner, zip });
  return { d, b, zip, quellKits, zielKits, zielWurzel, projekte: new Projekte(zielWurzel), o: { kitsOrdner: zielKits } };
}
const kitVonSpur = (p) => p.spuren.map((s) => s.geraet?.kit).filter(Boolean);
const rohPost = (s, body, kopf = ROH) => s.ruf('POST', '/proj/import_zip', { kopf, body });

test('round trip: collect, export, import gives a new slug with the same clips, kit name and device values', async (t) => {
  const x = await zipVonProjekt(t);
  const r = await importiereProjektZip(x.zip, { projekte: x.projekte, ...x.o });
  assert.deepEqual(r, { slug: 'song', kits_umbenannt: [] });
  const neu = x.projekte.lies('song');
  assert.deepEqual(kitVonSpur(neu), ['drums']);
  assert.deepEqual(neu.spuren.find((s) => s.clips?.length)?.clips[0].quelle.sha256, SHA);
  assert.equal(fs.readFileSync(path.join(x.zielWurzel, 'song', 'audio', `kick-${SHA.slice(0, 8)}.wav`), 'utf8'), 'kick-bytes');
  assert.equal(fs.readFileSync(path.join(x.zielWurzel, 'song', 'undo.jsonl'), 'utf8'), '');
  assert.equal(neu.wiedergabe_rev, 0);
  assert.deepEqual(wurzelListe(x.zielWurzel), ['song'], 'the dot folder is gone');
  assert.equal(await kitInhaltHash(path.join(x.zielKits, 'drums')), await kitInhaltHash(path.join(x.quellKits, 'drums')));
  const zwei = await importiereProjektZip(x.zip, { projekte: x.projekte, ...x.o });
  assert.equal(zwei.slug, 'song-2', 'a second import claims the next slug');
  assert.deepEqual(x.projekte.liste().map((e) => e.slug).sort(), ['song', 'song-2']);
});

test('import resets freeze to null on a track that had one', async (t) => {
  const x = await zipVonProjekt(t);
  assert.equal(x.b.projekt.spuren.some((s) => s.freeze && typeof s.freeze === 'object'), true, 'the source had a freeze');
  await importiereProjektZip(x.zip, { projekte: x.projekte, ...x.o });
  const neu = x.projekte.lies('song');
  assert.equal(neu.spuren.filter((s) => s.freeze !== undefined).every((s) => s.freeze === null), true);
});

test('kit with other content under the same name installs as name-sha8, the reference follows and the own kits folder is renamed', async (t) => {
  const x = await zipVonProjekt(t, { kitFuell: 0.1 });
  schreibeKit(path.join(x.zielKits, 'drums'), { fuell: 0.9 });
  const r = await importiereProjektZip(x.zip, { projekte: x.projekte, ...x.o });
  assert.equal(r.kits_umbenannt.length, 1);
  const { alt, neu } = r.kits_umbenannt[0];
  assert.equal(alt, 'drums');
  assert.match(neu, /^drums-[0-9a-f]{8}$/);
  assert.deepEqual(kitVonSpur(x.projekte.lies(r.slug)), [neu]);
  assert.equal(fs.existsSync(path.join(x.zielWurzel, r.slug, 'kits', neu, 'kit.json')), true);
  assert.equal(fs.existsSync(path.join(x.zielWurzel, r.slug, 'kits', 'drums')), false);
  assert.deepEqual(fs.readdirSync(x.zielKits).sort(), ['drums', neu], 'the old kit stays as it was');
  // the same zip again reuses the renamed kit: no third copy
  const noch = await importiereProjektZip(x.zip, { projekte: x.projekte, ...x.o });
  assert.deepEqual(noch.kits_umbenannt, [{ alt, neu }]);
  assert.deepEqual(fs.readdirSync(x.zielKits).sort(), ['drums', neu]);
});

test('identical kit already installed: kits_umbenannt is empty', async (t) => {
  const x = await zipVonProjekt(t, { kitFuell: 0.1 });
  schreibeKit(path.join(x.zielKits, 'drums'), { fuell: 0.1 });
  const r = await importiereProjektZip(x.zip, { projekte: x.projekte, ...x.o });
  assert.deepEqual(r.kits_umbenannt, []);
  assert.deepEqual(fs.readdirSync(x.zielKits), ['drums']);
});

test('a kits/.alt-x folder and a kits/Bad Name folder in the zip are not installed', async (t) => {
  const x = await zipVonProjekt(t);
  const roh = (p) => fs.readFileSync(path.join(x.b.ordner, p));
  const kit = (pre) => ({ [`${pre}/kit.json`]: roh('kits/drums/kit.json'), ...Object.fromEntries(fs.readdirSync(path.join(x.b.ordner, 'kits', 'drums')).filter((n) => n.endsWith('.f32')).map((n) => [`${pre}/${n}`, roh(`kits/drums/${n}`)])) });
  const zip = schreibeZip(path.join(x.d, 'extra.zip'), { 'project.json': roh('project.json'), ...kit('kits/drums'), ...kit('kits/.alt-1/drums'), ...kit('kits/Bad Name') });
  await importiereProjektZip(zip, { projekte: x.projekte, ...x.o });
  assert.deepEqual(fs.readdirSync(x.zielKits), ['drums']);
});

test('refusals write nothing: no project.json, a ../ entry, an invalid project.json, a broken kit, no free space', async (t) => {
  const x = await zipVonProjekt(t);
  const roh = (p) => fs.readFileSync(path.join(x.b.ordner, p));
  fs.mkdirSync(x.zielWurzel);
  const vorher = () => JSON.stringify([wurzelListe(x.zielWurzel), wurzelListe(x.zielKits)]);
  const stand = vorher();
  const kaputtKit = { 'kits/drums/kit.json': '{"schema":1,"name":"drums","klaenge":[{"note":36,"name":"bd","datei":"36.f32","frames":100}]}', 'kits/drums/36.f32': 'tiny', 'kits/gut/kit.json': roh('kits/drums/kit.json') };
  const faelle = [
    ['projekt_json_fehlt', 400, { 'x.txt': 'x' }],
    ['zip_abgelehnt', 400, { '../x': 'x', 'project.json': roh('project.json') }],
    ['projekt_ungueltig', 409, { 'project.json': '{"format":"nope"}' }],
    ['kit_ungueltig', 400, { 'project.json': roh('project.json'), ...kaputtKit }],
  ];
  for (const [grund, code, eintraege] of faelle) {
    const zip = schreibeZip(path.join(x.d, `${grund}.zip`), eintraege);
    await assert.rejects(importiereProjektZip(zip, { projekte: x.projekte, ...x.o }), (e) => e.grund === grund && e.code === code, grund);
    assert.equal(vorher(), stand, `${grund} left something behind`);
  }
  await assert.rejects(importiereProjektZip(x.zip, { projekte: x.projekte, ...x.o, frei: () => 1000 }), (e) => e.code === 507 && e.grund === 'platte_voll');
  assert.equal(vorher(), stand);
});

test('route: import answers ok, the project is listed and opens, nothing is opened', async (t) => {
  const x = await zipVonProjekt(t);
  const s = await stapelPortabel(t, { kits: x.zielKits });
  const r = await rohPost(s, fs.readFileSync(x.zip));
  assert.deepEqual([r.code, r.j], [200, { ok: true, slug: 'song', kits_umbenannt: [] }]);
  const p = new Projekte(s.wurzel);
  assert.deepEqual(p.liste().map((e) => e.slug), ['song']);
  assert.equal(p.lies('song').name, 'Song');
  assert.deepEqual(wurzelListe(s.wurzel), ['song']);
});

test('route: import as non-owner is 403, without x-djk-roh 403 roh_ohne_kopf, a refused zip leaves nothing', async (t) => {
  const x = await zipVonProjekt(t);
  const s = await stapelPortabel(t, { kits: x.zielKits });
  const body = fs.readFileSync(x.zip);
  const h = await rohPost(s, body, { ...ROH, ...hand });
  assert.deepEqual([h.code, h.j.grund], [403, 'nur_andreas']);
  const ohne = await rohPost(s, body, { 'content-type': 'application/octet-stream' });
  assert.deepEqual([ohne.code, ohne.j.grund], [403, 'roh_ohne_kopf']);
  const schlecht = await rohPost(s, Buffer.from('not a zip'));
  assert.deepEqual([schlecht.code, schlecht.j.grund], [400, 'zip_abgelehnt']);
  assert.deepEqual(wurzelListe(s.wurzel), []);
  assert.deepEqual(fs.readdirSync(x.zielKits), []);
});

// ---- review round 2: kits travel with the export, hints never carry a path of this machine, import details ----

const eintraegeVon = (ordner, unter) => {
  const e = {};
  for (const n of fs.readdirSync(ordner)) e[`${unter}/${n}`] = fs.readFileSync(path.join(ordner, n));
  return e;
};
const zipText = (zip, name) => execFileSync('python3', ['-I', '-c', 'import sys,zipfile\nsys.stdout.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]).decode())', zip, name], { encoding: 'utf8' });
const mitHinweis = (b, hinweis) => {
  const p = b.projekte.lies(b.slug);
  for (const s of p.spuren) for (const c of s.clips) if (c.art === 'audio') c.quelle.pfad_hinweis = hinweis;
  b.projekte.speichere(b.slug, p);
};

test('export takes a kit that is only in the kit folder along (kits/<name>/ in the zip), the project folder stays untouched', async (t) => {
  const { d, kits } = aufbau(t);
  schreibeKit(path.join(kits, 'drums'));
  const b = baueProjekt(d, { freeze: false });
  const zip = path.join(d, 'o.zip');
  await exportiereProjekt({ ordner: b.ordner, zip, kitsOrdner: kits });
  const n = namenImZip(zip);
  assert.ok(n.includes('kits/drums/kit.json') && n.includes('kits/drums/36.f32'), n.join(','));
  assert.equal(fs.existsSync(path.join(b.ordner, 'kits')), false);
});

test('export prefers the project kit over the kit folder of the same name', async (t) => {
  const { d, kits } = aufbau(t);
  schreibeKit(path.join(kits, 'drums'), { fuell: 0.1 });
  const b = baueProjekt(d, { freeze: false });
  await sammleKitsEin({ projekt: b.projekt, projektOrdner: b.ordner, kitsOrdner: kits });
  fs.rmSync(path.join(kits, 'drums'), { recursive: true }); schreibeKit(path.join(kits, 'drums'), { fuell: 0.9 });
  const zip = path.join(d, 'o.zip');
  await exportiereProjekt({ ordner: b.ordner, zip, kitsOrdner: kits });
  const eigen = fs.readFileSync(path.join(b.ordner, 'kits', 'drums', '36.f32'));
  const im = execFileSync('python3', ['-I', '-c', 'import sys,zipfile\nsys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))', zip, 'kits/drums/36.f32']);
  assert.deepEqual(im, eigen);
});

test('route: a kit found nowhere is 409 kit_fehlt naming it, and nothing stays behind', async (t) => {
  const { d } = aufbau(t);
  const b = baueProjekt(d, { freeze: false });
  const s = await stapelPortabel(t, { offen: offenVon(b), mitKit: false });
  const r = await s.ruf('GET', `/proj/export_zip?slug=${b.slug}`);
  assert.deepEqual([r.code, r.j.grund, r.j.fehler], [409, 'kit_fehlt', 'kit_fehlt']);
  assert.match(r.j.text, /drums/);
  assert.deepEqual(wurzelListe(s.wurzel), []);
});

test('export rewrites an absolute audio hint to the copy in audio/, and drops one without a copy; the project folder keeps its file', async (t) => {
  const { d, kits } = aufbau(t);
  schreibeKit(path.join(kits, 'drums'));
  const b = baueProjekt(d, { freeze: false });
  mitHinweis(b, '/home/entwickler/Musik/kick.wav');
  const zip = path.join(d, 'o.zip');
  await exportiereProjekt({ ordner: b.ordner, zip, kitsOrdner: kits });
  const j = zipText(zip, 'project.json');
  assert.equal(j.includes('/home/entwickler'), false);
  const hinweise = JSON.parse(j).spuren.flatMap((s) => s.clips.map((c) => c.quelle.pfad_hinweis));
  assert.deepEqual(hinweise, [`audio/kick-${SHA.slice(0, 8)}.wav`]);
  assert.match(fs.readFileSync(path.join(b.ordner, 'project.json'), 'utf8'), /\/home\/entwickler\/Musik\/kick\.wav/, 'the stored project is not changed');
  fs.rmSync(path.join(b.ordner, 'audio'), { recursive: true });
  const zip2 = path.join(d, 'o2.zip');
  await exportiereProjekt({ ordner: b.ordner, zip: zip2, kitsOrdner: kits });
  assert.deepEqual(JSON.parse(zipText(zip2, 'project.json')).spuren.flatMap((s) => s.clips.map((c) => c.quelle.pfad_hinweis)), ['']);
});

test('import rewrites every hint to the local copy by sha: a foreign zip cannot point a clip at a file of this machine (H9)', async (t) => {
  const x = await zipVonProjekt(t);
  const fremd = path.join(x.d, 'geheim.wav'); fs.writeFileSync(fremd, 'secret');
  const andere = 'cd'.repeat(32);
  const spurId = x.b.projekt.spuren.find((q) => q.clips.length).id;
  const pj = fuehreListeAus(x.b.projekt, [{ befehl: 'clip_neu', spur_id: spurId, art: 'audio', start_beat: 2, laenge_beats: 1, sha256: andere }], { kitDa: () => true }).projekt;
  for (const q of pj.spuren) for (const c of q.clips) if (c.art === 'audio') c.quelle.pfad_hinweis = fremd;
  const e = { 'project.json': JSON.stringify(pj), 'undo.jsonl': '', [`audio/kick-${SHA.slice(0, 8)}.wav`]: 'kick-bytes', ...eintraegeVon(path.join(x.b.ordner, 'kits', 'drums'), 'kits/drums') };
  const zip = schreibeZip(path.join(x.d, 'fremd.zip'), e);
  const r = await importiereProjektZip(zip, { projekte: x.projekte, ...x.o });
  const neu = x.projekte.lies(r.slug);
  const hin = neu.spuren.flatMap((s) => s.clips.filter((c) => c.art === 'audio').map((c) => [c.quelle.sha256.slice(0, 4), c.quelle.pfad_hinweis]));
  assert.deepEqual(hin.sort(), [[SHA.slice(0, 4), `audio/kick-${SHA.slice(0, 8)}.wav`], ['cdcd', '']]);
  assert.equal(JSON.stringify(neu).includes(fremd), false);
});

test('import: a rename chain moves every reference once (k to k-h, and the zip kit k-h to k-h-h2)', async (t) => {
  const d = tmpOrdner(t, 'portabel-k-');
  const zielKits = path.join(d, 'ziel-kits'); fs.mkdirSync(zielKits);
  const a = schreibeKit(path.join(d, 'a-kit'), { fuell: 0.1 });
  const c = schreibeKit(path.join(d, 'c-kit'), { fuell: 0.2 });
  const n1 = `k-${(await kitInhaltHash(a)).slice(0, 8)}`;           // where kit k lands when the kit folder holds another k
  const n2 = `${n1}-${(await kitInhaltHash(c)).slice(0, 8)}`;       // where the zip kit n1 lands when the kit folder holds another n1
  schreibeKit(path.join(zielKits, 'k'), { fuell: 0.9 });
  const projekte = new Projekte(path.join(d, 'ziel-projekte'));
  const { projekt } = new Projekte(path.join(d, 'quell')).lege('Kette');
  let p = fuehreListeAus(projekt, [{ befehl: 'spur_neu', art: 'instrument', geraet: gerat('k') }, { befehl: 'spur_neu', art: 'instrument', geraet: gerat(n1) }], { kitDa: () => true }).projekt;
  const zip = schreibeZip(path.join(d, 'kette.zip'), { 'project.json': JSON.stringify(p), 'undo.jsonl': '', ...eintraegeVon(a, 'kits/k'), ...eintraegeVon(c, `kits/${n1}`) });
  const r = await importiereProjektZip(zip, { projekte, kitsOrdner: zielKits });
  assert.deepEqual(r.kits_umbenannt, [{ alt: 'k', neu: n1 }, { alt: n1, neu: n2 }]);
  assert.deepEqual(kitVonSpur(projekte.lies(r.slug)), [n1, n2], 'the first track is not pushed on to n2');
  assert.deepEqual(fs.readdirSync(path.join(d, 'ziel-projekte', r.slug, 'kits')).sort(), [n1, n2].sort());
  assert.equal(await kitInhaltHash(path.join(zielKits, n1)), await kitInhaltHash(a));
  assert.equal(await kitInhaltHash(path.join(zielKits, n2)), await kitInhaltHash(c));
});

test('import: `kits` as a file in the zip is 400, not 500; a kit the project does not name is not installed', async (t) => {
  const x = await zipVonProjekt(t);
  const pj = fs.readFileSync(path.join(x.b.ordner, 'project.json'), 'utf8');
  const datei = schreibeZip(path.join(x.d, 'f.zip'), { 'project.json': pj, 'undo.jsonl': '', kits: 'I am a file' });
  await assert.rejects(importiereProjektZip(datei, { projekte: x.projekte, ...x.o }), (e) => e.code === 400 && e.grund === 'kit_ungueltig');
  assert.deepEqual(wurzelListe(x.zielWurzel), []);
  const mehr = schreibeZip(path.join(x.d, 'm.zip'), { 'project.json': pj, 'undo.jsonl': '', ...eintraegeVon(path.join(x.b.ordner, 'kits', 'drums'), 'kits/drums'),
    ...eintraegeVon(path.join(x.b.ordner, 'kits', 'drums'), 'kits/unbenutzt') });
  await importiereProjektZip(mehr, { projekte: x.projekte, ...x.o });
  assert.deepEqual(fs.readdirSync(x.zielKits), ['drums']);
});

test('route: a German message of the project check reaches the user in English (unknown field)', async (t) => {
  const x = await zipVonProjekt(t);
  const pj = JSON.parse(fs.readFileSync(path.join(x.b.ordner, 'project.json'), 'utf8'));
  pj.unsinn = 1;
  const zip = schreibeZip(path.join(x.d, 'u.zip'), { 'project.json': JSON.stringify(pj), 'undo.jsonl': '' });
  const s = await stapelPortabel(t, { kits: x.zielKits });
  const r = await rohPost(s, fs.readFileSync(zip));
  assert.deepEqual([r.code, r.j.grund], [409, 'projekt_ungueltig']);
  assert.match(r.j.text, /unknown field/);
  assert.equal(/unbekannt|[äöü]/.test(r.j.text), false, r.j.text);
});

test('export of a project beyond the zip limit says so in English (413, 4 GiB)', async (t) => {
  const { d, kits } = aufbau(t);
  schreibeKit(path.join(kits, 'drums'));
  const b = baueProjekt(d, { freeze: false });
  const gross = path.join(b.ordner, 'aufnahmen', 'riesig.wav');
  fs.mkdirSync(path.dirname(gross), { recursive: true }); fs.writeFileSync(gross, ''); fs.truncateSync(gross, 4 * 2 ** 30 + 1);   // sparse
  await assert.rejects(exportiereProjekt({ ordner: b.ordner, zip: path.join(d, 'o.zip'), kitsOrdner: kits, frei: () => 2 ** 50 }),
    (e) => e.code === 413 && e.grund === 'zip_abgelehnt' && /larger than 4 GiB/.test(e.text) && !/zu_gross/.test(e.text));
});

test('raeumeProjektReste removes old .import-*, .einspielen-*, .export-* folders and keeps young ones and projects; the route does it at start', async (t) => {
  const d = tmpOrdner(t, 'portabel-s-');
  const wurzel = path.join(d, 'projekte');
  const alt = new Date(Date.now() - 3600_000);
  for (const n of ['.import-a', '.einspielen-b', '.export-c', '.import-jung', 'song']) fs.mkdirSync(path.join(wurzel, n), { recursive: true });
  for (const n of ['.import-a', '.einspielen-b', '.export-c', 'song']) fs.utimesSync(path.join(wurzel, n), alt, alt);
  assert.equal(raeumeProjektReste(wurzel), 3);
  assert.deepEqual(wurzelListe(wurzel), ['.import-jung', 'song']);
  fs.mkdirSync(path.join(wurzel, '.export-zweit')); fs.utimesSync(path.join(wurzel, '.export-zweit'), alt, alt);
  portabelBereich({ log: () => {}, quelle: () => 'andreas' }, { offen: () => null }, { projekteWurzel: () => wurzel, quellPfad: () => null });
  assert.deepEqual(wurzelListe(wurzel), ['.import-jung', 'song']);
  assert.equal(raeumeProjektReste(path.join(d, 'gibt-es-nicht')), 0);
});

test('import refuses an audio file whose real sha differs from the one project.json names (409 audio_sha_falsch), nothing is installed', async (t) => {
  const x = await zipVonProjekt(t);
  const pj = fs.readFileSync(path.join(x.b.ordner, 'project.json'), 'utf8');
  const e = { 'project.json': pj, 'undo.jsonl': '', [`audio/kick-${SHA.slice(0, 8)}.wav`]: 'other bytes', ...eintraegeVon(path.join(x.b.ordner, 'kits', 'drums'), 'kits/drums') };
  const zip = schreibeZip(path.join(x.d, 'falsch.zip'), e);
  await assert.rejects(importiereProjektZip(zip, { projekte: x.projekte, ...x.o }), (f) => f.code === 409 && f.grund === 'audio_sha_falsch' && f.detail === `audio/kick-${SHA.slice(0, 8)}.wav` && /kick/.test(f.text));
  assert.deepEqual(wurzelListe(x.zielWurzel), [], 'no project, no temp folder');
  assert.deepEqual(fs.readdirSync(x.zielKits), [], 'no kit installed');
  const s = await stapelPortabel(t, { kits: x.zielKits });
  const r = await rohPost(s, fs.readFileSync(zip));
  assert.deepEqual([r.code, r.j.grund, r.j.fehler], [409, 'audio_sha_falsch', 'audio_sha_falsch']);
  assert.match(r.j.text, /audio\/kick-/);
  // a decoy with the same sha8 next to the right file is refused too
  const mix = schreibeZip(path.join(x.d, 'mix.zip'), { ...e, [`audio/kick-${SHA.slice(0, 8)}.wav`]: 'kick-bytes', [`audio/aaa-${SHA.slice(0, 8)}.wav`]: 'decoy' });
  await assert.rejects(importiereProjektZip(mix, { projekte: x.projekte, ...x.o }), (f) => f.grund === 'audio_sha_falsch');
});
