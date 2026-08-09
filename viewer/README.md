# pMHC viewer

Scroll-driven 3D viewer for the peptide–MHC class I complex on
[`structure.html`](../structure.html). Built from **PDB 3MRP** — HLA-A\*0201
heavy chain, β2-microglobulin, and the MART-1 decapeptide `ELAGLGINTV`.

## Layout

```
scripts/          model pipeline (mmCIF -> GLB)
  cif.py            minimal mmCIF reader
  mesh.py           cartoon-ribbon + ball-and-stick geometry
  glb.py            glTF 2.0 / GLB writer
  build_pmhc.py     ties them together -> build/pmhc_raw.glb
  compress-model.mjs  weld/reorder/quantize/meshopt -> ../public/models/pmhc.glb
src/              the React / react-three-fiber viewer
review.html       dev harness: every camera beat side by side
```

Build output is committed (`../assets/pmhc/`) because the site is plain static
files on GitHub Pages with no CI step.

## Commands

```bash
npm install
npm run model     # regenerate public/models/pmhc.glb from assets/3MRP.cif
npm run build     # bundle -> ../assets/pmhc/{pmhc.js,pmhc-viewer.js,pmhc.css}
```

`npm run model` runs the Python stage first:

```bash
python3 scripts/build_pmhc.py && node scripts/compress-model.mjs
```

## How it works

`pmhc.js` (~1 KB gzip) ships on the page and does nothing but watch for the
structure section approaching the viewport. When it does, it dynamically imports
`pmhc-viewer.js` (~308 KB gzip: React + three.js + the viewer), which mounts into
`[data-pmhc-stage]` and drives the camera from the enclosing
`[data-pmhc-section]`'s scroll position.

Motion is three superposed layers, added rather than switched between, so there
is never a visible hand-off:

1. **scroll** — a critically damped spring walks the `BEATS` camera path
2. **idle** — a slow continuous spin plus an always-on breathing dolly
3. **input** — pointer parallax and drag-to-orbit, with inertia and a slow yield
   back to the authored path

The canvas sets `touch-action: pan-y`, so the browser keeps vertical scrolling
for itself: the scene cannot swallow a page scroll on touch devices.

Append `?pmhcdebug` to any URL to force-mount the viewer and expose
`window.__pmhc` (`setProgress(p)`, `unpin()`, live driver state).
