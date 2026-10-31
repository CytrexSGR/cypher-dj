// Paket 1.13 Slice 6 (D13): reine Teile der Seite. Bereich (ganzer Clip oder Loop-Klammer im Clip), Menüpunkte (Separate Stems / Cancel), Körper der Route,
// Balken am Clip, und die Nachladeregel für Stems-Meldungen (Review: Fortschritts-Ticks lösen kein Nachladen aus).
import test from 'node:test';
import assert from 'node:assert/strict';
import { stemsBereich, stemsPunkte, stemsBalken, nachladenNoetig, stemsEndeMeldung, stemsFuerProjekt, stemsEreignis, stemsAktion,
  stemsBalkenListe, stummDecke } from '../oeffentlich/produktion/stems.js';
import { arrBild } from '../oeffentlich/produktion/zeitachse_bedienung.js';
import { neueAnsicht } from '../oeffentlich/produktion/zeitachse.js';

const TEXTE = { abbruch: 'The stem separation was cancelled', veraltet: 'The clip changed while separating: nothing was placed',
  stems_fehler: 'The stem separation failed: nothing was changed' };

const clip = { id: 'c1', art: 'audio', start_beat: 8, laenge_beats: 16, dekodiert: 'fertig' };
const projekt = (loop) => ({ loop, spuren: [{ id: 's1', clips: [clip] }] });

test('S6 Seite: Bereich = Loop-Klammer, wenn gesetzt und ganz im Clip; sonst der ganze Clip', () => {
  assert.deepEqual(stemsBereich(projekt({ an: true, von_beat: 10, bis_beat: 14 }), clip), { von_beat: 10, bis_beat: 14 });
  // Review MINOR 8: neuesProjekt legt immer loop {an:false, 0..32} an (modell.ts:132); gilt nur die eingeschaltete Klammer
  assert.deepEqual(stemsBereich(projekt({ an: false, von_beat: 10, bis_beat: 14 }), clip), { von_beat: 8, bis_beat: 24 });
  assert.deepEqual(stemsBereich(projekt({ an: true, von_beat: 4, bis_beat: 14 }), clip), { von_beat: 8, bis_beat: 24 });      // ragt hinaus
  assert.deepEqual(stemsBereich(projekt(null), clip), { von_beat: 8, bis_beat: 24 });
});

test('S6 Seite: Menüpunkte je Zustand; MIDI und Loop-Clip ohne Punkt, nicht dekodiert gesperrt', () => {
  const p = projekt(null);
  assert.deepEqual(stemsPunkte(p, clip, null).map((x) => [x.id, x.text, !!x.aus]), [['stems', 'Separate Stems (beats 8–24)', false]]);
  const k = stemsPunkte(p, clip, null)[0].koerper;
  assert.deepEqual(k, { clip_id: 'c1', von_beat: 8, bis_beat: 24 });
  const laeuft = { auftrag_id: 3, clip_id: 'c1', zustand: 'laeuft', prozent: 40 };
  assert.deepEqual(stemsPunkte(p, clip, laeuft).map((x) => [x.id, x.text]), [['stems_abbrechen', 'Cancel Stems (40 %)']]);
  assert.deepEqual(stemsPunkte(p, { ...clip, id: 'c2' }, laeuft).map((x) => [x.id, !!x.aus]), [['stems', true]]);       // ein Lauf je Server
  assert.deepEqual(stemsPunkte(p, { ...clip, art: 'midi' }, null), []);
  assert.equal(stemsPunkte(p, { ...clip, loop_beats: 4 }, null)[0].aus, true);
  assert.equal(stemsPunkte(p, { ...clip, dekodiert: 'laeuft' }, null)[0].aus, true);
});

