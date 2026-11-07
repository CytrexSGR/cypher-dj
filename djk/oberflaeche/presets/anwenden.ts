// Applying a preset (package 1.16 rest, decisions F1 and F1a, ENTSCHEIDUNGEN.md D25). No plugin reads preset folders: the server
// only COMPUTES a plan from the preset, the target and the open project, and the caller (page or hand) sends it through the
// existing routes, so undo, source, locks and refusals stay where they are:
//   {weg: 'proj', befehle, label, uebersprungen, hinweise?}   → one POST /proj/aendern (one undo step)
//   {weg: 'regler', anfragen: [{pfad, nach}], uebersprungen}  → one POST /regler per request (kern channel compressor D9, mix tools D22)
// Every parameter that cannot be carried is named in `uebersprungen`, never dropped silently. Pure: no file, no server.
import { alleInserts, INSERT_ARTEN_AKTIV, INSERT_WERT_NAMEN, sucheSpur, sucheStrang, type Projekt } from '../projekt/modell.ts';
import { INSERT_ARTEN } from '../projekt/insert_schluessel.ts';
import { RB_PARAMETER, BK_PARAMETER } from '../projekt/modell.ts';
import { rbNorm, rbPlain, RB_DEFS } from '../projekt/rb_abbildung.ts';
import { geraetVon, paramVon, type GeraetDef } from './geraete.ts';
import { PresetFehler, type Wert } from './modell.ts';

export type Ziel = { art: 'spur'; spur_id: string } | { art: 'insert'; insert_id: string } | { art: 'insert_neu'; strang_id: string } | { art: 'kanal'; kanal: string };
export interface AnzuwendenPreset { id: string; name: string; geraet: string; graph?: string; werte: Record<string, Wert> }
export type Plan =
  | { weg: 'proj'; befehle: Record<string, unknown>[]; label: string; uebersprungen: string[]; hinweise?: string[] }
  | { weg: 'regler'; anfragen: { pfad: string; nach: number }[]; uebersprungen: string[] };

const INSERT_GERAETE = ['komp', 'eq', 'saett'] as const;
// ENTSCHEIDUNGEN.md D9: the kern channel compressor (POST /regler <kanal>/komp/<feld>) carries six of the plugin's fields
// (page copy: oeffentlich/presets.js KERN_KOMP, pinned equal by tests/presets_anwenden_route.test.mjs)
export const KERN_KOMP: Readonly<Record<string, string>> = { thresh: 'schwelle', ratio: 'ratio', attack: 'attack', release: 'release', makeup: 'makeup', mix: 'mix' };
// Channel kinds as the page names them (oeffentlich/presets.js kanalArtVon)
export const kanalArtVon = (kanal: string): 'quelle' | 'bus' | null =>
  (/^(deck\/[1-4]|erz\/[1-7]|pad\/[12])$/.test(kanal) ? 'quelle' : /^bus\/[1-4]$/.test(kanal) ? 'bus' : null);

const zahlVon = (p: { def: GeraetDef['parameter'][number]['def'] } | undefined, w: Wert): number =>
  (typeof w === 'boolean' ? (w ? 1 : 0) : typeof w === 'string' ? (p?.def.art === 'auswahl' ? p.def.werte.indexOf(w) : Number.NaN) : w);

/** Plugin values of an insert kind → insert row values (INSERT_ARTEN[art].parameter[].geraet); enums by index, switches 1/0. */
export function insertWerteAusPreset(art: 'komp' | 'eq' | 'saett', werte: Record<string, Wert>): { werte: Record<string, number>; uebersprungen: string[] } {
  const g = geraetVon(art)!;
  const zeilen = INSERT_ARTEN[art].parameter.filter((q) => q.geraet !== null && (art !== 'komp' || INSERT_WERT_NAMEN.includes(q.name)));
  const aus: Record<string, number> = {}, uebersprungen: string[] = [];
  for (const [name, w] of Object.entries(werte)) {
    const q = zeilen.find((x) => x.geraet === name);
    if (!q) { uebersprungen.push(name); continue; }
    aus[q.name] = zahlVon(paramVon(g, name), w);
  }
  return { werte: aus, uebersprungen };
}

const gleich = (a: Record<string, number>, b: Record<string, number>): boolean =>
  Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => a[k] === b[k]);

