// Export into a chosen folder: POST /proj/export and /proj/export_spuren with `ordner`, and export_zeige for such a folder (areas/proj/output.ts).
// A temp folder is the only allowed root (AusgabeOptionen.erlaubt). Render stub as in proj_export_files.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { alsAntwort } from '../areas/proj/output.ts';
import { Einsammler } from '../project/einsammeln.ts';
import { baueNachExport } from '../project/exporte.ts';
import { aufbau } from './support/output_setup.mjs';

const mitUmgebung = async (werte, f) => {
  const alt = {};
  for (const [k, v] of Object.entries(werte)) { alt[k] = process.env[k]; process.env[k] = v; }
  try { return await f(); } finally { for (const [k, v] of Object.entries(alt)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};
const rufe = async (a, methode, d) => {
  try { return { code: 200, body: await mitUmgebung({ RENDER_ATTRAPPE_PROTOKOLL: path.join(a.tmp, 'render.jsonl'), TMPDIR: a.tmp }, () => a.ausgabe[methode](d)) }; }
  catch (e) { return alsAntwort(e); }
};
const dateien = (ordner) => fs.readdirSync(ordner).sort();
// the fixture plus a chosen folder that is the only allowed root; `ziel` is its realpath
async function mitZiel(t, opt = {}) {
  const ziel = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'djk-export-ziel-')));
  t.after(() => { try { fs.chmodSync(ziel, 0o700); } catch { /* gone */ } fs.rmSync(ziel, { recursive: true, force: true }); });
  const a = await aufbau(t, { opt: { erlaubt: () => [{ name: 'Test', pfad: ziel }], ...opt } });
  a.ziel = ziel;
  a.projektExport = path.join(a.offen().ordner, 'export');
  return a;
}
const projektDateien = (a) => (fs.existsSync(a.projektExport) ? dateien(a.projektExport) : []);

test('export with ordner: master and deliveries land in the chosen folder, the project export folder gets nothing', async (t) => {
  const a = await mitZiel(t);
  const r = await rufe(a, 'exportiere', { von_beat: 0, bis_beat: 8, ordner: a.ziel, abgabe: [{ format: 'wav', bits: 16 }, { format: 'mp3', kbps: 320 }] });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(path.dirname(r.body.datei), a.ziel);
  assert.deepEqual(r.body.abgaben.map((x) => path.dirname(x.datei)), [a.ziel, a.ziel]);
  const stamm = path.basename(r.body.datei, '.wav');
  assert.deepEqual(dateien(a.ziel), [`${stamm}.16bit-44k.wav`, `${stamm}.320kbps-44k.mp3`, `${stamm}.wav`].sort());
  assert.deepEqual(projektDateien(a), [], 'no copy stays in the project');
});

test('four exports in a row into the chosen folder: all stay, the bin stays empty, the older exports of the project are untouched', async (t) => {
  const protokoll = [];
  const haken = baueNachExport({ einsammler: new Einsammler({ wechselplatte: () => null, frei: () => true }), offen: () => null, quellPfad: () => null,
    log: (z) => protokoll.push(z) });
  const a = await mitZiel(t, { nachExport: haken });
  const slug = a.offen().slug;
  fs.mkdirSync(a.projektExport, { recursive: true });
  const alt = [1, 2, 3].map((n) => `${slug}-2026010${n}-100000.wav`);
  for (const n of alt) fs.writeFileSync(path.join(a.projektExport, n), n);
  const namen = [];
  for (let i = 0; i < 4; i++) {
    const r = await rufe(a, 'exportiere', { von_beat: 0, bis_beat: 4, ordner: a.ziel });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    namen.push(path.basename(r.body.datei));
  }
  assert.equal(new Set(namen).size, 4);
  assert.deepEqual(dateien(a.ziel), namen.sort());
  assert.deepEqual(projektDateien(a), alt, 'the three exports of the project stay');
  assert.equal(fs.existsSync(path.join(path.dirname(a.offen().ordner), '.papierkorb')), false, 'nothing in the bin');
  assert.deepEqual(protokoll, []);
});

test('export without ordner and with ordner null: the old behaviour, the tidy hook runs', async (t) => {
  const meldungen = [];
  const a = await mitZiel(t, { nachExport: (x) => meldungen.push(x) });
  for (const d of [{ von_beat: 0, bis_beat: 4 }, { von_beat: 0, bis_beat: 4, ordner: null }]) {
    const r = await rufe(a, 'exportiere', d);
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(path.dirname(r.body.datei), a.projektExport);
  }
  assert.equal(projektDateien(a).length, 2);
  assert.deepEqual(dateien(a.ziel), []);
  assert.equal(meldungen.length, 2);
});

