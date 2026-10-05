// Hilfen für die Tests der Kern-Attrappe: Schritt-Bausteine im Folgen-Format §19.0 und Test-Material im Arbeitsbestand.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SR = 48000;
export const S = (beat, bpm = 128) => Math.round((beat * 60 * SR) / bpm);   // Sample eines Beats bei konstantem Tempo
export const ID = 'a1b2c3d4e5f60718';                                          // Test-Material-ID (16 Hex)
export const ID2 = 'f0e1d2c3b4a59687';
export const inhalt = (id = ID, bpm = 128, r = 1) => `${id}/${Math.round(bpm * 1000)}_r${r}`;

// Arbeitsbestand mit einer Fassung: fassung.json plus Basis-Datei (sparse, Nullen) oder vier Stems
export function arbeitsbestand({ materialien = [{}] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attrappe-ab-'));
  for (const m of materialien) legeMaterial(dir, m);
  return dir;
}

export function legeMaterial(dir, { id = ID, bpm = 128, r = 1, beats = 96, e = 0, stems = false, lufs = -16, hotcues = [], erster_schlag_frame = 0, schuesse = [], nan = false } = {}) {
  const f = path.join(dir, id, 'fassungen', `${Math.round(bpm * 1000)}_r${r}`);
  fs.mkdirSync(path.join(f, 'stems'), { recursive: true });
  fs.mkdirSync(path.join(f, 'schuesse'), { recursive: true });
  const frames = erster_schlag_frame + Math.round((beats * 60 * SR) / bpm);
  const j = { schema: 1, material_id: id, basis_bpm: bpm, fassung: r, korrekturen_bis_zeile: 0, datei: 'basis.f32', frames, sha256: '', erster_schlag_frame,
    beats, erste_eins_quell_beat: e, analyse_quelle: stems ? 'stems' : 'basis', stems: {}, schuesse: schuesse.map((nr) => ({ nr, datei: `schuesse/${nr}.f32`, frames: 4800, quell_beat: 0, name: `s${nr}` })),
    headroom_db: -12, stimmung_korrektur_cent: 0, lautheit: { lufs_integriert: lufs, echtspitze_dbtp: -1, crest_db: 10, lufs_je_takt: [] },
    struktur: { phrasen: [] }, hotcues: hotcues.map(([nr, q]) => ({ nr, quell_beat: q, name: `h${nr}`, von: 'werkstatt' })), loops: [], tore: {}, nur_fuer_andreas: false, warnungen: [] };
  const leer = (p) => { const fd = fs.openSync(p, 'w'); fs.ftruncateSync(fd, frames * 8); fs.closeSync(fd); };
  if (stems) for (const n of ['drums', 'bass', 'vocals', 'other']) { j.stems[n] = { datei: `stems/${n}.f32`, sha256: '', frames }; leer(path.join(f, 'stems', `${n}.f32`)); }
  else leer(path.join(f, 'basis.f32'));
  if (nan) { const fd = fs.openSync(path.join(f, 'basis.f32'), 'r+'); const b = Buffer.alloc(4); b.writeFloatLE(NaN); fs.writeSync(fd, b, 0, 4, 400); fs.closeSync(fd); }
  for (const nr of schuesse) fs.writeFileSync(path.join(f, 'schuesse', `${nr}.f32`), Buffer.alloc(4800 * 8));
  fs.writeFileSync(path.join(f, 'fassung.json'), JSON.stringify(j));
  return f;
}

// Befehle als Folgen-Schritte (die id wählt der Test, Quelle wie angegeben)
export const sende = (sample, osc) => ({ t: 'sende', sample, osc });
export const erwarte = (bis_sample, osc) => ({ t: 'erwarte', bis_sample, osc });
export const wert = (sample, pfad, w, toleranz = 1e-6) => ({ t: 'wert', sample, pfad, wert: w, toleranz });
export const hand = (sample, pfad, midi_roh) => ({ t: 'hand', sample, pfad, midi_roh });

export const setNeu = (id, bpm = 128) => ['/k/set/neu', 'hsd', id, 'leitstand', bpm];
export const teil = (id, quelle, plan, nr, pfad, ab, dauer, nach, { form = 0, politik = 0, gruppe = '', hs = '' } = {}) =>
  ['/k/teil', 'hssisddfiiss', id, quelle, plan, nr, pfad, ab, dauer, nach, form, politik, gruppe, hs];
export const laden = (id, deck, { mid = ID, bpm = 128, r = 1, stems = 0 } = {}) => ['/k/deck/laden', 'hsisdii', id, 'leitstand', deck, mid, bpm, r, stems];
export const start = (id, quelle, deck, ab, qb, { plan = '', gruppe = '', hs = '', politik = 0 } = {}) =>
  ['/k/deck/start', 'hssssiddi', id, quelle, plan, gruppe, hs, deck, ab, qb, politik];
export const stopp = (id, quelle, deck, ab, { plan = '', gruppe = '', hs = '', politik = 1 } = {}) =>
  ['/k/deck/stopp', 'hssssidi', id, quelle, plan, gruppe, hs, deck, ab, politik];
export const hoerschein = (id, hs_id, kanal, inh, { bpm = 128, bis = 100000, von = 0, qbis = 100000, quelle = 'leitstand' } = {}) =>
  ['/k/hoerschein', 'hsssssddddfff', id, quelle, hs_id, kanal, inh, 'ok', bpm, bis, von, qbis, 0.5, 0, -10];

// erwartete Quittung: sample oder grund null = beliebig
export const q = (id, quelle, status, sample = null, grund = null) => ['/q', 'hsihds', id, quelle, status, sample, null, grund];

// Deck laden, Hörschein registrieren, Deck am Quell-Beat qb starten und den Fader bei Beat ab auf 0 dB öffnen
export function deckRein(n, { id0, ab, qb = 0, mid = ID, hs_id = `h${n}`, quelle = 'leitstand', eqTief = null, plan = '' }) {
  const k = `deck/${n}`;
  const s = [
    sende(S(ab) - 60000, laden(id0, n, { mid })),
    sende(S(ab) - 50000, hoerschein(id0 + 1, hs_id, k, inhalt(mid))),
    sende(S(ab) - 40000, start(id0 + 2, quelle, n, ab, qb, { plan })),
  ];
  // Bass einen Beat vor dem Fader setzen (Lesart n: I1 über die Schaltrampe; SCHNITTSTELLEN §14.1 Teil 1 bei Beat 447)
  if (eqTief !== null) s.push(sende(S(ab) - 30000, teil(id0 + 3, quelle, plan, 0, `${k}/eq/tief`, ab - 1, 0, eqTief)));
  s.push(sende(S(ab) - 20000, teil(id0 + 4, quelle, plan, 1, `${k}/fader`, ab, 0, 0, { hs: hs_id })));
  return s;
}
