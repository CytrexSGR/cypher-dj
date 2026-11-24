// String literals of a JS or TS source, without comments: [{ start, end, text }] where start..end spans the quotes.
// Small hand-written scanner (comments, quotes, template literals with nested code in ${}, regex literals); used by the wording guard.
export function literaleVon(src) {
  const aus = [];
  const n = src.length;

  function einfach(start) {
    const q = src[start];
    let j = start + 1;
    while (j < n && src[j] !== q && src[j] !== '\n') { if (src[j] === '\\') j++; j++; }
    return j + 1;
  }
  function schablone(start) {   // src[start] is the opening backtick; returns the index after the closing one
    let j = start + 1;
    while (j < n && src[j] !== '`') {
      if (src[j] === '\\') { j += 2; continue; }
      if (src[j] === '$' && src[j + 1] === '{') { j = code(j + 2, true); continue; }
      j++;
    }
    return j + 1;
  }
  // Scans code from i; with imBlock it stops after the brace that closes the block opened before i. Records string literals.
  function code(i, imBlock) {
    let tiefe = 0, letztes = '';
    const regexErlaubt = () => letztes === '' || '(,=:[!&|?{};+-*%<>~^'.includes(letztes);
    while (i < n) {
      const c = src[i];
      if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
      if (c === '\'' || c === '"') { const e = einfach(i); aus.push({ start: i, end: e, text: src.slice(i + 1, e - 1) }); i = e; letztes = 'x'; continue; }
      if (c === '`') { const e = schablone(i); aus.push({ start: i, end: e, text: src.slice(i + 1, e - 1) }); i = e; letztes = 'x'; continue; }
      if (c === '/' && regexErlaubt()) {
        let j = i + 1, klasse = false;
        while (j < n && src[j] !== '\n' && (klasse || src[j] !== '/')) { if (src[j] === '\\') j++; else if (src[j] === '[') klasse = true; else if (src[j] === ']') klasse = false; j++; }
        i = j + 1; letztes = 'x'; continue;
      }
      if (c === '{') tiefe++;
      if (c === '}') { if (imBlock && tiefe === 0) return i + 1; tiefe--; }
      if (!/\s/.test(c)) letztes = c;
      i++;
    }
    return i;
  }
  code(0, false);
  // nested template literals record their own entries too; the outer text already contains them, so sort for stable output
  return aus.sort((a, b) => a.start - b.start);
}
