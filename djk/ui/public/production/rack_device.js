// PRODUCTION 1.9 U7 T5 (spec E9, E11, 4.4): the instrument rack on the page, pure part. Member rows, the zone bars over a 128-key strip and the command
// builders; no DOM here (rack_device_operation.js binds it). Limits equal project/model.ts (pinned by tests/production_rack_device.test.mjs).
export const MAX_GLIEDER = 4;        // members per rack
export const MAX_RACK_GERAETE = 8;   // rack devices per project
export const GLIED_GAIN_MIN = -60, GLIED_GAIN_MAX = 12;
export const TON_MIN = 0, TON_MAX = 127, VEL_MIN = 1, VEL_MAX = 127, KETTE_MIN = 0, KETTE_MAX = 127;

export const RACK_TEXT = {
  titel: 'RACK', leer: 'This track has no rack.', hinzu: '+ MEMBER', hinzu_titel: 'Add an RB-338 member (up to 4 per rack)',
  entfernen: 'Remove', entfernen_titel: 'Remove this member (the last one cannot go: convert the track to a plain device instead)',
  kette: 'CHAIN', kette_titel: 'Chain value of the rack: a member plays while this value is inside its chain zone',
  ton: 'KEYS', vel: 'VEL', kette_zone: 'CHAIN ZONE', gain: 'GAIN',
  ton_titel: 'Key zone: drag an edge', vel_titel: 'Velocity zone: drag an edge', gain_titel: 'Member gain in dB (double click: 0 dB)',
  voll: 'A rack holds at most 4 members', info: 'Click a clip to go back to the clip detail',
};

export const RB_GLIED_GERAET = { art: 'intern', name: 'rb338', parameter: {} };
const ZONEN = { ton: [TON_MIN, TON_MAX], vel: [VEL_MIN, VEL_MAX], kette: [KETTE_MIN, KETTE_MAX] };

const istRack = (s) => s?.geraet?.art === 'rack';
export const glieder = (s) => (istRack(s) ? s.geraet.glieder : []);

// the page twin of istWirt (server: wirtSlots(s).length > 0): the track uses a Surge production slot, its own or a rack member's.
// Tolerates a track without `art` (like wirtSlots); an audio track has no device.
export function brauchtSlot(s) {
  if (!s || (s.art !== undefined && s.art !== 'instrument')) return false;
  const g = s.geraet;
  if (g?.art === 'wirt') return true;
  return g?.art === 'rack' && g.glieder.some((m) => m.geraet?.art === 'wirt');
}
// Surge slots in use over all tracks and members (the server's wirtSlots summed up); the button "+ SURGE" compares it with WIRT_SLOTS
export const wirtBelegt = (spuren) => spuren.reduce((n, s) => {
  if (s.art !== undefined && s.art !== 'instrument') return n;
  const g = s.geraet;
  return n + (g?.art === 'wirt' ? 1 : g?.art === 'rack' ? g.glieder.filter((m) => m.geraet?.art === 'wirt').length : 0);
}, 0);
// kit devices over tracks and members (the model counts both toward MAX_KIT_GERAETE)
export const kitBelegt = (spuren) => spuren.reduce((n, s) => n + [s.geraet, ...glieder(s).map((m) => m.geraet)]
  .filter((d) => d?.art === 'intern' && d.name === 'kit').length, 0);
export const rackBelegt = (spuren) => spuren.filter(istRack).length;

export function geraetName(g) {
  if (g?.art === 'intern' && g.name === 'rb338') return 'RB-338';
  if (g?.art === 'intern' && g.name === 'bk') return `BK · ${g.graph}`;
  if (g?.art === 'intern' && g.name === 'kit') return `KIT · ${g.kit}`;
  if (g?.art === 'wirt') return `${String(g.name).toUpperCase()} · ${g.slot}`;
  return String(g?.name ?? '?').toUpperCase();
}