test('export with ordner still reports to the collector but tidies nothing', async (t) => {
  const meldungen = [], einsammler = { melde: (x) => meldungen.push(x) };
  let a;
  const haken = baueNachExport({ einsammler, offen: () => ({ projekt: a.projekt(), ordner: a.offen().ordner }), quellPfad: () => null });
  a = await mitZiel(t, { nachExport: haken });
  const slug = a.offen().slug;
  fs.mkdirSync(a.projektExport, { recursive: true });
  const alt = [1, 2, 3, 4, 5].map((n) => `${slug}-2026010${n}-100000.wav`);
  for (const n of alt) fs.writeFileSync(path.join(a.projektExport, n), n);
  assert.equal((await rufe(a, 'exportiere', { von_beat: 0, bis_beat: 4, ordner: a.ziel })).code, 200);
  assert.equal(meldungen.length, 1, 'the collector was told');
  assert.deepEqual(projektDateien(a), alt, 'nothing was moved');
  assert.equal(fs.existsSync(path.join(path.dirname(a.offen().ordner), '.papierkorb')), false);
  assert.equal((await rufe(a, 'exportiere', { von_beat: 0, bis_beat: 4 })).code, 200);
  assert.equal(meldungen.length, 2);
  assert.ok(projektDateien(a).length < 6, 'without ordner the tidy rule runs');
});

test('the per-track set with ordner calls the hook without the tidy part', async (t) => {
  const meldungen = [];
  const a = await mitZiel(t, { nachExport: (x) => meldungen.push(x) });
  assert.equal((await rufe(a, 'exportiereSpuren', { von_beat: 0, bis_beat: 4, ordner: a.ziel })).code, 200);
  assert.equal(meldungen.length, 1);
  assert.equal(meldungen[0].ohneAufraeumen, true);
  assert.equal((await rufe(a, 'exportiereSpuren', { von_beat: 0, bis_beat: 4 })).code, 200);
  assert.equal(meldungen[1].ohneAufraeumen, undefined);
});

test('per-track set with ordner: the set folder is inside the chosen folder, with abgabe flac no float file is left', async (t) => {
  const a = await mitZiel(t);
  const r = await rufe(a, 'exportiereSpuren', { von_beat: 0, bis_beat: 8, ordner: a.ziel, abgabe: { format: 'flac', bits: 16 } });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(path.dirname(r.body.ordner), a.ziel);
  const namen = dateien(r.body.ordner);
  assert.ok(namen.includes('mix.flac'), namen.join());
  assert.deepEqual(namen.filter((n) => !n.endsWith('.flac')), [], 'only flac files, no float wav and no .teil');
  assert.deepEqual(projektDateien(a), []);
  const ohne = await rufe(a, 'exportiereSpuren', { von_beat: 0, bis_beat: 8 });
  assert.equal(ohne.code, 200, JSON.stringify(ohne.body));
  assert.equal(path.dirname(ohne.body.ordner), a.projektExport);
});

test('refusals: nothing is written, the lock is released, a following export works', async (t) => {
  const a = await mitZiel(t);
  const datei = path.join(a.ziel, 'eine-datei.txt');
  fs.writeFileSync(datei, 'x');
  const versteckt = path.join(a.ziel, '.versteckt'); fs.mkdirSync(versteckt);
  const faelle = [
    [5, 400, 'argument_ungueltig'], ['relativ/ordner', 400, 'argument_ungueltig'], ['', 400, 'argument_ungueltig'],
    [datei, 400, 'argument_ungueltig'],
    [path.join(a.ziel, 'gibt-es-nicht'), 404, 'pfad_fehlt'],
    [path.join(os.tmpdir(), 'ausserhalb-der-wurzel'), 403, 'pfad_ausserhalb'], [os.tmpdir(), 403, 'pfad_ausserhalb'],
    [versteckt, 403, 'pfad_ausserhalb'],
  ];
  for (const methode of ['exportiere', 'exportiereSpuren']) {
    for (const [ordner, code, grund] of faelle) {
      const r = await rufe(a, methode, { von_beat: 0, bis_beat: 4, ordner });
      assert.deepEqual([r.code, r.body.fehler], [code, grund], `${methode} ${JSON.stringify(ordner)}: ${JSON.stringify(r.body)}`);
      assert.match(r.body.text, /^[ -~]+$/, 'English literal text');
    }
    assert.deepEqual(dateien(a.ziel), ['.versteckt', 'eine-datei.txt']);
    assert.deepEqual(projektDateien(a), []);
    assert.deepEqual(a.ausgabe.zustand(), { lauf: null, wartend: 0, abbruch: 0 });
  }
  assert.equal(a.protokoll.gesendet.filter((x) => x.adresse === '/k/arr/freeze').length, 0, 'refused before any freeze');
  const ok = await rufe(a, 'exportiere', { von_beat: 0, bis_beat: 4, ordner: a.ziel });
  assert.equal(ok.code, 200, JSON.stringify(ok.body));
});

