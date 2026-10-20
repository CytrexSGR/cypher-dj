// Instanz der Server-Tests (ROADMAP Z2: Ports +1000·k). Vorgabe h wie bisher; zwei Sessions, die zugleich testen, wählen
// verschiedene Buchstaben: CYPHERDJ_TEST_INSTANZ=g node --test … . i ist die Prüfinstanz der Browser-Proben, also meiden.
import fs from 'node:fs';
import { nimmSperre, SperreBelegt } from '../../sperre.ts';
const roh = process.env.CYPHERDJ_TEST_INSTANZ ?? 'h';
if (!/^[a-i]$/.test(roh)) throw new Error(`CYPHERDJ_TEST_INSTANZ=${roh}: erlaubt sind a bis i`);
export const TEST_INSTANZ = roh;
export const K = 1000 * (roh.charCodeAt(0) - 96);

// Instanz des Prüfstapel-Tests (stapel.test.mjs). Sie ist nie die der Server-Tests derselben Session, nie h (Vorgabe der Server-Tests, die
// Schwester) und nie g (Abnahme); i ist die Browser-Probe. Es bleiben a bis f als Ziele für acht Quellen, Kollisionen sind darum
// unvermeidlich und stehen hier offen (tests/instanz.test.mjs prüft genau diese Liste):
//   b und g teilen sich a, e und h teilen sich f (h, die Vorgabe, behält f wie bisher). Zwei Sessions mit diesen Buchstaben, die gleichzeitig
//   stapel.test.mjs laufen lassen, stoßen aneinander. Wer das vermeiden will, setzt CYPHERDJ_STAPEL_INSTANZ=<a..f> (überschreibt das Mapping).
const STAPEL = { a: 'b', b: 'a', c: 'd', d: 'c', e: 'f', f: 'e', g: 'a', h: 'f' };
const ueber = process.env.CYPHERDJ_STAPEL_INSTANZ;
if (ueber !== undefined && (!/^[a-i]$/.test(ueber) || ueber === roh)) throw new Error(`CYPHERDJ_STAPEL_INSTANZ=${ueber}: erlaubt sind a bis i, nicht die Test-Instanz ${roh}`);
export const STAPEL_INSTANZ = ueber ?? STAPEL[roh] ?? 'f';

// Sperre der Test-Instanz (Plan 2026-10-15-d1-s1, Task 1): zwei Suiten auf demselben Buchstaben binden dieselben Ports
// (Attrappe UDP 47100+K, Seite TCP 47300+K) und scheitern sonst verschränkt mit „attrappe rc 3“ (EADDRINUSE), ohne Hinweis
// auf die Ursache (Erhebung u4 vom 15.10.: vier Mediathek-Tests rot, allein grün). Wer einen Server startet, ruft
// belegeTestInstanz() einmal je Prozess; ein zweiter lebender Prozess auf demselben Buchstaben scheitert sofort und laut.
// Grenze: die Sperre gilt dem Buchstaben der Server-Tests (TEST_INSTANZ); stapel.test.mjs läuft auf STAPEL_INSTANZ und ist nicht gesperrt.
// Die Sperrdatei liegt fest in /dev/shm (nicht in TMPDIR: zwei Sitzungen mit verschiedenem TMPDIR müssen sich sehen).
let freigabe = null;
export const SPERRDATEI = `/dev/shm/cypherdj-testinstanz-${roh}.sperre`;
export function belegeTestInstanz() {
  if (freigabe !== null) return;
  try { freigabe = nimmSperre(SPERRDATEI); }
  catch (e) {
    if (!(e instanceof SperreBelegt)) throw e;
    let wer = '?'; try { wer = JSON.parse(fs.readFileSync(SPERRDATEI, 'utf8')).pid; } catch { /* schon weg */ }
    throw new Error(`Testinstanz ${roh} belegt (PID ${wer}, ${SPERRDATEI}): läuft eine zweite Suite auf CYPHERDJ_TEST_INSTANZ=${roh}? ` +
      'Anderen Buchstaben wählen (a bis f) oder --test-concurrency=1 setzen.');
  }
  process.once('exit', () => { freigabe?.(); freigabe = null; });
}
