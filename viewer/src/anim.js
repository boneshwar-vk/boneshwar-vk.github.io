/**
 * Animation primitives.
 *
 * Everything here is frame-rate independent: the same motion at 30fps, 60fps and
 * 144fps. That is the single biggest difference between animation that feels
 * expensive and animation that feels cheap.
 */

export const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);

export const lerp = (a, b, t) => a + (b - a) * t;

/** 6t^5-15t^4+10t^3 — zero 1st AND 2nd derivative at both ends. */
export const smootherstep = (t) => {
  const x = clamp(t);
  return x * x * x * (x * (x * 6 - 15) + 10);
};

/**
 * Exponential smoothing toward a target.
 * `lambda` is a rate (higher = snappier); dt-corrected via exp so a dropped
 * frame produces the same trajectory rather than a lurch.
 */
export const damp = (current, target, lambda, dt) =>
  target + (current - target) * Math.exp(-lambda * dt);

export const dampVec3 = (out, target, lambda, dt) => {
  const k = Math.exp(-lambda * dt);
  out.x = target.x + (out.x - target.x) * k;
  out.y = target.y + (out.y - target.y) * k;
  out.z = target.z + (out.z - target.z) * k;
  return out;
};

/**
 * Implicit critically-damped spring. Unconditionally stable (never explodes at
 * large dt) and never overshoots, which is what we want for scroll: the model
 * should settle, not wobble.
 *
 * state: { x, v } mutated in place.
 */
export function spring(state, target, omega, dt) {
  // Clamp dt so a background-tab stall doesn't teleport the model.
  const h = Math.min(dt, 0.064);
  const f = 1 + 2 * h * omega;
  const oo = omega * omega;
  const hoo = h * oo;
  const hhoo = h * hoo;
  const detInv = 1 / (f + hhoo);
  state.v = (state.v + hoo * (target - state.x)) * detInv;
  state.x = (f * state.x + h * state.v + hhoo * target) * detInv;
  return state.x;
}

/**
 * Sample a keyframe track at story progress `p`.
 *
 * Keys are eased with smootherstep on the local segment parameter, so the
 * camera *settles* into every beat (zero velocity at the knot) and glides
 * between them. No overshoot is possible, which matters for `radius` — an
 * overshooting spline would punch the camera through the model.
 */
export function sampleTrack(beats, key, p) {
  const n = beats.length;
  if (p <= beats[0].at) return beats[0][key];
  if (p >= beats[n - 1].at) return beats[n - 1][key];
  for (let i = 0; i < n - 1; i++) {
    const a = beats[i];
    const b = beats[i + 1];
    if (p >= a.at && p <= b.at) {
      const t = smootherstep((p - a.at) / (b.at - a.at));
      return lerp(a[key], b[key], t);
    }
  }
  return beats[n - 1][key];
}

/** Same, for a 3-tuple track. Writes into `out` ({x,y,z}) to avoid allocation. */
export function sampleTrackVec3(beats, key, p, out) {
  const n = beats.length;
  let a = beats[0];
  let b = beats[0];
  let t = 0;
  if (p >= beats[n - 1].at) {
    a = b = beats[n - 1];
  } else if (p > beats[0].at) {
    for (let i = 0; i < n - 1; i++) {
      if (p >= beats[i].at && p <= beats[i + 1].at) {
        a = beats[i];
        b = beats[i + 1];
        t = smootherstep((p - a.at) / (b.at - a.at));
        break;
      }
    }
  }
  const va = a[key];
  const vb = b[key];
  out.x = lerp(va[0], vb[0], t);
  out.y = lerp(va[1], vb[1], t);
  out.z = lerp(va[2], vb[2], t);
  return out;
}
