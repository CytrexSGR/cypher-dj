// Reine Teile des Browsers (oeffentlich/stoebern.js): Spalten je Typ, URL, Zellen-Text. Kein DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SPALTEN, stoebernUrl, zelle, TYP_TEXT, baueBaum, detailFakten, welleStatus, feldText, aktionenFuer, loopBoxStatus, IMPORT_FEHLER_TEXT } from '../oeffentlich/stoebern.js';

test('SPALTEN: je Typ die Spalten aus der Spec, sortierbare Schlüssel wie der Server', () => {
  assert.deepEqual(SPALTEN.track.map((s) => s.titel), ['Title', 'Artist', 'BPM', 'Key', 'Energy', 'Genre', 'Length', 'Status']);
  assert.deepEqual(SPALTEN.loop.map((s) => s.titel), ['Name', 'Pack', 'BPM', 'Bars', 'Key', 'Folder']);
  assert.deepEqual(SPALTEN.oneshot.map((s) => s.titel), ['Name', 'Instrument', 'Pack', 'Length']);
  assert.deepEqual(SPALTEN.track.filter((s) => s.sort).map((s) => s.sort), ['titel', 'kuenstler', 'bpm', 'camelot', 'energie', 'genre', 'dauer']);
  assert.deepEqual(SPALTEN.oneshot.filter((s) => s.sort).map((s) => s.sort), ['name', 'instrument', 'pack', 'dauer']);
  assert.deepEqual(TYP_TEXT, { track: 'ALL TRACKS', loop: 'LOOPS', oneshot: 'SAMPLES', strudel: 'STRUDEL' });
});

test('stoebernUrl: nur gesetzte Teile, Reihenfolge fest', () => {
  assert.equal(stoebernUrl({ typ: 'loop', sort: 'bpm', ab: true, seite: 2 }), '/stoebern?typ=loop&sort=bpm&richtung=ab&seite=2');
  assert.equal(stoebernUrl({ typ: 'track' }), '/stoebern?typ=track');
  assert.equal(stoebernUrl({ typ: 'oneshot', seite: 0, ab: false }), '/stoebern?typ=oneshot');
});

test('zelle: Zahlen, Länge, Bars aus takte, fehlend als –, Titel mit Mix', () => {
  const s = (typ, titel) => SPALTEN[typ].find((x) => x.titel === titel);
  assert.equal(zelle(s('track', 'Title'), { titel: 'Wolf', mix: 'Extended Mix' }), 'Wolf (Extended Mix)');
  assert.equal(zelle(s('track', 'BPM'), { bpm: 127.5 }), '127.5');
  assert.equal(zelle(s('track', 'BPM'), { bpm: null }), '–');
  assert.equal(zelle(s('track', 'Length'), { dauer_s: 305 }), '5:05');
  assert.equal(zelle(s('loop', 'Bars'), { takte: 2 }), '2');
  assert.equal(zelle(s('oneshot', 'Length'), { dauer_s: 0.43 }), '0.43 s', 'kurze Klänge in Sekunden');
  assert.equal(zelle(s('track', 'Status'), { status: 'prepare' }), 'PREPARE');
  assert.equal(zelle(s('loop', 'Name'), { name: 'DT_126', nur_live: true }), 'DT_126 · Live only');
});

test('zelle: Länge rundet erst auf ganze Sekunden, nie „1:60" (Review MINOR 3)', () => {
  const l = SPALTEN.track.find((x) => x.titel === 'Length');
  assert.equal(zelle(l, { dauer_s: 119.6 }), '2:00');
  assert.equal(zelle(l, { dauer_s: 59.6 }), '1:00');
  assert.equal(zelle(l, { dauer_s: 305 }), '5:05');
  assert.equal(zelle(l, { dauer_s: 10.4 }), '0:10');
});

