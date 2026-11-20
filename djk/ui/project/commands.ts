// Befehle der Projekt-API (Spec 3.4, Abschnitt „Befehle in aendern") als reine Funktionen: Projekt → {projekt, vor, zurueck,
// betrifft_wiedergabe, regler_aenderungen}. Kein Server, kein Kern, keine Datei. Eine Ablehnung ist ein BefehlFehler mit `grund`.
// Ein Befehl ist ein flaches Objekt {befehl: '<name>', ...argumente}; unbekannte Argumente werden abgelehnt (kein stilles Schlucken).
// Die Patches entstehen aus dem Vergleich der Stände vor und nach dem Befehl (patch.ts), nicht von Hand je Befehl; `zurueck` ist der
// Vergleich in der Gegenrichtung (neu → alt), nicht ein Klon samt Umkehr.
// Mixer- und Kopfbefehle (Fader, Pan, Mute, Solo, Name, Farbe, Tempo, Loop, Metronom) laufen auf einem flachen Entwurf: nur die
// berührte Spur wird flach kopiert, Clips und Noten werden geteilt, es gibt weder Volltiefen-Klon noch Wiedergabe-Vergleich. Das ist
// die Bewegung, die der Verlauf zusammenfasst (Spec 6.5); `{voll: true}` erzwingt den allgemeinen Weg (Test: beide ergeben dasselbe).
// `rev` und `wiedergabe_rev` fasst kein Befehl an: sie zählt der Verlauf (history.ts).
import {
  MAX_AUTO_PUNKTE, MAX_FX_PUNKTE, MAX_LANE_PUNKTE, alleStraenge, FADER_MIN, MAX_CLIPS, MAX_NOTEN, MAX_RETURNS, HALL_FELDER, HALL_VORGABE, type InsertPoolArt,
  alleInserts, notenZaehler, sucheStrang, alleRacks, MAX_MAKROS, type Rack, bkSlot, bkLive, istObjekt, kanonisch, pruefeFehler, spurSicht, wiedergabeSicht,
  type AudioClip,
  type Gruppe, type Herkunft, type Insert, type Projekt, type Return, type Spur, type DekodiertZustand,
} from './model.ts';
import { INSERT_ARTEN } from './insert_key.ts';
import { unterschied, type Patch, pfadSegment } from './patch.ts';
import { hkPunkteZahl } from './envelope.ts';
import { faechertAus, weite, kopiereInhalt, mitglieder, raeumeVerbuende } from './verbund.ts';
import { MAX_WARP_PUNKTE, gainHkPunkte, relativeLanen, zaehleAusgerollt, zaehleFx, fxKollisionen, zaehleWarpMarker, type GeraetFxFn } from './playback.ts';
import {
  BefehlFehler, ab, laneRuhewerte, hatLaneRuhewerte, laneHinweise, GRUPPE_LEICHT, MIXER, PRO_BEFEHL, mergeTabellen, type ReglerAenderung, type StiftAenderung,
  type BefehlErgebnis, type LaneHinweis, type Befehl, type Args, type Kontext,
} from './commands_helpers.ts';
import { SPUR } from './commands_track.ts';
import { CLIP } from './commands_clip.ts';
import { GRUPPE } from './commands_group.ts';
import { INSERT } from './commands_insert.ts';
import { AUTO } from './commands_auto.ts';
import { TRANSPORT } from './commands_transport.ts';
import { SZENEN } from './commands_szenen.ts';
import { TRACKER } from './commands_tracker.ts';
export { BefehlFehler, bereinigeGliedZiele, DUCK_DURCH_KICK_WERTE, laneStart, COMP_FADE_S, teileClipsAn, compFade } from './commands_helpers.ts';
export type { ReglerAenderung, StiftAenderung, BefehlErgebnis, LaneHinweis, Befehl, PresetInhalt, MusterMeldung, PluginEintrag } from './commands_helpers.ts';
export { PRO_BEFEHL } from './commands_helpers.ts';

mergeTabellen(PRO_BEFEHL, SPUR, CLIP, GRUPPE, INSERT, AUTO, TRANSPORT, SZENEN, TRACKER);
export const BEFEHL_NAMEN: readonly string[] = Object.keys(PRO_BEFEHL);

// Ein eingefrorener Wirt-Spur-Klang gilt nur zu genau den Noten, dem Gerät und dem Tempo, mit denen er entstanden ist
// (Spec 3.3: Noten oder Gerät; Tempo ergänzt, weil das Audio in Sekunden fest ist und die Noten in Beats wandern).
// `Vorher` hält nur, was dafür nötig ist: Tempo und die Klang-Sicht der eingefrorenen Spuren. Ohne Freeze im Projekt kostet das nichts.
interface Vorher { tempo: number; sichten: Map<string, string> }
function merkeFreezes(p: Projekt): Vorher | null {
  const frozen = p.spuren.filter((s) => s.freeze);
  return frozen.length === 0 ? null : { tempo: p.tempo_bpm, sichten: new Map(frozen.map((s) => [s.id, kanonisch(spurSicht(s, false))])) };
}
function verwerfeFreezes(vorher: Vorher, neu: Projekt): void {
  for (const s of neu.spuren) {
    if (!s.freeze) continue;
    const alt = vorher.sichten.get(s.id);
    if (alt === undefined || vorher.tempo !== neu.tempo_bpm || alt !== kanonisch(spurSicht(s, false))) s.freeze = null;
  }
}

