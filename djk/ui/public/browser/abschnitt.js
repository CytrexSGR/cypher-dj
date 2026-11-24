// Section shell of the browser (browser plan 2, task 3): a collapsible block with the honest states laedt, leer, nicht_da, fehler.
// holeAbschnitt reads one route and sorts the answer into a state: a sibling route that is not built yet (404) is a dim "not available" note, never a crash.
export const abschnittSchluessel = (id) => `djk-browser-abschnitt-${id}`;
export function liesAbschnittOffen(speicher, id, standard) {
  let w = null;
  try { w = speicher?.getItem(abschnittSchluessel(id)) ?? null; } catch { /* without storage: the default */ }
  return w === 'ja' ? true : w === 'nein' ? false : standard;
}
export function merkeAbschnittOffen(speicher, id, offen) {
  try { speicher?.setItem(abschnittSchluessel(id), offen ? 'ja' : 'nein'); } catch { /* without storage: only now */ }
}

export async function holeAbschnitt(host, url) {
  const r = await host.holeGet(url);
  if (r.status >= 200 && r.status < 300) return { zustand: 'inhalt', j: r.j };
  if (r.status === 404) return { zustand: 'nicht_da' };
  const grund = r.j?.grund ?? r.j?.fehler;
  if (r.status === 409 && grund === 'kein_projekt') return { zustand: 'kein_projekt' };
  return { zustand: 'fehler', text: r.j?.text || `The request failed (${r.status || 'no connection'})` };
}

const LEER_TEXT = { laedt: 'Loading…', leer: 'Nothing here yet', nicht_da: 'Not available in this build yet', fehler: 'The request failed' };

export function baueAbschnitt({ id, titel, offen = true }, speicher = globalThis.localStorage) {
  const wurzel = document.createElement('section');
  wurzel.className = 'b-abschnitt'; wurzel.dataset.abschnitt = id;
  const kopf = document.createElement('button');
  kopf.type = 'button'; kopf.className = 'b-kopf'; kopf.textContent = titel;
  const zustandZeile = document.createElement('div');
  zustandZeile.className = 'b-zustand'; zustandZeile.setAttribute('role', 'status');
  const rumpf = document.createElement('div');
  rumpf.className = 'b-rumpf';
  wurzel.append(kopf, zustandZeile, rumpf);
  const zeige = (an) => { wurzel.classList.toggle('zu', !an); kopf.setAttribute('aria-expanded', String(an)); };
  let an = liesAbschnittOffen(speicher, id, offen);
  zeige(an);
  kopf.addEventListener('click', () => { an = !an; zeige(an); merkeAbschnittOffen(speicher, id, an); });
  function setze(zustand, text) {
    wurzel.dataset.zustand = zustand;
    if (zustand === 'inhalt') { zustandZeile.textContent = ''; zustandZeile.hidden = true; return; }
    rumpf.textContent = '';
    zustandZeile.hidden = false;
    zustandZeile.textContent = text ?? LEER_TEXT[zustand] ?? '';
  }
  setze('laedt');
  return { wurzel, kopf, rumpf, setze };
}
