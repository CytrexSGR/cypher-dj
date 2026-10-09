// Spiegel der Kern-Meldungen, Hörschein-Register und die Werte aus kern.toml.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { HoerscheinRegister } from '../src/hoerscheine.ts';
import { ladeKernWerte } from '../src/kern_konfig.ts';
import { Spiegel } from '../src/spiegel.ts';
import { H2 } from './hilfen/faelle.ts';

test('Spiegel: Regler und Halter aus /e/regler und /e/halter, Vorgabe sonst; Deck-Position hochgerechnet', () => {
  let beat = 20;
  const s = new Spiegel(() => beat);
  assert.equal(s.wert('deck/2/fader'), -200);                        // Vorgabe §1.5
  s.aufnehmen({ adresse: '/e/regler', felder: { pfad: 'deck/2/fader', wert: -15, halter: 'plan:p1', sample: 0, beat: 20 } });
  s.aufnehmen({ adresse: '/e/halter', felder: { pfad: 'deck/1/eq/tief', halter: 'mensch', sample: 0, beat: 20 } });
  assert.deepEqual([s.wert('deck/2/fader'), s.halter('deck/2/fader'), s.halter('deck/1/eq/tief'), s.halter('deck/3/fader')],
    [-15, 'plan:p1', 'mensch', 'frei']);
  s.aufnehmen({ adresse: '/e/geladen', felder: { deck: 2, material_id: 'f0000000000000b2', basis_bpm: 128, fassung: 1, mit_stems: 0, sample: 0 } });
  assert.equal(s.inhalt('deck/2'), 'f0000000000000b2/128000_r1');   // §4.5
  s.aufnehmen({ adresse: '/zustand/deck', felder: { deck: 2, status: 2, material_id: 'f0000000000000b2', basis_bpm: 128, fassung: 1,
    quell_beat: 12, beats_bis_ende: 200, faktor: 1, vorlauf_ms: 0, hoerweg: 0, stretcher_fuell: -1, versatz_intern_ms: 0,
      keylock_unterlauf: 0, keylock_aufgegeben: 0 } });
  beat = 30;
  assert.equal(s.quellBeatBei(2, 40), 32);                           // 12 + (40 − 20)·1
  assert.equal(s.laeuft(2), true);
  s.aufnehmen({ adresse: '/e/ki', felder: { gestoppt: 1, grund: 'taste', sample: 0 } });
  assert.equal(s.kiGestoppt, true);
});

test('Hörschein-Register: ok registriert, Erneuerung ersetzt, nicht mehr ok zieht zurück, nie ok schickt nichts', () => {
  const r = new HoerscheinRegister();
  const a = r.aufnehmen(H2);
  assert.equal(a?.adresse, '/k/hoerschein');
  assert.deepEqual([a?.felder.hs_id, a?.felder.kanal, a?.felder.inhalt, a?.felder.urteil, a?.felder.gueltig_bis_beat], ['h2', 'deck/2', H2.inhalt, 'ok', 200]);
  assert.equal(r.aufnehmen({ ...H2, erneuerung: 1, gueltig_bis_beat: 404 })?.adresse, '/k/hoerschein');
  assert.equal(r.aufnehmen({ ...H2, urteil: 'nicht_sync' })?.adresse, '/k/hoerschein/weg');
  assert.equal(r.aufnehmen({ ...H2, id: 'h3', urteil: 'zu_laut' }), null);
  assert.deepEqual(r.liste(20).map((h) => [h.id, h.urteil, h.gueltig_bis_takt]), [['h2', 'nicht_sync', 51], ['h3', 'zu_laut', 51]]);
  assert.deepEqual(r.liste(500).map((h) => h.id), []);               // 16 Takte nach Ablauf fallen sie heraus
});

test('kern.toml: Vorgaben ohne Datei, Werte aus der Datei, unbekannter Schlüssel ist ein Fehler', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kernwerte-'));
  assert.throws(() => ladeKernWerte(path.join(d, 'fehlt.toml'), ''), /fehlt/);        // ausdrücklich genannt, aber nicht da
  const v = ladeKernWerte(undefined, 'z');                                             // ~/.config/cypherdj-z/kern.toml gibt es nicht
  assert.deepEqual([v.hoerbar_db, v.tief_offen_db, v.max_stretcher], [-26, -12, 4]);
  fs.writeFileSync(path.join(d, 'kern.toml'), 'version = 1\nmax_stretcher = 1\n');
  assert.equal(ladeKernWerte(path.join(d, 'kern.toml'), '').max_stretcher, 1);
  fs.writeFileSync(path.join(d, 'falsch.toml'), 'version = 1\nmax_strecher = 1\n');
  assert.throws(() => ladeKernWerte(path.join(d, 'falsch.toml'), ''), /max_strecher|additional/);
});
