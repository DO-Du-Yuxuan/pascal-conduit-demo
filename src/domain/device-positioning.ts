import type { ConduitOverlayDocument, NetworkDevice, RoutePoint, Vec3 } from "./overlay";
import { isReferencePlaneEligibleDeviceType, rebuildNetworkDevice } from "./devices";

export type DevicePositioningContext = {
  levelFloorY: Readonly<Record<string, number>>;
  wallSpans: Readonly<Record<string, readonly [number, number]>>;
  wallOpenings?: Readonly<Record<string, readonly { id: string; start: number; end: number }[]>>;
  wallFaces?: readonly { id: string; levelId: string; point: Vec3; normal: Vec3; start?: Vec3; end?: Vec3; halfThickness?: number }[];
  /** Triangles from physical Building entities only; dimensions raycast these finite surfaces. */
  physicalSurfaces?: readonly { objectId: string; objectKind: string; vertices: readonly [Vec3, Vec3, Vec3] }[];
};

export type DevicePositionDescription = {
  vertical?: { millimeters: number; kind: "finished-floor" | "reference-plane"; direction?: Vec3; witness?: { objectId: string; objectKind: string; point: Vec3 } };
  horizontal?: { millimeters: number; kind: "device" | "wall-end" | "opening"; referenceId: string; direction: -1 | 1 };
  planar?: { key: string; millimeters: number; wallId: string; direction: Vec3; witness?: { objectId: string; objectKind: string; point: Vec3 } }[];
};

