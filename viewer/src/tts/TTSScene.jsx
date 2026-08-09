import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { smootherstep } from '../anim.js';
import {
  ACOUSTIC_Z,
  CARD_H,
  DECODER_Z,
  LAYERS,
  SPEAKER,
  WORDS,
  featureTexture,
  gridGeometry,
  layerZ,
  outlineGeometry,
  plateTexture,
  spectrogramGeometry,
  vectorFor,
  vectorTexture,
  waveformGeometry,
  wordLayout,
  wordTexture,
} from './scene.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Ramp from a to b. */
const ramp = (p, a, b) => smootherstep((p - a) / Math.max(1e-6, b - a));
/** On between a and b, easing at both ends. */
const band = (p, a, b, f = 0.04) => ramp(p, a, a + f) * (1 - ramp(p, b - f, b));

/**
 * Scroll 1: the sentence becomes tokens, then vectors.
 *
 * Each word keeps its own card the whole way. The word face fades out as the
 * numeric face fades in, so identity is never lost in the transformation.
 */
function WordCards({ progressRef, palette }) {
  const cards = useMemo(() => {
    const xs = wordLayout(1);
    return WORDS.map((w, i) => ({
      index: i,
      width: w.w,
      x: xs[i],
      wordTex: wordTexture(w.text, palette.ink),
      vecTex: vectorTexture(vectorFor(i), palette.ink, palette.dim, palette.accent),
    }));
  }, [palette]);

  // Three parallel ref arrays rather than stashing children on the parent's
  // userData: React assigns child refs before the parent's, so a child callback
  // that reads the parent ref always sees null and the link is never made.
  const refs = useRef([]);
  const wordRefs = useRef([]);
  const vecRefs = useRef([]);
  const bodyMat = useMemo(
    () => new THREE.MeshStandardMaterial({
      color: new THREE.Color(palette.card),
      roughness: 0.55,
      metalness: 0.08,
      transparent: true,
      opacity: 0,
    }),
    [palette],
  );
  const edgeMat = useMemo(
    () => new THREE.LineBasicMaterial({
      color: new THREE.Color(palette.edge),
      transparent: true,
      opacity: 0,
    }),
    [palette],
  );

  useEffect(() => () => {
    cards.forEach((c) => { c.wordTex.dispose(); c.vecTex.dispose(); });
    bodyMat.dispose();
    edgeMat.dispose();
  }, [cards, bodyMat, edgeMat]);

  const spread = useMemo(() => wordLayout(1), []);
  const spreadWide = useMemo(() => wordLayout(2.6), []);

  useFrame(() => {
    const p = progressRef.current;
    // sentence -> tokens -> vectors, then the whole row recedes into scroll 2
    const tokenise = ramp(p, 0.055, 0.135);
    const toVector = ramp(p, 0.15, 0.235);
    const handoff = ramp(p, 0.26, 0.34);
    const visible = 1 - ramp(p, 0.3, 0.4);

    bodyMat.opacity = toVector * 0.9 * visible;
    edgeMat.opacity = (0.25 + 0.45 * toVector) * visible;

    cards.forEach((c, i) => {
      const g = refs.current[i];
      if (!g) return;
      const x = spread[i] + (spreadWide[i] - spread[i]) * tokenise;
      // As the row hands off to the conditioning stage it gathers into a column.
      const gather = handoff;
      const gx = x * (1 - gather * 0.72);
      const gy = gather * ((i - (WORDS.length - 1) / 2) * 0.34);
      g.position.set(gx, gy, gather * 0.4);
      g.scale.setScalar(1 - 0.18 * gather);
      const wm = wordRefs.current[i];
      const vm = vecRefs.current[i];
      if (wm) wm.material.opacity = (1 - toVector) * visible;
      if (vm) vm.material.opacity = toVector * visible;
      g.visible = visible > 0.001;
    });
  });

  return (
    <group>
      {cards.map((c, i) => (
        <group key={c.index} ref={(el) => { refs.current[i] = el; }}>
          <mesh material={bodyMat}>
            <boxGeometry args={[c.width, CARD_H, 0.12]} />
          </mesh>
          <lineSegments material={edgeMat} geometry={getOutline(c.width, CARD_H)} position={[0, 0, 0.062]} />
          <mesh position={[0, 0.02, 0.07]} ref={(el) => { wordRefs.current[i] = el; }}>
            <planeGeometry args={[c.width * 0.92, c.width * 0.92 * 0.3125]} />
            <meshBasicMaterial map={c.wordTex} transparent depthWrite={false} toneMapped={false} opacity={1} />
          </mesh>
          <mesh position={[0, 0, 0.071]} ref={(el) => { vecRefs.current[i] = el; }}>
            <planeGeometry args={[c.width * 0.72, (c.width * 0.72) * 0.625]} />
            <meshBasicMaterial map={c.vecTex} transparent depthWrite={false} toneMapped={false} opacity={0} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Outline geometries are shared per size. Not a hook, despite being called
 *  during render: it only touches a module-level cache. */
const outlineCache = new Map();
function getOutline(w, h) {
  const key = `${w}x${h}`;
  if (!outlineCache.has(key)) outlineCache.set(key, outlineGeometry(w, h));
  return outlineCache.get(key);
}

/**
 * Scroll 2: four illustrative speaker features arrive and merge with the text
 * representation to form a single conditioned representation.
 */
function SpeakerConditioning({ progressRef, palette }) {
  const refs = useRef([]);
  const textures = useMemo(
    () => SPEAKER.map((f) => featureTexture(f, palette.ink, palette.dim, palette.accent)),
    [palette],
  );
  const bodyMat = useMemo(
    () => new THREE.MeshStandardMaterial({
      color: new THREE.Color(palette.speaker),
      roughness: 0.5,
      metalness: 0.1,
      transparent: true,
      opacity: 0,
    }),
    [palette],
  );
  const edgeMat = useMemo(
    () => new THREE.LineBasicMaterial({
      color: new THREE.Color(palette.accent),
      transparent: true,
      opacity: 0,
    }),
    [palette],
  );

  useEffect(() => () => {
    textures.forEach((t) => t.dispose());
    bodyMat.dispose();
    edgeMat.dispose();
  }, [textures, bodyMat, edgeMat]);

  useFrame(() => {
    const p = progressRef.current;
    const arrive = ramp(p, 0.28, 0.375);
    const merge = ramp(p, 0.4, 0.48);
    const gone = ramp(p, 0.46, 0.52);

    bodyMat.opacity = arrive * 0.92 * (1 - gone);
    edgeMat.opacity = arrive * 0.5 * (1 - gone);

    refs.current.forEach((g, i) => {
      if (!g) return;
      const y = ((SPEAKER.length - 1) / 2 - i) * 0.78;
      const fromX = 4.6;
      const x = fromX * (1 - merge * 0.92);
      g.position.set(x, y * (1 - merge * 0.85), -merge * 0.3);
      g.scale.setScalar((0.85 + 0.15 * arrive) * (1 - 0.3 * merge));
      g.visible = bodyMat.opacity > 0.002;
    });
  });

  return (
    <group>
      {SPEAKER.map((f, i) => (
        <group key={f.key} ref={(el) => { refs.current[i] = el; }}>
          <mesh material={bodyMat}>
            <boxGeometry args={[1.9, 0.62, 0.16]} />
          </mesh>
          <lineSegments material={edgeMat} geometry={getOutline(1.9, 0.62)} position={[0, 0, 0.082]} />
          <mesh position={[0, 0, 0.09]}>
            <planeGeometry args={[1.72, 0.86]} />
            <meshBasicMaterial map={textures[i]} transparent depthWrite={false} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/**
 * The conditioned representation: one object that carries the text and speaker
 * information through the generator. This is the thing the camera follows.
 */
function Carrier({ progressRef, palette, carrierRef }) {
  const mat = useMemo(
    () => new THREE.MeshStandardMaterial({
      color: new THREE.Color(palette.accent),
      emissive: new THREE.Color(palette.accent),
      emissiveIntensity: 0.5,
      roughness: 0.35,
      metalness: 0.1,
      transparent: true,
      opacity: 0,
    }),
    [palette],
  );
  const edgeMat = useMemo(
    () => new THREE.LineBasicMaterial({ color: new THREE.Color(palette.ink), transparent: true, opacity: 0 }),
    [palette],
  );

  useEffect(() => () => { mat.dispose(); edgeMat.dispose(); }, [mat, edgeMat]);

  useFrame(() => {
    const p = progressRef.current;
    const form = ramp(p, 0.44, 0.52);
    // Travel from the conditioning point, through every encoder layer, into
    // the decoder, and stop where the acoustic representation forms.
    const travel = ramp(p, 0.53, 0.78);
    const z = THREE.MathUtils.lerp(0.6, ACOUSTIC_Z + 0.6, travel);
    const dissolve = ramp(p, 0.76, 0.83);

    mat.opacity = form * (1 - dissolve);
    mat.emissiveIntensity = 0.35 + 0.5 * form;
    edgeMat.opacity = form * 0.6 * (1 - dissolve);

    const g = carrierRef.current;
    if (!g) return;
    g.position.set(0, 0, z);
    const s = 1 - 0.25 * travel;
    g.scale.set(s, s, s);
    g.visible = mat.opacity > 0.002;
  });

  return (
    <group ref={carrierRef}>
      <mesh material={mat}>
        <boxGeometry args={[1.5, 0.75, 0.2]} />
      </mesh>
      <lineSegments material={edgeMat} geometry={getOutline(1.5, 0.75)} position={[0, 0, 0.105]} />
    </group>
  );
}

/**
 * Scroll 3: the generator. Six thin layers in depth plus a decoder block.
 *
 * Sparse on purpose. The point is the sequence and the depth, not a count of
 * units, so there are no neurons to miscount.
 */
function Generator({ progressRef, palette }) {
  const layerRefs = useRef([]);
  const slabMat = useMemo(
    () => new THREE.MeshStandardMaterial({
      color: new THREE.Color(palette.layer),
      roughness: 0.75,
      metalness: 0.0,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
    }),
    [palette],
  );
  const edgeMat = useMemo(
    () => new THREE.LineBasicMaterial({ color: new THREE.Color(palette.edge), transparent: true, opacity: 0 }),
    [palette],
  );
  const decoderMat = useMemo(
    () => new THREE.MeshStandardMaterial({
      color: new THREE.Color(palette.decoder),
      roughness: 0.5,
      metalness: 0.05,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
    }),
    [palette],
  );
  const plate = useMemo(
    () => plateTexture('Neural TTS Generator', 'illustrative architecture', palette.ink, palette.dim, palette.accent),
    [palette],
  );
  const decoderPlate = useMemo(
    () => plateTexture('Generative decoder', '', palette.ink, palette.dim, palette.accent),
    [palette],
  );
  const plateRef = useRef(null);
  const decoderPlateRef = useRef(null);

  const outline = useMemo(() => outlineGeometry(4.6, 2.6), []);

  useEffect(() => () => {
    slabMat.dispose();
    edgeMat.dispose();
    decoderMat.dispose();
    plate.dispose();
    decoderPlate.dispose();
    outline.dispose();
  }, [slabMat, edgeMat, decoderMat, plate, decoderPlate, outline]);

  useFrame((st) => {
    const p = progressRef.current;
    const on = band(p, 0.5, 0.84, 0.05);
    slabMat.opacity = on * 0.16;
    decoderMat.opacity = on * 0.3;
    edgeMat.opacity = on * 0.5;
    if (plateRef.current) plateRef.current.material.opacity = band(p, 0.5, 0.72, 0.04) * 0.95;
    if (decoderPlateRef.current) decoderPlateRef.current.material.opacity = band(p, 0.66, 0.84, 0.04) * 0.95;

    // A layer brightens as the carrier passes through it. Nothing pulses on a
    // timer; the highlight tracks the representation's actual position.
    const travel = ramp(p, 0.53, 0.78);
    const z = THREE.MathUtils.lerp(0.6, ACOUSTIC_Z + 0.6, travel);
    layerRefs.current.forEach((m, i) => {
      if (!m) return;
      const d = Math.abs(z - layerZ(i));
      const near = clamp01(1 - d / 1.5);
      m.material.opacity = on * (0.12 + 0.5 * near * near);
    });
  });

  return (
    <group>
      {Array.from({ length: LAYERS }, (_, i) => (
        <group key={i} position={[0, 0, layerZ(i)]}>
          <mesh ref={(el) => { layerRefs.current[i] = el; }} material={slabMat.clone()}>
            <planeGeometry args={[4.6, 2.6]} />
          </mesh>
          <lineSegments material={edgeMat} geometry={outline} />
        </group>
      ))}

      <group position={[0, 0, DECODER_Z]}>
        <mesh material={decoderMat}>
          <boxGeometry args={[3.4, 2.0, 0.5]} />
        </mesh>
        <lineSegments material={edgeMat} geometry={getOutline(3.4, 2.0)} position={[0, 0, 0.26]} />
        <mesh ref={decoderPlateRef} position={[0, 1.45, 0.26]}>
          <planeGeometry args={[2.6, 0.81]} />
          <meshBasicMaterial map={decoderPlate} transparent depthWrite={false} toneMapped={false} opacity={0} />
        </mesh>
      </group>

      <mesh ref={plateRef} position={[0, 1.95, layerZ(0) + 0.4]}>
        <planeGeometry args={[3.4, 1.06]} />
        <meshBasicMaterial map={plate} transparent depthWrite={false} toneMapped={false} opacity={0} />
      </mesh>
    </group>
  );
}

/**
 * Scroll 4: the acoustic representation, then the waveform.
 *
 * Both are measured from the same signal the play button uses, so the surface
 * and the curve are two views of one piece of data.
 */
function Acoustics({ progressRef, palette, spec, wave, playRef }) {
  const surfRef = useRef(null);
  const wireRef = useRef(null);
  const waveRef = useRef(null);
  const gridRef = useRef(null);

  const surfGeo = useMemo(() => spectrogramGeometry(spec), [spec]);
  const waveGeo = useMemo(() => waveformGeometry(wave), [wave]);
  const gridGeo = useMemo(() => gridGeometry(), []);

  const surfMat = useMemo(
    () => new THREE.MeshStandardMaterial({
      color: new THREE.Color(palette.surface),
      roughness: 0.6,
      metalness: 0.05,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
    }),
    [palette],
  );
  const wireMat = useMemo(
    () => new THREE.MeshBasicMaterial({
      color: new THREE.Color(palette.accent),
      wireframe: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }),
    [palette],
  );
  const waveMat = useMemo(
    () => new THREE.MeshBasicMaterial({
      color: new THREE.Color(palette.accent),
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }),
    [palette],
  );
  const gridMat = useMemo(
    () => new THREE.LineBasicMaterial({ color: new THREE.Color(palette.edge), transparent: true, opacity: 0 }),
    [palette],
  );

  useEffect(() => () => {
    surfGeo.dispose();
    waveGeo.dispose();
    gridGeo.dispose();
    surfMat.dispose();
    wireMat.dispose();
    waveMat.dispose();
    gridMat.dispose();
  }, [surfGeo, waveGeo, gridGeo, surfMat, wireMat, waveMat, gridMat]);

  useFrame((st) => {
    const p = progressRef.current;
    const form = ramp(p, 0.78, 0.86);
    // The frequency axis collapses and the surface becomes the signal.
    const collapse = ramp(p, 0.88, 0.96);

    surfMat.opacity = form * 0.92 * (1 - collapse);
    wireMat.opacity = form * 0.09 * (1 - collapse);
    gridMat.opacity = form * 0.35 * (1 - collapse * 0.7);
    waveMat.opacity = ramp(p, 0.9, 0.975) * 0.95;

    if (surfRef.current) {
      surfRef.current.visible = surfMat.opacity > 0.002;
      // Flatten toward the time axis rather than fading out in place.
      surfRef.current.scale.set(1, 1 - collapse * 0.94, 1 - collapse * 0.9);
    }
    if (wireRef.current) {
      wireRef.current.visible = wireMat.opacity > 0.002;
      wireRef.current.scale.copy(surfRef.current ? surfRef.current.scale : wireRef.current.scale);
    }
    if (gridRef.current) gridRef.current.visible = gridMat.opacity > 0.002;

    if (waveRef.current) {
      waveRef.current.visible = waveMat.opacity > 0.002;
      // During playback the curve swells at the playhead so the picture and
      // the sound are visibly the same object.
      const play = playRef?.current;
      const amp = play && play.playing ? 1 + 0.18 * Math.sin(st.clock.elapsedTime * 9) : 1;
      waveRef.current.scale.set(1, amp, amp);
    }
  });

  return (
    <group position={[0, -0.3, ACOUSTIC_Z]}>
      <lineSegments ref={gridRef} geometry={gridGeo} material={gridMat} position={[0, -0.02, 0]} />
      <mesh ref={surfRef} geometry={surfGeo} material={surfMat} />
      <mesh ref={wireRef} geometry={surfGeo} material={wireMat} />
      <mesh ref={waveRef} geometry={waveGeo} material={waveMat} position={[0, 0.42, 0]} />
    </group>
  );
}

/**
 * Projects a handful of 3D anchors to screen space each frame so DOM labels can
 * sit on the objects. Text stays real text: crisp at any resolution, selectable,
 * and readable by a screen reader.
 */
function LabelProjector({ progressRef, labelRefs, labels }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const v = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const p = progressRef.current;
    labels.forEach((l, i) => {
      const el = labelRefs.current[i];
      if (!el) return;
      const on = band(p, l.show[0], l.show[1], 0.03);
      if (on < 0.01) {
        if (el.style.opacity !== '0') {
          el.style.opacity = '0';
          el.style.visibility = 'hidden';
        }
        return;
      }
      const a = typeof l.at === 'function' ? l.at(p, v) : v.set(...l.at);
      v.copy(a).project(camera);
      if (v.z > 1) {
        el.style.opacity = '0';
        return;
      }
      const x = (v.x * 0.5 + 0.5) * size.width;
      const y = (-v.y * 0.5 + 0.5) * size.height;
      el.style.visibility = 'visible';
      el.style.opacity = String(on);
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    });
  });

  return null;
}

/** Anchors and copy for the in-scene annotations. */
export const LABELS = [
  { key: 'tok', text: 'Tokens', note: 'sub-word units', at: [0, -1.15, 0], show: [0.07, 0.16] },
  { key: 'vec', text: 'Vector representation', note: 'illustrative projection, 4 of d dimensions', at: [0, -1.35, 0], show: [0.17, 0.29] },
  { key: 'spk', text: 'Speaker conditioning', note: 'illustrative acoustic features, not a full embedding', at: [4.6, 2.1, 0], show: [0.3, 0.44] },
  { key: 'cond', text: 'Conditioned representation', note: 'text and speaker, combined', at: [0, -1.15, 0.6], show: [0.46, 0.55] },
  { key: 'enc', text: 'Transformer layers', note: `${LAYERS} layers, sequential in depth`, at: [-2.6, 1.5, layerZ(1)], show: [0.56, 0.7] },
  { key: 'dec', text: 'Generative decoder', note: 'predicts the acoustic representation', at: [2.2, -1.3, DECODER_Z], show: [0.68, 0.8] },
  { key: 'ac', text: 'Acoustic representation', note: 'X time, Z frequency, Y intensity', at: [0, 1.5, ACOUSTIC_Z], show: [0.8, 0.9] },
  { key: 'wav', text: 'Waveform', note: 'the signal a speaker reproduces', at: [0, 1.2, ACOUSTIC_Z], show: [0.91, 1.01] },
];

export function TTSScene({ progressRef, palette, spec, wave, labelRefs, playRef, reducedMotion }) {
  const carrierRef = useRef(null);
  const rootRef = useRef(null);

  // Idle motion only, and only when the reader is still. Nothing rotates.
  useFrame((st) => {
    if (!rootRef.current || reducedMotion) return;
    const t = st.clock.elapsedTime;
    rootRef.current.position.y = Math.sin(t * 0.32) * 0.022;
  });

  return (
    <group ref={rootRef}>
      <WordCards progressRef={progressRef} palette={palette} />
      <SpeakerConditioning progressRef={progressRef} palette={palette} />
      <Carrier progressRef={progressRef} palette={palette} carrierRef={carrierRef} />
      <Generator progressRef={progressRef} palette={palette} />
      <Acoustics
        progressRef={progressRef}
        palette={palette}
        spec={spec}
        wave={wave}
        playRef={playRef}
      />
      <LabelProjector progressRef={progressRef} labelRefs={labelRefs} labels={LABELS} />
    </group>
  );
}
