// MIDI FX strip on the device view (strand 7, task 1.5): DOM part. One command per gesture end (button click, menu choice, knob release 'change'),
// never while a knob is dragged. The pure part is midi_stufe.js. Sections: Arp, Chord, Scale, Velocity, Chance, Seed.
import {
  MIDI_STUFE_TEXT as T, ARP_MUSTER_WAHL, ARP_RATE_WAHL, RATE_FREI, HZ_MIN, HZ_MAX, GATE_MIN, GATE_MAX,
  stufeVonSpur, koerper, kannMidiStufe, midiStufeLabel,
  AKKORD_VORGABEN, AKKORD_AUS, AKKORD_FREI, SKALA_WAHL, GRUNDTON_WAHL, kettenVonSpur, intervalleLesen, neueSaat,
} from './midi_stufe.js';

/** Binds the strip into `wurzel` (an empty element). zeige(spur) shows it for an instrument track, zeige(null) hides it. */
export function bindeMidiStufe(ctx, wurzel, opt = {}) {
  const d = opt.dokument ?? globalThis.document;
  const el = (tag, cls, text) => { const e = d.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const wahl = (name, paare) => {
    const s = el('select', 'p-ms-wahl'); s.dataset.m = name;
    for (const [v, t] of paare) { const o = el('option', '', t); o.value = v; s.append(o); }
    return s;
  };
  const feld = (name, label, steuer) => { const l = el('label', 'p-ms-feld'); l.append(el('span', 'p-ms-name', label), steuer); steuer.dataset.m = name; return l; };
  const knopf = (name, text, titel) => { const b = el('button', 'p-ms-knopf', text); b.type = 'button'; b.dataset.m = name; b.title = titel; b.setAttribute('aria-pressed', 'false'); return b; };

  const kopf = el('span', 'p-ms-titel', T.titel);
  const an = knopf('an', T.an, T.an_titel), arp = knopf('arp', T.arp, T.arp_titel);
  const muster = wahl('muster', ARP_MUSTER_WAHL), rate = wahl('rate', [...ARP_RATE_WAHL, [RATE_FREI, T.frei]]);
  const hz = el('input', 'p-ms-zahl'); hz.type = 'number'; hz.min = String(HZ_MIN); hz.max = String(HZ_MAX); hz.step = '0.5';
  const oktaven = wahl('oktaven', [1, 2, 3, 4].map((n) => [String(n), String(n)]));
  const gate = el('input', 'p-ms-gate'); gate.type = 'range'; gate.min = String(GATE_MIN); gate.max = String(GATE_MAX); gate.step = '1';
  const gateText = el('span', 'p-ms-wert');
  const gateFeld = feld('gate', T.gate, gate); gateFeld.append(gateText);
  const akkord = wahl('akkord', [[AKKORD_AUS, T.akkord_aus], ...AKKORD_VORGABEN.map((p) => [p[0], p[1]]), [AKKORD_FREI, T.akkord_frei]]);
  const akkordText = el('input', 'p-ms-text'); akkordText.type = 'text'; akkordText.placeholder = '4 7 11'; akkordText.title = T.akkord_frei_titel;
  const akkordFeld = feld('akkord', T.akkord, akkord), akkordTextFeld = feld('akkord_text', T.akkord_frei, akkordText);
  akkord.title = T.akkord_titel;
  const skalaAn = knopf('skala_an', T.skala, T.skala_titel);
  const skalaQuelle = wahl('skala_quelle', [['projekt', T.skala_projekt], ['eigene', T.skala_eigene]]);
  const grundton = wahl('grundton', GRUNDTON_WAHL), skala = wahl('skala', SKALA_WAHL);
  const velAn = knopf('vel_an', T.velocity, T.velocity_titel);
  const kurve = el('input', 'p-ms-gate'); kurve.type = 'range'; kurve.min = '-100'; kurve.max = '100'; kurve.step = '1';
  const kurveText = el('span', 'p-ms-wert'); const kurveFeld = feld('kurve', T.kurve, kurve); kurveFeld.append(kurveText);
  const zufall = el('input', 'p-ms-gate'); zufall.type = 'range'; zufall.min = '0'; zufall.max = '64'; zufall.step = '1';
  const zufallText = el('span', 'p-ms-wert'); const zufallFeld = feld('zufall', T.zufall, zufall); zufallFeld.append(zufallText);
  const fest = el('input', 'p-ms-zahl'); fest.type = 'number'; fest.min = '0'; fest.max = '127'; fest.step = '1'; fest.title = `${T.fest}: 0 = ${T.fest_aus}`;
  const chanceAn = knopf('chance_an', T.chance, T.chance_titel);
  const chance = el('input', 'p-ms-gate'); chance.type = 'range'; chance.min = '0'; chance.max = '100'; chance.step = '1';
  const chanceText = el('span', 'p-ms-wert'); const chanceFeld = feld('chance', T.chance, chance); chanceFeld.append(chanceText);
  const wuerfel = knopf('saat', '\u2684', T.saat_titel); wuerfel.removeAttribute('aria-pressed');
  const saatText = el('span', 'p-ms-wert');
  wurzel.replaceChildren(kopf, an, arp, feld('muster', T.muster, muster), feld('rate', T.rate, rate), feld('hz', T.hz, hz), feld('oktaven', T.oktaven, oktaven), gateFeld,
    akkordFeld, akkordTextFeld, skalaAn, skalaQuelle, grundton, skala, velAn, kurveFeld, zufallFeld, feld('fest', T.fest, fest), chanceAn, chanceFeld, el('span', 'p-ms-name', T.saat), wuerfel, saatText);
  wurzel.hidden = true;
  wurzel.setAttribute('role', 'group'); wurzel.setAttribute('aria-label', T.titel);

  let spurId = null;
  const spurJetzt = () => ctx.st?.projekt?.spuren?.find((x) => x.id === spurId) ?? null;
  const lies = () => ({ ...stufeVonSpur(spurJetzt()), ...kettenVonSpur(spurJetzt()) });
  const zuWerten = (w) => {
    w.muster = muster.value; w.rate = rate.value; w.oktaven = Number(oktaven.value); w.gate = Number(gate.value);
    if (Number.isFinite(Number(hz.value)) && hz.value !== '') w.hz = Number(hz.value);
    w.akkord = akkord.value; w.akkordText = akkordText.value;
    w.skalaQuelle = skalaQuelle.value; w.grundton = Number(grundton.value); w.skala = skala.value;
    w.kurve = Number(kurve.value) / 100; w.zufall = Number(zufall.value); w.fest = Number(fest.value) || 0;
    w.chance = Number(chance.value);
    return w;
  };
  const zeigeWerte = () => {
    const s = spurJetzt();
    if (!s || !kannMidiStufe(s)) { wurzel.hidden = true; return; }
    const w = stufeVonSpur(s);
    wurzel.hidden = false;
    an.textContent = w.aus ? T.aus : T.an; an.classList.toggle('an', !w.aus); an.setAttribute('aria-pressed', String(!w.aus));
    arp.classList.toggle('an', w.arpAn); arp.setAttribute('aria-pressed', String(w.arpAn));
    if (d.activeElement !== muster) muster.value = w.muster;
    if (d.activeElement !== rate) rate.value = w.rate;
    if (d.activeElement !== hz) hz.value = String(w.hz);
    if (d.activeElement !== oktaven) oktaven.value = String(w.oktaven);
    if (d.activeElement !== gate) gate.value = String(w.gate);
    gateText.textContent = `${gate.value} %`;
    hz.hidden = w.rate !== RATE_FREI; hz.parentElement.hidden = hz.hidden;
    for (const e of [muster, rate, hz, oktaven, gate]) e.disabled = !w.arpAn;
    const k = kettenVonSpur(s);
    const setze = (e, v) => { if (d.activeElement !== e) e.value = String(v); };
    setze(akkord, k.akkord); setze(akkordText, k.akkordText);
    akkordTextFeld.hidden = k.akkord !== AKKORD_FREI;
    skalaAn.classList.toggle('an', k.skalaAn); skalaAn.setAttribute('aria-pressed', String(k.skalaAn));
    setze(skalaQuelle, k.skalaQuelle); setze(grundton, k.grundton); setze(skala, k.skala);
    grundton.hidden = skala.hidden = k.skalaQuelle === 'projekt';
    for (const e of [skalaQuelle, grundton, skala]) e.disabled = !k.skalaAn;
    velAn.classList.toggle('an', k.velAn); velAn.setAttribute('aria-pressed', String(k.velAn));
    setze(kurve, Math.round(k.kurve * 100)); setze(zufall, k.zufall); setze(fest, k.fest);
    for (const e of [kurve, zufall, fest]) e.disabled = !k.velAn;
    chanceAn.classList.toggle('an', k.chanceAn); chanceAn.setAttribute('aria-pressed', String(k.chanceAn));
    setze(chance, k.chance); chance.disabled = !k.chanceAn;
    kurveText.textContent = String(Number(kurve.value) / 100); zufallText.textContent = zufall.value; chanceText.textContent = `${chance.value} %`;
    saatText.textContent = k.saat ? String(k.saat) : '';
    wurzel.classList.toggle('aus', w.aus);
  };
  const sende = (was, aendere) => {
    const s = spurJetzt();
    if (!s || !kannMidiStufe(s)) return;
    const w = aendere(zuWerten(lies()));
    const b = koerper(s.id, w, s.midi ?? null);
    ctx.aendere(midiStufeLabel(was), [b]);
  };
  an.addEventListener('click', () => sende(an.classList.contains('an') ? T.aus : T.an, (w) => ({ ...w, aus: !w.aus })));
  arp.addEventListener('click', () => sende(T.arp, (w) => ({ ...w, arpAn: !w.arpAn })));
  for (const [e, was] of [[muster, T.muster], [rate, T.rate], [oktaven, T.oktaven], [hz, T.hz], [gate, T.gate]]) {
    e.addEventListener('change', () => { if (!e.disabled) sende(was, (w) => w); });   // 'change' fires on release / menu choice, not while dragging
  }
  skalaAn.addEventListener('click', () => sende(T.skala, (w) => ({ ...w, skalaAn: !w.skalaAn })));
  velAn.addEventListener('click', () => sende(T.velocity, (w) => ({ ...w, velAn: !w.velAn })));
  chanceAn.addEventListener('click', () => sende(T.chance, (w) => ({ ...w, chanceAn: !w.chanceAn })));
  wuerfel.addEventListener('click', () => sende(T.saat, (w) => ({ ...w, saat: neueSaat() })));
  akkord.addEventListener('change', () => sende(T.akkord, (w) => w));
  akkordText.addEventListener('change', () => {
    const ok = intervalleLesen(akkordText.value) !== null;
    akkordText.setAttribute('aria-invalid', String(!ok));
    if (ok) sende(T.akkord, (w) => w);   // invalid text sends nothing
  });
  for (const [e, was] of [[skalaQuelle, T.skala], [grundton, T.skala], [skala, T.skala], [kurve, T.kurve], [zufall, T.zufall], [fest, T.fest], [chance, T.chance]]) {
    e.addEventListener('change', () => { if (!e.disabled) sende(was, (w) => w); });
  }
  kurve.addEventListener('input', () => { kurveText.textContent = String(Number(kurve.value) / 100); });
  zufall.addEventListener('input', () => { zufallText.textContent = zufall.value; });
  chance.addEventListener('input', () => { chanceText.textContent = `${chance.value} %`; });
  gate.addEventListener('input', () => { gateText.textContent = `${gate.value} %`; });   // display only, nothing is sent
  return {
    zeige(spur) { spurId = spur?.id ?? null; if (!spur) { wurzel.hidden = true; return; } zeigeWerte(); },
    aktualisiere: zeigeWerte,
  };
}
