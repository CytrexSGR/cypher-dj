// Authoring script for the golden project folders. Run by hand, never by a test:
//   node djk/ui/tests/golden/projekte/generate.mjs
// Regenerate only on a format bump, and review the diff of every project.json: these files are the promise that a 1.x program
// opens what an earlier 1.x wrote. The test (tests/golden_projekte.test.mjs) loads them, saves them and compares the bytes.
// Every file is built from `neuesProjekt` plus literals, checked by `pruefeProjekt` and stored in the form `Projekte.schreibe` writes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORMAT_ALT, FORMAT_ALT2, hebeAufDrei, insertVorgabe, MAX_MAKROS, neuesProjekt, pruefeProjekt, setzeFehlendeZaehler, sortiert } from '../../../project/model.ts';
import { normalisiere } from '../../../project/storage.ts';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const SHA = (n) => String(n).repeat(64).slice(0, 64);   // 64 hex characters, synthetic

const spur = (id, nr, name, art, extra = {}) => ({
  id, nr, name, farbe: '#3b8de0', art, fader_db: 0, pan: 0, mute: false, solo: false, clips: [], ...extra,
});
const audio = (id, name, start, laenge, extra = {}) => ({
  id, art: 'audio', name, start_beat: start, laenge_beats: laenge, quelle: { sha256: SHA(1), pfad_hinweis: 'sample.wav' },
  dekodiert: 'fertig', offset_s: 0, gain_db: 0, fade_ein_beats: 0, fade_aus_beats: 0, ...extra,
});
const midi = (id, name, start, laenge, noten, extra = {}) => ({ id, art: 'midi', name, start_beat: start, laenge_beats: laenge, noten, ...extra });
const gruppe = (id, nr, name, extra = {}) => ({
  id, nr, name, farbe: '#9b59d0', fader_db: 0, pan: 0, mute: false, solo: false, gefaltet: false, ...extra,
});
const ret = (id, nr, name, extra = {}) => ({
  id, nr, name, farbe: '#3bb07a', fader_db: 0, pan: 0, mute: false, solo: false,
  hall: { an: true, pre: 0.04, decay: 0.5252, groesse: 0.282, tief: 0.5658, highcut: 0.8039, fahne: 0.66667 }, ...extra,
});

// 16 notes, ids n1..n16; the first three carry chance, wdh and versatz
function sechzehnNoten() {
  const aus = [];
  for (let i = 0; i < 16; i++) {
    const n = { id: `n${i + 1}`, beat: i * 0.5, laenge: 0.25, ton: 48 + (i % 8) * 2, vel: 60 + i * 4 };
    if (i === 0) n.chance = 75;
    if (i === 1) n.wdh = 3;
    if (i === 2) n.versatz = -20;
    aus.push(n);
  }
  return aus;
}

