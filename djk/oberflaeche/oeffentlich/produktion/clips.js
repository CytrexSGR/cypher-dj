// PRODUCTION (D1 V2): Clips im Arrangement bearbeiten (Spec A2, 3.4 clip_*). Reine Funktionen, Browser und node.
// Jede Funktion liefert die Befehle für POST /proj/aendern (Befehlsform {befehl, ...}, wie S2 befehle.ts), nie einen neuen
// Projektstand: den rechnet der Server, die Seite zeigt ihn (während eines Zugs über entwurf.js). Lagen rasten auf das
// GRID der Transportleiste (zeitachse.js rasten); Fades rasten nicht (frei wie in jeder DAW).
import { rasten } from './zeitachse.js';
import { CLIP_KOPF, clipKasten, spurIndexBei } from './layout.js';

export const GRIFF_PX = 6;          // Breite der Kürz-Griffe an den Clip-Rändern
export const FADE_PX = 7;           // Fang-Abstand der Fade-Griffe in der Namenszeile eines Audio-Clips
export const ZUG_SCHWELLE = 3;      // Pixel, ab denen aus einem Klick ein Zug wird
export const MIN_LAENGE = 1 / 16;   // kürzester Clip in Beats bei GRID OFF
export const MIDI_LAENGE = 4;       // ein neuer MIDI-Clip ist einen Takt lang

const runde = (x) => Math.round(x * 1e9) / 1e9;            // wie S2 runde9: keine 0.30000000000000004 im Projekt
const runde3 = (x) => Math.round(x * 1000) / 1000;
export const istZug = (dx, dy) => Math.abs(dx) >= ZUG_SCHWELLE || Math.abs(dy) >= ZUG_SCHWELLE;
export const artPasst = (clip, spur) => clip.art === (spur.art === 'audio' ? 'audio' : 'midi');
const minLaenge = (clip, raster) => Math.min(clip.laenge_beats, raster > 0 ? raster : MIN_LAENGE);

// Welcher Clip liegt unter (x, y) der Spurfläche, und welche Zone: 'fade_ein' | 'fade_aus' (Namenszeile eines Audio-Clips,
// nahe am Fade-Punkt) | 'links' | 'rechts' (Kürz-Griffe) | 'mitte' (verschieben). Der zuletzt gezeichnete Clip gewinnt.
export function trefferClip(projekt, a, x, y) {
  const i = spurIndexBei(y, projekt?.spuren?.length ?? 0);
  if (i < 0) return null;
  const spur = projekt.spuren[i];
  for (let k = spur.clips.length - 1; k >= 0; k--) {
    const clip = spur.clips[k], kb = clipKasten(a, i, clip);
    if (x < kb.x || x > kb.x + kb.w || y < kb.y || y > kb.y + kb.h) continue;
    return { spurIndex: i, spur, clip, zone: zone(clip, kb, a, x, y) };
  }
  return null;
}
function zone(clip, k, a, x, y) {
  if (clip.art === 'audio' && y < k.y + CLIP_KOPF) {
    const f = fadePunkte(k, clip, a), de = Math.abs(x - f.ein), da = Math.abs(x - f.aus);
    if (Math.min(de, da) <= FADE_PX) return de < da || (de === da && x < k.x + k.w / 2) ? 'fade_ein' : 'fade_aus';
  }
  const griff = Math.min(GRIFF_PX, k.w / 4);
  if (x - k.x <= griff) return 'links';
  if (k.x + k.w - x <= griff) return 'rechts';
  return 'mitte';
}

// x-Lage der Fade-Punkte eines Audio-Clips im Kasten k (Pixel): Ende der Einblende, Anfang der Ausblende
export function fadePunkte(k, clip, a) {
  return { ein: k.x + (clip.fade_ein_beats ?? 0) * a.pxProBeat, aus: k.x + k.w - (clip.fade_aus_beats ?? 0) * a.pxProBeat };
}

