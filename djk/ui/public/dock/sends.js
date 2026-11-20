// The send knobs of a card: one small knob per return on every track and group card (switch `sends`, PRODUCTION only).
// The model gives `karte.sends` empty without returns or with the switch off, so no knob appears then.
import { neuerDrehknopf, sendPos, sendDb, sendText } from './drehknopf.js';
import { sendWert, sendBefehl, sendLabel } from '../production/routing.js';

/** The send knobs of a track or group card: nothing, or ONE container `karte-sends` (a single row) with one column per return: the small knob and
 *  the short return name below it (the full name is the tooltip). `karte` is the card of the model (model.js), `frisch` the array the refresh functions go into. */
export function sendKnoepfe(host, karte, frisch) {
  const knoepfe = [];
  if (!host.schalter?.sends) return knoepfe;
  const box = document.createElement('div');
  box.className = 'w-karte-sends'; box.setAttribute('data-w', 'karte-sends');
  for (const send of karte?.sends ?? []) {
    const titel = sendLabel(karte.name, send.name);
    const schluessel = `${karte.id}:send:${send.return_id}`;
    // the current strand of the project (a track or a group), read at call time
    const strang = () => { const p = host.projekt(); return (karte.art === 'grp' ? p?.gruppen : p?.spuren)?.find((s) => s.id === karte.id) ?? null; };
    const k = neuerDrehknopf({
      w: 'karte-send', klein: true, nummer: '', name: send.kurz, titel, vorgabe: 0,
      lies: () => { const s = strang(); return s ? sendPos(sendWert(s, send.return_id)) : null; },
      setze: (pos) => { host.aendere(titel, [sendBefehl(karte.id, send.return_id, sendDb(pos))], schluessel); },
      text: (pos) => sendText(sendDb(pos)),
    });
    k.setAttribute('data-return-id', send.return_id);
    k.frisch(); frisch.push(k.frisch);
    const spalte = document.createElement('div'), nm = document.createElement('span');
    spalte.className = 'w-karte-sendspalte';
    nm.className = 'w-karte-sendname'; nm.textContent = send.kurz; nm.title = send.name;
    spalte.append(k, nm); box.append(spalte);
  }
  if (box.childElementCount) knoepfe.push(box);
  return knoepfe;
}
