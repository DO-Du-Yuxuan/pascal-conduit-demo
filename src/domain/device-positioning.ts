import type { ConduitOverlayDocument, NetworkDevice, RoutePoint, Vec3 } from "./overlay";
import { isReferencePlaneEligibleDeviceType, rebuildNetworkDevice } from "./devices";
import { devicePositioningHalfExtent, deviceVerticalHalfExtentMeters } from "../geometry/positioning-measurements";
import { firstPhysicalPositioningHit } from "./physical-positioning-surfaces";

export type DevicePositioningContext = {
  levelFloorY: Readonly<Record<string, number>>;
  wallSpans: Readonly<Record<string, readonly [number, number]>>;
  wallOpenings?: Readonly<Record<string, readonly { id: string; start: number; end: number }[]>>;
  wallFaces?: readonly { id: string; levelId: string; point: Vec3; normal: Vec3; start?: Vec3; end?: Vec3; halfThickness?: number }[];
  /** Triangles from physical Building entities only; dimensions raycast these finite surfaces. */
  physicalSurfaces?: readonly { objectId: string; objectKind: string; vertices: readonly [Vec3, Vec3, Vec3] }[];
};

export type DevicePositionDescription = {
  vertical?: { millimeters: number; kind: "finished-floor" | "reference-plane" | "floor-socket"; direction?: Vec3; witness?: { objectId: string; objectKind: string; point: Vec3 } };
  horizontal?: { millimeters: number; kind: "device" | "wall-end" | "opening"; referenceId: string; direction: -1 | 1 };
  planar?: { key: string; millimeters: number; wallId: string; direction: Vec3; witness?: { objectId: string; objectKind: string; point: Vec3 } }[];
};

export type DevicePositionEdit = {
  deviceIds: string[];
  bottomHeightMm?: number;
  horizontalClearanceMm?: number;
  elevationMm?: number;
  /** User-facing installation elevation from the local finished floor, measured to the device's world-Y lower edge. */
  finishedFloorElevationMm?: number;
  planarClearanceMm?: Readonly<Record<string, number>>;
  verticalClearanceMm?: number;
};

export type DevicePositionEditResult = {
  status: "preview" | "committed" | "rejected";
  overlay: ConduitOverlayDocument;
  removedSegmentIds: string[];
  skippedDeviceIds: string[];
  diagnostics: string[];
};

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (value: Vec3, amount: number): Vec3 => [value[0] * amount, value[1] * amount, value[2] * amount];
const finiteNonNegative = (value: number | undefined) => value === undefined || Number.isFinite(value) && value >= 0;
const hasMovement = (delta: Vec3) => Math.hypot(...delta) > 1e-8;
const wallCoordinate = (device: NetworkDevice) => device.position.attachment?.localPosition?.[0] ?? 0;
const halfWallWidth = (device: NetworkDevice) => device.sizeMm[0] / 2000;
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const isWall86Box = (device: NetworkDevice) => device.position.attachment?.hostKind === "wall" && ["socket", "switch", "network-outlet"].includes(device.deviceType);
const isFloorSocket = (device: NetworkDevice) => device.deviceType === "socket" && device.position.attachment?.hostKind === "slab";
const isLargePositioningBox = (device: NetworkDevice) => device.deviceType === "strong-panel" || device.deviceType === "weak-panel";

function firstPhysicalHit(origin: Vec3, direction: Vec3, context: DevicePositioningContext, accepts?: (surface: NonNullable<DevicePositioningContext["physicalSurfaces"]>[number]) => boolean) {
  return firstPhysicalPositioningHit(origin, direction, context.physicalSurfaces ?? [], accepts);
}

function liesWithinSlabFootprint(point: Vec3, slabId: string, context: DevicePositioningContext): boolean | undefined {
  const triangles = (context.physicalSurfaces ?? []).filter(surface => surface.objectId === slabId && surface.objectKind === "slab");
  if (!triangles.length) return undefined;
  return triangles.some(({ vertices: [a, b, c] }) => {
    const v0 = [b[0] - a[0], b[2] - a[2]], v1 = [c[0] - a[0], c[2] - a[2]], v2 = [point[0] - a[0], point[2] - a[2]];
    const denominator = v0[0] * v1[1] - v1[0] * v0[1];
    if (Math.abs(denominator) < 1e-10) return false;
    const u = (v2[0] * v1[1] - v1[0] * v2[1]) / denominator;
    const v = (v0[0] * v2[1] - v2[0] * v0[1]) / denominator;
    return u >= -1e-8 && v >= -1e-8 && u + v <= 1 + 1e-8;
  });
}

function normalized(vector: Vec3 | undefined): Vec3 | null {
  if (!vector) return null;
  const magnitude = Math.hypot(...vector);
  return magnitude > 1e-8 ? scale(vector, 1 / magnitude) : null;
}

