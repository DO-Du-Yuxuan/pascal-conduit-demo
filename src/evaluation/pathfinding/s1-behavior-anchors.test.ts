import { describe, expect, it } from "vitest";
import type { EvaluationHandoff } from "../../parser/evaluation-handoff";
import type { DoorPortal, RoomConnectivityGraph } from "../connectivity";
import type { Point } from "../envelope";
import type { RoomNavigationAnalysis } from "../navigation";
import type { S1HighFrequencyPathSpaceRef } from "../s1-high-frequency-path";
import { bedItemsForS1Bedroom, resolveS1BedEdgeAnchors, resolveS1GarageResidenceAnchors, resolveS1KitchenRegionAnchors, resolveS1PrimaryEntranceAnchors } from "./s1-behavior-anchors";

const ring: Point[] = [[0,0],[10,0],[10,10],[0,10]];
const room = (roomRegionId: string) => ({ roomRegionId, levelId: "L1", polygons: [[ring]], holes: [], areaSquareMeters: 100, perimeterMeters: 40, compactness: .78, geometryArtifact: false, boundaryWallIds: [], sourceObjectIds: [], pascalSourceIds: [], confidence: "high" as const, diagnostics: [], usableForEvaluation: true });
const portal = (doorId: string, primary: boolean, exterior = true): DoorPortal => ({ doorId, pascalSourceId: doorId, levelId: "L1", hostWallId: "wall", openingCenter: [0,5], openingWidthMeters: 1, openingSegment: [[0,4.5],[0,5.5]], roomRegionAId: "R", roomRegionBId: exterior ? null : "G", connectsExterior: exterior, sideAExterior: false, sideBExterior: exterior, samplePointsA: [[.3,5]], samplePointsB: [[-.3,5]], confidence: "high", diagnostics: [], usableForConnectivity: true, isPrimaryEntrance: primary });
function context(portals: DoorPortal[], withGarage = false) {
  const rooms = [room("R"), ...(withGarage ? [room("G")] : [])], zones = withGarage ? [{ id: "garage", name: "Garage", levelId: "L1", outline: ring, spaceFunctionCode: "SF30" }] : [];
  const graph = { roomAnalysis: { envelopes: [], rooms, zoneMatches: withGarage ? [{ zoneId: "garage", levelId: "L1", overlaps: [], matchedRoomRegionIds: ["G"], relationship: "one-to-one", confidence: "high", diagnostics: [] }] : [], zoneOverlaps: [], unmatchedRoomRegionIds: [], roomToZoneIds: withGarage ? { R: [], G: ["garage"] } : { R: [] }, diagnostics: [] }, portals, stairConnections: [], nodes: rooms.map((value) => ({ nodeId: value.roomRegionId, nodeType: "room", levelId: "L1", roomRegionId: value.roomRegionId })), edges: withGarage ? [{ edgeId: "edge:garage", sourceObjectId: portals[0]!.doorId, connectionType: "door", fromNodeId: "G", toNodeId: "R", levelId: "L1", confidence: "high", diagnostics: [] }] : [], entrance: { candidateDoorIds: [], selectedDoorId: null, selectedRoomRegionId: null, confidence: "low", diagnostics: [] }, diagnostics: [] } as unknown as RoomConnectivityGraph;
  const handoff = { zones, walls: [{ id: "wall", thicknessMeters: .2 }], items: [] } as unknown as EvaluationHandoff;
  const navigation = { graph, obstacles: [], rooms: [], diagnostics: [] } as RoomNavigationAnalysis;
  return { handoff, graph, navigation };
}

