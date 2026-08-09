/**
 * The autoregressive loop, as pure maths.
 *
 * Kept free of three.js so the timing can be checked headlessly: how many
 * cycles have completed, how long the sequence is, and where the travelling
 * blocks are on their path at any scroll position.
 *
 * One cycle is four phases:
 *
 *   descend  the current sequence drops into the transformer stack
 *   emit     a new token appears below the stack
 *   return   it curves round and back up to the sequence
 *   settle   it joins the sequence, which is now one token longer
 */

export const CYCLES = 4;

/** Scroll range the loop occupies. */
export const LOOP_FROM = 0.44;
export const LOOP_TO = 0.82;

/** Labels for the generated tokens. */
export const TOKEN_LABELS = ['A', 'B', 'C', 'D'];

const PHASES = [
  { key: 'descend', end: 0.34 },
  { key: 'emit', end: 0.5 },
  { key: 'return', end: 0.84 },
  { key: 'settle', end: 1.0 },
];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t) => {
  const x = clamp01(t);
  return x * x * x * (x * (x * 6 - 15) + 10);
};

/**
 * @param {number} p scroll progress 0..1
 * @returns {{
 *   active: boolean, cycle: number, local: number, phase: string,
 *   descend: number, emit: number, ret: number, settle: number,
 *   sequence: number, completed: number
 * }}
 */
export function loopState(p) {
  const span = LOOP_TO - LOOP_FROM;
  const raw = (p - LOOP_FROM) / span;
  const active = raw > 0 && raw < 1;
  const t = clamp01(raw) * CYCLES;
  const cycle = Math.min(CYCLES - 1, Math.floor(t));
  const local = clamp01(t - cycle);

  // How far through each phase of the current cycle we are.
  const at = (i) => {
    const from = i === 0 ? 0 : PHASES[i - 1].end;
    return smooth((local - from) / (PHASES[i].end - from));
  };
  const descend = at(0);
  const emit = at(1);
  const ret = at(2);
  const settle = at(3);

  let phase = 'descend';
  for (let i = 0; i < PHASES.length; i++) {
    if (local <= PHASES[i].end) {
      phase = PHASES[i].key;
      break;
    }
  }

  // Tokens already locked into the sequence before this cycle.
  const completed = raw >= 1 ? CYCLES : cycle;
  // The one being placed counts once it settles.
  const sequence = completed + (raw >= 1 ? 0 : settle);

  return { active, cycle, local, phase, descend, emit, ret, settle, sequence, completed };
}

/**
 * Position along the return path, as a fraction.
 *
 * The path leaves under the stack, sweeps out to the right, and climbs back to
 * the end of the sequence row. Expressed as control points so the scene and the
 * tests agree on the same curve.
 */
export function returnPath(seqEndX) {
  return [
    [0, -2.45, 0],
    [2.2, -2.2, 0.35],
    [3.9, -0.6, 0.5],
    [3.9, 1.5, 0.35],
    [seqEndX + 0.9, 2.5, 0.1],
    [seqEndX, 2.5, 0],
  ];
}
