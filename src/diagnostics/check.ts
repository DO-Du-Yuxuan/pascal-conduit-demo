import { Diagnostic, NodeData } from "../types";
import { validDimensions } from "../geometry/transform";
export function inspectNodes(nodes: Record<string, NodeData>): Diagnostic[] {
  const diagnostics: Diagnostic[] = [],
    known = new Set([
      "site",
      "building",
      "level",
      "zone",
      "wall",
      "door",
      "window",
      "item",
      "slab",
      "ceiling",
      "shelf",
      "stair",
      "stair-segment",
    ]);
  for (const node of Object.values(nodes)) {
    if (!known.has(node.type))
      diagnostics.push({
        severity: "info",
        code: "unsupported_node_type",
        message: `暂未渲染的节点类型：${node.type}`,
        nodeId: node.id,
        sourcePath: `nodes.${node.id}.type`,
      });
    if (node.type !== "item") continue;
    if (!validDimensions(node))
      diagnostics.push({
        severity: "error",
        code: "invalid_item_dimensions",
        message: "asset.dimensions 必须是三个大于 0 的有限数值；未生成虚假尺寸",
        nodeId: node.id,
        sourcePath: `nodes.${node.id}.asset.dimensions`,
      });
    const scale = node.scale;
    if (
      Array.isArray(scale) &&
      !scale.every((value: any) => Number.isFinite(value) && value > 0)
    )
      diagnostics.push({
        severity: "error",
        code: "invalid_item_scale",
        message: "item.scale 包含无效数值",
        nodeId: node.id,
        sourcePath: `nodes.${node.id}.scale`,
      });
    if (
      Array.isArray(scale) &&
      scale.length >= 3 &&
      !(scale[0] === scale[1] && scale[1] === scale[2])
    )
      diagnostics.push({
        severity: "warning",
        code: "non_uniform_item_scale",
        message: "非等比例 item.scale，图片会被非等比例拉伸",
        nodeId: node.id,
        sourcePath: `nodes.${node.id}.scale`,
      });
    if (!node.asset?.floorPlanUrl)
      diagnostics.push({
        severity: "info",
        code: "missing_floor_plan_image",
        message: "缺少 floorPlanUrl，将显示物理占地框",
        nodeId: node.id,
        sourcePath: `nodes.${node.id}.asset.floorPlanUrl`,
      });
    if (node.asset?.rotation?.some((value: number) => value !== 0))
      diagnostics.push({
        severity: "warning",
        code: "asset_corrective_rotation_present",
        message: "GLB 校正旋转不参与 floorPlanUrl 二维实例旋转",
        nodeId: node.id,
        sourcePath: `nodes.${node.id}.asset.rotation`,
      });
  }
  return diagnostics;
}
