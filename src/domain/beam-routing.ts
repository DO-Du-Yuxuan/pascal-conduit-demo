import type { NodeData } from "../types";
import { validateBeam, type BeamNode } from "./beams";
import type { RouteDiagnostic } from "./routing";
import type { PlannedRoute } from "./routing";
import type { RoutePoint, Vec3 } from "./overlay";
import type { ConduitOverlayDocument, Penetration } from "./overlay";
import type { PenetrationSession } from "./drawing";

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (a: Vec3) => Math.hypot(...a);
const scale = (a: Vec3, n: number): Vec3 => [a[0] * n, a[1] * n, a[2] * n];
const normalize = (a: Vec3): Vec3 => { const n = length(a); return n < 1e-9 ? [1, 0, 0] : scale(a, 1 / n); };
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const segmentDistance = (a: Vec3, b: Vec3, c: Vec3, d: Vec3) => {
  const u = sub(b, a), v = sub(d, c), w = sub(a, c), aa = dot(u, u), bb = dot(u, v), cc = dot(v, v), dd = dot(u, w), ee = dot(v, w), denominator = aa * cc - bb * bb;
  let s = denominator < 1e-10 ? 0 : clamp((bb * ee - cc * dd) / denominator), t = cc < 1e-10 ? 0 : clamp((bb * s + ee) / cc);
  s = aa < 1e-10 ? 0 : clamp((bb * t - dd) / aa);
  return length(sub([a[0] + u[0] * s, a[1] + u[1] * s, a[2] + u[2] * s], [c[0] + v[0] * t, c[1] + v[1] * t, c[2] + v[2] * t]));
};

type BeamVolume = { beam: BeamNode; origin: Vec3; axis: Vec3; side: Vec3; bottom: number; top: number; halfLength: number; halfWidth: number };
const levelId = (nodes: Record<string, NodeData>, node: NodeData) => { let current: NodeData | undefined = node; const visited = new Set<string>(); while (current && !visited.has(current.id)) { visited.add(current.id); if (current.type === "level") return current.id; current = current.parentId ? nodes[current.parentId] : undefined; } return null; };
const levelElevation = (nodes: Record<string, NodeData>, beam: BeamNode) => { const level = levelId(nodes, beam); return level ? (typeof nodes[level]?.level === "number" ? nodes[level].level : 0) * 3.2 : 0; };

/** Valid authored beams are oriented prisms, independently of renderer meshes. */
export function validBeamVolumes(nodes: Record<string, NodeData>): BeamVolume[] {
  return Object.values(nodes).flatMap((node) => {
    const checked = node.type === "beam" ? validateBeam(node, nodes) : null;
    if (!checked?.valid || !checked.beam) return [];
    const beam = checked.beam, delta: Vec3 = [beam.end[0] - beam.start[0], 0, beam.end[1] - beam.start[1]], span = length(delta), axis = normalize(delta), side: Vec3 = [-axis[2], 0, axis[0]], base = levelElevation(nodes, beam), top = base + beam.effectiveCeilingElevation.meters;
    return [{ beam, origin: [(beam.start[0] + beam.end[0]) / 2, 0, (beam.start[1] + beam.end[1]) / 2], axis, side, bottom: top - beam.height, top, halfLength: span / 2, halfWidth: beam.width / 2 }];
  });
}

/** Finds the far physical Beam face along Tab's frozen incoming direction. */
export function projectBeamPenetrationExit(nodes: Record<string, NodeData>, session: PenetrationSession): RoutePoint | null {
  if (session.host.hostKind !== "beam") return null;
  const volume = validBeamVolumes(nodes).find((item) => item.beam.id === session.host.hostId);
  if (!volume) return null;
  const start = local(volume, session.entry.position), direction: Vec3 = [dot(session.direction, volume.side), session.direction[1], dot(session.direction, volume.axis)], minimum: Vec3 = [-volume.halfWidth, volume.bottom, -volume.halfLength], maximum: Vec3 = [volume.halfWidth, volume.top, volume.halfLength];
  let far = Infinity, exitAxis = -1;
  for (let axis = 0; axis < 3; axis += 1) {
    if (Math.abs(direction[axis]) < 1e-9) continue;
    const boundary = direction[axis] > 0 ? maximum[axis] : minimum[axis], distance = (boundary - start[axis]) / direction[axis];
    if (distance > 1e-5 && distance < far) { far = distance; exitAxis = axis; }
  }
  if (!Number.isFinite(far) || exitAxis < 0) return null;
  const position: Vec3 = [session.entry.position[0] + session.direction[0] * far, session.entry.position[1] + session.direction[1] * far, session.entry.position[2] + session.direction[2] * far];
  const positive = direction[exitAxis] > 0, surface = exitAxis === 0 ? positive ? "side-b" : "side-a" : exitAxis === 1 ? positive ? "top" : "bottom" : positive ? "end-b" : "end-a";
  // A penetration may exit at the ceiling-adjacent top; it is an attachment
  // evidence record, not a targetable conduit surface.
  const normal: Vec3 = exitAxis === 0 ? scale(volume.side, positive ? 1 : -1) : exitAxis === 1 ? [0, positive ? 1 : -1, 0] : scale(volume.axis, positive ? 1 : -1);
  const delta = sub(position, volume.origin);
  return { position, attachment: { hostId: volume.beam.id, hostKind: "beam", surface, normal, levelId: volume.beam.parentId ?? null, localPosition: [dot(delta, volume.side), position[1] - levelElevation(nodes, volume.beam), dot(delta, volume.axis)], basis: { u: exitAxis === 1 ? volume.axis : exitAxis === 0 ? volume.axis : volume.side, v: exitAxis === 1 ? volume.side : [0, 1, 0] } } };
}

