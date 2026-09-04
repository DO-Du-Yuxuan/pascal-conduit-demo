import { describe, expect, it } from "vitest";
import { buildManualMeasurementGeometry, buildMeasurementSnapSegments, formatArea, formatMeasurement, resolveMeasurementMode, snapMeasurementPoint } from "./manual-measurement";

const level = { id: "level", type: "level" }, wall = { id: "wall", type: "wall", parentId: "level", start: [0, 0], end: [4, 0], thickness: .2 }, item = { id: "item", type: "item", parentId: "level", position: [2, 0, 2], rotation: [0, Math.PI / 2, 0], asset: { dimensions: [2, 1, 1] } };

describe("manual CAD measurement", () => {
  it("formats millimetres and feet-inches rounded to one sixteenth", () => {
    expect(formatMeasurement(3.85, "millimeters")).toBe("3850");
    expect(formatMeasurement(3.85, "feet-inches")).toBe("12'-7 9/16\"");
    expect(formatMeasurement(.3048, "feet-inches")).toBe("1'-0\"");
    expect(formatMeasurement(-.3048, "feet-inches")).toBe("−1'-0\"");
  });
  it("formats global areas as square metres or square feet", () => {
    expect(formatArea(10, "millimeters")).toBe("10.00 m²");
    expect(formatArea(10, "feet-inches")).toBe("107.64 ft²");
  });
  it("measures aligned, horizontal, and vertical values independently", () => {
    expect(buildManualMeasurementGeometry([0, 0], [3, 4], "aligned").valueMeters).toBe(5);
    expect(buildManualMeasurementGeometry([0, 0], [3, 4], "horizontal")).toMatchObject({ valueMeters: 3, measurementEnd: [3, 0] });
    expect(buildManualMeasurementGeometry([0, 0], [3, 4], "vertical")).toMatchObject({ valueMeters: 4, measurementEnd: [0, 4] });
  });
  it("uses Shift-style orthogonal locking on the dominant world axis", () => {
    expect(resolveMeasurementMode([0, 0], [4, 2], true)).toBe("horizontal");
    expect(resolveMeasurementMode([0, 0], [2, 4], true)).toBe("vertical");
    expect(resolveMeasurementMode([0, 0], [2, 4], false)).toBe("aligned");
  });
  it("snaps to the physical wall face rather than its centerline", () => {
    const segments = buildMeasurementSnapSegments({ level, wall } as any, "level"), snap = snapMeasurementPoint([2, -.08], segments, .05);
    expect(snap.kind).toBe("wall-edge");
    expect(snap.point[1]).toBeCloseTo(-.1);
  });
  it("snaps to transformed furniture corners and edges", () => {
    const segments = buildMeasurementSnapSegments({ level, item } as any, "level"), corner = snapMeasurementPoint([1.51, 1.01], segments, .05), edge = snapMeasurementPoint([2, 1.01], segments, .05);
    expect(corner.kind).toBe("furniture-corner");
    expect(corner.point[0]).toBeCloseTo(1.5);
    expect(corner.point[1]).toBeCloseTo(1);
    expect(edge.kind).toBe("furniture-edge");
    expect(edge.point[1]).toBeCloseTo(1);
  });
  it("keeps an unsnapped cursor as a free world point", () => {
    expect(snapMeasurementPoint([9, 9], [], .1)).toEqual({ point: [9, 9], kind: "free", distanceMeters: 0 });
  });
});
