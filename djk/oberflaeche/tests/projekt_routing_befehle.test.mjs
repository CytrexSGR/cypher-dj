// 1.10 Slice 1: Befehle gruppenspur_neu/-aendern/-loeschen, ziel_setzen, master_aendern (Spec 5.2; AK4 Pegel-Pfade, AK7, AK22, AK28).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreAus, fuehreListeAus, BefehlFehler } from '../projekt/befehle.ts';
import { neuesProjekt, pruefeProjekt, kanonisch, MAX_GRUPPEN } from '../projekt/modell.ts';
import { wende } from '../projekt/patch.ts';
import { Verlauf, aendere, rueckgaengig } from '../projekt/verlauf.ts';
import { ohneAbgeleitetes, tmpOrdner } from './hilfen/projekt.mjs';
import fs from 'node:fs';
import path from 'node:path';

const zeilen = (d) => (fs.existsSync(d) ? fs.readFileSync(d, 'utf8').split('\n').filter(Boolean).map((z) => JSON.parse(z)) : []);
const ok = (p, b) => fuehreAus(p, b);
const lehntAb = (p, b, grund) => assert.throws(() => fuehreAus(p, b), (e) => e instanceof BefehlFehler && e.grund === grund, `erwartet ${grund} für ${JSON.stringify(b).slice(0, 90)}`);
function pruefe(p, r) {   // gültig, vor/zurueck gehen hin und zurück, Eingabe unberührt (AK22: ein Undo-Schritt)
  assert.equal(pruefeProjekt(r.projekt).fehler, undefined, JSON.stringify(pruefeProjekt(r.projekt)));
  assert.equal(ohneAbgeleitetes(wende(p, r.vor)), ohneAbgeleitetes(r.projekt));
  assert.equal(ohneAbgeleitetes(wende(r.projekt, r.zurueck)), ohneAbgeleitetes(p));
}
const gleichLeichtVoll = (p, b) => {   // der schnelle Weg ergibt dasselbe wie der allgemeine
  const l = fuehreListeAus(p, [b]), v = fuehreListeAus(p, [b], { voll: true });
  assert.deepEqual(l.vor, v.vor); assert.deepEqual(l.zurueck, v.zurueck); assert.deepEqual(l.regler_aenderungen, v.regler_aenderungen);
  assert.equal(l.betrifft_wiedergabe, v.betrifft_wiedergabe); assert.equal(kanonisch(l.projekt), kanonisch(v.projekt));
};
const mit3 = () => {
  let p = neuesProjekt('T');
  for (let i = 0; i < 3; i++) p = ok(p, { befehl: 'spur_neu', art: 'audio', name: `T${i + 1}` }).projekt;
  return p;
};