export function planeAnwendung(preset: AnzuwendenPreset, ziel: Ziel, projekt: Projekt | null): Plan {
  const g = geraetVon(preset.geraet);
  if (!g) throw new PresetFehler(400, 'geraet_unbekannt');
  // hall: the plugin Cypher Hall has no running instance in PRODUCTION; the return hall is another device (spec finding 4)
  if (g.id === 'hall') throw new PresetFehler(409, 'kein_ziel');
  const z = ziel as Record<string, unknown>;
  const label = `Preset ${preset.name}`;
  if (z?.art === 'kanal') return kanalPlan(preset, g, String(z.kanal ?? ''));
  if (z?.art !== 'spur' && z?.art !== 'insert' && z?.art !== 'insert_neu') throw new PresetFehler(404, 'ziel_unbekannt');
  if (!projekt) throw new PresetFehler(409, 'kein_projekt');

  if (z.art === 'spur') {
    const s = typeof z.spur_id === 'string' ? sucheSpur(projekt, z.spur_id) : undefined;
    if (!s) throw new PresetFehler(404, 'ziel_unbekannt');
    const alt = s.geraet;
    let geraet: Record<string, unknown>, uebersprungen: string[] = [];
    if (g.id === 'rb338') {
      if (alt?.art !== 'intern' || alt.name !== 'rb338') throw new PresetFehler(409, 'geraet_passt_nicht');
      const parameter = { ...alt.parameter };
      for (const [name, w] of Object.entries(preset.werte)) {
        if (RB_PARAMETER.includes(name)) parameter[name] = rbNorm(name, w as number | boolean); else uebersprungen.push(name);
      }
      geraet = { art: 'intern', name: 'rb338', parameter, preset: preset.id };
    } else if (g.id === 'baukasten') {
      if (alt?.art !== 'intern' || alt.name !== 'bk') throw new PresetFehler(409, 'geraet_passt_nicht');
      if (alt.graph !== preset.graph) throw new PresetFehler(409, 'graph_anders');
      const parameter = { ...alt.parameter };
      for (const [name, w] of Object.entries(preset.werte)) {
        const m = /^knob([1-8])$/.exec(name);
        if (m && BK_PARAMETER.includes(`k${m[1]}`)) parameter[`k${m[1]}`] = w as number; else uebersprungen.push(name);   // lautstaerke: a bk track has none
      }
      geraet = { art: 'intern', name: 'bk', graph: alt.graph, parameter, preset: preset.id };
    } else throw new PresetFehler(409, 'geraet_passt_nicht');
    // a freeze is dropped when the device's values change (spur_aendern); say so before the write
    const hinweise = s.freeze && !gleich(alt.parameter, geraet.parameter as Record<string, number>) ? ['freeze_geht'] : undefined;
    return { weg: 'proj', befehle: [{ befehl: 'spur_aendern', spur_id: s.id, geraet }], label, uebersprungen, ...(hinweise ? { hinweise } : {}) };
  }

  if (!(INSERT_GERAETE as readonly string[]).includes(g.id)) throw new PresetFehler(409, 'geraet_passt_nicht');
  const art = g.id as (typeof INSERT_GERAETE)[number];
  if (z.art === 'insert') {
    const t = alleInserts(projekt).find((x) => x.insert.id === z.insert_id);
    if (!t) throw new PresetFehler(404, 'ziel_unbekannt');
    if (!(INSERT_ARTEN_AKTIV as readonly string[]).includes(art)) throw new PresetFehler(409, 'art_nicht_aktiv');
    if (t.insert.art !== art) throw new PresetFehler(409, 'geraet_passt_nicht');
    const { werte, uebersprungen } = insertWerteAusPreset(art, preset.werte);
    return { weg: 'proj', befehle: [{ befehl: 'insert_werte_setzen', insert_id: t.insert.id, werte, preset: preset.id }], label, uebersprungen };
  }
  const strang = typeof z.strang_id === 'string' ? sucheStrang(projekt, z.strang_id) : undefined;
  if (!strang) throw new PresetFehler(404, 'ziel_unbekannt');
  if (!(INSERT_ARTEN_AKTIV as readonly string[]).includes(art)) throw new PresetFehler(409, 'art_nicht_aktiv');
  const { werte, uebersprungen } = insertWerteAusPreset(art, preset.werte);
  return { weg: 'proj', befehle: [{ befehl: 'insert_setzen', strang_id: z.strang_id, pos: (strang.inserts ?? []).length, art, werte, preset: preset.id }], label, uebersprungen };
}

