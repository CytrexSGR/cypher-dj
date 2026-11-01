// Paket 1.13 Slice 7: reine Merge-Rechnung. Plan (D9, D10), Regler-Datei des Renders (D3, D6), Wiedergabe-Ausschnitt (P5), neuer Stand (D5), Veraltet (D12).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreListeAus } from '../projekt/befehle.ts';
import { neuesProjekt, MAX_SPUREN } from '../projekt/modell.ts';
import { mergePlan, mergeRegler, mergeWiedergabe, mergeSicht, baueMergeProjekt, pruefeMergeNochGleich, MergeFehler,
  PAN_MITTE_DB } from '../projekt/zusammenfuehren.ts';

const SHA = 'c'.repeat(64);
const lauf = (p, b, quelle = 'andreas') => fuehreListeAus(p, b, { quelle }).projekt;
// vier Audio-Spuren s1..s4 mit je einem Clip 0..16; s1, s2 in der Gruppe g1 (Fader −6, Pan 0,5 an s1), s3, s4 am Master
function projekt(quelle = 'andreas') {
  const lauf = (p, b) => fuehreListeAus(p, b, { quelle }).projekt;     // Herkunft der Spuren = quelle (befehle.ts:223): Cypher darf nur eigene Spuren mergen
  let p = neuesProjekt('T');
  p = lauf(p, ['Kick', 'Bass', 'Lead', 'Pad'].map((name) => ({ befehl: 'spur_neu', art: 'audio', name })));
  for (const id of ['s1', 's2', 's3', 's4']) {
    p = lauf(p, [{ befehl: 'clip_neu', spur_id: id, art: 'audio', start_beat: 0, laenge_beats: 16, sha256: SHA, name: id }]);
  }
  p = lauf(p, [{ befehl: 'gruppenspur_neu', name: 'G', mitglieder: ['s1', 's2'] }, { befehl: 'spur_aendern', spur_id: 's1', fader_db: -6, pan: 0.5 }]);
  return p;
}
const grund = (f) => { try { f(); } catch (e) { assert.ok(e instanceof MergeFehler, String(e)); return e.grund; } return null; };
const A = { spur_ids: ['s1', 's2'], von_beat: 4, bis_beat: 12 };

test('S7 Plan: Spuren, Bereich, Ziel, Platz der neuen Spur, Name', () => {
  const z = mergePlan(projekt(), A, 'andreas');
  assert.deepEqual([z.spurIds, z.von, z.bis, z.ausgang], [['s1', 's2'], 4, 12, 'g1']);
  assert.equal(z.index, 2, 'direkt unter der tiefsten Quell-Spur (Index 1 + 1)');
  assert.equal(z.name, 'Merge: Kick + Bass');
  assert.equal(mergePlan(projekt(), { ...A, spur_ids: ['s3', 's4'] }, 'andreas').ausgang, null, 'beide am Master');
});

test('S7 Plan: Ablehnungen mit Grund (D6, D9, D10, P7)', () => {
  const p = projekt();
  assert.equal(grund(() => mergePlan(p, { ...A, spur_ids: ['s1'] }, 'andreas')), 'argument_ungueltig', 'eine Spur ist Bounce in Place (1.14), kein Merge');
  assert.equal(grund(() => mergePlan(p, { ...A, spur_ids: ['s1', 's1'] }, 'andreas')), 'argument_ungueltig');
  assert.equal(grund(() => mergePlan(p, { ...A, spur_ids: ['s1', 'nope'] }, 'andreas')), 'spur_unbekannt');
  assert.equal(grund(() => mergePlan(p, { ...A, von_beat: undefined }, 'andreas')), 'argument_ungueltig', 'von_beat ist Pflicht (D1)');
  assert.equal(grund(() => mergePlan(p, { ...A, spur_ids: ['s2', 's3'] }, 'andreas')), 'merge_gruppen', 'Gruppe und Master');
  const solo1 = lauf(p, [{ befehl: 'spur_aendern', spur_id: 's1', solo: true }]);
  assert.equal(grund(() => mergePlan(solo1, A, 'andreas')), 'merge_teil_solo', 'Solo bei s1, nicht bei s2');
  assert.equal(mergePlan(lauf(solo1, [{ befehl: 'spur_aendern', spur_id: 's2', solo: true }]), A, 'andreas').solo, true,
    'bei allen: ja, die neue Spur erbt es');
  assert.equal(mergePlan(lauf(p, [{ befehl: 'spur_aendern', spur_id: 's3', solo: true }]), A, 'andreas').solo, false,
    'Solo nur außerhalb der Auswahl: kein Solo, keine Ablehnung');
  assert.equal(grund(() => mergePlan(lauf(p, [{ befehl: 'gruppenspur_neu', name: 'H', mitglieder: ['s3'] }]), { ...A, spur_ids: ['s2', 's3'] },
    'andreas')), 'merge_gruppen', 'zwei Gruppen');
});

