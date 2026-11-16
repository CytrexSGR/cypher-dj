// Workbench SOUND region, sampler B task 3: TO KIT. The strip action of the cut (ctx.schnittAktionen, schnitt_streifen.js) opens a dialog that turns the
// selected slices into a drum kit in the kit folder (POST /sampler/kit) and puts the kit on a new DRUM track (KIT TO TRACK: the workbench's own
// werkbank_spur_neu command, one undo step, the same refusals as + INSTRUMENT TRACK).
//
// Markup: div[data-w="kit-dialog"] appended to the SOUND region, hidden when closed. It holds input[data-w="kit-name"] (the kit name), one
// div[data-w="kit-klang"][data-scheibe=<0-based>] per slice (span kit-nr = slice number, input kit-bank with a datalist, span kit-voll = "bd:1 · note 37",
// button kit-hoeren "▶", span kit-lang for a slice longer than 10 s), p[data-w="kit-text"] and the buttons kit-schreiben "WRITE KIT", kit-spur
// "KIT TO TRACK", kit-zu "CLOSE". The user edits the bank only; the number follows from the slice order (the numbers of a bank run 0, 1, 2 ...).
// The dialog closes when the selected track or its cut changes (also the same cut with other bounds, ctx.beiSchnittGeaendert), or the module changes, and sends nothing more after that. UI texts English.
import { neueSpurBefehl, NEU_TEXT } from './tracks.js';

export const KIT_TEXT = {
  knopf: 'TO KIT', knopfTitel: 'Make a drum kit of the selected slices',
  titel: 'KIT FROM SLICES', name: 'Kit name', nameTitel: 'The kit is written to the kit folder under this name',
  bankTitel: 'Bank name: the sound is named <bank>:<number>, the number follows from the slice order',
  hoeren: '▶', hoerenTitel: 'Hear the slice through the track',
  schreiben: 'WRITE KIT', schreibenTitel: 'Write the kit to the kit folder',
  spur: 'KIT TO TRACK', spurTitel: 'Put the written kit on a new DRUM track of this module',
  zu: 'CLOSE', zuTitel: 'Close this dialog',
  laedt: 'Reading the proposal…',
  hinweis: 'The banks are proposed from the sound of each slice. Change them as you like; a kit name that exists is refused.',
  zuLang: 'Longer than 10 s: remove it from the selection',
  bankFalsch: 'A bank is a to z, 0 to 9 and _, starting with a letter, at most 16 characters; the number is given in slice order',
  nameFalsch: 'A kit name is a to z, 0 to 9, _ and -, 1 to 32 characters',
  nichtGelegt: 'The track could not be added',
  geaendert: 'The cut changed. Select the slices again.',
  geschrieben: (kit, namen) => `Kit ${kit}: ${namen.join(' · ')}`,
  voll: (name, note) => `${name} · note ${note}`,
  laenger: (takte) => `The module is now ${takte} bars long, so every hit of the kit plays.`,
};
const MODUL_BEATS = [4, 8, 16, 32, 64];   // the module lengths of the top bar, as areas/sampler/area.ts grows them for SLICE TO TRACK
// KIT TO TRACK writes the hits where the slices sit in the cut (muster of POST /sampler/kit), on a loop as long as the cut, so the track plays at once.
// A module shorter than the cut grows to the first length that holds it, in the same history step (only a module length; any other loop stays).
// `takte` is the new module length in bars, null when it stays. Without a muster (an older server) the track is the empty one of + INSTRUMENT TRACK.
export function kitSpurBefehle(p, b, muster) {
  if (!muster || !Array.isArray(muster.noten) || !(muster.beats > 0)) return { befehle: [b], takte: null };
  const l = p?.loop;
  const laenge = l?.an && l.von_beat === 0 && MODUL_BEATS.includes(l.bis_beat) && l.bis_beat < muster.beats ? MODUL_BEATS.find((x) => x >= muster.beats) ?? null : null;
  const spur = { ...b, loop_beats: muster.beats, noten: muster.noten };
  return { befehle: [...(laenge === null ? [] : [{ befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: laenge }]), spur], takte: laenge === null ? null : laenge / 4 };
}
export const KIT_BANK = /^[a-z][a-z0-9_]{0,15}$/;
export const KIT_NAME = /^[a-z0-9_-]{1,32}$/;
export const KIT_BANK_LISTE = ['bd', 'sd', 'hh', 'cp', 'perc'];
export const KIT_ERSTE_NOTE = 36;

