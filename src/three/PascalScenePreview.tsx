import { Html, Line } from "@react-three/drei";
import { useEffect, useMemo, useState } from "react";
import { BackSide, BoxGeometry, DoubleSide, ExtrudeGeometry, FrontSide, Matrix4, Quaternion, RepeatWrapping, Shape, ShapeGeometry, SRGBColorSpace, Texture, TextureLoader, Vector3 } from "three";
import { getRoofOuterSurfaceFrameAtPoint } from "@pascal-app/viewer";
import { finalDimensions, resolveItemPlanTransform, resolveItemVerticalRange, resolveWallOpeningTransform } from "../geometry/transform";
import { getWallCurveFrameAt, isCurvedWall } from "../geometry/walls/curve";
import { DEFAULT_WALL_THICKNESS } from "../geometry/walls/thickness";
import { sourceNodeIsVisible } from "../scene-visibility";
import { resolveEffectiveBuildingParameters, resolveSlabVerticalRange } from "../geometry/effective-building";
import { beamNodeDefinition } from "../nodes/beam/definition";
import type { BeamRendererProps } from "../nodes/beam/BeamRenderer";
import { BuilderOpeningPreview } from "./BuilderOpeningPreview";
import { resolveBuilderOpeningWallTransform } from "./builder-opening-geometry";
import type { NodeData } from "../types";
import type { ThreeDLayerVisibility } from "./ThreeDWorkspace";
import { buildingLayerForType, type ThreeDLevelMode, type ThreeDWallMode } from "./view-state";
import type { ThreeDSceneInput } from "./scene-input";
import type { ConduitOverlayDocument, HostAttachment, Penetration, RoutePoint, SurfaceChase, Vec3 } from "../domain/overlay";
import { transitionToAdjacentWall, type WallHostCandidate } from "./host-transition";
import { isFrontmostSurfaceEvent } from "./surface-picking";
import { subtractBeamPenetrations, subtractHorizontalChases } from "./chase-geometry";
import { validateBeam, type BeamNode } from "../domain/beams";
import { beamPlanarClearances, type BeamPlanarClearance } from "../domain/beam-positioning";
import { getBuilderPresentation, sourceDimension } from "./builder-presentation";
import { buildCanonicalBuilderRoofGeometry, buildBuilderSkylightParts, buildBuilderStairParts, builderRoofSegmentTransform, withBuilderRoofDefaults, withBuilderSkylightDefaults } from "./builder-geometry";
import { buildBuilderColumnParts, buildBuilderFenceParts } from "./builder-structural-geometry";
import { buildBuilderWallGeometry } from "./builder-wall-geometry";
import { resolveBuilderRoleMaterial, resolveBuilderWallMaterials, resolveBuilderMaterialSchema } from "./builder-materials";
import type { BuilderResolvedMaterial, BuilderTextureSlot } from "./builder-materials";

export type ThreeDSurfaceHit = { point: Vec3; attachment: HostAttachment; shiftKey: boolean; ctrlKey?: boolean };
type Props = { scene: ThreeDSceneInput; layers: ThreeDLayerVisibility; hiddenNodeIds: ReadonlySet<string>; levelMode: ThreeDLevelMode; activeLevelId?: string; wallMode: ThreeDWallMode; selectedId: string | null; highlightHostId?: string | null; previousRoutePoint?: RoutePoint; penetrationBypassHostId?: string | null; beamPreview?: BeamNode | null; onSelect: (id: string) => void; overlay?: ConduitOverlayDocument; appliedSurfaceChases?: SurfaceChase[]; appliedPenetrations?: Penetration[]; constructionMode?: "construction" | "finished" | "xray"; onSurfaceHit?: (hit: ThreeDSurfaceHit) => void; onSurfaceMove?: (hit: ThreeDSurfaceHit | null) => void; onSurfaceFinish?: () => void; onChaseFallback?: (key: string, failed: boolean) => void };
type Point = [number, number, number];
const EMPTY_CHASES: SurfaceChase[] = [];
const EMPTY_PENETRATIONS: Penetration[] = [];
const EMPTY_OPENINGS: NodeData[] = [];
const TEXTURE_SLOTS: BuilderTextureSlot[] = ["map", "normalMap", "roughnessMap", "metalnessMap", "displacementMap", "aoMap", "emissiveMap", "bumpMap", "alphaMap", "lightMap"];
const PRESENTATION = getBuilderPresentation();

