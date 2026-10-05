import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Journal, setIdAus, type JournalZeile } from '../src/journal.ts';
import { pruefer, SCHEMA_JOURNAL } from '../src/vertrag.ts';

const SET = '2026-09-24_2100';
const zeile = (typ: string, daten: Record<string, unknown> = {}): JournalZeile =>
  ({ sample: 90000, beat: 4, takt: 2, mono_ns: 171571080000000, von: 'kern', typ, daten });
const start = (): JournalZeile => ({
  ...zeile('set_start', { set_id: SET, generation: 0, vertrag: 1, konfiguration: {} }), von: 'leitstand',
});
const lies = (p: string) => fs.readFileSync(p, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const ordner = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ls-journal-'));

test('set_id nach §9.2-Form JJJJ-MM-TT_hhmm; eine andere Form ist ein Fehler', () => {
  assert.equal(setIdAus(new Date(2026, 8, 24, 21, 0)), '2026-09-24_2100');
  assert.equal(setIdAus(new Date(2026, 0, 5, 7, 3)), '2026-01-05_0703');
  assert.throws(() => new Journal(ordner(), 'kette'), /JJJJ-MM-TT_hhmm/);
});

test('set_start ist die erste Zeile, gepufferte Zeilen folgen in Reihenfolge', () => {
  const j = new Journal(ordner(), SET);
  j.schreibe({ ...zeile('/k/hallo'), sample: null, beat: null, takt: null });
  j.schreibe(zeile('/q'));
  assert.equal(fs.existsSync(j.pfad), false); // vor set_start nichts auf der Platte
  j.oeffne(start());
  j.schreibe(zeile('/takt'));
  j.schliesse();
  assert.deepEqual(lies(j.pfad).map((z) => z.typ), ['set_start', '/k/hallo', '/q', '/takt']);
  assert.equal(j.zeilen, 4);
});

test('ein zweiter Lauf mit derselben set_id hängt an und beginnt mit fortsetzung', () => {
  const d = ordner();
  const a = new Journal(d, SET);
  a.oeffne(start());
  a.schreibe(zeile('/takt'));
  a.schliesse();
  const b = new Journal(d, SET);
  b.oeffne(start());
  b.schliesse();
  assert.deepEqual(lies(b.pfad).map((z) => z.typ), ['set_start', '/takt', 'fortsetzung']);
});

test('Puffer vor set_start ist begrenzt und meldet Verworfenes', () => {
  const j = new Journal(ordner(), SET);
  for (let i = 0; i < Journal.PUFFER_MAX + 5; i++) j.schreibe(zeile('/k/hallo', { i }));
  j.oeffne(start());
  j.schliesse();
  const z = lies(j.pfad);
  assert.equal(z[1].daten.i, 5); // die ältesten fünf sind weg
  assert.deepEqual(z.at(-1).daten, { anzahl: 5 });
});

test('Zeilen gültig gegen das Journal-Schema aus 09; Fehlerfall ohne mono_ns, falsche set_id im set_start', () => {
  const v = pruefer(SCHEMA_JOURNAL);
  const ok = zeile('/q', { id: 1, quelle: 'pruefstand', status: 2, ist_sample: 90000, ist_beat: 4, grund: '' });
  assert.equal(v(ok).ok, true, v(ok).fehler);
  assert.equal(v({ ...ok, sample: null, beat: null, takt: null }).ok, true); // vor der ersten Kern-Zeit
  assert.equal(v(start()).ok, true, v(start()).fehler);
  const { mono_ns: _weg, ...ohne } = ok;
  assert.equal(v(ohne).ok, false);
  assert.equal(v({ ...start(), daten: { set_id: 'kette', generation: 0, vertrag: 1, konfiguration: {} } }).ok, false);
});
