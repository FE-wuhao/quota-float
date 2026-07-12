export const DRAG_THRESHOLD_PX = 6;

export interface PointerOrigin {
  x: number;
  y: number;
}

export function exceedsDragThreshold(origin: PointerOrigin, x: number, y: number): boolean {
  return Math.hypot(x - origin.x, y - origin.y) > DRAG_THRESHOLD_PX;
}
