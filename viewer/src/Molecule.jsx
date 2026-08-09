import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

import { damp } from './anim.js';

/** Shared loader config — the GLB is meshopt-compressed (EXT_meshopt_compression). */
const extendLoader = (loader) => loader.setMeshoptDecoder(MeshoptDecoder);

/**
 * The pMHC complex.
 *
 * The GLB ships three named nodes — HLA, B2M, Peptide — and this component keeps
 * them as three addressable groups so the story can treat them independently.
 * `focusRef.current` (0..1) drives the peptide highlight: as it rises the two
 * chains recede in opacity and saturation and the peptide gains emissive lift,
 * so the epitope reads as the subject rather than as more molecule.
 */
export function Molecule({ url, theme, focusRef, onReady }) {
  const gltf = useLoader(GLTFLoader, url, extendLoader);

  const parts = useMemo(() => {
    const scene = gltf.scene;
    const find = (name) => scene.getObjectByName(name);
    const hla = find('HLA');
    const b2m = find('B2M');
    const peptide = find('Peptide');

    const collect = (root) => {
      const out = [];
      root?.traverse((o) => {
        if (o.isMesh) out.push(o);
      });
      return out;
    };

    // Clone materials so the three groups can diverge, and so a second instance
    // of the viewer on the page never fights over shared material state.
    const prep = (meshes, { transparent }) =>
      meshes.map((m) => {
        const mat = m.material.clone();
        mat.transparent = transparent;
        mat.envMapIntensity = 0.6;
        m.material = mat;
        m.castShadow = false;
        m.receiveShadow = false;
        m.frustumCulled = false;
        return m;
      });

    const chains = prep([...collect(hla)], { transparent: true });
    const b2mMeshes = prep([...collect(b2m)], { transparent: true });
    const pepMeshes = prep([...collect(peptide)], { transparent: false });

    // Peptide bounds let the camera aim at the epitope without baked constants.
    const box = new THREE.Box3();
    if (peptide) box.setFromObject(peptide);
    const center = box.getCenter(new THREE.Vector3());

    return { hla, b2m, peptide, chains, b2mMeshes, pepMeshes, peptideCenter: center };
  }, [gltf]);

  useEffect(() => {
    onReady?.(parts);
  }, [parts, onReady]);

  // Re-tint whenever the site theme changes.
  useEffect(() => {
    parts.chains.forEach((m) => m.material.color.copy(theme.hla));
    parts.b2mMeshes.forEach((m) => m.material.color.copy(theme.b2m));
    parts.pepMeshes.forEach((m) => {
      const name = m.material.name || '';
      if (name.includes('carbon')) m.material.color.copy(theme.peptide);
      else if (name.includes('bond')) m.material.color.copy(theme.bond);
      // nitrogen / oxygen keep their CPK identity across themes
      m.material.envMapIntensity = 0.9;
    });
    [...parts.chains, ...parts.b2mMeshes].forEach((m) => {
      m.material.envMapIntensity = theme.isLight ? 0.7 : 0.5;
    });
  }, [parts, theme]);

  const state = useRef({ focus: 0 });

  useFrame((_, dt) => {
    const target = focusRef.current ?? 0;
    // Damped rather than driven directly: the highlight keeps easing for a beat
    // after the scroll stops, which reads as intent instead of as a jump cut.
    const f = damp(state.current.focus, target, 4.2, Math.min(dt, 0.05));
    if (Math.abs(f - state.current.focus) < 1e-5 && Math.abs(f - target) < 1e-4) return;
    state.current.focus = f;

    // The chains recede but never vanish: the epitope only means anything if
    // you can still read the groove it is sitting in.
    const chainOpacity = 1 - 0.48 * f;
    const chainRough = 0.5 + 0.28 * f;
    parts.chains.forEach((m) => {
      m.material.opacity = chainOpacity;
      m.material.roughness = chainRough;
      m.material.depthWrite = chainOpacity > 0.92;
    });
    parts.b2mMeshes.forEach((m) => {
      m.material.opacity = 1 - 0.6 * f;
      m.material.depthWrite = m.material.opacity > 0.92;
    });
    parts.pepMeshes.forEach((m) => {
      if (!m.material.emissive) return;
      m.material.emissive.copy(theme.peptideGlow);
      m.material.emissiveIntensity = 0.06 + 0.34 * f;
    });
  });

  return <primitive object={gltf.scene} />;
}

export function preloadMolecule(url) {
  useLoader.preload(GLTFLoader, url, extendLoader);
}
