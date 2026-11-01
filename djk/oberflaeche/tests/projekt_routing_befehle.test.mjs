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

// ---- 1.10 slice 3: return_neu, return_aendern, return_loeschen, send_setzen (spec 5.2; AK12 server part, AK22 send/return) -------------------
const mitRet = () => {
  let p = mit3();
  p = ok(p, { befehl: 'gruppenspur_neu', name: 'Music', mitglieder: ['s2'] }).projekt;
  return p;
};

test('return_neu: smallest free nr, id r1, defaults, Hall defaults; controls; affects the playback', () => {
  const p = mitRet(), b = { befehl: 'return_neu' };
  const r = ok(p, b); pruefe(p, r);
  assert.deepEqual(r.projekt.returns.map((x) => [x.id, x.nr, x.name, x.fader_db, x.pan, x.mute, x.solo]), [['r1', 1, 'Return 1', 0, 0, false, false]]);
  assert.deepEqual(r.projekt.returns[0].hall, { an: true, pre: 0.04, decay: 0.5252, groesse: 0.282, tief: 0.5658, highcut: 0.8039, fahne: 0.66667 });
  assert.equal(r.projekt.naechste_id.return, 2);
  assert.equal(r.betrifft_wiedergabe, true);
  assert.deepEqual(r.regler_aenderungen, [{ pfad: 'ret/1/fader', wert: 0 }, { pfad: 'ret/1/pan', wert: 0 }, { pfad: 'ret/1/mute', wert: 0 }, { pfad: 'ret/1/solo', wert: 0 }],
    'the "+ Return: Hall" button is return_neu without arguments: four controls, the Hall stays at its defaults');
  assert.ok(!('returns' in p), 'input untouched');
  const h = ok(p, { befehl: 'return_neu', name: 'Plate', farbe: '#112233', hall: { decay: 0.8, an: false } }); pruefe(p, h);
  assert.deepEqual([h.projekt.returns[0].name, h.projekt.returns[0].farbe, h.projekt.returns[0].hall.decay, h.projekt.returns[0].hall.an], ['Plate', '#112233', 0.8, false]);
  assert.deepEqual(h.regler_aenderungen.filter((x) => x.pfad.includes('hall')), [{ pfad: 'ret/1/hall/an', wert: 0 }, { pfad: 'ret/1/hall/decay', wert: 0.8 }]);
  const zwei = ok(r.projekt, b); pruefe(r.projekt, zwei);
  assert.deepEqual(zwei.projekt.returns.map((x) => [x.id, x.nr]), [['r1', 1], ['r2', 2]]);
});

test('return_neu: limit of four (routing_grenze), arguments, an id is never reused and the freed number is', () => {
  let p = mitRet();
  for (let i = 0; i < 4; i++) p = ok(p, { befehl: 'return_neu' }).projekt;
  lehntAb(p, { befehl: 'return_neu' }, 'routing_grenze');                                          // the fifth
  const q = ok(p, { befehl: 'return_loeschen', return_id: 'r2' }).projekt;
  const n = ok(q, { befehl: 'return_neu' }).projekt;
  assert.equal(n.returns.find((x) => x.nr === 2).id, 'r5', 'id never reused, the freed number (slot) is reused'); assert.ok(!n.returns.some((x) => x.id === 'r2'));
  const o = mitRet();
  lehntAb(o, { befehl: 'return_neu', farbe: 'red' }, 'argument_ungueltig');
  lehntAb(o, { befehl: 'return_neu', name: '' }, 'argument_ungueltig');
  lehntAb(o, { befehl: 'return_neu', hall: { decay: 1.5 } }, 'argument_ungueltig');
  lehntAb(o, { befehl: 'return_neu', hall: { mix: 0.5 } }, 'argument_unbekannt');
  lehntAb(o, { befehl: 'return_neu', hall: {} }, 'argument_ungueltig');
  lehntAb(o, { befehl: 'return_neu', extra: 1 }, 'argument_unbekannt');
  assert.ok(ok(o, { befehl: 'return_neu', hall: { decay: 1 } }), 'negative control: the boundary 1 is valid');
});

