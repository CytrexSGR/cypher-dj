// D1 S2-Integration, Pflichtpunkte P5 (Fassade ProjZugang für S3, Plan S3 Z.185-202) und P4 (Spec 6.23: sperreLaden, 409 beschaeftigt
// während eines Freeze). Die Fassade wird über projBereich(...).zugang geprüft, nicht über die Sitzung: das ist, was S3 sieht.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { projBereich } from '../bereiche/proj/bereich.ts';
import { aendere } from '../projekt/verlauf.ts';
import { wiedergabeDatei } from '../projekt/wiedergabe.ts';
import { pruefKontext, wav, warteBis } from './hilfen/proj_kontext.mjs';
import { baueKatalog, ksha } from './hilfen/katalog.mjs';
import { tmpOrdner } from './hilfen/projekt.mjs';

const fehlerVon = async (p) => { try { await p; } catch (e) { return e; } return null; };

function bereich(t, opt = {}, k = pruefKontext()) {
  const d = tmpOrdner(t, 'djk-projzug-');
  const b = projBereich(k, { wurzel: path.join(d, 'projekte'), arbeitsordner: path.join(d, 'arr'), arrFristMs: 30, ...opt });
  t.after(() => b.sitzung.schliesse());
  return { b, s: b.sitzung, z: b.zugang, k, d, wurzel: path.join(d, 'projekte'), arr: path.join(d, 'arr') };
}
const mit = async (t, opt, k) => { const x = bereich(t, opt, k); await x.s.neu('F', 'andreas'); x.k.leere(); return x; };

// --- P5: Fassade ------------------------------------------------------------------------------------------------------------------------

test('P5 Fassade: projBereich liefert zugang mit allen dreizehn Funktionen (B3: naechsteNummer; S3: ausgabeLauf, Spec 6.34; 1.8: transport, aufnahmeLauf; Slice 6: stemsStand, beiSchliessen), die Routen bleiben neun plus GET /proj/warp (Paket 1.13); offen() ist null ohne Projekt', (t) => {
  const { b, z } = bereich(t);
  for (const f of ['offen', 'arbeitsordner', 'haken', 'uebernimm', 'schreibeWiedergabe', 'naechsteNummer', 'tempoAnMaster', 'sperreLaden', 'ausgabeLauf', 'transport', 'aufnahmeLauf', 'stemsStand', 'beiSchliessen']) assert.equal(typeof z[f], 'function', f);
  assert.equal(Object.keys(z).length, 13);
  assert.equal(b.routen().length, 10); assert.equal(b.name, 'proj');
  assert.equal(z.offen(), null);
  assert.equal(z.arbeitsordner(), b.sitzung.arbeitsordner);
});

