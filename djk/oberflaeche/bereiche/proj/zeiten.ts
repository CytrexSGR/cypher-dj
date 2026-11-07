// Time constants the session and the take collector share (a small module so that neither imports the other).
export const GESTE_RUHE_MS = 500;   // Spec 6.30: this long a rest closes a gesture (one history entry per gesture); D13 for the hand and the keyboard
