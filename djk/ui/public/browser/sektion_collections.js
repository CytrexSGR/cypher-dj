// COLLECTIONS (browser plan 2, task 12): the collections panel of PRODUCTION (public/collections.js) moved into the section: same rows, same drags
// (sample, preset, device), same open collection with RENAME and DELETE. The "Add to collection" menus are bound on the rows of LIBRARY, INSTRUMENTS AND
// EFFECTS and PRESETS themselves. A 404 on /kollektionen is the honest state, nothing is faked.
// Task 13: below the collections a SMART group lists the saved searches of plan 7 (GET /tags/gespeichert); a 404 hides the group.
import { baueAbschnitt } from './abschnitt.js';
import { bindeKollektionen } from '../collections.js';
import { gespeichert, vergiss } from './tags_client.js';

export const KOLL_NICHT_DA = 'Collections are not available in this build yet';

export function baueKollektionenAbschnitt(host, dienste = {}) {
  const a = baueAbschnitt({ id: 'kollektionen', titel: 'COLLECTIONS', offen: false });
  const koerper = document.createElement('div');
  koerper.className = 'b-kollektionen';
  const smart = document.createElement('div');
  smart.className = 'b-smart'; smart.hidden = true;
  const k = bindeKollektionen({ holeGet: host.holeGet, holeJson: host.holeJson, melde: host.melde }, { wurzel: koerper });
  async function ladeSmart() {
    let r;
    try { r = await gespeichert(); } catch { smart.hidden = true; return; }   // 404 or a refusal: no group, no made-up list
    const liste = Array.isArray(r?.suchen) ? r.suchen : [];
    smart.textContent = '';
    smart.hidden = liste.length === 0;
    if (liste.length === 0) return;
    const kopf = document.createElement('div'); kopf.className = 'b-zusatz b-smart-kopf'; kopf.textContent = 'SMART';
    smart.append(kopf);
    for (const s of liste) {
      const z = document.createElement('div'); z.className = 'b-zeile klickbar b-smart-zeile';
      const t = document.createElement('span'); t.className = 'b-text'; t.textContent = s.name; t.title = [...(s.tags ?? []), s.text].filter(Boolean).join(' ');
      z.append(t);
      if (typeof s.anzahl === 'number') { const n = document.createElement('span'); n.className = 'b-zusatz'; n.textContent = String(s.anzahl); z.append(n); }
      z.addEventListener('click', () => dienste.setzeSuche?.({ text: s.text ?? '', tags: s.tags ?? [] }));
      const weg = document.createElement('button'); weg.type = 'button'; weg.className = 'b-taste'; weg.textContent = 'DELETE'; weg.title = 'Forget this saved search';
      weg.addEventListener('click', async (e) => { e.stopPropagation(); try { await vergiss(s.name); } catch (x) { host.melde(x.text ?? 'Not deleted', true); } await ladeSmart(); });
      z.append(weg);
      smart.append(z);
    }
  }
  async function laden() {
    const r = await host.holeGet('/kollektionen');
    if (r.status === 404) return a.setze('nicht_da', KOLL_NICHT_DA);
    if (r.status !== 200) return a.setze('fehler', r.j?.text);
    a.setze('inhalt');
    if (!koerper.isConnected) { a.rumpf.textContent = ''; a.rumpf.append(koerper, smart); }
    await k.lade();
    await ladeSmart();
  }
  return { wurzel: a.wurzel, laden };
}
