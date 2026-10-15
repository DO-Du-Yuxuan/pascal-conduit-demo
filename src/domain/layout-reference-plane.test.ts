import { describe, expect, it } from "vitest";
import type { NodeData } from "../types";
import { createEmptyOverlay, parseOverlay } from "./overlay";
import { defaultLayoutReferencePlane, layoutReferencePlaneFor, replaceLayoutReferencePlane } from "./layout-reference-plane";
import { createReferencePlaneDevice } from "./devices";

const nodes = {
  level: { id: "level", type: "level", level: 0 },
  small: { id: "small", type: "ceiling", parentId: "level", height: 2.4, polygon: [[0, 0], [2, 0], [2, 2], [0, 2]] },
  large: { id: "large", type: "ceiling", parentId: "level", height: 2.8, polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] },
} as Record<string, NodeData>;

describe("Layout reference plane", () => {
  it("uses the largest valid Ceiling, then an identified 2700 mm fallback", () => {
    expect(defaultLayoutReferencePlane(nodes, "level")).toEqual({ levelId: "level", visible: true, elevationMm: 2800, basis: "largest-area-ceiling", sourceCeilingId: "large" });
    expect(defaultLayoutReferencePlane({ level: nodes.level }, "level")).toEqual({ levelId: "level", visible: true, elevationMm: 2700, basis: "derived-default-2700mm" });
  });

  it("preserves explicit per-Level edits through Overlay migration and export", () => {
    const base = createEmptyOverlay("source.json", "sha");
    const explicit = { levelId: "level", visible: false, elevationMm: 3150, basis: "explicit" as const };
    const overlay = { ...base, layoutReferencePlanes: replaceLayoutReferencePlane(base.layoutReferencePlanes, explicit) };
    expect(layoutReferencePlaneFor(nodes, overlay.layoutReferencePlanes, "level")).toEqual(explicit);
    expect(parseOverlay(JSON.parse(JSON.stringify(overlay))).layoutReferencePlanes).toEqual([explicit]);
    const legacy = { ...overlay } as Record<string, unknown>;
    delete legacy.layoutReferencePlanes;
    expect(parseOverlay(legacy).layoutReferencePlanes).toEqual([]);
  });

  it("uses the rendered Ceiling underside when source heights are omitted, without changing source nodes", () => {
    const source = structuredClone(nodes);
    source.level!.height = 2.5;
    delete source.large!.height;
    delete source.small!.height;
    const before = structuredClone(source);
    expect(defaultLayoutReferencePlane(source, "level")).toMatchObject({ elevationMm: 2490, basis: "largest-area-ceiling", sourceCeilingId: "large" });
    source.level!.height = 4.2;
    expect(defaultLayoutReferencePlane(source, "level").elevationMm).toBeCloseTo(4190);
    source.level!.height = 2.5;
    expect(source).toEqual(before);
  });

  it("follows overlapping slab undersides and the Builder default when no Level height is stored", () => {
    const source = structuredClone(nodes);
    delete source.large!.height;
    expect(defaultLayoutReferencePlane(source, "level").elevationMm).toBe(2500);
    source.level!.height = 2.5;
    source.slab = { id: "slab", type: "slab", parentId: "level", polygon: source.large!.polygon, elevation: 0, thickness: 0.2 };
    expect(defaultLayoutReferencePlane(source, "level").elevationMm).toBeCloseTo(2290);
    source.large!.height = 2.8;
    expect(defaultLayoutReferencePlane(source, "level").elevationMm).toBe(2800);
  });

  it("keeps eligible point mounts distinct and stable while a shared plane changes", () => {
    const base = createEmptyOverlay("source.json", "sha"), first = { levelId: "level", visible: true, elevationMm: 2800, basis: "largest-area-ceiling" as const, sourceCeilingId: "large" };
    const device = createReferencePlaneDevice("luminaire", [1, 2.8, 1], "level", first.elevationMm);
    const placed = { ...base, layoutReferencePlanes: [first], devices: [device] };
    const edited = { ...placed, layoutReferencePlanes: replaceLayoutReferencePlane(placed.layoutReferencePlanes, { levelId: "level", visible: false, elevationMm: 3150, basis: "explicit" }) };
    expect(edited.devices[0]).toMatchObject({ position: { position: [1, 2.8, 1] }, mount: { kind: "reference-plane", levelId: "level", elevationMm: 2800 } });
    expect(parseOverlay(JSON.parse(JSON.stringify(edited))).devices[0]?.mount).toMatchObject({ kind: "reference-plane", levelId: "level", elevationMm: 2800 });
  });

  it("gives every reference-plane point a downward display normal without inventing a Ceiling host", () => {
    for (const type of ["luminaire", "sprinkler-head", "sensor"] as const) {
      const device = createReferencePlaneDevice(type, [1, 2.8, 1], "level", 2800);
      expect(device).toMatchObject({ orientation: [0, -1, 0], frame: { front: [0, -1, 0] }, position: { position: [1, 2.8, 1] } });
      expect(device.position.attachment).toBeUndefined();
    }
  });
});
