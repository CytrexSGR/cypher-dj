// The address grammar of device windows: `/#geraet=<target>` (ADR 041, decision 2). Pure and free of imports so the opener (device_open.js), the window page
// (target_window.js) and, in stage 3, the controller focus share one vocabulary.
//   <target> = <track id>        a plain id without a colon: the instrument of a track (the window that follows the track in front)
//            | ins:<stage id>    one effect stage of a strip      | ret:<id>   a return      | grp:<id>   a group      | master
// Later targets (stage 5b: fx:<n>, color, kanal:<path>) are reserved: they parse to null today, so an address of that form never reads as a track.

const PRAEFIXE = ['ins', 'ret', 'grp'];
const RESERVIERT = /^color$/;

/** `{ art: 'spur' | 'ins' | 'ret' | 'grp' | 'master', id, text }` of a target text, or null. */
export function parseZiel(text) {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  if (t === '') return null;
  if (t === 'master') return { art: 'master', id: 'master', text: t };
  const i = t.indexOf(':');
  if (i < 0) return RESERVIERT.test(t) ? null : { art: 'spur', id: t, text: t };
  const art = t.slice(0, i), id = t.slice(i + 1);
  if (!PRAEFIXE.includes(art) || id === '') return null;   // reserved words (fx:, kanal:) and unknown prefixes land here too
  return { art, id, text: t };
}

/** The target text of a kind and an id, or null. */
export function formatZiel(art, id) {
  if (art === 'master') return 'master';
  if (art === 'spur') return typeof id === 'string' && id !== '' && parseZiel(id)?.art === 'spur' ? id : null;
  if (!PRAEFIXE.includes(art) || typeof id !== 'string' || id === '') return null;
  return `${art}:${id}`;
}

/** The address fragment of a parsed target (`#geraet=ins%3Ai7`). */
export const zielHash = (z) => `#geraet=${encodeURIComponent(z.text)}`;

const HASH = /^#geraet=(.+)$/;
/** The target a page address names (encoded or plain), or null when it is not a device window address. */
export function zielAusHash(hash) {
  const m = HASH.exec(typeof hash === 'string' ? hash : '');
  if (!m) return null;
  let text;
  try { text = decodeURIComponent(m[1]); } catch { return null; }
  return parseZiel(text);
}

/** The browser window name of a target: one for every track (it follows the synth in front), one per other target (a second WINDOW ↗ focuses it). */
export const zielName = (z) => (z.art === 'spur' ? 'djk-geraet' : `djk-geraet-${z.text.replace(/[^A-Za-z0-9_-]/g, '_')}`);
