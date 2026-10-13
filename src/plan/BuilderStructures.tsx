import React from "react";
import { ColumnNode, FenceNode, getWallCurveFrameAt, getWallCurveLength, isCurvedWall, sampleWallCenterline } from "@pascal-app/core";
import type { NodeData } from "../types";
import { resolveAncestorLevelId } from "../geometry/transform";
import { sourceNodeIsVisible } from "../scene-visibility";
import { BUILDER_PLAN_COLORS } from "./builder-presentation";

type Point2 = { x: number; z: number };
export type BuilderColumnPlanShape =
  | { kind: "polygon"; points: Point2[] }
  | { kind: "circle"; center: Point2; radius: number };
export type BuilderFencePost = { point: Point2; tangent: Point2; radius: number; style: string };
export type BuilderFencePlanGeometry = { points: Point2[]; posts: BuilderFencePost[] };

const COLUMN_DEFAULTS = ColumnNode.parse({ id: "column_plan_defaults", type: "column" });
const FENCE_DEFAULTS = FenceNode.parse({ id: "fence_plan_defaults", type: "fence", start: [0, 0], end: [1, 0] });
const COLUMN_BRACE_STYLES = new Set(["a-frame", "y-frame", "v-frame", "x-brace", "k-brace", "single-strut", "tripod", "trestle", "portal-frame", "box-frame"]);
const finite = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function withSchemaDefaults<T extends NodeData>(defaults: object, raw: T): T {
  const resolved = { ...defaults } as Record<string, unknown>;
  for (const [key, value] of Object.entries(raw)) if (value !== undefined) resolved[key] = value;
  return resolved as T;
}

function rotatedPoint(x: number, z: number, rotation: number): Point2 {
  const c = Math.cos(rotation), s = Math.sin(rotation);
  return { x: x * c + z * s, z: -x * s + z * c };
}

function rotatedRectangle(width: number, depth: number, rotation: number): Point2[] {
  const hw = Math.max(0.04, width) / 2, hd = Math.max(0.04, depth) / 2;
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, z]) => rotatedPoint(x!, z!, rotation));
}

/** Builder floorplan-panel.tsx:getColumnPlanFootprint, with schema defaults applied first. */
export function buildColumnPlanFootprints(rawNode: NodeData): BuilderColumnPlanShape[] {
  const node = withSchemaDefaults(COLUMN_DEFAULTS, rawNode);
  const position = Array.isArray(node.position) ? node.position : [0, 0, 0];
  const center = { x: finite(position[0], 0), z: finite(position[2], 0) };
  const rotation = finite(node.rotation, Array.isArray(node.rotation) ? finite(node.rotation[1], 0) : 0);
  const width = Math.max(0.04, finite(node.width, COLUMN_DEFAULTS.width));
  const depth = Math.max(0.04, finite(node.depth, COLUMN_DEFAULTS.depth));
  const radius = Math.max(0.02, finite(node.radius, COLUMN_DEFAULTS.radius));
  const supportStyle = String(node.supportStyle ?? COLUMN_DEFAULTS.supportStyle);

  if (COLUMN_BRACE_STYLES.has(supportStyle)) {
    const widthUsesBottomSpread = !["y-frame", "v-frame"].includes(supportStyle);
    const depthUsesSpread = ["tripod", "trestle", "box-frame"].includes(supportStyle);
    const braceWidth = Math.max(
      widthUsesBottomSpread ? finite(node.braceBottomSpread, 1.2) : 0,
      finite(node.braceTopSpread, ["y-frame", "v-frame"].includes(supportStyle) ? 1 : 0),
      finite(node.braceWidth, width) * 2,
    );
    const braceDepth = Math.max(depthUsesSpread ? finite(node.braceTopSpread, 1) : 0, finite(node.braceDepth, depth), 0.08);
    const polygon = rotatedRectangle(braceWidth, braceDepth, rotation).map(point => ({ x: center.x + point.x, z: center.z + point.z }));
    return [{ kind: "polygon", points: polygon }];
  }

  const crossSection = String(node.crossSection ?? COLUMN_DEFAULTS.crossSection);
  const isRound = crossSection === "round" || crossSection === "octagonal" || crossSection === "sixteen-sided";
  const shaftWidth = isRound ? radius * 2 : width;
  const shaftDepth = isRound ? radius * 2 : depth;
  const footprintWidth = Math.max(shaftWidth, width * finite(node.baseWidthScale, COLUMN_DEFAULTS.baseWidthScale), width * finite(node.capitalWidthScale, COLUMN_DEFAULTS.capitalWidthScale));
  const footprintDepth = Math.max(shaftDepth, depth * finite(node.baseDepthScale, COLUMN_DEFAULTS.baseDepthScale), depth * finite(node.capitalDepthScale, COLUMN_DEFAULTS.capitalDepthScale));

  if (node.style === "cluster") {
    const offset = Math.max(radius * 0.78, width * 0.22);
    const circles = [[0, 0, radius * 0.62], [offset, 0, Math.max(0.04, radius * 0.36)], [-offset, 0, Math.max(0.04, radius * 0.36)], [0, offset, Math.max(0.04, radius * 0.36)], [0, -offset, Math.max(0.04, radius * 0.36)]] as const;
    const clusterShapes: BuilderColumnPlanShape[] = circles.map(([x, z, r]) => {
      const offsetPoint = rotatedPoint(x, z, rotation);
      return { kind: "circle", center: { x: center.x + offsetPoint.x, z: center.z + offsetPoint.z }, radius: r };
    });
    // The tiered base/capital can project past the shafts, so preserve the saved
    // Builder end scales in the overall plan footprint as well.
    if (footprintWidth > radius * 1.24 || footprintDepth > radius * 1.24) {
      clusterShapes.push({ kind: "polygon", points: rotatedRectangle(footprintWidth, footprintDepth, rotation).map(point => ({ x: center.x + point.x, z: center.z + point.z })) });
    }
    return clusterShapes;
  }

  if (crossSection === "square" || crossSection === "rectangular") {
    return [{ kind: "polygon", points: rotatedRectangle(footprintWidth, footprintDepth, rotation).map(point => ({ x: center.x + point.x, z: center.z + point.z })) }];
  }

  const segmentCount = crossSection === "octagonal" ? 8 : crossSection === "sixteen-sided" ? 16 : 32;
  const points = Array.from({ length: segmentCount }, (_, index) => {
    const angle = index / segmentCount * Math.PI * 2;
    const local = rotatedPoint(Math.cos(angle) * footprintWidth / 2, Math.sin(angle) * footprintDepth / 2, rotation);
    return { x: center.x + local.x, z: center.z + local.z };
  });
  return [{ kind: "polygon", points }];
}

