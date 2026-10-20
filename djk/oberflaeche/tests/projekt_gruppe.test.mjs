// Paket 1.18, E-c: Varianten-Gruppe. Das Feld gruppe der Spur, der Befehl variante_waehlen {gruppe, spur_id} (reine Befehle, AK-c).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreAus, fuehreListeAus, BefehlFehler } from '../projekt/befehle.ts';
import { neuesProjekt, pruefeProjekt, GRUPPE_MAX } from '../projekt/modell.ts';
import { wende } from '../projekt/patch.ts';
import { ohneAbgeleitetes } from './hilfen/projekt.mjs';

const lehntAb = (p, b, grund) => assert.throws(() => fuehreAus(p, b), (e) => e instanceof BefehlFehler && e.grund === grund, `erwartet ${grund} für ${JSON.stringify(b)}`);
// wie projekt_befehle.test.mjs: gültiges Ergebnis, vor und zurueck gehen genau hin und zurück, kein Index im Pfad
function pruefeErgebnis(p, r) {
  assert.ok(pruefeProjekt(r.projekt).projekt, `Ergebnis ungültig: ${JSON.stringify(pruefeProjekt(r.projekt))}`);
  assert.equal(ohneAbgeleitetes(wende(p, r.vor)), ohneAbgeleitetes(r.projekt), 'vor führt zum Ergebnis');
  assert.equal(ohneAbgeleitetes(wende(r.projekt, r.zurueck)), ohneAbgeleitetes(p), 'zurueck führt zum Ausgang');
  for (const o of [...r.vor, ...r.zurueck]) assert.ok(!/\/\d+(\/|$)/.test(o.pfad), `Index im Pfad ${o.pfad}`);
}
// s1, s2, s3 in Gruppe "bass" (s1 laut, s2 und s3 stumm), s4 ohne Gruppe (laut), s5 in Gruppe "lead" (laut)
function bassProjekt() {
  const bef = [
    { befehl: 'spur_neu', art: 'instrument', name: 'Bass A', gruppe: 'bass' },
    { befehl: 'spur_neu', art: 'instrument', name: 'Bass B', gruppe: 'bass' },
    { befehl: 'spur_neu', art: 'instrument', name: 'Bass C', gruppe: 'bass' },
    { befehl: 'spur_neu', art: 'audio', name: 'Kick' },
    { befehl: 'spur_neu', art: 'instrument', name: 'Lead A', gruppe: 'lead' },
    { befehl: 'spur_aendern', spur_id: 's2', mute: true }, { befehl: 'spur_aendern', spur_id: 's3', mute: true },
  ];
  return fuehreListeAus(neuesProjekt('V'), bef, { quelle: 'cypher' }).projekt;
}
const mutes = (p) => p.spuren.map((s) => s.mute);

test('gruppe: spur_neu und spur_aendern setzen sie, null nimmt die Spur heraus; Text 1 bis 32 Zeichen, sonst argument_ungueltig', () => {
  const p = bassProjekt();
  assert.deepEqual(p.spuren.map((s) => s.gruppe), ['bass', 'bass', 'bass', undefined, 'lead']);
  const r = fuehreAus(p, { befehl: 'spur_aendern', spur_id: 's4', gruppe: 'drums' });
  pruefeErgebnis(p, r);                                      // fängt den schnellen Weg: ein neues Feld fehlte sonst in vor und zurueck
  assert.equal(r.projekt.spuren[3].gruppe, 'drums');
  assert.equal(r.betrifft_wiedergabe, false);
  const q = fuehreAus(r.projekt, { befehl: 'spur_aendern', spur_id: 's4', gruppe: null });
  pruefeErgebnis(r.projekt, q);
  assert.ok(!('gruppe' in q.projekt.spuren[3]), 'null entfernt das Feld');
  const lang = 'x'.repeat(GRUPPE_MAX);
  assert.equal(fuehreAus(p, { befehl: 'spur_neu', art: 'audio', gruppe: lang }).projekt.spuren.at(-1).gruppe, lang);
  for (const schlecht of ['', '   ', 'x'.repeat(GRUPPE_MAX + 1), 7, true]) {
    lehntAb(p, { befehl: 'spur_neu', art: 'audio', gruppe: schlecht }, 'argument_ungueltig');
    lehntAb(p, { befehl: 'spur_aendern', spur_id: 's4', gruppe: schlecht }, 'argument_ungueltig');
  }
  // Negativ-Kontrolle: ohne gruppe bleibt das Feld weg
  assert.ok(!('gruppe' in fuehreAus(p, { befehl: 'spur_neu', art: 'audio' }).projekt.spuren.at(-1)));
});

test('gruppe: die Prüfung des Projekts kennt das Feld (Datei mit gruppe ist gültig), ein zu langer Text nicht', () => {
  const p = bassProjekt();
  assert.ok(pruefeProjekt(JSON.parse(JSON.stringify(p))).projekt);
  const kaputt = JSON.parse(JSON.stringify(p));
  kaputt.spuren[0].gruppe = 'x'.repeat(GRUPPE_MAX + 1);
  assert.match(pruefeProjekt(kaputt).fehler, /gruppe/);
});

