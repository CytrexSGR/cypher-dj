// Muster-Bibliothek (Plan 2026-10-10-mediathek-browser, S2b): drei Quellen, stabile ids, Speichern mit Prüfung des Namens
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MusterBibliothek } from '../muster_bibliothek.ts';

function welt(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-mb-')); t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const eigen = path.join(d, 'muster'), sets = path.join(d, 'sets');
  fs.mkdirSync(eigen); fs.mkdirSync(path.join(sets, 'mein-track'), { recursive: true });
  fs.writeFileSync(path.join(sets, 'set1.json'), JSON.stringify({ blocks: [
    { name: 'drop', bars: 32, bpm: 146, code: 'setcps(146/60/4)\nstack(s("bd*4"))' },
    { name: 'intro', bars: 16, bpm: 138, layers: ['s("bd*4")', 's("hh*8")'] }] }));
  fs.writeFileSync(path.join(sets, 'kaputt.json'), '{');
  fs.writeFileSync(path.join(sets, 'mein-track', 'track.mjs'), 'export const M = { d_intro: `s("bd*4")`, b_a: `note("c2").s("sawtooth")`, x: `s("hh")` };\n');
  return { eigen, sets, mb: new MusterBibliothek({ eigen, sets }) };
}

test('liste: eigen, track (Rolle aus Präfix), Archiv (code oder stack(layers)); kaputte Datei übersprungen', async (t) => {
  const { mb } = welt(t);
  const l = await mb.liste();
  assert.deepEqual(l.map((e) => [e.id, e.quelle, e.rolle]).sort(), [
    ['dirigent:set1:drop', 'dirigent', null], ['dirigent:set1:intro', 'dirigent', null],
    ['track:mein-track:b_a', 'track', 'bass'], ['track:mein-track:d_intro', 'track', 'drums'], ['track:mein-track:x', 'track', null]]);
  const intro = l.find((e) => e.id === 'dirigent:set1:intro');
  assert.equal(intro.text, 'stack(\n  s("bd*4"),\n  s("hh*8")\n)');
  assert.deepEqual([intro.name, intro.bpm, intro.takte, intro.ladbar], ['set1 · intro', 138, 16, false], 'Archiv: nur ansehen');
  assert.equal(l.find((e) => e.id === 'track:mein-track:d_intro').ladbar, true);
});

test('speichere: Name geprüft, .js + .json, kein Überschreiben ohne Erlaubnis, leer abgewiesen; danach in der Liste', async (t) => {
  const { mb, eigen } = welt(t);
  const r = mb.speichere({ name: 'acid-a', text: 'note("c2 eb2").s("sawtooth")\n', rolle: 'bass', strom: 2, von: 'andreas' });
  assert.equal(r.name, 'acid-a');
  assert.equal(fs.readFileSync(path.join(eigen, 'acid-a.js'), 'utf8'), 'note("c2 eb2").s("sawtooth")\n');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(eigen, 'acid-a.json'), 'utf8')).rolle, 'bass');
  assert.throws(() => mb.speichere({ name: 'acid-a', text: 's("bd")', rolle: 'drums', strom: 1, von: 'andreas' }), (e) => e.code === 409 && e.fehler === 'name_vergeben');
  mb.speichere({ name: 'acid-a', text: 's("bd")', rolle: 'drums', strom: 1, von: 'andreas', ueberschreiben: true });
  assert.equal(fs.readFileSync(path.join(eigen, 'acid-a.js'), 'utf8'), 's("bd")\n');
  for (const name of ['../x', 'A B', '', 'x'.repeat(60)]) assert.throws(() => mb.speichere({ name, text: 's("bd")', rolle: 'drums', strom: 1, von: 'andreas' }), (e) => e.code === 400 && e.fehler === 'name_ungueltig', name);
  assert.throws(() => mb.speichere({ name: 'leer', text: '  ', rolle: 'drums', strom: 1, von: 'andreas' }), (e) => e.code === 409 && e.fehler === 'kein_muster');
  const e = (await mb.liste()).find((x) => x.id === 'eigen:acid-a');
  assert.deepEqual([e.quelle, e.rolle, e.ladbar, e.text], ['eigen', 'drums', true, 's("bd")']);
  assert.equal(await mb.eintrag('eigen:gibtsnicht'), null);
  assert.equal(await mb.eintrag('../../etc:passwd'), null, 'ungültige id → null, kein Pfad');
});

