/**
 * A small Klatt-style formant synthesizer, plus a real STFT.
 *
 * Why this exists: the acoustic scenes are supposed to be *derived from a
 * signal*, not decorative geometry. Rather than ship an audio file, we
 * synthesize an utterance from a phoneme script — glottal source, formant
 * resonators, fricative noise — and then take an honest short-time Fourier
 * transform of the result.
 *
 * Nothing is ever played back. The signal exists only so the acoustic scenes
 * have real numbers underneath them: the surface you fly over is a genuine
 * short-time Fourier transform with real formant tracks, not sculpted noise.
 *
 * No three.js in here on purpose — this module is pure numerics and is
 * testable under node.
 */

export const SAMPLE_RATE = 22050;

/**
 * "The future is spoken." as a phoneme script.
 *
 * f1/f2/f3 are formant centre frequencies in Hz, `voiced` selects the glottal
 * source over noise, `amp` is a rough loudness, `dur` is seconds. Values are
 * standard textbook targets for a male-ish vocal tract, not measurements.
 */
const SCRIPT = [
  // "The"  -> ð ə
  { p: 'dh', dur: 0.055, f1: 380, f2: 1200, f3: 2500, voiced: true, amp: 0.35 },
  { p: 'ax', dur: 0.075, f1: 550, f2: 1450, f3: 2500, voiced: true, amp: 0.85 },
  // "future" -> f j uw ch er
  { p: 'f', dur: 0.075, f1: 900, f2: 2100, f3: 3400, voiced: false, amp: 0.28 },
  { p: 'y', dur: 0.045, f1: 300, f2: 2100, f3: 2900, voiced: true, amp: 0.7 },
  { p: 'uw', dur: 0.105, f1: 320, f2: 900, f3: 2300, voiced: true, amp: 1.0 },
  { p: 'ch', dur: 0.06, f1: 1700, f2: 2400, f3: 3200, voiced: false, amp: 0.3 },
  { p: 'er', dur: 0.11, f1: 480, f2: 1350, f3: 1700, voiced: true, amp: 0.8 },
  // "is" -> ih z
  { p: 'ih', dur: 0.07, f1: 400, f2: 1900, f3: 2550, voiced: true, amp: 0.85 },
  { p: 'z', dur: 0.07, f1: 300, f2: 1600, f3: 2600, voiced: true, amp: 0.35 },
  // "spoken" -> s p ow k ax n
  { p: 's', dur: 0.1, f1: 1400, f2: 2600, f3: 4200, voiced: false, amp: 0.3 },
  { p: 'p', dur: 0.045, f1: 400, f2: 1100, f3: 2300, voiced: false, amp: 0.12 },
  { p: 'ow', dur: 0.13, f1: 450, f2: 850, f3: 2400, voiced: true, amp: 1.0 },
  { p: 'k', dur: 0.05, f1: 1900, f2: 2000, f3: 3100, voiced: false, amp: 0.16 },
  { p: 'ax', dur: 0.055, f1: 500, f2: 1500, f3: 2500, voiced: true, amp: 0.6 },
  { p: 'n', dur: 0.1, f1: 280, f2: 1300, f3: 2600, voiced: true, amp: 0.55 },
  { p: 'sil', dur: 0.16, f1: 500, f2: 1500, f3: 2500, voiced: false, amp: 0.0 },
];

/** Word boundaries as fractions of the utterance, for labelling the surface. */
export const UTTERANCE = 'The future is spoken.';

/** Two-pole resonator. Standard Klatt formant filter. */
function resonator(freq, bandwidth, sr) {
  const r = Math.exp((-Math.PI * bandwidth) / sr);
  const theta = (2 * Math.PI * freq) / sr;
  const a2 = -(r * r);
  const a1 = 2 * r * Math.cos(theta);
  const a0 = 1 - a1 - a2; // unity gain at DC-ish
  return { a0, a1, a2 };
}

/**
 * Render the script to a mono Float32Array.
 *
 * Source-filter: a glottal pulse train (or noise for unvoiced segments) run
 * through three formant resonators whose centre frequencies glide between
 * phoneme targets, which is what puts the moving formant bands into the
 * spectrogram.
 */
