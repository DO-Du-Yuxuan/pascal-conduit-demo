import { useMemo } from "react";
import { BoxGeometry, Quaternion, Shape, Vector3 } from "three";
import type { ThreeEvent } from "@react-three/fiber";
import type { BuildingScene as Building, PascalNode, Vec3 } from "../domain/building";
import { levelElevation, levelForNode, numberAt, planPoint, vec3 } from "../domain/building";
import type { HostAttachment, HostKind, Penetration, WallChase } from "../domain/overlay";
import { Brush, Evaluator, SUBTRACTION } from "three-bvh-csg";
import { computeBoundsTree } from "three-mesh-bvh";

export type SurfaceHit = { point: Vec3; attachment: HostAttachment; shiftKey: boolean };
export type BuildingSceneProps = { building: Building; mode: "construction" | "finished" | "xray"; selectedHostId: string | null; wallChases: WallChase[]; penetrations: Penetration[]; onSurfaceMove: (hit: SurfaceHit) => void; onSurfaceClick: (hit: SurfaceHit) => void; onSurfaceFinish: () => void };

const number = (value: unknown, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const yaw = (node: PascalNode) => typeof node.rotation === "number" ? node.rotation : numberAt(node.rotation, 1);
const pointInside = (x: number, z: number, polygon: unknown[]) => {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = planPoint(polygon[index]), b = planPoint(polygon[previous]);
    if ((a[2] > z) !== (b[2] > z) && x < (b[0] - a[0]) * (z - a[2]) / (b[2] - a[2]) + a[0]) inside = !inside;
  }
  return inside;
};

function attachment(node: PascalNode, hostKind: HostKind, surface: string, normal: Vec3, building: Building): HostAttachment {
  return { hostId: node.id, hostKind, surface, normal, levelId: levelForNode(building, node) };
}

function surfaceHit(event: ThreeEvent<MouseEvent | PointerEvent>, node: PascalNode, hostKind: HostKind, surface: string, normal: Vec3, building: Building): SurfaceHit {
  return { point: [event.point.x, event.point.y, event.point.z], attachment: attachment(node, hostKind, surface, normal, building), shiftKey: event.nativeEvent.shiftKey };
}

function Surface({ node, building, kind, y, thickness, color, opacity, selected, penetrations, onSurfaceMove, onSurfaceClick, onSurfaceFinish }: { node: PascalNode; building: Building; kind: "slab" | "ceiling"; y: number; thickness: number; color: string; opacity: number; selected: boolean; penetrations: Penetration[]; onSurfaceMove: BuildingSceneProps["onSurfaceMove"]; onSurfaceClick: BuildingSceneProps["onSurfaceClick"]; onSurfaceFinish: BuildingSceneProps["onSurfaceFinish"] }) {
  const shape = useMemo(() => {
    const polygon = Array.isArray(node.polygon) ? node.polygon : [];
    if (polygon.length < 3) return null;
    const result = new Shape();
    const add = (points: unknown[], target: Shape) => points.forEach((point, index) => { const [x, , z] = planPoint(point); index ? target.lineTo(x, -z) : target.moveTo(x, -z); });
    add(polygon, result); result.closePath();
    for (const hole of Array.isArray(node.holes) ? node.holes : []) if (Array.isArray(hole) && hole.length >= 3) { const path = new Shape(); add(hole, path); path.closePath(); result.holes.push(path); }
    // These holes are added only to this transient render shape. The stored
    // Pascal floor/ceiling polygon and the overlay remain independent.
    for (const penetration of penetrations) {
      const radius = penetration.diameterMm / 2000;
      const path = new Shape();
      for (let index = 0; index < 12; index++) {
        const angle = index / 12 * Math.PI * 2;
        const x = penetration.point.position[0] + Math.cos(angle) * radius;
        const z = penetration.point.position[2] + Math.sin(angle) * radius;
        index ? path.lineTo(x, -z) : path.moveTo(x, -z);
      }
      path.closePath(); result.holes.push(path);
    }
    return result;
  }, [node, penetrations]);
  if (!shape) return null;
  const normal: Vec3 = kind === "slab" ? [0, 1, 0] : [0, -1, 0];
  const handler = (event: ThreeEvent<MouseEvent | PointerEvent>) => surfaceHit(event, node, kind, kind === "slab" ? "top" : "ceiling-face", normal, building);
  return <mesh position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]} onPointerMove={(event) => { event.stopPropagation(); onSurfaceMove(handler(event)); }} onClick={(event) => { event.stopPropagation(); if (event.nativeEvent.detail < 2) onSurfaceClick(handler(event)); }} onDoubleClick={(event) => { event.stopPropagation(); onSurfaceFinish(); }}>
    {thickness > 0 ? <extrudeGeometry args={[shape, { depth: thickness, bevelEnabled: false }]} /> : <shapeGeometry args={[shape]} />}
    <meshStandardMaterial color={selected ? "#f59e0b" : color} transparent opacity={opacity} side={2} roughness={0.9} />
  </mesh>;
}

