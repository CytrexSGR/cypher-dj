// ID3v2-Leser (nur lesen) für die Mixed-In-Key-Tags: TIT2, TPE1, TBPM, TKEY, TXXX:EnergyLevel (Ersatz: COMM "9A - 5").
// Liest Frame für Frame mit Positionslesen und springt über große Frames (APIC), damit je Datei nur wenige KiB
// von der Platte kommen. Die Datei wird ausschließlich mit 'r' geöffnet.
import fs from 'node:fs';

export interface Tags {
  titel: string | null; artist: string | null; bpm: number | null; tonart: string | null; energie: number | null;
  id3: string | null; // "2.3", "2.4", "2.2" oder null (kein Tag)
}

const GEWOLLT = new Set(['TIT2', 'TPE1', 'TBPM', 'TKEY', 'TXXX', 'COMM', 'TT2', 'TP1', 'TBP', 'TKE', 'TXX', 'COM']);

// Klassische Tonartnamen auf Camelot (für Tags, die nicht von Mixed In Key stammen)
const CAMELOT: Record<string, string> = {
  'Abm': '1A', 'G#m': '1A', 'B': '1B', 'Ebm': '2A', 'D#m': '2A', 'F#': '2B', 'Gb': '2B', 'Bbm': '3A', 'A#m': '3A',
  'Db': '3B', 'C#': '3B', 'Fm': '4A', 'Ab': '4B', 'G#': '4B', 'Cm': '5A', 'Eb': '5B', 'D#': '5B', 'Gm': '6A',
  'Bb': '6B', 'A#': '6B', 'Dm': '7A', 'F': '7B', 'Am': '8A', 'C': '8B', 'Em': '9A', 'G': '9B', 'Bm': '10A', 'D': '10B',
  'F#m': '11A', 'Gbm': '11A', 'A': '11B', 'C#m': '12A', 'Dbm': '12A', 'E': '12B',
};

export function camelot(roh: string | null): string | null {
  if (!roh) return null;
  const t = roh.trim();
  const m = /^0?(\d{1,2})\s*([ABab])$/.exec(t);
  if (m) { const n = Number(m[1]); return n >= 1 && n <= 12 ? `${n}${m[2].toUpperCase()}` : null; }
  const k = t.replace(/\s*(maj(or)?)$/i, '').replace(/\s*(min(or)?)$/i, 'm').replace(/♯/g, '#').replace(/♭/g, 'b');
  return CAMELOT[k] ?? null;
}

function synchsafe(b: Buffer, o: number): number {
  return ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
}

function entunsync(b: Buffer): Buffer {
  const aus: number[] = [];
  for (let i = 0; i < b.length; i++) { aus.push(b[i]); if (b[i] === 0xff && b[i + 1] === 0x00) i++; }
  return Buffer.from(aus);
}

// Text nach ID3-Kodierbyte; liefert Liste der mit \0 getrennten Teile
function texte(enc: number, b: Buffer): string[] {
  let s: string;
  if (enc === 1 || enc === 2) {
    let d = b;
    let be = enc === 2;
    if (d.length >= 2 && d[0] === 0xff && d[1] === 0xfe) { d = d.subarray(2); be = false; } else if (d.length >= 2 && d[0] === 0xfe && d[1] === 0xff) { d = d.subarray(2); be = true; }
    const gerade = Buffer.from(d.subarray(0, d.length - (d.length % 2)));
    if (be) gerade.swap16();
    s = gerade.toString('utf16le');
    // BOMs mitten im String (UTF-16 mit BOM je Teil) entfernen
    s = s.replace(/﻿/g, '');
  } else if (enc === 3) s = b.toString('utf8');
  else s = b.toString('latin1');
  return s.split('\u0000');
}

function text(enc: number, b: Buffer): string { return texte(enc, b).filter((t) => t.length > 0)[0]?.trim() ?? ''; }