test('return_aendern: fields, Hall partial, controls ret/<r>/*, quick path equals the general path, rejections', () => {
  const p = ok(mitRet(), { befehl: 'return_neu' }).projekt;
  const b = { befehl: 'return_aendern', return_id: 'r1', fader_db: -6, hall: { decay: 0.9, highcut: 0.5 } };
  const r = ok(p, b); pruefe(p, r); gleichLeichtVoll(p, b);
  assert.equal(r.projekt.returns[0].fader_db, -6); assert.equal(r.projekt.returns[0].hall.decay, 0.9); assert.equal(r.projekt.returns[0].hall.pre, 0.04, 'the rest of the Hall stays');
  assert.deepEqual(r.regler_aenderungen, [{ pfad: 'ret/1/fader', wert: -6 }, { pfad: 'ret/1/hall/decay', wert: 0.9 }, { pfad: 'ret/1/hall/highcut', wert: 0.5 }]);
  assert.equal(r.betrifft_wiedergabe, false, 'level and Hall are controls, not playback');
  const m = ok(p, { befehl: 'return_aendern', return_id: 'r1', mute: true, solo: true, pan: -0.5, name: 'X', farbe: '#abcdef' }); pruefe(p, m);
  assert.deepEqual(m.regler_aenderungen, [{ pfad: 'ret/1/pan', wert: -0.5 }, { pfad: 'ret/1/mute', wert: 1 }, { pfad: 'ret/1/solo', wert: 1 }]);
  assert.deepEqual(ok(p, { befehl: 'return_aendern', return_id: 'r1', fader_db: 0 }).regler_aenderungen, [], 'same value: nothing to send');
  lehntAb(p, { befehl: 'return_aendern', return_id: 'r9', fader_db: 0 }, 'return_unbekannt');
  lehntAb(p, { befehl: 'return_aendern', return_id: 'r1' }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'return_aendern', return_id: 'r1', fader_db: 7 }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'return_aendern', return_id: 'r1', hall: { decay: -0.1 } }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'return_aendern', return_id: 'r1', hall: { an: 1 } }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'return_aendern', return_id: 'r1', send: 1 }, 'argument_unbekannt');
  assert.equal(p.returns[0].hall.decay, 0.5252, 'a refused command wrote nothing');
});

test('send_setzen: sets, changes, removes with -200; controls spur|grp/<n>/send/<r>; order by return number; rejections', () => {
  let p = ok(ok(mitRet(), { befehl: 'return_neu' }).projekt, { befehl: 'return_neu' }).projekt;
  const b = { befehl: 'send_setzen', strang_id: 's1', return_id: 'r2', db: -9 };
  const r = ok(p, b); pruefe(p, r); gleichLeichtVoll(p, b);
  assert.deepEqual(r.projekt.spuren[0].sends, [{ id: 'r2', db: -9 }]);
  assert.deepEqual(r.regler_aenderungen, [{ pfad: 'spur/1/send/2', wert: -9 }]);
  assert.equal(r.betrifft_wiedergabe, false);
  p = r.projekt;
  const zwei = ok(p, { befehl: 'send_setzen', strang_id: 's1', return_id: 'r1', db: -3 }); pruefe(p, zwei);
  assert.deepEqual(zwei.projekt.spuren[0].sends.map((x) => x.id), ['r1', 'r2'], 'ordered by return number');
  const g = ok(p, { befehl: 'send_setzen', strang_id: 'g1', return_id: 'r1', db: 0 }); pruefe(p, g);
  assert.deepEqual(g.projekt.gruppen[0].sends, [{ id: 'r1', db: 0 }]); assert.deepEqual(g.regler_aenderungen, [{ pfad: 'grp/1/send/1', wert: 0 }]);
  const aus = ok(p, { befehl: 'send_setzen', strang_id: 's1', return_id: 'r2', db: -200 }); pruefe(p, aus);
  assert.ok(!('sends' in aus.projekt.spuren[0]), '-200 removes the entry and the empty list');
  assert.deepEqual(aus.regler_aenderungen, [{ pfad: 'spur/1/send/2', wert: -200 }]);
  assert.deepEqual(ok(p, { befehl: 'send_setzen', strang_id: 's1', return_id: 'r1', db: -200 }).regler_aenderungen, [], 'removing what is not there: nothing to send');
  lehntAb(p, { befehl: 'send_setzen', strang_id: 's9', return_id: 'r1', db: 0 }, 'spur_unbekannt');
  lehntAb(p, { befehl: 'send_setzen', strang_id: 's1', return_id: 'r9', db: 0 }, 'return_unbekannt');
  lehntAb(p, { befehl: 'send_setzen', strang_id: 's1', return_id: 'r1', db: 6.5 }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'send_setzen', strang_id: 's1', return_id: 'r1', db: -201 }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'send_setzen', strang_id: 's1', return_id: 'r1' }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'send_setzen', strang_id: 's1', return_id: 'r1', db: 0, extra: 1 }, 'argument_unbekannt');
  assert.ok(ok(p, { befehl: 'send_setzen', strang_id: 's1', return_id: 'r1', db: 6 }), 'negative control: +6 is valid');
});

