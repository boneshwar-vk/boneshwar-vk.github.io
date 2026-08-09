# pMHC viewer

Scroll-driven 3D viewer for the peptide–MHC class I complex on
[`experience/popvax.html`](../experience/popvax.html). Built from **PDB 3MRP** — HLA-A\*0201
heavy chain, β2-microglobulin, and the MART-1 decapeptide `ELAGLGINTV`.

## Layout

```
src/tts/          the text-to-speech pipeline scene (ConvoZen page)
scripts/          pMHC model pipeline (mmCIF -> GLB)
  cif.py            minimal mmCIF reader
  mesh.py           cartoon-ribbon + ball-and-stick geometry
  glb.py            glTF 2.0 / GLB writer
  build_pmhc.py     ties them together -> build/pmhc_raw.glb
  compress-model.mjs  weld/reorder/quantize/meshopt -> ../public/models/pmhc.glb
src/              the React / react-three-fiber viewer
review.html       dev harness: every camera beat side by side
```

Build output is committed (`../assets/scenes/`) because the site is plain static
files on GitHub Pages with no CI step.

## Commands

```bash
npm install
npm run model     # regenerate public/models/pmhc.glb from assets/3MRP.cif
npm run build     # bundle -> ../assets/scenes/
```

`npm run model` runs the Python stage first:

```bash
python3 scripts/build_pmhc.py && node scripts/compress-model.mjs
```

## How it works

Two scenes share one build. Each page loads a ~0.5 KB gzip gate (`pmhc.js` or
`tts.js`) that watches for its section approaching the viewport, then dynamically
imports the scene chunk plus a shared `vendor.js` (~304 KB gzip: React +
three.js). A visitor who sees both pages downloads the vendor chunk once.

- `pmhc.js` → `mount.js` → mounts into `[data-pmhc-stage]`, driven by
  `[data-pmhc-section]`. See `src/`.
- `tts.js` → `ttsMount.js` → mounts into `[data-tts-stage]`, driven by
  `[data-tts-section]`. See `src/tts/`.

The TTS scene is one particle system morphing through eight authored layouts
(text → tokens → embedding → encoder lattice → attention → latent → spectrogram
→ waveform); `src/tts/stages.js` generates them and `src/tts/speech.js` provides
the real signal the acoustic stages are measured from. Nothing is ever played.

Motion is three superposed layers, added rather than switched between, so there
is never a visible hand-off:

1. **scroll** — a critically damped spring walks the `BEATS` camera path
2. **idle** — a slow continuous spin plus an always-on breathing dolly
3. **input** — pointer parallax and drag-to-orbit, with inertia and a slow yield
   back to the authored path

The canvas sets `touch-action: pan-y`, so the browser keeps vertical scrolling
for itself: the scene cannot swallow a page scroll on touch devices.

Append `?pmhcdebug` or `?ttsdebug` to a URL to force-mount that scene and expose
`window.__pmhc` / `window.__tts` (`setProgress(p)`, `unpin()`, live driver
state). `?ttsdebug` also exposes `window.__ttsScene` (live three.js scene, draw
call counts) and collects swallowed errors into `window.__ttsErr`.
