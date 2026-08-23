import { normalizePetCharacter } from "./pet-personality.js";

// Clawd's SVG is cropped tightly to its painted bounds, while the generated atlas
// characters include transparent breathing room. Normalize the painted footprint
// without changing the user's small / medium / large window preset.
export const CLAWD_VISUAL_SCALE = 0.84;

// bot draws into a 316-unit viewBox while the resting ball is only 200 across —
// the margin is headroom for the orbit rings, which reach 1.4x the radius. Scale
// up so the ball carries the same visual weight as an atlas character; the rings
// are allowed to overflow, they are translucent decoration.
export const BOT_VISUAL_SCALE = 1.35;

const SCALES = { clawd: CLAWD_VISUAL_SCALE, bot: BOT_VISUAL_SCALE };

export function petVisualScale(character) {
  return SCALES[normalizePetCharacter(character)] ?? 1;
}
