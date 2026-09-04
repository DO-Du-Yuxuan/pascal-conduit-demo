import { describe, expect, it } from "vitest";
import completedLayout from "../../layout_2026-08-21-completed.json";
import bellevueDemo from "../../sample-data/Bellevue demo.json";
import { parseProject } from "../parser/parse";
import { buildThreeDSceneInput } from "./scene-input";

describe("buildThreeDSceneInput", () => {
  it("keeps Parser nodes immutable while preserving an explicit root", () => {
    const parsed: any = { raw: { rootNodeIds: ["site"] }, nodes: { site: { id: "site", type: "site", children: ["level"] }, level: { id: "level", type: "level", parentId: "site" } }, diagnostics: [] };
    const scene = buildThreeDSceneInput(parsed);
    scene.nodes.site.children.push("changed");
    expect(scene.rootNodeIds).toEqual(["site"]);
    expect(parsed.nodes.site.children).toEqual(["level"]);
  });

  it("derives roots only from parentless nodes and reports the assumption", () => {
    const scene = buildThreeDSceneInput({ raw: {}, nodes: { site: { id: "site", type: "site" }, orphan: { id: "orphan", type: "item", parentId: "missing" } } as any, diagnostics: [] });
    expect(scene.rootNodeIds).toEqual(["site"]);
    expect(scene.diagnostics).toContainEqual(expect.objectContaining({ code: "derived_scene_root" }));
  });

  it("does not invent roof data", () => {
    const scene = buildThreeDSceneInput({ raw: { rootNodeIds: ["site"] }, nodes: { site: { id: "site", type: "site" } } as any, diagnostics: [] });
    expect(scene.hasRoofData).toBe(false);
    expect(scene.diagnostics).toContainEqual(expect.objectContaining({ code: "missing_roof_data" }));
  });

  it("keeps the completed layout's interior, ceiling and furniture input while reporting its missing roof", () => {
    const scene = buildThreeDSceneInput(parseProject(completedLayout));
    expect(Object.values(scene.nodes).some((node) => node.type === "ceiling")).toBe(true);
    expect(scene.itemCount).toBeGreaterThan(0);
    expect(scene.hasRoofData).toBe(false);
  });

  it("accepts Bellevue's multi-level roof and stair data for stacked or exploded presentation", () => {
    const scene = buildThreeDSceneInput(parseProject(bellevueDemo));
    expect(Object.values(scene.nodes).filter((node) => node.type === "level")).toHaveLength(2);
    expect(Object.values(scene.nodes).some((node) => node.type === "stair" || node.type === "stair-segment")).toBe(true);
    expect(scene.hasRoofData).toBe(true);
  });
});