function pruefeBefehl(b: unknown): asserts b is Befehl {
  if (!istObjekt(b) || typeof b.befehl !== 'string' || !Object.hasOwn(PRO_BEFEHL, b.befehl)) {
    ab('befehl_unbekannt', istObjekt(b) && typeof b.befehl === 'string' ? b.befehl : 'kein Befehl');
  }
}
function wendeAn(entwurf: Projekt, b: unknown, ctx: Kontext): void {
  pruefeBefehl(b);
  const vorher = merkeFreezes(entwurf);
  if (faechertAus(b)) {
    // ADR 039: a content command on a member of a pattern runs on every member, at its turn inside the list (one undo step with the list)
    const boden = notenZaehler(entwurf);
    const cmds = weite(entwurf, b as Args);
    if (cmds.length === 1) PRO_BEFEHL[b.befehl](entwurf, b as Args, ctx);
    else if (b.befehl === 'clip_aus_muster') {          // generated once: the other members take the result (the same note ids)
      PRO_BEFEHL[b.befehl](entwurf, cmds[0] as Args, ctx);
      const ms = mitglieder(entwurf, (cmds[0] as Args).clip_id as string);
      for (const m of ms.slice(1)) kopiereInhalt(ms[0], m);
    } else for (const c of cmds) PRO_BEFEHL[b.befehl](entwurf, c as Args, { ...ctx, noteIdsAb: boden });
  } else {
    PRO_BEFEHL[b.befehl](entwurf, b as Args, ctx);
    raeumeVerbuende(entwurf);                            // a pattern left with one member loses its verbund (not on the note fast path: it shares clips)
  }
  if (vorher) verwerfeFreezes(vorher, entwurf);
}

const KURZ = { fader_db: 'fader', pan: 'pan', mute: 'mute', solo: 'solo' } as const;
// 1.10 slice 3: send controls spur|grp/<nr>/send/<r> (dB, -200 = absent), ret/<r>/{fader,pan,mute,solo} and ret/<r>/hall/*.
// A new or deleted return number sets the slot to the defaults; a deleted track or group sets its sends back to -200
// (also when a new strip takes its number in the same step: the rows are compared by number, not by id).
const HALL_PFAD = ['an', ...HALL_FELDER] as const;
const hallWert = (h: Return['hall'], k: (typeof HALL_PFAD)[number]): number => (k === 'an' ? (h.an ? 1 : 0) : h[k]);
function returnReglerAenderungen(alt: Projekt, neu: Projekt, aus: ReglerAenderung[]): void {
  const sendWerte = (st: Spur | Gruppe, p: Projekt): number[] => {
    const w = new Array<number>(MAX_RETURNS).fill(FADER_MIN);
    for (const sd of st.sends ?? []) { const r = (p.returns ?? []).find((x) => x.id === sd.id); if (r) w[r.nr - 1] = sd.db; }
    return w;
  };
  const strang = (kurz: string, a: (Spur | Gruppe)[], n: (Spur | Gruppe)[], pa: Projekt, pn: Projekt): void => {
    for (const st of n) {
      const vorher = a.find((x) => x.nr === st.nr);     // the core rows are keyed by number: a reused number is compared with its previous holder
      const w = sendWerte(st, pn), v = vorher ? sendWerte(vorher, pa) : new Array<number>(MAX_RETURNS).fill(FADER_MIN);
      w.forEach((x, i) => { if (x !== v[i]) aus.push({ pfad: `${kurz}/${st.nr}/send/${i + 1}`, wert: x }); });
    }
    for (const st of a) {
      if (n.some((x) => x.nr === st.nr)) continue;
      sendWerte(st, pa).forEach((x, i) => { if (x !== FADER_MIN) aus.push({ pfad: `${kurz}/${st.nr}/send/${i + 1}`, wert: FADER_MIN }); });
    }
  };
  strang('spur', alt.spuren, neu.spuren, alt, neu);
  strang('grp', alt.gruppen ?? [], neu.gruppen ?? [], alt, neu);
  const altR = alt.returns ?? [], neuR = neu.returns ?? [];
  const rw = (r: Return): number[] => [r.fader_db, r.pan, r.mute ? 1 : 0, r.solo ? 1 : 0];
  const RK = ['fader', 'pan', 'mute', 'solo'];
  for (const r of neuR) {
    const a = altR.find((x) => x.id === r.id && x.nr === r.nr);
    const w = rw(r), v = a ? rw(a) : null;
    w.forEach((x, i) => { if (!v || v[i] !== x) aus.push({ pfad: `ret/${r.nr}/${RK[i]}`, wert: x }); });
    const hallVorher = a ?? altR.find((x) => x.nr === r.nr);   // a number reused in this diff: the core still holds the deleted return's Hall (Audit U12)
    for (const k of HALL_PFAD) {
      const x = hallWert(r.hall, k), y = hallVorher ? hallWert(hallVorher.hall, k) : hallWert(HALL_VORGABE, k);
      if (x !== y) aus.push({ pfad: `ret/${r.nr}/hall/${k}`, wert: x });
    }
  }
  for (const a of altR) {
    if (neuR.some((r) => r.nr === a.nr)) continue;
    rw(a).forEach((_, i) => aus.push({ pfad: `ret/${a.nr}/${RK[i]}`, wert: 0 }));
    for (const k of HALL_PFAD) {
      const vorgabe = hallWert(HALL_VORGABE, k);
      if (hallWert(a.hall, k) !== vorgabe) aus.push({ pfad: `ret/${a.nr}/hall/${k}`, wert: vorgabe });
    }
  }
}