export function synthesizeUtterance(sr = SAMPLE_RATE) {
  const total = SCRIPT.reduce((s, p) => s + p.dur, 0);
  const n = Math.ceil(total * sr);
  const out = new Float32Array(n);

  // Per-sample interpolated parameter tracks.
  const f1 = new Float32Array(n);
  const f2 = new Float32Array(n);
  const f3 = new Float32Array(n);
  const amp = new Float32Array(n);
  const voi = new Float32Array(n);

  let i = 0;
  for (let k = 0; k < SCRIPT.length; k++) {
    const cur = SCRIPT[k];
    const nxt = SCRIPT[Math.min(k + 1, SCRIPT.length - 1)];
    const len = Math.max(1, Math.round(cur.dur * sr));
    for (let j = 0; j < len && i < n; j++, i++) {
      // Glide the second half of each phone toward the next target, which is
      // what coarticulation looks like on a spectrogram.
      const t = j / len;
      const g = t < 0.6 ? 0 : (t - 0.6) / 0.4;
      const e = g * g * (3 - 2 * g);
      f1[i] = cur.f1 + (nxt.f1 - cur.f1) * e;
      f2[i] = cur.f2 + (nxt.f2 - cur.f2) * e;
      f3[i] = cur.f3 + (nxt.f3 - cur.f3) * e;
      // Short raised-cosine ramps so segment joins do not click.
      const ramp = Math.min(1, Math.min(j, len - j) / (0.012 * sr));
      amp[i] = cur.amp * (0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, ramp)));
      voi[i] = cur.voiced ? 1 : 0;
    }
  }

  // Falling F0 contour with a little declination and vibrato — a statement,
  // not a question.
  const f0At = (t) => 118 - 26 * t + 2.2 * Math.sin(2 * Math.PI * 4.5 * t);

  let phase = 0;
  let noiseState = 0;
  const r1 = { x1: 0, x2: 0 };
  const r2 = { x1: 0, x2: 0 };
  const r3 = { x1: 0, x2: 0 };
  let seed = 20260809;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) & 0xffffffff;
    return (seed >>> 8) / 8388608 - 1;
  };

  for (let s = 0; s < n; s++) {
    const t = s / n;
    const f0 = f0At(t);
    phase += f0 / sr;
    if (phase >= 1) phase -= 1;

    // Glottal pulse: a smooth asymmetric pulse is far closer to a real source
    // than a raw sawtooth and gives a natural spectral tilt.
    const op = 0.62;
    let glottal = 0;
    if (phase < op) {
      const x = phase / op;
      glottal = 3 * x * x - 2 * x * x * x;
      glottal = glottal * (1 - x) * 4;
    }
    glottal -= 0.12;

    noiseState = 0.85 * noiseState + 0.15 * rand();
    const src = voi[s] ? glottal + noiseState * 0.03 : noiseState * 1.6;

    const bw1 = voi[s] ? 70 : 200;
    const c1 = resonator(f1[s], bw1, sr);
    const c2 = resonator(f2[s], voi[s] ? 110 : 260, sr);
    const c3 = resonator(f3[s], voi[s] ? 180 : 340, sr);

    let y = c1.a0 * src + c1.a1 * r1.x1 + c1.a2 * r1.x2;
    r1.x2 = r1.x1;
    r1.x1 = y;
    let y2 = c2.a0 * y + c2.a1 * r2.x1 + c2.a2 * r2.x2;
    r2.x2 = r2.x1;
    r2.x1 = y2;
    let y3 = c3.a0 * y2 + c3.a1 * r3.x1 + c3.a2 * r3.x2;
    r3.x2 = r3.x1;
    r3.x1 = y3;

    out[s] = y3 * amp[s];
  }

  // Normalise with a little headroom.
  let peak = 0;
  for (let s = 0; s < n; s++) peak = Math.max(peak, Math.abs(out[s]));
  if (peak > 0) {
    const g = 0.82 / peak;
    for (let s = 0; s < n; s++) out[s] *= g;
  }
  return out;
}

// ------------------------------------------------------------------ FFT