function kanalPlan(preset: AnzuwendenPreset, g: GeraetDef, kanal: string): Plan {
  const kanalArt = kanalArtVon(kanal);
  if (!kanalArt) throw new PresetFehler(404, 'ziel_unbekannt');
  const anfragen: { pfad: string; nach: number }[] = [], uebersprungen: string[] = [];
  if (g.id === 'komp') {                                  // D9: the kern channel compressor sits on source channels only
    if (kanalArt !== 'quelle') throw new PresetFehler(409, 'kanal_art');
    for (const [name, w] of Object.entries(preset.werte)) {
      if (KERN_KOMP[name]) anfragen.push({ pfad: `${kanal}/komp/${KERN_KOMP[name]}`, nach: zahlVon(paramVon(g, name), w) }); else uebersprungen.push(name);
    }
    return { weg: 'regler', anfragen, uebersprungen };
  }
  if (g.herkunft !== 'kern') throw new PresetFehler(409, 'geraet_passt_nicht');
  if (!g.kanalArten?.includes(kanalArt)) throw new PresetFehler(409, 'kanal_art');
  for (const [name, w] of Object.entries(preset.werte)) {
    const p = paramVon(g, name);
    if (p?.pfad) anfragen.push({ pfad: `${kanal}/${p.pfad}`, nach: zahlVon(p, w) }); else uebersprungen.push(name);
  }
  // Review 1.15 (the page copy in oeffentlich/presets.js carries the same rule): the tool's on switch (<tool>/an) goes last when it switches the tool on and first
  // when it switches it off, so the tool never runs with old settings while the preset is in flight. Integration: b1-115-abschluss changed only the page copy.
  const i = anfragen.findIndex((a) => a.pfad.endsWith('/an') && a.pfad.split('/').length === kanal.split('/').length + 2);
  if (i >= 0) {
    const [an] = anfragen.splice(i, 1);
    if (an.nach >= 0.5) anfragen.push(an); else anfragen.unshift(an);
  }
  return { weg: 'regler', anfragen, uebersprungen };
}

// POST /presets/von_ziel (T3a.4): the current values of a project target as a preset's `werte`, the inverse of the plan above.
// rb338: plain values through rbPlain (a parameter the track does not set gets the plugin default, the switch becomes a boolean);
// bk: knob1..knob8 from k1..k8 (absent = 0.5 in the kern) and the graph name; komp stage: the mapped rows back to plugin ids.
// A kern channel is saved through POST /presets with werte, as the page does today (D9, D22).
export function werteVonZiel(ziel: Ziel, projekt: Projekt | null): { geraet: string; graph?: string; werte: Record<string, Wert> } {
  const z = ziel as Record<string, unknown>;
  if (z?.art !== 'spur' && z?.art !== 'insert') throw new PresetFehler(404, 'ziel_unbekannt');
  if (!projekt) throw new PresetFehler(409, 'kein_projekt');
  if (z.art === 'spur') {
    const s = typeof z.spur_id === 'string' ? sucheSpur(projekt, z.spur_id) : undefined;
    if (!s) throw new PresetFehler(404, 'ziel_unbekannt');
    const g = s.geraet;
    if (g?.art === 'intern' && g.name === 'rb338') {
      const werte: Record<string, Wert> = {};
      for (const k of RB_PARAMETER) {
        const plain = g.parameter[k] === undefined ? RB_DEFS[k].vorgabe : rbPlain(k, g.parameter[k]);
        werte[k] = RB_DEFS[k].art === 'schalter' ? plain > 0.5 : plain;
      }
      return { geraet: 'rb338', werte };
    }
    if (g?.art === 'intern' && g.name === 'bk') {
      return { geraet: 'baukasten', graph: g.graph, werte: Object.fromEntries(BK_PARAMETER.map((k, i) => [`knob${i + 1}`, g.parameter[k] ?? 0.5])) };
    }
    throw new PresetFehler(409, 'geraet_passt_nicht');
  }
  const t = alleInserts(projekt).find((x) => x.insert.id === z.insert_id);
  if (!t) throw new PresetFehler(404, 'ziel_unbekannt');
  const art = t.insert.art;
  if (!(INSERT_GERAETE as readonly string[]).includes(art) || !(INSERT_ARTEN_AKTIV as readonly string[]).includes(art)) throw new PresetFehler(409, 'art_nicht_aktiv');
  // the inverse of insertWerteAusPreset: the rows of the stage back to plugin ids; enums by their text, switches as booleans (1.10 slice 4b: eq and saett as well)
  const kind = art as (typeof INSERT_GERAETE)[number], g = geraetVon(kind)!;
  const werte: Record<string, Wert> = {};
  for (const q of INSERT_ARTEN[kind].parameter) {
    if (!q.geraet || (kind === 'komp' && !INSERT_WERT_NAMEN.includes(q.name)) || t.insert.werte[q.name] === undefined) continue;
    const x = t.insert.werte[q.name], def = paramVon(g, q.geraet)?.def;
    werte[q.geraet] = def?.art === 'auswahl' ? (def.werte[x] ?? x) : def?.art === 'schalter' ? x > 0.5 : x;
  }
  return { geraet: kind, werte };
}
