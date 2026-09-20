import { Html, Line } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { Quaternion, Vector3 } from 'three';
import { HVAC_COLORS, indoorUnitPort, type HvacAxisPlanarReference } from '../domain/hvac';
import type { ConduitOverlayDocument, HvacDuctOutlet, HvacDuctSegment, HvacIndoorUnit, HvacOutletFace, HvacSystem, HvacThermostat, Vec3 } from '../domain/overlay';
import { HVAC_DEFAULT_OUTLET_MM } from '../domain/hvac';
import type { DevicePositionDescription } from '../domain/device-positioning';
import { PositionDimensionGuides, type PositionDimensionGuide } from './PositionDimensionGuides';

const vector = (point: Vec3) => new Vector3(...point);
function ductTransform(segment: HvacDuctSegment) { const start = vector(segment.start.position), end = vector(segment.end.position), delta = end.clone().sub(start); return { center: start.clone().add(end).multiplyScalar(.5), length: delta.length(), rotation: new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), delta.normalize()) }; }
type IndoorUnitDimensionState = { bottomElevationMm?: number; planar: readonly HvacAxisPlanarReference[] };
export type HvacOutletPreview = { segmentId: string; face: HvacOutletFace; offsetMm: number };
export function HvacIndoorUnitDimensions({ unit, state }: { unit: HvacIndoorUnit; state: IndoorUnitDimensionState }) {
  const bottom: Vec3 = [unit.position.position[0], unit.position.position[1] - unit.sectionMm[1] / 2000, unit.position.position[2]], guides: PositionDimensionGuide[] = [];
  if (state.bottomElevationMm !== undefined) guides.push({ key: 'bottom-elevation', start: bottom, end: [bottom[0], bottom[1] - state.bottomElevationMm / 1000, bottom[2]], label: `内机底部标高 ${state.bottomElevationMm} mm` });
  for (const reference of state.planar) guides.push({ key: reference.key, start: reference.start, end: reference.end, label: `${reference.label} ${reference.millimeters} mm` });
  return <PositionDimensionGuides name="hvac-indoor-unit-position-dimensions" guides={guides} />;
}
export function HvacThermostatDimensions({ thermostat, description }: { thermostat: HvacThermostat; description: DevicePositionDescription }) {
  const origin = thermostat.position.position, guides: PositionDimensionGuide[] = [];
  if (description.vertical) {
    const start: Vec3 = [origin[0], origin[1] - thermostat.sizeMm[1] / 2000, origin[2]];
    guides.push({ key: 'vertical', start, end: [start[0], start[1] - description.vertical.millimeters / 1000, start[2]], label: `${description.vertical.millimeters} mm` });
  }
  if (description.horizontal) {
    const u = thermostat.position.attachment?.basis?.u ?? [1, 0, 0], sign = description.horizontal.direction;
    const start: Vec3 = [origin[0] + u[0] * thermostat.sizeMm[0] / 2000 * sign, origin[1] + u[1] * thermostat.sizeMm[0] / 2000 * sign, origin[2] + u[2] * thermostat.sizeMm[0] / 2000 * sign];
    guides.push({ key: 'horizontal', start, end: [start[0] + u[0] * description.horizontal.millimeters / 1000 * sign, start[1] + u[1] * description.horizontal.millimeters / 1000 * sign, start[2] + u[2] * description.horizontal.millimeters / 1000 * sign], label: `${description.horizontal.millimeters} mm` });
  }
  return <PositionDimensionGuides name="hvac-thermostat-position-dimensions" guides={guides} />;
}
function IndoorUnitVisual({ unit, selected, preview = false, onSelect, onStartDuct }: { unit: HvacIndoorUnit; selected: boolean; preview?: boolean; onSelect?: () => void; onStartDuct?: (system: HvacSystem) => void }) {
  const casingLength = unit.sizeMm[0] / 1000, sectionWidth = unit.sectionMm[0] / 1000, sectionHeight = unit.sectionMm[1] / 1000;
  const previewRaycast = preview ? () => null : undefined;
  const port = (system: HvacSystem) => { const sign = system === 'supply' ? 1 : -1, color = HVAC_COLORS[system], label = system === 'supply' ? '送风口' : '回风口'; return <group key={system} name={`${unit.id}:${system}-port`} position={[0, 0, sign * (casingLength / 2 + .055)]} onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); if (!preview && onStartDuct) onStartDuct(system); }}><mesh raycast={previewRaycast}><boxGeometry args={[sectionWidth, sectionHeight * .82, .11]} /><meshStandardMaterial color={color} transparent opacity={preview ? .38 : 1} /></mesh>{!preview && <Html center position={[0, sectionHeight / 2 + .08, sign * .03]} distanceFactor={9} pointerEvents="none"><span className="hvac-port-label" style={{ borderColor: color }}>{label}</span></Html>}</group>; };
  return <group name={unit.id} position={unit.position.position} rotation={[0, unit.rotationYDegrees * Math.PI / 180, 0]} onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onSelect?.(); }}><mesh name="hvac-indoor-casing" raycast={previewRaycast}><boxGeometry args={[sectionWidth, sectionHeight, casingLength]} /><meshStandardMaterial color={selected ? '#f59e0b' : '#94a3b8'} transparent opacity={preview ? .35 : 1} roughness={.38} /></mesh><mesh raycast={previewRaycast} position={[0, sectionHeight / 2 + .004, 0]}><boxGeometry args={[sectionWidth * .86, .012, casingLength * .72]} /><meshStandardMaterial color="#e2e8f0" transparent opacity={preview ? .4 : 1} /></mesh>{port('supply')}{port('return')}</group>;
}
function outletVisualTransform(segment: HvacDuctSegment, unit: HvacIndoorUnit, outlet: Pick<HvacDuctOutlet, 'face' | 'offsetMm' | 'sizeMm'>) {
  const transform = ductTransform(segment), t = (outlet.offsetMm + outlet.sizeMm[0] / 2) / Math.max(1, transform.length * 1000), localY = -transform.length / 2 + transform.length * t, topBottom = outlet.face === 'top' || outlet.face === 'bottom', localX = outlet.face === 'left' ? -unit.sectionMm[0] / 2000 : outlet.face === 'right' ? unit.sectionMm[0] / 2000 : 0, localZ = outlet.face === 'bottom' ? -unit.sectionMm[1] / 2000 : outlet.face === 'top' ? unit.sectionMm[1] / 2000 : 0;
  return { transform, localPosition: [localX, localY, localZ] as Vec3, geometry: topBottom ? [outlet.sizeMm[1] / 1000, outlet.sizeMm[0] / 1000, .015] as [number, number, number] : [.015, outlet.sizeMm[0] / 1000, outlet.sizeMm[1] / 1000] as [number, number, number] };
}
function outletPreviewAtPointer(segment: HvacDuctSegment, unit: HvacIndoorUnit, event: ThreeEvent<PointerEvent>): HvacOutletPreview | null {
  const normal = event.face?.normal;
  if (!normal || Math.abs(normal.y) > Math.max(Math.abs(normal.x), Math.abs(normal.z))) return null;
  const face: HvacOutletFace = Math.abs(normal.z) >= Math.abs(normal.x) ? normal.z >= 0 ? 'top' : 'bottom' : normal.x >= 0 ? 'right' : 'left';
  const transform = ductTransform(segment), local = event.object.worldToLocal(event.point.clone()), faceLengthMm = transform.length * 1000;
  if (faceLengthMm < HVAC_DEFAULT_OUTLET_MM[0]) return null;
  return { segmentId: segment.id, face, offsetMm: Math.min(faceLengthMm - HVAC_DEFAULT_OUTLET_MM[0], Math.max(0, (local.y + transform.length / 2) * 1000 - HVAC_DEFAULT_OUTLET_MM[0] / 2)) };
}
export function HvacOutletDimensions({ segment, unit, outlet }: { segment: HvacDuctSegment; unit: HvacIndoorUnit; outlet: HvacDuctOutlet }) {
  const visual = outletVisualTransform(segment, unit, outlet), faceLengthMm = visual.transform.length * 1000, outletStartY = -visual.transform.length / 2 + outlet.offsetMm / 1000, outletEndY = outletStartY + outlet.sizeMm[0] / 1000, topBottom = outlet.face === 'top' || outlet.face === 'bottom', faceOffset = .045;
  const x = topBottom ? -unit.sectionMm[0] / 2000 - faceOffset : outlet.face === 'right' ? unit.sectionMm[0] / 2000 + faceOffset : -unit.sectionMm[0] / 2000 - faceOffset;
  const z = topBottom ? (outlet.face === 'top' ? unit.sectionMm[1] / 2000 + .01 : -unit.sectionMm[1] / 2000 - .01) : unit.sectionMm[1] / 2000 + faceOffset;
  const guides = [
    { key: 'start', start: [x, -visual.transform.length / 2, z] as Vec3, end: [x, outletStartY, z] as Vec3, label: `起点净距 ${Math.round(outlet.offsetMm)} mm` },
    { key: 'end', start: [x, outletEndY, z] as Vec3, end: [x, visual.transform.length / 2, z] as Vec3, label: `终点净距 ${Math.round(faceLengthMm - outlet.offsetMm - outlet.sizeMm[0])} mm` },
  ];
  return <group name="hvac-outlet-edge-dimensions" position={visual.transform.center} quaternion={visual.transform.rotation}><PositionDimensionGuides name="hvac-outlet-edge-dimension-guides" guides={guides} /></group>;
}
function OutletVisual({ segment, unit, outlet, preview = false, onSelect }: { segment: HvacDuctSegment; unit: HvacIndoorUnit; outlet: Pick<HvacDuctOutlet, 'face' | 'offsetMm' | 'sizeMm'>; preview?: boolean; onSelect?: (event: ThreeEvent<MouseEvent>) => void }) {
  const visual = outletVisualTransform(segment, unit, outlet);
  return <group position={visual.transform.center} quaternion={visual.transform.rotation}><mesh name={preview ? "hvac-outlet-preview" : "hvac-outlet"} position={visual.localPosition} raycast={preview ? () => null : undefined} onClick={onSelect}><boxGeometry args={visual.geometry} /><meshBasicMaterial color="#ffffff" transparent={preview} opacity={preview ? .96 : 1} depthTest={false} /></mesh></group>;
}
export function HvacScene({ overlay, selectedId, onSelect, onStartDuct, onDuctOutletPreview, onPlaceDuctOutlet, outletPreview, selectedIndoorUnitDimensions, selectedThermostatDimensions, previewPosition, draftDuct }: { overlay: ConduitOverlayDocument; selectedId: string | null; onSelect: (id: string) => void; onStartDuct?: (unitId: string, system: HvacSystem) => void; onDuctOutletPreview?: (preview: HvacOutletPreview | null) => void; onPlaceDuctOutlet?: (preview: HvacOutletPreview) => void; outletPreview?: HvacOutletPreview | null; selectedIndoorUnitDimensions?: IndoorUnitDimensionState; selectedThermostatDimensions?: DevicePositionDescription; previewPosition?: Vec3 | null; draftDuct?: { unitId: string; system: HvacSystem; end: Vec3 } | null }) {
  if (!overlay.hvac.visible) return null;
  const ductFor = (segmentId: string) => overlay.hvac.ducts.find(duct => duct.segmentIds.includes(segmentId));
  const unitFor = (segmentId: string) => { const duct = ductFor(segmentId); return duct ? overlay.hvac.indoorUnits.find(unit => unit.id === duct.indoorUnitId) : undefined; };
  return <group name="hvac-overlay">
    {overlay.hvac.segments.map(segment => { const duct = ductFor(segment.id), unit = unitFor(segment.id); if (!duct || !unit) return null; const transform = ductTransform(segment); return transform.length < .001 ? null : <mesh key={segment.id} name={segment.id} position={transform.center} quaternion={transform.rotation} onPointerMove={(event: ThreeEvent<PointerEvent>) => { if (!onDuctOutletPreview) return; event.stopPropagation(); onDuctOutletPreview(outletPreviewAtPointer(segment, unit, event)); }} onPointerOut={() => onDuctOutletPreview?.(null)} onClick={(event: ThreeEvent<MouseEvent>) => { const preview = onPlaceDuctOutlet ? outletPreviewAtPointer(segment, unit, event as ThreeEvent<PointerEvent>) : null; event.stopPropagation(); if (preview) onPlaceDuctOutlet?.(preview); else onSelect(segment.id); }}><boxGeometry args={[unit.sectionMm[0] / 1000, transform.length, unit.sectionMm[1] / 1000]} /><meshStandardMaterial color={selectedId === segment.id ? '#f59e0b' : HVAC_COLORS[duct.system]} roughness={.35} /></mesh>; })}
    {overlay.hvac.outlets.map(outlet => { const segment = overlay.hvac.segments.find(item => item.id === outlet.segmentId), unit = segment && unitFor(segment.id); return segment && unit ? <group key={outlet.id}><OutletVisual segment={segment} unit={unit} outlet={outlet} onSelect={(event) => { event.stopPropagation(); onSelect(outlet.id); }} />{selectedId === outlet.id && <HvacOutletDimensions segment={segment} unit={unit} outlet={outlet} />}</group> : null; })}
    {outletPreview && (() => { const segment = overlay.hvac.segments.find(item => item.id === outletPreview.segmentId), unit = segment && unitFor(segment.id); return segment && unit ? <OutletVisual segment={segment} unit={unit} outlet={{ ...outletPreview, sizeMm: HVAC_DEFAULT_OUTLET_MM }} preview /> : null; })()}
    {overlay.hvac.indoorUnits.map(unit => <group key={unit.id}><IndoorUnitVisual unit={unit} selected={selectedId === unit.id} onSelect={() => onSelect(unit.id)} onStartDuct={system => onStartDuct?.(unit.id, system)} />{selectedId === unit.id && selectedIndoorUnitDimensions && <HvacIndoorUnitDimensions unit={unit} state={selectedIndoorUnitDimensions} />}</group>)}
    {draftDuct && (() => { const unit = overlay.hvac.indoorUnits.find(item => item.id === draftDuct.unitId); if (!unit) return null; const start = indoorUnitPort(unit, draftDuct.system), transform = ductTransform({ id: 'hvac-draft', start, end: { position: draftDuct.end } }); return transform.length < .001 ? null : <mesh name="hvac-duct-draft" position={transform.center} quaternion={transform.rotation} raycast={() => null}><boxGeometry args={[unit.sectionMm[0] / 1000, transform.length, unit.sectionMm[1] / 1000]} /><meshStandardMaterial color={HVAC_COLORS[draftDuct.system]} transparent opacity={.42} /></mesh>; })()}
    {previewPosition && <IndoorUnitVisual unit={{ id: 'hvac-unit-preview', type: 'indoor-air-handling-unit', name: '空调内机预览', position: { position: previewPosition }, sizeMm: [600, 1000, 300], sectionMm: [1000, 300], rotationYDegrees: 0, createdAt: '' }} selected={false} preview />}
    {overlay.hvac.thermostats.map(item => <group key={item.id}><mesh name={item.id} position={item.position.position} onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onSelect(item.id); }}><boxGeometry args={[.086, .086, .05]} /><meshStandardMaterial color={selectedId === item.id ? '#f59e0b' : '#a78bfa'} /></mesh>{selectedId === item.id && selectedThermostatDimensions && <HvacThermostatDimensions thermostat={item} description={selectedThermostatDimensions} />}</group>)}
    {overlay.hvac.controls.map(control => { const thermostat = overlay.hvac.thermostats.find(item => item.id === control.thermostatId), unit = overlay.hvac.indoorUnits.find(item => item.id === control.indoorUnitId); return thermostat && unit ? <Line key={control.id} points={[thermostat.position.position, unit.position.position]} color="#64748b" lineWidth={1} dashed dashSize={.1} gapSize={.08} /> : null; })}
  </group>;
}
