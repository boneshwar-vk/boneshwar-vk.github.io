/**
 * Compress the raw pMHC GLB for the browser.
 *
 * Pipeline: dedup -> weld -> prune -> quantize -> EXT_meshopt_compression.
 * Deliberately does NOT run `simplify`: the ribbons are already at a hand-tuned
 * tessellation and decimation puts visible dents in the helices.
 */
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, reorder, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const IN = resolve(here, '../build/pmhc_raw.glb');
const OUT = resolve(root, 'public/models/pmhc.glb');

await MeshoptEncoder.ready;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder,
});

const doc = await io.read(IN);

// Preserve the extras we baked in (peptide centre etc.) across the transforms.
const extras = doc.getRoot().getExtras();

await doc.transform(
  dedup(),
  // Ribbon rings and sphere seams share positions; welding them is a large win
  // and is safe because normals are continuous there.
  weld({ tolerance: 0.0001 }),
  prune({ keepAttributes: false, keepLeaves: false }),
  // Vertex-cache + fetch reordering. Meshopt's entropy coder keys off locality,
  // so this is worth far more than it looks: ~2x on top of quantization alone.
  reorder({ encoder: MeshoptEncoder, target: 'size' }),
  // 14-bit positions over a ~2-unit model => ~0.0001 unit error, invisible.
  quantize({
    quantizePosition: 14,
    quantizeNormal: 10,
    quantizeTexcoord: 12,
    quantizeColor: 8,
  }),
);

doc.getRoot().setExtras(extras);

// Meshopt compression, applied last so it sees the quantized attributes.
// FILTER (octahedral normals + exponential positions) beats plain QUANTIZE by
// ~30% here; three.js MeshoptDecoder handles both.
const { EXTMeshoptCompression } = await import('@gltf-transform/extensions');
doc
  .createExtension(EXTMeshoptCompression)
  .setRequired(true)
  .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });

const glb = await io.writeBinary(doc);
writeFileSync(OUT, glb);

const before = statSync(IN).size;
const after = statSync(OUT).size;
const nodes = doc.getRoot().listNodes().map((n) => n.getName());
const tris = doc
  .getRoot()
  .listMeshes()
  .flatMap((m) => m.listPrimitives())
  .reduce((sum, p) => sum + (p.getIndices()?.getCount() ?? 0) / 3, 0);

console.log(
  `nodes:      ${nodes.join(', ')}\n` +
    `triangles:  ${tris.toLocaleString()}\n` +
    `raw:        ${(before / 1024).toFixed(0)} KB\n` +
    `compressed: ${(after / 1024).toFixed(0)} KB  (${((1 - after / before) * 100).toFixed(1)}% smaller)`,
);
