// 1.9 U5: a fake Surge host for the mirror tests: a unix socket <ordner>/wirt-arr<slot>.sock that speaks the one-line JSON protocol of
// hosts/carla/host_control.py for `fahre` and `ist` and records every command. Only inside a folder the test made (never a live socket).
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

// a short folder (unix socket paths are limited to 107 bytes)
export function wirtOrdner(t) {
  const d = fs.mkdtempSync(path.join('/tmp', 'sw-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

// the part of a Surge patch XML the session reads: the type of filter 1 of scene A (0 = off, as in Templates/Init Saw)
export const patchXml = (typ) => `<?xml version="1.0" encoding="UTF-8"?>\n<patch revision="16"><parameters>\n<a_filter1_type type="0" value="${typ}" deactivated="0" />\n<a_filter1_cutoff type="2" value="3.00000000000000" extend_range="0" />\n</parameters></patch>\n`;

export function falscherWirt(t, ordner, slot, werte = {}) {
  const h = { befehle: [], werte: { ...werte }, antwort: null, halte: null };   // halte: a promise every answer waits for (a slow host)
  const sock = path.join(ordner, `wirt-arr${slot}.sock`);
  const server = net.createServer((c) => {
    let d = '';
    c.on('data', async (b) => {
      d += b;
      if (!d.endsWith('\n')) return;
      const befehl = JSON.parse(d); d = '';
      h.befehle.push(befehl);
      let r = h.antwort?.(befehl);                 // a test can answer a command itself (an error answer changes nothing in the host)
      if (!r) {
        r = { ok: true };
        if (befehl.befehl === 'fahre') h.werte[befehl.name] = befehl.bis;
        else if (befehl.befehl === 'ist') r = { ok: true, werte: Object.fromEntries(befehl.namen.map((n) => [n, h.werte[n]])) };
        else if (befehl.befehl === 'zustand' && h.filter1Typ !== undefined) r = { ok: true, xml: patchXml(h.filter1Typ) };   // set h.filter1Typ to answer the state
      }
      if (h.halte) await h.halte;
      c.end(JSON.stringify(r) + '\n');
    });
    c.on('error', () => {});
  });
  server.listen(sock);
  t.after(() => server.close());
  h.fahrten = () => h.befehle.filter((b) => b.befehl === 'fahre').map((b) => [b.name, b.bis, b.dauer]);
  h.sock = sock;
  return h;
}
