// Track commands: create, change, delete and move a track, takes and the comp choice of the project API (handler table of commands.ts, moved unchanged).
// The handlers reach each other through PRO_BEFEHL (commands_helpers.ts) at call time; commands.ts merges the tables.
import {
  istGeraetZiel, passtGeraetZiel, FADER_MAX, FADER_MIN, MAX_ARM_AUDIO, MAX_BEAT, MAX_SPUREN, alleInserts, SPUR_FARBEN, MAX_TAKES_PRO_SPUR,
  entferneLeereTakes, type Take, kanonisch, neueId, type AudioClip, type Clip, type Spur, wirtSlots, type SpurAufnahme,
} from './model.ts';
import {
  ab, erlaube, zahlOk, zahl, flagge, eingangVon, text, gruppeArg, idArg, spurVon, freezeFeld, bereinigeGliedZiele, takeName, takeVon, COMP_FADE_S,
  COMP_EPS, teileClipsAn, compGleich, compFade, baueGeraet, type Handler,
} from './commands_helpers.ts';

export const SPUR = {
  spur_neu(p, a, ctx) {
    erlaube(a, 'art', 'name', 'geraet', 'gruppe');
    const art = a.art;
    if (art !== 'audio' && art !== 'instrument') ab('argument_ungueltig', 'art: audio oder instrument erwartet');
    if (art === 'audio' && a.geraet !== undefined) ab('argument_ungueltig', 'geraet: nur für Instrument-Spuren');
    if (p.spuren.length >= MAX_SPUREN) ab('spur_bereich', `alle ${MAX_SPUREN} Spuren belegt`);
    const nr = Array.from({ length: MAX_SPUREN }, (_, i) => i + 1).find((n) => !p.spuren.some((s) => s.nr === n)) ?? ab('spur_bereich', 'keine freie Nummer');
    const spurId = neueId(p, 'spur');
    const geraet = art === 'instrument' ? baueGeraet(p, a.geraet ?? { art: 'intern' }, undefined, ctx, undefined, spurId) : undefined;
    const standard = geraet?.art === 'rack' ? 'Rack' : geraet?.art === 'intern'   // S20: a bk track is named after its graph; 1.9: a kit track after its kit
      ? (geraet.name === 'bk' ? geraet.graph : geraet.name === 'kit' ? `KIT · ${geraet.kit}` : 'RB-338')
      : geraet?.art === 'wirt' && geraet.plugin ? geraet.plugin.name : 'Surge';
    const name = text(a, 'name', 80) ?? (art === 'audio' ? `Audio ${nr}` : standard);
    const gruppe = gruppeArg(a);
    const spur: Spur = { id: spurId, von: ctx.quelle, ...(gruppe !== undefined ? { gruppe } : {}), nr, name,
      farbe: SPUR_FARBEN[(nr - 1) % SPUR_FARBEN.length], art,
      ...(geraet ? { geraet } : {}), ...(wirtSlots({ art, geraet }).length > 0 ? { freeze: null } : {}),
      fader_db: 0, pan: 0, mute: false, solo: false, clips: [] };
    p.spuren.push(spur);
  },

  spur_aendern(p, a, ctx) {
    if (a.von !== undefined) ab('argument_ungueltig', 'von: unveränderlich (Spec 6.22), die Herkunft einer Spur ändert kein Befehl');
    erlaube(a, 'spur_id', 'name', 'farbe', 'fader_db', 'pan', 'mute', 'solo', 'geraet', 'gruppe', 'arm', 'eingang', 'monitor');
    const s = spurVon(p, idArg(a, 'spur_id'));
    if (['name', 'farbe', 'fader_db', 'pan', 'mute', 'solo', 'geraet', 'gruppe', 'arm', 'eingang', 'monitor'].every((k) => a[k] === undefined)) {
      ab('argument_ungueltig', 'keine Änderung angegeben');
    }
    const name = text(a, 'name', 80);
    const gruppe = a.gruppe === null ? null : gruppeArg(a);       // null nimmt die Spur aus ihrer Gruppe
    if (a.farbe !== undefined && (typeof a.farbe !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(a.farbe))) ab('argument_ungueltig', 'farbe: #rrggbb erwartet');
    const fader = zahl(a, 'fader_db', FADER_MIN, FADER_MAX, { opt: true }), pan = zahl(a, 'pan', -1, 1, { opt: true });
    const mute = flagge(a, 'mute', true), solo = flagge(a, 'solo', true);
    if (a.geraet !== undefined && s.art !== 'instrument') ab('argument_ungueltig', 'geraet: nur für Instrument-Spuren');
    const geraet = a.geraet !== undefined ? baueGeraet(p, a.geraet, s.id, ctx) : undefined;
    if (a.arm !== undefined || a.eingang !== undefined || a.monitor !== undefined) {   // 1.8: kein Regler, kein Neuladen (wiedergabeSicht kennt das Feld nicht)
      if (a.arm !== undefined && typeof a.arm !== 'boolean') ab('argument_ungueltig', 'arm: true oder false erwartet');
      if (a.monitor !== undefined && !['aus', 'auto', 'ein'].includes(a.monitor as string)) ab('argument_ungueltig', 'monitor: aus, auto or ein expected');
      const alt = s.aufnahme ?? { scharf: false, eingang: null };
      let eingang = alt.eingang;
      if (a.eingang === null) eingang = null;
      else if (a.eingang !== undefined) eingang = eingangVon(s.art, a.eingang);
      const monitor = a.monitor === undefined ? alt.monitor : a.monitor === 'auto' ? undefined : a.monitor;   // auto is the canonical absence (D11)
      const scharf = a.arm ?? alt.scharf;
      if (scharf && eingang === null) ab('kein_eingang', 'arm braucht einen Eingang');
      // the cap of eight counts audio tracks only; an armed instrument track (midi) does not take a slot
      if (s.art === 'audio' && scharf && !alt.scharf
        && p.spuren.filter((x) => x !== s && x.art === 'audio' && x.aufnahme?.scharf).length >= MAX_ARM_AUDIO) {
        ab('zu_viele_scharf', `höchstens ${MAX_ARM_AUDIO} scharfe Audio-Spuren`);
      }
      if (scharf || eingang !== null || monitor !== undefined) s.aufnahme = { scharf, eingang, ...(monitor !== undefined ? { monitor } : {}) } as SpurAufnahme;
      else delete s.aufnahme;
    }
    if (name !== undefined) s.name = name;
    if (gruppe === null) delete s.gruppe; else if (gruppe !== undefined) s.gruppe = gruppe;
    if (a.farbe !== undefined) s.farbe = a.farbe;
    if (fader !== undefined) s.fader_db = fader;
    if (pan !== undefined) s.pan = pan;
    if (mute !== undefined) s.mute = mute;
    if (solo !== undefined) s.solo = solo;
    if (geraet && (s.automation ?? []).some((l) => istGeraetZiel(l.ziel) && !passtGeraetZiel(l.ziel, geraet))) {
      ab('geraet_lanes', `${s.id}: delete its geraet.* lanes before switching to a device that does not have those parameters`);
    }
    // 1.12 slice 5: the same rule for the geraet.* envelopes of the track's clips
    if (geraet && s.clips.some((c) => (c.huellkurven ?? []).some((h) => istGeraetZiel(h.ziel) && !passtGeraetZiel(h.ziel, geraet)))) {
      ab('geraet_huellkurven', `${s.id}: delete the geraet.* envelopes of its clips before switching to a device that does not have those parameters`);
    }
    if (geraet && kanonisch(geraet) !== kanonisch(s.geraet)) {
      s.geraet = geraet;
      freezeFeld(s);
      bereinigeGliedZiele(s);   // 1.9 U8 T8: a conversion away from a rack, or to other members, takes the member targets with it
    }
  },

  // 1.14 comping, slice 1: take lanes are read-only containers (R7); these commands never touch s.clips, so playback stays as it is
  take_neu(p, a) {
    erlaube(a, 'spur_id', 'name');
    const s = spurVon(p, idArg(a, 'spur_id'));
    if (s.art !== 'audio') ab('take_nur_audio', s.id);
    if ((s.takes ?? []).length >= MAX_TAKES_PRO_SPUR) ab('takes_voll', `at most ${MAX_TAKES_PRO_SPUR} take lanes per track`);
    const nummer = (s.takes ?? []).filter((t) => t.art === undefined).length + 1;   // the Original lane does not count
    const name = a.name === undefined ? `Take ${nummer}` : takeName(a.name);
    (s.takes ??= []).push({ id: neueId(p, 'take'), name, clips: [] });
  },

  take_umbenennen(p, a) {
    erlaube(a, 'spur_id', 'take_id', 'name');
    const { take } = takeVon(p, a);
    take.name = takeName(a.name);                 // art stays: the Original lane keeps its mark
  },

  take_loeschen(p, a) {
    erlaube(a, 'spur_id', 'take_id');
    const { spur, take } = takeVon(p, a);
    spur.takes!.splice(spur.takes!.indexOf(take), 1);
    entferneLeereTakes(p);                         // never leave `takes: []` behind (undo and redo patches would carry it)
  },

  // 1.14 comping (spec R4, R5): the main lane over [von, bis) becomes what the take lane holds there (gaps stay silent). Clones of the take
  // clips overlapping the range join s.clips next to the main clips (that overlap exists only inside this command; the project is validated
  // once, at the end), both sides are cut at von and bis by the clip_teilen rules, then main parts inside and clone parts outside the range go.
  // The take list is never touched, so no empty list can appear and entferneLeereTakes is not needed.
  comp_waehlen(p, a) {
    erlaube(a, 'spur_id', 'take_id', 'von_beat', 'bis_beat');
    const { spur, take } = takeVon(p, a);
    for (const k of ['von_beat', 'bis_beat']) if (!zahlOk(a[k])) ab('argument_ungueltig', `${k}: number expected`);
    const von: number = a.von_beat, bis: number = a.bis_beat;
    if (!(von >= 0 && bis <= MAX_BEAT && bis > von)) ab('comp_leer', `${von}..${bis} must lie inside 0..${MAX_BEAT} and be longer than 0`);
    const ende = (c: Clip): number => c.start_beat + c.laenge_beats;
    const drin = (c: Clip): boolean => c.start_beat < bis - COMP_EPS && ende(c) > von + COMP_EPS;          // overlaps [von, bis)
    const schneidet = (c: Clip, t: number): boolean => c.start_beat < t - COMP_EPS && ende(c) > t + COMP_EPS;   // t lies strictly inside
    const quellen = take.clips.filter(drin);
    for (const c of [...spur.clips, ...quellen]) {
      if (c.loop_beats != null && (schneidet(c, von) || schneidet(c, bis))) ab('ersetzen_loop', c.id);
    }
    if (compGleich(spur.clips.filter(drin), quellen, von, bis, p.tempo_bpm)) return;                       // no-op: nothing spent, nothing changed
    const klon = new Set<string>();
    for (const c of quellen) { const k = { ...structuredClone(c), id: neueId(p, 'clip') }; klon.add(k.id); spur.clips.push(k); }
    teileClipsAn(p, spur, [von, bis], (alt, neu) => { if (klon.has(alt.id)) klon.add(neu.id); });         // the second part of a clone is a clone
    spur.clips = spur.clips.filter((c) => (klon.has(c.id) ? drin(c) : !drin(c)));
    const haupt = spur.clips.filter((c): c is AudioClip => c.art === 'audio' && !klon.has(c.id));
    const klone = spur.clips.filter((c): c is AudioClip => c.art === 'audio' && klon.has(c.id));
    for (const k of klone) {                                                                               // clones sit at the right place in the lane
      spur.clips.splice(spur.clips.indexOf(k), 1);
      const i = spur.clips.findIndex((c) => !klon.has(c.id) && c.start_beat >= k.start_beat - COMP_EPS);
      spur.clips.splice(i < 0 ? spur.clips.length : i, 0, k);
    }
    const fade = (COMP_FADE_S * p.tempo_bpm) / 60;
    for (const m of haupt) for (const k of klone) {                                                        // seams only where main and clone touch
      const ziel = Math.min(fade, Math.min(m.laenge_beats, k.laenge_beats) / 2);
      const nahe = (x: number, y: number): boolean => Math.abs(x - y) <= COMP_EPS;
      if (nahe(ende(m), von) && nahe(k.start_beat, von)) { compFade(m, 'fade_aus_beats', ziel); compFade(k, 'fade_ein_beats', ziel); }
      if (nahe(ende(k), bis) && nahe(m.start_beat, bis)) { compFade(k, 'fade_aus_beats', ziel); compFade(m, 'fade_ein_beats', ziel); }
    }
  },

  spur_loeschen(p, a) {
    erlaube(a, 'spur_id');
    const s = spurVon(p, idArg(a, 'spur_id'));
    p.spuren.splice(p.spuren.indexOf(s), 1);
    // slice 4: a stage keyed on this track would dangle and silently re-bind to a later track taking the number; drop the key (the sc row resets to 0)
    for (const x of alleInserts(p)) {
      if (x.insert.sc === s.nr) delete x.insert.sc;
      if (x.insert.key?.quelle === 'spur' && x.insert.key.nr === s.nr) delete x.insert.key;   // slice 5: the same for a post key
    }
  },

  spur_verschieben(p, a) {
    erlaube(a, 'spur_id', 'index');
    const s = spurVon(p, idArg(a, 'spur_id'));
    if (!Number.isInteger(a.index)) ab('argument_ungueltig', 'index: ganze Zahl erwartet');
    if (a.index < 0 || a.index >= p.spuren.length) ab('index_bereich', `${a.index} (0..${p.spuren.length - 1})`);
    p.spuren.splice(p.spuren.indexOf(s), 1);
    p.spuren.splice(a.index, 0, s);
  },
} satisfies Record<string, Handler>;
