// PRODUCTION (D1 V1): Spurköpfe links neben dem Arrangement (DOM, Spec 2.11), je Spur Farbe, Name, Gerät, M, S,
// Lautstärke, Pan und Pegel (A6-Bedienung). Jede Bedienung geht über aendere() an POST /proj/aendern (Spec 3.4
// spur_aendern), damit sie im Projekt und im Undo-Verlauf landet. Der Pegel kommt ohne eigenen Code: app.js zeigePegel
// füllt jedes .meter[data-kanal="spur/<nr>"] aus /pegel (Spec 3.4: /pegel geht schon heute für jeden Kanal durch).
import { FARBEN } from './layout.js';
import { MAX_SPUREN } from './grenzen.js';
import { armZustand } from './aufnahme.js';
import { ausgangOptionen, ausgangWert, ausgangBefehl } from './routing.js';

// Fader −60..+6 dB; ganz unten heißt aus (−200), wie die Spurbänder es halten (spurband.js baender: min −60, aus −200)
export const FADER_MIN = -60, FADER_MAX = 6, FADER_AUS = -200;
export const faderWert = (v) => (v <= FADER_MIN ? FADER_AUS : Math.min(FADER_MAX, v));
export const faderText = (db) => (db <= FADER_MIN ? '−∞' : `${db > 0 ? '+' : ''}${db.toFixed(1)}`.replace('-', '−'));
export const panText = (p) => (Math.abs(p) < 0.005 ? 'C' : `${p < 0 ? 'L' : 'R'}${Math.round(Math.abs(p) * 100)}`);
export function geraetText(s) {
  if (s.art === 'audio') return 'AUDIO';
  if (s.geraet?.art === 'intern' && s.geraet.name === 'rb338') return 'RB-338';
  if (s.geraet?.art === 'wirt') return `${String(s.geraet.name).toUpperCase()} · ${s.geraet.slot}`;
  return String(s.geraet?.name ?? '?').toUpperCase();
}
export const naechsteFarbe = (f) => FARBEN[(FARBEN.indexOf(f) + 1) % FARBEN.length];
// ↑/↓: Zielindex in der Spurliste für spur_verschieben {spur_id, index}; am Rand (oder unbekannte Spur/Richtung) null
export function zielIndex(anzahl, index, richtung) {
  if (!(index >= 0 && index < anzahl)) return null;
  if (richtung === 'hoch') return index > 0 ? index - 1 : null;
  if (richtung === 'runter') return index < anzahl - 1 ? index + 1 : null;
  return null;
}

// Zugänglicher Name je Bedienelement mit Spurbezug: ohne ihn lesen sich acht Spuren als acht gleiche „M“, „S“, „↑“ (Oberfläche englisch)
export const spurLabels = (name) => ({
  mute: `Mute ${name}`, solo: `Solo ${name}`, hoch: `Move ${name} up`, runter: `Move ${name} down`, farbe: `Colour ${name}`,
  loeschen: `Delete track ${name}`, umbenennen: `Rename track ${name}`, fader: `Volume ${name}`, pan: `Pan ${name}`,
});
// Umbenennen per Tastatur: Enter oder F2 auf dem fokussierten Namen (wie Doppelklick)
export const istUmbenennenTaste = (e) => (e.key === 'Enter' || e.key === 'F2') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;

