// Anschluss-Zwischenspeicher (Mediathek.trackFelder): eine Änderung an der DB macht ihn ungültig, ohne die 10 min abzuwarten.
// Direkt gegen Mediathek, ohne Server. Fixture wie tests/mediathek.test.mjs (tmpMt).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Mediathek } from '../mediathek.ts';
import { sha, mid, tmpMt } from './hilfen/mediathek.mjs';

test('anschluss(): neu eingefügter Track ist sofort Kandidat und selbst abfragbar (Cache folgt stand())', (t) => {
  const m = tmpMt(t);
  const me = new Mediathek(m.db);
  const opt = { fenster: 6, energie: 'halten', limit: 20 };
  const vorher = me.anschluss(mid(2), opt, new Set(), () => null);   // füllt den Cache
  assert.ok(!vorher.treffer.some((x) => x.titel === 'Neuer Track'));

  const db = new DatabaseSync(m.db);
  db.exec('PRAGMA busy_timeout=2000');
  db.prepare('INSERT INTO werk VALUES (?,?,?)').run(9, 'test', 'w9');
  db.prepare('INSERT INTO objekt(inhalt_sha256, werk_id, dauer_s, erstmals_gesehen) VALUES (?,?,?,?)').run(sha(31), 9, 240, '2026-10-10');
  const ang = (feld, wert) => db.prepare("INSERT INTO angabe(inhalt_sha256, feld, wert, quelle, erhoben_am) VALUES (?,?,?,'tag','2026-10-10')").run(sha(31), feld, wert);
  ang('typ', 'track'); ang('titel', 'Neuer Track'); ang('bpm', '128'); ang('camelot', '9A'); ang('genre', 'Tech House'); ang('energie', '7');
  db.close();
  fs.utimesSync(m.db, new Date(), new Date(Date.now() + 2000));

  const neu = me.anschluss(mid(31), opt, new Set(), () => null);   // (a) vorher 409 kein_track
  assert.equal(neu.lauf.titel, 'Neuer Track');
  const w2 = me.anschluss(mid(2), opt, new Set(), () => null);     // (b) als Kandidat sichtbar
  assert.ok(w2.treffer.some((x) => x.titel === 'Neuer Track'), 'neuer Titel unter den Treffern');
});
