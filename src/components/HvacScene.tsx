import { Html } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useMemo } from 'react';
import { CatmullRomCurve3, Matrix4, Quaternion, TubeGeometry, Vector3 } from 'three';
import { HVAC_COLORS, HVAC_CONTROL_CONDUIT_DIAMETER_MM, hvacThermostatPortCandidates, indoorUnitCasingSizeMeters, indoorUnitPort, type HvacAxisPlanarReference, type HvacThermostatPortCandidate } from '../domain/hvac';
import { deviceFrame } from '../domain/devices';
import type { ConduitOverlayDocument, HvacControlFitting, HvacDuctOutlet, HvacDuctSegment, HvacIndoorUnit, HvacOutletFace, HvacSystem, HvacThermostat, RoutePoint, Vec3 } from '../domain/overlay';
import { HVAC_DEFAULT_OUTLET_MM } from '../domain/hvac';
import type { DevicePositionDescription } from '../domain/device-positioning';
import { PositionDimensionGuides, type PositionDimensionGuide } from './PositionDimensionGuides';

const vector = (point: Vec3) => new Vector3(...point);
function ductTransform(segment: HvacDuctSegment) { const start = vector(segment.start.position), end = vector(segment.end.position), delta = end.clone().sub(start); return { center: start.clone().add(end).multiplyScalar(.5), length: delta.length(), rotation: new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), delta.normalize()) }; }
type IndoorUnitDimensionState = { bottomElevationMm?: number; planar: readonly HvacAxisPlanarReference[] };
export type HvacOutletPreview = { segmentId: string; face: HvacOutletFace; offsetMm: number };
export function HvacIndoorUnitDimensions({ unit, state }: { unit: HvacIndoorUnit; state: IndoorUnitDimensionState }) {
  const bottom: Vec3 = [unit.position.position[0], unit.position.position[1] - unit.sizeMm[2] / 2000, unit.position.position[2]], guides: PositionDimensionGuide[] = [];
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
  for (const reference of description.planar ?? []) if (reference.witness) guides.push({ key: reference.key, start: [...origin], end: reference.witness.point, label: `${reference.millimeters} mm`, offset: [0, 0, 0] });
  return <PositionDimensionGuides name="hvac-thermostat-position-dimensions" guides={guides} />;
}

