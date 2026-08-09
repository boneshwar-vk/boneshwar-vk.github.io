/**
 * Eager entry for the TTS scene — styles plus a gate, nothing else.
 *
 * React, three.js and the scene itself sit behind a dynamic import that only
 * fires when the reader is within a viewport of the section, so the rest of
 * the page never pays for them.
 */
import './tts.css';

// Debug builds keep the last errors around: R3F swallows throws inside the
// canvas tree, and an empty console is otherwise indistinguishable from a
// scene that simply refused to mount.
if (typeof location !== 'undefined' && location.search.includes('ttsdebug')) {
  window.__ttsErr = [];
  window.addEventListener('error', (e) => {
    window.__ttsErr.push(String(e.message || e.error));
  });
  window.addEventListener('unhandledrejection', (e) => {
    window.__ttsErr.push('rejection: ' + String(e.reason && (e.reason.stack || e.reason.message || e.reason)));
  });
  const ce = console.error.bind(console);
  console.error = (...a) => {
    window.__ttsErr.push(a.map((x) => String(x && (x.stack || x.message || x))).join(' | ').slice(0, 600));
    ce(...a);
  };
}

let booted = false;

async function boot() {
  if (booted) return;
  booted = true;
  const { mountAll } = await import('./ttsMount.jsx');
  mountAll();
}

function init() {
  const sections = [...document.querySelectorAll('[data-tts-section]')];
  if (!sections.length) return;

  if (location.search.includes('ttsdebug')) {
    boot();
    return;
  }

  // Rect arithmetic rather than IntersectionObserver: an observer can stay
  // latched at "not intersecting" when the page is occluded or reports a
  // zero-height viewport, which would leave the section permanently inert.
  let raf = 0;
  const check = () => {
    raf = 0;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const near = sections.some((s) => {
      const r = s.getBoundingClientRect();
      return r.top < vh * 2 && r.bottom > -vh;
    });
    if (!near) return;
    window.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', schedule);
    boot();
  };
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(check);
  };

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  check();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
