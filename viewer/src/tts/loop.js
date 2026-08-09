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
 * Return path control points: out from under the stack, round the right, and
 * back up to the end of the sequence row.
 */
export function returnPath(seqEndX, emitY, seqY) {
  return [
    [0, emitY, 0],
    [2.4, emitY + 0.15, 0.3],
    [4.3, emitY * 0.35, 0.45],
    [4.3, seqY * 0.55, 0.3],
    [seqEndX + 1.1, seqY, 0.1],
    [seqEndX, seqY, 0],
  ];
}