// Verschieben: der gegriffene Clip (anker) rastet, alle gewählten folgen um denselben Versatz, keiner vor Beat 0.
// dSpur wechselt die Spur, wenn JEDER gewählte Clip auf seiner Zielspur Platz hat (Audio auf Audio, MIDI auf Instrument).
export function verschiebe(projekt, ids, ankerId, dBeat, dSpur, raster) {
  const lage = [];
  projekt.spuren.forEach((s, i) => { for (const c of s.clips) if (ids.includes(c.id)) lage.push({ c, i }); });
  const anker = lage.find((l) => l.c.id === ankerId);
  if (!anker) return [];
  let d = Math.max(0, rasten(anker.c.start_beat + dBeat, raster)) - anker.c.start_beat;
  d = Math.max(d, -Math.min(...lage.map((l) => l.c.start_beat)));
  const ds = dSpur !== 0 && lage.every((l) => projekt.spuren[l.i + dSpur] && artPasst(l.c, projekt.spuren[l.i + dSpur])) ? dSpur : 0;
  const aus = [];
  for (const l of lage) {
    const b = { befehl: 'clip_aendern', clip_id: l.c.id };
    const start = runde(l.c.start_beat + d);
    if (start !== l.c.start_beat) b.start_beat = start;
    if (ds !== 0) b.spur_id = projekt.spuren[l.i + ds].id;
    if (Object.keys(b).length > 2) aus.push(b);
  }
  return aus;
}

// Fades eines Audio-Clips nach einer Längenänderung: zusammen nie länger als der Clip (S2: fade_zu_lang)
function fadesFuer(clip, laenge) {
  const ein = Math.min(clip.fade_ein_beats, laenge);
  return { fade_ein_beats: ein, fade_aus_beats: Math.max(0, Math.min(clip.fade_aus_beats, runde(laenge - ein))) };
}
// nur geänderte Felder; null, wenn nichts anders ist
function nurAnders(clip, felder) {
  const b = { befehl: 'clip_aendern', clip_id: clip.id };
  for (const [k, v] of Object.entries(felder)) if (v !== clip[k]) b[k] = v;
  return Object.keys(b).length > 2 ? b : null;
}

// Rechten Rand ziehen: Ende rastet, Länge mindestens ein Rasterschritt (oder die bisherige, wenn sie kürzer ist). Bei einem Loop-Clip
// (Spec 6.17) zieht die rechte Kante laenge_beats, die Wiederholungen füllen sie; wird er kürzer als der Loop, geht loop_beats mit
// (S2: 1/16 ≤ loop_beats ≤ laenge_beats)
export function kuerzeRechts(clip, dBeat, raster) {
  const ende = rasten(clip.start_beat + clip.laenge_beats + dBeat, raster);
  const laenge = runde(Math.max(minLaenge(clip, raster), ende - clip.start_beat));
  const loop = istLoop(clip) ? { loop_beats: Math.min(clip.loop_beats, laenge) } : {};
  const b = nurAnders(clip, { laenge_beats: laenge, ...loop, ...(clip.art === 'audio' ? fadesFuer(clip, laenge) : {}) });
  return b ? [b] : [];
}

// Linken Rand ziehen: Anfang rastet, das Ende bleibt stehen. Audio: offset_s wandert mit (Sekunde im Clip = Beat · 60 / Tempo,
// kein Warp in D1), nie vor den Anfang der Quelle. MIDI: die Noten bleiben, wo sie im Projekt klingen (ihr beat ist relativ
// zum Clip und wandert gegenläufig); Noten, die vor dem neuen Anfang enden, werden gelöscht, angeschnittene gekürzt.
export function kuerzeLinks(clip, dBeat, raster, bpm) {
  if (istLoop(clip)) return [];   // Spec 6.17: der Loop beginnt immer am Clip-Anfang; ein neuer Anfang änderte jede Wiederholung (CLIP_TEXT.loop_links)
  const ende = clip.start_beat + clip.laenge_beats;
  let start = Math.min(rasten(clip.start_beat + dBeat, raster), ende - minLaenge(clip, raster));
  start = Math.max(0, start);
  if (clip.art === 'audio') start = Math.max(start, clip.start_beat - (clip.offset_s * bpm) / 60);
  start = runde(start);
  const d = runde(start - clip.start_beat);
  if (d === 0) return [];
  const laenge = runde(ende - start);
  if (clip.art === 'audio') {
    const b = nurAnders(clip, { start_beat: start, laenge_beats: laenge, offset_s: Math.max(0, runde(clip.offset_s + (d * 60) / bpm)), ...fadesFuer(clip, laenge) });
    return b ? [b] : [];
  }
  const aus = [{ befehl: 'clip_aendern', clip_id: clip.id, start_beat: start, laenge_beats: laenge }];
  const weg = [], neu = [];
  for (const n of clip.noten) {
    if (n.beat + n.laenge <= d + 1e-9) weg.push(n.id);
    else if (n.beat < d) neu.push({ id: n.id, beat: 0, laenge: runde(n.beat + n.laenge - d) });
    else neu.push({ id: n.id, beat: runde(n.beat - d) });
  }
  if (weg.length) aus.push({ befehl: 'noten_loeschen', clip_id: clip.id, ids: weg });
  if (neu.length) aus.push({ befehl: 'noten_aendern', clip_id: clip.id, noten: neu });
  return aus;
}