test('S7 Plan: Cypher darf keine Spur von Andreas stumm machen (D10), eigene Spuren ja', () => {
  let p = lauf(neuesProjekt('T'), [{ befehl: 'spur_neu', art: 'audio', name: 'A' }]);                  // von: andreas
  p = lauf(p, [{ befehl: 'spur_neu', art: 'audio', name: 'B' }], 'cypher');                            // von: cypher
  p = lauf(p, [{ befehl: 'spur_neu', art: 'audio', name: 'C' }], 'cypher');
  const a = { spur_ids: ['s2', 's3'], von_beat: 0, bis_beat: 4 };
  assert.equal(mergePlan(p, a, 'cypher').spurIds.length, 2, 'Negativ-Kontrolle: nur eigene Spuren');
  assert.equal(grund(() => mergePlan(p, { ...a, spur_ids: ['s1', 's2'] }, 'cypher')), 'merge_andreas_spur');
  assert.equal(mergePlan(p, { ...a, spur_ids: ['s1', 's2'] }, 'andreas').spurIds.length, 2, 'Andreas selbst darf');
});

test('S7 Plan: Surge track with notes and no freeze: merge_freeze_noetig (D7), not without notes or when frozen; no free track: merge_keine_spur_frei', () => {
  let p = lauf(projekt(), [{ befehl: 'spur_neu', art: 'instrument', name: 'Surge', geraet: { art: 'wirt' } }]);
  p = lauf(p, [{ befehl: 'clip_neu', spur_id: 's5', art: 'midi', start_beat: 0, laenge_beats: 8, noten: [{ beat: 0, laenge: 1, ton: 60, vel: 90 }] }]);
  assert.equal(grund(() => mergePlan(p, { ...A, spur_ids: ['s3', 's5'] }, 'andreas')), 'merge_freeze_noetig');
  const eingefroren = structuredClone(p); eingefroren.spuren[4].freeze = { datei: 'freeze-5-1.f32', frames: 100, kennung: 1, sha256: SHA, von_beat: 0 };
  assert.equal(mergePlan(eingefroren, { ...A, spur_ids: ['s3', 's5'] }, 'andreas').spurIds.length, 2);
  const voll = structuredClone(projekt());
  while (voll.spuren.length < MAX_SPUREN) voll.spuren.push({ ...structuredClone(voll.spuren[3]), id: `x${voll.spuren.length}`,
    nr: voll.spuren.length + 1, clips: [] });
  assert.equal(grund(() => mergePlan(voll, A, 'andreas')), 'merge_keine_spur_frei');
});

test('S7 Plan: quellen_laenger, wenn Inhalt einer Quelle außerhalb des Bereichs liegt (D8); sonst nicht', () => {
  assert.equal(mergePlan(projekt(), A, 'andreas').ausserhalb, true, 'Clips 0..16, Bereich 4..12');
  assert.equal(mergePlan(projekt(), { ...A, von_beat: 0, bis_beat: 16 }, 'andreas').ausserhalb, false);
});

test('S7 Regler (D3, D6): Quellen mit ihrem Fader/Pan/Mute, alle anderen Spuren stumm, Solo überall aus, Gruppen und PM neutral', () => {
  let p = lauf(projekt(), [{ befehl: 'spur_aendern', spur_id: 's2', mute: true }, { befehl: 'spur_aendern', spur_id: 's3', solo: true },
    { befehl: 'gruppenspur_aendern', gruppe_id: 'g1', fader_db: -3, pan: 0.4 }, { befehl: 'master_aendern', fader_db: -2 }]);
  const r = mergeRegler(p, ['s1', 's2']);
  assert.deepEqual([r['spur/1/fader'], r['spur/1/pan'], r['spur/1/mute']], [-6, 0.5, 0]);
  assert.equal(r['spur/2/mute'], 1, 'eine stumme Quelle trägt nichts bei');
  assert.equal(r['spur/3/mute'], 1); assert.ok(Object.entries(r).filter(([k]) => k.endsWith('/solo')).every(([, v]) => v === 0),
    'Solo des Projekts zählt nicht');
  assert.deepEqual([r['grp/1/fader'], r['grp/1/pan'], r['grp/1/mute']], [0, 0, 0], 'die Gruppe wirkt später einmal, nicht im Render');
  assert.equal('pm/fader' in r, false, 'PM-Fader steht auf der Vorgabe');
  assert.equal(Object.keys(r).filter((k) => /^spur\/\d+\/mute$/.test(k)).length, MAX_SPUREN);
});