test('variante_waehlen (AK-c): B laut, A und C stumm, die Spur außerhalb der Gruppe und die andere Gruppe bleiben; ein Befehl, Regler nur für Geändertes', () => {
  const p = bassProjekt();
  assert.deepEqual(mutes(p), [false, true, true, false, false]);
  const r = fuehreAus(p, { befehl: 'variante_waehlen', gruppe: 'bass', spur_id: 's2' });
  pruefeErgebnis(p, r);
  assert.deepEqual(mutes(r.projekt), [true, false, true, false, false], 'genau B laut; Kick (s4) und Lead (s5) unberührt');
  assert.deepEqual(r.regler_aenderungen, [{ pfad: 'spur/1/mute', wert: 1 }, { pfad: 'spur/2/mute', wert: 0 }]);
  assert.equal(r.betrifft_wiedergabe, false);
  // dieselbe Wahl noch einmal: nichts ändert sich
  const nochmal = fuehreAus(r.projekt, { befehl: 'variante_waehlen', gruppe: 'bass', spur_id: 's2' });
  assert.deepEqual(nochmal.regler_aenderungen, []);
  // C wählen, danach der Rückweg über zurueck stellt den Stand davor her (ein Undo-Schritt)
  const c = fuehreAus(r.projekt, { befehl: 'variante_waehlen', gruppe: 'bass', spur_id: 's3' });
  pruefeErgebnis(r.projekt, c);
  assert.deepEqual(mutes(c.projekt), [true, true, false, false, false]);
  assert.deepEqual(mutes(wende(c.projekt, c.zurueck)), mutes(r.projekt));
  // die andere Gruppe schaltet für sich
  const l = fuehreListeAus(c.projekt, [{ befehl: 'spur_neu', art: 'instrument', gruppe: 'lead' }, { befehl: 'variante_waehlen', gruppe: 'lead', spur_id: 's6' }]);
  assert.deepEqual(mutes(l.projekt), [true, true, false, false, true, false], 'Lead A stumm, Lead B laut; bass bleibt auf C');
});

test('variante_waehlen: Fehler. Spur nicht in der Gruppe, Spur unbekannt, Argumente fehlen oder sind fremd', () => {
  const p = bassProjekt();
  lehntAb(p, { befehl: 'variante_waehlen', gruppe: 'bass', spur_id: 's4' }, 'argument_ungueltig');       // Kick gehört nicht zu bass
  lehntAb(p, { befehl: 'variante_waehlen', gruppe: 'bass', spur_id: 's5' }, 'argument_ungueltig');       // Lead gehört zu lead
  lehntAb(p, { befehl: 'variante_waehlen', gruppe: 'bass', spur_id: 's99' }, 'spur_unbekannt');
  lehntAb(p, { befehl: 'variante_waehlen', spur_id: 's1' }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'variante_waehlen', gruppe: 'bass' }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'variante_waehlen', gruppe: 'bass', spur_id: 's1', mute: true }, 'argument_unbekannt');
});

test('variante_waehlen: eine Gruppe aus einer Spur (A allein) wird laut, wenn sie stumm war', () => {
  let p = fuehreListeAus(neuesProjekt('E'), [{ befehl: 'spur_neu', art: 'audio', gruppe: 'solo' }, { befehl: 'spur_aendern', spur_id: 's1', mute: true }]).projekt;
  p = fuehreAus(p, { befehl: 'variante_waehlen', gruppe: 'solo', spur_id: 's1' }).projekt;
  assert.equal(p.spuren[0].mute, false);
});

// Review S2 (2026-10-20): ein Gruppenname ohne Leerzeichen am Rand, an allen Eingängen gleich. Vorher nahm das Laden '   ' an (die Befehle nicht), und
// ' bass' wurde neben 'bass' eine zweite Gruppe mit eigener Tastenreihe.
test('gruppe: Leerzeichen am Rand lehnen Befehle und Laden gleich ab', () => {
  const p = bassProjekt();
  for (const schlecht of [' bass', 'bass ', '\tbass']) {
    lehntAb(p, { befehl: 'spur_neu', art: 'audio', gruppe: schlecht }, 'argument_ungueltig');
    lehntAb(p, { befehl: 'spur_aendern', spur_id: 's4', gruppe: schlecht }, 'argument_ungueltig');
  }
  for (const schlecht of ['   ', ' bass']) {
    const kaputt = JSON.parse(JSON.stringify(p));
    kaputt.spuren[0].gruppe = schlecht;
    assert.match(pruefeProjekt(kaputt).fehler ?? '', /gruppe/, `Laden lehnt ${JSON.stringify(schlecht)} ab`);
  }
  // Negativ-Kontrolle: ein Leerzeichen innen ist erlaubt
  assert.equal(fuehreAus(p, { befehl: 'spur_neu', art: 'audio', gruppe: 'bass 2' }).projekt.spuren.at(-1).gruppe, 'bass 2');
});
