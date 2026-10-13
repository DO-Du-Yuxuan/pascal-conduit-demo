import { describe, expect, it } from "vitest";
import { createSceneVisibilityHistory, sourceNodeIsVisible, hideSceneNode, restoreSceneNode, isHideableSceneNode, redoSceneVisibility, restoreAllSceneNodes, undoSceneVisibility } from "./scene-visibility";

describe("session-scoped canvas object visibility", () => {
  it("restores one node without exposing other hidden nodes and preserves undo/redo", () => {
    const hidden = hideSceneNode(hideSceneNode(createSceneVisibilityHistory(), "chair"), "wall");
    const restored = restoreSceneNode(hidden, "chair");
    expect(restored.hiddenNodeIds).toEqual(["wall"]);
    expect(undoSceneVisibility(restored).hiddenNodeIds).toEqual(["wall", "chair"]);
    expect(redoSceneVisibility(undoSceneVisibility(restored)).hiddenNodeIds).toEqual(["wall"]);
    expect(restoreSceneNode(restored, "chair")).toBe(restored);
  });
  it("honors saved ancestor visibility without rewriting imported objects", () => {
    const nodes = { parent: { id: "parent", type: "wall", visible: false }, child: { id: "child", type: "window", parentId: "parent", visible: true } };
    const before = JSON.stringify(nodes);
    expect(sourceNodeIsVisible("child", nodes)).toBe(false);
    expect(JSON.stringify(nodes)).toBe(before);
    expect(sourceNodeIsVisible("child", { ...nodes, parent: { ...nodes.parent, visible: true } })).toBe(true);
  });
  it("hides only the requested canvas node without changing its source object", () => {
    const source = { id: "chair", type: "item", name: "Chair" }, state = hideSceneNode(createSceneVisibilityHistory(), source.id);
    expect(state.hiddenNodeIds).toEqual(["chair"]);
    expect(source).toEqual({ id: "chair", type: "item", name: "Chair" });
  });

  it("keeps only actually rendered node types eligible for hiding", () => {
    expect(isHideableSceneNode({ id: "door", type: "door" })).toBe(true);
    expect(isHideableSceneNode({ id: "shelf", type: "shelf" })).toBe(true);
    expect(isHideableSceneNode({ id: "level", type: "level" })).toBe(false);
  });

  it("undoes and redoes individual hides in command order", () => {
    const hidden = hideSceneNode(hideSceneNode(createSceneVisibilityHistory(), "chair"), "table");
    const undone = undoSceneVisibility(hidden), redone = redoSceneVisibility(undone);
    expect(undone.hiddenNodeIds).toEqual(["chair"]);
    expect(redone.hiddenNodeIds).toEqual(["chair", "table"]);
  });

  it("restores all hidden nodes and makes that reset undoable", () => {
    const hidden = hideSceneNode(hideSceneNode(createSceneVisibilityHistory(), "chair"), "wall");
    const restored = restoreAllSceneNodes(hidden);
    expect(restored.hiddenNodeIds).toEqual([]);
    expect(undoSceneVisibility(restored).hiddenNodeIds).toEqual(["chair", "wall"]);
  });

  it("clears redo history after a new hide command", () => {
    const hidden = hideSceneNode(createSceneVisibilityHistory(), "chair");
    const undone = undoSceneVisibility(hidden);
    const next = hideSceneNode(undone, "table");
    expect(next.redoStack).toEqual([]);
    expect(redoSceneVisibility(next)).toBe(next);
  });
});
