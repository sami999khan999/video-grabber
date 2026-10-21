// Glass overlay scrollbar, a plain-script port of the core of ~/code/glass-scroll: the native bar
// is hidden (no gutter), and a frosted pill drawn on top of the content mirrors the scroll
// position. It fades in while scrolling or when the pointer nears the edge, grows on hover, and
// can be dragged. The browser still does all the scrolling.

/* eslint-disable no-unused-vars */
var GlassScroll = (() => {
  const HIDE_DELAY = 1100;
  const EDGE_REVEAL = 44;
  const MIN_THUMB = 36;

  const clamp = (n, min, max) => (n < min ? min : n > max ? max : n);

  /** Thumb length and offset for one scroll position (see glass-scroll's metrics.ts). */
  function measure(el, track) {
    const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
    // Sub-pixel rounding can leave a fraction of a pixel on a box that doesn't really scroll
    if (maxScroll < 1 || track <= 0) return { overflow: false };
    const thumb = clamp(Math.max((el.clientHeight / el.scrollHeight) * track, MIN_THUMB), 0, track);
    const travel = Math.max(0, track - thumb);
    const offset = (clamp(el.scrollTop, 0, maxScroll) / maxScroll) * travel;
    return { overflow: true, maxScroll, thumb, travel, offset };
  }

  /**
   * Give `el` (a scrolling box) a glass scrollbar. The overlay goes into el's parent, which
   * must be positioned; it lines up with el wherever el sits inside it.
   */
  function attach(el) {
    el.classList.add("gs-hide-native");
    const root = document.createElement("div");
    root.className = "gs-root";
    root.setAttribute("aria-hidden", "true");
    const thumb = document.createElement("div");
    thumb.className = "gs-thumb";
    root.append(thumb);
    el.parentElement.append(root);

    let frame = 0;
    let hideTimer = 0;
    let hovering = false;
    let dragging = false;
    let metrics = { overflow: false };

    const place = () => {
      // The overlay covers el exactly, even if el doesn't fill its parent
      root.style.top = `${el.offsetTop}px`;
      root.style.left = `${el.offsetLeft}px`;
      root.style.width = `${el.offsetWidth}px`;
      root.style.height = `${el.offsetHeight}px`;
    };

    const update = () => {
      frame = 0;
      place();
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

    el.addEventListener("scroll", () => {
      schedule();
      reveal();
    }, { passive: true });

    // Coming close to the right edge shows the bar, so it can be grabbed without scrolling first
    el.parentElement.addEventListener("pointermove", (e) => {
      if (dragging || !metrics.overflow || e.pointerType === "touch") return;
      const r = el.getBoundingClientRect();
      if (e.clientY >= r.top && e.clientY <= r.bottom && e.clientX <= r.right && r.right - e.clientX <= EDGE_REVEAL) reveal();
    });

    thumb.addEventListener("pointerenter", () => {
      hovering = true;
      clearTimeout(hideTimer);
      root.dataset.visible = "true";
      root.dataset.hovering = "true";
    });
    thumb.addEventListener("pointerleave", () => {
      hovering = false;
      delete root.dataset.hovering;
      hideLater();
    });

    thumb.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !metrics.overflow) return;
      e.preventDefault();
      const { travel, maxScroll } = metrics;
      const startY = e.clientY;
      const startScroll = el.scrollTop;
      dragging = true;
      root.dataset.dragging = "true";
      thumb.setPointerCapture(e.pointerId);
      const move = (ev) => {
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
    });

    // Content and size changes (new rows, a tab shown) move the thumb too
    new ResizeObserver(schedule).observe(el);
    new MutationObserver(schedule).observe(el, { childList: true, subtree: true });
    update();
    return { update: schedule, reveal };
  }

  return { attach };
})();
