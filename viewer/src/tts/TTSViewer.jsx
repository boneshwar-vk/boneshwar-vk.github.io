import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { clamp, spring } from '../anim.js';
import { usePointerControls, useStoryDriver } from '../useStoryDriver.js';
import { AttentionBeams, Grid, Lattice, Spectrogram, Waveform } from './Geometry.jsx';
import { CameraPath } from './CameraPath.jsx';
import { ParticleField } from './ParticleField.jsx';
import { buildStages, STAGE_AT } from './stages.js';
import { decimate, spectrogram, synthesizeUtterance } from './speech.js';

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
      ink: isLight ? '#41535a' : v('--ink', '#ecd6ad'),
      // A cool counterpoint to the warm accent: the field reads as data,
      // the accent is reserved for whatever is being pointed at.
      cool: isLight ? '#5d7f8c' : '#7fa7a6',
      line: isLight ? '#b9c6c2' : '#3d635f',
      surface: isLight ? '#8fa3a0' : '#4e6f6b',
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

/** WebGL2 availability. Without this the section would be 800vh of nothing. */
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

/**
 * Turns the driver's raw scroll position into the single smoothed 0..1 value
 * every other part of the scene reads. Kept on a ref so nothing re-renders.
 */
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

/** Debug-only: hands the live three.js state out to the console. */
function Probe({ built, progressRef }) {
  const three = useThree();
  useEffect(() => {
    window.__ttsScene = {
      get scene() { return three.scene; },
      get camera() { return three.camera; },
      get gl() { return three.gl; },
      get frames() { return three.gl.info.render.frame; },
      get calls() { return three.gl.info.render.calls; },
      get points() { return three.gl.info.render.points; },
      built,
      progressRef,
    };
  }, [three, built, progressRef]);
  return null;
}

function Scene({ built, spec, wave, palette, driver, progressRef, reducedMotion, onProgress, onStage, maxDpr, frameOffset, debug }) {
  return (
    <>
      {debug && <Probe built={built} progressRef={progressRef} />}
      <ambientLight intensity={palette.isLight ? 0.75 : 0.42} />
      <directionalLight position={[4, 7, 5]} intensity={palette.isLight ? 1.5 : 1.15} color="#fff4e6" />
      <directionalLight position={[-5, 2, -4]} intensity={0.4} color={palette.cool} />

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

      <ParticleField
        built={built}
        progressRef={progressRef}
        palette={palette}
        reducedMotion={reducedMotion}
        onStage={onStage}
      />
      <Lattice built={built} progressRef={progressRef} palette={palette} />
      <AttentionBeams built={built} progressRef={progressRef} palette={palette} />
      <Grid built={built} progressRef={progressRef} palette={palette} />
      <Spectrogram built={built} spec={spec} progressRef={progressRef} palette={palette} />
      <Waveform built={built} wave={wave} progressRef={progressRef} palette={palette} />
    </>
  );
}

/**
 * True once the element actually has a size.
 *
 * r3f only builds its renderer when the container measures non-zero, and it
 * learns that from a ResizeObserver. If the element is 0x0 at mount and the
 * observer's callback is missed, the canvas stays a 300x150 stub forever.
 * Polling for a real box removes that dead end entirely. The poll runs on a
 * timer rather than rAF on purpose: rAF is suspended whenever the page is not
 * compositing, which is exactly the situation this guard exists to escape.
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

/** Keeps the scene clear of the caption column, responsively. */
function useFrameOffset() {
  const [o, setO] = useState({ x: 0.2, y: 0 });
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const apply = () => setO(mq.matches ? { x: 0, y: -0.16 } : { x: 0.2, y: 0 });
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
  return o;
}

/**
 * Scroll-driven visualisation of a text-to-speech pipeline.
 *
 * One particle system carries the whole story: the same points that spell the
 * sentence become the tokens, the projected field, the transformer lattice,
 * the latent cloud, the spectrogram, and finally the waveform. Scroll position
 * is the only animation parameter; nothing spins on its own.
 */
export default function TTSViewer({ scrollElement = null, onProgress, onStage }) {
  const stageRef = useRef(null);
  const progressRef = useRef(0);

  const sectionRef = useRef(null);
  sectionRef.current = scrollElement ?? stageRef.current?.parentElement ?? null;

  const [shouldLoad, setShouldLoad] = useState(false);
  const [inView, setInView] = useState(false);
  const [ready, setReady] = useState(false);

  const handleGate = useCallback(({ near, visible }) => {
    if (near) setShouldLoad(true);
    setInView(visible);
  }, []);

  // ?ttsdebug force-mounts the scene and keeps the frame loop running, so the
  // pipeline can be inspected stage by stage without faking a scroll.
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

  // Everything the scene needs is derived once, off the main render path.
  const data = useMemo(() => {
    if (!shouldLoad || !webgl) return null;
    const signal = synthesizeUtterance();
    const spec = spectrogram(signal, { bins: isCoarse ? 40 : 64 });
    const wave = decimate(signal, 512);
    const count = isCoarse ? 7000 : 20000;
    const built = buildStages(count, spec, wave);
    return { spec, wave, built };
  }, [shouldLoad, webgl, isCoarse]);

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

  return (
    <div className="tts-mount" ref={stageRef} data-ready={ready ? 'true' : 'false'}>
      <div className="tts-canvas">
        {data && sized && (
          <Canvas
            frameloop={inView || debug ? 'always' : 'never'}
            dpr={maxDpr}
            gl={{ antialias: true, alpha: true, powerPreference: 'high-performance', stencil: false }}
            camera={{ fov: 38, near: 0.1, far: 120, position: [0, 0.15, 7.6] }}
            onCreated={({ gl }) => {
              gl.toneMapping = THREE.ACESFilmicToneMapping;
              gl.toneMappingExposure = 1.0;
              gl.outputColorSpace = THREE.SRGBColorSpace;
            }}
          >
            <Scene
              built={data.built}
              spec={data.spec}
              wave={data.wave}
              palette={palette}
              driver={driver}
              progressRef={progressRef}
              reducedMotion={reducedMotion}
              onProgress={onProgress}
              onStage={onStage}
              maxDpr={maxDpr}
              frameOffset={frameOffset}
              debug={debug}
            />
          </Canvas>
        )}
      </div>
      {webgl ? (
        <div className="tts-loading" data-visible={!ready}>
          <span className="tts-loading-bar" />
          <span className="tts-loading-text">Building field</span>
        </div>
      ) : (
        <div className="tts-fallback">
          <p>
            This section renders the text-to-speech pipeline in WebGL, which this
            browser has turned off. The written walkthrough below still covers every
            step.
          </p>
        </div>
      )}
    </div>
  );
}

export { STAGE_AT };
