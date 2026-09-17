import { CameraControlsImpl } from "@react-three/drei";
import { describe, expect, it } from "vitest";
import { cameraMouseButtons } from "./camera-navigation";

describe("3D camera wheel navigation", () => {
  it("uses zoom instead of dolly for an orthographic camera", () => {
    expect(cameraMouseButtons("perspective").wheel).toBe(CameraControlsImpl.ACTION.DOLLY);
    expect(cameraMouseButtons("orthographic").wheel).toBe(CameraControlsImpl.ACTION.ZOOM);
  });
});
