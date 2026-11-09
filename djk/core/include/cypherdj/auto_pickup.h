// 1.12 Automation slice 3, task 1 (D2): the source of the lane value for the pickup. The Stellwerk asks it inside
// hand_anwenden, exactly where a hand step is certain to be applied (Kern::setze_auto_pickup hands it over). The real
// implementation comes from the Arrangement (slice 3 task 2); until then the tests plug a stub in.
#pragma once

#include "cypherdj/signalbox/signalbox.h"

namespace cdj {

using AutoPickup = cypherdj::stellwerk::PickupQuelle;

}  // namespace cdj
