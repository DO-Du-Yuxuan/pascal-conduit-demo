import { NodeData } from "../types";
import { buildSpiralStairPlanGeometry } from "./spiral-stair";

export type PlanPoint = { x: number; z: number };
type SegmentEntry = { node: NodeData; polygon: PlanPoint[]; treads: Array<{ start: PlanPoint; end: PlanPoint }> };
export type StraightStairPlanGeometry = { segments: SegmentEntry[]; upDirection: { from: PlanPoint; to: PlanPoint } };
export type CurvedStairPlanGeometry = { footprintPath: string; treadLines: Array<{ start: PlanPoint; end: PlanPoint }>; upDirection: { from: PlanPoint; to: PlanPoint }; corners: PlanPoint[] };
export type StairLandingGeometry = { fromCenter: PlanPoint; toCenter: PlanPoint; fromOutward: PlanPoint; toOutward: PlanPoint; width: number };

const finite = (value: unknown) => Number.isFinite(value) ? Number(value) : null;
const number = (value: unknown, fallback: number) => finite(value) ?? fallback;
const rotate = (x: number, z: number, rotation: number) => ({ x: x * Math.cos(rotation) + z * Math.sin(rotation), z: -x * Math.sin(rotation) + z * Math.cos(rotation) });
const point = (x: number, z: number, rotation: number, origin: PlanPoint) => {
  const offset = rotate(x, z, rotation);
  return { x: origin.x + offset.x, z: origin.z + offset.z };
};

function segmentsFor(stair: NodeData, nodes: Record<string, NodeData>) {
  const listed = Array.isArray(stair.children) ? stair.children : [];
  const children = Object.values(nodes).filter((node) => node.type === "stair-segment" && node.parentId === stair.id);
  return children.sort((a, b) => {
    const ai = listed.indexOf(a.id), bi = listed.indexOf(b.id);
    return (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) - (bi < 0 ? Number.MAX_SAFE_INTEGER : bi);
  });
}

/** Mirrors Pascal's computeFloorplanStairSegmentTransforms + polygon builder. */
export function buildStraightStairPlanGeometry(stair: NodeData, nodes: Record<string, NodeData>): StraightStairPlanGeometry | null {
  const segments = segmentsFor(stair, nodes).filter((node) => node.visible !== false);
  if (!segments.length || !Array.isArray(stair.position)) return null;
  let current = { x: 0, z: 0 }, rotation = 0;
  const entries: SegmentEntry[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    const width = finite(segment.width), length = finite(segment.length);
    if (!(width && width > 0 && length && length > 0)) return null;
    if (index > 0) {
      const previous = segments[index - 1]!;
      const previousWidth = number(previous.width, 0), previousLength = number(previous.length, 0);
      let attachX = 0, attachZ = previousLength, delta = 0;
      if (segment.attachmentSide === "left") { attachX = previousWidth / 2; attachZ = previousLength / 2; delta = Math.PI / 2; }
      else if (segment.attachmentSide === "right") { attachX = -previousWidth / 2; attachZ = previousLength / 2; delta = -Math.PI / 2; }
      const attach = rotate(attachX, attachZ, rotation);
      current = { x: current.x + attach.x, z: current.z + attach.z };
      rotation += delta;
    }
    const local = [[-width / 2, 0], [width / 2, 0], [width / 2, length], [-width / 2, length]];
    const stairOrigin = { x: number(stair.position[0], 0), z: number(stair.position[2], 0) };
    const stairRotation = number(stair.rotation, 0);
    const toWorld = (x: number, z: number) => {
      const segmentOffset = rotate(x, z, rotation);
      return point(current.x + segmentOffset.x, current.z + segmentOffset.z, stairRotation, stairOrigin);
    };
    const polygon = local.map(([x, z]) => toWorld(x, z));
    const stepCount = Math.round(number(segment.stepCount, 0));
    const treads = segment.segmentType === "stair" && stepCount > 1
      ? Array.from({ length: stepCount - 1 }, (_, tread) => {
          const t = (tread + 1) / stepCount;
          return { start: toWorld(-width / 2, length * t), end: toWorld(width / 2, length * t) };
        }) : [];
    entries.push({ node: segment, polygon, treads });
  }
  const final = entries[entries.length - 1]!.polygon;
  return { segments: entries, upDirection: { from: { x: (entries[0]!.polygon[0]!.x + entries[0]!.polygon[1]!.x) / 2, z: (entries[0]!.polygon[0]!.z + entries[0]!.polygon[1]!.z) / 2 }, to: { x: (final[2]!.x + final[3]!.x) / 2, z: (final[2]!.z + final[3]!.z) / 2 } } };
}

