import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { damp, sampleTrack, sampleTrackVec3 } from '../anim.js';

/**
 * Scroll-driven camera.
 *
 * Every key is a deliberate vantage point rather than an orbit: the camera
 * stands off for the sentence, retreats as the field disperses, turns to look
 * down the transformer stack, pushes through it, closes on the focused token,
 * sinks into the latent cloud, rises over the acoustic landscape, and settles
 * square-on for the waveform. Nothing here spins.
 */
const KEYS = [
  // the sentence, read straight on
  { at: 0.0, pos: [0, 0.15, 7.6], target: [0, 0, 0], fov: 38 },
  { at: 0.1, pos: [0, 0.05, 8.6], target: [0, 0, 0], fov: 37 },
  // tokens, then the pull back as they scatter into the field
  { at: 0.19, pos: [0.6, 0.4, 8.0], target: [0, 0, 0], fov: 36 },
  { at: 0.33, pos: [5.4, 3.6, 12.2], target: [0, 0, 0], fov: 42 },
  // swing round to see the layers separated along Z
  { at: 0.43, pos: [9.4, 2.4, 8.6], target: [0, 0, 0], fov: 34 },
  // and push through the stack
  { at: 0.52, pos: [1.6, 0.75, 6.4], target: [0, 0, -1.6], fov: 44 },
  { at: 0.58, pos: [0.9, 0.5, 1.4], target: [0.8, 0.2, -3.2], fov: 44 },
  // close on the focused token as its beams arrive
  { at: 0.65, pos: [1.9, 1.5, 8.2], target: [1.45, 0.5, 3.9], fov: 32 },
  { at: 0.7, pos: [-0.4, 2.9, 9.4], target: [0.3, 0.5, 3.2], fov: 36 },
  // sink into the latent cloud
  { at: 0.76, pos: [0, 0.1, 3.4], target: [0, 0, 0], fov: 56 },
  // rise over the acoustic landscape and travel along it
  { at: 0.86, pos: [-6.0, 3.5, 5.0], target: [-1.0, 0.15, 0], fov: 40 },
  { at: 0.92, pos: [4.4, 2.0, 3.6], target: [1.8, 0.05, 0], fov: 40 },
  // and settle square-on for the signal
  { at: 1.0, pos: [0, 0.35, 8.4], target: [0, 0.1, 0], fov: 34 },
];

/** Where the camera parks when the reader has asked for reduced motion. */
const STILL = { pos: [3.4, 2.4, 10.5], target: [0, 0, 0], fov: 42 };

export function CameraPath({ progressRef, reducedMotion, frameOffset }) {
  const camera = useThree((s) => s.camera);
  const rig = useRef({
    pos: new THREE.Vector3(0, 0.15, 7.6),
    target: new THREE.Vector3(),
    wantPos: new THREE.Vector3(),
    wantTarget: new THREE.Vector3(),
    fov: 38,
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

    // The progress value is already spring-smoothed; this second pass only
    // rounds the corner where two moves change direction at once.
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

    // Slide the scene clear of the caption column without distorting the
    // projection: dolly sideways after aiming.
    if (frameOffset.x || frameOffset.y) {
      const halfH = Math.tan((camera.fov * Math.PI) / 360) * rig.pos.distanceTo(rig.target);
      const halfW = halfH * camera.aspect;
      if (frameOffset.x) camera.translateX(-frameOffset.x * halfW);
      if (frameOffset.y) camera.translateY(-frameOffset.y * halfH);
    }
  });

  return null;
}
