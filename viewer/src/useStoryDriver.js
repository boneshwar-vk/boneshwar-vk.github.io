import { useEffect, useRef } from 'react';

/**
 * Owns every piece of *input* state the render loop needs: scroll progress
 * through the pinned section, pointer parallax, and drag-to-orbit.
 *
 * Deliberately stores everything on a mutable ref rather than React state.
 * Nothing here triggers a re-render — the r3f frame loop reads the object
 * directly. Per-frame setState is the classic way to make a scroll scene stutter.
 */
export function useStoryDriver(sectionRef, { enabled = true, onGate } = {}) {
  const driver = useRef({
    /** raw 0..1 progress through the pinned section (unsmoothed) */
    targetProgress: 0,
    /** 1 right after a scroll event, decaying to 0 — used to hand over to idle */
    activity: 0,
    /** pointer parallax in -1..1 */
    pointerX: 0,
    pointerY: 0,
    /** user drag offsets, in radians, decaying back toward 0 */
    dragAzimuth: 0,
    dragPolar: 0,
    dragVelX: 0,
    dragVelY: 0,
    dragging: false,
    /** true while the section occupies the viewport */
    visible: false,
    /** debug only: when set, overrides scroll-derived progress */
    pinned: null,
  }).current;

  useEffect(() => {
    if (!enabled) return undefined;
    const section = sectionRef.current;
    if (!section) return undefined;

    let raf = 0;
    let lastProgress = 0;
    let lastNear = null;
    let lastVisible = null;

    const measure = () => {
      raf = 0;
      const rect = section.getBoundingClientRect();
      const vh = window.innerHeight;
      const scrollable = rect.height - vh;
      const p = scrollable > 0 ? -rect.top / scrollable : 0;
      if (driver.pinned == null) driver.targetProgress = Math.max(0, Math.min(1, p));
      if (Math.abs(driver.targetProgress - lastProgress) > 0.00005) {
        driver.activity = 1;
        lastProgress = driver.targetProgress;
      }

      // Gating is measured straight off the rect rather than delegated to an
      // IntersectionObserver. An observer can sit latched at "not intersecting"
      // when the page is occluded or the viewport reports zero height, which
      // leaves the scene permanently unloaded; arithmetic cannot get stuck.
      const visible = rect.top < vh && rect.bottom > 0;
      const near = rect.top < vh * 2 && rect.bottom > -vh;
      driver.visible = visible;
      if (near !== lastNear || visible !== lastVisible) {
        lastNear = near;
        lastVisible = visible;
        onGate?.({ near, visible });
      }
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    document.addEventListener('visibilitychange', onScroll);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      document.removeEventListener('visibilitychange', onScroll);
    };
  }, [sectionRef, driver, enabled, onGate]);

  return driver;
}

/**
 * Pointer parallax + drag-to-orbit, bound to the canvas wrapper.
 *
 * Touch behaviour is the important part: the element sets `touch-action: pan-y`,
 * so the browser keeps native vertical scrolling for itself and only hands us
 * horizontal gestures. The 3D scene therefore *cannot* swallow a page scroll,
 * no matter what the user does.
 */
export function usePointerControls(elementRef, driver, { enabled = true } = {}) {
  useEffect(() => {
    if (!enabled) return undefined;
    const el = elementRef.current;
    if (!el) return undefined;

    let pointerId = null;
    let lastX = 0;
    let lastY = 0;
    let isTouch = false;

    const onMove = (e) => {
      const rect = el.getBoundingClientRect();
      driver.pointerX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      driver.pointerY = ((e.clientY - rect.top) / rect.height) * 2 - 1;
    };

    const onLeave = () => {
      driver.pointerX = 0;
      driver.pointerY = 0;
    };

    const onDown = (e) => {
      if (pointerId !== null) return;
      // Buttons and links inside the stage must keep their clicks: capturing
      // the pointer here retargets the pointerup to the stage, and the browser
      // then never synthesises a click on the control that was pressed.
      if (e.target.closest?.('button, a, [data-no-drag]')) return;
      pointerId = e.pointerId;
      isTouch = e.pointerType === 'touch';
      lastX = e.clientX;
      lastY = e.clientY;
      driver.dragging = true;
      driver.dragVelX = 0;
      driver.dragVelY = 0;
      if (!isTouch) el.setPointerCapture(e.pointerId);
    };

    const onDrag = (e) => {
      if (e.pointerId !== pointerId) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      const k = 0.0055;
      driver.dragAzimuth -= dx * k;
      driver.dragVelX = -dx * k;
      // Vertical drag only tilts on non-touch; on touch, vertical belongs to the page.
      if (!isTouch) {
        driver.dragPolar -= dy * k;
        driver.dragVelY = -dy * k;
      }
    };

    const onUp = (e) => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      driver.dragging = false;
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onDrag);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);

    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onDrag);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
  }, [elementRef, driver, enabled]);
}
