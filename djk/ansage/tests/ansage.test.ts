// Ansage-Zeile gegen Taktgeber und Leitstand (480 BPM): Takt-Zeilen, Kern-weg-Satz, zuruf ins Journal.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import {
  beende, freierTcpPort, freierUdpPort, starte, warte, type Kind,
} from '../../leitstand/tests/hilfen/prozess.ts';
import { zeile } from '../ansage.ts';

const SET = '2026-09-23_0001';
let tmp: string;
let tg: Kind;
let ls: Kind;
let an: Kind;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-ansage-'));
  const [kern, abo, ws] = [await freierUdpPort(), await freierUdpPort(), await freierTcpPort()];
  const konfig = path.join(tmp, 'leitstand.toml');
  fs.writeFileSync(konfig, `version = 1\nws_port = ${ws}\nabo_port = ${abo}\nsets = "${tmp}/sets"\n`);
  tg = await starte('tests/hilfen/taktgeber.ts', ['--port', String(kern), '--bpm', '480'], 'taktgeber:');
  ls = await starte('src/leitstand.ts', ['--konfig', konfig, '--kern-port', String(kern), '--set-id', SET], 'leitstand:');
  an = await starte('../ansage/ansage.ts', ['--konfig', konfig], 'verbunden:');
});
after(async () => { await beende(an); await beende(ls); await beende(tg); });

test('zeile: takt, ansage, willkommen, rpc_fehler; andere Typen nichts', () => {
  const u = (typ: string, daten: Record<string, unknown>) =>
    ({ v: 1 as const, seq: 1, von: 'leitstand', typ, zeit: { sample: 0, beat: 64, takt: 17, phrase: 3 }, daten });
  assert.equal(zeile(u('takt', { takt: 17, phrase: 3, bpm: 128, bericht_vorher: null })), 'T 17.1  P3  128,00 BPM  (ohne Bericht)');
  assert.equal(zeile(u('ansage', { text: 'T 14: Kern da, Generation 0', art: 'info' })), 'T 14: Kern da, Generation 0');
  assert.equal(zeile(u('ansage', { text: 'T 14: x', art: 'warnung' })), 'WARNUNG T 14: x');
  assert.equal(zeile(u('willkommen', { rolle: 'ansage', set_id: SET, generation: 0, autonomie: 1 })),
    `verbunden: Set ${SET}, Generation 0, Autonomie 1`);
  assert.equal(zeile(u('ereignis', { art: 'hand' })), null);
});

test('je Takt eine Zeile; Kern angehalten → Warnsatz, weiter → Kern da; getippter zuruf steht im Journal', { timeout: 20000 }, async () => {
  await warte(2100);
  const takte = an.aus().split('\n').filter((l) => /^T \d+\.1  P\d+  480,00 BPM/.test(l));
  assert.ok(takte.length >= 3 && takte.length <= 6, `${takte.length} Takt-Zeilen in 2,1 s bei 480 BPM`);
  tg.p.kill('SIGSTOP');
  await warte(400);
  tg.p.kill('SIGCONT');
  await warte(400);
  const aus = an.aus();
  assert.match(aus, /WARNUNG T \d+: Kern antwortet nicht \(100 ms ohne \/uhr\)/);
  assert.match(aus.slice(aus.indexOf('Kern antwortet nicht')), /T \d+: Kern da, Generation 0/);
  an.p.stdin!.write('mehr Druck im Bass\n\n');
  await warte(300);
  const j = fs.readFileSync(path.join(tmp, 'sets', SET, 'journal.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const zurufe = j.filter((z) => z.typ === 'zuruf');
  assert.equal(zurufe.length, 1); // die leere Zeile schickt nichts
  assert.equal(zurufe[0].von, 'andreas');
  assert.equal(zurufe[0].daten.daten.text, 'mehr Druck im Bass');
  assert.doesNotMatch(an.aus(), /FEHLER/); // Negativ-Kontrolle: der zuruf war erlaubt
});
