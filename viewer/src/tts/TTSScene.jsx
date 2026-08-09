import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { smootherstep } from '../anim.js';
import { TOKEN_LABELS, buildReturnPath, loopState, pathAt, pulseTrack } from './loop.js';
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
  glyphFace,
  outlineGeometry,
  plateFace,
  seqX,
  speakerFace,
  tokenFace,
  tokenRow,
  vectorFor,
} from './scene.js';

const ramp = (p, a, b) => smootherstep((p - a) / Math.max(1e-6, b - a));
const band = (p, a, b, f = 0.035) => ramp(p, a, a + f) * (1 - ramp(p, b - f, b));
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Where the pulse enters the stack. */
const STACK_TOP_Y = STACK[0] + STACK_H / 2 + 0.55;

/**
 * Fade for solid bodies.
 *
 * Transparent boxes with depth writes punch rectangular holes in one another
 * and show their own back faces as offset ghosts, which is exactly the artefact
 * in the screenshots. The rule: fully opaque whenever possible, and while
 * actually fading, no depth writes so nothing can occlude-clip a neighbour.
 */
function fadeBody(mesh, o) {
  if (!mesh) return;
  const m = mesh.material;
  const solid = o >= 0.97;
  m.opacity = solid ? 1 : o;
  m.transparent = !solid;
  m.depthWrite = solid;
  mesh.visible = o > 0.004;
}

/** Fade for overlays that stay transparent (edges, face textures). */
function fadeOverlay(mesh, o) {
  if (!mesh) return;
  mesh.material.opacity = o;
  mesh.visible = o > 0.004;
}

/** Shared outline geometries, keyed by size. Not a hook. */
const outlines = new Map();
function outline(w, h) {
  const k = `${w}x${h}`;
  if (!outlines.has(k)) outlines.set(k, outlineGeometry(w, h));
  return outlines.get(k);
}

/**
 * Scroll 1 and 2: the token blocks. A row of words that gains numbers, then
 * gathers into the text side of the conditioned input.
 */
