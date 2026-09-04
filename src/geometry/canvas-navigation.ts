import { type ViewBox, zoomViewBoxAtPoint } from "./transform";

export type CanvasWheelGesture = "zoom" | "pan";

const LINE_HEIGHT_PX = 16;
const MIN_VIEWBOX_SPAN = .25;
const MAX_VIEWBOX_SPAN = 1_000;
export const DEFAULT_WHEEL_ZOOM_SENSITIVITY = .0015;
export const TRACKPAD_PINCH_ZOOM_SENSITIVITY = .006;
export const SAFARI_GESTURE_ZOOM_EXPONENT = 3.2;

export function canvasWheelGesture({ deltaX, deltaY, deltaMode, ctrlKey }: Pick<WheelEvent, "deltaX" | "deltaY" | "deltaMode" | "ctrlKey">): CanvasWheelGesture {
  void deltaMode;
  void ctrlKey;
  return Math.abs(deltaY) > 0 || deltaX === 0 ? "zoom" : "pan";
}

export function canvasWheelZoomFactor(deltaY: number, deltaMode: number, viewportHeight: number, sensitivity = DEFAULT_WHEEL_ZOOM_SENSITIVITY): number {
  const pixelDelta = deltaMode === 1 ? deltaY * LINE_HEIGHT_PX : deltaMode === 2 ? deltaY * viewportHeight : deltaY;
  return Math.exp(Math.max(-.22, Math.min(.22, pixelDelta * sensitivity)));
}

export function zoomCanvasViewBox(viewBox: ViewBox, point: { x: number; z: number }, requestedFactor: number): ViewBox {
  const minFactor = MIN_VIEWBOX_SPAN / Math.min(viewBox.width, viewBox.height), maxFactor = MAX_VIEWBOX_SPAN / Math.max(viewBox.width, viewBox.height);
  return zoomViewBoxAtPoint(viewBox, point, Math.max(minFactor, Math.min(maxFactor, requestedFactor)));
}