/** Distance to the first face of a placed device box along a finite ray. */
function rayDeviceEnvelopeHit(origin: Vec3, direction: Vec3, device: NetworkDevice): number | undefined {
  const frame = device.frame;
  if (!frame) return undefined;
  const axes = [frame.right, frame.up, frame.front], half = device.sizeMm.map(value => value / 2000);
  if (device.deviceType === "luminaire" || device.deviceType === "sensor") {
    const relative = subtract(origin, device.position.position), localOrigin = axes.map(axis => dot(relative, axis)), localDirection = axes.map(axis => dot(direction, axis));
    const radius = device.sizeMm[0] / 2000, halfDepth = device.sizeMm[2] / 2000;
    const a = localDirection[0]! ** 2 + localDirection[1]! ** 2, b = 2 * (localOrigin[0]! * localDirection[0]! + localOrigin[1]! * localDirection[1]!), c = localOrigin[0]! ** 2 + localOrigin[1]! ** 2 - radius ** 2;
    let radialNear = Number.NEGATIVE_INFINITY, radialFar = Number.POSITIVE_INFINITY;
    if (a < 1e-10) { if (c > 1e-8) return undefined; }
    else {
      const discriminant = b * b - 4 * a * c;
      if (discriminant < 0) return undefined;
      const root = Math.sqrt(discriminant);
      radialNear = (-b - root) / (2 * a); radialFar = (-b + root) / (2 * a);
    }
    const depthDirection = localDirection[2]!, depthOrigin = localOrigin[2]!;
    if (Math.abs(depthDirection) < 1e-8 && Math.abs(depthOrigin) > halfDepth + 1e-8) return undefined;
    const depthNear = Math.abs(depthDirection) < 1e-8 ? Number.NEGATIVE_INFINITY : (-halfDepth - depthOrigin) / depthDirection;
    const depthFar = Math.abs(depthDirection) < 1e-8 ? Number.POSITIVE_INFINITY : (halfDepth - depthOrigin) / depthDirection;
    const near = Math.max(radialNear, Math.min(depthNear, depthFar), 0), far = Math.min(radialFar, Math.max(depthNear, depthFar));
    return near <= far + 1e-8 && far > 1e-5 ? (near > 1e-5 ? near : far) : undefined;
  }
  let near = Number.NEGATIVE_INFINITY, far = Number.POSITIVE_INFINITY;
  for (let axisIndex = 0; axisIndex < 3; axisIndex += 1) {
    const axis = axes[axisIndex]!, centerOffset = dot(subtract(device.position.position, origin), axis), rayAxis = dot(direction, axis), extent = half[axisIndex]!;
    if (Math.abs(rayAxis) < 1e-8) {
      if (Math.abs(centerOffset) > extent + 1e-8) return undefined;
      continue;
    }
    const a = (centerOffset - extent) / rayAxis, b = (centerOffset + extent) / rayAxis;
    near = Math.max(near, Math.min(a, b));
    far = Math.min(far, Math.max(a, b));
    if (near > far + 1e-8) return undefined;
  }
  const distance = near > 1e-5 ? near : far;
  return distance > 1e-5 && Number.isFinite(distance) ? distance : undefined;
}

function positioningAxes(device: NetworkDevice): { key: string; direction: Vec3 }[] {
  const basis = device.position.attachment?.basis;
  const hosted = Boolean(device.position.attachment);
  const u = normalized(basis?.u) ?? (hosted ? normalized(device.frame?.right) : null) ?? [1, 0, 0];
  const v = normalized(basis?.v) ?? (hosted ? normalized(device.frame?.up) : null) ?? [0, 0, 1];
  return [
    { key: "u+", direction: u }, { key: "u-", direction: scale(u, -1) },
    { key: "v+", direction: v }, { key: "v-", direction: scale(v, -1) },
  ];
}

function legacyPlanarReferences(device: NetworkDevice, context: DevicePositioningContext): NonNullable<DevicePositionDescription["planar"]> {
  const levelId = referencePlaneLevelId(device);
  const candidates = (context.wallFaces ?? []).filter((face) => {
    if (face.levelId !== levelId || !face.start || !face.end) return face.levelId === levelId;
    const tangent = subtract(face.end, face.start), length = Math.hypot(...tangent);
    if (length < 1e-8) return false;
    const along = dot(subtract(device.position.position, face.start), scale(tangent, 1 / length));
    return along >= -1e-6 && along <= length + 1e-6;
  }).map((face) => {
    const signed = dot(subtract(device.position.position, face.point), face.normal), direction = scale(face.normal, signed < 0 ? -1 : 1);
    const distance = Math.max(0, Math.abs(signed) - (face.halfThickness ?? 0));
    return { key: face.id, millimeters: Math.round(distance * 1000), wallId: face.id, direction, distance };
  });
  const persisted = device.positioning?.planarWallIds?.map((id) => candidates.find((candidate) => candidate.wallId === id)).filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));
  const ordered = persisted?.length ? persisted : candidates.sort((a, b) => a.distance - b.distance || a.wallId.localeCompare(b.wallId));
  const first = ordered[0], second = first && ordered.find((candidate) => candidate.wallId !== first.wallId && Math.abs(dot(candidate.direction, first.direction)) <= .25);
  return [first, second].filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate)).map(({ distance: _distance, ...reference }) => reference);
}

