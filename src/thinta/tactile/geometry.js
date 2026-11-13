// Plain 2D helpers in mm. Rects are {x, y, w, h} with y growing down, like SVG.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function pointSegDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function pointRectDist(p, r) {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
  return Math.hypot(dx, dy);
}

const inside = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

function segsCross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

// Shortest distance from a segment to a rect; 0 when they touch.
export function segRectDist(a, b, r) {
  if (inside(a, r) || inside(b, r)) return 0;
  const c = [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];
  for (let i = 0; i < 4; i++) if (segsCross(a, b, c[i], c[(i + 1) % 4])) return 0;
  return Math.min(pointRectDist(a, r), pointRectDist(b, r), ...c.map(p => pointSegDist(p, a, b)));
}

export function rectRectDist(p, q) {
  const dx = Math.max(q.x - (p.x + p.w), 0, p.x - (q.x + q.w));
  const dy = Math.max(q.y - (p.y + p.h), 0, p.y - (q.y + q.h));
  return Math.hypot(dx, dy);
}

export const rectInside = (r, outer) => r.x >= outer.x && r.y >= outer.y && r.x + r.w <= outer.x + outer.w && r.y + r.h <= outer.y + outer.h;

// Polyline points to segment pairs.
export const toSegments = pts => pts.slice(1).map((p, i) => [pts[i], p]);
