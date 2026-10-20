// Paket K3 (Spec D1 2.5, 6.20, 6.24, 6.25, A7): Rauchprobe der drei Programme über ihre Kommandozeile, ohne JACK und
// ohne Dienst. Ein Live-Kern im Prozess (arr35::Lauf: eine Audio-Spur und eine interne Spur, die wie im Render die RB-338
// des Kerns spielt) liefert den Master-Mitschnitt und sein Neustart-Fach; das Fach liegt als Zustands-Datei unter /dev/shm
// (Aufbau wie §6.3), daraus lesen cypherdj-render und cypherdj-nulltest. Erwartet:
// render 0 mit JSON (regler_quelle kern) und WAV; nulltest 0 (bestanden), mit --gegenprobe-spur 1 im Render 1 (rot), mit
// falscher Blockphase 3; --vorbedingung 0 bei 128 BPM, 1 bei 120 und mit --fx-master 1; mitschnitt 0 an einem Ring,
// dessen w ein Faden weiterschiebt, 6 an einem stehenden Ring; render 5 bei einer Wirt-Spur. Spec 6.20/6.25
// (--spur-regler): ohne Neustart-Zustand mit Datei 0 und regler_quelle projekt (Spitze > −60 dBFS, gegen live bestanden),
// --ohne-zustand mit Datei projekt, unlesbarer Zustand 3, ohne Zustand und ohne Datei 3, unlesbare oder ungültige Datei 2.
#include <unistd.h>

#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include "arr_lauf.h"
#include "cypherdj/ring_mitschnitt.h"
#include "cypherdj/zustand.h"

bool g_waechter = false;

using k35::N;

namespace {

std::string bin(const char* name) { return std::string(CYPHERDJ_BIN) + "/" + name; }

// Fix L9: cypherdj-render ersetzt nie; wer dasselbe Ziel neu schreiben will, räumt es vorher weg
std::string frisch(const std::string& p) {
  std::filesystem::remove(p);
  return p;
}

// Kommando ausführen: Rückgabewert und erste Zeile der Ausgabe
int lauf(const std::string& cmd, std::string& zeile) {
  zeile.clear();
  FILE* p = popen((cmd + " 2>/dev/null").c_str(), "r");
  if (!p) return -1;
  char b[2048];
  if (std::fgets(b, sizeof b, p)) zeile = b;
  const int st = pclose(p);
  return WIFEXITED(st) ? WEXITSTATUS(st) : -1;
}

// Kommando ausführen: Rückgabewert und die ganze Ausgabe samt stderr
int lauf_alles(const std::string& cmd, std::string& aus) {
  aus.clear();
  FILE* p = popen((cmd + " 2>&1").c_str(), "r");
  if (!p) return -1;
  char b[2048];
  while (std::fgets(b, sizeof b, p)) aus += b;
  const int st = pclose(p);
  return WIFEXITED(st) ? WEXITSTATUS(st) : WIFSIGNALED(st) ? 128 + WTERMSIG(st) : -1;
}

// Fix L7: erste Ausgabezeile von cmd durch Pythons JSON-Leser (UTF-8 streng); Rückgabe des Lesers (0: gültiges JSON),
// in feld_wert der Text des Feldes name
int json_gueltig(const std::string& cmd, const char* name, std::string& feld_wert) {
  const std::string py = std::string("python3 -I -c 'import json,sys; z=sys.stdin.buffer.readline().decode(\"utf-8\"); "
                                     "d=json.loads(z); v=d[\"") + name + "\"]; "
                                     "sys.stdout.write(v if isinstance(v,str) else json.dumps(v,ensure_ascii=False))'";
  return lauf_alles(cmd + " 2>/dev/null | " + py, feld_wert);
}

long long feld(const std::string& j, const char* name) {   // "name":zahl aus einer JSON-Zeile
  const std::string k = std::string("\"") + name + "\":";
  const size_t i = j.find(k);
  return i == std::string::npos ? -999999 : std::atoll(j.c_str() + i + k.size());
}

double kommazahl(const std::string& j, const char* name) {
  const std::string k = std::string("\"") + name + "\":";
  const size_t i = j.find(k);
  return i == std::string::npos ? -999999.0 : std::atof(j.c_str() + i + k.size());
}

std::string text(const std::string& j, const char* name) {   // "name":"text" aus einer JSON-Zeile
  const std::string k = std::string("\"") + name + "\":\"";
  const size_t i = j.find(k);
  if (i == std::string::npos) return "<fehlt>";
  const size_t e = j.find('"', i + k.size());
  return j.substr(i + k.size(), e - i - k.size());
}

std::string rauschen(const arrdatei::Ordner& o, char z, int64_t frames) {
  const std::string sha(64, z);
  std::vector<float> d(static_cast<size_t>(frames) * 2);
  uint32_t x = 777u + static_cast<uint32_t>(z);
  for (float& v : d) {
    x = x * 1664525u + 1013904223u;
    v = 0.2f * (static_cast<float>(x >> 8) / 8388608.0f - 1.0f);
  }
  std::ofstream(o.pfad + "/audio/" + sha + ".f32", std::ios::binary)
      .write(reinterpret_cast<const char*>(d.data()), static_cast<std::streamsize>(d.size() * sizeof(float)));
  return sha;
}

void schreibe_zustand(const std::string& pfad, const cdj_z_echtzeit& f) {
  auto d = std::make_unique<cdj_z_datei>();
  std::memset(d.get(), 0, sizeof(cdj_z_datei));
  std::memcpy(d->magic, "CDJZ", 4);
  d->version = CDJ_ZUSTAND_VERSION;
  d->groesse = sizeof(cdj_z_datei);
  d->echtzeit[1] = f;
  d->echtzeit[1].seq = 2;
  d->echtzeit[1].stand = 1;
  std::ofstream(pfad, std::ios::binary).write(reinterpret_cast<const char*>(d.get()), sizeof(cdj_z_datei));
}

}  // namespace

