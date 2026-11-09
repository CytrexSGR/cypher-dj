// 1.8 Slice 1: REC-Knopf und Aufnahmestatus (Oberfläche englisch). Reine Funktionen getestet; bindeAufnahme hängt sie an Transportleiste und Kern-Ereignisse.
import { beatZuX } from './timeline.js';
export const recText = (z) => (z.status === 1 ? 'Counting in' : z.status === 2 ? 'Waiting for the start' : z.status === 3 ? `Recording${z.luecken > 0 ? ` · ${z.luecken} gaps` : ''}` : z.status === 4 ? 'Finishing' : '');
// M2: der Kern meldet /zustand/rec mit Status 0, nachdem er 1 bis 4 gemeldet hat: der Take ist zu Ende, auch wenn niemand STOP REC gedrückt hat.
// 1.8 T5: status 1 (count-in) counts as a run, so an aborted count-in (1 to 0) resets the button and one started elsewhere is picked up at once.
export const laufEnde = (vorher, jetzt) => vorher >= 1 && jetzt === 0;
export function recKnopf({ projekt, lauf }) {
  if (lauf) return { disabled: false, an: true, titel: 'Stop and keep the take', text: '■ STOP REC' };
  if (!projekt) return { disabled: true, an: false, titel: 'Open a project first', text: '● REC' };
  const scharf = projekt.spuren.some((s) => (s.art === 'audio' || s.art === 'instrument') && s.aufnahme?.scharf && s.aufnahme.eingang);   // 1.8 T8: instrument tracks on MIDI in too
  return scharf ? { disabled: false, an: false, titel: 'Record onto the armed tracks', text: '● REC' }
    : { disabled: true, an: false, titel: 'Arm a track and choose its input first', text: '● REC' };
}
// 1.8 S2b: the value of the input select. An internal tap keeps its name ('erz/1'), an external pair is 'ein/<paar>'. Recording modes of an external input (D14).
export const MODUS_OPTIONEN = [{ wert: 'stereo', text: 'Stereo' }, { wert: 'links', text: 'L' }, { wert: 'rechts', text: 'R' }, { wert: 'summe', text: 'Sum' }];
// 1.8 T8: an instrument track records the notes of midi_ein_1; its select holds exactly this one entry
export const MIDI_EINGANG_OPTIONEN = [{ wert: 'midi/1', text: 'MIDI in' }];
export const eingangWert = (e) => (!e ? '' : e.art === 'extern' ? `ein/${e.paar}` : e.art === 'midi' ? 'midi/1' : e.name ?? '');
// The select value back to the eingang of spur_aendern; modus is kept when the input stays external. '' = no input.
export function eingangVonWert(wert, modus = 'stereo') {
  if (wert === 'midi/1') return { art: 'midi' };
  const m = /^ein\/([1-4])$/.exec(wert ?? '');
  if (m) return { art: 'extern', paar: Number(m[1]), modus: MODUS_OPTIONEN.some((o) => o.wert === modus) ? modus : 'stereo' };
  return wert ? { art: 'intern', name: wert } : null;
}
// The select list: the external pairs that have a device (names from GET /geraete) above the internal channels. The value a track holds is always listed,
// also when its device is gone, so the select never shows another input than the project has.
export function eingangsOptionen(geraete, intern, aktuell = '', spurArt = 'audio') {
  if (spurArt === 'instrument') return MIDI_EINGANG_OPTIONEN;
  const liste = (geraete?.eingaenge ?? []).filter((e) => e.audio).map((e) => ({ wert: `ein/${e.k}`, text: e.name }));
  if (/^ein\/[1-4]$/.test(aktuell) && !liste.some((o) => o.wert === aktuell)) liste.push({ wert: aktuell, text: `Input ${aktuell.slice(4)} (no device)` });
  return [...liste, ...intern];
}
// 1.8 S3 (R10): monitoring of an external input, three-way. The project holds 'aus' or 'ein'; no key means 'auto' (Live's default).
export const MONITOR_OPTIONEN = [{ wert: 'ein', text: 'IN' }, { wert: 'auto', text: 'AUTO' }, { wert: 'aus', text: 'OFF' }];
export function armZustand(s) {
  const audio = s.art === 'audio';
  const e = s.aufnahme?.eingang;
  const extern = audio && e?.art === 'extern';
  const sichtbar = audio || s.art === 'instrument';   // 1.8 T8
  return { sichtbar, scharf: !!s.aufnahme?.scharf, eingang: eingangWert(e), modus: e?.art === 'extern' ? e.modus : 'stereo', modusSichtbar: extern,
    armSperre: !sichtbar || !e,
    // monitor buttons and the level bar of the input: external inputs only (internal sources sound on their own mixer channel, D11)
    monitor: s.aufnahme?.monitor ?? 'auto', monitorSichtbar: extern, eingangKanal: extern ? `ein/${e.paar}` : '' };
}

