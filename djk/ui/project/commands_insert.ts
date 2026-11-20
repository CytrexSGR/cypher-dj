// Return, send and insert chain commands, device parameters, presets and the sound snapshot of the project API (handler table of commands.ts, moved unchanged).
// The handlers reach each other through PRO_BEFEHL (commands_helpers.ts) at call time; commands.ts merges the tables.
import {
  istRbGeraet, FADER_MAX, FADER_MIN, MAX_RETURNS, HALL_VORGABE, INSERT_ARTEN_AKTIV, insertWertParameter, type InsertPoolArt, MAX_INSERTS_PRO_STRANG,
  MAX_INS, alleInserts, insertVorgabe, sucheStrang, makroVon, BK_GRAPH_NAME, BK_PARAMETER, SPUR_FARBEN, SURGE_PARAMETER_MAX, istObjekt, neueId,
  sucheSpur, type Gruppe, type Insert, type Return, type Send, type Spur, MAX_LATENZ_EXTRA,
} from './model.ts';
import { bkSetzen } from './modular.ts';
import { normaleStifte, stiftFehler, stiftEinzelFehler, STIFT_SAETZE, type Stift } from '../steckfeld.ts';
import { wendeAn as richtungAnwenden } from './direction.ts';
import { pruefeStammbaum, type Stammbaum } from './sound_runde_contract.ts';   // find sound: the family tree of a track
import { presetZuParameter } from './rb_mapping.ts';
import {
  ab, erlaube, zahlOk, zahl, flagge, text, hallArg, idArg, spurVon, returnVon, strangKennung, rackBereinigen, hostSetzen, insertVon,
  DUCK_DURCH_KICK_WERTE, schluesselArg, schluesselDef, FARBE_OK, presetArg, PRO_BEFEHL, type Args, type Kontext, type Handler,
} from './commands_helpers.ts';

// refusal detail of an unknown werte key; `an` is a parameter of the table but a new stage is on and switches with insert_an
const werteName = (k: string): string => (k === 'an' ? 'werte.an (a new stage is on; switch it with insert_an)' : `werte.${k}`);

// preset ids of the RB-338 as the register prints them: <herkunft>:rb338/<slug> (presets/model.ts SLUG)
const RB_PRESET_ID = /^(?:werk|nutzer):rb338\/[a-z0-9][a-z0-9-]{0,47}$/;

const BK_LIVE_KNOEPFE = 64;   // k1..k64 have a core row spur/<slot>/bk/<k> (SPUR_BK_KNOEPFE; 32 until 2026-11-16, production plan task 9)

// arr-bk slice 3: the graph of a bk stage. The name rule always applies; with ctx.graphArt (the server injects a lookup into the graph folder)
// an unknown graph and
// an instrument graph (no `eingang` node) are refused with the reason in the text, the mirror of the check for an instrument track (baueBkGeraet).
function bkEffektGraph(g: unknown, ctx?: Kontext): string {
  if (g === undefined) ab('argument_ungueltig', 'graph: an effect graph name is required for art bk (list them with the graphen tool: art effekt)');
  if (typeof g !== 'string' || !BK_GRAPH_NAME.test(g)) ab('argument_ungueltig', 'graph: graph name expected ([a-z0-9_-], 1..32 characters)');
  const art = ctx?.graphArt?.(g);
  if (ctx?.graphArt && art === null) ab('argument_ungueltig', `graph: unknown graph ${g} (list the graphs with the graphen tool)`);
  if (art === 'instrument') {
    ab('argument_ungueltig', `graph: ${g} is an instrument graph (it has no input node), an effect graph is expected (graphen tool, art effekt)`);
  }
  return g;
}

