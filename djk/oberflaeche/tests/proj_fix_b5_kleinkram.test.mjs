// D1 S2-Integration, Fix-Runde B5 (Quality-Review, Kleinkram): je Begriff eine Stelle. Der Wächter liest die Quellen und hält fest, dass die
// Dubletten nicht zurückkommen: das Fader-Literal in abbildung.ts (FADER_MIN/FADER_MAX aus modell.ts), schlafMs neben schlaf in sitzung.ts, ein
// zweiter Typ Quelle in kern_weg.ts, der Vorlauf in server.ts abVon (vorlaufBeats aus tempo_rampe.ts), die alten Kopfkommentare.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { reglerZuBefehl } from '../bereiche/proj/abbildung.ts';
import { FADER_MAX, FADER_MIN } from '../projekt/modell.ts';
import { vorlaufBeats } from '../tempo_rampe.ts';
import { specProjekt } from './hilfen/projekt.mjs';

const quelle = (p) => fs.readFileSync(path.join(import.meta.dirname, '..', p), 'utf8');

test('B5 abbildung.ts: der Rückweg klemmt mit FADER_MIN/FADER_MAX, kein Literal; Kopfkommentar nennt das Spurfeld von', () => {
  const s = quelle('bereiche/proj/abbildung.ts');
  assert.ok(!/Math\.min\(6,|Math\.max\(-200,/.test(s), 'Literal 6/-200 in abbildung.ts');
  assert.ok(!/Urheber der Spuren aus dem Verlauf/.test(s), 'Kopfkommentar: die Herkunft kommt aus dem Spurfeld von (Spec 6.22)');
  const p = specProjekt();
  assert.equal(reglerZuBefehl(p, 'spur/1/fader', 99).befehl.fader_db, FADER_MAX);
  assert.equal(reglerZuBefehl(p, 'spur/1/fader', -999).befehl.fader_db, FADER_MIN);
});

test('B5 sitzung.ts: ein schlaf, Kopfkommentar mit rev-Nachprüfung und kein_kern; kern_weg.ts: Quelle nur aus verlauf.ts', () => {
  const s = quelle('bereiche/proj/sitzung.ts');
  assert.ok(!/schlafMs/.test(s), 'schlafMs neben schlaf');
  assert.ok(/rev noch\s*\n?\/\/ einmal prüfen/.test(s) && /kein_kern/.test(s.split('\nimport')[0]), 'Kopfkommentar: Reihenfolge einer Änderung nach Spec 6.30');
  assert.ok(!/export type Quelle =/.test(quelle('bereiche/proj/kern_weg.ts')), 'zweiter Typ Quelle in kern_weg.ts');
});

test('B5 server.ts abVon: Vorlauf aus tempo_rampe.ts (vorlaufBeats), keine eigene Formel', () => {
  const s = quelle('server.ts');
  assert.ok(!/10\.7 \/ 1000/.test(s), 'eigene Vorlauf-Formel in server.ts');
  assert.match(s, /abBeat\(beat, vorlaufBeats\(bpm\), AB\[ab\]\)/);
  assert.equal(vorlaufBeats(128), Math.max(10.7 / 1000 * 128 / 60, 0.1));
});