test('S7 Wiedergabe-Ausschnitt (P5): nur die gewählten Spuren, Gruppen bleiben; eine nicht eingefrorene Surge-Spur fehlt', () => {
  const w = mergeWiedergabe(projekt(), ['s1', 's3']);
  assert.deepEqual(w.spuren.map((s) => s.id), ['s1', 's3']);
  assert.equal(w.gruppen.length, 1);
});

test('S7 neuer Stand (D5, D6): Spur unter der tiefsten Quelle, Ziel, ein Clip mit +3,0103 dB, Quellen stumm; Solo erbt die neue Spur', () => {
  let p = lauf(projekt('cypher'), [{ befehl: 'spur_aendern', spur_id: 's1', solo: true }, { befehl: 'spur_aendern', spur_id: 's2', solo: true }], 'cypher');
  const z = mergePlan(p, A, 'cypher');       // Fund 5: die Spuren stammen von cypher, sonst wirft merge_andreas_spur
  const { projekt: q, spurId } = baueMergeProjekt(p, z, { sha256: 'd'.repeat(64), pfad: '/x/merge/merge-7.wav' }, 'cypher');
  assert.deepEqual(q.spuren.map((s) => s.id), ['s1', 's2', spurId, 's3', 's4']);
  const n = q.spuren[2];
  assert.deepEqual([n.name, n.ausgang, n.fader_db, n.pan, n.mute, n.solo, n.von], ['Merge: Kick + Bass', { art: 'gruppe', id: 'g1' }, 0, 0, false, true,
    'cypher']);
  assert.equal(n.clips.length, 1);
  const c = n.clips[0];
  assert.deepEqual([c.start_beat, c.laenge_beats, c.offset_s, c.quelle.sha256, c.quelle.pfad_hinweis, c.warp ?? null], [4, 8, 0, 'd'.repeat(64),
    '/x/merge/merge-7.wav', null]);
  assert.equal(c.gain_db, PAN_MITTE_DB); assert.ok(Math.abs(PAN_MITTE_DB - 3.0102999566398) < 1e-12);
  assert.deepEqual([q.spuren[0].mute, q.spuren[1].mute, q.spuren[3].mute], [true, true, false], 'Quellen stumm, andere unberührt');
  assert.equal(q.spuren[0].solo, true, 'Solo-Flag der Quelle bleibt');
  assert.equal(p.spuren.length, 4, 'Eingabe unverändert');
});

test('S7 Veraltet (D12): gleich → null; Fader, Pan, Mute, Solo, Ziel, Clip, Tempo, ein Clip-Dekodierzustand: nur die ersten sieben zählen', () => {
  const p = projekt(), z = mergePlan(p, A, 'andreas');
  assert.equal(pruefeMergeNochGleich(p, z), null);
  const aendere = (b) => lauf(p, b);
  for (const [name, q] of [['fader', aendere([{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -3 }])], ['pan', aendere([{ befehl: 'spur_aendern',
    spur_id: 's1', pan: 0 }])],
    ['mute', aendere([{ befehl: 'spur_aendern', spur_id: 's2', mute: true }])], ['solo', aendere([{ befehl: 'spur_aendern', spur_id: 's2',
      solo: true }])], ['ziel', aendere([{ befehl: 'ziel_setzen', strang_id: 's2', ausgang: 'master' }])],
    ['clip', aendere([{ befehl: 'clip_aendern', clip_id: 'c1', start_beat: 1 }])], ['tempo', aendere([{ befehl: 'tempo_setzen', bpm: 100 }])]]) {
    assert.equal(pruefeMergeNochGleich(q, z), 'veraltet', name);   // Teil-Solo während des Renders eingeschlossen
  }
  const d = structuredClone(p); d.spuren[0].clips[0].dekodiert = 'fertig';
  assert.equal(pruefeMergeNochGleich(d, z), null, 'ein Dekodierzustand ist keine Änderung des Klangs');
  const voll = structuredClone(p);
  while (voll.spuren.length < MAX_SPUREN) voll.spuren.push({ ...structuredClone(voll.spuren[3]), id: `x${voll.spuren.length}`,
    nr: voll.spuren.length + 1, clips: [] });
  assert.equal(pruefeMergeNochGleich(voll, z), 'merge_keine_spur_frei');
  assert.equal(mergeSicht(p, ['s1', 's2']), z.sicht);
});