const el = (tag, klasse, text) => { const e = document.createElement(tag); if (klasse) e.className = klasse; if (text !== undefined) e.textContent = text; return e; };
const markiere = (e, name) => { e.setAttribute('data-w', name); return e; };
const grossAnfang = (t) => `${t.charAt(0).toUpperCase()}${t.slice(1)}`;
// the text of the server when the answer has one (the sampler routes carry their own English text), else the page's text for the reason
const refusalText = (ctx, r) => (typeof r?.j?.text === 'string' && r.j.text !== '' ? grossAnfang(r.j.text) : ctx.antwortText(r));
const nummeriere = (banken) => { const z = new Map(); return banken.map((b) => { const k = z.get(b) ?? 0; z.set(b, k + 1); return `${b}:${k}`; }); };

export function bindeSchnittKit(ctx) {
  if (!Array.isArray(ctx.schnittAktionen)) return;
  const { st, $ } = ctx;
  const host = $('klang');
  const listeId = 'w-kit-banken';

  const dialog = markiere(el('div', 'w-kit'), 'kit-dialog');
  dialog.hidden = true;
  const kopf = el('div', 'w-kit-kopf');
  const name = markiere(el('input', 'w-kit-name'), 'kit-name');
  name.type = 'text'; name.setAttribute('aria-label', KIT_TEXT.name); name.setAttribute('title', KIT_TEXT.nameTitel); name.setAttribute('maxlength', '32');
  kopf.append(markiere(el('span', 'w-kit-titel', KIT_TEXT.titel), 'kit-titel'), name);
  const liste = el('div', 'w-kit-liste');
  const datenliste = el('datalist');
  datenliste.setAttribute('id', listeId);
  for (const b of KIT_BANK_LISTE) { const o = el('option'); o.setAttribute('value', b); datenliste.append(o); }
  const text = markiere(el('p', 'w-kit-text'), 'kit-text');
  const knopf = (n, t, titelText, klickt) => {
    const b = markiere(el('button', 'w-effekt-knopf', t), n);
    b.type = 'button'; b.setAttribute('title', titelText); b.addEventListener('click', klickt);
    return b;
  };
  const schreibenKnopf = knopf('kit-schreiben', KIT_TEXT.schreiben, KIT_TEXT.schreibenTitel, () => schreibe());
  const spurKnopf = knopf('kit-spur', KIT_TEXT.spur, KIT_TEXT.spurTitel, () => zuSpur());
  const zuKnopf = knopf('kit-zu', KIT_TEXT.zu, KIT_TEXT.zuTitel, () => schliesse());
  const knoepfe = el('div', 'w-kit-knoepfe');
  knoepfe.append(schreibenKnopf, spurKnopf, zuKnopf);
  dialog.append(kopf, liste, datenliste, text, knoepfe);
  host.append(dialog);

  // The open dialog: { wahl, slug, serie, vorschlag, zeilen: [{ klang, zeile, bank, voll, lang }], geschrieben, laeuft, meldung }
  let dlg = null;
  let serie = 0;

  function schliesse() {
    dlg = null; serie++;
    dialog.hidden = true;
    liste.replaceChildren();
  }

  const bankenJetzt = () => dlg.zeilen.map((z) => z.bank.value);
  const zeigeZustand = () => {
    if (!dlg) return;
    const banken = bankenJetzt(), namen = nummeriere(banken);
    let bankenOk = true, zuLang = false;
    dlg.zeilen.forEach((z, k) => {
      const ok = KIT_BANK.test(banken[k]);
      if (!ok) bankenOk = false;
      z.bank.classList.toggle('falsch', !ok);
      z.voll.textContent = ok ? KIT_TEXT.voll(namen[k], KIT_ERSTE_NOTE + k) : '';
      if (z.klang.zu_lang) zuLang = true;
    });
    const nameOk = KIT_NAME.test(name.value);
    name.classList.toggle('falsch', !nameOk);
    const geschrieben = dlg.geschrieben !== null;
    const grund = dlg.zeilen.length === 0 ? '' : zuLang ? KIT_TEXT.zuLang : !bankenOk ? KIT_TEXT.bankFalsch : !nameOk ? KIT_TEXT.nameFalsch : '';
    schreibenKnopf.disabled = dlg.laeuft || geschrieben || dlg.zeilen.length === 0 || zuLang || !bankenOk || !nameOk;
    schreibenKnopf.setAttribute('title', grund !== '' && !geschrieben ? grund : KIT_TEXT.schreibenTitel);
    spurKnopf.disabled = dlg.laeuft || !geschrieben;
    text.textContent = dlg.meldung ?? (dlg.vorschlag === null ? KIT_TEXT.laedt : grund !== '' ? grund : KIT_TEXT.hinweis);
    text.classList.toggle('fehler', dlg.fehler === true);
  };
  const sage = (meldung, fehler = false) => { if (dlg) { dlg.meldung = meldung; dlg.fehler = fehler; zeigeZustand(); } };

  function baueZeilen(klaenge) {
    const zeilen = klaenge.map((k) => {
      const zeile = markiere(el('div', 'w-kit-klang'), 'kit-klang');
      zeile.setAttribute('data-scheibe', String(k.scheibe));
      const bank = markiere(el('input', 'w-kit-bank'), 'kit-bank');
      bank.type = 'text'; bank.setAttribute('list', listeId); bank.setAttribute('title', KIT_TEXT.bankTitel); bank.setAttribute('maxlength', '17');
      bank.setAttribute('aria-label', `Bank of slice ${k.scheibe + 1}`);
      bank.value = k.bank;
      bank.addEventListener('input', () => { if (dlg && dlg.geschrieben === null) { dlg.meldung = null; zeigeZustand(); } });
      const voll = markiere(el('span', 'w-kit-voll'), 'kit-voll');
      const hoeren = markiere(el('button', 'w-effekt-knopf w-kit-hoeren', KIT_TEXT.hoeren), 'kit-hoeren');
      hoeren.type = 'button'; hoeren.setAttribute('title', KIT_TEXT.hoerenTitel);
      hoeren.addEventListener('click', () => hoere(k.scheibe));
      zeile.append(markiere(el('span', 'w-kit-nr', String(k.scheibe + 1)), 'kit-nr'), bank, voll, hoeren);
      if (k.zu_lang) zeile.append(markiere(el('span', 'w-kit-lang', KIT_TEXT.zuLang), 'kit-lang'));
      return { klang: k, zeile, bank, voll };
    });
    liste.replaceChildren(...zeilen.map((z) => z.zeile));
    return zeilen;
  }
  name.addEventListener('input', () => { if (dlg && dlg.geschrieben === null) { dlg.meldung = null; zeigeZustand(); } });

  // The strip action: opens the dialog for the selection and reads the proposal.
  async function lauf(wahl) {
    const mein = ++serie;
    dlg = { wahl: { spur_id: wahl.spur_id, schnitt_id: wahl.schnitt_id, scheiben: [...wahl.scheiben] }, slug: st.slug, serie: mein, vorschlag: null, zeilen: [],
      geschrieben: null, laeuft: false, meldung: null, fehler: false };
    const d = dlg;
    liste.replaceChildren();
    name.value = ''; name.removeAttribute('readonly'); name.classList.remove('falsch');
    dialog.hidden = false;
    zeigeZustand();
    const r = await ctx.holeGet(`/sampler/kit/vorschlag?id=${encodeURIComponent(wahl.schnitt_id)}&scheiben=${wahl.scheiben.join(',')}`);
    if (dlg !== d) return;   // closed or opened again while the answer was on its way
    if (r.status !== 200 || !Array.isArray(r.j?.klaenge)) { d.vorschlag = false; sage(refusalText(ctx, r), true); return; }
    d.vorschlag = r.j;
    name.value = typeof r.j.kit === 'string' ? r.j.kit : '';
    d.zeilen = baueZeilen(r.j.klaenge);
    d.meldung = null;
    zeigeZustand();
  }

  async function hoere(scheibe) {
    const d = dlg;
    if (!d) return;
    const r = await ctx.holeJson('/sampler/hoeren', { spur_id: d.wahl.spur_id, scheibe });
    if (dlg !== d) return;
    if (r.status !== 200) sage(refusalText(ctx, r), true);
  }

  async function schreibe() {
    const d = dlg;
    if (!d || d.laeuft || d.geschrieben !== null || d.zeilen.length === 0 || schreibenKnopf.disabled) return;
    d.laeuft = true; d.meldung = null; zeigeZustand();
    const koerper = { id: d.wahl.schnitt_id, scheiben: d.zeilen.map((z) => z.klang.scheibe), banken: bankenJetzt(), kit: name.value };
    const r = await ctx.holeJson('/sampler/kit', koerper);
    if (dlg !== d) return;   // the dialog was closed meanwhile: the kit is on disk, nothing more happens here
    d.laeuft = false;
    if (r.status !== 200 || !Array.isArray(r.j?.klaenge)) { sage(refusalText(ctx, r), true); return; }
    d.geschrieben = r.j;
    for (const z of d.zeilen) z.bank.setAttribute('readonly', '');
    name.setAttribute('readonly', '');
    name.value = r.j.kit;
    sage(KIT_TEXT.geschrieben(r.j.kit, r.j.klaenge.map((k) => k.name)));
  }

  // KIT TO TRACK: the command of + INSTRUMENT TRACK with the kit as its device; the kit stays on disk when the module refuses.
  async function zuSpur() {
    const d = dlg;
    if (!d || d.laeuft || d.geschrieben === null) return;
    if (!st.projekt || st.slug !== d.slug) { schliesse(); return; }
    const kit = d.geschrieben.kit;
    const b = neueSpurBefehl(st.projekt, { name: kit, geraet: { art: 'intern', name: 'kit', kit } });
    if (!b) { sage(NEU_TEXT.voll, true); return; }
    const { befehle, takte } = kitSpurBefehle(st.projekt, b, d.geschrieben.muster);
    d.laeuft = true; zeigeZustand();
    const ok = await ctx.aendere(`Add track ${b.name}`, befehle);
    if (dlg !== d) return;
    d.laeuft = false;
    if (!ok) { sage($('meldung')?.textContent || KIT_TEXT.nichtGelegt, true); return; }   // the writer showed the refusal in the message line already
    const neu = st.projekt?.spuren?.find((x) => x.art === 'instrument' && x.name === b.name);
    schliesse();
    if (neu) ctx.waehle(neu.id);
    if (takte !== null) ctx.melde(KIT_TEXT.laenger(takte));
  }

  ctx.beiSchnittWahl?.push((wahl) => {
    if (dlg && (!wahl || wahl.spur_id !== dlg.wahl.spur_id || wahl.schnitt_id !== dlg.wahl.schnitt_id)) schliesse();
  });
  // A cut can change under the same id (a marker moved, set or removed, CUT AGAIN, or another hand cut it): the slice numbers and the proposed banks of the
  // dialog belong to the old cut, so it closes and sends nothing more.
  ctx.beiSchnittGeaendert?.push((id) => {
    if (dlg && dlg.wahl.schnitt_id === id) { schliesse(); ctx.melde(KIT_TEXT.geaendert, true); }
  });
  ctx.beimProjekt.push((_p, wechsel) => { if (dlg && wechsel) schliesse(); });

  ctx.schnittAktionen.push({ id: 'kit', text: KIT_TEXT.knopf, titel: KIT_TEXT.knopfTitel, aktiv: (w) => w.scheiben.length > 0, lauf });
  ctx.zeichneSchnitt?.();
}
