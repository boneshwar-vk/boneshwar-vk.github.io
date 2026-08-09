/**
 * Procedural target layouts for the single particle system.
 *
 * The whole piece is one `Points` object. Each stage is a full set of target
 * positions for every particle, and the shader mixes between two of them. That
 * is what makes the scenes *become* one another rather than cut: the particle
 * that was part of the letter "f" is the same particle that ends up in the
 * transformer lattice and then in a ridge of the spectrogram.
 *
 * Nothing here is downloaded — the text positions are sampled from glyphs
 * rasterised in a canvas, and everything else is generated.
 */

export const WORDS = ['The', 'future', 'is', 'spoken.'];

/** Sub-word tokens, as a real tokenizer would split them. */
export const TOKENS = [
  { text: 'The', word: 0 },
  { text: 'fut', word: 1 },
  { text: 'ure', word: 1 },
  { text: 'is', word: 2 },
  { text: 'spo', word: 3 },
  { text: 'ken', word: 3 },
  { text: '.', word: 3 },
];

/** Token index the attention scene focuses on. */
export const FOCUS_TOKEN = 4; // "spo"

/**
 * Conceptual self-attention weights from the focus token to every token.
 * Hand-authored to read like a plausible encoder head, not measured from a
 * model — the caption on the page says as much.
 */
export const ATTENTION = [0.42, 0.86, 0.78, 0.21, 1.0, 0.55, 0.30];

export const STAGE = {
  TEXT: 0,
  TOKENS: 1,
  EMBED: 2,
  LATTICE: 3,
  ATTENTION: 4,
  LATENT: 5,
  SPECTRO: 6,
  WAVE: 7,
};

/** Scroll progress at which each layout is fully formed. */
export const STAGE_AT = [0.04, 0.17, 0.33, 0.5, 0.65, 0.75, 0.88, 0.985];

export const LAYERS = 4;

// ------------------------------------------------------------------ helpers

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller, for clouds that look like distributions rather than boxes. */
function gauss(rnd) {
  const u = Math.max(1e-6, rnd());
  const v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Rasterise a string and return normalised glyph coverage points in [-0.5,0.5]
 * on X and proportional on Y. Purely a sampling of the font already on the page.
 */
function sampleText(text, { size = 128, max = 6000 } = {}) {
  const pad = Math.round(size * 0.3);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const font = `500 ${size}px "EB Garamond", Georgia, "Times New Roman", serif`;
  ctx.font = font;
  const metrics = ctx.measureText(text);
  const w = Math.ceil(metrics.width) + pad * 2;
  const h = Math.ceil(size * 1.5) + pad * 2;
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext('2d', { willReadFrequently: true });
  c.font = font;
  c.fillStyle = '#fff';
  c.textBaseline = 'middle';
  c.fillText(text, pad, h / 2);

  const img = c.getImageData(0, 0, w, h).data;
  const hits = [];
  // Step by 2px: plenty of coverage for a particle field, a quarter of the work.
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      if (img[(y * w + x) * 4 + 3] > 128) hits.push(x, y);
    }
  }

  const n = hits.length / 2;
  const aspect = w / h;
  const pts = new Float32Array(Math.min(n, max) * 2);
  const stride = n / Math.min(n, max);
  for (let i = 0; i < pts.length / 2; i++) {
    const k = Math.min(n - 1, Math.floor(i * stride));
    pts[i * 2] = (hits[k * 2] / w - 0.5) * aspect;
    pts[i * 2 + 1] = -(hits[k * 2 + 1] / h - 0.5);
  }
  return { pts, count: pts.length / 2, aspect };
}

// ------------------------------------------------------------------ layouts

/**
 * Build every stage's positions plus the per-particle attributes that stay
 * constant (word, token, random seed).
 *
 * @param {number} count   particles
 * @param {object} spec    { frames, bins, data } from speech.js
 * @param {Float32Array} wave signed decimated waveform
 */
