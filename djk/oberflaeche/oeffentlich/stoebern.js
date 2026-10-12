// Browser über die Mediathek (Plan 2026-10-10-mediathek-browser): reine Teile ohne DOM — Spalten je Typ, URL, Zellen.
// Die Sortierschlüssel müssen zu SORTIERUNG in katalog.ts passen (Test stoebern_seite.test.mjs).
// Lauf, den die Seite in dieser Sitzung beobachtet (mid → 'laeuft' | 'fehler'); schlägt den Listenstand der Status-Spalte, bis die Liste neu geladen wird.
const live = new Map();
export const setzeVorbereitLive = (mid, st) => { if (st) live.set(mid, st); else live.delete(mid); };
export const statusText = (t) => STATUS[live.get(t.material_id) ?? t.status] ?? '?';
export const TYP_TEXT = { track: 'ALL TRACKS', loop: 'LOOPS', oneshot: 'SAMPLES', strudel: 'STRUDEL' };   // oben bleibt der Reiter TRACKS (vorbereitete Fassungen)
const laenge = (s) => (s == null ? '–' : s < 10 ? `${s.toFixed(2)} s` : `${Math.floor(Math.round(s) / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`);
const zahl = (x) => (x == null ? '–' : String(x));
const text = (x) => (x == null || x === '' ? '–' : x);
const STATUS = { ready: 'READY', prepare: 'PREPARE', missing: 'MISSING', laeuft: 'PREPARING…', fehler: 'FAILED' };
const name = (t) => `${t.name ?? '–'}${t.nur_live ? ' · Live only' : ''}`;
export const SPALTEN = {
  track: [
    { titel: 'Title', sort: 'titel', wert: (t) => (t.mix ? `${t.titel ?? '–'} (${t.mix})` : text(t.titel)), klasse: 'titelzelle' },
    { titel: 'Artist', sort: 'kuenstler', wert: (t) => text(t.kuenstler) },
    { titel: 'BPM', sort: 'bpm', wert: (t) => zahl(t.bpm), klasse: 'zahl' },
    { titel: 'Key', sort: 'camelot', wert: (t) => text(t.camelot), klasse: 'zahl' },
    { titel: 'Energy', sort: 'energie', wert: (t) => zahl(t.energie), klasse: 'zahl' },
    { titel: 'Genre', sort: 'genre', wert: (t) => text(t.genre) },
    { titel: 'Length', sort: 'dauer', wert: (t) => laenge(t.dauer_s), klasse: 'zahl' },
    { titel: 'Status', wert: statusText, klasse: 'status' },
  ],
  loop: [
    { titel: 'Name', sort: 'name', wert: name, klasse: 'titelzelle' },
    { titel: 'Pack', sort: 'pack', wert: (t) => text(t.pack) },
    { titel: 'BPM', sort: 'bpm', wert: (t) => zahl(t.bpm), klasse: 'zahl' },
    { titel: 'Bars', sort: 'takte', wert: (t) => zahl(t.takte), klasse: 'zahl' },
    { titel: 'Key', sort: 'camelot', wert: (t) => text(t.camelot), klasse: 'zahl' },
    { titel: 'Folder', sort: 'ordner', wert: (t) => text(t.ordner?.split('/').slice(-2).join('/')) },
  ],
  oneshot: [
    { titel: 'Name', sort: 'name', wert: name, klasse: 'titelzelle' },
    { titel: 'Instrument', sort: 'instrument', wert: (t) => text(t.instrument) },
    { titel: 'Pack', sort: 'pack', wert: (t) => text(t.pack) },
    { titel: 'Length', sort: 'dauer', wert: (t) => laenge(t.dauer_s), klasse: 'zahl' },
  ],
};
const ROLLE_TEXT = { drums: 'DRUMS', bass: 'BASS', melodie: 'MELODY' };
const QUELLE_TEXT = { eigen: 'mine', track: 'track', dirigent: 'archive' };
SPALTEN.strudel = [
  { titel: 'Name', sort: 'name', wert: (t) => `${t.name}${t.ladbar ? '' : ' · archive'}`, klasse: 'titelzelle' },
  { titel: 'Role', sort: 'rolle', wert: (t) => ROLLE_TEXT[t.rolle] ?? '–' },
  { titel: 'Source', sort: 'quelle', wert: (t) => QUELLE_TEXT[t.quelle] ?? '–' },
  { titel: 'BPM', sort: 'bpm', wert: (t) => zahl(t.bpm), klasse: 'zahl' },
  { titel: 'Bars', sort: 'takte', wert: (t) => zahl(t.takte), klasse: 'zahl' },
];
export const zelle = (spalte, t) => spalte.wert(t);

