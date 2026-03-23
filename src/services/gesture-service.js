export class GestureService {
  static bindSwipeAction(el, {
    onLeft,
    onRight,
    onTap,
    threshold = 72,
    previewClassRight,
    previewClassLeft,
    transformEl = null,
    maxTranslate = 108,
  }) {
    let sx = 0;
    let sy = 0;
    let dx = 0;
    let dy = 0;
    let active = false;
    let dragAxis = "none";

    const moveTarget = transformEl || el;

    const resetVisual = () => {
      moveTarget.style.transition = "transform 140ms ease, opacity 140ms ease";
      moveTarget.style.transform = "translateX(0)";
      moveTarget.style.opacity = "1";
      if (previewClassRight) el.classList.remove(previewClassRight);
      if (previewClassLeft) el.classList.remove(previewClassLeft);
    };

    const startPoint = (x, y) => {
      active = true;
      dragAxis = "none";
      sx = x;
      sy = y;
      dx = 0;
      dy = 0;
      moveTarget.style.transition = "none";
    };

    const movePoint = (x, y) => {
      if (!active) return;
      dx = x - sx;
      dy = y - sy;

      if (dragAxis === "none") {
        if (Math.abs(dx) < 14 && Math.abs(dy) < 14) return;
        if (Math.abs(dx) > Math.abs(dy) * 1.2) {
          dragAxis = "x";
        } else {
          dragAxis = "y";
          active = false;
          resetVisual();
          return;
        }
      }

      if (dragAxis !== "x") return;

      const clamped = Math.max(-maxTranslate, Math.min(maxTranslate, dx));
      moveTarget.style.transform = `translateX(${clamped}px)`;
      moveTarget.style.opacity = "0.94";

      if (previewClassRight || previewClassLeft) {
        const dir = clamped > 26 ? "right" : clamped < -26 ? "left" : "none";
        if (previewClassRight) el.classList.toggle(previewClassRight, dir === "right");
        if (previewClassLeft) el.classList.toggle(previewClassLeft, dir === "left");
      }
    };

    const finish = (shouldTrigger) => {
      if (!active && dragAxis === "none") return;

      const finalDx = dx;
      const finalDy = dy;
      const horizontalDrag = dragAxis === "x";
      const wasTap = dragAxis === "none" && Math.abs(finalDx) < 10 && Math.abs(finalDy) < 10;

      active = false;
      dragAxis = "none";
      sx = 0;
      sy = 0;
      dx = 0;
      dy = 0;

      resetVisual();

      if (!shouldTrigger) return;

      if (wasTap) {
        onTap?.();
        return;
      }

      if (!horizontalDrag) return;
      if (Math.abs(finalDx) < threshold) return;

      if (finalDx > 0) onRight?.();
      else onLeft?.();
    };

    const onPointerDown = (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      startPoint(e.clientX, e.clientY);
    };

    const onPointerMove = (e) => movePoint(e.clientX, e.clientY);

    const onTouchStart = (e) => {
      const t = e.changedTouches?.[0];
      if (!t) return;
      startPoint(t.clientX, t.clientY);
    };

    const onTouchMove = (e) => {
      const t = e.changedTouches?.[0];
      if (!t) return;
      movePoint(t.clientX, t.clientY);
    };

    el.addEventListener("pointerdown", onPointerDown, { passive: true });
    el.addEventListener("pointermove", onPointerMove, { passive: true });
    el.addEventListener("pointerup", () => finish(true), { passive: true });
    el.addEventListener("pointercancel", () => finish(false), { passive: true });
    el.addEventListener("lostpointercapture", () => finish(false), { passive: true });

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("touchend", () => finish(true), { passive: true });
    el.addEventListener("touchcancel", () => finish(false), { passive: true });
  }
}
