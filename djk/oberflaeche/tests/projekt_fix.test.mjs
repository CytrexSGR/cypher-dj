// D1 S2-Kern, Fix-Runde nach den Reviews (Spec Fassung 2.1, Abschnitt 6). Jeder Test hier war vor dem Fix rot (Belege: ~/messungen/2026-10-15-d1-s2kern/fix/).
// Neue Schnittstellen werden über Namensräume angesprochen, damit ein fehlender Name den einen Test rot macht und nicht die ganze Datei.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import * as WIEDERGABE from '../projekt/wiedergabe.ts';
import * as BEFEHLE from '../projekt/befehle.ts';
import * as VERLAUF from '../projekt/verlauf.ts';
import * as ABLAGE from '../projekt/ablage.ts';
import * as PATCH from '../projekt/patch.ts';
import { DekodierCache } from '../projekt/dekodier.ts';
import { pruefeProjekt, kanonisch, neuesProjekt } from '../projekt/modell.ts';
import { tmpOrdner, specProjekt, kopie, zufall, ohneAbgeleitetes, mitVon, SHA_A, SHA_B } from './hilfen/projekt.mjs';

const { fuehreAus, fuehreListeAus, BefehlFehler, gleicheDekodiertAb } = BEFEHLE;
const { Projekte, AblageFehler } = ABLAGE;
const { Verlauf, aendere, rueckgaengig, VerlaufFehler } = VERLAUF;
const A = { quelle: 'andreas', label: 'Test' };
const sha = (c) => c.repeat(64);
const AUDIO = '/arbeit/arr/audio';
const opt = (extra = {}) => ({ audioOrdner: AUDIO, frames: () => 24000, ...extra });
const zeilen = (d) => fs.readFileSync(d, 'utf8').split('\n').filter(Boolean).map((z) => JSON.parse(z));
const istLog = (fd) => { try { return fs.readlinkSync(`/proc/self/fd/${fd}`).endsWith('undo.jsonl'); } catch { return false; } };   // writeFileSync ruft intern fs.writeSync
const FREEZE = { datei: 'freeze/s3-7.f32', frames: 96000, kennung: 7, sha256: SHA_B };

// ---------------------------------------------------------------------------------------------------------------------
// 6.2 freeze.kennung ist int, freeze.sha256 wird beim Einfrieren berechnet
test('6.2 freeze: kennung als ganze Zahl und sha256 sind gültig (Rundlauf über die Ablage); Text-Kennung, Bruch, negativ, zu groß, fehlende sha256 nicht', (t) => {
  const p = specProjekt(); p.spuren[2].freeze = kopie(FREEZE);
  assert.ok(pruefeProjekt(p).projekt, JSON.stringify(pruefeProjekt(p)));
  const w = tmpOrdner(t); const pr = new Projekte(w); const { slug } = pr.lege('Frost');
  pr.speichere(slug, p); assert.equal(kanonisch(pr.lies(slug)), kanonisch(mitVon(p)), 'speichern und lesen mit Zahl-Kennung');
  const schlecht = (aendere2, muster) => {
    const q = specProjekt(); q.spuren[2].freeze = kopie(FREEZE); aendere2(q.spuren[2].freeze);
    const r = pruefeProjekt(q); assert.ok('fehler' in r && muster.test(r.fehler), `${JSON.stringify(r).slice(0, 120)}`);
  };
  schlecht((f) => { f.kennung = '7'; }, /kennung/); schlecht((f) => { f.kennung = 1.5; }, /kennung/); schlecht((f) => { f.kennung = -1; }, /kennung/);
  schlecht((f) => { f.kennung = 2 ** 31; }, /kennung/); schlecht((f) => { delete f.sha256; }, /sha256/); schlecht((f) => { f.sha256 = 'XYZ'; }, /sha256/);
  schlecht((f) => { f.sha256 = SHA_B.toUpperCase().replace(/B/g, 'B'); }, /sha256/);
});

test('6.2 Mutation: freeze.datei mit ".." oder absolut wird abgelehnt (Pfad-Traversal), auch mitten im Pfad', () => {
  for (const d of ['a/../../x', '../x', '/etc/passwd', '', 'freeze/../../x']) {
    const q = specProjekt(); q.spuren[2].freeze = { ...kopie(FREEZE), datei: d };
    const r = pruefeProjekt(q); assert.ok('fehler' in r && /freeze\.datei/.test(r.fehler), `${d}: ${JSON.stringify(r).slice(0, 100)}`);
  }
  const ok = specProjekt(); ok.spuren[2].freeze = { ...kopie(FREEZE), datei: 'freeze/s3-7.f32' }; assert.ok(pruefeProjekt(ok).projekt, 'harmloser Pfad geht');
});

test('6.2 Übersetzer nimmt die sha256 aus freeze.sha256 und liest die Freeze-Datei nicht (kein readFileSync auf ihr)', (t) => {
  const d = tmpOrdner(t); fs.mkdirSync(path.join(d, 'freeze'));
  const datei = path.join(d, 'freeze', 's3-7.f32'); fs.writeFileSync(datei, Buffer.alloc(800, 3));
  const p = specProjekt(); p.spuren[2].freeze = { ...kopie(FREEZE), frames: 100 };
  const orig = fs.readFileSync; const gelesen = [];
  fs.readFileSync = (f, ...r) => { gelesen.push(String(f)); return orig(f, ...r); };
  let w;
  try { w = WIEDERGABE.uebersetze(p, opt({ nr: 1, arbeitsordner: d })); } finally { fs.readFileSync = orig; }
  assert.equal(w.spuren[2].clips[0].sha256, SHA_B, 'sha aus dem Projekt, nicht aus dem Inhalt der Datei');
  assert.ok(!gelesen.includes(datei), `Freeze-Datei darf nicht gelesen werden (gelesen: ${gelesen.join(',')})`);
  fs.rmSync(datei);
  assert.throws(() => WIEDERGABE.uebersetze(p, opt({ nr: 1, arbeitsordner: d })), (e) => e.grund === 'datei_fehlt', 'fehlende Datei bleibt ein Fehler');
});

// ---------------------------------------------------------------------------------------------------------------------
// 6.1 Wiedergabe-Nummer je Instanz
test('6.1 Wiedergabe-Datei trägt "nr" (nicht "rev") und heißt wiedergabe-<nr>.json; ohne nr kein Übersetzen', () => {
  const w = WIEDERGABE.uebersetze(specProjekt(), opt({ nr: 42 }));
  assert.equal(w.nr, 42); assert.equal('rev' in w, false); assert.deepEqual(Object.keys(w), ['format', 'nr', 'spuren']);
  assert.equal(WIEDERGABE.wiedergabeDatei('/x', 42), '/x/wiedergabe-42.json');
  assert.throws(() => WIEDERGABE.uebersetze(specProjekt(), opt()), (e) => e.grund === 'nr_ungueltig');
});