const BAUER = {
  'audio-clips': () => {
    const p = neuesProjekt('Golden audio clips');
    p.tempo_bpm = 124;
    p.spuren = [
      spur('s1', 1, 'Drums', 'audio', { clips: [
        audio('c1', 'Warped loop', 0, 16, { warp: { an: true, modus: 'beats', marker: [[0, 0], [4, 4], [8, 8.25]], versatz_beats: 0.5, quelle: 'hand',
          transpose_st: 0, detune_ct: 0, beats: { raster: '1/8', loop: 'vor', huelle: 80 } } }),
        audio('c2', 'Faded', 16, 8, { gain_db: -6, fade_ein_beats: 1, fade_aus_beats: 2, offset_s: 0.5, quelle: { sha256: SHA(2), pfad_hinweis: 'vocal.flac' } }),
      ] }),
      spur('s2', 2, 'Texture', 'audio', { clips: [
        audio('c3', 'Looped muted', 0, 12, { loop_beats: 4, stumm: true, quelle: { sha256: SHA(3), pfad_hinweis: 'pad.wav' } }),
      ] }),
    ];
    return p;
  },
  'midi-automation': () => {
    const p = neuesProjekt('Golden midi automation');
    p.spuren = [spur('s1', 1, 'Bass', 'instrument', {
      geraet: { art: 'intern', name: 'rb338', parameter: { cutoff: 0.4, resonanz: 0.6 } },
      clips: [midi('c1', 'Line', 0, 8, sechzehnNoten())],
      automation: [{ id: 'l1', ziel: 'fader', punkte: [{ beat: 0, wert: -12 }, { beat: 4, wert: -3, form: 'linear' }, { beat: 8, wert: -6, form: 's' },
        { beat: 12, wert: 0, form: 'sprung' }] }],
    })];
    return p;
  },
  'kit-spur': () => {
    const p = neuesProjekt('Golden kit track');
    p.spuren = [spur('s1', 1, 'Kit', 'instrument', {
      geraet: { art: 'intern', name: 'kit', kit: 'tr808' },
      clips: [midi('c1', 'Beat', 0, 4, [{ id: 'n1', beat: 0, laenge: 0.25, ton: 36, vel: 110 }, { id: 'n2', beat: 1, laenge: 0.25, ton: 38, vel: 100 },
        { id: 'n3', beat: 2, laenge: 0.25, ton: 36, vel: 110 }, { id: 'n4', beat: 3, laenge: 0.25, ton: 38, vel: 100 }])],
    })];
    return p;
  },
  'rack-makros': () => {
    const p = neuesProjekt('Golden rack macros');
    const ziele = (glied, param) => ({ glied, param, von: 0, bis: 1 });
    p.spuren = [spur('s1', 1, 'Rack', 'instrument', {
      geraet: { art: 'rack', kette: 0, glieder: [
        { id: 'g1', geraet: { art: 'intern', name: 'rb338', parameter: { cutoff: 0.5 } }, ton: [0, 59], gain_db: -3 },
        { id: 'g2', geraet: { art: 'intern', name: 'bk', graph: 'demo', parameter: { k1: 0.2 } }, ton: [60, 127], vel: [1, 127] },
      ] },
      clips: [midi('c1', 'Chord', 0, 4, [{ id: 'n1', beat: 0, laenge: 2, ton: 48, vel: 90 }, { id: 'n2', beat: 0, laenge: 2, ton: 64, vel: 90 }])],
      rack: { slot: 1, namen: ['Open', 'Res', 'Level', 'Mix'], werte: [0.1, 0.2, 0.3, 0.4],
        makros: [
          { ziel: [ziele('g1', 'cutoff'), ziele('g2', 'k1')] },
          { ziel: [ziele('g1', 'resonanz')] },
          { ziel: [ziele('g1', 'lautstaerke')] },
          { ziel: [ziele('g2', 'k2')] },
        ],
        variationen: [{ name: 'Bright', werte: [0.9, 0.5, 0.5, 0.5] }] },
    })];
    if (p.spuren[0].rack.makros.length !== MAX_MAKROS) throw new Error('rack-makros: expected all macros');
    return p;
  },
  'gruppen-returns': () => {
    const p = neuesProjekt('Golden groups and returns');
    p.master = { fader_db: -1.5 };
    p.gruppen = [gruppe('g1', 1, 'Drums bus'), gruppe('g2', 2, 'Rhythm', { sends: [{ id: 'r2', db: -12 }] })];
    p.gruppen[0].ausgang = { art: 'gruppe', id: 'g2' };
    p.returns = [
      ret('r1', 1, 'Hall', { inserts: [{ id: 'i1', art: 'eq', slot: 1, an: true, werte: insertVorgabe('eq') }] }),
      ret('r2', 2, 'Space'),
    ];
    p.spuren = [
      spur('s1', 1, 'Kick', 'audio', { ausgang: { art: 'gruppe', id: 'g1' }, sends: [{ id: 'r1', db: -9 }] }),
      spur('s2', 2, 'Snare', 'audio', { ausgang: { art: 'gruppe', id: 'g1' } }),
      spur('s3', 3, 'Lead', 'audio', { ausgang: { art: 'gruppe', id: 'g2' }, sends: [{ id: 'r2', db: -6 }] }),
    ];
    return p;
  },
  'take-lanes': () => {
    const p = neuesProjekt('Golden take lanes');
    p.spuren = [spur('s1', 1, 'Vocal', 'audio', {
      clips: [audio('c1', 'Comp A', 0, 4), audio('c2', 'Comp B', 4, 4, { quelle: { sha256: SHA(2), pfad_hinweis: 'take2.wav' } })],
      takes: [
        { id: 't1', name: 'Original', art: 'original', clips: [audio('c3', 'Original', 0, 8)] },
        { id: 't2', name: 'Take 2', clips: [audio('c4', 'Take 2 part', 0, 8, { quelle: { sha256: SHA(2), pfad_hinweis: 'take2.wav' } })] },
      ],
    })];
    return p;
  },
  'taktart-3-4': () => {
    const p = neuesProjekt('Golden waltz');
    p.taktart = [3, 4];
    p.loop = { an: true, von_beat: 0, bis_beat: 12 };
    p.spuren = [
      spur('s1', 1, 'Waltz', 'instrument', { geraet: { art: 'intern', name: 'rb338', parameter: {} },
        clips: [midi('c1', 'Bar loop', 0, 12, [{ id: 'n1', beat: 0, laenge: 1, ton: 36, vel: 100 }, { id: 'n2', beat: 1, laenge: 0.5, ton: 48, vel: 70 },
          { id: 'n3', beat: 2, laenge: 0.5, ton: 48, vel: 70 }], { loop_beats: 3 })] }),
      spur('s2', 2, 'Strings', 'audio', { clips: [audio('c2', 'Pad', 0, 12, { loop_beats: 6 })] }),
    ];
    return p;
  },
};

