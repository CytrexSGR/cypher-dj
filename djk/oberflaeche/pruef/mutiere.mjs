// Mutationsprobe (L5): ersetzt in <datei> genau eine Textstelle, fährt den Testbefehl und stellt die Datei danach wieder her.
// Garantiert wiederhergestellt wird: nach dem Lauf (grün, rot oder Absturz des Testbefehls) und wenn mutiere selbst per
// SIGINT, SIGTERM oder SIGHUP beendet wird (Strg+C, kill, Zeitlimit des Aufrufers): dann stellt es her, beendet den Testbefehl
// und endet mit Exit 128+Signal. NICHT garantiert: SIGKILL und Stromausfall, dort kann niemand mehr aufräumen; wer so einen
// Lauf hatte, prüft mit `git diff` auf eine liegengebliebene Mutation.
// Exit 0 heißt: der Test wurde unter der Mutation rot (gut). Exit 1: der Test blieb grün (Mutation überlebt), der Grundlauf
// ohne Mutation war nicht grün, oder der Suchtext kommt nicht genau einmal vor. Exit 2: Aufruf falsch.
// Aufruf: node pruef/mutiere.mjs <datei> <suche> <ersetze> -- <befehl …>
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const [datei, suche, ersetze, trenner, ...befehl] = process.argv.slice(2);
if (!datei || suche === undefined || ersetze === undefined || trenner !== '--' || befehl.length === 0) {
  console.error('Aufruf: node pruef/mutiere.mjs <datei> <suche> <ersetze> -- <befehl …>');
  process.exit(2);
}
// Asynchron statt spawnSync: ein blockierter Elternprozess führt seine Signal-Hörer erst nach dem Testlauf aus, also zu spät
let kind = null;
const lauf = () => new Promise((ok) => {
  kind = spawn(befehl[0], befehl.slice(1), { stdio: 'inherit' });
  kind.on('error', () => ok({ status: 127, signal: null }));
  kind.on('exit', (status, signal) => { kind = null; ok({ status, signal }); });
});
// Grundlauf: ohne Mutation muss der Befehl grün sein, sonst sagt ein rotes Ergebnis unter Mutation nichts
if ((await lauf()).status !== 0) { console.error(`mutiere: Grundlauf ohne Mutation ist nicht grün: ${befehl.join(' ')}`); process.exit(1); }
const alt = fs.readFileSync(datei, 'utf8');
const n = alt.split(suche).length - 1;
if (n !== 1) { console.error(`mutiere: „${suche}“ kommt ${n}-mal in ${datei} vor, verlangt ist genau einmal`); process.exit(1); }
const stelleHer = () => fs.writeFileSync(datei, alt);
for (const [name, nummer] of [['SIGINT', 2], ['SIGTERM', 15], ['SIGHUP', 1]]) {
  process.on(name, () => {
    stelleHer();
    try { kind?.kill('SIGTERM'); } catch { /* der Testbefehl ist schon weg */ }
    console.error(`mutiere: ${name}, ${datei} wiederhergestellt`);
    process.exit(128 + nummer);
  });
}
fs.writeFileSync(datei, alt.replace(suche, () => ersetze));   // Funktion: $& und $1 im Ersatz bleiben wörtlich
let r;
try { r = await lauf(); } finally { stelleHer(); }
if (r.status === 0) { console.error(`MUTATION ÜBERLEBT: ${befehl.join(' ')} blieb grün`); process.exit(1); }
console.log(`MUTATION ROT (gut): Exit ${r.status ?? r.signal}, ${datei} wiederhergestellt`);