test('gruppenspur_neu: kleinste freie nr, ID g1, Name, Farbe, vier Regler grp/1/*; Mitglieder wechseln im selben Schritt; betrifft die Wiedergabe', () => {
  const p = mit3(); const r = ok(p, { befehl: 'gruppenspur_neu', name: 'Music', mitglieder: ['s2', 's3'] });
  pruefe(p, r);
  assert.deepEqual(r.projekt.gruppen.map((g) => [g.id, g.nr, g.name, g.fader_db, g.pan, g.mute, g.solo, g.gefaltet]), [['g1', 1, 'Music', 0, 0, false, false, false]]);
  assert.match(r.projekt.gruppen[0].farbe, /^#[0-9a-f]{6}$/);
  assert.deepEqual(r.projekt.spuren.map((s) => s.ausgang?.id ?? null), [null, 'g1', 'g1']);
  assert.equal(r.betrifft_wiedergabe, true);
  assert.deepEqual(r.regler_aenderungen, [{ pfad: 'grp/1/fader', wert: 0 }, { pfad: 'grp/1/pan', wert: 0 }, { pfad: 'grp/1/mute', wert: 0 }, { pfad: 'grp/1/solo', wert: 0 }]);
  assert.equal(p.gruppen.length, 0, 'Eingabe unberührt');
  const zwei = ok(r.projekt, { befehl: 'gruppenspur_neu' }); pruefe(r.projekt, zwei);
  assert.deepEqual(zwei.projekt.gruppen.map((g) => [g.id, g.nr, g.name]), [['g1', 1, 'Music'], ['g2', 2, 'Group 2']]);
});

test('gruppenspur_neu: Grenzen und Ablehnungen (acht Gruppen, unbekannte Mitglieder, fremde Felder); eine ID wird nie wiederverwendet', () => {
  let p = neuesProjekt('T');
  for (let i = 0; i < MAX_GRUPPEN; i++) p = ok(p, { befehl: 'gruppenspur_neu' }).projekt;
  lehntAb(p, { befehl: 'gruppenspur_neu' }, 'routing_grenze');
  const q = ok(p, { befehl: 'gruppenspur_loeschen', gruppe_id: 'g3' }).projekt;
  const n = ok(q, { befehl: 'gruppenspur_neu' }).projekt;
  assert.deepEqual(n.gruppen.at(-1).id, 'g9', 'ID nie wiederverwendet (Spec 6.26)'); assert.equal(n.gruppen.at(-1).nr, 3, 'die Nummer (Regler-Slot) wird frei');
  const k = mit3();
  lehntAb(k, { befehl: 'gruppenspur_neu', mitglieder: ['s9'] }, 'spur_unbekannt');
  lehntAb(k, { befehl: 'gruppenspur_neu', mitglieder: [] }, 'argument_ungueltig');
  lehntAb(k, { befehl: 'gruppenspur_neu', mitglieder: ['s1', 's1'] }, 'argument_ungueltig');
  lehntAb(k, { befehl: 'gruppenspur_neu', farbe: 'rot' }, 'argument_ungueltig');
  lehntAb(k, { befehl: 'gruppenspur_neu', gruppe: 'x' }, 'argument_unbekannt');
});

test('gruppenspur_aendern: Fader, Pan, Mute, Solo, Name, Farbe, Falten; schneller Weg = allgemeiner Weg; nur Regler, keine neue Wiedergabe', () => {
  const p = ok(mit3(), { befehl: 'gruppenspur_neu', mitglieder: ['s1'] }).projekt;
  for (const felder of [{ fader_db: -6 }, { pan: 0.5 }, { mute: true }, { solo: true }, { name: 'Bus' }, { farbe: '#112233' }, { gefaltet: true }, { fader_db: -3, pan: -1, mute: true }]) {
    const b = { befehl: 'gruppenspur_aendern', gruppe_id: 'g1', ...felder };
    const r = ok(p, b); pruefe(p, r); gleichLeichtVoll(p, b);
    assert.equal(r.betrifft_wiedergabe, false, JSON.stringify(felder));
  }
  assert.deepEqual(ok(p, { befehl: 'gruppenspur_aendern', gruppe_id: 'g1', fader_db: -6, mute: true }).regler_aenderungen, [{ pfad: 'grp/1/fader', wert: -6 }, { pfad: 'grp/1/mute', wert: 1 }]);
  assert.deepEqual(ok(p, { befehl: 'gruppenspur_aendern', gruppe_id: 'g1', gefaltet: true }).regler_aenderungen, [], 'Falten ist kein Regler');
  lehntAb(p, { befehl: 'gruppenspur_aendern', gruppe_id: 'g9', mute: true }, 'gruppe_unbekannt');
  lehntAb(p, { befehl: 'gruppenspur_aendern', gruppe_id: 'g1', fader_db: 7 }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'gruppenspur_aendern', gruppe_id: 'g1', pan: 2 }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'gruppenspur_aendern', gruppe_id: 'g1' }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'gruppenspur_aendern', gruppe_id: 'g1', nr: 3 }, 'argument_unbekannt');
});

test('gruppenspur_loeschen: Mitglieder wechseln auf master (ein Undo-Schritt), Regler zurück auf die Vorgabe, nie verwaiste Ziele', () => {
  let p = ok(mit3(), { befehl: 'gruppenspur_neu', mitglieder: ['s1', 's2'] }).projekt;
  p = ok(p, { befehl: 'gruppenspur_aendern', gruppe_id: 'g1', fader_db: -6, mute: true }).projekt;
  const r = ok(p, { befehl: 'gruppenspur_loeschen', gruppe_id: 'g1' }); pruefe(p, r);
  assert.deepEqual(r.projekt.gruppen, []); assert.ok(r.projekt.spuren.every((s) => s.ausgang === undefined));
  assert.deepEqual(r.regler_aenderungen, [{ pfad: 'grp/1/fader', wert: 0 }, { pfad: 'grp/1/pan', wert: 0 }, { pfad: 'grp/1/mute', wert: 0 }, { pfad: 'grp/1/solo', wert: 0 }]);
  assert.equal(r.betrifft_wiedergabe, true);
  lehntAb(p, { befehl: 'gruppenspur_loeschen', gruppe_id: 'g9' }, 'gruppe_unbekannt');
});

