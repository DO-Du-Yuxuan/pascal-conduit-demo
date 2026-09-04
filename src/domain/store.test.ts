import { describe, expect, it } from "vitest";
import { createEmptyOverlay } from "./overlay";
import { useOverlayStore } from "./store";

describe("overlay history", () => {
  it("undoes and redoes atomic overlay commits", () => {
    const store = useOverlayStore.getState();
    store.load(createEmptyOverlay("a.json", "a"));
    const next = { ...useOverlayStore.getState().overlay!, segments: [{ id: "pipe", type: "conduit-segment" as const, system: "power" as const, diameterMm: 20, start: { position: [0, 0, 0] as [number, number, number] }, end: { position: [1, 0, 0] as [number, number, number] }, createdAt: "now" }] };
    useOverlayStore.getState().commit(next);
    expect(useOverlayStore.getState().overlay?.segments).toHaveLength(1);
    useOverlayStore.getState().undo();
    expect(useOverlayStore.getState().overlay?.segments).toHaveLength(0);
    useOverlayStore.getState().redo();
    expect(useOverlayStore.getState().overlay?.segments).toHaveLength(1);
  });
});