test('S6 Seite: Balken nur am laufenden Clip, Breite nach Prozent', () => {
  const k = { x: 100, y: 40, w: 200, h: 60 };
  assert.equal(stemsBalken(k, { clip_id: 'c1', zustand: 'fertig', prozent: 100 }, 'c1'), null);
  assert.equal(stemsBalken(k, { clip_id: 'c2', zustand: 'laeuft', prozent: 50 }, 'c1'), null);
  assert.deepEqual(stemsBalken(k, { clip_id: 'c1', zustand: 'laeuft', prozent: 25 }, 'c1'), { x: 100, y: 96, w: 50, h: 4 });
  assert.deepEqual(stemsBalken(k, { clip_id: 'c1', zustand: 'laeuft', prozent: null }, 'c1'), { x: 100, y: 96, w: 0, h: 4 });
  // Nachzug F6: in der Stufe schreiben meldet der Server keinen Prozentwert; der Balken steht dann voll (die Trennung ist fertig), nicht bei 0
  assert.deepEqual(stemsBalken(k, { clip_id: 'c1', zustand: 'laeuft', stufe: 'schreiben', prozent: null }, 'c1'), { x: 100, y: 96, w: 200, h: 4 });
  assert.equal(stemsPunkte({ spuren: [] }, { art: 'audio', id: 'c1', dekodiert: 'fertig', start_beat: 0, laenge_beats: 4 },
    { auftrag_id: 3, clip_id: 'c1', zustand: 'laeuft', stufe: 'schreiben', prozent: null })[0].text, 'Cancel Stems (100 %)');
});

// Review: produktion.js:321 rief bei JEDER Stems-SSE-Meldung planeLaden(), weil f.slug dort undefined ist (die Meldung trägt
// {stems:{slug,…}}). Ticks (laeuft) laden nie nach; das Ende lädt nur bei fertig (das Projekt hat sich geändert).
test('S6 Seite: Stems-Ticks laden nicht nach, nur fertig; andere Meldungen bleiben wie sie waren', () => {
  const ctx = { sichtbar: true, slug: 'p1', rev: 5, eigene: () => false };
  const stems = (zustand, prozent) => ({ stems: { slug: 'p1', auftrag_id: 1, clip_id: 'c1', zustand, stufe: 'trennen', prozent } });
  assert.equal(nachladenNoetig('proj', stems('laeuft', 10), ctx), false);
  assert.equal(nachladenNoetig('proj', stems('laeuft', 90), ctx), false);
  assert.equal(nachladenNoetig('proj', stems('abgebrochen'), ctx), false);
  assert.equal(nachladenNoetig('proj', stems('veraltet'), ctx), false);
  assert.equal(nachladenNoetig('proj', stems('fehler'), ctx), false);
  assert.equal(nachladenNoetig('proj', stems('fertig', 100), ctx), true);
  // Negativ-Kontrollen: die bisherigen Auslöser gelten weiter
  assert.equal(nachladenNoetig('proj', { slug: 'p1', rev: 6 }, ctx), true);            // neuer Stand
  assert.equal(nachladenNoetig('proj', { slug: 'p2', rev: 1 }, ctx), true);            // anderes Projekt
  assert.equal(nachladenNoetig('proj', { slug: 'p1', rev: 5, clip_id: 'c1', analyse: 'fertig' }, ctx), true);
  assert.equal(nachladenNoetig('proj', { slug: 'p1', rev: 5 }, ctx), false);           // nichts Neues
  assert.equal(nachladenNoetig('proj', { slug: 'p1', rev: 6 }, { ...ctx, eigene: () => true }), false);   // eigene Änderung
  assert.equal(nachladenNoetig('proj', { slug: 'p1', rev: 6 }, { ...ctx, sichtbar: false }), false);
  assert.equal(nachladenNoetig('stand', {}, ctx), false);
});

test('S6 Seite: Endmeldung je Zustand mit Text, nie „Rejected“', () => {
  const m = (zustand, grund, hinweis) => stemsEndeMeldung({ zustand, grund, hinweis, text: 'server text' }, TEXTE);
  assert.deepEqual(m('fertig'), { text: 'Stems ready: four tracks under the clip', fehler: false });
  assert.equal(m('fertig', undefined, 'stems_ohne_gruppe').text, 'Stems ready: four tracks under the clip (no free group)');
  // F3: der gewollte Abbruch ist kein Fehler (neutral); ein Abbruch aus anderem Grund (Quantum, Zeitlimit) bleibt Fehler-Stil
  assert.deepEqual(m('abgebrochen', 'abbruch'), { text: 'Stems cancelled', fehler: false });
  assert.equal(m('abgebrochen', 'stems_quantum').fehler, true);
  assert.equal(m('veraltet', 'veraltet').text, 'The clip changed while separating: nothing was placed');
  assert.equal(m('fehler', 'stems_fehler').text, 'The stem separation failed: nothing was changed');
  assert.equal(m('fehler', 'neuer_grund_xyz').text, 'server text');                    // unbekannter Grund: Text des Servers
  assert.equal(stemsEndeMeldung({ zustand: 'laeuft' }), null);
});