function wallPlanarReferences(overlay: ConduitOverlayDocument, device: NetworkDevice, context: DevicePositioningContext): NonNullable<DevicePositionDescription["planar"]> {
  const attachment = device.position.attachment!;
  const horizontal = normalized(attachment.basis?.u) ?? normalized(device.frame?.right) ?? [attachment.normal[2], 0, -attachment.normal[0]] as Vec3;
  const vertical: Vec3 = [0, 1, 0];
  const origin = device.position.position;
  return [
    { key: "u+", direction: horizontal }, { key: "u-", direction: scale(horizontal, -1) },
    { key: "v+", direction: vertical }, { key: "v-", direction: [0, -1, 0] as Vec3 },
  ].flatMap(({ key, direction }) => {
    const rayOrigin = add(origin, scale(direction, devicePositioningHalfExtent(device.deviceType, device.sizeMm, key)));
    if (Math.abs(direction[1]) > .9) {
      const downward = direction[1] < 0;
      const hit = firstPhysicalHit(rayOrigin, direction, context, downward
        ? surface => surface.objectKind === "slab"
        : surface => surface.objectKind === "wall" && surface.objectId === attachment.hostId);
      const clearanceMm = hit ? Math.round(hit.distance * 1000) - (downward && isWall86Box(device) ? deviceVerticalHalfExtentMeters(device) * 1000 : 0) : 0;
      return hit && clearanceMm >= 0 ? [{ key, wallId: key, direction, millimeters: clearanceMm, witness: { objectId: hit.objectId, objectKind: hit.objectKind, point: hit.point } }] : [];
    }

    const peerHits = overlay.devices.flatMap(peer => {
      const peerAttachment = peer.position.attachment;
      if (peer.id === device.id || peerAttachment?.hostKind !== "wall" || peerAttachment.hostId !== attachment.hostId) return [];
      const offset = subtract(peer.position.position, rayOrigin), along = dot(offset, direction);
      const perpendicular = subtract(offset, scale(direction, along));
      if (along <= 1e-5 || Math.hypot(...perpendicular) > .005) return [];
      const peerDistance = along - devicePositioningHalfExtent(peer.deviceType, peer.sizeMm, key);
      return peerDistance > 1e-5 ? [{ distance: peerDistance, objectId: peer.id, objectKind: isLargePositioningBox(peer) ? "device-envelope" : "device", point: add(rayOrigin, scale(direction, peerDistance)) }] : [];
    });
    // Move the ray one millimetre into the host wall so a ray along its face
    // can hit real wall ends, opening reveals, and the first adjoining wall face.
    const wallRayOrigin = subtract(rayOrigin, scale(attachment.normal, .001));
    const sameLevelWallIds = context.wallFaces?.filter(face => face.levelId === attachment.levelId).map(face => face.id);
    const wallHit = firstPhysicalHit(wallRayOrigin, direction, context, surface => surface.objectKind === "wall" && (
      surface.objectId === attachment.hostId || Boolean(sameLevelWallIds?.includes(surface.objectId))
    ));
    const wallAlong = wallHit ? dot(subtract(wallHit.point, wallRayOrigin), direction) : undefined;
    const candidates = [
      ...peerHits,
      ...(wallHit && wallAlong !== undefined && wallAlong > 1e-5 ? [{ distance: wallAlong, objectId: wallHit.objectId, objectKind: wallHit.objectKind, point: add(rayOrigin, scale(direction, wallAlong)) }] : []),
    ].sort((a, b) => a.distance - b.distance || a.objectId.localeCompare(b.objectId));
    const hit = candidates[0];
    return hit ? [{ key, wallId: key, direction, millimeters: Math.round(hit.distance * 1000), witness: { objectId: hit.objectId, objectKind: hit.objectKind, point: hit.point } }] : [];
  });
}

