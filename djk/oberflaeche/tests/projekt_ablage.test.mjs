// D1 S2-Kern, Ablage: Projektordner anlegen/öffnen/listen/speichern, atomar mit Sperre, Normalisierung (A8), Wurzel je Instanz.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Projekte, AblageFehler, normalisiere, projektWurzelVorgabe, arbeitsordnerVorgabe, projektSlug } from '../projekt/ablage.ts';
import { Verlauf, aendere } from '../projekt/verlauf.ts';
import { kanonisch, neuesProjekt } from '../projekt/modell.ts';
import { startzeit } from '../sperre.ts';
import { tmpOrdner, specProjekt, kopie, mitVon } from './hilfen/projekt.mjs';

test('projektSlug: wie die Sammlungen (Umlaute, Sonderzeichen, 48 Zeichen), leerer Name → projekt', () => {
  assert.equal(projektSlug('First Track'), 'first-track'); assert.equal(projektSlug('Größe & Maß!'), 'groesse-mass');
  assert.equal(projektSlug('!!!'), 'projekt'); assert.equal(projektSlug('x'.repeat(100)).length, 48);
});

test('lege: Ordner mit project.json (gültig, rev 0) und leerer undo.jsonl; gleicher Name → -2; Slug = Ordnername', (t) => {
  const w = tmpOrdner(t); const pr = new Projekte(path.join(w, 'wurzel'));
  const a = pr.lege('First Track');
  assert.equal(a.slug, 'first-track'); assert.equal(a.projekt.name, 'First Track'); assert.equal(a.projekt.rev, 0);
  assert.ok(fs.existsSync(path.join(w, 'wurzel', 'first-track', 'project.json')));
  assert.equal(fs.readFileSync(path.join(w, 'wurzel', 'first-track', 'undo.jsonl'), 'utf8'), '');
  assert.equal(pr.lege('First Track').slug, 'first-track-2');
  assert.throws(() => pr.lege(''), (e) => e instanceof AblageFehler && e.fehler === 'name_ungueltig' && e.code === 400);
  assert.throws(() => pr.lege('x'.repeat(81)), (e) => e.fehler === 'name_ungueltig');
  assert.throws(() => pr.lege(5), (e) => e.fehler === 'name_ungueltig');
});

test('liste: Slug, Name, geaendert (ISO aus der Änderungszeit); leere/fehlende Wurzel → []; kaputte project.json wird gelistet, nicht verworfen', (t) => {
  const w = tmpOrdner(t); const pr = new Projekte(path.join(w, 'gibtsnicht'));
  assert.deepEqual(pr.liste(), []);
  const q = new Projekte(w); q.lege('Beta'); q.lege('Alpha');
  fs.mkdirSync(path.join(w, 'kaputt')); fs.writeFileSync(path.join(w, 'kaputt', 'project.json'), '{nein');
  fs.mkdirSync(path.join(w, 'leer-ohne-datei'));
  const l = q.liste();
  assert.deepEqual(l.map((x) => x.slug), ['alpha', 'beta', 'kaputt']);
  assert.deepEqual(l.map((x) => x.name), ['Alpha', 'Beta', 'kaputt']);
  assert.match(l[0].geaendert, /^\d{4}-\d\d-\d\dT/); assert.equal(l[2].fehler, 'json_kaputt');
  assert.equal(fs.readFileSync(path.join(w, 'kaputt', 'project.json'), 'utf8'), '{nein', 'Datei unangetastet');
});

