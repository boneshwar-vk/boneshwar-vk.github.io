import * as THREE from 'three';

/**
 * Layout constants and texture builders for the TTS scene.
 *
 * Everything visible is a small, named object with a job. There is no particle
 * field: seven word cards, four speaker features, six encoder layers, one
 * decoder, one acoustic surface, one waveform.
 */

export const SENTENCE = 'The future of artificial intelligence is spoken.';

/** Card width tracks word length, so the row reads as the sentence it is. */
export const WORDS = [
  { text: 'The', w: 0.54 },
  { text: 'future', w: 0.88 },
  { text: 'of', w: 0.43 },
  { text: 'artificial', w: 1.23 },
  { text: 'intelligence', w: 1.5 },
  { text: 'is', w: 0.39 },
  { text: 'spoken', w: 0.95 },
];

export const CARD_H = 0.95;

/** Illustrative acoustic/speaker features. Not a complete speaker embedding. */
export const SPEAKER = [
  { key: 'Pitch', unit: 'F0', value: '112 Hz' },
  { key: 'Timbre', unit: 'spectral envelope', value: '0.41' },
  { key: 'Energy', unit: 'RMS', value: '0.68' },
  { key: 'Rhythm', unit: 'speaking rate', value: '4.1 syl/s' },
];

export const LAYERS = 6;
export const LAYER_GAP = 1.65;
/** z of encoder layer i, running away from the reader. */
export const layerZ = (i) => -1.2 - i * LAYER_GAP;
export const DECODER_Z = layerZ(LAYERS - 1) - 2.2;
export const ACOUSTIC_Z = DECODER_Z - 2.6;

const CARD_GAP = 0.16;

/** Word card x positions, centred on the origin. */
export function wordLayout(spread = 1) {
  const gap = CARD_GAP * spread;
  const total = WORDS.reduce((s, w) => s + w.w, 0) + gap * (WORDS.length - 1);
  const out = [];
  let x = -total / 2;
  for (const w of WORDS) {
    out.push(x + w.w / 2);
    x += w.w + gap;
  }
  return out;
}

/** Stable pseudo-random dimensions per word, so the numbers never re-roll. */
export function vectorFor(index, n = 4) {
  let a = (index + 1) * 0x9e3779b1;
  const out = [];
  for (let i = 0; i < n; i++) {
    a ^= a << 13; a >>>= 0;
    a ^= a >> 17;
    a ^= a << 5; a >>>= 0;
    out.push(((a / 4294967296) * 2 - 1) * 0.98);
  }
  return out;
}

// ------------------------------------------------------------------ textures

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

/** A word, set in the site serif, as a transparent texture. */
export function wordTexture(text, color) {
  const W = 512;
  const H = 160;
  const { c, ctx } = makeCanvas(W, H);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = 86;
  ctx.font = `500 ${size}px "EB Garamond", Georgia, serif`;
  while (ctx.measureText(text).width > W - 40 && size > 20) {
    size -= 3;
    ctx.font = `500 ${size}px "EB Garamond", Georgia, serif`;
  }
  ctx.fillText(text, W / 2, H / 2 + 2);
  return finish(c);
}

/**
 * The numeric face of a card: a few representative dimensions with an explicit
 * ellipsis, so it never reads as the whole vector.
 */
export function vectorTexture(values, color, dim, accent) {
  const W = 512;
  const H = 320;
  const { c, ctx } = makeCanvas(W, H);
  ctx.clearRect(0, 0, W, H);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  ctx.font = '600 30px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = dim;
  ctx.fillText('[', 44, 40);

  ctx.font = '500 40px ui-monospace, SFMono-Regular, Menlo, monospace';
  values.forEach((v, i) => {
    ctx.fillStyle = i === 0 ? accent : color;
    const s = (v < 0 ? '' : ' ') + v.toFixed(3);
    ctx.fillText(s, 74, 92 + i * 52);
  });

  ctx.font = '500 40px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = dim;
  ctx.fillText('...', 74, 92 + values.length * 52);
  ctx.font = '600 30px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText(']', 44, 92 + values.length * 52 + 44);

  return finish(c);
}

/** A labelled face for the speaker feature blocks. */
export function featureTexture(feature, color, dim, accent) {
  const W = 512;
  const H = 256;
  const { c, ctx } = makeCanvas(W, H);
  ctx.clearRect(0, 0, W, H);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  ctx.font = '600 34px Inter, system-ui, sans-serif';
  ctx.fillStyle = accent;
  ctx.fillText(feature.key.toUpperCase(), 40, 66);

  ctx.font = '500 58px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = color;
  ctx.fillText(feature.value, 40, 138);

  ctx.font = '400 28px Inter, system-ui, sans-serif';
  ctx.fillStyle = dim;
  ctx.fillText(feature.unit, 40, 196);

  return finish(c);
}

/** A plain caption plate, used on the architecture blocks. */
export function plateTexture(title, sub, color, dim, accent) {
  const W = 512;
  const H = 160;
  const { c, ctx } = makeCanvas(W, H);
  ctx.clearRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 40px Inter, system-ui, sans-serif';
  ctx.fillStyle = accent;
  ctx.fillText(title, W / 2, 58);
  if (sub) {
    ctx.font = '400 28px Inter, system-ui, sans-serif';
    ctx.fillStyle = dim;
    ctx.fillText(sub, W / 2, 108);
  }
  return finish(c);
}

// ------------------------------------------------------------------ geometry

/** Rectangle outline in the XY plane, for layer edges. */
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

/**
 * The acoustic surface. X is time, Z is frequency, Y is intensity.
 *
 * The brief lists intensity on Z; a surface you look across needs intensity to
 * be height, so the axis legend on the page states the mapping explicitly.
 */
export function spectrogramGeometry(spec, { w = 9, d = 3.4, h = 1.5, cols = 150 } = {}) {
  const nx = Math.min(cols, spec.frames);
  const nz = spec.bins;
  const g = new THREE.PlaneGeometry(w, d, nx - 1, nz - 1);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const ci = i % nx;
    const ri = Math.floor(i / nx);
    const f = Math.min(spec.frames - 1, Math.round((ci / (nx - 1)) * (spec.frames - 1)));
    const e = spec.data[f * spec.bins + Math.min(spec.bins - 1, ri)];
    pos.setY(i, e * e * h);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/** The waveform as a tube through the decimated signal. */
export function waveformGeometry(wave, { w = 9, amp = 0.85, radius = 0.028 } = {}) {
  const n = Math.min(wave.length, 480);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const k = Math.floor(u * (wave.length - 1));
    pts.push(new THREE.Vector3((u - 0.5) * w, wave[k] * amp, 0));
  }
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.25);
  return new THREE.TubeGeometry(curve, n * 2, radius, 8, false);
}

/** Measured ground grid, for scale under the acoustic scenes. */
export function gridGeometry(w = 9, d = 3.4, nx = 18, nz = 8) {
  const v = [];
  for (let i = 0; i <= nx; i++) {
    const x = (i / nx - 0.5) * w;
    v.push(x, 0, -d / 2, x, 0, d / 2);
  }
  for (let i = 0; i <= nz; i++) {
    const z = (i / nz - 0.5) * d;
    v.push(-w / 2, 0, z, w / 2, 0, z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  return g;
}