export function buildCurvedStairPlanGeometry(stair: NodeData): CurvedStairPlanGeometry | null {
  if (!Array.isArray(stair.position)) return null;
  const width = finite(stair.width), innerRadius = finite(stair.innerRadius), sweep = finite(stair.sweepAngle);
  const stepCount = Math.round(number(stair.stepCount, 10));
  if (!(width && width > 0 && innerRadius !== null && innerRadius > 0 && sweep && stepCount > 0)) return null;
  const center = { x: number(stair.position[0], 0), z: number(stair.position[2], 0) }, rotation = number(stair.rotation, 0), outerRadius = innerRadius + width;
  const start = -rotation - sweep / 2, end = start + sweep;
  const arcPoint = (radius: number, angle: number) => ({ x: center.x + Math.cos(angle) * radius, z: center.z + Math.sin(angle) * radius });
  const startOuter = arcPoint(outerRadius, start), endOuter = arcPoint(outerRadius, end), endInner = arcPoint(innerRadius, end), startInner = arcPoint(innerRadius, start);
  const large = Math.abs(sweep) > Math.PI ? 1 : 0, flag = sweep >= 0 ? 1 : 0, reverse = flag ? 0 : 1;
  const footprintPath = `M ${startOuter.x} ${startOuter.z} A ${outerRadius} ${outerRadius} 0 ${large} ${flag} ${endOuter.x} ${endOuter.z} L ${endInner.x} ${endInner.z} A ${innerRadius} ${innerRadius} 0 ${large} ${reverse} ${startInner.x} ${startInner.z} Z`;
  const treadLines = Array.from({ length: stepCount + 1 }, (_, index) => {
    const angle = start + sweep * index / stepCount;
    return { start: arcPoint(innerRadius, angle), end: arcPoint(outerRadius, angle) };
  });
  const midRadius = innerRadius + width / 2, arrowStart = arcPoint(midRadius, start + sweep * .2), arrowEnd = arcPoint(midRadius, start + sweep * .8);
  const segments = Math.max(16, Math.ceil(Math.abs(sweep) / (Math.PI / 18)));
  const corners = [...Array.from({ length: segments + 1 }, (_, i) => arcPoint(outerRadius, start + sweep * i / segments)), ...Array.from({ length: segments + 1 }, (_, i) => arcPoint(innerRadius, end - sweep * i / segments))];
  return { footprintPath, treadLines, upDirection: { from: arrowStart, to: arrowEnd }, corners };
}

export function stairCorners(stair: NodeData, nodes: Record<string, NodeData>) {
  if (stair.stairType === "spiral") return buildSpiralStairPlanGeometry(stair)?.footprint ?? [];
  if (stair.stairType === "curved") return buildCurvedStairPlanGeometry(stair)?.corners ?? [];
  return buildStraightStairPlanGeometry(stair, nodes)?.segments.flatMap((segment) => segment.polygon) ?? [];
}

/** Landing centres and outward directions are stable evaluator inputs; Room matching samples outside the stair body instead of intersecting the whole footprint. */
export function stairLandingGeometry(stair: NodeData, nodes: Record<string, NodeData>): StairLandingGeometry | null {
  if (stair.stairType === "spiral" || stair.stairType === "curved") {
    const width = finite(stair.width), innerRadius = finite(stair.innerRadius), sweep = finite(stair.sweepAngle), position = Array.isArray(stair.position) ? stair.position : null;
    if (!(width && width > 0 && innerRadius !== null && innerRadius > 0 && sweep && position)) return null;
    const center = { x: number(position[0], 0), z: number(position[2], 0) }, startAngle = -number(stair.rotation, 0) - sweep / 2, endAngle = startAngle + sweep, radius = innerRadius + width / 2, direction = Math.sign(sweep);
    const at = (angle: number) => ({ x: center.x + Math.cos(angle) * radius, z: center.z + Math.sin(angle) * radius });
    const travel = (angle: number) => ({ x: -Math.sin(angle) * direction, z: Math.cos(angle) * direction });
    const fromTravel = travel(startAngle), toTravel = travel(endAngle);
    return { fromCenter: at(startAngle), toCenter: at(endAngle), fromOutward: { x: -fromTravel.x, z: -fromTravel.z }, toOutward: toTravel, width };
  }
  const geometry = buildStraightStairPlanGeometry(stair, nodes), first = geometry?.segments[0]?.polygon, last = geometry?.segments[geometry.segments.length - 1]?.polygon;
  if (!first || !last) return null;
  const midpoint = (a: PlanPoint, b: PlanPoint) => ({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }), normalized = (from: PlanPoint, to: PlanPoint) => { const dx = to.x - from.x, dz = to.z - from.z, length = Math.hypot(dx, dz); return length > 0 ? { x: dx / length, z: dz / length } : null; };
  const fromCenter = midpoint(first[0]!, first[1]!), firstTop = midpoint(first[2]!, first[3]!), lastBottom = midpoint(last[0]!, last[1]!), toCenter = midpoint(last[2]!, last[3]!), fromOutward = normalized(firstTop, fromCenter), toOutward = normalized(lastBottom, toCenter), width = Math.hypot(first[1]!.x - first[0]!.x, first[1]!.z - first[0]!.z);
  return fromOutward && toOutward ? { fromCenter, toCenter, fromOutward, toOutward, width } : null;
}

export function hasStairPlanGeometry(stair: NodeData, nodes: Record<string, NodeData>) {
  return stair.stairType === "spiral" ? Boolean(buildSpiralStairPlanGeometry(stair)) : stair.stairType === "curved" ? Boolean(buildCurvedStairPlanGeometry(stair)) : Boolean(buildStraightStairPlanGeometry(stair, nodes));
}
