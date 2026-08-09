import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/**
 * Image-based lighting from a procedural room. Generated on the GPU at mount —
 * no HDR fetch, so nothing extra crosses the network and there is no pop-in.
 */
export function Environment({ intensity }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);

  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const target = pmrem.fromScene(room, 0.04);
    scene.environment = target.texture;
    return () => {
      scene.environment = null;
      target.texture.dispose();
      pmrem.dispose();
      room.traverse((o) => {
        if (o.isMesh) {
          o.geometry?.dispose();
          o.material?.dispose();
        }
      });
    };
  }, [gl, scene]);

  useEffect(() => {
    scene.environmentIntensity = intensity;
  }, [scene, intensity]);

  return null;
}

/**
 * Three-point rig. The rim light is tinted with the site accent so the silhouette
 * of the helices separates from the background in all three themes.
 */
export function Lights({ theme }) {
  return (
    <>
      <ambientLight intensity={theme.ambientIntensity} />
      <directionalLight
        position={[3.2, 4.5, 3.0]}
        intensity={theme.keyIntensity}
        color="#fff6e8"
      />
      <directionalLight position={[-3.6, 1.2, -2.4]} intensity={0.75} color={theme.rim} />
      <directionalLight position={[0, -3.0, 1.6]} intensity={0.28} color="#9fb6c9" />
    </>
  );
}