test('6.1 Zähler: fortlaufend über Projekte hinweg, nach Neustart aus dem Arbeitsordner wiederhergestellt; Fremdnamen zählen nicht', (t) => {
  const d = path.join(tmpOrdner(t), 'arr');
  const z = new WIEDERGABE.WiedergabeZaehler(d);
  assert.deepEqual([z.naechste(), z.naechste()], [1, 2], 'leerer/fehlender Ordner: beginnt bei 1');
  const A1 = specProjekt(); A1.rev = 47; const B1 = specProjekt(); B1.name = 'B'; B1.rev = 47;      // beide Projekte haben rev 47
  const pfade = new Set();
  for (let i = 0; i < 6; i++) { const proj = i % 2 ? B1 : A1; pfade.add(WIEDERGABE.schreibeWiedergabe(d, WIEDERGABE.uebersetze(proj, opt({ nr: z.naechste() })))); }
  assert.equal(pfade.size, 6, 'gleiche Projekt-rev, aber sechs verschiedene Dateien: nichts wird überschrieben');
  fs.writeFileSync(path.join(d, 'wiedergabe-abc.json'), '{}'); fs.writeFileSync(path.join(d, 'wiedergabe-9999.json.bak'), '{}');
  const z2 = new WIEDERGABE.WiedergabeZaehler(d);
  assert.equal(z2.naechste(), 9, 'Neustart: höchste vorhandene Nummer (8) plus 1; Fremdnamen zählen nicht');
});

test('6.1 behalten werden die 5 zuletzt geschriebenen, auch wenn zwei Projekte abwechselnd schreiben (Probe des Reviews: A rev 44..50, danach B rev 3..6)', (t) => {
  const d = tmpOrdner(t); const z = new WIEDERGABE.WiedergabeZaehler(d); const geschrieben = [];
  const projA = specProjekt(); const projB = specProjekt(); projB.name = 'B';
  for (let rev = 44; rev <= 50; rev++) { projA.rev = rev; const nr = z.naechste(); WIEDERGABE.schreibeWiedergabe(d, WIEDERGABE.uebersetze(projA, opt({ nr }))); geschrieben.push(nr); }
  for (let rev = 3; rev <= 6; rev++) { projB.rev = rev; const nr = z.naechste(); WIEDERGABE.schreibeWiedergabe(d, WIEDERGABE.uebersetze(projB, opt({ nr }))); geschrieben.push(nr); }
  const da = fs.readdirSync(d).filter((n) => /^wiedergabe-\d+\.json$/.test(n)).map((n) => Number(/\d+/.exec(n)[0])).sort((a, b) => a - b);
  assert.deepEqual(da, geschrieben.slice(-5), 'genau die fünf zuletzt geschriebenen');
  assert.equal(JSON.parse(fs.readFileSync(path.join(d, `wiedergabe-${geschrieben.at(-1)}.json`), 'utf8')).nr, geschrieben.at(-1));
});

// ---------------------------------------------------------------------------------------------------------------------
// 6.4 RB-338-Parameter gegen die Liste
test('6.4 RB-338: nur lautstaerke, wellenform, cutoff, resonanz, env_mod, decay, accent; alles andere argument_unbekannt (Befehl) bzw. ungültig (Datei)', () => {
  const ids = ['lautstaerke', 'wellenform', 'cutoff', 'resonanz', 'env_mod', 'decay', 'accent'];
  const parameter = Object.fromEntries(ids.map((k, i) => [k, i / 10]));
  const r = fuehreAus(neuesProjekt('R'), { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'intern', parameter } });
  assert.deepEqual(r.projekt.spuren[0].geraet.parameter, parameter, 'alle sieben gehen');
  for (const falsch of ['gibtsnicht', 'volume', 'resonance', 'square']) {
    assert.throws(() => fuehreAus(neuesProjekt('R'), { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'intern', parameter: { [falsch]: 0.5 } } }),
      (e) => e instanceof BefehlFehler && e.grund === 'argument_unbekannt' && e.message.includes(falsch), falsch);
    const q = specProjekt(); q.spuren[1].geraet.parameter = { [falsch]: 0.5 };
    const g = pruefeProjekt(q); assert.ok('fehler' in g && /parameter/.test(g.fehler), `Datei mit ${falsch}: ${JSON.stringify(g).slice(0, 100)}`);
  }
  const ok = specProjekt(); ok.spuren[1].geraet.parameter = parameter; assert.ok(pruefeProjekt(ok).projekt);
});

// ---------------------------------------------------------------------------------------------------------------------
// 6.8 spur_aendern ohne slot behält den Slot
// Spec 6.28: in D1 gibt es nur Slot 1; früher prüfte dieser Test die Spur in Slot 2 (Slot 1 frei), das Projekt wäre jetzt ungültig
test('6.8 spur_aendern geraet {art:wirt} ohne slot auf der Surge-Spur (Slot 1): Slot bleibt, Freeze bleibt, kein Eintrag', () => {
  const p = specProjekt(); p.spuren[2].freeze = kopie(FREEZE);
  const r = fuehreAus(p, { befehl: 'spur_aendern', spur_id: 's3', geraet: { art: 'wirt' } });
  assert.equal(r.projekt.spuren[2].geraet.slot, 1); assert.deepEqual(r.projekt.spuren[2].freeze, FREEZE);
  assert.deepEqual(r.vor, [], 'nichts geändert, also kein Patch'); assert.equal(r.betrifft_wiedergabe, false);
  const frei = fuehreAus(p, { befehl: 'spur_aendern', spur_id: 's3', geraet: { art: 'intern', name: 'rb338' } }).projekt;
  const ausIntern = fuehreAus(frei, { befehl: 'spur_aendern', spur_id: 's2', geraet: { art: 'wirt' } });
  assert.equal(ausIntern.projekt.spuren[1].geraet.slot, 1, 'eine Spur ohne eigenen Wirt-Slot bekommt den ersten freien');
  assert.equal(fuehreAus(p, { befehl: 'spur_aendern', spur_id: 's3', geraet: { art: 'wirt', slot: 1 } }).projekt.spuren[2].geraet.slot, 1, 'ausdrücklicher Slot gilt');
});

// ---------------------------------------------------------------------------------------------------------------------
// 6.3 Mono ohne Pegelverlust
function wavDatei(dir, name, kanaele, dauer = 0.25) {
  const p = path.join(dir, name);
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${dauer}:sample_rate=48000`, '-ac', String(kanaele), '-y', p]);
  return p;
}
const f32 = (datei) => { const b = fs.readFileSync(datei); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); };
const spitze = (f, k, schritt) => { let m = 0; for (let i = k; i < f.length; i += schritt) m = Math.max(m, Math.abs(f[i])); return m; };
function quellSpitze(datei) {
  const b = execFileSync('ffmpeg', ['-v', 'error', '-i', datei, '-map', '0:a:0', '-af', 'pan=mono|c0=c0', '-f', 'f32le', '-'], { maxBuffer: 1 << 26 });
  const f = new Float32Array(b.buffer, b.byteOffset, b.length / 4); return spitze(f, 0, 1);
}
function aufruf(dir) {
  const log = path.join(dir, 'ff-args.log'); const wrap = path.join(dir, 'ffw.sh');
  fs.writeFileSync(wrap, `#!/bin/sh\necho "$*" >> "${log}"\nexec ffmpeg "$@"\n`, { mode: 0o755 });
  return { wrap, args: () => fs.readFileSync(log, 'utf8') };
}

test('6.3 Mono-Quelle: Pegel bleibt (Spitze links = Spitze der Quelle, links = rechts), pan-Filter statt -ac 2', async (t) => {
  const dir = tmpOrdner(t); const w = aufruf(dir); const c = new DekodierCache(path.join(dir, 'arr'), { ffmpeg: [w.wrap] });
  const q = wavDatei(dir, 'mono.wav', 1); const soll = quellSpitze(q);
  c.fordereAn(sha('1'), q); assert.equal(await c.bereit(sha('1')), 'fertig');
  const f = f32(c.datei(sha('1'))); const links = spitze(f, 0, 2), rechts = spitze(f, 1, 2);
  assert.ok(soll > 0.1, `Quelle trägt Signal (${soll})`);
  assert.ok(Math.abs(links / soll - 1) < 0.005, `Verhältnis Ausgabe/Quelle ${links / soll} (−3 dB wäre 0,707)`);
  assert.equal(links, rechts); for (let i = 0; i < f.length; i += 2) if (f[i] !== f[i + 1]) assert.fail(`Frame ${i / 2}: L ${f[i]} ≠ R ${f[i + 1]}`);
  assert.match(w.args(), /pan=stereo\|c0=c0\|c1=c0/); assert.doesNotMatch(w.args(), /-ac /);
});