test('Archiv-ids sind stabil: aus Datei und Blockname, nicht aus der Position; Dubletten bekommen einen Inhalts-Hash (Review S2b Befund 4)', async (t) => {
  const { mb, sets } = welt(t);
  const vorher = (await mb.liste()).find((e) => e.id === 'dirigent:set1:drop');
  // ein Block wird VORN eingefügt: „drop“ rutscht von Index 0 auf 1 und behält seine id
  const j = JSON.parse(fs.readFileSync(path.join(sets, 'set1.json'), 'utf8'));
  j.blocks.unshift({ name: 'neu vorn', bars: 8, bpm: 130, layers: ['s("cp*2")'] });
  fs.writeFileSync(path.join(sets, 'set1.json'), JSON.stringify(j));
  const l = await mb.liste();
  assert.equal(l.find((e) => e.id === 'dirigent:set1:drop').text, vorher.text, 'dieselbe id zeigt auf denselben Block');
  assert.ok(l.some((e) => e.id === 'dirigent:set1:neu-vorn'), 'Name wird zum Slug (1/4, Leerzeichen, Großschreibung weg)');
  // zwei Blöcke gleichen Namens: unterscheidbar über den Inhalt, und beide stabil
  j.blocks.push({ name: 'Neu Vorn', bars: 8, bpm: 130, layers: ['s("rim*4")'] });
  fs.writeFileSync(path.join(sets, 'set1.json'), JSON.stringify(j));
  const ids = (await mb.liste()).filter((e) => e.quelle === 'dirigent' && e.name.endsWith('Vorn') || e.name.endsWith('vorn')).map((e) => e.id);
  assert.equal(new Set(ids).size, 2, `zwei verschiedene ids: ${ids}`);
  assert.ok(ids.every((x) => /^dirigent:set1:neu-vorn-[0-9a-f]{6}$/.test(x)), ids.join());
  for (const id of ids) assert.ok(await mb.eintrag(id), 'jede Dublette ist über ihre id auflösbar');
  assert.equal(await mb.eintrag('dirigent:set1:0'), null, 'die alte Positions-id gibt es nicht mehr');
});

test('Archiv-ids: Blöcke ohne Namen bekommen eine id aus dem Inhalt, lange Dubletten bleiben gültig (Re-Review N6)', async (t) => {
  const { mb, sets } = welt(t);
  const lang = 'ein sehr langer blockname der weit ueber vierzig zeichen hinausgeht';
  const blocks = [{ bars: 8, bpm: 130, layers: ['s("bd*4")'] }, { name: '', layers: ['s("hh*8")'] }, { name: lang, layers: ['s("cp")'] }, { name: lang, layers: ['s("cp")'] }, { name: lang, layers: ['s("rim")'] }];
  fs.writeFileSync(path.join(sets, 'alt.json'), JSON.stringify({ blocks }));
  const ids = () => mb.liste().then((l) => l.filter((e) => e.id.startsWith('dirigent:alt:')).map((e) => e.id));
  const vorher = await ids();
  assert.equal(vorher.length, 5);
  assert.equal(new Set(vorher).size, 5, `alle verschieden: ${vorher.join(' | ')}`);
  const gueltig = /^dirigent:[a-z0-9][a-z0-9_-]{0,47}:[a-z0-9][a-z0-9_-]{0,47}$/;
  for (const id of vorher) assert.ok(gueltig.test(id), `gültig und auflösbar: ${id}`);
  for (const id of vorher) assert.ok(await mb.eintrag(id), `eintrag(${id})`);
  // stabil: ein Block VORN ändert keine bestehende id, auch nicht die der namenlosen
  blocks.unshift({ name: 'neu', layers: ['s("oh")'] });
  fs.writeFileSync(path.join(sets, 'alt.json'), JSON.stringify({ blocks }));
  const nachher = await ids();
  for (const id of vorher) assert.ok(nachher.includes(id), `${id} gibt es nach dem Einfügen vorn noch`);
  assert.ok(vorher.some((id) => /:block-[0-9a-f]{6}/.test(id)), 'namenlos → block-<hash>');
});

