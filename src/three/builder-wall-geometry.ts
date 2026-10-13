import { buildBuilderOpeningGeometry } from "./builder-opening-geometry";
import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Matrix4,
  Quaternion,
  Shape,
  Vector3,
} from "three";
import { Brush, Evaluator, SUBTRACTION } from "three-bvh-csg";
import { computeBoundsTree } from "three-mesh-bvh";
import type { Penetration, SurfaceChase, Vec3 } from "../domain/overlay";
import { calculateLevelMiters, getWallPlanFootprint } from "../geometry/walls";
import { getWallCurveFrameAt, isCurvedWall } from "../geometry/walls/curve";
import type { Point2, Wall } from "../geometry/walls/types";
import type { NodeData } from "../types";
import { sampleChase } from "./chase-geometry";

const EPSILON = 1e-7;

export type BuilderWallGeometryOptions = {
  /** Same-level walls, including `wall`, used to calculate Editor-style miters. */
  levelWalls: Wall[];
  /** Optional precomputed plan boundary in world X/Z coordinates. */
  footprint?: Point2[];
  /** Child Door and Window nodes. Their position is wall-local: [along, height, depth]. */
  openings?: NodeData[];
  /** World elevation of the wall bottom. Geometry is returned in world coordinates. */
  levelY?: number;
  /** Optional construction channels owned by this wall. */
  chases?: SurfaceChase[];
  /** Optional through-wall sleeves owned by this wall. */
  penetrations?: Penetration[];
  /** Called when a cutout/chase/sleeve boolean fails and the intact wall is returned. */
  onCsgFailure?: (diagnostic: string) => void;
};

/**
 * Builds a world-coordinate Builder wall solid from the exact Demo plan footprint.
 * The returned geometry is not attached to a node transform: place the mesh at
 * the origin. Source project nodes and supplied footprints are read-only inputs.
 */