export type DevicePositionEdit = {
  deviceIds: string[];
  bottomHeightMm?: number;
  horizontalClearanceMm?: number;
  elevationMm?: number;
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

function rayTriangle(origin: Vec3, direction: Vec3, vertices: readonly [Vec3, Vec3, Vec3]): number | null {
  const [a, b, c] = vertices, edge1 = subtract(b, a), edge2 = subtract(c, a);
  const p: Vec3 = [direction[1] * edge2[2] - direction[2] * edge2[1], direction[2] * edge2[0] - direction[0] * edge2[2], direction[0] * edge2[1] - direction[1] * edge2[0]];
  const determinant = dot(edge1, p);
  if (Math.abs(determinant) < 1e-9) return null;
  const inverse = 1 / determinant, offset = subtract(origin, a), u = dot(offset, p) * inverse;
  if (u < -1e-8 || u > 1 + 1e-8) return null;
  const q: Vec3 = [offset[1] * edge1[2] - offset[2] * edge1[1], offset[2] * edge1[0] - offset[0] * edge1[2], offset[0] * edge1[1] - offset[1] * edge1[0]];
  const v = dot(direction, q) * inverse;
  if (v < -1e-8 || u + v > 1 + 1e-8) return null;
  const distance = dot(edge2, q) * inverse;
  return distance > 1e-7 ? distance : null;
}

function firstPhysicalHit(origin: Vec3, direction: Vec3, context: DevicePositioningContext, accepts?: (surface: NonNullable<DevicePositioningContext["physicalSurfaces"]>[number]) => boolean) {
  const hits = (context.physicalSurfaces ?? []).flatMap((surface) => {
    // Furniture is display geometry, never a positioning witness. Keep this
    // independent of layer visibility so hiding furniture cannot change a value.
    if (surface.objectKind === "item" || surface.objectKind === "shelf" || surface.objectKind === "cabinet" || surface.objectKind === "cabinet-module") return [];
    if (accepts && !accepts(surface)) return [];
    const distance = rayTriangle(origin, direction, surface.vertices);
    return distance === null ? [] : [{ distance, objectId: surface.objectId, objectKind: surface.objectKind, point: add(origin, scale(direction, distance)) }];
  }).sort((a, b) => a.distance - b.distance || a.objectId.localeCompare(b.objectId));
  return hits[0];
}

function normalized(vector: Vec3 | undefined): Vec3 | null {
  if (!vector) return null;
  const magnitude = Math.hypot(...vector);
  return magnitude > 1e-8 ? scale(vector, 1 / magnitude) : null;
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
    if (Math.abs(direction[1]) > .9) {
      const downward = direction[1] < 0;
      const hit = firstPhysicalHit(origin, direction, context, downward
        ? surface => surface.objectKind === "slab"
        : surface => surface.objectKind === "wall" && surface.objectId === attachment.hostId);
      return hit ? [{ key, wallId: key, direction, millimeters: Math.round(hit.distance * 1000), witness: { objectId: hit.objectId, objectKind: hit.objectKind, point: hit.point } }] : [];
    }

    const peerHits = overlay.devices.flatMap(peer => {
      const peerAttachment = peer.position.attachment;
      if (peer.id === device.id || peerAttachment?.hostKind !== "wall" || peerAttachment.hostId !== attachment.hostId) return [];
      const offset = subtract(peer.position.position, origin), along = dot(offset, direction);
      const perpendicular = subtract(offset, scale(direction, along));
      if (along <= 1e-5 || Math.hypot(...perpendicular) > .005) return [];
      return [{ distance: along, objectId: peer.id, objectKind: "device", point: add(origin, scale(direction, along)) }];
    });
    // Move the ray one millimetre into the host wall so that a ray along the
    // wall face can hit real end and opening reveals instead of being coplanar.
    const wallRayOrigin = subtract(origin, scale(attachment.normal, .001));
    const wallHit = firstPhysicalHit(wallRayOrigin, direction, context, surface => surface.objectId === attachment.hostId);
    const wallAlong = wallHit ? dot(subtract(wallHit.point, wallRayOrigin), direction) : undefined;
    const candidates = [
      ...peerHits,
      ...(wallHit && wallAlong !== undefined && wallAlong > 1e-5 ? [{ distance: wallAlong, objectId: wallHit.objectId, objectKind: wallHit.objectKind, point: add(origin, scale(direction, wallAlong)) }] : []),
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
    const physicalHit = firstPhysicalHit(origin, direction, context);
    const sameHostDeviceHits = overlay.devices.flatMap(peer => {
      const attachment = device.position.attachment, peerAttachment = peer.position.attachment;
      if (peer.id === device.id || !attachment || peerAttachment?.hostKind === "wall" || peerAttachment?.hostKind !== attachment.hostKind || peerAttachment.hostId !== attachment.hostId || peerAttachment.surface !== attachment.surface) return [];
      const offset = subtract(peer.position.position, origin), along = dot(offset, direction);
      const perpendicular = subtract(offset, scale(direction, along));
      // Floor-mounted boxes that represent one row/column may be a little out of square.
      // The witness and value remain the actual centre-to-centre measurement.
      const centerDistance = Math.hypot(...offset);
      if (along <= 1e-5 || Math.hypot(...perpendicular) > .1 || centerDistance < 1e-5) return [];
      const centerRayHit = firstPhysicalHit(origin, scale(offset, 1 / centerDistance), context);
      if (centerRayHit && centerRayHit.distance < centerDistance - 1e-5) return [centerRayHit];
      return [{ distance: centerDistance, objectId: peer.id, objectKind: "device", point: peer.position.position }];
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
  if (attachment && context.physicalSurfaces) return { planar: planarReferences(overlay, device, context) };
  if (device.mount?.kind === "reference-plane" && context.physicalSurfaces) {
    const hit = firstPhysicalHit(device.position.position, [0, -1, 0], context);
    return {
      vertical: hit ? { millimeters: Math.round(hit.distance * 1000), kind: "reference-plane", direction: [0, -1, 0], witness: { objectId: hit.objectId, objectKind: hit.objectKind, point: hit.point } } : undefined,
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
    return { vertical: floor === undefined ? undefined : { millimeters: Math.round((device.position.position[1] - floor) * 1000), kind: "reference-plane" }, planar: planarReferences(overlay, device, context) };
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
      circuits: overlay.circuits.map((circuit) => ({ ...circuit, segmentIds: circuit.segmentIds.filter((id) => segmentIds.has(id)), status: circuit.segmentIds.some((id) => removedIds.has(id)) ? "broken" as const : circuit.status })),
      surfaceChases: overlay.surfaceChases.filter((chase) => segmentIds.has(chase.routeElementId) || fittingIds.has(chase.routeElementId)),
      penetrations: overlay.penetrations.filter((penetration) => segmentIds.has(penetration.segmentId)),
    },
  };
}

export function editDevicePosition(overlay: ConduitOverlayDocument, edit: DevicePositionEdit, context: DevicePositioningContext, mode: "preview" | "commit"): DevicePositionEditResult {
  if (!edit.deviceIds.length || !finiteNonNegative(edit.bottomHeightMm) || !finiteNonNegative(edit.horizontalClearanceMm) || !finiteNonNegative(edit.elevationMm) || !finiteNonNegative(edit.verticalClearanceMm) || Object.values(edit.planarClearanceMm ?? {}).some((value) => !finiteNonNegative(value))) return { status: "rejected", overlay, removedSegmentIds: [], skippedDeviceIds: edit.deviceIds, diagnostics: ["定位尺寸必须是非负有限数值。"] };
  const selected = new Set(edit.deviceIds), skipped: string[] = [], moved = new Map<string, NetworkDevice>();
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
          const desiredAlongMm = Math.sqrt(Math.max(0, requested * requested - lateralMm * lateralMm));
          const currentAlongMm = planar.witness ? dot(subtract(planar.witness.point, device.position.position), planar.direction) * 1000 : planar.millimeters;
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
      const promotesHostedPoint = device.position.attachment?.hostKind !== "wall" && canEditAsReferencePlane(device);
      if (promotesHostedPoint && floor === undefined) { skipped.push(device.id); continue; }
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
      delta = [0, floor + edit.elevationMm / 1000 - device.position.position[1], 0];
      if (!edit.planarClearanceMm) { if (hasMovement(delta)) moved.set(device.id, moveDevice(device, delta, undefined, { levelId, elevationMm: edit.elevationMm }, mode === "commit")); continue; }
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
      const movedDevice = moveDevice(device, delta, undefined, { levelId, elevationMm: edit.elevationMm ?? Math.round((device.position.position[1] + delta[1] - floor) * 1000) }, mode === "commit");
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
  if (!moved.size) return { status: "rejected", overlay, removedSegmentIds: [], skippedDeviceIds: skipped, diagnostics: ["所选设备没有可编辑的定位参考。"] };
  const withMovedDevices = { ...overlay, devices: overlay.devices.map((device) => moved.get(device.id) ?? device) };
  if (mode === "preview") return { status: "preview", overlay: withMovedDevices, removedSegmentIds: [], skippedDeviceIds: skipped, diagnostics: [] };
  const removed = removeAdjacentSegments(overlay, new Set(moved.keys()));
  const committed = { ...removed.overlay, devices: removed.overlay.devices.map((device) => moved.get(device.id) ?? device) };
  return { status: "committed", overlay: committed, removedSegmentIds: [...removed.removedIds], skippedDeviceIds: skipped, diagnostics: skipped.length ? ["部分所选设备不属于安装参考平面，未移动。"] : [] };
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

/**
 * A Spotlight's installation centre and cable ports are physical references.
 * Its cylinder can change diameter/depth without rebuilding that topology.
 */
export function resizeSpotlight(overlay: ConduitOverlayDocument, deviceId: string, diameterMm: number, depthMm: number): ConduitOverlayDocument {
  if (!Number.isFinite(diameterMm) || diameterMm <= 0 || !Number.isFinite(depthMm) || depthMm <= 0) return overlay;
  const device = overlay.devices.find((candidate) => candidate.id === deviceId);
  if (!device || device.deviceType !== "luminaire") return overlay;
  const sizeMm: [number, number, number] = [diameterMm, diameterMm, depthMm];
  if (device.sizeMm.every((value, index) => value === sizeMm[index])) return overlay;
  return { ...overlay, devices: overlay.devices.map((candidate) => candidate.id === deviceId ? { ...candidate, sizeMm } : candidate) };
}
