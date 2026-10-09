// kit.json (ADR 024): klaenge [{note, name "<s>:<n>", datei, frames}]. Strudel s und n → Note des Kits; n läuft im
// Ring der Bank wie in Strudel (hh:3 bei zwei hh-Klängen = hh:1).
import fs from 'node:fs';

export function ladeKit(ordner) {
  const j = JSON.parse(fs.readFileSync(`${ordner}/kit.json`, 'utf8'));
  const note = new Map();
  const bank = new Map();
  for (const k of j.klaenge) {
    note.set(k.name, k.note);
    const s = k.name.split(':')[0];
    bank.set(s, (bank.get(s) ?? 0) + 1);
  }
  return { name: j.name, note, bank };
}

// MVP 2 Scheibe 3 (E2): Basis-Kit und Zusatz-Kit (Mitschnitte) wie der Kern mit kit:<a>+<b>. Fehlt das Zusatz-Kit,
// gilt nur das Basis-Kit. Zusatz-Kit auf 128 + note wie im Kern (F08).
const ZUSATZ_NOTE = 128;  // = KIT_NOTEN im Kern (kit.h)
export function ladeKits(ordnerBasis, ordnerZusatz) {
  const a = ladeKit(ordnerBasis);
  if (!ordnerZusatz || !fs.existsSync(`${ordnerZusatz}/kit.json`)) return a;
  const b = ladeKit(ordnerZusatz);
  for (const [n, note] of b.note) a.note.set(n, ZUSATZ_NOTE + note);
  for (const [s, anzahl] of b.bank) a.bank.set(s, (a.bank.get(s) ?? 0) + anzahl);
  return { name: `${a.name}+${b.name}`, note: a.note, bank: a.bank };
}

export function noteFuer(kit, wert) {
  const s = typeof wert === 'string' ? wert : wert?.s;
  if (!s || !kit.bank.has(s)) return null;
  const n = Math.max(0, Math.floor(Number(wert?.n ?? 0)) || 0) % kit.bank.get(s);
  return kit.note.get(`${s}:${n}`) ?? null;
}
