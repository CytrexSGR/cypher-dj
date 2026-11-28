// Moved unchanged out of hand.ts: the library, set and instrument tools of the tool table.
import path from 'node:path';
import { type Json, instrumenteLaden, http, deck, ab, type Werkzeug } from './hand_core.ts';

export const WERKZEUGE_BIBLIOTHEK: Werkzeug[] = [
  { name: 'bibliothek', description: 'Search the whole media library (tracks only): text (title, artist, mix), camelot key, bpm range "124-130", genre. Each hit: material_id, title, artist, bpm, key, genre, length, pfad_da (file reachable), im_bestand (ready to load). Not ready: use vorbereiten.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' }, camelot: { type: 'string' }, bpm: { type: 'string', pattern: '^\\d+-\\d+$' }, genre: { type: 'string' }, max: { type: 'integer', minimum: 1, maximum: 200 } } },
    lauf: (p) => {
      const q = new URLSearchParams();
      for (const k of ['text', 'camelot', 'bpm', 'genre'] as const) if (p[k] !== undefined) q.set(k, String(p[k]));
      q.set('limit', String(p.max ?? 20));
      return http('GET', `/mediathek?${q}`);
    } },
  { name: 'anschluss', description: 'Which library tracks fit after the running one? Give deck (1|2) or material_id. Ranked by tempo (within ±6 % by default), genre, Camelot move (same, neighbour, parallel, diagonal both ways, boost +2, lower -2; semitone only with energie=heben and a rising energy class; opposite key never) and energy class (low ≤5, mid 6-7, high ≥8). Unknown tempo (missing or ≤ 0), unknown key or an uncertain key (from a weak source such as Traktor) does not exclude a track, it only scores low. energie: halten (default), heben, senken. Each hit has punkte, zug and gruende, plus material_id and im_bestand as in bibliothek.',
    inputSchema: { type: 'object', properties: { deck: { type: 'integer', enum: [1, 2] }, material_id: { type: 'string', pattern: '^[0-9a-f]{16}$' },
      energie: { type: 'string', enum: ['halten', 'heben', 'senken'] }, fenster: { type: 'number', minimum: 1, maximum: 16 }, max: { type: 'integer', minimum: 1, maximum: 50 } } },
    lauf: (p) => {
      const q = new URLSearchParams();
      for (const k of ['deck', 'material_id', 'energie', 'fenster'] as const) if (p[k] !== undefined) q.set(k, String(p[k]));
      q.set('limit', String(p.max ?? 10));
      return http('GET', `/mediathek/anschluss?${q}`);
    } },
  { name: 'stoebern', description: 'Browse the whole media library by type: track (whole library, one per work), loop, oneshot (samples), strudel (pattern library). '
      + 'text: words match as prefixes over title, artist, label, genre, pack, instrument, folder, file name; field:value narrows to one field '
      + '(artist:, title:, label:, genre:, release:, catalog:, isrc:, remixer:, pack:, instrument:, year:, folder:); plain words also match values from every source, not only the winning one. '
      + 'For strudel the words are plain substrings of name, code and role, and only name: and rolle: exist (any other field is an error, suchfeld_nicht_anwendbar). '
      + 'Filters per type: camelot (nachbarn true adds ±1 and the relative key) for track and loop, bpm "124-130" for track, loop and strudel, energie 0 low | 1 mid | 2 high for track only; '
      + 'a filter the type does not have is an error (filter_nicht_anwendbar). Also ordner (folder path; not for strudel, which is an error too), sort, richtung auf|ab, seite, limit (100, max 200). '
      + 'Each hit has material_id and sha (for loop import and preview) and, for tracks, status ready|prepare|missing.',
    inputSchema: { type: 'object', properties: { typ: { type: 'string', enum: ['track', 'loop', 'oneshot', 'strudel'] }, text: { type: 'string' }, camelot: { type: 'string' },
      nachbarn: { type: 'boolean' }, bpm: { type: 'string', pattern: '^\\d+(-\\d+)?$' }, energie: { type: 'integer', enum: [0, 1, 2] }, ordner: { type: 'string' },
      sort: { type: 'string' }, richtung: { type: 'string', enum: ['auf', 'ab'] }, seite: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 200 } } },
    lauf: (p) => http('GET', '/stoebern?' + new URLSearchParams(Object.entries(p).map(([k, v]) => [k, k === 'nachbarn' ? (v ? '1' : '0') : String(v)])).toString()) },
  { name: 'klaenge', description: 'Find sounds (not tracks): one-shots, loops, impulse responses, my recordings, generated sounds and voices from the media library on this host plus my loop library. Text matches path, pack, category, instrument, title. Each hit has einsatz: sofort (plays now: my loop library, load with box), werkstatt (open file, needs a kit build or loading first), nur_live (encrypted Ableton pack sample, only Ableton Live plays it; never try to load it). Filters: typ, pack, einsatz, bpm "124-130", camelot, limit (30, max 200). Ask this BEFORE building a sound.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' }, typ: { type: 'string', enum: ['oneshot', 'loop', 'impuls', 'mitschnitt', 'erzeugt', 'stimme'] }, pack: { type: 'string' }, einsatz: { type: 'string', enum: ['sofort', 'werkstatt', 'nur_live'] }, bpm: { type: 'string' }, camelot: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 200 } } },
    lauf: (p) => http('GET', '/klaenge?' + new URLSearchParams(Object.entries(p).map(([k, v]) => [k, String(v)])).toString()) },
  { name: 'bestand_karte', description: 'Overview of all sounds in numbers: per type how many play now (sofort), need the workshop, or are Live-only; the biggest packs; size of my loop library. Call it once at the start of a session that will build sounds.',
    inputSchema: { type: 'object', properties: {} },
    lauf: () => http('GET', '/klaenge/karte') },
  { name: 'vorbereiten', description: 'Run one library track through the workshop (analysis + render at 128 BPM, about a minute) so it can be loaded on a deck. Waits up to 150 s and returns the final status (neu, vorhanden, fehler) or laeuft if still running.',
    inputSchema: { type: 'object', required: ['material_id'], properties: { material_id: { type: 'string', pattern: '^[0-9a-f]{16}$' } } },
    lauf: async (p) => {
      const r = await http('POST', '/mediathek/vorbereiten', { material_id: p.material_id });
      if (r.code !== 202) return r;
      const t0 = Date.now();
      for (;;) {
        await new Promise((ok) => setTimeout(ok, 2000));
        const s = await http('GET', `/mediathek/vorbereiten?material_id=${p.material_id}`);
        // HTTP >= 400: sofort zurück (antwort() macht daraus den Werkzeugfehler); nach 150 s das Statusobjekt, kein Fehler
        if (s.code >= 400 || s.j.status !== 'laeuft' || Date.now() - t0 > 150000) return s;
      }
    } },
  { name: 'sets', description: 'List the prepared sets (free collections of tracks for a planned DJ set): slug, name, number of items.',
    inputSchema: { type: 'object', properties: {} }, lauf: () => http('GET', '/sammlungen?art=set') },
  { name: 'set_zeige', description: 'Show one set: every item with title, artist, bpm, key, genre, length, status (ready = loadable via laden with laden_mid, prepare, missing, wartet, laeuft, fehler) and a summary (total length, bpm range, keys, genres, status counts).',
    inputSchema: { type: 'object', required: ['slug'], properties: { slug: { type: 'string' } } },
    lauf: (p) => http('GET', `/sammlungen/${encodeURIComponent(String(p.slug))}`) },
  { name: 'set_lege', description: 'Put a library track (material_id from bibliothek) into a set. If the set does not exist and name is given, it is created first. Same track twice is reported as schon_drin.',
    inputSchema: { type: 'object', required: ['slug', 'material_id'], properties: { slug: { type: 'string' }, name: { type: 'string', description: 'create the set with this name if it does not exist' },
      material_id: { type: 'string', pattern: '^[0-9a-f]{16}$' }, notiz: { type: 'string' } } },
    lauf: async (p) => {
      let slug = String(p.slug);
      if ((await http('GET', `/sammlungen/${encodeURIComponent(slug)}`)).code === 404) {
        if (!p.name) return { code: 404, j: { fehler: 'unbekannt', text: 'set does not exist; pass name to create it' } };
        const n = await http('POST', '/sammlungen', { name: p.name });
        if (n.code !== 201) return n;
        slug = String(n.j.slug);
      }
      const r = await http('POST', `/sammlungen/${encodeURIComponent(slug)}/posten`, { art: 'track', material_id: p.material_id, ...(p.notiz ? { notiz: p.notiz } : {}) });
      return { code: r.code, j: { slug, ...r.j } };
    } },
  { name: 'set_vorbereiten', description: 'Queue every not-yet-prepared track of a set for the workshop (two at a time, about a minute each). Returns how many were queued; watch progress with set_zeige.',
    inputSchema: { type: 'object', required: ['slug'], properties: { slug: { type: 'string' } } },
    lauf: (p) => http('POST', `/sammlungen/${encodeURIComponent(String(p.slug))}/vorbereiten`, {}) },
  { name: 'instrumente', description: 'Load the Surge XT instruments into the RUNNING studio without stopping anything else: starts the bass and melody hosts, wires them to the core, and restarts only the bass (strom 2) and melody (strom 3) instances so they play into Surge instead of the sample kit. Patterns are kept and sound through Surge from the next bar (say so before). Drums, decks and the core keep running. Idempotent: already loaded parts are skipped. Afterwards klang works. Refused while Stop Cypher is set or AUTO of instance 2 or 3 is off. melodie: surge or fluegel (omitted: the melody host keeps the kind its status file says, Surge if there is none) ; fluegel = a real sampled grand piano (Ableton Core Library, 4 velocity layers) on the melody instance (strom 3) instead of Surge; switching only restarts the melody host, the pattern keeps playing. With fluegel klang does not work on melodie (no Surge there), velocity("<0.3 0.9>") picks the piano layer.',
    inputSchema: { type: 'object', properties: { melodie: { type: 'string', enum: ['surge', 'fluegel'] } } },
    lauf: async (p) => {
      if (p.melodie !== undefined && p.melodie !== 'surge' && p.melodie !== 'fluegel') return { code: 400, j: { fehler: 'melodie', text: 'melodie: surge or fluegel' } };
      const l = (await http('GET', '/lage')).j as { ki?: { gestoppt?: boolean }; studio?: { stroeme?: Json[] } };
      if (l.ki?.gestoppt) return { code: 409, j: { fehler: 'gestoppt', text: 'Stop Cypher is set' } };
      const aus = (l.studio?.stroeme ?? []).filter((x) => (x.strom === 2 || x.strom === 3) && x.autonom === false).map((x) => x.strom);
      if (aus.length) return { code: 409, j: { fehler: 'auto_aus', text: `AUTO off on instance ${aus.join(', ')}: Andreas holds it` } };
      return instrumenteLaden(p.melodie ? ['--melodie', String(p.melodie)] : []);
    } },
];
