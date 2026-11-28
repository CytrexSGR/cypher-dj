// Automation lane and envelope commands of the project API (handler table of commands.ts, moved unchanged).
// The handlers reach each other through PRO_BEFEHL (commands_helpers.ts) at call time; commands.ts merges the tables.
import {
  AUTO_ZIELE, MAX_LANES_PRO_SPUR, MAX_KETTEN_LANEN, istGeraetZiel, passtGeraetZiel, normalisiereLane, punktePruefung, istKettenZiel, istBlendZiel,
  istSendZiel, sendZielVon, sendZielBereich, istPluginZiel, pluginZielVon, pluginZielBereich, pluginLanen, MAX_PLUGIN_LANEN,
  blendPfad, zerlegeKettenZiel, kettenZielBereich, zielBereichVon, alleStraenge, type Lane, type Punkt, MAX_BEAT, insertWertParameter,
  type InsertPoolArt, sucheStrang, makroFaehig, makroVon, istObjekt, neueId, sucheSpur, type InsertTraeger, type Return, type Spur,
  MAX_MODULATOREN, MOD_FELDER_NUR, MOD_TAKT_VORGABE, modulatorenPruefung, type Modulator,
} from './model.ts';
import { huellkurvePruefung, type Huellkurve } from './envelope.ts';
import { FORMEN_EINFUEGEN, bereichVereinfacht, dehne, formBereich, formPunkte, neige, setzeForm, type FormEinfuegen } from './lane_tools.ts';
import {
  ab, erlaube, zahl, idArg, spurVon, strangKennung, laneVon, laneBereichVon, laneBereich, laneSchreibe, laneStart, clipVon, returnVon, type Args, type Handler,
} from './commands_helpers.ts';

