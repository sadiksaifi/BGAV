import type { Box } from "../layout/layout";

export interface Transform {
  x: number;
  y: number;
  k: number;
}

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 2.5;
/** Below this scale, fitting the whole graph makes job names hard to read. */
export const READABLE_SCALE = 0.7;
/** Scale a graph opens at when fitting it would go below READABLE_SCALE. */
export const OPEN_SCALE = 0.8;
const MARGIN = 24;
/** Minimum part of the graph, in screen pixels, that panning keeps on screen. */
const KEEP_VISIBLE = 80;

const clampScale = (k: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, k));

/** Scale that fits the content into the viewport, never above 100%. */
export function fitScale(
  content: { width: number; height: number },
  view: { width: number; height: number },
): number {
  if (content.width <= 0 || content.height <= 0) return 1;
  return clampScale(
    Math.min(
      1,
      (view.width - MARGIN * 2) / content.width,
      (view.height - MARGIN * 2) / content.height,
    ),
  );
}

/** Transform that centers the content at scale `k`. */
export function centered(
  content: { width: number; height: number },
  view: { width: number; height: number },
  k: number,
): Transform {
  return { k, x: (view.width - content.width * k) / 2, y: (view.height - content.height * k) / 2 };
}

/** Zooms to scale `k` while keeping the content point under (px, py) in place. */
export function zoomAround(t: Transform, k: number, px: number, py: number): Transform {
  const next = clampScale(k);
  const ratio = next / t.k;
  return { k: next, x: px - (px - t.x) * ratio, y: py - (py - t.y) * ratio };
}

/** Keeps part of the content on screen so the graph cannot be panned out of sight. */
export function clampPan(
  t: Transform,
  content: { width: number; height: number },
  view: { width: number; height: number },
): Transform {
  const w = content.width * t.k;
  const hgt = content.height * t.k;
  const keepX = Math.min(KEEP_VISIBLE, w);
  const keepY = Math.min(KEEP_VISIBLE, hgt);
  return {
    k: t.k,
    x: Math.min(view.width - keepX, Math.max(keepX - w, t.x)),
    y: Math.min(view.height - keepY, Math.max(keepY - hgt, t.y)),
  };
}

/** Transform that brings a box to the center of the viewport. */
export function centerOn(
  t: Transform,
  box: Box,
  view: { width: number; height: number },
  minScale = 0.8,
): Transform {
  const k = Math.max(t.k, Math.min(minScale, fitScale(box, view)));
  return {
    k,
    x: view.width / 2 - (box.x + box.width / 2) * k,
    y: view.height / 2 - (box.y + box.height / 2) * k,
  };
}

/** Whether the box is fully inside the visible area. */
export function isVisible(
  t: Transform,
  box: Box,
  view: { width: number; height: number },
): boolean {
  const x = box.x * t.k + t.x;
  const y = box.y * t.k + t.y;
  return (
    x >= 0 && y >= 0 && x + box.width * t.k <= view.width && y + box.height * t.k <= view.height
  );
}

export interface GestureHandlers {
  get: () => Transform;
  set: (t: Transform, animate?: boolean) => void;
  /** Whether plain wheel scrolling should pan the graph instead of the page. */
  wheelPans: () => boolean;
}

const DRAG_THRESHOLD = 4;

const isControl = (target: EventTarget | null) =>
  target instanceof Element && target.closest("button, input, .minimap, .no-pan") !== null;

/** Stops native link and image dragging so drags always pan. */
const onDragStart = (e: DragEvent) => e.preventDefault();

/**
 * Pointer and wheel gestures for a pannable, zoomable viewport:
 * drag to pan, Ctrl or Cmd + wheel (or trackpad pinch) to zoom, two-finger touch to pinch.
 */
export function attachGestures(viewport: HTMLElement, handlers: GestureHandlers): () => void {
  const pointers = new Map<number, { x: number; y: number }>();
  let dragStart: { x: number; y: number; t: Transform } | undefined;
  let dragging = false;
  let suppressClick = false;
  let pinch: { dist: number; t: Transform; cx: number; cy: number } | undefined;

  const local = (e: { clientX: number; clientY: number }) => {
    const rect = viewport.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    if (isControl(e.target)) return;
    pointers.set(e.pointerId, local(e));
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      pinch = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        t: handlers.get(),
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
      };
      dragStart = undefined;
      dragging = true;
      return;
    }
    dragStart = { ...local(e), t: handlers.get() };
    dragging = false;
    if (e.button === 1) e.preventDefault();
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const zoomed = zoomAround(pinch.t, pinch.t.k * (dist / pinch.dist), pinch.cx, pinch.cy);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      handlers.set({ ...zoomed, x: zoomed.x + cx - pinch.cx, y: zoomed.y + cy - pinch.cy });
      return;
    }
    if (!dragStart) return;
    const dx = p.x - dragStart.x;
    const dy = p.y - dragStart.y;
    if (!dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!dragging) {
      dragging = true;
      viewport.setPointerCapture(e.pointerId);
      viewport.classList.add("panning");
    }
    handlers.set({ k: dragStart.t.k, x: dragStart.t.x + dx, y: dragStart.t.y + dy });
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = undefined;
    if (pointers.size === 0) {
      if (dragging) suppressClick = true;
      dragging = false;
      dragStart = undefined;
      viewport.classList.remove("panning");
      if (viewport.hasPointerCapture(e.pointerId)) viewport.releasePointerCapture(e.pointerId);
    }
  };

  const onClick = (e: MouseEvent) => {
    if (!suppressClick) return;
    suppressClick = false;
    e.preventDefault();
    e.stopPropagation();
  };

  const onWheel = (e: WheelEvent) => {
    if (isControl(e.target) && !(e.target instanceof Element && e.target.closest(".minimap")))
      return;
    const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewport.clientHeight : 1;
    const dx = e.deltaX * scale;
    const dy = e.deltaY * scale;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const p = local(e);
      const t = handlers.get();
      handlers.set(zoomAround(t, t.k * Math.exp(-dy * 0.0025), p.x, p.y));
      return;
    }
    if (!handlers.wheelPans()) return;
    e.preventDefault();
    const t = handlers.get();
    handlers.set({ ...t, x: t.x - dx, y: t.y - dy });
  };

  const onDblClick = (e: MouseEvent) => {
    if (
      isControl(e.target) ||
      (e.target instanceof Element && e.target.closest(".node, .cluster-head"))
    )
      return;
    const p = local(e);
    const t = handlers.get();
    handlers.set(zoomAround(t, t.k * (e.shiftKey ? 1 / 1.6 : 1.6), p.x, p.y), true);
  };

  viewport.addEventListener("pointerdown", onPointerDown);
  viewport.addEventListener("pointermove", onPointerMove);
  viewport.addEventListener("pointerup", onPointerUp);
  viewport.addEventListener("pointercancel", onPointerUp);
  viewport.addEventListener("click", onClick, true);
  viewport.addEventListener("wheel", onWheel, { passive: false });
  viewport.addEventListener("dblclick", onDblClick);
  viewport.addEventListener("dragstart", onDragStart);

  return () => {
    viewport.removeEventListener("pointerdown", onPointerDown);
    viewport.removeEventListener("pointermove", onPointerMove);
    viewport.removeEventListener("pointerup", onPointerUp);
    viewport.removeEventListener("pointercancel", onPointerUp);
    viewport.removeEventListener("click", onClick, true);
    viewport.removeEventListener("wheel", onWheel);
    viewport.removeEventListener("dblclick", onDblClick);
    viewport.removeEventListener("dragstart", onDragStart);
  };
}