test('baueBaum: Ordner zu Baum, Zähler aufsummiert, Ketten mit einem Kind zusammengezogen', () => {
  const b = baueBaum([{ pfad: '/m/HomeLW/01 MP3/Audio/Loops/A', n: 3 }, { pfad: '/m/HomeLW/01 MP3/Audio/Loops/B', n: 2 }, { pfad: '/m/disk2/X', n: 1 }]);
  assert.deepEqual(b.map((k) => [k.name, k.n]), [['m', 6]]);
  const m = b[0].kinder;
  assert.deepEqual(m.map((k) => [k.name, k.n, k.pfad]), [['HomeLW/01 MP3/Audio/Loops', 5, '/m/HomeLW/01 MP3/Audio/Loops'], ['disk2/X', 1, '/m/disk2/X']]);
  assert.deepEqual(m[0].kinder.map((k) => [k.name, k.n, k.pfad]), [['A', 3, '/m/HomeLW/01 MP3/Audio/Loops/A'], ['B', 2, '/m/HomeLW/01 MP3/Audio/Loops/B']]);
  assert.deepEqual(baueBaum([]), []);
});

test('stoebernUrl: Ordner und Facette (leerer Wert bleibt in der URL)', () => {
  assert.equal(stoebernUrl({ typ: 'oneshot', feld: 'instrument', wert: '' }), '/stoebern?typ=oneshot&feld=instrument&wert=');
  assert.equal(stoebernUrl({ typ: 'loop', ordner: '/m/A B' }), '/stoebern?typ=loop&ordner=%2Fm%2FA+B');
});

import { LISTEN_TEXT, listenArtFuer, neueReihenfolge } from '../oeffentlich/stoebern.js';
test('STRUDEL-Spalten, Listen-Arten je Zeilentyp, Reihenfolge nach Ziehen', () => {
  assert.equal(TYP_TEXT.strudel, 'STRUDEL');
  assert.deepEqual(SPALTEN.strudel.map((s) => s.titel), ['Name', 'Role', 'Source', 'BPM', 'Bars']);
  assert.deepEqual(LISTEN_TEXT, { playlist: 'Playlists', looplist: 'Loop lists', strudellist: 'Strudel lists' });
  assert.deepEqual(['track', 'loop', 'oneshot', 'strudel'].map(listenArtFuer), ['playlist', 'looplist', 'looplist', 'strudellist']);
  assert.equal(neueReihenfolge(['p1', 'p2', 'p3', 'p4'], 'p4', 'p2'), 1, 'p4 vor p2 gezogen → Index 1');
  assert.equal(neueReihenfolge(['p1', 'p2', 'p3'], 'p1', 'p3'), 1, 'nach unten: Index nach dem Herausnehmen');
  assert.equal(neueReihenfolge(['p1', 'p2'], 'p1', null), 1, 'ans Ende');
});

test('stoebernUrl: Key, Nachbarn, BPM, Energie', () => {
  assert.equal(stoebernUrl({ typ: 'track', camelot: '8a', nachbarn: true, bpm: '124 - 130', energie: '2' }),
    '/stoebern?typ=track&camelot=8A&nachbarn=1&bpm=124-130&energie=2');
  assert.equal(stoebernUrl({ typ: 'track', camelot: '', bpm: '', energie: '' }), '/stoebern?typ=track');
});

// Review B5: die Bedingung `x.eigen === 0` in baueBaum. Ein Ordner mit eigenen Dateien UND genau einem Unterordner darf nicht
// mit ihm zusammengezogen werden, sonst wären seine eigenen Dateien über keinen Knoten erreichbar und der Zähler gehörte dem Kind.
test('baueBaum: Ordner mit eigenen Dateien und genau einem Unterordner wird nicht zusammengezogen (Review B5)', () => {
  const b = baueBaum([{ pfad: '/m/A', n: 2 }, { pfad: '/m/A/B', n: 1 }]);
  assert.deepEqual(b.map((k) => [k.name, k.pfad, k.n]), [['m/A', '/m/A', 3]], 'm hat nur ein Kind ohne eigene Dateien → m/A, A selbst bleibt');
  assert.deepEqual(b[0].kinder.map((k) => [k.name, k.pfad, k.n]), [['B', '/m/A/B', 1]], 'B bleibt ein Kind von A');
  // Gegenprobe: ohne eigene Dateien zieht dieselbe Form zusammen
  assert.deepEqual(baueBaum([{ pfad: '/m/A/B', n: 1 }]).map((k) => [k.name, k.pfad, k.n, k.kinder.length]), [['m/A/B', '/m/A/B', 1, 0]]);
});

