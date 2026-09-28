import type { ConduitOverlayDocument, HvacControlConduit, HvacDuct, HvacDuctOutlet, HvacDevicePort, HvacIndoorUnit, HvacOutletFace, HvacSystem, HvacThermostat, HvacWallPenetration, RoutePoint, Vec3 } from './overlay';
import { deviceFrame } from './devices';
import { validatePlannedRoute } from './routing-collision';
import { planRoute, type PlannedRoute } from './routing';

export const HVAC_DEFAULT_UNIT_SIZE_MM: [number, number, number] = [1000, 600, 300];
export const HVAC_DEFAULT_SECTION_MM: [number, number] = [500, 200];
export const HVAC_DEFAULT_OUTLET_MM: [number, number] = [300, 150];
export const HVAC_CONTROL_CONDUIT_DIAMETER_MM = 20;
export const HVAC_CONTROL_CONDUIT_COLOR = '#ffffff';
export const HVAC_COLORS: Record<HvacSystem, string> = { supply: '#0ea5e9', return: '#f97316' };
const stamp = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const clone = <T>(value: T): T => structuredClone(value);
const length = (a: Vec3, b: Vec3) => Math.hypot(...a.map((value, axis) => value - b[axis]));
const direction = (a: Vec3, b: Vec3): Vec3 => { const d = b.map((value, axis) => value - a[axis]) as Vec3, l = Math.hypot(...d); return l < 1e-8 ? [0, 0, 0] : d.map(value => value / l) as Vec3; };
const orthogonal = (left: Vec3, right: Vec3) => Math.abs(left[0] * right[0] + left[1] * right[1] + left[2] * right[2]) < 1e-5;

/**
 * The local X axis is the shared duct width and the local Z axis is airflow.
 * Keeping this frame here makes plan, 3D, previews, and route starts agree.
 */
export function indoorUnitPort(unit: HvacIndoorUnit, system: HvacSystem): RoutePoint {
  const yaw = unit.rotationYDegrees * Math.PI / 180;
  const sign = system === 'supply' ? 1 : -1;
  const offset = unit.sizeMm[0] / 2000 * sign;
  return {
    position: [
      unit.position.position[0] + Math.sin(yaw) * offset,
      unit.position.position[1],
      unit.position.position[2] + Math.cos(yaw) * offset,
    ],
  };
}

/** Three.js casing geometry is [width, height, length]; the duct section has its own dimensions. */
export function indoorUnitCasingSizeMeters(unit: HvacIndoorUnit): [number, number, number] {
  return [unit.sizeMm[1] / 1000, unit.sizeMm[2] / 1000, unit.sizeMm[0] / 1000];
}

/** The first rectangular duct leaves its clicked port along this outward airflow normal. */
export function indoorUnitPortDirection(unit: HvacIndoorUnit, system: HvacSystem): Vec3 {
  const yaw = unit.rotationYDegrees * Math.PI / 180, sign = system === 'supply' ? 1 : -1;
  const clean = (value: number) => Math.abs(value) < 1e-12 ? 0 : value;
  return [clean(Math.sin(yaw) * sign), 0, clean(Math.cos(yaw) * sign)];
}

/** The first leg must leave the clicked port, even when the pointer is on its reverse side. */
export function projectFirstDuctSegmentFromPort(unit: HvacIndoorUnit, system: HvacSystem, target: RoutePoint): RoutePoint {
  const start = indoorUnitPort(unit, system), direction = indoorUnitPortDirection(unit, system), delta = target.position.map((value, axis) => value - start.position[axis]) as Vec3, distance = Math.abs(delta[0] * direction[0] + delta[1] * direction[1] + delta[2] * direction[2]);
  return { ...target, position: start.position.map((value, axis) => value + direction[axis] * distance) as Vec3 };
}

export function indoorUnitFootprint(unit: HvacIndoorUnit): readonly [Vec3, Vec3, Vec3, Vec3] {
  const yaw = unit.rotationYDegrees * Math.PI / 180;
  const right: Vec3 = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const forward: Vec3 = [Math.sin(yaw), 0, Math.cos(yaw)];
  const halfWidth = unit.sizeMm[1] / 2000, halfLength = unit.sizeMm[0] / 2000;
  const corner = (longitudinal: -1 | 1, lateral: -1 | 1): Vec3 => [
    unit.position.position[0] + right[0] * lateral * halfWidth + forward[0] * longitudinal * halfLength,
    unit.position.position[1],
    unit.position.position[2] + right[2] * lateral * halfWidth + forward[2] * longitudinal * halfLength,
  ];
  return [corner(-1, -1), corner(-1, 1), corner(1, 1), corner(1, -1)];
}

