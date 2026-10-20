// D1 S2-Integration: reine Bausteine des Bereichs proj (lage.ts, abbildung.ts, konfig.ts, tempo_rampe.ts). Ohne Server, ohne Kern.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KernLage } from '../bereiche/proj/lage.ts';
import * as AB from '../bereiche/proj/abbildung.ts';
import { arrOrdner } from '../bereiche/proj/konfig.ts';
import { tempoRampe, abBeatVon } from '../tempo_rampe.ts';
import { specProjekt, tmpOrdner } from './hilfen/projekt.mjs';

test('KernLage: Uhr, Decks, Boxen, Regler, /zustand/arr; djLaeuft nach Spec 2.2 (Deck ≥ 2, Box 2..4, erz/1..3 offen), sonst false', () => {
  const l = new KernLage();
  assert.equal(l.djLaeuft(), false, 'nichts bekannt: quant 0');
  l.nimm('/uhr', { sample: 0n, mono_ns: 0n, beat: 12.5, bpm: 124, bpm_pro_s: 0 });
  assert.deepEqual(l.uhr, { beat: 12.5, bpm: 124, sample: 0 });   // sample seit Fix4 J1 (Spec 6.35: Stopp-Beat aus /e/ki sample)
  l.nimm('/zustand/deck', { deck: 1, status: 1 }); assert.equal(l.djLaeuft(), false, 'geladen ist nicht laufend');
  l.nimm('/zustand/deck', { deck: 1, status: 2 }); assert.equal(l.djLaeuft(), true); assert.equal(l.deckLaeuft(), true);
  l.nimm('/zustand/deck', { deck: 1, status: 0 }); assert.equal(l.djLaeuft(), false);
  for (const [status, laeuft] of [[1, false], [2, true], [3, true], [4, true], [0, false]]) {
    l.nimm('/e/loop', { box: 2, status, name: 'x', beats: 4, fx_art: 0, fx_beats: 1, fx_wet: 0 });
    assert.equal(l.djLaeuft(), laeuft, `Box Status ${status}`);
  }
  l.nimm('/e/regler', { pfad: 'erz/2/fader', wert: -12, halter: 'mensch', sample: 0n, beat: 0 });
  assert.equal(l.djLaeuft(), true, 'Strom auf offenem Kanal'); assert.equal(l.deckLaeuft(), false);
  l.nimm('/e/regler', { pfad: 'erz/2/fader', wert: -200, halter: 'frei', sample: 0n, beat: 0 });
  l.nimm('/e/regler', { pfad: 'erz/4/fader', wert: 0, halter: 'frei', sample: 0n, beat: 0 });
  assert.equal(l.djLaeuft(), false, 'erz/4 ist die Produktion selbst, kein Studio-Strom');
  l.nimm('/zustand/arr', { nr: 7, status: 2, loop_an: 1, projekt_beat: 3.5, ursprung_sample: 96000n, start_beat: 0, metronom_an: 0 });
  assert.deepEqual(l.arr, { nr: 7, status: 2, loop_an: 1, projekt_beat: 3.5, ursprung_sample: 96000, start_beat: 0, metronom_an: 0 });
});

test('KernLage: Neustart nur bei /e/neustart mit neuer Generation (wie server.ts vomKern)', () => {
  const l = new KernLage();
  assert.deepEqual(l.nimm('/k/willkommen', { generation: 3 }), { neustart: false });
  assert.deepEqual(l.nimm('/e/neustart', { generation: 3, sample: 0n }), { neustart: false }, 'gleiche Generation: Abonnent neu, Kern lief weiter');
  assert.deepEqual(l.nimm('/e/neustart', { generation: 4, sample: 0n }), { neustart: true });
  assert.deepEqual(l.nimm('/k/willkommen', { generation: 5 }), { neustart: false }, 'gebremster Start: nichts wiederherstellen');
});

test('abbildung: Gründe → HTTP (400, 404, 409, 413, 503)', () => {
  assert.equal(AB.grundCode('argument_ungueltig'), 400); assert.equal(AB.grundCode('json'), 400);
  assert.equal(AB.grundCode('clip_unbekannt'), 404); assert.equal(AB.grundCode('sha_unbekannt'), 404);
  assert.equal(AB.grundCode('rev_veraltet'), 409); assert.equal(AB.grundCode('spur_bereich'), 409); assert.equal(AB.grundCode('nichts_zu_tun'), 409);
  assert.equal(AB.grundCode('koerper_zu_gross'), 413); assert.equal(AB.grundCode('katalog_fehlt'), 503);
});