test('6.3 Negativ-Kontrolle: Stereo bleibt unverändert (kein pan, kein -ac), mehr als zwei Kanäle werden mit -ac 2 gemischt', async (t) => {
  const dir = tmpOrdner(t); const w = aufruf(dir); const c = new DekodierCache(path.join(dir, 'arr'), { ffmpeg: [w.wrap] });
  const st = wavDatei(dir, 'st.wav', 2); const mehr = wavDatei(dir, 'sechs.wav', 6);
  c.fordereAn(sha('2'), st); assert.equal(await c.bereit(sha('2')), 'fertig');
  const fs2 = f32(c.datei(sha('2')));
  assert.ok(Math.abs(spitze(fs2, 0, 2) / quellSpitze(st) - 1) < 0.005, 'Stereo-Pegel unverändert');
  let zeile = w.args().trim().split('\n').at(-1); assert.doesNotMatch(zeile, /pan=|-ac /, zeile);
  c.fordereAn(sha('3'), mehr); assert.equal(await c.bereit(sha('3')), 'fertig');
  zeile = w.args().trim().split('\n').at(-1); assert.match(zeile, /-ac 2/); assert.doesNotMatch(zeile, /pan=/);
  const f6 = f32(c.datei(sha('3'))); assert.ok(spitze(f6, 0, 2) > 0.01 && f6.length % 2 === 0, 'Mehrkanal ergibt hörbares Stereo');
});

test('Mutation: Ausgabe, deren Länge kein Vielfaches von 8 ist (halber Frame), ist format-Fehler und hinterlässt keine Datei', async (t) => {
  const dir = tmpOrdner(t); const wrap = path.join(dir, 'schief.sh');
  fs.writeFileSync(wrap, '#!/bin/sh\nfor a; do last=$a; done\nprintf "abcdefghijklm" > "$last"\nexit 0\n', { mode: 0o755 });
  const c = new DekodierCache(path.join(dir, 'arr'), { ffmpeg: [wrap] });
  c.fordereAn(sha('4'), wavDatei(dir, 'a.wav', 2)); assert.equal(await c.bereit(sha('4')), 'fehler'); assert.equal(c.fehlerGrund(sha('4')), 'format');
  assert.equal(c.zustand(sha('4')), 'fehler'); assert.deepEqual(fs.readdirSync(path.join(dir, 'arr', 'audio')), []);
});

