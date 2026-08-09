import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { clamp, damp, sampleTrack, sampleTrackVec3, spring } from './anim.js';

/**
 * The story path.
 *
 * Each beat is a camera pose in spherical coordinates around the complex.
 * `focus` (0..1) is the peptide-highlight weight. Tracks are eased with
 * smootherstep between beats, so the camera settles at each one and glides
 * between — never a linear ramp, never an overshoot.
 *
 * `at` values line up with the narrative panels in structure.html.
 */
export const BEATS = [
  // 0 — the whole complex, three-quarter view, standing upright
  { at: 0.0, azimuth: -0.62, polar: 1.44, radius: 4.35, fov: 32, focus: 0.0, target: [0, 0, 0] },
  // 1 — swing round the alpha1/alpha2 platform
  { at: 0.26, azimuth: 0.72, polar: 1.30, radius: 3.55, fov: 32, focus: 0.12, target: [0, 0.16, 0] },
  // 2 — drop to beta2M sitting underneath as the scaffold
  { at: 0.5, azimuth: 1.85, polar: 1.58, radius: 4.05, fov: 32, focus: 0.0, target: [0, -0.22, 0] },
  // 3 — rise over the groove: the T-cell receptor's eye view
  { at: 0.76, azimuth: 3.05, polar: 0.62, radius: 2.15, fov: 30, focus: 0.82, target: 'peptide' },
  // 4 — settle in close on the epitope itself
  { at: 1.0, azimuth: 3.72, polar: 0.95, radius: 1.35, fov: 27, focus: 1.0, target: 'peptide' },
];

const IDLE_SPIN = 0.052;        // rad/s — "very slow continuous rotation"
const BREATH_RATE = 0.185;      // rad/s of the breathing sine
const BREATH_AMOUNT = 0.052;    // +/- 5.2% radius, always on
const PARALLAX = 0.085;         // rad of pointer-driven sway
const DRAG_RETURN = 0.55;       // how fast a user's orbit yields back to the story

/**
 * Drives the camera every frame from three superposed sources:
 *
 *   1. the scroll story  — a spring-smoothed progress value through the beats
 *   2. an idle layer     — continuous slow spin + a continuous breathing dolly
 *   3. direct input      — pointer parallax and drag-to-orbit, with inertia
 *
 * They are *added*, never switched between, which is why there is no visible
 * hand-off when the reader stops scrolling: the scroll term simply stops
 * changing while the idle term keeps running.
 */