// PREPARING-Anzeige aus dem Stand von GET /mediathek/vorbereiten (Server: Vorbereiter.stand). Alles kommt aus den Meldungen der
// Werkstatt: Stufe, Prozent nur wo ein Werkzeug sie liefert, vergangene Zeit, „no progress for N s“ wenn der Server haengt meldet.
const uhr = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
export function vorbereitText(st) {
  if (!st) return null;
  if (st.status === 'fehler') return `FAILED${st.name ? ` at ${st.name}` : ''}: ${st.grund ?? 'unknown'}`;
  if (st.status !== 'laeuft') return null;
  let t = st.name ? `PREPARING ${st.stufe}/${st.von} ${st.name}${typeof st.prozent === 'number' ? ` ${Math.round(st.prozent)} %` : ''}` : 'PREPARING…';
  if (typeof st.vergangen_s === 'number') t += ` · ${uhr(st.vergangen_s)}`;
  if (st.haengt) t += ` · no progress for ${st.ohne_fortschritt_s} s`;
  return t;
}

// FAILED-Text einer Zeile: die Beobachtung dieser Sitzung zuerst, sonst die /stoebern-Daten (Grund und Stufe vom Server; überlebt F5). null = kein Fehler.
export const fehlerAnzeige = (t, beobachtet) => beobachtet ?? (t.status === 'fehler' ? vorbereitText({ status: 'fehler', grund: t.grund, name: t.grund_stufe }) : null);

// Listen (S2b): Art → Titel im Baum; Zeilentyp → Art der Liste, in die er gehört
export const LISTEN_TEXT = { playlist: 'Playlists', looplist: 'Loop lists', strudellist: 'Strudel lists' };
export const listenArtFuer = (typ) => ({ track: 'playlist', loop: 'looplist', oneshot: 'looplist', strudel: 'strudellist' })[typ];
// Spalten der Listenansicht. Eine LOOP LIST mischt Loops und Samples, darum eine gemeinsame Spalte „Type“ und nur Felder,
// die beide Arten haben; sortiert wird hier nie (die Reihenfolge ist die der Liste).
export const LISTEN_SPALTEN = {
  playlist: SPALTEN.track.map((s) => ({ ...s, sort: undefined })),
  looplist: [
    { titel: 'Name', wert: name, klasse: 'titelzelle' },
    { titel: 'Type', wert: (t) => (t.typ === 'oneshot' ? 'SAMPLE' : 'LOOP') },
    { titel: 'Pack', wert: (t) => text(t.pack) },
    { titel: 'BPM', wert: (t) => zahl(t.bpm), klasse: 'zahl' },
    { titel: 'Bars', wert: (t) => zahl(t.takte), klasse: 'zahl' },
    { titel: 'Key', wert: (t) => text(t.camelot), klasse: 'zahl' },
    { titel: 'Length', wert: (t) => laenge(t.dauer_s), klasse: 'zahl' },
  ],
  strudellist: SPALTEN.strudel.map((s) => ({ ...s, sort: undefined })),
};
// Ziel-Index für POST …/posten/verschieben: id wird VOR vorId eingesetzt (null = ans Ende), gezählt nach dem Herausnehmen
export function neueReihenfolge(ids, id, vorId) {
  const ohne = ids.filter((x) => x !== id);
  const i = vorId === null ? -1 : ohne.indexOf(vorId);
  return i < 0 ? ohne.length : i;
}