function TokenBlocks({ progressRef, palette }) {
  const faces = useMemo(
    () => WORDS.map((w, i) => tokenFace(w, vectorFor(i), palette)),
    [palette],
  );
  const groups = useRef([]);
  const bodies = useRef([]);
  const edges = useRef([]);
  const faceMeshes = useRef([]);

  useEffect(() => () => faces.forEach((t) => t.dispose()), [faces]);

  const rowTight = useMemo(() => tokenRow(WORDS.length, 1), []);
  const rowWide = useMemo(() => tokenRow(WORDS.length, 2.4), []);

  useFrame(() => {
    const p = progressRef.current;
    const intro = ramp(p, 0.025, 0.085);
    const separate = ramp(p, 0.08, 0.19);
    const gather = ramp(p, 0.3, 0.4);
    const o = intro * (1 - ramp(p, 0.38, 0.44));

    groups.current.forEach((g, i) => {
      if (!g) return;
      const x = rowTight[i] + (rowWide[i] - rowTight[i]) * separate;
      g.position.set(
        THREE.MathUtils.lerp(x, -2.35, gather),
        THREE.MathUtils.lerp(0, 0.75, gather),
        // Fan the depth slightly DURING gather only, so stacking order is
        // deterministic while blocks overlap and flat the rest of the time.
        -0.05 * i * gather,
      );
      g.scale.setScalar(THREE.MathUtils.lerp(1, 0.4, gather));
      g.visible = o > 0.004;
      fadeBody(bodies.current[i], o);
      fadeOverlay(edges.current[i], o * 0.7);
      fadeOverlay(faceMeshes.current[i], o * (1 - gather));
    });
  });

  return (
    <group>
      {WORDS.map((w, i) => (
        <group key={w + i} ref={(el) => { groups.current[i] = el; }}>
          <mesh ref={(el) => { bodies.current[i] = el; }} renderOrder={1}>
            <boxGeometry args={[TOKEN_W, TOKEN_H, TOKEN_D]} />
            <meshStandardMaterial color={palette.text} roughness={0.55} metalness={0.05} />
          </mesh>
          <lineSegments
            ref={(el) => { edges.current[i] = el; }}
            geometry={outline(TOKEN_W, TOKEN_H)}
            position={[0, 0, TOKEN_D / 2 + 0.004]}
            renderOrder={6}
          >
            <lineBasicMaterial color={palette.textEdge} transparent depthWrite={false} />
          </lineSegments>
          <mesh
            ref={(el) => { faceMeshes.current[i] = el; }}
            position={[0, 0, TOKEN_D / 2 + 0.008]}
            renderOrder={7}
          >
            <planeGeometry args={[TOKEN_W * 0.94, TOKEN_H * 0.94]} />
            <meshBasicMaterial map={faces[i]} transparent depthWrite={false} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Scroll 2: the single speaker block, arriving from the right. */
function SpeakerBlock({ progressRef, palette }) {
  const face = useMemo(() => speakerFace(palette), [palette]);
  const group = useRef(null);
  const body = useRef(null);
  const edge = useRef(null);
  const faceMesh = useRef(null);

  useEffect(() => () => face.dispose(), [face]);

  useFrame(() => {
    const p = progressRef.current;
    const arrive = ramp(p, 0.24, 0.32);
    const merge = ramp(p, 0.34, 0.42);
    const o = arrive * (1 - ramp(p, 0.4, 0.45));

    const g = group.current;
    if (g) {
      g.position.set(
        THREE.MathUtils.lerp(3.6, -2.35, merge),
        THREE.MathUtils.lerp(-0.1, 0.75, merge),
        -0.4 * merge,
      );
      g.scale.setScalar(THREE.MathUtils.lerp(1, 0.4, merge));
      g.visible = o > 0.004;
    }
    fadeBody(body.current, o);
    fadeOverlay(edge.current, o * 0.75);
    fadeOverlay(faceMesh.current, o * (1 - merge));
  });

  return (
    <group ref={group}>
      <mesh ref={body} renderOrder={1}>
        <boxGeometry args={[1.75, 1.75, 0.34]} />
        <meshStandardMaterial color={palette.speaker} roughness={0.5} metalness={0.05} />
      </mesh>
      <lineSegments geometry={outline(1.75, 1.75)} position={[0, 0, 0.175]} ref={edge} renderOrder={6}>
        <lineBasicMaterial color={palette.speakerEdge} transparent depthWrite={false} />
      </lineSegments>
      <mesh ref={faceMesh} position={[0, 0, 0.18]} renderOrder={7}>
        <planeGeometry args={[1.6, 1.6]} />
        <meshBasicMaterial map={face} transparent depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

/**
 * The conditioned input. Forms where text and speaker met, takes its place at
 * the head of the input sequence, and stays there for the whole loop.
 */
function ConditionedInput({ progressRef, palette }) {
  const face = useMemo(
    () => plateFace('CONDITIONED INPUT', 'text + speaker', palette, { w: 620, h: 210, size: 40 }),
    [palette],
  );
  const group = useRef(null);
  const body = useRef(null);
  const edge = useRef(null);
  const faceMesh = useRef(null);

  useEffect(() => () => face.dispose(), [face]);

  useFrame(() => {
    const p = progressRef.current;
    const form = ramp(p, 0.4, 0.46);
    const toSeq = ramp(p, 0.44, 0.5);
    // Converges into the acoustic representation with the rest of the sequence.
    const converge = ramp(p, 0.845, 0.9);
    const o = form * (1 - converge);

    const g = group.current;
    if (g) {
      const x = THREE.MathUtils.lerp(-2.35, seqX(0) - 0.62, toSeq);
      const y = THREE.MathUtils.lerp(0.75, SEQ_Y, toSeq);
      g.position.set(
        THREE.MathUtils.lerp(x, 0, converge),
        THREE.MathUtils.lerp(y, 0.5, converge),
        0,
      );
      g.scale.setScalar(THREE.MathUtils.lerp(1, 0.62, toSeq) * (1 - 0.35 * converge));
      g.visible = o > 0.004;
    }
    fadeBody(body.current, o);
    fadeOverlay(edge.current, o * 0.8);
    fadeOverlay(faceMesh.current, o);
  });

  return (
    <group ref={group}>
      <mesh ref={body} renderOrder={1}>
        <boxGeometry args={[2.6, 0.98, 0.34]} />
        <meshStandardMaterial color={palette.conditioned} roughness={0.5} metalness={0.05} />
      </mesh>
      <lineSegments geometry={outline(2.6, 0.98)} position={[0, 0, 0.175]} ref={edge} renderOrder={6}>
        <lineBasicMaterial color={palette.conditionedEdge} transparent depthWrite={false} />
      </lineSegments>
      <mesh ref={faceMesh} position={[0, 0, 0.18]} renderOrder={7}>
        <planeGeometry args={[2.4, 0.81]} />
        <meshBasicMaterial map={face} transparent depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

/**
 * Scroll 3: the autoregressive circuit, in one component so every part reads
 * the same clock.
 *
 * Each cycle: a pulse representing the CURRENT INPUT SEQUENCE slides from the
 * row to the top of the stack and travels down THROUGH every layer, lighting
 * each one as it passes. Only when it has come out of the bottom does the next
 * token appear, and that token follows the return wire back up and joins the
 * sequence. Nothing skips the transformer.
 */
function Autoregression({ progressRef, palette }) {
  const layerFaces = useMemo(
    () => STACK.map((_, i) => plateFace(`Transformer layer ${i + 1}`, '', palette, {
      w: 620, h: 130, size: 36, titleColor: palette.ink,
    })),
    [palette],
  );
  const glyphs = useMemo(
    () => TOKEN_LABELS.map((l) => glyphFace(l, palette.onAccent)),
    [palette],
  );

  const layerBodies = useRef([]);
  const layerEdges = useRef([]);
  const layerFaceMeshes = useRef([]);

  const pulseGroup = useRef(null);
  const pulseBody = useRef(null);
  const pulseEdge = useRef(null);

  const tokenGroups = useRef([]);
  const tokenBodies = useRef([]);
  const tokenEdges = useRef([]);
  const tokenFaceMeshes = useRef([]);

  const wireRef = useRef(null);

  // One fixed schematic trace. The wire geometry and every token sample the
  // same polyline, and each token simply stops where the top run crosses its
  // own slot, so the feedback line never changes shape.
  const path = useMemo(
    () => buildReturnPath({ emitY: EMIT_Y, seqY: SEQ_Y, xEnd: seqX(1) }),
    [],
  );
  const wire = useMemo(() => {
    class Trace extends THREE.Curve {
      getPoint(t, target = new THREE.Vector3()) {
        const q = pathAt(path, t);
        return target.set(q[0], q[1], q[2]);
      }
    }
    return new THREE.TubeGeometry(new Trace(), 260, 0.016, 6, false);
  }, [path]);
  const stops = useMemo(
    () => TOKEN_LABELS.map((_, i) => path.stopAt(seqX(1 + i))),
    [path],
  );
  const tmp = useMemo(() => [0, 0, 0], []);

  useEffect(() => () => {
    layerFaces.forEach((t) => t.dispose());
    glyphs.forEach((t) => t.dispose());
    wire.dispose();
  }, [layerFaces, glyphs, wire]);

  useFrame(() => {
    const p = progressRef.current;
    const s = loopState(p);
    const stackOn = band(p, 0.42, 0.88, 0.04);
    const wireOn = band(p, 0.46, 0.86, 0.04);

    fadeOverlay(wireRef.current, wireOn * 0.32);

    // ---- the pulse: the input sequence passing through the stack ----------
    const headX = seqX(Math.max(0, s.sequence - 0.5));
    const t = pulseTrack(s.enter, headX, STACK_TOP_Y, EMIT_Y);
    const pulseAlive = s.active && s.enter > 0.02 && s.emit < 0.5;
    const pulseO = pulseAlive ? Math.min(1, s.enter / 0.08) * (1 - s.emit) : 0;
    if (pulseGroup.current) {
      // Rides down the FRONT face of the stack so the descent is visible the
      // whole way; the layers lighting in sequence carry the "through" reading.
      pulseGroup.current.position.set(t.x, t.y, STACK_D / 2 + 0.15);
      pulseGroup.current.visible = pulseO > 0.004;
    }
    fadeBody(pulseBody.current, pulseO * 0.96);
    fadeOverlay(pulseEdge.current, pulseO * 0.85);

    // ---- layers light while the pulse is inside them ----------------------
    STACK.forEach((ly, i) => {
      const inside = pulseAlive ? clamp01(1 - Math.abs(t.y - ly) / 1.0) : 0;
      const bodyMesh = layerBodies.current[i];
      if (bodyMesh) {
        fadeBody(bodyMesh, stackOn);
        bodyMesh.material.emissiveIntensity = 0.04 + 0.5 * inside;
      }
      fadeOverlay(layerEdges.current[i], stackOn * (0.45 + 0.55 * inside));
      fadeOverlay(layerFaceMeshes.current[i], stackOn * 0.92);
    });

    // ---- generated tokens -------------------------------------------------
    const converge = ramp(p, 0.845, 0.9);
    TOKEN_LABELS.forEach((_, i) => {
      const g = tokenGroups.current[i];
      if (!g) return;

      let x = seqX(1 + i);
      let y = SEQ_Y;
      let z = 0;
      let o = 0;
      let scale = 0.62;

      const doneAll = p >= 0.84;

      if (i < s.completed || doneAll) {
        o = 1;
      } else if (i === s.cycle && s.active) {
        if (s.emit > 0.001 && s.ret <= 0.001) {
          // Emerging exactly where the pulse arrived, then easing onto the
          // wire's plane as it grows to full size.
          x = 0;
          y = EMIT_Y;
          z = (STACK_D / 2 + 0.15) * (1 - s.emit);
          o = s.emit;
          scale = 0.62 * (0.7 + 0.3 * s.emit);
        } else if (s.ret > 0.001) {
          // Ride the fixed trace and stop where it crosses this token's slot;
          // arrival IS the slot, so settling needs no extra move.
          pathAt(path, Math.min(1, s.ret) * stops[i], tmp);
          x = tmp[0]; y = tmp[1]; z = tmp[2];
          o = 1;
        }
      }

      // Settled tokens converge into the acoustic representation at the end.
      if (o > 0 && converge > 0 && (i < s.completed || doneAll)) {
        x = THREE.MathUtils.lerp(x, 0, converge);
        y = THREE.MathUtils.lerp(y, 0.5, converge);
        scale *= 1 - 0.4 * converge;
        o *= 1 - converge;
      }

      g.position.set(x, y, z);
      g.scale.setScalar(scale);
      g.visible = o > 0.004;
      fadeBody(tokenBodies.current[i], o);
      fadeOverlay(tokenEdges.current[i], o);
      fadeOverlay(tokenFaceMeshes.current[i], o);
    });
  });

  return (
    <group>
      {STACK.map((y, i) => (
        <group key={y} position={[0, y, 0]}>
          <mesh ref={(el) => { layerBodies.current[i] = el; }} renderOrder={1}>
            <boxGeometry args={[STACK_W, STACK_H, STACK_D]} />
            <meshStandardMaterial
              color={palette.stack}
              emissive={palette.stackGlow}
              emissiveIntensity={0.04}
              roughness={0.6}
              metalness={0.04}
            />
          </mesh>
          <lineSegments
            ref={(el) => { layerEdges.current[i] = el; }}
            geometry={outline(STACK_W, STACK_H)}
            position={[0, 0, STACK_D / 2 + 0.004]}
            renderOrder={6}
          >
            <lineBasicMaterial color={palette.stackEdge} transparent depthWrite={false} />
          </lineSegments>
          <mesh
            ref={(el) => { layerFaceMeshes.current[i] = el; }}
            position={[0, 0, STACK_D / 2 + 0.008]}
            renderOrder={7}
          >
            <planeGeometry args={[STACK_W * 0.84, STACK_W * 0.84 * 0.21]} />
            <meshBasicMaterial map={layerFaces[i]} transparent depthWrite={false} toneMapped={false} />
          </mesh>
        </group>
      ))}

      <mesh ref={wireRef} geometry={wire} renderOrder={0}>
        <meshBasicMaterial color={palette.accent} transparent opacity={0} depthWrite={false} />
      </mesh>

      <group ref={pulseGroup}>
        <mesh ref={pulseBody} renderOrder={1}>
          <boxGeometry args={[1.15, 0.5, 0.26]} />
          <meshStandardMaterial
            color={palette.conditioned}
            emissive={palette.conditionedEdge}
            emissiveIntensity={0.25}
            roughness={0.45}
            metalness={0.05}
          />
        </mesh>
        <lineSegments geometry={outline(1.15, 0.5)} position={[0, 0, 0.135]} ref={pulseEdge} renderOrder={6}>
          <lineBasicMaterial color={palette.conditionedEdge} transparent depthWrite={false} />
        </lineSegments>
      </group>

      {TOKEN_LABELS.map((l, i) => (
        <group key={l} ref={(el) => { tokenGroups.current[i] = el; }}>
          <mesh ref={(el) => { tokenBodies.current[i] = el; }} renderOrder={1}>
            <boxGeometry args={[1.05, 1.05, 0.34]} />
            <meshStandardMaterial color={palette.accent} roughness={0.42} metalness={0.08} />
          </mesh>
          <lineSegments
            geometry={outline(1.05, 1.05)}
            position={[0, 0, 0.175]}
            ref={(el) => { tokenEdges.current[i] = el; }}
            renderOrder={6}
          >
            <lineBasicMaterial color={palette.accentEdge} transparent depthWrite={false} />
          </lineSegments>
          <mesh
            position={[0, 0, 0.18]}
            ref={(el) => { tokenFaceMeshes.current[i] = el; }}
            renderOrder={7}
          >
            <planeGeometry args={[0.86, 0.86]} />
            <meshBasicMaterial map={glyphs[i]} transparent depthWrite={false} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/**
 * Scroll 4: the converged sequence as one compact acoustic representation.
 * The waveform below it is strictly 2D and lives in the DOM.
 */
function AcousticBlock({ progressRef, palette }) {
  const face = useMemo(
    () => plateFace('ACOUSTIC REPRESENTATION', '', palette, { w: 640, h: 120, size: 34 }),
    [palette],
  );
  const group = useRef(null);
  const body = useRef(null);
  const edge = useRef(null);
  const faceMesh = useRef(null);

  useEffect(() => () => face.dispose(), [face]);

  useFrame(() => {
    const p = progressRef.current;
    const form = ramp(p, 0.885, 0.93);
    const g = group.current;
    if (g) {
      g.position.set(0, 0.5, 0);
      g.scale.setScalar(0.85 + 0.15 * form);
      g.visible = form > 0.004;
    }
    fadeBody(body.current, form);
    fadeOverlay(edge.current, form * 0.85);
    fadeOverlay(faceMesh.current, form);
  });

  return (
    <group ref={group}>
      <mesh ref={body} renderOrder={1}>
        <boxGeometry args={[2.9, 0.62, 0.3]} />
        <meshStandardMaterial color={palette.stack} roughness={0.5} metalness={0.06} />
      </mesh>
      <lineSegments geometry={outline(2.9, 0.62)} position={[0, 0, 0.155]} ref={edge} renderOrder={6}>
        <lineBasicMaterial color={palette.accentEdge} transparent depthWrite={false} />
      </lineSegments>
      <mesh ref={faceMesh} position={[0, 0, 0.16]} renderOrder={7}>
        <planeGeometry args={[2.6, 0.49]} />
        <meshBasicMaterial map={face} transparent depthWrite={false} toneMapped={false} />
      </mesh>
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
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translateX(-50%)`;
    });
  });

  return null;
}

export const LABELS = [
  { key: 'tok', text: 'Tokens', note: 'illustrative values', at: [0, -1.4, 0], show: [0.09, 0.29] },
  { key: 'what', text: 'What is said', note: '', at: [-2.35, 2.0, 0], show: [0.31, 0.42] },
  { key: 'how', text: 'How it sounds', note: '', at: [3.6, 1.4, 0], show: [0.25, 0.36] },
  { key: 'seq', text: 'Input sequence', note: 'grows every step', at: [-2.4, SEQ_Y + 0.85, 0], show: [0.46, 0.84] },
  { key: 'gen', text: 'Generated token', note: 'from the last layer', at: [0, EMIT_Y - 0.85, 0], show: [0.48, 0.84] },
  { key: 'back', text: 'Fed back in', note: '', at: [4.95, 0.0, 0], show: [0.5, 0.84] },
];

export function TTSScene({ progressRef, palette, labelRefs, reducedMotion }) {
  const root = useRef(null);

  useFrame((st) => {
    if (!root.current || reducedMotion) return;
    root.current.position.y = Math.sin(st.clock.elapsedTime * 0.28) * 0.015;
  });

  return (
    <group ref={root}>
      <TokenBlocks progressRef={progressRef} palette={palette} />
      <SpeakerBlock progressRef={progressRef} palette={palette} />
      <ConditionedInput progressRef={progressRef} palette={palette} />
      <Autoregression progressRef={progressRef} palette={palette} />
      <AcousticBlock progressRef={progressRef} palette={palette} />
      <LabelProjector progressRef={progressRef} labelRefs={labelRefs} labels={LABELS} />
    </group>
  );
}