test('P5 offen(): {slug, ordner, projekt, verlauf} mit dem lebenden Stand bei jedem Aufruf; ordner ist der absolute Projektordner', async (t) => {
  const { s, z, wurzel } = await mit(t);
  const o = z.offen();
  assert.deepEqual(Object.keys(o).sort(), ['ordner', 'projekt', 'slug', 'verlauf']);
  assert.equal(o.slug, 'f'); assert.equal(o.ordner, path.join(wurzel, 'f')); assert.ok(path.isAbsolute(o.ordner));
  assert.ok(fs.existsSync(path.join(o.ordner, 'project.json')));
  assert.equal(typeof o.verlauf.liste, 'function'); assert.equal(typeof o.verlauf.pruefeMeta, 'function');
  await s.aendern({ rev: 0, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'andreas');
  assert.equal(z.offen().projekt.rev, 1, 'bei jedem Aufruf der aktuelle Stand'); assert.equal(z.offen().projekt, s.aktuell().j.projekt);
});

test('P5 haken(): speichere schreibt project.json, dekodiert fragt den Cache', async (t) => {
  const { z } = await mit(t);
  const h = z.haken(), o = z.offen();
  h.speichere({ ...o.projekt, tempo_bpm: 99 });
  assert.equal(JSON.parse(fs.readFileSync(path.join(o.ordner, 'project.json'), 'utf8')).tempo_bpm, 99);
  assert.equal(h.dekodiert('e'.repeat(64)), 'nein');
});

test('P5 schreibeWiedergabe(p): nächste Nummer des EINEN Zählers, Datei geschrieben, kein /k/arr/laden; die folgende Änderung zählt weiter', async (t) => {
  const { s, z, k, arr } = await mit(t);
  const nr0 = z.offen().projekt.wiedergabe_rev;
  const r = z.schreibeWiedergabe(z.offen().projekt);
  assert.deepEqual(Object.keys(r).sort(), ['datei', 'nr']);
  assert.equal(r.nr, nr0 + 1); assert.equal(r.datei, wiedergabeDatei(arr, r.nr)); assert.ok(fs.existsSync(r.datei));
  assert.equal(k.an('/k/arr/laden').length, 0, 'ohne /k/arr/laden');
  assert.equal(z.offen().projekt.wiedergabe_rev, nr0, 'wiedergabe_rev führt nur, was geladen wurde');
  await s.aendern({ rev: 0, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'andreas');
  assert.equal(k.an('/k/arr/laden')[0].felder.nr, nr0 + 2, 'ein Zähler für beide Wege');
});

test('P5 uebernimm(w, meta): Projektstand synchron gesetzt, danach Wiedergabe geladen, Regler gesendet, SSE proj; ohne Eintrag nichts', async (t) => {
  const { z, k } = await mit(t);
  const meta = { quelle: 'andreas', label: 'Spur' };
  const o = z.offen();
  const w = aendere(o.verlauf, o.projekt, [{ befehl: 'spur_neu', art: 'audio' }], meta, z.haken());
  const lauf = z.uebernimm(w, meta);
  assert.equal(z.offen().projekt, w.projekt, 'synchron, vor dem ersten await');
  assert.equal(k.gesendet.length, 0, 'noch nichts gesendet');
  await lauf;
  assert.equal(k.an('/k/arr/laden').length, 1); assert.equal(z.offen().projekt.wiedergabe_rev, k.an('/k/arr/laden')[0].felder.nr);
  assert.deepEqual(k.teile().map((x) => x.felder.pfad).sort(), ['spur/1/fader', 'spur/1/mute', 'spur/1/pan', 'spur/1/solo']);
  assert.deepEqual(k.verteilt.at(-1), { a: 'proj', f: { slug: 'f', rev: 1, label: 'Spur', quelle: 'andreas' } });
  // Mixer allein: Regler, keine neue Wiedergabe
  k.leere();
  const o2 = z.offen(), m2 = { quelle: 'cypher', label: 'Leiser' };
  const w2 = aendere(o2.verlauf, o2.projekt, [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -6 }], m2, z.haken());
  await z.uebernimm(w2, m2);
  assert.equal(k.an('/k/arr/laden').length, 0); assert.deepEqual(k.teile().map((x) => [x.felder.pfad, x.felder.nach]), [['spur/1/fader', -6]]);
  // kein Eintrag (nichts geändert): nichts geschieht
  k.leere();
  const o3 = z.offen();
  await z.uebernimm(aendere(o3.verlauf, o3.projekt, [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -6 }], m2, z.haken()), m2);
  assert.equal(k.gesendet.length, 0); assert.equal(k.verteilt.length, 0);
});

