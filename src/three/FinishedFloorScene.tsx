import { selectionAppearance } from "./selection-appearance";
import { useEffect, useMemo } from "react";
import { BufferAttribute, BufferGeometry, DoubleSide, Matrix4, Vector3, type Object3D } from "three";
import type { FinishedFloorSurface } from "../domain/finished-floor";
import type { Vec3 } from "../domain/overlay";

export type FinishedFloorTool = "select" | "point" | "other";

/** Convert a rendered pointer hit back to authored coordinates before placement. */
export function finishedFloorPointerPoint(point: Vec3, worldToEditing: Matrix4): Vec3 {
  const local = new Vector3(...point).applyMatrix4(worldToEditing);
  return [local.x, local.y, local.z];
}

/** A translucent finish must not prevent selecting an existing box below it. */
export function finishedFloorHasDeviceHit(intersections: readonly { object: Object3D }[]): boolean {
  return intersections.some(hit => {
    let object: Object3D | null = hit.object;
    while (object) {
      if (typeof object.userData.positionedDeviceId === "string") return true;
      object = object.parent;
    }
    return false;
  });
}

function SurfaceMesh({
  surface,
  selected,
  interactive,
  placementEnabled,
  worldToEditing,
  onSelect,
  onMove,
  onPlace,
}: {
  surface: FinishedFloorSurface;
  selected: boolean;
  interactive: boolean;
  placementEnabled: boolean;
  worldToEditing: Matrix4;
  onSelect: () => void;
  onMove: (surface: FinishedFloorSurface, point: Vec3 | null) => void;
  onPlace: (surface: FinishedFloorSurface, point: Vec3) => void;
}) {
  const geometry = useMemo(() => {
    const positions = surface.triangles.flatMap(triangle => triangle.flatMap(point => point));
    const result = new BufferGeometry();
    result.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    result.computeVertexNormals();
    return result;
  }, [surface]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh
    name={`finished-floor:${surface.id}`}
    geometry={geometry}
    raycast={interactive ? undefined : () => null}
    userData={{ finishedFloorSurfaceId: surface.id }}
    onPointerMove={event => {
      if (!interactive) return;
      event.stopPropagation();
      onMove(surface, finishedFloorPointerPoint([event.point.x, event.point.y, event.point.z], worldToEditing));
    }}
    onPointerOut={event => { if (interactive) { event.stopPropagation(); onMove(surface, null); } }}
    onClick={event => {
      if (!interactive || event.nativeEvent.button !== 0) return;
      if (!placementEnabled && finishedFloorHasDeviceHit(event.intersections)) return;
      event.stopPropagation();
      const local = finishedFloorPointerPoint([event.point.x, event.point.y, event.point.z], worldToEditing);
      if (placementEnabled && event.nativeEvent.detail < 2) onPlace(surface, local);
      else onSelect();
    }}
  >
    <meshBasicMaterial color={selectionAppearance("#e8b968", selected).color} transparent opacity={selected ? .26 : .18} side={DoubleSide} depthWrite={false} polygonOffset polygonOffsetFactor={-1} />
  </mesh>;
}

/** Derived scene-only floor finish patches; they never enter the saved project tree. */
export function FinishedFloorScene({
  surfaces,
  activeLevelId,
  tool,
  floorPlacementEnabled,
  worldToEditing,
  selectedId,
  onSelect,
  onMove,
  onPlace,
}: {
  surfaces: readonly FinishedFloorSurface[];
  activeLevelId: string;
  tool: FinishedFloorTool;
  floorPlacementEnabled: boolean;
  worldToEditing: Matrix4;
  selectedId: string | null;
  onSelect: (surface: FinishedFloorSurface) => void;
  onMove: (surface: FinishedFloorSurface, point: Vec3 | null) => void;
  onPlace: (surface: FinishedFloorSurface, point: Vec3) => void;
}) {
  const interactive = tool === "select" || tool === "point" && floorPlacementEnabled;
  return <group name="derived-finished-floors">
    {surfaces.filter(surface => surface.levelId === activeLevelId).map(surface => <SurfaceMesh
      key={surface.id}
      surface={surface}
      selected={selectedId === surface.id}
      interactive={interactive}
      placementEnabled={tool === "point" && floorPlacementEnabled}
      worldToEditing={worldToEditing}
      onSelect={() => onSelect(surface)}
      onMove={onMove}
      onPlace={onPlace}
    />)}
  </group>;
}
