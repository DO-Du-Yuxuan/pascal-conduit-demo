import { describe, expect, it } from "vitest";
import { createSceneVisibilityHistory, hideSceneNode, isHideableSceneNode, redoSceneVisibility, restoreAllSceneNodes, undoSceneVisibility } from "./scene-visibility";

describe("session-scoped canvas object visibility", () => {
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
