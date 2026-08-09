import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { smootherstep } from '../anim.js';
import { ATTENTION, FOCUS_TOKEN, LAYERS, TOKENS } from './stages.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Visible only over [a,b], easing in and out at the edges. */
function band(p, a, b, fade = 0.05) {
  return smootherstep((p - a) / fade) * (1 - smootherstep((p - b) / fade));
}

/**
 * Scaffolding for the transformer stage: one faint plane per layer, plus the
 * residual/flow lines between consecutive layers.
 *
 * These exist so the lattice reads as an architecture with an axis and a
 * direction of travel, rather than as a cloud of dots that happens to be
 * arranged in rows.
 */
export function Lattice({ built, progressRef, palette }) {
  const group = useRef(null);

  const { flow, planes } = useMemo(() => {
    const { tokenX, layerZ } = built;
    // Flow: every token in layer L to every token in layer L+1. That is what
    // all-to-all mixing looks like; it is the honest picture of the topology.
    const verts = [];
    for (let l = 0; l < LAYERS - 1; l++) {
      for (let i = 0; i < TOKENS.length; i++) {
        for (let j = 0; j < TOKENS.length; j++) {
          const y0 = (l - (LAYERS - 1) / 2) * 0.28;
          const y1 = (l + 1 - (LAYERS - 1) / 2) * 0.28;
          verts.push(tokenX[i], y0, layerZ(l), tokenX[j], y1, layerZ(l + 1));
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));

    // One outline rectangle per layer, marking the plane the tokens sit in.
    const pv = [];
    const halfX = Math.abs(built.tokenX[0]) + 0.9;
    const halfY = 0.85;
    for (let l = 0; l < LAYERS; l++) {
      const z = layerZ(l);
      const y = (l - (LAYERS - 1) / 2) * 0.28;
      const corners = [
        [-halfX, y - halfY, z], [halfX, y - halfY, z],
        [halfX, y - halfY, z], [halfX, y + halfY, z],
        [halfX, y + halfY, z], [-halfX, y + halfY, z],
        [-halfX, y + halfY, z], [-halfX, y - halfY, z],
      ];
      corners.forEach((c) => pv.push(...c));
    }
    const gp = new THREE.BufferGeometry();
    gp.setAttribute('position', new THREE.Float32BufferAttribute(pv, 3));
    return { flow: g, planes: gp };
  }, [built]);

  const flowMat = useMemo(
    () => new THREE.LineBasicMaterial({
      color: new THREE.Color(palette.cool),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
    [palette],
  );

  const planeMat = useMemo(
    () => new THREE.LineBasicMaterial({
      color: new THREE.Color(palette.line),
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }),
    [palette],
  );

  useEffect(() => () => {
    flow.dispose();
    planes.dispose();
    flowMat.dispose();
    planeMat.dispose();
  }, [flow, planes, flowMat, planeMat]);

  useFrame((st) => {
    const p = progressRef.current;
    const on = band(p, 0.4, 0.7, 0.06);
    // A slow pulse along the stack so information reads as moving forward,
    // rather than the whole thing glowing at once.
    const pulse = 0.72 + 0.28 * Math.sin(st.clock.elapsedTime * 0.9);
    flowMat.opacity = on * 0.075 * pulse;
    planeMat.opacity = on * 0.3;
    if (group.current) group.current.visible = on > 0.002;
  });

  return (
    <group ref={group}>
      <lineSegments geometry={flow} material={flowMat} frustumCulled={false} />
      <lineSegments geometry={planes} material={planeMat} frustumCulled={false} />
    </group>
  );
}

/**
 * Attention beams from the focus token to every other token.
 *
 * Drawn as tubes rather than lines because line width is capped at 1px in most
 * WebGL implementations, and width is carrying information here: radius and
 * brightness both scale with the weight. Beams bow upward so they read as
 * connections rather than a starburst.
 */
export function AttentionBeams({ built, progressRef, palette }) {
  const group = useRef(null);
  const matsRef = useRef([]);

  const beams = useMemo(() => {
    const { tokenX, layerZ } = built;
    const z = layerZ(LAYERS - 1);
    const y = ((LAYERS - 1) - (LAYERS - 1) / 2) * 0.28;
    const from = new THREE.Vector3(tokenX[FOCUS_TOKEN], y, z);
    const out = [];
    for (let j = 0; j < TOKENS.length; j++) {
      if (j === FOCUS_TOKEN) continue;
      const to = new THREE.Vector3(tokenX[j], y, z);
      const w = ATTENTION[j];
      const mid = from.clone().lerp(to, 0.5);
      mid.y += 0.5 + 1.5 * w;
      mid.z += 0.25;
      const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
      const geo = new THREE.TubeGeometry(curve, 40, 0.008 + 0.05 * w * w, 6, false);
      out.push({ geo, weight: w, token: j });
    }
    return out;
  }, [built]);

  const materials = useMemo(
    () => beams.map(() => new THREE.MeshBasicMaterial({
      color: new THREE.Color(palette.accent),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })),
    [beams, palette],
  );
  matsRef.current = materials;

  useEffect(() => () => {
    beams.forEach((b) => b.geo.dispose());
    materials.forEach((m) => m.dispose());
  }, [beams, materials]);

  useFrame((st) => {
    const p = progressRef.current;
    const on = band(p, 0.585, 0.7, 0.045);
    if (group.current) group.current.visible = on > 0.002;
    // Beams arrive in order of strength: the strong ones first, so the eye is
    // led to what matters before the weak links even appear.
    beams.forEach((b, i) => {
      const arrive = clamp01((on - 0.15 * (1 - b.weight)) / 0.85);
      const pulse = 0.85 + 0.15 * Math.sin(st.clock.elapsedTime * 1.4 + i);
      materials[i].opacity = arrive * (0.12 + 0.78 * b.weight) * pulse;
    });
  });

  return (
    <group ref={group}>
      {beams.map((b, i) => (
        <mesh key={b.token} geometry={b.geo} material={materials[i]} frustumCulled={false} />
      ))}
    </group>
  );
}

/**
 * The acoustic landscape: a height field displaced by the real spectrogram.
 *
 * The particles form this shape first; the mesh fades in over them so the
 * cloud gains a surface rather than being replaced by one.
 */
export function Spectrogram({ built, spec, progressRef, palette }) {
  const meshRef = useRef(null);
  const wireRef = useRef(null);

  const { geo, mat, wireMat } = useMemo(() => {
    const { w, d, h, cols, rows } = built.spectroSize;
    const g = new THREE.PlaneGeometry(w, d, cols - 1, rows - 1);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const ci = i % cols;
      const ri = Math.floor(i / cols);
      const f = Math.min(spec.frames - 1, Math.round((ci / (cols - 1)) * (spec.frames - 1)));
      const e = spec.data[f * spec.bins + Math.min(spec.bins - 1, ri)];
      pos.setY(i, e * e * h - 0.35);
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();

    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(palette.surface),
      roughness: 0.62,
      metalness: 0.05,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      flatShading: false,
    });
    const wm = new THREE.MeshBasicMaterial({
      color: new THREE.Color(palette.accent),
      wireframe: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    return { geo: g, mat: m, wireMat: wm };
  }, [built, spec, palette]);

  useEffect(() => () => {
    geo.dispose();
    mat.dispose();
    wireMat.dispose();
  }, [geo, mat, wireMat]);

  useFrame(() => {
    const p = progressRef.current;
    // Solid from the moment the particles have finished forming the shape,
    // gone again as the frequency axis collapses into the waveform.
    const on = band(p, 0.845, 0.925, 0.045);
    mat.opacity = on * 0.9;
    wireMat.opacity = on * 0.07;
    if (meshRef.current) meshRef.current.visible = on > 0.002;
    if (wireRef.current) wireRef.current.visible = on > 0.002;
  });

  return (
    <group>
      <mesh ref={meshRef} geometry={geo} material={mat} frustumCulled={false} />
      <mesh ref={wireRef} geometry={geo} material={wireMat} frustumCulled={false} />
    </group>
  );
}

/**
 * The waveform, as a tube through the decimated signal. It appears exactly
 * where the collapsing spectrogram leaves the particles, so the curve looks
 * extruded out of the surface rather than dropped on top of it.
 */
export function Waveform({ built, wave, progressRef, palette }) {
  const meshRef = useRef(null);

  const { geo, mat } = useMemo(() => {
    const { w } = built.spectroSize;
    const pts = [];
    const n = Math.min(wave.length, 420);
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const k = Math.floor(u * (wave.length - 1));
      pts.push(new THREE.Vector3((u - 0.5) * w, wave[k] * 1.65, 0));
    }
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.2);
    const g = new THREE.TubeGeometry(curve, n * 2, 0.035, 8, false);
    const m = new THREE.MeshBasicMaterial({
      color: new THREE.Color(palette.accent),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return { geo: g, mat: m };
  }, [built, wave, palette]);

  useEffect(() => () => {
    geo.dispose();
    mat.dispose();
  }, [geo, mat]);

  useFrame(() => {
    const p = progressRef.current;
    const on = smootherstep((p - 0.925) / 0.05);
    mat.opacity = on * 0.85;
    if (meshRef.current) meshRef.current.visible = on > 0.002;
  });

  return <mesh ref={meshRef} geometry={geo} material={mat} frustumCulled={false} />;
}

/**
 * A ground reference under the acoustic scenes — a plain measured grid, the
 * way an instrument would draw one. It gives the flight over the landscape a
 * sense of scale and speed that the surface alone does not.
 */
export function Grid({ built, progressRef, palette }) {
  const ref = useRef(null);

  const { geo, mat } = useMemo(() => {
    const { w, d } = built.spectroSize;
    const verts = [];
    const nx = 26;
    const nz = 12;
    for (let i = 0; i <= nx; i++) {
      const x = (i / nx - 0.5) * w;
      verts.push(x, -0.42, -d / 2, x, -0.42, d / 2);
    }
    for (let i = 0; i <= nz; i++) {
      const z = (i / nz - 0.5) * d;
      verts.push(-w / 2, -0.42, z, w / 2, -0.42, z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    const m = new THREE.LineBasicMaterial({
      color: new THREE.Color(palette.line),
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    return { geo: g, mat: m };
  }, [built, palette]);

  useEffect(() => () => {
    geo.dispose();
    mat.dispose();
  }, [geo, mat]);

  useFrame(() => {
    const p = progressRef.current;
    mat.opacity = band(p, 0.8, 0.98, 0.06) * 0.4;
    if (ref.current) ref.current.visible = mat.opacity > 0.002;
  });

  return <lineSegments ref={ref} geometry={geo} material={mat} frustumCulled={false} />;
}
