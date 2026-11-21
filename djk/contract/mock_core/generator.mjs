// Erzeuger-Ströme und -Fenster (INTERFACES §4.8, I3c) und Einzelschüsse (§4.6, I3b). Die Attrappe spielt nichts
// ab und schickt kein MIDI; sie führt Buch, ersetzt Fenster, zählt und prüft die Hörschein-Pflicht.

import fs from 'node:fs';
import path from 'node:path';
import { BEFEHLE, SPIELKANAELE, playerVonContainer } from './contract.mjs';
import { llround } from './clock.mjs';
import { offen, sicht } from './level.mjs';
import { gueltig } from './listening_slip.mjs';

const ZIEL = /^(midi:[1-4]:([1-9]|1[0-6])|bk:\S{0,64})$/;

function hsMuster(K, kanal, muster, beat) {
  const schluessel = `deck/${playerVonContainer(kanal)}`;   // the Hörschein key is the player name (C7)
  for (const hs of K.hs.values()) if (!gueltig(K, hs, schluessel, `muster/${muster}`, beat)) return true;
  return false;
}

// MOCK APPROXIMATION (container core C6, review I3): the real core uses the container that holds the stream's top group; the mock reads no arrangement
// and cannot know groups, so it takes the first container with art 2. Enough for the positive case; the negative control (closed container) is tested on the core (K8).
// container core (C6): a stream has no mixer channel, and the mock knows no groups. The muster Hörschein (I3c) applies to the FIRST container
// with art 2 (module); without one nothing is checked. The real core uses the container that holds the stream's top group.
function ungehoert(K, muster, s) {
  const kanal = SPIELKANAELE.find((_, i) => K.container[i].art === 2);
  return kanal !== undefined && offen(K, sicht(K, s), kanal) && !hsMuster(K, kanal, muster, K.uhr.beat(s));
}

function fenster(K, m, von) {
  const [kopf, ...evs] = m.elemente;
  // Scheibe 3 (§4.8): /erz/ev darf nach den festen Typen 0 bis n Paare 'if' tragen
  const pruefe = (x, adr) => x && !x.bundle && x.adresse === adr && (x.typen === BEFEHLE[adr].typen ||
    (adr === '/erz/ev' && x.typen.startsWith(BEFEHLE[adr].typen) && /^(if)*$/.test(x.typen.slice(BEFEHLE[adr].typen.length))));
  if (!pruefe(kopf, '/erz/fenster') || !evs.every((e) => pruefe(e, '/erz/ev'))) return K.protokollfehler('#bundle', 'protokoll', von);
  const [strom, sendung, , , ab_beat, bis_beat] = kopf.werte;
  const st = K.erz.stroeme.get(strom);
  if (!st) return K.protokollfehler('/erz/fenster', 'unbekannter_regler', von);
  const jetztBeat = K.uhr.beat(K.jetzt);
  const ab = Math.max(ab_beat, jetztBeat);
  const neueMuster = new Set(evs.map((e) => e.werte[1]));
  const alt = K.erz.ev.filter((e) => e.strom === strom && e.beat >= ab && e.beat < bis_beat);
  K.erz.ev = K.erz.ev.filter((e) => !alt.includes(e));
  const z = { verworfen: alt.length, anderes: alt.filter((e) => !neueMuster.has(e.muster)).length, eingefuegt: 0, zu_spaet: 0, ungehoert: 0 };
  for (const e of evs) {
    const [s_, muster, ev_id, note, beat, dauer, velocity] = e.werte;
    if (s_ !== strom) continue;
    if (beat < jetztBeat) { z.zu_spaet++; continue; }
    if (!K.mutation.has('i3c_aus') && ungehoert(K, muster, K.jetzt)) { z.ungehoert++; continue; }
    K.erz.ev.push({ strom, muster, ev_id, note, beat, dauer, velocity });
    z.eingefuegt++;
  }
  K.aus('/erz/quittung', [strom, sendung, z.verworfen, z.anderes, z.eingefuegt, z.zu_spaet, z.ungehoert]);
}

const schussArt = {
  pruefeEin(K, t) {
    if (t.pad !== 1 && t.pad !== 2) return 'ausserhalb_bereich';
    if (t.politik !== 0 && t.politik !== 1) return 'ausserhalb_bereich';
    return null;
  },
  pruefeStart(K, t, s) {
    const bpm1000 = Math.round(K.uhr.bpm(s) * 1000);
    t.inhalt = `${t.material_id}/${bpm1000}_r${t.fassung}/s${t.schuss_nr}`;
    const datei = path.join(K.cfg.arbeitsbestand, t.material_id, 'fassungen', `${bpm1000}_r${t.fassung}`, 'schuesse', `${t.schuss_nr}.f32`);
    if (!fs.existsSync(datei)) return 'material_fehlt';
    const k = `pad/${t.pad}`;
    if (t.quelle !== 'andreas' && !K.mutation.has('i3b_aus') && offen(K, sicht(K, s), k)) {
      const beat = K.uhr.beat(s);
      if (![...K.hs.values()].some((hs) => !gueltig(K, hs, k, t.inhalt, beat))) {
        K.aus('/e/invariante', ['hoerschein', t.plan, t.teil, BigInt(s), beat]);
        return 'kein_hoerschein';
      }
    }
    return null;
  },
  start() {
    return 'fertig';
  },
};

export default {
  name: 'erzeuger',
  init(K) {
    K.erz = { stroeme: new Map(), ev: [], gespielt: 0, ungehoert: 0 };
  },
  befehle: {
    '/erz/strom': (K, a, b) => {
      if (!(a.strom >= 1 && a.strom <= 16) || !ZIEL.test(a.ziel)) return K.q(b, 6, 'ausserhalb_bereich');
      K.sofort(b, () => { K.erz.stroeme.set(a.strom, { ziel: a.ziel }); return null; });
    },
    '#bundle': (K, m, b, von) => fenster(K, m, von),
    '/erz/fenster': (K, a, b, von) => K.protokollfehler('/erz/fenster', 'protokoll', von),
    '/erz/ev': (K, a, b, von) => K.protokollfehler('/erz/ev', 'protokoll', von),
    '/erz/cc': () => {},
    '/k/schuss': (K, a, b) => {
      K.einsortieren(K.teilNeu(b, a, 'schuss', { material_id: a.material_id, fassung: a.fassung, schuss_nr: a.schuss_nr, pad: a.pad, pegel_db: a.pegel_db }));
    },
  },
  arten: { schuss: schussArt },
  punkte(K, s0, s1) {
    const p = [];
    for (const e of K.erz.ev) {
      const s = llround(K.uhr.sample(e.beat));
      if (s >= s0 && s < s1) {
        p.push({ s, prio: 4, seq: 0, tu: () => {
          const st = K.erz.stroeme.get(e.strom);
          if (st && !K.mutation.has('i3c_aus') && ungehoert(K, e.muster, s)) K.erz.ungehoert++;
          else K.erz.gespielt++;
          K.erz.ev = K.erz.ev.filter((x) => x !== e);
        } });
      }
    }
    return p;
  },
};
