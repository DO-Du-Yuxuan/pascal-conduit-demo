import polygonClipping from "polygon-clipping";
import type { EvaluationHandoff } from "../parser/evaluation-handoff";
import { rectangularFootprint, type Point, type Ring } from "./envelope";
import { G1_GEOMETRY_TOLERANCES as T } from "./tolerances";
import { hasFunctionTag, placementRoleOf } from "./object-semantics";

export type Obstacle = { objectId: string; pascalSourceId: string; levelId: string | null; objectType: "wall" | "column" | "shaft" | "fixed-cabinet" | "furniture" | "equipment"; rawCategory: string | null; footprint: Ring; mobility: "fixed" | "movable" | "unknown"; classificationConfidence: "high" | "medium" | "low"; diagnostics: string[]; usableForCollision: boolean };
export type DoorLeafOperation = { leafIndex: number; hingePoint: Point; closedLeafSegment: [Point, Point]; openLeafSegment: [Point, Point]; swingPolygon: Ring; requiredSwingPolygon: Ring };
export type DoorOperation = { doorId: string; pascalSourceId: string; levelId: string | null; hostWallId: string | null; hingePoint: Point | null; portalSegment: [Point, Point] | null; closedLeafSegment: [Point, Point] | null; openLeafSegment: [Point, Point] | null; swingPolygon: Ring; requiredSwingPolygon: Ring; leaves: DoorLeafOperation[]; entryPolygon: Ring; openingAngleRadians: number | null; confidence: "high" | "medium" | "low"; diagnostics: string[]; usableForEvaluation: boolean };
const obstacleCache = new WeakMap<object, Obstacle[]>(), doorOperationCache = new WeakMap<object, DoorOperation[]>();
const closed = (ring: Ring) => ring.length > 2 ? [...ring, ring[0]!] : ring;
const area = (ring: Ring) => Math.abs(ring.reduce((sum, point, index) => { const next = ring[(index + 1) % ring.length]!; return sum + point[0] * next[1] - next[0] * point[1]; }, 0) / 2);
export const intersectionArea = (a: Ring, b: Ring) => { try { return (polygonClipping.intersection([closed(a)] as any, [closed(b)] as any) as Ring[][]).reduce((sum, polygon) => sum + area(polygon[0] ?? []), 0); } catch { return null; } };
const rectangle = (a: Point, b: Point, depth: number): Ring => { const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz); if (length <= T.lengthMeters) return []; const nx = -dz / length * depth / 2, nz = dx / length * depth / 2; return [[a[0] + nx, a[1] + nz], [b[0] + nx, b[1] + nz], [b[0] - nx, b[1] - nz], [a[0] - nx, a[1] - nz]]; };
const sector = (hinge: Point, radius: number, start: number, end: number): Ring => { const steps = 18, direction = end >= start ? 1 : -1; return [hinge, ...Array.from({ length: steps + 1 }, (_, index) => { const angle = start + direction * Math.abs(end - start) * index / steps; return [hinge[0] + Math.cos(angle) * radius, hinge[1] + Math.sin(angle) * radius] as Point; })]; };