// 1.10 slice 4: the pooled rows ins/<art>/<slot>/* follow the stages by SLOT, not by strip: a slot that is free (or whose stage left) is at the
// defaults (an 0, the pool defaults, sc 0). Values first, `an` last when a stage turns on; `an` first when it turns off, so nothing sounds with stale values.
// Slice 4b: the same for eq, saett and lim (the contract names every row of the kind, the EQ band rows as 'b<m>/<parameter>').
// utility and bk last, as in the contract (arr-fx, arr-bk)
const INS_POOL: readonly InsertPoolArt[] = ['komp', 'eq', 'saett', 'lim', 'host', 'utility', 'bk'];
const INS_NAMEN = Object.fromEntries(INS_POOL.map((art) => [art, INSERT_ARTEN[art].parameter.map((q) => q.name)])) as Record<InsertPoolArt, string[]>;
const INS_VORGABE: Record<InsertPoolArt, Record<string, number>> = Object.fromEntries(
  INS_POOL.map((art) => [art, Object.fromEntries(INSERT_ARTEN[art].parameter.map((q) => [q.name, q.vorgabe]))])
) as Record<InsertPoolArt, Record<string, number>>;
function insertReglerAenderungen(alt: Projekt, neu: Projekt, aus: ReglerAenderung[]): void {
  for (const art of INS_POOL) {
    const zustand = (p: Projekt): Map<number, Record<string, number>> => new Map(alleInserts(p).filter((x) => x.insert.art === art)
      .map((x) => [x.insert.slot, { ...x.insert.werte, an: x.insert.an ? 1 : 0, ...(art === 'komp' ? { sc: x.insert.sc ?? 0 } : {}) }] as const));
    const a = zustand(alt), n = zustand(neu);
    for (const slot of [...new Set([...a.keys(), ...n.keys()])].sort((x, y) => x - y)) {
      const v = a.get(slot) ?? INS_VORGABE[art], w = n.get(slot) ?? INS_VORGABE[art];
      const geaendert = INS_NAMEN[art].filter((k) => v[k] !== w[k]);
      const pfad = (k: string): ReglerAenderung => ({ pfad: `ins/${art}/${slot}/${k}`, wert: w[k] });
      if (geaendert.includes('an') && w.an === 0) aus.push(pfad('an'));
      for (const k of geaendert) if (k !== 'an') aus.push(pfad(k));
      if (geaendert.includes('an') && w.an === 1) aus.push(pfad('an'));
    }
  }
}

// 1.10 slice 4c: the macro rows rack/<slot>/m1..m4 follow the racks by SLOT, like the insert rows: a free slot (or one whose rack left) is at the default 0.
function rackReglerAenderungen(alt: Projekt, neu: Projekt, aus: ReglerAenderung[]): void {
  const zustand = (p: Projekt): Map<number, number[]> => new Map(alleRacks(p).map((x) => [x.rack.slot, x.rack.werte] as const));
  const a = zustand(alt), n = zustand(neu);
  for (const slot of [...new Set([...a.keys(), ...n.keys()])].sort((x, y) => x - y)) {
    const v = a.get(slot) ?? [0, 0, 0, 0], w = n.get(slot) ?? [0, 0, 0, 0];
    for (let i = 0; i < MAX_MAKROS; i++) if (v[i] !== w[i]) aus.push({ pfad: `rack/${slot}/m${i + 1}`, wert: w[i] });
  }
}

// Welche Regler (spur/<nr>/…) müssen auf welchen Wert? Mute und Solo als 0/1.
function reglerAenderungen(alt: Projekt, neu: Projekt): ReglerAenderung[] {
  const werte = (s: Spur): Record<(typeof MIXER)[number], number> => ({ fader_db: s.fader_db, pan: s.pan, mute: s.mute ? 1 : 0, solo: s.solo ? 1 : 0 });
  const aus: ReglerAenderung[] = [];
  for (const s of neu.spuren) {
    const a = alt.spuren.find((x) => x.id === s.id && x.nr === s.nr);
    const w = werte(s), v = a ? werte(a) : null;
    for (const k of MIXER) if (!v || v[k] !== w[k]) aus.push({ pfad: `spur/${s.nr}/${KURZ[k]}`, wert: w[k] });
  }
  for (const a of alt.spuren) {
    if (neu.spuren.some((s) => s.nr === a.nr)) continue;                      // die Nummer lebt weiter (ggf. mit neuer Spur): oben erledigt
    for (const k of MIXER) aus.push({ pfad: `spur/${a.nr}/${KURZ[k]}`, wert: 0 });
  }
  // 1.10: Gruppen-Regler grp/<nr>/* und pm/fader; eine gelöschte oder neue Gruppe setzt den Slot auf die Vorgabe (alles 0) beziehungsweise auf ihre Werte
  const gw = (g: Gruppe): Record<(typeof MIXER)[number], number> => ({ fader_db: g.fader_db, pan: g.pan, mute: g.mute ? 1 : 0, solo: g.solo ? 1 : 0 });
  const altG = alt.gruppen ?? [], neuG = neu.gruppen ?? [];
  for (const g of neuG) {
    const a = altG.find((x) => x.id === g.id && x.nr === g.nr);
    const w = gw(g), v = a ? gw(a) : null;
    for (const k of MIXER) if (!v || v[k] !== w[k]) aus.push({ pfad: `grp/${g.nr}/${KURZ[k]}`, wert: w[k] });
  }
  for (const a of altG) {
    if (neuG.some((g) => g.nr === a.nr)) continue;
    for (const k of MIXER) aus.push({ pfad: `grp/${a.nr}/${KURZ[k]}`, wert: 0 });
  }
  if ((alt.master?.fader_db ?? 0) !== (neu.master?.fader_db ?? 0)) aus.push({ pfad: 'pm/fader', wert: neu.master?.fader_db ?? 0 });
  returnReglerAenderungen(alt, neu, aus);
  insertReglerAenderungen(alt, neu, aus);
  rackReglerAenderungen(alt, neu, aus);
  return aus;
}

