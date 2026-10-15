import { describe, expect, it } from "vitest";
import { createEmptyOverlay, type ConstructionDatum, type NetworkDevice } from "./overlay";
import type { NodeData } from "../types";
import { buildPlanAnnotations, createPlanContext } from "../plan/model";
import { buildInstallationSchedule } from "../plan/construction-drawings";
import { constructionDatumFinishedFloorY, constructionDatumHeightAboveFinishMm, constructionDatumRegionAt, datumWallLineSegments, finishOffsetForRegion } from "./construction-datum";
import { decodeUnifiedProject, encodeUnifiedProject } from "./unified-project";

const datum: ConstructionDatum = {
  id: "survey:level-1", levelId: "level-1", label: "H01",
  rawReference: { kind: "slab-top", sourceObjectId: "slab-1", elevationMm: 50, basis: "explicit" },
  heightAboveRawMm: 1350, elevationMm: 1400, finishedFloorOffsetMm: 50,
  localRegionFinishOffsets: [{ regionId: "bathroom", offsetMm: -20 }],
};
const zones = {
  "level-1": { id: "level-1", type: "level", level: 0 },
  bathroom: { id: "bathroom", type: "zone", parentId: "level-1", polygon: [[0, 0, 0], [3, 0, 0], [3, 0, 3], [0, 0, 3]] },
};

function project() {
  const systems = ["ElectricalSystem", "PlumbingSystem", "LightingSystem", "HVACSystem", "SmartSystem", "WaterPurificationSystem", "BathroomSystem", "FireProtectionSystem", "IrrigationSystem", "GasSystem"];
  const nodes: Record<string, any> = {
    site: { id: "site", type: "Site", parentId: null, children: ["building", ...systems] },
    building: { id: "building", type: "Building", parentId: "site", children: ["level-1"] },
    "level-1": { id: "level-1", type: "Level", parentId: "building", children: ["slab-1", "bathroom"], constructionDatums: [{ ...structuredClone(datum), future: { retained: true }, rawReference: { ...datum.rawReference, future: { retained: true } }, localRegionFinishOffsets: [{ regionId: "bathroom", offsetMm: -20, future: { retained: true } }] }] },
    "slab-1": { id: "slab-1", type: "Slab", parentId: "level-1", elevation: .05, polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] },
    bathroom: { ...zones.bathroom, type: "Zone" },
  };
  for (const type of systems) nodes[type] = { id: type, type, parentId: "site", children: [] };
  return { schemaVersion: "4.0", pascalConduitProjectId: "datum-contract", rootNodeIds: ["site"], nodes };
}

