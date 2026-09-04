import { useMemo } from "react";
import { Shape } from "three";
import { finalDimensions, resolveItemPlanTransform, resolveWallOpeningTransform } from "../geometry/transform";
import { getWallCurveFrameAt, isCurvedWall } from "../geometry/walls/curve";
import type { NodeData } from "../types";
import type { ThreeDLayerVisibility } from "./ThreeDWorkspace";
import type { ThreeDLevelMode, ThreeDWallMode } from "./view-state";
import type { ThreeDSceneInput } from "./scene-input";
import type { ConduitOverlayDocument, HostAttachment, Penetration, RoutePoint, Vec3, WallChase } from "../domain/overlay";
import { transitionToAdjacentWall, type WallHostCandidate } from "./host-transition";

export type ThreeDSurfaceHit = { point: Vec3; attachment: HostAttachment; shiftKey: boolean };
type Props = { scene: ThreeDSceneInput; layers: ThreeDLayerVisibility; hiddenNodeIds: ReadonlySet<string>; levelMode: ThreeDLevelMode; wallMode: ThreeDWallMode; selectedId: string | null; highlightHostId?: string | null; previousRoutePoint?: RoutePoint; onSelect: (id: string) => void; overlay?: ConduitOverlayDocument; constructionMode?: "construction" | "finished" | "xray"; onSurfaceHit?: (hit: ThreeDSurfaceHit) => void; onSurfaceMove?: (hit: ThreeDSurfaceHit) => void; onSurfaceFinish?: () => void };
type Point = [number, number, number];

const numeric = (value: unknown, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const vector = (value: unknown): Point => Array.isArray(value) ? [numeric(value[0]), numeric(value[1]), numeric(value[2])] : [0, 0, 0];
const planarPoint = (value: unknown): Point => Array.isArray(value) && value.length >= 2 ? [numeric(value[0]), 0, numeric(value[1])] : [0, 0, 0];
const pointInPolygon = (x: number, z: number, polygon: unknown[]) => {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = planarPoint(polygon[index]), b = planarPoint(polygon[previous]);
    if ((a[2] > z) !== (b[2] > z) && x < (b[0] - a[0]) * (z - a[2]) / (b[2] - a[2]) + a[0]) inside = !inside;
  }
  return inside;
};
const yaw = (node: NodeData) => typeof node.rotation === "number" ? node.rotation : vector(node.rotation)[1];
const dimensions = (node: NodeData): Point => {
  const final = finalDimensions(node);
  return final ? [final.width, final.height, final.depth] : [numeric(node.asset?.dimensions?.[0], 1), numeric(node.asset?.dimensions?.[1], 1), numeric(node.asset?.dimensions?.[2], 1)];
};
const typeLayer = (type: string): keyof ThreeDLayerVisibility | null => {
  if (type === "wall") return "walls";
  if (type === "slab") return "floors";
  if (type === "ceiling") return "ceilings";
  if (type === "roof" || type === "roof-segment") return "roofs";
  if (type === "door" || type === "window") return "openings";
  if (["item", "shelf", "stair", "stair-segment", "column", "fence", "cabinet", "cabinet-module"].includes(type)) return "furniture";
  if (type === "zone") return "zones";
  return null;
};

