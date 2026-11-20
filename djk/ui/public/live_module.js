// Live modules (plan live-module task 4): the page side of the live container. Only pure parts here (model, calls with an injected holeJson),
// so they run in node tests. The module panel and its faders are gone (loop deck P1); what is left is the model of the container's slots
// (modulAnsicht, read by tests and the channel state), the key distance, the channel state kanalAnsicht (stream.js) and oeffneLive.
import { loopVonGruppe } from './loop_wave.js';

export const SLOTS = ['A', 'B'];
const prozentVon = (stand) => (stand.prozent == null && stand.stufe === 'schreiben' ? 100 : stand.prozent);

function zustandVon(hatStems, st, stems) {
  if (hatStems || st?.stems === 'fertig') return { art: 'bereit', text: 'READY', prozent: null };
  if (st?.stems === 'wartet') return { art: 'trennt', text: 'SEPARATING', prozent: null };
  if (st?.stems === 'laeuft') {
    const unser = stems && stems.zustand === 'laeuft' && stems.auftrag_id === st.auftrag_id;
    const p = unser && prozentVon(stems) != null ? Math.round(Math.max(0, Math.min(100, prozentVon(stems)))) : null;
    return { art: 'trennt', text: p == null ? 'SEPARATING' : `SEPARATING ${p} %`, prozent: p };
  }
  if (st?.stems === 'fehler') return { art: 'fehler', text: st.text ?? st.grund ?? 'the separation failed', prozent: null };
  return { art: 'fehler', text: 'the stems are not separated', prozent: null };
}

// Key distance of a slot (task 11, GET /modul/stand tonart_abstand): semitones adapting would still move, null when a key is unknown or no deck plays.
export function tonartAnsicht(st) {
  const a = st?.tonart_abstand;
  if (typeof a !== 'number') return { abstand: null, aus: true, text: 'KEY', titel: `Key unknown or no deck on the master (${st?.tonart_grund ?? 'no deck'})` };
  if (a === 0) return { abstand: 0, aus: true, text: 'KEY 0', titel: `In key with the deck on the master${st?.deck_tonart ? ` (${st.deck_tonart})` : ''}` };
  return { abstand: a, aus: false, text: `KEY ${a > 0 ? '+' : '−'}${Math.abs(a)}`, titel: `Transpose this module by ${a > 0 ? '+' : ''}${a} semitones to the deck on the master` };
}
// The channel a slot plays on (DJ view places, ADR 037): slot A is Loop 1 on pad/1, slot B is Loop 2 on pad/2. The page says Loop 1 / Loop 2; A and B
// are the crossfader sides. `regler` is the row table of the page (zustand.regler). Open = trim plus fader above -26 dB, the rule of kanalOffen in
// hand_operation.ts (unknown fader -200, unknown trim 0); the page copy with its parity test comes with slots.js (plan task 13).
export const KANAL_OFFEN_DB = -26;
export function kanalAnsicht(slot, regler) {
  const nr = slot === 'A' ? 1 : 2, pfad = `pad/${nr}`;
  const offen = (regler?.[`${pfad}/trim`] ?? 0) + (regler?.[`${pfad}/fader`] ?? -200) > KANAL_OFFEN_DB;
  return { nr, pfad, name: `Loop ${nr}`, offen, text: `Loop ${nr} · ${offen ? 'open' : 'closed'}`,
    titel: `Loop ${nr} plays on the channel ${pfad} (strip L${nr}): ${offen ? 'open, the module is on the master' : 'closed, listen on PFL; open the channel fader to bring it in'}` };
}

// projekt = the open project (or null), stand = GET /modul/stand, stems = the proj_stems state ({auftrag_id, zustand, prozent}) or null,
// regler = the row table of the page (channel state of pad/1, pad/2)
export function modulAnsicht(projekt, stand, stems, regler = {}) {
  if (!projekt?.live) return { offen: false, slots: [] };
  const slots = SLOTS.map((slot) => {
    const g = (projekt.gruppen ?? []).find((x) => x.ausgang === undefined && x.modul?.slot === slot);
    const kanal = kanalAnsicht(slot, regler);
    if (!g) return { slot, kanal, leer: true, zustand: { art: 'leer', text: 'EMPTY', prozent: null }, stems: [] };
    const kinder = (projekt.gruppen ?? []).filter((x) => x.ausgang?.id === g.id);
    const stemsListe = kinder.map((k) => {
      const o = (projekt.spuren ?? []).find((s) => s.ausgang?.id === k.id && s.art === 'audio');
      const n = (projekt.spuren ?? []).find((s) => s.ausgang?.id === k.id && s.art === 'instrument');   // task 8: the new path of Drums and Bass
      return o ? { name: k.name, stem: k.name.toLowerCase(), gruppeId: k.id, spurId: o.id, faderDb: o.fader_db,
        ...(n ? { neu: { spurId: n.id, faderDb: n.fader_db }, blend: k.blend ?? 0 } : {}) } : null;
    }).filter(Boolean);
    const m = g.modul;
    return { slot, kanal, leer: false, gruppeId: g.id, loop: loopVonGruppe(projekt, g.id), titel: m.titel, kuenstler: m.kuenstler, bpm: m.bpm, tonart: m.tonart, beats: m.laenge_beats,
      faderDb: g.fader_db, zustand: zustandVon(stemsListe.length > 0, stand?.[slot]?.stems, stems), stems: stemsListe,
      tonartStand: tonartAnsicht(stand?.[slot]) };
  });
  return { offen: true, slots };
}

const grundVon = (j) => j?.text ?? j?.fehler ?? 'unknown';
// LIVE: opens the live container; when the server refuses with live_laeuft (a running live container would be stopped) Andreas confirms first
export async function oeffneLive(holeJson, frage) {
  let r = await holeJson('/live/oeffnen', {});
  if (r.status === 409 && r.j?.fehler === 'live_laeuft') {
    if (!frage('The live container is running while a deck plays. Opening it again stops the modules. Open anyway?')) {
      return { ok: false, text: 'Live container not opened', abgelehnt: true };
    }
    r = await holeJson('/live/oeffnen', { bestaetigt: true });
  }
  return r.status === 200 ? { ok: true, text: 'Live container open' } : { ok: false, text: `Live container refused: ${grundVon(r.j)}` };
}
