import { describe, expect, it } from "vitest";
import referenceProject from "../../sample-data/Bellevue demo.json";
import passingProject from "../../sample-data/Bellevue passing demo.json";
import sampleHandoff from "../../fixtures/evaluation/sample-normalized-plan.json";
import { parseProject } from "./parse";
import { buildEvaluationHandoff } from "./evaluation-handoff";
import { buildDoorOperations } from "../evaluation/door-operations";

describe("evaluation handoff projection", () => {
  it("preserves Pascal IDs while exposing evaluator-facing objects and relationships", () => {
    const parsed = parseProject(referenceProject), handoff = buildEvaluationHandoff(parsed);
    expect(handoff.schemaVersion).toBe("1.0");
    expect(handoff.levels.length).toBeGreaterThan(1);
    expect(handoff.zones.length).toBeGreaterThan(1);
    expect(handoff.ceilings.length).toBeGreaterThan(1);
    expect(handoff.ceilings[0]).toEqual(expect.objectContaining({ outline: expect.any(Array), heightMeters: expect.any(Number), autoFromWalls: expect.any(Boolean) }));
    expect(handoff.walls.length).toBeGreaterThan(0);
    expect(handoff.doors.length).toBeGreaterThan(0);
    expect(handoff.windows.length).toBeGreaterThan(0);
    expect(handoff.furniture.length).toBeGreaterThan(0);
    expect(handoff.items).toHaveLength(handoff.furniture.length + handoff.equipment.length + handoff.columns.length);
    expect(handoff.furniture.find((item) => item.id === "item_0aahggnuvs15c6lx")).toMatchObject({ assetId: "double-bed", assetName: "Double Bed", category: "double-beds", functionTags: ["double-beds"], assetTags: expect.arrayContaining(["bed", "double"]) });
    expect(handoff.equipment.length).toBeGreaterThan(0);
    expect(handoff.shelves.length).toBeGreaterThan(0);
    expect(handoff.shelves.every((shelf) => Array.isArray(shelf.footprint))).toBe(true);
    expect(handoff.shelves.every((shelf) => shelf.functionTags.length > 0)).toBe(true);
    const openable = handoff.items.find((item) => item.openingDirections.length > 0)!;
    expect(openable).toMatchObject({ openingDirections: ["front"], rawMaxOpeningDepthMeters: expect.any(Number), rawMinOpeningUseClearanceMeters: expect.any(Number), itemScale: expect.any(Array) });
    expect(handoff.stairs.length).toBeGreaterThan(0);
    expect(handoff.stairs[0].footprint).toEqual(expect.any(Array));
    expect(handoff.walls[0].rawPascalId).toBe(handoff.walls[0].id);
    expect(handoff.walls[0].footprintValidation).toEqual(expect.objectContaining({ valid: expect.any(Boolean), codes: expect.any(Array), areaSquareMeters: expect.any(Number), footprint: expect.any(Array) }));
    expect(handoff.relationships.hostedOpenings.length).toBeGreaterThan(0);
    expect(handoff.relationships.levelMembership.length).toBeGreaterThan(0);
  });

  it("keeps the checked-in handoff fixture structurally representative", () => {
    expect(sampleHandoff.schemaVersion).toBe("1.0");
    expect(sampleHandoff.levels.length).toBeGreaterThan(1);
    expect(sampleHandoff.zones.length).toBeGreaterThan(1);
    expect(sampleHandoff.spaces.length).toBeGreaterThan(0);
    expect(sampleHandoff.walls.length).toBeGreaterThan(0);
    expect(sampleHandoff.walls.every((wall) => Array.isArray(wall.footprintValidation.footprint))).toBe(true);
    expect(sampleHandoff.doors.length).toBeGreaterThan(0);
    expect(sampleHandoff.windows.length).toBeGreaterThan(0);
    expect(sampleHandoff.furniture.length).toBeGreaterThan(0);
    expect(sampleHandoff.equipment.length).toBeGreaterThan(0);
    expect(sampleHandoff.stairs.length).toBeGreaterThan(0);
    expect(sampleHandoff.doors[0].rawPascalId).toBe(sampleHandoff.doors[0].id);
    expect(sampleHandoff.relationships.hostedOpenings.length).toBeGreaterThan(0);
  });

  it("does not turn missing Pascal door-operation fields into evaluator facts", () => {
    const project = structuredClone(referenceProject) as any, rawDoor = Object.values(project.nodes).find((node: any) => node.type === "door") as any;
    delete rawDoor.hingesSide;
    delete rawDoor.swingDirection;
    const handoff = buildEvaluationHandoff(parseProject(project)), door = handoff.doors.find((candidate) => candidate.id === rawDoor.id)!;
    expect(door).toMatchObject({ hingesSide: null, swingDirection: null, effectiveHingesSide: null, effectiveSwingDirection: null });
    expect(buildDoorOperations(handoff).find((operation) => operation.doorId === rawDoor.id)).toMatchObject({ usableForEvaluation: false, diagnostics: ["door_operation_data_unavailable"] });
  });

  it("projects isPrimaryEntrance only from Door nodes into the evaluator handoff", () => {
    const project = structuredClone(referenceProject) as any, doors = Object.values(project.nodes).filter((node: any) => node.type === "door") as any[];
    doors[0].isPrimaryEntrance = true;
    const nonDoor = Object.values(project.nodes).find((node: any) => node.type !== "door") as any;
    nonDoor.isPrimaryEntrance = true;
    const parsed = parseProject(project), handoff = buildEvaluationHandoff(parsed);
    expect(handoff.doors.find((door) => door.id === doors[0].id)?.isPrimaryEntrance).toBe(true);
    expect(parsed.nodes[nonDoor.id]?.isPrimaryEntrance).toBeUndefined();
    expect(parsed.diagnostics).toContainEqual(expect.objectContaining({ code: "primary_entrance_on_non_door", nodeId: nonDoor.id }));
  });

  it("projects optional valid SF codes and their standard Chinese names from Zones only", () => {
    const parsed = parseProject(passingProject), handoff = buildEvaluationHandoff(parsed);
    expect(handoff.zones.find((zone) => zone.name === "OPEN KITCHEN")).toMatchObject({ spaceFunctionCode: "SF01", spaceFunctionName: "开放厨房" });
    expect(handoff.zones.find((zone) => zone.name === "MASTER BEDROOM")).toMatchObject({ spaceFunctionCode: "SF11", spaceFunctionName: "主卧室" });
    expect(handoff.zones.find((zone) => zone.name === "OPEN TO BELOW")).toMatchObject({ spaceFunctionCode: null, spaceFunctionName: null });
    expect([...new Set(handoff.zones.flatMap((zone) => zone.spaceFunctionCode ? [zone.spaceFunctionCode] : []))].sort()).toEqual(["SF01", "SF03", "SF04", "SF05", "SF06", "SF07", "SF08", "SF09", "SF11", "SF13", "SF14", "SF15", "SF16", "SF18", "SF19", "SF24", "SF25", "SF27", "SF30", "SF34", "SF35", "SF36"]);
    expect([...handoff.doors, ...handoff.furniture].some((node) => "spaceFunctionCode" in node)).toBe(false);
  });

  it("keeps old Zones compatible and reports unknown codes without dropping the Zone", () => {
    const old = buildEvaluationHandoff(parseProject(referenceProject));
    expect(old.zones.filter((zone) => zone.spaceFunctionCode !== null)).toHaveLength(29);
    expect(old.zones.filter((zone) => zone.spaceFunctionCode === null)).toHaveLength(2);
    const project = structuredClone(referenceProject) as any, zone = Object.values(project.nodes).find((node: any) => node.type === "zone") as any;
    zone.spaceFunctionCode = "SF99";
    const parsed = parseProject(project), handoff = buildEvaluationHandoff(parsed);
    expect(handoff.zones.find((candidate) => candidate.id === zone.id)).toMatchObject({ spaceFunctionCode: "SF99", spaceFunctionName: null });
    expect(parsed.diagnostics).toContainEqual(expect.objectContaining({ code: "unknown_space_function_code", nodeId: zone.id }));
  });

  it("removes spaceFunctionCode from non-Zone nodes with a diagnostic", () => {
    const project = structuredClone(referenceProject) as any, door = Object.values(project.nodes).find((node: any) => node.type === "door") as any;
    door.spaceFunctionCode = "SF01";
    const parsed = parseProject(project);
    expect(parsed.nodes[door.id]?.spaceFunctionCode).toBeUndefined();
    expect(parsed.diagnostics).toContainEqual(expect.objectContaining({ code: "space_function_code_on_non_zone", nodeId: door.id }));
  });
});