test('return_loeschen: every send to it goes in the SAME step (one undo), controls back to the defaults, no orphan', () => {
  let p = ok(ok(mitRet(), { befehl: 'return_neu' }).projekt, { befehl: 'return_neu', hall: { decay: 0.9 } }).projekt;
  for (const [s, r] of [['s1', 'r2'], ['s3', 'r2'], ['g1', 'r2'], ['s1', 'r1']]) p = ok(p, { befehl: 'send_setzen', strang_id: s, return_id: r, db: -6 }).projekt;
  p = ok(p, { befehl: 'return_aendern', return_id: 'r2', fader_db: -4, mute: true }).projekt;
  const r = ok(p, { befehl: 'return_loeschen', return_id: 'r2' }); pruefe(p, r);
  assert.deepEqual(r.projekt.returns.map((x) => x.id), ['r1']);
  assert.deepEqual(r.projekt.spuren.map((s) => (s.sends ?? []).map((x) => x.id)), [['r1'], [], []], 'no orphan send');
  assert.ok(!('sends' in r.projekt.gruppen[0]) && !('sends' in r.projekt.spuren[2]));
  assert.deepEqual(r.regler_aenderungen.map((x) => x.pfad).sort(),
    ['grp/1/send/2', 'ret/2/fader', 'ret/2/hall/decay', 'ret/2/mute', 'ret/2/pan', 'ret/2/solo', 'spur/1/send/2', 'spur/3/send/2'].sort());
  assert.deepEqual(r.regler_aenderungen.find((x) => x.pfad === 'ret/2/fader'), { pfad: 'ret/2/fader', wert: 0 });
  assert.deepEqual(r.regler_aenderungen.find((x) => x.pfad === 'ret/2/hall/decay'), { pfad: 'ret/2/hall/decay', wert: 0.5252 });
  assert.deepEqual(r.regler_aenderungen.find((x) => x.pfad === 'spur/1/send/2'), { pfad: 'spur/1/send/2', wert: -200 });
  lehntAb(p, { befehl: 'return_loeschen', return_id: 'r9' }, 'return_unbekannt');
  const leer = ok(r.projekt, { befehl: 'return_loeschen', return_id: 'r1' }).projekt;
  assert.ok(!('returns' in leer) && pruefeProjekt(leer).fehler === undefined, 'the last return takes the key with it');
  assert.equal(leer.naechste_id.return, 3, 'the counter stays');
});