function planarReferences(overlay: ConduitOverlayDocument, device: NetworkDevice, context: DevicePositioningContext): NonNullable<DevicePositionDescription["planar"]> {
  if (!context.physicalSurfaces) return legacyPlanarReferences(device, context);
  if (device.position.attachment?.hostKind === "wall") return wallPlanarReferences(overlay, device, context);
  const origin = device.position.position;
  return positioningAxes(device).flatMap(({ key, direction }) => {
    const rayOrigin = add(origin, scale(direction, devicePositioningHalfExtent(device.deviceType, device.sizeMm, key)));
    const physicalHit = firstPhysicalHit(rayOrigin, direction, context);
    const sameHostDeviceHits = overlay.devices.flatMap(peer => {
      const attachment = device.position.attachment, peerAttachment = peer.position.attachment;
      if (peer.id === device.id || !attachment || peerAttachment?.hostKind === "wall" || peerAttachment?.hostKind !== attachment.hostKind || peerAttachment.hostId !== attachment.hostId || peerAttachment.surface !== attachment.surface) return [];
      const offset = subtract(peer.position.position, rayOrigin), along = dot(offset, direction);
      const centerDistance = Math.hypot(...offset), peerExtent = devicePositioningHalfExtent(peer.deviceType, peer.sizeMm, key), targetDistance = centerDistance - peerExtent;
      const verticalAxis = Math.abs(direction[1]) > .9, perpendicular = subtract(offset, scale(direction, along));
      const rayHitDistance = verticalAxis ? rayDeviceEnvelopeHit(rayOrigin, direction, peer) : undefined;
      if (along <= 1e-5 || verticalAxis && rayHitDistance === undefined || !verticalAxis && Math.hypot(...perpendicular) > .1 || targetDistance < 1e-5) return [];
      const centerRayHit = firstPhysicalHit(rayOrigin, scale(offset, 1 / centerDistance), context);
      if (centerRayHit && centerRayHit.distance < targetDistance - 1e-5) return [centerRayHit];
      return [{ distance: verticalAxis ? rayHitDistance! : targetDistance, objectId: peer.id, objectKind: isLargePositioningBox(peer) ? "device-envelope" : "device", point: verticalAxis ? add(rayOrigin, scale(direction, rayHitDistance!)) : isLargePositioningBox(peer) ? add(rayOrigin, scale(direction, targetDistance)) : peer.position.position }];
    });
    const hit = [physicalHit, ...sameHostDeviceHits].filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate)).sort((a, b) => a.distance - b.distance || a.objectId.localeCompare(b.objectId))[0];
    return hit ? [{ key, wallId: key, direction, millimeters: Math.round(hit.distance * 1000), witness: { objectId: hit.objectId, objectKind: hit.objectKind, point: hit.point } }] : [];
  });
}

function referencePlaneLevelId(device: NetworkDevice) {
  return device.mount?.kind === "reference-plane" ? device.mount.levelId : device.position.attachment?.hostKind === "ceiling" || device.position.attachment?.hostKind === "slab" || device.position.attachment?.hostKind === "beam" ? device.position.attachment.levelId : null;
}

function canEditAsReferencePlane(device: NetworkDevice) {
  return Boolean(referencePlaneLevelId(device) && isReferencePlaneEligibleDeviceType(device.deviceType));
}

function horizontalReference(overlay: ConduitOverlayDocument, device: NetworkDevice, context: DevicePositioningContext): DevicePositionDescription["horizontal"] {
  const attachment = device.position.attachment;
  if (!attachment || attachment.hostKind !== "wall") return undefined;
  const own = wallCoordinate(device), persisted = device.positioning?.horizontal;
  const span = context.wallSpans[attachment.hostId];
  if (!span) return undefined;
  const references = [
    { kind: "wall-end" as const, referenceId: `${attachment.hostId}:start`, coordinate: span[0] },
    { kind: "wall-end" as const, referenceId: `${attachment.hostId}:end`, coordinate: span[1] },
    ...(context.wallOpenings?.[attachment.hostId] ?? []).flatMap((opening) => [{ kind: "opening" as const, referenceId: `${opening.id}:start`, coordinate: opening.start }, { kind: "opening" as const, referenceId: `${opening.id}:end`, coordinate: opening.end }]),
  ];
  const stable = persisted && persisted.kind !== "device" ? references.find((reference) => reference.kind === persisted.kind && reference.referenceId === persisted.referenceId) : undefined;
  const chosen = stable ?? references.sort((a, b) => Math.abs(a.coordinate - own) - Math.abs(b.coordinate - own) || a.referenceId.localeCompare(b.referenceId))[0];
  const direction = (chosen.coordinate < own ? -1 : 1) as -1 | 1;
  return { millimeters: Math.max(0, Math.round((Math.abs(own - chosen.coordinate) - halfWallWidth(device)) * 1000)), kind: chosen.kind, referenceId: chosen.referenceId, direction };
}