function useWallGeometry(start: Vec3, end: Vec3, levelY: number, height: number, thickness: number, chases: WallChase[], penetrations: Penetration[], openings: PascalNode[], enabled: boolean) {
  return useMemo(() => {
    const length = Math.hypot(end[0] - start[0], end[2] - start[2]);
    const base = new BoxGeometry(length, height, thickness);
    if (!enabled || !(chases.length || penetrations.length || openings.length)) return { geometry: base, failed: false };
    try {
      const center = new Vector3((start[0] + end[0]) / 2, levelY + height / 2, (start[2] + end[2]) / 2);
      const xAxis = new Vector3(end[0] - start[0], 0, end[2] - start[2]).normalize();
      const zAxis = new Vector3(-xAxis.z, 0, xAxis.x);
      const local = (world: Vec3) => {
        const relative = new Vector3(world[0], world[1], world[2]).sub(center);
        return new Vector3(relative.dot(xAxis), relative.y, relative.dot(zAxis));
      };
      const prepare = (brush: Brush) => {
        // three-bvh-csg and R3F bring different declarations for this optional
        // geometry extension. Invoke the implementation directly instead of
        // mutating the geometry's public type.
        computeBoundsTree.call(brush.geometry);
        brush.updateMatrixWorld();
      };
      let result = new Brush(base);
      prepare(result);
      const evaluator = new Evaluator();
      const subtract = (cutter: Brush) => {
        prepare(cutter);
        result = evaluator.evaluate(result, cutter, SUBTRACTION);
        prepare(result);
      };
      for (const chase of chases) {
        const a = local(chase.start.position), b = local(chase.end.position), direction = b.clone().sub(a);
        direction.z = 0;
        if (direction.lengthSq() < 1e-8) continue;
        const width = chase.widthMm / 1000, depth = Math.min(thickness + .004, chase.depthMm / 1000 + .004);
        // Do not run a CSG operation for a curved-wall piece the chase does
        // not actually cross. This keeps the render clone bounded in size.
        if (Math.max(a.x, b.x) < -length / 2 - .02 || Math.min(a.x, b.x) > length / 2 + .02) continue;
        const cutter = new Brush(new BoxGeometry(direction.length() + .008, width, depth));
        const normal = chase.start.attachment?.normal ?? [zAxis.x, 0, zAxis.z];
        const side = new Vector3(normal[0], normal[1], normal[2]).dot(zAxis) >= 0 ? 1 : -1;
        cutter.position.copy(a.clone().add(b).multiplyScalar(.5));
        cutter.position.z = side * (thickness / 2 - depth / 2);
        cutter.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), direction.normalize()));
        subtract(cutter);
      }
      for (const penetration of penetrations) {
        const position = local(penetration.point.position);
        if (Math.abs(position.x) > length / 2 + .02 || Math.abs(position.y) > height / 2 + .02) continue;
        const diameter = penetration.diameterMm / 1000;
        const cutter = new Brush(new BoxGeometry(diameter, diameter, thickness + .01));
        cutter.position.copy(position);
        subtract(cutter);
      }
      for (const opening of openings) {
        const openingWidth = Math.max(.05, number(opening.width, .9));
        const openingHeight = Math.max(.05, number(opening.height, 2));
        const openingPosition = vec3(opening.position);
        const cutter = new Brush(new BoxGeometry(openingWidth + .004, openingHeight + .004, thickness + .01));
        // Pascal wall children use an x offset from the wall start, while the
        // wall mesh itself is centered at the origin.
        cutter.position.set(openingPosition[0] - length / 2, openingPosition[1] - height / 2, 0);
        subtract(cutter);
      }
      result.geometry.computeVertexNormals();
      return { geometry: result.geometry, failed: false };
    } catch {
      return { geometry: base, failed: true };
    }
  }, [start, end, levelY, height, thickness, chases, penetrations, openings, enabled]);
}

