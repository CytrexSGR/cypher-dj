// Szenarien fuer Probe 09 b. Aufruf: node szenario.mjs  -> ergebnis_ausfuehrung.json, protokoll_*.jsonl
import { writeFileSync } from 'node:fs';
import { Uhr, Stellwerk, schlagVon } from './stellwerk.mjs';

export const SR = 48000, BLOCK = 256;
export const T = (takt) => (takt - 1) * 90000;          // Takt-Anfang in Samples bei 128 BPM, 48 kHz

export const PLAN = {
  id: 'p1', von: 'cypher', grund: 'A ausblenden, Bass A raus auf Takt 21',
  teile: [
    { regler: 'A.gain', art: 'rampe', ab: { takt: 17 }, dauer: { takte: 8 }, von: 0.8, nach: 0 },
    { regler: 'A.bass', art: 'setze', ab: { takt: 21 }, nach: 0 },
  ],
};

// Andreas greift Gain A bei Takt 19 und dreht in einem halben Schlag von 0,81 auf 0,90
export const HANDGRIFF = Array.from({ length: 10 }, (_, k) => ({ sample: T(19) + k * 1406, regler: 'A.gain', art: 'bewegung', wert: +(0.81 + 0.01 * k).toFixed(2) }));
export const HANDGRIFF_RELATIV = Array.from({ length: 10 }, (_, k) => ({ sample: T(19) + k * 1406, regler: 'A.gain', art: 'relativ', delta: 0.01 }));

export const PRUEFPUNKTE = [T(17) - 1, T(17), T(19) - 1, T(19), T(19) + 1, T(21) - 1, T(21), T(23), T(25) - 1, T(25), T(25) + 1, T(27)];

export function neuesStellwerk(optionen = {}, extra = {}) {
  const uhr = new Uhr({ sr: SR, bpm: 128 });
  const sw = new Stellwerk({
    uhr,
    regler: { 'A.gain': 0.8, 'A.bass': 1, 'B.gain': 0, 'B.bass': 0 },
    decks: { A: { material: 'nachtzug' }, B: { material: 'ki-song-7' } },
    hoerscheine: extra.hoerscheine ?? {},
    optionen,
  });
  return sw;
}

export function laufeBis(sw, sample, aktionen = []) {
  // aktionen: [{sample, tu: (sw) => ...}] werden vor dem Block ausgefuehrt, der ihr Sample enthaelt
  const offen = [...aktionen].sort((a, b) => a.sample - b.sample);
  while (sw.jetzt < sample) {
    while (offen.length && offen[0].sample < sw.jetzt + BLOCK) offen.shift().tu(sw);
    sw.block(BLOCK);
  }
}

export function lauf({ name, hand = null, optionen = {}, tempo = null, plan = PLAN, bisTakt = 28, einreichenBei = T(9), extra = {} }) {
  const sw = neuesStellwerk(optionen, extra);
  PRUEFPUNKTE.forEach((s) => sw.beobachte.add(s));
  const zusatz = [T(21) - 1, 1791818, 1791819, 2140909, 2140910];
  zusatz.forEach((s) => sw.beobachte.add(s));
  laufeBis(sw, einreichenBei);
  const antwort = sw.einreichen(plan);
  if (hand) hand.forEach((h) => sw.hand(h));
  const aktionen = tempo ? [{ sample: tempo.sample, tu: (w) => w.uhr.setzeTempo(tempo.sample, tempo.bpm) }] : [];
  laufeBis(sw, T(bisTakt), aktionen);
  const w = (s, r) => (sw.beobachtet[s]?.[r] === undefined ? null : +sw.beobachtet[s][r].toFixed(6));
  const takte = {};
  for (const e of sw.ereignisse.filter((x) => x.typ === 'takt' && x.takt >= 16)) takte[e.takt] = { 'A.gain': e.regler['A.gain'].wert, 'A.bass': e.regler['A.bass'].wert, halter_gain: e.regler['A.gain'].halter };
  return {
    name, antwort,
    werte: Object.fromEntries([...PRUEFPUNKTE, ...zusatz].map((s) => [s, { 'A.gain': w(s, 'A.gain'), 'A.bass': w(s, 'A.bass') }])),
    stufen: sw.stufen,
    max_sprung_gain: sw.maxSprung['A.gain'],
    takte,
    ereignisse: sw.ereignisse.filter((e) => e.typ !== 'takt').map(({ seq, typ, sample, takt, schlag, anteil, ...rest }) => ({ seq, typ, sample, takt, schlag, anteil, ...rest })),
    plan_status: sw.plaene[plan.id]?.status ?? null,
    sw,
  };
}