export function describeDevicePosition(overlay: ConduitOverlayDocument, deviceId: string, context: DevicePositioningContext): DevicePositionDescription {
  const device = overlay.devices.find((candidate) => candidate.id === deviceId);
  if (!device) return {};
  const attachment = device.position.attachment;
  if (attachment && context.physicalSurfaces) {
    const planar = planarReferences(overlay, device, context);
    const floorWitness = planar.find(reference => reference.key === "v-")?.witness;
    const finishedFloorY = attachment.levelId
      ? floorWitness?.objectKind === "slab" ? floorWitness.point[1] : context.levelFloorY[attachment.levelId]
      : undefined;
    const bottomHeightMm = finishedFloorY === undefined ? undefined : Math.round((device.position.position[1] - deviceVerticalHalfExtentMeters(device) - finishedFloorY) * 1000);
    return {
      ...(isFloorSocket(device) ? { vertical: { millimeters: 0, kind: "floor-socket" as const, direction: [0, -1, 0] as Vec3, witness: { objectId: attachment.hostId, objectKind: "slab", point: device.position.position } } } : attachment.hostKind === "wall" && bottomHeightMm !== undefined ? { vertical: { millimeters: bottomHeightMm, kind: "finished-floor" as const, direction: [0, -1, 0] as Vec3, ...(floorWitness ? { witness: floorWitness } : {}) } } : {}),
      planar,
    };
  }
  if (device.mount?.kind === "reference-plane" && context.physicalSurfaces) {
    const direction: Vec3 = [0, -1, 0], physicalHit = firstPhysicalHit(device.position.position, direction, context);
    const deviceHit = overlay.devices.flatMap(peer => {
      if (peer.id === device.id) return [];
      const distance = rayDeviceEnvelopeHit(device.position.position, direction, peer);
      return distance === undefined ? [] : [{ distance, objectId: peer.id, objectKind: "device", point: add(device.position.position, scale(direction, distance)) }];
    }).sort((a, b) => a.distance - b.distance || a.objectId.localeCompare(b.objectId))[0];
    const hit = physicalHit && (!deviceHit || physicalHit.distance <= deviceHit.distance) ? physicalHit : deviceHit;
    return {
      vertical: hit ? { millimeters: Math.round(hit.distance * 1000), kind: "reference-plane", direction, witness: { objectId: hit.objectId, objectKind: hit.objectKind, point: hit.point } } : undefined,
      planar: planarReferences(overlay, device, context),
    };
  }
  if (attachment?.hostKind === "wall") {
    const levelId = attachment.levelId;
    const floorY = levelId ? context.levelFloorY[levelId] : undefined;
    return {
      vertical: floorY === undefined ? undefined : { millimeters: Math.round((device.position.position[1] - device.sizeMm[1] / 2000 - floorY) * 1000), kind: "finished-floor" },
      horizontal: horizontalReference(overlay, device, context),
    };
  }
  if (canEditAsReferencePlane(device)) {
    const levelId = referencePlaneLevelId(device)!, floor = context.levelFloorY[levelId];
    return { vertical: floor === undefined ? undefined : { millimeters: Math.round((device.position.position[1] - deviceVerticalHalfExtentMeters(device) - floor) * 1000), kind: "reference-plane" }, planar: planarReferences(overlay, device, context) };
  }
  return {};
}

function translatedPoint(point: RoutePoint, delta: Vec3, clearAttachment = false): RoutePoint {
  const attachment = clearAttachment ? undefined : point.attachment ? structuredClone(point.attachment) : undefined;
  if (attachment?.localPosition) {
    const basis = attachment.basis;
    attachment.localPosition = basis
      ? add(attachment.localPosition, [basis.u[0] * delta[0] + basis.u[1] * delta[1] + basis.u[2] * delta[2], basis.v[0] * delta[0] + basis.v[1] * delta[1] + basis.v[2] * delta[2], attachment.normal[0] * delta[0] + attachment.normal[1] * delta[1] + attachment.normal[2] * delta[2]])
      : add(attachment.localPosition, delta);
  }
  return attachment ? { position: add(point.position, delta), attachment } : { position: add(point.position, delta) };
}

function moveDevice(device: NetworkDevice, delta: Vec3, reference?: NonNullable<DevicePositionDescription["horizontal"]>, referencePlaneMount?: { levelId: string; elevationMm: number }, clearConnections = true): NetworkDevice {
  const referencePlane = Boolean(referencePlaneMount);
  const movedPosition = translatedPoint(device.position, delta, referencePlane);
  return {
    ...device,
    position: movedPosition,
    mount: referencePlaneMount ? { kind: "reference-plane", ...referencePlaneMount } : device.mount?.kind === "host" && movedPosition.attachment ? { kind: "host", attachment: structuredClone(movedPosition.attachment) } : device.mount,
    positioning: reference ? { ...device.positioning, horizontal: reference } : device.positioning,
    ports: device.ports.map((port) => ({ ...port, position: translatedPoint(port.position, delta, referencePlane), connectedSegmentIds: clearConnections ? [] : port.connectedSegmentIds })),
  };
}

