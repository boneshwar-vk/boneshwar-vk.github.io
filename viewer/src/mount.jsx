/**
 * Lazy chunk: React + three.js + the viewer.
 *
 * Mounts into every `[data-pmhc-stage]`, using the enclosing
 * `[data-pmhc-section]` as the scroll driver. Narrative panels stay in plain
 * HTML — this only syncs which one is lit.
 */
import { createRoot } from 'react-dom/client';

import PMHCViewer from './PMHCViewer.jsx';
import { resolveBeats } from './CameraRig.jsx';

/** Nearest beat to the current eased progress — drives panel highlighting. */
function activeBeat(beats, p) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < beats.length; i++) {
    const d = Math.abs(beats[i].at - p);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

function mount(stageEl) {
  const section = stageEl.closest('[data-pmhc-section]') ?? stageEl.parentElement;
  const modelUrl = stageEl.dataset.model || undefined;
  // `data-beats` picks the camera path preset; it must match the number of
  // narrative panels the page actually renders.
  const beatSet = stageEl.dataset.beats || 'full';
  const beats = resolveBeats(beatSet);
  const panels = section ? [...section.querySelectorAll('[data-beat]')] : [];

  let lastBeat = -1;
  const onProgress = (p) => {
    if (section) section.style.setProperty('--pmhc-progress', p.toFixed(4));
    const beat = activeBeat(beats, p);
    if (beat === lastBeat) return;
    lastBeat = beat;
    if (section) section.dataset.activeBeat = String(beat);
    for (const el of panels) {
      el.dataset.active = String(Number(el.dataset.beat) === beat);
    }
  };

  const pinned = stageEl.dataset.progress != null ? Number(stageEl.dataset.progress) : null;

  createRoot(stageEl).render(
    <PMHCViewer
      modelUrl={modelUrl}
      scrollElement={section}
      onProgress={onProgress}
      pinnedProgress={pinned}
      beats={beatSet}
    />,
  );

  // Lets CSS switch on the focus choreography only once JS is actually running.
  section?.setAttribute('data-pmhc-ready', 'true');
}

export function mountAll() {
  document.querySelectorAll('[data-pmhc-stage]').forEach(mount);
}

export { PMHCViewer };