// ---------- Verriegelung (A4): nie ungehoert einspielen ----------
const HS = (over = {}) => ({ H12: { id: 'H12', deck: 'B', material: 'ki-song-7', bpm: 128, sync_fehler_ms: 0.4, lufs_kurz: -9.1, gemessen_bis_schlag: schlagVon({ takt: 9 }), gueltig_bis_schlag: schlagVon({ takt: 40 }), ...over } });
const PLAN_B = (extra = {}) => ({ id: 'pB', teile: [{ regler: 'B.gain', art: 'rampe', ab: { takt: 17 }, dauer: { takte: 8 }, nach: 0.8 }], ...extra });

export function verriegelung() {
  const erg = {};
  const einmal = (name, { hs = {}, plan, bei = T(9), tempo = null, bis = T(26) }) => {
    const sw = neuesStellwerk({}, { hoerscheine: hs });
    laufeBis(sw, bei);
    const a = sw.einreichen(plan);
    const akt = tempo ? [{ sample: tempo.sample, tu: (w) => w.uhr.setzeTempo(tempo.sample, tempo.bpm) }] : [];
    laufeBis(sw, bis, akt);
    const gB = sw.ereignisse.filter((e) => e.typ === 'takt' && e.takt === 25)[0]?.regler['B.gain']?.wert ?? null;
    erg[name] = { antwort: a, plan_status: sw.plaene[plan.id]?.status ?? null, B_gain_bei_takt_25: gB,
      ereignisse: sw.ereignisse.filter((e) => e.typ.startsWith('plan')).map((e) => ({ typ: e.typ, takt: e.takt, grund: e.grund, gruende: e.gruende, status: e.status })) };
  };
  einmal('ohne_hoerschein', { plan: PLAN_B() });
  einmal('mit_hoerschein', { hs: HS(), plan: PLAN_B({ hoerschein: 'H12' }) });
  einmal('hoerschein_bei_126_bpm', { hs: HS({ bpm: 126 }), plan: PLAN_B({ hoerschein: 'H12' }) });
  einmal('hoerschein_falsches_material', { hs: HS({ material: 'ki-song-6' }), plan: PLAN_B({ hoerschein: 'H12' }) });
  einmal('hoerschein_abgelaufen', { hs: HS({ gueltig_bis_schlag: schlagVon({ takt: 16 }) }), plan: PLAN_B({ hoerschein: 'H12' }) });
  einmal('zu_spaet', { hs: HS(), plan: { ...PLAN_B({ hoerschein: 'H12' }), teile: [{ regler: 'B.gain', art: 'rampe', ab: { takt: 9 }, dauer: { takte: 8 }, nach: 0.8 }] }, bei: T(9) + 11250 });
  einmal('zweitpruefung_tempo_geaendert', { hs: HS(), plan: PLAN_B({ hoerschein: 'H12' }), tempo: { sample: T(12), bpm: 132 } });
  einmal('nur_leiser_ohne_hoerschein', { plan: { id: 'pL', teile: [{ regler: 'A.gain', art: 'rampe', ab: { takt: 17 }, dauer: { takte: 8 }, nach: 0 }] } });
  einmal('sub_doppelt', { hs: HS(), plan: { id: 'pS', hoerschein: 'H12', teile: [
    { regler: 'B.gain', art: 'setze', ab: { takt: 17 }, nach: 0.8 }, { regler: 'B.bass', art: 'setze', ab: { takt: 17 }, nach: 1 }] } });
  einmal('basstausch_sauber', { hs: HS(), plan: { id: 'pT', hoerschein: 'H12', teile: [
    { regler: 'B.gain', art: 'rampe', ab: { takt: 17 }, dauer: { takte: 4 }, nach: 0.8 },
    { regler: 'A.bass', art: 'setze', ab: { takt: 21 }, nach: 0, gruppe: 'basstausch' },
    { regler: 'B.bass', art: 'setze', ab: { takt: 21 }, nach: 1, gruppe: 'basstausch' }] } });
  return erg;
}