// A value of an insert stage by the range of its contract row. One more rule that the range cannot say: `mono_unter` of the utility is 0 (off) or at least 1 Hz
// (the core treats 1 to 19 as 20 Hz, the page shows "off" below 1), so 0 < v < 1 is refused instead of switching the bass mono on while the page says off.
function insertZahl(art: InsertPoolArt, q: { min: number; max: number; ganz?: boolean; name: string }, o: Args, k: string): number {
  const v = zahl(o, k, q.min, q.max, { ganz: q.ganz })!;
  if (art === 'utility' && q.name === 'mono_unter' && v > 0 && v < 1) ab('argument_ungueltig', `${k}: 0 (off) or 1..500 Hz expected (1 to 19 act as 20 Hz)`);
  return v;
}

export const INSERT = {
  // 1.10 slice 3: returns (the Hall is a part of the return) and sends. A send is an entry {id: <return id>, db} of a track or group; -200 removes it.
  // arr-bk slice 4: `effekt` {graph, werte?} makes an EFFECT return: the Hall is off and the chain carries one bk stage with that effect graph
  // (the shipped standard case is the tempo-synchronous stereo delay fx-delay-sync). Without `effekt` the return keeps the Cypher Hall as before.
  // The send level into the return is send_setzen as always.
  return_neu(p, a, ctx) {
    erlaube(a, 'name', 'farbe', 'hall', 'effekt');
    if (a.effekt !== undefined && a.hall !== undefined) ab('argument_ungueltig', 'effekt and hall exclude each other: an effect return has no Hall');
    if (a.effekt !== undefined && !istObjekt(a.effekt)) ab('argument_ungueltig', 'effekt: object {graph, werte?} expected');
    const rl = p.returns ?? [];
    if (rl.length >= MAX_RETURNS) ab('routing_grenze', `all ${MAX_RETURNS} returns are used`);
    const nr = Array.from({ length: MAX_RETURNS }, (_, i) => i + 1).find((n) => !rl.some((r) => r.nr === n)) ?? ab('routing_grenze', 'no free return number');
    if (a.farbe !== undefined && (typeof a.farbe !== 'string' || !FARBE_OK.test(a.farbe))) ab('argument_ungueltig', 'farbe: #rrggbb erwartet');
    const name = text(a, 'name', 80);
    const hall = { ...HALL_VORGABE };
    hallArg(a.hall, hall);
    const r: Return = { id: neueId(p, 'return'), nr, name: name ?? `Return ${nr}`, farbe: a.farbe ?? SPUR_FARBEN[(nr + 3) % SPUR_FARBEN.length],
      fader_db: 0, pan: 0, mute: false, solo: false, hall };
    if (a.effekt !== undefined) r.hall.an = false;
    p.returns = [...rl, r].sort((x, y) => x.nr - y.nr);
    if (a.effekt !== undefined) {
      const e = a.effekt as Args;
      for (const k of Object.keys(e)) if (k !== 'graph' && k !== 'werte') ab('argument_unbekannt', `effekt.${k}`);
      const stufe: Args = { befehl: 'insert_setzen', strang_id: r.id, pos: 0, art: 'bk', graph: e.graph, ...(e.werte !== undefined ? { werte: e.werte } : {}) };
      PRO_BEFEHL.insert_setzen(p, stufe, ctx);
    }
  },

  return_aendern(p, a) {
    erlaube(a, 'return_id', 'name', 'farbe', 'fader_db', 'pan', 'mute', 'solo', 'hall', 'pre');
    const r = returnVon(p, idArg(a, 'return_id'));
    const felderRet = ['name', 'farbe', 'fader_db', 'pan', 'mute', 'solo', 'hall', 'pre'];
    if (felderRet.every((k) => a[k] === undefined)) ab('argument_ungueltig', 'keine Änderung angegeben');
    const name = text(a, 'name', 80);
    if (a.farbe !== undefined && (typeof a.farbe !== 'string' || !FARBE_OK.test(a.farbe))) ab('argument_ungueltig', 'farbe: #rrggbb erwartet');
    const fader = zahl(a, 'fader_db', FADER_MIN, FADER_MAX, { opt: true }), pan = zahl(a, 'pan', -1, 1, { opt: true });
    const mute = flagge(a, 'mute', true), solo = flagge(a, 'solo', true), pre = flagge(a, 'pre', true);
    const hall = { ...r.hall };
    hallArg(a.hall, hall);                                           // validates the whole object before anything is written
    if (name !== undefined) r.name = name;
    if (a.farbe !== undefined) r.farbe = a.farbe;
    if (fader !== undefined) r.fader_db = fader;
    if (pan !== undefined) r.pan = pan;
    if (mute !== undefined) r.mute = mute;
    if (solo !== undefined) r.solo = solo;
    if (pre === true) r.pre = true; else if (pre === false) delete r.pre;   // absent = post (slice 4)
    r.hall = hall;
  },

  return_loeschen(p, a) {   // every send to it goes in the same step, never an orphan; the stellwerk slots go back to the defaults (reglerAenderungen)
    erlaube(a, 'return_id');
    const r = returnVon(p, idArg(a, 'return_id'));
    for (const st of [...p.spuren, ...(p.gruppen ?? [])]) {
      if (!st.sends) continue;
      st.sends = st.sends.filter((x) => x.id !== r.id);
      if (st.sends.length === 0) delete st.sends;
    }
    p.returns = (p.returns ?? []).filter((x) => x.id !== r.id);
    if (p.returns.length === 0) delete p.returns;
    // slice 5: a key on this return would dangle
    for (const x of alleInserts(p)) if (x.insert.key?.quelle === 'ret' && x.insert.key.nr === r.nr) delete x.insert.key;
  },

  send_setzen(p, a) {
    erlaube(a, 'strang_id', 'return_id', 'db');
    const id = idArg(a, 'strang_id');
    const strang: Spur | Gruppe = sucheSpur(p, id) ?? (p.gruppen ?? []).find((g) => g.id === id) ?? ab('spur_unbekannt', id);
    const r = returnVon(p, idArg(a, 'return_id'));
    const db = zahl(a, 'db', FADER_MIN, FADER_MAX)!;
    const rest = (strang.sends ?? []).filter((x) => x.id !== r.id);
    if (db > FADER_MIN) rest.push({ id: r.id, db });
    const nr = (x: Send): number => (p.returns ?? []).find((y) => y.id === x.id)?.nr ?? 0;
    rest.sort((x, y) => nr(x) - nr(y));
    if (rest.length) strang.sends = rest; else delete strang.sends;
  },

  // 1.10 slice 4: the insert chain of a strip (track, group, return, 'master'). Stages carry a pooled slot (lowest free of the kind, project-wide).
  // Default `insert_setzen` INSERTS at `pos` (later stages move back; a chain of five refuses with kette_voll); `ersetzen: true` replaces the stage at `pos`.
  insert_setzen(p, a, ctx) {
    if (a.art === 'host') return hostSetzen(p, a, ctx);
    erlaube(a, 'strang_id', 'pos', 'art', 'werte', 'sc', 'key', 'ersetzen', 'preset', 'graph');
    const preset = presetArg(a.preset, 'preset');
    const art = a.art;
    if (typeof art !== 'string' || !(INSERT_ARTEN_AKTIV as readonly string[]).includes(art)) ab('art_unbekannt', String(art));
    const id = idArg(a, 'strang_id');
    const strang = sucheStrang(p, id) ?? ab('spur_unbekannt', id);
    const pos = zahl(a, 'pos', 0, MAX_INSERTS_PRO_STRANG - 1, { ganz: true })!;
    const ersetzen = flagge(a, 'ersetzen', true) ?? false;
    const pool = art as InsertPoolArt;
    const werte = insertVorgabe(pool);
    const wp = insertWertParameter(pool);
    if (a.werte !== undefined) {
      if (!istObjekt(a.werte)) ab('argument_ungueltig', 'werte: Objekt erwartet');
      for (const k of Object.keys(a.werte)) if (!wp.some((q) => q.name === k)) ab('argument_unbekannt', werteName(k));
      for (const q of wp) {
        if (a.werte[q.name] !== undefined) werte[q.name] = insertZahl(pool, q, a.werte as Args, q.name);
      }
    }
    const graph = pool === 'bk' ? bkEffektGraph(a.graph, ctx) : undefined;
    if (pool !== 'bk' && a.graph !== undefined) ab('argument_unbekannt', `graph: only a bk stage has a graph (${art})`);
    if (pool !== 'komp' && a.sc !== undefined) ab('argument_unbekannt', `sc: only the compressor has a key (${art})`);
    if (pool !== 'komp' && a.key !== undefined) ab('argument_unbekannt', `key: only the compressor has a key (${art})`);
    if (a.sc !== undefined && a.key !== undefined && a.key !== null) ab('argument_ungueltig', 'sc and key exclude each other: a stage has one key at most');
    const liste = [...(strang.inserts ?? [])];
    if (ersetzen) {
      if (pos >= liste.length) ab('argument_ungueltig', `pos: no stage to replace at ${pos}`);
      liste.splice(pos, 1);
    } else {
      if (pos > liste.length) ab('argument_ungueltig', `pos: at most ${liste.length} (no gaps in the chain)`);
      if (liste.length >= MAX_INSERTS_PRO_STRANG) ab('kette_voll', `all ${MAX_INSERTS_PRO_STRANG} stages of ${id} are used`);
    }
    const belegt = new Set(alleInserts(p).filter((x) => x.insert.art === art && !(ersetzen && x.insert === strang.inserts![pos])).map((x) => x.insert.slot));
    const slot = Array.from({ length: MAX_INS[art] }, (_, i) => i + 1).find((n) => !belegt.has(n))
      ?? ab('ins_voll', `all ${MAX_INS[art]} ${art} stages are used`);
    const gestuft = ersetzen ? strang.inserts![pos] : undefined;   // a replaced stage does not count as an edge of the track order
    const def = schluesselDef(p, id, a.key, gestuft);
    const sc = def && 'sc' in def ? def.sc : schluesselArg(p, a.sc, id, gestuft);
    const insert: Insert = { id: neueId(p, 'insert'), art: art as Insert['art'], slot, an: true, werte, ...(sc > 0 ? { sc } : {}),
      ...(def && 'key' in def ? { key: def.key } : {}), ...(graph !== undefined ? { graph } : {}), ...(preset !== undefined ? { preset } : {}) };
    liste.splice(pos, 0, insert);
    strang.inserts = liste;
    rackBereinigen(strang);   // a replaced stage takes its mappings with it
  },

  insert_param_setzen(p, a) {
    erlaube(a, 'insert_id', 'param', 'wert');
    const { strang, insert } = insertVon(p, idArg(a, 'insert_id'));
    const param = a.param;
    if (param === 'sc') {
      if (insert.art !== 'komp') ab('argument_unbekannt', `param: sc (only the compressor has a key; ${insert.art})`);
      if (a.wert === undefined) ab('argument_ungueltig', 'wert: fehlt');
      const sc = schluesselArg(p, a.wert, strangKennung(p, strang), insert);
      if (sc > 0) insert.sc = sc; else delete insert.sc;
      delete insert.key;   // slice 5 (E8): a stage has one key at most; the row key replaces a structural one (a structure change, see istLeicht)
      return;
    }
    if (param === 'key') {   // slice 5: every other source; null removes the structural key
      if (insert.art !== 'komp') ab('argument_unbekannt', `param: key (only the compressor has a key; ${insert.art})`);
      if (a.wert === undefined) ab('argument_ungueltig', 'wert: fehlt');
      const def = schluesselDef(p, strangKennung(p, strang), a.wert, insert);
      if (def === null) delete insert.key;
      else if ('sc' in def) { if (def.sc > 0) insert.sc = def.sc; else delete insert.sc; delete insert.key; }
      else { insert.key = def.key; delete insert.sc; }
      return;
    }
    const q = typeof param === 'string' ? insertWertParameter(insert.art as InsertPoolArt).find((x) => x.name === param) : undefined;
    if (!q) return ab('argument_unbekannt', `param: ${String(param)}`);
    const gemappt = makroVon(strang, insert.id, q.name);   // slice 4c (spec D13, Q4): one writer per parameter
    if (gemappt) {
      const wo = `macro ${gemappt.nr} of the rack of ${strangKennung(p, strang)}`;
      ab('param_gemappt', `${insert.id}.${q.name} is driven by ${wo}; remove the mapping first (rack_setzen)`);
    }
    insert.werte[q.name] = insertZahl(insert.art as InsertPoolArt, q, a, 'wert');
  },

  // Production plan task 9: one knob k1..k64 of a Baukasten track, live (no new playback). The core row spur/<slot>/bk/<k> that carries the value
  // to the instance while the knob is dragged is added by fuehreLeichtAus (the only producer of such a row); a knob beyond the live range
  // would stay on the release path (spur_aendern).
  geraet_param_setzen(p, a) {
    erlaube(a, 'spur_id', 'param', 'wert');
    const spur = spurVon(p, idArg(a, 'spur_id'));
    const param = a.param;
    if (typeof param !== 'string' || !BK_PARAMETER.includes(param)) ab('argument_unbekannt', `param: ${String(param)} (k1..k${BK_LIVE_KNOEPFE})`);
    if (!(spur.geraet?.art === 'intern' && spur.geraet.name === 'bk')) ab('geraet_falsch', `${spur.id} is not a Baukasten track`);
    if (Number((param as string).slice(1)) > BK_LIVE_KNOEPFE) {
      ab('param_nicht_live', `${String(param)}: only k1..k${BK_LIVE_KNOEPFE} are live, change the others with spur_aendern`);
    }
    if (!zahlOk(a.wert) || a.wert < 0 || a.wert > 1) ab('argument_ungueltig', 'wert: Zahl 0..1 erwartet');
    (spur.geraet as { parameter: Record<string, number> }).parameter[param as string] = a.wert;
  },

  // Kraken patch field (task 4): one pin of the matrix block of a Baukasten track. [satz 0|1, zeile 0..15, spalte 0..15, wert -1..1], wert 0 removes the pin.
  // A device without `stifte` first takes the graph's default pins from ctx.steckfeldVon (D5: a stored list replaces the defaults entirely, so the defaults
  // must be written into it before the first pin); no lookup or no matrix node: kein_steckfeld. Light (live, no rebuild) only when the list is already there
  // (istLeicht); the light path hands this handler a copy of the track, its device and its list, and the handler assigns a NEW array.
  geraet_stift_setzen(p, a, ctx) {
    erlaube(a, 'spur_id', 'satz', 'zeile', 'spalte', 'wert');
    const spur = spurVon(p, idArg(a, 'spur_id'));
    if (!(spur.geraet?.art === 'intern' && spur.geraet.name === 'bk')) ab('geraet_falsch', `${spur.id} is not a Baukasten track`);
    const satz = zahl(a, 'satz', 0, STIFT_SAETZE - 1, { ganz: true })!, zeile = zahl(a, 'zeile', 0, 15, { ganz: true })!;
      const spalte = zahl(a, 'spalte', 0, 15, { ganz: true })!;
    if (!zahlOk(a.wert) || a.wert < -1 || a.wert > 1) ab('argument_ungueltig', 'wert: number -1..1 expected');
    const g = spur.geraet;
    let liste = g.stifte;
    if (!liste) {
      const sf = ctx?.steckfeldVon?.(g.graph);
      if (!sf) ab('kein_steckfeld', `${g.graph}: no matrix node (or no graph lookup here)`);
      liste = sf!.stifte;
    }
    g.stifte = normaleStifte([...liste, [satz, zeile, spalte, a.wert]]);
  },
  // Kraken patch field: a whole pin list. `stifte: null` = back to the graph defaults (the field is deleted; `satz` must then be absent). With
  // `satz` only that set
  // is replaced (every entry must carry that satz), the other set is kept; without `satz` the list replaces everything. Never light: up to 512 pins would
  // overrun the core command ring, so it reaches the core as a playback.
  geraet_stifte_setzen(p, a, ctx) {
    erlaube(a, 'spur_id', 'satz', 'stifte');
    const spur = spurVon(p, idArg(a, 'spur_id'));
    if (!(spur.geraet?.art === 'intern' && spur.geraet.name === 'bk')) ab('geraet_falsch', `${spur.id} is not a Baukasten track`);
    const g = spur.geraet;
    if (!('stifte' in a)) ab('argument_ungueltig', 'stifte: list or null expected');
    const satz = a.satz === undefined ? undefined : zahl(a, 'satz', 0, STIFT_SAETZE - 1, { ganz: true });
    if (a.stifte === null) {
      if (satz !== undefined) ab('argument_ungueltig', 'satz: must be absent when stifte is null');
      delete g.stifte;
      return;
    }
    if (!Array.isArray(a.stifte)) ab('argument_ungueltig', 'stifte: list or null expected');
    if (a.stifte.length > 512) ab('argument_ungueltig', 'stifte: at most 512 entries');
    (a.stifte as unknown[]).forEach((e, i) => {
      const f = stiftEinzelFehler(e, `stifte[${i}]`);
      if (f) ab('argument_ungueltig', f);
      if (satz !== undefined && (e as Stift)[0] !== satz) ab('argument_ungueltig', `stifte[${i}]: satz ${(e as Stift)[0]} but the command sets satz ${satz}`);
    });
    const neu = normaleStifte(a.stifte as Stift[]);
    if (stiftFehler(neu) !== null) ab('argument_ungueltig', stiftFehler(neu)!);
    if (satz === undefined) { g.stifte = neu; return; }
    const alt = g.stifte ?? ctx?.steckfeldVon?.(g.graph)?.stifte;
    if (!alt) ab('kein_steckfeld', `${g.graph}: no matrix node (or no graph lookup here)`);
    g.stifte = normaleStifte([...alt!.filter((e) => e[0] !== satz), ...neu]);
  },

  // find sound: the family tree of a Baukasten track (null removes it). Project data only: spurSicht omits it, so the playback is not rebuilt;
  // general path (not in istLeicht). The tree is not bound to geraet.graph here, so a graph change stays possible; readers ignore a foreign tree.
  stammbaum_setzen(p, a) {
    erlaube(a, 'spur_id', 'stammbaum');
    const spur = spurVon(p, idArg(a, 'spur_id'));
    if (!(spur.geraet?.art === 'intern' && spur.geraet.name === 'bk')) ab('geraet_falsch', `${spur.id} is not a Baukasten track`);
    if (a.stammbaum === null) { delete spur.stammbaum; return; }
    const f = pruefeStammbaum(a.stammbaum);
    if (f.length) ab('argument_ungueltig', f[0]);
    spur.stammbaum = structuredClone(a.stammbaum as Stammbaum);
  },

  // plan 1.11 T7 (D4): the user's addition to the latency of a host stage, 0..MAX_LATENZ_EXTRA samples (0 = the field is absent)
  insert_latenz_extra(p, a) {
    erlaube(a, 'insert_id', 'samples');
    const { insert } = insertVon(p, idArg(a, 'insert_id'));
    if (insert.art !== 'host') ab('argument_ungueltig', `insert_id: ${insert.id} is not a host stage (${insert.art})`);
    const n = zahl(a, 'samples', 0, MAX_LATENZ_EXTRA, { ganz: true })!;
    if (n === 0) delete insert.latenz_extra; else insert.latenz_extra = n;
  },

  insert_an(p, a) {
    erlaube(a, 'insert_id', 'an');
    const { insert } = insertVon(p, idArg(a, 'insert_id'));
    insert.an = flagge(a, 'an')!;
  },

  // 1.10 slice 5 (plan E12): "Duck by Kick" in one gesture. A `komp` stage on `spur_id` with the values of the Kick Sidechain preset
  // (DUCK_DURCH_KICK_WERTE) keyed by the
  // input of the kick track (`sc` = its number, the track `pre` key of E8 a). `pos` defaults to the end of the chain. One command, so one undo step.
  duck_durch_kick(p, a, ctx) {
    erlaube(a, 'spur_id', 'kick_id', 'pos');
    const spur = spurVon(p, idArg(a, 'spur_id'));
    const kick = spurVon(p, idArg(a, 'kick_id'));
    if (kick === spur) ab('argument_ungueltig', 'kick_id: the kick track must be another track than spur_id');
    const laenge = spur.inserts?.length ?? 0;
    if (a.pos === undefined && laenge >= MAX_INSERTS_PRO_STRANG) ab('kette_voll', `all ${MAX_INSERTS_PRO_STRANG} stages of ${spur.id} are used`);
    PRO_BEFEHL.insert_setzen(p, { befehl: 'insert_setzen', strang_id: spur.id, pos: a.pos ?? laenge, art: 'komp',
      werte: { ...DUCK_DURCH_KICK_WERTE }, sc: kick.nr }, ctx);
  },

  insert_entfernen(p, a) {
    erlaube(a, 'insert_id');
    const { strang, insert } = insertVon(p, idArg(a, 'insert_id'));
    const rest = (strang.inserts ?? []).filter((x) => x !== insert);
    if (rest.length) strang.inserts = rest; else delete strang.inserts;   // the slot goes back to the pool; the rows reset through reglerAenderungen
    rackBereinigen(strang);
  },

  insert_ordnung(p, a) {
    erlaube(a, 'strang_id', 'reihenfolge');
    const id = idArg(a, 'strang_id');
    const strang = sucheStrang(p, id) ?? ab('spur_unbekannt', id);
    const jetzt = strang.inserts ?? [];
    const r = a.reihenfolge;
    if (!Array.isArray(r) || r.length !== jetzt.length || new Set(r).size !== r.length || !r.every((x) => jetzt.some((i) => i.id === x))) {
      ab('argument_ungueltig', `reihenfolge: a permutation of the ${jetzt.length} stage IDs of ${id} expected`);
    }
    if (jetzt.length) strang.inserts = r.map((x) => jetzt.find((i) => i.id === x)!);
  },

  // 1.16 rest (F1, F8): several values of one stage in one command (one undo step, used by an applied preset), plus its preset origin
  // (`preset` id sets it, null clears it). Names, ranges and steps are those of the stage's kind as insert_setzen has them (compressor, EQ, saturator);
  // `an` and the key `sc` are never touched. A value that a rack macro drives is refused like insert_param_setzen does (param_gemappt). Controls only.
  insert_werte_setzen(p, a) {
    erlaube(a, 'insert_id', 'werte', 'preset');
    const { strang, insert } = insertVon(p, idArg(a, 'insert_id'));
    if (!istObjekt(a.werte)) ab('argument_ungueltig', 'werte: Objekt erwartet');
    const werte = a.werte as Args;
    const wp = insertWertParameter(insert.art as InsertPoolArt);
    for (const k of Object.keys(werte)) if (!wp.some((q) => q.name === k)) ab('argument_unbekannt', werteName(k));
    const preset = a.preset === null ? null : presetArg(a.preset, 'preset');
    if (Object.keys(werte).length === 0 && preset === undefined) ab('argument_ungueltig', 'werte: at least one value, or a preset');
    const neu: Record<string, number> = {};
    for (const q of wp) {
      if (werte[q.name] === undefined) continue;
      const gemappt = makroVon(strang, insert.id, q.name);   // slice 4c (spec D13, Q4): one writer per parameter
      if (gemappt) {
        ab('param_gemappt',
          `${insert.id}.${q.name} is driven by macro ${gemappt.nr} of the rack of ${strangKennung(p, strang)}; remove the mapping first (rack_setzen)`);
      }
      neu[q.name] = insertZahl(insert.art as InsertPoolArt, q, werte, q.name);
    }
    Object.assign(insert.werte, neu);
    if (preset === null) delete insert.preset; else if (preset !== undefined) insert.preset = preset;
  },

  // 1.9 U4 (O28, E6): description to sound. A word of the device's direction table (project/direction.ts) moves the parameters of the track's
  // device by bounded steps (0.12 x staerke). One command is one undo step; the label is the caller's (`<word> <track name>` by convention).
  geraet_richtung(p, a, ctx) {
    erlaube(a, 'spur_id', 'wort', 'staerke');
    const s = spurVon(p, idArg(a, 'spur_id'));
    if (typeof a.wort !== 'string' || a.wort === '') ab('argument_ungueltig', 'wort: a direction word is expected');
    const rb = s.art === 'instrument' && istRbGeraet(s.geraet);
    const surge = s.art === 'instrument' && s.geraet?.art === 'wirt' && s.geraet.name === 'surge' ? s.geraet : null;
    const name = rb ? 'rb338' : surge ? 'surge' : s.art === 'audio' ? 'audio' : s.geraet?.art === 'intern' ? s.geraet.name
      : s.geraet?.art === 'wirt' ? 'plugin' : (s.geraet?.art ?? 'none');
    // Surge (U5): the map holds display values; a parameter it does not hold yet starts from the host's current value (ctx.surgeIst, read by the server)
    const umfeld = surge ? { bereich: ctx.surgeBereich ?? (() => null), ist: (n: string) => ctx.surgeIst?.(surge.slot, n) ?? null,
      filter1An: () => ctx.surgeFilter1An?.(surge.slot) ?? null } : undefined;
    const alt = rb ? (s.geraet as { parameter: Record<string, number> }).parameter : surge ? { ...(surge.parameter ?? {}) } : {};
    const r = richtungAnwenden(name, alt, a.wort, a.staerke ?? 1, umfeld);
    if ('grund' in r) {
      if (r.grund === 'richtung_unbekannt') ab('richtung_unbekannt', r.text);
      if (r.grund === 'richtung_grenze') ab('richtung_grenze', r.text);
      if (r.grund === 'wirt_wert_unbekannt') ab('wirt_wert_unbekannt', r.text);
      if (r.grund === 'richtung_wirkungslos') ab('richtung_wirkungslos', r.text);
      ab('argument_ungueltig', r.text);
    } else if (surge) {
      if (Object.keys(r.parameter).length > SURGE_PARAMETER_MAX) ab('argument_ungueltig', `the Surge map holds at most ${SURGE_PARAMETER_MAX} entries`);
      surge.parameter = r.parameter;
    } else (s.geraet as { parameter: Record<string, number> }).parameter = r.parameter;
  },

  // 1.9 U4 (O28, E8): a factory or user preset of the RB-338 becomes the track's parameter object (display units → the core's 0..1, rb_mapping.ts).
  // The object is replaced as a whole: a parameter the preset does not name goes back to the plugin default,
  // so the result does not depend on what the track held before.
  preset_anwenden(p, a, ctx) {
    erlaube(a, 'spur_id', 'preset');
    const s = spurVon(p, idArg(a, 'spur_id'));
    const id = idArg(a, 'preset');
    if (!RB_PRESET_ID.test(id)) ab('argument_ungueltig', 'preset: an id like werk:rb338/dark-dub is expected (werk or nutzer, device rb338, a slug)');
    if (s.art !== 'instrument' || !istRbGeraet(s.geraet)) ab('argument_ungueltig', `${s.id}: only an RB-338 track takes an RB-338 preset`);
    const preset = ctx.presetLies?.(id) ?? null;
    if (preset === null || preset.geraet !== 'rb338') ab('preset_unbekannt', id);
    let parameter: Record<string, number>;
    try { parameter = presetZuParameter(preset!.werte); } catch (e) { return ab('argument_ungueltig', `${id}: ${(e as Error).message}`); }
    (s.geraet as { parameter: Record<string, number> }).parameter = parameter;
    (s.geraet as { preset?: string }).preset = id;   // merge with 1.16 rest: the device remembers the preset it came from, as presets_anwenden does
  },

  bk_setzen(p, a) {   // S17: sound snapshot entry (project/modular.ts); no playback, no controls
    const r = bkSetzen(p.baukasten, a);
    if ('grund' in r) ab(r.grund, r.text);
    else if (r.liste.length) p.baukasten = r.liste; else delete p.baukasten;
  },
} satisfies Record<string, Handler>;
