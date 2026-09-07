import type { DeviceFrame, NetworkPort, NetworkPortRole, NetworkOwnerKind, RoutePoint, RoutingSystem, Vec3 } from "./overlay";

const normalize = (value: Vec3): Vec3 => { const length = Math.hypot(...value); return length < 1e-9 ? [0, 1, 0] : value.map((item) => item / length) as Vec3; };
const add = (a: Vec3, b: Vec3): Vec3 => a.map((value, axis) => value + b[axis]) as Vec3;
const scale = (value: Vec3, amount: number): Vec3 => value.map((item) => item * amount) as Vec3;
const subtract = (a: Vec3, b: Vec3): Vec3 => a.map((value, axis) => value - b[axis]) as Vec3;
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export function boxFrame(position: RoutePoint, tangent?: Vec3): DeviceFrame {
  const hostFront = position.attachment?.hostKind === "wall" ? position.attachment.normal : undefined;
  const fallbackFront = tangent && Math.abs(tangent[1]) < .96 ? normalize(cross(tangent, [0, 1, 0])) : [0, 0, 1] as Vec3;
  const front = normalize(hostFront ?? position.attachment?.normal ?? fallbackFront);
  const preferredUp: Vec3 = [0, 1, 0], projected = subtract(preferredUp, scale(front, dot(preferredUp, front)));
  const up = Math.hypot(...projected) > 1e-6 ? normalize(projected) : normalize(cross(front, [1, 0, 0]));
  return { front, up, right: normalize(cross(up, front)) };
}

export function eightBoxPorts(ownerKind: NetworkOwnerKind, ownerId: string, position: RoutePoint, frame: DeviceFrame, sizeMm: [number, number, number], system: RoutingSystem, role: NetworkPortRole): NetworkPort[] {
  const width = sizeMm[0] / 1000, height = sizeMm[1] / 1000;
  const faces: Array<{ face: NonNullable<NetworkPort["face"]>; direction: Vec3; lateral: Vec3; extent: number }> = [
    { face: "top", direction: frame.up, lateral: frame.right, extent: height / 2 },
    { face: "bottom", direction: scale(frame.up, -1), lateral: frame.right, extent: height / 2 },
    { face: "left", direction: scale(frame.right, -1), lateral: frame.up, extent: width / 2 },
    { face: "right", direction: frame.right, lateral: frame.up, extent: width / 2 },
  ];
  return faces.flatMap((face, faceIndex) => ([0, 1] as const).map((slot) => {
    const across = (slot === 0 ? -.22 : .22) * (face.face === "top" || face.face === "bottom" ? width : height);
    return {
      id: `${ownerId}:port:${faceIndex * 2 + slot}`,
      owner: { kind: ownerKind, id: ownerId },
      position: { position: add(add(position.position, scale(face.direction, face.extent)), scale(face.lateral, across)), attachment: position.attachment ? structuredClone(position.attachment) : undefined },
      direction: face.direction,
      role,
      system,
      connectedSegmentIds: [],
      face: face.face,
      slot,
      flow: "unknown" as const,
    };
  }));
}

export function sameFaceFreePeer(ports: NetworkPort[], port: NetworkPort, system: RoutingSystem) {
  return port.face ? ports.find((candidate) => candidate.id !== port.id && candidate.system === system && candidate.face === port.face && candidate.connectedSegmentIds.length === 0) : undefined;
}