function Surface({ node, y, thickness = 0, color, opacity, selected, onSelect, attachment, penetrations = [], onSurfaceHit, onSurfaceMove, onSurfaceFinish }: { node: NodeData; y: number; thickness?: number; color: string; opacity: number; selected: boolean; onSelect: () => void; attachment?: HostAttachment; penetrations?: Penetration[]; onSurfaceHit?: (hit: ThreeDSurfaceHit) => void; onSurfaceMove?: (hit: ThreeDSurfaceHit) => void; onSurfaceFinish?: () => void }) {
  const geometry = useMemo(() => {
    const polygon = Array.isArray(node.polygon) ? node.polygon : [];
    if (polygon.length < 3) return null;
    const shape = new Shape();
    const addPath = (points: unknown[], target: Shape) => points.forEach((point: unknown, index: number) => {
      const [x, , z] = vector(Array.isArray(point) && point.length === 2 ? [point[0], 0, point[1]] : point);
      if (index === 0) target.moveTo(x, -z); else target.lineTo(x, -z);
    });
    addPath(polygon, shape);
    shape.closePath();
    for (const hole of Array.isArray(node.holes) ? node.holes : []) if (Array.isArray(hole) && hole.length >= 3) { const path = new Shape(); addPath(hole, path); path.closePath(); shape.holes.push(path); }
    for (const penetration of penetrations) {
      const radius = penetration.diameterMm / 2000, path = new Shape();
      for (let index = 0; index < 12; index += 1) { const angle = index / 12 * Math.PI * 2, x = penetration.point.position[0] + Math.cos(angle) * radius, z = penetration.point.position[2] + Math.sin(angle) * radius; if (index) path.lineTo(x, -z); else path.moveTo(x, -z); }
      path.closePath(); shape.holes.push(path);
    }
    return shape;
  }, [node.polygon, node.holes, penetrations]);
  if (!geometry) return null;
  const hit = (event: any): ThreeDSurfaceHit | null => attachment ? { point: [event.point.x, event.point.y, event.point.z], attachment: { ...attachment, localPosition: [event.point.x, event.point.y - y, event.point.z], basis: { u: [1, 0, 0], v: [0, 0, 1] } }, shiftKey: event.nativeEvent.shiftKey } : null;
  return <mesh position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]} onPointerMove={(event) => { const next = hit(event); if (next) onSurfaceMove?.(next); }} onClick={(event) => { event.stopPropagation(); onSelect(); const next = hit(event); if (next && event.nativeEvent.detail < 2) onSurfaceHit?.(next); }} onDoubleClick={(event) => { event.stopPropagation(); onSurfaceFinish?.(); }}>
    {thickness > 0 ? <extrudeGeometry args={[geometry, { depth: thickness, bevelEnabled: false }]} /> : <shapeGeometry args={[geometry]} />}
    <meshStandardMaterial color={selected ? "#fb923c" : color} transparent opacity={opacity} side={2} roughness={.88} />
  </mesh>;
}

function ItemProxy({ node, position, selected, onSelect }: { node: NodeData; position: Point; selected: boolean; onSelect: () => void }) {
  const [width, height, depth] = dimensions(node);
  return <group position={position} rotation={[0, yaw(node), 0]} onClick={(event) => { event.stopPropagation(); onSelect(); }}>
    <mesh position={[0, Math.max(.03, height) / 2, 0]}>
      <boxGeometry args={[Math.max(.05, width), Math.max(.05, height), Math.max(.05, depth)]} />
      <meshStandardMaterial color={selected ? "#fb923c" : "#7c5c3b"} roughness={.72} />
    </mesh>
  </group>;
}