function HvacPortConnector({ port, color, actionable, onClick, onHoverChange }: { port: NonNullable<HvacIndoorUnit['powerPort']>; color: string; actionable: boolean; onClick: (event: ThreeEvent<MouseEvent>) => void; onHoverChange?: (hovered: boolean) => void }) {
  const direction = vector(port.direction).normalize(), rotation = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction);
  return <group name={port.id} position={port.position.position} quaternion={rotation} renderOrder={24} onClick={onClick} onPointerOver={(event) => { event.stopPropagation(); if (actionable) onHoverChange?.(true); }} onPointerOut={() => onHoverChange?.(false)}>
    <mesh position={[0, .024, 0]}><cylinderGeometry args={[.032, .04, .048, 16]} /><meshStandardMaterial color="#343b45" metalness={.45} roughness={.35} /></mesh>
    <mesh position={[0, .05, 0]}><cylinderGeometry args={[.027, .032, .009, 16]} /><meshStandardMaterial color={actionable ? '#22c55e' : color} emissive={actionable ? '#14532d' : '#000000'} /></mesh>
    <mesh position={[0, .055, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[.018, .024, 20]} /><meshBasicMaterial color={actionable ? '#86efac' : color} side={2} depthTest={false} /></mesh>
  </group>;
}
function IndoorUnitVisual({ unit, selected, preview = false, onSelect, onStartDuct }: { unit: HvacIndoorUnit; selected: boolean; preview?: boolean; onSelect?: () => void; onStartDuct?: (system: HvacSystem) => void }) {
  const [casingWidth, casingHeight, casingLength] = indoorUnitCasingSizeMeters(unit), sectionWidth = unit.sectionMm[0] / 1000, sectionHeight = unit.sectionMm[1] / 1000;
  const previewRaycast = preview ? () => null : undefined;
  const port = (system: HvacSystem) => { const sign = system === 'supply' ? 1 : -1, color = HVAC_COLORS[system], label = system === 'supply' ? '送风口' : '回风口'; return <group key={system} name={`${unit.id}:${system}-port`} position={[0, 0, sign * (casingLength / 2 + .055)]} onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); if (!preview && onStartDuct) onStartDuct(system); }}><mesh raycast={previewRaycast}><boxGeometry args={[sectionWidth, sectionHeight * .82, .11]} /><meshStandardMaterial color={color} transparent opacity={preview ? .38 : 1} /></mesh>{!preview && selected && <Html center position={[0, sectionHeight / 2 + .08, sign * .03]} distanceFactor={9} pointerEvents="none"><span className="hvac-port-label" style={{ borderColor: color }}>{label}</span></Html>}</group>; };
  return <group name={unit.id} position={unit.position.position} rotation={[0, unit.rotationYDegrees * Math.PI / 180, 0]} onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onSelect?.(); }}><mesh name="hvac-indoor-casing" raycast={previewRaycast}><boxGeometry args={[casingWidth, casingHeight, casingLength]} /><meshStandardMaterial color={selected ? '#f59e0b' : '#94a3b8'} transparent opacity={preview ? .35 : 1} roughness={.38} /></mesh><mesh raycast={previewRaycast} position={[0, casingHeight / 2 + .004, 0]}><boxGeometry args={[casingWidth * .86, .012, casingLength * .72]} /><meshStandardMaterial color="#e2e8f0" transparent opacity={preview ? .4 : 1} /></mesh>{port('supply')}{port('return')}</group>;
}
function outletVisualTransform(segment: HvacDuctSegment, unit: HvacIndoorUnit, outlet: Pick<HvacDuctOutlet, 'face' | 'offsetMm' | 'sizeMm'>) {
  const transform = ductTransform(segment), t = (outlet.offsetMm + outlet.sizeMm[0] / 2) / Math.max(1, transform.length * 1000), localY = -transform.length / 2 + transform.length * t, topBottom = outlet.face === 'top' || outlet.face === 'bottom', localX = outlet.face === 'left' ? -unit.sectionMm[0] / 2000 : outlet.face === 'right' ? unit.sectionMm[0] / 2000 : 0, localZ = outlet.face === 'bottom' ? -unit.sectionMm[1] / 2000 : outlet.face === 'top' ? unit.sectionMm[1] / 2000 : 0;
  return { transform, localPosition: [localX, localY, localZ] as Vec3, geometry: topBottom ? [outlet.sizeMm[1] / 1000, outlet.sizeMm[0] / 1000, .015] as [number, number, number] : [.015, outlet.sizeMm[0] / 1000, outlet.sizeMm[1] / 1000] as [number, number, number] };
}
function HvacControlFittingVisual({ fitting, segments, selected, deleteMode, onSelect, onDelete }: { fitting: HvacControlFitting; segments: HvacDuctSegment[]; selected: boolean; deleteMode: boolean; onSelect: (id: string) => void; onDelete?: (id: string) => void }) {
  const geometry = useMemo(() => {
    if (!fitting.arc) return null;
    const center = vector(fitting.arc.center), start = vector(fitting.arc.start), normal = vector(fitting.arc.normal).normalize(), radius = start.distanceTo(center), radial = start.clone().sub(center).normalize(), tangent = new Vector3().crossVectors(normal, radial).normalize();
    const points = Array.from({ length: 13 }, (_, index) => { const angle = fitting.arc!.sweepRadians * index / 12; return center.clone().addScaledVector(radial, Math.cos(angle) * radius).addScaledVector(tangent, Math.sin(angle) * radius); });
    return new TubeGeometry(new CatmullRomCurve3(points), 24, fitting.diameterMm / 2000, 8, false);
  }, [fitting]);
  const adjacent = segments.find(segment => fitting.segmentIds.includes(segment.id));
  const direction = adjacent ? vector(adjacent.end.position).sub(vector(adjacent.start.position)).normalize() : new Vector3(0, 0, 1);
  const rotation = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction);
  const onClick = (event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); if (deleteMode) onDelete?.(fitting.id); else onSelect(fitting.id); };
  if (geometry) return <mesh name={fitting.id} geometry={geometry} onClick={onClick}><meshStandardMaterial color={selected ? '#f59e0b' : '#ffffff'} roughness={.6} /></mesh>;
  if (fitting.fitting === 'coupling') return <mesh name={fitting.id} position={fitting.position.position} quaternion={rotation} onClick={onClick}><cylinderGeometry args={[fitting.diameterMm * .65 / 1000, fitting.diameterMm * .65 / 1000, .04, 12]} /><meshStandardMaterial color={selected ? '#f59e0b' : '#d1d5db'} roughness={.55} /></mesh>;
  return <mesh name={fitting.id} position={fitting.position.position} onClick={onClick}><sphereGeometry args={[fitting.diameterMm / 2000, 12, 10]} /><meshStandardMaterial color={selected ? '#f59e0b' : '#ffffff'} roughness={.6} /></mesh>;
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
export function HvacScene({ overlay, selectedId, onSelect, onStartDuct, ductStartActive = false, onDuctOutletPreview, onPlaceDuctOutlet, outletPreview, selectedIndoorUnitDimensions, selectedThermostatDimensions, previewPosition, draftDuct, routeStartChooser = false, controlRouteActive = false, powerRouteActive = false, deleteMode = false, draftControlRoute, targetAssist, onStartControlRoute, onTargetControlPort, onTargetPowerPort, onHoverTargetPort, onDelete, systemVisible }: { overlay: ConduitOverlayDocument; selectedId: string | null; onSelect: (id: string) => void; onStartDuct?: (unitId: string, system: HvacSystem) => void; ductStartActive?: boolean; onDuctOutletPreview?: (preview: HvacOutletPreview | null) => void; onPlaceDuctOutlet?: (preview: HvacOutletPreview) => void; outletPreview?: HvacOutletPreview | null; selectedIndoorUnitDimensions?: IndoorUnitDimensionState; selectedThermostatDimensions?: DevicePositionDescription; previewPosition?: Vec3 | null; draftDuct?: { unitId: string; system: HvacSystem; end: Vec3 } | null; routeStartChooser?: boolean; controlRouteActive?: boolean; powerRouteActive?: boolean; deleteMode?: boolean; draftControlRoute?: { thermostatId: string; points: RoutePoint[]; cursor?: Vec3 | null } | null; targetAssist?: { point: Vec3; mode: 'alignment' | 'connect' } | null; onStartControlRoute?: (thermostatId: string, candidate: HvacThermostatPortCandidate) => void; onTargetControlPort?: (unitId: string) => void; onTargetPowerPort?: (unitId: string, portId: string, position: RoutePoint) => void; onHoverTargetPort?: (unitId: string, portId: string, kind: 'power' | 'control', hovered: boolean) => void; onDelete?: (id: string) => void; systemVisible?: boolean }) {
  if (!(systemVisible ?? overlay.hvac.visible)) return null;
  const ductFor = (segmentId: string) => overlay.hvac.ducts.find(duct => duct.segmentIds.includes(segmentId));
  const unitFor = (segmentId: string) => { const duct = ductFor(segmentId); return duct ? overlay.hvac.indoorUnits.find(unit => unit.id === duct.indoorUnitId) : undefined; };
  const thermostatCanStart = (thermostat: HvacThermostat) => Boolean(thermostat.controlPort && !thermostat.controlPort.connectedSegmentIds.length && !overlay.hvac.controlConduits.some(route => route.thermostatId === thermostat.id));
  return <group name="hvac-overlay">
    {overlay.hvac.segments.map(segment => { const duct = ductFor(segment.id), unit = unitFor(segment.id); if (!duct || !unit) return null; const transform = ductTransform(segment); return transform.length < .001 ? null : <mesh key={segment.id} name={segment.id} position={transform.center} quaternion={transform.rotation} onPointerMove={(event: ThreeEvent<PointerEvent>) => { if (!onDuctOutletPreview) return; event.stopPropagation(); onDuctOutletPreview(outletPreviewAtPointer(segment, unit, event)); }} onPointerOut={() => onDuctOutletPreview?.(null)} onClick={(event: ThreeEvent<MouseEvent>) => { const preview = onPlaceDuctOutlet ? outletPreviewAtPointer(segment, unit, event as ThreeEvent<PointerEvent>) : null; event.stopPropagation(); if (preview) onPlaceDuctOutlet?.(preview); else onSelect(segment.id); }}><boxGeometry args={[unit.sectionMm[0] / 1000, transform.length, unit.sectionMm[1] / 1000]} /><meshStandardMaterial color={selectedId === segment.id ? '#f59e0b' : HVAC_COLORS[duct.system]} roughness={.35} /></mesh>; })}
    {overlay.hvac.outlets.map(outlet => { const segment = overlay.hvac.segments.find(item => item.id === outlet.segmentId), unit = segment && unitFor(segment.id); return segment && unit ? <group key={outlet.id}><OutletVisual segment={segment} unit={unit} outlet={outlet} onSelect={(event) => { event.stopPropagation(); onSelect(outlet.id); }} />{selectedId === outlet.id && <HvacOutletDimensions segment={segment} unit={unit} outlet={outlet} />}</group> : null; })}
    {outletPreview && (() => { const segment = overlay.hvac.segments.find(item => item.id === outletPreview.segmentId), unit = segment && unitFor(segment.id); return segment && unit ? <OutletVisual segment={segment} unit={unit} outlet={{ ...outletPreview, sizeMm: HVAC_DEFAULT_OUTLET_MM }} preview /> : null; })()}
    {overlay.hvac.indoorUnits.map(unit => <group key={unit.id}><IndoorUnitVisual unit={unit} selected={selectedId === unit.id} onSelect={() => onSelect(unit.id)} onStartDuct={ductStartActive ? system => onStartDuct?.(unit.id, system) : undefined} />{selectedId === unit.id && selectedIndoorUnitDimensions && <HvacIndoorUnitDimensions unit={unit} state={selectedIndoorUnitDimensions} />}</group>)}
    {draftDuct && (() => { const unit = overlay.hvac.indoorUnits.find(item => item.id === draftDuct.unitId); if (!unit) return null; const start = indoorUnitPort(unit, draftDuct.system), transform = ductTransform({ id: 'hvac-draft', start, end: { position: draftDuct.end } }); return transform.length < .001 ? null : <mesh name="hvac-duct-draft" position={transform.center} quaternion={transform.rotation} raycast={() => null}><boxGeometry args={[unit.sectionMm[0] / 1000, transform.length, unit.sectionMm[1] / 1000]} /><meshStandardMaterial color={HVAC_COLORS[draftDuct.system]} transparent opacity={.42} /></mesh>; })()}
    {previewPosition && <IndoorUnitVisual unit={{ id: 'hvac-unit-preview', type: 'indoor-air-handling-unit', name: 'FCU 空调内机预览', position: { position: previewPosition }, sizeMm: [1000, 600, 300], sectionMm: [500, 200], rotationYDegrees: 0, createdAt: '' }} selected={false} preview />}
    {overlay.hvac.thermostats.map(item => { const frame = deviceFrame(item.position), rotation = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(vector(frame.right), vector(frame.up), vector(frame.front))); return <group key={item.id}><group position={item.position.position} quaternion={rotation}><mesh name={item.id} onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onSelect(item.id); }}><boxGeometry args={[.086, .086, .05]} /><meshStandardMaterial color={selectedId === item.id ? '#f59e0b' : '#a78bfa'} /></mesh></group>{selectedId === item.id && selectedThermostatDimensions && <HvacThermostatDimensions thermostat={item} description={selectedThermostatDimensions} />}</group>; })}
    {routeStartChooser && overlay.hvac.indoorUnits.flatMap(unit => (['supply', 'return'] as HvacSystem[]).filter(system => !overlay.hvac.ducts.some(duct => duct.indoorUnitId === unit.id && duct.system === system)).map(system => {
      const port = indoorUnitPort(unit, system);
      return <mesh key={`route-start:${unit.id}:${system}`} name={`route-start:${unit.id}:${system}`} position={port.position} renderOrder={22} onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onStartDuct?.(unit.id, system); }}><sphereGeometry args={[.026, 12, 10]} /><meshBasicMaterial color="#22c55e" depthTest={false} /></mesh>;
    }))}
    {overlay.hvac.indoorUnits.map(unit => [unit.powerPort, unit.controlPort].filter(Boolean).map(port => {
      const controlTarget = port!.id === unit.controlPort?.id && controlRouteActive && !port!.connectedSegmentIds.length;
      const powerTarget = port!.id === unit.powerPort?.id && powerRouteActive && !port!.connectedSegmentIds.length;
      const actionable = controlTarget || powerTarget;
      const inactiveColor = port!.id === unit.powerPort?.id ? '#ef4444' : '#a78bfa';
      return <HvacPortConnector key={port!.id} port={port!} color={inactiveColor} actionable={actionable} onHoverChange={(hovered) => onHoverTargetPort?.(unit.id, port!.id, controlTarget ? 'control' : 'power', hovered)} onClick={(event) => { event.stopPropagation(); if (controlTarget) onTargetControlPort?.(unit.id); else if (powerTarget) onTargetPowerPort?.(unit.id, port!.id, port!.position); else onSelect(unit.id); }} />;
    }))}
    {targetAssist && <mesh name="hvac-target-assist" position={targetAssist.point} raycast={() => null} renderOrder={26}><sphereGeometry args={[.022, 12, 10]} /><meshBasicMaterial color={targetAssist.mode === 'connect' ? '#22c55e' : '#f59e0b'} depthTest={false} /></mesh>}
    {overlay.hvac.thermostats.map(item => {
      const canChooseHole = thermostatCanStart(item) && (routeStartChooser || controlRouteActive);
      const candidates = canChooseHole ? hvacThermostatPortCandidates(item.position, item.sizeMm) : item.controlPort ? [{ key: 'selected', position: item.controlPort.position, direction: item.controlPort.direction }] : [];
      return candidates.map(candidate => <mesh key={`${item.id}:${candidate.key}`} name={`${item.id}:control-port:${candidate.key}`} position={candidate.position.position} renderOrder={20} onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); if (canChooseHole) onStartControlRoute?.(item.id, candidate); else onSelect(item.id); }}><sphereGeometry args={[canChooseHole ? .018 : .016, 12, 10]} /><meshBasicMaterial color={canChooseHole ? '#22c55e' : '#a78bfa'} depthTest={false} /></mesh>);
    })}
    {overlay.hvac.controlSegments.map(segment => { const transform = ductTransform(segment); return transform.length < .001 ? null : <mesh key={segment.id} name={segment.id} position={transform.center} quaternion={transform.rotation} onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); if (deleteMode) onDelete?.(segment.id); else onSelect(segment.id); }}><cylinderGeometry args={[HVAC_CONTROL_CONDUIT_DIAMETER_MM / 2000, HVAC_CONTROL_CONDUIT_DIAMETER_MM / 2000, transform.length, 10]} /><meshStandardMaterial color={selectedId === segment.id ? '#f59e0b' : '#ffffff'} roughness={.6} /></mesh>; })}
    {overlay.hvac.controlFittings.map(fitting => <HvacControlFittingVisual key={fitting.id} fitting={fitting} segments={overlay.hvac.controlSegments.filter(segment => fitting.segmentIds.includes(segment.id))} selected={selectedId === fitting.id} deleteMode={deleteMode} onSelect={onSelect} onDelete={onDelete} />)}
    {draftControlRoute && (() => {
      const thermostat = overlay.hvac.thermostats.find(item => item.id === draftControlRoute.thermostatId);
      if (!thermostat?.controlPort) return null;
      const points = [thermostat.controlPort.position, ...draftControlRoute.points, ...(draftControlRoute.cursor ? [{ position: draftControlRoute.cursor }] : [])];
      return points.slice(0, -1).map((start, index) => { const end = points[index + 1]!; const transform = ductTransform({ id: `draft-control-${index}`, start, end }); return transform.length < .001 ? null : <mesh key={index} name="hvac-control-draft" position={transform.center} quaternion={transform.rotation} raycast={() => null}><cylinderGeometry args={[HVAC_CONTROL_CONDUIT_DIAMETER_MM / 2000, HVAC_CONTROL_CONDUIT_DIAMETER_MM / 2000, transform.length, 10]} /><meshStandardMaterial color="#ffffff" transparent opacity={.55} /></mesh>; });
    })()}
  </group>;
}
