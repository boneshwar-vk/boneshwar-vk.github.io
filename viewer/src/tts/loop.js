/**
 * The autoregressive loop, as pure maths.
 *
 * Kept free of three.js so the timing can be checked headlessly.
 *
 * One cycle is four phases, and the order matters because it is the thing the
 * diagram is trying to teach:
 *
 *   enter    the current sequence travels DOWN THROUGH the transformer layers
 *   emit     what comes out the bottom becomes the next token
 *   return   it curves back around to the input
 *   settle   it joins the sequence, which is now one token longer
 *
 * The `enter` phase is not decoration. A token that appears at the output
 * without passing through the stack would be describing something that is not
 * autoregressive generation.
 */

export const CYCLES = 4;

/** Scroll range the loop occupies. */
export const LOOP_FROM = 0.44;
export const LOOP_TO = 0.84;

export const TOKEN_LABELS = ['A', 'B', 'C', 'D'];

/** Phase boundaries as fractions of one cycle. */
const PHASES = [
  { key: 'enter', end: 0.42 },
  { key: 'emit', end: 0.56 },
  { key: 'return', end: 0.88 },
  { key: 'settle', end: 1.0 },
];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t) => {
  const x = clamp01(t);
  return x * x * x * (x * (x * 6 - 15) + 10);
};

export function loopState(p) {
  const span = LOOP_TO - LOOP_FROM;
  const raw = (p - LOOP_FROM) / span;
  const active = raw > 0 && raw < 1;
  const t = clamp01(raw) * CYCLES;
  const cycle = Math.min(CYCLES - 1, Math.floor(t));
  const local = clamp01(t - cycle);

  const at = (i) => {
    const from = i === 0 ? 0 : PHASES[i - 1].end;
    return smooth((local - from) / (PHASES[i].end - from));
  };
  const enter = at(0);
  const emit = at(1);
  const ret = at(2);
  const settle = at(3);

  let phase = 'enter';
  for (let i = 0; i < PHASES.length; i++) {
    if (local <= PHASES[i].end) {
      phase = PHASES[i].key;
      break;
    }
  }

  const completed = raw >= 1 ? CYCLES : cycle;
  const sequence = completed + (raw >= 1 ? 0 : settle);

  return { active, raw, cycle, local, phase, enter, emit, ret, settle, sequence, completed };
}

/**
 * Vertical position of the sequence pulse during the enter phase.
 *
 * The first fifth of the phase slides the pulse from the row across to the top
 * of the stack; the rest carries it straight down THROUGH every layer to the
 * output. This is the part that makes the diagram autoregressive rather than a
 * box with an arrow around it, so it is exported for testing.
 */
export const SLIDE_FRACTION = 0.2;

export function pulseTrack(enter, headX, topY, emitY) {
  const slide = Math.min(1, enter / SLIDE_FRACTION);
  const drop = enter <= SLIDE_FRACTION ? 0 : (enter - SLIDE_FRACTION) / (1 - SLIDE_FRACTION);
  return {
    x: headX * (1 - slide),
    y: topY + (emitY - topY) * drop,
    slide,
    drop,
  };
}

/**
 * The return path, as a fixed schematic trace: straight runs joined by
 * quarter-circle corners, the way a feedback wire is drawn in a circuit
 * diagram. Out from under the stack, right, up, and left along the sequence
 * row. The wire and every token sample the same polyline, so a token can
 * never leave the drawn line.
 */
export function buildReturnPath({ emitY, seqY, xRight = 4.45, xEnd, r = 0.55, step = 0.04 }) {
  const pts = [];
  const push = (x, y) => pts.push([x, y, 0]);

  // straight: under the stack, heading right
  for (let x = 0; x < xRight - r; x += step) push(x, emitY);
  // corner: right -> up
  const c1 = [xRight - r, emitY + r];
  for (let a = -Math.PI / 2; a < 0; a += step / r) {
    push(c1[0] + r * Math.cos(a), c1[1] + r * Math.sin(a));
  }
  // straight: climbing the right side
  for (let y = emitY + r; y < seqY - r; y += step) push(xRight, y);
  // corner: up -> left
  const c2 = [xRight - r, seqY - r];
  for (let a = 0; a < Math.PI / 2; a += step / r) {
    push(c2[0] + r * Math.cos(a), c2[1] + r * Math.sin(a));
  }
  // straight: along the sequence row, right to left
  for (let x = xRight - r; x > xEnd; x -= step) push(x, seqY);
  push(xEnd, seqY);

  // cumulative arc length, for even-speed travel and per-slot stops
  const lens = [0];
  for (let k = 1; k < pts.length; k++) {
    const dx = pts[k][0] - pts[k - 1][0];
    const dy = pts[k][1] - pts[k - 1][1];
    lens.push(lens[k - 1] + Math.hypot(dx, dy));
  }
  const total = lens[lens.length - 1];

  /** Fraction of the path at which the top run reaches x (a sequence slot). */
  const stopAt = (x) => {
    for (let k = pts.length - 1; k > 0; k--) {
      if (pts[k][1] === seqY && pts[k][0] >= x) return lens[k] / total;
    }
    return 1;
  };

  return { pts, lens, total, stopAt };
}

/** Point at fraction t of the path's arc length. */
export function pathAt(path, t, out = [0, 0, 0]) {
  const { pts, lens, total } = path;
  const target = Math.max(0, Math.min(1, t)) * total;
  let lo = 0;
  let hi = lens.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lens[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  const k = Math.max(1, lo);
  const seg = lens[k] - lens[k - 1] || 1;
  const f = (target - lens[k - 1]) / seg;
  out[0] = pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * f;
  out[1] = pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * f;
  out[2] = 0;
  return out;
}
