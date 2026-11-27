// Agent keys (strand 9, slice 2): the store behind `authorization: Bearer <token>`. Built like the tablet pairing (coupling.ts):
// 32 random bytes as base64url, only the SHA-256 is stored, compared in constant time, files 0600 in a 0700 folder, written via tmp + rename.
//   - <ordner>/hand_schluessel.json: { schluessel: [{ id, name, stufe, hash, seit, zuletzt }] }
//   - <ordner>/hand.token: the local hand's token (stufe zerstoerend), created at start if missing; the hand reads it (same OS user)
// No token value is ever logged; neu() returns a new one exactly once.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { sha, zufall } from './coupling.ts';
import type { Stufe } from './hand_schutz.ts';

export const SCHLUESSEL_RE = /^Bearer ([A-Za-z0-9_-]{43})$/;
const TOKEN_DATEI_RE = /^[A-Za-z0-9_-]{43}\n?$/;
const STUFEN: readonly Stufe[] = ['lesen', 'schreiben', 'zerstoerend'];
const ZULETZT_SPEICHERN_MS = 3600 * 1000;   // the last-use time goes to disk at most once an hour per key
export const LOKAL_ID = 'lokal';

export interface Schluessel { id: string; name: string; stufe: Stufe; hash: string; seit: number; zuletzt: number }
export interface SchluesselInfo { id: string; name: string; stufe: Stufe; seit: number; zuletzt: number }

export class HandSchluessel {
  private schluessel: Schluessel[] = [];
  private readonly gespeichert = new WeakMap<Schluessel, number>();   // the last-use time that is on disk
  private readonly ordner: string;
  private readonly datei: string;
  private readonly tokenDatei: string;
  private readonly jetzt: () => number;
  constructor(ordner: string, jetzt: () => number = Date.now) {
    this.ordner = ordner; this.jetzt = jetzt;
    this.datei = path.join(ordner, 'hand_schluessel.json');
    this.tokenDatei = path.join(ordner, 'hand.token');
    try {
      const j = JSON.parse(fs.readFileSync(this.datei, 'utf8')) as { schluessel?: unknown };
      if (Array.isArray(j.schluessel)) {
        this.schluessel = j.schluessel
          .filter((s): s is Schluessel => typeof s?.id === 'string' && typeof s?.hash === 'string' && /^[0-9a-f]{64}$/.test(s.hash)
            && STUFEN.includes(s?.stufe))
          .map((s) => ({ id: s.id, name: String(s.name ?? ''), stufe: s.stufe, hash: s.hash, seit: Number(s.seit) || 0, zuletzt: Number(s.zuletzt) || 0 }));
        for (const s of this.schluessel) this.gespeichert.set(s, s.zuletzt);
      }
    } catch { /* no file yet or unreadable: no keys */ }
  }

  /** Makes sure the local hand has a key: an intact hand.token (43 chars, no group/other mode bits) is registered under id 'lokal';
   *  otherwise a new one is written. */
  sichereLokal(): void {
    let token: string | null = null;
    try {
      const st = fs.statSync(this.tokenDatei);
      const inhalt = fs.readFileSync(this.tokenDatei, 'utf8');
      if (st.isFile() && (st.mode & 0o077) === 0 && TOKEN_DATEI_RE.test(inhalt)) token = inhalt.trim();
    } catch { /* missing or unreadable: a new one is written */ }
    if (token === null) {
      token = zufall();
      this.schreibe(this.tokenDatei, `${token}\n`);
    }
    const hash = sha(token).toString('hex');
    const da = this.schluessel.find((s) => s.id === LOKAL_ID);
    if (da && da.hash === hash && da.stufe === 'zerstoerend') return;
    const t = this.jetzt();
    this.schluessel = this.schluessel.filter((s) => s.id !== LOKAL_ID);
    const s: Schluessel = { id: LOKAL_ID, name: 'local hand', stufe: 'zerstoerend', hash, seit: t, zuletzt: 0 };
    this.schluessel.unshift(s);
    this.gespeichert.set(s, 0);
    this.sichere();
  }

  /** A new key. The token is returned once; only its hash is kept. */
  neu(name: string, stufe: Stufe): { id: string; token: string } {
    if (!STUFEN.includes(stufe)) throw new Error(`unknown stufe: ${String(stufe)}`);
    const token = zufall(), id = crypto.randomBytes(6).toString('hex'), t = this.jetzt();
    const s: Schluessel = { id, name: String(name).replace(/[^\x20-\x7e]/g, '').slice(0, 80), stufe, hash: sha(token).toString('hex'), seit: t, zuletzt: 0 };
    this.schluessel.push(s);
    this.gespeichert.set(s, 0);
    this.sichere();
    return { id, token };
  }

  /** The key an Authorization header belongs to, or null. Hashes the presented value and compares it to every stored hash in constant time (no early exit). */
  pruefe(authKopf: string | undefined): { id: string; name: string; stufe: Stufe } | null {
    const m = SCHLUESSEL_RE.exec(String(authKopf ?? ''));
    if (!m) return null;
    const h = sha(m[1] as string);
    let treffer: Schluessel | null = null;
    for (const s of this.schluessel) if (crypto.timingSafeEqual(h, Buffer.from(s.hash, 'hex')) && treffer === null) treffer = s;
    if (treffer === null) return null;
    const t = this.jetzt();
    treffer.zuletzt = t;
    const aufPlatte = this.gespeichert.get(treffer) ?? 0;   // 0: never used so far, the first use goes to disk at once
    if (aufPlatte === 0 || t - aufPlatte > ZULETZT_SPEICHERN_MS) { this.gespeichert.set(treffer, t); this.sichere(); }
    return { id: treffer.id, name: treffer.name, stufe: treffer.stufe };
  }

  /** All keys without their hashes (for GET /hand/schluessel). */
  liste(): SchluesselInfo[] {
    return this.schluessel.map(({ id, name, stufe, seit, zuletzt }) => ({ id, name, stufe, seit, zuletzt }));
  }

  /** Removes a key. 'lokal' may be revoked too: sichereLokal() at the next start writes a new token file. */
  widerrufe(id: string): boolean {
    const n = this.schluessel.length;
    this.schluessel = this.schluessel.filter((s) => s.id !== id);
    if (this.schluessel.length === n) return false;
    if (id === LOKAL_ID) try { fs.rmSync(this.tokenDatei, { force: true }); } catch { /* the stale file is replaced at the next start anyway */ }
    this.sichere();
    return true;
  }

  private sichere(): void {
    this.schreibe(this.datei, JSON.stringify({ schluessel: this.schluessel }, null, 1) + '\n');
  }
  private schreibe(datei: string, inhalt: string): void {
    fs.mkdirSync(this.ordner, { recursive: true, mode: 0o700 });
    const tmp = `${datei}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, inhalt, { mode: 0o600 });
    fs.chmodSync(tmp, 0o600);   // an old tmp file left by a crash may carry other bits
    fs.renameSync(tmp, datei);
  }
}
