import { events, type RootStore } from "@react-three/fiber";
import { CameraControlsImpl } from "@react-three/drei";
import { Matrix4, Vector3, type Ray } from "three";

export type CameraProjection = "perspective" | "orthographic";

/** Builder rotates from the nearest cardinal azimuth, preserving orbit height. */
export function builderOrbitAzimuth(current: number, direction: "cw" | "ccw"): number {
  const quarterTurn = Math.PI / 2;
  return (Math.round(current / quarterTurn) + (direction === "cw" ? -1 : 1)) * quarterTurn;
}

/** Schedule the first frame before issuing imperative camera commands in demand mode. */
export function requestCameraCommand(invalidate: () => void, command: () => unknown): void {
  invalidate();
  void command();
}

export function cameraMouseButtons(projection: CameraProjection, spacePan = false) {
  return {
    left: spacePan ? CameraControlsImpl.ACTION.SCREEN_PAN : CameraControlsImpl.ACTION.NONE,
    middle: CameraControlsImpl.ACTION.SCREEN_PAN,
    right: CameraControlsImpl.ACTION.ROTATE,
    wheel: projection === "orthographic" ? CameraControlsImpl.ACTION.ZOOM : CameraControlsImpl.ACTION.DOLLY,
  };
}

export type NavigationKeyTarget = Pick<HTMLElement, "tagName" | "isContentEditable" | "closest"> | null;

export const SPACE_PAN_NAVIGATION_EVENT = "__pascalBuilderSpacePanNavigation";

export function isSpacePanNavigationEvent(event: Event): boolean {
  return (event as Event & { [SPACE_PAN_NAVIGATION_EVENT]?: boolean })[SPACE_PAN_NAVIGATION_EVENT] === true;
}

let spacePanKeyboardActive = false;
let navigationKeyboardEnabled = true;
const navigationPointerIds = new Set<number>();
const navigationClickPointerIds = new Set<number>();
let lastNavigationLeftClickAt = 0;
const NAVIGATION_DOUBLE_CLICK_WINDOW_MS = 500;

export function clearBuilderNavigationTracking(): void {
  navigationPointerIds.clear();
  navigationClickPointerIds.clear();
  lastNavigationLeftClickAt = 0;
}

export function setNavigationKeyboardEnabled(enabled: boolean): void {
  navigationKeyboardEnabled = enabled;
  if (!enabled) {
    setSpacePanKeyboardActive(false);
    clearBuilderNavigationTracking();
  }
}

export function setSpacePanKeyboardActive(active: boolean): void {
  spacePanKeyboardActive = navigationKeyboardEnabled && active;
}