test('undo and redo of the return commands restore state and controls (one step per command, also return_loeschen with two senders)', (t) => {
  const uhr = { t: 1000 };
  const w = new Verlauf(path.join(tmpOrdner(t), 'undo.jsonl'), { jetzt: () => uhr.t, zeitgeber: false });
  const A = { quelle: 'andreas', label: 'x' };
  let q = aendere(w, mitRet(), [{ befehl: 'return_neu' }], A).projekt;
  uhr.t += 5000; q = aendere(w, q, [{ befehl: 'send_setzen', strang_id: 's1', return_id: 'r1', db: -6 }], A).projekt;
  uhr.t += 5000; q = aendere(w, q, [{ befehl: 'send_setzen', strang_id: 's3', return_id: 'r1', db: -3 }], A).projekt;
  uhr.t += 5000; q = aendere(w, q, [{ befehl: 'return_aendern', return_id: 'r1', hall: { decay: 0.9 }, fader_db: -2 }], A).projekt;
  const voll = q;
  uhr.t += 5000; q = aendere(w, q, [{ befehl: 'return_loeschen', return_id: 'r1' }], A).projekt;
  assert.ok(!('returns' in q));
  const u = rueckgaengig(w, q, { quelle: 'andreas' });
  const ohneRev = (x) => ohneAbgeleitetes({ ...x, rev: 0, wiedergabe_rev: 0 });
  assert.equal(ohneRev(u.projekt), ohneRev(voll), 'ONE undo step brings the return AND both sends back');
  assert.deepEqual(u.projekt.spuren.map((s) => (s.sends ?? []).length), [1, 0, 1]);
  assert.ok(u.regler_aenderungen.some((x) => x.pfad === 'spur/1/send/1' && x.wert === -6) && u.regler_aenderungen.some((x) => x.pfad === 'ret/1/hall/decay' && x.wert === 0.9));
  const u2 = rueckgaengig(w, u.projekt, { quelle: 'andreas' });
  assert.deepEqual(u2.projekt.returns[0].hall.decay, 0.5252, 'the Hall change is its own step');
  assert.equal(u2.projekt.returns[0].fader_db, 0);
});

test('AK28 (returns): variante_waehlen and the variant groups never touch the return strips', () => {
  let p = ok(mitRet(), { befehl: 'return_neu' }).projekt;
  p = ok(p, { befehl: 'spur_aendern', spur_id: 's1', gruppe: 'bass' }).projekt;
  p = ok(p, { befehl: 'spur_aendern', spur_id: 's3', gruppe: 'bass' }).projekt;
  p = ok(p, { befehl: 'send_setzen', strang_id: 's1', return_id: 'r1', db: -6 }).projekt;
  const v = ok(p, { befehl: 'variante_waehlen', gruppe: 'bass', spur_id: 's3' });
  assert.deepEqual(v.projekt.spuren.map((s) => s.mute), [true, false, false]);
  assert.equal(v.projekt.returns[0].mute, false, 'negative control: the return stays audible');
  assert.deepEqual(v.projekt.spuren[0].sends, [{ id: 'r1', db: -6 }], 'the sends stay');
  assert.ok(!v.regler_aenderungen.some((x) => x.pfad.startsWith('ret/')));
});

test('deleting a track or group takes its sends out of the controls (set back to -200), a new track leaves the sends alone', () => {
  let p = ok(ok(mitRet(), { befehl: 'return_neu' }).projekt, { befehl: 'send_setzen', strang_id: 's1', return_id: 'r1', db: -6 }).projekt;
  p = ok(p, { befehl: 'send_setzen', strang_id: 'g1', return_id: 'r1', db: -2 }).projekt;
  const t = ok(p, { befehl: 'spur_loeschen', spur_id: 's1' });
  assert.ok(t.regler_aenderungen.some((x) => x.pfad === 'spur/1/send/1' && x.wert === -200));
  const g = ok(p, { befehl: 'gruppenspur_loeschen', gruppe_id: 'g1' });
  assert.ok(g.regler_aenderungen.some((x) => x.pfad === 'grp/1/send/1' && x.wert === -200));
  const n = ok(p, { befehl: 'spur_neu', art: 'audio' });
  assert.ok(!n.regler_aenderungen.some((x) => x.pfad.includes('/send/')), 'negative control: a new track without sends sends nothing');
});

test('ki_gestoppt-style source: the commands carry the source into the history like the other commands (Cypher is not exempt)', (t) => {
  const w = new Verlauf(path.join(tmpOrdner(t), 'undo.jsonl'), { jetzt: () => 1, zeitgeber: false });
  const e = aendere(w, mitRet(), [{ befehl: 'return_neu' }], { quelle: 'cypher', label: 'Hall' });
  assert.equal(e.eintrag.quelle, 'cypher');
});