test('a read-only folder is refused as ordner_nicht_schreibbar before anything is written', { skip: process.getuid?.() === 0 }, async (t) => {
  const a = await mitZiel(t);
  const nur = path.join(a.ziel, 'nur-lesen'); fs.mkdirSync(nur); fs.chmodSync(nur, 0o500);
  for (const methode of ['exportiere', 'exportiereSpuren']) {
    const r = await rufe(a, methode, { von_beat: 0, bis_beat: 4, ordner: nur });
    assert.deepEqual([r.code, r.body.fehler], [403, 'ordner_nicht_schreibbar'], JSON.stringify(r.body));
    assert.match(r.body.text, /^[ -~]+$/);
  }
  assert.deepEqual(dateien(nur), []);
  assert.equal((await rufe(a, 'exportiere', { von_beat: 0, bis_beat: 4, ordner: a.ziel })).code, 200);
  fs.chmodSync(nur, 0o700);
});

test('a file with the name of the master already in the chosen folder keeps its bytes', async (t) => {
  const a = await mitZiel(t);
  const erster = await rufe(a, 'exportiere', { von_beat: 0, bis_beat: 4, ordner: a.ziel });
  assert.equal(erster.code, 200, JSON.stringify(erster.body));
  // the clock is fixed: the next master has the same stamp; the first file is overwritten by hand to see that it is never replaced
  fs.writeFileSync(erster.body.datei, 'mine');
  const zweiter = await rufe(a, 'exportiere', { von_beat: 0, bis_beat: 4, ordner: a.ziel });
  assert.equal(zweiter.code, 200, JSON.stringify(zweiter.body));
  assert.notEqual(zweiter.body.datei, erster.body.datei);
  assert.equal(fs.readFileSync(erster.body.datei, 'utf8'), 'mine');
});

test('export_zeige accepts the chosen folder and refuses one outside the roots', async (t) => {
  const a = await mitZiel(t);
  const r = await rufe(a, 'exportiere', { von_beat: 0, bis_beat: 4, ordner: a.ziel });
  assert.equal(r.code, 200);
  const unter = path.join(a.ziel, 'unter', 'tief'); fs.mkdirSync(unter, { recursive: true });
  const zeige = (d) => { try { return { code: 200, body: a.ausgabe.zeigeExport(d) }; } catch (e) { return alsAntwort(e); } };
  const alt = { d: process.env.DISPLAY, w: process.env.WAYLAND_DISPLAY };
  delete process.env.DISPLAY; delete process.env.WAYLAND_DISPLAY;       // an accepted folder ends in keine_arbeitsflaeche: xdg-open never starts
  try {
    assert.equal(zeige({ ordner: a.ziel }).body.fehler, 'keine_arbeitsflaeche', 'the chosen folder itself');
    assert.equal(zeige({ ordner: unter }).body.fehler, 'keine_arbeitsflaeche', 'a folder below it');
    for (const aussen of [os.tmpdir(), a.tmp]) {
      const x = zeige({ ordner: aussen });
      assert.deepEqual([x.code, x.body.fehler], [400, 'argument_ungueltig'], aussen);
    }
    assert.equal(zeige({ ordner: path.join(a.ziel, 'eine.txt') }).body.fehler, 'argument_ungueltig');
    fs.writeFileSync(path.join(a.ziel, 'eine.txt'), 'x');
    assert.equal(zeige({ ordner: path.join(a.ziel, 'eine.txt') }).body.fehler, 'argument_ungueltig', 'a file');
  } finally { if (alt.d !== undefined) process.env.DISPLAY = alt.d; if (alt.w !== undefined) process.env.WAYLAND_DISPLAY = alt.w; }
});