export type HvacMeasurementWall = { id: string; start: Vec3; end: Vec3; normal: Vec3; halfThickness?: number };
export type HvacAxisPlanarReference = { key: 'px' | 'nx' | 'pz' | 'nz'; label: '+X' | '−X' | '+Z' | '−Z'; axis: 'x' | 'z'; sign: -1 | 1; start: Vec3; end: Vec3; millimeters: number; targetId: string; targetKind: 'wall' | 'indoor-unit' };

const crossXZ = (left: Vec3, right: Vec3) => left[0] * right[2] - left[2] * right[0];
const subtract = (left: Vec3, right: Vec3): Vec3 => [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
const addScaled = (point: Vec3, direction: Vec3, distance: number): Vec3 => [point[0] + direction[0] * distance, point[1] + direction[1] * distance, point[2] + direction[2] * distance];
function raySegmentDistanceXZ(origin: Vec3, direction: Vec3, start: Vec3, end: Vec3): number | null {
  const edge = subtract(end, start), offset = subtract(start, origin), denominator = crossXZ(direction, edge);
  if (Math.abs(denominator) < 1e-8) return null;
  const distance = crossXZ(offset, edge) / denominator, along = crossXZ(offset, direction) / denominator;
  return distance >= -1e-8 && along >= -1e-8 && along <= 1 + 1e-8 ? Math.max(0, distance) : null;
}
function rayPolygonDistanceXZ(origin: Vec3, direction: Vec3, polygon: readonly Vec3[]): number | null {
  const distances = polygon.map((point, index) => raySegmentDistanceXZ(origin, direction, point, polygon[(index + 1) % polygon.length]!)).filter((value): value is number => value !== null);
  return distances.length ? Math.min(...distances) : null;
}
function wallFootprint(wall: HvacMeasurementWall): readonly [Vec3, Vec3, Vec3, Vec3] {
  const magnitude = Math.hypot(wall.normal[0], wall.normal[2]) || 1, width = wall.halfThickness ?? 0, normal: Vec3 = [wall.normal[0] / magnitude, 0, wall.normal[2] / magnitude];
  return [addScaled(wall.start, normal, width), addScaled(wall.end, normal, width), addScaled(wall.end, normal, -width), addScaled(wall.start, normal, -width)];
}

/**
 * Four signed world-axis dimensions. Each starts on the selected unit's real
 * footprint and ends at the first physical Wall or vertically-overlapping
 * Indoor unit footprint in that direction.
 */
export function hvacAxisPlanarReferences(unit: HvacIndoorUnit, walls: readonly HvacMeasurementWall[], indoorUnits: readonly HvacIndoorUnit[]): HvacAxisPlanarReference[] {
  const origin = unit.position.position, ownFootprint = indoorUnitFootprint(unit), axes: readonly { key: HvacAxisPlanarReference['key']; label: HvacAxisPlanarReference['label']; axis: HvacAxisPlanarReference['axis']; sign: -1 | 1; direction: Vec3 }[] = [
    { key: 'px', label: '+X', axis: 'x', sign: 1, direction: [1, 0, 0] }, { key: 'nx', label: '−X', axis: 'x', sign: -1, direction: [-1, 0, 0] }, { key: 'pz', label: '+Z', axis: 'z', sign: 1, direction: [0, 0, 1] }, { key: 'nz', label: '−Z', axis: 'z', sign: -1, direction: [0, 0, -1] },
  ];
  const ownBottom = unit.position.position[1] - unit.sizeMm[2] / 2000, ownTop = unit.position.position[1] + unit.sizeMm[2] / 2000;
  return axes.flatMap(axis => {
    const ownExtent = Math.max(...ownFootprint.map(point => (point[0] - origin[0]) * axis.direction[0] + (point[2] - origin[2]) * axis.direction[2]));
    const targets = [
      ...walls.map(wall => ({ targetId: wall.id, targetKind: 'wall' as const, distance: rayPolygonDistanceXZ(origin, axis.direction, wallFootprint(wall)) })),
      ...indoorUnits.filter(other => other.id !== unit.id && other.position.position[1] - other.sizeMm[2] / 2000 <= ownTop && other.position.position[1] + other.sizeMm[2] / 2000 >= ownBottom).map(other => ({ targetId: other.id, targetKind: 'indoor-unit' as const, distance: rayPolygonDistanceXZ(origin, axis.direction, indoorUnitFootprint(other)) })),
    ].filter((target): target is { targetId: string; targetKind: 'wall' | 'indoor-unit'; distance: number } => target.distance !== null && target.distance >= ownExtent - 1e-8).sort((left, right) => left.distance - right.distance || left.targetId.localeCompare(right.targetId));
    const target = targets[0];
    if (!target) return [];
    return [{ key: axis.key, label: axis.label, axis: axis.axis, sign: axis.sign, start: addScaled(origin, axis.direction, ownExtent), end: addScaled(origin, axis.direction, target.distance), millimeters: Math.max(0, Math.round((target.distance - ownExtent) * 1000)), targetId: target.targetId, targetKind: target.targetKind }];
  });
}
export const hvacUnitConnected = (overlay: ConduitOverlayDocument, unitId: string) => overlay.hvac.ducts.some(duct => duct.indoorUnitId === unitId && duct.segmentIds.length > 0)
  || overlay.hvac.controlConduits.some(route => route.indoorUnitId === unitId)
  || Boolean(overlay.hvac.indoorUnits.find(unit => unit.id === unitId)?.powerPort?.connectedSegmentIds.length);

export function createHvacUnitPorts(id: string, position: RoutePoint, sizeMm: [number, number, number], rotationYDegrees: number): Pick<HvacIndoorUnit, 'powerPort' | 'controlPort'> {
  const yaw = rotationYDegrees * Math.PI / 180, right: Vec3 = [Math.cos(yaw), 0, -Math.sin(yaw)], forward: Vec3 = [Math.sin(yaw), 0, Math.cos(yaw)];
  const port = (kind: 'power' | 'control', side: 1 | -1, along: 1 | -1, system: HvacDevicePort['system']): HvacDevicePort => {
    const direction: Vec3 = right.map(value => value * side) as Vec3;
    const longitudinal = sizeMm[0] / 4000 * along;
    const offset = sizeMm[1] / 2000;
    const point: RoutePoint = { position: position.position.map((value, axis) => value + direction[axis] * offset + forward[axis] * longitudinal) as Vec3, ...(position.attachment ? { attachment: clone(position.attachment) } : {}) };
    return { id: `${id}:${kind}-port`, ownerId: id, position: point, direction, role: kind === 'power' ? 'sink' : 'sink', system, connectedSegmentIds: [] };
  };
  return { powerPort: port('power', 1, -1, 'receptacle'), controlPort: port('control', -1, 1, 'hvac-control') };
}

export type HvacThermostatPortCandidate = { key: string; position: RoutePoint; direction: Vec3 };
export function hvacThermostatPortCandidates(position: RoutePoint, sizeMm: [number, number, number]): HvacThermostatPortCandidate[] {
  const frame = deviceFrame(position), sides: Array<{ face: string; direction: Vec3; lateral: Vec3; extent: number; span: number }> = [
    { face: 'top', direction: frame.up, lateral: frame.right, extent: sizeMm[1] / 2000, span: sizeMm[0] / 1000 },
    { face: 'bottom', direction: frame.up.map(value => -value) as Vec3, lateral: frame.right, extent: sizeMm[1] / 2000, span: sizeMm[0] / 1000 },
    { face: 'left', direction: frame.right.map(value => -value) as Vec3, lateral: frame.up, extent: sizeMm[0] / 2000, span: sizeMm[1] / 1000 },
    { face: 'right', direction: frame.right, lateral: frame.up, extent: sizeMm[0] / 2000, span: sizeMm[1] / 1000 },
  ];
  return sides.flatMap(side => ([-1, 1] as const).map((slot, index) => ({
    key: `${side.face}:${index}`,
    position: { position: position.position.map((value, axis) => value + side.direction[axis]! * side.extent + side.lateral[axis]! * side.span * .22 * slot) as Vec3, ...(position.attachment ? { attachment: clone(position.attachment) } : {}) },
    direction: side.direction.map(value => value === 0 ? 0 : value) as Vec3,
  })));
}

export function createHvacThermostatPort(id: string, position: RoutePoint, sizeMm: [number, number, number], candidateKey = 'bottom:0'): HvacDevicePort {
  // The alternatives use the same eight perimeter holes as a physical 86 box.
  const candidate = hvacThermostatPortCandidates(position, sizeMm).find(item => item.key === candidateKey) ?? hvacThermostatPortCandidates(position, sizeMm)[2]!;
  return { id: `${id}:control-port`, ownerId: id, position: clone(candidate.position), direction: candidate.direction, role: 'source', system: 'hvac-control', connectedSegmentIds: [] };
}
export const ensureHvacUnitPorts = (unit: HvacIndoorUnit): HvacIndoorUnit => {
  if (unit.powerPort && unit.controlPort) return unit;
  const defaults = createHvacUnitPorts(unit.id, unit.position, unit.sizeMm, unit.rotationYDegrees);
  return { ...unit, ...(!unit.powerPort ? { powerPort: defaults.powerPort } : {}), ...(!unit.controlPort ? { controlPort: defaults.controlPort } : {}) };
};
export const ensureHvacThermostatPort = (thermostat: HvacThermostat): HvacThermostat => ({ ...thermostat, ...(!thermostat.controlPort ? { controlPort: createHvacThermostatPort(thermostat.id, thermostat.position, thermostat.sizeMm) } : {}) });

export function selectHvacThermostatPort(overlay: ConduitOverlayDocument, thermostatId: string, candidateKey: string): { overlay: ConduitOverlayDocument } | { overlay: ConduitOverlayDocument; reason: string } {
  const thermostat = overlay.hvac.thermostats.find(item => item.id === thermostatId);
  if (!thermostat) return { overlay, reason: '控温器不存在。' };
  if (thermostat.controlPort?.connectedSegmentIds.length || overlay.hvac.controlConduits.some(route => route.thermostatId === thermostatId)) return { overlay, reason: '控温器已连接控制管，不能更换接管孔。' };
  const candidate = hvacThermostatPortCandidates(thermostat.position, thermostat.sizeMm).find(item => item.key === candidateKey);
  if (!candidate) return { overlay, reason: '控温器接管孔无效。' };
  const current = ensureHvacThermostatPort(thermostat).controlPort!;
  if (JSON.stringify(current.position) === JSON.stringify(candidate.position) && current.direction.every((value, index) => Math.abs(value - candidate.direction[index]!) < 1e-9)) return { overlay };
  return { overlay: { ...overlay, hvac: { ...overlay.hvac, thermostats: overlay.hvac.thermostats.map(item => item.id === thermostatId ? { ...item, controlPort: { ...current, position: clone(candidate.position), direction: [...candidate.direction] as Vec3 } } : item) } } };
}

/** A routed thermostat stays fixed so its physical endpoint cannot drift from the saved route. */
export function editThermostat(overlay: ConduitOverlayDocument, thermostatId: string, change: Partial<Pick<HvacThermostat, 'name' | 'position' | 'mount' | 'positioning'>>): { overlay: ConduitOverlayDocument } | { overlay: ConduitOverlayDocument; reason: string } {
  const thermostat = overlay.hvac.thermostats.find(item => item.id === thermostatId);
  if (!thermostat) return { overlay, reason: '控温器不存在。' };
  const routed = overlay.hvac.controlConduits.some(route => route.thermostatId === thermostatId);
  if (routed && (change.position || change.mount || change.positioning)) return { overlay, reason: '控温器已连接控制线管，请先删除线管再移动。' };
  const next = { ...ensureHvacThermostatPort(thermostat), ...change };
  if (change.position && next.controlPort) {
    const offset = next.controlPort.position.position.map((value, axis) => value - thermostat.position.position[axis]) as Vec3;
    next.controlPort = { ...next.controlPort, position: { position: change.position.position.map((value, axis) => value + offset[axis]!) as Vec3, ...(change.position.attachment ? { attachment: clone(change.position.attachment) } : {}) } };
  }
  return { overlay: { ...overlay, hvac: { ...overlay.hvac, thermostats: overlay.hvac.thermostats.map(item => item.id === thermostatId ? next : item) } } };
}

/** A connected unit may change its shared duct section but never move, yaw, or change casing length. */
export function editIndoorUnit(overlay: ConduitOverlayDocument, unitId: string, change: Partial<Pick<HvacIndoorUnit, 'position' | 'rotationYDegrees' | 'sizeMm' | 'sectionMm'>>): { overlay: ConduitOverlayDocument } | { overlay: ConduitOverlayDocument; reason: string } {
  const unit = overlay.hvac.indoorUnits.find(item => item.id === unitId);
  if (!unit) return { overlay, reason: '空调内机不存在。' };
  const connected = hvacUnitConnected(overlay, unitId);
  if (connected && (change.position || change.rotationYDegrees !== undefined || change.sizeMm && change.sizeMm[0] !== unit.sizeMm[0])) return { overlay, reason: '已连接风管的内机不能移动、旋转或修改外壳长度。' };
  const sectionMm = change.sectionMm ? [...change.sectionMm] as [number, number] : unit.sectionMm;
  const requestedSize = change.sizeMm ? [...change.sizeMm] as [number, number, number] : unit.sizeMm;
  const next = { ...unit, ...change, sizeMm: requestedSize, sectionMm };
  if (next.sectionMm.some(value => !Number.isFinite(value) || value <= 0)) return { overlay, reason: '风管截面必须为正数。' };
  if (!connected && (change.position || change.rotationYDegrees !== undefined || change.sizeMm)) Object.assign(next, createHvacUnitPorts(unit.id, next.position, next.sizeMm, next.rotationYDegrees));
  return { overlay: { ...overlay, hvac: { ...overlay.hvac, indoorUnits: overlay.hvac.indoorUnits.map(item => item.id === unitId ? next : item) } } };
}

export function placeIndoorUnit(overlay: ConduitOverlayDocument, position: RoutePoint, name = 'FCU 空调内机'): { overlay: ConduitOverlayDocument; unit: HvacIndoorUnit } {
  const supportedCenter: RoutePoint = { ...clone(position), position: [position.position[0], position.position[1] + HVAC_DEFAULT_UNIT_SIZE_MM[2] / 2000, position.position[2]] };
  const unitId = id('hvac-unit'), sizeMm: [number, number, number] = [...HVAC_DEFAULT_UNIT_SIZE_MM];
  const unit: HvacIndoorUnit = { id: unitId, type: 'indoor-air-handling-unit', name, position: supportedCenter, mount: position.attachment ? { kind: 'host', attachment: clone(position.attachment) } : undefined, sizeMm, sectionMm: [...HVAC_DEFAULT_SECTION_MM], rotationYDegrees: 0, ...createHvacUnitPorts(unitId, supportedCenter, sizeMm, 0), createdAt: stamp() };
  return { overlay: { ...overlay, hvac: { ...overlay.hvac, indoorUnits: [...overlay.hvac.indoorUnits, unit] } }, unit };
}

export function placeThermostat(overlay: ConduitOverlayDocument, position: RoutePoint, name = 'FCU 温控器'): { overlay: ConduitOverlayDocument; thermostat: HvacThermostat } | { overlay: ConduitOverlayDocument; reason: string } {
  if (position.attachment?.hostKind !== 'wall' && position.attachment?.hostKind !== 'beam') return { overlay, reason: '控温器只能安装在墙面或梁侧面。' };
  const thermostatId = id('thermostat'), sizeMm: [number, number, number] = [86, 86, 50];
  const thermostat: HvacThermostat = { id: thermostatId, type: 'thermostat', name, position: clone(position), mount: { kind: 'host', attachment: clone(position.attachment) }, sizeMm, controlPort: createHvacThermostatPort(thermostatId, position, sizeMm), createdAt: stamp() };
  return { overlay: { ...overlay, hvac: { ...overlay.hvac, thermostats: [...overlay.hvac.thermostats, thermostat] } }, thermostat };
}

export function createHvacDuct(overlay: ConduitOverlayDocument, unitId: string, system: HvacSystem, _clickedStart: RoutePoint, end: RoutePoint): { overlay: ConduitOverlayDocument; duct: HvacDuct } | { overlay: ConduitOverlayDocument; reason: string } {
  const unit = overlay.hvac.indoorUnits.find(item => item.id === unitId);
  if (!unit) return { overlay, reason: '空调内机不存在。' };
  if (overlay.hvac.ducts.some(duct => duct.indoorUnitId === unitId && duct.system === system)) return { overlay, reason: '该内机的送风或回风路线已经存在，当前版本不支持分支。' };
  const start = indoorUnitPort(unit, system);
  if (length(start.position, end.position) < .001) return { overlay, reason: '风管长度必须大于 1 mm。' };
  const segment = { id: id('hvac-segment'), start: clone(start), end: clone(end) }, duct: HvacDuct = { id: id('hvac-duct'), type: 'hvac-duct', indoorUnitId: unitId, system, segmentIds: [segment.id], createdAt: stamp() };
  return { overlay: { ...overlay, hvac: { ...overlay.hvac, ducts: [...overlay.hvac.ducts, duct], segments: [...overlay.hvac.segments, segment] } }, duct };
}

export function appendHvacDuctSegment(overlay: ConduitOverlayDocument, ductId: string, end: RoutePoint): { overlay: ConduitOverlayDocument } | { overlay: ConduitOverlayDocument; reason: string } {
  const duct = overlay.hvac.ducts.find(item => item.id === ductId), previousId = duct?.segmentIds[duct.segmentIds.length - 1], previous = previousId ? overlay.hvac.segments.find(item => item.id === previousId) : undefined;
  if (!duct || !previous) return { overlay, reason: '风管路线不存在。' };
  if (length(previous.end.position, end.position) < .001) return { overlay, reason: '风管长度必须大于 1 mm。' };
  const dot = direction(previous.start.position, previous.end.position).reduce((sum, value, axis) => sum + value * direction(previous.end.position, end.position)[axis], 0);
  if (!orthogonal(direction(previous.start.position, previous.end.position), direction(previous.end.position, end.position)) && Math.abs(Math.abs(dot) - 1) > 1e-5) return { overlay, reason: '当前版本只支持直段和 90° 矩形弯头。' };
  const segment = { id: id('hvac-segment'), start: clone(previous.end), end: clone(end) };
  return { overlay: { ...overlay, hvac: { ...overlay.hvac, segments: [...overlay.hvac.segments, segment], ducts: overlay.hvac.ducts.map(item => item.id === duct.id ? { ...item, segmentIds: [...item.segmentIds, segment.id] } : item) } } };
}

export function resizeHvacTerminalSegment(overlay: ConduitOverlayDocument, ductId: string, lengthMm: number): { overlay: ConduitOverlayDocument } | { overlay: ConduitOverlayDocument; reason: string } {
  const duct = overlay.hvac.ducts.find(item => item.id === ductId), segmentId = duct?.segmentIds[(duct?.segmentIds.length ?? 1) - 1], segment = segmentId ? overlay.hvac.segments.find(item => item.id === segmentId) : undefined;
  if (!duct || !segment || !Number.isFinite(lengthMm) || lengthMm <= 0) return { overlay, reason: '只能修改有效风管末端段的正长度。' };
  const vector = direction(segment.start.position, segment.end.position), end = segment.start.position.map((value, axis) => value + vector[axis] * lengthMm / 1000) as Vec3;
  const faceLengthMm = lengthMm;
  if (overlay.hvac.outlets.some(outlet => outlet.segmentId === segment.id && outlet.offsetMm + outlet.sizeMm[0] > faceLengthMm + 1e-6)) return { overlay, reason: '缩短后会让风口超出风管面，已拒绝修改。' };
  return { overlay: { ...overlay, hvac: { ...overlay.hvac, segments: overlay.hvac.segments.map(item => item.id === segment.id ? { ...item, end: { position: end } } : item) } } };
}

export function addHvacOutlet(overlay: ConduitOverlayDocument, ductId: string, segmentId: string, face: HvacOutletFace, offsetMm: number, sizeMm: [number, number] = HVAC_DEFAULT_OUTLET_MM): { overlay: ConduitOverlayDocument; outlet: HvacDuctOutlet } | { overlay: ConduitOverlayDocument; reason: string } {
  const duct = overlay.hvac.ducts.find(item => item.id === ductId), segment = overlay.hvac.segments.find(item => item.id === segmentId), unit = duct && overlay.hvac.indoorUnits.find(item => item.id === duct.indoorUnitId);
  if (!duct || !segment || !unit || !duct.segmentIds.includes(segmentId)) return { overlay, reason: '风管或管段不存在。' };
  const faceLengthMm = length(segment.start.position, segment.end.position) * 1000, faceHeightMm = face === 'top' || face === 'bottom' ? unit.sectionMm[0] : unit.sectionMm[1];
  if (offsetMm < 0 || sizeMm[0] > faceLengthMm || sizeMm[1] > faceHeightMm || offsetMm + sizeMm[0] > faceLengthMm) return { overlay, reason: '风口尺寸必须完全落在所在风管面内。' };
  const outlet: HvacDuctOutlet = { id: id('hvac-outlet'), type: 'hvac-duct-outlet', ductId, segmentId, face, offsetMm, sizeMm: [...sizeMm], createdAt: stamp() };
  return { overlay: { ...overlay, hvac: { ...overlay.hvac, outlets: [...overlay.hvac.outlets, outlet] } }, outlet };
}

/** The two longitudinal clearances on the physical duct face which hosts an outlet. */
export function hvacOutletEdgeClearances(overlay: ConduitOverlayDocument, outletId: string): { fromStartMm: number; toEndMm: number } | null {
  const outlet = overlay.hvac.outlets.find(item => item.id === outletId), segment = outlet && overlay.hvac.segments.find(item => item.id === outlet.segmentId);
  if (!outlet || !segment) return null;
  const faceLengthMm = length(segment.start.position, segment.end.position) * 1000;
  return { fromStartMm: outlet.offsetMm, toEndMm: faceLengthMm - outlet.offsetMm - outlet.sizeMm[0] };
}

/** The physical face is established by the placement hit and cannot be edited afterwards. */
export function editHvacOutlet(overlay: ConduitOverlayDocument, outletId: string, change: Partial<Pick<HvacDuctOutlet, 'offsetMm' | 'sizeMm'>>): { overlay: ConduitOverlayDocument } | { overlay: ConduitOverlayDocument; reason: string } {
  const outlet = overlay.hvac.outlets.find(item => item.id === outletId);
  if (!outlet) return { overlay, reason: '风口不存在。' };
  const base = { ...overlay, hvac: { ...overlay.hvac, outlets: overlay.hvac.outlets.filter(item => item.id !== outletId) } }, candidate = addHvacOutlet(base, outlet.ductId, outlet.segmentId, outlet.face, change.offsetMm ?? outlet.offsetMm, change.sizeMm ?? outlet.sizeMm);
  if ('reason' in candidate) return { overlay, reason: candidate.reason };
  const replacement = { ...candidate.outlet, id: outlet.id, createdAt: outlet.createdAt };
  return { overlay: { ...candidate.overlay, hvac: { ...candidate.overlay.hvac, outlets: [...candidate.overlay.hvac.outlets.filter(item => item.id !== candidate.outlet.id), replacement] } } };
}

export function createHvacControlConduit(overlay: ConduitOverlayDocument, thermostatId: string, indoorUnitId: string, waypoints: RoutePoint[] = []): { overlay: ConduitOverlayDocument; conduit: HvacControlConduit } | { overlay: ConduitOverlayDocument; reason: string } {
  const thermostat = overlay.hvac.thermostats.find(item => item.id === thermostatId), unit = overlay.hvac.indoorUnits.find(item => item.id === indoorUnitId);
  if (!thermostat || !unit) return { overlay, reason: '控温器或 FCU 不存在。' };
  const sourcePort = ensureHvacThermostatPort(thermostat).controlPort, targetPort = ensureHvacUnitPorts(unit).controlPort;
  if (!sourcePort || sourcePort.system !== 'hvac-control' || sourcePort.role !== 'source' || !targetPort || targetPort.system !== 'hvac-control' || targetPort.role !== 'sink') return { overlay, reason: '控温器或 FCU 的控制端口无效。' };
  if (sourcePort.connectedSegmentIds.length || targetPort.connectedSegmentIds.length || overlay.hvac.controlConduits.some(route => route.thermostatId === thermostatId || route.indoorUnitId === indoorUnitId)) return { overlay, reason: '温控器和 FCU 控制端口各只能连接一条控制管。' };
  const points = [sourcePort.position, ...waypoints.map(clone), targetPort.position];
  const clean = points.filter((point, index) => index === 0 || length(points[index - 1]!.position, point.position) > 1e-6);
  if (clean.length < 2) return { overlay, reason: '控制管至少需要一个有效管段。' };
  const conduitId = id('hvac-control-conduit'), createdAt = stamp();
  const plan: PlannedRoute = planRoute('network', HVAC_CONTROL_CONDUIT_DIAMETER_MM, 'surface', clean, undefined, [], { bendRadiusMm: overlay.settings.bendRadiusMm, stockLengthMm: overlay.settings.stockLengthMm });
  if (!plan.canCommit) return { overlay, reason: plan.diagnostics[0]?.message ?? '控制管转弯空间不足。' };
  const collision = validatePlannedRoute(overlay, plan);
  if (collision.length) return { overlay, reason: collision[0]!.message };
  const plannedSegments = plan.segments.map((segment, index) => ({ ...segment, ...(index === 0 ? { startPortId: sourcePort.id } : {}), ...(index === plan.segments.length - 1 ? { endPortId: targetPort.id } : {}) }));
  const segments = plannedSegments.map(({ type: _type, system: _system, diameterMm: _diameterMm, createdAt: _createdAt, startPortId: _startPortId, endPortId: _endPortId, circuitId: _circuitId, legacyUnrooted: _legacyUnrooted, ...segment }) => segment);
  const fittings = plan.fittings.map(({ id: fittingId, fitting, bendStyle, radiusMm, arc, bridge, diameterMm, position, segmentIds }) => ({ id: fittingId, type: 'hvac-control-fitting' as const, system: 'control' as const, fitting: fitting === 'bridge-bend' ? 'bridge-bend' as const : fitting === 'coupling' ? 'coupling' as const : 'elbow' as const, ...(bendStyle === 'sweep' || bendStyle === 'right-angle' ? { bendStyle } : {}), ...(radiusMm !== undefined ? { radiusMm } : {}), ...(arc ? { arc } : {}), ...(bridge ? { bridge } : {}), diameterMm, position: clone(position), segmentIds: [...segmentIds] }));
  const conduit: HvacControlConduit = { id: conduitId, type: 'hvac-control-conduit', system: 'control', thermostatId, thermostatPortId: sourcePort.id, indoorUnitId, indoorUnitPortId: targetPort.id, segmentIds: segments.map(segment => segment.id), fittingIds: fittings.map(fitting => fitting.id), diameterMm: HVAC_CONTROL_CONDUIT_DIAMETER_MM, createdAt };
  const firstId = segments[0]!.id, lastId = segments[segments.length - 1]!.id;
  return { conduit, overlay: { ...overlay, hvac: { ...overlay.hvac, controlConduits: [...overlay.hvac.controlConduits, conduit], controlSegments: [...overlay.hvac.controlSegments, ...segments], controlFittings: [...overlay.hvac.controlFittings, ...fittings], thermostats: overlay.hvac.thermostats.map(item => {
    if (item.id !== thermostatId) return item;
    const ensured = ensureHvacThermostatPort(item);
    return { ...ensured, controlPort: { ...ensured.controlPort!, connectedSegmentIds: [firstId] } };
  }), indoorUnits: overlay.hvac.indoorUnits.map(item => {
    if (item.id !== indoorUnitId) return item;
    const ensured = ensureHvacUnitPorts(item);
    return { ...ensured, controlPort: { ...ensured.controlPort!, connectedSegmentIds: [lastId] } };
  }) } } };
}

export function deleteHvacControlConduit(overlay: ConduitOverlayDocument, conduitId: string): ConduitOverlayDocument {
  const conduit = overlay.hvac.controlConduits.find(item => item.id === conduitId);
  if (!conduit) return overlay;
  const segmentIds = new Set(conduit.segmentIds);
  return { ...overlay, hvac: { ...overlay.hvac, controlConduits: overlay.hvac.controlConduits.filter(item => item.id !== conduitId), controlSegments: overlay.hvac.controlSegments.filter(item => !segmentIds.has(item.id)), controlFittings: overlay.hvac.controlFittings.filter(item => !conduit.fittingIds.includes(item.id)), thermostats: overlay.hvac.thermostats.map(item => {
    if (item.id !== conduit.thermostatId) return item;
    const port = ensureHvacThermostatPort(item).controlPort!;
    return { ...item, controlPort: { ...port, connectedSegmentIds: port.connectedSegmentIds.filter(id => !segmentIds.has(id)) } };
  }), indoorUnits: overlay.hvac.indoorUnits.map(item => {
    if (item.id !== conduit.indoorUnitId) return item;
    const port = ensureHvacUnitPorts(item).controlPort!;
    return { ...item, controlPort: { ...port, connectedSegmentIds: port.connectedSegmentIds.filter(id => !segmentIds.has(id)) } };
  }) } };
}

/** Ctrl-created ducts keep their Wall opening as fixed Overlay construction evidence. */
export function addHvacWallPenetration(overlay: ConduitOverlayDocument, wallId: string, segmentId: string, entry: RoutePoint, exit: RoutePoint): { overlay: ConduitOverlayDocument; penetration: HvacWallPenetration } | { overlay: ConduitOverlayDocument; reason: string } {
  const duct = overlay.hvac.ducts.find(item => item.segmentIds.includes(segmentId)), unit = duct && overlay.hvac.indoorUnits.find(item => item.id === duct.indoorUnitId);
  if (!duct || !unit || !wallId || length(entry.position, exit.position) < .001) return { overlay, reason: '墙体穿孔需要同一条有效风管的入口和出口。' };
  const penetration: HvacWallPenetration = { id: id('hvac-wall-penetration'), type: 'hvac-wall-penetration', wallId, segmentId, entry: clone(entry), exit: clone(exit), openingMm: [unit.sectionMm[0] + 50, unit.sectionMm[1] + 50], createdAt: stamp() };
  return { overlay: { ...overlay, hvac: { ...overlay.hvac, wallPenetrations: [...overlay.hvac.wallPenetrations, penetration] } }, penetration };
}

export function deleteHvacObject(overlay: ConduitOverlayDocument, objectId: string): { overlay: ConduitOverlayDocument } | { overlay: ConduitOverlayDocument; reason: string } {
  const hvac = overlay.hvac, unit = hvac.indoorUnits.find(item => item.id === objectId), thermostat = hvac.thermostats.find(item => item.id === objectId), controlRoute = hvac.controlConduits.find(item => item.id === objectId || item.segmentIds.includes(objectId) || item.fittingIds.includes(objectId)), duct = hvac.ducts.find(item => item.id === objectId), outlet = hvac.outlets.find(item => item.id === objectId), segment = hvac.segments.find(item => item.id === objectId);
  if (controlRoute) return { overlay: deleteHvacControlConduit(overlay, controlRoute.id) };
  if (unit) {
    if (hvacUnitConnected(overlay, unit.id)) return { overlay, reason: '仍连接管线的 FCU 不能删除，请先删除相连风管和线管。' };
    return { overlay: { ...overlay, hvac: { ...hvac, indoorUnits: hvac.indoorUnits.filter(item => item.id !== unit.id) } } };
  }
  if (thermostat) {
    const route = hvac.controlConduits.find(item => item.thermostatId === thermostat.id), base = route ? deleteHvacControlConduit(overlay, route.id) : overlay;
    return { overlay: { ...base, hvac: { ...base.hvac, thermostats: base.hvac.thermostats.filter(item => item.id !== thermostat.id) } } };
  }
  if (duct) {
    const segments = new Set(duct.segmentIds);
    return { overlay: { ...overlay, hvac: { ...hvac, ducts: hvac.ducts.filter(item => item.id !== duct.id), segments: hvac.segments.filter(item => !segments.has(item.id)), outlets: hvac.outlets.filter(item => item.ductId !== duct.id), wallPenetrations: hvac.wallPenetrations.filter(item => !segments.has(item.segmentId)) } } };
  }
  if (outlet) return { overlay: { ...overlay, hvac: { ...hvac, outlets: hvac.outlets.filter(item => item.id !== outlet.id) } } };
  if (segment) {
    const owner = hvac.ducts.find(item => item.segmentIds.includes(segment.id));
    if (!owner) return { overlay, reason: '风管段没有有效路线。' };
    if (owner.segmentIds[owner.segmentIds.length - 1] !== segment.id) return { overlay, reason: '只能删除末端风管段；请先删除后续段。' };
    const remaining = owner.segmentIds.slice(0, -1), ducts = remaining.length ? hvac.ducts.map(item => item.id === owner.id ? { ...item, segmentIds: remaining } : item) : hvac.ducts.filter(item => item.id !== owner.id);
    return { overlay: { ...overlay, hvac: { ...hvac, ducts, segments: hvac.segments.filter(item => item.id !== segment.id), outlets: hvac.outlets.filter(item => item.segmentId !== segment.id), wallPenetrations: hvac.wallPenetrations.filter(item => item.segmentId !== segment.id) } } };
  }
  return { overlay, reason: '空调对象不存在。' };
}
