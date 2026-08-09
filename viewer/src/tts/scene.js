import * as THREE from 'three';

/**
 * Layout and texture builders.
 *
 * Every object in the scene is one of five things: a token block, the speaker
 * block, the conditioned input, a transformer layer, or a generated token.
 * Colour carries the distinction, so the legend on the page is enough to read
 * the whole diagram.
 */

export const SENTENCE = 'The future of artificial intelligence is spoken.';

export const WORDS = ['The', 'future', 'of', 'artificial', 'intelligence', 'is', 'spoken'];

/** Listed on the single speaker block. Illustrative, not a full embedding. */
export const SPEAKER_FEATURES = ['Pitch', 'Timbre', 'Energy', 'Speaking style'];

// ---- layout ----------------------------------------------------------------

export const TOKEN_W = 1.02;
export const TOKEN_H = 1.02;
export const TOKEN_D = 0.3;
const TOKEN_GAP = 0.16;

/** Row of token blocks, centred, for scroll 1. */
export function tokenRow(n = WORDS.length, spread = 1) {
  const step = TOKEN_W + TOKEN_GAP * spread;
  return Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * step);
}

/** Stack of three transformer layers, front and centre. */
export const STACK = [0.82, 0, -0.82];
export const STACK_W = 2.9;
export const STACK_H = 0.62;
export const STACK_D = 1.15;

/** Where the growing sequence sits, above the stack. */
export const SEQ_Y = 2.5;
export const SEQ_X0 = -2.5;
export const SEQ_STEP = 0.78;
export const seqX = (i) => SEQ_X0 + i * SEQ_STEP;

/** Where a freshly generated token appears, below the stack. */
export const EMIT_Y = -2.45;

// ---- textures --------------------------------------------------------------

const DPR = 2;

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w * DPR;
  c.height = h * DPR;
  const ctx = c.getContext('2d');
  ctx.scale(DPR, DPR);
  return { c, ctx };
}

function finish(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** Stable illustrative numbers per token, so they never re-roll. */
export function vectorFor(index, n = 4) {
  let a = ((index + 1) * 0x9e3779b1) >>> 0;
  const out = [];
  for (let i = 0; i < n; i++) {
    a ^= a << 13; a >>>= 0;
    a ^= a >> 17;
    a ^= a << 5; a >>>= 0;
    out.push(((a / 4294967296) * 2 - 1) * 0.95);
  }
  return out;
}

/**
 * The face of a token block: the word it came from, then a few illustrative
 * dimensions. Keeping the word on the block is what makes the sequence
 * readable once the numbers appear.
 */
export function tokenFace(word, values, { ink, dim, accent }) {
  const W = 360;
  const H = 360;
  const { c, ctx } = makeCanvas(W, H);
  ctx.clearRect(0, 0, W, H);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = ink;
  let size = 62;
  ctx.font = `500 ${size}px "EB Garamond", Georgia, serif`;
  while (ctx.measureText(word).width > W - 48 && size > 18) {
    size -= 2;
    ctx.font = `500 ${size}px "EB Garamond", Georgia, serif`;
  }
  ctx.fillText(word, W / 2, 88);

  ctx.strokeStyle = dim;
  ctx.globalAlpha = 0.4;
  ctx.beginPath();
  ctx.moveTo(52, 132);
  ctx.lineTo(W - 52, 132);
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.font = '500 40px ui-monospace, SFMono-Regular, Menlo, monospace';
  const cols = [110, 250];
  values.slice(0, 4).forEach((v, i) => {
    ctx.fillStyle = i === 0 ? accent : ink;
    const s = v.toFixed(2);
    ctx.fillText(s, cols[i % 2], 190 + Math.floor(i / 2) * 58);
  });

  ctx.fillStyle = dim;
  ctx.font = '400 30px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText('...', W / 2, 308);

  return finish(c);
}

/** The single speaker block: a title and the features it stands for. */
export function speakerFace({ ink, dim, accent }) {
  const W = 400;
  const H = 400;
  const { c, ctx } = makeCanvas(W, H);
  ctx.clearRect(0, 0, W, H);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = accent;
  ctx.font = '600 38px Inter, system-ui, sans-serif';
  ctx.fillText('SPEAKER', W / 2, 74);

  ctx.strokeStyle = dim;
  ctx.globalAlpha = 0.4;
  ctx.beginPath();
  ctx.moveTo(56, 116);
  ctx.lineTo(W - 56, 116);
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.textAlign = 'left';
  ctx.fillStyle = ink;
  ctx.font = '400 34px Inter, system-ui, sans-serif';
  SPEAKER_FEATURES.forEach((f, i) => {
    ctx.fillText(f, 74, 170 + i * 56);
  });

  return finish(c);
}

/** A plain titled plate, used for the conditioned input and the layers. */
export function plateFace(title, sub, { ink, dim, accent }, opts = {}) {
  const W = opts.w ?? 512;
  const H = opts.h ?? 200;
  const { c, ctx } = makeCanvas(W, H);
  ctx.clearRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = opts.titleColor ?? accent;
  ctx.font = `600 ${opts.size ?? 42}px Inter, system-ui, sans-serif`;
  ctx.fillText(title, W / 2, sub ? H / 2 - 26 : H / 2);
  if (sub) {
    ctx.font = '400 30px Inter, system-ui, sans-serif';
    ctx.fillStyle = dim;
    ctx.fillText(sub, W / 2, H / 2 + 30);
  }
  return finish(c);
}

/** A single large glyph, for the generated token blocks. */
export function glyphFace(label, color) {
  const W = 256;
  const H = 256;
  const { c, ctx } = makeCanvas(W, H);
  ctx.clearRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.font = '600 118px Inter, system-ui, sans-serif';
  ctx.fillText(label, W / 2, H / 2 + 6);
  return finish(c);
}

// ---- geometry --------------------------------------------------------------

/** Rectangle outline in the XY plane. */
export function outlineGeometry(w, h) {
  const x = w / 2;
  const y = h / 2;
  const v = [
    -x, -y, 0, x, -y, 0,
    x, -y, 0, x, y, 0,
    x, y, 0, -x, y, 0,
    -x, y, 0, -x, -y, 0,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  return g;
}

/** A tube along a set of control points, used for the return path. */
export function pathTube(points, radius = 0.018) {
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(...p)),
    false,
    'centripetal',
    0.4,
  );
  return { geometry: new THREE.TubeGeometry(curve, 80, radius, 6, false), curve };
}

/** A short arrow: shaft plus head, pointing down the negative Y axis. */
export function arrowGeometry(len = 0.5) {
  const g = new THREE.BufferGeometry();
  const h = 0.16;
  const v = [
    0, 0, 0, 0, -len, 0,
    0, -len, 0, -h * 0.6, -len + h, 0,
    0, -len, 0, h * 0.6, -len + h, 0,
  ];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  return g;
}