import { ziehZiel, postenArtText } from '../oeffentlich/stoebern.js';
test('ziehZiel: Ziehen auf die untere Hälfte des Nachbarn darüber ändert nichts, sonst der richtige Index (Review S2b Befund 2)', () => {
  const ids = ['p1', 'p2', 'p3'];
  assert.equal(ziehZiel(ids, 'p3', 'p2', true), null, 'p3 steht schon hinter p2: keine Änderung (gemessen: vertauschte vorher)');
  assert.equal(ziehZiel(ids, 'p1', 'p2', true), 1, 'Gegenprobe: p1 hinter p2 → Index 1');
  assert.equal(ziehZiel(ids, 'p3', 'p1', false), 0, 'p3 vor p1');
  assert.equal(ziehZiel(ids, 'p1', 'p3', true), 2, 'p1 hinter die letzte Zeile → ans Ende');
  assert.equal(ziehZiel(ids, 'p2', 'p3', false), null, 'p2 vor p3: steht schon so');
  assert.equal(ziehZiel(ids, 'p2', 'p2', true), null, 'auf sich selbst');
  assert.equal(ziehZiel(ids, 'p2', 'p2', false), null, 'auf sich selbst, obere Hälfte');
  assert.equal(ziehZiel(ids, 'p9', 'p1', false), null, 'unbekannte id');
});
test('postenArtText: ein Muster im Set heißt pattern, nicht sample (Review S2b Befund 5)', () => {
  assert.deepEqual(['track', 'loop', 'oneshot', 'muster'].map(postenArtText), ['track', 'loop', 'sample', 'pattern']);
});

import { filterFuer, filterBereinigt } from '../oeffentlich/stoebern.js';
test('Filter je Typ: Samples keiner, Strudel nur BPM, Loops ohne Energie; Verborgenes wird zurückgesetzt und nie gesendet (S3-Concern)', () => {
  assert.deepEqual(['track', 'loop', 'oneshot', 'strudel'].map((t) => filterFuer(t)), [['camelot', 'bpm', 'energie'], ['camelot', 'bpm'], [], ['bpm']]);
  const voll = { camelot: '8A', nachbarn: true, bpm: '124-130', energie: '2', sort: 'bpm' };
  assert.deepEqual(filterBereinigt('track', voll), voll, 'Tracks behalten alles');
  assert.deepEqual(filterBereinigt('loop', voll), { camelot: '8A', nachbarn: true, bpm: '124-130', energie: '', sort: 'bpm' }, 'Loops: Energie weg');
  assert.deepEqual(filterBereinigt('oneshot', voll), { camelot: '', nachbarn: false, bpm: '', energie: '', sort: 'bpm' }, 'Samples: alles weg, Rest bleibt');
  assert.deepEqual(filterBereinigt('strudel', voll), { camelot: '', nachbarn: false, bpm: '124-130', energie: '', sort: 'bpm' }, 'Strudel: nur BPM bleibt');
  // Gürtel und Hosenträger: selbst ein vergessener Rest im Zustand geht nie in die URL
  assert.equal(stoebernUrl({ typ: 'oneshot', ...voll }), '/stoebern?typ=oneshot&sort=bpm');
  assert.equal(stoebernUrl({ typ: 'strudel', ...voll }), '/stoebern?typ=strudel&sort=bpm&bpm=124-130');
  assert.equal(stoebernUrl({ typ: 'loop', ...voll }), '/stoebern?typ=loop&sort=bpm&camelot=8A&nachbarn=1&bpm=124-130');
});