// ---- Task 2: instruments, live, loop decks, scenes ----

const zelle = (id, name, extra = {}) => ({ id, name, farbe: 3, art: 'loop', sha256: SHA(4), beats: 8, bpm: 120, gain_db: 0, pfad_hinweis: 'loop.wav', ...extra });
const deckSpuren = (gruppeId, ersteNr, ersteId, zellenJe) => [1, 2, 3, 4].map((i) => spur(`s${ersteId + i - 1}`, ersteNr + i - 1, `Deck ${i}`, 'audio', {
  ausgang: { art: 'gruppe', id: gruppeId }, zellen: zellenJe(i),
}));
const lebendig = (name) => {
  const p = neuesProjekt(name);
  p.live = true; p.loop = { an: true, von_beat: 0, bis_beat: 64 };
  hebeAufDrei(p);   // the default layout track, track, strudel, track
  return p;
};

Object.assign(BAUER, {
  'surge-patch': () => {
    const p = neuesProjekt('Golden surge patch');
    p.spuren = [spur('s1', 1, 'Pad', 'instrument', { freeze: null,
      geraet: { art: 'wirt', name: 'surge', slot: 1, patch: 'Pads/Warm Pad', parameter: { filter_cutoff: 62.5, osc_level: -3 } },
      clips: [midi('c1', 'Chords', 0, 8, [{ id: 'n1', beat: 0, laenge: 4, ton: 57, vel: 80 }, { id: 'n2', beat: 4, laenge: 4, ton: 60, vel: 80 }])],
    })];
    return p;
  },
  'modular-knoepfe': () => {
    const p = neuesProjekt('Golden modular knobs');
    const knoepfe = (extra) => ({ k1: 0.1, k2: 0.2, k3: 0.3, k4: 0.4, k5: 0.5, k6: 0.6, k7: 0.7, k8: 0.8, ...extra });
    p.spuren = [
      spur('s1', 1, 'Modular A', 'instrument', { geraet: { art: 'intern', name: 'bk', graph: 'demo', parameter: knoepfe({ k40: 0.25 }) },
        clips: [midi('c1', 'Riff', 0, 4, [{ id: 'n1', beat: 0, laenge: 1, ton: 45, vel: 100 }])] }),
      spur('s2', 2, 'Modular B', 'instrument', { geraet: { art: 'intern', name: 'bk', graph: 'strings-1', parameter: knoepfe({ k9: 0.5, k8: 0.95 }) } }),
    ];
    return p;
  },
  'loopdeck-scheiben': () => {
    const p = lebendig('Golden loop deck slices');
    const id = 'g2';
    p.gruppen.push(gruppe(id, 2, 'LOOP 1', { loopdeck: { platz: 1, raster: 'takt' } }));
    p.plaetze[3] = { typ: 'loops', gruppe: id };
    p.spuren = deckSpuren(id, 1, 1, (i) => {
      const z = Array(8).fill(null);
      if (i === 1) {
        z[0] = zelle('z1', 'Sliced', { scheiben: { teilung: '1/8', grenzen: [0, 2, 4, 6], folge: [1, 3, 2, 4] },
          huellen: [{ ziel: 'gain', punkte: [{ beat: 0, wert: -12 }, { beat: 4, wert: 0, form: 's' }] }, { ziel: 'filter', punkte: [{ beat: 0, wert: -0.5 }] }] });
        z[1] = zelle('z2', 'Hit', { art: 'einmal', beats: 2, farbe: 5 });
        z[2] = { halten: true };
      }
      return z;
    });
    p.spuren[0].filter = 0.25; p.spuren[0].eq = { tief: -3 }; p.spuren[0].kill = { hoch: true }; p.spuren[0].fx = { 1: true };
    return p;
  },
  szenen: () => {
    const p = lebendig('Golden scenes');
    p.spuren = [spur('s1', 1, 'Pattern', 'instrument', { geraet: { art: 'intern', name: 'rb338', parameter: {} } }),
      spur('s2', 2, 'Pattern 2', 'instrument', { geraet: { art: 'intern', name: 'rb338', parameter: {} } })];
    p.szenen = [{ an: ['s1'], aus: ['s2'] }, null, { an: ['s1', 's2'], aus: [] }, null, null, null, null, null];
    p.session = { raster: '4takte', szenen: Array.from({ length: 8 }, (_, i) => ({ id: `sz${i + 1}`, name: ['Intro', 'Build', 'Drop', '', '', '', '', 'Outro'][i], farbe: i,
      ...(i === 2 ? { bpm: 128, takte: 16, folge: 'weiter' } : {}) })) };
    return p;
  },
});

