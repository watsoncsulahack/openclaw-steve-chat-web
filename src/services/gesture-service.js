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

    const start = (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      active = true;
      dragAxis = "none";
      sx = e.clientX;
      sy = e.clientY;
      dx = 0;
      dy = 0;
      moveTarget.style.transition = "none";
    };

    const move = (e) => {
      if (!active) return;
      dx = e.clientX - sx;
      dy = e.clientY - sy;

      if (dragAxis === "none") {
        if (Math.abs(dx) < 14 && Math.abs(dy) < 14) return;
        if (Math.abs(dx) > Math.abs(dy) * 1.35) {
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

    el.addEventListener("pointerdown", start);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", () => finish(true));
    el.addEventListener("pointercancel", () => finish(false));
    el.addEventListener("lostpointercapture", () => finish(false));
  }
}