import { bpmNormal } from '../oeffentlich/stoebern.js';
test('bpmNormal: Leerzeichen und Komma als Trenner werden zum Bereich, Dezimalkomma bleibt, Unsinn bleibt Unsinn (S3-Review B2)', () => {
  const g = [['124-130', '124-130'], ['124 - 130', '124-130'], ['124 130', '124-130'], ['124–130', '124-130'], ['128,130', '128-130'], ['128;130', '128-130'],
    ['128,5', '128,5'], ['128,50', '128,50'], ['128.5', '128.5'], ['  128 ', '128'], ['124,5-130,5', '124,5-130,5'], ['124.5 130.5', '124.5-130.5']];
  for (const [ein, aus] of g) assert.equal(bpmNormal(ein), aus, `${JSON.stringify(ein)} → ${aus}`);
  assert.equal(bpmNormal('abc'), 'abc', 'Unsinn geht unverändert an den Server (400 bpm_ungueltig, sichtbar)');
  assert.equal(bpmNormal('124 abc'), '124 abc');
  assert.equal(stoebernUrl({ typ: 'track', bpm: '124 130' }), '/stoebern?typ=track&bpm=124-130', 'die URL nimmt die normalisierte Form (früher: „124130“, still 0 Treffer)');
});

test('stoebernUrl: text zuerst nach typ, getrimmt', () => {
  assert.equal(stoebernUrl({ typ: 'oneshot', text: '  kick hard ', seite: 1 }), '/stoebern?typ=oneshot&text=kick+hard&seite=1');
});
test('stoebernUrl: Feld-Präfixe werden kodiert; leerer oder blanker Text fällt weg; text gilt für jeden Typ (auch strudel)', () => {
  assert.equal(stoebernUrl({ typ: 'track', text: 'label:drumcode artist:"a b"' }), '/stoebern?typ=track&text=label%3Adrumcode+artist%3A%22a+b%22');
  assert.equal(stoebernUrl({ typ: 'track', text: '   ' }), '/stoebern?typ=track');
  assert.equal(stoebernUrl({ typ: 'track', text: '' }), '/stoebern?typ=track');
  assert.equal(stoebernUrl({ typ: 'strudel', text: 'bd' }), '/stoebern?typ=strudel&text=bd');
});

// ---- S5 Task 5.4: reine Teile der Detail-Spalte ----
const sample = (o) => ({ typ: 'oneshot', name: '1 F1', pack: 'Pack A', dauer_s: 0.5, ordner: '/musik/Kits/A/Drums', pfad_da: true, nur_live: false, ...o });

test('detailFakten: gleichnamige Samples sind an Ordner, Pack und Länge zu unterscheiden (voller Ordnerpfad, nicht gekürzt)', () => {
  const a = detailFakten(sample({})), b = detailFakten(sample({ pack: 'Pack B', dauer_s: 1.25, ordner: '/musik/Kits/B/Drums' }));
  const wert = (f, k) => f.find(([l]) => l === k)?.[1];
  assert.equal(wert(a, 'Folder'), '/musik/Kits/A/Drums', 'der ganze Pfad, nicht die letzten zwei Teile wie in der Liste');
  assert.deepEqual([wert(a, 'Pack'), wert(a, 'Length')], ['Pack A', '0.50 s']);
  assert.deepEqual([wert(b, 'Pack'), wert(b, 'Length'), wert(b, 'Folder')], ['Pack B', '1.25 s', '/musik/Kits/B/Drums']);
  assert.notDeepEqual(a, b);
});

test('detailFakten: je Typ nur die Felder, die der Typ hat; Strudel mit Rolle und Quelle', () => {
  const namen = (t) => detailFakten(t).map(([l]) => l);
  assert.deepEqual(namen(sample({})), ['Instrument', 'Pack', 'Length', 'Folder']);
  assert.deepEqual(namen({ typ: 'loop', name: 'x', pack: 'p', bpm: 128, takte: 4, camelot: '8A', dauer_s: 7.5, ordner: '/o' }), ['Pack', 'BPM', 'Bars', 'Key', 'Length', 'Folder']);
  assert.deepEqual(namen({ typ: 'track', titel: 't', bpm: 126, camelot: '8A', energie: 7, genre: 'Techno', dauer_s: 300, ordner: '/o' }), ['BPM', 'Key', 'Energy', 'Genre', 'Length', 'Folder']);
  const m = detailFakten({ typ: 'strudel', name: 'a', quelle: 'dirigent', rolle: 'melodie', bpm: 124, takte: 8, text: 's("bd")', ladbar: false });
  assert.deepEqual(m, [['Role', 'MELODY'], ['Source', 'archive'], ['BPM', '124'], ['Bars', '8']]);
  assert.deepEqual(detailFakten({ typ: 'strudel', name: 'b', quelle: 'eigen', rolle: null, bpm: null, takte: null }), [['Role', '–'], ['Source', 'mine'], ['BPM', '–'], ['Bars', '–']]);
  assert.equal(detailFakten(sample({ ordner: null })).find(([l]) => l === 'Folder')[1], '–', 'ohne Ordner kein Absturz');
});

