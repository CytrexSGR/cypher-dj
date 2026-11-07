// 1.14 Comping slice 1, task 7: fixtures of the take-copy rule (R6). The page-side istTakeKopie (oeffentlich/produktion/takes.js) mirrors the server's
// istTakeKopie (projekt/takes.ts, built in the server strand). The cross test "page against server on the same fixtures" imports TAKE_KOPIE_FIXTURES:
// each entry is {name, bpm, haupt, take, erwartet}; haupt and take are audio clips (the main clip and the take clip), erwartet the verdict.
const quelle = (sha) => ({ sha256: sha, pfad_hinweis: `${sha}.wav` });
export const audio = (id, sha, start, laenge, offset, extra = {}) => ({
  id, art: 'audio', name: id, start_beat: start, laenge_beats: laenge, quelle: quelle(sha), dekodiert: 'fertig',
  offset_s: offset, gain_db: 0, fade_ein_beats: 0, fade_aus_beats: 0, ...extra,
});
const BPM = 120;                      // 2 beats per second: a shift of d beats is d / 2 seconds
const MARKER = [[0, 0], [4, 8]];
const warp = (versatz, marker = MARKER) => ({ an: true, marker, versatz_beats: versatz });
const T = audio('c1', 'A', 0, 8, 0);  // the take clip every fixture compares against

export const TAKE_KOPIE_FIXTURES = [
  { name: 'identical copy', bpm: BPM, take: T, haupt: audio('m1', 'A', 0, 8, 0), erwartet: true },
  { name: 'copy split at beat 3 (start 3, offset 1.5 s)', bpm: BPM, take: T, haupt: audio('m1', 'A', 3, 5, 1.5), erwartet: true },
  { name: 'copy placed on a take that starts later', bpm: BPM, take: audio('c2', 'A', 4, 8, 2), haupt: audio('m1', 'A', 6, 2, 3), erwartet: true },
  { name: 'tolerance: 1e-7 beats off', bpm: BPM, take: T, haupt: audio('m1', 'A', 3 + 1e-7, 5, 1.5), erwartet: true },
  { name: 'beyond tolerance: 1e-5 beats off', bpm: BPM, take: T, haupt: audio('m1', 'A', 3 + 1e-5, 5, 1.5), erwartet: false },
  { name: 'moved main clip (start shifted, offset kept)', bpm: BPM, take: T, haupt: audio('m1', 'A', 3.5, 5, 1.5), erwartet: false },
  { name: 'other sha', bpm: BPM, take: T, haupt: audio('m1', 'B', 0, 8, 0), erwartet: false },
  { name: 'loop clip on the main lane never counts', bpm: BPM, take: T, haupt: audio('m1', 'A', 0, 8, 0, { loop_beats: 4 }), erwartet: false },
  { name: 'loop clip on the take side never counts', bpm: BPM, take: audio('c2', 'A', 0, 8, 0, { loop_beats: 4 }),
    haupt: audio('m1', 'A', 0, 8, 0), erwartet: false },
  { name: 'warp: same markers, versatz follows the start', bpm: BPM, take: audio('c2', 'A', 0, 8, 0, { warp: warp(0) }),
    haupt: audio('m1', 'A', 3, 5, 0, { warp: warp(3) }), erwartet: true },
  { name: 'warp: offset_s is ignored, versatz decides', bpm: BPM, take: audio('c2', 'A', 0, 8, 0, { warp: warp(0) }),
    haupt: audio('m1', 'A', 3, 5, 1.5, { warp: warp(0) }), erwartet: false },
  { name: 'warp: different markers', bpm: BPM, take: audio('c2', 'A', 0, 8, 0, { warp: warp(0) }),
    haupt: audio('m1', 'A', 0, 8, 0, { warp: warp(0, [[0, 0], [4, 7]]) }), erwartet: false },
  { name: 'warp on one side only', bpm: BPM, take: audio('c2', 'A', 0, 8, 0, { warp: warp(0) }), haupt: audio('m1', 'A', 0, 8, 0), erwartet: false },
  { name: 'warp switched off counts as unwarped', bpm: BPM, take: audio('c2', 'A', 0, 8, 0, { warp: { an: false, marker: MARKER, versatz_beats: 9 } }),
    haupt: audio('m1', 'A', 3, 5, 1.5), erwartet: true },
  { name: 'tempo matters: 60 bpm, 1 beat = 1 s', bpm: 60, take: T, haupt: audio('m1', 'A', 3, 5, 3), erwartet: true },
  { name: 'tempo matters: same clips at 120 bpm do not match', bpm: BPM, take: T, haupt: audio('m1', 'A', 3, 5, 3), erwartet: false },
];

// The T3 track: take 1 unused, take 2 holds [3,5) of the comp, take 3 holds [0,3) and [5,8). All takes are 8 beats at 120 bpm.
export const T3_TEMPO = BPM;
export const T3_SPUR = {
  id: 's1', nr: 1, name: 'Vox', art: 'audio', farbe: '#e0563b',
  clips: [audio('m1', 'C', 0, 3, 0), audio('m2', 'B', 3, 2, 1.5), audio('m3', 'C', 5, 3, 2.5)],
  takes: [
    { id: 't1', name: 'Take 1', clips: [audio('c1', 'A', 0, 8, 0)] },
    { id: 't2', name: 'Take 2', clips: [audio('c2', 'B', 0, 8, 0)] },
    { id: 't3', name: 'Take 3', clips: [audio('c3', 'C', 0, 8, 0)] },
  ],
};
export const projektMit = (spuren) => ({ rev: 1, tempo_bpm: BPM, spuren, gruppen: [], loop: { an: false, von_beat: 0, bis_beat: 8 } });
