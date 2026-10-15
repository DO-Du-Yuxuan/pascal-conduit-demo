import { describe, expect, it } from "vitest";
import { constructionDatumElevationMm, constructionDatumHeightAboveFinishMm, constructionDatumLabel, constructionDatumWallLabel, datumWallLineSegments, finishOffsetForRegion, replaceRegionFinishOffset } from "./construction-datum";
import type { ConstructionDatum } from "./overlay";
import { buildBuilderWallGeometry } from "../three/builder-wall-geometry";

const datum: ConstructionDatum = { id: "datum:level", levelId: "level", label: "H01", rawReference: { kind: "slab-top", sourceObjectId: "slab", elevationMm: 50, basis: "explicit" }, heightAboveRawMm: 1350, elevationMm: 1400, finishedFloorOffsetMm: 50, localRegionFinishOffsets: [] };

describe("construction datum", () => {
  it("keeps line height and finish-relative height as separate values", () => {
    expect(constructionDatumElevationMm(50, 1350)).toBe(1400);
    expect(constructionDatumHeightAboveFinishMm(datum)).toBe(1300);
    expect(constructionDatumWallLabel(datum)).toBe("H01 水平基线离完成面高度 1300 mm");
    expect(constructionDatumWallLabel({ ...datum, finishedFloorOffsetMm: undefined })).toContain("待设置");
    expect(constructionDatumLabel(1)).toBe("H01");
  });
  it("uses a Zone-local finish offset without moving the global datum", () => {
    const regional = replaceRegionFinishOffset(datum, "zone-a", -20);
    expect(finishOffsetForRegion(regional, "zone-a")).toBe(30);
    expect(constructionDatumHeightAboveFinishMm(regional, finishOffsetForRegion(regional, "zone-a"))).toBe(1320);
    expect(regional.elevationMm).toBe(1400);
  });
  it("splits a shared wall datum line at a door opening", () => {
    const lines = datumWallLineSegments(datum, [{ id: "wall", start: [0, 0], end: [4, 0], height: 2.5 }], { wall: [{ id: "door", type: "door", position: [2, 1.05, 0], width: 1, height: 2.1 }] }, 0);
    expect(lines).toHaveLength(4);
    expect(lines[0]!.points[lines[0]!.points.length - 1]![0]).toBeCloseTo(1.5);
    expect(lines[1]!.points[0]![0]).toBeCloseTo(2.5);
    expect(lines[0]!.points[0][2]).not.toBe(0);
  });
  it("joins straight wall datum strokes at the actual rendered L-wall miter on both sides", () => {
    const walls = [
      { id: "host", type: "wall", start: [-2, 1.5], end: [0, 1.5], height: 2.5, thickness: .1 },
      { id: "neighbor", type: "wall", start: [-2, -.5], end: [-2, 1.5], height: 2.5, thickness: .1 },
    ];
    const lines = datumWallLineSegments(datum, walls, {}, 0);
    const hostStart = lines.find(line => line.wallId === "host" && line.side === 1)!.points[0]!;
    const neighborEndPoints = lines.find(line => line.wallId === "neighbor" && line.side === 1)!.points;
    const neighborEnd = neighborEndPoints[neighborEndPoints.length - 1]!;
    const hostOtherSide = lines.find(line => line.wallId === "host" && line.side === -1)!.points[0]!;
    const neighborOtherSidePoints = lines.find(line => line.wallId === "neighbor" && line.side === -1)!.points;
    const neighborOtherSide = neighborOtherSidePoints[neighborOtherSidePoints.length - 1]!;
    const mesh = buildBuilderWallGeometry(walls[0] as any, { levelWalls: walls as any, levelY: 0 });
    const positions = mesh.getAttribute("position");
    const vertices = Array.from({ length: positions.count }, (_, index) => [positions.getX(index), positions.getY(index), positions.getZ(index)] as const);
    const renderedMiter = (x: number, z: number) => vertices.some(vertex => Math.hypot(vertex[0] - x, vertex[2] - z) < .003);

    expect(hostStart[0]).toBeCloseTo(-2.05, 6);
    expect(hostStart[2]).toBeCloseTo(1.552, 6);
    expect(Math.hypot(neighborEnd[0] - hostStart[0], neighborEnd[2] - hostStart[2])).toBeLessThan(.003);
    expect(renderedMiter(hostStart[0], hostStart[2])).toBe(true);
    expect(hostOtherSide[0]).toBeCloseTo(-1.95, 6);
    expect(hostOtherSide[2]).toBeCloseTo(1.448, 6);
    expect(Math.hypot(neighborOtherSide[0] - hostOtherSide[0], neighborOtherSide[2] - hostOtherSide[2])).toBeLessThan(.003);
    expect(renderedMiter(hostOtherSide[0], hostOtherSide[2])).toBe(true);
    mesh.dispose();
  });
});