// 1.8 T5: count-in, punch and overdub (project level, command aufnahme_setzen). The page shows bars (one-based), the project stores beats (4 per bar).
export const VORZAEHLER_OPTIONEN = [{ wert: 0, text: 'Off' }, { wert: 1, text: '1 bar' }, { wert: 2, text: '2 bars' }, { wert: 4, text: '4 bars' }];
const VORGABE = { vorzaehler_takte: 0, punch: { ein: false, aus: false, von_beat: 0, bis_beat: 4 }, overdub: false };   // = AUFNAHME_VORGABE (project/model.ts), the key is absent until the first command
const aufnahmeVon = (p) => p?.aufnahme ?? VORGABE;
export function aufnahmeStand(p) {
  const a = aufnahmeVon(p);
  return { vorzaehler: a.vorzaehler_takte, punchEin: a.punch.ein, punchAus: a.punch.aus, overdub: a.overdub,
    vonTakt: Math.floor(a.punch.von_beat / 4) + 1, bisTakt: Math.ceil(a.punch.bis_beat / 4) };
}
export function vorzaehlerBefehl(wert) {
  const o = VORZAEHLER_OPTIONEN.find((x) => String(x.wert) === String(wert).trim());
  return o ? { befehl: 'aufnahme_setzen', vorzaehler_takte: o.wert } : null;
}
// Both bar fields always go into ONE command: the server checks bis_beat > von_beat against the STORED other value, so a single changed field (say from bar 5)
// would be refused. The order of the two bars is the server's rule (argument_ungueltig); an entry that is no whole bar number >= 1 gives null.
export function punchBefehl(von, bis) {
  const takt = (t) => (/^\s*[0-9]+\s*$/.test(String(t)) && Number(t) >= 1 ? Number(t) : null);
  const a = takt(von), b = takt(bis);
  return a === null || b === null ? null : { befehl: 'aufnahme_setzen', punch: { von_beat: (a - 1) * 4, bis_beat: b * 4 } };
}
export function schalterBefehl(p, was) {
  const a = aufnahmeVon(p);
  if (was === 'punch_ein') return { befehl: 'aufnahme_setzen', punch: { ein: !a.punch.ein } };
  if (was === 'punch_aus') return { befehl: 'aufnahme_setzen', punch: { aus: !a.punch.aus } };
  if (was === 'overdub') return { befehl: 'aufnahme_setzen', overdub: !a.overdub };
  return null;
}
// The punch range as a read-only band in the ruler (the stored range is drawn while PUNCH IN or OUT is on; the brace is not movable, see the plan, Deferred)
export function punchBand(a, p) {
  const u = aufnahmeVon(p).punch;
  return u.ein || u.aus ? { x0: beatZuX(a, u.von_beat), x1: beatZuX(a, u.bis_beat), ein: u.ein, aus: u.aus } : null;
}