const numeric = (value: unknown, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const resolveNodeMaterial = (node: NodeData, schemaKey = "material", presetKey = "materialPreset", role: "roof" | "joinery" | "glazing" | "furnishing" = "joinery") => {
  const schema = node[schemaKey];
  if (schema && typeof schema === "object") return resolveBuilderMaterialSchema(schema as any);
  const preset = node[presetKey];
  if (typeof preset === "string" && preset.length > 0) return resolveBuilderMaterialSchema({ materialPreset: preset } as any);
  return resolveBuilderRoleMaterial(role);
};
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


function BuilderWallMaterialSlot({ attach, resolved, selected, translucent }: { attach: string; resolved: BuilderResolvedMaterial; selected: boolean; translucent: boolean }) {
  const [textures, setTextures] = useState<Partial<Record<BuilderTextureSlot, Texture>>>({});
  useEffect(() => {
    let active = true;
    const loaded: Partial<Record<BuilderTextureSlot, Texture>> = {};
    setTextures({});
    for (const slot of TEXTURE_SLOTS) {
      const source = resolved.maps[slot];
      if (!source) continue;
      new TextureLoader().load(source.url, (texture) => {
        if (!active) { texture.dispose(); return; }
        texture.wrapS = texture.wrapT = RepeatWrapping;
        texture.repeat.set(source.repeat[0], source.repeat[1]);
        if (slot === "map" || slot === "emissiveMap") texture.colorSpace = SRGBColorSpace;
        loaded[slot] = texture;
        setTextures({ ...loaded });
      }, undefined, () => undefined);
    }
    return () => { active = false; Object.values(loaded).forEach((texture) => texture?.dispose()); };
  }, [resolved]);
  const side = resolved.side === "double" ? DoubleSide : resolved.side === "back" ? BackSide : FrontSide;
  return <meshStandardMaterial attach={attach}
    color={selected ? "#fb923c" : resolved.color}
    roughness={resolved.roughness}
    metalness={resolved.metalness}
    opacity={resolved.opacity * (translucent ? .3 : 1)}
    transparent={resolved.transparent || translucent}
    side={side}
    map={textures.map}
    normalMap={textures.normalMap}
    roughnessMap={textures.roughnessMap}
    metalnessMap={textures.metalnessMap}
    displacementMap={textures.displacementMap}
    aoMap={textures.aoMap}
    emissiveMap={textures.emissiveMap}
    bumpMap={textures.bumpMap}
    alphaMap={textures.alphaMap}
    lightMap={textures.lightMap}
  />;
}

function Beam({ node, levelY, ...props }: Omit<BeamRendererProps, "node" | "levelBaseY"> & { node: NodeData; levelY: number }) {
  const Renderer = beamNodeDefinition.Renderer;
  return <Renderer node={node as BeamNode} levelBaseY={levelY} {...props} />;
}

function Surface({ node, y, thickness = 0, color, opacity, selected, onSelect, attachment, chases = EMPTY_CHASES, penetrations = EMPTY_PENETRATIONS, onSurfaceHit, onSurfaceMove, onSurfaceFinish, onChaseFallback }: { node: NodeData; y: number; thickness?: number; color: string; opacity: number; selected: boolean; onSelect: () => void; attachment?: HostAttachment; chases?: SurfaceChase[]; penetrations?: Penetration[]; onSurfaceHit?: (hit: ThreeDSurfaceHit) => void; onSurfaceMove?: (hit: ThreeDSurfaceHit | null) => void; onSurfaceFinish?: () => void; onChaseFallback?: (key: string, failed: boolean) => void }) {
  const result = useMemo(() => {
    const polygon = Array.isArray(node.polygon) ? node.polygon : [];
    if (polygon.length < 3) return { geometry: null, failed: false };
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
      for (let index = 0; index < 12; index += 1) { const angle = index / 12 * Math.PI * 2, x = penetration.entry.position[0] + Math.cos(angle) * radius, z = penetration.entry.position[2] + Math.sin(angle) * radius; if (index) path.lineTo(x, -z); else path.moveTo(x, -z); }
      path.closePath(); shape.holes.push(path);
    }
    if (thickness <= 0) return { geometry: new ShapeGeometry(shape), failed: false };
    const base = new ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
    return subtractHorizontalChases(base, chases, y, thickness);
  }, [node.polygon, node.holes, penetrations, chases, thickness, y]);
  useEffect(() => { onChaseFallback?.(node.id, result.failed); return () => onChaseFallback?.(node.id, false); }, [node.id, result.failed, result.geometry, onChaseFallback]);
  useEffect(() => () => result.geometry?.dispose(), [result.geometry]);
  const geometry = result.geometry;
  if (!geometry) return null;
  const hit = (event: any): ThreeDSurfaceHit | null => {
    if (!attachment) return null;
    // Horizontal hosts are double-sided. Preserve the face the user actually
    // clicked so an 86 box fronts downward from below a ceiling and upward
    // from above it, rather than forcing every horizontal host to one Y side.
    const normal: Vec3 = attachment.hostKind === "wall" ? attachment.normal : event.ray.direction.y < 0 ? [0, 1, 0] : [0, -1, 0];
    const surface = attachment.hostKind === "ceiling"
      ? normal[1] < 0 ? "ceiling-face" : "ceiling-back"
      : normal[1] < 0 ? "bottom" : "top";
    return { point: [event.point.x, event.point.y, event.point.z], attachment: { ...attachment, surface, normal, localPosition: [event.point.x, event.point.y - y, event.point.z], basis: { u: [1, 0, 0], v: [0, 0, 1] } }, shiftKey: event.nativeEvent.shiftKey, ctrlKey: event.nativeEvent.ctrlKey || event.nativeEvent.metaKey };
  };
  return <mesh position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]} onPointerMove={(event) => { if (!isFrontmostSurfaceEvent(event)) return; const next = hit(event); if (next) onSurfaceMove?.(next); }} onClick={(event) => { if (!isFrontmostSurfaceEvent(event)) return; event.stopPropagation(); onSelect(); const next = hit(event); if (next && event.nativeEvent.detail < 2) onSurfaceHit?.(next); }} onDoubleClick={(event) => { if (!isFrontmostSurfaceEvent(event)) return; event.stopPropagation(); onSurfaceFinish?.(); }}>
    <primitive object={geometry} attach="geometry" />
    <meshStandardMaterial color={selected ? "#fb923c" : color} transparent opacity={opacity} side={2} roughness={.88} />
  </mesh>;
}