/** True for pointer sequences consumed by camera navigation, false for hover. */
export function isBuilderNavigationEvent(event: Event): boolean {
  if (isSpacePanNavigationEvent(event)) return true;
  const pointer = event as Event & { button?: number; buttons?: number; pointerId?: number };
  const type = event.type;
  const pointerId = pointer.pointerId;
  if (type === "pointerdown" && (pointer.button === 1 || pointer.button === 2 || (spacePanKeyboardActive && pointer.button === 0))) {
    if (pointerId !== undefined) navigationPointerIds.add(pointerId);
    (event as Event & { [SPACE_PAN_NAVIGATION_EVENT]?: boolean })[SPACE_PAN_NAVIGATION_EVENT] = true;
    return true;
  }
  if (type === "pointerdown" && pointerId !== undefined) {
    // A new ordinary gesture proves an earlier navigation click will not arrive.
    navigationClickPointerIds.delete(pointerId);
  }
  if (pointerId !== undefined && navigationPointerIds.has(pointerId)) {
    (event as Event & { [SPACE_PAN_NAVIGATION_EVENT]?: boolean })[SPACE_PAN_NAVIGATION_EVENT] = true;
    if (type === "pointerup" || type === "pointercancel") {
      navigationPointerIds.delete(pointerId);
      if (type === "pointerup" && pointer.button === 0) navigationClickPointerIds.add(pointerId);
    }
    return true;
  }
  if (type === "pointermove" && ((pointer.buttons ?? 0) & 6) !== 0) {
    (event as Event & { [SPACE_PAN_NAVIGATION_EVENT]?: boolean })[SPACE_PAN_NAVIGATION_EVENT] = true;
    return true;
  }
  if (type === "dblclick" && lastNavigationLeftClickAt > 0 && Date.now() - lastNavigationLeftClickAt <= NAVIGATION_DOUBLE_CLICK_WINDOW_MS) {
    lastNavigationLeftClickAt = 0;
    (event as Event & { [SPACE_PAN_NAVIGATION_EVENT]?: boolean })[SPACE_PAN_NAVIGATION_EVENT] = true;
    return true;
  }
  if ((type === "click" || type === "auxclick") && (pointer.button === 1 || pointer.button === 2 || (pointerId !== undefined ? navigationClickPointerIds.delete(pointerId) : navigationClickPointerIds.size > 0))) {
    if (type === "click" && pointer.button === 0) lastNavigationLeftClickAt = Date.now();
    if (pointerId === undefined) navigationClickPointerIds.clear();
    (event as Event & { [SPACE_PAN_NAVIGATION_EVENT]?: boolean })[SPACE_PAN_NAVIGATION_EVENT] = true;
    return true;
  }
  if (type === "contextmenu" && pointer.button === 2) {
    navigationClickPointerIds.clear();
    (event as Event & { [SPACE_PAN_NAVIGATION_EVENT]?: boolean })[SPACE_PAN_NAVIGATION_EVENT] = true;
    return true;
  }
  return false;
}

/** Preserve CameraControls DOM input while preventing the same gesture from ray-picking scene objects. */
export function builderCanvasEvents(store: RootStore, worldToEditing?: Matrix4) {
  const manager = events(store);
  const originalFilter = manager.filter;
  let eventRay: Ray | null = null;
  let restoreRay: Ray | null = null;
  let rayWasTransformed = false;
  if (worldToEditing) {
    manager.filter = ((items, state) => {
      const filtered = originalFilter ? originalFilter(items, state) : items;
      if (!eventRay || rayWasTransformed) return filtered;
      rayWasTransformed = true;
      const ray = state.raycaster.ray;
      restoreRay = ray.clone();
      ray.origin.applyMatrix4(worldToEditing);
      ray.direction.transformDirection(worldToEditing);
      return filtered.map((item) => ({ ...item, point: item.point.clone().applyMatrix4(worldToEditing) }));
    }) as typeof manager.filter;
  }
  const handlerNames = ["onPointerDown", "onPointerMove", "onPointerUp", "onPointerCancel", "onClick", "onDoubleClick", "onContextMenu", "onWheel"] as const;
  for (const name of handlerNames) {
    const original = manager.handlers?.[name];
    if (!original || !manager.handlers) continue;
    manager.handlers[name] = ((event: Event) => {
      if (isBuilderNavigationEvent(event)) return;
      if (!worldToEditing) return original(event);
      const ray = store.getState().raycaster.ray;
      const previousRay = ray.clone();
      eventRay = ray;
      restoreRay = previousRay;
      rayWasTransformed = false;
      try {
        return original(event);
      } finally {
        ray.copy(restoreRay ?? previousRay);
        eventRay = null;
        restoreRay = null;
        rayWasTransformed = false;
      }
    }) as typeof original;
  }
  return manager;
}

/** Space pans only when focus is outside text-entry controls. */
export function shouldEnableSpacePan(target: NavigationKeyTarget): boolean {
  if (!target) return true;
  if (typeof target.tagName !== "string") return true;
  if (target.isContentEditable) return false;
  if (["INPUT", "TEXTAREA", "SELECT", "OPTION"].includes(target.tagName.toUpperCase())) return false;
  return !target.closest('input, textarea, select, option, [contenteditable=""], [contenteditable="true"], [role="textbox"]');
}
