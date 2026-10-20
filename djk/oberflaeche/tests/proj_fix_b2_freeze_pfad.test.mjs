// D1 S2-Integration, Fix-Runde B2 (Spec 6.29, 6.14): freeze.datei ist relativ zum Arbeitsordner der Instanz. Der Übersetzer bekommt dafür den
// Arbeitsordner (Option arbeitsordner); die Option projektOrdner entfällt. Vorher hieß sie projektOrdner, und wer dem Namen folgte, baute den Pfad
// aus dem Projektordner.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { uebersetze, WiedergabeFehler } from '../projekt/wiedergabe.ts';
import { Projekte } from '../projekt/ablage.ts';
import { SHA_B, specProjekt, tmpOrdner } from './hilfen/projekt.mjs';
import { sitzung } from './hilfen/proj_kontext.mjs';

const FREEZE = { datei: 'freeze-3-41.f32', frames: 9600, kennung: 41, sha256: SHA_B };
const eingefroren = () => { const p = specProjekt(); p.spuren[2].freeze = { ...FREEZE }; return p; };
const opt = (o) => ({ nr: 1, audioOrdner: '/a/audio', frames: () => 48000, ...o });

test('B2 Übersetzer: Datei im Arbeitsordner → Freeze-Clip mit diesem Pfad; nur im Projektordner → datei_fehlt; ohne Arbeitsordner → arbeitsordner_fehlt', (t) => {
  const arbeit = tmpOrdner(t, 'djk-b2-arr-'), projekt = tmpOrdner(t, 'djk-b2-proj-');
  fs.writeFileSync(path.join(projekt, FREEZE.datei), Buffer.alloc(800, 1));
  assert.throws(() => uebersetze(eingefroren(), opt({ arbeitsordner: arbeit })), (e) => e instanceof WiedergabeFehler && e.grund === 'datei_fehlt',
    'nur im Projektordner');
  fs.writeFileSync(path.join(arbeit, FREEZE.datei), Buffer.alloc(800, 1));
  const c = uebersetze(eingefroren(), opt({ arbeitsordner: arbeit })).spuren[2].clips[0];
  assert.equal(c.datei, path.join(arbeit, FREEZE.datei));
  assert.throws(() => uebersetze(eingefroren(), opt()), (e) => e instanceof WiedergabeFehler && e.grund === 'arbeitsordner_fehlt');
  assert.throws(() => uebersetze(eingefroren(), opt({ projektOrdner: arbeit })), (e) => e instanceof WiedergabeFehler && e.grund === 'arbeitsordner_fehlt',
    'die alte Option gibt es nicht mehr');
});

// Projekt mit eingefrorener Spur 3 auf der Platte, dann öffnen: die Sitzung lädt die Wiedergabe (oder meldet datei_fehlt)
async function oeffneEingefroren(t, wohin) {
  const { s, k, wurzel, arr } = sitzung(t, { arrFristMs: 30 });
  const pr = new Projekte(wurzel), { slug } = pr.lege('Frz');
  const p = eingefroren(); p.rev = 0; p.wiedergabe_rev = 0; p.naechste_id = { spur: 4, clip: 3 };
  pr.speichere(slug, p);
  fs.mkdirSync(arr, { recursive: true });
  if (wohin === 'arbeitsordner') fs.writeFileSync(path.join(arr, FREEZE.datei), Buffer.alloc(800, 1));
  else fs.writeFileSync(path.join(wurzel, slug, FREEZE.datei), Buffer.alloc(800, 1));
  const r = await s.oeffnen(slug, 'andreas');
  return { r, k, arr };
}

test('B2 Sitzung: Projekt mit eingefrorener Spur, Datei im Arbeitsordner → die Wiedergabe lädt (Freeze-Clip mit Pfad im Arbeitsordner)', async (t) => {
  const { r, k, arr } = await oeffneEingefroren(t, 'arbeitsordner');
  assert.equal(r.j.kern.wiedergabe.fehler, undefined, JSON.stringify(r.j.kern.wiedergabe));
  assert.equal(k.an('/k/arr/laden').length, 1);
  const w = JSON.parse(fs.readFileSync(path.join(arr, `wiedergabe-${r.j.kern.wiedergabe.nr}.json`), 'utf8'));
  assert.equal(w.spuren.find((x) => x.nr === 3).clips[0].datei, path.join(arr, FREEZE.datei));
});

test('B2 Sitzung: Datei nur im Projektordner → datei_fehlt, nichts geladen', async (t) => {
  const { r, k } = await oeffneEingefroren(t, 'projektordner');
  assert.deepEqual([r.j.kern.wiedergabe.nr, r.j.kern.wiedergabe.fehler], [null, 'datei_fehlt']);
  assert.equal(k.an('/k/arr/laden').length, 0);
});
