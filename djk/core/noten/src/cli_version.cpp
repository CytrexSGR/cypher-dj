#include "intern.h"

namespace cdj::noten {

int cliVersion(const Argumente&) {
  nlohmann::ordered_json z;
  z["status"] = "ok";
  z["programm"] = "cypherdj-noten";
  z["vertrag"] = VERTRAG;
  z["detektor"] = std::string(DETEKTOR_VERSION);
  z["segmentierer"] = std::string(SEGMENTIERER_VERSION);
  z["maschine"] = std::string(MASCHINE_VERSION);
  return endeOk(z);
}

}  // namespace cdj::noten
