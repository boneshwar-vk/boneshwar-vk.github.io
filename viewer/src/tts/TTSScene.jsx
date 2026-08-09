import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { smootherstep } from '../anim.js';
import { CYCLES, LOOP_FROM, LOOP_TO, TOKEN_LABELS, loopState, returnPath } from './loop.js';
import {
  EMIT_Y,
  SEQ_Y,
  STACK,
  STACK_D,
  STACK_H,
  STACK_W,
  TOKEN_D,
  TOKEN_H,
  TOKEN_W,
  WORDS,
  arrowGeometry,
  glyphFace,
  outlineGeometry,
  pathTube,
  plateFace,
  seqX,
  speakerFace,
  tokenFace,
  tokenRow,
  vectorFor,
} from './scene.js';

const ramp = (p, a, b) => smootherstep((p - a) / Math.max(1e-6, b - a));
const band = (p, a, b, f = 0.035) => ramp(p, a, a + f) * (1 - ramp(p, b - f, b));

/** Shared outline geometries, keyed by size. Not a hook. */
const outlines = new Map();
function outline(w, h) {
  const k = `${w}x${h}`;
  if (!outlines.has(k)) outlines.set(k, outlineGeometry(w, h));
  return outlines.get(k);
}

/** A labelled block: solid body, crisp edge, and a face texture. */
function Block({ w, h, d, color, edge, texture, opacity = 1, meshRef, faceRef, edgeRef }) {
  return (
    <group>
      <mesh ref={meshRef}>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial
          color={color}
          roughness={0.52}
          metalness={0.06}
          transparent
          opacity={opacity}
        />
      </mesh>
      <lineSegments ref={edgeRef} geometry={outline(w, h)} position={[0, 0, d / 2 + 0.002]}>
        <lineBasicMaterial color={edge} transparent opacity={opacity} />
      </lineSegments>
      {texture && (
        <mesh ref={faceRef} position={[0, 0, d / 2 + 0.006]}>
          <planeGeometry args={[w * 0.9, h * 0.9]} />
          <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}

/**
 * Scroll 1 and 2: the token blocks.
 *
 * They start as a row of words, gain their numbers, then gather into the single
 * block that represents the text side of the conditioned input.
 */
function TokenBlocks({ progressRef, palette }) {
  const faces = useMemo(
    () => WORDS.map((w, i) => tokenFace(w, vectorFor(i), palette)),
    [palette],
  );
  const groups = useRef([]);
  const bodies = useRef([]);
  const edges = useRef([]);
  const facesRef = useRef([]);

  useEffect(() => () => faces.forEach((t) => t.dispose()), [faces]);

  const rowTight = useMemo(() => tokenRow(WORDS.length, 1), []);
  const rowWide = useMemo(() => tokenRow(WORDS.length, 2.4), []);

  useFrame(() => {
    const p = progressRef.current;
    // The 2D sentence holds the frame first; the blocks take over from it.
    const intro = ramp(p, 0.025, 0.085);
    const separate = ramp(p, 0.08, 0.19);   // sentence opens into tokens
    const gather = ramp(p, 0.3, 0.4);       // tokens collapse into one block
    const visible = intro * (1 - ramp(p, 0.38, 0.44));

    groups.current.forEach((g, i) => {
      if (!g) return;
      const x = rowTight[i] + (rowWide[i] - rowTight[i]) * separate;
      // Gather toward the left, where the conditioned input forms.
      g.position.set(
        THREE.MathUtils.lerp(x, -2.35, gather),
        THREE.MathUtils.lerp(0, 0.75, gather),
        THREE.MathUtils.lerp(0, -0.02 * i, gather),
      );
      g.scale.setScalar(THREE.MathUtils.lerp(1, 0.42, gather));
      g.visible = visible > 0.002;

      const o = visible;
      if (bodies.current[i]) bodies.current[i].material.opacity = o * 0.95;
      if (edges.current[i]) edges.current[i].material.opacity = o * 0.65;
      if (facesRef.current[i]) facesRef.current[i].material.opacity = o * (1 - gather * 0.85);
    });
  });

  return (
    <group>
      {WORDS.map((w, i) => (
        <group key={w + i} ref={(el) => { groups.current[i] = el; }}>
          <Block
            w={TOKEN_W}
            h={TOKEN_H}
            d={TOKEN_D}
            color={palette.text}
            edge={palette.textEdge}
            texture={faces[i]}
            meshRef={(el) => { bodies.current[i] = el; }}
            edgeRef={(el) => { edges.current[i] = el; }}
            faceRef={(el) => { facesRef.current[i] = el; }}
          />
        </group>
      ))}
    </group>
  );
}

/**
 * Scroll 2: one speaker block arrives from the right and merges with the text
 * side. Its colour is deliberately distinct so the merge is legible.
 */
function SpeakerBlock({ progressRef, palette }) {
  const face = useMemo(() => speakerFace(palette), [palette]);
  const group = useRef(null);
  const body = useRef(null);
  const edge = useRef(null);
  const faceRef = useRef(null);

  useEffect(() => () => face.dispose(), [face]);

  useFrame(() => {
    const p = progressRef.current;
    const arrive = ramp(p, 0.24, 0.32);
    const merge = ramp(p, 0.34, 0.42);
    const gone = ramp(p, 0.4, 0.45);
    const o = arrive * (1 - gone);

    const g = group.current;
    if (g) {
      g.position.set(
        THREE.MathUtils.lerp(3.5, -2.35, merge),
        THREE.MathUtils.lerp(-0.1, -0.75, merge),
        0,
      );
      g.scale.setScalar(THREE.MathUtils.lerp(1, 0.42, merge));
      g.visible = o > 0.002;
    }
    if (body.current) body.current.material.opacity = o * 0.95;
    if (edge.current) edge.current.material.opacity = o * 0.7;
    if (faceRef.current) faceRef.current.material.opacity = o * (1 - merge * 0.85);
  });

  return (
    <group ref={group}>
      <Block
        w={1.75}
        h={1.75}
        d={0.34}
        color={palette.speaker}
        edge={palette.speakerEdge}
        texture={face}
        meshRef={(el) => { body.current = el; }}
        edgeRef={(el) => { edge.current = el; }}
        faceRef={(el) => { faceRef.current = el; }}
      />
    </group>
  );
}

/**
 * The conditioned input. Its colour sits between the text and speaker hues,
 * which is the whole point: it is both.
 */
function ConditionedInput({ progressRef, palette, headRef }) {
  const face = useMemo(
    () => plateFace('CONDITIONED INPUT', 'text + speaker', palette, { w: 600, h: 200, size: 38 }),
    [palette],
  );
  const group = useRef(null);
  const body = useRef(null);
  const edge = useRef(null);
  const faceRef = useRef(null);

  useEffect(() => () => face.dispose(), [face]);

  useFrame(() => {
    const p = progressRef.current;
    const form = ramp(p, 0.4, 0.46);
    const s = loopState(p);
    // Once the loop starts it takes its place at the head of the sequence row.
    const toSeq = ramp(p, 0.44, 0.5);
    const fade = ramp(p, 0.86, 0.93);
    const o = form * (1 - fade);

    const g = group.current;
    if (g) {
      g.position.set(
        THREE.MathUtils.lerp(-2.35, seqX(0) - 0.55, toSeq),
        THREE.MathUtils.lerp(0, SEQ_Y, toSeq),
        0,
      );
      g.scale.setScalar(THREE.MathUtils.lerp(1, 0.62, toSeq));
      g.visible = o > 0.002;
      // Dips with the sequence as it enters the stack.
      g.position.y -= s.active ? s.descend * (1 - s.settle) * 0.28 : 0;
    }
    if (body.current) body.current.material.opacity = o * 0.95;
    if (edge.current) edge.current.material.opacity = o * 0.75;
    if (faceRef.current) faceRef.current.material.opacity = o;
    if (headRef) headRef.current = g;
  });

  return (
    <group ref={group}>
      <Block
        w={2.6}
        h={0.98}
        d={0.34}
        color={palette.conditioned}
        edge={palette.conditionedEdge}
        texture={face}
        meshRef={(el) => { body.current = el; }}
        edgeRef={(el) => { edge.current = el; }}
        faceRef={(el) => { faceRef.current = el; }}
      />
    </group>
  );
}

/**
 * Scroll 3: three transformer layers and the loop around them.
 *
 * The camera never goes inside. What matters is the circuit: the sequence drops
 * in at the top, one token comes out at the bottom, travels back around, and
 * joins the sequence, which is then one token longer.
 */
function Transformer({ progressRef, palette }) {
  const layerFaces = useMemo(
    () => STACK.map((_, i) => plateFace(`Transformer layer ${i + 1}`, '', palette, {
      w: 600, h: 150, size: 34, titleColor: palette.ink,
    })),
    [palette],
  );
  const bodies = useRef([]);
  const edges = useRef([]);
  const faces = useRef([]);
  const arrowRefs = useRef([]);

  const arrow = useMemo(() => arrowGeometry(0.42), []);

  useEffect(() => () => {
    layerFaces.forEach((t) => t.dispose());
    arrow.dispose();
  }, [layerFaces, arrow]);

  useFrame(() => {
    const p = progressRef.current;
    const on = band(p, 0.42, 0.88, 0.04);
    const s = loopState(p);

    STACK.forEach((y, i) => {
      // Each layer lights briefly as the sequence passes through it.
      const at = (i + 0.5) / STACK.length;
      const near = 1 - Math.min(1, Math.abs(s.descend - at) * 3.2);
      const lit = s.active ? Math.max(0, near) : 0;
      if (bodies.current[i]) {
        bodies.current[i].material.opacity = on * (0.5 + 0.35 * lit);
        bodies.current[i].material.emissiveIntensity = 0.05 + 0.35 * lit;
      }
      if (edges.current[i]) edges.current[i].material.opacity = on * (0.5 + 0.5 * lit);
      if (faces.current[i]) faces.current[i].material.opacity = on * 0.9;
    });
    arrowRefs.current.forEach((a) => {
      if (a) a.material.opacity = on * 0.4;
    });
  });

  return (
    <group>
      {STACK.map((y, i) => (
        <group key={y} position={[0, y, 0]}>
          <mesh ref={(el) => { bodies.current[i] = el; }}>
            <boxGeometry args={[STACK_W, STACK_H, STACK_D]} />
            <meshStandardMaterial
              color={palette.stack}
              emissive={palette.stackGlow}
              emissiveIntensity={0.05}
              roughness={0.6}
              metalness={0.04}
              transparent
              opacity={0}
            />
          </mesh>
          <lineSegments
            ref={(el) => { edges.current[i] = el; }}
            geometry={outline(STACK_W, STACK_H)}
            position={[0, 0, STACK_D / 2 + 0.002]}
          >
            <lineBasicMaterial color={palette.stackEdge} transparent opacity={0} />
          </lineSegments>
          <mesh ref={(el) => { faces.current[i] = el; }} position={[0, 0, STACK_D / 2 + 0.006]}>
            <planeGeometry args={[STACK_W * 0.86, STACK_W * 0.86 * 0.25]} />
            <meshBasicMaterial map={layerFaces[i]} transparent depthWrite={false} toneMapped={false} />
          </mesh>
          {i < STACK.length - 1 && (
            <lineSegments
              ref={(el) => { arrowRefs.current[i] = el; }}
              geometry={arrow}
              position={[0, -STACK_H / 2 - 0.02, STACK_D / 2]}
            >
              <lineBasicMaterial color={palette.stackEdge} transparent opacity={0} />
            </lineSegments>
          )}
        </group>
      ))}
    </group>
  );
}

/**
 * The generated tokens and the path they take back to the sequence.
 *
 * Token i is emitted below the stack on cycle i, follows the return curve, and
 * then stays put at position i of the sequence for the rest of the piece.
 */
function Generated({ progressRef, palette }) {
  const labels = useMemo(
    () => TOKEN_LABELS.map((l) => glyphFace(l, palette.onAccent)),
    [palette],
  );
  const groups = useRef([]);
  const bodies = useRef([]);
  const edges = useRef([]);
  const faces = useRef([]);

  const { geometry: pathGeo, curve } = useMemo(
    () => pathTube(returnPath(seqX(CYCLES))),
    [],
  );
  const pathRef = useRef(null);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => () => {
    labels.forEach((t) => t.dispose());
    pathGeo.dispose();
  }, [labels, pathGeo]);

  useFrame(() => {
    const p = progressRef.current;
    const s = loopState(p);
    const on = band(p, 0.44, 0.9, 0.04);
    if (pathRef.current) pathRef.current.material.opacity = on * 0.3;

    TOKEN_LABELS.forEach((_, i) => {
      const g = groups.current[i];
      if (!g) return;

      let x = seqX(1 + i);
      let y = SEQ_Y;
      let z = 0;
      let scale = 1;
      let o = 0;

      if (i < s.cycle || (!s.active && p > LOOP_TO)) {
        // Already part of the sequence.
        o = 1;
      } else if (i === s.cycle && s.active) {
        if (s.emit <= 0.001) {
          o = 0;
        } else if (s.ret <= 0.001) {
          // Emerging below the stack.
          x = 0;
          y = EMIT_Y;
          o = s.emit;
          scale = 0.7 + 0.3 * s.emit;
        } else if (s.settle <= 0.001) {
          // Travelling the return path.
          curve.getPointAt(Math.min(0.999, s.ret), tmp);
          x = tmp.x;
          y = tmp.y;
          z = tmp.z;
          o = 1;
        } else {
          // Settling into its slot.
          curve.getPointAt(0.999, tmp);
          x = THREE.MathUtils.lerp(tmp.x, seqX(1 + i), s.settle);
          y = THREE.MathUtils.lerp(tmp.y, SEQ_Y, s.settle);
          z = THREE.MathUtils.lerp(tmp.z, 0, s.settle);
          o = 1;
        }
      }

      // Sequence members dip with the rest as they enter the stack.
      if (o > 0 && i < s.cycle && s.active) y -= s.descend * (1 - s.settle) * 0.28;

      g.position.set(x, y, z);
      g.scale.setScalar(scale * 0.7);
      g.visible = o * on > 0.002;
      const a = o * on;
      if (bodies.current[i]) bodies.current[i].material.opacity = a * 0.98;
      if (edges.current[i]) edges.current[i].material.opacity = a;
      if (faces.current[i]) faces.current[i].material.opacity = a;
    });
  });

  return (
    <group>
      <mesh ref={pathRef} geometry={pathGeo}>
        <meshBasicMaterial color={palette.accent} transparent opacity={0} depthWrite={false} />
      </mesh>
      {TOKEN_LABELS.map((l, i) => (
        <group key={l} ref={(el) => { groups.current[i] = el; }}>
          <Block
            w={0.92}
            h={0.92}
            d={0.32}
            color={palette.accent}
            edge={palette.accentEdge}
            texture={labels[i]}
            meshRef={(el) => { bodies.current[i] = el; }}
            edgeRef={(el) => { edges.current[i] = el; }}
            faceRef={(el) => { faces.current[i] = el; }}
          />
        </group>
      ))}
    </group>
  );
}

/**
 * Scroll 4: the finished sequence becomes one acoustic block, which then hands
 * off to the 2D waveform drawn over the canvas.
 */
function AcousticBlock({ progressRef, palette }) {
  const face = useMemo(
    () => plateFace('ACOUSTIC REPRESENTATION', '', palette, { w: 700, h: 160, size: 36 }),
    [palette],
  );
  const group = useRef(null);
  const body = useRef(null);
  const edge = useRef(null);
  const faceRef = useRef(null);

  useEffect(() => () => face.dispose(), [face]);

  useFrame(() => {
    const p = progressRef.current;
    const form = ramp(p, 0.86, 0.92);
    const gone = ramp(p, 0.95, 1.0);
    const o = form * (1 - gone);
    const g = group.current;
    if (g) {
      g.position.set(0, THREE.MathUtils.lerp(SEQ_Y, 0.4, form), 0);
      g.scale.setScalar(THREE.MathUtils.lerp(0.6, 1, form));
      g.visible = o > 0.002;
    }
    if (body.current) body.current.material.opacity = o * 0.95;
    if (edge.current) edge.current.material.opacity = o * 0.8;
    if (faceRef.current) faceRef.current.material.opacity = o;
  });

  return (
    <group ref={group}>
      <Block
        w={3.6}
        h={0.86}
        d={0.34}
        color={palette.acoustic}
        edge={palette.accentEdge}
        texture={face}
        meshRef={(el) => { body.current = el; }}
        edgeRef={(el) => { edge.current = el; }}
        faceRef={(el) => { faceRef.current = el; }}
      />
    </group>
  );
}

/** Positions DOM labels from 3D anchors so the type stays 2D and crisp. */
function LabelProjector({ progressRef, labelRefs, labels }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const v = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const p = progressRef.current;
    labels.forEach((l, i) => {
      const el = labelRefs.current[i];
      if (!el) return;
      const on = band(p, l.show[0], l.show[1], 0.025);
      if (on < 0.01) {
        if (el.style.opacity !== '0') {
          el.style.opacity = '0';
          el.style.visibility = 'hidden';
        }
        return;
      }
      v.set(l.at[0], l.at[1], l.at[2]).project(camera);
      const x = (v.x * 0.5 + 0.5) * size.width;
      const y = (-v.y * 0.5 + 0.5) * size.height;
      el.style.visibility = 'visible';
      el.style.opacity = String(on);
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    });
  });

  return null;
}

