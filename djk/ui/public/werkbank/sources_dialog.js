// Workbench shelf, storage layout A4: the dialog of the source folders (SOURCES in the shelf header; FOLDERS is the mode switch next to LIBRARY). The person sees every folder of the source list
// (GET /quellen), adds one (POST /quellen/dazu) and removes one (POST /quellen/weg, after a confirm). The list file itself belongs to the server;
// this file only shows the answer and sends the two commands.
//
// Markup: div[data-w="quellen-dialog"] (hidden when closed) holds a div[data-w="quellen-zeile"][data-name] per source (span quellen-punkt with the
// class an for a reachable one, quellen-name, quellen-pfad, quellen-zustand, button quellen-weg REMOVE), the fields input quellen-pfad-feld, input
// quellen-name-feld (follows the last element of the path until it is edited), select quellen-art, input quellen-wechsel (removable disk; unset means
// the server decides), button quellen-dazu ADD, p quellen-text and button quellen-zu CLOSE. UI texts English.

export const QUELLEN_TEXT = {
  titel: 'SOURCE FOLDERS', knopf: 'SOURCES', knopfTitel: 'Show, add and remove the folders the studio reads sounds and tracks from',
  leer: 'No source folders yet. Add one below.',
  liest: 'Reading…',
  da: 'Reachable', platte: 'Drive missing', ordner: 'Folder missing or empty', keinPfad: 'No path on this machine',
  pfad: 'Folder path', pfadTitel: 'The full path of a folder, for example /media/you/Music',
  name: 'Name', nameTitel: 'Shown in the shelf and the library; filled in from the folder name',
  art: 'Kind', artTitel: 'What the folder holds',
  wechsel: 'Removable drive', wechselTitel: 'Unchecked: the studio decides from the path (a drive under /media is removable)',
  dazu: 'ADD', dazuTitel: 'Add this folder to the source list',
  weg: 'REMOVE', wegTitel: 'Remove this folder from the source list (the files stay where they are)',
  zu: 'CLOSE', zuTitel: 'Close this dialog',
  fragWeg: (name) => `Remove the source folder "${name}" from the list? The files stay where they are.`,
  pfadFehlt: 'Type the full path of the folder, starting with /',
  nameFehlt: 'Give the folder a name',
  dazuGut: (name) => `Added ${name}`, wegGut: (name) => `Removed ${name}`,
};
export const QUELLEN_ARTEN = [['sample', 'Samples'], ['oneshot', 'One-shots'], ['loop', 'Loops'], ['track', 'Tracks']];
const NAME_MAX = 40;

// The name a folder gets by default: its last path element (no trailing slash, no slash inside, at most 40 characters)
export function namenVorschlag(pfad) {
  const teile = String(pfad ?? '').split('/').filter((t) => t !== '');
  return (teile.at(-1) ?? '').slice(0, NAME_MAX);
}
// The state of one source of the answer: {an, text}. A root without a path for this machine is grey with its own text.
export function zustandVon(w) {
  if (w?.erreichbar === true) return { an: true, text: QUELLEN_TEXT.da };
  if (w?.grund === 'kein_pfad_fuer_rechner' || w?.pfad === null) return { an: false, text: QUELLEN_TEXT.keinPfad };
  return { an: false, text: w?.grund === 'ordner' ? QUELLEN_TEXT.ordner : QUELLEN_TEXT.platte };
}

const el = (tag, klasse, text) => { const e = document.createElement(tag); if (klasse) e.className = klasse; if (text !== undefined) e.textContent = text; return e; };
const markiere = (e, name) => { e.setAttribute('data-w', name); return e; };
const grossAnfang = (t) => `${t.charAt(0).toUpperCase()}${t.slice(1)}`;
const refusalText = (ctx, r) => (typeof r?.j?.text === 'string' && r.j.text !== '' ? grossAnfang(r.j.text) : ctx.antwortText(r));

