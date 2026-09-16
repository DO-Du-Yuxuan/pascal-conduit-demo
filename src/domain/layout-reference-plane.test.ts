import { describe, expect, it } from "vitest";
import type { NodeData } from "../types";
import { createEmptyOverlay, parseOverlay } from "./overlay";
import { defaultLayoutReferencePlane, layoutReferencePlaneFor, replaceLayoutReferencePlane } from "./layout-reference-plane";

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
});
