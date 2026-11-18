// Head commands: tempo, time signature, loop, recording, key and metronome of the project API (handler table of commands.ts, moved unchanged).
// The handlers reach each other through PRO_BEFEHL (commands_helpers.ts) at call time; commands.ts merges the tables.
import {
  MAX_BEAT, TEMPO_MAX, TEMPO_MIN, TAKTART_ZAEHLER_MAX, TAKTART_ZAEHLER_MIN, taktartOk, istObjekt, AUFNAHME_VORGABE, VORZAEHLER_WERTE,
  type ProjektAufnahme,
} from './model.ts';
import { tonartFehler } from '../public/harmonie.js';
import { ab, erlaube, zahlOk, zahl, flagge, type Args, type Handler } from './commands_helpers.ts';

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