// Zustand → URL. Feste Reihenfolge, nur gesetzte Teile (Vorgaben fallen weg).
export function stoebernUrl(z) {
  const p = new URLSearchParams({ typ: z.typ });
  if (z.text && z.text.trim()) p.set('text', z.text.trim());
  if (z.sort) p.set('sort', z.sort);
  if (z.ab) p.set('richtung', 'ab');
  if (z.seite) p.set('seite', String(z.seite));
  if (z.ordner) p.set('ordner', z.ordner);
  if (z.feld) { p.set('feld', z.feld); p.set('wert', z.wert ?? ''); }
  const f = filterFuer(z.typ);   // was der Typ nicht anbietet, geht nie in die URL (auch nicht als vergessener Rest im Zustand)
  if (z.camelot && f.includes('camelot')) { p.set('camelot', z.camelot.trim().toUpperCase()); if (z.nachbarn) p.set('nachbarn', '1'); }
  if (z.bpm && f.includes('bpm')) p.set('bpm', bpmNormal(z.bpm));
  if (z.energie !== undefined && z.energie !== '' && f.includes('energie')) p.set('energie', String(z.energie));
  return `/stoebern?${p}`;
}

// Ordnerliste ({pfad, n}, vollständige Pfade) → Baum. Zähler je Knoten = Summe darunter. Knoten mit genau einem Kind
// und ohne eigene Dateien werden zusammengezogen („HomeLW/01 MP3/Audio"), wie kompakte Ordner in Editoren.
export function baueBaum(ordner) {
  const wurzel = { name: '', pfad: '', n: 0, eigen: 0, kinder: new Map() };
  for (const { pfad, n } of ordner) {
    let k = wurzel; k.n += n;
    let p = '';
    for (const teil of pfad.split('/').filter(Boolean)) {
      p += `/${teil}`;
      if (!k.kinder.has(teil)) k.kinder.set(teil, { name: teil, pfad: p, n: 0, eigen: 0, kinder: new Map() });
      k = k.kinder.get(teil); k.n += n;
    }
    k.eigen += n;
  }
  const fertig = (k) => {
    let x = k;
    while (x.kinder.size === 1 && x.eigen === 0) { const [c] = x.kinder.values(); x = { ...c, name: `${x.name}/${c.name}` }; }
    return { name: x.name, pfad: x.pfad, n: x.n, kinder: [...x.kinder.values()].map(fertig) };
  };
  return [...wurzel.kinder.values()].map(fertig);
}

// Ziel-Index beim Ziehen einer Listenzeile auf eine andere (null = nichts ändern). unten: Maus in der unteren Hälfte der Zielzeile.
// Steht die gezogene Zeile schon dort, wo sie landen würde, ändert sich nichts (sonst vertauschte das Ziehen auf die untere
// Hälfte des Nachbarn darüber die beiden; Review S2b Befund 2).
export function ziehZiel(ids, gezogen, zielId, unten) {
  const von = ids.indexOf(gezogen), ziel = ids.indexOf(zielId);
  if (von < 0 || ziel < 0 || gezogen === zielId) return null;
  const vor = unten ? (ids[ziel + 1] ?? null) : zielId;
  if (vor === gezogen) return null;
  const nach = neueReihenfolge(ids, gezogen, vor);
  return nach === von ? null : nach;
}
// Beschriftung der Posten-Art in der Set-Ansicht
export const postenArtText = (art) => ({ track: 'track', loop: 'loop', oneshot: 'sample', muster: 'pattern' })[art] ?? art;

