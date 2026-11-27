// Release metadata: the project field `abgabe_meta`, the command abgabe_meta_setzen and the tags of abgabeTags (export delivery plan, task 4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { neuesProjekt, pruefeFehler, wiedergabeSicht } from '../project/model.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { abgabeTags } from '../project/abgabe.ts';
import path from 'node:path';
import { Verlauf, aendere, rueckgaengig } from '../project/history.ts';
import { kopie, tmpOrdner } from './support/project.mjs';

const lauf = (p, befehle) => fuehreListeAus(kopie(p), befehle);
const grund = (p, b) => { try { fuehreListeAus(kopie(p), [b]); return null; } catch (e) { return e.grund; } };

test('abgabe_meta_setzen sets, removes and clears', () => {
  const p = neuesProjekt('m');
  const a = lauf(p, [{ befehl: 'abgabe_meta_setzen', titel: 'Night', kuenstler: 'Cytrex' }]);
  assert.deepEqual(a.projekt.abgabe_meta, { titel: 'Night', kuenstler: 'Cytrex' });
  assert.equal(pruefeFehler(a.projekt), null);
  assert.deepEqual(wiedergabeSicht(a.projekt), wiedergabeSicht(p));
  assert.equal(a.betrifft_wiedergabe, false);
  const b = lauf(a.projekt, [{ befehl: 'abgabe_meta_setzen', kuenstler: null }]);
  assert.deepEqual(b.projekt.abgabe_meta, { titel: 'Night' });
  const c = lauf(b.projekt, [{ befehl: 'abgabe_meta_setzen', titel: null }]);
  assert.equal('abgabe_meta' in c.projekt, false, 'removing the last field removes the object');
  const d = lauf(a.projekt, [{ befehl: 'abgabe_meta_setzen', aus: true }]);
  assert.equal('abgabe_meta' in d.projekt, false);
  assert.equal('abgabe_meta' in lauf(p, [{ befehl: 'abgabe_meta_setzen', aus: true }]).projekt, false, 'aus on an empty project is fine');
  const e = lauf(a.projekt, [{ befehl: 'abgabe_meta_setzen', jahr: 2026, isrc: 'DEXXX2600001', album: 'A', genre: 'Techno' }]);
  assert.deepEqual(e.projekt.abgabe_meta, { titel: 'Night', kuenstler: 'Cytrex', jahr: 2026, isrc: 'DEXXX2600001', album: 'A', genre: 'Techno' });
});

test('abgabe_meta_setzen is one undo step with several fields', (t) => {
  const v = new Verlauf(path.join(tmpOrdner(t), 'undo.jsonl'), { zeitgeber: false });
  const p = neuesProjekt('m');
  const r = aendere(v, p, [{ befehl: 'abgabe_meta_setzen', titel: 'T', jahr: 2026, genre: 'G' }], { quelle: 'andreas', label: 'Meta' });
  assert.equal(r.projekt.rev, p.rev + 1);
  assert.deepEqual(r.projekt.abgabe_meta, { titel: 'T', jahr: 2026, genre: 'G' });
  const u = rueckgaengig(v, r.projekt, { quelle: 'andreas' }).projekt;
  assert.equal('abgabe_meta' in u, false, 'one undo removes all three fields');
});

test('abgabe_meta_setzen keeps text unchanged: quotes, equals sign, emoji, 200 characters', () => {
  const p = neuesProjekt('m');
  for (const t of ['say "hi" = ok', 'Nacht \u{1F319} Müller', 'x'.repeat(200), "it's  spaced "]) {
    assert.equal(lauf(p, [{ befehl: 'abgabe_meta_setzen', titel: t }]).projekt.abgabe_meta.titel, t);
  }
});

test('abgabe_meta_setzen refuses bad values', () => {
  const p = neuesProjekt('m');
  for (const arg of [{}, { titel: '' }, { titel: 'a\nb' }, { titel: 'a\u007fb' }, { titel: 'a\u0000b' }, { titel: 'x'.repeat(201) }, { titel: 5 }, { jahr: '2026' },
    { jahr: 1899 }, { jahr: 2101 }, { jahr: 2026.5 }, { isrc: 'de-xxx-26-00001' }, { isrc: 'dexxx2600001' }, { isrc: 'DEXXX260000' }, { aus: true, titel: 'x' },
    { aus: false }, { titel: undefined }]) {
    assert.equal(grund(p, { befehl: 'abgabe_meta_setzen', ...arg }), 'argument_ungueltig', JSON.stringify(arg));
  }
});