export const AUTO = {
  // --- Automation Slice 1 (ADR 032, D8): Lanes sind Projektdaten; jeder Befehl ist ein Undo-Schritt (Patch über `unterschied`) ---
  auto_neu(p, a) {
    erlaube(a, 'spur_id', 'strang_id', 'ziel', 'punkte');
    // 1.12 slice 6: a chain lane (`insert.<id>.<param>`, `rack.m1..m4`) lives on the strip that carries the stage or rack: a track by `spur_id`, or any
    // strip (track, group, return, 'master') by `strang_id`; a device lane (fader, pan, ...) is always a track's
    if (a.spur_id !== undefined && a.strang_id !== undefined) ab('argument_ungueltig', 'spur_id and strang_id: give one of them');
    const strang: InsertTraeger = a.strang_id !== undefined
      ? (sucheStrang(p, idArg(a, 'strang_id')) ?? ab('spur_unbekannt', String(a.strang_id)))
      : spurVon(p, idArg(a, 'spur_id'));
    const kennung = strangKennung(p, strang);
    if (a.ziel === undefined) ab('argument_ungueltig', 'ziel: fehlt');
    const kettig = istKettenZiel(a.ziel);
    const pluginZiel = istPluginZiel(a.ziel);
    if (pluginZiel) {   // strand 2 slice 1: a parameter of a host stage on this strip (track, group, return, master, like chain lanes)
      const z = pluginZielVon(a.ziel as string)!;
      if (!pluginZielBereich(strang, a.ziel as string)) ab('ziel_unbekannt', `${String(a.ziel)} (no host stage ${z.insert} on ${kennung})`);
      if (!(strang.automation ?? []).some((l) => l.ziel === a.ziel) && pluginLanen(strang, z.insert).length >= MAX_PLUGIN_LANEN) {
        ab('plugin_lanen_voll', `${z.insert} on ${kennung} has ${MAX_PLUGIN_LANEN} plugin lanes`);
      }
    } else if (istBlendZiel(a.ziel)) {   // live modules decision 7: the blend lane lives on the stem group it names, nowhere else
      const g = (p.gruppen ?? []).find((x) => x.id === (strang as { id?: string }).id);
      if (!g || a.ziel !== `blend:${g.id}` || blendPfad(p, g.id) === null) {
        ab('ziel_unbekannt', `${a.ziel} (only on a stem group with a new path, as blend:<its id>)`);
      }
    } else if (istSendZiel(a.ziel)) {   // send automation: the level of an existing send of a TRACK into a return (not of a group, return or master)
      if (sucheSpur(p, kennung) !== strang) ab('ziel_unbekannt', `${a.ziel} (a send lane belongs to a track; ${kennung} is not one)`);
      const rid = returnVon(p, sendZielVon(a.ziel)!).id;
      if (!sendZielBereich(strang, a.ziel)) ab('ziel_unbekannt', `${a.ziel} (no send into the return ${rid} on ${kennung}: set the send first)`);
    } else if (!kettig && !(AUTO_ZIELE as readonly unknown[]).includes(a.ziel)) {
      ab('ziel_unbekannt',
        `${String(a.ziel)} (${AUTO_ZIELE.join(' | ')} | insert.<stage id>.<param> | rack.m1..m4 | send.<return id> | plugin.<host stage id>.<index>)`);
    }
    const s = strang as Spur;
    // return fader lane: a return also takes `fader` (the volume of the return strip); the master and groups take no volume curve, and no
    // other device target belongs to a return
    const istReturn = (p.returns ?? []).includes(strang as Return);
    const geraetig = !kettig && !pluginZiel && !istBlendZiel(a.ziel) && !istSendZiel(a.ziel);   // a device lane: fader, pan, mute, solo, geraet.*
    if (geraetig && !(a.ziel === 'fader' && istReturn) && (strang === p.master || sucheSpur(p, kennung) !== strang)) {
      ab('ziel_unbekannt', a.ziel === 'fader'
        ? `fader (the master and groups take no volume curve: a fader lane belongs to a track or a return; ${kennung} is neither)`
        : `${String(a.ziel)} (a device lane belongs to a track${istReturn ? ' (a return takes a fader lane only)' : ''}; ${kennung} is not one)`);
    }
    if (geraetig && istGeraetZiel(a.ziel as string) && !(s.art === 'instrument' && passtGeraetZiel(a.ziel as string, s.geraet))) {
      ab('ziel_unbekannt', `${String(a.ziel)} (only on a track whose device has that parameter: RB-338 lautstaerke, cutoff, resonanz, env_mod; bk k1 to k64)`);
    }
    if (kettig) {
      const k = zerlegeKettenZiel(a.ziel as string)!;
      if ('makro' in k) {
        if (!strang.rack) ab('rack_unbekannt', `${kennung} has no rack (${String(a.ziel)})`);
      } else {
        const st = (strang.inserts ?? []).find((x) => x.id === k.insert) ?? ab('insert_unbekannt', `${k.insert} is no stage of the chain of ${kennung}`);
        if (st.art === 'host') ab('ziel_unbekannt', `${String(a.ziel)} (a host stage keeps its own parameters)`);
        if (!insertWertParameter(st.art as InsertPoolArt).some((x) => x.name === k.param)) {
          ab('argument_unbekannt', `${String(a.ziel)}: no parameter ${k.param} on a ${st.art} stage`);
        }
        if (!makroFaehig(st.art as InsertPoolArt, k.param)) {
          ab('param_nicht_stetig', `${String(a.ziel)}: a lane drives continuous parameters, not a switch or a step list`);
        }
        const gemappt = makroVon(strang, st.id, k.param);   // one writer per parameter (spec D13)
        if (gemappt) {
          ab('param_gemappt', `${st.id}.${k.param} is driven by macro ${gemappt.nr} of the rack of ${kennung}; `
            + `remove the mapping first (rack_setzen) or automate the macro (rack.m${gemappt.nr})`);
        }
      }
      if (!kettenZielBereich(strang, a.ziel as string)) ab('ziel_unbekannt', String(a.ziel));
    }
    if ((strang.automation ?? []).some((l) => l.ziel === a.ziel)) ab('lane_doppelt', `${kennung} ${a.ziel}`);
    // plugin lanes have their own limit (MAX_PLUGIN_LANEN per host stage, above) and do not count against the strip's
    if (!pluginZiel && (strang.automation ?? []).filter((l) => !istPluginZiel(l.ziel)).length >= MAX_LANES_PRO_SPUR) {
      ab('zu_gross', `at most ${MAX_LANES_PRO_SPUR} lanes per strip`);
    }
    if (kettig && alleStraenge(p).reduce((n, x) => n + (x.strang.automation ?? []).filter((l) => istKettenZiel(l.ziel)).length, 0) >= MAX_KETTEN_LANEN) {
      ab('zu_gross', `at most ${MAX_KETTEN_LANEN} insert and rack lanes in the project`);
    }
    // eine Lane mit leerer Punktliste ist verboten: zwei Punkte an der Loop-Klammer mit dem Grundwert der Spur
    // slice 3 (D16): optional `punkte` bring the lane and its points in one command (a recorded take), checked like any lane
    // a plugin lane starts at 0.5: the plugin's current value lives in the host process and is not known synchronously here
    const ziel = a.ziel as string, wert = pluginZiel ? 0.5 : laneStart(strang, ziel);
    let start: Punkt[] = [{ beat: p.loop.von_beat, wert }, { beat: p.loop.bis_beat, wert }];
    if (a.punkte !== undefined) {
      const f = punktePruefung(a.punkte, ziel, zielBereichVon(ziel, strang)!);
      if (f) ab(f.grund, f.text);
      start = (a.punkte as Punkt[]).map((q) => ({ ...q }));
    }
    const lane: Lane = { id: neueId(p, 'lane'), ziel: ziel as Lane['ziel'], punkte: start };
    normalisiereLane(lane);
    strang.automation = [...(strang.automation ?? []), lane];
  },

  auto_punkte(p, a) {
    erlaube(a, 'lane_id', 'setze', 'loesche_von', 'loesche_bis');
    const { spur: traeger, lane } = laneVon(p, idArg(a, 'lane_id'));
    const bereich = laneBereichVon(traeger, lane);
    const von = zahl(a, 'loesche_von', -Infinity, Infinity, { opt: true }), bis = zahl(a, 'loesche_bis', -Infinity, Infinity, { opt: true });
    if (a.setze !== undefined && !Array.isArray(a.setze)) ab('argument_ungueltig', 'setze: Liste erwartet');
    const setze = (a.setze ?? []) as unknown[];
    if (setze.length === 0 && von === undefined && bis === undefined) {
      ab('argument_ungueltig', 'keine Änderung angegeben (setze, loesche_von oder loesche_bis)');
    }
    const neu: Punkt[] = setze.map((x, i) => {
      if (!istObjekt(x)) return ab('argument_ungueltig', `setze[${i}]: Objekt erwartet`);
      erlaube(x as Args, 'beat', 'wert', 'form');
      return { ...(x as unknown as Punkt) };
    });
    for (const [i, q] of neu.entries()) {          // Wert und Beat des einzelnen Punkts: dieselbe Prüfung wie im Modell
      const f = punktePruefung([q], lane.ziel, bereich);
      if (f) ab(f.grund, f.text.replace(/^punkte\[0\]/, `setze[${i}]`));
    }
    // erst löschen (beide Enden inklusiv, fehlt eines, ist die Seite offen), dann setzen: ein gesetzter Punkt ersetzt alle Punkte an seinem Beat
    const imBereich = (q: Punkt): boolean => (von !== undefined || bis !== undefined)
      && (von === undefined || q.beat >= von) && (bis === undefined || q.beat <= bis);
    const bleibt = lane.punkte.filter((q) => !imBereich(q) && !neu.some((n) => n.beat === q.beat));
    const alle = [...bleibt, ...neu].map((q, i) => ({ q, i })).sort((x, y) => x.q.beat - y.q.beat || x.i - y.i).map((x) => x.q);
    const f = punktePruefung(alle, lane.ziel, bereich);
    if (f) ab(f.grund, f.text);
    lane.punkte = alle;
    normalisiereLane(lane);
  },

  // slice 2 (E4): the lock; `gesperrt: false` deletes the key (an unlocked lane never carries it), one undo step
  auto_aendern(p, a) {
    erlaube(a, 'lane_id', 'gesperrt');
    const lane = laneVon(p, idArg(a, 'lane_id'), true).lane;
    if (typeof a.gesperrt !== 'boolean') ab('argument_ungueltig', 'gesperrt: true or false expected');
    if (a.gesperrt) lane.gesperrt = true; else delete lane.gesperrt;
  },

  auto_loeschen(p, a) {
    erlaube(a, 'lane_id');
    const { spur, lane } = laneVon(p, idArg(a, 'lane_id'));
    const rest = (spur.automation ?? []).filter((l) => l !== lane);
    if (rest.length > 0) spur.automation = rest; else delete spur.automation;     // eine leere Liste steht nie in der Datei
  },

  // --- 1.12 slice 4 (D3 to D6): the editor tools; each goes through laneVon (lock) and ends with the lane check (laneSchreibe) ---
  auto_vereinfachen(p, a) {
    erlaube(a, 'lane_id', 'von_beat', 'bis_beat', 'toleranz');
    const { spur: traeger, lane } = laneVon(p, idArg(a, 'lane_id'));
    const [von, bis] = laneBereich(a);
    const tol = zahl(a, 'toleranz', 0, 1000, { opt: true });
    const br = laneBereichVon(traeger, lane);
    // a chain lane's default tolerance is 0.4 % of the parameter's range (the rule of pan and the device lanes, D15)
    const toleranz = tol ?? (istKettenZiel(lane.ziel) || istPluginZiel(lane.ziel) ? 0.004 * (br.max - br.min) : undefined);
    laneSchreibe(traeger, lane, bereichVereinfacht(lane.punkte, von, bis, lane.ziel, toleranz));
  },

  auto_dehnen(p, a) {
    erlaube(a, 'lane_id', 'von_beat', 'bis_beat', 'neu_bis_beat');
    const { spur: traeger, lane } = laneVon(p, idArg(a, 'lane_id'));
    const [von, bis] = laneBereich(a);
    const neuBis = zahl(a, 'neu_bis_beat', -Infinity, Infinity)!;
    if (!(neuBis > von && neuBis <= MAX_BEAT)) ab('bereich_leer', `neu_bis_beat ${neuBis} must lie after von_beat ${von} and at most at ${MAX_BEAT}`);
    laneSchreibe(traeger, lane, dehne(lane.punkte, von, bis, neuBis, lane.ziel));
  },

  auto_neigen(p, a) {
    erlaube(a, 'lane_id', 'von_beat', 'bis_beat', 'faktor');
    const { spur: traeger, lane } = laneVon(p, idArg(a, 'lane_id'));
    const [von, bis] = laneBereich(a);
    laneSchreibe(traeger, lane, neige(lane.punkte, von, bis, zahl(a, 'faktor', -1, 1)!, lane.ziel));
  },

  auto_form(p, a) {
    erlaube(a, 'lane_id', 'von_beat', 'bis_beat', 'form', 'perioden', 'unten', 'oben');
    const { spur: traeger, lane } = laneVon(p, idArg(a, 'lane_id'));
    const [von, bis] = laneBereich(a);
    if (a.form === undefined) ab('argument_ungueltig', 'form: missing');
    if (!(FORMEN_EINFUEGEN as readonly unknown[]).includes(a.form)) ab('form_ungueltig', `${String(a.form)} (${FORMEN_EINFUEGEN.join(' | ')})`);
    const { min, max, nurSprung } = laneBereichVon(traeger, lane);
    if (nurSprung && a.form !== 'rechteck') ab('form_ungueltig', `${lane.ziel} lanes take rechteck only`);
    const eigen = istKettenZiel(lane.ziel) || istPluginZiel(lane.ziel);
    const vorgabe = eigen ? { unten: min, oben: max } : formBereich(lane.ziel);   // a chain lane's shape spans the parameter's own range
    const perioden = zahl(a, 'perioden', 1, 64, { opt: true, ganz: true }) ?? 1;
    const unten = zahl(a, 'unten', min, max, { opt: true }) ?? vorgabe.unten, oben = zahl(a, 'oben', min, max, { opt: true }) ?? vorgabe.oben;
    if (unten > oben) ab('argument_ungueltig', `unten ${unten} must not lie above oben ${oben}`);
    laneSchreibe(traeger, lane, setzeForm(lane.punkte, von, bis, formPunkte(a.form as FormEinfuegen, von, bis, perioden, unten, oben), lane.ziel));
  },

  // --- 1.12 slice 5 (D7): clip envelopes; one per target and clip, replaced as a whole ---
  huellkurve_setzen(p, a) {
    erlaube(a, 'clip_id', 'ziel', 'punkte', 'verknuepft', 'loop_beats');
    const { spur, clip } = clipVon(p, idArg(a, 'clip_id'));
    if (a.verknuepft !== undefined && typeof a.verknuepft !== 'boolean') ab('argument_ungueltig', 'verknuepft: true or false expected');
    const hk = { ziel: a.ziel, ...(a.verknuepft === false ? { verknuepft: false } : {}), ...(a.loop_beats !== undefined ? { loop_beats: a.loop_beats } : {}),
      punkte: Array.isArray(a.punkte) ? (a.punkte as unknown[]).map((q) => (istObjekt(q) ? { ...q } : q)) : a.punkte };
    const f = huellkurvePruefung(hk, clip, spur);
    if (f) ab(f.grund, f.text);
    const liste = (clip.huellkurven ?? []).filter((h) => h.ziel !== a.ziel);
    clip.huellkurven = [...liste, hk as Huellkurve];
  },

  huellkurve_loeschen(p, a) {
    erlaube(a, 'clip_id', 'ziel');
    const { clip } = clipVon(p, idArg(a, 'clip_id'));
    if (!(clip.huellkurven ?? []).some((h) => h.ziel === a.ziel)) ab('huellkurve_unbekannt', `${clip.id} ${String(a.ziel)}`);
    const rest = (clip.huellkurven ?? []).filter((h) => h.ziel !== a.ziel);
    if (rest.length) clip.huellkurven = rest; else delete clip.huellkurven;       // an empty list is never written
  },

  // --- Strand 6: project-level modulators (LFO, envelope follower). One undo step each; the whole list is checked after the change (modulatorenPruefung) ---
  // mod_neu takes the lowest free core slot `nr` (D11); the new modulator is the one the caller does not know yet (model.ts neuerModulator)
  mod_neu(p, a) {
    erlaube(a, 'art', 'form', 'takt', 'hz', 'phase', 'glatt_ms', 'name', 'ziele', 'quelle', 'angriff_ms', 'abfall_ms', 'empfindlich_db');
    const liste = p.modulatoren ?? [];
    if (liste.length >= MAX_MODULATOREN) ab('mod_voll', `all ${MAX_MODULATOREN} modulators of the project are used`);
    const belegt = new Set(liste.map((m) => m.nr));
    const nr = Array.from({ length: MAX_MODULATOREN }, (_, i) => i + 1).find((n) => !belegt.has(n))!;
    // a refused command drops the whole draft, the drawn id with it
    const m = modFelder({ id: neueId(p, 'mod'), nr, art: 'lfo', ziele: [] }, a);
    modLfoVorgaben(m);
    modSchreibe(p, [...liste, m]);
  },

  // any field of mod_neu, `an` (false switches off, true removes the key) and `ziele` (replaces the whole list); takt and hz replace each other.
  // A new `art` drops the fields of the old kind (an LFO gets form sinus and takt 4 again; a follower needs `quelle`)
  mod_aendern(p, a) {
    erlaube(a, 'mod_id', 'art', 'form', 'takt', 'hz', 'phase', 'glatt_ms', 'name', 'an', 'ziele', 'quelle', 'angriff_ms', 'abfall_ms', 'empfindlich_db');
    const alt = modVon(p, a);
    if (a.an !== undefined && typeof a.an !== 'boolean') ab('argument_ungueltig', 'an: true or false expected');
    if (a.takt !== undefined && a.hz !== undefined) ab('argument_ungueltig', 'takt and hz: give one of them');
    const basis = { ...alt, ziele: [...alt.ziele] } as unknown as Record<string, unknown>;
    if (a.art !== undefined && a.art !== alt.art && (alt.art === 'lfo' || alt.art === 'folger')) {
      for (const k of MOD_FELDER_NUR[alt.art]) delete basis[k];
    }
    const m = modFelder(basis as unknown as Modulator, a);
    if (a.takt !== undefined) delete m.hz;
    if (a.hz !== undefined) delete m.takt;
    if (a.art !== undefined && a.art !== alt.art) modLfoVorgaben(m);
    if (a.an === false) m.an = false; else if (a.an === true) delete m.an;
    modSchreibe(p, (p.modulatoren ?? []).map((x) => (x === alt ? m : x)));
  },

  mod_loeschen(p, a) {
    erlaube(a, 'mod_id');
    const alt = modVon(p, a);
    const rest = (p.modulatoren ?? []).filter((x) => x !== alt);
    if (rest.length) p.modulatoren = rest; else delete p.modulatoren;   // an empty list is never written
  },
} satisfies Record<string, Handler>;

