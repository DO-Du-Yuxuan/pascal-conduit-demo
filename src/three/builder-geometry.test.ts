import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { buildBuilderRoofSegmentGeometry, buildBuilderSkylightParts, buildBuilderStairParts, buildCanonicalBuilderRoofGeometry, builderRoofSegmentTransform, withBuilderRoofDefaults, withBuilderSkylightDefaults, withBuilderStairDefaults } from "./builder-geometry";
import { buildStraightStairPlanGeometry, stairCorners } from "../geometry/stairs";

describe("Builder architectural placeholder geometry", () => {
  it("builds straight stair runs from source tread count and segment chain", () => {
    const stair: any = { id: "stair", type: "stair", stairType: "straight", position: [4, 0, 7], rotation: 0, children: ["run", "landing"] };
    const nodes: any = {
      stair,
      run: { id: "run", type: "stair-segment", parentId: "stair", segmentType: "stair", width: 1.2, length: 2.4, height: 1.8, stepCount: 9, fillToFloor: true },
      landing: { id: "landing", type: "stair-segment", parentId: "stair", segmentType: "landing", width: 1.2, length: 1, height: 0.2, fillToFloor: false, thickness: 0.12, attachmentSide: "front" },
    };
    const parts = buildBuilderStairParts(stair, nodes);
    expect(parts).toHaveLength(2);
    parts[0]!.geometry.computeBoundingBox();
    const size = parts[0]!.geometry.boundingBox!.getSize(new Vector3());
    expect(size.x).toBeCloseTo(1.2); expect(size.y).toBeCloseTo(1.8); expect(size.z).toBeCloseTo(2.4);
    expect(parts[1]!.position[1]).toBe(1.8);
    expect(parts[1]!.geometry.getAttribute("position").count).toBeGreaterThan(0);
    parts.forEach((part) => part.geometry.dispose());
  });

  it("uses stair schema defaults beneath raw nodes while retaining future fields", () => {
    const stair: any = { id: "stair_defaulted", type: "stair", children: ["sseg_defaulted"], futureStairField: "keep" };
    const segment: any = { id: "sseg_defaulted", type: "stair-segment", parentId: stair.id, futureSegmentField: 9 };
    const nodes = { [stair.id]: stair, [segment.id]: segment } as any, parts = buildBuilderStairParts(stair, nodes);
    expect(withBuilderStairDefaults(stair).stairType).toBe("straight");
    expect(parts.filter((part) => part.role === "tread")).toHaveLength(1);
    parts[0]!.geometry.computeBoundingBox();
    const size = parts[0]!.geometry.boundingBox!.getSize(new Vector3());
    expect(size.x).toBeCloseTo(1); expect(size.y).toBeCloseTo(2.5); expect(size.z).toBeCloseTo(3);
    expect(stair.futureStairField).toBe("keep"); expect(segment.futureSegmentField).toBe(9);
    parts.forEach((part) => part.geometry.dispose());
  });

  it.each(["left", "right"] as const)("places a turned straight stair run on the plan footprint (%s)", (side) => {
    const stair: any = { id: "s", type: "stair", stairType: "straight", position: [3, 0, -2], rotation: .37, children: ["a", "b"] };
    const nodes: any = { s: stair, a: { id: "a", type: "stair-segment", parentId: "s", segmentType: "stair", width: 1, length: 2, height: 1.2, stepCount: 6, fillToFloor: true }, b: { id: "b", type: "stair-segment", parentId: "s", segmentType: "stair", width: 1, length: 1.5, height: 1, stepCount: 5, fillToFloor: true, attachmentSide: side } };
    const plan = buildStraightStairPlanGeometry(stair, nodes)!;
    const parts = buildBuilderStairParts(stair, nodes);
    expect(parts).toHaveLength(2);
    const planPolygon = plan.segments[1]!.polygon;
    const planCenter = { x: planPolygon.reduce((sum, p) => sum + p.x, 0) / 4, z: planPolygon.reduce((sum, p) => sum + p.z, 0) / 4 };
    const part = parts[1]!; part.geometry.computeBoundingBox();
    const localX = part.position[0] + Math.sin(part.rotationY) * (part.geometry.boundingBox!.min.z + part.geometry.boundingBox!.max.z) / 2;
    const localZ = part.position[2] + Math.cos(part.rotationY) * (part.geometry.boundingBox!.min.z + part.geometry.boundingBox!.max.z) / 2;
    const worldX = stair.position[0] + localX * Math.cos(stair.rotation) + localZ * Math.sin(stair.rotation);
    const worldZ = stair.position[2] - localX * Math.sin(stair.rotation) + localZ * Math.cos(stair.rotation);
    expect(worldX).toBeCloseTo(planCenter.x, 5); expect(worldZ).toBeCloseTo(planCenter.z, 5);
    parts.forEach((entry) => entry.geometry.dispose());
  });

  it("aligns curved and spiral tread volumes with source plan footprints", () => {
    for (const stairType of ["curved", "spiral"] as const) {
      const stair: any = { id: stairType, type: "stair", stairType, position: [4, 0, -3], rotation: Math.PI / 3, width: 0.8, innerRadius: 0.35, sweepAngle: Math.PI / 2, stepCount: 6, totalRise: 1.5 };
      const parts = buildBuilderStairParts(stair, { [stair.id]: stair });
      const treads = parts.filter((part) => part.role === "tread");
      expect(treads).toHaveLength(6);
      treads[0]!.geometry.computeBoundingBox();
      expect(treads[0]!.geometry.boundingBox!.max.y - treads[0]!.geometry.boundingBox!.min.y).toBeCloseTo(stairType === "spiral" ? 0.25 : 0.25);
      const corners = stairCorners(stair, { [stair.id]: stair });
      const sourceBounds = { minX: Math.min(...corners.map((p) => p.x)), maxX: Math.max(...corners.map((p) => p.x)), minZ: Math.min(...corners.map((p) => p.z)), maxZ: Math.max(...corners.map((p) => p.z)) };
      const points = treads.flatMap((part) => {
        const attribute = part.geometry.getAttribute("position");
        return Array.from({ length: attribute.count }, (_, index) => {
          const x = attribute.getX(index), z = attribute.getZ(index);
          return { x: stair.position[0] + x * Math.cos(stair.rotation) + z * Math.sin(stair.rotation), z: stair.position[2] - x * Math.sin(stair.rotation) + z * Math.cos(stair.rotation) };
        });
      });
      expect(Math.min(...points.map((p) => p.x))).toBeCloseTo(sourceBounds.minX, 1);
      expect(Math.max(...points.map((p) => p.x))).toBeCloseTo(sourceBounds.maxX, 1);
      expect(Math.min(...points.map((p) => p.z))).toBeCloseTo(sourceBounds.minZ, 1);
      expect(Math.max(...points.map((p) => p.z))).toBeCloseTo(sourceBounds.maxZ, 1);
      parts.forEach((part) => part.geometry.dispose());
    }
    const stair: any = { id: "unsupported", type: "stair", stairType: "future-stair", width: 1 };
    expect(buildBuilderStairParts(stair, { [stair.id]: stair })).toEqual([]);
  });

  it("adds canonical stair railings, spiral supports, center column, and integrated landing from source flags", () => {
    const spiral: any = { id: "spiral", type: "stair", stairType: "spiral", position: [0, 0, 0], width: .9, innerRadius: .55, sweepAngle: Math.PI * 1.5, stepCount: 8, totalRise: 2.4, thickness: .12, showStepSupports: true, showCenterColumn: true, railingMode: "both", railingHeight: .92, topLandingMode: "integrated", topLandingDepth: .8 };
    const parts = buildBuilderStairParts(spiral, { spiral });
    expect(parts.filter((part) => part.role === "tread")).toHaveLength(8);
    expect(parts.filter((part) => part.role === "support")).toHaveLength(8);
    expect(parts.filter((part) => part.role === "column")).toHaveLength(1);
    expect(parts.filter((part) => part.role === "landing")).toHaveLength(1);
    expect(parts.filter((part) => part.role === "rail").length).toBeGreaterThan(8);
    expect(parts.filter((part) => part.role === "baluster").length).toBeGreaterThan(8);
    parts.forEach((part) => part.geometry.dispose());
  });

  it("rotates child roof-segment offsets in the parent coordinate frame", () => {
    const actual = builderRoofSegmentTransform([2, 1, 0], [10, 4, 5], Math.PI / 2, .2);
    expect(actual.position[0]).toBeCloseTo(10);
    expect(actual.position[1]).toBe(5);
    expect(actual.position[2]).toBeCloseTo(3);
    expect(actual.rotationY).toBeCloseTo(Math.PI / 2 + .2);
  });

  it("fills Builder roof schema defaults without discarding imported future fields", () => {
    const raw: any = { id: "rseg_future", type: "roof-segment", width: 4, futureRoofField: { preserved: true } };
    const display = withBuilderRoofDefaults(raw);
    expect(display.roofType).toBe("gable"); expect(display.pitch).toBe(40); expect(display.wallHeight).toBe(.5);
    expect(display.futureRoofField).toEqual({ preserved: true }); expect(raw).toEqual({ id: "rseg_future", type: "roof-segment", width: 4, futureRoofField: { preserved: true } });
  });

  it("fills skylight schema defaults while preserving raw future values", () => {
    const raw: any = { id: "sky_future", type: "skylight", futureAccessory: "keep" }, display = withBuilderSkylightDefaults(raw);
    expect(display.width).toBeGreaterThan(0); expect(display.height).toBeGreaterThan(0); expect(display.skylightType).toBe("flat");
    expect(display.futureAccessory).toBe("keep"); expect(raw).toEqual({ id: "sky_future", type: "skylight", futureAccessory: "keep" });
    const parts = buildBuilderSkylightParts(raw);
    expect(parts.length).toBeGreaterThan(0); parts.forEach((part) => part.geometry.dispose());
  });

  it("builds pitched and folded roof volumes using source roof fields", () => {
    const base: any = { id: "roof", type: "roof-segment", roofType: "gable", width: 8, depth: 6, wallHeight: 2.7, pitch: 40, wallThickness: 0.2, deckThickness: 0.1, overhang: 0.3, shingleThickness: 0.04 };
    for (const roofType of ["gable", "hip", "shed", "gambrel", "dutch", "mansard", "flat"]) {
      const geometry = buildBuilderRoofSegmentGeometry({ ...base, roofType });
      expect(geometry, roofType).not.toBeNull();
      geometry!.computeBoundingBox();
      const bounds = geometry!.boundingBox!;
      expect(bounds.max.x - bounds.min.x, roofType).toBeGreaterThan(base.width);
      expect(bounds.max.y, roofType).toBeGreaterThan(base.wallHeight);
      geometry!.dispose();
    }
    expect(buildBuilderRoofSegmentGeometry({ ...base, roofType: "future-roof" })).toBeNull();
  });

  it("builds canonical roof geometry, applies the schema gable default, and cuts linked skylights", () => {
    const roof: any = { id: "roof", type: "roof-segment", width: 6, depth: 5, wallHeight: 2.7, pitch: 30, position: [0, 0, 0] };
    const baseline = buildCanonicalBuilderRoofGeometry(roof, { roof });
    const skylight: any = { id: "sky", type: "skylight", roofSegmentId: "roof", position: [0, 0, 0], width: 1.1, height: .8, frameThickness: .06, frameDepth: .1, cutoutOffset: .02, curb: true, curbHeight: .08, skylightType: "flat" };
    const withSkylight = buildCanonicalBuilderRoofGeometry(roof, { roof, sky: skylight });
    expect(baseline.geometry.getAttribute("position").count).toBeGreaterThan(0);
    expect(new Set(baseline.geometry.groups.map((group) => group.materialIndex))).toEqual(new Set([0, 1, 2, 3]));
    expect(withSkylight.failed, withSkylight.diagnostic).toBe(false);
    expect(withSkylight.geometry.getAttribute("position").count).not.toBe(baseline.geometry.getAttribute("position").count);
    expect(withSkylight.geometry.groups.some((group) => group.materialIndex === 3)).toBe(true);
    expect(Array.from(withSkylight.geometry.getAttribute("position").array).every(Number.isFinite)).toBe(true);
    const flatParts = buildBuilderSkylightParts(skylight), lanternParts = buildBuilderSkylightParts({ ...skylight, skylightType: "lantern" });
    expect(flatParts.filter((part) => part.role === "glazing")).toHaveLength(1);
    expect(lanternParts.filter((part) => part.role === "glazing")).toHaveLength(5);
    const closed = buildBuilderSkylightParts({ ...skylight, skylightType: "opening", openingAngle: Math.PI / 6, operationState: 0 }), opened = buildBuilderSkylightParts({ ...skylight, skylightType: "opening", openingAngle: Math.PI / 6, operationState: 1 });
    const closedPane = closed.find((part) => part.role === "glazing")!, openedPane = opened.find((part) => part.role === "glazing")!;
    expect(openedPane.position[1]).toBeGreaterThan(closedPane.position[1]); expect(openedPane.rotation?.[0]).toBeCloseTo(Math.PI / 6);
    const sliding = buildBuilderSkylightParts({ ...skylight, skylightType: "sliding", slideDirection: "x", slideFraction: 1 });
    const slidingPanes = sliding.filter((part) => part.role === "glazing");
    expect(slidingPanes).toHaveLength(2); expect(slidingPanes[0]!.position[0]).not.toBe(slidingPanes[1]!.position[0]);
    baseline.geometry.dispose(); withSkylight.geometry.dispose(); [...flatParts, ...lanternParts, ...closed, ...opened, ...sliding].forEach((part) => part.geometry.dispose());
  });
});