import { stapel, hole, post, tmpMt, mid } from './hilfen/mediathek.mjs';
test('GET /stoebern?typ=strudel, Baum mit quelle/rolle, POST /muster speichert das LAUFENDE Muster der Instanz', async (t) => {
  const { eigen, sets } = welt(t);
  const mo = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-mo-')); t.after(() => fs.rmSync(mo, { recursive: true, force: true }));
  const s = await stapel(t, { musterBibliothek: eigen, musterSets: sets, musterOrdner: mo });
  const r = await hole(s.url, '/stoebern?typ=strudel&sort=name');
  assert.equal(r.code, 200); assert.equal(r.j.gesamt, 5);
  assert.deepEqual(Object.keys(r.j.treffer[0]).sort(), ['bpm', 'id', 'ladbar', 'name', 'quelle', 'rolle', 'takte', 'text', 'typ']);
  assert.equal((await hole(s.url, '/stoebern?typ=strudel&text=hh')).j.gesamt, 2, 'Text sucht in Name und Mustertext (Teilstring)');
  assert.equal((await hole(s.url, '/stoebern?typ=strudel&feld=quelle&wert=track')).j.gesamt, 3);
  assert.equal((await hole(s.url, '/stoebern?typ=strudel&feld=rolle&wert=drums')).j.gesamt, 1);
  assert.deepEqual((await hole(s.url, '/stoebern?typ=strudel&bpm=140-150')).j.treffer.map((e) => e.id), ['dirigent:set1:drop'], 'BPM-Filter gilt für Muster mit BPM; ohne BPM fallen sie heraus');
  assert.equal((await hole(s.url, '/stoebern?typ=strudel&bpm=138')).j.gesamt, 1, 'einzelner Wert');
  assert.equal((await hole(s.url, '/stoebern?typ=strudel&bpm=abc')).code, 400, 'ungültiger BPM-Wert: 400 wie bei den anderen Typen');
  assert.deepEqual(Object.keys((await hole(s.url, '/stoebern/baum?typ=strudel')).j.facetten), ['quelle', 'rolle']);
  // SAVE: das laufende Muster von Strom 2 (strom1.js im Muster-Ordner der Instanz) — nicht ein Text aus der Anfrage
  const ordner2 = `${mo}2`; fs.mkdirSync(ordner2, { recursive: true }); t.after(() => fs.rmSync(ordner2, { recursive: true, force: true }));   // Strom 2 = <basis>2
  fs.writeFileSync(path.join(ordner2, 'strom1.js'), 'note("c2").s("sawtooth")\n');
  const sv = await post(s.url, '/muster', { name: 'bass-lauf', strom: 2, text: 's("ignoriert")' });
  assert.deepEqual([sv.code, sv.j.name], [201, 'bass-lauf']);
  assert.equal(fs.readFileSync(path.join(eigen, 'bass-lauf.js'), 'utf8'), 'note("c2").s("sawtooth")\n');
  assert.equal(JSON.parse(fs.readFileSync(path.join(eigen, 'bass-lauf.json'), 'utf8')).rolle, 'bass', 'Rolle aus dem Strom');
  assert.deepEqual([(await post(s.url, '/muster', { name: 'bass-lauf', strom: 2 })).code], [409]);
  assert.equal((await post(s.url, '/muster', { name: 'leer', strom: 3 })).code, 409, 'Instanz ohne Muster → kein_muster');
  assert.equal((await post(s.url, '/muster', { name: 'leer', strom: 3 })).j.fehler, 'kein_muster');
  assert.equal((await hole(s.url, '/stoebern?typ=strudel&feld=quelle&wert=eigen')).j.gesamt, 1);
});

