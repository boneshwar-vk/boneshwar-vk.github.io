import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { damp, sampleTrack, sampleTrackVec3 } from '../anim.js';
import { ACOUSTIC_Z, DECODER_Z, layerZ } from './scene.js';

/**
 * Scroll-driven camera.
 *
 * Every key is a chosen vantage point. The camera reads the sentence square on,
 * turns to meet the speaker features arriving from the right, then travels down
 * the length of the generator before rising over the acoustic surface and
 * settling back to level for the waveform. It never orbits.
 */
const KEYS = [
  // scroll 1: the sentence, the tokens, the vectors
  { at: 0.0, pos: [0, 0.1, 9.4], target: [0, 0, 0], fov: 32 },
  { at: 0.12, pos: [0, 0.05, 10.4], target: [0, 0, 0], fov: 32 },
  { at: 0.22, pos: [0.3, -0.15, 8.2], target: [0, -0.1, 0], fov: 30 },
  // scroll 2: speaker features arrive and merge
  { at: 0.34, pos: [2.2, 0.55, 9.0], target: [1.1, 0.15, 0], fov: 34 },
  { at: 0.46, pos: [0.5, 0.3, 7.0], target: [0, 0, 0.2], fov: 34 },
  // scroll 3: down the length of the generator
  { at: 0.56, pos: [0, 0.25, 3.6], target: [0, 0, -1.6], fov: 42 },
  { at: 0.66, pos: [0, 0.15, layerZ(2) + 3.0], target: [0, 0, layerZ(4)], fov: 46 },
  { at: 0.75, pos: [0, 0.2, DECODER_Z + 4.0], target: [0, 0, DECODER_Z], fov: 40 },
  // scroll 4: over the acoustic surface, then level with the signal
  { at: 0.85, pos: [-3.0, 2.5, ACOUSTIC_Z + 5.0], target: [0, 0.1, ACOUSTIC_Z], fov: 36 },
  { at: 0.93, pos: [2.4, 1.3, ACOUSTIC_Z + 4.4], target: [0.5, 0.1, ACOUSTIC_Z], fov: 36 },
  { at: 1.0, pos: [0, 0.5, ACOUSTIC_Z + 6.2], target: [0, 0.25, ACOUSTIC_Z], fov: 32 },
];

/** Where the camera parks when the reader has asked for reduced motion. */
const STILL = { pos: [2.6, 1.6, 9.6], target: [0, 0, 0], fov: 38 };

export function CameraPath({ progressRef, reducedMotion, frameOffset }) {
  const camera = useThree((s) => s.camera);
  const rig = useRef({
    pos: new THREE.Vector3(0, 0.1, 9.4),
    target: new THREE.Vector3(),
    wantPos: new THREE.Vector3(),
    wantTarget: new THREE.Vector3(),
    fov: 32,
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

    if (!rig.ready) {
      rig.pos.copy(rig.wantPos);
      rig.target.copy(rig.wantTarget);
      rig.ready = true;
    }

    // Progress is already spring-smoothed; this only rounds the corner where
    // two moves change direction at once.
    const k = 1 - Math.exp(-6.5 * dt);
    rig.pos.lerp(rig.wantPos, k);
    rig.target.lerp(rig.wantTarget, k);

    camera.position.copy(rig.pos);
    camera.lookAt(rig.target);

    const wantFov = damp(camera.fov, rig.fov, 5, dt);
    if (Math.abs(camera.fov - wantFov) > 0.01) {
      camera.fov = wantFov;
      camera.updateProjectionMatrix();
    }

    // Slide the scene clear of the caption column by dollying sideways after
    // aiming, which keeps the projection honest.
    if (frameOffset.x || frameOffset.y) {
      const halfH = Math.tan((camera.fov * Math.PI) / 360) * rig.pos.distanceTo(rig.target);
      const halfW = halfH * camera.aspect;
      if (frameOffset.x) camera.translateX(-frameOffset.x * halfW);
      if (frameOffset.y) camera.translateY(-frameOffset.y * halfH);
    }
  });

  return null;
}
