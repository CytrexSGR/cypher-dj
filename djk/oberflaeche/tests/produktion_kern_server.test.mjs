// PRODUCTION V2 Nachzug (7c, 7d) gegen den echten Server-Code im selben Baum: /proj/aendern antwortet 200 mit kern.wiedergabe =
// {nr: null, fehler, text}, wenn der Übersetzer die Wiedergabe nicht bauen kann, und mit kern.regler = 'kein_kern', wenn Mixer-Werte
// ohne Kern angenommen werden (Spec 6.30). Genau diese Formen liest die Seite (produktion.js kernHinweis). Kein Server-Code geändert;
// der Test hält fest, dass Seite und Sitzung dieselbe Form meinen.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Projekte } from '../projekt/ablage.ts';
import { SHA_B, specProjekt } from './hilfen/projekt.mjs';
import { sitzung, pruefKontext } from './hilfen/proj_kontext.mjs';
import { kernHinweis } from '../oeffentlich/produktion/produktion.js';

const FREEZE = { datei: 'freeze-3-41.f32', frames: 9600, kennung: 41, sha256: SHA_B };

async function offen(t, kontext) {
  const { s, wurzel, arr } = sitzung(t, { arrFristMs: 30 }, kontext);
  const pr = new Projekte(wurzel), { slug } = pr.lege('Kern');
  const p = specProjekt(); p.spuren[2].freeze = { ...FREEZE }; p.rev = 0; p.wiedergabe_rev = 0; p.naechste_id = { spur: 4, clip: 3 };
  pr.speichere(slug, p);
  fs.mkdirSync(arr, { recursive: true });
  fs.writeFileSync(path.join(arr, FREEZE.datei), Buffer.alloc(800, 1));
  const r = await s.oeffnen(slug, 'andreas');
  return { s, arr, r };
}

test('V2 Kern-Hinweis gegen die Sitzung: Wiedergabe nicht gebaut → 200 mit kern.wiedergabe {nr: null, fehler, text}', async (t) => {
  const { s, arr, r } = await offen(t, pruefKontext());
  assert.equal(typeof r.j.kern.wiedergabe.nr, 'number', 'Positiv-Kontrolle: mit Datei lädt die Wiedergabe');
  const gut = await s.aendern({ rev: r.j.projekt.rev, label: 'Add note', befehle: [{ befehl: 'noten_neu', clip_id: 'c2', noten: [{ beat: 1, laenge: 0.5, ton: 38, vel: 90 }] }] }, 'andreas');
  assert.equal(kernHinweis(gut.j.kern), null, `geladen: kein Hinweis (${JSON.stringify(gut.j.kern.wiedergabe)})`);
  fs.rmSync(path.join(arr, FREEZE.datei));                                   // die Freeze-Datei der eingefrorenen Spur ist weg
  const a = await s.aendern({ rev: gut.j.rev, label: 'Add note', befehle: [{ befehl: 'noten_neu', clip_id: 'c2', noten: [{ beat: 2, laenge: 0.5, ton: 38, vel: 90 }] }] }, 'andreas');
  assert.equal(a.code, 200, 'die Änderung ist gespeichert');
  assert.deepEqual([a.j.kern.wiedergabe.nr, a.j.kern.wiedergabe.fehler, typeof a.j.kern.wiedergabe.text], [null, 'datei_fehlt', 'string']);
  assert.equal(kernHinweis(a.j.kern), 'Saved, but the core did not load the arrangement: a frozen track file is missing');
});

test('V2 Kern-Hinweis gegen die Sitzung: Mixer ohne Kern (Quittung null) → 200 mit kern.regler kein_kern', async (t) => {
  const k = pruefKontext();
  const { s, r } = await offen(t, k);
  k.regel = () => null;                                                      // ab jetzt antwortet der Kern nicht
  const a = await s.aendern({ rev: r.j.projekt.rev, label: 'Mixer', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -6 }] }, 'andreas');
  assert.deepEqual([a.code, a.j.kern.regler, a.j.projekt.spuren[0].fader_db], [200, 'kein_kern', -6]);
  assert.equal(kernHinweis(a.j.kern), 'Saved; the core is not running');
});
