import { CameraControlsImpl } from "@react-three/drei";
import { Matrix4, Mesh, PerspectiveCamera, Ray, Raycaster, Vector2, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";
import { builderOrbitAzimuth, cameraMouseButtons, builderCanvasEvents, isBuilderNavigationEvent, requestCameraCommand, setNavigationKeyboardEnabled, setSpacePanKeyboardActive, shouldEnableSpacePan } from "./camera-navigation";

describe("3D camera wheel navigation", () => {
  it("filters legacy mouse clicks after Space pan without swallowing the next selection", () => {
    setNavigationKeyboardEnabled(true); setSpacePanKeyboardActive(true);
    expect(isBuilderNavigationEvent(Object.assign(new Event("pointerdown"), { button: 0, pointerId: 21 }))).toBe(true);
    setSpacePanKeyboardActive(false);
    expect(isBuilderNavigationEvent(Object.assign(new Event("pointerup"), { button: 0, pointerId: 21 }))).toBe(true);
    expect(isBuilderNavigationEvent(Object.assign(new Event("click"), { button: 0 }))).toBe(true);
    expect(isBuilderNavigationEvent(Object.assign(new Event("pointerdown"), { button: 0, pointerId: 21 }))).toBe(false);
    expect(isBuilderNavigationEvent(Object.assign(new Event("click"), { button: 0, pointerId: 21 }))).toBe(false);
    setSpacePanKeyboardActive(true);
    isBuilderNavigationEvent(Object.assign(new Event("pointerdown"), { button: 0, pointerId: 21 }));
    isBuilderNavigationEvent(Object.assign(new Event("pointerup"), { button: 0, pointerId: 21 }));
    setSpacePanKeyboardActive(false);
    // Pointer capture can finish outside the canvas, with no following click.
    expect(isBuilderNavigationEvent(Object.assign(new Event("pointerdown"), { button: 0, pointerId: 21 }))).toBe(false);
    expect(isBuilderNavigationEvent(Object.assign(new Event("click"), { button: 0, pointerId: 21 }))).toBe(false);
    setNavigationKeyboardEnabled(false); setNavigationKeyboardEnabled(true);
  });
  it("orbits by Builder's nearest-cardinal quarter turn in both directions", () => {
    expect(builderOrbitAzimuth(Math.PI / 3, "cw")).toBeCloseTo(0);
    expect(builderOrbitAzimuth(Math.PI / 3, "ccw")).toBeCloseTo(Math.PI);
    expect(builderOrbitAzimuth(-Math.PI / 2, "cw")).toBeCloseTo(-Math.PI);
  });
  it("invalidates demand rendering before imperative camera commands", () => {
    const order: string[] = [];
    requestCameraCommand(() => order.push("invalidate"), () => order.push("set-look-at"));
    expect(order).toEqual(["invalidate", "set-look-at"]);
  });
  it("uses zoom instead of dolly for an orthographic camera", () => {
    expect(cameraMouseButtons("perspective").wheel).toBe(CameraControlsImpl.ACTION.DOLLY);
    expect(cameraMouseButtons("orthographic").wheel).toBe(CameraControlsImpl.ACTION.ZOOM);
  });

  it("matches Builder mouse gestures and enables left pan only while Space is held", () => {
    const idle = cameraMouseButtons("perspective");
    expect(idle.left).toBe(CameraControlsImpl.ACTION.NONE);
    expect(idle.middle).toBe(CameraControlsImpl.ACTION.SCREEN_PAN);
    expect(idle.right).toBe(CameraControlsImpl.ACTION.ROTATE);
    expect(cameraMouseButtons("perspective", true).left).toBe(CameraControlsImpl.ACTION.SCREEN_PAN);
  });

  it("protects editable focus from Space panning", () => {
    const input = { tagName: "INPUT", isContentEditable: false, closest: () => null };
    const editor = { tagName: "DIV", isContentEditable: true, closest: () => null };
    const canvas = { tagName: "CANVAS", isContentEditable: false, closest: () => null };
    const button = { tagName: "BUTTON", isContentEditable: false, closest: () => null };
    expect(shouldEnableSpacePan(input)).toBe(false);
    expect(shouldEnableSpacePan(editor)).toBe(false);
    expect(shouldEnableSpacePan({ tagName: "SPAN", isContentEditable: false, closest: () => ({ tagName: "INPUT" }) as unknown as Element })).toBe(false);
    expect(shouldEnableSpacePan(button)).toBe(true);
    expect(shouldEnableSpacePan(canvas)).toBe(true);
    expect(shouldEnableSpacePan(null)).toBe(true);
  });

  it("suppresses scene picking during camera pointer gestures while keeping ordinary hover", () => {
    setNavigationKeyboardEnabled(true);
    setSpacePanKeyboardActive(false);
    const hover = Object.assign(new Event("pointermove"), { buttons: 0, pointerId: 1 });
    expect(isBuilderNavigationEvent(hover)).toBe(false);
    setSpacePanKeyboardActive(true);
    const down = Object.assign(new Event("pointerdown"), { button: 0, pointerId: 1 });
    expect(isBuilderNavigationEvent(down)).toBe(true);
    setSpacePanKeyboardActive(false);
    const move = Object.assign(new Event("pointermove"), { buttons: 1, pointerId: 1 });
    expect(isBuilderNavigationEvent(move)).toBe(true);
    const up = Object.assign(new Event("pointerup"), { button: 0, pointerId: 1 });
    expect(isBuilderNavigationEvent(up)).toBe(true);
    const click = Object.assign(new Event("click"), { button: 0, pointerId: 1 });
    expect(isBuilderNavigationEvent(click)).toBe(true);
    expect(isBuilderNavigationEvent(Object.assign(new Event("pointerdown"), { button: 1, pointerId: 2 }))).toBe(true);
    expect(isBuilderNavigationEvent(Object.assign(new Event("pointerdown"), { button: 2, pointerId: 3 }))).toBe(true);
    setNavigationKeyboardEnabled(false);
    setNavigationKeyboardEnabled(true);
  });

  it("skips R3F scene dispatch for navigation and still reports an ordinary missed click", () => {
    const onPointerMissed = vi.fn();
    let state: Record<string, any>;
    const eventObject = { __r3f: { handlers: { onPointerMissed }, root: { getState: () => state } } };
    state = {
      internal: { interaction: [eventObject], initialClick: [0, 0], initialHits: [], hovered: new Map(), capturedMap: new Map(), lastEvent: { current: null } },
      pointer: { set: vi.fn() },
      raycaster: { camera: undefined, setFromCamera: vi.fn(), intersectObject: vi.fn() },
      onPointerMissed: undefined,
      events: undefined as unknown,
    };
    const store = { getState: () => state, setState: vi.fn() } as never;
    const manager = builderCanvasEvents(store);
    manager.compute = vi.fn();
    state.events = manager;

    setNavigationKeyboardEnabled(true);
    setSpacePanKeyboardActive(true);
    manager.handlers!.onPointerDown(Object.assign(new Event("pointerdown"), { button: 0, pointerId: 7, offsetX: 5, offsetY: 5 }));
    setSpacePanKeyboardActive(false);
    manager.handlers!.onPointerUp(Object.assign(new Event("pointerup"), { button: 0, pointerId: 7, offsetX: 5, offsetY: 5 }));
    manager.handlers!.onClick(Object.assign(new Event("click"), { button: 0, pointerId: 7, offsetX: 5, offsetY: 5 }));
    expect(onPointerMissed).not.toHaveBeenCalled();

    manager.handlers!.onPointerDown(Object.assign(new Event("pointerdown"), { button: 0, pointerId: 8, offsetX: 5, offsetY: 5 }));
    manager.handlers!.onClick(Object.assign(new Event("click"), { button: 0, pointerId: 8, offsetX: 5, offsetY: 5 }));
    expect(onPointerMissed).toHaveBeenCalledTimes(1);

    setNavigationKeyboardEnabled(false);
    setSpacePanKeyboardActive(true);
    manager.handlers!.onPointerDown(Object.assign(new Event("pointerdown"), { button: 0, pointerId: 9, offsetX: 5, offsetY: 5 }));
    manager.handlers!.onClick(Object.assign(new Event("click"), { button: 0, pointerId: 9, offsetX: 5, offsetY: 5 }));
    expect(onPointerMissed).toHaveBeenCalledTimes(2);
    setNavigationKeyboardEnabled(true);
  });

  it("converts R3F hit points and rays once after world-space raycasting, then restores the ray", () => {
    const worldOrigin = new Vector3(13, 7, 4);
    const worldDirection = new Vector3(0, 0, -1);
    const originalHitPoint = new Vector3(13, 7, 3);
    const observed: { point?: Vector3; ray?: Ray } = {};
    let state: Record<string, any>;
    const mesh = new Mesh();
    (mesh as Mesh & { __r3f?: any }).__r3f = { eventCount: 1, handlers: { onClick: (event: any) => { observed.point = event.point.clone(); observed.ray = event.ray.clone(); } }, root: { getState: () => state } };
    const rawHit = { object: mesh, point: originalHitPoint, distance: 1 };
    const raycaster = new Raycaster();
    raycaster.setFromCamera = vi.fn((_pointer, activeCamera) => {
      raycaster.camera = activeCamera;
      raycaster.ray.set(worldOrigin, worldDirection);
    });
    raycaster.intersectObject = vi.fn(() => [rawHit as any]);
    const camera = new PerspectiveCamera();
    camera.updateMatrixWorld();
    state = {
      internal: { interaction: [mesh], initialClick: [5, 5], initialHits: [mesh], hovered: new Map(), capturedMap: new Map(), lastEvent: { current: null } },
      pointer: new Vector2(),
      raycaster,
      camera,
      previousRoot: null,
      onPointerMissed: undefined,
      events: undefined as unknown,
    };
    const store = { getState: () => state, setState: vi.fn() } as never;
    const worldToEditing = new Matrix4().makeTranslation(-10, -2, -1);
    const manager = builderCanvasEvents(store, worldToEditing);
    manager.compute = vi.fn((_event: any, current: any) => {
      current.pointer.set(0, 0);
      current.raycaster.setFromCamera(current.pointer, current.camera);
    });
    state.events = manager;

    manager.handlers!.onClick(Object.assign(new Event("click"), { button: 0, pointerId: 14, offsetX: 5, offsetY: 5 }));

    expect(manager.compute).toHaveBeenCalled();
    expect(raycaster.intersectObject).toHaveBeenCalledWith(mesh, true);
    expect(observed.point?.toArray()).toEqual([3, 5, 2]);
    expect(observed.ray?.origin.toArray()).toEqual([3, 5, 3]);
    expect(observed.ray?.direction.toArray()).toEqual([0, 0, -1]);
    expect(originalHitPoint.toArray()).toEqual([13, 7, 3]);
    expect(raycaster.ray.origin.toArray()).toEqual([13, 7, 4]);
  });

  it("filters the native double-click that follows a navigation click sequence", () => {
    setNavigationKeyboardEnabled(true);
    setSpacePanKeyboardActive(true);
    const navClick = (pointerId: number) => {
      isBuilderNavigationEvent(Object.assign(new Event("pointerdown"), { button: 0, pointerId }));
      setSpacePanKeyboardActive(false);
      isBuilderNavigationEvent(Object.assign(new Event("pointerup"), { button: 0, pointerId }));
      expect(isBuilderNavigationEvent(Object.assign(new Event("click"), { button: 0, pointerId }))).toBe(true);
      setSpacePanKeyboardActive(true);
    };
    navClick(31);
    navClick(32);
    setSpacePanKeyboardActive(false);
    expect(isBuilderNavigationEvent(Object.assign(new Event("dblclick"), { button: 0 }))).toBe(true);
    expect(isBuilderNavigationEvent(Object.assign(new Event("pointerdown"), { button: 0, pointerId: 33 }))).toBe(false);
    expect(isBuilderNavigationEvent(Object.assign(new Event("click"), { button: 0, pointerId: 33 }))).toBe(false);
    setNavigationKeyboardEnabled(false);
    setNavigationKeyboardEnabled(true);
  });
});