/** In-place iterative radix-2 FFT. `re`/`im` must be a power-of-two length. */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j];
        const ui = im[i + j];
        const vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci;
        const vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j] = ur + vr;
        im[i + j] = ui + vi;
        re[i + j + len / 2] = ur - vr;
        im[i + j + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/**
 * Short-time Fourier transform -> log-magnitude bands in [0,1].
 *
 * Returns { frames, bins, data } where data[f * bins + b] is the normalised
 * energy of band b at frame f. Bands are spaced on a mel-like curve so the
 * low frequencies where speech lives get the resolution, which is also what
 * makes the surface legible.
 */
export function spectrogram(signal, {
  sr = SAMPLE_RATE,
  fftSize = 1024,
  hop = 256,
  bins = 64,
  fMin = 60,
  fMax = 7000,
} = {}) {
  const frames = Math.max(1, Math.floor((signal.length - fftSize) / hop) + 1);
  const data = new Float32Array(frames * bins);

  const window = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (fftSize - 1));
  }

  const hzToMel = (h) => 2595 * Math.log10(1 + h / 700);
  const melToHz = (m) => 700 * (10 ** (m / 2595) - 1);
  const mMin = hzToMel(fMin);
  const mMax = hzToMel(fMax);
  const edges = new Float32Array(bins + 2);
  for (let i = 0; i < bins + 2; i++) {
    const hz = melToHz(mMin + ((mMax - mMin) * i) / (bins + 1));
    edges[i] = (hz / sr) * fftSize;
  }

  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);
  const mag = new Float32Array(fftSize / 2);

  let lo = Infinity;
  let hi = -Infinity;

  for (let f = 0; f < frames; f++) {
    const off = f * hop;
    for (let i = 0; i < fftSize; i++) {
      re[i] = (signal[off + i] || 0) * window[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let i = 0; i < fftSize / 2; i++) {
      mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
    }
    // Triangular mel filterbank.
    for (let b = 0; b < bins; b++) {
      const l = edges[b];
      const c = edges[b + 1];
      const r = edges[b + 2];
      let sum = 0;
      for (let k = Math.floor(l); k <= Math.ceil(r) && k < fftSize / 2; k++) {
        if (k < 0) continue;
        const w = k < c ? (k - l) / Math.max(1e-6, c - l) : (r - k) / Math.max(1e-6, r - c);
        if (w > 0) sum += mag[k] * w;
      }
      const db = 20 * Math.log10(sum + 1e-7);
      data[f * bins + b] = db;
      if (db < lo) lo = db;
      if (db > hi) hi = db;
    }
  }

  // Normalise to [0,1] over a 70 dB window below the peak — the usual way a
  // spectrogram is displayed, and it keeps the floor from being noise.
  const floor = hi - 70;
  const span = Math.max(1e-6, hi - floor);
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.max(0, Math.min(1, (data[i] - floor) / span));
  }

  return { frames, bins, data, hop, sr };
}

/** Peak-envelope decimation of the waveform, for the 3D waveform stage. */
export function envelope(signal, points = 512) {
  const out = new Float32Array(points);
  const step = signal.length / points;
  for (let i = 0; i < points; i++) {
    const a = Math.floor(i * step);
    const b = Math.min(signal.length, Math.floor((i + 1) * step));
    let peak = 0;
    for (let j = a; j < b; j++) {
      const v = Math.abs(signal[j]);
      if (v > peak) peak = v;
    }
    out[i] = peak;
  }
  return out;
}

/** Signed decimation, so the waveform stage keeps its shape rather than a hull. */
export function decimate(signal, points = 1024) {
  const out = new Float32Array(points);
  const step = signal.length / points;
  for (let i = 0; i < points; i++) {
    const a = Math.floor(i * step);
    const b = Math.min(signal.length, Math.floor((i + 1) * step));
    let acc = 0;
    let peak = 0;
    for (let j = a; j < b; j++) {
      acc += signal[j];
      if (Math.abs(signal[j]) > Math.abs(peak)) peak = signal[j];
    }
    out[i] = peak * 0.65 + (acc / Math.max(1, b - a)) * 0.35;
  }
  return out;
}