test('P5 tempoAnMaster(): wirft deck_laeuft nur, wenn das Master-Tempo abweicht UND ein Deck läuft; sonst Rampe, zurück erst nach dem Rampen-Ende', async (t) => {
  const { s, z, k } = await mit(t);                                   // Projekttempo 120
  assert.equal((await fehlerVon(bereich(t).z.tempoAnMaster())).fehler, 'kein_projekt');
  s.ereignis('/uhr', { beat: 5.2, bpm: 120 });
  await z.tempoAnMaster();
  assert.equal(k.an('/k/tempo/rampe').length, 0, 'Master-Tempo gleich: nichts zu tun');
  s.ereignis('/zustand/deck', { deck: 1, status: 2 });
  await z.tempoAnMaster();
  assert.equal(k.an('/k/tempo/rampe').length, 0, 'Deck läuft, Tempo gleich: kein Fehler (Negativ-Kontrolle)');
  s.ereignis('/uhr', { beat: 5.2, bpm: 128 });
  const e = await fehlerVon(z.tempoAnMaster());
  assert.deepEqual([e.grund, e.fehler, e.code], ['deck_laeuft', 'deck_laeuft', 409]);
  assert.equal(k.an('/k/tempo/rampe').length, 0);
  s.ereignis('/zustand/deck', { deck: 1, status: 0 });
  let fertig = false;
  const lauf = z.tempoAnMaster().then(() => { fertig = true; });
  assert.ok(await warteBis(() => k.an('/k/tempo/rampe').length === 1));
  assert.deepEqual(k.an('/k/tempo/rampe')[0].felder, { quelle: 'andreas', ab_beat: 8, ziel_bpm: 120, dauer_beats: 4 });
  s.ereignis('/uhr', { beat: 11.9, bpm: 121 });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(fertig, false, 'vor dem Rampen-Ende nicht zurück');
  s.ereignis('/uhr', { beat: 12.01, bpm: 120 });
  await lauf; assert.equal(fertig, true);
});

// --- P4: sperreLaden (Spec 6.23) --------------------------------------------------------------------------------------------------------

const noten = (rev, beat = 0) => ({ rev, label: 'Note', befehle: [{ befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: beat, laenge_beats: 4, noten: [{ beat: 0, laenge: 1, ton: 36, vel: 100 }] }] });
async function mitInstrument(t, opt, k) {
  const x = await mit(t, opt, k);
  await x.s.aendern({ rev: 0, label: 'Bass', befehle: [{ befehl: 'spur_neu', art: 'instrument' }, { befehl: 'spur_neu', art: 'audio' }] }, 'andreas');
  await x.s.aendern({ rev: 1, label: 'Clip', befehle: noten(1).befehle }, 'andreas');
  x.k.leere();
  return x;
}

test('P4 sperreLaden: wiedergabewirksame Änderungen (Noten, Clips, Spuren, Gerät, Tempo, Loop) → 409 beschaeftigt ohne Wirkung; Mixer bleibt frei; danach geht alles durch', async (t) => {
  const { s, z, k, wurzel } = await mitInstrument(t);
  const datei = path.join(wurzel, 'f', 'project.json'), vorher = fs.readFileSync(datei, 'utf8');
  const frei = z.sperreLaden();
  assert.equal(typeof frei, 'function');
  const rev = () => s.aktuell().j.projekt.rev;
  const wirksam = [
    ['Noten', [{ befehl: 'noten_neu', clip_id: 'c1', noten: [{ beat: 1, laenge: 1, ton: 40, vel: 90 }] }]],
    ['Clip', noten(rev(), 8).befehle],
    ['Spur anlegen', [{ befehl: 'spur_neu', art: 'audio' }]],
    ['Spur löschen', [{ befehl: 'spur_loeschen', spur_id: 's2' }]],
    ['Gerät', [{ befehl: 'spur_aendern', spur_id: 's1', geraet: { art: 'wirt', name: 'surge', slot: 1 } }]],
    ['Tempo', [{ befehl: 'tempo_setzen', bpm: 130 }]],
    ['Loop', [{ befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 8 }]],
  ];
  for (const [name, befehle] of wirksam) {
    const e = await fehlerVon(s.aendern({ rev: rev(), label: name, befehle }, 'andreas'));
    assert.deepEqual([e?.code, e?.fehler], [409, 'beschaeftigt'], name);
  }
  assert.equal(k.gesendet.length, 0, 'nichts ging an den Kern'); assert.equal(fs.readFileSync(datei, 'utf8'), vorher, 'nichts gespeichert'); assert.equal(rev(), 2);
  for (const [name, felder] of [['fader', { fader_db: -3 }], ['pan', { pan: 0.5 }], ['mute', { mute: true }], ['solo', { solo: true }], ['name', { name: 'Neu' }], ['farbe', { farbe: '#112233' }]]) {
    const r = await s.aendern({ rev: rev(), label: name, befehle: [{ befehl: 'spur_aendern', spur_id: 's1', ...felder }] }, 'andreas');
    assert.equal(r.code, 200, name);
  }
  assert.equal(k.an('/k/arr/laden').length, 0, 'Mixer lädt nichts');
  frei();
  assert.equal((await s.aendern({ rev: rev(), label: 'Noten', befehle: wirksam[0][1] }, 'andreas')).code, 200, 'nach dem Freigeben geht die Notenänderung durch');
  assert.equal(k.an('/k/arr/laden').length, 1);
});