test('abbildung: alle 32 Spur-Regler, belegte Slots mit Werten (mute/solo 0/1), freie mit der Vorgabe; erz/4 neutral ohne nur-Hand-Pfade', () => {
  const p = specProjekt(); p.spuren[1].fader_db = -6; p.spuren[1].pan = 0.25; p.spuren[1].mute = true;
  const r = AB.alleSpurRegler(p);
  assert.equal(r.length, 32);
  const w = Object.fromEntries(r.map((x) => [x.pfad, x.wert]));
  assert.deepEqual([w['spur/2/fader'], w['spur/2/pan'], w['spur/2/mute'], w['spur/2/solo']], [-6, 0.25, 1, 0]);
  assert.deepEqual([w['spur/8/fader'], w['spur/8/pan'], w['spur/8/mute'], w['spur/8/solo']], [0, 0, 0, 0]);
  assert.ok(!AB.ERZ4_NEUTRAL.some((x) => x.pfad === 'erz/4/ziel' || x.pfad === 'erz/4/xseite'), 'nur Hand: bei Quelle cypher lehnt der Kern nur_hand ab');
  assert.deepEqual(AB.ERZ4_NUR_HAND.map((x) => x.pfad), ['erz/4/ziel', 'erz/4/xseite']);
  // P6: bei Quelle andreas gehören ziel=0 und xseite=1 in die Sollliste (der Kern lehnt nur_hand nur bei cypher ab, einsortieren.cpp:38)
  assert.deepEqual(AB.erz4Soll('andreas').slice(-2), [{ pfad: 'erz/4/ziel', wert: 0 }, { pfad: 'erz/4/xseite', wert: 1 }]);
  assert.equal(AB.erz4Soll('andreas').length, 16); assert.equal(AB.erz4Soll('cypher').length, 14);
  assert.equal(AB.ERZ4_NEUTRAL.find((x) => x.pfad === 'erz/4/send/2').wert, -200);
});

test('abbildung: Rückweg /e/regler → spur_aendern (Nummer → ID, 0/1 → bool, Klemmen), gleicher Wert und fremde Pfade → null', () => {
  const p = specProjekt();
  assert.deepEqual(AB.reglerZuBefehl(p, 'spur/2/fader', -7.5), { befehl: { befehl: 'spur_aendern', spur_id: 's2', fader_db: -7.5 }, label: 'Mixer: Bass fader' });
  assert.deepEqual(AB.reglerZuBefehl(p, 'spur/1/mute', 1).befehl, { befehl: 'spur_aendern', spur_id: 's1', mute: true });
  assert.deepEqual(AB.reglerZuBefehl(p, 'spur/3/pan', -1.5).befehl, { befehl: 'spur_aendern', spur_id: 's3', pan: -1 });
  assert.deepEqual(AB.reglerZuBefehl(p, 'spur/3/fader', 9).befehl.fader_db, 6, 'geklemmt auf +6 (Spec 6.16)');
  assert.equal(AB.reglerZuBefehl(p, 'spur/1/fader', 0), null, 'Wert schon im Projekt');
  assert.equal(AB.reglerZuBefehl(p, 'spur/5/fader', -3), null, 'keine Spur auf Slot 5');
  assert.equal(AB.reglerZuBefehl(p, 'erz/4/fader', -3), null);
  assert.equal(AB.reglerZuBefehl(p, 'spur/1/fader', NaN), null);
});

test('abbildung: Cyphers Spuren aus dem Feld von (Spec 6.22, nicht aus dem Verlauf), Liste der KI-Maske', () => {
  const p = specProjekt();
  assert.deepEqual(AB.cypherSpuren(p), [], 'ohne von gilt andreas');
  p.spuren[2].von = 'cypher'; assert.deepEqual(AB.cypherSpuren(p), [3]);
  p.spuren[0].von = 'cypher'; p.spuren[1].von = 'andreas'; assert.deepEqual(AB.cypherSpuren(p), [1, 3], 'nach Nummer sortiert');
  assert.equal(AB.kiSpurListe([3, 1]), 'spur/13');                                 // K1-Form (ki.cpp:94-112, 755edead): spur/<ziffern>
  assert.equal(AB.kiSpurListe([]), 'spur/0');                                      // spur/0 = keine Spur
});

test('konfig: arr_ordner aus kern.toml (mit Instanz umgeschrieben), leer oder fehlend: Vorgabe ~/.cache/cypherdj[-<i>]/arr', (t) => {
  const d = tmpOrdner(t), toml = path.join(d, 'kern.toml');
  assert.equal(arrOrdner('h', path.join(d, 'fehlt.toml')), path.join(os.homedir(), '.cache', 'cypherdj-h', 'arr'));
  assert.equal(arrOrdner('', path.join(d, 'fehlt.toml')), path.join(os.homedir(), '.cache', 'cypherdj', 'arr'));
  fs.writeFileSync(toml, 'udp_port = 47100\narr_ordner = "/mnt/x/cypherdj/arr/"   # eigener Ort\n');
  assert.equal(arrOrdner('', toml), '/mnt/x/cypherdj/arr');
  assert.equal(arrOrdner('h', toml), '/mnt/x/cypherdj-h/arr');
  fs.writeFileSync(toml, 'arr_ordner = ""\n');
  assert.equal(arrOrdner('h', toml), path.join(os.homedir(), '.cache', 'cypherdj-h', 'arr'));
  fs.writeFileSync(toml, '# arr_ordner = "/nein"\n');
  assert.equal(arrOrdner('', toml), path.join(os.homedir(), '.cache', 'cypherdj', 'arr'), 'auskommentiert zählt nicht');
});

test('tempo_rampe: nächster Takt, 4 Beats, auf 0,01 gerundet, 60..200; außerhalb null (wie POST /tempo)', () => {
  assert.deepEqual(tempoRampe(5.2, 120, 124.567), { ab_beat: 8, ziel_bpm: 124.57, dauer_beats: 4 });
  assert.equal(tempoRampe(5.2, 120, 59.99), null); assert.equal(tempoRampe(5.2, 120, 200.01), null); assert.equal(tempoRampe(5.2, 120, NaN), null);
  assert.equal(tempoRampe(5.2, 120, '120'), null);
  assert.ok(abBeatVon(5.2, 120, 'jetzt') > 5.2 && abBeatVon(5.2, 120, 'jetzt') < 5.4, 'jetzt = Beat plus Vorlauf');
});
