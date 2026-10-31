// Paket 1.13 Warp, Slice 3b: Material für die Zielabnahme (pruef/abnahme_w3b.mjs). Nimmt den Aufbau von Slice 3a (w3a_aufbau.mjs: Drift-Track mit Karte, Katalog, Ablage)
// und legt dazu einen Bestand des Decks an: bestand/<sha[:16]>/ mit material.json (dieselbe Karte, Eins 2 unsicher), einer Fassung und ohne korrekturen.jsonl, für den Track
// ksha(2). Die Prüfinstanz bekommt ihn mit CYPHERDJ_KORREKTUREN (nie der echte Bestand). Aufruf: node pruef/w3b_aufbau.mjs --ziel /tmp/w3b-ziel [--instanz a]
// Ausgabe: das JSON von w3a_aufbau plus { bestand }.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ksha } from '../tests/hilfen/katalog.mjs';
import { schreibeBestand } from '../tests/hilfen/karte.mjs';

const { values: opt } = parseArgs({ options: { ziel: { type: 'string' }, instanz: { type: 'string' } } });
if (!opt.ziel) { process.stderr.write('Aufruf: node pruef/w3b_aufbau.mjs --ziel <Ordner> [--instanz a]\n'); process.exit(2); }
if (!/^\/(tmp|dev\/shm)\//.test(path.resolve(opt.ziel))) { process.stderr.write('--ziel nur unter /tmp oder /dev/shm (nie der echte Bestand)\n'); process.exit(2); }
const HIER = path.dirname(fileURLToPath(import.meta.url));
const a = JSON.parse(execFileSync(process.execPath, [path.join(HIER, 'w3a_aufbau.mjs'), '--ziel', opt.ziel, ...(opt.instanz ? ['--instanz', opt.instanz] : [])], { encoding: 'utf8' }));
const bestand = path.join(opt.ziel, 'bestand');
fs.rmSync(bestand, { recursive: true, force: true });
schreibeBestand(bestand, ksha(2), { karte: a.schlaege_s.map((s, k) => [s, k]), eins: 2, unsicher: true, dauer_s: a.dauer_s });
process.stdout.write(`${JSON.stringify({ ...a, bestand })}\n`);