function removeAdjacentSegments(overlay: ConduitOverlayDocument, movedIds: ReadonlySet<string>) {
  const removedIds = new Set(overlay.devices.filter((device) => movedIds.has(device.id)).flatMap((device) => device.ports.flatMap((port) => port.connectedSegmentIds)));
  const retainedSegments = overlay.segments.filter((segment) => !removedIds.has(segment.id));
  const segmentIds = new Set(retainedSegments.map((segment) => segment.id));
  const reconcileNode = <T extends { segmentIds: string[]; ports: NetworkDevice["ports"] }>(node: T): T => ({
    ...node,
    segmentIds: node.segmentIds.filter((id) => segmentIds.has(id)),
    ports: node.ports.map((port) => ({ ...port, segmentId: port.segmentId && segmentIds.has(port.segmentId) ? port.segmentId : undefined, connectedSegmentIds: port.connectedSegmentIds.filter((id) => segmentIds.has(id)) })),
  });
  const fittings = overlay.fittings.map(reconcileNode).filter((fitting) => fitting.segmentIds.length > 1);
  const fittingIds = new Set(fittings.map((fitting) => fitting.id));
  const junctionBoxes = overlay.junctionBoxes.map(reconcileNode).filter((box) => box.segmentIds.length > 0);
  const devices = overlay.devices.map((device) => ({ ...device, ports: device.ports.map((port) => ({ ...port, connectedSegmentIds: port.connectedSegmentIds.filter((id) => segmentIds.has(id)) })) }));
  const validPortIds = new Set([
    ...devices.flatMap((device) => device.ports.map((port) => port.id)),
    ...fittings.flatMap((fitting) => fitting.ports.map((port) => port.id)),
    ...junctionBoxes.flatMap((box) => box.ports.map((port) => port.id)),
  ]);
  const segments = retainedSegments.map((segment) => ({
    ...segment,
    startPortId: segment.startPortId && validPortIds.has(segment.startPortId) ? segment.startPortId : undefined,
    endPortId: segment.endPortId && validPortIds.has(segment.endPortId) ? segment.endPortId : undefined,
  }));
  return {
    removedIds,
    overlay: {
      ...overlay,
      segments,
      fittings,
      junctionBoxes,
      devices,
      hvac: {
        ...overlay.hvac,
        indoorUnits: overlay.hvac.indoorUnits.map((unit) => unit.powerPort
          ? { ...unit, powerPort: { ...unit.powerPort, connectedSegmentIds: unit.powerPort.connectedSegmentIds.filter((id) => segmentIds.has(id)) } }
          : unit),
      },
      circuits: overlay.circuits.map((circuit) => ({ ...circuit, segmentIds: circuit.segmentIds.filter((id) => segmentIds.has(id)), status: circuit.segmentIds.some((id) => removedIds.has(id)) ? "broken" as const : circuit.status })),
      surfaceChases: overlay.surfaceChases.filter((chase) => segmentIds.has(chase.routeElementId) || fittingIds.has(chase.routeElementId)),
      penetrations: overlay.penetrations.filter((penetration) => segmentIds.has(penetration.segmentId)),
    },
  };
}