const KOPF = `<button class="p-farbe" title="Track colour: click for the next one"></button>
<span class="p-spurname" role="button" tabindex="0" title="Double click, Enter or F2 to rename"></span><span class="p-geraet"></span>
<button class="p-hoch" title="Move track up">↑</button><button class="p-runter" title="Move track down">↓</button>
<button class="p-mute" aria-pressed="false" title="Mute">M</button><button class="p-solo" aria-pressed="false" title="Solo">S</button>
<button class="p-arm" aria-pressed="false" title="Arm for recording (needs an input)" disabled>●</button><select class="p-eingang" title="Recording input" disabled><option value="">input</option><option value="erz/1">erz/1</option><option value="erz/2">erz/2</option><option value="erz/3">erz/3</option></select>
<button class="p-loeschen" title="Delete track (Undo brings it back)">✕</button>
<input class="p-fader" type="range" min="${FADER_MIN}" max="${FADER_MAX}" step="0.5" title="Volume (double click: 0 dB)"><select class="p-ausgang" title="Output: Master or a group track"></select>
<output class="p-faderwert"></output>
<input class="p-pan" type="range" min="-1" max="1" step="0.01" title="Pan (double click: centre)">
<output class="p-panwert"></output>
<div class="meter waagrecht p-pegel"><i></i></div>`;

