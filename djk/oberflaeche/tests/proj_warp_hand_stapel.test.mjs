// Paket 1.13 Warp, Slice 3b (D3): die Verdrahtung des Bestands im echten Seiten-Server. Eine Prüfinstanz (a..i) schreibt nie in den Bestand des Decks, auch wenn der Server
// ihn kennt (Option bestand); nur ein ausdrücklicher proj.bestand (oder der Betrieb ohne Instanz) schaltet den Rückweg von Set 1.1.1 Here ein.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { stapel } from './hilfen/mediathek.mjs';
import { ruf, CYPHER } from './hilfen/proj_stapel.mjs';
import { baueKatalog, ksha } from './hilfen/katalog.mjs';
import { wav } from './hilfen/proj_kontext.mjs';
import { tmpOrdner } from './hilfen/projekt.mjs';
import { karteLinear, schreibeKarte, schreibeBestand } from './hilfen/karte.mjs';

async function lauf(t, projExtra, mitDeckBestand = true) {
  const d = tmpOrdner(t, 'djk-hand-stapel-');
  const katalog = baueKatalog(path.join(d, 'kat'), [{ n: 6, typ: 'track', werk_id: 2, titel: 'Song', bpm: 120, dauer_s: 25, pfad: wav(path.join(d, 'daten'), 'track.wav', 3.84) }]);
  const analyse = path.join(d, 'analyse'), bestand = path.join(d, 'bestand');
  const karte = karteLinear(40, { t0: 0.5, bpm: 120 });
  schreibeKarte(analyse, ksha(6), { karte, eins: 2, unsicher: true });
  if (mitDeckBestand) schreibeBestand(bestand, ksha(6), { karte, eins: 2, unsicher: true });
  const { url } = await stapel(t, { katalog, ...(mitDeckBestand ? { bestand } : {}), proj: { analyse, ...(projExtra ? projExtra(bestand) : {}) } });
  const neu = await ruf(url, 'POST', '/proj/neu', { name: 'Bestand' });
  const a = await ruf(url, 'POST', '/proj/aendern', { rev: neu.j.projekt.rev, label: 'Setup', befehle: [{ befehl: 'spur_neu', art: 'audio' },
    { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 1, sha256: ksha(6), warp: 'auto' }] }, CYPHER);
  assert.equal(a.code, 200, JSON.stringify(a.j));
  const e = await ruf(url, 'POST', '/proj/aendern', { rev: a.j.rev, label: 'Set 1.1.1', befehle: [{ befehl: 'eins_hier', clip_id: 'c1', quell_s: 3 }] }, CYPHER);
  assert.equal(e.code, 200, JSON.stringify(e.j));
  return { hinweise: e.j.hinweise, datei: path.join(bestand, ksha(6).slice(0, 16), 'korrekturen.jsonl') };
}

test('Prüfinstanz: der Server kennt den Bestand des Decks, schreibt aber nichts hinein (eins_nur_hier)', async (t) => {
  const r = await lauf(t, null);
  assert.deepEqual(r.hinweise, [{ index: 0, hinweis: 'eins_nur_hier' }]);
  assert.equal(fs.existsSync(r.datei), false, 'nichts im Bestand des Decks');
});

test('Mit ausdrücklichem proj.bestand schreibt der Server die Eins-Korrektur (eins_gemeldet): Positivkontrolle derselben Anordnung', async (t) => {
  const r = await lauf(t, (b) => ({ bestand: b }));
  assert.deepEqual(r.hinweise, [{ index: 0, hinweis: 'eins_gemeldet' }]);
  assert.equal(fs.readFileSync(r.datei, 'utf8').trim().split('\n').length, 1, 'eine Zeile');
});