export function leseTags(datei: string): Tags {
  const t: Tags = { titel: null, artist: null, bpm: null, tonart: null, energie: null, id3: null };
  const fd = fs.openSync(datei, 'r');
  try {
    const kopf = Buffer.alloc(10);
    if (fs.readSync(fd, kopf, 0, 10, 0) < 10 || kopf.toString('latin1', 0, 3) !== 'ID3') return t;
    const haupt = kopf[3];
    const flags = kopf[5];
    const groesse = synchsafe(kopf, 6);
    if (haupt < 2 || haupt > 4) return t;
    t.id3 = `2.${haupt}`;
    const lies = (pos: number, n: number): Buffer => { const b = Buffer.alloc(n); const g = fs.readSync(fd, b, 0, n, pos); return b.subarray(0, g); };
    const tagUnsync = (flags & 0x80) !== 0 && haupt < 4;
    let pos = 10;
    const ende = 10 + groesse;
    if (haupt >= 3 && (flags & 0x40)) {
      const e = lies(pos, 4);
      pos += haupt === 4 ? synchsafe(e, 0) : e.readUInt32BE(0) + 4;
    }
    const idLen = haupt === 2 ? 3 : 4;
    const kopfLen = haupt === 2 ? 6 : 10;
    let comm: string | null = null;
    while (pos + kopfLen <= ende) {
      const fk = lies(pos, kopfLen);
      if (fk.length < kopfLen || fk[0] === 0) break;
      const id = fk.toString('latin1', 0, idLen);
      if (!/^[A-Z0-9]+$/.test(id)) break;
      const fg = haupt === 2 ? (fk[3] << 16) | (fk[4] << 8) | fk[5] : haupt === 4 ? synchsafe(fk, 4) : fk.readUInt32BE(4);
      const datenPos = pos + kopfLen;
      pos = datenPos + fg;
      if (fg <= 0 || !GEWOLLT.has(id) || fg > 65536) continue;
      let d = lies(datenPos, fg);
      const fflags = haupt === 4 ? fk[9] : 0;
      if (tagUnsync || (fflags & 0x02)) d = entunsync(d);
      if (haupt === 4 && (fflags & 0x01)) d = d.subarray(4); // Datenlängen-Indikator
      if (d.length < 2) continue;
      const enc = d[0];
      const rest = d.subarray(1);
      switch (id) {
        case 'TIT2': case 'TT2': t.titel = text(enc, rest) || null; break;
        case 'TPE1': case 'TP1': t.artist = text(enc, rest) || null; break;
        case 'TBPM': case 'TBP': { const v = Number.parseFloat(text(enc, rest).replace(',', '.')); t.bpm = Number.isFinite(v) && v > 0 ? v : null; break; }
        case 'TKEY': case 'TKE': t.tonart = camelot(text(enc, rest)); break;
        case 'TXXX': case 'TXX': {
          const [beschr, ...wert] = texte(enc, rest);
          const b = beschr?.trim().toLowerCase();
          if (b === 'energylevel') { const v = Number.parseInt(wert.join('').trim(), 10); if (Number.isFinite(v)) t.energie = v; }
          else if (b === 'comment' && comm === null) comm = wert.join('').trim() || null; // manche Tagger (ffmpeg) schreiben COMM so
          break;
        }
        case 'COMM': case 'COM': { if (comm === null && rest.length > 3) { const tt = texte(enc, rest.subarray(3)); comm = tt.slice(1).join('').trim() || tt[0]?.trim() || null; } break; }
      }
    }
    // Mixed In Key schreibt auch "9A - 5" in den Kommentar: Ersatz, wenn TKEY/EnergyLevel fehlen
    if (comm) {
      const m = /^\s*(\d{1,2}[AB])\s*-\s*(\d{1,2})\b/.exec(comm);
      if (m) { t.tonart ??= camelot(m[1]); t.energie ??= Number(m[2]); }
    }
    return t;
  } finally { fs.closeSync(fd); }
}
