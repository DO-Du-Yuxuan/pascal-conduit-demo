import { isValidBeamAttachment } from "../domain/beam-routing";
import { projectRoutePointToDirection, resolveOrthogonalBeamHit, resolveOrthogonalDirection } from "../domain/snapping";
import type { RoutePoint, Vec3 } from "../domain/overlay";
import type { NodeData } from "../types";
import { transitionToAdjacentBeamFace } from "./host-transition";

/** Electrical and HVAC control routes share the same physical host transitions. */
export function resolveHostSurfaceCursor(nodes: Record<string, NodeData>, start: RoutePoint, hit: RoutePoint, orthogonal: boolean, previousDirection: Vec3 | null): RoutePoint {
  const candidate = hit.attachment?.hostKind === "beam" ? transitionToAdjacentBeamFace(start, hit) : hit;
  if (!orthogonal) return candidate;
  const direction = previousDirection ?? resolveOrthogonalDirection(start, candidate);
  if (candidate.attachment?.hostKind === "beam") {
    const along = candidate.position.reduce((sum, value, axis) => sum + (value - start.position[axis]) * direction[axis], 0);
    const toward = along < 0 ? direction.map(value => -value) as Vec3 : direction;
    const resolution = resolveOrthogonalBeamHit(start, candidate, toward);
    return resolution.kind === "arrival" && !isValidBeamAttachment(nodes, resolution.point)
      ? { position: projectRoutePointToDirection(start, candidate, direction).position, attachment: start.attachment }
      : resolution.point;
  }
  return projectRoutePointToDirection(start, candidate, direction);
}
