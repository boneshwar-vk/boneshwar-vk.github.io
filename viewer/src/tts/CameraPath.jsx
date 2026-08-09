import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { damp, sampleTrack, sampleTrackVec3 } from '../anim.js';

/**
 * Scroll-driven camera.
 *
 * It stays outside the diagram throughout. The only moves are a gentle pull
 * back as more of the picture is needed, and a settle back in at the end.
 * Nothing orbits and nothing flies through the transformer.
 */
const KEYS = [
  // the sentence, then the tokens opening out
  { at: 0.0, pos: [0, 0, 8.6], target: [0, 0, 0], fov: 34 },
  { at: 0.16, pos: [0, 0, 10.4], target: [0, 0, 0], fov: 34 },
  // text on the left, speaker on the right
  { at: 0.3, pos: [0.5, 0, 10.4], target: [0.3, 0, 0], fov: 34 },
  // pull back far enough to hold the whole loop at once
  { at: 0.46, pos: [0.7, 0.25, 11.6], target: [0.5, 0.05, 0], fov: 36 },
  { at: 0.64, pos: [0.95, 0.2, 11.3], target: [0.6, 0.02, 0], fov: 36 },
  { at: 0.8, pos: [0.7, 0.25, 11.5], target: [0.5, 0.05, 0], fov: 36 },
  // settle square on for the acoustic block and the waveform below it
  { at: 0.92, pos: [0, 0.35, 10.8], target: [0, 0.42, 0], fov: 33 },
  { at: 1.0, pos: [0, 0.4, 10.2], target: [0, 0.5, 0], fov: 32 },
];

/** Where the camera parks when the reader has asked for reduced motion. */
const STILL = { pos: [0.7, 0.25, 11.6], target: [0.5, 0.05, 0], fov: 36 };

export function CameraPath({ progressRef, reducedMotion, frameOffset }) {
  const camera = useThree((s) => s.camera);
  const rig = useRef({
    pos: new THREE.Vector3(0, 0, 8.6),
    target: new THREE.Vector3(),
    wantPos: new THREE.Vector3(),
    wantTarget: new THREE.Vector3(),
    fov: 34,
    ready: false,
  }).current;

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.064);
    const p = progressRef.current;

    if (reducedMotion) {
      rig.wantPos.set(...STILL.pos);
      rig.wantTarget.set(...STILL.target);
      rig.fov = STILL.fov;
    } else {
      sampleTrackVec3(KEYS, 'pos', p, rig.wantPos);
      sampleTrackVec3(KEYS, 'target', p, rig.wantTarget);
      rig.fov = sampleTrack(KEYS, 'fov', p);
    }

    // Narrow viewports see far less width at a given distance. Scale the
    // camera's distance from its target so the diagram fits on a phone
    // without needing a separate layout.
    const fit = THREE.MathUtils.clamp(1.75 / camera.aspect, 1, 3);
    if (fit > 1.001) {
      rig.wantPos.sub(rig.wantTarget).multiplyScalar(fit).add(rig.wantTarget);
    }

    if (!rig.ready) {
      rig.pos.copy(rig.wantPos);
      rig.target.copy(rig.wantTarget);
      rig.ready = true;
    }

    // Slow on purpose. Progress is already spring-smoothed; this keeps the
    // camera unhurried rather than snapping between keys.
    const k = 1 - Math.exp(-4.2 * dt);
    rig.pos.lerp(rig.wantPos, k);
    rig.target.lerp(rig.wantTarget, k);

    camera.position.copy(rig.pos);
    camera.lookAt(rig.target);

    const wantFov = damp(camera.fov, rig.fov, 4, dt);
    if (Math.abs(camera.fov - wantFov) > 0.01) {
      camera.fov = wantFov;
      camera.updateProjectionMatrix();
    }

    if (frameOffset.x || frameOffset.y) {
      const halfH = Math.tan((camera.fov * Math.PI) / 360) * rig.pos.distanceTo(rig.target);
      const halfW = halfH * camera.aspect;
      if (frameOffset.x) camera.translateX(-frameOffset.x * halfW);
      if (frameOffset.y) camera.translateY(-frameOffset.y * halfH);
    }
  });

  return null;
}
