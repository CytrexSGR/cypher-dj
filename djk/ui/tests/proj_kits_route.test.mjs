// Package 1.9 U2 (L25), T2.2/T2.4: the kit folder as the project server sees it. GET /proj/kits lists the folders that hold a kit.json of the right
// shape, spur_neu / spur_aendern with a kit that is not in the folder is refused kit_unbekannt (404) through the real server. The folder is
// CYPHERDJ_KIT_ORDNER, read at every call. Kern attrappe, test instance from CYPHERDJ_TEST_INSTANZ. No sound.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stapel, hole, post } from './support/media_library.mjs';
import { kitDa, listeKits } from '../areas/proj/kits.ts';

// a kit folder with: kit_a (3 sounds), kit_b (1 sound), and four folders that must not be offered
function baueKits(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-kits-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const kit = (n, inhalt) => { fs.mkdirSync(path.join(d, n), { recursive: true }); if (inhalt !== null) fs.writeFileSync(path.join(d, n, 'kit.json'), inhalt); };
  const klang = (note) => ({ note, name: `s${note}`, datei: `s${note}.f32`, frames: 4 });
  kit('kit_b', JSON.stringify({ schema: 1, name: 'kit_b', klaenge: [klang(0)] }));
  kit('kit_a', JSON.stringify({ schema: 1, name: 'kit_a', klaenge: [klang(0), klang(1), klang(2)] }));
  kit('leer', null);                                                          // folder without kit.json
  kit('kaputt', '{"schema": 1, "klaenge": [');                                // not JSON
  kit('schema2', JSON.stringify({ schema: 2, klaenge: [klang(0)] }));         // wrong schema
  kit('Gross', JSON.stringify({ schema: 1, klaenge: [klang(0)] }));           // name rule
  kit('ohne-klaenge', JSON.stringify({ schema: 1, klaenge: [] }));            // no sounds
  fs.writeFileSync(path.join(d, 'datei.json'), '{}');                         // a file, not a folder
  return d;
}
const mitKitOrdner = (t, d) => {
  const alt = process.env.CYPHERDJ_KIT_ORDNER;
  process.env.CYPHERDJ_KIT_ORDNER = d;
  t.after(() => { if (alt === undefined) delete process.env.CYPHERDJ_KIT_ORDNER; else process.env.CYPHERDJ_KIT_ORDNER = alt; });
};

test('kits module: listeKits offers only well-formed kit folders, sorted; kitDa follows the name rule and the file', (t) => {
  const d = baueKits(t); mitKitOrdner(t, d);
  assert.deepEqual(listeKits(), [{ name: 'kit_a', klaenge: 3 }, { name: 'kit_b', klaenge: 1 }]);
  assert.equal(kitDa('kit_a'), true);
  assert.equal(kitDa('leer'), false, 'folder without kit.json');
  assert.equal(kitDa('nicht-da-i19'), false);
  assert.equal(kitDa('../' + path.basename(d) + '/kit_a'), false, 'a path never leaves the folder');
  assert.equal(kitDa('Gross'), false, 'the name rule applies before the file system');
  // negative control: a folder that does not exist offers nothing and does not throw
  mitKitOrdner(t, path.join(d, 'gibt-es-nicht'));
  assert.deepEqual(listeKits(), []);
  assert.equal(kitDa('kit_a'), false);
});

test('GET /proj/kits and kit_unbekannt through the real server', async (t) => {
  const d = baueKits(t); mitKitOrdner(t, d);
  const { o, url } = await stapel(t);
  const routen = o.routen().filter((r) => r.pfad === '/proj/kits');
  assert.deepEqual(routen.map((r) => [r.bereich, r.methode, r.schutz]), [['proj', 'GET', 'offen']]);
  const l = await hole(url, '/proj/kits');
  assert.deepEqual([l.code, l.j], [200, { kits: [{ name: 'kit_a', klaenge: 3 }, { name: 'kit_b', klaenge: 1 }] }]);
  const neu = await post(url, '/proj/neu', { name: 'Kits' });
  assert.equal(neu.code, 200, JSON.stringify(neu.j));
  const rev = () => hole(url, '/proj/aktuell?nur=rev').then((r) => r.j.rev);
  const rev0 = await rev();
  const aendern = (geraet) => post(url, '/proj/aendern', { rev: rev0, label: 'kit', befehle: [{ befehl: 'spur_neu', art: 'instrument', geraet }] });
  const nix = await aendern({ art: 'intern', name: 'kit', kit: 'nicht-da-i19' });
  assert.deepEqual([nix.code, nix.j.fehler], [404, 'kit_unbekannt'], JSON.stringify(nix.j));
  assert.match(nix.j.text, /that kit is not in the kit folder/);
  assert.equal(await rev(), rev0, 'a refusal changes nothing');
  // negative control: a kit that is in the folder is accepted and the track is named after it
  const ok = await aendern({ art: 'intern', name: 'kit', kit: 'kit_a' });
  assert.equal(ok.code, 200, JSON.stringify(ok.j));
  const sp = (await hole(url, '/proj/aktuell')).j.projekt.spuren.at(-1);
  assert.deepEqual([sp.name, sp.geraet], ['KIT · kit_a', { art: 'intern', name: 'kit', kit: 'kit_a' }]);
});