export function buildStages(count, spec, wave) {
  const rnd = mulberry(0x5eed1);
  const stages = Array.from({ length: 8 }, () => new Float32Array(count * 3));
  const aWord = new Float32Array(count);
  const aToken = new Float32Array(count);
  const aRand = new Float32Array(count);

  for (let i = 0; i < count; i++) aRand[i] = rnd();

  // ---- assign particles to words in proportion to glyph coverage ----------
  const samples = WORDS.map((w) => sampleText(w));
  const totalCoverage = samples.reduce((s, x) => s + x.count, 0);
  const perWord = samples.map((x) => Math.max(1, Math.round((x.count / totalCoverage) * count)));
  // fix rounding drift
  let drift = count - perWord.reduce((a, b) => a + b, 0);
  perWord[1] += drift;

  // Staggered two-line placement, as specified:
  //   "The"        "future"
  //          "is"           "spoken."
  const PLACE = [
    { x: -3.5, y: 0.85, z: 0.0, s: 1.0 },
    { x: 0.35, y: 1.05, z: -0.6, s: 1.15 },
    { x: -1.5, y: -0.75, z: 0.5, s: 0.85 },
    { x: 2.6, y: -0.95, z: -0.25, s: 1.2 },
  ];

  // Precomputed so the per-particle loop does not allocate.
  const tokensOfWord = WORDS.map((_, w) =>
    TOKENS.map((t, ti) => (t.word === w ? ti : -1)).filter((ti) => ti >= 0));

  let p = 0;
  const wordStart = [];
  for (let w = 0; w < WORDS.length; w++) {
    wordStart.push(p);
    const { pts, count: n } = samples[w];
    const place = PLACE[w];
    const scale = 2.2 * place.s;
    for (let k = 0; k < perWord[w] && p < count; k++, p++) {
      const j = k % n;
      aWord[p] = w;
      const gx = pts[j * 2] * scale + place.x;
      const gy = pts[j * 2 + 1] * scale + place.y;
      // A thin slab of depth so the words read as objects, not decals.
      const gz = place.z + (aRand[p] - 0.5) * 0.22;
      stages[STAGE.TEXT][p * 3] = gx;
      stages[STAGE.TEXT][p * 3 + 1] = gy;
      stages[STAGE.TEXT][p * 3 + 2] = gz;

      // token id: split each word's particles across its sub-word tokens
      const toks = tokensOfWord[w];
      aToken[p] = toks[Math.min(toks.length - 1, Math.floor(aRand[p] * toks.length))];
    }
  }
  // any remainder (rounding) joins the last word
  for (; p < count; p++) {
    aWord[p] = WORDS.length - 1;
    aToken[p] = TOKENS.length - 1;
    const q = wordStart[WORDS.length - 1] + (p % 64);
    stages[STAGE.TEXT][p * 3] = stages[STAGE.TEXT][q * 3];
    stages[STAGE.TEXT][p * 3 + 1] = stages[STAGE.TEXT][q * 3 + 1];
    stages[STAGE.TEXT][p * 3 + 2] = stages[STAGE.TEXT][q * 3 + 2];
  }

  // ---- TOKENS: each token collapses into its own compact cluster ----------
  const tokenX = TOKENS.map((_, i) => (i - (TOKENS.length - 1) / 2) * 1.45);
  for (let i = 0; i < count; i++) {
    const t = aToken[i];
    const r = mulberry(i * 2654435761 >>> 0);
    const rad = 0.16 + 0.26 * Math.cbrt(r());
    const th = r() * Math.PI * 2;
    const ph = Math.acos(2 * r() - 1);
    stages[STAGE.TOKENS][i * 3] = tokenX[t] + rad * Math.sin(ph) * Math.cos(th);
    stages[STAGE.TOKENS][i * 3 + 1] = rad * Math.sin(ph) * Math.sin(th);
    stages[STAGE.TOKENS][i * 3 + 2] = rad * Math.cos(ph);
  }

  // ---- EMBED: token clusters scattered through a wide projected field -----
  // Positions come from a hash of the token index, so the arrangement is
  // arbitrary-but-stable. It is a projection, not a claim about the space.
  for (let t = 0; t < TOKENS.length; t++) {
    const r = mulberry(0xbeef + t * 7919);
    const cx = (r() - 0.5) * 9;
    const cy = (r() - 0.5) * 5;
    const cz = (r() - 0.5) * 9;
    for (let i = 0; i < count; i++) {
      if (aToken[i] !== t) continue;
      const g = mulberry((i + 1) * 0x9e3779b1 >>> 0);
      stages[STAGE.EMBED][i * 3] = cx + gauss(g) * 0.95;
      stages[STAGE.EMBED][i * 3 + 1] = cy + gauss(g) * 0.7;
      stages[STAGE.EMBED][i * 3 + 2] = cz + gauss(g) * 0.95;
    }
  }

  // ---- LATTICE: transformer layers along Z, token columns along X ---------
  const layerZ = (l) => (l - (LAYERS - 1) / 2) * 2.6;
  for (let i = 0; i < count; i++) {
    const t = aToken[i];
    const layer = Math.min(LAYERS - 1, Math.floor(aRand[i] * LAYERS));
    const g = mulberry((i + 77) * 0x85ebca6b >>> 0);
    // A flattened disc per (token, layer) node, so nodes read as nodes.
    const rad = 0.22 * Math.sqrt(g());
    const th = g() * Math.PI * 2;
    stages[STAGE.LATTICE][i * 3] = tokenX[t] + rad * Math.cos(th);
    stages[STAGE.LATTICE][i * 3 + 1] = (layer - (LAYERS - 1) / 2) * 0.28 + rad * Math.sin(th) * 1.6;
    stages[STAGE.LATTICE][i * 3 + 2] = layerZ(layer) + (g() - 0.5) * 0.18;
  }

  // ---- ATTENTION: identical geometry; the beat belongs to the beams -------
  stages[STAGE.ATTENTION].set(stages[STAGE.LATTICE]);

  // ---- LATENT: one dense, slightly oblate cloud --------------------------
  for (let i = 0; i < count; i++) {
    const g = mulberry((i + 991) * 0xc2b2ae35 >>> 0);
    stages[STAGE.LATENT][i * 3] = gauss(g) * 2.5;
    stages[STAGE.LATENT][i * 3 + 1] = gauss(g) * 1.15;
    stages[STAGE.LATENT][i * 3 + 2] = gauss(g) * 2.5;
  }

  // ---- SPECTRO: the acoustic landscape -----------------------------------
  // X = time, Z = frequency, Y = energy. The spec lists energy on Z, but the
  // scene asks for a landscape flown over, which needs energy to be height;
  // the axis labels on the page state this explicitly.
  const SPEC_W = 13;
  const SPEC_D = 5.2;
  const SPEC_H = 2.5;
  const cols = Math.max(2, Math.min(spec.frames, 180));
  const rows = spec.bins;
  const sampleSpec = (ci, ri) => {
    const f = Math.min(spec.frames - 1, Math.round((ci / (cols - 1)) * (spec.frames - 1)));
    return spec.data[f * spec.bins + ri];
  };
  for (let i = 0; i < count; i++) {
    const ci = i % cols;
    const ri = Math.floor((i / cols) % rows);
    const jitterX = (aRand[i] - 0.5) * (SPEC_W / cols) * 0.9;
    const jitterZ = (((i * 0.618) % 1) - 0.5) * (SPEC_D / rows) * 0.9;
    const e = sampleSpec(ci, ri);
    stages[STAGE.SPECTRO][i * 3] = (ci / (cols - 1) - 0.5) * SPEC_W + jitterX;
    stages[STAGE.SPECTRO][i * 3 + 1] = e * e * SPEC_H - 0.35;
    stages[STAGE.SPECTRO][i * 3 + 2] = (ri / (rows - 1) - 0.5) * SPEC_D + jitterZ;
  }

  // ---- WAVE: the frequency axis collapses; what is left is the signal -----
  const wn = wave.length;
  for (let i = 0; i < count; i++) {
    const u = (i % cols) / (cols - 1);
    const wi = Math.min(wn - 1, Math.floor(u * wn));
    const amp = wave[wi];
    // Particles wrap around the signal as a thin tube rather than a flat line.
    const a = aRand[i] * Math.PI * 2;
    const rad = 0.045 + 0.09 * Math.abs(amp);
    stages[STAGE.WAVE][i * 3] = (u - 0.5) * SPEC_W;
    stages[STAGE.WAVE][i * 3 + 1] = amp * 1.65 + Math.sin(a) * rad;
    stages[STAGE.WAVE][i * 3 + 2] = Math.cos(a) * rad;
  }

  return {
    stages,
    aWord,
    aToken,
    aRand,
    tokenX,
    layerZ,
    spectroSize: { w: SPEC_W, d: SPEC_D, h: SPEC_H, cols, rows },
  };
}
