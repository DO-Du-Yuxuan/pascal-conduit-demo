import { describe, expect, it } from "vitest";
import { createEmptyOverlay } from "./overlay";
import { useOverlayStore } from "./store";

describe("overlay history", () => {
  it("undoes and redoes atomic overlay commits", () => {
    const store = useOverlayStore.getState();
    store.load(createEmptyOverlay("a.json", "a"));
    const next = { ...useOverlayStore.getState().overlay!, segments: [{ id: "pipe", type: "conduit-segment" as const, system: "receptacle" as const, diameterMm: 20, start: { position: [0, 0, 0] as [number, number, number] }, end: { position: [1, 0, 0] as [number, number, number] }, createdAt: "now" }] };
    useOverlayStore.getState().commit(next);
    expect(useOverlayStore.getState().overlay?.segments).toHaveLength(1);
    expect(useOverlayStore.getState().dirty).toBe(true);
    useOverlayStore.getState().undo();
    expect(useOverlayStore.getState().overlay?.segments).toHaveLength(0);
    useOverlayStore.getState().redo();
    expect(useOverlayStore.getState().overlay?.segments).toHaveLength(1);
  });

  it("keeps shared snapshots dirty until the Overlay is exported", () => {
    const overlay = createEmptyOverlay("a.json", "a");
    useOverlayStore.getState().load(overlay);
    useOverlayStore.getState().publish({ ...overlay, settings: { ...overlay.settings, visibleSystems: { ...overlay.settings.visibleSystems, receptacle: false } } }, true);
    expect(useOverlayStore.getState().dirty).toBe(true);
    useOverlayStore.getState().markExported();
    expect(useOverlayStore.getState().dirty).toBe(false);
  });

  it("publishes a transient route preview without changing Overlay history", () => {
    const overlay = createEmptyOverlay("a.json", "a");
    useOverlayStore.getState().load(overlay);
    useOverlayStore.getState().publishPreview({ sourceSha: "a", system: "receptacle", diameterMm: 20, levelId: "L0", points: [{ position: [0, 0, 0] }, { position: [1, 0, 0] }], plan: null });
    expect(useOverlayStore.getState().preview?.points).toHaveLength(2);
    expect(useOverlayStore.getState().dirty).toBe(false);
    expect(useOverlayStore.getState().undoStack).toHaveLength(0);
    useOverlayStore.getState().load(overlay);
    expect(useOverlayStore.getState().preview).toBeNull();
  });
});
