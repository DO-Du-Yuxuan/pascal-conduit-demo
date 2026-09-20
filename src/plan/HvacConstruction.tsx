import React from 'react';
import type { NodeData } from '../types';
import type { ConduitOverlayDocument, HvacIndoorUnit, Vec3 } from '../domain/overlay';
import { indoorUnitFootprint } from '../domain/hvac';
import type { Point, PointPositionDimension } from './model';

const point = (value: Vec3): Point => [value[0], value[2]];
const dot = (left: Point, right: Point) => left[0] * right[0] + left[1] * right[1];
const length = (left: Point, right: Point) => Math.hypot(right[0] - left[0], right[1] - left[1]);
const normalized = (value: Point): Point | null => { const size = Math.hypot(...value); return size > 1e-6 ? [value[0] / size, value[1] / size] : null; };
const levelFor = (item: { position: { attachment?: { levelId: string | null } }; mount?: { kind: string; levelId?: string } }) => item.position.attachment?.levelId ?? (item.mount?.kind === 'reference-plane' ? item.mount.levelId ?? null : null);
const wallLevel = (node: NodeData) => node.parentId;

type WallFace = { id: string; corners: readonly [Point, Point, Point, Point] };
const wallsOnLevel = (nodes: Record<string, NodeData>, levelId: string): WallFace[] => Object.values(nodes).flatMap(node => {
  if (node.type !== 'wall' || node.curveOffset !== undefined || wallLevel(node) !== levelId || !Array.isArray(node.start) || !Array.isArray(node.end)) return [];
  const start: Point = [Number(node.start[0]), Number(node.start[1])], end: Point = [Number(node.end[0]), Number(node.end[1])], axis = normalized([end[0] - start[0], end[1] - start[1]]);
  if (!axis) return [];
  const half = Math.max(.01, Number(node.thickness) || .1) / 2, normal: Point = [-axis[1] * half, axis[0] * half];
  return [{ id: node.id, corners: [[start[0] + normal[0], start[1] + normal[1]], [end[0] + normal[0], end[1] + normal[1]], [end[0] - normal[0], end[1] - normal[1]], [start[0] - normal[0], start[1] - normal[1]]] }];
});

const raySegmentDistance = (origin: Point, direction: Point, start: Point, end: Point) => {
  const edge: Point = [end[0] - start[0], end[1] - start[1],], denominator = direction[0] * edge[1] - direction[1] * edge[0];
  if (Math.abs(denominator) < 1e-8) return null;
  const offset: Point = [start[0] - origin[0], start[1] - origin[1]], distance = (offset[0] * edge[1] - offset[1] * edge[0]) / denominator, segment = (offset[0] * direction[1] - offset[1] * direction[0]) / denominator;
  return distance > 1e-5 && segment >= -1e-6 && segment <= 1 + 1e-6 ? distance : null;
};

const nearestWallHit = (origin: Point, direction: Point, walls: readonly WallFace[]) => {
  const distances = walls.flatMap(wall => wall.corners.map((corner, index) => raySegmentDistance(origin, direction, corner, wall.corners[(index + 1) % wall.corners.length]!)).filter((value): value is number => value !== null));
  const distance = distances.length ? Math.min(...distances) : null;
  return distance === null ? null : [origin[0] + direction[0] * distance, origin[1] + direction[1] * distance] as Point;
};

function unitDimension(unit: HvacIndoorUnit, walls: readonly WallFace[], levelId: string, laneBase: number): PointPositionDimension[] {
  const center = point(unit.position.position), yaw = unit.rotationYDegrees * Math.PI / 180, axes: Point[] = [[Math.sin(yaw), Math.cos(yaw)], [Math.cos(yaw), -Math.sin(yaw)]];
  const footprint = indoorUnitFootprint(unit).map(point);
  return axes.flatMap((axis, index) => {
    const candidates = [1, -1].flatMap(sign => {
      const direction: Point = [axis[0] * sign, axis[1] * sign], projection = Math.max(...footprint.map(corner => dot(corner, direction)), ...footprint.map(corner => -dot(corner, direction) * -1));
      const witness: Point = [center[0] + direction[0] * (projection - dot(center, direction)), center[1] + direction[1] * (projection - dot(center, direction))];
      const hit = nearestWallHit(witness, direction, walls);
      return hit ? [{ direction, witness, hit, value: length(witness, hit) }] : [];
    }).sort((left, right) => left.value - right.value);
    const candidate = candidates[0];
    if (!candidate) return [];
    const direction: Point = [-candidate.direction[0], -candidate.direction[1]], normal: Point = [-direction[1], direction[0]];
    return [{ id: `hvac:unit:${unit.id}:axis:${index}`, sourceId: unit.id, levelId, reference: candidate.hit, center: candidate.witness, referenceWitness: candidate.hit, centerWitness: candidate.witness, direction, normal, lane: laneBase + index, valueMeters: candidate.value, referenceKind: 'wall-face', relatedIds: [unit.id], measurementBasis: 'derived', confidence: 'high', assumptions: ['内机定位尺寸从外壳实体边缘量至该方向首先命中的墙体实体面。'] }];
  });
}