// aendereAus(rechne) (V2 Fix-Runde 2 H1, Spec 6.34): M, S, Farbe und ↑/↓ folgen aus dem Stand der Spur und rechnen darum erst, wenn die Anfrage an der
// Reihe ist, aus genau dem Stand, dessen rev mitgeht (zwei schnelle Klicks auf M: an, dann aus; vorher zweimal an). Fader, Pan, Name, Löschen sind fest.
export function bindeKoepfe(behaelter, { aendere, aendereAus }) {
  const stand = new Map();     // spur_id → Spur laut letztem Projekt
  const greift = new Set();    // `${id}:fader|pan`, solange die Hand am Regler ist: der Server überschreibt dann nicht
  const els = new Map();       // spur_id → Element
  let reihenfolge = [];        // spur_ids in Anzeigereihenfolge (Array-Reihenfolge des Projekts)
  let gruppenStand = [];       // Gruppen laut letztem Projekt (Auswahl der Ausgang-Wahl)

  function baue(id) {
    const el = document.createElement('div');
    el.className = 'p-kopf';
    el.dataset.spur = id;
    el.innerHTML = KOPF;
    const q = (s) => el.querySelector(s);
    const spur = () => stand.get(id);
    const aendernSpur = (label, felder, schluessel = null) => aendere(label, [{ befehl: 'spur_aendern', spur_id: id, ...felder }], schluessel);
    // rechne(spur, projekt) → {label, felder} | null aus der Spur im Stand beim Senden; ist sie dort weg, geht nichts
    const spurAus = (rechne) => aendereAus((p) => {
      const s = p.spuren.find((x) => x.id === id), r = s ? rechne(s, p) : null;
      return r ? { label: r.label, befehle: r.befehle ?? [{ befehl: 'spur_aendern', spur_id: id, ...r.felder }] } : null;
    });
    q('.p-mute').addEventListener('click', () => spurAus((s) => ({ label: `${s.mute ? 'Unmute' : 'Mute'} ${s.name}`, felder: { mute: !s.mute } })));
    q('.p-solo').addEventListener('click', () => spurAus((s) => ({ label: `${s.solo ? 'Unsolo' : 'Solo'} ${s.name}`, felder: { solo: !s.solo } })));
    q('.p-arm').addEventListener('click', () => spurAus((s) => ({ label: `${s.aufnahme?.scharf ? 'Disarm' : 'Arm'} ${s.name}`, felder: { arm: !s.aufnahme?.scharf } })));
    q('.p-eingang').addEventListener('change', () => { const w = q('.p-eingang').value; aendernSpur(`Input ${spur().name}`, { eingang: w ? { art: 'intern', name: w } : null, ...(w ? {} : { arm: false }) }); });
    q('.p-farbe').addEventListener('click', () => spurAus((s) => ({ label: `Colour ${s.name}`, felder: { farbe: naechsteFarbe(s.farbe) } })));
    // ↑/↓ und ✕ sind eigene Befehle (spur_verschieben, spur_loeschen), nicht spur_aendern; Löschen nimmt Undo zurück
    for (const [klasse, richtung] of [['.p-hoch', 'hoch'], ['.p-runter', 'runter']]) {
      q(klasse).addEventListener('click', () => spurAus((s, p) => {
        const z = zielIndex(p.spuren.length, p.spuren.indexOf(s), richtung);
        return z === null ? null : { label: `Move track ${richtung === 'hoch' ? 'up' : 'down'} ${s.name}`, befehle: [{ befehl: 'spur_verschieben', spur_id: id, index: z }] };
      }));
    }
    q('.p-loeschen').addEventListener('click', () => aendere(`Delete track ${spur().name}`, [{ befehl: 'spur_loeschen', spur_id: id }]));
    q('.p-ausgang').addEventListener('change', (e) => aendere(`Output ${spur().name}`, [ausgangBefehl(id, e.target.value)]));
    for (const [klasse, feld, vorgabe] of [['.p-fader', 'fader_db', 0], ['.p-pan', 'pan', 0]]) {
      const r = q(klasse), k = `${id}:${feld}`;
      const sende = () => {
        const v = feld === 'fader_db' ? faderWert(Number(r.value)) : Number(r.value);
        zeigeWerte(el, { ...spur(), [feld]: v });
        aendernSpur(`${feld === 'fader_db' ? 'Volume' : 'Pan'} ${spur().name}`, { [feld]: v }, k);
      };
      r.addEventListener('pointerdown', () => greift.add(k));
      r.addEventListener('input', sende);
      r.addEventListener('change', () => greift.delete(k));
      r.addEventListener('pointerup', () => greift.delete(k));
      r.addEventListener('dblclick', () => { r.value = String(vorgabe); sende(); greift.delete(k); });
    }
    const name = q('.p-spurname');
    const umbenennen = () => {
      const ein = document.createElement('input');
      ein.className = 'p-namefeld'; ein.value = spur().name; ein.maxLength = 40; ein.setAttribute('aria-label', 'Track name');
      name.replaceWith(ein); ein.focus(); ein.select();
      let fertig = false;
      const ende = (uebernehmen, zurueckAnName) => {
        if (fertig) return; fertig = true;
        ein.replaceWith(name);
        if (zurueckAnName) name.focus();      // per Tastatur begonnen: der Fokus kehrt an den Namen zurück
        const neu = ein.value.trim();
        if (uebernehmen && neu && neu !== spur().name) aendernSpur('Rename track', { name: neu });
      };
      ein.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') ende(true, true); if (e.key === 'Escape') ende(false, true); });
      ein.addEventListener('blur', () => ende(false, false));
    };
    name.addEventListener('dblclick', umbenennen);
    name.addEventListener('keydown', (e) => { if (istUmbenennenTaste(e)) { e.preventDefault(); e.stopPropagation(); umbenennen(); } });
    return el;
  }

  function zeigeWerte(el, s) {
    const q = (x) => el.querySelector(x);
    el.style.setProperty('--farbe', s.farbe);
    q('.p-spurname').textContent = s.name;
    q('.p-geraet').textContent = geraetText(s) + (s.freeze ? ' · FROZEN' : '');
    for (const [k, an] of [['.p-mute', s.mute], ['.p-solo', s.solo]]) { q(k).classList.toggle('an', an); q(k).setAttribute('aria-pressed', String(an)); }
    if (!greift.has(`${s.id}:fader_db`)) q('.p-fader').value = String(Math.max(FADER_MIN, s.fader_db));
    if (!greift.has(`${s.id}:pan`)) q('.p-pan').value = String(s.pan);
    const sel = q('.p-ausgang'), opts = ausgangOptionen({ gruppen: gruppenStand }), schluessel = JSON.stringify(opts);
    if (sel.dataset.optionen !== schluessel) {   // die Auswahl wird nur neu gebaut, wenn sich die Gruppen ändern
      sel.dataset.optionen = schluessel;
      sel.replaceChildren(...opts.map((o) => { const e = document.createElement('option'); e.value = o.wert; e.textContent = o.text; return e; }));
    }
    sel.value = ausgangWert(s);
    sel.setAttribute('aria-label', `Output ${s.name}`);
    const L = spurLabels(s.name);
    for (const [k, v] of [['.p-mute', L.mute], ['.p-solo', L.solo], ['.p-hoch', L.hoch], ['.p-runter', L.runter], ['.p-farbe', L.farbe],
      ['.p-loeschen', L.loeschen], ['.p-spurname', L.umbenennen], ['.p-fader', L.fader], ['.p-pan', L.pan]]) q(k).setAttribute('aria-label', v);
    const z = armZustand(s);
    for (const k of ['.p-arm', '.p-eingang']) q(k).hidden = !z.sichtbar;
    q('.p-arm').classList.toggle('an', z.scharf); q('.p-arm').setAttribute('aria-pressed', String(z.scharf)); q('.p-arm').disabled = z.armSperre && !z.scharf;
    q('.p-arm').setAttribute('aria-label', `Arm ${s.name} for recording`);
    q('.p-eingang').value = z.eingang; q('.p-eingang').disabled = !z.sichtbar; q('.p-eingang').setAttribute('aria-label', `Recording input of ${s.name}`);
    q('.p-faderwert').textContent = faderText(s.fader_db);
    q('.p-panwert').textContent = panText(s.pan);
    q('.p-pegel').dataset.kanal = `spur/${s.nr}`;
    const i = reihenfolge.indexOf(s.id);
    q('.p-hoch').disabled = zielIndex(reihenfolge.length, i, 'hoch') === null;
    q('.p-runter').disabled = zielIndex(reihenfolge.length, i, 'runter') === null;
  }

  return {
    zeige(projekt) {
      const spuren = projekt?.spuren ?? [];
      gruppenStand = projekt?.gruppen ?? [];
      stand.clear();
      reihenfolge = spuren.map((s) => s.id);
      for (const s of spuren) stand.set(s.id, s);
      for (const [id, el] of els) if (!stand.has(id)) { el.remove(); els.delete(id); }
      spuren.forEach((s, i) => {
        let el = els.get(s.id);
        if (!el) { el = baue(s.id); els.set(s.id, el); }
        zeigeWerte(el, s);
        if (behaelter.children[i] !== el) behaelter.insertBefore(el, behaelter.children[i] ?? null);
      });
    },
  };
}

