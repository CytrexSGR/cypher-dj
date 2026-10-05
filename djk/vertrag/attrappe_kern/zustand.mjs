// Neustart-Zustand der Attrappe (Gegenstück zu SCHNITTSTELLEN §6.3, als JSON-Datei statt Seqlock): Anker, Karte,
// offene Befehle und Teile, Regler, Decks, Hörscheine, KI, Erzeuger, Abonnenten. Nach einem Neustart setzt die Attrappe
// auf dem Anker fort (ADR 004 Regel 2): Sample = anker_sample + (jetzt_ns − anker_mono_ns)·48000/10⁹, auf den nächsten
// Blockanfang gerundet; generation + 1; /e/neustart an alle gespeicherten Abonnenten; /q/stand nach /k/hallo.

import fs from 'node:fs';
import path from 'node:path';
import { Karte, SR } from './uhr.mjs';
import { REGLER } from './vertrag.mjs';

const VERSION = 1;
const ersetze = (k, v) => (typeof v === 'bigint' ? { $big: v.toString() } : v === Infinity ? { $inf: 1 } : Number.isNaN(v) ? { $nan: 1 } : v);
const belebe = (k, v) => (v && typeof v === 'object' && '$big' in v ? BigInt(v.$big) : v && typeof v === 'object' && '$inf' in v ? Infinity : v && typeof v === 'object' && '$nan' in v ? NaN : v);

export function sichere(K) {
  const teile = K.teile.map(({ vorher, ...t }) => t);
  const r = [];
  for (const [pfad, x] of K.r ?? []) if (x.spur || x.halter !== 'frei' || x.wert !== REGLER.get(pfad).vorgabe) r.push([pfad, { wert: x.wert, halter: x.halter, spur: x.spur, letzteHand: x.letzteHand }]);
  return JSON.stringify({
    version: VERSION, generation: K.generation, anker: K.anker, jetzt: K.jetzt, seq: K.seq,
    karte: K.uhr.sicher(), befehle: [...K.befehle.values()], teile,
    abos: [...K.abos.values()], r, decks: K.decks, hand: K.hand?.q ?? [], hs: [...(K.hs?.values() ?? [])],
    ki: K.ki, leds: K.leds, latenz: K.latenz, erz: K.erz ? { stroeme: [...K.erz.stroeme], ev: K.erz.ev } : null,
  }, ersetze);
}

export function stelleWieder(K, text, { jetztNs }) {
  const z = JSON.parse(text, belebe);
  if (z.version !== VERSION) throw new Error(`Zustand Version ${z.version}, erwartet ${VERSION}`);
  K.anker = z.anker;
  K.uhr = Karte.aus(z.karte);
  K.seq = z.seq;
  const befehle = new Map(z.befehle.map((b) => [b.key, b]));
  K.teile = z.teile.map((t) => ({ ...t, b: t.b.intern ? t.b : befehle.get(t.b.key) ?? t.b }));
  K.befehle = befehle;
  if (K.r) for (const [pfad, x] of z.r) Object.assign(K.r.get(pfad), x);
  if (z.decks) K.decks = z.decks;
  if (K.hand) K.hand.q = z.hand;
  if (K.hs) K.hs = new Map(z.hs.map((h) => [h.hs_id, h]));
  if (z.ki) K.ki = z.ki;
  if (z.leds) K.leds = z.leds;
  if (z.latenz) K.latenz = z.latenz;
  if (z.erz && K.erz) { K.erz.stroeme = new Map(z.erz.stroeme); K.erz.ev = z.erz.ev; }
  const roh = z.anker.sample + (Number(jetztNs - BigInt(z.anker.mono_ns)) * SR) / 1e9;
  const blockanfang = z.anker.sample + Math.ceil((roh - z.anker.sample) / 256) * 256;
  K.jetzt = Math.max(z.jetzt, blockanfang);
  K.generation = z.generation + 1;
  K.neustartSample = K.jetzt;
  K.abos = new Map(z.abos.map((a) => [a.name, { ...a, letzte: K.jetzt }]));
  K.stempel = K.jetzt;
  K.aus('/e/neustart', [K.generation, BigInt(K.jetzt)]);
  K.aus('/e/fx/routing', [K.fxRouting ?? 0]);   // Vorgabe Post Fader; der Wunsch liegt beim Seiten-Server (Ohr Task 15)
}

export function schreibeDatei(K, datei) {
  fs.mkdirSync(path.dirname(datei), { recursive: true });
  const tmp = `${datei}.tmp`;
  fs.writeFileSync(tmp, sichere(K));
  fs.renameSync(tmp, datei);
}

export function leseDatei(datei) {
  try { return fs.readFileSync(datei, 'utf8'); } catch { return null; }
}