export function buildObstacles(handoff: EvaluationHandoff): Obstacle[] {
  const cached = obstacleCache.get(handoff);
  if (cached) return cached;
  const walls = handoff.walls.map((wall) => ({ objectId: wall.id, pascalSourceId: wall.rawPascalId, levelId: wall.levelId, objectType: "wall" as const, rawCategory: null, footprint: wall.footprintValidation.footprint as Ring, mobility: "fixed" as const, classificationConfidence: "high" as const, diagnostics: wall.footprintValidation.valid ? [] : ["wall_footprint_invalid"], usableForCollision: wall.footprintValidation.valid }));
  const items = (handoff.items ?? [...handoff.furniture, ...handoff.equipment, ...handoff.columns]).map((item) => { const footprint = rectangularFootprint(item), role = placementRoleOf(item), isColumn = hasFunctionTag(item, "columns") && role === "other", objectType: Obstacle["objectType"] = isColumn ? "column" : role === "fixed" ? "equipment" : "furniture", mobility: Obstacle["mobility"] = isColumn || role === "fixed" ? "fixed" : ["placed-furniture", "light-movable"].includes(role) ? "movable" : "unknown", classificationConfidence: Obstacle["classificationConfidence"] = role === "other" ? "low" : "high"; return { objectId: item.id, pascalSourceId: item.rawPascalId, levelId: item.levelId, objectType, rawCategory: item.category ?? null, footprint: footprint ?? [], mobility, classificationConfidence, diagnostics: [...(footprint ? [] : ["item_footprint_unavailable"]), ...(role === "other" ? ["function_tag_semantics_unresolved"] : []), ...(role === "vehicle" ? ["vehicle_excluded"] : []), ...(role === "light-movable" ? ["light_movable_excluded_from_hard_blocking"] : [])], usableForCollision: Boolean(footprint && !["other", "vehicle", "light-movable"].includes(role)) }; });
  const shelves = handoff.shelves.map((shelf) => { const reliableSemantic = hasFunctionTag(shelf, "bookshelf", "bookshelves", "open-rack", "open-shelf"); return { objectId: shelf.id, pascalSourceId: shelf.rawPascalId, levelId: shelf.levelId, objectType: "fixed-cabinet" as const, rawCategory: shelf.style ?? null, footprint: shelf.footprint as Ring, mobility: "fixed" as const, classificationConfidence: reliableSemantic ? "high" as const : "low" as const, diagnostics: [...(shelf.footprint.length >= 3 ? [] : ["shelf_footprint_unavailable"]), ...(reliableSemantic ? [] : ["shelf_function_tag_unresolved"])], usableForCollision: shelf.footprint.length >= 3 && reliableSemantic }; });
  const shafts = handoff.shafts.map((shaft) => ({ objectId: shaft.id, pascalSourceId: shaft.rawPascalId, levelId: shaft.levelId, objectType: "shaft" as const, rawCategory: null, footprint: shaft.outline as Ring, mobility: "fixed" as const, classificationConfidence: "high" as const, diagnostics: shaft.outline.length >= 3 ? [] : ["shaft_footprint_unavailable"], usableForCollision: shaft.outline.length >= 3 }));
  const obstacles = [...walls, ...items, ...shelves, ...shafts];
  obstacleCache.set(handoff, obstacles);
  return obstacles;
}