// ---- the /1 and /2 inputs, written in the old shape; the expected /3 files are the lifted models in stored form ----

const ALT = {
  'alt-1': () => {
    const p = neuesProjekt('Golden version 1');
    p.format = FORMAT_ALT;
    delete p.gruppen; delete p.master;
    p.spuren = [
      spur('s1', 1, 'Beat', 'instrument', { geraet: { art: 'intern', name: 'rb338', parameter: { cutoff: 0.3 } },
        clips: [midi('c1', 'Line', 0, 4, [{ id: 'n1', beat: 0, laenge: 1, ton: 36, vel: 100 }, { id: 'n2', beat: 2, laenge: 1, ton: 43, vel: 90 }])] }),
      spur('s2', 2, 'Sample', 'audio', { clips: [audio('c2', 'Loop', 0, 8)] }),
    ];
    for (const s of p.spuren) delete s.von;   // /1 files have no origin field
    return p;
  },
  'alt-2': () => {
    const p = neuesProjekt('Golden version 2 live');
    p.format = FORMAT_ALT2;
    p.live = true; p.loop = { an: true, von_beat: 0, bis_beat: 64 };
    p.gruppen = [
      gruppe('g1', 1, 'SEQ', { seq: { schema: 2, platz: 1 } }),
      gruppe('g2', 2, 'LOOP 1', { loopdeck: { platz: 1, raster: 'takt' } }),
    ];
    p.returns = [ret('r1', 1, 'Hall'), ret('r2', 2, 'Delay')];
    p.spuren = [
      spur('s1', 1, 'Pattern', 'instrument', { ausgang: { art: 'gruppe', id: 'g1' }, sends: [{ id: 'r1', db: -10 }, { id: 'r2', db: -14 }],
        geraet: { art: 'intern', name: 'rb338', parameter: {} },
        clips: [midi('c1', 'Pattern', 0, 64, [{ id: 'n1', beat: 0, laenge: 0.25, ton: 36, vel: 100 }])] }),
      ...deckSpuren('g2', 2, 2, (i) => { const z = Array(8).fill(null); if (i === 1) z[0] = zelle('z1', 'Loop'); return z; }),
    ];
    p.naechste_id = { spur: 6, clip: 2, gruppe: 3, return: 3, zelle: 2 };
    return p;
  },
  'alt-2-produktion': () => {
    const p = neuesProjekt('Golden version 2 production');
    p.tempo_bpm = 110;
    p.returns = [ret('r1', 1, 'Hall')];
    p.spuren = [spur('s1', 1, 'Keys', 'instrument', { sends: [{ id: 'r1', db: -8 }], geraet: { art: 'intern', name: 'rb338', parameter: {} },
      clips: [midi('c1', 'Keys', 0, 4, [{ id: 'n1', beat: 0, laenge: 1, ton: 60, vel: 90 }])] })];
    // a stored /2 production file already holds every default the loader fills (origin, counters): the lift only changes the format string
    setzeFehlendeZaehler(p);
    const r = pruefeProjekt(p);
    if ('fehler' in r) throw new Error(`alt-2-produktion: ${r.fehler}`);
    const fertig = normalisiere(r.projekt);
    fertig.format = FORMAT_ALT2;
    return fertig;
  },
};

const alsDatei = (x) => JSON.stringify(sortiert(x), null, 1) + '\n';

export function baue(slug) {
  const p = BAUER[slug]();
  setzeFehlendeZaehler(p);
  const r = pruefeProjekt(p);
  if ('fehler' in r) throw new Error(`${slug}: ${r.fehler}`);
  return JSON.stringify(normalisiere(r.projekt), null, 1) + '\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const slug of Object.keys(BAUER)) {
    const ordner = path.join(HIER, slug);
    fs.mkdirSync(ordner, { recursive: true });
    fs.writeFileSync(path.join(ordner, 'project.json'), baue(slug));
    console.log(`wrote ${slug}`);
  }
  for (const slug of Object.keys(ALT)) {
    const ordner = path.join(HIER, slug);
    fs.mkdirSync(ordner, { recursive: true });
    const alt = ALT[slug]();
    const r = pruefeProjekt(alt);
    if ('fehler' in r) throw new Error(`${slug}: ${r.fehler}`);
    fs.writeFileSync(path.join(ordner, 'project.json'), alsDatei(alt));
    fs.writeFileSync(path.join(ordner, 'erwartet-3.json'), JSON.stringify(normalisiere(r.projekt), null, 1) + '\n');
    console.log(`wrote ${slug} (old shape and lifted)`);
  }
}