export function bindeAufnahme(ctx) {
  const { st, $ } = ctx;
  let lauf = null, zuletzt = 0, umschaltet = false, zieht = false;
  // `letzte` of GET /proj/aufnahme belongs to the run before until a run ends: bekannt = result kennungen seen outside an end, laufKennung = the last run this page saw
  const bekannt = new Set();
  let laufKennung = null, endet = false;
  const takt = ctx.takt ?? 500, warte = () => new Promise((ok) => setTimeout(ok, takt));
  const zeige = () => {
    const k = recKnopf({ projekt: st.projekt, lauf });
    const b = $('rec');
    b.disabled = k.disabled; b.title = k.titel; b.textContent = k.text; b.classList.toggle('an', k.an); b.setAttribute('aria-pressed', String(k.an));
  };
  async function umschalten() {
    if (umschaltet) return;   // Doppelklick oder gehaltene Taste: ein Wechsel läuft schon, der zweite würde rot abgelehnt oder die frische Aufnahme sofort stoppen
    umschaltet = true;
    try { await umschaltenInnen(); } finally { umschaltet = false; }
  }
  async function umschaltenInnen() {
    const r = lauf ? await ctx.holeJson('/proj/aufnahme', { aktion: 'stopp' }) : await ctx.holeJson('/proj/aufnahme', { aktion: 'start', von_beat: st.start });
    if (r.status !== 200) ctx.melde(ctx.antwortText(r), true);
    else if (lauf) { const t = r.j?.takes ?? []; ctx.melde(t.some((x) => x.fehler) ? `Take saved, but: ${t.filter((x) => x.fehler).map((x) => x.fehler).join(', ')}` : 'Take saved'); await ctx.ladeAktuell(); }
    await holeLauf();
  }
  async function holeLauf() {
    const r = await ctx.holeGet('/proj/aufnahme');
    lauf = r.status === 200 ? r.j.lauf : null;
    if (lauf) laufKennung = lauf.kennung;
    if (!endet && r.status === 200 && r.j.letzte && !lauf) bekannt.add(r.j.letzte.kennung);
    zeige();
  }
  // M2: der Take endete ohne STOP REC (Transport-Knopf, Hand-Taste, Ende des Arrangements): das Ergebnis abwarten (der Server wandelt in die WAV und setzt den Clip) und zeigen
  async function nachLaufEnde() {
    endet = true;
    try {
      const gesehen = laufKennung;
      for (let i = 0; i < 60; i++) { await holeLauf(); if (!lauf) break; await warte(); }
      const r = await ctx.holeGet('/proj/aufnahme');
      const z = r.status === 200 ? r.j.letzte : null;
      // The server leaves `letzte` untouched when a start fails (count-in or wait aborted): only the result of THIS run is reported, an older take is not
      const meins = z && (z.kennung === gesehen || !bekannt.has(z.kennung));
      if (meins) { ctx.melde(z.takes?.some((x) => x.fehler) || z.fehler ? `Recording ended, but: ${z.fehler ?? z.takes.filter((x) => x.fehler).map((x) => x.fehler).join(', ')}` : 'Take saved', !!z.fehler); bekannt.add(z.kennung); }
      else ctx.melde('Recording ended, nothing was recorded', false);
      await ctx.ladeAktuell();
    } finally { endet = false; }
  }
  // Eine Aufnahme, die nicht von dieser Seite kam (Cypher über MCP): der Server setzt den Lauf erst nach dem Transport-Start, der Kern meldet aber schon vorher Status 2.
  // Darum so lange nachfragen, bis der Lauf da ist oder der Status wieder 0 ist (ein einzelnes GET an der Flanke käme zu früh und lieferte lauf null).
  async function ziehNach() {
    if (zieht) return;
    zieht = true;
    try {
      for (let i = 0; i < 30 && !lauf && !umschaltet && zuletzt >= 1; i++) { await holeLauf(); if (lauf || umschaltet || zuletzt < 1) break; await warte(); }
    } finally { zieht = false; }
  }
  // 1.8 T5: count-in select, punch toggles and bar fields, overdub. A field being typed in keeps its text until the change is sent.
  const regler = ['vorzaehler', 'punch-ein', 'punch-aus', 'overdub', 'punch-von', 'punch-bis'];
  function zeigeRegler() {
    const p = st.projekt, a = aufnahmeStand(p), frei = (n) => typeof document === 'undefined' || document.activeElement !== $(n);
    for (const n of regler) $(n).disabled = !p;
    if (frei('vorzaehler')) $('vorzaehler').value = String(a.vorzaehler);
    if (frei('punch-von')) $('punch-von').value = String(a.vonTakt);
    if (frei('punch-bis')) $('punch-bis').value = String(a.bisTakt);
    for (const [n, an] of [['punch-ein', a.punchEin], ['punch-aus', a.punchAus], ['overdub', a.overdub]]) { $(n).classList.toggle('an', an); $(n).setAttribute('aria-pressed', String(an)); }
  }
  $('vorzaehler').addEventListener('change', async () => {
    const k = vorzaehlerBefehl($('vorzaehler').value);
    if (!k) { zeigeRegler(); return; }
    const n = k.vorzaehler_takte;
    try { await ctx.aendereAus(() => ({ label: n === 0 ? 'Count-in off' : `Count-in ${n} bar${n === 1 ? '' : 's'}`, befehle: [k] })); } finally { zeigeRegler(); }
  });
  for (const [n, was, label] of [['punch-ein', 'punch_ein', 'Punch in'], ['punch-aus', 'punch_aus', 'Punch out'], ['overdub', 'overdub', 'Overdub']]) {
    $(n).addEventListener('click', () => ctx.aendereAus((p) => ({ label, befehle: [schalterBefehl(p, was)] })));
  }
  async function sendePunch() {
    const k = punchBefehl($('punch-von').value, $('punch-bis').value);
    if (!k) { ctx.melde(ctx.fehlerText({ j: { fehler: 'argument_ungueltig' } }), true); zeigeRegler(); return; }
    // a refused range (bis <= von: argument_ungueltig) is reported by the write path; the fields then show the stored range again
    try { await ctx.aendereAus(() => ({ label: 'Punch range', befehle: [k] })); } finally { zeigeRegler(); }
  }
  $('punch-von').addEventListener('change', sendePunch);
  $('punch-bis').addEventListener('change', sendePunch);
  $('rec').addEventListener('click', umschalten);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'r' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || !st.sichtbar) return;
    const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (!$('rec').disabled) umschalten();
  });
  ctx.beimProjekt.push(() => { zeige(); zeigeRegler(); });
  ctx.beimEreignis.push((a, f) => {
    if (a !== '/zustand/rec') return;
    setzeText($('rec-status'), recText(f));
    const vorher = zuletzt;
    zuletzt = f.status;
    if (f.status >= 1 && !lauf) ziehNach();   // ziehNach prüft selbst, ob ein eigener Wechsel läuft
    if (laufEnde(vorher, f.status) && !umschaltet) nachLaufEnde();
  });
  ctx.beimSichtwechsel.push((sichtbar) => { if (sichtbar) holeLauf(); });
  holeLauf();
  function setzeText(el, t) { if (el.textContent !== t) el.textContent = t; }
}