// the core slot `nr` and the id are never arguments of the mod_* commands
function modVon(p: Parameters<Handler>[0], a: Args): Modulator {
  const id = idArg(a, 'mod_id');
  return (p.modulatoren ?? []).find((m) => m.id === id) ?? ab('mod_unbekannt', id);
}
// copies the given arguments onto `m` (values are checked with the whole list afterwards); `ziele` entries are copied, never shared with the arguments
function modFelder(m: Modulator, a: Args): Modulator {
  const z = m as unknown as Record<string, unknown>;
  for (const k of ['art', 'form', 'takt', 'hz', 'phase', 'glatt_ms', 'name', 'quelle', 'angriff_ms', 'abfall_ms', 'empfindlich_db'] as const) {
    if (a[k] !== undefined) z[k] = a[k];
  }
  if (a.ziele !== undefined) {
    if (!Array.isArray(a.ziele)) ab('argument_ungueltig', 'ziele: list expected');
    m.ziele = (a.ziele as unknown[]).map((x) => (istObjekt(x) ? { ...x } : x)) as Modulator['ziele'];
  }
  return m;
}
// an LFO without shape or rate gets the written defaults (form sinus, takt 4); a follower writes none (absent = default, the translator fills in)
function modLfoVorgaben(m: Modulator): void {
  if (m.art !== 'lfo') return;
  if (m.form === undefined) m.form = 'sinus';
  if (m.takt === undefined && m.hz === undefined) m.takt = MOD_TAKT_VORGABE;
}
function modSchreibe(p: Parameters<Handler>[0], liste: Modulator[]): void {
  const f = modulatorenPruefung(liste, p);
  if (f) ab(f.grund, f.text.replace(/^\[\d+\] /, ''));
  p.modulatoren = liste;
}
