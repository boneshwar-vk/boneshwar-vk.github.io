/**
 * Lazy chunk: React + three.js + the viewer.
 *
 * Mounts into every `[data-pmhc-stage]`, using the enclosing
 * `[data-pmhc-section]` as the scroll driver. Narrative panels stay in plain
 * HTML — this only syncs which one is lit.
 */
import { createRoot } from 'react-dom/client';

import PMHCViewer, { BEATS } from './PMHCViewer.jsx';

/** Nearest beat to the current eased progress — drives panel highlighting. */
function activeBeat(p) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < BEATS.length; i++) {
    const d = Math.abs(BEATS[i].at - p);
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
  const panels = section ? [...section.querySelectorAll('[data-beat]')] : [];

  let lastBeat = -1;
  const onProgress = (p) => {
    if (section) section.style.setProperty('--pmhc-progress', p.toFixed(4));
    const beat = activeBeat(p);
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
    />,
  );

  // Lets CSS switch on the focus choreography only once JS is actually running.
  section?.setAttribute('data-pmhc-ready', 'true');
}

export function mountAll() {
  document.querySelectorAll('[data-pmhc-stage]').forEach(mount);
}

export { PMHCViewer, BEATS };
