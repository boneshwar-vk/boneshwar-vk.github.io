import { useEffect, useState } from 'react';
import * as THREE from 'three';

/**
 * Mirrors the site's CSS custom properties into the 3D scene, so the molecule
 * re-tints when the reader flips the charcoal/teal/ivory switch in the nav.
 */
const readVar = (name, fallback) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
};

function palette() {
  const accent = new THREE.Color(readVar('--accent', '#c9a86a'));
  const accentDeep = new THREE.Color(readVar('--accent-deep', '#ddc488'));
  const paper = new THREE.Color(readVar('--paper', '#1b1c1e'));

  // Perceived lightness of the page background decides whether we light the
  // scene as a dark editorial plate or a bright ivory one.
  const lum = 0.2126 * paper.r + 0.7152 * paper.g + 0.0722 * paper.b;
  const isLight = lum > 0.5;

  // The two chains are deliberately NOT derived from --ink. On the warm themes
  // --ink is cream, which lands within a few percent of --accent and collapses
  // the whole complex into one colour. A cool desaturated sage keeps the protein
  // reading as structure and leaves the warm accent exclusively to the epitope.
  // Base values sit deliberately dark: ACES tone mapping plus the environment
  // lift the lit faces a long way, and a mid-tone base washes out to near-white.
  const hla = new THREE.Color(isLight ? '#5f7c77' : '#7a958e');
  const b2m = new THREE.Color(isLight ? '#9aaaa6' : '#4c6763');

  return {
    isLight,
    background: paper,
    hla,
    b2m,
    peptide: accent,
    peptideGlow: accentDeep,
    bond: accent.clone().multiplyScalar(0.72),
    // A fully warm rim turns the recessive chain muddy brown against the teal
    // background; halfway to white keeps the edge light without the stain.
    rim: isLight
      ? new THREE.Color('#ffffff')
      : accentDeep.clone().lerp(new THREE.Color('#ffffff'), 0.55),
    keyIntensity: isLight ? 1.9 : 1.5,
    ambientIntensity: isLight ? 0.62 : 0.36,
    envIntensity: isLight ? 0.7 : 0.5,
  };
}

export function useSiteTheme() {
  const [theme, setTheme] = useState(() => palette());

  useEffect(() => {
    const update = () => setTheme(palette());
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'style', 'class'],
    });
    return () => mo.disconnect();
  }, []);

  return theme;
}
