// A small QR code encoder for the pairing link (task 10): no library, no CDN, no network. Byte mode, error correction level L, versions 1 to 6
// (up to 134 bytes; the pairing link is about 85). Returns the module matrix or an SVG; the page draws it black on white with the quiet zone a scanner needs.
// Layout, masks and format bits follow ISO/IEC 18004; tests/qr.test.mjs compares the matrix module by module with an independent encoder.

// version -> [data codewords in all, error correction codewords per block, blocks] for level L
const L_TABELLE = { 1: [19, 7, 1], 2: [34, 10, 1], 3: [55, 15, 1], 4: [80, 20, 1], 5: [108, 26, 1], 6: [136, 18, 2] };
const AUSRICHTUNG = { 2: 18, 3: 22, 4: 26, 5: 30, 6: 34 };   // centre of the one alignment pattern (versions 2 to 6)
export const QR_MAX_BYTES = 134;

const EXP = new Array(512), LOG = new Array(256);
{ let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; }
const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function reedSolomon(daten, n) {   // the n error correction codewords of `daten`
  let g = [1];
  for (let i = 0; i < n; i++) { const next = new Array(g.length + 1).fill(0); for (let j = 0; j < g.length; j++) { next[j] ^= g[j]; next[j + 1] ^= mul(g[j], EXP[i]); } g = next; }
  const rest = new Array(n).fill(0);
  for (const b of daten) {
    const f = b ^ rest.shift(); rest.push(0);
    if (f !== 0) for (let i = 0; i < n; i++) rest[i] ^= mul(g[i + 1], f);
  }
  return rest;
}

function codewoerter(bytes, v) {
  const [gesamt, ec, bloecke] = L_TABELLE[v];
  const bits = [];
  const put = (wert, n) => { for (let i = n - 1; i >= 0; i--) bits.push((wert >>> i) & 1); };
  put(0b0100, 4); put(bytes.length, 8);
  for (const b of bytes) put(b, 8);
  for (let i = 0; i < 4 && bits.length < gesamt * 8; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const daten = [];
  for (let i = 0; i < bits.length; i += 8) daten.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; daten.length < gesamt; pad ^= 0xec ^ 0x11) daten.push(pad);
  const je = gesamt / bloecke, teile = [], ecs = [];
  for (let b = 0; b < bloecke; b++) { const t = daten.slice(b * je, (b + 1) * je); teile.push(t); ecs.push(reedSolomon(t, ec)); }
  const aus = [];
  for (let i = 0; i < je; i++) for (const t of teile) aus.push(t[i]);
  for (let i = 0; i < ec; i++) for (const e of ecs) aus.push(e[i]);
  return aus;
}

