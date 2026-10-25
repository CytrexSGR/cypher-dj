// I08 Task 6: Abstand MIDI-Ereignis minus Audio-Flanke im Kern-Zeitstrahl. Aufruf: node messe_midi_zeit.mjs <Port der Prüfinstanz> <Anzahl> <Ausgabedatei>
// Der Client cypherdj-pruef-ein sendet beides im selben Frame; 0 heißt: Zeitstempel und Audio fallen zusammen.
import fs from 'node:fs';
const [port, anzahl, aus] = [process.argv[2], Number(process.argv[3] ?? 20), process.argv[4]];
const holen = async () => (await (await fetch(`http://127.0.0.1:${port}/geraete`)).json()).kern?.ein ?? null;
const spaet = (ms) => new Promise((r) => setTimeout(r, ms));
const deltas = [];
let letzteFlanke = -1;
const ende = Date.now() + (anzahl + 5) * 2000;
while (deltas.length < anzahl && Date.now() < ende) {
  const e = await holen();
  if (e && e.flanke_sample >= 0 && e.flanke_sample !== letzteFlanke) {
    await spaet(150);                     // das MIDI-Ereignis steht im selben /zustand/ein oder im nächsten (20 Hz)
    const z = await holen();
    letzteFlanke = z.flanke_sample;
    deltas.push(z.midi_sample - z.flanke_sample);
  }
  await spaet(50);
}
const n = deltas.length, mittel = n ? deltas.reduce((a, b) => a + b, 0) / n : null;
const ergebnis = { n, deltas, mittel, min: n ? Math.min(...deltas) : null, max: n ? Math.max(...deltas) : null, gemessen: new Date().toISOString() };
if (aus) fs.writeFileSync(aus, JSON.stringify(ergebnis, null, 2) + '\n');
console.log(JSON.stringify(ergebnis));
process.exit(n >= anzahl ? 0 : 1);
