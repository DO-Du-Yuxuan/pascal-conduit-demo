import { create } from "zustand";
import type { ConduitOverlayDocument } from "./overlay";

type OverlayState = {
  overlay: ConduitOverlayDocument | null;
  undoStack: ConduitOverlayDocument[];
  redoStack: ConduitOverlayDocument[];
  dirty: boolean;
  load: (overlay: ConduitOverlayDocument) => void;
  publish: (overlay: ConduitOverlayDocument, dirty: boolean) => void;
  markExported: () => void;
  commit: (next: ConduitOverlayDocument) => void;
  undo: () => void;
  redo: () => void;
};

const clone = (value: ConduitOverlayDocument) => structuredClone(value);

export const useOverlayStore = create<OverlayState>((set, get) => ({
  overlay: null,
  undoStack: [],
  redoStack: [],
  dirty: false,
  // A newly loaded building or imported Overlay is already backed by a file.
  load: (overlay) => set({ overlay: clone(overlay), undoStack: [], redoStack: [], dirty: false }),
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
}));