test('welleStatus: Welle nur anfordern, wenn sie gelingen kann; sonst der Grund als Text', () => {
  assert.deepEqual(welleStatus(sample({})), { anfordern: true, grund: null });
  assert.deepEqual(welleStatus(sample({ nur_live: true, pfad_da: false })), { anfordern: false, grund: 'Live only: Ableton-protected, no waveform' });
  assert.deepEqual(welleStatus(sample({ pfad_da: false })), { anfordern: false, grund: 'File not found (drive unplugged?)' });
  assert.deepEqual(welleStatus({ typ: 'strudel', name: 'x' }), { anfordern: false, grund: null }, 'Muster haben keine Welle und brauchen keinen Grund');
});

test('feldText: bekannte Felder englisch, unbekannte unverändert', () => {
  assert.deepEqual(['titel', 'kuenstler', 'camelot', 'energie', 'katalognummer', 'exotisch'].map(feldText), ['Title', 'Artist', 'Key', 'Energy', 'Catalog no.', 'exotisch']);
});

test('aktionenFuer: Loop → Loop-Box-Knöpfe (S6), Sample nie; Strudel ladbar → Editoren, Archiv → COPY', () => {
  assert.deepEqual(aktionenFuer({ typ: 'track' }), ['track', 'set', 'liste']);
  assert.deepEqual(aktionenFuer({ typ: 'loop' }), ['loopbox', 'set', 'liste']);
  assert.deepEqual(aktionenFuer({ typ: 'oneshot' }), ['set', 'liste'], 'ein One-Shot ist kein Loop: kein → L1/L2');
  assert.deepEqual(aktionenFuer({ typ: 'strudel', ladbar: true }), ['editor', 'set', 'liste']);
  assert.deepEqual(aktionenFuer({ typ: 'strudel', ladbar: false }), ['kopieren', 'set', 'liste']);
});

test('loopBoxStatus: aktiv nur mit Datei, ohne Ableton-Schutz und ohne Import-Grund; jeder Grund ist lesbar', () => {
  const gut = { typ: 'loop', pfad_da: true, nur_live: false, import_beats: 4 };
  assert.deepEqual(loopBoxStatus(gut), { aktiv: true, grund: null, titel: 'Stretch to 128 BPM and load into the loop box' });
  // Ableton-geschützt: kein aktiver Knopf, der Grund steht sichtbar da — auch wenn Datei und Beats stimmen würden
  const live = loopBoxStatus({ ...gut, nur_live: true });
  assert.deepEqual([live.aktiv, live.grund], [false, 'Live only']);
  assert.deepEqual(loopBoxStatus({ ...gut, pfad_da: false }), { aktiv: false, grund: null, titel: 'File not found' });
  for (const [g, kurz] of [['bpm_unbekannt', 'No BPM'], ['takte_unklar', 'Length unclear'], ['zu_lang', 'Over 8 bars']]) {
    const s = loopBoxStatus({ ...gut, import_beats: undefined, import_grund: g });
    assert.deepEqual([s.aktiv, s.grund], [false, kurz], g);
    assert.ok(s.titel.length > kurz.length, `Tooltip erklärt ${g}: ${s.titel}`);
  }
  assert.equal(loopBoxStatus({ ...gut, import_beats: undefined, import_grund: 'neu_erfunden' }).grund, 'neu_erfunden', 'unbekannter Grund wird gezeigt, nicht verschluckt');
  // Listenzeile ohne Katalogeintrag (Stub): weder Datei noch Beats → deaktiviert, nicht still aktiv
  assert.equal(loopBoxStatus({ typ: 'loop', pfad_da: false, nur_live: false, name: null }).aktiv, false);
});