// Gleich wie kanonisch(a) === kanonisch(b), ohne beide Seiten zu sortieren und zu serialisieren: Identisches ist gleich (geteilte Noten des
// Notenwegs kosten nichts), Objekte vergleichen ihre Schlüssel ohne Reihenfolge (undefined zählt wie in JSON als fehlend), Arrays der Reihe nach;
// alles andere (Zahlen, Text, null) über kanonisch selbst, damit -0, NaN und Co. genau wie dort ausgehen. Spec 6.31 (Leistung).
export function gleicheSicht(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!gleicheSicht(a[i], b[i])) return false;
    return true;
  }
  if (istObjekt(a) && istObjekt(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined), kb = Object.keys(b).filter((k) => b[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => b[k] !== undefined && gleicheSicht(a[k], b[k]));
  }
  if (istObjekt(a) || istObjekt(b)) return false;
  return kanonisch(a) === kanonisch(b);
}

// Was ein Stand dem Kern sagt: Wiedergabe neu nötig? Welche Regler müssen auf welchen Wert?
export function vergleiche(alt: Projekt, neu: Projekt): { betrifft_wiedergabe: boolean; regler_aenderungen: ReglerAenderung[] } {
  return { betrifft_wiedergabe: !gleicheSicht(wiedergabeSicht(alt), wiedergabeSicht(neu)), regler_aenderungen: reglerAenderungen(alt, neu) };
}

// --- Schneller Weg für Mixer- und Kopfbefehle --------------------------------------------------------------------------
const SPUR_LEICHT = ['name', 'farbe', 'fader_db', 'pan', 'mute', 'solo'];
function istLeicht(projekt: Projekt, b: unknown): boolean {
  if (!istObjekt(b) || typeof b.befehl !== 'string') return false;
  switch (b.befehl) {
    // ein Gerätewechsel berührt Freeze, Slots und Klang; gruppe kann neu entstehen, und leichterUnterschied sieht nur Schlüssel, die schon da sind
    case 'spur_aendern': return b.geraet === undefined && b.gruppe === undefined && b.arm === undefined && b.eingang === undefined && b.monitor === undefined;
    case 'loop_setzen': case 'metronom_setzen': return true;
    case 'gruppenspur_aendern': case 'master_aendern': return true;
    // slice 4: knob and bypass of a stage are live only (the key `sc` may add or remove a field, and `key` is structure, so both take the general path)
    case 'insert_param_setzen': return b.param !== 'sc' && b.param !== 'key';
    case 'insert_an': return true;
    // production plan task 9: a knob of a Baukasten track, live. Only the first BK_LIVE_SLOTS bk tracks have a core row; the 9th to 16th take the general path
    // (playback rebuild, no spur/ row). An unknown or non-bk id keeps this route: the handler raises the same error as before.
    case 'geraet_param_setzen': return typeof b.spur_id !== 'string' || bkSlot(projekt, b.spur_id) === null || bkLive(projekt, b.spur_id);
    // Kraken patch field: a pin is live only when the track is a bk track that already HAS a pin list and no freeze (the first pin takes the general
    // path so the graph
    // defaults are written into the list; a freeze would drop). An unknown or non-bk id keeps this route: the handler raises the same error as before.
    case 'geraet_stift_setzen': {
      if (typeof b.spur_id !== 'string') return true;
      const sp = projekt.spuren.find((x) => x.id === b.spur_id);
      if (!sp || !(sp.geraet?.art === 'intern' && sp.geraet.name === 'bk')) return true;
      return sp.geraet.stifte !== undefined && !sp.freeze;
    }
    case 'rack_makro': case 'makro_variation_laden': return true;   // slice 4c: the live macro value is a control change
    case 'tempo_setzen': return !projekt.spuren.some((s) => s.freeze);        // Tempo verwirft Freezes und ändert deren Länge in Beats
    default: return false;
  }
}

