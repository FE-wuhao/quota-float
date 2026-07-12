import { describe, expect, it } from "vitest";
import { DRAG_THRESHOLD_PX, exceedsDragThreshold } from "./gesture";

describe("compact card gesture threshold", () => {
  it("keeps small pointer movement eligible for a click", () => {
    expect(exceedsDragThreshold({ x: 10, y: 10 }, 14, 14)).toBe(false);
  });

  it("starts dragging only after movement exceeds six pixels", () => {
    expect(exceedsDragThreshold({ x: 0, y: 0 }, DRAG_THRESHOLD_PX, 0)).toBe(false);
    expect(exceedsDragThreshold({ x: 0, y: 0 }, DRAG_THRESHOLD_PX + 1, 0)).toBe(true);
  });
});
