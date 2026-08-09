import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { STAGE_AT, WORDS } from './stages.js';
import { smootherstep } from '../anim.js';

/**
 * The single `Points` object that is every scene.
 *
 * Two position attributes are live at a time — the stage behind you and the
 * stage ahead — and a `uMix` uniform crossfades between them. Buffers are only
 * re-uploaded when you cross a stage boundary, so scrolling costs one uniform
 * write per frame rather than a full geometry update.
 */
export function ParticleField({ built, progressRef, palette, reducedMotion, onStage }) {
  const pointsRef = useRef(null);
  const geomRef = useRef(null);
  const state = useRef({ segment: -1, mix: 0 }).current;

  const { stages, aWord, aToken, aRand } = built;
  const count = aRand.length;

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(stages[0].slice(), 3));
    g.setAttribute('aPosB', new THREE.BufferAttribute(stages[1].slice(), 3));
    g.setAttribute('aWord', new THREE.BufferAttribute(aWord, 1));
    g.setAttribute('aToken', new THREE.BufferAttribute(aToken, 1));
    g.setAttribute('aRand', new THREE.BufferAttribute(aRand, 1));
    // Never culled: positions live in the shader, so three's bounds are wrong.
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 40);
    return g;
  }, [stages, aWord, aToken, aRand]);

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uMix: { value: 0 },
        uTime: { value: 0 },
        uSize: { value: 1 },
        uDrift: { value: reducedMotion ? 0 : 1 },
        uFocus: { value: -1 },
        uFocusAmt: { value: 0 },
        uTextAmt: { value: 1 },
        uColorA: { value: new THREE.Color(palette.cool) },
        uColorB: { value: new THREE.Color(palette.accent) },
        uColorC: { value: new THREE.Color(palette.ink) },
        uOpacity: { value: 1 },
        uWordOff: { value: Array.from({ length: 4 }, () => new THREE.Vector3()) },
        uPixelRatio: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aPosB;
        attribute float aWord;
        attribute float aToken;
        attribute float aRand;

        uniform float uMix;
        uniform float uTime;
        uniform float uSize;
        uniform float uDrift;
        uniform float uFocus;
        uniform float uFocusAmt;
        uniform float uTextAmt;
        uniform float uPixelRatio;
        uniform vec3 uWordOff[4];

        varying float vRand;
        varying float vToken;
        varying float vFocus;
        varying float vDepth;

        void main() {
          vec3 p = mix(position, aPosB, uMix);

          // Per-word float/parallax, only while the sentence is still a sentence.
          int wi = int(aWord + 0.5);
          vec3 off = uWordOff[0];
          if (wi == 1) off = uWordOff[1];
          else if (wi == 2) off = uWordOff[2];
          else if (wi == 3) off = uWordOff[3];
          p += off * uTextAmt;

          // Idle drift: small, slow, and different per particle so the field
          // breathes without anything visibly spinning.
          float t = uTime * 0.35 + aRand * 43.0;
          p += vec3(sin(t), cos(t * 0.83 + 1.7), sin(t * 0.61 + 3.1))
               * (0.028 + 0.05 * aRand) * uDrift;

          vFocus = (abs(aToken - uFocus) < 0.5) ? uFocusAmt : 0.0;
          vRand = aRand;
          vToken = aToken;

          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vDepth = -mv.z;
          gl_Position = projectionMatrix * mv;

          float s = uSize * (0.55 + 0.9 * aRand) * (1.0 + 1.6 * vFocus);
          gl_PointSize = s * uPixelRatio * (34.0 / max(1.0, -mv.z));
        }
      `,
      fragmentShader: /* glsl */ `
        precision mediump float;

        uniform vec3 uColorA;
        uniform vec3 uColorB;
        uniform vec3 uColorC;
        uniform float uOpacity;
        uniform float uMix;

        varying float vRand;
        varying float vToken;
        varying float vFocus;
        varying float vDepth;

        void main() {
          // Round, soft-edged sprite. Cheaper and cleaner than a texture.
          vec2 d = gl_PointCoord - 0.5;
          float r = dot(d, d);
          if (r > 0.25) discard;
          float alpha = smoothstep(0.25, 0.02, r);

          vec3 col = mix(uColorA, uColorC, vRand * 0.55);
          col = mix(col, uColorB, vFocus * 0.85);
          // A touch of token-wise variation so clusters are distinguishable
          // without turning the palette into confetti.
          col *= 0.86 + 0.14 * sin(vToken * 1.7);

          // Fade with distance so depth reads without fog washing the scene.
          float depthFade = clamp(1.35 - vDepth * 0.028, 0.25, 1.0);

          gl_FragColor = vec4(col, alpha * uOpacity * depthFade * (0.5 + 0.5 * vRand));
        }
      `,
    });
  }, [palette, reducedMotion]);

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  // Keep colours in step with the site theme without rebuilding the material.
  useEffect(() => {
    material.uniforms.uColorA.value.set(palette.cool);
    material.uniforms.uColorB.value.set(palette.accent);
    material.uniforms.uColorC.value.set(palette.ink);
  }, [material, palette]);

  const wordPhase = useRef([0, 1.9, 3.4, 5.1]).current;

  useFrame((st, delta) => {
    const dt = Math.min(delta, 0.064);
    const p = progressRef.current;
    const u = material.uniforms;
    u.uTime.value += dt;
    u.uPixelRatio.value = st.gl.getPixelRatio();

    // Which pair of stages are we between?
    let seg = 0;
    while (seg < STAGE_AT.length - 2 && p > STAGE_AT[seg + 1]) seg += 1;
    const a = STAGE_AT[seg];
    const b = STAGE_AT[seg + 1];
    const local = smootherstep((p - a) / Math.max(1e-6, b - a));

    if (seg !== state.segment) {
      state.segment = seg;
      const posA = geometry.getAttribute('position');
      const posB = geometry.getAttribute('aPosB');
      posA.array.set(stages[seg]);
      posB.array.set(stages[seg + 1]);
      posA.needsUpdate = true;
      posB.needsUpdate = true;
      onStage?.(seg);
    }
    u.uMix.value = local;

    // Text-stage extras fade out as the sentence stops being a sentence.
    const textAmt = 1 - smootherstep((p - 0.02) / 0.1);
    u.uTextAmt.value = textAmt;
    if (textAmt > 0.001 && !reducedMotion) {
      for (let i = 0; i < WORDS.length; i++) {
        const t = u.uTime.value * 0.5 + wordPhase[i];
        u.uWordOff.value[i].set(
          Math.sin(t * 0.7) * 0.075,
          Math.sin(t) * 0.1,
          Math.cos(t * 0.55) * 0.06,
        );
      }
    }

    // Point size grows as the field disperses, so density reads evenly.
    const disperse = smootherstep((p - 0.2) / 0.25);
    u.uSize.value = 1.05 + 0.5 * disperse - 0.45 * smootherstep((p - 0.78) / 0.2);

    // Focus token highlight, only across the attention beat.
    const focus = smootherstep((p - 0.58) / 0.07) * (1 - smootherstep((p - 0.68) / 0.06));
    u.uFocusAmt.value = focus;
    u.uFocus.value = focus > 0.01 ? 4 : -1;

    // Hand the stage over to the surface mesh as it takes on solidity.
    const surfaceHandover = smootherstep((p - 0.84) / 0.06) * (1 - smootherstep((p - 0.9) / 0.06));
    u.uOpacity.value = 1 - 0.45 * surfaceHandover;
  });

  return <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />;
}