function Wall({ node, hostId, levelId, openings, chases = [], penetrations = [], y, selected, wallMode, onSelect, onSurfaceHit, onSurfaceMove, onSurfaceFinish, curveT }: { node: NodeData; hostId: string; levelId: string | null; openings: NodeData[]; chases?: WallChase[]; penetrations?: Penetration[]; y: number; selected: boolean; wallMode: ThreeDWallMode; onSelect: () => void; onSurfaceHit?: (hit: ThreeDSurfaceHit) => void; onSurfaceMove?: (hit: ThreeDSurfaceHit) => void; onSurfaceFinish?: () => void; curveT?: number }) {
  const start = vector([node.start?.[0], 0, node.start?.[1]]), end = vector([node.end?.[0], 0, node.end?.[1]]);
  const length = Math.hypot(end[0] - start[0], end[2] - start[2]);
  if (length < .001) return null;
  if (isCurvedWall(node as any)) return <CurvedWall node={node} hostId={hostId} levelId={levelId} openings={openings} chases={chases} penetrations={penetrations} y={y} selected={selected} wallMode={wallMode} onSelect={onSelect} onSurfaceHit={onSurfaceHit} onSurfaceMove={onSurfaceMove} onSurfaceFinish={onSurfaceFinish} />;
  const sourceHeight = Math.max(.1, numeric(node.height, 2.7)), height = wallMode === "cutaway" ? Math.min(sourceHeight, 1.15) : sourceHeight, thickness = Math.max(.05, numeric(node.thickness, .12));
  const holes = openings.map((opening) => {
    const openingWidth = Math.max(.05, numeric(opening.width, .9)), openingHeight = Math.max(.05, numeric(opening.height, 2));
    const centerX = numeric(opening.position?.[0]), centerY = numeric(opening.position?.[1], openingHeight / 2);
    return { left: Math.max(0, centerX - openingWidth / 2), right: Math.min(length, centerX + openingWidth / 2), bottom: Math.max(0, centerY - openingHeight / 2), top: Math.min(height, centerY + openingHeight / 2) };
  }).filter((hole) => hole.right > hole.left && hole.top > hole.bottom);
  const project = (position: Vec3) => ({ x: ((position[0] - start[0]) * (end[0] - start[0]) + (position[2] - start[2]) * (end[2] - start[2])) / length, y: position[1] - y });
  for (const chase of chases) {
    const a = project(chase.start.position), b = project(chase.end.position), half = chase.widthMm / 2000;
    holes.push({ left: Math.max(0, Math.min(a.x, b.x) - half), right: Math.min(length, Math.max(a.x, b.x) + half), bottom: Math.max(0, Math.min(a.y, b.y) - half), top: Math.min(height, Math.max(a.y, b.y) + half) });
  }
  for (const penetration of penetrations) {
    const center = project(penetration.point.position), radius = penetration.diameterMm / 2000;
    holes.push({ left: Math.max(0, center.x - radius), right: Math.min(length, center.x + radius), bottom: Math.max(0, center.y - radius), top: Math.min(height, center.y + radius) });
  }
  const validHoles = holes.filter((hole) => hole.right > hole.left && hole.top > hole.bottom);
  const xBreaks = [...new Set([0, length, ...validHoles.flatMap((hole) => [hole.left, hole.right])])].sort((a, b) => a - b);
  const yBreaks = [...new Set([0, height, ...validHoles.flatMap((hole) => [hole.bottom, hole.top])])].sort((a, b) => a - b);
  const parts: Array<{ x: number; y: number; width: number; height: number }> = [];
  for (let xi = 0; xi < xBreaks.length - 1; xi += 1) for (let yi = 0; yi < yBreaks.length - 1; yi += 1) {
    const left = xBreaks[xi], right = xBreaks[xi + 1], bottom = yBreaks[yi], top = yBreaks[yi + 1];
    if (right - left < .001 || top - bottom < .001 || validHoles.some((hole) => (left + right) / 2 > hole.left && (left + right) / 2 < hole.right && (bottom + top) / 2 > hole.bottom && (bottom + top) / 2 < hole.top)) continue;
    parts.push({ x: (left + right) / 2 - length / 2, y: (bottom + top) / 2, width: right - left, height: top - bottom });
  }
  const hit = (event: any): ThreeDSurfaceHit => {
    const normalVector = event.face?.normal.clone().transformDirection(event.object.matrixWorld);
    const normal: Vec3 = normalVector ? [normalVector.x, normalVector.y, normalVector.z] : [0, 0, 1];
    const tangent: Vec3 = [(end[0] - start[0]) / length, 0, (end[2] - start[2]) / length];
    const p: Vec3 = [event.point.x, event.point.y, event.point.z];
    return { point: p, attachment: { hostId, hostKind: "wall", surface: normal[2] >= 0 ? "exterior" : "interior", normal, levelId, localPosition: [(p[0] - start[0]) * tangent[0] + (p[2] - start[2]) * tangent[2], p[1] - y, (p[0] - start[0]) * normal[0] + (p[2] - start[2]) * normal[2]], basis: { u: tangent, v: [0, 1, 0] }, curveT, wallSide: normal[2] >= 0 ? "exterior" : "interior" }, shiftKey: event.nativeEvent.shiftKey };
  };
  return <group position={[(start[0] + end[0]) / 2, y, (start[2] + end[2]) / 2]} rotation={[0, -Math.atan2(end[2] - start[2], end[0] - start[0]), 0]}>
    {parts.map((part, index) => <mesh key={index} position={[part.x, part.y, 0]} onPointerMove={(event) => onSurfaceMove?.(hit(event))} onClick={(event) => { if (event.nativeEvent.button !== 0) return; event.stopPropagation(); onSelect(); if (event.nativeEvent.detail < 2) onSurfaceHit?.(hit(event)); }} onDoubleClick={(event) => { if (event.nativeEvent.button !== 0) return; event.stopPropagation(); onSurfaceFinish?.(); }}><boxGeometry args={[part.width, part.height, thickness]} /><meshStandardMaterial color={selected ? "#fb923c" : "#d1c4b4"} transparent={wallMode === "translucent"} opacity={wallMode === "translucent" ? .3 : 1} roughness={.92} /></mesh>)}
  </group>;
}

