import { describe, expect, it } from "vitest";
import { isExplicitlyOpenable, planUseSpaces, scaledMinimumUseClearance, scaledOpeningDepth } from "./object-use-space";

const owner = (extra: Record<string, unknown> = {}) => ({ id: "cabinet", dimensionsMeters: [1, 1, .5], itemScale: [2, 1, .5], openingDirections: ["front"], rawMaxOpeningDepthMeters: .5, rawMinOpeningUseClearanceMeters: .45, resolvedWorldPosition: [3, 4], resolvedRotationRadians: 0, ...extra });

describe("explicit object opening and use space", () => {
  it("scales both product distances on the local direction axis", () => {
    expect(scaledOpeningDepth(owner(), "front")).toBeCloseTo(.25, 10);
    expect(scaledMinimumUseClearance(owner(), "front")).toBeCloseTo(.225, 10);
    expect(scaledOpeningDepth(owner({ openingDirections: ["right"] }), "right")).toBeCloseTo(1, 10);
  });

  it("rotates semantic front with the item and keeps minimum and full zones separate", () => {
    const [space] = planUseSpaces(owner({ resolvedRotationRadians: Math.PI / 2 }));
    expect(space).toMatchObject({ direction: "front", maximumOpeningDepthMeters: .25, minimumUseClearanceMeters: .225, measurementBasis: "explicit" });
    expect(Math.min(...space!.minimumUsePolygon.map((point) => point[0]))).toBeGreaterThan(3);
    expect(Math.max(...space!.fullUsePolygon.map((point) => point[0]))).toBeGreaterThan(Math.max(...space!.minimumUsePolygon.map((point) => point[0])));
    expect(Math.min(...space!.openedUsePolygon.map((point) => point[0]))).toBeCloseTo(Math.max(...space!.openingPolygon.map((point) => point[0])), 10);
  });

  it("places the full-open use area after the opening area", () => {
    const [space] = planUseSpaces(owner({ itemScale: [1,1,1], resolvedRotationRadians: 0 }));
    const openingFar = Math.max(...space!.openingPolygon.map((point) => point[1]));
    const useNear = Math.min(...space!.openedUsePolygon.map((point) => point[1]));
    expect(useNear).toBeCloseTo(openingFar, 10);
    expect(Math.max(...space!.openedUsePolygon.map((point) => point[1])) - useNear).toBeCloseTo(.45, 10);
  });

  it("treats missing, null, or zero depth as confirmed non-openable", () => {
    expect(isExplicitlyOpenable(owner({ rawMaxOpeningDepthMeters: 0 }))).toBe(false);
    expect(isExplicitlyOpenable(owner({ rawMaxOpeningDepthMeters: null }))).toBe(false);
    expect(isExplicitlyOpenable(owner({ openingDirections: [] }))).toBe(false);
    expect(planUseSpaces(owner({ rawMaxOpeningDepthMeters: 0 }))).toEqual([]);
  });
});
