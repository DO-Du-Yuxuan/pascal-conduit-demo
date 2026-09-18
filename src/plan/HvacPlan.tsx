import React from 'react';
import type { ConduitOverlayDocument, HvacDuctOutlet, HvacIndoorUnit, HvacSystem, Vec3 } from '../domain/overlay';
import { HVAC_COLORS, indoorUnitFootprint, indoorUnitPort } from '../domain/hvac';

type Point = readonly [number, number];
const planPoint = (point: Vec3): Point => [point[0], point[2]];
const distance = (start: Point, end: Point) => Math.hypot(end[0] - start[0], end[1] - start[1]);
const points = (items: readonly Point[]) => items.map(point => point.join(',')).join(' ');

function levelFor(item: { position: { attachment?: { levelId: string | null } }; mount?: { kind: string; levelId?: string } }) {
  return item.position.attachment?.levelId ?? (item.mount?.kind === 'reference-plane' ? item.mount.levelId ?? null : null);
}

function ductOutline(start: Point, end: Point, width: number): readonly [Point, Point, Point, Point] | null {
  const length = distance(start, end);
  if (length < 1e-6) return null;
  const normal: Point = [-(end[1] - start[1]) / length * width / 2, (end[0] - start[0]) / length * width / 2];
  return [[start[0] + normal[0], start[1] + normal[1]], [end[0] + normal[0], end[1] + normal[1]], [end[0] - normal[0], end[1] - normal[1]], [start[0] - normal[0], start[1] - normal[1]]];
}

function HvacOutletSymbol({ outlet, start, end, width, color, scale, selected, onSelect }: { outlet: HvacDuctOutlet; start: Point; end: Point; width: number; color: string; scale: number; selected: boolean; onSelect: () => void }) {
  const length = distance(start, end);
  if (length < 1e-6) return null;
  const direction: Point = [(end[0] - start[0]) / length, (end[1] - start[1]) / length];
  const normal: Point = [-direction[1], direction[0]];
  const along = Math.min(1, Math.max(0, (outlet.offsetMm + outlet.sizeMm[0] / 2) / Math.max(1, length * 1000)));
  const center: Point = [start[0] + (end[0] - start[0]) * along, start[1] + (end[1] - start[1]) * along];
  const outline = selected ? '#f36b00' : color;
  const isSideOutlet = outlet.face === 'left' || outlet.face === 'right';
  if (isSideOutlet) {
    const side = outlet.face === 'left' ? -1 : 1;
    const edge: Point = [center[0] + normal[0] * width / 2 * side, center[1] + normal[1] * width / 2 * side];
    const halfLength = outlet.sizeMm[0] / 2000;
    const outside: Point = [edge[0] + normal[0] * .035 * side, edge[1] + normal[1] * .035 * side];
    return <g data-hvac-outlet={outlet.id} onClick={onSelect} stroke={outline} strokeWidth={1.6 / scale} fill="#fff"><line x1={edge[0] - direction[0] * halfLength} y1={edge[1] - direction[1] * halfLength} x2={edge[0] + direction[0] * halfLength} y2={edge[1] + direction[1] * halfLength} /><line x1={outside[0] - direction[0] * halfLength} y1={outside[1] - direction[1] * halfLength} x2={outside[0] + direction[0] * halfLength} y2={outside[1] + direction[1] * halfLength} /></g>;
  }
  const half = Math.max(.045, outlet.sizeMm[0] / 2000);
  return <g data-hvac-outlet={outlet.id} onClick={onSelect} transform={`translate(${center[0]} ${center[1]}) rotate(${Math.atan2(direction[1], direction[0]) * 180 / Math.PI})`} stroke={outline} strokeWidth={1.5 / scale} fill="#fff"><rect x={-half} y={-Math.max(.035, outlet.sizeMm[1] / 2000)} width={half * 2} height={Math.max(.07, outlet.sizeMm[1] / 1000)} rx={.015} /><path d={`M${-half * .56} ${-Math.max(.02, outlet.sizeMm[1] / 4000)}H${half * .56}M${-half * .56} ${Math.max(.02, outlet.sizeMm[1] / 4000)}H${half * .56}`} /></g>;
}

