/**
 * Eager entry — deliberately tiny.
 *
 * Ships the panel styles (needed for layout on first paint) and nothing else.
 * React, three.js and the viewer itself live behind a dynamic import that only
 * fires when the reader is within a viewport of the structure section, so the
 * rest of the page never pays for the 3D bundle.
 */
import './viewer.css';

let booted = false;

async function boot() {
  if (booted) return;
  booted = true;
  const { mountAll } = await import('./mount.jsx');
  mountAll();
}

function init() {
  const sections = [...document.querySelectorAll('[data-pmhc-section]')];
  if (!sections.length) return;

  // ?pmhcdebug boots immediately and skips gating, for inspection and testing.
  if (location.search.includes('pmhcdebug')) {
    boot();
    return;
  }

  // Measured off the rect rather than via IntersectionObserver: an observer can
  // stay latched at "not intersecting" while the page is occluded or reporting
  // a zero-height viewport, which would leave the section permanently inert.
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