test('Listen-Ansicht: je Posten id = Posten-id und eintrag = Browser-Zeile (strudel mit Text, track mit typ/pfad_da)', async (t) => {
  const { eigen, sets } = welt(t);
  const m = tmpMt(t);
  const so = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-so-')); t.after(() => fs.rmSync(so, { recursive: true, force: true }));
  const s = await stapel(t, { mediathek: m.db, musterBibliothek: eigen, musterSets: sets, sammlungen: so });
  const sl = (await post(s.url, '/sammlungen', { name: 'Grooves', art: 'strudellist' })).j.slug;
  await post(s.url, `/sammlungen/${sl}/posten`, { art: 'muster', ref: 'track:mein-track:d_intro' });
  await post(s.url, `/sammlungen/${sl}/posten`, { art: 'muster', ref: 'eigen:weg' });   // gibt es nicht (mehr)
  const [a, b] = (await hole(s.url, `/sammlungen/${sl}`)).j.posten;
  assert.deepEqual([a.id, a.eintrag.typ, a.eintrag.id, a.eintrag.text, a.eintrag.ladbar], ['p1', 'strudel', 'track:mein-track:d_intro', 's("bd*4")', true]);
  assert.deepEqual([b.id, b.status, b.eintrag.ladbar], ['p2', 'missing', false]);
  const pl = (await post(s.url, '/sammlungen', { name: 'Peak', art: 'playlist' })).j.slug;
  await post(s.url, `/sammlungen/${pl}/posten`, { art: 'track', material_id: mid(5) });
  const [tr] = (await hole(s.url, `/sammlungen/${pl}`)).j.posten;
  assert.deepEqual([tr.id, tr.eintrag.typ, tr.eintrag.material_id, tr.eintrag.status, typeof tr.eintrag.pfad_da], ['p1', 'track', mid(5), 'prepare', 'boolean']);
});

test('GET /stoebern?typ=strudel&text: Wörter UND über Name, Code und Rolle; name:/rolle: schränken ein; andere Feld-Präfixe 400', async (t) => {
  const { eigen, sets } = welt(t);
  const mo = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-mo-')); t.after(() => fs.rmSync(mo, { recursive: true, force: true }));
  const s = await stapel(t, { musterBibliothek: eigen, musterSets: sets, musterOrdner: mo });
  const ids = async (q) => { const r = await hole(s.url, `/stoebern?typ=strudel&${q}`); return [r.code, (r.j.treffer ?? []).map((e) => e.id).sort()]; };
  const text = (x, rest = '') => ids(`text=${encodeURIComponent(x)}${rest}`);
  assert.deepEqual(await text('bass'), [200, ['track:mein-track:b_a']], 'Rolle (b_ → bass)');
  assert.deepEqual(await text('sawtooth'), [200, ['track:mein-track:b_a']], 'Code');
  assert.deepEqual(await text('bd intro'), [200, ['dirigent:set1:intro', 'track:mein-track:d_intro']], 'zwei Wörter: UND, nicht als Phrase');
  assert.deepEqual(await text('rolle:drums'), [200, ['track:mein-track:d_intro']]);
  assert.deepEqual(await text('name:intro'), [200, ['dirigent:set1:intro', 'track:mein-track:d_intro']]);
  assert.deepEqual(await text('name:sawtooth'), [200, []], 'name: sucht nur im Namen, nicht im Code');
  assert.deepEqual(await text('rolle:bass sawtooth'), [200, ['track:mein-track:b_a']]);
  assert.deepEqual(await text('bd', '&feld=quelle&wert=track'), [200, ['track:mein-track:d_intro']], 'Text + Facette');
  assert.deepEqual(await text('zzqxnichtda'), [200, []], 'Negativ: Unsinn');
  assert.equal((await text(' - * '))[1].length, 5, 'Text ohne Buchstaben ist kein Filter');
  for (const x of ['artist:liebing', 'label:drumcode', 'pack:battery kick', 'folder:beatport', 'ordner:x'])
    assert.deepEqual(await text(x), [400, []], `${x} gilt für Muster nicht`);
  const r = await hole(s.url, `/stoebern?typ=strudel&text=${encodeURIComponent('label:x')}`);
  assert.equal(r.j.fehler, 'suchfeld_nicht_anwendbar');
});

test('Review S4-6: ordner gilt für Muster nicht: 400 filter_nicht_anwendbar, leer ist kein Filter, Katalog-Typen nehmen ordner weiter', async (t) => {
  const { eigen, sets } = welt(t);
  const mo = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-mo-')); t.after(() => fs.rmSync(mo, { recursive: true, force: true }));
  const s = await stapel(t, { musterBibliothek: eigen, musterSets: sets, musterOrdner: mo });
  const r = await hole(s.url, '/stoebern?typ=strudel&ordner=%2Fx');
  assert.deepEqual([r.code, r.j.fehler], [400, 'filter_nicht_anwendbar']);
  assert.equal((await hole(s.url, '/stoebern?typ=strudel&ordner=')).j.gesamt, 5, 'leerer Wert ist kein Filter');
  assert.equal((await hole(s.url, '/stoebern?typ=strudel')).j.gesamt, 5, 'Negativkontrolle: ohne ordner die volle Liste');
});