test('the helper file of the render (the controls file) is never written into the chosen folder', async (t) => {
  const a = await mitZiel(t);
  const r = await rufe(a, 'exportiere', { von_beat: 0, bis_beat: 4, ordner: a.ziel, abgabe: [{ format: 'wav', bits: 16 }] });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.deepEqual(dateien(a.ziel), [path.basename(r.body.datei), path.basename(r.body.abgaben[0].datei)].sort());
  const aufrufe = fs.readFileSync(path.join(a.tmp, 'render.jsonl'), 'utf8').trim().split('\n').map((z) => JSON.parse(z));
  const regler = aufrufe.map((x) => x.argv[x.argv.indexOf('--spur-regler') + 1]).filter(Boolean);
  assert.ok(regler.length > 0, 'the render got a controls file');
  for (const f of regler) assert.ok(!f.startsWith(a.ziel), `${f} lies outside the chosen folder`);
});

// ---- the export folder of the open project, and the projects folder ----
async function mitProjekten(t, opt = {}) {
  const a = await mitZiel(t, opt);
  a.ausgabe.opt.erlaubt = () => [{ name: 'Ziel', pfad: a.ziel }, { name: 'Tmp', pfad: fs.realpathSync(a.tmp) }];
  a.projekte = path.dirname(a.offen().ordner);
  return a;
}

test('ordner that is the export folder of the open project counts as not chosen: the tidy hook runs', async (t) => {
  const meldungen = [];
  const a = await mitProjekten(t, { nachExport: (x) => meldungen.push(x) });
  fs.mkdirSync(a.projektExport, { recursive: true });
  for (const ordner of [a.projektExport, `${a.projektExport}/../export`]) {
    const r = await rufe(a, 'exportiere', { von_beat: 0, bis_beat: 4, ordner });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(path.dirname(r.body.datei), fs.realpathSync(a.projektExport));
  }
  assert.equal(meldungen.length, 2);
  assert.ok(meldungen.every((x) => x.ohneAufraeumen === undefined));
});

test('ordner inside the projects folder (other than the open export folder) is refused', async (t) => {
  const a = await mitProjekten(t);
  const fremd = path.join(a.projekte, 'anderes-projekt', 'export'); fs.mkdirSync(fremd, { recursive: true });
  const papierkorb = path.join(a.projekte, '.papierkorb'); fs.mkdirSync(papierkorb, { recursive: true });
  const faelle = [a.projekte, a.offen().ordner, fremd, path.join(a.offen().ordner, 'export-unter'), papierkorb];
  fs.mkdirSync(faelle[3], { recursive: true });
  for (const methode of ['exportiere', 'exportiereSpuren']) {
    for (const ordner of faelle) {
      const r = await rufe(a, methode, { von_beat: 0, bis_beat: 4, ordner });
      assert.equal(r.code >= 400, true, `${ordner}`);
      if (ordner !== papierkorb) {
        assert.deepEqual([r.code, r.body.fehler, r.body.text],
          [400, 'argument_ungueltig', 'ordner: a folder inside the projects folder cannot be chosen; leave it out to export into the project'], ordner);
      }
    }
  }
  assert.deepEqual(dateien(fremd), []);
});

// ---- the chosen folder vanishes between the check and the write (a drive pulled out): never created again ----
test('a chosen folder that is gone at write time is not created again, nothing is left, the refusal is pfad_fehlt', async (t) => {
  for (const methode of ['exportiere', 'exportiereSpuren']) {
    const ziel = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'djk-export-weg-')));
    t.after(() => fs.rmSync(ziel, { recursive: true, force: true }));
    let scharf = false;                                                  // the clock is read after the check: the folder goes then
    const a = await aufbau(t, { opt: { erlaubt: () => [{ name: 'Test', pfad: path.dirname(ziel) }],
      jetzt: () => { if (scharf) fs.rmSync(ziel, { recursive: true, force: true }); return new Date(2026, 9, 15, 18, 15, 0); } } });
    scharf = true;
    const r = await rufe(a, methode, { von_beat: 0, bis_beat: 4, ordner: ziel });
    assert.deepEqual([r.code, r.body.fehler], [404, 'pfad_fehlt'], JSON.stringify(r.body));
    assert.equal(fs.existsSync(ziel), false, `${methode}: the folder was not created again`);
    assert.deepEqual(a.ausgabe.zustand(), { lauf: null, wartend: 0, abbruch: 0 });
  }
});
