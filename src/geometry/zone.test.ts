import { describe, expect, it } from "vitest";
import { zoneColor, zoneLabelPoint } from "./zone";

describe("zone plan styling", () => {
  it("places the label at the polygon area centroid", () => {
    expect(zoneLabelPoint({ id: "zone", type: "zone", polygon: [[0, 0], [4, 0], [4, 2], [0, 2]] } as any)).toEqual({ x: 2, z: 1 });
  });
  it("preserves Pascal colors and assigns stable fallback colors", () => {
    expect(zoneColor({ id: "zone", type: "zone", color: "#ef4444" } as any)).toBe("#ef4444");
    expect(zoneColor({ id: "missing", type: "zone" } as any)).toBe(zoneColor({ id: "missing", type: "zone" } as any));
  });
});