function ItemProxy({ node, position, rotationY, selected, onSelect }: { node: NodeData; position: Point; rotationY: number; selected: boolean; onSelect: () => void }) {
  const [width, height, depth] = dimensions(node);
  const geometry = useMemo(() => width > 0 && height > 0 && depth > 0 ? new BoxGeometry(width, height, depth) : null, [width, height, depth]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return null;
  return <group position={position} rotation={[0, rotationY, 0]} onClick={(event) => { event.stopPropagation(); onSelect(); }}>
    <mesh position={[0, height / 2, 0]}>
      <primitive object={geometry} attach="geometry" />
      <meshStandardMaterial color={selected ? "#fb923c" : PRESENTATION.colors.furnishing} roughness={.72} />
    </mesh>
  </group>;
}

function MiteredWallMesh({ node, levelWalls, openings, chases, penetrations, levelY, selected, translucent, hostId, hit, onSelect, onSurfaceHit, onSurfaceMove, onSurfaceFinish, onChaseFallback }: { node: NodeData; levelWalls: NodeData[]; openings: NodeData[]; chases: SurfaceChase[]; penetrations: Penetration[]; levelY: number; selected: boolean; translucent: boolean; hostId: string; hit: (event: any) => ThreeDSurfaceHit; onSelect: () => void; onSurfaceHit?: (hit: ThreeDSurfaceHit) => void; onSurfaceMove?: (hit: ThreeDSurfaceHit | null) => void; onSurfaceFinish?: () => void; onChaseFallback?: (key: string, failed: boolean) => void }) {
  const materials = useMemo(() => resolveBuilderWallMaterials(node, { textures: true }), [node]);
  const result = useMemo(() => {
    let cutFailed = false;
    try {
      const geometry = buildBuilderWallGeometry(node as any, { levelWalls: levelWalls as any, openings, levelY, chases, penetrations, onCsgFailure: () => { cutFailed = true; } });
      return { geometry, failed: cutFailed };
    }
    catch {
      // Keep a renderable source-sized wall visible when a boolean fails. This
      // fallback is intentionally reported because it cannot preserve cuts.
      const start = node.start ?? [0, 0], end = node.end ?? [0, 0], dx = end[0] - start[0], dz = end[1] - start[1], length = Math.hypot(dx, dz), height = numeric(node.height, 2.7), thickness = numeric(node.thickness, DEFAULT_WALL_THICKNESS);
      const geometry = new BoxGeometry(length, height, thickness);
      geometry.applyMatrix4(new Matrix4().makeRotationY(Math.atan2(dx, dz)).setPosition((start[0] + end[0]) / 2, levelY + height / 2, (start[1] + end[1]) / 2));
      return { geometry, failed: true };
    }
  }, [node, levelWalls, openings, levelY, chases, penetrations]);
  useEffect(() => { onChaseFallback?.(hostId, result.failed); return () => { result.geometry.dispose(); onChaseFallback?.(hostId, false); }; }, [result, hostId, onChaseFallback]);
  return <mesh castShadow receiveShadow onPointerMove={(event) => { if (isFrontmostSurfaceEvent(event)) onSurfaceMove?.(hit(event)); }} onClick={(event) => { if (event.nativeEvent.button !== 0 || !isFrontmostSurfaceEvent(event)) return; event.stopPropagation(); onSelect(); if (event.nativeEvent.detail < 2) onSurfaceHit?.(hit(event)); }} onDoubleClick={(event) => { if (event.nativeEvent.button !== 0 || !isFrontmostSurfaceEvent(event)) return; event.stopPropagation(); onSurfaceFinish?.(); }}><primitive object={result.geometry} attach="geometry" /><BuilderWallMaterialSlot attach="material-0" resolved={materials.base} selected={selected} translucent={translucent} /><BuilderWallMaterialSlot attach="material-1" resolved={materials.interior} selected={selected} translucent={translucent} /><BuilderWallMaterialSlot attach="material-2" resolved={materials.exterior} selected={selected} translucent={translucent} /></mesh>;
}

function Wall({ node, hostId, levelId, levelWalls, openings, chases = EMPTY_CHASES, penetrations = EMPTY_PENETRATIONS, y, selected, wallMode, effectiveHeight, onSelect, onSurfaceHit, onSurfaceMove, onSurfaceFinish, onChaseFallback, curveT }: { node: NodeData; hostId: string; levelId: string | null; levelWalls: NodeData[]; openings: NodeData[]; chases?: SurfaceChase[]; penetrations?: Penetration[]; y: number; selected: boolean; wallMode: ThreeDWallMode; effectiveHeight?: number; onSelect: () => void; onSurfaceHit?: (hit: ThreeDSurfaceHit) => void; onSurfaceMove?: (hit: ThreeDSurfaceHit | null) => void; onSurfaceFinish?: () => void; onChaseFallback?: (key: string, failed: boolean) => void; curveT?: number }) {
  const start = vector([node.start?.[0], 0, node.start?.[1]]), end = vector([node.end?.[0], 0, node.end?.[1]]);
  const length = Math.hypot(end[0] - start[0], end[2] - start[2]);
  const sourceHeight = effectiveHeight ?? numeric(node.height, 2.5), height = wallMode === "cutaway" ? Math.min(sourceHeight, 1.15) : sourceHeight, thickness = numeric(node.thickness, DEFAULT_WALL_THICKNESS);
  const geometryNode = useMemo(() => node.height === height ? node : { ...node, height }, [node, height]);
  if (length < .001 || height <= 0 || thickness <= 0) return null;
  if (isCurvedWall(node as any)) {
    const hit = (event: any): ThreeDSurfaceHit => {
      const point: Vec3 = [event.point.x, event.point.y, event.point.z];
      let t = 0, best = Infinity;
      for (let index = 0; index <= 128; index += 1) {
        const candidate = index / 128, frame = getWallCurveFrameAt(node as any, candidate).point;
        const distance = (frame.x - point[0]) ** 2 + (frame.y - point[2]) ** 2;
        if (distance < best) { best = distance; t = candidate; }
      }
      const frame = getWallCurveFrameAt(node as any, t), tangent: Vec3 = [frame.tangent.x, 0, frame.tangent.y];
      const frontNormal: Vec3 = [-tangent[2], 0, tangent[0]], front = (point[0] - frame.point.x) * frontNormal[0] + (point[2] - frame.point.y) * frontNormal[2] >= 0;
      const normal: Vec3 = front ? frontNormal : [-frontNormal[0], 0, -frontNormal[2]], wallSide = (front ? node.frontSide : node.backSide) === "exterior" ? "exterior" : "interior";
      const chordAlong = Math.hypot(end[0] - start[0], end[2] - start[2]) * t;
      return { point, attachment: { hostId, hostKind: "wall", surface: wallSide, normal, levelId, localPosition: [chordAlong, point[1] - y, 0], basis: { u: tangent, v: [0, 1, 0] }, curveT: t, wallSide }, shiftKey: event.nativeEvent.shiftKey, ctrlKey: event.nativeEvent.ctrlKey || event.nativeEvent.metaKey };
    };
    return <MiteredWallMesh node={geometryNode} levelWalls={levelWalls} openings={openings} chases={chases} penetrations={penetrations} levelY={y} selected={selected} translucent={wallMode === "translucent"} hostId={hostId} hit={hit} onSelect={onSelect} onSurfaceHit={onSurfaceHit} onSurfaceMove={onSurfaceMove} onSurfaceFinish={onSurfaceFinish} onChaseFallback={onChaseFallback} />;
  }
  const hit = (event: any): ThreeDSurfaceHit => {
    const tangent: Vec3 = [(end[0] - start[0]) / length, 0, (end[2] - start[2]) / length];
    const p: Vec3 = [event.point.x, event.point.y, event.point.z];
    const frontNormal: Vec3 = [-tangent[2], 0, tangent[0]], front = (p[0] - start[0]) * frontNormal[0] + (p[2] - start[2]) * frontNormal[2] >= 0;
    const normal: Vec3 = front ? frontNormal : [-frontNormal[0], 0, -frontNormal[2]];
    const declaredSide = front ? node.frontSide : node.backSide;
    const wallSide = declaredSide === "exterior" ? "exterior" : "interior";
    return { point: p, attachment: { hostId, hostKind: "wall", surface: wallSide, normal, levelId, localPosition: [(p[0] - start[0]) * tangent[0] + (p[2] - start[2]) * tangent[2], p[1] - y, (p[0] - start[0]) * normal[0] + (p[2] - start[2]) * normal[2]], basis: { u: tangent, v: [0, 1, 0] }, curveT, wallSide }, shiftKey: event.nativeEvent.shiftKey, ctrlKey: event.nativeEvent.ctrlKey || event.nativeEvent.metaKey };
  };
  return <MiteredWallMesh node={geometryNode} levelWalls={levelWalls} openings={openings} chases={chases} penetrations={penetrations} levelY={y} selected={selected} translucent={wallMode === "translucent"} hostId={hostId} hit={hit} onSelect={onSelect} onSurfaceHit={onSurfaceHit} onSurfaceMove={onSurfaceMove} onSurfaceFinish={onSurfaceFinish} onChaseFallback={onChaseFallback} />;
}

function Opening({ node, nodes, y, selected, onSelect }: { node: NodeData; nodes: Record<string, NodeData>; y: number; selected: boolean; onSelect: () => void }) {
  const wall = nodes[node.wallId || node.parentId || ""];
  const transform = wall ? resolveBuilderOpeningWallTransform(node, wall) : null;
  if (!transform) return null;
  return <group position={[transform.position[0], y + transform.position[1], transform.position[2]]} rotation-y={transform.wallRotationY} onClick={event => { event.stopPropagation(); onSelect(); }}>
    <group rotation={transform.openingRotation}><BuilderOpeningPreview node={node} selected={selected} /></group>
  </group>;
}

function BuilderStair({ stair, nodes, y, selected, onSelect }: { stair: NodeData; nodes: Record<string, NodeData>; y: number; selected: boolean; onSelect: () => void }) {
  const parts = useMemo(() => buildBuilderStairParts(stair, nodes), [stair, nodes]);
  useEffect(() => () => parts.forEach((part) => part.geometry.dispose()), [parts]);
  const material = useMemo(() => resolveNodeMaterial(stair), [stair]);
  const position = vector(stair.position);
  return <group position={[position[0], y + position[1], position[2]]} rotation={[0, yaw(stair), 0]}>
    {parts.map((part, index) => <mesh key={`${stair.id}:${part.sourceId}:${index}`} castShadow receiveShadow position={part.position} rotation={[0, part.rotationY, 0]} onClick={(event) => { event.stopPropagation(); onSelect(); }}>
      <primitive object={part.geometry} attach="geometry" />
      <BuilderWallMaterialSlot attach="material" resolved={material} selected={selected} translucent={false} />
    </mesh>)}
  </group>;
}

function BuilderColumn({ node, y, selected, onSelect }: { node: NodeData; y: number; selected: boolean; onSelect: () => void }) {
  const parts = useMemo(() => buildBuilderColumnParts(node), [node]);
  useEffect(() => () => parts.forEach((part) => part.geometry.dispose()), [parts]);
  const material = useMemo(() => resolveNodeMaterial(node, "material", "materialPreset", "furnishing"), [node]);
  const position = vector(node.position);
  return <group position={[position[0], y + position[1], position[2]]} rotation={[0, yaw(node), 0]} onClick={(event) => { event.stopPropagation(); onSelect(); }}>
    {parts.map((part, index) => <mesh key={`${node.id}:${index}`} castShadow receiveShadow position={part.position} rotation={[0, part.rotationY, 0]}><primitive object={part.geometry} attach="geometry" /><BuilderWallMaterialSlot attach="material" resolved={material} selected={selected} translucent={false} /></mesh>)}
  </group>;
}

function BuilderFence({ node, y, selected, onSelect }: { node: NodeData; y: number; selected: boolean; onSelect: () => void }) {
  const parts = useMemo(() => buildBuilderFenceParts(node), [node]);
  useEffect(() => () => parts.forEach((part) => part.geometry.dispose()), [parts]);
  const material = useMemo(() => resolveNodeMaterial(node), [node]);
  return <group position-y={y} onClick={(event) => { event.stopPropagation(); onSelect(); }}>
    {parts.map((part, index) => <mesh key={`${node.id}:${index}`} castShadow receiveShadow position={part.position} rotation={[0, part.rotationY, 0]}><primitive object={part.geometry} attach="geometry" /><BuilderWallMaterialSlot attach="material" resolved={material} selected={selected} translucent={false} /></mesh>)}
  </group>;
}

export function PascalScenePreview({ scene, layers, hiddenNodeIds, levelMode, activeLevelId, wallMode, selectedId, highlightHostId, previousRoutePoint, penetrationBypassHostId, beamPreview, onSelect, overlay, appliedSurfaceChases, appliedPenetrations, constructionMode = "construction", onSurfaceHit, onSurfaceMove, onSurfaceFinish, onChaseFallback }: Props) {
  const sceneIndex = useMemo(() => {
    const nodes = Object.values(scene.nodes), levelIdByNode: Record<string, string | null> = {}, levelValueByNode: Record<string, number> = {}, openingsByWall: Record<string, NodeData[]> = {}, slabsByLevel: Record<string, NodeData[]> = {}, wallsByLevel: Record<string, NodeData[]> = {};
    const levelIdFor = (node: NodeData) => {
      if (node.id in levelIdByNode) return levelIdByNode[node.id];
      let cursor: NodeData | undefined = node, visited = new Set<string>(), result: string | null = null;
      while (cursor && !visited.has(cursor.id)) { visited.add(cursor.id); if (cursor.type === "level") { result = cursor.id; break; } cursor = cursor.parentId ? scene.nodes[cursor.parentId] : undefined; }
      levelIdByNode[node.id] = result;
      return result;
    };
    for (const node of nodes) {
      const levelId = levelIdFor(node), levelNode = levelId ? scene.nodes[levelId] : undefined;
      levelValueByNode[node.id] = levelNode ? numeric(levelNode.level) : 0;
      if ((node.type === "door" || node.type === "window") && (node.wallId || node.parentId)) (openingsByWall[node.wallId ?? node.parentId!] ??= []).push(node);
      if (node.type === "slab") (slabsByLevel[levelId ?? ""] ??= []).push(node);
      if (node.type === "wall") (wallsByLevel[levelId ?? ""] ??= []).push(node);
    }
    return { nodes, levelIdByNode, levelValueByNode, openingsByWall, slabsByLevel, wallsByLevel };
  }, [scene.nodes]);
  const effectiveParameters = useMemo(() => resolveEffectiveBuildingParameters(scene.nodes), [scene.nodes]);
  const levelFor = (node: NodeData) => sceneIndex.levelValueByNode[node.id] ?? (node.parentId ? numeric(scene.nodes[node.parentId]?.level) : 0);
  const levelIdFor = (node: NodeData) => sceneIndex.levelIdByNode[node.id] ?? null;
  const wallHosts = useMemo<WallHostCandidate[]>(() => sceneIndex.nodes.filter((node) => node.type === "wall").map((node) => ({
    node,
    levelId: levelIdFor(node),
    openings: (sceneIndex.openingsByWall[node.id] ?? EMPTY_OPENINGS).flatMap((child) => Array.isArray(child.position) && Number.isFinite(child.position[0]) && Number.isFinite(child.width) ? [{ center: child.position[0], width: child.width }] : []),
  })), [sceneIndex]);
  const renderedChases = appliedSurfaceChases ?? overlay?.surfaceChases ?? EMPTY_CHASES;
  const renderedPenetrations = appliedPenetrations ?? overlay?.penetrations ?? EMPTY_PENETRATIONS;
  const chasesByHost = useMemo(() => {
    const grouped: Record<string, SurfaceChase[]> = {};
    for (const chase of renderedChases) (grouped[chase.hostId] ??= []).push(chase);
    return grouped;
  }, [renderedChases]);
  const penetrationsByHost = useMemo(() => {
    const grouped: Record<string, Penetration[]> = {};
    for (const penetration of renderedPenetrations) (grouped[penetration.hostId] ??= []).push(penetration);
    return grouped;
  }, [renderedPenetrations]);
  const handleSurfaceMove = (hit: ThreeDSurfaceHit | null) => onSurfaceMove?.(hit ? transitionToAdjacentWall(hit, wallHosts, .14, previousRoutePoint, penetrationBypassHostId) : null);
  const handleSurfaceHit = (hit: ThreeDSurfaceHit) => onSurfaceHit?.(transitionToAdjacentWall(hit, wallHosts, .14, previousRoutePoint, penetrationBypassHostId));
  const elevation = (node: NodeData) => { const level = levelFor(node); return level * 3.2 + (levelMode === "exploded" ? level * 1.6 : 0); };
  const floorTopAt = (levelId: string | null, x: number, z: number) => Math.max(0, ...(sceneIndex.slabsByLevel[levelId ?? ""] ?? EMPTY_OPENINGS).filter((node) => Array.isArray(node.polygon) && pointInPolygon(x, z, node.polygon)).map((node) => Math.max(0, numeric(node.elevation, .05))));
  const visible = (node: NodeData) => { const layer = buildingLayerForType(node.type); return sourceNodeIsVisible(node.id, scene.nodes) && !hiddenNodeIds.has(node.id) && !!layer && layers[layer] && !(node.type === "beam" && !validateBeam(node, scene.nodes).valid) && !(node.type === "wall" && wallMode === "down") && (levelMode !== "solo" || (activeLevelId ? levelIdFor(node) === activeLevelId : levelFor(node) === 0)); };
  return <group name="pascal-readonly-preview">
    {layers.beams && beamPreview && !scene.nodes[beamPreview.id] && <Beam node={beamPreview} selected={false} onSelect={() => undefined} levelY={elevation(beamPreview)} preview />}
    {sceneIndex.nodes.map((node) => {
      if (!visible(node)) return null;
      const selected = node.id === selectedId || node.id === highlightHostId, select = () => onSelect(node.id), y = elevation(node);
      if (node.type === "wall") return <Wall key={node.id} node={node} hostId={node.id} levelId={levelIdFor(node)} levelWalls={sceneIndex.wallsByLevel[levelIdFor(node) ?? ""] ?? EMPTY_OPENINGS} openings={sceneIndex.openingsByWall[node.id] ?? EMPTY_OPENINGS} chases={constructionMode === "finished" ? EMPTY_CHASES : chasesByHost[node.id] ?? EMPTY_CHASES} penetrations={constructionMode === "finished" ? EMPTY_PENETRATIONS : penetrationsByHost[node.id] ?? EMPTY_PENETRATIONS} y={y} selected={selected} effectiveHeight={effectiveParameters[node.id]?.height?.value} wallMode={constructionMode === "xray" ? "translucent" : wallMode} onSelect={select} onSurfaceHit={handleSurfaceHit} onSurfaceMove={handleSurfaceMove} onSurfaceFinish={onSurfaceFinish} onChaseFallback={onChaseFallback} />;
      if (node.type === "slab") { const range = resolveSlabVerticalRange(node); return <Surface key={node.id} node={node} y={y + range.bottom} thickness={range.thickness} color={PRESENTATION.colors.floor} opacity={constructionMode === "xray" ? .32 : 1} selected={selected} onSelect={select} attachment={{ hostId: node.id, hostKind: "slab", surface: "top", normal: [0, 1, 0], levelId: levelIdFor(node) }} chases={constructionMode === "finished" ? EMPTY_CHASES : chasesByHost[node.id] ?? EMPTY_CHASES} penetrations={constructionMode === "finished" ? EMPTY_PENETRATIONS : penetrationsByHost[node.id] ?? EMPTY_PENETRATIONS} onSurfaceHit={handleSurfaceHit} onSurfaceMove={handleSurfaceMove} onSurfaceFinish={onSurfaceFinish} onChaseFallback={onChaseFallback} />; }
      if (node.type === "ceiling") return <Surface key={node.id} node={node} y={y + (effectiveParameters[node.id]?.height?.value ?? 2.5)} thickness={.04} color={PRESENTATION.colors.ceiling} opacity={constructionMode === "xray" ? .24 : .94} selected={selected} onSelect={select} attachment={{ hostId: node.id, hostKind: "ceiling", surface: "ceiling-face", normal: [0, -1, 0], levelId: levelIdFor(node) }} penetrations={constructionMode === "finished" ? EMPTY_PENETRATIONS : penetrationsByHost[node.id] ?? EMPTY_PENETRATIONS} onSurfaceHit={handleSurfaceHit} onSurfaceMove={handleSurfaceMove} onSurfaceFinish={onSurfaceFinish} />;
      if (node.type === "beam") { const rendered = beamPreview?.id === node.id ? beamPreview : node, valid = validateBeam(rendered, scene.nodes).beam; return <Beam key={node.id} node={rendered} selected={selected} onSelect={select} levelY={elevation(rendered)} penetrations={constructionMode === "finished" ? EMPTY_PENETRATIONS : penetrationsByHost[node.id] ?? EMPTY_PENETRATIONS} planarClearances={selected && valid ? beamPlanarClearances(scene.nodes, valid) : []} onSurfaceHit={handleSurfaceHit} onSurfaceMove={handleSurfaceMove} onSurfaceFinish={onSurfaceFinish} />; }
      if (node.type === "zone") return <Surface key={node.id} node={node} y={y + .012} color={typeof node.color === "string" ? node.color : "#60a5fa"} opacity={.24} selected={selected} onSelect={select} />;
      if (node.type === "item" || node.type === "shelf" || node.type === "cabinet" || node.type === "cabinet-module") {
        const transform = resolveItemPlanTransform(node.id, scene.nodes), vertical = resolveItemVerticalRange(node.id, scene.nodes), position = vector(node.position);
        const itemLevelId = levelIdFor(node), worldX = transform.status === "ok" ? transform.x : position[0], worldZ = transform.status === "ok" ? transform.z : position[2], grounded = node.asset?.attachTo === "wall-side" || node.asset?.attachTo === "ceiling" ? 0 : floorTopAt(itemLevelId, worldX, worldZ), localBottom = vertical.status === "ok" ? vertical.bottom : position[1], rotationY = transform.status === "ok" ? transform.rotationY : yaw(node);
        return <ItemProxy key={node.id} node={node} position={[worldX, y + grounded + localBottom, worldZ]} rotationY={rotationY} selected={selected} onSelect={select} />;
      }
      if (node.type === "door" || node.type === "window") return <Opening key={node.id} node={node} nodes={scene.nodes} y={y} selected={selected} onSelect={select} />;
      if (node.type === "column") return <BuilderColumn key={node.id} node={node} y={y} selected={selected} onSelect={select} />;
      if (node.type === "fence") return <BuilderFence key={node.id} node={node} y={y} selected={selected} onSelect={select} />;
      if (node.type === "stair") return <BuilderStair key={node.id} stair={node} nodes={scene.nodes} y={y} selected={selected} onSelect={select} />;
      if (node.type === "stair-segment") return null;
      if (node.type === "roof-segment") {
        const parent = node.parentId ? scene.nodes[node.parentId] : undefined, pos = vector(node.position), parentPos = parent ? vector(parent.position) : [0, 0, 0];
        const transform = builderRoofSegmentTransform(pos, parentPos, parent ? yaw(parent) : 0, yaw(node));
        return <RoofSegmentMesh key={node.id} node={node} nodes={scene.nodes} transform={transform} levelY={y} selected={selected} selectedId={selectedId} onSelect={select} onSelectSkylight={onSelect} onChaseFallback={onChaseFallback} />;
      }
      return null;
    })}
  </group>;
}

function RoofSegmentMesh({ node, nodes, transform, levelY, selected, selectedId, onSelect, onSelectSkylight, onChaseFallback }: { node: NodeData; nodes: Record<string, NodeData>; transform: { position: Point; rotationY: number }; levelY: number; selected: boolean; selectedId: string | null; onSelect: () => void; onSelectSkylight: (id: string) => void; onChaseFallback?: (key: string, failed: boolean) => void }) {
  const result = useMemo(() => buildCanonicalBuilderRoofGeometry(node, nodes), [node, nodes]);
  const geometry = result.geometry;
  const roofMaterials = useMemo(() => {
    const raw = node as any, role = (name: "roof" | "ceiling") => resolveBuilderRoleMaterial(name), explicit = (schema: unknown, preset?: unknown) => schema && typeof schema === "object" ? resolveBuilderMaterialSchema(schema as any) : typeof preset === "string" ? resolveBuilderMaterialSchema({ materialPreset: preset } as any) : undefined;
    const catchAll = explicit(raw.material, raw.materialPreset), top = explicit(raw.topMaterial, raw.topMaterialPreset) ?? catchAll, edge = explicit(raw.edgeMaterial, raw.edgeMaterialPreset) ?? catchAll, wall = explicit(raw.wallMaterial, raw.wallMaterialPreset) ?? catchAll;
    // Canonical Builder roof groups: 0 wall/trim, 1 deck, 2 interior, 3 shingle.
    return [wall ?? edge ?? role("roof"), top ?? role("ceiling"), wall ?? role("ceiling"), top ?? role("roof")];
  }, [node]);
  useEffect(() => { onChaseFallback?.(node.id, result.failed); return () => { geometry.dispose(); onChaseFallback?.(node.id, false); }; }, [geometry, node.id, onChaseFallback, result.failed]);
  const childIds = new Set(Array.isArray(node.children) ? node.children : []), skylights = Object.values(nodes).filter((entry) => entry.type === "skylight" && entry.visible !== false && (entry.roofSegmentId === node.id || entry.parentId === node.id || childIds.has(entry.id)));
  return <group position={[transform.position[0], levelY + transform.position[1], transform.position[2]]} rotation={[0, transform.rotationY, 0]}>
    <mesh castShadow receiveShadow onClick={(event) => { event.stopPropagation(); onSelect(); }}><primitive object={geometry} attach="geometry" />{roofMaterials.map((material, index) => <BuilderWallMaterialSlot key={index} attach={`material-${index}`} resolved={material} selected={selected} translucent={false} />)}</mesh>
    {skylights.map((skylight) => <BuilderSkylight key={skylight.id} node={skylight} roof={node} selected={selectedId === skylight.id} onSelect={() => onSelectSkylight(skylight.id)} />)}
  </group>;
}

function BuilderSkylight({ node, roof, selected, onSelect }: { node: NodeData; roof: NodeData; selected: boolean; onSelect: () => void }) {
  const source = useMemo(() => withBuilderSkylightDefaults(node), [node]), position = vector(source.position), roofWithDefaults = useMemo(() => withBuilderRoofDefaults(roof), [roof]), frame = useMemo(() => getRoofOuterSurfaceFrameAtPoint(roofWithDefaults as any, position[0], position[2]), [roofWithDefaults, position[0], position[2]]);
  const quaternion = useMemo(() => new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(frame.normal.x, frame.normal.y, frame.normal.z).normalize()), [frame]);
  const parts = useMemo(() => buildBuilderSkylightParts(source), [source]);
  useEffect(() => () => parts.forEach((part) => part.geometry.dispose()), [parts]);
  const frameMaterial = useMemo(() => resolveNodeMaterial(source, "material", "materialPreset", "joinery"), [source]);
  const glassMaterial = useMemo(() => resolveNodeMaterial(source, "glassMaterial", "glassMaterialPreset", "glazing"), [source]);
  return <group position={[position[0], frame.point.y, position[2]]} quaternion={[quaternion.x, quaternion.y, quaternion.z, quaternion.w]}>
    <group rotation-y={numeric(source.rotation)} onClick={(event) => { event.stopPropagation(); onSelect(); }}>
      {parts.map((part, index) => { const material = part.role === "glazing" ? glassMaterial : frameMaterial, rotation = part.rotation ?? [0, part.rotationY, 0]; return <mesh key={`${node.id}:${index}`} castShadow={part.role !== "glazing"} receiveShadow position={part.position} rotation={rotation}><primitive object={part.geometry} attach="geometry" /><BuilderWallMaterialSlot attach="material" resolved={material} selected={selected} translucent={false} /></mesh>; })}
    </group>
  </group>;
}
