import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { clamp, spring } from '../anim.js';
import { usePointerControls, useStoryDriver } from '../useStoryDriver.js';
import { CameraPath } from './CameraPath.jsx';
import { LABELS, TTSScene } from './TTSScene.jsx';
import {
  SAMPLE_RATE,
  decimate,
  loadAudio,
  spectrogram,
  synthesizeUtterance,
  toAudioBuffer,
} from './speech.js';

/** Scroll positions of the four narrative stages. */
export const STAGES = [0.12, 0.38, 0.64, 0.9];

/** Reads the site's CSS custom properties so the scene tracks the theme. */
function usePalette() {
  const read = () => {
    const cs = getComputedStyle(document.documentElement);
    const v = (n, f) => cs.getPropertyValue(n).trim() || f;
    const paper = new THREE.Color(v('--paper', '#0f3a37'));
    const lum = 0.2126 * paper.r + 0.7152 * paper.g + 0.0722 * paper.b;
    const isLight = lum > 0.5;
    return {
      isLight,
      accent: v('--accent', '#d3a05f'),
      ink: isLight ? '#26302f' : '#e8e2d4',
      dim: isLight ? '#7d8a87' : '#8ea19d',
      card: isLight ? '#e6e9e4' : '#25403d',
      speaker: isLight ? '#dfe6e4' : '#1f3a45',
      layer: isLight ? '#9fb0ad' : '#7fa7a6',
      decoder: isLight ? '#b9c6c2' : '#39605c',
      surface: isLight ? '#93a7a3' : '#4f716d',
      edge: isLight ? '#9aa8a4' : '#5c8480',
    };
  };
  const [pal, setPal] = useState(read);
  useEffect(() => {
    const mo = new MutationObserver(() => setPal(read()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  return pal;
}

function useReducedMotion() {
  const [r, setR] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setR(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return r;
}

/** WebGL availability. Without this the section would be four screens of nothing. */
function useWebGL() {
  const [ok, setOk] = useState(true);
  useEffect(() => {
    try {
      const c = document.createElement('canvas');
      setOk(!!(c.getContext('webgl2') || c.getContext('webgl')));
    } catch {
      setOk(false);
    }
  }, []);
  return ok;
}

/**
 * True once the element actually has a size.
 *
 * r3f only builds its renderer when the container measures non-zero, and it
 * learns that from a ResizeObserver. If the element is 0x0 at mount and that
 * callback is missed, the canvas stays a stub forever. The poll runs on a timer
 * rather than rAF because rAF is suspended whenever the page is not
 * compositing, which is the situation this guard exists to escape.
 */
function useHasSize(ref) {
  const [sized, setSized] = useState(false);
  useEffect(() => {
    if (sized) return undefined;
    let timer = 0;
    let tries = 0;
    const check = () => {
      const el = ref.current;
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          setSized(true);
          return;
        }
      }
      if (tries++ < 200) timer = setTimeout(check, 50);
    };
    check();
    const ro = new ResizeObserver(check);
    if (ref.current) ro.observe(ref.current);
    return () => {
      clearTimeout(timer);
      ro.disconnect();
    };
  }, [ref, sized]);
  return sized;
}

/** Drops resolution when the frame budget slips, recovers when it eases. */
function AdaptiveResolution({ max }) {
  const setDpr = useThree((s) => s.setDpr);
  const acc = useRef({ t: 0, n: 0, dpr: max });
  useFrame((_, dt) => {
    const a = acc.current;
    a.t += dt;
    a.n += 1;
    if (a.t < 1.1) return;
    const fps = a.n / a.t;
    a.t = 0;
    a.n = 0;
    let next = a.dpr;
    if (fps < 45 && a.dpr > 1) next = Math.max(1, a.dpr - 0.25);
    else if (fps > 57 && a.dpr < max) next = Math.min(max, a.dpr + 0.25);
    if (next !== a.dpr) {
      a.dpr = next;
      setDpr(next);
    }
  });
  return null;
}

/** Smooths raw scroll into the single value the whole scene reads. */
function ProgressDriver({ driver, progressRef, reducedMotion, onProgress }) {
  const st = useRef({ x: 0, v: 0, last: -1 }).current;
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.064);
    const p = clamp(spring(st, driver.targetProgress, reducedMotion ? 26 : 7.0, dt));
    progressRef.current = p;
    if (Math.abs(p - st.last) > 0.004) {
      st.last = p;
      onProgress?.(p);
    }
  });
  return null;
}

