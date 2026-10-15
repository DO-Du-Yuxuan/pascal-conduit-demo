import { useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { Matrix4, Plane, Raycaster, Vector2, Vector3, type Object3D } from "three";
import type { NodeData } from "../types";
import { isBuilderNavigationEvent } from "./camera-navigation";

export type BeamPointer = { point: [number, number, number]; shiftKey: boolean; ctrlKey?: boolean; levelId?: string | null; targetId?: string };

/** Use the visible building's real hit first. Only an already anchored draft
 * may project its cursor through empty space at the established wall-top Y. */
export function beamPointerFromRay(raycaster: Raycaster, objects: Object3D[], nodes: Record<string, NodeData>, worldToEditing: Matrix4, topY: number | null, modifiers: { shiftKey: boolean; ctrlKey: boolean }): BeamPointer | null {
  const hit = raycaster.intersectObjects(objects, true).find(intersection => {
    let object: Object3D | null = intersection.object;
    while (object) {
      if (nodes[object.userData.boxSelectId]) return true;
      object = object.parent;
    }
    return false;
  });
  let targetId: string | undefined;
  if (hit) {
    let object: Object3D | null = hit.object;
    while (object && !nodes[object.userData.boxSelectId]) object = object.parent;
    targetId = object?.userData.boxSelectId;
    const point = hit.point.clone().applyMatrix4(worldToEditing);
    if (topY === null || ["wall", "column", "beam"].includes(nodes[targetId ?? ""]?.type))
      return { point: point.toArray() as [number, number, number], targetId, ...modifiers };
    // Floors/ceilings behind the draft must not pull its cursor off the
    // established wall-top plane or turn into endpoint support.

  }
  if (topY === null) return null;
  const ray = raycaster.ray.clone().applyMatrix4(worldToEditing), point = new Vector3();
  if (!ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -topY), point)) return null;
  return { point: point.toArray() as [number, number, number], ...modifiers };
}

export function BeamSurfacePointerCapture({ nodes, topY, worldToEditing, onPreview, onPlace }: { nodes: Record<string, NodeData>; topY: number | null; worldToEditing: Matrix4; onPreview: (pointer: BeamPointer | null) => void; onPlace: (pointer: BeamPointer | null) => void }) {
  const { camera, gl, scene } = useThree();
  const latest = useRef({ nodes, topY, worldToEditing, onPreview, onPlace });
  latest.current = { nodes, topY, worldToEditing, onPreview, onPlace };
  useEffect(() => {
    const canvas = gl.domElement, raycaster = new Raycaster(), pointer = new Vector2();
    const resolve = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -((event.clientY - bounds.top) / bounds.height * 2 - 1));
      raycaster.setFromCamera(pointer, camera);
      scene.updateMatrixWorld(true);
      const current = latest.current;
      return beamPointerFromRay(raycaster, scene.children, current.nodes, current.worldToEditing, current.topY, { shiftKey: event.shiftKey, ctrlKey: event.ctrlKey || event.metaKey });
    };
    const onMove = (event: PointerEvent) => {
      if (isBuilderNavigationEvent(event) || event.buttons) { latest.current.onPreview(null); return; }
      latest.current.onPreview(resolve(event));
    };
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0 || isBuilderNavigationEvent(event)) { latest.current.onPreview(null); return; }
      const hit = resolve(event);
      event.preventDefault(); event.stopImmediatePropagation();
      latest.current.onPreview(hit);
      latest.current.onPlace(hit);
    };
    const clear = () => latest.current.onPreview(null);
    canvas.addEventListener("pointermove", onMove, true);
    canvas.addEventListener("pointerdown", onDown, true);
    canvas.addEventListener("pointerleave", clear, true);
    canvas.addEventListener("wheel", clear, true);
    return () => {
      canvas.removeEventListener("pointermove", onMove, true);
      canvas.removeEventListener("pointerdown", onDown, true);
      canvas.removeEventListener("pointerleave", clear, true);
      canvas.removeEventListener("wheel", clear, true);
    };
  }, [camera, gl, scene]);
  return null;
}