// Binder für produktion.js: Köpfe zeigen und Spuren anlegen (Audio, RB-338 intern, Surge im Wirt-Slot 1; Spec 2.4, 3.4)
const NEU = {
  'neu-audio': ['Add audio track', { befehl: 'spur_neu', art: 'audio', name: 'Audio' }],
  'neu-rb': ['Add RB-338 track', { befehl: 'spur_neu', art: 'instrument', name: 'RB-338', geraet: { art: 'intern', name: 'rb338', parameter: {} } }],
  'neu-surge': ['Add Surge track', { befehl: 'spur_neu', art: 'instrument', name: 'Surge', geraet: { art: 'wirt', name: 'surge', slot: 1 } }],
};
export function bindeSpuren(ctx) {
  const { $ } = ctx;
  const koepfe = bindeKoepfe($('koepfe'), { aendere: ctx.aendere, aendereAus: ctx.aendereAus });
  for (const [knopf, [label, befehl]] of Object.entries(NEU)) $(knopf).addEventListener('click', () => ctx.aendere(label, [befehl]));
  ctx.beimProjekt.push((p) => {
    const n = p?.spuren.length ?? 0;
    $('neu-audio').disabled = $('neu-rb').disabled = !p || n >= MAX_SPUREN;
    $('neu-surge').disabled = !p || n >= MAX_SPUREN || p.spuren.some((s) => s.geraet?.art === 'wirt' && s.geraet.slot === 1);
    koepfe.zeige(p);
  });
}