test('ziel_setzen (AK7): Spur in Gruppe und zurück; Zyklus, Verschachtelung und unbekanntes Ziel werden abgelehnt; ein azyklischer Fall gleicher Größe wird angenommen', () => {
  const p = ok(mit3(), { befehl: 'gruppenspur_neu' }).projekt;
  const r = ok(p, { befehl: 'ziel_setzen', strang_id: 's1', ausgang: { art: 'gruppe', id: 'g1' } }); pruefe(p, r);
  assert.deepEqual(r.projekt.spuren[0].ausgang, { art: 'gruppe', id: 'g1' }); assert.equal(r.betrifft_wiedergabe, true);
  const z = ok(r.projekt, { befehl: 'ziel_setzen', strang_id: 's1', ausgang: 'master' }); pruefe(r.projekt, z);
  assert.equal(z.projekt.spuren[0].ausgang, undefined, 'master wird nie gespeichert');
  const z2 = ok(r.projekt, { befehl: 'ziel_setzen', strang_id: 's1', ausgang: { art: 'master' } }); assert.equal(z2.projekt.spuren[0].ausgang, undefined);
  lehntAb(p, { befehl: 'ziel_setzen', strang_id: 'g1', ausgang: { art: 'gruppe', id: 'g1' } }, 'routing_zyklus');     // Gruppe in sich selbst
  const zwei = ok(p, { befehl: 'gruppenspur_neu' }).projekt;
  lehntAb(zwei, { befehl: 'ziel_setzen', strang_id: 'g1', ausgang: { art: 'gruppe', id: 'g2' } }, 'routing_grenze');   // Tiefe 1
  lehntAb(p, { befehl: 'ziel_setzen', strang_id: 's1', ausgang: { art: 'gruppe', id: 'g9' } }, 'ziel_unbekannt');
  lehntAb(p, { befehl: 'ziel_setzen', strang_id: 's9', ausgang: 'master' }, 'spur_unbekannt');
  lehntAb(p, { befehl: 'ziel_setzen', strang_id: 's1', ausgang: 'return' }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'ziel_setzen', strang_id: 's1' }, 'argument_ungueltig');
  assert.equal(ok(p, { befehl: 'ziel_setzen', strang_id: 'g1', ausgang: 'master' }).projekt.gruppen[0].id, 'g1', 'Negativ-Kontrolle: die Gruppe auf master ist gültig (ohne Wirkung)');
});

test('ziel_setzen: ein Ziel-Wechsel verwirft keinen Freeze einer Wirt-Spur', () => {
  let p = neuesProjekt('T');
  p = ok(p, { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'wirt', name: 'surge' } }).projekt;
  p = ok(p, { befehl: 'gruppenspur_neu' }).projekt;
  p.spuren[0].freeze = { datei: 'freeze-1-1.f32', frames: 48000, kennung: 1, sha256: 'a'.repeat(64) };
  const r = ok(p, { befehl: 'ziel_setzen', strang_id: 's1', ausgang: { art: 'gruppe', id: 'g1' } });
  assert.ok(r.projekt.spuren[0].freeze, 'Freeze bleibt (er ist vor Fader und Ziel)');
});

test('master_aendern: PM-Fader, Bereich, Regler pm/fader, schneller Weg = allgemeiner Weg', () => {
  const p = mit3(), b = { befehl: 'master_aendern', fader_db: -6 };
  const r = ok(p, b); pruefe(p, r); gleichLeichtVoll(p, b);
  assert.deepEqual(r.projekt.master, { fader_db: -6 }); assert.deepEqual(r.regler_aenderungen, [{ pfad: 'pm/fader', wert: -6 }]); assert.equal(r.betrifft_wiedergabe, false);
  assert.deepEqual(ok(p, { befehl: 'master_aendern', fader_db: 0 }).regler_aenderungen, [], 'gleicher Wert: nichts zu senden');
  lehntAb(p, { befehl: 'master_aendern', fader_db: 7 }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'master_aendern' }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'master_aendern', fader_db: 0, pan: 0 }, 'argument_unbekannt');
});

test('AK28: eine Gruppen-Spur und eine Varianten-Gruppe (Feld gruppe) im selben Projekt; variante_waehlen schaltet keine Gruppen-Spur stumm', () => {
  let p = mit3();
  p = ok(p, { befehl: 'spur_aendern', spur_id: 's1', gruppe: 'bass' }).projekt;
  p = ok(p, { befehl: 'spur_aendern', spur_id: 's2', gruppe: 'bass' }).projekt;
  p = ok(p, { befehl: 'gruppenspur_neu', name: 'Music', mitglieder: ['s1', 's2'] }).projekt;
  const v = ok(p, { befehl: 'variante_waehlen', gruppe: 'bass', spur_id: 's1' });
  assert.deepEqual(v.projekt.spuren.map((s) => s.mute), [false, true, false]);
  assert.equal(v.projekt.gruppen[0].mute, false, 'Negativ-Kontrolle: die Gruppen-Spur bleibt laut');
  assert.deepEqual(v.projekt.spuren.map((s) => s.ausgang?.id ?? null), ['g1', 'g1', null], 'die Ziele bleiben');
});

