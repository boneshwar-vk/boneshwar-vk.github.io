/**
 * Lazy chunk: React + three.js + the TTS scene.
 *
 * Mounts into `[data-tts-stage]`, driven by the enclosing `[data-tts-section]`.
 * The captions stay in plain HTML; this only syncs which one is lit and keeps
 * the readout in step with the scene.
 */
import { createRoot } from 'react-dom/client';

import TTSViewer, { STAGES } from './TTSViewer.jsx';

function nearestStage(p) {
  let best = 0;
  let dist = Infinity;
  for (let i = 0; i < STAGES.length; i++) {
    const d = Math.abs(STAGES[i] - p);
    if (d < dist) {
      dist = d;
      best = i;
    }
  }
  return best;
}

function mount(stageEl) {
  const section = stageEl.closest('[data-tts-section]') ?? stageEl.parentElement;
  const panels = section ? [...section.querySelectorAll('[data-stage]')] : [];
  const readout = section?.querySelector('[data-tts-readout]') ?? null;
  const audioUrl = section?.dataset.audio || null;

  let lastStage = -1;
  const onProgress = (p) => {
    if (section) section.style.setProperty('--tts-progress', p.toFixed(4));
    if (readout) readout.textContent = `${(p * 100).toFixed(0)}%`;
    const s = nearestStage(p);
    if (s === lastStage) return;
    lastStage = s;
    if (section) section.dataset.activeStage = String(s);
    for (const el of panels) {
      el.dataset.active = String(Number(el.dataset.stage) === s);
    }
  };

  createRoot(stageEl).render(
    <TTSViewer scrollElement={section} audioUrl={audioUrl} onProgress={onProgress} />,
  );

  section?.setAttribute('data-tts-ready', 'true');
}

export function mountAll() {
  document.querySelectorAll('[data-tts-stage]').forEach(mount);
}

export { TTSViewer };
