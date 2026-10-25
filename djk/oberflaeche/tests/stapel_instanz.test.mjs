// I08 Nachzug R2 (m4): der Server unter Test fasst nie die Dateien des Betriebs an (Instanz leer), besonders nicht /dev/shm/cypherdj/kanten
// (Vorhoeren.ende() schreibt sie bei jedem Stopp per grep -v und mv neu). Die Hilfe stapel() setzt CYPHERDJ_INSTANZ auch für den Server.
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { stapel } from './hilfen/mediathek.mjs';
import { TEST_INSTANZ } from './hilfen/instanz.mjs';

test('stapel: der Server hat die Testinstanz, sein Kanten-Pfad liegt nie im Betrieb; nach dem Test ist die Umgebung wie vorher', async (t) => {
  const vorher = process.env.CYPHERDJ_INSTANZ;
  let pfad;
  await t.test('innen', async (u) => {
    const { o } = await stapel(u);
    pfad = o.vorhoeren.o.kantenDatei;
    assert.equal(process.env.CYPHERDJ_INSTANZ, TEST_INSTANZ);
    assert.notEqual(pfad, '/dev/shm/cypherdj/kanten', 'Betriebspfad');
    assert.equal(pfad, `/dev/shm/cypherdj-${TEST_INSTANZ}/kanten`);
  });
  assert.equal(process.env.CYPHERDJ_INSTANZ, vorher, 'Umgebung wiederhergestellt');
  assert.ok(pfad);
});

test('jede Testdatei, die einen Oberflaeche im Prozess baut, setzt die Instanz für den Server (serverInstanzSetzen oder CYPHERDJ_INSTANZ = TEST_INSTANZ)', () => {
  const hier = path.dirname(fileURLToPath(import.meta.url));
  const dateien = [...fs.readdirSync(hier).filter((f) => f.endsWith('.mjs')).map((f) => path.join(hier, f)),
    ...fs.readdirSync(path.join(hier, 'hilfen')).filter((f) => f.endsWith('.mjs')).map((f) => path.join(hier, 'hilfen', f))];
  const baut = dateien.filter((f) => /new Oberflaeche\(/.test(fs.readFileSync(f, 'utf8')) && f !== fileURLToPath(import.meta.url));
  assert.ok(baut.length >= 5, `Positivkontrolle: gefunden ${baut.length} (mediathek, server, schutznetz, deck_raster, routen_golden)`);
  const ohne = baut.filter((f) => { const s = fs.readFileSync(f, 'utf8'); return !/serverInstanzSetzen\(t\)|process\.env\.CYPHERDJ_INSTANZ = TEST_INSTANZ/.test(s); });
  assert.deepEqual(ohne.map((f) => path.basename(f)), []);
});
