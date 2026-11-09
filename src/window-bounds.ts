/** Saved window bounds, checked against the current displays. Pure, so `node --test` can load it. */

export type Bounds = { x?: number; y?: number; width: number; height: number; maximized?: boolean };
export type Rect = { x: number; y: number; width: number; height: number };

/** How much of the window must be on one display to keep its saved position. */
const MIN_VISIBLE = { width: 100, height: 50 };

const visibleEnough = (a: Rect, b: Rect) =>
  Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) >= MIN_VISIBLE.width &&
  Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) >= MIN_VISIBLE.height;

/**
 * Keeps the saved position only if at least 100x50 px of the window would be on
 * some display's work area; otherwise drops x/y so Electron centres it. Stops the
 * window opening on an unplugged monitor, or as an ungrabbable sliver at an edge.
 */
export function onScreenBounds(saved: Bounds, workAreas: Rect[]): Bounds {
  const { x, y, width, height, maximized } = saved;
  const sized: Bounds = maximized === undefined ? { width, height } : { width, height, maximized };
  if (x === undefined || y === undefined) return sized;
  return workAreas.some((area) => visibleEnough({ x, y, width, height }, area)) ? saved : sized;
}
