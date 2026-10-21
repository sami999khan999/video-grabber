"use client";

import { useEffect } from "react";

// Glass overlay scrollbar, ported from the core of ~/code/glass-scroll (the browser extension has
// the same thing in glass-scroll.js): the native bar is hidden, so it takes no width, and a
// frosted pill on top of the content mirrors the scroll position. It fades in while scrolling or
// when the pointer nears the edge, grows on hover, and can be dragged. Styles: .gs-* in wall.css.

const HIDE_DELAY = 1100;
const EDGE_REVEAL = 44;
const MIN_THUMB = 36;

const clamp = (n: number, min: number, max: number) => (n < min ? min : n > max ? max : n);

type Metrics = { overflow: false } | { overflow: true; maxScroll: number; thumb: number; travel: number; offset: number };

/** Thumb length and offset for one scroll position. */
function measure(el: HTMLElement, track: number): Metrics {
  const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
  // Sub-pixel rounding can leave a fraction of a pixel on a box that doesn't really scroll
  if (maxScroll < 1 || track <= 0) return { overflow: false };
  const thumb = clamp(Math.max((el.clientHeight / el.scrollHeight) * track, MIN_THUMB), 0, track);
  const travel = Math.max(0, track - thumb);
  const offset = (clamp(el.scrollTop, 0, maxScroll) / maxScroll) * travel;
  return { overflow: true, maxScroll, thumb, travel, offset };
}

/**
 * Give `el` (a scrolling box) a glass scrollbar, drawn in el's parent over el's own box.
 * Returns the cleanup.
 */
export function attachGlassScroll(el: HTMLElement): () => void {
  const parent = el.parentElement;
  if (!parent) return () => {};
  el.classList.add("gs-hide-native");
  const root = document.createElement("div");
  root.className = "gs-root";
  root.setAttribute("aria-hidden", "true");
  const thumb = document.createElement("div");
  thumb.className = "gs-thumb";
  root.append(thumb);
  parent.append(root);

  let frame = 0;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let hovering = false;
  let dragging = false;
  let metrics: Metrics = { overflow: false };

  const update = () => {
    frame = 0;
    // Both are placed against the same positioned ancestor, so el's offsets line the overlay up
    root.style.top = `${el.offsetTop}px`;
    root.style.left = `${el.offsetLeft}px`;
    root.style.width = `${el.offsetWidth}px`;
    root.style.height = `${el.offsetHeight}px`;
    metrics = measure(el, root.clientHeight - 8);
    root.dataset.overflow = String(metrics.overflow);
    if (!metrics.overflow) return;
    thumb.style.height = `${metrics.thumb}px`;
    thumb.style.transform = `translate3d(0, ${metrics.offset + 4}px, 0)`;
  };

  // Any number of triggers in one frame make one update
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };

  const hideLater = () => {
    clearTimeout(hideTimer);
    if (hovering || dragging) return;
    hideTimer = setTimeout(() => (root.dataset.visible = "false"), HIDE_DELAY);
  };

  const reveal = () => {
    root.dataset.visible = "true";
    hideLater();
  };

  const onScroll = () => {
    schedule();
    reveal();
  };

  // Coming close to the right edge shows the bar, so it can be grabbed without scrolling first
  const onPointerMove = (e: PointerEvent) => {
    if (dragging || !metrics.overflow || e.pointerType === "touch") return;
    const r = el.getBoundingClientRect();
    if (e.clientY >= r.top && e.clientY <= r.bottom && e.clientX <= r.right && r.right - e.clientX <= EDGE_REVEAL) reveal();
  };

  const onEnter = () => {
    hovering = true;
    clearTimeout(hideTimer);
    root.dataset.visible = "true";
    root.dataset.hovering = "true";
  };

  const onLeave = () => {
    hovering = false;
    delete root.dataset.hovering;
    hideLater();
  };

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 || !metrics.overflow) return;
    e.preventDefault();
    const { travel, maxScroll } = metrics;
    const startY = e.clientY;
    const startScroll = el.scrollTop;
    dragging = true;
    root.dataset.dragging = "true";
    thumb.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      // Anchored to where the drag began, so rounding never drifts
      el.scrollTop = travel > 0 ? clamp(startScroll + ((ev.clientY - startY) / travel) * maxScroll, 0, maxScroll) : startScroll;
    };
    const end = () => {
      thumb.removeEventListener("pointermove", move);
      thumb.removeEventListener("pointerup", end);
      thumb.removeEventListener("pointercancel", end);
      dragging = false;
      delete root.dataset.dragging;
      hideLater();
    };
    thumb.addEventListener("pointermove", move);
    thumb.addEventListener("pointerup", end);
    thumb.addEventListener("pointercancel", end);
  };

  el.addEventListener("scroll", onScroll, { passive: true });
  parent.addEventListener("pointermove", onPointerMove);
  thumb.addEventListener("pointerenter", onEnter);
  thumb.addEventListener("pointerleave", onLeave);
  thumb.addEventListener("pointerdown", onDown);
  // Size and content changes (new rows, a resized window) move the thumb too
  const resize = new ResizeObserver(schedule);
  resize.observe(el);
  const mutations = new MutationObserver(schedule);
  mutations.observe(el, { childList: true, subtree: true });
  window.addEventListener("resize", schedule);
  update();

  return () => {
    cancelAnimationFrame(frame);
    clearTimeout(hideTimer);
    resize.disconnect();
    mutations.disconnect();
    window.removeEventListener("resize", schedule);
    el.removeEventListener("scroll", onScroll);
    parent.removeEventListener("pointermove", onPointerMove);
    el.classList.remove("gs-hide-native");
    root.remove();
  };
}

/**
 * A glass scrollbar on every element matching `selector`, including ones that appear later
 * (a panel switched in), for as long as the calling component is mounted.
 */
export function useGlassScrollAll(selector: string) {
  useEffect(() => {
    const attached = new Map<HTMLElement, () => void>();
    const sync = () => {
      const current = new Set(document.querySelectorAll<HTMLElement>(selector));
      for (const [el, detach] of attached) {
        if (!current.has(el)) {
          detach();
          attached.delete(el);
        }
      }
      for (const el of current) if (!attached.has(el)) attached.set(el, attachGlassScroll(el));
    };
    sync();
    // Only elements coming and going matter here; each bar watches its own content
    const observer = new MutationObserver((records) => {
      if (records.some((r) => r.addedNodes.length || r.removedNodes.length)) sync();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      attached.forEach((detach) => detach());
    };
  }, [selector]);
}
