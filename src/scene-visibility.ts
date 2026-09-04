import type { NodeData } from "./types";

/**
 * Presentation-only, session-scoped object suppression for the plan canvas.
 * It deliberately never changes Pascal node data or evaluation inputs.
 */
export type SceneVisibilityCommand =
  | { kind: "hide"; nodeIds: string[] }
  | { kind: "restore-all"; nodeIds: string[] };

export type SceneVisibilityHistory = {
  hiddenNodeIds: string[];
  undoStack: SceneVisibilityCommand[];
  redoStack: SceneVisibilityCommand[];
};

const CANVAS_NODE_TYPES = new Set(["item", "shelf", "slab", "zone", "wall", "door", "window", "stair"]);

const unique = (nodeIds: readonly string[]) => [...new Set(nodeIds.filter(Boolean))];
const without = (source: readonly string[], removed: readonly string[]) => source.filter((id) => !removed.includes(id));
const withIds = (source: readonly string[], added: readonly string[]) => unique([...source, ...added]);

export const createSceneVisibilityHistory = (): SceneVisibilityHistory => ({ hiddenNodeIds: [], undoStack: [], redoStack: [] });

export const isHideableSceneNode = (node: NodeData | undefined | null): node is NodeData => Boolean(node && CANVAS_NODE_TYPES.has(node.type));

const commit = (history: SceneVisibilityHistory, command: SceneVisibilityCommand): SceneVisibilityHistory => ({
  hiddenNodeIds: command.kind === "hide" ? withIds(history.hiddenNodeIds, command.nodeIds) : without(history.hiddenNodeIds, command.nodeIds),
  undoStack: [...history.undoStack, command],
  redoStack: [],
});

export const hideSceneNode = (history: SceneVisibilityHistory, nodeId: string): SceneVisibilityHistory => {
  if (!nodeId || history.hiddenNodeIds.includes(nodeId)) return history;
  return commit(history, { kind: "hide", nodeIds: [nodeId] });
};

export const restoreAllSceneNodes = (history: SceneVisibilityHistory): SceneVisibilityHistory => {
  if (!history.hiddenNodeIds.length) return history;
  return commit(history, { kind: "restore-all", nodeIds: history.hiddenNodeIds });
};

export const undoSceneVisibility = (history: SceneVisibilityHistory): SceneVisibilityHistory => {
  const command = history.undoStack[history.undoStack.length - 1];
  if (!command) return history;
  return {
    hiddenNodeIds: command.kind === "hide" ? without(history.hiddenNodeIds, command.nodeIds) : withIds(history.hiddenNodeIds, command.nodeIds),
    undoStack: history.undoStack.slice(0, -1),
    redoStack: [...history.redoStack, command],
  };
};

export const redoSceneVisibility = (history: SceneVisibilityHistory): SceneVisibilityHistory => {
  const command = history.redoStack[history.redoStack.length - 1];
  if (!command) return history;
  return {
    hiddenNodeIds: command.kind === "hide" ? withIds(history.hiddenNodeIds, command.nodeIds) : without(history.hiddenNodeIds, command.nodeIds),
    undoStack: [...history.undoStack, command],
    redoStack: history.redoStack.slice(0, -1),
  };
};