// Fade ziehen (nur Audio): Einblende nach rechts länger, Ausblende nach links länger; zusammen höchstens die Clip-Länge
export function zieheFade(clip, seite, dBeat) {
  if (clip.art !== 'audio') return [];
  const ein = seite === 'ein', alt = ein ? clip.fade_ein_beats : clip.fade_aus_beats, andere = ein ? clip.fade_aus_beats : clip.fade_ein_beats;
  const v = Math.max(0, Math.min(runde3(alt + (ein ? dBeat : -dBeat)), runde(clip.laenge_beats - andere)));
  const b = nurAnders(clip, { [ein ? 'fade_ein_beats' : 'fade_aus_beats']: v });
  return b ? [b] : [];
}

// Ein Zug im Arrangement: Zone des Treffers → Befehle
export function zugBefehle(projekt, treffer, auswahl, dBeat, dSpur, raster, bpm) {
  const c = treffer.clip;
  switch (treffer.zone) {
    case 'mitte': return verschiebe(projekt, auswahl.includes(c.id) ? auswahl : [c.id], c.id, dBeat, dSpur, raster);
    case 'links': return kuerzeLinks(c, dBeat, raster, bpm);
    case 'rechts': return kuerzeRechts(c, dBeat, raster);
    case 'fade_ein': return zieheFade(c, 'ein', dBeat);
    case 'fade_aus': return zieheFade(c, 'aus', dBeat);
    default: return [];
  }
}
export function zugLabel(zone, befehle) {
  const n = befehle.filter((b) => b.befehl === 'clip_aendern').length;
  if (zone === 'mitte') return n > 1 ? `Move ${n} clips` : 'Move clip';
  if (zone === 'fade_ein') return 'Fade in';
  if (zone === 'fade_aus') return 'Fade out';
  return 'Trim clip';
}

// Teilen am Beat (Startmarke): jeder gewählte Clip, der den Beat im Inneren hat; Loop-Clips nicht (Spec 6.17: S2 lehnt clip_teilen auf einem
// Loop-Clip mit argument_ungueltig ab, erst den Loop ausschalten), dafür meldet loopImWeg() den Text CLIP_TEXT.loop_teilen
const innen = (c, beat) => beat > c.start_beat + 1e-9 && beat < c.start_beat + c.laenge_beats - 1e-9;
export function teile(projekt, ids, beat) {
  const aus = [];
  for (const s of projekt?.spuren ?? []) for (const c of s.clips) {
    if (ids.includes(c.id) && !istLoop(c) && innen(c, beat)) aus.push({ befehl: 'clip_teilen', clip_id: c.id, beat });
  }
  return aus;
}
export const loopImWeg = (projekt, ids, beat) => (projekt?.spuren ?? []).some((s) => s.clips.some((c) => ids.includes(c.id) && istLoop(c) && innen(c, beat)));

