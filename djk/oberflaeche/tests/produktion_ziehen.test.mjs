// PRODUCTION V1: Ziehen aus LIBRARY (reine Funktionen)
import test from 'node:test';
import assert from 'node:assert/strict';
import { ZIEH_TYP, nutzlast, ablageBefehl, ABLAGE_TEXT } from '../oeffentlich/produktion/ziehen.js';

const SHA = 'a'.repeat(64);
const kick = { typ: 'oneshot', sha: SHA, name: 'Kick 1', pfad_da: true, nur_live: false, dauer_s: 0.5 };
const projekt = { tempo_bpm: 120, spuren: [
  { id: 's1', nr: 1, art: 'audio', clips: [] },
  { id: 's2', nr: 2, art: 'instrument', geraet: { art: 'intern', name: 'rb338' }, clips: [] },
] };

test('V1 Ziehen: Nutzlast nur für ziehbare LIBRARY-Zeilen', () => {
  assert.equal(ZIEH_TYP, 'application/x-djk-clip');
  assert.deepEqual(nutzlast(kick), { sha: SHA, dauer_s: 0.5, name: 'Kick 1' });
  assert.deepEqual(nutzlast({ ...kick, typ: 'loop' }), { sha: SHA, dauer_s: 0.5, name: 'Kick 1' });
  assert.deepEqual(nutzlast({ ...kick, typ: 'track', titel: 'T' }), { sha: SHA, dauer_s: 0.5, name: 'T' }, 'Track: der Titel, nicht das Feld name');
  assert.equal(nutzlast({ ...kick, typ: 'strudel' }), null, 'Muster sind keine Audio-Quelle');
  assert.equal(nutzlast({ ...kick, pfad_da: false }), null, 'Datei fehlt');
  assert.equal(nutzlast({ ...kick, nur_live: true }), null, 'Ableton-geschützt');
  assert.equal(nutzlast({ ...kick, sha: SHA.slice(0, 16) }), null, 'material_id (16 Hex) ist kein sha');
  assert.equal(nutzlast({ ...kick, dauer_s: 0 }), null);
  assert.equal(nutzlast(null), null);
});

test('V1 Ziehen: Ablage auf eine Audio-Spur gerastet, Länge in Beats aus Dauer und Projekttempo', () => {
  const r = ablageBefehl(projekt, nutzlast(kick), 0, 4.3, 1);
  assert.deepEqual(r, { befehl: { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 4, laenge_beats: 1, sha256: SHA, name: 'Kick 1' } });
  assert.equal(ablageBefehl(projekt, nutzlast(kick), 0, 6.1, 4).befehl.start_beat, 8);
  assert.equal(ablageBefehl(projekt, nutzlast(kick), 0, -3, 1).befehl.start_beat, 0, 'nie vor Beat 0');
  // Negativ-Kontrolle: Raster aus lässt den Ablage-Beat stehen
  assert.equal(ablageBefehl(projekt, nutzlast(kick), 0, 4.3, 0).befehl.start_beat, 4.3);
});

test('V1 Ziehen: Instrument-Spur und Leere lehnen ab, mit englischem Text', () => {
  assert.deepEqual(ablageBefehl(projekt, nutzlast(kick), 1, 0, 1), { fehler: 'keine_audiospur' });
  assert.deepEqual(ablageBefehl(projekt, nutzlast(kick), 5, 0, 1), { fehler: 'keine_spur' });
  assert.deepEqual(ablageBefehl(null, nutzlast(kick), 0, 0, 1), { fehler: 'keine_spur' });
  assert.match(ABLAGE_TEXT.keine_audiospur, /^[ -~]+$/);
});

// Fix 5: ohne name nennt S2 jeden abgelegten Clip „Audio“ (befehle.ts clip_neu). Die Seite schickt den Titel der Library-Zeile mit.
test('V1 Ziehen: der Titel der Library-Zeile geht als name in clip_neu', () => {
  assert.equal(nutzlast(kick).name, 'Kick 1');
  assert.equal(ablageBefehl(projekt, nutzlast(kick), 0, 0, 1).befehl.name, 'Kick 1');
  // Track: Titel, mit Mix in Klammern wie in der Spalte der Liste (stoebern.js SPALTEN.track)
  assert.equal(nutzlast({ ...kick, typ: 'track', titel: 'Song', mix: 'Extended Mix', name: 'datei' }).name, 'Song (Extended Mix)');
  // S2 lehnt name über 80 Zeichen ab (argument_ungueltig): die Seite kürzt, statt die Ablage scheitern zu lassen
  assert.equal(nutzlast({ ...kick, name: 'x'.repeat(200) }).name.length, 80);
  // Negativ-Kontrolle: ohne Titel gibt es kein name-Feld (S2 nimmt dann den Dateinamen oder „Audio“), nie einen leeren Namen
  for (const leer of [{ name: '' }, { name: '   ' }, { name: undefined }, { name: null }]) {
    const n = nutzlast({ ...kick, ...leer });
    assert.deepEqual(n, { sha: SHA, dauer_s: 0.5 }, JSON.stringify(leer));
    assert.equal('name' in ablageBefehl(projekt, n, 0, 0, 1).befehl, false);
  }
  assert.equal('name' in nutzlast({ ...kick, typ: 'track', titel: null }), false);
});
