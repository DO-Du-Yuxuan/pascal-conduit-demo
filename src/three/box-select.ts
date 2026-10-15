import { Box3, Matrix4, Object3D, Vector3, type BufferGeometry } from "three";

export type BoxSelectRect = { left: number; top: number; right: number; bottom: number };
export type BoxSelectPoint = { x: number; y: number };
export type BoxSelectBounds = { minX: number; maxX: number; minZ: number; maxZ: number };

export const BOX_SELECT_DRAG_THRESHOLD_PX = 4;

export function boxSelectRect(start: BoxSelectPoint, end: BoxSelectPoint, threshold = BOX_SELECT_DRAG_THRESHOLD_PX): BoxSelectRect | null {
  if (Math.hypot(end.x - start.x, end.y - start.y) < threshold) return null;
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    right: Math.max(start.x, end.x),
    bottom: Math.max(start.y, end.y),
  };
}

export function mergeBoxSelection(current: readonly string[], incoming: readonly string[], additive: boolean): string[] {
  if (!additive) return [...new Set(incoming)];
  return [...new Set([...current, ...incoming])];
}

export function boxSelectBounds(start: Vector3, end: Vector3): BoxSelectBounds {
  return { minX: Math.min(start.x, end.x), maxX: Math.max(start.x, end.x), minZ: Math.min(start.z, end.z), maxZ: Math.max(start.z, end.z) };
}

/** Test actual rendered mesh bounds, including very thin pipes, without sampling rays. */
export function collectBoxSelection(scene: Object3D, bounds: BoxSelectBounds, worldToEditing: Matrix4): string[] {
  scene.updateMatrixWorld(true);
  const byId = new Map<string, Box3>();
  const point = new Vector3(), transform = new Matrix4();
  scene.traverseVisible((object) => {
    const mesh = object as Object3D & { isMesh?: boolean; geometry?: BufferGeometry };
    if (!mesh.isMesh || !mesh.geometry) return;
    let id: string | null = null;
    for (let ancestor: Object3D | null = object; ancestor; ancestor = ancestor.parent) {
      if (ancestor.userData.boxSelectIgnore) return;
      if (!id && typeof ancestor.userData.boxSelectId === "string") id = ancestor.userData.boxSelectId;
    }
    if (!id) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const localBounds = mesh.geometry.boundingBox;
    if (!localBounds || localBounds.isEmpty()) return;
    transform.multiplyMatrices(worldToEditing, object.matrixWorld);
    const combined = byId.get(id) ?? new Box3();
    for (const x of [localBounds.min.x, localBounds.max.x]) for (const y of [localBounds.min.y, localBounds.max.y]) for (const z of [localBounds.min.z, localBounds.max.z]) {
      combined.expandByPoint(point.set(x, y, z).applyMatrix4(transform));
    }
    byId.set(id, combined);
  });
  return [...byId].filter(([, box]) => box.max.x >= bounds.minX && box.min.x <= bounds.maxX && box.max.z >= bounds.minZ && box.min.z <= bounds.maxZ).map(([id]) => id);
}