export function editDevicePosition(overlay: ConduitOverlayDocument, edit: DevicePositionEdit, context: DevicePositioningContext, mode: "preview" | "commit"): DevicePositionEditResult {
  if (!edit.deviceIds.length || !finiteNonNegative(edit.bottomHeightMm) || !finiteNonNegative(edit.horizontalClearanceMm) || !finiteNonNegative(edit.elevationMm) || !finiteNonNegative(edit.finishedFloorElevationMm) || !finiteNonNegative(edit.verticalClearanceMm) || Object.values(edit.planarClearanceMm ?? {}).some((value) => !finiteNonNegative(value))) return { status: "rejected", overlay, removedSegmentIds: [], skippedDeviceIds: edit.deviceIds, diagnostics: ["定位尺寸必须是非负有限数值。"] };
  const selected = new Set(edit.deviceIds), skipped: string[] = [], moved = new Map<string, NetworkDevice>(), outsideSlabIds: string[] = [];
  for (const device of overlay.devices) {
    if (!selected.has(device.id)) continue;
    let delta: Vec3 = [0, 0, 0];
    let reference: DevicePositionDescription["horizontal"];
    if (context.physicalSurfaces && (edit.planarClearanceMm || edit.verticalClearanceMm !== undefined)) {
      if (!device.position.attachment && !(device.mount?.kind === "reference-plane" && isReferencePlaneEligibleDeviceType(device.deviceType))) { skipped.push(device.id); continue; }
      for (const planar of planarReferences(overlay, device, context)) {
        const requested = edit.planarClearanceMm?.[planar.key];
        if (requested !== undefined) {
          const lateral = planar.witness ? subtract(subtract(planar.witness.point, device.position.position), scale(planar.direction, dot(subtract(planar.witness.point, device.position.position), planar.direction))) : [0, 0, 0] as Vec3;
          const lateralMm = Math.hypot(...lateral) * 1000;
          if (requested < lateralMm) { skipped.push(device.id); break; }
          const desiredAlongMm = Math.sqrt(Math.max(0, requested * requested - lateralMm * lateralMm)) + (planar.key === "v-" && isWall86Box(device) ? device.sizeMm[1] / 2 : 0);
          const rayOrigin = add(device.position.position, scale(planar.direction, devicePositioningHalfExtent(device.deviceType, device.sizeMm, planar.key)));
          const currentAlongMm = planar.witness ? dot(subtract(planar.witness.point, rayOrigin), planar.direction) * 1000 : planar.millimeters;
          delta = add(delta, scale(planar.direction, (currentAlongMm - desiredAlongMm) / 1000));
        }
      }
      if (skipped.includes(device.id)) continue;
      if (edit.verticalClearanceMm !== undefined) {
        if (device.mount?.kind !== "reference-plane") { skipped.push(device.id); continue; }
        const currentHit = firstPhysicalHit(device.position.position, [0, -1, 0], context);
        if (!currentHit) { skipped.push(device.id); continue; }
        delta = add(delta, [0, (edit.verticalClearanceMm / 1000 - currentHit.distance), 0]);
      }
      if (!hasMovement(delta)) continue;
      const levelId = referencePlaneLevelId(device) ?? device.position.attachment?.levelId;
      const floor = levelId ? context.levelFloorY[levelId] : undefined;
      // A slab-top point is already on its intended installation plane. Moving
      // it in that plane must keep the real slab attachment (and floor-socket
      // identity); Ceiling and Beam edits still detach into the virtual plane.
      const hostKind = device.position.attachment?.hostKind;
      const promotesHostedPoint = hostKind !== "wall" && hostKind !== "slab" && canEditAsReferencePlane(device);
      if (promotesHostedPoint && floor === undefined) { skipped.push(device.id); continue; }
      if (hostKind === "slab" && device.position.attachment) {
        const withinHost = liesWithinSlabFootprint(add(device.position.position, delta), device.position.attachment.hostId, context);
        if (withinHost === false) { skipped.push(device.id); outsideSlabIds.push(device.id); continue; }
      }
      const referencePlaneMount = device.mount?.kind === "reference-plane" && floor !== undefined
          ? { levelId: device.mount.levelId, elevationMm: Math.round((device.position.position[1] + delta[1] - floor) * 1000) }
        : promotesHostedPoint && levelId && floor !== undefined
          ? { levelId, elevationMm: Math.round((device.position.position[1] + delta[1] - floor) * 1000) }
          : undefined;
      const movedDevice = moveDevice(device, delta, undefined, referencePlaneMount, mode === "commit");
      movedDevice.positioning = { ...movedDevice.positioning, planarWallIds: planarReferences(overlay, device, context).map((item) => item.witness?.objectKind === "wall" ? item.witness.objectId : item.wallId) };
      moved.set(device.id, movedDevice);
      continue;
    }
    if (edit.elevationMm !== undefined) {
      const levelId = referencePlaneLevelId(device);
      if (!levelId || !canEditAsReferencePlane(device)) { skipped.push(device.id); continue; }
      const floor = context.levelFloorY[levelId];
      if (floor === undefined) { skipped.push(device.id); continue; }
      delta = [0, floor + edit.elevationMm / 1000 + deviceVerticalHalfExtentMeters(device) - device.position.position[1], 0];
      if (!edit.planarClearanceMm) { if (hasMovement(delta)) moved.set(device.id, moveDevice(device, delta, undefined, { levelId, elevationMm: edit.elevationMm + Math.round(deviceVerticalHalfExtentMeters(device) * 1000) }, mode === "commit")); continue; }
    }
    if (edit.finishedFloorElevationMm !== undefined) {
      const levelId = referencePlaneLevelId(device);
      if (!levelId || !canEditAsReferencePlane(device)) { skipped.push(device.id); continue; }
      const floorHit = firstPhysicalHit(device.position.position, [0, -1, 0], context, surface => surface.objectKind === "slab");
      const floorY = floorHit?.point[1] ?? context.levelFloorY[levelId];
      const levelBaseY = context.levelFloorY[levelId];
      if (floorY === undefined || levelBaseY === undefined) { skipped.push(device.id); continue; }
      const centerY = floorY + edit.finishedFloorElevationMm / 1000 + deviceVerticalHalfExtentMeters(device);
      delta = [0, centerY - device.position.position[1], 0];
      if (!edit.planarClearanceMm) {
        if (hasMovement(delta)) moved.set(device.id, moveDevice(device, delta, undefined, { levelId, elevationMm: Math.round((centerY - levelBaseY) * 1000) }, mode === "commit"));
        continue;
      }
    }
    if (edit.planarClearanceMm && canEditAsReferencePlane(device)) {
      const levelId = referencePlaneLevelId(device)!, floor = context.levelFloorY[levelId];
      if (floor === undefined) { skipped.push(device.id); continue; }
      const references = planarReferences(overlay, device, context);
      if (!references.length) { skipped.push(device.id); continue; }
      for (const reference of references) {
        const proposed = edit.planarClearanceMm[reference.wallId];
        if (proposed === undefined) continue;
        delta = add(delta, scale(reference.direction, (proposed - reference.millimeters) / 1000));
      }
      if (!hasMovement(delta)) continue;
      const movedDevice = moveDevice(device, delta, undefined, { levelId, elevationMm: edit.elevationMm === undefined ? Math.round((device.position.position[1] + delta[1] - floor) * 1000) : edit.elevationMm + Math.round(deviceVerticalHalfExtentMeters(device) * 1000) }, mode === "commit");
      movedDevice.positioning = { ...movedDevice.positioning, planarWallIds: references.map((reference) => reference.wallId) };
      moved.set(device.id, movedDevice);
      continue;
    } else if (device.position.attachment?.hostKind === "wall") {
      const description = describeDevicePosition(overlay, device.id, context);
      reference = description.horizontal;
      if (edit.bottomHeightMm !== undefined) {
        const levelId = device.position.attachment.levelId, floor = levelId ? context.levelFloorY[levelId] : undefined;
        if (floor === undefined) { skipped.push(device.id); continue; }
        delta[1] = floor + edit.bottomHeightMm / 1000 + device.sizeMm[1] / 2000 - device.position.position[1];
      }
      if (edit.horizontalClearanceMm !== undefined) {
        if (!reference) { skipped.push(device.id); continue; }
        const activeReference = reference;
        const opening = activeReference.kind === "opening" ? (context.wallOpenings?.[device.position.attachment.hostId] ?? []).flatMap((item) => [{ id: `${item.id}:start`, coordinate: item.start }, { id: `${item.id}:end`, coordinate: item.end }]).find((item) => item.id === activeReference.referenceId) : undefined;
        const boundary = opening?.coordinate ?? (reference.direction < 0 ? context.wallSpans[device.position.attachment.hostId]?.[0] : context.wallSpans[device.position.attachment.hostId]?.[1]);
        const targetCoordinate = boundary! - reference.direction * (halfWallWidth(device) + edit.horizontalClearanceMm / 1000);
        const span = context.wallSpans[device.position.attachment.hostId];
        if (!span || targetCoordinate - halfWallWidth(device) < span[0] - 1e-8 || targetCoordinate + halfWallWidth(device) > span[1] + 1e-8) { skipped.push(device.id); continue; }
        const basis = device.position.attachment.basis?.u ?? [1, 0, 0];
        delta = add(delta, scale(basis, targetCoordinate - wallCoordinate(device)));
      }
    } else { skipped.push(device.id); continue; }
    if (hasMovement(delta)) moved.set(device.id, moveDevice(device, delta, reference, undefined, mode === "commit"));
  }
  if (!moved.size) return { status: "rejected", overlay, removedSegmentIds: [], skippedDeviceIds: skipped, diagnostics: [outsideSlabIds.length ? "设备不能移出其当前楼板范围。" : "所选设备没有可编辑的定位参考。"] };
  const withMovedDevices = { ...overlay, devices: overlay.devices.map((device) => moved.get(device.id) ?? device) };
  if (mode === "preview") return { status: "preview", overlay: withMovedDevices, removedSegmentIds: [], skippedDeviceIds: skipped, diagnostics: [] };
  const removed = removeAdjacentSegments(overlay, new Set(moved.keys()));
  const committed = { ...removed.overlay, devices: removed.overlay.devices.map((device) => moved.get(device.id) ?? device) };
  return { status: "committed", overlay: committed, removedSegmentIds: [...removed.removedIds], skippedDeviceIds: skipped, diagnostics: outsideSlabIds.length ? ["部分设备将超出当前楼板范围，未移动。"] : skipped.length ? ["部分所选设备不属于安装参考平面，未移动。"] : [] };
}

