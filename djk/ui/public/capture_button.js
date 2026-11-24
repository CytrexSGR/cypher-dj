// REC MIX (journey tours, task 2): the header key that records the master mix of the studio to a WAV file (POST /mitschnitt/start|stopp, GET /mitschnitt/stand).
// Idle: "REC MIX". Running: a red dot and the elapsed time "REC 12:34", read from /mitschnitt/stand once per second, only while the tab is visible.
// A click while running stops and shows one line "Saved: <file name>" (the full path in the title) for 10 s. A refusal shows its reason text in the same place.
const MELDUNG_MS = 10000;
export const RUHE_TEXT = 'REC MIX';
export const RUHE_TITEL = 'Record the master mix of the studio to a WAV file; click again to stop';

export const uhrText = (sekunden) => {
  const s = Math.max(0, Math.floor(Number(sekunden) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const zwei = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${zwei(m)}:${zwei(r)}` : `${zwei(m)}:${zwei(r)}`;
};
const dateiName = (pfad) => String(pfad ?? '').split('/').pop() || String(pfad ?? '');

/** Binds the key. ruf(methode, pfad, body?) -> {code, j} (default: fetch); zeit gives the timers and the tab visibility (tests inject them).
 *  Returns { tick, klick, zustand }: tick() = one stand poll, klick() = what a click does. */
export function bindeMitschnitt({ knopf, ruf, zeit = {}, sichtbar }) {
  const http = ruf ?? (async (methode, pfad, body) => {
    const r = await fetch(pfad, { method: methode, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { code: r.status, j: await r.json().catch(() => ({})) };
  });
  const setzeInterval = zeit.setInterval ?? ((f, ms) => setInterval(f, ms)), loescheInterval = zeit.clearInterval ?? ((id) => clearInterval(id));
  const setzeTimeout = zeit.setTimeout ?? ((f, ms) => setTimeout(f, ms)), loescheTimeout = zeit.clearTimeout ?? ((id) => clearTimeout(id));
  const istSichtbar = sichtbar ?? (() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  let laeuft = false, uhr = null, meldung = null, beschaeftigt = false, sekunden = 0, datei = '';

  const zeichne = () => {
    if (meldung) return;   // a line (saved or refused) holds the key's text until it expires
    knopf.classList.toggle('laeuft', laeuft);
    knopf.classList.toggle('meldung', false);
    knopf.setAttribute('aria-pressed', laeuft ? 'true' : 'false');
    knopf.textContent = laeuft ? `● REC ${uhrText(sekunden)}` : RUHE_TEXT;
    knopf.title = laeuft ? `Recording to ${datei}. Click to stop.` : RUHE_TITEL;
  };
  const zeigeMeldung = (text, titel, fehler) => {
    if (meldung) loescheTimeout(meldung);
    knopf.classList.toggle('laeuft', false);
    knopf.classList.toggle('meldung', true);
    knopf.classList.toggle('fehler', !!fehler);
    knopf.textContent = text;
    knopf.title = titel ?? '';
    meldung = setzeTimeout(() => { meldung = null; knopf.classList.toggle('fehler', false); zeichne(); if (!laeuft) pruefe(); }, MELDUNG_MS);
  };
  const stoppeUhr = () => { if (uhr !== null) { loescheInterval(uhr); uhr = null; } };
  const starteUhr = () => { if (uhr === null) uhr = setzeInterval(() => { if (istSichtbar()) tick(); }, 1000); };
  const setze = (an, s, d) => {
    laeuft = an; sekunden = s ?? 0; if (d) datei = d;
    if (an) starteUhr(); else stoppeUhr();
    zeichne();
  };
  const pruefe = async () => {
    try {
      const r = await http('GET', '/mitschnitt/stand');
      if (r.code === 200) setze(!!r.j.laeuft, r.j.sekunden, r.j.datei);
    } catch { /* page server gone: the key keeps its state */ }
  };
  const tick = async () => { if (laeuft) await pruefe(); };
  const grundText = (r) => r.j?.text || r.j?.grund || 'The recording could not be started.';

  const klick = async () => {
    if (beschaeftigt) return;
    beschaeftigt = true;
    try {
      if (meldung) { loescheTimeout(meldung); meldung = null; knopf.classList.toggle('fehler', false); }
      if (laeuft) {
        const r = await http('POST', '/mitschnitt/stopp', {});
        setze(false, 0);
        if (r.code === 200 && r.j.ok) zeigeMeldung(`Saved: ${dateiName(r.j.datei)}`, r.j.datei, false);
        else zeigeMeldung(grundText(r), r.j?.detail, true);
      } else {
        const r = await http('POST', '/mitschnitt/start', {});
        if (r.code === 200 && r.j.ok) setze(true, 0, r.j.datei);
        else zeigeMeldung(grundText(r), r.j?.detail, true);
      }
    } catch { zeigeMeldung('The page server did not answer.', '', true); }
    finally { beschaeftigt = false; }
  };
  knopf.addEventListener('click', klick);
  if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('visibilitychange', () => { if (istSichtbar()) tick(); });
  zeichne();
  pruefe();   // a page reload during a recording shows it again
  return { tick, klick, zustand: () => ({ laeuft, sekunden, meldung: meldung !== null }) };
}