// ---------------------------------------------------------------------------------------------------------------------
// Robustheit: Schlange bleibt nicht stehen, wenn das Aufräumen wirft
test('pumpe(): wirft das Aufräumen der .teil-Datei (EISDIR), wird der Auftrag fehler und die Schlange läuft weiter (vorher: hängt für immer)', async (t) => {
  const dir = tmpOrdner(t); const wrap = path.join(dir, 'verzeichnis.sh');
  fs.writeFileSync(wrap, '#!/bin/sh\nfor a; do last=$a; done\nmkdir -p "$last"\nexit 1\n', { mode: 0o755 });
  const c = new DekodierCache(path.join(dir, 'arr'), { ffmpeg: [wrap] }); const q = wavDatei(dir, 'a.wav', 2);
  c.fordereAn(sha('5'), q); c.fordereAn(sha('6'), q);
  const frist = (p) => Promise.race([p, new Promise((ok) => setTimeout(() => ok('HAENGT'), 4000).unref())]);
  assert.deepEqual([await frist(c.bereit(sha('5'))), await frist(c.bereit(sha('6')))], ['fehler', 'fehler'], 'beide Aufträge kommen zu einem Ende');
  fs.rmSync(path.join(dir, 'arr', 'audio'), { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------------------------------
// 6.7 Haltbarkeit
function stand(t, name = 'Haltbar') {
  const w = tmpOrdner(t); const pr = new Projekte(w); const { slug, projekt } = pr.lege(name);
  const v = pr.verlauf(slug, { zeitgeber: false, jetzt: () => 1_000_000 });
  t.after(() => { try { v.schliesse(); } catch { /* egal */ } });
  const haken = { speichere: (n) => pr.speichere(slug, n) };
  return { w, pr, slug, projekt, v, haken, log: path.join(w, slug, 'undo.jsonl'), json: path.join(w, slug, 'project.json') };
}

test('6.7 project.json: fsync auf die Temp-Datei, dann rename, dann fsync auf das Verzeichnis (Reihenfolge der Systemaufrufe gemessen)', (t) => {
  const { pr, slug } = stand(t);
  const ereignisse = []; const fsync = fs.fsyncSync, rename = fs.renameSync;
  fs.fsyncSync = (fd) => { ereignisse.push(fs.fstatSync(fd).isDirectory() ? 'fsync-verzeichnis' : 'fsync-datei'); return fsync(fd); };
  fs.renameSync = (a, b) => { ereignisse.push(`rename ${path.basename(String(b))}`); return rename(a, b); };
  try { pr.speichere(slug, specProjekt()); } finally { fs.fsyncSync = fsync; fs.renameSync = rename; }
  assert.deepEqual(ereignisse, ['fsync-datei', 'rename project.json', 'fsync-verzeichnis']);
});

test('6.7 Schreiben scheitert nach 20 Bytes (ENOSPC): Speicher unverändert, Datei auf die alte Länge zurück, Projekt auf der Platte wieder alt, gleiche rev geht danach', (t) => {
  const s = stand(t); const r1 = aendere(s.v, s.projekt, [{ befehl: 'spur_neu', art: 'audio', name: 'A' }], A, s.haken);
  const logVor = fs.readFileSync(s.log, 'utf8'), zeiger = s.v.zeiger(), listeVor = s.v.liste();
  const orig = fs.writeSync; let n = 0;
  fs.writeSync = (fd, puffer, off, len, ...r) => {
    if (!istLog(fd)) return orig(fd, puffer, off, len, ...r);
    n++; orig(fd, puffer, off, Math.min(20, len), ...r); const e = new Error('ENOSPC: no space left on device'); e.code = 'ENOSPC'; throw e;
  };
  try {
    assert.throws(() => aendere(s.v, r1.projekt, [{ befehl: 'spur_neu', art: 'audio', name: 'B' }], A, s.haken), /ENOSPC/);
  } finally { fs.writeSync = orig; }
  assert.ok(n >= 1, 'writeSync wurde tatsächlich getroffen');
  assert.equal(fs.readFileSync(s.log, 'utf8'), logVor, 'kein Zeilenfragment in der Datei');
  assert.deepEqual(s.v.zeiger(), zeiger, 'Undo-Stapel unverändert'); assert.deepEqual(s.v.liste(), listeVor);
  assert.equal(kanonisch(s.pr.lies(s.slug)), kanonisch(r1.projekt), 'project.json steht wieder auf dem Stand, den der Aufrufer behalten hat');
  const r2 = aendere(s.v, r1.projekt, [{ befehl: 'spur_neu', art: 'audio', name: 'B' }], A, s.haken);
  assert.equal(r2.projekt.rev, r1.projekt.rev + 1, 'dieselbe rev wie der gescheiterte Versuch ist wieder frei');
  assert.equal(zeilen(s.log).length, 2); assert.doesNotThrow(() => new Verlauf(s.log, { zeitgeber: false }), 'Datei beim nächsten Start lesbar');
});

test('6.7 Kurzer Schreibvorgang (writeSync liefert nur 7 Bytes je Aufruf): Schleife schreibt bis zur vollen Länge', (t) => {
  const s = stand(t); const orig = fs.writeSync; let aufrufe = 0;
  fs.writeSync = (fd, puffer, off, len, ...r) => { if (!istLog(fd)) return orig(fd, puffer, off, len, ...r); aufrufe++; return orig(fd, puffer, off, Math.min(7, len), ...r); };
  try { aendere(s.v, s.projekt, [{ befehl: 'spur_neu', art: 'audio', name: 'Lang genug fuer viele Teile' }], A, s.haken); } finally { fs.writeSync = orig; }
  assert.ok(aufrufe > 5, `mehrere Teilschreibvorgänge (${aufrufe})`);
  const z = zeilen(s.log); assert.equal(z.length, 1); assert.equal(z[0].rev, 1);
});

test('6.7 rev im Log schon höher als das Projekt: aendere scheitert VOR dem Speichern (project.json bleibt, keine 140/141/142-Spur)', (t) => {
  const s = stand(t); const r1 = aendere(s.v, s.projekt, [{ befehl: 'tempo_setzen', bpm: 140 }], A, s.haken);
  const alt = kopie(r1.projekt); alt.rev = 0;                                           // Aufrufer mit veraltetem Stand
  const vorher = fs.readFileSync(s.json, 'utf8');
  assert.throws(() => aendere(s.v, alt, [{ befehl: 'tempo_setzen', bpm: 141 }], A, s.haken), (e) => e instanceof VerlaufFehler && e.grund === 'rev_nicht_steigend');
  assert.equal(fs.readFileSync(s.json, 'utf8'), vorher, 'project.json unberührt');
});

test('6.7 Strom weg: Log läuft dem Projekt voraus (project.json auf rev 1 zurück, Log auf rev 2): oeffne zieht aus dem Log nach, danach geht Ändern und Undo', (t) => {
  const s = stand(t); const dekoder = { dekodiert: () => 'fertig' };
  const r1 = aendere(s.v, s.projekt, [{ befehl: 'spur_neu', art: 'audio', name: 'A' }], A, s.haken);
  const bei1 = fs.readFileSync(s.json, 'utf8');
  const r2 = aendere(s.v, r1.projekt, [{ befehl: 'tempo_setzen', bpm: 140 }], A, s.haken);
  assert.equal(r2.projekt.rev, 2); s.v.schliesse();
  fs.writeFileSync(s.json, bei1);                                                         // die Platte hat nur den älteren Stand behalten
  const pr2 = new Projekte(s.w); assert.equal(pr2.lies(s.slug).rev, 1);
  const o = pr2.oeffne(s.slug, { zeitgeber: false, jetzt: () => 2_000_000 });
  t.after(() => o.verlauf.schliesse());
  assert.equal(o.nachgezogen, 1); assert.equal(o.projekt.rev, 2); assert.equal(o.projekt.tempo_bpm, 140);
  assert.equal(pr2.lies(s.slug).rev, 2, 'der nachgezogene Stand steht wieder in project.json');
  const hk = { speichere: (n) => pr2.speichere(s.slug, n) };
  const r3 = aendere(o.verlauf, o.projekt, [{ befehl: 'tempo_setzen', bpm: 150 }], A, hk);
  assert.equal(r3.projekt.rev, 3);
  const u = rueckgaengig(o.verlauf, r3.projekt, { quelle: 'andreas' }, { ...hk, ...dekoder });
  assert.equal(u.projekt.tempo_bpm, 140);
});

test('6.7 oeffne ohne Rückstand: nachgezogen 0, Projekt unverändert; ein Log, das sich nicht anwenden lässt, meldet verlauf_inkonsistent statt zu raten', (t) => {
  const s = stand(t); aendere(s.v, s.projekt, [{ befehl: 'tempo_setzen', bpm: 133 }], A, s.haken); s.v.schliesse();
  const o = new Projekte(s.w).oeffne(s.slug, { zeitgeber: false }); assert.equal(o.nachgezogen, 0); assert.equal(o.projekt.tempo_bpm, 133); o.verlauf.schliesse();
  const heil = fs.readFileSync(s.json, 'utf8');
  const j = JSON.parse(heil); j.rev = 0; fs.writeFileSync(s.json, JSON.stringify(j));
  const z = zeilen(s.log); z[0].vor = [{ op: 'replace', pfad: '/spuren/s9/name', wert: 'x' }]; fs.writeFileSync(s.log, z.map((x) => JSON.stringify(x)).join('\n') + '\n');
  assert.throws(() => new Projekte(s.w).oeffne(s.slug, { zeitgeber: false }), (e) => e instanceof VerlaufFehler && e.grund === 'verlauf_inkonsistent');
  // die Sperre wurde beim Scheitern freigegeben: verlauf() kommt bis zum Vergleich mit project.json (log_voraus), nicht projekt_busy
  assert.throws(() => new Projekte(s.w).verlauf(s.slug, { zeitgeber: false }), (e) => e instanceof AblageFehler && e.fehler === 'log_voraus');
});

test('Sperre über die Lebensdauer: ein zweites Öffnen desselben Projekts (auch im selben Prozess) ist projekt_busy; nach schliesse geht es; die Sperrdatei verschwindet', (t) => {
  const w = tmpOrdner(t); const pr = new Projekte(w); const { slug } = pr.lege('Zwei');
  const v1 = pr.verlauf(slug, { zeitgeber: false });
  assert.ok(fs.existsSync(path.join(w, slug, '.lauf')), 'Sperrdatei liegt, solange der Verlauf offen ist');
  for (const andere of [pr, new Projekte(w)]) {
    assert.throws(() => andere.verlauf(slug, { zeitgeber: false }), (e) => e instanceof AblageFehler && e.code === 409 && e.fehler === 'projekt_busy');
    assert.throws(() => andere.oeffne(slug, { zeitgeber: false }), (e) => e.code === 409 && e.fehler === 'projekt_busy');
  }
  v1.schliesse(); v1.schliesse();                                                          // zweimal schliessen schadet nicht
  assert.ok(!fs.existsSync(path.join(w, slug, '.lauf')));
  const v2 = pr.verlauf(slug, { zeitgeber: false }); v2.schliesse();
  assert.throws(() => pr.verlauf('gibt-es-nicht', {}), (e) => e.code === 404);
});

test('Sperre: ein toter Besitzer (Rest von einem Absturz) blockiert das Öffnen nicht', (t) => {
  const w = tmpOrdner(t); const pr = new Projekte(w); const { slug } = pr.lege('Rest');
  const tot = execFileSync('sh', ['-c', 'echo $$']).toString().trim();
  fs.writeFileSync(path.join(w, slug, '.lauf'), JSON.stringify({ pid: Number(tot), start: '1' }));
  const v = pr.verlauf(slug, { zeitgeber: false }); v.schliesse();
});

test('Verlauf: scheitert der Timer-Flush (Platte weg), wirft er keine unbehandelte Ausnahme: beiFehler hört es, der Eintrag bleibt ausstehend und kommt später an', async (t) => {
  const dir = tmpOrdner(t); const datei = path.join(dir, 'undo.jsonl'); const meldungen = [];
  const v = new Verlauf(datei, { zusammenfassenMs: 30, beiFehler: (e) => meldungen.push(e.message) });
  let p = neuesProjekt('T'); p = aendere(v, p, [{ befehl: 'spur_neu', art: 'audio' }], A).projekt;
  aendere(v, p, [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -3 }], A);
  fs.rmSync(datei); fs.mkdirSync(datei);                                                  // ab jetzt kann nicht mehr angehängt werden (EISDIR)
  await new Promise((ok) => setTimeout(ok, 120));
  assert.equal(meldungen.length, 1, `beiFehler gerufen: ${JSON.stringify(meldungen)}`);
  fs.rmSync(datei, { recursive: true }); fs.writeFileSync(datei, '');
  v.flush(); assert.equal(zeilen(datei).length, 1, 'der ausstehende Eintrag wurde nachgeschrieben');
  v.schliesse();
});

test('Verlauf: derselbe Fehler im Timer beendet den Prozess nicht (eigener Prozess, ohne Hörer: Meldung auf stderr, Exit-Code 0)', (t) => {
  const dir = tmpOrdner(t); const datei = path.join(dir, 'undo.jsonl'); const modul = path.resolve('projekt/verlauf.ts'); const modell = path.resolve('projekt/modell.ts');
  const code = `
    import fs from 'node:fs';
    const { Verlauf, aendere } = await import(${JSON.stringify(modul)});
    const { neuesProjekt } = await import(${JSON.stringify(modell)});
    const v = new Verlauf(${JSON.stringify(datei)}, { zusammenfassenMs: 20 });
    let p = neuesProjekt('T'); const m = { quelle: 'andreas', label: 'x' };
    p = aendere(v, p, [{ befehl: 'spur_neu', art: 'audio' }], m).projekt;
    aendere(v, p, [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -3 }], m);
    fs.rmSync(${JSON.stringify(datei)}); fs.mkdirSync(${JSON.stringify(datei)});
    await new Promise((ok) => setTimeout(ok, 150));
    console.log('LEBT');`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', cwd: path.resolve('.') });
  assert.equal(r.status, 0, `Exit ${r.status}: ${r.stderr.slice(0, 300)}`); assert.match(r.stdout, /LEBT/); assert.match(r.stderr, /Verlauf|undo\.jsonl/);
});

// ---------------------------------------------------------------------------------------------------------------------
// 6.5 Zusammenfassen gleitend + Testlücken des Reviews
function fader(v, p, spur, wert, uhr, pause, quelle = 'andreas') {
  uhr.t += pause; return aendere(v, p, [{ befehl: 'spur_aendern', spur_id: spur, fader_db: wert }], { quelle, label: `Fader ${wert}` }).projekt;
}
function mitSpuren(datei, uhr) {
  const v = new Verlauf(datei, { jetzt: () => uhr.t, zeitgeber: false });
  let p = neuesProjekt('Z'); p = aendere(v, p, [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'spur_neu', art: 'audio' }], A).projekt;
  return { v, p };
}

test('6.5 gleitend: ein Fader-Zug über 10 s (Abstand 0,6 s) ist EIN Eintrag mit erstem zurueck und letztem vor; eine Pause über 1 s trennt', (t) => {
  const dir = tmpOrdner(t); const datei = path.join(dir, 'undo.jsonl'); const uhr = { t: 0 };
  let { v, p } = mitSpuren(datei, uhr);
  for (let i = 1; i <= 17; i++) p = fader(v, p, 's1', -i, uhr, 600);                        // 17 × 0,6 s = 10,2 s
  p = fader(v, p, 's1', -50, uhr, 1500);                                                     // Pause > 1 s: neuer Eintrag
  v.schliesse(); const z = zeilen(datei);
  assert.equal(z.length, 3, 'Spuren, Zug, Nachzügler');
  assert.deepEqual(z[1].zurueck, [{ op: 'replace', pfad: '/spuren/s1/fader_db', wert: 0 }]); assert.deepEqual(z[1].vor, [{ op: 'replace', pfad: '/spuren/s1/fader_db', wert: -17 }]);
  assert.equal(z[1].rev, 18); assert.equal(z[2].rev, 19);
});

test('6.5 Mutation "gleiche Quelle": abwechselnd andreas und cypher in 100 ms Abstand ergibt je einen Eintrag, nicht einen gemeinsamen', (t) => {
  const dir = tmpOrdner(t); const datei = path.join(dir, 'undo.jsonl'); const uhr = { t: 0 };
  let { v, p } = mitSpuren(datei, uhr);
  p = fader(v, p, 's1', -1, uhr, 100, 'andreas'); p = fader(v, p, 's1', -2, uhr, 100, 'cypher'); p = fader(v, p, 's1', -3, uhr, 100, 'andreas');
  v.schliesse(); const z = zeilen(datei).slice(1); assert.deepEqual(z.map((x) => x.quelle), ['andreas', 'cypher', 'andreas']);
});

test('6.5 Mutation "nur Mixer-Felder, andere Spur/anderes Feld trennt": name, zwei Spuren und zwei Felder werden nicht zusammengefasst', (t) => {
  const dir = tmpOrdner(t); const datei = path.join(dir, 'undo.jsonl'); const uhr = { t: 0 };
  let { v, p } = mitSpuren(datei, uhr);
  for (const name of ['Eins', 'Zwei']) { uhr.t += 50; p = aendere(v, p, [{ befehl: 'spur_aendern', spur_id: 's1', name }], A).projekt; }
  p = fader(v, p, 's1', -1, uhr, 50); p = fader(v, p, 's2', -1, uhr, 50);
  uhr.t += 50; p = aendere(v, p, [{ befehl: 'spur_aendern', spur_id: 's2', pan: 0.5 }], A).projekt;
  v.schliesse(); assert.equal(zeilen(datei).length - 1, 5, 'zwei Namen, zwei Spuren, ein anderes Feld: fünf Einträge');
});

test('6.5 Mutation "Undo von X, oben liegt Y": ein Log, dessen Undo nicht die oberste Änderung trifft, ist verlauf_kaputt', (t) => {
  const dir = tmpOrdner(t); const datei = path.join(dir, 'undo.jsonl'); const uhr = { t: 0 };
  const { v } = mitSpuren(datei, uhr); let p = neuesProjekt('Z'); p.rev = 1;
  aendere(v, p, [{ befehl: 'tempo_setzen', bpm: 130 }], A); v.schliesse();
  const z = zeilen(datei);
  z.push({ rev: 3, zeit: z[0].zeit, quelle: 'andreas', label: 'Undo', art: 'undo', bezug: 1, vor: [], zurueck: [] });          // oben liegt rev 2
  fs.writeFileSync(datei, z.map((x) => JSON.stringify(x)).join('\n') + '\n');
  assert.throws(() => new Verlauf(datei, { zeitgeber: false }), (e) => e.grund === 'verlauf_kaputt' && /oben liegt/.test(e.message));
});

// ---------------------------------------------------------------------------------------------------------------------
// Mutationen aus der Qualitätsprüfung: Schlussprüfung auf dem Befehlsweg, Umkehren auf einen inkonsistenten Stand
test('Schlussprüfung: 4096 Clips gehen, der 4097. über clip_neu nicht; 65536 Noten gehen, die 65537. über noten_neu nicht', () => {
  const p = specProjekt(); p.spuren[0].clips = [];
  p.spuren[1].clips = Array.from({ length: 4095 }, (_, i) => ({ id: `c${i + 10}`, art: 'midi', name: 'm', start_beat: i, laenge_beats: 1, noten: [] }));
  const r = fuehreAus(p, { befehl: 'clip_neu', spur_id: 's2', art: 'midi', start_beat: 0, laenge_beats: 1 }); assert.equal(r.projekt.spuren[1].clips.length, 4096);
  assert.throws(() => fuehreAus(r.projekt, { befehl: 'clip_neu', spur_id: 's2', art: 'midi', start_beat: 0, laenge_beats: 1 }),
    (e) => e instanceof BefehlFehler && e.grund === 'projekt_ungueltig' && /4096/.test(e.message));
  const q = specProjekt(); q.spuren[1].clips[0].noten = Array.from({ length: 65535 }, (_, i) => ({ id: `n${i + 1}`, beat: 0, laenge: 1, ton: 36, vel: 100 }));
  const n = fuehreAus(q, { befehl: 'noten_neu', clip_id: 'c2', noten: [{ beat: 1, laenge: 1, ton: 40, vel: 90 }] });
  assert.equal(n.projekt.spuren[1].clips[0].noten.length, 65536);
  assert.throws(() => fuehreAus(n.projekt, { befehl: 'noten_neu', clip_id: 'c2', noten: [{ beat: 1, laenge: 1, ton: 40, vel: 90 }] }), (e) => e.grund === 'projekt_ungueltig' && /65536/.test(e.message));
});

test('Undo auf einen Stand, der das Projekt ungültig macht, wird abgelehnt (verlauf_inkonsistent), nichts geschrieben, Zeiger bleibt', (t) => {
  const dir = tmpOrdner(t); const datei = path.join(dir, 'undo.jsonl'); const p0 = neuesProjekt('U'); p0.rev = 0;
  fs.writeFileSync(datei, JSON.stringify({ rev: 1, zeit: '2026-10-15T12:00:00.000Z', quelle: 'andreas', label: 'Tempo', art: 'aendern', bezug: null,
    vor: [{ op: 'replace', pfad: '/tempo_bpm', wert: 130 }], zurueck: [{ op: 'replace', pfad: '/tempo_bpm', wert: 5 }] }) + '\n');
  const v = new Verlauf(datei, { zeitgeber: false }); const p1 = { ...kopie(p0), rev: 1, tempo_bpm: 130 }; const vorher = fs.readFileSync(datei, 'utf8');
  assert.throws(() => rueckgaengig(v, p1, { quelle: 'andreas' }), (e) => e instanceof VerlaufFehler && e.grund === 'verlauf_inkonsistent' && /tempo_bpm/.test(e.message));
  assert.equal(fs.readFileSync(datei, 'utf8'), vorher); assert.deepEqual(v.zeiger(), { undo: [1], redo: [] });
});

// ---------------------------------------------------------------------------------------------------------------------
// 6.6 Reihenfolge als eigene Operation, keine abgeleiteten Felder in Patches
function grosseSpuren(notenJeClip) {
  const p = specProjekt(); p.spuren[1].clips[0].noten = Array.from({ length: notenJeClip }, (_, i) => ({ id: `n${i + 1}`, beat: i % 64, laenge: 0.25, ton: 36 + (i % 24), vel: 100 }));
  return p;
}
test('6.6 spur_verschieben: Patch ist eine einzige move-Operation auf der ID-Liste, klein (bei 1000 Noten unter 400 Bytes statt 114 KB), Undo/Redo gehen', () => {
  const p = grosseSpuren(1000);
  const r = fuehreAus(p, { befehl: 'spur_verschieben', spur_id: 's3', index: 0 });
  assert.deepEqual(r.vor, [{ op: 'move', pfad: '/spuren/s3', index: 0 }]); assert.deepEqual(r.zurueck, [{ op: 'move', pfad: '/spuren/s3', index: 2 }]);
  assert.ok(JSON.stringify(r.vor).length + JSON.stringify(r.zurueck).length < 400);
  assert.deepEqual(r.projekt.spuren.map((s) => s.id), ['s3', 's1', 's2']);
  assert.equal(kanonisch(PATCH.wende(p, r.vor)), kanonisch(r.projekt)); assert.equal(kanonisch(PATCH.wende(r.projekt, r.zurueck)), kanonisch(p));
  assert.equal(kanonisch(PATCH.wende(r.projekt, PATCH.kehreUm(r.vor, p))), kanonisch(p), 'kehreUm kennt move');
});

test('6.6 unterschied: reine Umordnung ergibt nur move; Umordnen mit Einfügen und Entfernen geht hin und zurück (Fuzz 300)', () => {
  const rnd = zufall(61); const wahl = (a) => a[Math.floor(rnd() * a.length)];
  let zaehler = 100;
  for (let i = 0; i < 300; i++) {
    const a = specProjekt(); for (let k = 0; k < 3; k++) a.spuren.push({ id: `s${10 + k}`, nr: 4 + k, name: 'x', farbe: '#000000', art: 'audio', fader_db: 0, pan: 0, mute: false, solo: false, clips: [] });
    const b = kopie(a);
    for (let k = 0; k < 1 + Math.floor(rnd() * 4); k++) {
      const m = wahl(['mischen', 'weg', 'neu']);
      if (m === 'mischen') b.spuren.sort(() => rnd() - 0.5);
      else if (m === 'weg' && b.spuren.length > 2) b.spuren.splice(Math.floor(rnd() * b.spuren.length), 1);
      else b.spuren.splice(Math.floor(rnd() * (b.spuren.length + 1)), 0, { id: `s${++zaehler}`, nr: 8, name: 'n', farbe: '#000000', art: 'audio', fader_db: 0, pan: 0, mute: false, solo: false, clips: [] });
    }
    const vor = PATCH.unterschied(a, b), zurueck = PATCH.unterschied(b, a);
    assert.equal(ohneAbgeleitetes(PATCH.wende(a, JSON.parse(JSON.stringify(vor)))), ohneAbgeleitetes(b), `Schritt ${i} hin`);
    assert.equal(ohneAbgeleitetes(PATCH.wende(b, JSON.parse(JSON.stringify(zurueck)))), ohneAbgeleitetes(a), `Schritt ${i} zurück`);
    assert.ok(!vor.some((o) => o.op === 'replace' && o.pfad === '/spuren'), 'nie mehr die ganze Liste');
  }
  const a = specProjekt(), b = kopie(a); b.spuren.reverse();
  const nurMove = PATCH.unterschied(a, b); assert.ok(nurMove.length >= 1 && nurMove.every((o) => o.op === 'move'), JSON.stringify(nurMove));
});

test('6.6 unterschied: alle 120 Anordnungen von 5 IDs gehen mit höchstens n−1 moves hin und zurück; das Verschieben eines Elements ist genau ein move', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const perm = (xs) => (xs.length < 2 ? [xs] : xs.flatMap((x, i) => perm([...xs.slice(0, i), ...xs.slice(i + 1)]).map((r) => [x, ...r])));
  const liste = (o) => ({ l: o.map((id) => ({ id, w: id.charCodeAt(0) })) });
  let n = 0;
  for (const p of perm(ids)) {
    const hin = PATCH.unterschied(liste(ids), liste(p)), zurueck = PATCH.unterschied(liste(p), liste(ids));
    assert.ok(hin.length <= 4 && hin.every((o) => o.op === 'move'), `${p}: ${JSON.stringify(hin)}`);
    assert.deepEqual(PATCH.wende(liste(ids), hin), liste(p)); assert.deepEqual(PATCH.wende(liste(p), zurueck), liste(ids)); n++;
  }
  assert.equal(n, 120);
  for (const [von, nach] of [[4, 0], [0, 4], [2, 3], [1, 3]]) {
    const q = [...ids]; q.splice(nach, 0, q.splice(von, 1)[0]);
    assert.equal(PATCH.unterschied(liste(ids), liste(q)).length, 1, `${von}→${nach}`);
  }
});

test('6.6 move: unbekannte ID, Index außerhalb, Pfad auf Nicht-Liste werden abgelehnt', () => {
  const p = specProjekt();
  for (const [o, grund] of [[{ op: 'move', pfad: '/spuren/s9', index: 0 }, 'pfad_unbekannt'], [{ op: 'move', pfad: '/spuren/s1', index: 3 }, 'index_bereich'],
    [{ op: 'move', pfad: '/spuren/s1', index: -1 }, 'index_bereich'], [{ op: 'move', pfad: '/tempo_bpm', index: 0 }, 'pfad_unbekannt'], [{ op: 'move', pfad: '/spuren/s1' }, 'index_bereich']]) {
    assert.throws(() => PATCH.wende(p, [o]), (e) => e instanceof PATCH.PatchFehler && e.grund === grund, JSON.stringify(o));
  }
});

test('6.6 Messprobe des Reviews: Spur verschieben, "dekodiert" auf fertig abgleichen, Undo → Clip bleibt fertig, betrifft_wiedergabe false', (t) => {
  const s = stand(t, 'Dek'); let p = specProjekt(); p.rev = 0; p.spuren[0].clips[0].dekodiert = 'nein';
  const r = aendere(s.v, p, [{ befehl: 'spur_verschieben', spur_id: 's3', index: 0 }], A, s.haken);
  const abgeglichen = gleicheDekodiertAb(r.projekt, () => 'fertig');
  assert.equal(abgeglichen.spuren.find((x) => x.id === 's1').clips[0].dekodiert, 'fertig');
  const u = rueckgaengig(s.v, abgeglichen, { quelle: 'andreas' }, s.haken);
  assert.equal(u.projekt.spuren.find((x) => x.id === 's1').clips[0].dekodiert, 'fertig', 'abgeleiteter Zustand überlebt das Undo');
  assert.equal(u.betrifft_wiedergabe, false);
  assert.deepEqual(u.projekt.spuren.map((x) => x.id), ['s1', 's2', 's3']);
});

test('6.6 Abgeleitetes in Patches: ein gelöschter, fertig dekodierter Clip steht mit dekodiert "nein" im Patch; Undo mit Abgleich-Haken setzt den echten Zustand', (t) => {
  const s = stand(t, 'Abl'); const p = specProjekt(); p.rev = 0;                           // c1 ist fertig
  const r = aendere(s.v, p, [{ befehl: 'clip_loeschen', clip_id: 'c1' }], A, s.haken);
  assert.doesNotMatch(JSON.stringify([r.eintrag.vor, r.eintrag.zurueck]), /fertig|laeuft|fehler/, 'kein abgeleiteter Zustand im Log');
  const u = rueckgaengig(s.v, r.projekt, { quelle: 'andreas' }, { ...s.haken, dekodiert: (sh) => (sh === SHA_A ? 'fertig' : 'nein') });
  assert.equal(u.projekt.spuren[0].clips[0].dekodiert, 'fertig'); assert.equal(u.betrifft_wiedergabe, true, 'der Clip ist wieder da');
  const r2 = aendere(s.v, u.projekt, [{ befehl: 'clip_loeschen', clip_id: 'c1' }], A, s.haken);
  const u2 = rueckgaengig(s.v, r2.projekt, { quelle: 'andreas' }, s.haken);
  assert.equal(u2.projekt.spuren[0].clips[0].dekodiert, 'nein', 'ohne Haken: neutral, der Server gleicht danach ab');
});

// ---------------------------------------------------------------------------------------------------------------------
// Leistung
function riesig(n) {
  const p = specProjekt(); p.spuren[1].clips[0].noten = Array.from({ length: n }, (_, i) => ({ id: `n${i + 1}`, beat: (i % 4000) * 0.25, laenge: 0.25, ton: 36 + (i % 24), vel: 100 }));
  p.spuren[1].clips[0].laenge_beats = 1000; return p;
}
const neueNoten = (n) => Array.from({ length: n }, (_, i) => ({ beat: (i % 4000) * 0.25, laenge: 0.25, ton: 36 + (i % 24), vel: 100 }));

test('Leistung: noten_neu mit 20000 Noten (ohne IDs) dauert unter 1 s, wächst linear (Faktor 4 in der Menge, weniger als Faktor 9 in der Zeit), IDs lückenlos', { timeout: 180_000 }, () => {
  const p = specProjekt();
  const zeit = (n) => { let best = Infinity; for (let k = 0; k < 2; k++) { const t0 = performance.now(); fuehreAus(p, { befehl: 'noten_neu', clip_id: 'c2', noten: neueNoten(n) }); best = Math.min(best, performance.now() - t0); } return best; };
  const klein = zeit(5000), gross = zeit(20000);
  assert.ok(gross < 1000, `20000 Noten: ${gross.toFixed(0)} ms (Grenze 1000)`);
  assert.ok(gross / klein < 9, `Verhältnis 20000/5000 = ${(gross / klein).toFixed(1)} (quadratisch wäre 16)`);
  const r = fuehreAus(p, { befehl: 'noten_neu', clip_id: 'c2', noten: neueNoten(20000) });
  const ids = r.projekt.spuren[1].clips[0].noten.map((n) => n.id);
  assert.equal(ids.length, 20001); assert.equal(new Set(ids).size, 20001); assert.equal(ids.at(-1), 'n20001');
});

test('Leistung: Undo und Redo eines noten_neu mit 20000 Noten (Patch anwenden) dauern je unter 500 ms (vorher 1,3 s und 3,2 s)', { timeout: 180_000 }, () => {
  const p = specProjekt(); const r = fuehreAus(p, { befehl: 'noten_neu', clip_id: 'c2', noten: neueNoten(20000) });
  const zeit = (f) => { const t0 = performance.now(); const x = f(); return [performance.now() - t0, x]; };
  const [redo, nachRedo] = zeit(() => PATCH.wende(p, r.vor)); const [undo, nachUndo] = zeit(() => PATCH.wende(r.projekt, r.zurueck));
  assert.equal(ohneAbgeleitetes(nachRedo), ohneAbgeleitetes(r.projekt)); assert.equal(ohneAbgeleitetes(nachUndo), ohneAbgeleitetes(p));
  assert.ok(redo < 500 && undo < 500, `Redo ${redo.toFixed(0)} ms, Undo ${undo.toFixed(0)} ms`);
});

test('Leistung: noten_neu mit ausdrücklichen und erzeugten IDs gemischt: keine Kollision, Ablehnung doppelter ID bleibt', () => {
  const p = specProjekt();
  const r = fuehreAus(p, { befehl: 'noten_neu', clip_id: 'c2', noten: [{ id: 'n2', beat: 1, laenge: 1, ton: 40, vel: 90 }, { beat: 2, laenge: 1, ton: 41, vel: 90 }, { beat: 3, laenge: 1, ton: 42, vel: 90 }] });
  assert.deepEqual(r.projekt.spuren[1].clips[0].noten.map((n) => n.id), ['n1', 'n2', 'n3', 'n4']);
  assert.throws(() => fuehreAus(p, { befehl: 'noten_neu', clip_id: 'c2', noten: [{ id: 'n1', beat: 1, laenge: 1, ton: 40, vel: 90 }] }), (e) => e.grund === 'id_belegt');
  assert.throws(() => fuehreAus(p, { befehl: 'noten_neu', clip_id: 'c2', noten: [{ id: 'x', beat: 1, laenge: 1, ton: 40, vel: 90 }, { id: 'x', beat: 1, laenge: 1, ton: 40, vel: 90 }] }), (e) => e.grund === 'id_belegt');
});

test('Leistung: ein Fader-Schritt bei 60000 Noten klont nichts tief (kein structuredClone), braucht unter 60 ms, verändert die Eingabe nicht', { timeout: 120_000 }, () => {
  const p = riesig(60000); const eingabe = kanonisch(p.spuren[0]) + p.tempo_bpm;
  const orig = globalThis.structuredClone; let klone = 0; globalThis.structuredClone = (...a) => { klone++; return orig(...a); };
  let dt, r;
  try { const t0 = performance.now(); for (let i = 0; i < 5; i++) r = fuehreAus(p, { befehl: 'spur_aendern', spur_id: 's1', fader_db: -3 - i }); dt = (performance.now() - t0) / 5; }
  finally { globalThis.structuredClone = orig; }
  assert.equal(klone, 0, `structuredClone-Aufrufe: ${klone}`);
  assert.ok(dt < 60, `${dt.toFixed(1)} ms je Schritt (vorher gemessen: ~380 ms)`);
  assert.deepEqual(r.vor, [{ op: 'replace', pfad: '/spuren/s1/fader_db', wert: -7 }]); assert.deepEqual(r.zurueck, [{ op: 'replace', pfad: '/spuren/s1/fader_db', wert: 0 }]);
  assert.deepEqual(r.regler_aenderungen, [{ pfad: 'spur/1/fader', wert: -7 }]); assert.equal(r.betrifft_wiedergabe, false);
  assert.equal(p.spuren[0].fader_db, 0, 'Eingabe unverändert'); assert.equal(kanonisch(p.spuren[0]) + p.tempo_bpm, eingabe);
  assert.equal(r.projekt.spuren[1].clips[0].noten.length, 60000);
  for (const b of [{ befehl: 'tempo_setzen', bpm: 130 }, { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 8 }, { befehl: 'metronom_setzen', an: true }]) {
    globalThis.structuredClone = (...a) => { klone++; return orig(...a); };
    try { fuehreAus(p, b); } finally { globalThis.structuredClone = orig; }
  }
  assert.equal(klone, 0, 'auch Kopfbefehle (Tempo, Loop, Metronom) klonen nicht');
});

test('Leistung: schneller Weg und voller Weg ergeben dasselbe (Fuzz 400 Befehlslisten, mit und ohne Freeze): Projekt, vor, zurueck, Regler, betrifft_wiedergabe, Fehler samt Index', () => {
  const rnd = zufall(777); const wahl = (a) => a[Math.floor(rnd() * a.length)];
  const zahlOderMist = (min, max) => (rnd() < 0.05 ? wahl([min - 1, max + 1, 'x', NaN, null]) : min + Math.round(rnd() * (max - min) * 4) / 4);
  const einzel = () => wahl([
    () => ({ befehl: 'spur_aendern', spur_id: rnd() < 0.05 ? 's9' : wahl(['s1', 's2', 's3']), fader_db: zahlOderMist(-60, 6) }),
    () => ({ befehl: 'spur_aendern', spur_id: wahl(['s1', 's2', 's3']), pan: zahlOderMist(-1, 1), mute: wahl([true, false]) }),
    () => ({ befehl: 'spur_aendern', spur_id: wahl(['s1', 's2', 's3']), name: rnd() < 0.1 ? wahl([' ', 'x'.repeat(81)]) : wahl(['Kick', 'Bass', 'Lead']),
      farbe: rnd() < 0.1 ? '#xyz' : wahl(['#010203', '#ffffff']) }),
    () => ({ befehl: 'spur_aendern', spur_id: wahl(['s1', 's2']), solo: rnd() < 0.1 ? 1 : wahl([true, false]) }),
    () => (rnd() < 0.5 ? { befehl: 'spur_aendern', spur_id: 's1' } : { befehl: 'spur_aendern', spur_id: 's1', unbekannt: 1 }),
    () => ({ befehl: 'tempo_setzen', bpm: zahlOderMist(60, 200) }),
    () => ({ befehl: 'loop_setzen', an: wahl([true, false]), von_beat: zahlOderMist(0, 16), bis_beat: 17 + (zahlOderMist(0, 20) || 0) }),
    () => ({ befehl: 'metronom_setzen', an: wahl([true, false, true]), pegel_db: zahlOderMist(-60, 0), ziel: rnd() < 0.05 ? 'laut' : wahl(['master', 'cue', undefined]) }),
  ])();
  const ausgaenge = [specProjekt(), (() => { const q = specProjekt(); q.spuren[2].freeze = kopie(FREEZE); return q; })()];
  let angewendet = 0, abgelehnt = 0;
  for (let i = 0; i < 400; i++) {
    const p = ausgaenge[i % 2]; const befehle = Array.from({ length: 1 + Math.floor(rnd() * 3) }, einzel);
    const lauf = (voll) => { try { return { ok: fuehreListeAus(p, kopie(befehle), { voll }) }; } catch (e) { return { grund: e.grund, index: e.index, detail: e.detail }; } };
    const schnell = lauf(false), voll = lauf(true);
    assert.deepEqual(schnell, voll, `Liste ${i}: ${JSON.stringify(befehle)}`);
    if (schnell.ok) { angewendet++; assert.equal(kanonisch(PATCH.wende(p, schnell.ok.vor)), kanonisch(schnell.ok.projekt)); assert.equal(kanonisch(PATCH.wende(schnell.ok.projekt, schnell.ok.zurueck)), kanonisch(p)); }
    else abgelehnt++;
  }
  assert.ok(angewendet > 100 && abgelehnt > 50, `Mischung angewendet ${angewendet} / abgelehnt ${abgelehnt}`);
});

test('Leistung: Tempo bei eingefrorener Spur nimmt den vollen Weg (Freeze fällt, betrifft_wiedergabe true); ohne Freeze den schnellen', () => {
  const q = specProjekt(); q.spuren[2].freeze = kopie(FREEZE);
  const r = fuehreAus(q, { befehl: 'tempo_setzen', bpm: 100 });
  assert.equal(r.projekt.spuren[2].freeze, null); assert.equal(r.betrifft_wiedergabe, true); assert.ok(r.vor.some((o) => o.pfad === '/spuren/s3/freeze'));
  assert.equal(fuehreAus(specProjekt(), { befehl: 'tempo_setzen', bpm: 100 }).betrifft_wiedergabe, false);
});

// ---------------------------------------------------------------------------------------------------------------------
// Lange Zeilen
// Fix-Runde 2 S3, F3: auch bereiche/proj/*.ts (dort stand ein Kommentar mit 208 Zeichen hinter einer Feld-Zeile)
test('Lesbarkeit: keine Zeile in projekt/*.ts und bereiche/proj/*.ts ist länger als 160 Zeichen', () => {
  const lang = [];
  let dateien = 0;
  for (const d of ['projekt', 'bereiche/proj']) {
    for (const n of fs.readdirSync(d).filter((x) => x.endsWith('.ts'))) {
      dateien++;
      fs.readFileSync(path.join(d, n), 'utf8').split('\n').forEach((z, i) => { if ([...z].length > 160) lang.push(`${d}/${n}:${i + 1} (${[...z].length})`); });
    }
  }
  assert.ok(dateien >= 15, `${dateien} Dateien gelesen`);
  assert.deepEqual(lang, []);
});