// ---- Nachbesserung T10 (Review): F1 fremder Stand, F2 Anbindung als reine Funktionen, F3 neutral, F4 kein Import aus produktion.js ----
const eigen = { slug: 'p1', auftrag_id: 3, clip_id: 'c1', zustand: 'laeuft', stufe: 'trennen', prozent: 70 };
const fremd = { ...eigen, slug: 'ganz-anderes-projekt' };

test('S6 F1: fremder Stand → kein Balken, kein Cancel-Punkt, kein Nachladen, keine Meldung; eigener Stand wie bisher', () => {
  const ctx = { slug: 'p1', sichtbar: true };
  // Ereignis: fremd wird ignoriert (stand undefined = unverändert lassen)
  const f = stemsEreignis({ stems: fremd }, ctx, TEXTE);
  assert.deepEqual(f, { behandelt: true, uebernimm: false, stand: null, meldung: null, nachladen: false });
  const fe = stemsEreignis({ stems: { ...fremd, zustand: 'fertig' } }, ctx, TEXTE);
  assert.deepEqual([fe.uebernimm, fe.meldung, fe.nachladen], [false, null, false], 'auch ein fremdes fertig: kein Nachladen, kein Toast');
  assert.equal(nachladenNoetig('proj', { stems: { ...fremd, zustand: 'fertig' } }, { ...ctx, rev: 1, eigene: () => false }), false);
  // eigener Stand: Tick übernimmt, lädt nicht; fertig übernimmt, meldet, lädt
  const t = stemsEreignis({ stems: eigen }, ctx, TEXTE);
  assert.deepEqual([t.behandelt, t.uebernimm, t.stand, t.meldung, t.nachladen], [true, true, eigen, null, false]);
  const e = stemsEreignis({ stems: { ...eigen, zustand: 'fertig' } }, ctx, TEXTE);
  assert.deepEqual([e.uebernimm, e.meldung.text, e.nachladen], [true, 'Stems ready: four tracks under the clip', true]);
  assert.equal(stemsEreignis({ stems: { ...eigen, zustand: 'fertig' } }, { ...ctx, sichtbar: false }, TEXTE).nachladen, false);
  assert.deepEqual(stemsEreignis({ slug: 'p1', rev: 2 }, ctx, TEXTE), { behandelt: false });
  // Anzeige: nach der Übernahme-Regel erreicht ein fremder Stand Menü und Balken nie
  const st = stemsFuerProjekt(fremd, 'p1');
  assert.equal(st, null);
  const p = projekt(null), k = { x: 0, y: 0, w: 100, h: 60 };
  assert.deepEqual(stemsPunkte(p, clip, st).map((x) => x.id), ['stems']);
  assert.deepEqual(stemsBalkenListe(p, st, () => k), []);
  assert.equal(stemsFuerProjekt(eigen, 'p1'), eigen);
  assert.equal(stemsFuerProjekt(eigen, null), null, 'kein offenes Projekt');
  assert.equal(stemsFuerProjekt(null, 'p1'), null);
  assert.equal(stemsFuerProjekt(undefined, 'p1'), null);
});

