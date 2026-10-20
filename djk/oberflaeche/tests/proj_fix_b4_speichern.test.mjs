// D1 S2-Integration, Fix-Runde B4 (Spec 6.30 Leistung, Quality-Befund 4): eine Noten-Änderung speichert project.json EINMAL. Vorher speicherte
// aendere() den neuen Stand und ladeWiedergabe() gleich danach noch einmal, nur um wiedergabe_rev nachzutragen (bei 60.000 Noten zweimal 3,6 MB mit
// fsync). Jetzt entsteht die Wiedergabe vor dem Speichern, und die eine Speicherung trägt ihre Nummer schon.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Projekte } from '../projekt/ablage.ts';
import { sitzung } from './hilfen/proj_kontext.mjs';

const N = (beat) => ({ beat, laenge: 1, ton: 60, vel: 100 });
async function aufbau(t) {
  const e = sitzung(t);
  await e.s.neu('S', 'andreas');
  await e.s.aendern({ rev: 0, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'instrument' }, { befehl: 'spur_neu', art: 'audio' }] }, 'andreas');
  await e.s.aendern({ rev: 1, label: 'Clip', befehle: [{ befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 0, laenge_beats: 4 }] }, 'andreas');
  const saves = [];
  const orig = Projekte.prototype.speichere;
  Projekte.prototype.speichere = function (slug, p) { saves.push(p.wiedergabe_rev); return orig.call(this, slug, p); };
  t.after(() => { Projekte.prototype.speichere = orig; });
  const datei = () => JSON.parse(fs.readFileSync(path.join(e.wurzel, e.s.aktuell().j.slug, 'project.json'), 'utf8'));
  e.k.leere();
  return { ...e, saves, datei };
}

test('B4 Noten-Änderung: eine Speicherung, sie trägt schon die neue Wiedergabe-Nummer; /k/arr/laden mit derselben Nummer', async (t) => {
  const { s, k, saves, datei } = await aufbau(t);
  const r = await s.aendern({ rev: 2, label: 'Note', befehle: [{ befehl: 'noten_neu', clip_id: 'c1', noten: [N(0)] }] }, 'andreas');
  const nr = r.j.kern.wiedergabe.nr;
  assert.ok(Number.isInteger(nr), JSON.stringify(r.j.kern));
  assert.deepEqual(saves, [nr], `Speicherungen (wiedergabe_rev je Speicherung): ${JSON.stringify(saves)}`);
  assert.equal(datei().wiedergabe_rev, nr);
  assert.equal(datei().rev, 3);
  assert.deepEqual(k.an('/k/arr/laden').map((x) => x.felder.nr), [nr]);
  saves.length = 0;
  const u = await s.umkehr('undo', { rev: 3 }, 'andreas');
  assert.deepEqual(saves, [u.j.kern.wiedergabe.nr], 'auch Undo speichert einmal');
  assert.equal(datei().wiedergabe_rev, u.j.kern.wiedergabe.nr);
});

test('B4 Negativ-Kontrolle: ein Fader speichert einmal und lädt keine Wiedergabe (wiedergabe_rev bleibt)', async (t) => {
  const { s, k, saves, datei } = await aufbau(t);
  const vorher = datei().wiedergabe_rev;
  await s.aendern({ rev: 2, label: 'Fader', befehle: [{ befehl: 'spur_aendern', spur_id: 's2', fader_db: -6 }] }, 'andreas');
  assert.deepEqual(saves, [vorher]);
  assert.equal(k.an('/k/arr/laden').length, 0);
});

test('B4 Wiedergabe scheitert (eingefrorene Spur ohne Datei): die Änderung ist einmal gespeichert, wiedergabe_rev bleibt, kern.wiedergabe nennt den Fehler', async (t) => {
  const { s, k, saves, datei, wurzel } = await aufbau(t);
  const slug = s.aktuell().j.slug;
  // Spur s1 auf Surge mit Freeze, dessen Datei fehlt: über die Ablage, dann neu öffnen
  s.schliesse();
  const pr = new Projekte(wurzel), p = pr.lies(slug);
  p.spuren[0].geraet = { art: 'wirt', name: 'surge', slot: 1 }; p.spuren[0].freeze = { datei: 'freeze-1-9.f32', frames: 4800, kennung: 9, sha256: 'b'.repeat(64) };
  Projekte.prototype.speichere.call(pr, slug, p);
  await s.oeffnen(slug, 'andreas');
  saves.length = 0; k.leere();
  const vorher = datei().wiedergabe_rev;
  const r = await s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'Clip', befehle: [{ befehl: 'spur_neu', art: 'instrument' }] }, 'andreas');
  assert.equal(r.j.kern.wiedergabe.fehler, 'datei_fehlt', JSON.stringify(r.j.kern));
  assert.deepEqual(saves, [vorher]);
  assert.equal(datei().wiedergabe_rev, vorher);
  assert.equal(datei().spuren.length, 3, 'die Änderung selbst ist gespeichert');
  assert.equal(k.an('/k/arr/laden').length, 0);
});