test('speichere/lies: Rundlauf; geschrieben wird normalisiert (Schlüssel sortiert); kein Temp-Rest; ungültiges Projekt wird NICHT geschrieben', (t) => {
  const w = tmpOrdner(t); const pr = new Projekte(w); const { slug } = pr.lege('Rund');
  const p = specProjekt();
  pr.speichere(slug, p);
  const roh = fs.readFileSync(path.join(w, slug, 'project.json'), 'utf8');
  assert.equal(kanonisch(JSON.parse(roh)), kanonisch(p));
  assert.ok(roh.indexOf('"farbe"') < roh.indexOf('"fader_db"') === ('farbe' < 'fader_db'), 'Schlüssel alphabetisch in der Datei');
  assert.equal(kanonisch(pr.lies(slug)), kanonisch(mitVon(p)), 'beim Laden gilt eine Spur ohne von als andreas (Spec 6.22)');
  assert.deepEqual(fs.readdirSync(path.join(w, slug)).sort(), ['project.json', 'undo.jsonl']);
  const kaputt = kopie(p); kaputt.tempo_bpm = 5;
  assert.throws(() => pr.speichere(slug, kaputt), (e) => e instanceof AblageFehler && e.fehler === 'projekt_ungueltig' && /tempo_bpm/.test(e.message));
  assert.equal(kanonisch(pr.lies(slug)), kanonisch(mitVon(p)), 'alter Stand liegt unverändert');
  assert.throws(() => pr.speichere('gibt-es-nicht', p), (e) => e.code === 404);
});

test('lies: unbekannt 404, Slug-Muster 400 (kein ../), kaputtes JSON 409 json_kaputt, ungültiges Format 409 projekt_ungueltig; Datei bleibt', (t) => {
  const w = tmpOrdner(t); const pr = new Projekte(w);
  assert.throws(() => pr.lies('nix'), (e) => e.code === 404 && e.fehler === 'unbekannt');
  for (const s of ['../etc', 'A', '', 'a/b', '.papierkorb']) assert.throws(() => pr.lies(s), (e) => e.code === 400 && e.fehler === 'slug_ungueltig', s);
  fs.mkdirSync(path.join(w, 'k')); fs.writeFileSync(path.join(w, 'k', 'project.json'), '{nein');
  assert.throws(() => pr.lies('k'), (e) => e.code === 409 && e.fehler === 'json_kaputt');
  fs.mkdirSync(path.join(w, 'f')); fs.writeFileSync(path.join(w, 'f', 'project.json'), JSON.stringify({ format: 'x' }));
  assert.throws(() => pr.lies('f'), (e) => e.code === 409 && e.fehler === 'projekt_ungueltig');
  assert.equal(fs.readFileSync(path.join(w, 'k', 'project.json'), 'utf8'), '{nein');
});

test('verlauf(slug): öffnet undo.jsonl des Projekts; Speichern + Verlauf überleben ein neues Projekte-Objekt (= Server-Neustart)', (t) => {
  const w = tmpOrdner(t); const pr = new Projekte(w); const { slug, projekt } = pr.lege('Neu');
  let v = pr.verlauf(slug, { zeitgeber: false });
  const r = aendere(v, projekt, [{ befehl: 'spur_neu', art: 'audio', name: 'A' }], { quelle: 'andreas', label: 'Spur' });
  pr.speichere(slug, r.projekt); v.schliesse();
  const pr2 = new Projekte(w); const p2 = pr2.lies(slug); const v2 = pr2.verlauf(slug, { zeitgeber: false });
  assert.equal(kanonisch(p2), kanonisch(r.projekt)); assert.deepEqual(v2.zeiger(), { undo: [1], redo: [] });
});