// Filter je Typ (S3-Concern, Entscheidung 2026-10-10): nur was der Typ wirklich hat. Samples haben weder Key noch BPM noch Energie,
// Muster haben BPM, Loops haben keine Energie. Verborgene Filter werden zurückgesetzt, damit keiner unsichtbar weiterwirkt.
export const FILTER_FUER = { track: ['camelot', 'bpm', 'energie'], loop: ['camelot', 'bpm'], oneshot: [], strudel: ['bpm'] };
export const filterFuer = (typ) => FILTER_FUER[typ] ?? [];
export function filterBereinigt(typ, z) {
  const ok = filterFuer(typ), leer = { camelot: '', nachbarn: false, bpm: '', energie: '' };
  const aus = { ...z };
  for (const k of Object.keys(leer)) if (!ok.includes(k === 'nachbarn' ? 'camelot' : k)) aus[k] = leer[k];
  return aus;
}

// BPM-Eingabe → Server-Form „a“ oder „a-b“ (S3-Review B2). Früher fielen die Leerzeichen weg: aus „124 130“ wurde „124130“, still null Treffer.
// Trenner zwischen zwei Zahlen: Bindestrich (auch –, —), Semikolon, Leerzeichen, oder ein Komma, dem genau drei Ziffern folgen („128,130“;
// „128,5“ und „128,50“ bleiben Dezimalkomma). Was nicht passt, geht unverändert an den Server und kommt als sichtbares bpm_ungueltig zurück.
export function bpmNormal(roh) {
  const t = String(roh).trim();
  const zahl = '\\d+(?:[.,]\\d+)?';
  const bereich = new RegExp(`^(${zahl})\\s*(?:[-–—;]|\\s)\\s*(${zahl})$`).exec(t);
  if (bereich) return `${bereich[1]}-${bereich[2]}`;
  const komma = /^(\d+),(\d{3})$/.exec(t);
  if (komma) return `${komma[1]}-${komma[2]}`;
  return /^\d+(?:[.,]\d+)?(?:-\d+(?:[.,]\d+)?)?$/.test(t) || !/\s/.test(t) ? t : roh;
}

// ---------- Detail-Spalte (S5) ----------
// Angaben-Felder der Mediathek (deutsche Schlüssel) → Beschriftung
const FELD_TEXT = { titel: 'Title', kuenstler: 'Artist', mix: 'Mix', bpm: 'BPM', camelot: 'Key', energie: 'Energy', genre: 'Genre', label: 'Label',
  release: 'Release', katalognummer: 'Catalog no.', isrc: 'ISRC', remixer: 'Remixer', jahr: 'Year', pack: 'Pack', instrument: 'Instrument',
  kategorie: 'Category', typ: 'Type', schutz: 'Protection', takte: 'Bars', stimmung_cent: 'Tuning (cent)', lufs: 'LUFS', sterne: 'Stars' };
