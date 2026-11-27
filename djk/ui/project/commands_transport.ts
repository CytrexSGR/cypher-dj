// Head commands: tempo, time signature, loop, recording, key and metronome of the project API (handler table of commands.ts, moved unchanged).
// The handlers reach each other through PRO_BEFEHL (commands_helpers.ts) at call time; commands.ts merges the tables.
import {
  MAX_BEAT, neueId, TEMPO_MAX, TEMPO_MIN, TAKTART_ZAEHLER_MAX, TAKTART_ZAEHLER_MIN, taktartOk, istObjekt, AUFNAHME_VORGABE, VORZAEHLER_WERTE,
  type ProjektAufnahme,
} from './model.ts';
import { tonartFehler } from '../public/harmonie.js';
import { META_FELDER, metaWertFehler } from './abgabe_meta.ts';
import { ab, erlaube, zahlOk, zahl, flagge, idArg, type Args, type Handler } from './commands_helpers.ts';
import { ordneMarker } from './marker.ts';
import { MARKER_FARBE_MAX, MARKER_MAX, markerNameFehler } from '../public/production/marker.js';

const EPS = 1e-9;

export const TRANSPORT = {
  tempo_setzen(p, a) {
    erlaube(a, 'bpm');
    if (!zahlOk(a.bpm)) ab('argument_ungueltig', 'bpm: Zahl erwartet');
    if (a.bpm < TEMPO_MIN || a.bpm > TEMPO_MAX) ab('tempo_bereich', `${a.bpm} (${TEMPO_MIN}..${TEMPO_MAX})`);
    p.tempo_bpm = a.bpm;
  },

  // Meter n/4 (plan production, Task 13): one per project, denominator 4. Not a playback change: the core still counts bars of 4 beats.
  taktart_setzen(p, a) {
    erlaube(a, 'taktart');
    if (!taktartOk(a.taktart)) ab('argument_ungueltig', `taktart: [n, 4] with n = ${TAKTART_ZAEHLER_MIN}..${TAKTART_ZAEHLER_MAX} expected`);
    const t = a.taktart as number[];
    p.taktart = [t[0], t[1]];
  },

  loop_setzen(p, a) {
    erlaube(a, 'an', 'von_beat', 'bis_beat');
    const an = flagge(a, 'an')!, von = zahl(a, 'von_beat', 0, MAX_BEAT)!, bis = zahl(a, 'bis_beat', 0, MAX_BEAT)!;
    if (bis - von < 1) ab('loop_bereich', `bis_beat − von_beat muss mindestens 1 sein (${von}..${bis})`);
    p.loop = { an, von_beat: von, bis_beat: bis };
  },

  // 1.8 S0 (D17): count-in, punch range and overdub. The key is created by the first command; unset fields take AUFNAHME_VORGABE. Not a mixer command
  // (nested, off the fast path) and not a playback command (wiedergabeSicht does not know it).
  aufnahme_setzen(p, a) {
    erlaube(a, 'vorzaehler_takte', 'punch', 'overdub');
    if (['vorzaehler_takte', 'punch', 'overdub'].every((k) => a[k] === undefined)) ab('argument_ungueltig', 'keine Änderung angegeben');
    const neu = structuredClone(p.aufnahme ?? AUFNAHME_VORGABE) as ProjektAufnahme;
    if (a.vorzaehler_takte !== undefined) {
      if (!(VORZAEHLER_WERTE as readonly unknown[]).includes(a.vorzaehler_takte)) ab('argument_ungueltig', 'vorzaehler_takte: 0, 1, 2 or 4 expected');
      neu.vorzaehler_takte = a.vorzaehler_takte as ProjektAufnahme['vorzaehler_takte'];
    }
    if (a.punch !== undefined) {
      if (!istObjekt(a.punch)) ab('argument_ungueltig', 'punch: object expected');
      const pu = a.punch as Args;
      erlaube(pu, 'ein', 'aus', 'von_beat', 'bis_beat');
      if (['ein', 'aus', 'von_beat', 'bis_beat'].every((k) => pu[k] === undefined)) ab('argument_ungueltig', 'punch: no field given');
      const ein = flagge(pu, 'ein', true), aus = flagge(pu, 'aus', true);
      const von = zahl(pu, 'von_beat', 0, MAX_BEAT, { opt: true }), bis = zahl(pu, 'bis_beat', 0, MAX_BEAT, { opt: true });
      if (ein !== undefined) neu.punch.ein = ein;
      if (aus !== undefined) neu.punch.aus = aus;
      if (von !== undefined) neu.punch.von_beat = von;
      if (bis !== undefined) neu.punch.bis_beat = bis;
      if (neu.punch.bis_beat <= neu.punch.von_beat) {
        ab('argument_ungueltig', `punch: bis_beat must be greater than von_beat (${neu.punch.von_beat}..${neu.punch.bis_beat})`);
      }
    }
    const overdub = flagge(a, 'overdub', true);
    if (overdub !== undefined) neu.overdub = overdub;
    p.aufnahme = neu;
  },

  // Key of the project: {grundton: 0..11, skala: a scale name of public/harmonie.js} sets it, {aus: true} removes it. The note editors mark the pitches of
  // the key, fold to them and snap to them; playback never reads the key, so no note moves by this command.
  tonart_setzen(p, a) {
    erlaube(a, 'grundton', 'skala', 'aus');
    if (a.aus !== undefined) {
      if (a.aus !== true || a.grundton !== undefined || a.skala !== undefined) ab('argument_ungueltig', 'aus: true alone expected (no grundton, skala)');
      delete p.tonart;
      return;
    }
    const f = tonartFehler({ grundton: a.grundton, skala: a.skala });
    if (f) ab('argument_ungueltig', f);
    p.tonart = { grundton: a.grundton as number, skala: a.skala as string };
  },

  // Release metadata of the project (abgabe_meta) for the tags of delivery files: a given field is set, null removes it, {aus: true} alone removes all.
  // The object is never left empty. Playback never reads it.
  abgabe_meta_setzen(p, a) {
    erlaube(a, 'titel', 'kuenstler', 'album', 'jahr', 'genre', 'isrc', 'aus');
    if (a.aus !== undefined) {
      if (a.aus !== true || META_FELDER.some((k) => a[k] !== undefined)) ab('argument_ungueltig', 'aus: true alone expected (no other field)');
      delete p.abgabe_meta;
      return;
    }
    const gegeben = META_FELDER.filter((k) => k in a && a[k] !== undefined);
    if (gegeben.length === 0) ab('argument_ungueltig', `keine Änderung angegeben (${META_FELDER.join(', ')} or aus)`);
    const m: Record<string, unknown> = { ...p.abgabe_meta };
    for (const k of gegeben) {
      if (a[k] === null) { delete m[k]; continue; }
      const f = metaWertFehler(k, a[k]);
      if (f) ab('argument_ungueltig', f);
      m[k] = a[k];
    }
    if (Object.keys(m).length === 0) delete p.abgabe_meta; else p.abgabe_meta = m as AbgabeMeta;
  },

  // Arrangement markers (project field `marker`, stored sorted by beat, never empty, never part of the playback). Without `id` a marker is created
  // (`beat` and `name` required, `farbe` 0..15 optional); with `id` the given fields change and `farbe: null` removes the colour.
  // songmarker_unbekannt: no such id (marker_unbekannt is the warp markers' reason). marker_beat_belegt: another marker sits on that beat.
  // marker_zu_viele: the 65th marker.
  // tracker_live: refused on the live container (a workbench module takes markers: its arrangement view has a timeline like any project).
  marker_setzen(p, a) {
    erlaube(a, 'id', 'beat', 'name', 'farbe');
    if (p.live) ab('tracker_live', 'the live container has no markers');
    const neu = a.id === undefined;
    const alt = neu ? undefined : (p.marker ?? []).find((m) => m.id === idArg(a, 'id'));
    if (!neu && !alt) ab('songmarker_unbekannt', String(a.id));   // first: an unknown id is the answer whatever else is wrong
    if (!neu && ['beat', 'name', 'farbe'].every((k) => a[k] === undefined)) ab('argument_ungueltig', 'no change given: send beat, name or farbe');
    if (neu && (a.beat === undefined || a.name === undefined)) ab('argument_ungueltig', 'beat and name are required for a new marker');
    const beat = zahl(a, 'beat', 0, MAX_BEAT, { opt: true });
    if (a.name !== undefined) { const f = markerNameFehler(a.name); if (f) ab('argument_ungueltig', f); }
    if (a.farbe === null && neu) ab('argument_ungueltig', 'farbe: null removes the colour of an existing marker');
    if (a.farbe !== undefined && a.farbe !== null && !(Number.isInteger(a.farbe) && a.farbe >= 0 && a.farbe <= MARKER_FARBE_MAX)) {
      ab('argument_ungueltig', `farbe: whole number 0..${MARKER_FARBE_MAX} expected`);
    }
    const frei = (p.marker ?? []).find((m) => m !== alt && beat !== undefined && Math.abs(m.beat - beat) < EPS);
    if (frei) ab('marker_beat_belegt', `${frei.id} sits on beat ${frei.beat}`);
    if (neu && (p.marker?.length ?? 0) >= MARKER_MAX) ab('marker_zu_viele', `at most ${MARKER_MAX} markers`);
    const m = alt ?? { id: neueId(p, 'marker'), beat: beat!, name: a.name as string };
    if (alt) {
      if (beat !== undefined) alt.beat = beat;
      if (a.name !== undefined) alt.name = a.name;
    } else (p.marker ??= []).push(m);
    if (a.farbe === null) delete m.farbe; else if (a.farbe !== undefined) m.farbe = a.farbe;
    ordneMarker(p);
  },

  // {id}: deletes the marker; the last one takes the field `marker` with it. songmarker_unbekannt: no such id
  marker_loeschen(p, a) {
    erlaube(a, 'id');
    const id = idArg(a, 'id');
    if (!(p.marker ?? []).some((m) => m.id === id)) ab('songmarker_unbekannt', id);
    p.marker = p.marker!.filter((m) => m.id !== id);
    ordneMarker(p);
  },

  metronom_setzen(p, a) {
    erlaube(a, 'an', 'pegel_db', 'ziel');
    if (['an', 'pegel_db', 'ziel'].every((k) => a[k] === undefined)) ab('argument_ungueltig', 'keine Änderung angegeben');
    const an = flagge(a, 'an', true), pegel = zahl(a, 'pegel_db', -60, 0, { opt: true });
    if (a.ziel !== undefined && a.ziel !== 'master' && a.ziel !== 'cue') ab('argument_ungueltig', 'ziel: master oder cue erwartet');
    if (an !== undefined) p.metronom.an = an;
    if (pegel !== undefined) p.metronom.pegel_db = pegel;
    if (a.ziel !== undefined) p.metronom.ziel = a.ziel;
  },
} satisfies Record<string, Handler>;