test('IMPORT_FEHLER_TEXT: jeder Fehlercode der Route hat englischen Klartext (kein roher Code in der Meldung)', () => {
  for (const c of ['unbekannt', 'kein_loop', 'nur_live', 'datei_fehlt', 'bpm_unbekannt', 'takte_unklar', 'zu_lang', 'import_laeuft', 'zeitlimit', 'dekodierung', 'dehnung', 'name_vergeben', 'sha_ungueltig']) {
    assert.ok(/^[A-Za-z]/.test(IMPORT_FEHLER_TEXT[c] ?? ''), c);
    assert.ok(!/_/.test(IMPORT_FEHLER_TEXT[c]), `${c}: Klartext statt Code: ${IMPORT_FEHLER_TEXT[c]}`);
  }
});

// S7-Re-Review F1/F4: reine Teile des Vorhörens
import { vorhoerFolgt, vorhoerCursor } from '../oeffentlich/stoebern.js';
test('F1 vorhoerFolgt: ↓ während die Anfrage noch lädt (stz.hoert noch leer) lenkt um; sonst nicht', () => {
  assert.equal(vorhoerFolgt({ typ: 'track' }, 'y', { wartet: 'x', hoert: null }), true, 'X lädt noch, Y gewählt: Y vorhören');
  assert.equal(vorhoerFolgt({ typ: 'track' }, 'y', { wartet: null, hoert: 'x' }), true, 'X spielt, Y gewählt');
  assert.equal(vorhoerFolgt({ typ: 'track' }, 'x', { wartet: 'x', hoert: null }), false, 'dieselbe Zeile');
  assert.equal(vorhoerFolgt({ typ: 'track' }, 'y', { wartet: null, hoert: null }), false, 'nichts läuft: ↓ startet nichts');
  assert.equal(vorhoerFolgt({ typ: 'strudel' }, 'y', { wartet: 'x', hoert: null }), false, 'Muster nie');
});
test('F4 vorhoerCursor: ungekürzt s/dauer, gekürzt s in echten Sekunden gegen die ganze Welle', () => {
  const SR = 48000, frames = SR * 19037;                         // 5,3-h-Track, die Welle zeigt alles
  assert.equal(vorhoerCursor({ s: 100, dauer_s: 200 }, 1000, SR), 500, 'ungekürzt: Anteil');
  const c = vorhoerCursor({ s: 450, dauer_s: 1800, gekuerzt: true }, frames, SR);
  assert.equal(c, 450 * SR, 'gekürzt: 450 s von 19037 s, nicht 25 % der Welle');
  assert.ok(c / frames < 0.025);
});

// ---- PREPARING-Anzeige (Fortschritt aus GET /mediathek/vorbereiten) ----
import { vorbereitText } from '../oeffentlich/stoebern.js';

test('vorbereitText: Stufe, Name, Prozent und Zeit', () => {
  assert.equal(vorbereitText({ status: 'laeuft', stufe: 2, von: 5, name: 'beats', prozent: 40, vergangen_s: 83, ohne_fortschritt_s: 3, haengt: false }), 'PREPARING 2/5 beats 40 % · 1:23');
  assert.equal(vorbereitText({ status: 'laeuft', stufe: 4, von: 5, name: 'render', prozent: 12.5, vergangen_s: 7, ohne_fortschritt_s: 0, haengt: false }), 'PREPARING 4/5 render 13 % · 0:07', 'Prozent gerundet');
});

test('vorbereitText: ohne Prozent steht keine Zahl da (nichts geschätzt); vor der ersten Meldung nur die Zeit', () => {
  assert.equal(vorbereitText({ status: 'laeuft', stufe: 2, von: 5, name: 'beats', prozent: null, teil: 'tracking', vergangen_s: 30, ohne_fortschritt_s: 2, haengt: false }), 'PREPARING 2/5 beats · 0:30');
  assert.equal(vorbereitText({ status: 'laeuft', vergangen_s: 5, ohne_fortschritt_s: 5, haengt: false }), 'PREPARING… · 0:05');
  assert.equal(vorbereitText({ status: 'laeuft' }), 'PREPARING…', 'älterer Server ohne Felder: wie bisher');
});