export function CameraRig({
  driver,
  focusRef,
  peptideCenter,
  reducedMotion,
  onProgress,
  frameOffset = { x: 0, y: 0 },
}) {
  const camera = useThree((s) => s.camera);

  const rig = useRef({
    progress: { x: 0, v: 0 },
    azimuth: 0,
    polar: 1.44,
    radius: 4.35,
    fov: 32,
    spin: 0,
    clock: 0,
    parallaxX: 0,
    parallaxY: 0,
    target: new THREE.Vector3(),
    smoothTarget: new THREE.Vector3(),
    beatTarget: new THREE.Vector3(),
    initialised: false,
    lastReported: -1,
  }).current;

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.064);
    rig.clock += dt;

    // ---- 1. story progress -------------------------------------------------
    // A critically damped spring, so flick-scrolling on a trackpad or a phone
    // arrives as smooth motion instead of a stutter of discrete jumps.
    const p = spring(rig.progress, driver.targetProgress, reducedMotion ? 26 : 7.5, dt);
    const progress = clamp(p);

    // Scroll activity decays; it only gates the *idle spin*, never the breathing.
    driver.activity = damp(driver.activity, 0, 1.9, dt);

    // ---- 2. sample the beat tracks ----------------------------------------
    const azTrack = sampleTrack(BEATS, 'azimuth', progress);
    const polTrack = sampleTrack(BEATS, 'polar', progress);
    const radTrack = sampleTrack(BEATS, 'radius', progress);
    const fovTrack = sampleTrack(BEATS, 'fov', progress);
    focusRef.current = sampleTrack(BEATS, 'focus', progress);

    // Beat targets resolve 'peptide' to the epitope centroid measured from the GLB.
    resolveTarget(BEATS, progress, peptideCenter, rig.beatTarget);

    // ---- 3. idle layer -----------------------------------------------------
    if (!reducedMotion) {
      // Idle spin fades in as scroll activity fades out — both are continuous,
      // so the transition is invisible.
      const idleWeight = 1 - clamp(driver.activity);
      rig.spin += IDLE_SPIN * idleWeight * dt;
    }

    // The breathing dolly runs at all times, including mid-scroll. This is what
    // keeps the frame alive: the model is never truly still.
    const breath = reducedMotion
      ? 0
      : Math.sin(rig.clock * BREATH_RATE * Math.PI) * BREATH_AMOUNT +
        Math.sin(rig.clock * BREATH_RATE * Math.PI * 0.41 + 1.7) * BREATH_AMOUNT * 0.38;

    // ---- 4. direct input ---------------------------------------------------
    if (!driver.dragging) {
      // Inertia, then a slow yield back to the authored path.
      driver.dragAzimuth += driver.dragVelX;
      driver.dragPolar += driver.dragVelY;
      driver.dragVelX = damp(driver.dragVelX, 0, 6.5, dt);
      driver.dragVelY = damp(driver.dragVelY, 0, 6.5, dt);
      driver.dragAzimuth = damp(driver.dragAzimuth, 0, DRAG_RETURN, dt);
      driver.dragPolar = damp(driver.dragPolar, 0, DRAG_RETURN, dt);
    }

    rig.parallaxX = damp(rig.parallaxX, driver.pointerX * PARALLAX, 3.0, dt);
    rig.parallaxY = damp(rig.parallaxY, driver.pointerY * PARALLAX * 0.55, 3.0, dt);

    // ---- 5. compose + damp -------------------------------------------------
    const wantAz = azTrack + rig.spin + driver.dragAzimuth + rig.parallaxX;
    const wantPol = clamp(
      polTrack + driver.dragPolar + rig.parallaxY,
      0.22,
      Math.PI - 0.22,
    );
    const wantRad = radTrack * (1 + breath);

    if (!rig.initialised) {
      rig.azimuth = wantAz;
      rig.polar = wantPol;
      rig.radius = wantRad;
      rig.fov = fovTrack;
      rig.smoothTarget.copy(rig.beatTarget);
      rig.initialised = true;
    }

    // A final smoothing pass over the composed pose. Every source is already
    // continuous, so this is polish rather than correction — it rounds off the
    // corner where two motions change direction at once.
    rig.azimuth = damp(rig.azimuth, wantAz, 9.0, dt);
    rig.polar = damp(rig.polar, wantPol, 9.0, dt);
    rig.radius = damp(rig.radius, wantRad, 6.0, dt);
    rig.fov = damp(rig.fov, fovTrack, 5.0, dt);
    rig.smoothTarget.lerp(rig.beatTarget, 1 - Math.exp(-5.0 * dt));

    // ---- 6. write to the camera -------------------------------------------
    const sinPol = Math.sin(rig.polar);
    camera.position.set(
      rig.smoothTarget.x + rig.radius * sinPol * Math.sin(rig.azimuth),
      rig.smoothTarget.y + rig.radius * Math.cos(rig.polar),
      rig.smoothTarget.z + rig.radius * sinPol * Math.cos(rig.azimuth),
    );
    camera.lookAt(rig.smoothTarget);

    if (Math.abs(camera.fov - rig.fov) > 0.01) {
      camera.fov = rig.fov;
      camera.updateProjectionMatrix();
    }

    // Slide the complex clear of the narrative column by dollying the camera
    // sideways *after* aiming it. Doing it here rather than with a CSS transform
    // keeps the projection honest and wastes no pixels off-screen.
    if (frameOffset.x || frameOffset.y) {
      const halfH = Math.tan((rig.fov * Math.PI) / 360) * rig.radius;
      const halfW = halfH * camera.aspect;
      if (frameOffset.x) camera.translateX(-frameOffset.x * halfW);
      if (frameOffset.y) camera.translateY(-frameOffset.y * halfH);
    }

    // Report the eased progress out to the DOM (panel highlighting), throttled
    // to meaningful change so we are not touching the DOM 60 times a second.
    if (onProgress && Math.abs(progress - rig.lastReported) > 0.004) {
      rig.lastReported = progress;
      onProgress(progress);
    }
  });

  return null;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

function resolveTarget(beats, p, peptideCenter, out) {
  const pick = (beat, v) => {
    if (beat.target === 'peptide') return v.copy(peptideCenter);
    return v.set(beat.target[0], beat.target[1], beat.target[2]);
  };
  const n = beats.length;
  if (p <= beats[0].at) return pick(beats[0], out);
  if (p >= beats[n - 1].at) return pick(beats[n - 1], out);
  for (let i = 0; i < n - 1; i++) {
    if (p >= beats[i].at && p <= beats[i + 1].at) {
      const t = (p - beats[i].at) / (beats[i + 1].at - beats[i].at);
      const e = t * t * t * (t * (t * 6 - 15) + 10);
      pick(beats[i], _a);
      pick(beats[i + 1], _b);
      return out.copy(_a).lerp(_b, e);
    }
  }
  return pick(beats[n - 1], out);
}

export { sampleTrackVec3 };
