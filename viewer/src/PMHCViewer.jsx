import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { BEATS, BEAT_SETS, CameraRig, resolveBeats } from './CameraRig.jsx';
import { Molecule } from './Molecule.jsx';
import { Environment, Lights } from './Stage.jsx';
import { usePointerControls, useStoryDriver } from './useStoryDriver.js';
import { useSiteTheme } from './useSiteTheme.js';

const DEFAULT_MODEL = 'public/models/pmhc.glb';

function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

/**
 * Drops resolution if the frame budget slips and recovers it when there is
 * headroom. Sampled over a ~1s window, so one slow frame during GLB upload
 * never permanently degrades the image.
 */
function AdaptiveResolution({ max }) {
  const setDpr = useThree((s) => s.setDpr);
  const acc = useRef({ t: 0, frames: 0, dpr: max });

  useFrame((_, dt) => {
    const a = acc.current;
    a.t += dt;
    a.frames += 1;
    if (a.t < 1.1) return;
    const fps = a.frames / a.t;
    a.t = 0;
    a.frames = 0;
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

/** Keeps the model out from behind the narrative column, responsively. */
function useFrameOffset() {
  const [offset, setOffset] = useState({ x: 0.26, y: 0 });
  useEffect(() => {
    const narrow = window.matchMedia('(max-width: 860px)');
    const apply = () => setOffset(narrow.matches ? { x: 0, y: -0.2 } : { x: 0.26, y: 0 });
    apply();
    narrow.addEventListener('change', apply);
    return () => narrow.removeEventListener('change', apply);
  }, []);
  return offset;
}

function Scene({
  url,
  theme,
  driver,
  focusRef,
  reducedMotion,
  onProgress,
  onLoaded,
  maxDpr,
  frameOffset,
  beats,
}) {
  const [peptideCenter, setPeptideCenter] = useState(() => new THREE.Vector3(0, 0.6, 0));

  const handleReady = useCallback(
    (parts) => {
      setPeptideCenter(parts.peptideCenter.clone());
      onLoaded?.();
    },
    [onLoaded],
  );

  return (
    <>
      <Environment intensity={theme.envIntensity} />
      <Lights theme={theme} />
      <AdaptiveResolution max={maxDpr} />
      <CameraRig
        driver={driver}
        focusRef={focusRef}
        peptideCenter={peptideCenter}
        reducedMotion={reducedMotion}
        onProgress={onProgress}
        frameOffset={frameOffset}
        beats={beats}
      />
      <Suspense fallback={null}>
        <Molecule url={url} theme={theme} focusRef={focusRef} onReady={handleReady} />
      </Suspense>
    </>
  );
}

/**
 * Scroll-driven pMHC viewer (HLA-A*0201 / beta-2-microglobulin / MART-1).
 *
 * Renders the pinned canvas only. The caller owns the tall scroll section and
 * passes it in as `scrollElement`; that keeps the narrative copy in real HTML —
 * indexable, selectable, and legible with JavaScript disabled.
 *
 * Motion model: a spring-smoothed scroll value walks an authored camera path,
 * with a continuous idle layer (slow spin + breathing dolly) added on top so
 * the frame is never static, and pointer/drag input added on top of that.
 *
 * @param {string}      modelUrl      path to the meshopt-compressed GLB
 * @param {HTMLElement} scrollElement tall section whose scroll drives the story
 * @param {function}    onProgress    receives eased 0..1 progress each change
 */
export default function PMHCViewer({
  modelUrl = DEFAULT_MODEL,
  scrollElement = null,
  onProgress,
  pinnedProgress = null,
  beats: beatsProp = 'full',
}) {
  const beats = useMemo(() => resolveBeats(beatsProp), [beatsProp]);
  const stageRef = useRef(null);
  const focusRef = useRef(0);

  // useStoryDriver wants a ref-shaped handle; wrap whatever we were handed.
  const sectionRef = useRef(null);
  sectionRef.current = scrollElement ?? stageRef.current?.parentElement ?? null;

  const [shouldLoad, setShouldLoad] = useState(false);
  const [inView, setInView] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Lazy load: no GLB request until the section is within a viewport of the
  // fold; frame loop parked whenever it is off screen. Both flags come from the
  // driver's own rect measurement, so they track scroll exactly.
  const handleGate = useCallback(({ near, visible }) => {
    if (near) setShouldLoad(true);
    setInView(visible);
  }, []);

  useEffect(() => {
    if (location.search.includes('pmhcdebug')) setShouldLoad(true);
  }, []);

  const theme = useSiteTheme();
  const reducedMotion = useReducedMotion();
  const frameOffset = useFrameOffset();
  const driver = useStoryDriver(sectionRef, { onGate: handleGate });
  usePointerControls(stageRef, driver);

  // A pinned instance parks at one point on the story path and ignores scroll.
  // Used by the review harness to inspect every beat in a single view.
  // Must stay below the `driver` declaration — the dependency array reads it
  // during render, so hoisting this above would be a temporal-dead-zone throw.
  const pinned = pinnedProgress != null;
  useEffect(() => {
    if (!pinned) return;
    driver.pinned = pinnedProgress;
    driver.targetProgress = pinnedProgress;
    setShouldLoad(true);
    setInView(true);
  }, [pinned, pinnedProgress, driver]);

  const maxDpr = useMemo(() => {
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    return Math.min(coarse ? 1.75 : 2, dpr);
  }, []);

  const handleLoaded = useCallback(() => setLoaded(true), []);

  // Opt-in diagnostics: append ?pmhcdebug to the URL to inspect the live driver
  // and to pin story progress by hand, which is how the camera path gets
  // verified beat by beat without having to fake a scroll.
  const debug = typeof location !== 'undefined' && location.search.includes('pmhcdebug');
  useEffect(() => {
    if (!debug) return;
    window.__pmhc = {
      driver,
      focusRef,
      setProgress: (p) => {
        driver.pinned = Math.max(0, Math.min(1, p));
        driver.targetProgress = driver.pinned;
      },
      unpin: () => {
        driver.pinned = null;
      },
      get shouldLoad() { return shouldLoad; },
      get inView() { return inView; },
      get loaded() { return loaded; },
      get focus() { return focusRef.current; },
    };
  }, [debug, driver, shouldLoad, inView, loaded]);

  return (
    <div className="pmhc-mount" ref={stageRef} data-loaded={loaded ? 'true' : 'false'}>
      <div className="pmhc-canvas">
        {shouldLoad && (
          <Canvas
            frameloop={inView || debug ? 'always' : 'never'}
            dpr={maxDpr}
            gl={{
              antialias: true,
              alpha: true,
              powerPreference: 'high-performance',
              stencil: false,
            }}
            camera={{ fov: beats[0].fov, near: 0.05, far: 60, position: [0, 0, 4.35] }}
            onCreated={({ gl }) => {
              gl.toneMapping = THREE.ACESFilmicToneMapping;
              gl.toneMappingExposure = 1.05;
              gl.outputColorSpace = THREE.SRGBColorSpace;
            }}
          >
            <Scene
              url={modelUrl}
              theme={theme}
              driver={driver}
              focusRef={focusRef}
              reducedMotion={reducedMotion}
              onProgress={onProgress}
              onLoaded={handleLoaded}
              maxDpr={maxDpr}
              frameOffset={frameOffset}
              beats={beats}
            />
          </Canvas>
        )}
      </div>
      <div className="pmhc-loading" data-visible={!loaded}>
        <span className="pmhc-loading-bar" />
        <span className="pmhc-loading-text">Loading structure · PDB 3MRP</span>
      </div>
    </div>
  );
}

export { BEATS, BEAT_SETS };