export function buildHvacPositionDimensions(nodes: Record<string, NodeData>, overlay: ConduitOverlayDocument, levelId: string): PointPositionDimension[] {
  if (!overlay.hvac.visible) return [];
  const walls = wallsOnLevel(nodes, levelId), units = overlay.hvac.indoorUnits.filter(unit => levelFor(unit) === levelId);
  const unitDimensions = units.flatMap((unit, index) => unitDimension(unit, walls, levelId, index * 3));
  const ductDimensions = overlay.hvac.ducts.filter(duct => units.some(unit => unit.id === duct.indoorUnitId)).flatMap((duct, ductIndex) => duct.segmentIds.flatMap((id, segmentIndex) => {
    const segment = overlay.hvac.segments.find(item => item.id === id); if (!segment) return [];
    const reference = point(segment.start.position), center = point(segment.end.position), axis = normalized([center[0] - reference[0], center[1] - reference[1]]); if (!axis) return [];
    return [{ id: `hvac:duct:${id}:length`, sourceId: id, levelId, reference, center, referenceWitness: reference, centerWitness: center, direction: axis, normal: [-axis[1], axis[0]] as Point, lane: unitDimensions.length + ductIndex + segmentIndex, valueMeters: length(reference, center), referenceKind: 'wall-face' as const, relatedIds: [duct.id, id], measurementBasis: 'derived' as const, confidence: 'high' as const, assumptions: ['风管长度尺寸直接量取该直段两端中心线端点。'] }];
  }));
  return [...unitDimensions, ...ductDimensions];
}

export function HvacSectionCallouts({ overlay, levelId, rotation, annotationScale, labelPositions = {}, onLabelPositionChange, toPlanPoint }: { overlay: ConduitOverlayDocument; levelId: string; rotation: number; annotationScale: number; labelPositions?: Readonly<Record<string, Point>>; onLabelPositionChange?: (id: string, label: Point, signature: string) => void; toPlanPoint?: (clientX: number, clientY: number) => Point | null }) {
  const units = overlay.hvac.indoorUnits.filter(unit => levelFor(unit) === levelId), unitById = new Map(units.map(unit => [unit.id, unit]));
  const [draft, setDraft] = React.useState<Record<string, Point>>({}), drag = React.useRef<{ id: string; pointerId: number } | null>(null);
  return <g className="hvac-section-callouts" aria-label="空调风管截面标注">{overlay.hvac.ducts.filter(duct => unitById.has(duct.indoorUnitId)).map(duct => {
    const unit = unitById.get(duct.indoorUnitId)!, segment = overlay.hvac.segments.find(item => item.id === duct.segmentIds[0]); if (!segment) return null;
    const start = point(segment.start.position), end = point(segment.end.position), axis = normalized([end[0] - start[0], end[1] - start[1]]); if (!axis) return null;
    const id = `hvac:duct:${duct.id}:section`, anchor: Point = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2], defaultLabel: Point = [anchor[0] - axis[1] * .55 * annotationScale, anchor[1] + axis[0] * .55 * annotationScale], label = draft[id] ?? labelPositions[id] ?? defaultLabel, bend: Point = [label[0], anchor[1]], text = `${duct.system === 'supply' ? '送风管' : '回风管'} ${unit.sectionMm[0]}×${unit.sectionMm[1]} mm`, width = Math.max(1.5, text.length * .105 * annotationScale);
    const finish = (event: React.PointerEvent, save: boolean) => { const item = drag.current; if (!item || item.id !== id || item.pointerId !== event.pointerId) return; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); drag.current = null; const next = draft[id] ?? label; setDraft(current => { const { [id]: _, ...rest } = current; return rest; }); if (save) onLabelPositionChange?.(id, next, JSON.stringify([duct.id, duct.system, unit.sectionMm])); };
    return <g key={id} data-hvac-section-callout={duct.id}><polyline points={[anchor, bend, label].map(item => item.join(',')).join(' ')} fill="none" stroke="#454545" strokeWidth="1" vectorEffect="non-scaling-stroke"/><g transform={`translate(${label[0]} ${label[1]}) rotate(${-rotation})`} onPointerDown={event => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { id, pointerId: event.pointerId }; }} onPointerMove={event => { if (drag.current?.id !== id || drag.current.pointerId !== event.pointerId) return; const next = toPlanPoint?.(event.clientX, event.clientY); if (next) setDraft(current => ({ ...current, [id]: next })); }} onPointerUp={event => finish(event, true)} onPointerCancel={event => finish(event, false)} style={{ cursor: 'move' }}><rect x={-width / 2} y={-.16 * annotationScale} width={width} height={.32 * annotationScale} fill="#fff" fillOpacity=".96" stroke="#454545" strokeWidth="1" vectorEffect="non-scaling-stroke"/><text textAnchor="middle" dominantBaseline="middle" fontSize={.18 * annotationScale} fill="#343434">{text}</text></g></g>;
  })}</g>;
}