// Unterschied zweier Stände, soweit ihn leichte Befehle erzeugen können (Tempo, Loop, Metronom, flache Spur-Felder), in der Schlüsselfolge
// von `von` (dieselbe Reihenfolge wie `unterschied`, damit beide Wege dieselben Patches ergeben).
function leichterUnterschied(von: Projekt, nach: Projekt): Patch {
  const aus: Patch = [];
  const flach = (a: object, b: object, pfad: string, felder?: readonly string[]): void => {
    for (const k of Object.keys(a)) {
      if (felder && !felder.includes(k)) continue;
      const x = (a as Record<string, unknown>)[k], y = (b as Record<string, unknown>)[k];
      if (x !== y && !(Number.isNaN(x) && Number.isNaN(y))) aus.push({ op: 'replace', pfad: `${pfad}/${pfadSegment(k)}`, wert: y });
    }
  };
  // slice 4: the stages of a strip, only the fields the light commands write (`an` and the values), in the key order of `unterschied`
  const stufen = (a: { inserts?: Insert[]; rack?: Rack }, b: { inserts?: Insert[]; rack?: Rack }, pfad: string): void => {
    if (a.inserts !== b.inserts) {
      (a.inserts ?? []).forEach((x, i) => {
        const y = b.inserts![i];
        if (x === y) return;
        flach(x, y, `${pfad}/inserts/${x.id}`, ['an']);
        flach(x.werte, y.werte, `${pfad}/inserts/${x.id}/werte`);
      });
    }
    // slice 4c: the live macro values of the rack (the general path replaces the whole array)
    if (a.rack && b.rack && a.rack !== b.rack) flach(a.rack, b.rack, `${pfad}/rack`, ['werte']);
  };
  // production plan task 9: the knob values of a Baukasten device (geraet_param_setzen): a knob that is new is added, one that changed is replaced,
  // one that is gone is removed
  const bkKnoepfe = (a: Spur, b: Spur, pfad: string): void => {
    if (a.geraet === b.geraet || a.geraet?.art !== 'intern' || a.geraet.name !== 'bk' || b.geraet?.art !== 'intern' || b.geraet.name !== 'bk') return;
    const x = a.geraet.parameter, y = b.geraet.parameter;
    for (const k of Object.keys(y)) {
      if (!(k in x)) aus.push({ op: 'add', pfad: `${pfad}/geraet/parameter/${pfadSegment(k)}`, wert: y[k] });
      else if (x[k] !== y[k]) aus.push({ op: 'replace', pfad: `${pfad}/geraet/parameter/${pfadSegment(k)}`, wert: y[k] });
    }
    for (const k of Object.keys(x)) if (!(k in y)) aus.push({ op: 'remove', pfad: `${pfad}/geraet/parameter/${pfadSegment(k)}` });
    // Kraken patch field: the pin list is replaced as a whole by ONE patch (geraet_stift_setzen on the light path always had a list before), so a
    // drag of one pin stays
    // one patch and the undo coalescing (r.vor.length === 1) holds
    if (a.geraet.stifte !== b.geraet.stifte && a.geraet.stifte !== undefined && b.geraet.stifte !== undefined
      && kanonisch(a.geraet.stifte) !== kanonisch(b.geraet.stifte)) {
      aus.push({ op: 'replace', pfad: `${pfad}/geraet/stifte`, wert: b.geraet.stifte });
    }
  };
  for (const k of Object.keys(von)) {
    if (k === 'tempo_bpm') flach({ tempo_bpm: von.tempo_bpm }, { tempo_bpm: nach.tempo_bpm }, '');
    else if (k === 'loop' || k === 'metronom') flach(von[k], nach[k], `/${k}`);
    else if (k === 'spuren') {
      von.spuren.forEach((s, i) => {
        if (s === nach.spuren[i]) return;
        flach(s, nach.spuren[i], `/spuren/${s.id}`, SPUR_LEICHT); stufen(s, nach.spuren[i], `/spuren/${s.id}`);
        bkKnoepfe(s, nach.spuren[i], `/spuren/${s.id}`);
      });
    } else if (k === 'gruppen') {
      von.gruppen.forEach((g, i) => {
        if (g === nach.gruppen[i]) return;
        flach(g, nach.gruppen[i], `/gruppen/${g.id}`, GRUPPE_LEICHT); stufen(g, nach.gruppen[i], `/gruppen/${g.id}`);
      });
    }
    else if (k === 'returns') (von.returns ?? []).forEach((r, i) => { if (r !== nach.returns![i]) stufen(r, nach.returns![i], `/returns/${r.id}`); });
    else if (k === 'master') { flach(von.master, nach.master, '/master', ['fader_db']); stufen(von.master, nach.master, '/master'); }
  }
  return aus;
}

