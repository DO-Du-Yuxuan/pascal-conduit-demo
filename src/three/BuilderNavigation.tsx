import { CameraControls, CameraControlsImpl } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Box3, Matrix4, Vector3 } from "three";
import { builderDisplayBounds } from "./builder-display-transform";
import { builderOrbitAzimuth, cameraMouseButtons, clearBuilderNavigationTracking, requestCameraCommand, setNavigationKeyboardEnabled, setSpacePanKeyboardActive, shouldEnableSpacePan, type CameraProjection } from "./camera-navigation";
import type { BuilderDisplayTransform } from "./builder-display-transform";
import type { ThreeDBounds } from "./scene-input";
import type { ThreeDViewPreset } from "./view-state";
import type { Vec3 } from "../domain/overlay";

const GROUND_CAMERA_CLEARANCE = 0.04;
const NO_CAMERA_COLLIDERS: never[] = [];
const IDENTITY_MATRIX = new Matrix4();

type ViewPreset = ThreeDViewPreset;

export function BuilderNavigation({
  bounds,
  preset,
  presetRevision,
  projection,
  onCameraRight,
  keyboardActive = true,
  interactionActive = false,
  orbitRequest,
  displayTransform,
}: {
  bounds: ThreeDBounds;
  preset: ViewPreset;
  presetRevision: number;
  projection: CameraProjection;
  onCameraRight: (right: Vec3) => void;
  keyboardActive?: boolean;
  interactionActive?: boolean;
  orbitRequest?: { id: number; direction: "cw" | "ccw" };
  displayTransform?: Pick<BuilderDisplayTransform, "displayMatrix" | "worldToEditing">;
}) {
  const controls = useRef<CameraControlsImpl>(null!);
  const camera = useThree((state) => state.camera);
  const canvas = useThree((state) => state.gl.domElement);
  const invalidate = useThree((state) => state.invalidate);
  const displayMatrix = displayTransform?.displayMatrix ?? IDENTITY_MATRIX;
  const worldToEditing = displayTransform?.worldToEditing ?? IDENTITY_MATRIX;
  const cameraBounds = useMemo(() => builderDisplayBounds(bounds, displayMatrix), [bounds, displayMatrix]);
  const spacePan = useRef(false);
  const previousCursor = useRef("");
  const mouseButtons = useMemo(() => cameraMouseButtons(projection, spacePan.current), [projection, spacePan.current]);
  const touchActions = useMemo(() => ({
    // Let one finger orbit in navigation mode while leaving active placement and drawing gestures to tools.
    one: interactionActive ? CameraControlsImpl.ACTION.NONE : CameraControlsImpl.ACTION.TOUCH_ROTATE,
    two: projection === "orthographic" ? CameraControlsImpl.ACTION.TOUCH_ZOOM_TRUCK : CameraControlsImpl.ACTION.TOUCH_DOLLY_TRUCK,
    three: CameraControlsImpl.ACTION.TOUCH_ROTATE,
  }), [interactionActive, projection]);

  const reportCameraRight = useCallback(() => {
    const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion).transformDirection(worldToEditing);
    onCameraRight([right.x, right.y, right.z]);
  }, [camera, onCameraRight, worldToEditing]);

  const updateSpacePan = useCallback((enabled: boolean) => {
    spacePan.current = enabled;
    setSpacePanKeyboardActive(enabled);
    if (controls.current) {
      controls.current.mouseButtons.left = enabled
        ? CameraControlsImpl.ACTION.SCREEN_PAN
        : CameraControlsImpl.ACTION.NONE;
    }
  }, []);

  useEffect(() => {
    reportCameraRight();
  }, [reportCameraRight]);

  useEffect(() => {
    setNavigationKeyboardEnabled(keyboardActive);
    if (!keyboardActive) {
      updateSpacePan(false);
      return () => setNavigationKeyboardEnabled(false);
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat || !shouldEnableSpacePan(event.target as HTMLElement | null)) return;
      event.preventDefault();
      if (!spacePan.current) previousCursor.current = document.body.style.cursor;
      document.body.style.cursor = "grab";
      updateSpacePan(true);
    };
    const reset = () => {
      if (!spacePan.current) return;
      updateSpacePan(false);
      document.body.style.cursor = previousCursor.current;
    };
    const onWindowBlur = () => {
      reset();
      clearBuilderNavigationTracking();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") reset();
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onWindowBlur);
      reset();
      setNavigationKeyboardEnabled(false);
    };
  }, [keyboardActive, updateSpacePan]);

  useEffect(() => {
    const suppressBrowserZoom = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
    };
    canvas.addEventListener("wheel", suppressBrowserZoom, { capture: true, passive: false });
    return () => canvas.removeEventListener("wheel", suppressBrowserZoom, true);
  }, [canvas]);

  useEffect(() => {
    if (!controls.current) return;
    const extent = Number.MAX_SAFE_INTEGER;
    controls.current.setBoundary(new Box3(
      new Vector3(-extent, GROUND_CAMERA_CLEARANCE, -extent),
      new Vector3(extent, extent, extent),
    ));
  }, [cameraBounds]);

  const latestBounds = useRef(cameraBounds);
  latestBounds.current = cameraBounds;
  useEffect(() => {
    if (!controls.current || !orbitRequest) return;
    requestCameraCommand(invalidate, () => controls.current.rotateTo(builderOrbitAzimuth(controls.current.azimuthAngle, orbitRequest.direction), controls.current.polarAngle, true));
  }, [orbitRequest?.id, invalidate]);
  useEffect(() => {
    if (!controls.current) return;
    const currentBounds = latestBounds.current;
    const [x, y, z] = currentBounds.center;
    const distance = currentBounds.span * 1.35;
    const viewpoints: Record<ViewPreset, [number, number, number, number, number, number]> = {
      exterior: [x + distance, y + distance * 0.72, z + distance, x, y, z],
      interior: [x + distance * 0.55, Math.max(1.6, y), z + distance * 0.55, x, Math.max(1.35, y), z],
      floor: [x, y + distance * 1.6, z, x, 0, z],
      ceiling: [x, Math.max(0.7, y - distance * 0.15), z, x, y + distance * 0.55, z],
      top: [x, y + distance * 1.6, z, x, y, z],
      front: [x, y + distance * 0.45, z + distance, x, y, z],
      back: [x, y + distance * 0.45, z - distance, x, y, z],
      left: [x - distance, y + distance * 0.45, z, x, y, z],
      right: [x + distance, y + distance * 0.45, z, x, y, z],
      isometric: [x + distance, y + distance, z + distance, x, y, z],
    };
    const [cameraX, cameraY, cameraZ, targetX, targetY, targetZ] = viewpoints[preset];
    requestCameraCommand(invalidate, () => controls.current.setLookAt(cameraX, cameraY, cameraZ, targetX, targetY, targetZ, false));
  }, [preset, presetRevision, invalidate]);

  return <CameraControls
    ref={controls}
    makeDefault
    smoothTime={0.25}
    draggingSmoothTime={0.125}
    dollyToCursor
    infinityDolly
    minDistance={Math.max(0.12, bounds.span * 0.01)}
    maxDistance={Infinity}
    minZoom={0.001}
    maxZoom={Infinity}
    boundaryFriction={0}
    boundaryEnclosesCamera
    colliderMeshes={NO_CAMERA_COLLIDERS}
    mouseButtons={mouseButtons}
    touches={touchActions}
    onChange={reportCameraRight}
  />;
}