function fenceMarkerTs(fence: FenceNode): number[] {
  const length = isCurvedWall(fence) ? getWallCurveLength(fence) : Math.hypot(fence.end[0] - fence.start[0], fence.end[1] - fence.start[1]);
  if (length <= 0.24) return [0.5];
  const spacing = clamp(fence.style === "privacy" ? fence.postSpacing * 0.72 : fence.postSpacing, 0.34, 1.5);
  const inset = clamp(Math.max(fence.postSize * 1.25, fence.edgeInset * 10), 0.18, Math.min(0.48, length * 0.22));
  const usableLength = Math.max(length - inset * 2, 0);
  if (usableLength <= 0.001) return [0.5];
  const count = Math.max(1, Math.min(24, Math.floor(usableLength / spacing) + 1));
  if (count === 1) return [0.5];
  return Array.from({ length: count }, (_, index) => clamp((inset + usableLength * index / (count - 1)) / length, 0.08, 0.92));
}

/** Builder nodes/fence/floorplan.ts curve sampler and marker spacing, reduced to read-only plan primitives. */
export function buildFencePlanGeometry(rawNode: NodeData): BuilderFencePlanGeometry | null {
  if (!Array.isArray(rawNode.start) || !Array.isArray(rawNode.end)) return null;
  const fence = withSchemaDefaults(FENCE_DEFAULTS, rawNode) as unknown as FenceNode;
  const length = isCurvedWall(fence) ? getWallCurveLength(fence) : Math.hypot(fence.end[0] - fence.start[0], fence.end[1] - fence.start[1]);
  if (!Number.isFinite(length) || length <= 1e-8) return null;
  const points = isCurvedWall(fence)
    ? sampleWallCenterline(fence, Math.max(24, Math.ceil(length / 0.2)))
    : [{ x: fence.start[0], y: fence.start[1] }, { x: fence.end[0], y: fence.end[1] }];
  const postTs = fenceMarkerTs(fence).filter((_, index, all) => fence.showInfill || index === 0 || index === all.length - 1);
  const posts = postTs.map(t => {
    const frame = getWallCurveFrameAt(fence, t);
    return { point: { x: frame.point.x, z: frame.point.y }, tangent: { x: frame.tangent.x, z: frame.tangent.y }, radius: Math.max(0.025, fence.postSize / 2), style: fence.style };
  });
  return { points: points.map(point => ({ x: point.x, z: point.y })), posts };
}

