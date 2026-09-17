import { CameraControlsImpl } from "@react-three/drei";

export type CameraProjection = "perspective" | "orthographic";

export function cameraMouseButtons(projection: CameraProjection) {
  return {
    left: CameraControlsImpl.ACTION.NONE,
    middle: CameraControlsImpl.ACTION.TRUCK,
    right: CameraControlsImpl.ACTION.ROTATE,
    wheel: projection === "orthographic" ? CameraControlsImpl.ACTION.ZOOM : CameraControlsImpl.ACTION.DOLLY,
  };
}