describe("construction datum agreed contract", () => {
  it("uses one line with different finish-relative readings and includes the raw slab elevation", () => {
    expect(constructionDatumHeightAboveFinishMm(datum)).toBe(1300);
    expect(constructionDatumHeightAboveFinishMm(datum, finishOffsetForRegion(datum, "bathroom"))).toBe(1320);
    expect(constructionDatumFinishedFloorY(datum, zones, 1, 1)).toBeCloseTo(.08);
    expect(constructionDatumFinishedFloorY(datum, zones, 4, 4)).toBeCloseTo(.1);
    expect(datum.elevationMm).toBe(1400);
  });

  it("does not turn an unconfirmed common finish into zero through a local override", () => {
    const pending = { ...datum, finishedFloorOffsetMm: undefined };
    expect(finishOffsetForRegion(pending, "bathroom")).toBeUndefined();
    expect(constructionDatumHeightAboveFinishMm(pending, finishOffsetForRegion(pending, "bathroom"))).toBeNull();
    expect(constructionDatumFinishedFloorY(pending, zones, 1, 1)).toBeUndefined();
  });

  it("resolves 3D Zone polygons and avoids choosing an arbitrary overlapping region", () => {
    expect(constructionDatumRegionAt(zones, "level-1", 1, 1)).toBe("bathroom");
    expect(constructionDatumRegionAt({ ...zones, overlap: { ...zones.bathroom, id: "overlap" } }, "level-1", 1, 1)).toBeUndefined();
  });

  it("clips a stale opening outside the wall without extending the baseline beyond the wall", () => {
    const wall = { id: "wall-1", start: [0, 0], end: [4, 0], height: 2.8, thickness: .2 };
    const lines = datumWallLineSegments(datum, [wall], { "wall-1": [{ id: "door-1", type: "door", position: [10, 1.05, 0], width: 1, height: 2.1 }] }, 0);
    expect(lines).toHaveLength(2);
    for (const line of lines) for (const point of line.points) {
      expect(point[0]).toBeGreaterThanOrEqual(0);
      expect(point[0]).toBeLessThanOrEqual(4);
      expect(point[1]).toBeCloseTo(1.4);
      expect(Math.abs(point[2])).toBeGreaterThanOrEqual(.1);
    }
  });

  it("keeps a finish cleared after saving and preserves unknown datum/reference/region fields", () => {
    const opened = decodeUnifiedProject(project(), "datum.json", "sha");
    const edited = structuredClone(opened.overlay);
    delete edited.constructionDatums[0]!.finishedFloorOffsetMm;
    edited.constructionDatums[0]!.localRegionFinishOffsets[0]!.offsetMm = -30;
    const saved = encodeUnifiedProject(opened.projectRaw, edited) as any;
    const persisted = saved.nodes["level-1"].constructionDatums[0];
    expect(persisted).not.toHaveProperty("finishedFloorOffsetMm");
    expect(persisted.future).toEqual({ retained: true });
    expect(persisted.rawReference.future).toEqual({ retained: true });
    expect(persisted.localRegionFinishOffsets[0]).toMatchObject({ regionId: "bathroom", offsetMm: -30, future: { retained: true } });
    expect(decodeUnifiedProject(saved, "saved.json", "next").overlay.constructionDatums[0]!.finishedFloorOffsetMm).toBeUndefined();
  });

  it("does not add construction datums to an old project without them", () => {
    const raw = project();
    delete raw.nodes["level-1"].constructionDatums;
    const opened = decodeUnifiedProject(raw, "old.json", "sha");
    const saved = encodeUnifiedProject(opened.projectRaw, opened.overlay) as any;
    expect(saved.nodes["level-1"]).not.toHaveProperty("constructionDatums");
  });

  it("persists Drawing measurement evidence that references an embedded construction datum", () => {
    const opened = decodeUnifiedProject(project(), "drawing.json", "sha");
    opened.overlay.constructionAnnotationEvidence["height-evidence"] = {
      levelId: "level-1", sourceObjectIds: ["slab-1", "survey:level-1", "bathroom"],
      basis: { kind: "derived", reference: "height", assumptions: ["相对已确认完成面"], confidence: "high" },
    };
    const saved = encodeUnifiedProject(opened.projectRaw, opened.overlay) as any;
    expect(saved.nodes["height-evidence"]).toMatchObject({ type: "ConstructionAnnotation", sourceObjectIds: ["slab-1", "survey:level-1", "bathroom"], basis: { kind: "derived", confidence: "high" } });
    expect(decodeUnifiedProject(saved, "saved.json", "next").overlay.constructionAnnotationEvidence["height-evidence"]!.sourceObjectIds).toContain("survey:level-1");
  });

  it("uses the regional finished floor for wall installation annotations with traceable sources", () => {
    const nodes = {
      ...zones,
      "wall-1": { id: "wall-1", type: "wall", parentId: "level-1", start: [0, 0], end: [4, 0], thickness: .2, height: 2.8 },
      "slab-1": { id: "slab-1", type: "slab", parentId: "level-1", elevation: .05, polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] },
    } as unknown as Record<string, NodeData>;
    const overlay = createEmptyOverlay("annotation.json", "sha");
    overlay.constructionDatums = [structuredClone(datum)];
    overlay.devices = [{ id: "outlet-1", type: "network-device", deviceType: "socket", name: "插座", position: { position: [1, .423, .1], attachment: { hostId: "wall-1", hostKind: "wall", levelId: "level-1", surface: "front", normal: [0, 0, 1] } }, sizeMm: [86, 86, 50], orientation: [0, 0, 0], systems: ["receptacle"], ports: [], createdAt: "now" }];
    const annotation = buildPlanAnnotations(nodes, overlay, "level-1", "millimeters").annotations[0]!;
    expect(annotation.rows[0]!.height).toBe("300 mm");
    expect(annotation.evidenceSourceIds).toEqual(expect.arrayContaining(["outlet-1", "survey:level-1", "slab-1", "bathroom"]));
    expect(annotation.measurementBasis).toBe("derived");
    expect(overlay.devices[0]!.position.position).toEqual([1, .423, .1]);
  });

  it("keeps schedule device quantities separate from datum evidence sources", () => {
    const nodes = { ...zones, "slab-1": { id: "slab-1", type: "slab", parentId: "level-1", elevation: .05, polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] } } as unknown as Record<string, NodeData>;
    const overlay = createEmptyOverlay("schedule.json", "sha");
    overlay.constructionDatums = [structuredClone(datum)];
    overlay.devices = [1, 2].map((x): NetworkDevice => ({ id: `point-${x}`, type: "network-device", deviceType: "socket", name: "插座", position: { position: [x, 2.043, 1] }, mount: { kind: "reference-plane", levelId: "level-1", elevationMm: 2043 }, sizeMm: [86, 86, 50], orientation: [0, 0, 0], systems: ["receptacle"], ports: [], createdAt: "now" }));
    const row = buildInstallationSchedule(nodes, overlay, "level-1", "millimeters", createPlanContext(nodes, overlay))[0]!.rows[0]!;
    expect(row.height).toBe("1920 mm");
    expect(row.quantity).toBe(2);
    expect(row.sourceIds).toEqual(["point-1", "point-2"]);
    expect(row.evidenceSourceIds).toEqual(expect.arrayContaining(["point-1", "point-2", "survey:level-1", "slab-1", "bathroom"]));
    expect(row.measurementBasis).toBe("derived");
  });

  it("uses the same regional finished floor for a wall thermostat", () => {
    const nodes = {
      ...zones,
      "wall-1": { id: "wall-1", type: "wall", parentId: "level-1", start: [0, 0], end: [4, 0], thickness: .2, height: 2.8 },
      "slab-1": { id: "slab-1", type: "slab", parentId: "level-1", elevation: .05, polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] },
    } as unknown as Record<string, NodeData>;
    const overlay = createEmptyOverlay("thermostat.json", "sha");
    overlay.constructionDatums = [structuredClone(datum)];
    overlay.hvac.thermostats = [{ id: "thermostat-1", type: "thermostat", name: "温控器", position: { position: [1, .423, .1], attachment: { hostId: "wall-1", hostKind: "wall", levelId: "level-1", surface: "front", normal: [0, 0, 1] } }, sizeMm: [86, 86, 50], createdAt: "now" }];
    const annotation = buildPlanAnnotations(nodes, overlay, "level-1", "millimeters").annotations[0]!;
    expect(annotation.rows[0]!.height).toBe("300 mm");
    expect(annotation.evidenceSourceIds).toEqual(expect.arrayContaining(["thermostat-1", "survey:level-1", "slab-1", "bathroom"]));
  });
});
