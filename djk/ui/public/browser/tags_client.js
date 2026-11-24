// Tag client for the browser page: a thin fetch wrapper over the /tags routes and the resolver that turns what a person typed into a
// full <art>:<wort> tag. No DOM access, no state: every call goes to the page server. A refusal or a network failure throws an Error
// that carries `grund` (the reason code) and `text` (one English sentence).

const FREI = /^[a-z0-9][a-z0-9 -]{0,23}$/;   // the free-tag rule of the server (the preset TAG rule)

async function ruf(methode, pfad, koerper) {
  let antwort;
  try {
    antwort = await fetch(pfad, methode === 'GET' ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(koerper ?? {}) });
  } catch (e) {
    throw fehler('netz', `the page server cannot be reached: ${e && e.message ? e.message : e}`);
  }
  let j = null;
  try { j = await antwort.json(); } catch { /* no JSON body */ }
  if (!antwort.ok || (j && j.ok === false)) {
    const grund = (j && (j.grund || j.fehler)) || `http_${antwort.status}`;
    const e = fehler(grund, (j && j.text) || `the request was refused (${grund})`);
    if (j && j.betroffen !== undefined) e.betroffen = j.betroffen;
    e.code = antwort.status;
    throw e;
  }
  return j;
}

function fehler(grund, text) {
  const e = new Error(text);
  e.grund = grund;
  e.text = text;
  return e;
}

const kodiere = encodeURIComponent;

export const ladeVokabular = () => ruf('GET', '/tags/vokabular');
export const tagsVon = (item) => ruf('GET', `/tags?item=${kodiere(item)}`);
export const setzen = (items, tags, an) => ruf('POST', '/tags/setzen', { items, tags, an });
export const verwandt = (item) => ruf('GET', `/tags/verwandt?item=${kodiere(item)}`);
export const gespeichert = () => ruf('GET', '/tags/gespeichert');
export const merke = (s) => ruf('POST', '/tags/gespeichert', { name: s.name, tags: s.tags ?? [], text: s.text ?? '', ...(s.art ? { art: s.art } : {}) });
export const vergiss = (name) => ruf('POST', '/tags/gespeichert/weg', { name });

export function suche({ tags = [], text = '', art = '' } = {}) {
  const q = [];
  if (tags.length > 0) q.push(`tags=${tags.map(kodiere).join(',')}`);
  if (text) q.push(`text=${kodiere(text)}`);
  if (art) q.push(`art=${kodiere(art)}`);
  return ruf('GET', `/tags/suche${q.length ? `?${q.join('&')}` : ''}`);
}

// What a person typed -> a full tag, or null when it is not one (the UI then asks or shows the hint).
//   a full art:wort that exists            -> itself
//   a bare word found in exactly one art   -> that tag (a whole number 40..220 is a tempo, a key like 8a is a tonart)
//   a bare word found in several arts      -> null (the UI asks which)
//   otherwise a word that fits the free-tag rule -> frei:<wort>; anything else -> null
export function loeseTag(text, v) {
  const t = String(text ?? '').trim().toLowerCase();
  if (t === '') return null;
  const arten = new Map((v && v.arten ? v.arten : []).map((a) => [a.art, a]));
  const kennt = (art, wort) => {
    const a = arten.get(art);
    if (!a) return null;
    if (art === 'tempo') return /^[0-9]+$/.test(wort) && Number(wort) >= 40 && Number(wort) <= 220 && String(Number(wort)) === wort ? wort : null;
    if (art === 'frei') return FREI.test(wort) ? wort : null;
    const gross = art === 'tonart' ? wort.toUpperCase() : wort;
    return a.woerter.some((w) => w.wort === gross) ? gross : null;
  };
  const i = t.indexOf(':');
  if (i > 0) {
    const art = t.slice(0, i), wort = t.slice(i + 1);
    for (const w of new Set([wort, wort.replace(/ /g, '_')])) { const k = kennt(art, w); if (k !== null) return `${art}:${k}`; }
    return null;
  }
  const treffer = new Set();
  for (const w of new Set([t, t.replace(/ /g, '_')])) {
    for (const art of arten.keys()) {
      if (art === 'frei') continue;
      const k = kennt(art, w);
      if (k !== null) treffer.add(`${art}:${k}`);
    }
  }
  if (treffer.size === 1) return [...treffer][0];
  if (treffer.size > 1) return null;
  return FREI.test(t) ? `frei:${t}` : null;
}