test('AK22 (Liste): eine Liste aus Anlegen, Einstecken und Ziehen ist EIN Undo-Schritt', () => {
  const p = mit3();
  const r = fuehreListeAus(p, [{ befehl: 'gruppenspur_neu', name: 'M' }, { befehl: 'ziel_setzen', strang_id: 's1', ausgang: { art: 'gruppe', id: 'g1' } },
    { befehl: 'gruppenspur_aendern', gruppe_id: 'g1', fader_db: -4 }]);
  pruefe(p, r);
  assert.equal(r.projekt.gruppen[0].fader_db, -4);
  assert.ok(r.vor.length > 0 && r.zurueck.length > 0);
});

test('AK22 (Zug, B2): viele Anfragen an einem Gruppen- oder Master-Fader im Fenster sind EIN Verlaufseintrag und EIN Undo, wie beim Spur-Fader; Name, zwei Felder, andere Gruppe oder anderes Feld trennen', (t) => {
  const datei = path.join(tmpOrdner(t), 'undo.jsonl'); const uhr = { t: Date.parse('2026-10-22T12:00:00Z') };
  const v = new Verlauf(datei, { jetzt: () => uhr.t, zeitgeber: false });
  const A = { quelle: 'andreas', label: 'Test' };
  let p = aendere(v, mit3(), [{ befehl: 'gruppenspur_neu' }, { befehl: 'gruppenspur_neu' }], A).projekt;   // Eintrag 1
  const zug = (b) => { uhr.t += 100; p = aendere(v, p, [b], A).projekt; };
  for (let i = 1; i <= 6; i++) zug({ befehl: 'gruppenspur_aendern', gruppe_id: 'g1', fader_db: -i });       // Eintrag 2: sechs Anfragen, ein Eintrag
  for (let i = 1; i <= 6; i++) zug({ befehl: 'master_aendern', fader_db: -i });                               // Eintrag 3
  for (let i = 1; i <= 3; i++) zug({ befehl: 'gruppenspur_aendern', gruppe_id: 'g2', fader_db: -i });         // Eintrag 4: andere Gruppe
  zug({ befehl: 'gruppenspur_aendern', gruppe_id: 'g2', pan: 0.5 });                                           // Eintrag 5: anderes Feld
  zug({ befehl: 'gruppenspur_aendern', gruppe_id: 'g2', name: 'A' });                                          // Eintrag 6 und 7: Name ist kein Mixer-Feld
  zug({ befehl: 'gruppenspur_aendern', gruppe_id: 'g2', name: 'B' });
  zug({ befehl: 'gruppenspur_aendern', gruppe_id: 'g1', fader_db: -20, mute: true });                          // Eintrag 8: zwei Felder
  v.flush();
  const z = zeilen(datei);
  assert.equal(z.length, 8, JSON.stringify(z.map((e) => e.vor)));
  assert.deepEqual([z[1].vor.length, z[1].vor[0].wert, z[1].zurueck[0].wert], [1, -6, 0], 'Gruppen-Zug: letztes vor, erstes zurueck');
  assert.deepEqual([z[2].vor.length, z[2].vor[0].wert, z[2].zurueck[0].wert], [1, -6, 0], 'Master-Zug');
  assert.deepEqual([z[3].vor[0].wert, z[3].zurueck[0].wert], [-3, 0], 'andere Gruppe: eigener Eintrag');
  // ein Undo je Zug (eigener Verlauf, frische Zeit)
  const w = new Verlauf(path.join(tmpOrdner(t), 'undo.jsonl'), { jetzt: () => uhr.t, zeitgeber: false });
  let q = aendere(w, mit3(), [{ befehl: 'gruppenspur_neu' }], A).projekt;
  for (let i = 1; i <= 6; i++) { uhr.t += 100; q = aendere(w, q, [{ befehl: 'gruppenspur_aendern', gruppe_id: 'g1', fader_db: -i }], A).projekt; }
  const u = rueckgaengig(w, q, { quelle: 'andreas' });
  assert.equal(u.projekt.gruppen[0].fader_db, 0, 'ein Undo für den ganzen Zug');
  assert.deepEqual(u.regler_aenderungen, [{ pfad: 'grp/1/fader', wert: 0 }]);
  q = u.projekt;
  for (let i = 1; i <= 6; i++) { uhr.t += 100; q = aendere(w, q, [{ befehl: 'master_aendern', fader_db: -i }], A).projekt; }
  const um = rueckgaengig(w, q, { quelle: 'andreas' });
  assert.equal(um.projekt.master.fader_db, 0); assert.deepEqual(um.regler_aenderungen, [{ pfad: 'pm/fader', wert: 0 }]);
});
