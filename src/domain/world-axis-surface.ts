import type { WorldAxis } from "./drawing";
import type { RoutePoint, Vec3 } from "./overlay";
import { firstPhysicalPositioningHit, type PositioningTriangle } from "./physical-positioning-surfaces";
import { projectRoutePointToWorldAxis } from "./snapping";

export type WorldAxisHostSurfaceResolution = { kind: "arrival" | "alignment" | "none"; point: RoutePoint; normal?: Vec3 };

/** A hovered finite physical face supplies distance, while the world axis stays fixed. */
export function resolveWorldAxisHostSurface(start: RoutePoint, hit: RoutePoint, axis: WorldAxis, surfaces: readonly PositioningTriangle[]): WorldAxisHostSurfaceResolution {
  const point = projectRoutePointToWorldAxis(start, hit, axis), host = hit.attachment;
  if (!host) return { kind: "none", point };
  const normalLength = Math.hypot(...host.normal);
  if (normalLength < 1e-9) return { kind: "none", point };
  const normal = host.normal.map(value => value / normalLength) as Vec3;
  const index = axis === "x" ? 0 : axis === "y" ? 1 : 2;
  if (Math.abs(normal[index]) < 1e-9) return { kind: "alignment", point, normal };
  const distance = hit.position.reduce((sum, value, i) => sum + (value - start.position[i]) * normal[i], 0) / normal[index];
  const position = [...start.position] as Vec3;
  position[index] += distance;
  if (!position.every(Number.isFinite)) return { kind: "alignment", point, normal };
  // Reuse the actual finite surfaces, including cutouts, rather than extending
  // the hovered face into an infinite wall, beam or ceiling plane.
  const origin = position.map((value, i) => value - normal[i] * .01) as Vec3;
  const witness = firstPhysicalPositioningHit(origin, normal, surfaces, surface => surface.objectId === host.hostId);
  if (!witness || Math.hypot(...witness.point.map((value, i) => value - position[i])) > .002) return { kind: "alignment", point, normal };
  const attachment = structuredClone(host);
  if (attachment.localPosition) {
    const delta = position.map((value, i) => value - hit.position[i]) as Vec3;
    const dot = (a: Vec3, b: Vec3) => a.reduce((sum, value, i) => sum + value * b[i], 0);
    if (attachment.hostKind === "beam" && attachment.basis) {
      const u = dot(delta, attachment.basis.u), v = dot(delta, attachment.basis.v);
      if (attachment.surface === "bottom" || attachment.surface === "top") attachment.localPosition = [attachment.localPosition[0] + v, attachment.localPosition[1] + delta[1], attachment.localPosition[2] + u];
      else if (attachment.surface === "side-a" || attachment.surface === "side-b") attachment.localPosition = [attachment.localPosition[0], attachment.localPosition[1] + v, attachment.localPosition[2] + u];
      else attachment.localPosition = [attachment.localPosition[0] + u, attachment.localPosition[1] + v, attachment.localPosition[2]];
    } else if (attachment.hostKind === "wall" && attachment.basis) {
      attachment.localPosition = [attachment.localPosition[0] + dot(delta, attachment.basis.u), attachment.localPosition[1] + dot(delta, attachment.basis.v), attachment.localPosition[2] + dot(delta, normal)];
    } else if (attachment.hostKind === "ceiling" || attachment.hostKind === "slab") {
      attachment.localPosition = attachment.localPosition.map((value, i) => value + delta[i]) as Vec3;
    }
  }
  return { kind: "arrival", point: { position, attachment }, normal };
}