// ---------- Kopplung: Hand an einem Teil einer Gruppe nimmt die ganze Gruppe mit ----------
export function gruppe(handRegler) {
  const sw = neuesStellwerk({}, { hoerscheine: HS() });
  laufeBis(sw, T(9));
  const a = sw.einreichen({ id: 'pT', hoerschein: 'H12', teile: [
    { regler: 'B.gain', art: 'rampe', ab: { takt: 17 }, dauer: { takte: 4 }, nach: 0.8 },
    { regler: 'A.gain', art: 'rampe', ab: { takt: 17 }, dauer: { takte: 8 }, nach: 0 },
    { regler: 'A.bass', art: 'setze', ab: { takt: 21 }, nach: 0, gruppe: 'basstausch' },
    { regler: 'B.bass', art: 'setze', ab: { takt: 21 }, nach: 1, gruppe: 'basstausch' }] });
  sw.hand({ sample: T(20), regler: handRegler, art: 'bewegung', wert: handRegler === 'A.bass' ? 0.99 : 0.81 });
  laufeBis(sw, T(23));
  const t22 = sw.ereignisse.find((e) => e.typ === 'takt' && e.takt === 22).regler;
  return { antwort: a.status, hand_an: handRegler, bei_takt_22: Object.fromEntries(Object.entries(t22).map(([k, v]) => [k, v.wert])),
    abgebrochen: sw.ereignisse.filter((e) => e.typ === 'plan_teil_abgebrochen').map((e) => ({ takt: e.takt, regler: e.regler })),
    plan_status: sw.plaene.pT.status };
}

function knapp(v) {
  const { sw, ...rest } = v;
  return rest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const V = {
    soll_mit_hand: lauf({ name: 'soll_mit_hand', hand: HANDGRIFF }),
    negativ_ohne_hand: lauf({ name: 'negativ_ohne_hand' }),
    naiv_block: lauf({ name: 'naiv_block', hand: HANDGRIFF, optionen: { quantisierung: 'block' } }),
    naiv_kein_schiedsrichter: lauf({ name: 'naiv_kein_schiedsrichter', hand: HANDGRIFF, optionen: { schiedsrichter: false } }),
    naiv_ganzer_plan: lauf({ name: 'naiv_ganzer_plan', hand: HANDGRIFF, optionen: { abbruch: 'plan' } }),
    uebernahme_sprung: lauf({ name: 'uebernahme_sprung', hand: HANDGRIFF, optionen: { uebernahme: 'sprung' } }),
    uebernahme_pickup: lauf({ name: 'uebernahme_pickup', hand: HANDGRIFF, optionen: { uebernahme: 'pickup' } }),
    uebernahme_relativ: lauf({ name: 'uebernahme_relativ', hand: HANDGRIFF_RELATIV, optionen: { uebernahme: 'relativ' } }),
    tempo_132_ab_takt_18: lauf({ name: 'tempo_132_ab_takt_18', tempo: { sample: T(18), bpm: 132 } }),
  };
  const aus = { erzeugt: new Date().toISOString(), sr: SR, block: BLOCK, takt_samples_128: 90000, plan: PLAN, handgriff: HANDGRIFF,
    varianten: Object.fromEntries(Object.entries(V).map(([k, v]) => [k, knapp(v)])),
    verriegelung: verriegelung(),
    gruppe_hand_an_A_bass: gruppe('A.bass'), gruppe_hand_an_A_gain: gruppe('A.gain') };
  writeFileSync(new URL('./ergebnis_ausfuehrung.json', import.meta.url), JSON.stringify(aus, null, 1));
  for (const k of ['soll_mit_hand', 'negativ_ohne_hand']) {
    writeFileSync(new URL(`./protokoll_${k}.jsonl`, import.meta.url), V[k].sw.ereignisse.map((e) => JSON.stringify({ set: 'probe-09', ...e })).join('\n') + '\n');
  }
  // Kurzbericht
  for (const [k, v] of Object.entries(V)) {
    const bass = v.stufen.find((s) => s.regler === 'A.bass');
    const gainSt = v.stufen.filter((s) => s.regler === 'A.gain');
    const ab = v.ereignisse.filter((e) => e.typ === 'plan_teil_abgebrochen').map((e) => `${e.regler.join('+')}@${e.sample}`);
    console.log(`${k.padEnd(26)} plan=${v.plan_status} gainT19=${v.werte[T(19)]['A.gain']} gainT21=${v.werte[T(21)]['A.gain']} gainT25=${v.werte[T(25)]['A.gain']} gainT27=${v.werte[T(27)]['A.gain']} bassStufe=${bass ? bass.sample : '-'} gainStufen=${gainSt.length} maxSprungGain=${v.max_sprung_gain?.d.toFixed(6)}@${v.max_sprung_gain?.sample} abbruch=${ab.join(',') || '-'}`);
  }
  console.log('verriegelung', JSON.stringify(Object.fromEntries(Object.entries(aus.verriegelung).map(([k, v]) => [k, [v.antwort.status, (v.antwort.gruende || []).map((g) => g.grund).join('+'), v.plan_status, v.B_gain_bei_takt_25, v.ereignisse.filter((e) => e.typ === 'plan_teil_verriegelt').map((e) => e.grund).join('+')]]))));
  console.log('gruppe A.bass', JSON.stringify(aus.gruppe_hand_an_A_bass));
  console.log('gruppe A.gain', JSON.stringify(aus.gruppe_hand_an_A_gain));
}