test('P4 sperreLaden gilt auch für Undo und Redo (wiedergabewirksam gesperrt, Mixer frei), Freigabe ist einmalig, zwei Sperren halten bis zur letzten Freigabe', async (t) => {
  const { s, z, k } = await mitInstrument(t);
  await s.aendern({ rev: 2, label: 'Leiser', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -3 }] }, 'andreas');
  const frei1 = z.sperreLaden(), frei2 = z.sperreLaden();
  const rev = () => s.aktuell().j.projekt.rev;
  const u = await s.umkehr('undo', { rev: rev() }, 'andreas');
  assert.equal(u.code, 200, 'Undo einer Mixer-Änderung bleibt frei');
  const e = await fehlerVon(s.umkehr('undo', { rev: rev() }, 'andreas'));
  assert.deepEqual([e?.code, e?.fehler], [409, 'beschaeftigt'], 'Undo des Clips ändert die Wiedergabe');
  frei1(); frei1();                                                      // zweimal dieselbe Freigabe zählt einmal
  assert.equal((await fehlerVon(s.umkehr('undo', { rev: rev() }, 'andreas')))?.fehler, 'beschaeftigt', 'die zweite Sperre hält');
  frei2();
  const ok = await s.umkehr('undo', { rev: rev() }, 'andreas');
  assert.equal(ok.code, 200); assert.equal(k.an('/k/arr/laden').length, 1);
  z.sperreLaden();
  assert.equal((await fehlerVon(s.umkehr('redo', { rev: rev() }, 'andreas')))?.fehler, 'beschaeftigt', 'Redo des Clips ebenso');
});

test('P4 Dekodieren während der Sperre: das Ereignis geht an die Seite, die neue Wiedergabe wartet bis zur Freigabe (sonst bräche sie den Freeze ab)', async (t) => {
  const d = tmpOrdner(t, 'djk-projsperre-');
  const kick = wav(path.join(d, 'daten'), 'kick.wav');
  const katalog = baueKatalog(path.join(d, 'kat'), [{ n: 1, typ: 'oneshot', pfad: kick, dauer_s: 0.25 }]);
  const { s, z, k } = bereich(t, { katalog, vorsatz: ['sh', '-c', 'sleep 0.5; exec "$0" "$@"'] });   // Dekodieren dauert mindestens eine halbe Sekunde
  await s.neu('D', 'andreas');
  await s.aendern({ rev: 0, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, 'andreas');
  const c = await s.aendern({ rev: 1, label: 'Clip', befehle: [{ befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 1, sha256: ksha(1) }] }, 'andreas');
  const clipId = c.j.projekt.spuren[0].clips[0].id;
  const frei = z.sperreLaden();
  k.leere();
  assert.ok(await warteBis(() => k.verteilt.some((x) => x.f.clip_id === clipId && x.f.dekodiert === 'fertig'), 15000), 'Ereignis kommt trotz Sperre');
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(k.an('/k/arr/laden').length, 0, 'keine Wiedergabe während der Sperre');
  frei();
  assert.ok(await warteBis(() => k.an('/k/arr/laden').length === 1), 'nach der Freigabe wird nachgeladen');
  assert.equal(s.aktuell().j.projekt.wiedergabe_rev, k.an('/k/arr/laden')[0].felder.nr);
});
