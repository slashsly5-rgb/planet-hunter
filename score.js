// A tap counts if it lands within `radius` of the object in either image, or of the path between them.
export function isHit(tap, frames, radius) {
  const [a, b] = frames;
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((tap.x - a.x) * dx + (tap.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(tap.x - (a.x + t * dx), tap.y - (a.y + t * dy)) <= radius;
}