// the bars to draw: an absent zone is the whole range
export const zonenLeiste = (m) => ({ ton: m.ton ?? [...ZONEN.ton], vel: m.vel ?? [...ZONEN.vel] });
const zonePaar = (m, art) => m[art] ?? [...ZONEN[art]];

export function gliedZeilen(s) {
  const liste = glieder(s);
  return liste.map((m) => ({ id: m.id, text: geraetName(m.geraet), zonen: zonenLeiste(m), kette: zonePaar(m, 'kette'), gain: m.gain_db ?? 0,
    kannEntfernen: liste.length > 1 }));
}
export const kannGliedHinzu = (s) => glieder(s).length > 0 && glieder(s).length < MAX_GLIEDER;

const KANTEN = /^(ton|vel|kette)_(lo|hi)$/;
const klemme = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// one member with one field changed: the whole member goes back (rack_glied_setzen replaces), absent fields stay absent
const mitFeld = (m, feld, wert) => ({ ...m, [feld]: wert });
const setzen = (spurId, glied) => ({ befehl: 'rack_glied_setzen', spur_id: spurId, glied });

// zoneBefehl(spurId, glied, 'ton_lo'|'ton_hi'|'vel_lo'|'vel_hi'|'kette_lo'|'kette_hi', wert): lo never passes hi (the dragged edge stops at the other one)
export function zoneBefehl(spurId, m, kante, wert) {
  const k = KANTEN.exec(kante);
  if (!k || typeof wert !== 'number' || !Number.isFinite(wert)) return null;
  const [art, seite] = [k[1], k[2]], [min, max] = ZONEN[art], [lo, hi] = zonePaar(m, art);
  const v = klemme(Math.round(wert), min, max);
  return setzen(spurId, mitFeld(m, art, seite === 'lo' ? [Math.min(v, hi), hi] : [lo, Math.max(v, lo)]));
}
export const ketteBefehl = (spurId, kette) => (typeof kette !== 'number' || !Number.isFinite(kette) ? null
  : { befehl: 'rack_kette', spur_id: spurId, kette: klemme(Math.round(kette), KETTE_MIN, KETTE_MAX) });
export function gainBefehl(spurId, m, db) {
  if (typeof db !== 'number' || !Number.isFinite(db)) return null;
  const { gain_db: _alt, ...rest } = m;
  const v = klemme(db, GLIED_GAIN_MIN, GLIED_GAIN_MAX);
  return setzen(spurId, v === 0 ? rest : { ...rest, gain_db: v });   // 0 dB is the absent value
}
export const gliedHinzuBefehl = (spurId) => setzen(spurId, { geraet: { ...RB_GLIED_GERAET } });   // no id: the server takes the lowest free one
export const gliedEntfernenBefehl = (spurId, gliedId) => ({ befehl: 'rack_glied_entfernen', spur_id: spurId, glied_id: gliedId });

// the drag of one zone edge: bewegung(wert) previews (returns the clamped value), ende() sends ONE body when the edge moved
export function kantenZug(spurId, m, kante, senden) {
  const k = KANTEN.exec(kante), start = k ? zonePaar(m, k[1])[k[2] === 'lo' ? 0 : 1] : null;
  let jetzt = start, fertig = false;
  return {
    bewegung(wert) {
      const b = zoneBefehl(spurId, m, kante, wert);
      if (b) jetzt = b.glied[k[1]][k[2] === 'lo' ? 0 : 1];
      return jetzt;
    },
    ende() {
      if (fertig) return;
      fertig = true;
      if (jetzt !== start) return senden(zoneBefehl(spurId, m, kante, jetzt));   // what senden returns (the promise of the write)
      return undefined;
    },
  };
}
// pixel inside a bar of `breite` px to a key between min and max
export const tasteVonX = (x, breite, min, max) => (breite > 0 ? klemme(Math.round(min + (x / breite) * (max - min)), min, max) : min);
