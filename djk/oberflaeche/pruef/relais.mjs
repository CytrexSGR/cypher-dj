// Zähl-Relais vor dem Kern (Scheibe 60m, Prüfung): jedes Datagramm an den Kern wird dekodiert protokolliert und
// weitergereicht; Antworten des Kerns an den Absender-Port (etwa /e/protokollfehler an von.port) gehen zurück.
// Ein Upstream-Socket je Absender-Port, damit der Kern jeden Absender einzeln sieht. Unabhängiges Instrument: es
// weiß nichts von der Seite, es zählt am Draht.
import dgram from 'node:dgram';
import fs from 'node:fs';
import { liesUndDekodiere } from '../../leitstand/src/adressen.ts';

export function starteRelais({ hoeren, kern, log }) {
  const fd = fs.openSync(log, 'a');
  const ein = dgram.createSocket('udp4');
  const hoch = new Map(); // Absender-Port → Socket zum Kern
  const zaehler = { n: 0 };
  const zeile = (z) => fs.writeSync(fd, JSON.stringify(z) + '\n');
  ein.on('message', (buf, r) => {
    let d;
    try { d = liesUndDekodiere(buf); } catch (e) { d = { adresse: '?', felder: { fehler: e.message } }; }
    zaehler.n++;
    zeile({ t: Date.now(), von_port: r.port, adresse: d.adresse, felder: d.felder });
    let s = hoch.get(r.port);
    if (!s) {
      s = dgram.createSocket('udp4');
      s.on('message', (b) => ein.send(b, r.port, '127.0.0.1'));
      s.bind(0, '127.0.0.1');
      hoch.set(r.port, s);
    }
    s.send(buf, kern, '127.0.0.1');
  });
  return new Promise((ok) => ein.bind(hoeren, '127.0.0.1', () => ok({
    zaehler,
    stoppe: () => { ein.close(); for (const s of hoch.values()) s.close(); fs.closeSync(fd); },
  })));
}
