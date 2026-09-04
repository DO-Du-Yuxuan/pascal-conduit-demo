import { create } from "zustand";
import type { ConduitOverlayDocument } from "./overlay";

type OverlayState = {
  overlay: ConduitOverlayDocument | null;
  undoStack: ConduitOverlayDocument[];
  redoStack: ConduitOverlayDocument[];
  load: (overlay: ConduitOverlayDocument) => void;
  commit: (next: ConduitOverlayDocument) => void;
  undo: () => void;
  redo: () => void;
};

const clone = (value: ConduitOverlayDocument) => structuredClone(value);

export const useOverlayStore = create<OverlayState>((set, get) => ({
  overlay: null,
  undoStack: [],
  redoStack: [],
  load: (overlay) => set({ overlay: clone(overlay), undoStack: [], redoStack: [] }),
  commit: (next) => {
    const current = get().overlay;
    set({ overlay: clone(next), undoStack: current ? [...get().undoStack, clone(current)] : get().undoStack, redoStack: [] });
  },
  undo: () => {
    const [previous, ...rest] = [...get().undoStack].reverse();
    const current = get().overlay;
    if (!previous || !current) return;
    set({ overlay: clone(previous), undoStack: rest.reverse(), redoStack: [...get().redoStack, clone(current)] });
  },
  redo: () => {
    const [next, ...rest] = [...get().redoStack].reverse();
    const current = get().overlay;
    if (!next || !current) return;
    set({ overlay: clone(next), redoStack: rest.reverse(), undoStack: [...get().undoStack, clone(current)] });
  },
}));
