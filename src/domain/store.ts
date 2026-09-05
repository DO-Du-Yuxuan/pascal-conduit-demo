import { create } from "zustand";
import type { ConduitOverlayDocument, NetworkDeviceType, RoutePoint, RoutingSystem, Vec3 } from "./overlay";
import type { PlannedRoute } from "./routing";

export type RoutePreviewSnapshot = {
  sourceSha: string;
  system: RoutingSystem;
  diameterMm: number;
  levelId: string | null;
  points: RoutePoint[];
  plan: PlannedRoute | null;
  branchNode?: { kind: "junction-box" | "tee"; position: Vec3; sizeMm: [number, number, number] };
  deviceNode?: { deviceType: NetworkDeviceType; position: RoutePoint; valid: boolean };
};

type OverlayState = {
  overlay: ConduitOverlayDocument | null;
  undoStack: ConduitOverlayDocument[];
  redoStack: ConduitOverlayDocument[];
  dirty: boolean;
  preview: RoutePreviewSnapshot | null;
  load: (overlay: ConduitOverlayDocument) => void;
  publish: (overlay: ConduitOverlayDocument, dirty: boolean) => void;
  markExported: () => void;
  commit: (next: ConduitOverlayDocument) => void;
  undo: () => void;
  redo: () => void;
  publishPreview: (preview: RoutePreviewSnapshot) => void;
  clearPreview: () => void;
};

const clone = (value: ConduitOverlayDocument) => structuredClone(value);

export const useOverlayStore = create<OverlayState>((set, get) => ({
  overlay: null,
  undoStack: [],
  redoStack: [],
  dirty: false,
  preview: null,
  // A newly loaded building or imported Overlay is already backed by a file.
  load: (overlay) => set({ overlay: clone(overlay), undoStack: [], redoStack: [], dirty: false, preview: null }),
  // 3D owns transient drawing state, while 2D consumes this shared snapshot.
  // Publishing must not reset history or silently mark local edits as exported.
  publish: (overlay, dirty) => set({ overlay: clone(overlay), dirty }),
  markExported: () => set({ dirty: false }),
  commit: (next) => {
    const current = get().overlay;
    set({ overlay: clone(next), undoStack: current ? [...get().undoStack, clone(current)] : get().undoStack, redoStack: [], dirty: true });
  },
  undo: () => {
    const [previous, ...rest] = [...get().undoStack].reverse();
    const current = get().overlay;
    if (!previous || !current) return;
    set({ overlay: clone(previous), undoStack: rest.reverse(), redoStack: [...get().redoStack, clone(current)], dirty: true });
  },
  redo: () => {
    const [next, ...rest] = [...get().redoStack].reverse();
    const current = get().overlay;
    if (!next || !current) return;
    set({ overlay: clone(next), redoStack: rest.reverse(), undoStack: [...get().undoStack, clone(current)], dirty: true });
  },
  // Preview is ephemeral UI state: no clone, history entry, dirty flag or export.
  publishPreview: (preview) => set({ preview }),
  clearPreview: () => set({ preview: null }),
}));