function WallBox({ node, building, start, end, levelY, selected, opacity, chases, penetrations, openings, csgEnabled, onSurfaceMove, onSurfaceClick, onSurfaceFinish }: { node: PascalNode; building: Building; start: Vec3; end: Vec3; levelY: number; selected: boolean; opacity: number; chases: WallChase[]; penetrations: Penetration[]; openings: PascalNode[]; csgEnabled: boolean; onSurfaceMove: BuildingSceneProps["onSurfaceMove"]; onSurfaceClick: BuildingSceneProps["onSurfaceClick"]; onSurfaceFinish: BuildingSceneProps["onSurfaceFinish"] }) {
  const dx = end[0] - start[0], dz = end[2] - start[2], length = Math.hypot(dx, dz);
  if (length < 0.001) return null;
  const height = Math.max(0.1, number(node.height, 2.7)), thickness = Math.max(0.05, number(node.thickness, 0.12));
  const wallGeometry = useWallGeometry(start, end, levelY, height, thickness, chases, penetrations, openings, csgEnabled);
  const midpoint: Vec3 = [(start[0] + end[0]) / 2, levelY + height / 2, (start[2] + end[2]) / 2];
  const wallYaw = -Math.atan2(dz, dx);
  const makeHit = (event: ThreeEvent<MouseEvent | PointerEvent>) => {
    const faceNormal = event.face?.normal.clone().transformDirection(event.object.matrixWorld);
    const normal: Vec3 = faceNormal ? [faceNormal.x, faceNormal.y, faceNormal.z] : [0, 0, 1];
    return surfaceHit(event, node, "wall", normal[2] >= 0 ? "exterior" : "interior", normal, building);
  };
  return <mesh position={midpoint} rotation={[0, wallYaw, 0]} onPointerMove={(event) => { event.stopPropagation(); onSurfaceMove(makeHit(event)); }} onClick={(event) => { event.stopPropagation(); if (event.nativeEvent.detail < 2) onSurfaceClick(makeHit(event)); }} onDoubleClick={(event) => { event.stopPropagation(); onSurfaceFinish(); }}>
    <primitive attach="geometry" object={wallGeometry.geometry} />
    <meshStandardMaterial color={selected ? "#f59e0b" : "#d4c5b3"} transparent={opacity < 1} opacity={opacity} roughness={0.92} />
  </mesh>;
}

function CurvedWall({ node, building, levelY, selected, opacity, chases, penetrations, openings, csgEnabled, onSurfaceMove, onSurfaceClick, onSurfaceFinish }: Omit<React.ComponentProps<typeof WallBox>, "start" | "end">) {
  const start = planPoint(node.start), end = planPoint(node.end), offset = number(node.curveOffset);
  const count = Math.max(12, Math.min(32, Math.ceil(Math.hypot(end[0] - start[0], end[2] - start[2]) * 3)));
  const normal: Vec3 = [-(end[2] - start[2]), 0, end[0] - start[0]];
  const length = Math.hypot(normal[0], normal[2]) || 1;
  const unit: Vec3 = [normal[0] / length, 0, normal[2] / length];
  const pointAt = (t: number): Vec3 => [start[0] * (1 - t) + end[0] * t + unit[0] * offset * 4 * t * (1 - t), 0, start[2] * (1 - t) + end[2] * t + unit[2] * offset * 4 * t * (1 - t)];
  return <group>{Array.from({ length: count }, (_, index) => <WallBox key={index} node={node} building={building} start={pointAt(index / count)} end={pointAt((index + 1) / count)} levelY={levelY} selected={selected} opacity={opacity} chases={chases} penetrations={penetrations} openings={openings} csgEnabled={csgEnabled} onSurfaceMove={onSurfaceMove} onSurfaceClick={onSurfaceClick} onSurfaceFinish={onSurfaceFinish} />)}</group>;
}

