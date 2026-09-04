import { describe, expect, it } from "vitest";
import referenceProject from "../../sample-data/Bellevue demo.json";
import { buildAlignedDimensionDisplay, buildExteriorDimensions, dimensionDisplayGeometry, dimensionOverlayBounds, formatDimensionMetersToMillimeters, POSITION_TOLERANCE_M, signedRingArea, uprightDimensionAngle } from "./exterior-dimensions";

const level = { id: "level", type: "level" };
const wall = (id: string, start: [number, number], end: [number, number], extra: any = {}) => ({ id, type: "wall", parentId: "level", start, end, thickness: .2, ...extra });
const rectangle = (prefix = "w", x = 0, z = 0, width = 8, depth = 6) => ({
  [`${prefix}1`]: wall(`${prefix}1`, [x, z], [x + width, z]),
  [`${prefix}2`]: wall(`${prefix}2`, [x + width, z], [x + width, z + depth]),
  [`${prefix}3`]: wall(`${prefix}3`, [x + width, z + depth], [x, z + depth]),
  [`${prefix}4`]: wall(`${prefix}4`, [x, z + depth], [x, z]),
});

describe("straight exterior dimensions", () => {
  it("unions a rectangular wall footprint into one exterior component and four runs", () => {
    const report = buildExteriorDimensions({ level, ...rectangle() } as any, "level");
    expect(report.summary.exteriorComponentCount).toBe(1);
    expect(report.summary.exteriorRunCount).toBe(4);
    expect(report.summary.overallDimensionCount).toBe(4);
    expect(report.summary.innerSegmentCount).toBe(0);
    expect(report.summary.interiorRingCount).toBe(1);
  });
  it("keeps disconnected buildings as separate exterior components", () => {
    const report = buildExteriorDimensions({ level, ...rectangle("a"), ...rectangle("b", 20, 0) } as any, "level");
    expect(report.summary.exteriorComponentCount).toBe(2);
    expect(report.diagnostics.some((item) => item.code === "multiple_exterior_components")).toBe(true);
  });
  it("keeps the six real turns of a concave L footprint as independent runs", () => {
    const lWalls = {
      a: wall("a", [0, 0], [8, 0]), b: wall("b", [8, 0], [8, 3]),
      c: wall("c", [8, 3], [4, 3]), d: wall("d", [4, 3], [4, 6]),
      e: wall("e", [4, 6], [0, 6]), f: wall("f", [0, 6], [0, 0]),
    };
    const report = buildExteriorDimensions({ level, ...lWalls } as any, "level");
    expect(report.summary.exteriorRunCount).toBe(6);
    expect(report.summary.overallDimensionCount).toBe(6);
    const display = buildAlignedDimensionDisplay(report), localOverall = display.filter((item) => item.dimensionLayer === "overall" && !item.runId.includes("-frame-")), frameOverall = display.filter((item) => item.runId.includes("-frame-"));
    expect(localOverall).toHaveLength(2);
    expect(frameOverall).toHaveLength(4);
  });
  it("does not turn an internal wall into an exterior run", () => {
    const report = buildExteriorDimensions({ level, ...rectangle(), inner: wall("inner", [4, 0], [4, 6]) } as any, "level");
    expect(report.runs.some((run) => run.sourceWallIds.includes("inner"))).toBe(false);
  });
  it("creates a continuous chain from exterior Door and Window spans", () => {
    const walls = rectangle(), door = { id: "door", type: "door", parentId: "w1", wallId: "w1", position: [2, 1, 0], width: 1 }, window = { id: "window", type: "window", parentId: "w1", wallId: "w1", position: [5, 1, 0], width: 2 };
    const report = buildExteriorDimensions({ level, ...walls, door, window } as any, "level"), chain = report.dimensions.filter((item) => item.dimensionLayer === "inner-chain" && item.sourceWallIds.includes("w1"));
    expect(chain).toHaveLength(5);
    expect(chain.reduce((sum, item) => sum + item.valueMeters, 0)).toBeCloseTo(8.2, 6);
    expect(chain.find((item) => item.sourceStart.sourceNodeId === "door" && item.sourceEnd.sourceNodeId === "door")?.valueMeters).toBeCloseTo(1, 6);
    expect(chain.find((item) => item.sourceStart.sourceNodeId === "window" && item.sourceEnd.sourceNodeId === "window")?.valueMeters).toBeCloseTo(2, 6);
    expect(report.summary.exteriorDoorCount).toBe(1);
    expect(report.summary.exteriorWindowCount).toBe(1);
    expect(report.summary.chainSumMismatchCount).toBe(0);
  });
  it("sorts multiple opening edges and preserves every physical opening width", () => {
    const walls = rectangle(), openings = {
      z: { id: "z", type: "window", parentId: "w1", wallId: "w1", position: [6.5, 1, 0], width: .8 },
      a: { id: "a", type: "door", parentId: "w1", wallId: "w1", position: [1.5, 1, 0], width: .9 },
      m: { id: "m", type: "window", parentId: "w1", wallId: "w1", position: [4, 1, 0], width: 1.2 },
    };
    const report = buildExteriorDimensions({ level, ...walls, ...openings } as any, "level");
    const openingSegments = report.dimensions.filter((item) => item.dimensionLayer === "inner-chain" && item.sourceOpeningIds.length === 1 && item.sourceStart.sourceNodeId === item.sourceEnd.sourceNodeId);
    expect(openingSegments.map((item) => item.sourceOpeningIds[0])).toEqual(["a", "m", "z"]);
    expect(openingSegments[0]!.valueMeters).toBeCloseTo(.9, 9);
    expect(openingSegments[1]!.valueMeters).toBeCloseTo(1.2, 9);
    expect(openingSegments[2]!.valueMeters).toBeCloseTo(.8, 9);
    expect(report.summary.chainSumMismatchCount).toBe(0);
  });
  it("excludes an opening hosted by an interior wall", () => {
    const inner = wall("inner", [4, 0], [4, 6]), door = { id: "door", type: "door", parentId: "inner", wallId: "inner", position: [3, 1, 0], width: 1 };
    const report = buildExteriorDimensions({ level, ...rectangle(), inner, door } as any, "level");
    expect(report.summary.exteriorDoorCount).toBe(0);
    expect(report.summary.excludedInteriorOpeningCount).toBe(1);
  });
  it("supports aligned diagonal dimensions and winding-derived outward normals", () => {
    const report = buildExteriorDimensions({ level, a: wall("a", [0, 0], [4, 4]), b: wall("b", [4, 4], [8, 0]), c: wall("c", [8, 0], [0, 0]) } as any, "level");
    expect(report.runs.some((run) => Math.abs(run.direction[0]) > .6 && Math.abs(run.direction[1]) > .6)).toBe(true);
    for (const run of report.runs) expect(Math.abs(run.direction[0] * run.outwardNormal[0] + run.direction[1] * run.outwardNormal[1])).toBeLessThan(1e-9);
    expect(Math.abs(uprightDimensionAngle([-1, -1]))).toBeLessThanOrEqual(90);
  });
  it("does not dimension curved exterior segments as chords", () => {
    const report = buildExteriorDimensions({ level, ...rectangle(), w1: wall("w1", [0, 0], [8, 0], { curveOffset: 1 }) } as any, "level");
    expect(report.diagnostics.some((item) => item.code === "unsupported_curved_exterior_dimension")).toBe(true);
  });
  it("formats dimensions only at display time and exposes a metre tolerance", () => {
    expect(formatDimensionMetersToMillimeters(3.8496)).toBe("3850");
    expect(POSITION_TOLERANCE_M).toBe(.001);
    expect(signedRingArea([[0, 0], [2, 0], [2, 1], [0, 1]])).toBeGreaterThan(0);
  });
  it("includes derived annotation extents without changing any source node", () => {
    const nodes = { level, ...rectangle() } as any, before = JSON.stringify(nodes), report = buildExteriorDimensions(nodes, "level");
    expect(dimensionOverlayBounds(report).length).toBeGreaterThan(0);
    expect(JSON.stringify(nodes)).toBe(before);
  });
  it("replaces envelope-run totals with one complete overall dimension per component side", () => {
    const report = buildExteriorDimensions({ level, ...rectangle() } as any, "level"), display = buildAlignedDimensionDisplay(report), overall = display.filter((item) => item.dimensionLayer === "overall");
    expect(overall).toHaveLength(4);
    expect(overall.every((item) => item.runId.includes("-frame-"))).toBe(true);
    expect(overall.filter((item) => Math.abs(item.direction[0]) > .99).every((item) => item.valueMeters === 8.2)).toBe(true);
    expect(overall.filter((item) => Math.abs(item.direction[1]) > .99).every((item) => item.valueMeters === 6.2)).toBe(true);
  });
  it("keeps recessed concave dimensions local instead of projecting them onto the frame", () => {
    const lWalls = { a: wall("a", [0, 0], [8, 0]), b: wall("b", [8, 0], [8, 3]), c: wall("c", [8, 3], [4, 3]), d: wall("d", [4, 3], [4, 6]), e: wall("e", [4, 6], [0, 6]), f: wall("f", [0, 6], [0, 0]) }, report = buildExteriorDimensions({ level, ...lWalls, insetWindow: { id: "insetWindow", type: "window", parentId: "c", wallId: "c", position: [2, 1, 0], width: 1 } } as any, "level"), segment = buildAlignedDimensionDisplay(report).find((item) => item.dimensionLayer === "inner-chain" && item.sourceOpeningIds.includes("insetWindow"))!;
    expect(dimensionDisplayGeometry(report, segment).faceStart).toEqual(segment.start);
  });
  it("builds generic reference reports without unresolved union boundaries or source mutation", () => {
    const nodes = referenceProject.nodes as any, before = JSON.stringify(nodes), levels = Object.values(nodes).filter((node: any) => node.type === "level") as any[];
    const reports = levels.map((entry) => buildExteriorDimensions(nodes, entry.id));
    expect(reports.length).toBeGreaterThan(0);
    expect(reports.every((report) => report.summary.exteriorComponentCount > 0)).toBe(true);
    expect(reports.every((report) => report.summary.unresolvedRunCount === 0)).toBe(true);
    expect(JSON.stringify(nodes)).toBe(before);
  });
});
