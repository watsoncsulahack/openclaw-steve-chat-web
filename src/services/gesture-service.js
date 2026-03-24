export class GestureService {
  static bindSwipeAction(el, {
    onLeft,
    onRight,
    onTap,
    threshold = 56,
    previewClassRight,
    previewClassLeft,
    transformEl = null,
    maxTranslate = 108,
  }) {
    const moveTarget = transformEl || el;

    let sx = 0;
    let sy = 0;
    let dx = 0;
    let dy = 0;
    let active = false;
    let axis = "none";
    let pointerId = null;
    let captured = false;

    const resetVisual = () => {
      moveTarget.style.transition = "transform 140ms ease, opacity 140ms ease";
      moveTarget.style.transform = "translateX(0)";
      moveTarget.style.opacity = "1";
      if (previewClassRight) el.classList.remove(previewClassRight);
      if (previewClassLeft) el.classList.remove(previewClassLeft);
    };

    const start = (x, y, pid = null) => {
      active = true;
      axis = "none";
      pointerId = pid;
      captured = false;
      sx = x;
      sy = y;
      dx = 0;
      dy = 0;
      moveTarget.style.transition = "none";
    };

    const move = (x, y, evt = null, pid = null) => {
      if (!active) return;
      if (pointerId != null && pid != null && pid !== pointerId) return;

      dx = x - sx;
      dy = y - sy;

      if (axis === "none") {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;

        // Bias slightly toward horizontal so swipe-reply is easier on phones.
        if (Math.abs(dx) >= Math.abs(dy) * 0.85) {
          axis = "x";
        } else {
          axis = "y";
          active = false;
          resetVisual();
          return;
        }
      }

      if (axis !== "x") return;

      if (!captured && pointerId != null && el.setPointerCapture) {
        try {
          el.setPointerCapture(pointerId);
          captured = true;
        } catch {
          // ignore
        }
      }

      if (evt?.cancelable) evt.preventDefault();

      const clamped = Math.max(-maxTranslate, Math.min(maxTranslate, dx));
      moveTarget.style.transform = `translateX(${clamped}px)`;
      moveTarget.style.opacity = "0.94";

      if (previewClassRight || previewClassLeft) {
        const dir = clamped > 18 ? "right" : clamped < -18 ? "left" : "none";
        if (previewClassRight) el.classList.toggle(previewClassRight, dir === "right");
        if (previewClassLeft) el.classList.toggle(previewClassLeft, dir === "left");
      }
    };

    const finish = (shouldTrigger) => {
      if (!active && axis === "none") return;

      const finalDx = dx;
      const finalDy = dy;
      const horizontalDrag = axis === "x";
      const wasTap = axis === "none" && Math.abs(finalDx) < 10 && Math.abs(finalDy) < 10;

      if (captured && pointerId != null && el.releasePointerCapture) {
        try {
          el.releasePointerCapture(pointerId);
        } catch {
          // ignore
        }
      }

      active = false;
      axis = "none";
      pointerId = null;
      captured = false;
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
      start(e.clientX, e.clientY, e.pointerId);
    };

    const onPointerMove = (e) => move(e.clientX, e.clientY, e, e.pointerId);

    // Pointer events cover modern Android/iOS + desktop.
    if (window.PointerEvent) {
      el.addEventListener("pointerdown", onPointerDown, { passive: true });
      el.addEventListener("pointermove", onPointerMove, { passive: false });
      el.addEventListener("pointerup", () => finish(true), { passive: true });
      el.addEventListener("pointercancel", () => finish(false), { passive: true });
      el.addEventListener("lostpointercapture", () => finish(false), { passive: true });
      return;
    }

    // Fallback for old engines.
    const onTouchStart = (e) => {
      const t = e.changedTouches?.[0];
      if (!t) return;
      start(t.clientX, t.clientY, null);
    };

    const onTouchMove = (e) => {
      const t = e.changedTouches?.[0];
      if (!t) return;
      move(t.clientX, t.clientY, e, null);
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", () => finish(true), { passive: true });
    el.addEventListener("touchcancel", () => finish(false), { passive: true });
  }
}
