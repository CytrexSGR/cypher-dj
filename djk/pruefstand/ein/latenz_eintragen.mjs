// I08 Task 14: Messdatei des Clients -> POST /geraete/latenz. Aufruf: node latenz_eintragen.mjs <Datei> <Port> <k> <art software|kabel> [cypher|andreas]
import fs from 'node:fs';
const [datei, port, k, art, quelle = 'cypher'] = process.argv.slice(2);
let m;
try { m = JSON.parse(fs.readFileSync(datei, 'utf8')); }
catch (e) { console.error('Messung ohne Wert, nichts eingetragen: keine lesbare Messdatei', datei, `(${e.code ?? e.name})`); process.exit(3); }   // nach einem Fehllauf gibt es keine Datei, das ist der Normalfall
if (!m.ok) { console.error('Messung ohne Wert, nichts eingetragen:', m.grund); process.exit(3); }
const r = await fetch(`http://127.0.0.1:${port}/geraete/latenz`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-djk-quelle': quelle },
  body: JSON.stringify({ k: Number(k), art, samples: m.samples, streuung: m.streuung, min: m.min, max: m.max, laeufe: m.laeufe, quantum: m.quantum, rate: m.rate }) });
console.log(r.status, JSON.stringify((await r.json()).fehler ?? 'ok'));
process.exit(r.status === 200 ? 0 : 1);
