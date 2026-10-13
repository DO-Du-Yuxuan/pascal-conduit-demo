import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import type { Vec3 } from "../domain/overlay";
import type { ThreeDBounds } from "./scene-input";
import type { NodeData } from "../types";

const DEFAULT_LEVEL_HEIGHT = 2.5;
const DEMO_LEVEL_SPACING = 3.2;

export type BuilderDisplayTransform = {
  buildingId: string | null;
  activeLevelId: string | null;
  actualLevelBaseY: number;
  levelCorrectionY: number;
  displayMatrix: Matrix4;
  worldToEditing: Matrix4;
};

type Vector3Tuple = readonly [number, number, number];

const tuple = (value: unknown): Vector3Tuple => Array.isArray(value)
  ? [numberOr(value[0], 0), numberOr(value[1], 0), numberOr(value[2], 0)]
  : [0, 0, 0];

const numberOr = (value: unknown, fallback: number): number => typeof value === "number" && Number.isFinite(value) ? value : fallback;

function builderLevelHeight(level: NodeData, nodes: Record<string, NodeData>): number {
  if (typeof level.height === "number" && Number.isFinite(level.height) && level.height > 0) return level.height;
  let maxTop = 0;
  const children = Array.isArray(level.children)
    ? level.children.map((id: string) => nodes[id]).filter((node): node is NodeData => Boolean(node))
    : Object.values(nodes).filter((node) => node.parentId === level.id);

  for (const child of children) {
    if (child.type === "ceiling") {
      maxTop = Math.max(maxTop, numberOr(child.height, DEFAULT_LEVEL_HEIGHT));
    } else if (child.type === "wall") {
      // Builder clamps a wall's registered mesh Y to the floor before taking
      // its top; mirror that rule for source positions below the level plane.
      const wallY = Math.max(0, numberOr(child.position?.[1], 0));
      maxTop = Math.max(maxTop, wallY + numberOr(child.height, DEFAULT_LEVEL_HEIGHT));
    }
  }
  return maxTop > 0 ? maxTop : DEFAULT_LEVEL_HEIGHT;
}

function owningBuilding(level: NodeData | undefined, nodes: Record<string, NodeData>): NodeData | undefined {
  let cursor = level;
  const visited = new Set<string>();
  while (cursor && !visited.has(cursor.id)) {
    visited.add(cursor.id);
    if (cursor.type === "building") return cursor;
    cursor = cursor.parentId ? nodes[cursor.parentId] : undefined;
  }
  return undefined;
}

/**
 * Resolves the display-only coordinate seam between Demo editing coordinates
 * and Builder's building-local, stacked-level world coordinates. Source nodes
 * and saved construction coordinates remain untouched.
 */
export function resolveBuilderDisplayTransform(
  nodes: Record<string, NodeData>,
  activeLevelId: string | null | undefined,
): BuilderDisplayTransform {
  const activeLevel = activeLevelId ? nodes[activeLevelId] : undefined;
  const building = owningBuilding(activeLevel, nodes);
  const buildingId = building?.id ?? null;

  const levels = Object.values(nodes)
    .filter((node) => node.type === "level" && (building ? node.parentId === building.id : false))
    .sort((left, right) => numberOr(left.level, 0) - numberOr(right.level, 0));

  let actualLevelBaseY = 0;
  for (const level of levels) {
    actualLevelBaseY += numberOr(level.baseElevation, 0);
    if (level.id === activeLevelId) break;
    actualLevelBaseY += builderLevelHeight(level, nodes);
  }
  const sourceLevel = activeLevel?.type === "level" ? numberOr(activeLevel.level, 0) : 0;
  const levelCorrectionY = actualLevelBaseY - sourceLevel * DEMO_LEVEL_SPACING;

  const buildingPosition = tuple(building?.position);
  const buildingRotation = tuple(building?.rotation);
  const buildingMatrix = new Matrix4().compose(
    new Vector3(...buildingPosition),
    new Quaternion().setFromEuler(new Euler(buildingRotation[0], buildingRotation[1], buildingRotation[2], "XYZ")),
    new Vector3(1, 1, 1),
  );
  const levelCorrection = new Matrix4().makeTranslation(0, levelCorrectionY, 0);
  const displayMatrix = buildingMatrix.multiply(levelCorrection);

  return {
    buildingId,
    activeLevelId: activeLevel?.type === "level" ? activeLevel.id : null,
    actualLevelBaseY,
    levelCorrectionY,
    displayMatrix,
    worldToEditing: displayMatrix.clone().invert(),
  };
}

export function builderDisplayPoint(point: Vector3Tuple, displayMatrix: Matrix4): Vec3 {
  const result = new Vector3(...point).applyMatrix4(displayMatrix);
  return [result.x, result.y, result.z];
}

export function builderEditingPoint(point: Vector3Tuple, worldToEditing: Matrix4): Vec3 {
  const result = new Vector3(...point).applyMatrix4(worldToEditing);
  return [result.x, result.y, result.z];
}

export function builderEditingRay(origin: Vector3Tuple, direction: Vector3Tuple, worldToEditing: Matrix4): { origin: Vec3; direction: Vec3 } {
  const localOrigin = new Vector3(...origin).applyMatrix4(worldToEditing);
  const localDirection = new Vector3(...direction).transformDirection(worldToEditing);
  return {
    origin: [localOrigin.x, localOrigin.y, localOrigin.z],
    direction: [localDirection.x, localDirection.y, localDirection.z],
  };
}

/** A rotation/translation preserves the bounding-sphere span. */
export function builderDisplayBounds(bounds: ThreeDBounds, displayMatrix: Matrix4): ThreeDBounds {
  return { center: builderDisplayPoint(bounds.center, displayMatrix), span: bounds.span };
}