function fuehreLeichtAus(projekt: Projekt, befehle: unknown[]): BefehlErgebnis {
  const entwurf: Projekt = { ...projekt, loop: { ...projekt.loop }, metronom: { ...projekt.metronom }, spuren: [...projekt.spuren],
    ...(projekt.gruppen ? { gruppen: [...projekt.gruppen], master: { ...projekt.master } } : {}) };
  const kopiert = new Set<string>();
  if (projekt.returns) entwurf.returns = [...projekt.returns];
  // slice 4: copy the strip, its chain and the stage that a light insert command writes (everything else stays shared)
  const kopiereStufe = (id: string): void => {
    if (kopiert.has(id)) return;
    const t = alleInserts(entwurf).find((x) => x.insert.id === id);
    if (!t) return;
    const eigen = { ...t.strang, inserts: t.strang.inserts!.map((x) => (x === t.insert ? { ...x, werte: { ...x.werte } } : x)) };
    const in_ = (liste: { id: string }[] | undefined): void => {
      const k = liste?.findIndex((x) => x.id === t.strangId) ?? -1;
      if (liste && k >= 0) liste[k] = eigen as never;
    };
    if (t.strangId === 'master') entwurf.master = eigen as typeof entwurf.master;
    else { in_(entwurf.spuren); in_(entwurf.gruppen); in_(entwurf.returns); }
    kopiert.add(id);
  };
  // slice 4c: copy the strip and its rack for rack_makro
  const kopiereRack = (id: string): void => {
    const key = `rack:${id}`;
    if (kopiert.has(key)) return;
    const st = sucheStrang(entwurf, id);
    if (!st?.rack) return;
    const eigen = { ...st, rack: { ...st.rack, werte: [...st.rack.werte] } };
    const in_ = (liste: { id: string }[] | undefined): void => {
      const k = liste?.findIndex((x) => x.id === id) ?? -1;
      if (liste && k >= 0) liste[k] = eigen as never;
    };
    if (id === 'master') entwurf.master = eigen as typeof entwurf.master;
    else { in_(entwurf.spuren); in_(entwurf.gruppen); in_(entwurf.returns); }
    kopiert.add(key);
  };
  const hinweise: LaneHinweis[] = [];
  // production plan task 9: spur/<slot>/bk/<k> -> value, the last write of a knob wins; this is the only producer of such a row
  const bkZeilen = new Map<string, number>();
  // Kraken patch field: the pins to send, the last write of a position wins (a Map keeps the first insertion order, the value is overwritten)
  const stifte = new Map<string, StiftAenderung>();
  befehle.forEach((b, i) => {
    const vorher = hatLaneRuhewerte(entwurf) ? laneRuhewerte(entwurf) : null;
    try {
      const a = b as Args;
      if ((a.befehl === 'rack_makro' || a.befehl === 'makro_variation_laden') && typeof a.strang_id === 'string') kopiereRack(a.strang_id);
      if ((a.befehl === 'insert_param_setzen' || a.befehl === 'insert_an') && typeof a.insert_id === 'string') kopiereStufe(a.insert_id);
      if (a.befehl === 'spur_aendern' && typeof a.spur_id === 'string' && !kopiert.has(a.spur_id)) {
        const k = entwurf.spuren.findIndex((s) => s.id === a.spur_id);
        if (k >= 0) { entwurf.spuren[k] = { ...entwurf.spuren[k] }; kopiert.add(a.spur_id); }
      }
      // task 9: the track, its device and the knob map are written
      if (a.befehl === 'geraet_param_setzen' && typeof a.spur_id === 'string' && !kopiert.has(`geraet:${a.spur_id}`)) {
        const k = entwurf.spuren.findIndex((s) => s.id === a.spur_id);
        const g = k >= 0 ? entwurf.spuren[k].geraet : undefined;
        if (k >= 0) {
          entwurf.spuren[k] = { ...entwurf.spuren[k], ...(g?.art === 'intern' && g.name === 'bk' ? { geraet: { ...g, parameter: { ...g.parameter } } } : {}) };
          kopiert.add(`geraet:${a.spur_id}`);
        }
      }
      // Kraken patch field: the track, its device AND its pin list are copied once per track before the handler runs, so the original project is never mutated
      // (the handler assigns a new list, but a shared device object would still be written)
      if (a.befehl === 'geraet_stift_setzen' && typeof a.spur_id === 'string' && !kopiert.has(`stifte:${a.spur_id}`)) {
        const k = entwurf.spuren.findIndex((s) => s.id === a.spur_id);
        const g = k >= 0 ? entwurf.spuren[k].geraet : undefined;
        if (k >= 0) {
          const kopieG = g?.art === 'intern' && g.name === 'bk' ? { geraet: { ...g, ...(g.stifte ? { stifte: [...g.stifte] } : {}) } } : {};
            entwurf.spuren[k] = { ...entwurf.spuren[k], ...kopieG };
          kopiert.add(`stifte:${a.spur_id}`);
        }
      }
      if (a.befehl === 'gruppenspur_aendern' && typeof a.gruppe_id === 'string' && !kopiert.has(a.gruppe_id)) {
        const k = (entwurf.gruppen ?? []).findIndex((g) => g.id === a.gruppe_id);
        if (k >= 0) { entwurf.gruppen[k] = { ...entwurf.gruppen[k] }; kopiert.add(a.gruppe_id); }
      }
      PRO_BEFEHL[a.befehl](entwurf, a, { quelle: 'andreas' });          // nur Befehle ohne Herkunft (istLeicht)
      if (a.befehl === 'geraet_stift_setzen') {   // Kraken patch field: the handler accepted it, so the track is a bk track and the position is in range
        const nr = entwurf.spuren.find((x) => x.id === a.spur_id)!.nr;
        stifte.set(`${nr}:${a.satz}:${a.zeile}:${a.spalte}`, { nr, satz: a.satz, zeile: a.zeile, spalte: a.spalte, wert: a.wert });
      }
      if (a.befehl === 'geraet_param_setzen') {   // task 9: the handler accepted it, so the track is a bk track and the knob is k1..k64
        bkZeilen.set(`spur/${bkSlot(entwurf, a.spur_id)}/bk/${Number(a.param.slice(1))}`, a.wert);
      }
    } catch (e) { if (e instanceof BefehlFehler) e.index = i; throw e; }
    hinweise.push(...laneHinweise(vorher, entwurf, i));
  });
  return { projekt: entwurf, vor: leichterUnterschied(projekt, entwurf), zurueck: leichterUnterschied(entwurf, projekt),
    betrifft_wiedergabe: false, regler_aenderungen: [...reglerAenderungen(projekt, entwurf), ...[...bkZeilen].map(([pfad, wert]) => ({ pfad, wert }))],
    ...(hinweise.length ? { hinweise } : {}), ...(stifte.size ? { stift_aenderungen: [...stifte.values()] } : {}) };
}