export function buildDoorOperations(handoff: EvaluationHandoff): DoorOperation[] {
  const cached = doorOperationCache.get(handoff);
  if (cached) return cached;
  const walls = new Map(handoff.walls.map((wall) => [wall.id, wall]));
  const operations: DoorOperation[] = handoff.doors.map((door) => {
    const wall = door.hostWallId ? walls.get(door.hostWallId) : undefined, diagnostics: string[] = [];
    if (door.doorType !== "hinged" && door.doorType !== "double" && door.doorType !== "french") return { doorId: door.id, pascalSourceId: door.rawPascalId, levelId: door.levelId, hostWallId: door.hostWallId, hingePoint: null, portalSegment: null, closedLeafSegment: null, openLeafSegment: null, swingPolygon: [], requiredSwingPolygon: [], leaves: [], entryPolygon: [], openingAngleRadians: null, confidence: "high", diagnostics: ["non_swing_door_not_applicable"], usableForEvaluation: false };
    const hingesSide = door.effectiveHingesSide ?? door.hingesSide, swingDirection = door.effectiveSwingDirection ?? door.swingDirection;
    if (!wall?.start || !wall.end || Math.abs(wall.curveOffsetMeters) > T.lengthMeters || !door.resolvedWorldPosition || !Number.isFinite(door.widthMeters) || !hingesSide || !swingDirection || !Number.isFinite(door.swingAngleRadians) || (door.swingAngleRadians ?? 0) < T.doorOperationMinimumAngleRadians) {
      return { doorId: door.id, pascalSourceId: door.rawPascalId, levelId: door.levelId, hostWallId: door.hostWallId, hingePoint: null, portalSegment: null, closedLeafSegment: null, openLeafSegment: null, swingPolygon: [], requiredSwingPolygon: [], leaves: [], entryPolygon: [], openingAngleRadians: door.swingAngleRadians, confidence: "low", diagnostics: ["door_operation_data_unavailable"], usableForEvaluation: false };
    }
    const [sx, sz] = wall.start, [ex, ez] = wall.end, length = Math.hypot(ex - sx, ez - sz); if (length <= T.lengthMeters) return { doorId: door.id, pascalSourceId: door.rawPascalId, levelId: door.levelId, hostWallId: door.hostWallId, hingePoint: null, portalSegment: null, closedLeafSegment: null, openLeafSegment: null, swingPolygon: [], requiredSwingPolygon: [], leaves: [], entryPolygon: [], openingAngleRadians: door.swingAngleRadians, confidence: "low", diagnostics: ["host_wall_invalid"], usableForEvaluation: false };
    const tx = (ex - sx) / length, tz = (ez - sz) / length, width = door.widthMeters!, center = door.resolvedWorldPosition as Point, hinge: Point = hingesSide === "left" ? [center[0] - tx * width / 2, center[1] - tz * width / 2] : [center[0] + tx * width / 2, center[1] + tz * width / 2], closedEnd: Point = hingesSide === "left" ? [center[0] + tx * width / 2, center[1] + tz * width / 2] : [center[0] - tx * width / 2, center[1] - tz * width / 2];
    const closedAngle = Math.atan2(closedEnd[1] - hinge[1], closedEnd[0] - hinge[0]),
      swingSide = swingDirection === "inward" ? 1 : -1,
      // A right-hinged leaf starts along the opposite wall tangent, so it must
      // rotate with the opposite sign to reach the same inward/outward side.
      rotationSign = swingSide * (hingesSide === "left" ? 1 : -1),
      openAngle = closedAngle + rotationSign * door.swingAngleRadians!,
      openEnd: Point = [hinge[0] + Math.cos(openAngle) * width, hinge[1] + Math.sin(openAngle) * width];
    const portalStart: Point = [center[0] - tx * width / 2, center[1] - tz * width / 2], portalEnd: Point = [center[0] + tx * width / 2, center[1] + tz * width / 2], requiredAngle = closedAngle + rotationSign * Math.min(door.swingAngleRadians!, T.doorOperationMinimumAngleRadians);
    if (door.doorType === "double" || door.doorType === "french") {
      const leafWidth = width / 2, commonSide = swingSide, leafSpecs: Array<{ hinge: Point; end: Point; rotationSign: number }> = [{ hinge: portalStart, end: center, rotationSign: commonSide }, { hinge: portalEnd, end: center, rotationSign: -commonSide }];
      const leaves = leafSpecs.map(({ hinge: leafHinge, end, rotationSign }, leafIndex) => { const leafClosedAngle = Math.atan2(end[1] - leafHinge[1], end[0] - leafHinge[0]), leafOpenAngle = leafClosedAngle + rotationSign * door.swingAngleRadians!, leafRequiredAngle = leafClosedAngle + rotationSign * Math.min(door.swingAngleRadians!, T.doorOperationMinimumAngleRadians), leafOpenEnd: Point = [leafHinge[0] + Math.cos(leafOpenAngle) * leafWidth, leafHinge[1] + Math.sin(leafOpenAngle) * leafWidth]; return { leafIndex, hingePoint: leafHinge, closedLeafSegment: [leafHinge, end] as [Point, Point], openLeafSegment: [leafHinge, leafOpenEnd] as [Point, Point], swingPolygon: sector(leafHinge, leafWidth, leafClosedAngle, leafOpenAngle), requiredSwingPolygon: sector(leafHinge, leafWidth, leafClosedAngle, leafRequiredAngle) }; });
      return { doorId: door.id, pascalSourceId: door.rawPascalId, levelId: door.levelId, hostWallId: door.hostWallId, hingePoint: null, portalSegment: [portalStart, portalEnd], closedLeafSegment: null, openLeafSegment: null, swingPolygon: [], requiredSwingPolygon: [], leaves, entryPolygon: rectangle(portalStart, portalEnd, T.doorEntryDepthMeters * 2), openingAngleRadians: door.swingAngleRadians, confidence: "medium", diagnostics: ["double_door_equal_leaf_assumption"], usableForEvaluation: true };
    }
    const leaf = { leafIndex: 0, hingePoint: hinge, closedLeafSegment: [hinge, closedEnd] as [Point, Point], openLeafSegment: [hinge, openEnd] as [Point, Point], swingPolygon: sector(hinge, width, closedAngle, openAngle), requiredSwingPolygon: sector(hinge, width, closedAngle, requiredAngle) };
    return { doorId: door.id, pascalSourceId: door.rawPascalId, levelId: door.levelId, hostWallId: door.hostWallId, hingePoint: hinge, portalSegment: [portalStart, portalEnd], closedLeafSegment: leaf.closedLeafSegment, openLeafSegment: leaf.openLeafSegment, swingPolygon: leaf.swingPolygon, requiredSwingPolygon: leaf.requiredSwingPolygon, leaves: [leaf], entryPolygon: rectangle(portalStart, portalEnd, T.doorEntryDepthMeters * 2), openingAngleRadians: door.swingAngleRadians, confidence: "medium", diagnostics, usableForEvaluation: true };
  });
  doorOperationCache.set(handoff, operations);
  return operations;
}

export const doorLeafFootprint = (operation: DoorOperation, state: "closed" | "open") => {
  const segment = state === "open" ? operation.openLeafSegment : operation.closedLeafSegment;
  return segment ? rectangle(segment[0], segment[1], T.doorLeafThicknessMeters) : [];
};
export const doorLeafFootprints = (operation: DoorOperation, state: "closed" | "open") => operation.leaves.map((leaf) => rectangle(state === "open" ? leaf.openLeafSegment[0] : leaf.closedLeafSegment[0], state === "open" ? leaf.openLeafSegment[1] : leaf.closedLeafSegment[1], T.doorLeafThicknessMeters));
