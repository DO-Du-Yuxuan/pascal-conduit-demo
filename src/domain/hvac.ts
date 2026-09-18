import type { ConduitOverlayDocument, HvacControl, HvacDuct, HvacDuctOutlet, HvacIndoorUnit, HvacOutletFace, HvacSystem, HvacThermostat, HvacWallPenetration, RoutePoint, Vec3 } from './overlay';

export const HVAC_DEFAULT_UNIT_SIZE_MM: [number, number, number] = [600, 1000, 300];
export const HVAC_DEFAULT_SECTION_MM: [number, number] = [1000, 300];
export const HVAC_DEFAULT_OUTLET_MM: [number, number] = [300, 150];
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
  const halfWidth = unit.sectionMm[0] / 2000, halfLength = unit.sizeMm[0] / 2000;
  const corner = (longitudinal: -1 | 1, lateral: -1 | 1): Vec3 => [
    unit.position.position[0] + right[0] * lateral * halfWidth + forward[0] * longitudinal * halfLength,
    unit.position.position[1],
    unit.position.position[2] + right[2] * lateral * halfWidth + forward[2] * longitudinal * halfLength,
  ];
  return [corner(-1, -1), corner(-1, 1), corner(1, 1), corner(1, -1)];
}
export const hvacUnitConnected = (overlay: ConduitOverlayDocument, unitId: string) => overlay.hvac.ducts.some(duct => duct.indoorUnitId === unitId && duct.segmentIds.length > 0);

/** A connected unit may change its shared duct section but never move, yaw, or change casing length. */
export function editIndoorUnit(overlay: ConduitOverlayDocument, unitId: string, change: Partial<Pick<HvacIndoorUnit, 'position' | 'rotationYDegrees' | 'sizeMm' | 'sectionMm'>>): { overlay: ConduitOverlayDocument } | { overlay: ConduitOverlayDocument; reason: string } {
  const unit = overlay.hvac.indoorUnits.find(item => item.id === unitId);
  if (!unit) return { overlay, reason: '空调内机不存在。' };
  const connected = hvacUnitConnected(overlay, unitId);
  if (connected && (change.position || change.rotationYDegrees !== undefined || change.sizeMm && change.sizeMm[0] !== unit.sizeMm[0])) return { overlay, reason: '已连接风管的内机不能移动、旋转或修改外壳长度。' };
  const sectionMm = change.sectionMm ? [...change.sectionMm] as [number, number] : unit.sectionMm;
  const requestedSize = change.sizeMm ? [...change.sizeMm] as [number, number, number] : unit.sizeMm;
  const next = { ...unit, ...change, sizeMm: [requestedSize[0], sectionMm[0], sectionMm[1]] as [number, number, number], sectionMm };
  if (next.sectionMm.some(value => !Number.isFinite(value) || value <= 0)) return { overlay, reason: '风管截面必须为正数。' };
  return { overlay: { ...overlay, hvac: { ...overlay.hvac, indoorUnits: overlay.hvac.indoorUnits.map(item => item.id === unitId ? next : item) } } };
}

export function placeIndoorUnit(overlay: ConduitOverlayDocument, position: RoutePoint, name = '空调内机'): { overlay: ConduitOverlayDocument; unit: HvacIndoorUnit } {
  const supportedCenter: RoutePoint = { ...clone(position), position: [position.position[0], position.position[1] + HVAC_DEFAULT_UNIT_SIZE_MM[2] / 2000, position.position[2]] };
  const unit: HvacIndoorUnit = { id: id('hvac-unit'), type: 'indoor-air-handling-unit', name, position: supportedCenter, mount: position.attachment ? { kind: 'host', attachment: clone(position.attachment) } : undefined, sizeMm: [...HVAC_DEFAULT_UNIT_SIZE_MM], sectionMm: [...HVAC_DEFAULT_SECTION_MM], rotationYDegrees: 0, createdAt: stamp() };
  return { overlay: { ...overlay, hvac: { ...overlay.hvac, indoorUnits: [...overlay.hvac.indoorUnits, unit] } }, unit };
}