/** Keeps only explicit Beam holes that still describe an existing, physical passage. */
export function revalidateBeamPenetrations(nodes: Record<string, NodeData>, overlay: ConduitOverlayDocument): ConduitOverlayDocument {
  const penetrations = overlay.penetrations.filter((penetration) => {
    if (penetration.hostKind !== "beam") return true;
    if (!overlay.segments.some((segment) => segment.id === penetration.segmentId)) return false;
    const entry = penetration.entry, host = entry.attachment;
    if (!host || host.hostKind !== "beam" || host.hostId !== penetration.hostId) return false;
    const expected = projectBeamPenetrationExit(nodes, { entry, host, direction: penetration.direction, orthogonal: false });
    return Boolean(expected && Math.hypot(...expected.position.map((value, axis) => value - penetration.exit.position[axis])) < .006);
  });
  return penetrations.length === overlay.penetrations.length ? overlay : { ...overlay, penetrations };
}

const local = (volume: BeamVolume, point: Vec3): Vec3 => { const delta = sub(point, volume.origin); return [dot(delta, volume.side), point[1], dot(delta, volume.axis)]; };
const segmentHitsExpandedBox = (start: Vec3, end: Vec3, volume: BeamVolume, radius: number) => {
  const a = local(volume, start), b = local(volume, end), d = sub(b, a), minimum: Vec3 = [-volume.halfWidth - radius, volume.bottom - radius, -volume.halfLength - radius], maximum: Vec3 = [volume.halfWidth + radius, volume.top + radius, volume.halfLength + radius];
  let enter = 0, exit = 1;
  for (let axis = 0; axis < 3; axis += 1) {
    if (Math.abs(d[axis]) < 1e-9) { if (a[axis] < minimum[axis] || a[axis] > maximum[axis]) return null; continue; }
    const first = (minimum[axis] - a[axis]) / d[axis], second = (maximum[axis] - a[axis]) / d[axis];
    enter = Math.max(enter, Math.min(first, second)); exit = Math.min(exit, Math.max(first, second));
    if (enter > exit) return null;
  }
  return [start[0] + (end[0] - start[0]) * enter, start[1] + (end[1] - start[1]) * enter, start[2] + (end[2] - start[2]) * enter] as Vec3;
};

const exposedFace = (point: RoutePoint, volume: BeamVolume) => {
  const attachment = point.attachment;
  if (!attachment || attachment.hostKind !== "beam" || attachment.hostId !== volume.beam.id || attachment.surface === "top") return false;
  const p = local(volume, point.position), tolerance = .006;
  const face = attachment.surface;
  return (face === "bottom" && Math.abs(p[1] - volume.bottom) < tolerance)
    || (face === "side-a" && Math.abs(p[0] + volume.halfWidth) < tolerance)
    || (face === "side-b" && Math.abs(p[0] - volume.halfWidth) < tolerance)
    || (face === "end-a" && Math.abs(p[2] + volume.halfLength) < tolerance)
    || (face === "end-b" && Math.abs(p[2] - volume.halfLength) < tolerance);
};

const faceName = (point: RoutePoint, volume: BeamVolume) => exposedFace(point, volume) ? point.attachment!.surface : null;
const outwardDeparture = (from: RoutePoint, toward: RoutePoint, volume: BeamVolume) => {
  if (!exposedFace(from, volume)) return false;
  return dot(normalize(sub(toward.position, from.position)), from.attachment!.normal) > .001;
};

/** Beam-face runs are legal; every other solid intersection blocks ordinary routing. */
export function beamRouteDiagnostics(nodes: Record<string, NodeData>, plan: PlannedRoute, bypassHostId?: string | null): RouteDiagnostic[] {
  const diagnostics: RouteDiagnostic[] = [];
  for (const segment of plan.segments) for (const volume of validBeamVolumes(nodes)) {
    const sameFaceRun = faceName(segment.start, volume) !== null && faceName(segment.start, volume) === faceName(segment.end, volume);
    // An endpoint may leave its attached face, but a face-to-face shortcut
    // through the prism is never an implicit penetration.
    const leavesBeam = outwardDeparture(segment.start, segment.end, volume) || outwardDeparture(segment.end, segment.start, volume);
    // `planRoute` may trim a bend around the user-confirmed entry/exit, so
    // the persisted segment id is not a reliable owner of that passage.
    const explicitPassage = plan.penetrations.some((penetration) => {
      if (penetration.hostId !== volume.beam.id) return false;
      const routeDirection = normalize(sub(segment.end.position, segment.start.position)), passageDirection = normalize(sub(penetration.exit.position, penetration.entry.position));
      return Math.abs(dot(routeDirection, passageDirection)) > .999
        && segmentDistance(segment.start.position, segment.end.position, penetration.entry.position, penetration.exit.position) < (segment.diameterMm + penetration.diameterMm) / 2000 + .001;
    });
    if (bypassHostId === volume.beam.id || explicitPassage || sameFaceRun || leavesBeam) continue;
    const point = segmentHitsExpandedBox(segment.start.position, segment.end.position, volume, segment.diameterMm / 2000);
    if (point) diagnostics.push({ code: "beam_collision", message: `预览管线进入梁 ${volume.beam.name || volume.beam.id} 的实体体积。`, objectIds: [volume.beam.id], point });
  }
  return diagnostics.filter((item, index, all) => index === all.findIndex((candidate) => candidate.objectIds?.[0] === item.objectIds?.[0]));
}
