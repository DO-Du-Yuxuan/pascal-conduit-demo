import type { ConduitOverlayDocument, NetworkDevice, RoutePoint, Vec3 } from "./overlay";
import { rebuildNetworkDevice } from "./devices";

export type DevicePositioningContext = {
  levelFloorY: Readonly<Record<string, number>>;
  wallSpans: Readonly<Record<string, readonly [number, number]>>;
  wallOpenings?: Readonly<Record<string, readonly { id: string; start: number; end: number }[]>>;
  wallFaces?: readonly { id: string; levelId: string; point: Vec3; normal: Vec3; start?: Vec3; end?: Vec3; halfThickness?: number }[];
};

export type DevicePositionDescription = {
  vertical?: { millimeters: number; kind: "finished-floor" | "reference-plane" };
  horizontal?: { millimeters: number; kind: "device" | "wall-end" | "opening"; referenceId: string; direction: -1 | 1 };
  planar?: { millimeters: number; wallId: string; direction: Vec3 }[];
};

export type DevicePositionEdit = {
  deviceIds: string[];
  bottomHeightMm?: number;
  horizontalClearanceMm?: number;
  elevationMm?: number;
  planarClearanceMm?: Readonly<Record<string, number>>;
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
const footprintExtent = (device: NetworkDevice, normal: Vec3) => Math.abs(normal[0]) * device.sizeMm[0] / 2000 + Math.abs(normal[2]) * device.sizeMm[2] / 2000;

function planarReferences(device: NetworkDevice, context: DevicePositioningContext): NonNullable<DevicePositionDescription["planar"]> {
  const levelId = device.mount?.kind === "reference-plane" ? device.mount.levelId : device.position.attachment?.levelId;
  const candidates = (context.wallFaces ?? []).filter((face) => {
    if (face.levelId !== levelId || !face.start || !face.end) return face.levelId === levelId;
    const tangent = subtract(face.end, face.start), length = Math.hypot(...tangent);
    if (length < 1e-8) return false;
    const along = dot(subtract(device.position.position, face.start), scale(tangent, 1 / length));
    return along >= -1e-6 && along <= length + 1e-6;
  }).map((face) => {
    const signed = dot(subtract(device.position.position, face.point), face.normal), direction = scale(face.normal, signed < 0 ? -1 : 1);
    const surfaceDistance = Math.max(0, Math.abs(signed) - (face.halfThickness ?? 0));
    return { millimeters: Math.max(0, Math.round((surfaceDistance - footprintExtent(device, face.normal)) * 1000)), wallId: face.id, direction, distance: surfaceDistance };
  });
  const persisted = device.positioning?.planarWallIds?.map((id) => candidates.find((candidate) => candidate.wallId === id)).filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));
  const ordered = persisted?.length ? persisted : candidates.sort((a, b) => a.distance - b.distance || a.wallId.localeCompare(b.wallId));
  const first = ordered[0], second = first && ordered.find((candidate) => candidate.wallId !== first.wallId && Math.abs(dot(candidate.direction, first.direction)) <= .25);
  return [first, second].filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate)).map(({ distance: _distance, ...reference }) => reference);
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
  if (attachment?.hostKind === "wall") {
    const levelId = attachment.levelId;
    const floorY = levelId ? context.levelFloorY[levelId] : undefined;
    return {
      vertical: floorY === undefined ? undefined : { millimeters: Math.round((device.position.position[1] - device.sizeMm[1] / 2000 - floorY) * 1000), kind: "finished-floor" },
      horizontal: horizontalReference(overlay, device, context),
    };
  }
  if (device.mount?.kind === "reference-plane") return { vertical: { millimeters: device.mount.elevationMm, kind: "reference-plane" }, planar: planarReferences(device, context) };
  if (attachment?.hostKind === "slab") return { planar: planarReferences(device, context) };
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

function moveDevice(device: NetworkDevice, delta: Vec3, reference?: NonNullable<DevicePositionDescription["horizontal"]>, elevationMm?: number, clearConnections = true): NetworkDevice {
  const referencePlaneMount = device.mount?.kind === "reference-plane" ? device.mount : undefined;
  const referencePlane = Boolean(referencePlaneMount);
  const movedPosition = translatedPoint(device.position, delta, referencePlane);
  return {
    ...device,
    position: movedPosition,
    mount: referencePlaneMount ? { ...referencePlaneMount, elevationMm: elevationMm ?? referencePlaneMount.elevationMm } : device.mount?.kind === "host" && movedPosition.attachment ? { kind: "host", attachment: structuredClone(movedPosition.attachment) } : device.mount,
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
  if (!edit.deviceIds.length || !finiteNonNegative(edit.bottomHeightMm) || !finiteNonNegative(edit.horizontalClearanceMm) || !finiteNonNegative(edit.elevationMm) || Object.values(edit.planarClearanceMm ?? {}).some((value) => !finiteNonNegative(value))) return { status: "rejected", overlay, removedSegmentIds: [], skippedDeviceIds: edit.deviceIds, diagnostics: ["定位尺寸必须是非负有限数值。"] };
  const selected = new Set(edit.deviceIds), skipped: string[] = [], moved = new Map<string, NetworkDevice>();
  for (const device of overlay.devices) {
    if (!selected.has(device.id)) continue;
    let delta: Vec3 = [0, 0, 0];
    let reference: DevicePositionDescription["horizontal"];
    if (edit.elevationMm !== undefined) {
      if (device.mount?.kind !== "reference-plane") { skipped.push(device.id); continue; }
      const floor = context.levelFloorY[device.mount.levelId];
      if (floor === undefined) { skipped.push(device.id); continue; }
      delta = [0, floor + edit.elevationMm / 1000 - device.position.position[1], 0];
      if (!edit.planarClearanceMm) { if (hasMovement(delta)) moved.set(device.id, moveDevice(device, delta, undefined, edit.elevationMm, mode === "commit")); continue; }
    }
    if (edit.planarClearanceMm && (device.mount?.kind === "reference-plane" || device.position.attachment?.hostKind === "slab")) {
      const references = planarReferences(device, context);
      if (!references.length) { skipped.push(device.id); continue; }
      for (const reference of references) {
        const proposed = edit.planarClearanceMm[reference.wallId];
        if (proposed === undefined) continue;
        delta = add(delta, scale(reference.direction, (proposed - reference.millimeters) / 1000));
      }
      if (!hasMovement(delta)) continue;
      const movedDevice = moveDevice(device, delta, undefined, edit.elevationMm, mode === "commit");
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
    if (hasMovement(delta)) moved.set(device.id, moveDevice(device, delta, reference, edit.elevationMm, mode === "commit"));
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
