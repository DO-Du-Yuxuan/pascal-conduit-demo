import { NodeData } from "../types";
import {
  finalDimensions,
  resolveItemPlanTransform,
  resolveWallOpeningTransform,
} from "../geometry/transform";
import {
  hasValidShelfFootprint,
  resolveShelfPlanTransform,
} from "../geometry/shelf";
import { buildSlabPlanGeometry } from "../geometry/slab";
import { hasStairPlanGeometry } from "../geometry/stairs";
export type RenderStrategy = "self" | "parent-emitted" | "intentionally-hidden" | "hidden-by-layer-toggle";
export type RenderRecord = {
  nodeId: string;
  kind: string;
  variant?: string;
  emittedByNodeId?: string;
  renderStrategy: RenderStrategy;
};
export class RenderedNodeRegistry {
  private records = new Map<string, RenderRecord>();
  register(record: RenderRecord) {
    this.records.set(record.nodeId, record);
  }
  get(nodeId: string) {
    return this.records.get(nodeId);
  }
  all() {
    return [...this.records.values()];
  }
}
const variant = (node: NodeData) =>
  node.type === "stair"
    ? node.stairType
    : node.type === "door"
      ? node.doorType
      : node.type === "window"
        ? node.windowType
        : node.type === "shelf"
          ? node.style
          : undefined;
/** Mirrors current Plan dispatch conditions; it does not build or alter SVG geometry. */
export function collectCurrentRenderRegistry(nodes: Record<string, NodeData>, visibility: { slabs?: boolean; stairs?: boolean } = {}) {
  const registry = new RenderedNodeRegistry();
  for (const node of Object.values(nodes)) {
    if (
      ["site", "building", "level", "scan", "guide", "spawn"].includes(
        node.type,
      )
    ) {
      registry.register({
        nodeId: node.id,
        kind: node.type,
        variant: variant(node),
        renderStrategy: "intentionally-hidden",
      });
      continue;
    }
    if (node.type === "ceiling") {
      registry.register({ nodeId: node.id, kind: node.type, renderStrategy: "intentionally-hidden" });
      continue;
    }
    if (node.type === "slab" && buildSlabPlanGeometry(node)) {
      registry.register({ nodeId: node.id, kind: node.type, renderStrategy: node.visible === false ? "intentionally-hidden" : visibility.slabs === false ? "hidden-by-layer-toggle" : "self" });
      continue;
    }
    if (
      node.type === "wall" &&
      Array.isArray(node.start) &&
      Array.isArray(node.end)
    )
      registry.register({
        nodeId: node.id,
        kind: node.type,
        renderStrategy: "self",
      });
    else if (node.type === "zone" && Array.isArray(node.polygon))
      registry.register({
        nodeId: node.id,
        kind: node.type,
        renderStrategy: "self",
      });
    else if (
      node.type === "item" &&
      finalDimensions(node) &&
      resolveItemPlanTransform(node.id, nodes).status === "ok"
    )
      registry.register({
        nodeId: node.id,
        kind: node.type,
        renderStrategy: "self",
      });
    else if (
      node.type === "shelf" &&
      hasValidShelfFootprint(node) &&
      resolveShelfPlanTransform(node.id, nodes).status === "ok"
    )
      registry.register({
        nodeId: node.id,
        kind: node.type,
        variant: variant(node),
        renderStrategy: "self",
      });
    else if (
      (node.type === "door" || node.type === "window") &&
      resolveWallOpeningTransform(node, nodes)
    )
      registry.register({
        nodeId: node.id,
        kind: node.type,
        variant: variant(node),
        renderStrategy: "self",
      });
    else if (node.type === "stair" && hasStairPlanGeometry(node, nodes))
      registry.register({
        nodeId: node.id,
        kind: node.type,
        variant: node.stairType ?? "straight",
        renderStrategy: visibility.stairs === false ? "hidden-by-layer-toggle" : "self",
      });
    else if (node.type === "stair-segment") {
      const parent = nodes[node.parentId ?? ""];
      if (parent?.type === "stair" && hasStairPlanGeometry(parent, nodes))
        registry.register({
          nodeId: node.id,
          kind: node.type,
          emittedByNodeId: parent.id,
          renderStrategy: visibility.stairs === false ? "hidden-by-layer-toggle" : "parent-emitted",
        });
    }
  }
  return registry;
}