test('Sperre: ein lebender Fremdprozess hält das Projekt → speichere wirft 409 projekt_busy, sofort; ein toter Besitzer blockiert nicht', async (t) => {
  const w = tmpOrdner(t); const pr = new Projekte(w); const { slug } = pr.lege('Gesperrt');
  const k = spawn('sleep', ['60'], { stdio: 'ignore' }); t.after(() => { try { process.kill(k.pid, 'SIGTERM'); } catch { /* weg */ } });
  fs.writeFileSync(path.join(w, slug, '.sperre'), JSON.stringify({ pid: k.pid, start: startzeit(k.pid) }));
  const t0 = performance.now();
  assert.throws(() => pr.speichere(slug, specProjekt()), (e) => e.code === 409 && e.fehler === 'projekt_busy');
  assert.ok(performance.now() - t0 < 500, 'wartet nicht');
  assert.equal(pr.lies(slug).rev, 0, 'Lesen ist nicht gesperrt, Stand unverändert');
  process.kill(k.pid, 'SIGKILL'); await new Promise((r) => k.once('exit', r));
  pr.speichere(slug, specProjekt());   // Besitzer tot: Sperre verwaist, wird übernommen
  assert.equal(pr.lies(slug).rev, 17);
  assert.ok(!fs.existsSync(path.join(w, slug, '.sperre')), 'Sperre nach dem Speichern frei');
});

test('Atomarität: bricht das Schreiben der Temp-Datei ab, bleibt project.json heil (Fehler beim Schreiben simuliert)', (t) => {
  const w = tmpOrdner(t); const pr = new Projekte(w); const { slug } = pr.lege('Heil');
  pr.speichere(slug, specProjekt());
  const vorher = fs.readFileSync(path.join(w, slug, 'project.json'), 'utf8');
  const orig = fs.writeFileSync;
  fs.writeFileSync = (p, ...r) => { if (String(p).includes('project.json')) { orig(p, '{"halb":'); throw new Error('Platte voll'); } return orig(p, ...r); };
  try { assert.throws(() => pr.speichere(slug, neuesProjekt('Anders')), /Platte voll/); } finally { fs.writeFileSync = orig; }
  assert.equal(fs.readFileSync(path.join(w, slug, 'project.json'), 'utf8'), vorher);
  assert.ok(!fs.readdirSync(path.join(w, slug)).some((n) => n.includes('.tmp') || n.includes('.teil')), 'Temp-Rest aufgeräumt');
});

test('normalisiere: Schlüssel tief sortiert, Zahlen wie JSON.stringify (-0 → 0, 1.0 → 1), Array-Reihenfolge bleibt; idempotent', () => {
  const p = specProjekt(); p.spuren[0].pan = -0; p.tempo_bpm = 124.0;
  const n = normalisiere(p);
  assert.equal(JSON.stringify(n), kanonisch(p)); assert.equal(JSON.stringify(normalisiere(n)), JSON.stringify(n));
  assert.deepEqual(Object.keys(n), [...Object.keys(n)].sort()); assert.deepEqual(Object.keys(n.spuren[0].clips[0]), [...Object.keys(n.spuren[0].clips[0])].sort());
  assert.deepEqual(n.spuren.map((s) => s.id), ['s1', 's2', 's3']);
  assert.equal(Object.is(n.spuren[0].pan, 0), true, '-0 wird 0');
  assert.notEqual(n, p);
});

test('Wurzeln je Instanz: Betrieb = ~/cypherdj-projekte und ~/.cache/cypherdj/arr; Prüfinstanz (Buchstabe) hat eigene; ungültiger Buchstabe → Fehler', () => {
  assert.equal(projektWurzelVorgabe(''), path.join(os.homedir(), 'cypherdj-projekte'));
  assert.equal(arbeitsordnerVorgabe(''), path.join(os.homedir(), '.cache', 'cypherdj', 'arr'));
  assert.equal(projektWurzelVorgabe('t'), '/dev/shm/cypherdj-t/projekte');
  assert.equal(arbeitsordnerVorgabe('t'), path.join(os.homedir(), '.cache', 'cypherdj-t', 'arr'));
  assert.notEqual(projektWurzelVorgabe('t'), projektWurzelVorgabe('u')); assert.notEqual(projektWurzelVorgabe('t'), projektWurzelVorgabe(''));
  for (const x of ['ab', 'A', '1', '../x', '-']) { assert.throws(() => projektWurzelVorgabe(x), /Instanz/); assert.throws(() => arbeitsordnerVorgabe(x), /Instanz/); }
});