export const feldText = (f) => FELD_TEXT[f] ?? f;
// Fakten oben im Detail, je Typ nur was der Typ hat. „Folder“ ist der VOLLE Pfad (die Liste kürzt auf zwei Teile): so sind die
// zehn Samples „1 F1“ zu unterscheiden. Alles kommt aus der Trefferzeile, das Detail braucht dafür keine Anfrage.
export function detailFakten(t) {
  if (t.typ === 'strudel') return [['Role', ROLLE_TEXT[t.rolle] ?? '–'], ['Source', QUELLE_TEXT[t.quelle] ?? '–'], ['BPM', zahl(t.bpm)], ['Bars', zahl(t.takte)]];
  const ordner = ['Folder', text(t.ordner)];
  if (t.typ === 'track') return [['BPM', zahl(t.bpm)], ['Key', text(t.camelot)], ['Energy', zahl(t.energie)], ['Genre', text(t.genre)], ['Length', laenge(t.dauer_s)], ordner];
  if (t.typ === 'loop') return [['Pack', text(t.pack)], ['BPM', zahl(t.bpm)], ['Bars', zahl(t.takte)], ['Key', text(t.camelot)], ['Length', laenge(t.dauer_s)], ordner];
  return [['Instrument', text(t.instrument)], ['Pack', text(t.pack)], ['Length', laenge(t.dauer_s)], ordner];
}
// Die Seite fordert eine Welle nur an, wenn sie gelingen kann: weder für Ableton-geschützte Dateien (ffmpeg 422) noch ohne Datei (404).
export function welleStatus(t) {
  if (t.typ === 'strudel') return { anfordern: false, grund: null };
  if (t.nur_live) return { anfordern: false, grund: 'Live only: Ableton-protected, no waveform' };
  if (!t.pfad_da) return { anfordern: false, grund: 'File not found (drive unplugged?)' };
  return { anfordern: true, grund: null };
}
// Welche Aktionen das Detail (und die Zeile) anbietet: Loops bekommen „→ L1/L2“ (S6), One-Shots nie (die Box nimmt nur Loops).
export function aktionenFuer(t) {
  const vorn = t.typ === 'track' ? ['track'] : t.typ === 'strudel' ? [t.ladbar ? 'editor' : 'kopieren'] : t.typ === 'loop' ? ['loopbox'] : [];
  return [...vorn, 'set', 'liste'];
}
// „→ L1/L2“ (S6): aktiv nur, wenn der Import gelingen kann. Die Gründe kommen vom Server (import_grund, gleiche Regel wie der Import),
// die Seite rechnet nichts nach. nur_live: kein aktiver Knopf, der Grund steht sichtbar da. Sonst bleiben die Knöpfe deaktiviert
// und der Grund steht im Tooltip (und kurz daneben, wenn er nicht schon aus der Zeile klar ist).
const IMPORT_GRUND = {
  bpm_unbekannt: ['No BPM', 'No BPM in the catalog: the loop cannot be stretched to 128 BPM'],
  takte_unklar: ['Length unclear', 'Length is not 1, 2, 4, 8, 16 or 32 beats at the given tempo'],
  zu_lang: ['Over 8 bars', 'Longer than 8 bars (32 beats): the loop box takes no more'],
};
export const IMPORT_FEHLER_TEXT = { ...Object.fromEntries(Object.entries(IMPORT_GRUND).map(([k, v]) => [k, v[1]])),
  nur_live: 'Ableton Live only', unbekannt: 'not in the catalog (rebuild it with “mediathek katalog”)', kein_loop: 'this is not a loop', name_vergeben: 'a loop with that name already exists', sha_ungueltig: 'invalid file id', datei_fehlt: 'file not found', import_laeuft: 'another import is running, try again in a moment',
  zeitlimit: 'the import took too long and was stopped', dekodierung: 'the file could not be decoded', dehnung: 'the stretch failed' };
export function loopBoxStatus(t) {
  if (t.nur_live) return { aktiv: false, grund: 'Live only', titel: 'Ableton Live only: protected, cannot be loaded here' };
  if (!t.pfad_da) return { aktiv: false, grund: null, titel: 'File not found' };
  if (t.import_grund) { const [kurz, lang] = IMPORT_GRUND[t.import_grund] ?? [t.import_grund, t.import_grund]; return { aktiv: false, grund: kurz, titel: lang }; }
  return { aktiv: true, grund: null, titel: 'Stretch to 128 BPM and load into the loop box' };
}

// Vorhören (S7-Re-Review F1): ↓ lenkt um, wenn schon etwas läuft ODER noch lädt (wartet = ID der Anfrage in der Luft)
export function vorhoerFolgt(t, idNeu, { wartet, hoert }) {
  const aktiv = wartet ?? hoert;
  return !!aktiv && aktiv !== idNeu && t.typ !== 'strudel';
}
// F4: Cursor-Frame in der Detail-Welle. Der Vorhörer dekodiert höchstens 30 min (gekuerzt), die Welle zeigt die ganze Datei:
// dann zählen echte Sekunden gegen die Wellenlänge, nicht der Anteil an der gekürzten Dauer.
export function vorhoerCursor(s, gesamtFrames, sr) {
  return s.gekuerzt ? s.s * sr : (s.s / s.dauer_s) * gesamtFrames;
}