/** Pascal stores a curve as a chord plus sagitta. Render it as short tangent
 * wall pieces, preserving the same source curveOffset rather than mirroring it
 * into an arbitrary spline. Openings are split across every overlapping piece. */
function CurvedWall({ node, hostId, levelId, openings, chases = [], penetrations = [], y, selected, wallMode, onSelect, onSurfaceHit, onSurfaceMove, onSurfaceFinish }: { node: NodeData; hostId: string; levelId: string | null; openings: NodeData[]; chases?: WallChase[]; penetrations?: Penetration[]; y: number; selected: boolean; wallMode: ThreeDWallMode; onSelect: () => void; onSurfaceHit?: (hit: ThreeDSurfaceHit) => void; onSurfaceMove?: (hit: ThreeDSurfaceHit) => void; onSurfaceFinish?: () => void }) {
  const start = vector([node.start?.[0], 0, node.start?.[1]]), end = vector([node.end?.[0], 0, node.end?.[1]]), chordLength = Math.hypot(end[0] - start[0], end[2] - start[2]);
  const segments = Math.max(12, Math.min(32, Math.ceil(chordLength * 3)));
  return <group>{Array.from({ length: segments }, (_, index) => {
    const startT = index / segments, endT = (index + 1) / segments, a = getWallCurveFrameAt(node as any, startT).point, b = getWallCurveFrameAt(node as any, endT).point;
    const segmentLength = Math.hypot(b.x - a.x, b.y - a.y);
    const segmentOpenings = openings.flatMap((opening) => {
      const width = Math.max(.05, numeric(opening.width, .9)), center = numeric(opening.position?.[0]), intervalStart = Math.max(startT, (center - width / 2) / chordLength), intervalEnd = Math.min(endT, (center + width / 2) / chordLength);
      if (intervalEnd <= intervalStart || segmentLength < .001) return [];
      const left = (intervalStart - startT) / (endT - startT) * segmentLength, right = (intervalEnd - startT) / (endT - startT) * segmentLength;
      return [{ ...opening, id: `${opening.id}:${index}`, position: [(left + right) / 2, numeric(opening.position?.[1], numeric(opening.height, 2) / 2), 0], width: right - left, curveOffset: 0 }];
    });
    return <Wall key={index} node={{ ...node, id: `${node.id}:curve:${index}`, start: [a.x, a.y], end: [b.x, b.y], curveOffset: 0 }} hostId={hostId} levelId={levelId} openings={segmentOpenings} chases={chases} penetrations={penetrations} y={y} selected={selected} wallMode={wallMode} onSelect={onSelect} onSurfaceHit={onSurfaceHit} onSurfaceMove={onSurfaceMove} onSurfaceFinish={onSurfaceFinish} curveT={(startT + endT) / 2} />;
  })}</group>;
}

function Opening({ node, nodes, y, selected, onSelect }: { node: NodeData; nodes: Record<string, NodeData>; y: number; selected: boolean; onSelect: () => void }) {
  const transform = resolveWallOpeningTransform(node, nodes);
  if (!transform) return null;
  const width = Math.max(.2, numeric(node.width, .9)), height = Math.max(.2, numeric(node.height, 2)), thickness = Math.max(.04, numeric(node.depth, .08));
  const vertical = y + numeric(node.position?.[1], height / 2);
  return <mesh position={[transform.x, vertical, transform.z]} rotation={[0, -transform.rotationY, 0]} onClick={(event) => { event.stopPropagation(); onSelect(); }}>
    <boxGeometry args={[width, height, thickness]} />
    <meshStandardMaterial color={selected ? "#fb923c" : node.type === "window" ? "#77bde8" : "#875e3a"} transparent opacity={node.type === "window" ? .55 : 1} roughness={.45} />
  </mesh>;
}