export function ensureInstallationReferencePlane(overlay: ConduitOverlayDocument, levelId: string, elevationMm = 2700): ConduitOverlayDocument {
  if (overlay.installationReferencePlanes.some((plane) => plane.levelId === levelId)) return overlay;
  return { ...overlay, installationReferencePlanes: [...overlay.installationReferencePlanes, { levelId, elevationMm, basis: "finished-floor", derived: true }] };
}

export function resizeDevicePoint(overlay: ConduitOverlayDocument, deviceId: string, sizeMm: [number, number, number]): ConduitOverlayDocument {
  if (sizeMm.some((value) => !Number.isFinite(value) || value <= 0)) return overlay;
  const device = overlay.devices.find((candidate) => candidate.id === deviceId);
  if (!device || device.ports.some((port) => port.connectedSegmentIds.length > 0)) return overlay;
  return { ...overlay, devices: overlay.devices.map((candidate) => candidate.id === deviceId ? rebuildNetworkDevice(candidate, sizeMm) : candidate) };
}

/** Resize a lighting junction box while keeping connected port geometry fixed. */
export function resizeSpotlight(overlay: ConduitOverlayDocument, deviceId: string, diameterMm: number, depthMm: number): ConduitOverlayDocument {
  if (!Number.isFinite(diameterMm) || diameterMm <= 0 || !Number.isFinite(depthMm) || depthMm <= 0) return overlay;
  const device = overlay.devices.find((candidate) => candidate.id === deviceId);
  if (!device || device.deviceType !== "luminaire") return overlay;
  const connected = device.ports.some((port) => port.connectedSegmentIds.length > 0);
  const sizeMm: [number, number, number] = [connected ? device.sizeMm[0] : diameterMm, connected ? device.sizeMm[1] : diameterMm, depthMm];
  if (device.sizeMm.every((value, index) => value === sizeMm[index])) return overlay;
  if (sizeMm[0] !== device.sizeMm[0]) return { ...overlay, devices: overlay.devices.map((candidate) => candidate.id === deviceId ? rebuildNetworkDevice(candidate, sizeMm) : candidate) };
  return { ...overlay, devices: overlay.devices.map((candidate) => candidate.id === deviceId ? { ...candidate, sizeMm } : candidate) };
}
