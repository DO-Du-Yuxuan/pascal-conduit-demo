import type { NodeData } from "../types";

/** Pure stair rail path port from dsphere-main/packages/nodes/src/stair/renderer.tsx
 * (buildStairRailPaths, computeStairRailLayouts, buildSegmentRailPath,
 * resolveLandingChainNextStair, and computeSegmentTransforms). */
export type BuilderStairRailSide = "left" | "right" | "front";
export type BuilderStairRailPath = {
  position: [number, number, number];
  rotation: number;
  segmentId: string;
  segmentType: string;
  connectFromPrevious: boolean;
  sidePaths: Array<{ side: BuilderStairRailSide; points: Array<[number, number, number]> }>;
};
type Layout = { center: [number, number]; elevation: number; rotation: number; segment: NodeData };
type Transform = { position: [number, number, number]; rotation: number };

const val = (node: NodeData, key: string, fallback = 0) => typeof node[key] === "number" && Number.isFinite(node[key]) ? node[key] as number : fallback;
const rotateXZ = (x: number, z: number, angle: number): [number, number] => [x * Math.cos(angle) + z * Math.sin(angle), -x * Math.sin(angle) + z * Math.cos(angle)];
const distance3 = (a: [number, number, number], b: [number, number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function buildBuilderStairRailPaths(stair: NodeData, segments: NodeData[]): BuilderStairRailPath[] {
  const mode = stair.railingMode;
  if (mode === "none" || !mode) return [];
  if (stair.stairType === "curved" || stair.stairType === "spiral") {
    const count = Math.max(2, Math.round(val(stair, "stepCount", 10))), sweep = val(stair, "sweepAngle", stair.stairType === "spiral" ? Math.PI * 2 : Math.PI / 2), stepHeight = Math.max(val(stair, "totalRise", 2.5), .1) / count, inner = Math.max(stair.stairType === "spiral" ? .05 : .2, val(stair, "innerRadius", .9)), outer = inner + Math.max(val(stair, "width", 1), .4), left = sweep >= 0 ? inner + .04 : outer - .04, right = sweep >= 0 ? outer - .04 : inner + .04;
    const radii = mode === "both" ? [left, right] : mode === "left" ? [left] : mode === "right" ? [right] : [];
    const sidePaths = radii.map((radius, sideIndex) => ({ side: sideIndex === 0 && mode !== "both" ? mode as BuilderStairRailSide : sideIndex === 0 ? "left" as const : "right" as const, points: Array.from({ length: count }, (_, index) => { const angle = -sweep / 2 + sweep / count * index + sweep / count / 2; return [Math.cos(angle) * radius, stair.stairType === "spiral" ? stepHeight * index + Math.max(val(stair, "thickness", .25), .02) : stepHeight * (index + 1), Math.sin(angle) * radius] as [number, number, number]; }) }));
    return [{ position: [0, 0, 0], rotation: 0, segmentId: stair.id, segmentType: stair.stairType, connectFromPrevious: false, sidePaths }];
  }
  if (stair.stairType !== "straight") return [];
  const visible = segments.filter((segment) => segment.visible !== false);
  const layouts = computeStairRailLayouts(visible);
  if (!layouts.length) return [];
  const landingInset = .08;
  if (mode === "both") {
    const doubleLanding = layouts.length === 4 && layouts[0]?.segment.segmentType === "stair" && layouts[1]?.segment.segmentType === "landing" && layouts[2]?.segment.segmentType === "stair" && layouts[2]?.segment.attachmentSide === "front" && layouts[3]?.segment.segmentType === "landing" && layouts[3]?.segment.attachmentSide === "front";
    return layouts.map((layout, index) => {
      const prev = layouts[index - 1], next = layouts[index + 1], { nextStair, terminal } = resolveLandingChainNextStair(layouts, index);
      const hideLanding = layout.segment.segmentType === "landing" && prev?.segment.segmentType === "stair" && next?.segment.segmentType === "stair";
      const turn = terminal && nextStair?.segment.attachmentSide ? nextStair.segment.attachmentSide : next?.segment.attachmentSide;
      const sides: BuilderStairRailSide[] = terminal && layout.segment.segmentType === "landing" ? turn === "left" ? ["front", "right"] : turn === "right" ? ["front", "left"] : ["left", "right"] : hideLanding ? turn === "left" ? ["front", "right"] : turn === "right" ? ["front", "left"] : ["left", "right"] : layout.segment.segmentType === "landing" ? next?.segment.segmentType === "landing" && turn === "left" ? ["front", "right"] : next?.segment.segmentType === "landing" && turn === "right" ? ["front", "left"] : turn === "left" ? ["right"] : turn === "right" ? ["left"] : ["left", "right"] : ["left", "right"];
      const chosen = doubleLanding && index === 1 ? ["left", "right"] as const : sides;
      return publicPath(layout, chosen.map((side) => buildSegmentRailPath(layouts, index, side, landingInset)), index > 0 && !(prev?.segment.segmentType === "landing" && layout.segment.segmentType === "landing"));
    });
  }
  const doubleLanding = layouts.length === 4 && layouts[0]?.segment.segmentType === "stair" && layouts[1]?.segment.segmentType === "landing" && layouts[2]?.segment.segmentType === "stair" && layouts[2]?.segment.attachmentSide === "front" && layouts[3]?.segment.segmentType === "landing" && layouts[3]?.segment.attachmentSide === "front";
  return layouts.map((layout, index) => {
    const prev = layouts[index - 1], next = layouts[index + 1], { nextStair, terminal } = resolveLandingChainNextStair(layouts, index), middle = layout.segment.segmentType === "landing" && prev?.segment.segmentType === "stair" && next?.segment.segmentType === "stair", nextSide = next?.segment.attachmentSide, terminalSide = nextStair?.segment.attachmentSide;
    const suppressMiddle = middle && nextSide != null && nextSide !== "front" && nextSide === mode;
    const suppress = (layout.segment.segmentType === "landing" && next?.segment.segmentType === "landing" && nextSide === mode) || suppressMiddle;
    const continues = layout.segment.segmentType === "landing" ? nextSide == null || nextSide === "front" || nextSide === mode : true;
    let sides: BuilderStairRailSide[];
    if (suppress) sides = [];
    else if (layout.segment.segmentType !== "landing") sides = [mode];
    else if (terminal) sides = mode === "left" ? terminalSide === "right" ? ["front", "left"] : terminalSide === "front" || terminalSide == null ? ["left"] : [] : mode === "right" ? terminalSide === "left" ? ["front", "right"] : terminalSide === "front" || terminalSide == null ? ["right"] : [] : [mode];
    else if (doubleLanding) sides = [mode];
    else if (middle && mode === "left") sides = nextSide === "right" ? ["front", "left"] : ["left"];
    else if (middle && mode === "right") sides = nextSide === "left" ? ["front", "right"] : ["right"];
    else if (next?.segment.segmentType === "landing" && nextSide != null && nextSide !== "front" && nextSide !== mode) sides = ["front", mode];
    else sides = [mode];
    return publicPath(layout, sides.map((side) => buildSegmentRailPath(layouts, index, side, landingInset)), index > 0 && !suppress && sides.length > 0 && continues);
  });
}

function publicPath(layout: Layout, sidePaths: BuilderStairRailPath["sidePaths"], connectFromPrevious: boolean): BuilderStairRailPath {
  return { position: [layout.center[0], layout.elevation, layout.center[1]], rotation: layout.rotation, segmentId: layout.segment.id, segmentType: String(layout.segment.segmentType), connectFromPrevious, sidePaths };
}
function resolveLandingChainNextStair(layouts: Layout[], index: number) {
  const layout = layouts[index];
  if (!layout || layout.segment.segmentType !== "landing") return { nextStair: undefined as Layout | undefined, terminal: false };
  let cursor = index;
  while (cursor + 1 < layouts.length && layouts[cursor + 1]?.segment.segmentType === "landing") cursor++;
  const nextStair = cursor + 1 < layouts.length && layouts[cursor + 1]?.segment.segmentType === "stair" ? layouts[cursor + 1] : undefined;
  return { nextStair, terminal: Boolean(nextStair) && cursor === index };
}
function computeStairRailLayouts(segments: NodeData[]): Layout[] {
  const transforms = computeSegmentTransforms(segments);
  return segments.map((segment, index) => {
    const transform = transforms[index]!, [dx, dz] = rotateXZ(0, val(segment, "length") / 2, transform.rotation);
    return { center: [transform.position[0] + dx, transform.position[2] + dz], elevation: transform.position[1], rotation: transform.rotation, segment };
  });
}
function buildSegmentRailPath(layouts: Layout[], index: number, side: BuilderStairRailSide, inset: number) {
  const layout = layouts[index]!, segment = layout.segment, prev = layouts[index - 1], next = layouts[index + 1], landing = segment.segmentType === "landing", steps = Math.max(1, landing ? 1 : Math.round(val(segment, "stepCount", 10))), depth = val(segment, "length") / steps, rise = landing ? 0 : val(segment, "height") / steps, sideOffset = side === "left" ? val(segment, "width") / 2 - .045 : -val(segment, "width") / 2 + .045;
  const startX = prev?.segment.segmentType === "landing" ? -val(segment, "length") / 2 + inset : -val(segment, "length") / 2, endX = next?.segment.segmentType === "landing" ? val(segment, "length") / 2 - inset : val(segment, "length") / 2, frontX = prev?.segment.segmentType === "stair" && segment.attachmentSide && segment.attachmentSide !== "front" ? -val(segment, "length") / 2 + inset : val(segment, "length") / 2 - inset;
  if (landing) {
    const back = -val(segment, "length") / 2 + inset, front = val(segment, "length") / 2 - inset, left = val(segment, "width") / 2 - inset, right = -val(segment, "width") / 2 + inset;
    return { side, points: side === "left" ? [[back, 0, left], [front, 0, left]] as [number,number,number][] : side === "right" ? [[back, 0, right], [front, 0, right]] as [number,number,number][] : [[frontX, 0, left], [frontX, 0, right]] as [number,number,number][] };
  }
  const points: Array<[number, number, number]> = [];
  if (prev?.segment.segmentType !== "landing") points.push([startX, rise > 0 ? rise : 0, sideOffset]);
  for (let i = 0; i < steps; i += 1) points.push([-val(segment, "length") / 2 + depth * i + depth / 2, rise * (i + 1), sideOffset]);
  if (next?.segment.segmentType !== "landing") points.push([endX, val(segment, "height"), sideOffset]);
  return { side, points };
}
function toWorld(layout: Layout, point: [number, number, number]): [number, number, number] {
  const [dx, dz] = rotateXZ(point[2], point[0], layout.rotation);
  return [layout.center[0] + dx, layout.elevation + point[1], layout.center[1] + dz];
}
function computeSegmentTransforms(segments: NodeData[]): Transform[] {
  const result: Transform[] = []; let p: [number, number, number] = [0, 0, 0], rotation = 0;
  segments.forEach((segment, index) => {
    if (index > 0) {
      const prev = segments[index - 1]!, len = val(prev, "length"), width = val(prev, "width"); let ax = 0, az = len, turn = 0;
      if (segment.attachmentSide === "left") { ax = width / 2; az = len / 2; turn = Math.PI / 2; }
      else if (segment.attachmentSide === "right") { ax = -width / 2; az = len / 2; turn = -Math.PI / 2; }
      const [dx, dz] = rotateXZ(ax, az, rotation); p = [p[0] + dx, p[1] + val(prev, "height"), p[2] + dz]; rotation += turn;
    }
    result.push({ position: p, rotation });
  });
  return result;
}

export function builderWorldRailPoint(path: BuilderStairRailPath, point: [number, number, number]): [number, number, number] {
  const [dx, dz] = rotateXZ(point[2], point[0], path.rotation);
  return [path.position[0] + dx, path.position[1] + point[1], path.position[2] + dz];
}
export function closestRailPath(previous: BuilderStairRailPath, currentPoint: [number, number, number]) {
  const world = previous.sidePaths.map((entry) => ({ entry, last: entry.points.length ? builderWorldRailPoint(previous, entry.points[entry.points.length - 1]!) : null }));
  return world.filter((x) => x.last).sort((a, b) => distance3(a.last!, currentPoint) - distance3(b.last!, currentPoint))[0]?.last ?? null;
}