test('abgabe_meta_setzen names an unknown argument', () => {
  assert.equal(grund(neuesProjekt('m'), { befehl: 'abgabe_meta_setzen', farbe: 1 }), 'argument_unbekannt');
});

test('a project without abgabe_meta saves byte-identical; one with it loads and saves unchanged', () => {
  const p = neuesProjekt('m');
  assert.equal(JSON.stringify(p).includes('abgabe_meta'), false);
  const a = lauf(p, [{ befehl: 'abgabe_meta_setzen', titel: 'T', jahr: 1900 }]).projekt;
  assert.equal(pruefeFehler(kopie(a)), null);
  assert.equal(JSON.stringify(kopie(a)), JSON.stringify(a));
  const b = lauf(a, [{ befehl: 'abgabe_meta_setzen', aus: true }]).projekt;
  assert.equal(JSON.stringify(b), JSON.stringify({ ...p, rev: b.rev }).replace(/"rev":\d+/, `"rev":${b.rev}`));
});

test('a stored project with a wrong abgabe_meta is refused', () => {
  const p = neuesProjekt('m');
  for (const m of [{}, { titel: '' }, { jahr: '2026' }, { isrc: 'x' }, { farbe: 'rot' }, 'x', [], { titel: 'a\nb' }]) {
    assert.match(String(pruefeFehler({ ...p, abgabe_meta: m })), /abgabe_meta/, JSON.stringify(m));
  }
});

test('abgabeTags per format', () => {
  const projekt = neuesProjekt('night drive');
  const p = { ...projekt, name: 'night drive', tempo_bpm: 128.5, tonart: { grundton: 9, skala: 'minor' },
    abgabe_meta: { kuenstler: 'Cytrex', jahr: 2026, isrc: 'DEXXX2600001' } };
  assert.deepEqual(abgabeTags(p, 'mp3'), { title: 'night drive', artist: 'Cytrex', date: '2026', TSRC: 'DEXXX2600001', TBPM: '129', TKEY: 'Am' });
  assert.deepEqual(abgabeTags(p, 'flac'), { title: 'night drive', artist: 'Cytrex', date: '2026', ISRC: 'DEXXX2600001', BPM: '128.5', INITIALKEY: 'Am' });
  assert.deepEqual(abgabeTags(p, 'wav'), { title: 'night drive', artist: 'Cytrex', date: '2026', ISRC: 'DEXXX2600001', originator: 'cypher-dj', originator_reference: 'DEXXX2600001' });
  assert.deepEqual(abgabeTags({ ...p, tonart: { grundton: 2, skala: 'dorian' }, abgabe_meta: undefined }, 'flac'), { title: 'night drive', BPM: '128.5' });
});

test('abgabeTags: title from the meta, tempo formats, key names', () => {
  const p = { ...neuesProjekt('n'), tempo_bpm: 120, abgabe_meta: { titel: 'Own', album: 'Alb', genre: 'Gen' } };
  assert.deepEqual(abgabeTags(p, 'flac'), { title: 'Own', album: 'Alb', genre: 'Gen', BPM: '120' });
  assert.deepEqual(abgabeTags(p, 'mp3'), { title: 'Own', album: 'Alb', genre: 'Gen', TBPM: '120' });
  assert.deepEqual(abgabeTags(p, 'wav'), { title: 'Own', album: 'Alb', genre: 'Gen' });
  assert.equal(abgabeTags({ ...p, tempo_bpm: 123.456 }, 'flac').BPM, '123.46');
  assert.equal(abgabeTags({ ...p, tempo_bpm: 120.1 }, 'flac').BPM, '120.1');
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  notes.forEach((n, i) => {
    assert.equal(abgabeTags({ ...p, tonart: { grundton: i, skala: 'major' } }, 'mp3').TKEY, n);
    assert.equal(abgabeTags({ ...p, tonart: { grundton: i, skala: 'minor' } }, 'flac').INITIALKEY, `${n}m`);
  });
  assert.equal('TKEY' in abgabeTags({ ...p, tonart: { grundton: 0, skala: 'lydian' } }, 'mp3'), false);
});