int main() {
  k35::Arbeitsbestand ab("test_export_programme");
  arr35::Lauf x(ab.pfad, "test_export_programme");
  const std::string a = rauschen(x.ordner, 'a', 9 * 22500);
  x.laden(1, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + x.ordner.clip("c1", 0.0, 9.0, a, 9 * 22500) + "]},"
             "{\"nr\":2,\"art\":\"intern\",\"geraet\":\"rb338\",\"parameter\":{\"cutoff\":0.4},\"noten\":["
             "{\"id\":\"m/n1\",\"beat\":1.0,\"laenge\":0.5,\"ton\":36,\"vel\":100},"
             "{\"id\":\"m/n2\",\"beat\":5.5,\"laenge\":0.5,\"ton\":41,\"vel\":100}]}");
  x.ordner.wiedergabe(2, "{\"nr\":1,\"art\":\"wirt\",\"slot\":1,\"noten\":[]}");
  x.teil("spur/1/fader", -2.0f, 0.0, 0.0);
  x.loop(true, 0.0, 8.0);
  // Live-Lauf mit Mitschnitt über den Ring-Kopf
  cdj::RingLeser leser(x.ring);
  cdj::RingMitschnitt m;
  x.lauf(21 * N);
  PRUEF(leser.lies(m));
  const int64_t id = x.start(0.0, 0);
  while (!x.quittung(id, 2) || x.kern->sample() < x.quittung(id, 2)->sample + 9 * 22500) {
    x.lauf(x.kern->sample() + N);
    PRUEF(leser.lies(m));
    if (x.kern->sample() > 40 * 22500) break;
  }
  PRUEF(x.quittung(id, 2));
  const int64_t ursprung = x.quittung(id, 2) ? x.quittung(id, 2)->sample : 0;
  auto fach = std::make_unique<cdj_z_echtzeit>();
  x.kern->abbild(*fach);
  const std::string zustand = ab.pfad + "/zustand", konfig = ab.pfad + "/kern.toml";
  schreibe_zustand(zustand, *fach);
  std::ofstream(konfig) << "version = 1\n";
  const std::string live = ab.pfad + "/live.f32";
  {
    std::ofstream f(live, std::ios::binary);
    for (size_t i = 0; i < m.l.size(); ++i) {
      f.write(reinterpret_cast<const char*>(&m.l[i]), 4);
      f.write(reinterpret_cast<const char*>(&m.r[i]), 4);
    }
  }
  const std::string gemeinsam = " --konfig " + konfig + " --zustand " + zustand + " --arr-ordner " + x.ordner.pfad;
  std::string z;
  // render
  const std::string wav = ab.pfad + "/export.wav";
  PRUEF(lauf(bin("cypherdj-render") + " --nr 1 --von-beat 0 --bis-beat 8 --bpm 128 --aus " + wav + gemeinsam, z) == 0);
  std::printf("render: %s", z.c_str());
  PRUEF(feld(z, "frames") == 8 * 22500 && feld(z, "phase") == 25 && feld(z, "quantum") == N && feld(z, "regler") > 0);
  PRUEF(text(z, "regler_quelle") == "kern");
  PRUEF(std::filesystem::file_size(wav) == 58 + 8 * 22500 * 8);
  const std::string vergleich = bin("cypherdj-nulltest") + " --live " + live + " --live-s0 " + std::to_string(m.s0) +
                                " --grenze " + std::to_string(m.grenze) + " --ursprung " + std::to_string(ursprung) +
                                " --start-sample " + std::to_string(feld(z, "start_sample")) + " --frames " +
                                std::to_string(feld(z, "frames")) + " --vorhalt " + std::to_string(feld(z, "vorhalt")) +
                                " --quantum " + std::to_string(N);
  PRUEF(lauf(vergleich + " --render " + wav, z) == 0);
  std::printf("nulltest: %s", z.c_str());
  // Gegenprobe: Spur 1 um ein Sample verschoben -> rot
  const std::string wav_g = ab.pfad + "/gegenprobe.wav";
  PRUEF(lauf(bin("cypherdj-render") + " --nr 1 --von-beat 0 --bis-beat 8 --bpm 128 --gegenprobe-spur 1 --aus " + wav_g +
                 gemeinsam, z) == 0);
  PRUEF(lauf(vergleich + " --render " + wav_g, z) == 1);
  std::printf("gegenprobe: %s", z.c_str());
  // falsche Blockphase (Grenze um 1 versetzt) -> ungültig
  PRUEF(lauf(bin("cypherdj-nulltest") + " --live " + live + " --live-s0 " + std::to_string(m.s0) + " --grenze " +
                 std::to_string(m.grenze + 1) + " --ursprung " + std::to_string(ursprung) + " --start-sample 793 --frames " +
                 std::to_string(8 * 22500) + " --vorhalt 84 --quantum 256 --render " + wav, z) == 3);
  // Vorbedingungen
  PRUEF(lauf(bin("cypherdj-nulltest") + " --vorbedingung --bpm 128 --zustand " + zustand, z) == 0);
  PRUEF(lauf(bin("cypherdj-nulltest") + " --vorbedingung --bpm 120 --zustand " + zustand, z) == 1);
  PRUEF(lauf(bin("cypherdj-nulltest") + " --vorbedingung --bpm 128 --fx-master 1 --zustand " + zustand, z) == 1);
  std::printf("vorbedingung --fx-master 1: %s", z.c_str());
  PRUEF(z.find("FX") != std::string::npos);
  // Spec 6.20/6.25: Spur-Regler als Datei (der Server übergibt die Werte aus project.json)
  {
    const std::string regler = ab.pfad + "/spur_regler.json", kaputt = ab.pfad + "/kaputt.json",
                      ausser = ab.pfad + "/ausser.json", fehlt = ab.pfad + "/zustand_fehlt", muell = ab.pfad + "/muell";
    std::ofstream(regler) << "{\"spur/1/fader\":-2,\"spur/1/pan\":0,\"spur/2/mute\":0}";
    std::ofstream(kaputt) << "{\"spur/1/fader\":";
    std::ofstream(ausser) << "{\"spur/1/fader\":9}";
    std::ofstream(muell) << "kein Zustand";
    const std::string basis = bin("cypherdj-render") + " --nr 1 --von-beat 0 --bis-beat 8 --bpm 128 --konfig " + konfig +
                              " --arr-ordner " + x.ordner.pfad;
    const std::string wav_p = ab.pfad + "/projekt.wav";
    // mit Zustand: kern (die Datei wird geprüft und übergangen)
    PRUEF(lauf(basis + " --aus " + frisch(wav_p) + " --zustand " + zustand + " --spur-regler " + regler, z) == 0);
    PRUEF(text(z, "regler_quelle") == "kern");
    // ohne Neustart-Zustand mit Datei: projekt, hörbar, gegen live bestanden (live: erz/4 neutral, spur/1/fader −2)
    PRUEF(lauf(basis + " --aus " + frisch(wav_p) + " --zustand " + fehlt + " --spur-regler " + regler, z) == 0);
    std::printf("render ohne Zustand: %s", z.c_str());
    PRUEF(text(z, "regler_quelle") == "projekt" && kommazahl(z, "spitze_db") > -60.0 && feld(z, "regler") == 3);
    const std::string zeile_p = z;
    PRUEF(lauf(vergleich + " --render " + wav_p, z) == 0);
    std::printf("nulltest projekt: %s", z.c_str());
    // die interne RB-Spur spielt live und im Render mit: im Render stumm geschaltet, ist der Null-Test rot
    const std::string ohne_rb = ab.pfad + "/ohne_rb.json";
    std::ofstream(ohne_rb) << "{\"spur/1/fader\":-2,\"spur/2/mute\":1}";
    PRUEF(lauf(basis + " --aus " + frisch(wav_p) + " --zustand " + fehlt + " --spur-regler " + ohne_rb, z) == 0);
    PRUEF(lauf(vergleich + " --render " + wav_p, z) == 1);
    std::printf("nulltest Spur 2 (RB-338) stumm: %s", z.c_str());
    // --ohne-zustand mit Datei: projekt
    PRUEF(lauf(basis + " --aus " + frisch(wav_p) + " --ohne-zustand --spur-regler " + regler, z) == 0);
    PRUEF(text(z, "regler_quelle") == "projekt");
    // vorhandener, aber unlesbarer Zustand: 3, kein stiller Rückfall
    PRUEF(lauf(basis + " --aus " + wav_p + " --zustand " + muell + " --spur-regler " + regler, z) == 3);
    // ohne Zustand und ohne Datei: 3
    PRUEF(lauf(basis + " --aus " + wav_p + " --zustand " + fehlt, z) == 3);
    PRUEF(lauf(basis + " --aus " + wav_p + " --ohne-zustand", z) == 3);
    // unlesbare oder ungültige Datei: 2 (auch wenn der Zustand da ist)
    PRUEF(lauf(basis + " --aus " + wav_p + " --zustand " + zustand + " --spur-regler " + ab.pfad + "/gibtsnicht.json", z) == 2);
    PRUEF(lauf(basis + " --aus " + wav_p + " --zustand " + fehlt + " --spur-regler " + kaputt, z) == 2);
    PRUEF(lauf(basis + " --aus " + wav_p + " --zustand " + fehlt + " --spur-regler " + ausser, z) == 2);
    PRUEF(zeile_p.find("\"regler_quelle\"") != std::string::npos);
  }
  // Wirt-Spur nicht eingefroren
  PRUEF(lauf(bin("cypherdj-render") + " --nr 2 --von-beat 0 --bis-beat 8 --bpm 128 --aus " + ab.pfad + "/w.wav" + gemeinsam,
             z) == 5);
  // Fix L9: cypherdj-render ersetzt nie (wie der Freeze, Spec 6.25). Ein vorhandenes Ziel ist Rückgabe 8 mit Text, der Inhalt
  // bleibt, keine Teil-Datei bleibt liegen (vorher: still ersetzt, Rückgabe 0). S3 vergibt eigene Namen.
  {
    std::string t;
    const std::string alt = ab.pfad + "/besteht.wav";
    std::ofstream(alt) << "alt";
    const int rc_b = lauf_alles(bin("cypherdj-render") + " --nr 1 --von-beat 0 --bis-beat 8 --bpm 128 --aus " + alt + gemeinsam, t);
    std::string inhalt;
    std::getline(std::ifstream(alt), inhalt);
    size_t teile = 0;
    for (const auto& e : std::filesystem::directory_iterator(ab.pfad)) teile += e.path().string().find(".teil") != std::string::npos;
    std::printf("L9 render auf vorhandenes Ziel: Rückgabe %d, %sInhalt \"%s\", Teil-Dateien %zu\n", rc_b, t.c_str(),
                inhalt.c_str(), teile);
    PRUEF(rc_b == 8 && t.find("besteht") != std::string::npos && inhalt == "alt" && teile == 0);
  }
  // Fix L7: die JSON-Zeilen sind maskiert. --aus mit Anführungszeichen und Backslash: Pythons Leser nimmt die Zeile an und
  // liest den Pfad zurück (vorher: ungültiges JSON). Verstöße mit einer Material-ID aus Anführungszeichen, Backslash und
  // einem bei 23 Bytes zerschnittenen UTF-8-Zeichen: gültig, das halbe Zeichen wird U+FFFD.
  {
    std::string v;
    const std::string schraeg = ab.pfad + "/a\"b\\c.wav";
    const int rc_json = json_gueltig(bin("cypherdj-render") + " --nr 1 --von-beat 0 --bis-beat 8 --bpm 128 --aus '" + schraeg +
                                         "'" + gemeinsam, "datei", v);
    std::printf("L7 render --aus a\"b\\c.wav: Leser %d, datei %s\n", rc_json, v.c_str());
    PRUEF(rc_json == 0 && v == schraeg);
    auto fach2 = std::make_unique<cdj_z_echtzeit>(*fach);
    fach2->n_decks = 1;
    std::memset(fach2->decks[0].material_id, 0, sizeof fach2->decks[0].material_id);
    const char mid[24] = "x\"y\\z\x01" "abcdefghijklmn\xc3\xa4\xc3";   // 23 Bytes, das letzte Zeichen halb
    std::memcpy(fach2->decks[0].material_id, mid, sizeof mid);
    const std::string zustand2 = ab.pfad + "/zustand_deck";
    schreibe_zustand(zustand2, *fach2);
    const int rc_v = json_gueltig(bin("cypherdj-nulltest") + " --vorbedingung --bpm 128 --zustand " + zustand2, "verstoesse", v);
    std::printf("L7 nulltest verstoesse: Leser %d, %s\n", rc_v, v.c_str());
    PRUEF(rc_v == 0 && v.find("deck/1 geladen") != std::string::npos && v.find("\xef\xbf\xbd") != std::string::npos);
  }
  // Fix L8: Zahlen werden streng gelesen (ganz verbraucht, endlich, im Wertebereich des Typs); sonst Rückgabe 2 mit dem
  // Schalter im Text. Vorher: --nr abc las 0 (Rückgabe 4 datei_fehlt), --bpm 128x las 128 (erfüllt, 0), --sekunden 0.1x
  // las 0,1. Ungültige CYPHERDJ_INSTANZ: Rückgabe 2 mit Hinweis (vorher render nur die Aufrufzeile, mitschnitt 3).
  {
    std::string t;
    const std::string r1 = bin("cypherdj-render") + " --von-beat 0 --bis-beat 8 --bpm 128 --aus " + ab.pfad + "/l8.wav" + gemeinsam;
    const int rc_nr = lauf_alles(r1 + " --nr abc", t);
    std::printf("L8 render --nr abc: Rückgabe %d, %s", rc_nr, t.c_str());
    PRUEF(rc_nr == 2 && t.find("--nr") != std::string::npos);
    PRUEF(lauf_alles(bin("cypherdj-render") + " --nr 1 --von-beat 0x --bis-beat 8 --bpm 128 --aus " + ab.pfad + "/l8.wav" +
                         gemeinsam, t) == 2 && t.find("--von-beat") != std::string::npos);
    PRUEF(lauf_alles(r1 + " --nr 1 --quantum 256k", t) == 2 && t.find("--quantum") != std::string::npos);
    PRUEF(lauf_alles(r1 + " --nr 99999999999999999999", t) == 2);   // über int64
    PRUEF(!std::filesystem::exists(ab.pfad + "/l8.wav"));
    const int rc_bpm = lauf_alles(bin("cypherdj-nulltest") + " --vorbedingung --bpm 128x --zustand " + zustand, t);
    std::printf("L8 nulltest --bpm 128x: Rückgabe %d, %s", rc_bpm, t.c_str());
    PRUEF(rc_bpm == 2 && t.find("--bpm") != std::string::npos);
    PRUEF(lauf_alles(bin("cypherdj-nulltest") + " --vorbedingung --bpm 128 --fx-master eins --zustand " + zustand, t) == 2);
    const int rc_sek = lauf_alles(bin("cypherdj-mitschnitt") + " --sekunden 0.1x --aus " + ab.pfad + "/l8.f32 --ring " +
                                      ab.pfad + "/kein_ring", t);
    std::printf("L8 mitschnitt --sekunden 0.1x: Rückgabe %d, %s", rc_sek, t.c_str());
    PRUEF(rc_sek == 2 && t.find("--sekunden") != std::string::npos);
    for (const char* p : {"cypherdj-render", "cypherdj-mitschnitt", "cypherdj-nulltest"}) {
      const std::string arg = std::string(p) == "cypherdj-render" ? " --nr 1 --von-beat 0 --bis-beat 8 --bpm 128 --aus " +
                                                                        ab.pfad + "/l8.wav" + gemeinsam
                              : std::string(p) == "cypherdj-mitschnitt" ? " --sekunden 0.1 --aus " + ab.pfad + "/l8.f32"
                                                                         : " --vorbedingung --bpm 128";
      const int rc_i = lauf_alles("CYPHERDJ_INSTANZ=zz " + bin(p) + arg, t);
      std::printf("L8 %s mit CYPHERDJ_INSTANZ=zz: Rückgabe %d, %s", p, rc_i, t.c_str());
      PRUEF(rc_i == 2 && t.find("CYPHERDJ_INSTANZ") != std::string::npos);
    }
    // Negativ-Kontrolle: gültige Instanz b und gültige Zahlen gehen durch
    PRUEF(lauf_alles("CYPHERDJ_INSTANZ=b " + bin("cypherdj-nulltest") + " --vorbedingung --bpm 128.0 --zustand " + zustand, t) == 0);
  }
  // Fix L3: bis − von über 2048 Beats ist ein Aufruffehler (Rückgabe 2, Grenze im Text; vorher 1e9: bad_alloc, Abbruch 134);
  // Speichermangel (bad_alloc, hier über ulimit -v) ist Rückgabe 7 mit Text statt Abbruch. Keine Datei in beiden Fällen.
  {
    std::string t;
    const std::string gross = ab.pfad + "/gross.wav";
    const std::string r0 = bin("cypherdj-render") + " --nr 1 --von-beat 0 --aus " + gross + gemeinsam;
    const int rc_riesig = lauf_alles(r0 + " --bpm 128 --bis-beat 1e9", t);
    std::printf("L3 --bis-beat 1e9: Rückgabe %d, %s", rc_riesig, t.c_str());
    PRUEF(rc_riesig == 2 && t.find("2048") != std::string::npos);
    PRUEF(lauf_alles(r0 + " --bpm 128 --bis-beat 2048.001", t) == 2);
    // Negativ-Kontrolle: unter derselben Grenze geht ein kurzer Export durch
    PRUEF(lauf_alles("ulimit -v 700000; exec " + bin("cypherdj-render") + " --nr 1 --von-beat 0 --bis-beat 8 --bpm 128 --aus " +
                         ab.pfad + "/klein.wav" + gemeinsam, t) == 0);
    const int rc_speicher = lauf_alles("ulimit -v 700000; exec " + r0 + " --bpm 60 --bis-beat 2048", t);
    std::printf("L3 ulimit -v 700000, 2048 Beats bei 60 BPM: Rückgabe %d, %s", rc_speicher, t.c_str());
    PRUEF(rc_speicher == 7 && t.find("Speicher") != std::string::npos);
    PRUEF(!std::filesystem::exists(gross));
  }
  // mitschnitt an einem Ring in einer Datei: ein Faden schiebt w alle 5 ms um 256 Frames weiter
  {
    const std::string ring_pfad = ab.pfad + "/bus";
    {
      std::vector<char> leer(CDJ_RING_BYTES, 0);
      auto* k = reinterpret_cast<cdj_ring_kopf*>(leer.data());
      k->version = CDJ_RING_VERSION;
      k->rate = CDJ_RING_RATE;
      k->kanaele = CDJ_RING_KANAELE;
      k->cap = CDJ_RING_CAP;
      std::memcpy(k->magic, "CDJB", 4);
      std::ofstream(ring_pfad, std::ios::binary).write(leer.data(), static_cast<std::streamsize>(leer.size()));
    }
    PRUEF(lauf(bin("cypherdj-mitschnitt") + " --sekunden 0.1 --aus " + ab.pfad + "/m.f32 --ring " + ring_pfad, z) == 6);
    std::atomic<bool> halt{false};
    std::thread schieber([&] {
      std::fstream f(ring_pfad, std::ios::in | std::ios::out | std::ios::binary);
      uint64_t w = 0;
      while (!halt.load()) {
        w += 256;
        f.seekp(32);
        f.write(reinterpret_cast<const char*>(&w), 8);
        f.flush();
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
      }
    });
    const int rc = lauf(bin("cypherdj-mitschnitt") + " --sekunden 0.1 --aus " + ab.pfad + "/m.f32 --ring " + ring_pfad, z);
    std::string v;   // Fix L7: maskierter Pfad, gültiges JSON
    const std::string schraeg = ab.pfad + "/m\"\\.f32";
    const int rc_json =
        json_gueltig(bin("cypherdj-mitschnitt") + " --sekunden 0.1 --aus '" + schraeg + "' --ring " + ring_pfad, "datei", v);
    halt = true;
    schieber.join();
    std::printf("mitschnitt: %s", z.c_str());
    PRUEF(rc == 0 && feld(z, "frames") >= 4800 && feld(z, "s0") >= 0);
    std::printf("L7 mitschnitt --aus m\"\\.f32: Leser %d, datei %s\n", rc_json, v.c_str());
    PRUEF(rc_json == 0 && v == schraeg);
    PRUEF(std::filesystem::file_size(ab.pfad + "/m.f32") == static_cast<uintmax_t>(feld(z, "frames")) * 8);
  }
  PRUEF_ENDE();
}
