import { Line } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { Matrix4, Plane, Raycaster, Vector2, Vector3 } from "three";
import { boxSelectBounds, boxSelectRect, collectBoxSelection, type BoxSelectBounds } from "./box-select";
import { isBuilderNavigationEvent } from "./camera-navigation";

type Props = {
  planeY: number;
  worldToEditing: Matrix4;
  onSelect: (ids: string[], additive: boolean) => void;
  onPreview?: (ids: string[]) => void;
  onCancel?: () => void;
};

/** dsphere-style current-level horizontal marquee; no authoring or document writes. */
export function BoxSelectTool({ planeY, worldToEditing, onSelect, onPreview, onCancel }: Props) {
  const { camera, gl, scene, invalidate } = useThree();
  const callbacks = useRef({ onSelect, onPreview, onCancel });
  callbacks.current = { onSelect, onPreview, onCancel };
  const [bounds, setBounds] = useState<BoxSelectBounds | null>(null);
  const displayMatrix = useMemo(() => worldToEditing.clone().invert(), [worldToEditing]);
  useEffect(() => {
    const canvas = gl.domElement, plane = new Plane(new Vector3(0, 1, 0), -planeY);
    const raycaster = new Raycaster(), pointer = new Vector2();
    let drag: { pointerId: number; client: { x: number; y: number }; start: Vector3; end: Vector3; active: boolean } | null = null;
    let suppressClick = false;
    const previousCursor = canvas.style.cursor;
    canvas.style.cursor = "crosshair";
    // Esc can unmount this tool before the held mouse button is released.
    // Keep that cancelled gesture's click from clearing the committed selection.
    const suppressCancelledClick = () => {
      const cleanup = () => { canvas.removeEventListener("click", swallow, true); canvas.removeEventListener("pointerdown", cleanup, true); window.clearTimeout(timer); };
      const swallow = (event: MouseEvent) => { event.preventDefault(); event.stopImmediatePropagation(); cleanup(); };
      const timer = window.setTimeout(cleanup, 1000);
      canvas.addEventListener("click", swallow, true);
      canvas.addEventListener("pointerdown", cleanup, true);
    };
    const hit = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      raycaster.ray.applyMatrix4(worldToEditing);
      return raycaster.ray.intersectPlane(plane, new Vector3());
    };
    const clear = () => {
      const pointerId = drag?.pointerId;
      drag = null;
      if (pointerId !== undefined && canvas.hasPointerCapture?.(pointerId)) canvas.releasePointerCapture(pointerId);
      setBounds(null); callbacks.current.onPreview?.([]); invalidate();
    };
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || isBuilderNavigationEvent(event)) return;
      suppressClick = false;
      const start = hit(event);
      if (!start) return;
      drag = { pointerId: event.pointerId, client: { x: event.clientX, y: event.clientY }, start, end: start.clone(), active: false };
      canvas.setPointerCapture?.(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (isBuilderNavigationEvent(event)) { clear(); return; }
      if (!boxSelectRect(drag.client, { x: event.clientX, y: event.clientY })) return;
      const end = hit(event);
      if (!end) return;
      drag.active = true; drag.end = end;
      event.preventDefault(); event.stopImmediatePropagation();
      const nextBounds = boxSelectBounds(drag.start, end);
      setBounds(nextBounds);
      callbacks.current.onPreview?.(collectBoxSelection(scene, nextBounds, worldToEditing));
      invalidate();
    };
    const up = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId || event.button !== 0) return;
      if (drag.active) {
        event.preventDefault(); event.stopImmediatePropagation();
        suppressClick = true;
        const end = hit(event) ?? drag.end;
        callbacks.current.onSelect(collectBoxSelection(scene, boxSelectBounds(drag.start, end), worldToEditing), event.ctrlKey || event.metaKey);
      }
      clear();
    };
    const click = (event: MouseEvent) => {
      if (!suppressClick || event.button !== 0) return;
      event.preventDefault(); event.stopImmediatePropagation();
    };
    const cancelPointer = (event: PointerEvent) => { if (drag?.pointerId === event.pointerId) { suppressClick = drag.active; clear(); } };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      suppressClick = Boolean(drag?.active);
      if (drag) suppressCancelledClick();
      clear();
      if (callbacks.current.onCancel) { event.preventDefault(); event.stopImmediatePropagation(); callbacks.current.onCancel(); }
    };
    const blur = () => { suppressClick = Boolean(drag?.active); clear(); };
    canvas.addEventListener("pointerdown", down, true);
    canvas.addEventListener("pointermove", move, true);
    canvas.addEventListener("pointerup", up, true);
    canvas.addEventListener("pointercancel", cancelPointer, true);
    canvas.addEventListener("click", click, true);
    canvas.addEventListener("dblclick", click, true);
    window.addEventListener("keydown", escape, true);
    window.addEventListener("blur", blur);
    return () => {
      canvas.removeEventListener("pointerdown", down, true);
      canvas.removeEventListener("pointermove", move, true);
      canvas.removeEventListener("pointerup", up, true);
      canvas.removeEventListener("pointercancel", cancelPointer, true);
      canvas.removeEventListener("click", click, true);
      canvas.removeEventListener("dblclick", click, true);
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("blur", blur);
      canvas.style.cursor = previousCursor;
      if (drag) suppressCancelledClick();
      if (drag && canvas.hasPointerCapture?.(drag.pointerId)) canvas.releasePointerCapture(drag.pointerId);
      callbacks.current.onPreview?.([]);
    };
  }, [camera, gl, scene, invalidate, planeY, worldToEditing]);
  if (!bounds) return null;
  const y = planeY + .02;
  return <group matrix={displayMatrix} matrixAutoUpdate={false} userData={{ boxSelectIgnore: true }}>
    <mesh position={[(bounds.minX + bounds.maxX) / 2, y, (bounds.minZ + bounds.maxZ) / 2]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null} renderOrder={99}>
      <planeGeometry args={[Math.max(.001, bounds.maxX - bounds.minX), Math.max(.001, bounds.maxZ - bounds.minZ)]} />
      <meshBasicMaterial color="#818cf8" transparent opacity={.15} depthTest={false} depthWrite={false} side={2} />
    </mesh>
    <Line points={[[bounds.minX, y, bounds.minZ], [bounds.maxX, y, bounds.minZ], [bounds.maxX, y, bounds.maxZ], [bounds.minX, y, bounds.maxZ], [bounds.minX, y, bounds.minZ]]} color="#818cf8" lineWidth={1.5} depthTest={false} raycast={() => null} renderOrder={100} />
  </group>;
}