export type BuilderStructuresProps = {
  nodes: Record<string, NodeData> | NodeData[];
  levelId: string;
  hiddenNodeIds?: ReadonlySet<string>;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
};

function pointsString(points: Point2[]) { return points.map(({ x, z }) => `${x},${z}`).join(" "); }

/** Read-only Builder-colored column/fence plan symbols. It only emits SVG and forwards selection IDs. */
export function BuilderStructures({ nodes, levelId, hiddenNodeIds = new Set(), selectedId = null, onSelect = () => undefined }: BuilderStructuresProps) {
  const entries = Array.isArray(nodes) ? nodes : Object.values(nodes);
  const nodeMap = Array.isArray(nodes) ? null : nodes;
  // Arrays are an explicit API for callers which already filtered the current
  // level. Record inputs retain the safer ancestry check here.
  const structures = entries.filter(node => (node.type === "column" || node.type === "fence") && node.visible !== false && (!nodeMap || sourceNodeIsVisible(node.id, nodeMap)) && !hiddenNodeIds.has(node.id) && (!nodeMap || resolveAncestorLevelId(node.id, nodeMap).levelId === levelId));
  return <g className="builder-structures">
    {structures.map(node => {
      const selected = node.id === selectedId;
      const fill = selected ? "rgba(59, 130, 246, .16)" : "#ece8de";
      const stroke = selected ? BUILDER_PLAN_COLORS.selected : "#827b6d";
      const handleSelect = (event: React.MouseEvent<SVGElement>) => { event.stopPropagation(); onSelect(node.id); };
      if (node.type === "column") {
        return <g key={node.id} data-builder-structure={node.type} data-node-id={node.id} data-selectable onClick={handleSelect} style={{ cursor: "pointer" }}>
          {buildColumnPlanFootprints(node).map((shape, index) => shape.kind === "circle"
            ? <circle key={`${node.id}-shape-${index}`} cx={shape.center.x} cy={shape.center.z} r={shape.radius} fill={fill} stroke={stroke} strokeWidth={selected ? ".035" : ".022"} />
            : <polygon key={`${node.id}-shape-${index}`} points={pointsString(shape.points)} fill={fill} stroke={stroke} strokeWidth={selected ? ".035" : ".022"} />)}
          {selected && <circle cx={Array.isArray(node.position) ? finite(node.position[0], 0) : 0} cy={Array.isArray(node.position) ? finite(node.position[2], 0) : 0} r=".035" fill={stroke} pointerEvents="none" />}
        </g>;
      }
      const geometry = buildFencePlanGeometry(node);
      if (!geometry) return null;
      const path = geometry.points.map((point, index) => `${index ? "L" : "M"}${point.x} ${point.z}`).join(" ");
      const thickness = Math.max(0.045, finite(node.thickness, FENCE_DEFAULTS.thickness));
      return <g key={node.id} data-builder-structure={node.type} data-node-id={node.id} data-selectable onClick={handleSelect} style={{ cursor: "pointer" }}>
        <path d={path} fill="none" stroke="#fffdf7" strokeWidth={thickness + 0.07} strokeLinecap="round" strokeLinejoin="round" />
        <path d={path} fill="none" stroke={selected ? BUILDER_PLAN_COLORS.selected : "#827b6d"} strokeWidth={selected ? thickness + 0.025 : thickness} strokeLinecap="round" strokeLinejoin="round" />
        {geometry.posts.map((post, index) => {
          const angle = Math.atan2(post.tangent.z, post.tangent.x) * 180 / Math.PI;
          const postLength = Math.max(post.radius * 1.2, Math.min(thickness, post.radius * 1.8));
          return <g key={`${node.id}-post-${index}`} transform={`translate(${post.point.x} ${post.point.z}) rotate(${angle})`}>
            <rect x={-postLength / 2} y={-post.radius} width={postLength} height={post.radius * 2} rx={post.style === "privacy" ? 0 : post.radius} fill={selected ? "#dbeafe" : "#fffdf7"} stroke={selected ? BUILDER_PLAN_COLORS.selected : "#6f685a"} strokeWidth={selected ? ".028" : ".02"} />
          </g>;
        })}
      </g>;
    })}
  </g>;
}