describe("S1-HPE behavior anchors", () => {
  it("uses the marked primary Door residential landing and refuses ambiguous markings or exterior fallback", () => {
    const one = context([portal("primary", true)]), selected = resolveS1PrimaryEntranceAnchors(one.handoff, one.graph, one.navigation);
    expect(selected.anchors[0]).toMatchObject({ anchorType: "primary_entrance_landing", sourceObjectId: "primary", roomRegionId: "R" });
    const multiple = context([portal("a", true), portal("b", true)]);
    expect(resolveS1PrimaryEntranceAnchors(multiple.handoff, multiple.graph, multiple.navigation)).toMatchObject({ anchors: [], missingData: ["唯一主要入口 Door 标记"] });
    const unmarked = context([portal("a", false), portal("b", false)]);
    expect(resolveS1PrimaryEntranceAnchors(unmarked.handoff, unmarked.graph, unmarked.navigation).anchors).toEqual([]);
  });

  it("derives Garage-to-residence sources only from real internal DoorPortals", () => {
    const p = portal("garage-door", false, false), value = context([p], true), garage: S1HighFrequencyPathSpaceRef = { roomRegionId: "G", levelId: "L1", zoneIds: ["garage"], zoneNames: ["Garage"], spaceFunctionCodes: ["SF30"], confidence: "high" };
    expect(resolveS1GarageResidenceAnchors(value.handoff, value.graph, value.navigation, garage).anchors[0]).toMatchObject({ anchorType: "garage_residence_landing", sourceObjectId: "garage-door", roomRegionId: "R" });
  });

  it("creates Kitchen boundary targets and treats each formal bed as an independent source", () => {
    const value = context([]), kitchenZone = { id: "k", name: "Kitchen", levelId: "L1", outline: [[4,4],[8,4],[8,8],[4,8]] as Point[], spaceFunctionCode: "SF01" }, bedroomZone = { id: "b", name: "Bedroom", levelId: "L1", outline: ring, spaceFunctionCode: "SF13" };
    (value.handoff.zones as any[]).push(kitchenZone, bedroomZone);
    (value.handoff.items as any[]).push({ id: "bed-a", levelId: "L1", functionTags: ["beds"], dimensionsMeters: [2,1,.9], resolvedWorldPosition: [3,3], resolvedRotationRadians: 0 }, { id: "bed-b", levelId: "L1", functionTags: ["beds"], dimensionsMeters: [1,1,2], resolvedWorldPosition: [7,3], resolvedRotationRadians: 0 }, { id: "square", levelId: "L1", functionTags: ["beds"], dimensionsMeters: [1,1,1], resolvedWorldPosition: [5,7], resolvedRotationRadians: 0 });
    const kitchen: S1HighFrequencyPathSpaceRef = { roomRegionId: "R", levelId: "L1", zoneIds: ["k"], zoneNames: ["Kitchen"], spaceFunctionCodes: ["SF01"], confidence: "high" }, bedroom: S1HighFrequencyPathSpaceRef = { roomRegionId: "R", levelId: "L1", zoneIds: ["b"], zoneNames: ["Bedroom"], spaceFunctionCodes: ["SF13"], confidence: "high" };
    const targets = resolveS1KitchenRegionAnchors(value.handoff, value.graph, value.navigation, kitchen);
    expect(targets.anchors.length).toBeGreaterThan(4); expect(targets.anchors.every((anchor) => anchor.anchorType === "kitchen_zone_entry" && anchor.zoneId === "k")).toBe(true);
    expect(bedItemsForS1Bedroom(value.handoff, bedroom).map((item) => item.id)).toEqual(["bed-a", "bed-b", "square"]);
    expect(resolveS1BedEdgeAnchors(value.handoff, value.graph, value.navigation, bedroom, "bed-a").anchors.length).toBeGreaterThan(0);
    expect(resolveS1BedEdgeAnchors(value.handoff, value.graph, value.navigation, bedroom, "bed-b").anchors.length).toBeGreaterThan(0);
    expect(resolveS1BedEdgeAnchors(value.handoff, value.graph, value.navigation, bedroom, "square").anchors.length).toBeGreaterThan(0);
  });

  it("uses the resolved local Z direction for bed head-to-foot and samples only its perpendicular local X sides", () => {
    const value = context([]), bedroomZone = { id: "b", name: "Bedroom", levelId: "L1", outline: ring, spaceFunctionCode: "SF13" };
    (value.handoff.zones as any[]).push(bedroomZone);
    const bedroom: S1HighFrequencyPathSpaceRef = { roomRegionId: "R", levelId: "L1", zoneIds: ["b"], zoneNames: ["Bedroom"], spaceFunctionCodes: ["SF13"], confidence: "high" };
    const anchorsFor = (id: string, rotation: number) => {
      (value.handoff.items as any[]).splice(0, 1, { id, levelId: "L1", functionTags: ["beds"], dimensionsMeters: [2,1,4], resolvedWorldPosition: [5,5], resolvedRotationRadians: rotation });
      return resolveS1BedEdgeAnchors(value.handoff, value.graph, value.navigation, bedroom, id).anchors.map((anchor) => anchor.point);
    };
    const zero = anchorsFor("zero", 0), rightAngle = anchorsFor("right-angle", Math.PI / 2), diagonal = anchorsFor("diagonal", Math.PI / 4);
    expect(zero).toEqual(expect.arrayContaining([[3.79,4],[3.79,5],[3.79,6],[6.21,4],[6.21,5],[6.21,6]]));
    expect(rightAngle).toEqual(expect.arrayContaining([[4,6.21],[5,6.21],[6,6.21],[4,3.79],[5,3.79],[6,3.79]]));
    expect(diagonal.every(([x, z]) => {
      const dx = x - 5, dz = z - 5, c = Math.cos(Math.PI / 4), s = Math.sin(Math.PI / 4), localX = dx * c - dz * s, localZ = dx * s + dz * c;
      return Math.abs(Math.abs(localX) - 1.21) < 1e-9 && [-1, 0, 1].some((value) => Math.abs(localZ - value) < 1e-9);
    })).toBe(true);
  });

  it("returns unable only when the formal world direction is actually unavailable", () => {
    const value = context([]), bedroomZone = { id: "b", name: "Bedroom", levelId: "L1", outline: ring, spaceFunctionCode: "SF13" };
    (value.handoff.zones as any[]).push(bedroomZone);
    (value.handoff.items as any[]).push({ id: "bad-direction", levelId: "L1", functionTags: ["beds"], dimensionsMeters: [2,1,2], resolvedWorldPosition: [5,5], resolvedRotationRadians: null });
    const bedroom: S1HighFrequencyPathSpaceRef = { roomRegionId: "R", levelId: "L1", zoneIds: ["b"], zoneNames: ["Bedroom"], spaceFunctionCodes: ["SF13"], confidence: "high" };
    expect(resolveS1BedEdgeAnchors(value.handoff, value.graph, value.navigation, bedroom, "bad-direction")).toMatchObject({ anchors: [], missingData: ["bad-direction: bed center / resolvedRotationRadians / footprint"] });
  });
});