export function placeThermostat(overlay: ConduitOverlayDocument, position: RoutePoint, name = '空调控温器'): { overlay: ConduitOverlayDocument; thermostat: HvacThermostat } | { overlay: ConduitOverlayDocument; reason: string } {
  if (position.attachment?.hostKind !== 'wall' && position.attachment?.hostKind !== 'beam') return { overlay, reason: '控温器只能安装在墙面或梁侧面。' };
  const thermostat: HvacThermostat = { id: id('thermostat'), type: 'thermostat', name, position: clone(position), mount: { kind: 'host', attachment: clone(position.attachment) }, sizeMm: [86, 86, 50], createdAt: stamp() };
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

export function editHvacOutlet(overlay: ConduitOverlayDocument, outletId: string, change: Partial<Pick<HvacDuctOutlet, 'face' | 'offsetMm' | 'sizeMm'>>): { overlay: ConduitOverlayDocument } | { overlay: ConduitOverlayDocument; reason: string } {
  const outlet = overlay.hvac.outlets.find(item => item.id === outletId);
  if (!outlet) return { overlay, reason: '风口不存在。' };
  const base = { ...overlay, hvac: { ...overlay.hvac, outlets: overlay.hvac.outlets.filter(item => item.id !== outletId) } }, candidate = addHvacOutlet(base, outlet.ductId, outlet.segmentId, change.face ?? outlet.face, change.offsetMm ?? outlet.offsetMm, change.sizeMm ?? outlet.sizeMm);
  if ('reason' in candidate) return { overlay, reason: candidate.reason };
  const replacement = { ...candidate.outlet, id: outlet.id, createdAt: outlet.createdAt };
  return { overlay: { ...candidate.overlay, hvac: { ...candidate.overlay.hvac, outlets: [...candidate.overlay.hvac.outlets.filter(item => item.id !== candidate.outlet.id), replacement] } } };
}

export function bindThermostat(overlay: ConduitOverlayDocument, thermostatId: string, indoorUnitId: string): { overlay: ConduitOverlayDocument; control: HvacControl } | { overlay: ConduitOverlayDocument; reason: string } {
  if (!overlay.hvac.thermostats.some(item => item.id === thermostatId) || !overlay.hvac.indoorUnits.some(item => item.id === indoorUnitId)) return { overlay, reason: '控温器或内机不存在。' };
  if (overlay.hvac.controls.some(item => item.thermostatId === thermostatId || item.indoorUnitId === indoorUnitId)) return { overlay, reason: '控温器和内机在当前版本均只能一对一关联。' };
  const control: HvacControl = { id: id('hvac-control'), thermostatId, indoorUnitId, createdAt: stamp() };
  return { overlay: { ...overlay, hvac: { ...overlay.hvac, controls: [...overlay.hvac.controls, control] } }, control };
}

/** Ctrl-created ducts keep their Wall opening as fixed Overlay construction evidence. */
export function addHvacWallPenetration(overlay: ConduitOverlayDocument, wallId: string, segmentId: string, entry: RoutePoint, exit: RoutePoint): { overlay: ConduitOverlayDocument; penetration: HvacWallPenetration } | { overlay: ConduitOverlayDocument; reason: string } {
  const duct = overlay.hvac.ducts.find(item => item.segmentIds.includes(segmentId)), unit = duct && overlay.hvac.indoorUnits.find(item => item.id === duct.indoorUnitId);
  if (!duct || !unit || !wallId || length(entry.position, exit.position) < .001) return { overlay, reason: '墙体穿孔需要同一条有效风管的入口和出口。' };
  const penetration: HvacWallPenetration = { id: id('hvac-wall-penetration'), type: 'hvac-wall-penetration', wallId, segmentId, entry: clone(entry), exit: clone(exit), openingMm: [unit.sectionMm[0] + 50, unit.sectionMm[1] + 50], createdAt: stamp() };
  return { overlay: { ...overlay, hvac: { ...overlay.hvac, wallPenetrations: [...overlay.hvac.wallPenetrations, penetration] } }, penetration };
}

export function deleteHvacObject(overlay: ConduitOverlayDocument, objectId: string): { overlay: ConduitOverlayDocument } | { overlay: ConduitOverlayDocument; reason: string } {
  const hvac = overlay.hvac, unit = hvac.indoorUnits.find(item => item.id === objectId), thermostat = hvac.thermostats.find(item => item.id === objectId), duct = hvac.ducts.find(item => item.id === objectId), outlet = hvac.outlets.find(item => item.id === objectId), segment = hvac.segments.find(item => item.id === objectId);
  if (unit) {
    if (hvacUnitConnected(overlay, unit.id)) return { overlay, reason: '仍连接风管的内机不能删除，请先删除送风和回风管。' };
    return { overlay: { ...overlay, hvac: { ...hvac, indoorUnits: hvac.indoorUnits.filter(item => item.id !== unit.id), controls: hvac.controls.filter(item => item.indoorUnitId !== unit.id) } } };
  }
  if (thermostat) return { overlay: { ...overlay, hvac: { ...hvac, thermostats: hvac.thermostats.filter(item => item.id !== thermostat.id), controls: hvac.controls.filter(item => item.thermostatId !== thermostat.id) } } };
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