export function PascalScenePreview({ scene, layers, hiddenNodeIds, levelMode, wallMode, selectedId, highlightHostId, previousRoutePoint, onSelect, overlay, constructionMode = "construction", onSurfaceHit, onSurfaceMove, onSurfaceFinish }: Props) {
  const levelById = useMemo(() => Object.fromEntries(Object.values(scene.nodes).filter((node) => node.type === "level").map((node) => [node.id, numeric(node.level)])), [scene.nodes]);
  const levelFor = (node: NodeData) => {
    let cursor: NodeData | undefined = node, visited = new Set<string>();
    while (cursor && !visited.has(cursor.id)) { visited.add(cursor.id); if (cursor.type === "level") return levelById[cursor.id] ?? 0; cursor = cursor.parentId ? scene.nodes[cursor.parentId] : undefined; }
    return 0;
  };
  const levelIdFor = (node: NodeData) => {
    let cursor: NodeData | undefined = node, visited = new Set<string>();
    while (cursor && !visited.has(cursor.id)) { visited.add(cursor.id); if (cursor.type === "level") return cursor.id; cursor = cursor.parentId ? scene.nodes[cursor.parentId] : undefined; }
    return null;
  };
  const wallHosts = useMemo<WallHostCandidate[]>(() => Object.values(scene.nodes).filter((node) => node.type === "wall").map((node) => ({
    node,
    levelId: levelIdFor(node),
    openings: Object.values(scene.nodes).filter((child) => (child.type === "door" || child.type === "window") && (child.wallId === node.id || child.parentId === node.id)).flatMap((child) => Array.isArray(child.position) && Number.isFinite(child.position[0]) && Number.isFinite(child.width) ? [{ center: child.position[0], width: child.width }] : []),
  })), [scene.nodes, levelById]);
  const handleSurfaceMove = (hit: ThreeDSurfaceHit) => onSurfaceMove?.(transitionToAdjacentWall(hit, wallHosts, .14, previousRoutePoint));
  const handleSurfaceHit = (hit: ThreeDSurfaceHit) => onSurfaceHit?.(transitionToAdjacentWall(hit, wallHosts, .14, previousRoutePoint));
  const elevation = (node: NodeData) => { const level = levelFor(node); return level * 3.2 + (levelMode === "exploded" ? level * 1.6 : 0); };
  const floorTopAt = (level: number, x: number, z: number) => Math.max(0, ...Object.values(scene.nodes).filter((node) => node.type === "slab" && levelFor(node) === level && Array.isArray(node.polygon) && pointInPolygon(x, z, node.polygon)).map((node) => Math.max(0, numeric(node.elevation, .05))));
  const visible = (node: NodeData) => { const layer = typeLayer(node.type); return node.visible !== false && !hiddenNodeIds.has(node.id) && !!layer && layers[layer] && !(node.type === "wall" && wallMode === "down") && (levelMode !== "solo" || levelFor(node) === 0); };
  return <group name="pascal-readonly-preview">
    <ambientLight intensity={1.25} />
    <directionalLight position={[14, 22, 10]} intensity={2.3} castShadow />
    {Object.values(scene.nodes).map((node) => {
      if (!visible(node)) return null;
      const selected = node.id === selectedId || node.id === highlightHostId, select = () => onSelect(node.id), y = elevation(node);
      if (node.type === "wall") return <Wall key={node.id} node={node} hostId={node.id} levelId={levelIdFor(node)} openings={Object.values(scene.nodes).filter((candidate) => (candidate.type === "door" || candidate.type === "window") && (candidate.wallId === node.id || candidate.parentId === node.id))} chases={constructionMode === "finished" ? [] : overlay?.wallChases.filter((feature) => feature.wallId === node.id) ?? []} penetrations={constructionMode === "finished" ? [] : overlay?.penetrations.filter((feature) => feature.hostId === node.id) ?? []} y={y} selected={selected} wallMode={wallMode} onSelect={select} onSurfaceHit={handleSurfaceHit} onSurfaceMove={handleSurfaceMove} onSurfaceFinish={onSurfaceFinish} />;
      if (node.type === "slab") return <Surface key={node.id} node={node} y={y} thickness={Math.max(.01, Math.abs(numeric(node.elevation, .05)))} color="#c4a484" opacity={1} selected={selected} onSelect={select} attachment={{ hostId: node.id, hostKind: "slab", surface: "top", normal: [0, 1, 0], levelId: levelIdFor(node) }} penetrations={constructionMode === "finished" ? [] : overlay?.penetrations.filter((feature) => feature.hostId === node.id) ?? []} onSurfaceHit={handleSurfaceHit} onSurfaceMove={handleSurfaceMove} onSurfaceFinish={onSurfaceFinish} />;
      if (node.type === "ceiling") return <Surface key={node.id} node={node} y={y + numeric(node.height, 2.7)} thickness={.04} color="#f7f2e8" opacity={.94} selected={selected} onSelect={select} attachment={{ hostId: node.id, hostKind: "ceiling", surface: "ceiling-face", normal: [0, -1, 0], levelId: levelIdFor(node) }} penetrations={constructionMode === "finished" ? [] : overlay?.penetrations.filter((feature) => feature.hostId === node.id) ?? []} onSurfaceHit={handleSurfaceHit} onSurfaceMove={handleSurfaceMove} onSurfaceFinish={onSurfaceFinish} />;
      if (node.type === "zone") return <Surface key={node.id} node={node} y={y + .012} color={typeof node.color === "string" ? node.color : "#60a5fa"} opacity={.24} selected={selected} onSelect={select} />;
      if (node.type === "item" || node.type === "shelf" || node.type === "cabinet" || node.type === "cabinet-module") {
        const transform = resolveItemPlanTransform(node.id, scene.nodes), position = vector(node.position);
        const itemLevel = levelFor(node), grounded = node.asset?.attachTo === "wall-side" || node.asset?.attachTo === "ceiling" ? 0 : floorTopAt(itemLevel, transform.status === "ok" ? transform.x : position[0], transform.status === "ok" ? transform.z : position[2]);
        return <ItemProxy key={node.id} node={node} position={transform.status === "ok" ? [transform.x, y + grounded + position[1], transform.z] : [position[0], y + grounded + position[1], position[2]]} selected={selected} onSelect={select} />;
      }
      if (node.type === "door" || node.type === "window") return <Opening key={node.id} node={node} nodes={scene.nodes} y={y} selected={selected} onSelect={select} />;
      if (node.type === "stair" || node.type === "stair-segment") { const pos = vector(node.position), width = Math.max(.4, numeric(node.width, 1)), rise = Math.max(.25, numeric(node.totalRise, 2.8)), run = Math.max(.7, numeric(node.depth, numeric(node.run, 2.4))); return <mesh key={node.id} position={[pos[0], y + rise / 2, pos[2]]} rotation={[0, yaw(node), 0]} onClick={(event) => { event.stopPropagation(); select(); }}><boxGeometry args={[width, rise, run]} /><meshStandardMaterial color={selected ? "#fb923c" : "#a88767"} roughness={.8} /></mesh>; }
      if (node.type === "roof-segment") { const parent = node.parentId ? scene.nodes[node.parentId] : undefined, pos = vector(node.position), parentPos = parent ? vector(parent.position) : [0, 0, 0], width = Math.max(1, numeric(node.width, 8)), depth = Math.max(1, numeric(node.depth, 6)); return <mesh key={node.id} position={[parentPos[0] + pos[0], y + parentPos[1] + pos[1] + .06, parentPos[2] + pos[2]]} rotation={[0, yaw(parent ?? node) + yaw(node), 0]} onClick={(event) => { event.stopPropagation(); select(); }}><boxGeometry args={[width, .12, depth]} /><meshStandardMaterial color={selected ? "#fb923c" : "#7f3f28"} roughness={.72} /></mesh>; }
      return null;
    })}
  </group>;
}