// --- Notenweg (Spec 6.31, Leistung) ----------------------------------------------------------------------------------
// Eine Liste nur aus noten_neu, noten_aendern und noten_loeschen berührt nur die genannten Clips. Statt das ganze Projekt tief zu kopieren,
// bekommen nur ihre Spuren und Clips eine flache Kopie samt eigener Notenliste; alle anderen Spuren, Clips und Noten werden geteilt. Die Befehle
// verändern dabei keine geteilte Note (noten_aendern setzt ein neues Objekt, noten_neu hängt an die eigene Liste, noten_loeschen filtert), und
// unterschied/vergleiche sehen Geteiltes über die Identität. Ergebnis wie der volle Weg (Test: beide Wege, das Ausgangsprojekt bleibt gleich).
const NOTEN_BEFEHLE: ReadonlySet<unknown> = new Set(['noten_neu', 'noten_aendern', 'noten_loeschen']);
function notenEntwurf(projekt: Projekt, befehle: unknown[]): Projekt | null {
  const clips = new Set<string>();
  for (const b of befehle) {
    if (!istObjekt(b) || !NOTEN_BEFEHLE.has(b.befehl) || typeof b.clip_id !== 'string') return null;
    clips.add(b.clip_id);
  }
  for (const id of [...clips]) for (const m of mitglieder(projekt, id)) clips.add(m.id);   // ADR 039: the members of a pattern are written too
  return { ...projekt, loop: { ...projekt.loop }, metronom: { ...projekt.metronom },
    spuren: projekt.spuren.map((s) => (s.clips.some((c) => clips.has(c.id))
      ? { ...s, clips: s.clips.map((c) => (clips.has(c.id) && c.art === 'midi' ? { ...c, noten: [...c.noten] } : c)) } : s)) };
}

type TransientenQuelle = (sha256: string) => number[] | null;
// The checks every command list ends with (model validity, the core's limits after unrolling loops, warp markers); also the end of a recording.
export function pruefeGrenzen(entwurf: Projekt, o: { transienten?: TransientenQuelle; geraetFx?: GeraetFxFn } = {}): void {
  const fehler = pruefeFehler(entwurf);
  if (fehler !== null) ab('projekt_ungueltig', fehler);
  const g = zaehleAusgerollt(entwurf);                                         // Spec 6.17: die Grenzen gelten nach dem Ausrollen
  // Spec 6.34: englisch (der Text kam bisher deutsch an die Seite, die bei zu_gross den Text der Antwort zeigt)
  if (g.clips > MAX_CLIPS || g.noten > MAX_NOTEN) {
    ab('zu_gross', `after unrolling loops ${g.clips} clips, ${g.noten} notes (at most ${MAX_CLIPS}, ${MAX_NOTEN})`);
  }
  // Paket 1.13: Warp-Marker aller Kopien, Grenze wie im Kern (Slice 4: BEATS-Einheiten nach denselben Transienten wie uebersetze)
  const marker = zaehleWarpMarker(entwurf, o.transienten ? { transienten: o.transienten } : undefined);
  if (marker > MAX_WARP_PUNKTE) ab('zu_gross', `after unrolling loops ${marker} warp markers (at most ${MAX_WARP_PUNKTE})`);
  // tracker effect commands (task 14): the pitch and level events and the lanes they roll out to, after unrolling the loops (a project without fx: no cost)
  const fx = zaehleFx(entwurf, o.geraetFx);
  if (fx.events > MAX_FX_PUNKTE) ab('zu_gross', `after unrolling ${fx.events} pitch and level events (at most ${MAX_FX_PUNKTE})`);
  if (fx.breit && fx.breit.n > MAX_LANE_PUNKTE) {
    ab('zu_gross', `${fx.breit.spur}: the ${fx.breit.ziel} effect lane rolls out to ${fx.breit.n} points (at most ${MAX_LANE_PUNKTE})`);
  }
  // 1.12 slice 5 (D7): clip envelope points count with the lane points against MAX_AUTO_PUNKTE (once per repetition over the clip)
  let hk = 0, lanen = 0;
  // 1.12 slice 6: every strip carries lanes
  for (const { strang } of alleStraenge(entwurf)) for (const l of strang.automation ?? []) lanen += l.punkte.length;
  for (const s of entwurf.spuren) for (const c of s.clips) hk += hkPunkteZahl(c);
  if (fx.lanePunkte > 0 && lanen + fx.lanePunkte > MAX_AUTO_PUNKTE) {
    ab('zu_gross', `${lanen} lane points and ${fx.lanePunkte} effect lane points (at most ${MAX_AUTO_PUNKTE})`);
  }
  if (hk > 0 && hk + lanen > MAX_AUTO_PUNKTE) ab('zu_gross', `${lanen} lane points and ${hk} envelope points (at most ${MAX_AUTO_PUNKTE})`);
  // the modulation envelopes of a track merge into one relative lane per target (D9); the core takes at most MAX_LANE_PUNKTE points per lane.
  // The total counts the points as the translator writes them (gain_hk per copy, relative lanes): the roll-out adds points at every period edge.
  if (hk > 0) {
    let ausgerollt = 0;
    for (const s of entwurf.spuren) {
      for (const l of relativeLanen(s.clips)) {
        const n = l.punkte.length;
        if (n > MAX_LANE_PUNKTE) ab('zu_gross', `${s.id}: the ${l.ziel} modulation rolls out to ${n} points (at most ${MAX_LANE_PUNKTE})`);
        ausgerollt += l.punkte.length;
      }
      for (const c of s.clips) ausgerollt += gainHkPunkte(c);
    }
    if (ausgerollt + lanen > MAX_AUTO_PUNKTE) ab('zu_gross', `${lanen} lane points and ${ausgerollt} rolled-out envelope points (at most ${MAX_AUTO_PUNKTE})`);
  }
}
// Mehrere Befehle nacheinander (spätere sehen frühere); ein Gesamt-Patch von `projekt` zum Ergebnis. Eine Ablehnung verwirft alle.
// o.quelle: Herkunft für spur_neu (Spec 6.22), ohne Angabe andreas. o.voll: immer der allgemeine Weg (tiefe Kopie), für den Vergleich in Tests.
// o.transienten (Slice 4, D9): dieselbe Transienten-Quelle wie uebersetze, damit die Zählung der BEATS-Einheiten hier und dort gleich ist;
// ohne gilt Raster 1/16.
export function fuehreListeAus(projekt: Projekt, befehle: unknown[],
  o: { voll?: boolean; quelle?: Herkunft; transienten?: TransientenQuelle; graphArt?: Kontext['graphArt']; kitDa?: Kontext['kitDa'];
    presetLies?: Kontext['presetLies']; surgeBereich?: Kontext['surgeBereich']; surgeIst?: Kontext['surgeIst'];
    surgeFilter1An?: Kontext['surgeFilter1An']; surgePatchDa?: Kontext['surgePatchDa']; pluginDa?: Kontext['pluginDa'];
    pluginIndex?: Kontext['pluginIndex']; musterUebersetze?: Kontext['musterUebersetze']; kitKlaenge?: Kontext['kitKlaenge'];
    musterMeldung?: Kontext['musterMeldung']; geraetFx?: GeraetFxFn; steckfeldVon?: Kontext['steckfeldVon'] } = {}): BefehlErgebnis {
  if (!Array.isArray(befehle) || befehle.length === 0) ab('argument_ungueltig', 'befehle: nicht leere Liste erwartet');
  if (!o.voll && befehle.every((b) => istLeicht(projekt, b))) return fuehreLeichtAus(projekt, befehle);
  const entwurf = (o.voll ? null : notenEntwurf(projekt, befehle)) ?? structuredClone(projekt);
  const ctx: Kontext = { quelle: o.quelle ?? 'andreas', ...(o.graphArt ? { graphArt: o.graphArt } : {}), ...(o.kitDa ? { kitDa: o.kitDa } : {}),
    ...(o.presetLies ? { presetLies: o.presetLies } : {}), ...(o.surgeBereich ? { surgeBereich: o.surgeBereich } : {}),
    ...(o.surgeIst ? { surgeIst: o.surgeIst } : {}),
    ...(o.surgeFilter1An ? { surgeFilter1An: o.surgeFilter1An } : {}), ...(o.surgePatchDa ? { surgePatchDa: o.surgePatchDa } : {}),
    ...(o.pluginDa ? { pluginDa: o.pluginDa } : {}), ...(o.pluginIndex ? { pluginIndex: o.pluginIndex } : {}),
    ...(o.musterUebersetze ? { musterUebersetze: o.musterUebersetze } : {}), ...(o.kitKlaenge ? { kitKlaenge: o.kitKlaenge } : {}),
    ...(o.musterMeldung ? { musterMeldung: o.musterMeldung } : {}), ...(o.steckfeldVon ? { steckfeldVon: o.steckfeldVon } : {}) };
  const hinweise: LaneHinweis[] = [];
  befehle.forEach((b, i) => {
    const vorher = hatLaneRuhewerte(entwurf) ? laneRuhewerte(entwurf) : null;
    try { wendeAn(entwurf, b, ctx); } catch (e) { if (e instanceof BefehlFehler) e.index = i; throw e; }
    hinweise.push(...laneHinweise(vorher, entwurf, i));
  });
  pruefeGrenzen(entwurf, o);
  // a role lane of the effect commands would replace a lane the track holds (the playback lets the role lane win): refuse what the list newly creates
  const kollision = fxKollisionen(entwurf, o.geraetFx);
  if (kollision.size > 0) {
    const alt = fxKollisionen(projekt, o.geraetFx);
    const neu = [...kollision].find((k) => !alt.has(k));
    if (neu !== undefined) {
      const [spur, ziel] = neu.split('/');
      ab('fx_lane_kollision',
        `${spur}: the effect commands drive ${ziel} and would replace the lane the track holds for it; delete the lane or the commands first`);
    }
  }
  return { projekt: entwurf, vor: unterschied(projekt, entwurf), zurueck: unterschied(entwurf, projekt), ...vergleiche(projekt, entwurf),
    ...(hinweise.length ? { hinweise } : {}) };
}
export const fuehreAus = (projekt: Projekt, befehl: unknown): BefehlErgebnis => fuehreListeAus(projekt, [befehl]);