/** Keeps the scene clear of the caption column, responsively. */
function useFrameOffset() {
  const [o, setO] = useState({ x: 0.18, y: 0 });
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const apply = () => setO(mq.matches ? { x: 0, y: -0.14 } : { x: 0.18, y: 0 });
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
  return o;
}

/**
 * The audio the acoustic scenes are measured from.
 *
 * If the section carries a data-audio URL that file is decoded and used, so a
 * real generated sample makes the surface, the waveform and the play button all
 * the same recording. Otherwise the signal is synthesised in the browser, and
 * the page says so rather than implying a model produced it.
 */
function useSignal(enabled, audioUrl) {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const build = async () => {
      if (audioUrl) {
        try {
          const signal = await loadAudio(audioUrl);
          if (!cancelled) setState({ signal, source: 'file' });
          return;
        } catch {
          // fall through to synthesis rather than leaving the section empty
        }
      }
      if (!cancelled) setState({ signal: synthesizeUtterance(), source: 'synthetic' });
    };
    build();
    return () => { cancelled = true; };
  }, [enabled, audioUrl]);
  return state;
}

export default function TTSViewer({ scrollElement = null, audioUrl = null, onProgress }) {
  const stageRef = useRef(null);
  const progressRef = useRef(0);
  const labelRefs = useRef([]);
  const playRef = useRef({ playing: false });

  const sectionRef = useRef(null);
  sectionRef.current = scrollElement ?? stageRef.current?.parentElement ?? null;

  const [shouldLoad, setShouldLoad] = useState(false);
  const [inView, setInView] = useState(false);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);

  const handleGate = useCallback(({ near, visible }) => {
    if (near) setShouldLoad(true);
    setInView(visible);
  }, []);

  const debug = typeof location !== 'undefined' && location.search.includes('ttsdebug');
  useEffect(() => {
    if (!debug) return;
    setShouldLoad(true);
    setInView(true);
  }, [debug]);

  const palette = usePalette();
  const reducedMotion = useReducedMotion();
  const frameOffset = useFrameOffset();
  const sized = useHasSize(stageRef);
  const webgl = useWebGL();
  const driver = useStoryDriver(sectionRef, { onGate: handleGate });
  usePointerControls(stageRef, driver);

  const isCoarse = useMemo(
    () => (typeof window === 'undefined' ? false : window.matchMedia?.('(pointer: coarse)').matches),
    [],
  );
  const maxDpr = useMemo(() => {
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    return Math.min(isCoarse ? 1.6 : 2, dpr);
  }, [isCoarse]);

  const signal = useSignal(shouldLoad && webgl, audioUrl);

  const data = useMemo(() => {
    if (!signal) return null;
    const spec = spectrogram(signal.signal, { bins: isCoarse ? 40 : 56 });
    const wave = decimate(signal.signal, 420);
    return {
      spec,
      wave,
      source: signal.source,
      seconds: signal.signal.length / SAMPLE_RATE,
    };
  }, [signal, isCoarse]);

  useEffect(() => {
    if (data) setReady(true);
  }, [data]);

  useEffect(() => {
    if (!debug) return;
    window.__tts = {
      driver,
      get progress() { return progressRef.current; },
      setProgress: (p) => {
        driver.pinned = Math.max(0, Math.min(1, p));
        driver.targetProgress = driver.pinned;
      },
      unpin: () => { driver.pinned = null; },
      get ready() { return ready; },
    };
  }, [debug, driver, ready]);

  // --- playback -----------------------------------------------------------
  const audio = useRef({ ctx: null, node: null });

  const stop = useCallback(() => {
    const a = audio.current;
    if (a.node) {
      try { a.node.stop(); } catch { /* already ended */ }
      a.node.disconnect();
      a.node = null;
    }
    playRef.current.playing = false;
    setPlaying(false);
  }, []);

  const play = useCallback(() => {
    if (!signal) return;
    if (playing) {
      stop();
      return;
    }
    const a = audio.current;
    // Created on the click, which is what the autoplay policy requires.
    if (!a.ctx) a.ctx = new (window.AudioContext || window.webkitAudioContext)();
    a.ctx.resume?.();
    const node = a.ctx.createBufferSource();
    node.buffer = toAudioBuffer(a.ctx, signal.signal, SAMPLE_RATE);
    const gain = a.ctx.createGain();
    gain.gain.value = 0.9;
    node.connect(gain).connect(a.ctx.destination);
    node.onended = () => {
      playRef.current.playing = false;
      setPlaying(false);
    };
    node.start();
    a.node = node;
    playRef.current.playing = true;
    setPlaying(true);
  }, [signal, playing, stop]);

  useEffect(() => () => {
    const a = audio.current;
    try { a.node?.stop(); } catch { /* noop */ }
    a.ctx?.close?.();
  }, []);

  return (
    <div className="tts-mount" ref={stageRef} data-ready={ready ? 'true' : 'false'}>
      <div className="tts-canvas">
        {data && sized && (
          <Canvas
            frameloop={inView || debug ? 'always' : 'never'}
            dpr={maxDpr}
            gl={{ antialias: true, alpha: true, powerPreference: 'high-performance', stencil: false }}
            camera={{ fov: 32, near: 0.1, far: 120, position: [0, 0.1, 9.4] }}
            onCreated={({ gl }) => {
              gl.toneMapping = THREE.ACESFilmicToneMapping;
              gl.toneMappingExposure = 1.0;
              gl.outputColorSpace = THREE.SRGBColorSpace;
            }}
          >
            <ambientLight intensity={palette.isLight ? 0.8 : 0.5} />
            <directionalLight
              position={[4, 6, 8]}
              intensity={palette.isLight ? 1.6 : 1.25}
              color="#fff4e6"
            />
            <directionalLight position={[-6, 2, -4]} intensity={0.45} color={palette.layer} />

            <AdaptiveResolution max={maxDpr} />
            <ProgressDriver
              driver={driver}
              progressRef={progressRef}
              reducedMotion={reducedMotion}
              onProgress={onProgress}
            />
            <CameraPath
              progressRef={progressRef}
              reducedMotion={reducedMotion}
              frameOffset={frameOffset}
            />
            <TTSScene
              progressRef={progressRef}
              palette={palette}
              spec={data.spec}
              wave={data.wave}
              labelRefs={labelRefs}
              playRef={playRef}
              reducedMotion={reducedMotion}
            />
          </Canvas>
        )}
      </div>

      {/* Annotations live in the DOM and are positioned from 3D each frame, so
          the type stays crisp at any resolution. */}
      <div className="tts-annotations" aria-hidden="true">
        {LABELS.map((l, i) => (
          <span
            key={l.key}
            className="tts-annotation"
            ref={(el) => { labelRefs.current[i] = el; }}
          >
            <b>{l.text}</b>
            {l.note ? <i>{l.note}</i> : null}
          </span>
        ))}
      </div>

      {data && (
        <div className="tts-transport" data-visible={ready}>
          <button type="button" className="tts-play" onClick={play} aria-pressed={playing}>
            {playing ? (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="6.5" y="5" width="3.6" height="14" rx="1" />
                <rect x="13.9" y="5" width="3.6" height="14" rx="1" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.2v13.6L19 12z" /></svg>
            )}
            {playing ? 'Stop' : 'Play'}
          </button>
          <dl className="tts-meta">
            <div>
              <dt>Signal</dt>
              <dd>{data.source === 'file' ? 'Generated sample' : 'Synthesised in browser'}</dd>
            </div>
            <div><dt>Rate</dt><dd>{(SAMPLE_RATE / 1000).toFixed(2)} kHz mono</dd></div>
            <div><dt>Length</dt><dd>{data.seconds.toFixed(2)} s</dd></div>
          </dl>
        </div>
      )}

      {webgl ? (
        <div className="tts-loading" data-visible={!ready}>
          <span className="tts-loading-bar" />
          <span className="tts-loading-text">Preparing scene</span>
        </div>
      ) : (
        <div className="tts-fallback">
          <p>
            This section draws the text-to-speech pipeline with WebGL, which this
            browser has turned off. The written walkthrough below covers every step.
          </p>
        </div>
      )}
    </div>
  );
}
