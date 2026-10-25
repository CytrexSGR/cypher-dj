// 1.8 Task 25: Spur.aufnahme {scharf, eingang}. AK1: arm/eingang ändern rev, nicht die Wiedergabe. AK2: Grenzen. AK3: alte Projekte öffnen unverändert.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreListeAus } from '../projekt/befehle.ts';
import { neuesProjekt as neuesProjektModell, pruefeProjekt, wiedergabeSicht } from '../projekt/modell.ts';

const neuesProjekt = () => neuesProjektModell('T');   // steht in projekt/modell.ts, nicht in tests/hilfen/projekt.mjs (Probelauf, Nachbesserung 1, N7)

const ein = (name) => ({ art: 'intern', name });
const mitSpuren = (n) => {
  let p = neuesProjekt();
  for (let i = 0; i < n; i++) p = fuehreListeAus(p, [{ befehl: 'spur_neu', art: 'audio', name: `A${i + 1}` }]).projekt;
  return p;
};

test('AK1: arm und eingang ändern den Stand, nicht die Wiedergabe-Sicht (kein Neuladen)', () => {
  const p = mitSpuren(1);
  const id = p.spuren[0].id;
  const e = fuehreListeAus(p, [{ befehl: 'spur_aendern', spur_id: id, eingang: ein('erz/1') }, { befehl: 'spur_aendern', spur_id: id, arm: true }]);
  assert.deepEqual(e.projekt.spuren[0].aufnahme, { scharf: true, eingang: ein('erz/1') });
  assert.equal(e.betrifft_wiedergabe, false);
  assert.ok(e.vor.length > 0 && e.zurueck.length > 0, 'der Patch kennt die Änderung, sonst gäbe es keinen Verlaufseintrag und kein Undo (Schnellweg istLeicht, N6)');
  assert.deepEqual(wiedergabeSicht(e.projekt), wiedergabeSicht(p));
  assert.deepEqual(e.regler_aenderungen, []);
  // Undo-Patch kehrt zurück: der Stand vor dem Befehl hat kein Feld aufnahme
  assert.equal(p.spuren[0].aufnahme, undefined);
});

test('AK2: scharf braucht einen Eingang, nur interne Eingänge, höchstens 8 scharf, nur Audio-Spuren', () => {
  const p = mitSpuren(10);
  const id = (i) => p.spuren[i].id;
  const grund = (f) => { try { f(); } catch (e) { return e.grund ?? String(e); } return null; };
  assert.equal(grund(() => fuehreListeAus(p, [{ befehl: 'spur_aendern', spur_id: id(0), arm: true }])), 'kein_eingang');
  assert.equal(grund(() => fuehreListeAus(p, [{ befehl: 'spur_aendern', spur_id: id(0), eingang: { art: 'intern', name: 'erz/9' } }])), 'eingang_fehlt');
  assert.equal(grund(() => fuehreListeAus(p, [{ befehl: 'spur_aendern', spur_id: id(0), eingang: { art: 'extern', paar: 1 } }])), 'eingang_fehlt');
  const acht = fuehreListeAus(p, Array.from({ length: 8 }, (_, i) => ({ befehl: 'spur_aendern', spur_id: id(i), eingang: ein('erz/1'), arm: true }))).projekt;
  assert.equal(acht.spuren.filter((s) => s.aufnahme?.scharf).length, 8);
  assert.equal(grund(() => fuehreListeAus(acht, [{ befehl: 'spur_aendern', spur_id: id(8), eingang: ein('erz/2'), arm: true }])), 'zu_viele_scharf');
  const rb = fuehreListeAus(mitSpuren(0), [{ befehl: 'spur_neu', art: 'instrument', name: 'RB', geraet: { art: 'intern', name: 'rb338', parameter: {} } }]).projekt;
  assert.equal(grund(() => fuehreListeAus(rb, [{ befehl: 'spur_aendern', spur_id: rb.spuren[0].id, arm: true }])), 'argument_ungueltig');
  // Entschärfen entfernt das Feld wieder, wenn nichts übrig bleibt
  const an = fuehreListeAus(p, [{ befehl: 'spur_aendern', spur_id: id(0), eingang: ein('erz/3'), arm: true }]).projekt;
  const aus = fuehreListeAus(an, [{ befehl: 'spur_aendern', spur_id: id(0), arm: false, eingang: null }]).projekt;
  assert.equal(aus.spuren[0].aufnahme, undefined);
});

test('AK3: ein Projekt ohne das Feld ist gültig und bleibt es; Müll im Feld wird abgelehnt', () => {
  const p = mitSpuren(2);
  assert.ok('projekt' in pruefeProjekt(JSON.parse(JSON.stringify(p))));   // pruefeProjekt wirft nicht: {projekt} oder {fehler}
  const kaputt = JSON.parse(JSON.stringify(p));
  kaputt.spuren[0].aufnahme = { scharf: true, eingang: null };
  assert.match(pruefeProjekt(kaputt).fehler, /scharf/);
  kaputt.spuren[0].aufnahme = { scharf: 'ja', eingang: ein('erz/1') };
  assert.ok('fehler' in pruefeProjekt(kaputt));
  const gut = JSON.parse(JSON.stringify(p));
  gut.spuren[0].aufnahme = { scharf: true, eingang: ein('erz/2') };
  assert.deepEqual(pruefeProjekt(JSON.parse(JSON.stringify(gut))).projekt.spuren[0].aufnahme, { scharf: true, eingang: ein('erz/2') });
});
