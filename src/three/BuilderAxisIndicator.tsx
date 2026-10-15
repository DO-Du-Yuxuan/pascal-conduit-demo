import { GizmoHelper, GizmoViewport } from "@react-three/drei";
import { useMemo } from "react";
import { Matrix4, Quaternion } from "three";

/** Axis labels use editing coordinates even when the Building rotates in the viewer. */
export function editingAxesDisplayRotation(displayMatrix: Matrix4): Quaternion {
  return new Quaternion().setFromRotationMatrix(new Matrix4().extractRotation(displayMatrix));
}

export function BuilderAxisIndicator({ displayMatrix }: { displayMatrix: Matrix4 }) {
  const rotation = useMemo(() => editingAxesDisplayRotation(displayMatrix), [displayMatrix]);
  return <GizmoHelper alignment="bottom-left" margin={[58, 58]} renderPriority={2}>
    <group name="editing-axis-indicator" quaternion={rotation}>
      <GizmoViewport disabled scale={28} axisHeadScale={.85} axisColors={["#e5484d", "#30a46c", "#3e63dd"]} labels={["X", "Y", "Z"]} labelColor="#ffffff" />
    </group>
  </GizmoHelper>;
}