function IndoorUnitSymbol({ unit, selected, scale, rotation, onSelect }: { unit: HvacIndoorUnit; selected: boolean; scale: number; rotation: number; onSelect: () => void }) {
  const footprint = indoorUnitFootprint(unit);
  const supply = indoorUnitPort(unit, 'supply');
  const returning = indoorUnitPort(unit, 'return');
  const yaw = unit.rotationYDegrees * Math.PI / 180;
  const right: Point = [Math.cos(yaw), -Math.sin(yaw)];
  const forward: Point = [Math.sin(yaw), Math.cos(yaw)];
  const portLength = .11;
  const port = (item: typeof supply, system: HvacSystem) => {
    const center = planPoint(item.position);
    const sign = system === 'supply' ? 1 : -1;
    const halfWidth = unit.sectionMm[0] / 2000;
    const halfLength = portLength / 2;
    const shape: Point[] = [
      [center[0] - right[0] * halfWidth - forward[0] * halfLength, center[1] - right[1] * halfWidth - forward[1] * halfLength],
      [center[0] + right[0] * halfWidth - forward[0] * halfLength, center[1] + right[1] * halfWidth - forward[1] * halfLength],
      [center[0] + right[0] * halfWidth + forward[0] * halfLength, center[1] + right[1] * halfWidth + forward[1] * halfLength],
      [center[0] - right[0] * halfWidth + forward[0] * halfLength, center[1] - right[1] * halfWidth + forward[1] * halfLength],
    ];
    const labelPoint: Point = [center[0] + forward[0] * sign * .005, center[1] + forward[1] * sign * .005];
    return <g key={system} data-hvac-plan-port={system} aria-label={`${system === 'supply' ? '送风' : '回风'}端口`}><polygon points={points(shape)} fill={HVAC_COLORS[system]} stroke={HVAC_COLORS[system]} strokeWidth={1 / scale} /><text x={labelPoint[0]} y={labelPoint[1]} transform={`rotate(${-rotation} ${labelPoint[0]} ${labelPoint[1]})`} textAnchor="middle" dominantBaseline="middle" fontSize=".14" fontWeight="700" fill="#fff" stroke="none">{system === 'supply' ? '送' : '回'}</text></g>;
  };
  const center = planPoint(unit.position.position);
  return <g className="hvac-plan-unit" data-hvac-indoor-unit={unit.id} onClick={onSelect}><polygon points={points(footprint.map(planPoint))} fill="#f8fafc" stroke={selected ? '#f36b00' : '#475569'} strokeWidth={1.5 / scale} />{port(supply, 'supply')}{port(returning, 'return')}<path d={`M${center[0] - right[0] * unit.sectionMm[0] / 5000} ${center[1] - right[1] * unit.sectionMm[0] / 5000}L${center[0] + right[0] * unit.sectionMm[0] / 5000} ${center[1] + right[1] * unit.sectionMm[0] / 5000}`} stroke="#94a3b8" strokeWidth={1 / scale} /><text x={center[0]} y={center[1]} transform={`rotate(${-rotation} ${center[0]} ${center[1]})`} textAnchor="middle" dominantBaseline="middle" fontSize=".15" fill="#334155" stroke="none">内机</text></g>;
}

export function HvacPlan({ overlay, levelId, selectedId, onSelect, scale, rotation }: { overlay: ConduitOverlayDocument; levelId: string; selectedId: string | null; onSelect: (id: string) => void; scale: number; rotation: number }) {
  if (!overlay.hvac.visible) return null;
  const units = overlay.hvac.indoorUnits.filter(unit => levelFor(unit) === levelId);
  const unitIds = new Set(units.map(unit => unit.id));
  const ducts = overlay.hvac.ducts.filter(duct => unitIds.has(duct.indoorUnitId));
  const ductsBySegment = new Map(ducts.flatMap(duct => duct.segmentIds.map(segmentId => [segmentId, duct] as const)));
  const unitByDuct = new Map(ducts.flatMap(duct => {
    const unit = units.find(item => item.id === duct.indoorUnitId);
    return unit ? [[duct.id, unit] as const] : [];
  }));
  return <g className="hvac-plan" data-hvac-plan fill="none" strokeLinecap="square" strokeLinejoin="miter">
    {overlay.hvac.segments.map(segment => {
      const duct = ductsBySegment.get(segment.id), unit = duct && unitByDuct.get(duct.id);
      if (!duct || !unit) return null;
      const outline = ductOutline(planPoint(segment.start.position), planPoint(segment.end.position), unit.sectionMm[0] / 1000);
      if (!outline) return null;
      const color = selectedId === segment.id ? '#f36b00' : HVAC_COLORS[duct.system];
      return <polygon key={segment.id} data-hvac-duct-segment={segment.id} points={points(outline)} fill="#fff" fillOpacity=".86" stroke={color} strokeWidth={1.6 / scale} onClick={event => { event.stopPropagation(); onSelect(segment.id); }} />;
    })}
    {overlay.hvac.outlets.map(outlet => {
      const duct = ducts.find(item => item.id === outlet.ductId), unit = duct && unitByDuct.get(duct.id), segment = overlay.hvac.segments.find(item => item.id === outlet.segmentId);
      if (!duct || !unit || !segment) return null;
      return <HvacOutletSymbol key={outlet.id} outlet={outlet} start={planPoint(segment.start.position)} end={planPoint(segment.end.position)} width={unit.sectionMm[0] / 1000} color={HVAC_COLORS[duct.system]} scale={scale} selected={selectedId === outlet.id} onSelect={() => onSelect(outlet.id)} />;
    })}
    {units.map(unit => <IndoorUnitSymbol key={unit.id} unit={unit} selected={selectedId === unit.id} scale={scale} rotation={rotation} onSelect={() => onSelect(unit.id)} />)}
    {overlay.hvac.thermostats.filter(item => levelFor(item) === levelId).map(item => {
      const size = item.sizeMm[0] / 1000;
      return <g key={item.id} data-hvac-thermostat={item.id} transform={`translate(${item.position.position[0]} ${item.position.position[2]}) rotate(${-rotation})`} onClick={event => { event.stopPropagation(); onSelect(item.id); }}><rect x={-size / 2} y={-size / 2} width={size} height={size} fill="#fff" stroke={selectedId === item.id ? '#f36b00' : '#7c3aed'} strokeWidth={1.5 / scale}/><circle r={size * .19} fill="none" stroke="#7c3aed" strokeWidth={1 / scale}/></g>;
    })}
    {overlay.hvac.controls.map(control => {
      const thermostat = overlay.hvac.thermostats.find(item => item.id === control.thermostatId), unit = units.find(item => item.id === control.indoorUnitId);
      return thermostat && unit && levelFor(thermostat) === levelId ? <line key={control.id} data-hvac-control-line={control.id} x1={thermostat.position.position[0]} y1={thermostat.position.position[2]} x2={unit.position.position[0]} y2={unit.position.position[2]} stroke="#64748b" strokeWidth={1.2 / scale} strokeDasharray={`${5 / scale} ${4 / scale}`} pointerEvents="none" /> : null;
    })}
  </g>;
}