// Clip-Loop (Spec 6.17): Schalter setzt loop_beats auf die aktuelle Länge bzw. null; Kacheln = Durchläufe [start, laenge] im Projekt
export const istLoop = (clip) => clip?.loop_beats != null;
export const schalteLoop = (clip) => ({ befehl: 'clip_aendern', clip_id: clip.id, loop_beats: istLoop(clip) ? null : clip.laenge_beats });
export const loopLabel = (clip) => (istLoop(clip) ? 'Loop off' : 'Loop on');
// Nur die Kacheln, die [von, bis) im Projekt berühren (Vorgabe: alle); kein Deckel (V2 Fix F5: vorher endeten sie still nach 4096)
export function kacheln(clip, von = -Infinity, bis = Infinity) {
  if (!istLoop(clip) || !(clip.loop_beats > 0)) return [{ start: clip.start_beat, laenge: clip.laenge_beats }];
  const l = clip.loop_beats, n = Math.ceil(clip.laenge_beats / l - 1e-9);
  const k0 = Math.max(0, Math.floor((von - clip.start_beat) / l + 1e-9)), k1 = Math.min(n, Math.ceil((bis - clip.start_beat) / l - 1e-9));
  const aus = [];
  for (let k = k0; k < k1; k++) {
    aus.push({ start: runde(clip.start_beat + k * l), laenge: runde(Math.min(l, clip.laenge_beats - k * l)) });
  }
  return aus;
}
// Duplizieren (Strg+D): die Auswahl als Block direkt hinter sich, jeder Clip um die Spanne der Auswahl versetzt
export function dupliziere(projekt, ids) {
  const cs = (projekt?.spuren ?? []).flatMap((s) => s.clips).filter((c) => ids.includes(c.id));
  if (cs.length === 0) return [];
  const spanne = Math.max(...cs.map((c) => c.start_beat + c.laenge_beats)) - Math.min(...cs.map((c) => c.start_beat));
  return cs.map((c) => ({ befehl: 'clip_duplizieren', clip_id: c.id, ziel_beat: runde(c.start_beat + spanne) }));
}
export const loesche = (ids) => ids.map((id) => ({ befehl: 'clip_loeschen', clip_id: id }));

// Doppelklick ins Leere einer Instrument-Spur: neuer MIDI-Clip, ein Takt, Anfang auf den Rasterschritt davor gerastet
export function neuerMidiClip(projekt, spurIndex, beat, raster) {
  const spur = projekt?.spuren?.[spurIndex];
  if (!spur) return { fehler: 'keine_spur' };
  if (spur.art !== 'instrument') return { fehler: 'keine_instrumentspur' };
  const g = raster > 0 ? raster : MIN_LAENGE;
  return { befehl: { befehl: 'clip_neu', spur_id: spur.id, art: 'midi', start_beat: runde(Math.max(0, Math.floor(beat / g + 1e-9) * g)), laenge_beats: MIDI_LAENGE } };
}
export const CLIP_TEXT = {
  keine_spur: 'Double click on a track',
  keine_instrumentspur: 'Double click makes MIDI clips on instrument tracks; samples are dragged from LIBRARY',
  nichts_zu_teilen: 'Select a clip and click inside it to set the split point',
  loop_teilen: 'Loop clip: turn the loop off before splitting',
  loop_links: 'Loop clip: the loop starts at the clip start; turn the loop off to trim the start',
};

// Detailbereich (Audio-Clip): ein Eingabefeld → ein clip_aendern oder ein Fehlertext. Komma als Dezimalzeichen erlaubt.
// Wertebereiche wie S2 (befehle.ts clip_aendern): gain −96..+24 dB (Spec 6.27, modell.ts GAIN_MAX), offset ≥ 0 s, Lagen ≥ 0, Länge > 0,
// Fades zusammen ≤ Länge.
export const FELDER = {
  gain_db: { min: -96, max: 24, text: 'Gain: −96 to +24 dB' },
  start_beat: { min: 0, max: 100000, text: 'Start: 0 or later' },
  laenge_beats: { min: 0, max: 100000, offen: true, text: 'Length: more than 0 beats' },
  offset_s: { min: 0, max: 1e7, text: 'Offset: 0 s or later' },
  fade_ein_beats: { min: 0, max: 100000, text: 'Fade in: 0 or longer' },
  fade_aus_beats: { min: 0, max: 100000, text: 'Fade out: 0 or longer' },
};
export function feldBefehl(clip, feld, eingabe) {
  const regel = FELDER[feld];
  if (!regel) return { fehler: `Unknown field ${feld}` };
  const v = Number(String(eingabe).trim().replace(',', '.'));
  if (String(eingabe).trim() === '' || !Number.isFinite(v) || v > regel.max || (regel.offen ? v <= regel.min : v < regel.min)) return { fehler: regel.text };
  const neu = { ...clip, [feld]: v };
  if (clip.art === 'audio' && neu.fade_ein_beats + neu.fade_aus_beats > neu.laenge_beats + 1e-9) return { fehler: 'The fades are longer than the clip' };
  return v === clip[feld] ? { befehl: null } : { befehl: { befehl: 'clip_aendern', clip_id: clip.id, [feld]: v } };
}
export const zahlText = (x, stellen = 3) => String(Math.round(x * 10 ** stellen) / 10 ** stellen);