test('vorbereitText: hängt → no progress for N s, auch vor der ersten Meldung; Zeit über eine Stunde', () => {
  assert.equal(vorbereitText({ status: 'laeuft', stufe: 2, von: 5, name: 'beats', prozent: null, vergangen_s: 140, ohne_fortschritt_s: 75, haengt: true }), 'PREPARING 2/5 beats · 2:20 · no progress for 75 s');
  assert.equal(vorbereitText({ status: 'laeuft', vergangen_s: 61, ohne_fortschritt_s: 61, haengt: true }), 'PREPARING… · 1:01 · no progress for 61 s');
  assert.equal(vorbereitText({ status: 'laeuft', stufe: 1, von: 5, name: 'decode', vergangen_s: 3725, ohne_fortschritt_s: 3725, haengt: true }), 'PREPARING 1/5 decode · 62:05 · no progress for 3725 s');
});

test('vorbereitText: FAILED mit Grund, mit der Stufe wenn bekannt (Negativkontrolle: laufend zeigt nie FAILED)', () => {
  assert.equal(vorbereitText({ status: 'fehler', grund: 'ValueError: kaputt', stufe: 1, von: 5, name: 'decode' }), 'FAILED at decode: ValueError: kaputt');
  assert.equal(vorbereitText({ status: 'fehler', grund: 'zeitlimit' }), 'FAILED: zeitlimit');
  assert.equal(vorbereitText({ status: 'fehler' }), 'FAILED: unknown');
  assert.doesNotMatch(vorbereitText({ status: 'laeuft', haengt: true, vergangen_s: 99, ohne_fortschritt_s: 99 }), /FAILED/);
});

test('vorbereitText: andere Stände geben null (nichts anzuzeigen)', () => {
  assert.equal(vorbereitText({ status: 'neu' }), null);
  assert.equal(vorbereitText({ status: 'vorhanden' }), null);
  assert.equal(vorbereitText(null), null);
});

import { statusText, setzeVorbereitLive } from '../oeffentlich/stoebern.js';
test('Status-Spalte: Listenstand, aber ein beobachteter Lauf schlägt ihn (PREPARING… / FAILED statt PREPARE); danach wieder der Listenstand', () => {
  const t = { material_id: 'm-status', status: 'prepare' };
  assert.equal(statusText(t), 'PREPARE');
  assert.equal(zelle(SPALTEN.track.find((s) => s.titel === 'Status'), t), 'PREPARE');
  setzeVorbereitLive('m-status', 'laeuft');
  assert.equal(statusText(t), 'PREPARING…');
  assert.equal(zelle(SPALTEN.track.find((s) => s.titel === 'Status'), t), 'PREPARING…');
  setzeVorbereitLive('m-status', 'fehler');
  assert.equal(statusText(t), 'FAILED');
  setzeVorbereitLive('m-status', null);
  assert.equal(statusText(t), 'PREPARE');
  assert.equal(statusText({ material_id: 'andere', status: 'fehler' }), 'FAILED', 'Negativ: andere Tracks bleiben unberührt');
});

import { fehlerAnzeige } from '../oeffentlich/stoebern.js';
test('m2: FAILED-Grund nach F5 aus den /stoebern-Daten (Grund + Stufe); Beobachtung der Sitzung schlägt ihn; ohne Fehler null', () => {
  const t = { material_id: 'm-f', status: 'fehler', grund: 'ValueError: Karte reicht ueber das Dateiende', grund_stufe: 'render' };
  assert.equal(fehlerAnzeige(t, undefined), 'FAILED at render: ValueError: Karte reicht ueber das Dateiende');
  assert.equal(fehlerAnzeige({ ...t, grund_stufe: undefined }, undefined), 'FAILED: ValueError: Karte reicht ueber das Dateiende');
  assert.equal(fehlerAnzeige(t, 'FAILED at decode: x'), 'FAILED at decode: x');
  assert.equal(fehlerAnzeige({ material_id: 'm-g', status: 'prepare' }, undefined), null, 'Negativ: kein Fehler, kein Text');
});