// Abgleich der Audio-Clips mit dem Dekodier-Cache (Spec 2.8: Zustand je Clip). Kein Befehl und kein Undo-Eintrag: der Zustand ist
// abgeleitet und steht nie in einem Patch (Spec 6.6). Ändert sich etwas, steigt rev um 1; ändert sich nichts, kommt dasselbe Objekt zurück.
export function gleicheDekodiertAb(p: Projekt, zustandVon: (sha256: string) => DekodiertZustand): Projekt {
  let anders = false;
  for (const c of alleAudioClips(p)) if (zustandVon(c.quelle.sha256) !== c.dekodiert) anders = true;
  if (!anders) return p;
  const q = structuredClone(p);
  setzeDekodiert(q, zustandVon);
  q.rev += 1;
  return q;
}
// Setzt den Zustand aller Audio-Clips in `p` selbst (ohne rev). Nach Undo/Redo und beim Nachziehen aus dem Log ruft der Verlauf das über
// den Haken `dekodiert`, weil Patches den echten Zustand nicht tragen.
export function setzeDekodiert(p: Projekt, zustandVon: (sha256: string) => DekodiertZustand): void {
  for (const c of alleAudioClips(p)) c.dekodiert = zustandVon(c.quelle.sha256);
}
// 1.14 comping (R9): the audio clips of the main lanes and of the take lanes; a take clip is decoded like a main clip
export function* alleAudioClips(p: Projekt): Generator<AudioClip> {
  for (const s of p.spuren) {
    for (const c of s.clips) if (c.art === 'audio') yield c;
    for (const t of s.takes ?? []) for (const c of t.clips) yield c;
  }
}