export function buildBuilderWallGeometry(
  wall: Wall,
  options: BuilderWallGeometryOptions,
): BufferGeometry {
  const levelWalls = options.levelWalls.some((candidate) => candidate.id === wall.id)
    ? options.levelWalls
    : [...options.levelWalls, wall];
  const footprint = options.footprint ?? getWallPlanFootprint(wall, calculateLevelMiters(levelWalls));
  const levelY = finite(options.levelY, 0);
  const height = positive(wall.height, 2.5);
  if (footprint.length < 3 || height <= 0 || footprint.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    return new BufferGeometry();
  }

  const shape = new Shape();
  shape.moveTo(footprint[0]!.x, -footprint[0]!.y);
  for (let index = 1; index < footprint.length; index += 1) {
    shape.lineTo(footprint[index]!.x, -footprint[index]!.y);
  }
  shape.closePath();

  const baseGeometry = new ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
  baseGeometry.rotateX(-Math.PI / 2);
  baseGeometry.translate(0, levelY, 0);
  baseGeometry.computeVertexNormals();

  const thickness = positive(wall.thickness, 0.1);
  const tangent = new Vector3(wall.end[0] - wall.start[0], 0, wall.end[1] - wall.start[1]);
  if (tangent.lengthSq() < EPSILON) {
    assignBuilderWallMaterialGroups(baseGeometry, wall, null);
    return baseGeometry;
  }
  tangent.normalize();
  const wallLength = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
  const wallStart = new Vector3(wall.start[0], 0, wall.start[1]);
  const evaluator = new Evaluator();
  evaluator.attributes = ["position", "normal", "uv"];
  let result = new Brush(baseGeometry);
  prepareBrush(result);
  let ownsResultGeometry = false;

  const applyCut = (cutterGeometry: BufferGeometry, position: Vector3, quaternion?: Quaternion) => {
    const cutter = new Brush(cutterGeometry);
    cutter.position.copy(position);
    if (quaternion) cutter.quaternion.copy(quaternion);
    prepareBrush(cutter);
    const previous = result;
    const next = evaluator.evaluate(previous, cutter, SUBTRACTION);
    prepareBrush(next);
    if (ownsResultGeometry) previous.geometry.dispose();
    cutter.geometry.dispose();
    result = next;
    ownsResultGeometry = true;
  };

  try {
    for (const opening of options.openings ?? []) {
      if (opening.type !== "door" && opening.type !== "window") continue;
      if (opening.wallId && opening.wallId !== wall.id) continue;
      if (!opening.wallId && opening.parentId && opening.parentId !== wall.id) continue;
      const position = Array.isArray(opening.position) ? opening.position : [];
      const along = finite(position[0], 0);
      const openingHeight = positive(opening.height, opening.type === "window" ? 1.5 : 2.1);
      const openingWidth = positive(opening.width, opening.type === "window" ? 1.5 : 0.9);
      const centerY = finite(position[1], openingHeight / 2);
      if (along + openingWidth / 2 < 0 || along - openingWidth / 2 > wallLength) continue;
      const frame = isCurvedWall(wall) && wallLength > EPSILON
        ? getWallCurveFrameAt(wall, Math.max(0, Math.min(1, along / wallLength)))
        : null;
      const center = frame
        ? new Vector3(frame.point.x, 0, frame.point.y)
        : wallStart.clone().addScaledVector(tangent, along);
      const cutterTangent = frame?.tangent ?? { x: tangent.x, y: tangent.z };
      center.y = levelY + centerY;
      const yaw = Math.atan2(-cutterTangent.y, cutterTangent.x);
      const generated = buildBuilderOpeningGeometry(opening, { cutDepth: thickness * 4 + 0.02 });
      generated.parts.forEach(part => part.geometry.dispose());
      const cutter = generated.cutGeometry;
      const rotation = new Matrix4().makeRotationY(yaw);
      applyCut(cutter, center, rotationQuaternion(rotation));
    }

    for (const chase of (options.chases ?? []).filter((item) => item.hostId === wall.id && item.hostKind === "wall")) {
      subtractChase(chase, thickness, applyCut);
    }
    for (const penetration of (options.penetrations ?? []).filter((item) => item.hostId === wall.id && item.hostKind === "wall")) {
      subtractSleeve(penetration, applyCut);
    }
  } catch (error) {
    if (ownsResultGeometry) result.geometry.dispose();
    const detail = error instanceof Error ? error.message : String(error);
    options.onCsgFailure?.(`wall_csg_fallback:${wall.id}:${detail}`);
    baseGeometry.computeVertexNormals();
    assignBuilderWallMaterialGroups(baseGeometry, wall, tangent);
    baseGeometry.computeBoundingBox();
    baseGeometry.computeBoundingSphere();
    return baseGeometry;
  }

  if (ownsResultGeometry) baseGeometry.dispose();
  const geometry = result.geometry;
  geometry.computeVertexNormals();
  assignBuilderWallMaterialGroups(geometry, wall, tangent.normalize());
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Builder wall renderers use material 0 for ends/top/bottom, material 1 for
 * the semantic interior face and material 2 for exterior. This reproduces that
 * contract from face normals while leaving the footprint and CSG untouched.
 */
function assignBuilderWallMaterialGroups(geometry: BufferGeometry, wall: Wall, tangent: Vector3 | null) {
  const positions = geometry.getAttribute("position");
  if (!positions) return;
  const index = geometry.getIndex();
  const triangleCount = index ? Math.floor(index.count / 3) : Math.floor(positions.count / 3);
  if (triangleCount === 0) {
    geometry.clearGroups();
    return;
  }

  const horizontalTangent = tangent?.clone().setY(0).normalize();
  const frontNormal = horizontalTangent
    ? new Vector3(-horizontalTangent.z, 0, horizontalTangent.x)
    : null;
  const frontIndex = wall.frontSide === "exterior" ? 2 : 1;
  const backIndex = wall.backSide === "interior" ? 1 : 2;
  const materialByTriangle: number[] = [];
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const normal = new Vector3();

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const ia = index ? index.getX(triangle * 3) : triangle * 3;
    const ib = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1;
    const ic = index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2;
    a.fromBufferAttribute(positions, ia);
    b.fromBufferAttribute(positions, ib);
    c.fromBufferAttribute(positions, ic);
    normal.crossVectors(b.sub(a), c.sub(a)).normalize();
    if (!frontNormal || Math.abs(normal.y) > 0.5) {
      materialByTriangle.push(0);
      continue;
    }

    const sideAlignment = normal.dot(frontNormal);
    if (sideAlignment > 0.5) materialByTriangle.push(frontIndex);
    else if (sideAlignment < -0.5) materialByTriangle.push(backIndex);
    else materialByTriangle.push(0);
  }

  geometry.clearGroups();
  let currentMaterial = materialByTriangle[0] ?? 0;
  let groupStart = 0;
  for (let triangle = 1; triangle < triangleCount; triangle += 1) {
    const materialIndex = materialByTriangle[triangle] ?? 0;
    if (materialIndex === currentMaterial) continue;
    geometry.addGroup(groupStart * 3, (triangle - groupStart) * 3, currentMaterial);
    groupStart = triangle;
    currentMaterial = materialIndex;
  }
  geometry.addGroup(groupStart * 3, (triangleCount - groupStart) * 3, currentMaterial);
}

