import type { DeviceFrame, NetworkPort, RoutePoint, RoutingSystem, Vec3 } from "./overlay";

export const SOURCE_PORTS_PER_EDGE = 10;
const SOURCE_PORT_EDGE_INSET = .045;
const SOURCE_PORT_LANE_SPACING = .035;
const SOURCE_PORT_FACE_CLEARANCE = .013;

const add = (left: Vec3, right: Vec3): Vec3 => [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
const scale = (value: Vec3, amount: number): Vec3 => [value[0] * amount, value[1] * amount, value[2] * amount];
const cross = (left: Vec3, right: Vec3): Vec3 => [left[1] * right[2] - left[2] * right[1], left[2] * right[0] - left[0] * right[2], left[0] * right[1] - left[1] * right[0]];
const normalize = (value: Vec3): Vec3 => { const length = Math.hypot(...value); return length > 1e-9 ? [value[0] / length, value[1] / length, value[2] / length] : [0, 0, 1]; };

const sourcePortEdge = (index: number, dualSided: boolean) => dualSided && Math.floor(index / SOURCE_PORTS_PER_EDGE) % 2 === 1 ? "top" : "bottom";

export function sourcePortPosition(position: RoutePoint, index: number, _systemIndex = 0, _systemCount = 1, sizeMm: [number, number, number] = [500, 600, 120], frame?: DeviceFrame, dualSided = false): RoutePoint {
  const normal = normalize(frame?.front ?? position.attachment?.normal ?? [0, 0, 1]), fallbackU = Math.abs(normal[1]) < .9 ? normalize(cross([0, 1, 0], normal)) : [1, 0, 0] as Vec3;
  const u = normalize(frame?.right ?? position.attachment?.basis?.u ?? fallbackU), v = normalize(frame?.up ?? position.attachment?.basis?.v ?? cross(normal, u));
  const width = sizeMm[0] / 1000, height = sizeMm[1] / 1000, depth = sizeMm[2] / 1000;
  const column = index % SOURCE_PORTS_PER_EDGE, overflowRow = Math.floor(index / (dualSided ? SOURCE_PORTS_PER_EDGE * 2 : SOURCE_PORTS_PER_EDGE));
  const usableWidth = Math.max(0, width - SOURCE_PORT_EDGE_INSET * 2), pitch = SOURCE_PORTS_PER_EDGE <= 1 ? 0 : usableWidth / (SOURCE_PORTS_PER_EDGE - 1);
  const offsetU = (column - (SOURCE_PORTS_PER_EDGE - 1) / 2) * pitch;
  // Electrical systems share the same physical holes. Keep every real route
  // anchor on the room-facing side instead of separating systems through the wall depth.
  const offsetNormal = depth / 2 + SOURCE_PORT_FACE_CLEARANCE + overflowRow * SOURCE_PORT_LANE_SPACING;
  const edgeOffset = sourcePortEdge(index, dualSided) === "top" ? height / 2 + .012 : -(height / 2 + .012);
  return { position: add(add(add(position.position, scale(v, edgeOffset)), scale(u, offsetU)), scale(normal, offsetNormal)), ...(position.attachment ? { attachment: structuredClone(position.attachment) } : {}) };
}

export function sourcePortTemplate(deviceId: string, position: RoutePoint, direction: Vec3, system: RoutingSystem, index: number, systemIndex: number, systemCount: number, sizeMm: [number, number, number] = [500, 600, 120], frame?: DeviceFrame, dualSided = false): NetworkPort {
  const normal = normalize(frame?.front ?? direction), fallbackU = Math.abs(normal[1]) < .9 ? normalize(cross([0, 1, 0], normal)) : [1, 0, 0] as Vec3, up = normalize(frame?.up ?? position.attachment?.basis?.v ?? cross(normal, normalize(frame?.right ?? position.attachment?.basis?.u ?? fallbackU)));
  const edgeDirection = sourcePortEdge(index, dualSided) === "top" ? up : scale(up, -1);
  return { id: index === 0 ? `${deviceId}:port:${systemIndex}` : `${deviceId}:port:source:${system}:${index}`, owner: { kind: "device", id: deviceId }, position: sourcePortPosition(position, index, systemIndex, systemCount, sizeMm, frame, dualSided), direction: edgeDirection, role: "source", system, connectedSegmentIds: [], flow: "unknown" };
}