// ctx: the workbench context (holeGet, holeJson, antwortText, frage). opt.mount: the element the dialog is appended to; opt.beiAenderung(): called after an
// add or a remove went through (the shelf reloads its folders). Returns {oeffne, schliesse, offen}.
export function bindeQuellenDialog(ctx, { mount, beiAenderung = () => {} }) {
  const dialog = markiere(el('div', 'w-quellen'), 'quellen-dialog');
  dialog.hidden = true;
  dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-label', QUELLEN_TEXT.titel);
  const kopf = el('div', 'w-quellen-kopf');
  const zuKnopf = markiere(el('button', 'w-effekt-knopf', QUELLEN_TEXT.zu), 'quellen-zu');
  zuKnopf.type = 'button'; zuKnopf.setAttribute('title', QUELLEN_TEXT.zuTitel);
  kopf.append(el('span', 'w-quellen-titel', QUELLEN_TEXT.titel), zuKnopf);
  const liste = markiere(el('div', 'w-quellen-liste'), 'quellen-liste');

  const feld = (klasse, name, label, titel, art = 'input') => {
    const f = markiere(el(art, klasse), name);
    f.setAttribute('aria-label', label); f.setAttribute('title', titel);
    return f;
  };
  const pfadFeld = feld('w-quellen-feld', 'quellen-pfad-feld', QUELLEN_TEXT.pfad, QUELLEN_TEXT.pfadTitel);
  pfadFeld.type = 'text'; pfadFeld.setAttribute('placeholder', QUELLEN_TEXT.pfad);
  const nameFeld = feld('w-quellen-feld kurz', 'quellen-name-feld', QUELLEN_TEXT.name, QUELLEN_TEXT.nameTitel);
  nameFeld.type = 'text'; nameFeld.setAttribute('placeholder', QUELLEN_TEXT.name); nameFeld.setAttribute('maxlength', String(NAME_MAX));
  const artWahl = feld('w-quellen-feld kurz', 'quellen-art', QUELLEN_TEXT.art, QUELLEN_TEXT.artTitel, 'select');
  for (const [wert, text] of QUELLEN_ARTEN) { const o = el('option', '', text); o.setAttribute('value', wert); artWahl.append(o); }
  artWahl.value = 'sample';
  const wechsel = feld('w-quellen-haken', 'quellen-wechsel', QUELLEN_TEXT.wechsel, QUELLEN_TEXT.wechselTitel);
  wechsel.type = 'checkbox'; wechsel.checked = false;
  const wechselEtikett = el('label', 'w-quellen-etikett'); wechselEtikett.setAttribute('title', QUELLEN_TEXT.wechselTitel);
  wechselEtikett.append(wechsel, el('span', '', QUELLEN_TEXT.wechsel));
  const dazuKnopf = markiere(el('button', 'w-effekt-knopf', QUELLEN_TEXT.dazu), 'quellen-dazu');
  dazuKnopf.type = 'button'; dazuKnopf.setAttribute('title', QUELLEN_TEXT.dazuTitel);
  const formular = el('div', 'w-quellen-form');
  formular.append(pfadFeld, nameFeld, artWahl, wechselEtikett, dazuKnopf);
  const text = markiere(el('p', 'w-quellen-text'), 'quellen-text');
  dialog.append(kopf, liste, formular, text);
  mount.append(dialog);

  let nameEigen = false, laeuft = false, serie = 0;
  const sage = (t, fehler = false) => { text.textContent = t ?? ''; text.classList.toggle('fehler', fehler); };

  function zeichne(wurzeln) {
    if (wurzeln.length === 0) { liste.replaceChildren(el('div', 'w-quellen-leer', QUELLEN_TEXT.leer)); return; }
    liste.replaceChildren(...wurzeln.map((w) => {
      const z = zustandVon(w);
      const zeile = markiere(el('div', 'w-quellen-zeile'), 'quellen-zeile');
      zeile.setAttribute('data-name', w.name);
      const punkt = markiere(el('span', `w-quellen-punkt${z.an ? ' an' : ''}`), 'quellen-punkt');
      punkt.setAttribute('title', z.text);
      const pfad = markiere(el('span', 'w-quellen-pfad', w.pfad ?? ''), 'quellen-pfad');
      if (w.pfad) pfad.setAttribute('title', w.pfad);
      const weg = markiere(el('button', 'w-effekt-knopf', QUELLEN_TEXT.weg), 'quellen-weg');
      weg.type = 'button'; weg.setAttribute('title', QUELLEN_TEXT.wegTitel);
      weg.addEventListener('click', () => entferne(w.name));
      zeile.append(punkt, markiere(el('span', 'w-quellen-name', w.name), 'quellen-name'), pfad, markiere(el('span', 'w-quellen-zustand', z.text), 'quellen-zustand'), weg);
      return zeile;
    }));
  }

  async function lade() {
    const mein = ++serie;
    const r = await ctx.holeGet('/quellen');
    if (mein !== serie || dialog.hidden) return;
    if (r.status !== 200 || !Array.isArray(r.j?.wurzeln)) { liste.replaceChildren(); sage(refusalText(ctx, r), true); return; }
    zeichne(r.j.wurzeln);
  }

  async function sende(weg, koerper, gut) {
    if (laeuft) return;
    laeuft = true; dazuKnopf.disabled = true;
    try {
      const r = await ctx.holeJson(weg, koerper);
      if (r.status !== 200 || !Array.isArray(r.j?.wurzeln)) { sage(refusalText(ctx, r), true); return false; }
      serie++;
      zeichne(r.j.wurzeln); sage(gut);
      beiAenderung();
      return true;
    } finally { laeuft = false; dazuKnopf.disabled = false; }
  }

  async function fuegeHinzu() {
    const pfad = pfadFeld.value.trim(), name = nameFeld.value.trim();
    if (!pfad.startsWith('/')) { sage(QUELLEN_TEXT.pfadFehlt, true); return; }
    if (name === '') { sage(QUELLEN_TEXT.nameFehlt, true); return; }
    const art = artWahl.value;
    const koerper = { name, pfad, art, regal: art !== 'track', ...(wechsel.checked ? { wechselplatte: true } : {}) };
    if (await sende('/quellen/dazu', koerper, QUELLEN_TEXT.dazuGut(name))) {
      pfadFeld.value = ''; nameFeld.value = ''; nameEigen = false; wechsel.checked = false;
    }
  }
  async function entferne(name) {
    if (!ctx.frage(QUELLEN_TEXT.fragWeg(name))) return;
    await sende('/quellen/weg', { name }, QUELLEN_TEXT.wegGut(name));
  }

  pfadFeld.addEventListener('input', () => { if (!nameEigen) nameFeld.value = namenVorschlag(pfadFeld.value); });
  nameFeld.addEventListener('input', () => { nameEigen = nameFeld.value !== ''; });
  for (const f of [pfadFeld, nameFeld]) {
    f.addEventListener('keydown', (ev) => { ev.stopPropagation?.(); if (ev.key === 'Enter') fuegeHinzu(); else if (ev.key === 'Escape') schliesse(); });
  }
  dazuKnopf.addEventListener('click', () => fuegeHinzu());
  zuKnopf.addEventListener('click', () => schliesse());

  function oeffne() {
    dialog.hidden = false; sage(''); liste.replaceChildren(el('div', 'w-quellen-leer', QUELLEN_TEXT.liest));
    lade();
  }
  function schliesse() { dialog.hidden = true; serie++; }
  return { oeffne, schliesse, offen: () => !dialog.hidden };
}