function subtractChase(
  chase: SurfaceChase,
  wallThickness: number,
  applyCut: (geometry: BufferGeometry, position: Vector3, quaternion?: Quaternion) => void,
) {
  if (!(chase.widthMm > 0 && chase.depthMm > 0)) return;
  const surfaceNormal = new Vector3(...chase.surfaceNormal);
  if (surfaceNormal.lengthSq() < EPSILON) return;
  surfaceNormal.normalize();
  const depth = Math.min(wallThickness, chase.depthMm / 1000);
  const width = chase.widthMm / 1000;
  const points = sampleChase(chase);

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = new Vector3(...points[index]!);
    const end = new Vector3(...points[index + 1]!);
    const delta = end.clone().sub(start);
    const length = delta.length();
    if (length < EPSILON) continue;
    const direction = delta.multiplyScalar(1 / length);
    const normal = surfaceNormal.clone();
    const lateral = normal.clone().cross(direction);
    if (lateral.lengthSq() < EPSILON) continue;
    lateral.normalize();
    normal.crossVectors(direction, lateral).normalize();
    const basis = new Matrix4().makeBasis(direction, lateral, normal);
    const position = start.add(end).multiplyScalar(0.5).addScaledVector(surfaceNormal, -(depth / 2 - 0.001));
    const cutter = new BoxGeometry(length + width, width, depth + 0.004);
    applyCut(cutter, position, rotationQuaternion(basis));
  }
}

function subtractSleeve(
  penetration: Penetration,
  applyCut: (geometry: BufferGeometry, position: Vector3, quaternion?: Quaternion) => void,
) {
  const start = new Vector3(...penetration.entry.position);
  const end = new Vector3(...penetration.exit.position);
  const direction = end.clone().sub(start);
  const length = direction.length();
  if (length < EPSILON || !(penetration.diameterMm > 0)) return;
  const radius = penetration.diameterMm / 2000;
  const cutter = new CylinderGeometry(radius, radius, length + 0.02, 20);
  const center = start.add(end).multiplyScalar(0.5);
  const quaternion = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize());
  applyCut(cutter, center, quaternion);
}

function prepareBrush<T extends Brush>(brush: T): T {
  brush.updateMatrixWorld(true);
  const geometry = brush.geometry as BufferGeometry & { computeBoundsTree?: (...args: never[]) => unknown };
  if (typeof geometry.computeBoundsTree !== "function") {
    (geometry as any).computeBoundsTree = computeBoundsTree;
  }
  (geometry as any).computeBoundsTree({ maxLeafSize: 10 });
  return brush;
}

function rotationQuaternion(matrix: Matrix4) {
  return new Quaternion().setFromRotationMatrix(matrix);
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