test('S6 F2: Balkenliste, Stumm-Decke, Menü-Aktion, Bildargumente', async () => {
  const p = { spuren: [{ clips: [{ id: 'c9' }] }, { clips: [{ id: 'c1' }, { id: 'c2' }] }] };
  const aufruf = [];
  const l = stemsBalkenListe(p, eigen, (i, c) => { aufruf.push([i, c.id]); return { x: 10, y: 20, w: 200, h: 60 }; });
  assert.deepEqual(l, [{ x: 10, y: 76, w: 140, h: 4 }]);
  assert.deepEqual(aufruf, [[1, 'c1']], 'nur der Clip des Laufs wird gemessen');
  assert.deepEqual(stemsBalkenListe(p, { ...eigen, zustand: 'fertig' }, () => ({ x: 0, y: 0, w: 1, h: 10 })), []);
  assert.deepEqual(stemsBalkenListe(null, eigen, () => null), []);
  assert.deepEqual(stummDecke({ x: 1, y: 2, w: 3, h: 4 }, { stumm: true }), { x: 1, y: 2, w: 3, h: 4, farbe: 'rgba(11,13,17,0.62)' });
  assert.equal(stummDecke({ x: 1, y: 2, w: 3, h: 4 }, { stumm: false }), null);
  assert.equal(stummDecke({ x: 1, y: 2, w: 3, h: 4 }, {}), null);
  // Menü-Aktion: Pfad und Körper, Fehlerpfad mit fehlerText
  const log = [];
  const holeJson = async (weg, k) => { log.push([weg, k]); return log.length === 3 ? { status: 409, j: { fehler: 'zu_spaet' } } : { status: 200, j: {} }; };
  const melde = (t, f) => log.push(['melde', t, f]);
  const fehlerText = (r) => `T:${r.j.fehler}`;
  await stemsAktion({ id: 'stems', koerper: { clip_id: 'c1' } }, { holeJson, melde, fehlerText });
  await stemsAktion({ id: 'stems_abbrechen', auftrag_id: 3 }, { holeJson, melde, fehlerText });
  assert.deepEqual(log, [['/proj/stems', { clip_id: 'c1' }], ['/proj/stems/abbrechen', { auftrag_id: 3 }]], 'Erfolg: keine Meldung');
  await stemsAktion({ id: 'stems_abbrechen', auftrag_id: 3 }, { holeJson, melde, fehlerText });
  assert.deepEqual(log.slice(2), [['/proj/stems/abbrechen', { auftrag_id: 3 }], ['melde', 'T:zu_spaet', true]]);
  // Bildargumente (zeitachse_bedienung): stems geht mit
  const st = { ansicht: neueAnsicht(), projekt: { loop: null }, projektEntwurf: null, loopEntwurf: null, kopfBeat: null, start: 0, geist: null, stems: eigen };
  assert.equal(arrBild(st).stems, eigen);
  assert.equal(arrBild({ ...st, stems: null }).stems, null);
});

test('S6 F2: Arrangement zeichnet Balken und Stumm-Decke, wenn stems greifen', async () => {
  const fills = [];
  const kontext = () => {
    const z = {};
    return new Proxy(z, { get: (o, k) => (k === 'fillRect' ? (...a) => fills.push([z.fillStyle, ...a]) : k in o ? o[k] : () => {}),
      set: (o, k, v) => { o[k] = v; return true; } });
  };
  const leinwand = () => ({ width: 800, height: 300, getContext: kontext, getBoundingClientRect: () => ({ width: 800, height: 300 }) });
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  const { Arrangement } = await import('../oeffentlich/produktion/arrangement.js');
  const arr = new Arrangement({ lineal: leinwand(), spuren: leinwand(), ueber: leinwand(), wellen: { hole: () => ({}) } });
  const projekt = { tempo_bpm: 120, loop: null, spuren: [{ id: 's', farbe: '#e0563b', clips: [
    { id: 'c1', art: 'audio', name: 'a', start_beat: 0, laenge_beats: 8, dekodiert: 'laeuft', stumm: true, quelle: { sha256: 'x' } }] }] };
  const bild = (stems) => {
    fills.length = 0;
    arr.bild({ ansicht: neueAnsicht(), projekt, loop: null, kopfBeat: null, startBeat: 0, geist: null, stems });
    return [...fills];
  };
  assert.ok(bild(null).some((f) => f[0] === 'rgba(11,13,17,0.62)'), 'Stumm-Decke');
  assert.equal(bild(null).filter((f) => f[0] === '#2fd6c3' && f[4] === 4).length, 0, 'ohne Stand kein Balken');
  assert.equal(bild(eigen).filter((f) => f[0] === '#2fd6c3' && f[4] === 4).length, 1, 'Balken bei laufendem Stand');
  assert.equal(bild({ ...eigen, clip_id: 'c2' }).filter((f) => f[0] === '#2fd6c3' && f[4] === 4).length, 0);
});

test('S6 F4: stems.js importiert nichts (kein Zyklus mit produktion.js)', async () => {
  const fs = await import('node:fs');
  const q = fs.readFileSync(new URL('../oeffentlich/produktion/stems.js', import.meta.url), 'utf8');
  assert.equal(/^\s*import\b/m.test(q), false);
});
