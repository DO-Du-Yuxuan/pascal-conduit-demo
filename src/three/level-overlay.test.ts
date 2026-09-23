import { describe, expect, it } from "vitest";
import { createEmptyOverlay, type RouteSegment } from "../domain/overlay";
import { overlayForLevel } from "./level-overlay";

const point = (x: number, levelId: string) => ({ position: [x, 0, 0] as [number, number, number], attachment: { hostId: `wall-${levelId}`, hostKind: "wall" as const, surface: "side", normal: [1, 0, 0] as [number, number, number], levelId } });
const segment = (id: string, start: string, end: string): RouteSegment => ({ id, type: "conduit-segment", system: "receptacle", diameterMm: 20, start: point(0, start), end: point(1, end), createdAt: "now" });

describe("3D level display slice", () => {
  it("shows same-level and crossing routes on their floors without changing stored data", () => {
    const source = createEmptyOverlay("test.json", "sha");
    source.segments = [segment("floor-0", "l0", "l0"), segment("floor-1", "l1", "l1"), segment("riser", "l0", "l1")];
    const original = source.segments;
    expect(overlayForLevel(source, "l0").segments.map((item) => item.id)).toEqual(["floor-0", "riser"]);
    expect(overlayForLevel(source, "l1").segments.map((item) => item.id)).toEqual(["floor-1", "riser"]);
    expect(source.segments).toBe(original);
    expect(source.segments).toHaveLength(3);
  });
});