function ItemBox({ node, levelY }: { node: PascalNode; levelY: number }) {
  const position = vec3(node.position), dimensions = Array.isArray(node.dimensions) ? node.dimensions : node.asset && typeof node.asset === "object" ? (node.asset as Record<string, unknown>).dimensions : undefined;
  const width = Math.max(0.08, numberAt(dimensions, 0, 0.8)), height = Math.max(0.08, numberAt(dimensions, 1, 0.8)), depth = Math.max(0.08, numberAt(dimensions, 2, 0.8));
  return <mesh position={[position[0], levelY + position[1] + height / 2, position[2]]} rotation={[0, yaw(node), 0]}><boxGeometry args={[width, height, depth]} /><meshStandardMaterial color="#806246" roughness={0.75} /></mesh>;
}

export function BuildingScene({ building, mode, selectedHostId, wallChases, penetrations, onSurfaceMove, onSurfaceClick, onSurfaceFinish }: BuildingSceneProps) {
  const floorTopAt = (node: PascalNode) => {
    const levelId = levelForNode(building, node), position = vec3(node.position);
    const slab = Object.values(building.nodes).find((candidate) => candidate.type === "slab" && levelForNode(building, candidate) === levelId && Array.isArray(candidate.polygon) && pointInside(position[0], position[2], candidate.polygon));
    return slab ? Math.max(0, number(slab.elevation, 0.05)) : 0;
  };
  return <group name="building">
    <ambientLight intensity={1.1} /><directionalLight position={[14, 22, 10]} intensity={2.2} />
    {Object.values(building.nodes).map((node) => {
      if (node.visible === false) return null;
      const levelY = levelElevation(building, levelForNode(building, node));
      const selected = node.id === selectedHostId;
      if (node.type === "wall") { const chases = mode === "finished" ? [] : wallChases.filter((chase) => chase.wallId === node.id), wallPenetrations = mode === "finished" ? [] : penetrations.filter((feature) => feature.hostId === node.id), openings = Object.values(building.nodes).filter((candidate) => ["door", "window"].includes(candidate.type) && (candidate.parentId === node.id || candidate.wallId === node.id)); return typeof node.curveOffset === "number" && Math.abs(node.curveOffset) > 1e-9 ? <CurvedWall key={node.id} node={node} building={building} levelY={levelY} selected={selected} opacity={mode === "xray" ? 0.3 : 1} chases={chases} penetrations={wallPenetrations} openings={openings} csgEnabled onSurfaceMove={onSurfaceMove} onSurfaceClick={onSurfaceClick} onSurfaceFinish={onSurfaceFinish} /> : <WallBox key={node.id} node={node} building={building} start={planPoint(node.start)} end={planPoint(node.end)} levelY={levelY} selected={selected} opacity={mode === "xray" ? 0.3 : 1} chases={chases} penetrations={wallPenetrations} openings={openings} csgEnabled onSurfaceMove={onSurfaceMove} onSurfaceClick={onSurfaceClick} onSurfaceFinish={onSurfaceFinish} />; }
      if (node.type === "slab") return <Surface key={node.id} node={node} building={building} kind="slab" y={levelY} thickness={Math.max(0.01, number(node.elevation, 0.05))} color="#c49a6c" opacity={mode === "xray" ? 0.35 : 1} selected={selected} penetrations={mode === "finished" ? [] : penetrations.filter((feature) => feature.hostId === node.id)} onSurfaceMove={onSurfaceMove} onSurfaceClick={onSurfaceClick} onSurfaceFinish={onSurfaceFinish} />;
      if (node.type === "ceiling") return <Surface key={node.id} node={node} building={building} kind="ceiling" y={levelY + number(node.height, 2.7)} thickness={0.035} color="#f8f4ea" opacity={mode === "construction" ? 0.28 : mode === "xray" ? 0.18 : 0.96} selected={selected} penetrations={mode === "finished" ? [] : penetrations.filter((feature) => feature.hostId === node.id)} onSurfaceMove={onSurfaceMove} onSurfaceClick={onSurfaceClick} onSurfaceFinish={onSurfaceFinish} />;
      if (["item", "shelf", "cabinet", "cabinet-module"].includes(node.type)) return <ItemBox key={node.id} node={node} levelY={levelY + floorTopAt(node)} />;
      return null;
    })}
  </group>;
}