const MASKEN = [
  (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function strafe(m) {   // the four penalty rules of the standard (lower is better)
  const n = m.length;
  let p = 0, dunkel = 0;
  const reihe = (get) => {
    for (let a = 0; a < n; a++) {
      let lauf = 1;
      for (let b = 1; b <= n; b++) {
        if (b < n && get(a, b) === get(a, b - 1)) lauf++; else { if (lauf >= 5) p += 3 + lauf - 5; lauf = 1; }
      }
      for (let b = 0; b + 6 < n; b++) {   // 1011101 with four light modules on one side
        if (get(a, b) && !get(a, b + 1) && get(a, b + 2) && get(a, b + 3) && get(a, b + 4) && !get(a, b + 5) && get(a, b + 6)) {
          const vor = b >= 4 && [1, 2, 3, 4].every((d) => !get(a, b - d)), nach = b + 10 < n && [7, 8, 9, 10].every((d) => !get(a, b + d));
          if (vor || nach) p += 40;
        }
      }
    }
  };
  reihe((a, b) => m[a][b]); reihe((a, b) => m[b][a]);
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) { const c = m[y][x]; if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3; }
  for (const z of m) for (const c of z) if (c) dunkel++;
  p += 10 * (Math.ceil(Math.abs(dunkel * 20 - n * n * 10) / (n * n)) - 1);
  return p;
}

/** The QR matrix (array of rows of booleans, true = dark) for `text` (UTF-8), or throws when it does not fit. `maske` 0..7 forces a mask (tests); else the best one. */
export function qrMatrix(text, maske) {
  const bytes = [...new TextEncoder().encode(text)];
  const v = Object.keys(L_TABELLE).map(Number).find((x) => bytes.length <= L_TABELLE[x][0] - 2);
  if (v === undefined) throw new Error(`QR: ${bytes.length} bytes do not fit (at most ${QR_MAX_BYTES})`);
  const n = 17 + 4 * v;
  const m = Array.from({ length: n }, () => new Array(n).fill(false)), fn = Array.from({ length: n }, () => new Array(n).fill(false));
  const setze = (x, y, dunkel) => { m[y][x] = dunkel; fn[y][x] = true; };
  const sucher = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      setze(x, y, d !== 2 && d !== 4);
    }
  };
  sucher(3, 3); sucher(n - 4, 3); sucher(3, n - 4);
  for (let i = 8; i < n - 8; i++) { setze(i, 6, i % 2 === 0); setze(6, i, i % 2 === 0); }
  if (AUSRICHTUNG[v]) { const c = AUSRICHTUNG[v]; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setze(c + dx, c + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1); }
  const reserviere = (x, y) => { fn[y][x] = true; };   // the two copies of the format bits, filled once the mask is known
  for (let b = 0; b <= 5; b++) reserviere(8, b);
  reserviere(8, 7); reserviere(8, 8); reserviere(7, 8);
  for (let b = 9; b < 15; b++) reserviere(14 - b, 8);
  for (let b = 0; b < 8; b++) reserviere(n - 1 - b, 8);
  for (let b = 8; b < 15; b++) reserviere(8, n - 15 + b);
  setze(8, n - 8, true);   // the dark module
  const daten = codewoerter(bytes, v);
  let i = 0;
  for (let rechts = n - 1; rechts >= 1; rechts -= 2) {
    if (rechts === 6) rechts = 5;
    for (let senk = 0; senk < n; senk++) for (let j = 0; j < 2; j++) {
      const x = rechts - j, y = ((rechts + 1) & 2) === 0 ? n - 1 - senk : senk;
      if (!fn[y][x] && i < daten.length * 8) { m[y][x] = ((daten[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; }
    }
  }
  const mitMaske = (k) => {
    const z = m.map((r) => r.slice());
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!fn[y][x] && MASKEN[k](x, y)) z[y][x] = !z[y][x];
    const d = (0b01 << 3) | k;   // level L = 01
    let rest = d;
    for (let b = 0; b < 10; b++) rest = (rest << 1) ^ ((rest >>> 9) * 0x537);
    const bits = ((d << 10) | rest) ^ 0x5412;
    const bit = (b) => ((bits >>> b) & 1) === 1;
    const f = (x, y, b) => { z[y][x] = bit(b); };
    for (let b = 0; b <= 5; b++) f(8, b, b);
    f(8, 7, 6); f(8, 8, 7); f(7, 8, 8);
    for (let b = 9; b < 15; b++) f(14 - b, 8, b);
    for (let b = 0; b < 8; b++) f(n - 1 - b, 8, b);
    for (let b = 8; b < 15; b++) f(8, n - 15 + b, b);
    z[n - 8][8] = true;
    return z;
  };
  if (maske !== undefined) return mitMaske(maske);
  let beste = null, besteStrafe = Infinity;
  for (let k = 0; k < 8; k++) { const z = mitMaske(k), s = strafe(z); if (s < besteStrafe) { besteStrafe = s; beste = z; } }
  return beste;
}

/** The QR code as an SVG string: black modules on white, with a 4 module quiet zone (a scanner needs it, whatever the page theme is). */
export function qrSvg(text, { modul = 6, rand = 4 } = {}) {
  const m = qrMatrix(text), n = m.length, g = (n + 2 * rand) * modul;
  let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y][x]) d += `M${(x + rand) * modul} ${(y + rand) * modul}h${modul}v${modul}h-${modul}z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${g} ${g}" width="${g}" height="${g}" role="img" aria-label="QR code of the pairing link"><rect width="${g}" height="${g}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