export const LABELS = [
  { key: 'tok', text: 'Tokens', note: 'illustrative values', at: [0, -1.35, 0], show: [0.08, 0.3] },
  { key: 'what', text: 'What is said', note: '', at: [-2.35, 1.6, 0], show: [0.3, 0.42] },
  { key: 'how', text: 'How it sounds', note: '', at: [3.5, 1.35, 0], show: [0.26, 0.36] },
  { key: 'seq', text: 'Input sequence', note: 'grows every step', at: [-2.6, 3.35, 0], show: [0.46, 0.86] },
  { key: 'gen', text: 'Generated token', note: '', at: [0, -3.25, 0], show: [0.47, 0.85] },
  { key: 'back', text: 'Fed back in', note: '', at: [4.1, 0.1, 0], show: [0.5, 0.85] },
];

/**
 * Debug-only: reports what is actually on screen at the current progress.
 * Rendering correctly is not the same as compiling, and a scene that throws or
 * silently leaves everything at zero opacity looks identical to a blank canvas.
 */
function Probe({ progressRef, root }) {
  const three = useThree();
  useEffect(() => {
    window.__ttsProbe = () => {
      const out = [];
      root.current?.traverse((o) => {
        if (!o.isMesh && !o.isLineSegments) return;
        const m = o.material;
        if (!m) return;
        const op = m.opacity ?? 1;
        if (!o.visible || op < 0.02) return;
        const wp = new THREE.Vector3();
        o.getWorldPosition(wp);
        out.push({
          type: o.isMesh ? 'mesh' : 'line',
          op: +op.toFixed(2),
          at: [+wp.x.toFixed(2), +wp.y.toFixed(2), +wp.z.toFixed(2)],
        });
      });
      return {
        progress: +progressRef.current.toFixed(3),
        visible: out.length,
        calls: three.gl.info.render.calls,
        tris: three.gl.info.render.triangles,
        objects: out,
      };
    };
  }, [three, root, progressRef]);
  return null;
}

export function TTSScene({ progressRef, palette, labelRefs, reducedMotion, debug }) {
  const root = useRef(null);
  const headRef = useRef(null);

  useFrame((st) => {
    if (!root.current || reducedMotion) return;
    // Idle motion only: a slow, small breath. Nothing rotates.
    root.current.position.y = Math.sin(st.clock.elapsedTime * 0.28) * 0.018;
  });

  return (
    <group ref={root}>
      {debug && <Probe progressRef={progressRef} root={root} />}
      <TokenBlocks progressRef={progressRef} palette={palette} />
      <SpeakerBlock progressRef={progressRef} palette={palette} />
      <ConditionedInput progressRef={progressRef} palette={palette} headRef={headRef} />
      <Transformer progressRef={progressRef} palette={palette} />
      <Generated progressRef={progressRef} palette={palette} />
      <AcousticBlock progressRef={progressRef} palette={palette} />
      <LabelProjector progressRef={progressRef} labelRefs={labelRefs} labels={LABELS} />
    </group>
  );
}
