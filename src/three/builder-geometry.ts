import { BoxGeometry, BufferGeometry, CylinderGeometry, ExtrudeGeometry, Float32BufferAttribute, Matrix4, Quaternion, Shape, Vector3 } from "three";
import { generateRoofSegmentGeometry, getRoofOuterSurfaceFrameAtPoint, roofCsgDummyMats } from "@pascal-app/viewer";
import { RoofSegmentNode, SkylightNode, StairNode, StairSegmentNode } from "@pascal-app/core";
import { Brush, Evaluator, SUBTRACTION } from "three-bvh-csg";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { computeBoundsTree } from "three-mesh-bvh";
import type { NodeData } from "../types";
import { buildBuilderStairRailPaths, builderWorldRailPoint, closestRailPath } from "./builder-stair-rails";

export type BuilderStairPart = { geometry: BufferGeometry; position: [number, number, number]; rotationY: number; sourceId: string; role?: "tread" | "support" | "column" | "rail" | "baluster" | "landing" };
export type BuilderRoofSegmentTransform = { position: [number, number, number]; rotationY: number };
export type BuilderStructuralPart = { geometry: BufferGeometry; position: [number, number, number]; rotationY: number; role?: "joinery" | "glazing"; rotation?: [number, number, number] };

const n = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const visible = (node: NodeData) => node.visible !== false;
const ROOF_SEGMENT_DEFAULTS = RoofSegmentNode.parse({ id: "rseg_builder_display_defaults", type: "roof-segment" });
const SKYLIGHT_DEFAULTS = SkylightNode.parse({ id: "skylight_builder_display_defaults", type: "skylight" });
const STAIR_DEFAULTS = StairNode.parse({ id: "stair_builder_display_defaults", type: "stair" });
const STAIR_SEGMENT_DEFAULTS = StairSegmentNode.parse({ id: "sseg_builder_display_defaults", type: "stair-segment" });
const rotateXZ = (x: number, z: number, angle: number): [number, number] => [x * Math.cos(angle) + z * Math.sin(angle), -x * Math.sin(angle) + z * Math.cos(angle)];

/** Apply Builder schema defaults beneath raw project fields without parsing or
 * stripping valid future fields from the imported read-only source node. */
export function withBuilderRoofDefaults(node: NodeData): NodeData {
  return { ...ROOF_SEGMENT_DEFAULTS, ...node, roofType: node.roofType ?? ROOF_SEGMENT_DEFAULTS.roofType } as NodeData;
}

export function withBuilderSkylightDefaults(node: NodeData): NodeData {
  return { ...SKYLIGHT_DEFAULTS, ...node } as NodeData;
}

export function withBuilderStairDefaults(node: NodeData): NodeData {
  return { ...STAIR_DEFAULTS, ...node } as NodeData;
}

function withBuilderStairSegmentDefaults(node: NodeData): NodeData {
  return { ...STAIR_SEGMENT_DEFAULTS, ...node } as NodeData;
}

function assignRoofMaterialGroups(geometry: BufferGeometry, wallHeight: number) {
  const positions = geometry.getAttribute("position"), index = geometry.getIndex();
  if (!positions) return;
  const triangleCount = index ? Math.floor(index.count / 3) : Math.floor(positions.count / 3), groups: number[] = [], a = new Vector3(), b = new Vector3(), c = new Vector3();
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const ia = index ? index.getX(triangle * 3) : triangle * 3, ib = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1, ic = index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2;
    a.fromBufferAttribute(positions, ia); b.fromBufferAttribute(positions, ib); c.fromBufferAttribute(positions, ic);
    const normal = new Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize(), centerY = (a.y + b.y + c.y) / 3;
    groups.push(normal.y > .18 && centerY > wallHeight - .03 ? 3 : centerY < wallHeight - .03 ? (normal.y < -.18 ? 2 : 0) : 1);
  }
  geometry.clearGroups();
  if (!triangleCount) return;
  let material = groups[0] ?? 0, start = 0;
  for (let triangle = 1; triangle < triangleCount; triangle += 1) if (groups[triangle] !== material) { geometry.addGroup(start * 3, (triangle - start) * 3, material); start = triangle; material = groups[triangle]!; }
  geometry.addGroup(start * 3, (triangleCount - start) * 3, material);
}

export function builderRoofSegmentTransform(segmentPosition: number[], parentPosition: number[], parentRotation: number, segmentRotation: number): BuilderRoofSegmentTransform {
  const [x, z] = rotateXZ(n(segmentPosition[0], 0), n(segmentPosition[2], 0), parentRotation);
  return {
    position: [n(parentPosition[0], 0) + x, n(parentPosition[1], 0) + n(segmentPosition[1], 0), n(parentPosition[2], 0) + z],
    rotationY: parentRotation + segmentRotation,
  };
}

function stairSegments(stair: NodeData, nodes: Record<string, NodeData>) {
  const ids = Array.isArray(stair.children) ? stair.children : [];
  return Object.values(nodes).filter((node) => node.type === "stair-segment" && node.parentId === stair.id).sort((a, b) => {
    const ai = ids.indexOf(a.id), bi = ids.indexOf(b.id);
    return (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) - (bi < 0 ? Number.MAX_SAFE_INTEGER : bi);
  });
}

function makeStraightSegment(segment: NodeData, absoluteHeight: number): BufferGeometry | null {
  const width = n(segment.width, 1), length = n(segment.length, 3), height = n(segment.height, 2.5), stepCount = Math.round(n(segment.stepCount, 10));
  if (width <= 0 || length <= 0 || (segment.segmentType !== "landing" && (height <= 0 || stepCount < 1))) return null;
  const shape = new Shape();
  if (segment.segmentType === "landing") {
    shape.moveTo(0, 0); shape.lineTo(length, 0);
    if (segment.fillToFloor === false) shape.lineTo(length, -n(segment.thickness, 0.25));
    else shape.lineTo(length, -absoluteHeight);
    shape.lineTo(0, segment.fillToFloor === false ? -n(segment.thickness, 0.25) : -absoluteHeight);
  } else {
    const riser = height / stepCount, tread = length / stepCount;
    shape.moveTo(0, 0);
    for (let i = 0; i < stepCount; i += 1) {
      shape.lineTo(i * tread, (i + 1) * riser);
      shape.lineTo((i + 1) * tread, (i + 1) * riser);
    }
    const thickness = n(segment.thickness, 0.25);
    if (segment.fillToFloor !== false) {
      shape.lineTo(length, -absoluteHeight); shape.lineTo(0, -absoluteHeight);
    } else {
      const slopeAngle = Math.atan(riser / tread), undersideOffset = thickness / Math.cos(slopeAngle);
      shape.lineTo(length, height - undersideOffset);
      if (absoluteHeight === 0) {
        const xGround = length - (height - undersideOffset) / (riser / tread);
        if (xGround > 0) shape.lineTo(xGround, 0);
      } else shape.lineTo(0, -undersideOffset);
    }
  }
  shape.lineTo(0, 0);
  const geometry = new ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  const transform = new Matrix4().makeRotationY(-Math.PI / 2);
  transform.setPosition(width / 2, 0, 0);
  geometry.applyMatrix4(transform);
  geometry.computeVertexNormals();
  return geometry;
}

function makeRadialStep(innerRadius: number, outerRadius: number, start: number, end: number, bottom: number, rise: number): BufferGeometry {
  const shape = new Shape(), segments = Math.max(2, Math.ceil(Math.abs(end - start) / (Math.PI / 24)));
  for (let index = 0; index <= segments; index += 1) {
    const angle = start + (end - start) * index / segments;
    const x = outerRadius * Math.cos(angle), z = outerRadius * Math.sin(angle);
    if (index === 0) shape.moveTo(x, -z); else shape.lineTo(x, -z);
  }
  for (let index = segments; index >= 0; index -= 1) {
    const angle = start + (end - start) * index / segments;
    shape.lineTo(innerRadius * Math.cos(angle), -innerRadius * Math.sin(angle));
  }
  shape.closePath();
  const geometry = new ExtrudeGeometry(shape, { depth: rise, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, bottom, 0);
  geometry.computeVertexNormals();
  return geometry;
}

function makeStairRail(start: Vector3, end: Vector3, radius: number, sourceId: string): BuilderStairPart {
  const delta = end.clone().sub(start), length = delta.length(), geometry = new CylinderGeometry(radius, radius, length, 8, 1);
  geometry.applyMatrix4(new Matrix4().makeRotationFromQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), delta.normalize())));
  geometry.translate((start.x + end.x) / 2, (start.y + end.y) / 2, (start.z + end.z) / 2);
  return { geometry, position: [0, 0, 0], rotationY: 0, sourceId };
}

type RoofPoint = { x: number; y: number; z: number };
const roofShapeDefaults = { gambrelLowerWidthRatio: .5, gambrelLowerHeightRatio: .6, mansardSteepWidthRatio: .15, mansardSteepHeightRatio: .7, dutchHipWidthRatio: .25, dutchHipHeightRatio: .5 };
function roofFaces(type: string, w: number, d: number, wh: number, rh: number, insets: { front: number; back: number; left: number; right: number; dutchI: number }, baseW: number, baseD: number, tanTheta: number, ratios: typeof roofShapeDefaults): RoofPoint[][] {
  const v = (x: number, y: number, z: number): RoofPoint => ({ x, y, z });
  const { front: iF, back: iB, left: iL, right: iR } = insets;
  const b1 = v(-w / 2 + iL, 0, d / 2 - iF), b2 = v(w / 2 - iR, 0, d / 2 - iF), b3 = v(w / 2 - iR, 0, -d / 2 + iB), b4 = v(-w / 2 + iL, 0, -d / 2 + iB);
  const e1 = v(-w / 2, wh, d / 2), e2 = v(w / 2, wh, d / 2), e3 = v(w / 2, wh, -d / 2), e4 = v(-w / 2, wh, -d / 2);
  const faces: RoofPoint[][] = [[b1, b2, e2, e1], [b2, b3, e3, e2], [b3, b4, e4, e3], [b4, b1, e1, e4], [b4, b3, b2, b1]];
  const h = wh + Math.max(.001, rh);
  if (type === "flat" || rh === 0) return [...faces, [e1, e2, e3, e4]];
  if (type === "gable" || type === "gambrel") {
    const r1 = v(-w / 2, h, 0), r2 = v(w / 2, h, 0);
    if (type === "gable") return [...faces, [e4, e1, r1], [e2, e3, r2], [e1, e2, r2, r1], [e3, e4, r1, r2]];
    const mz = (baseD / 2) * ratios.gambrelLowerWidthRatio, mh = wh + (d / 2 - mz) * tanTheta;
    const m1 = v(-w / 2, mh, mz), m2 = v(w / 2, mh, mz), m3 = v(w / 2, mh, -mz), m4 = v(-w / 2, mh, -mz);
    return [...faces, [e4, e1, m1, r1, m4], [e2, e3, m3, r2, m2], [e1, e2, m2, m1], [m1, m2, r2, r1], [e3, e4, m4, m3], [m3, m4, r1, r2]];
  }
  if (type === "shed") {
    const t1 = v(-w / 2, h, -d / 2), t2 = v(w / 2, h, -d / 2);
    return [...faces, [e1, e2, t2, t1], [e2, e3, t2], [e3, e4, t1, t2], [e4, e1, t1]];
  }
  if (type === "hip") {
    if (Math.abs(w - d) < .01) { const r = v(0, h, 0); return [...faces, [e4, e1, r], [e1, e2, r], [e2, e3, r], [e3, e4, r]]; }
    if (w >= d) { const r1 = v(-w / 2 + d / 2, h, 0), r2 = v(w / 2 - d / 2, h, 0); return [...faces, [e4, e1, r1], [e2, e3, r2], [e1, e2, r2, r1], [e3, e4, r1, r2]]; }
    const r1 = v(0, h, d / 2 - w / 2), r2 = v(0, h, -d / 2 + w / 2);
    return [...faces, [e1, e2, r1], [e3, e4, r2], [e2, e3, r2, r1], [e4, e1, r1, r2]];
  }
  const i = type === "mansard" ? Math.min(baseW, baseD) * ratios.mansardSteepWidthRatio : insets.dutchI || Math.min(baseW, baseD) * ratios.dutchHipWidthRatio;
  const mh = wh + i * tanTheta, m1 = v(-w / 2 + i, mh, d / 2 - i), m2 = v(w / 2 - i, mh, d / 2 - i), m3 = v(w / 2 - i, mh, -d / 2 + i), m4 = v(-w / 2 + i, mh, -d / 2 + i);
  if (type === "dutch") {
    if (w >= d) { const r1 = v(-w / 2 + i, h, 0), r2 = v(w / 2 - i, h, 0); return [...faces, [e1, e2, m2, m1], [e2, e3, m3, m2], [e3, e4, m4, m3], [e4, e1, m1, m4], [m4, m1, r1], [m2, m3, r2], [m1, m2, r2, r1], [m3, m4, r1, r2]]; }
    const r1 = v(0, h, d / 2 - i), r2 = v(0, h, -d / 2 + i); return [...faces, [e1, e2, m2, m1], [e2, e3, m3, m2], [e3, e4, m4, m3], [e4, e1, m1, m4], [m1, m2, r1], [m3, m4, r2], [m2, m3, r2, r1], [m4, m1, r1, r2]];
  }
  const t1 = v(-w / 2 + 2 * i, h, d / 2 - 2 * i), t2 = v(w / 2 - 2 * i, h, d / 2 - 2 * i), t3 = v(w / 2 - 2 * i, h, -d / 2 + 2 * i), t4 = v(-w / 2 + 2 * i, h, -d / 2 + 2 * i);
  if (w - i * 4 <= .01 || d - i * 4 <= .01) {
    if (w >= d) { const r1 = v(-w / 2 + d / 2, h, 0), r2 = v(w / 2 - d / 2, h, 0); return [...faces, [e4, e1, r1], [e2, e3, r2], [e1, e2, r2, r1], [e3, e4, r1, r2]]; }
    const r1 = v(0, h, d / 2 - w / 2), r2 = v(0, h, -d / 2 + w / 2); return [...faces, [e1, e2, r1], [e3, e4, r2], [e2, e3, r2, r1], [e4, e1, r1, r2]];
  }
  return [...faces, [t1, t2, t3, t4], [e1, e2, m2, m1], [e2, e3, m3, m2], [e3, e4, m4, m3], [e4, e1, m1, m4], [m1, m2, t2, t1], [m2, m3, t3, t2], [m3, m4, t4, t3], [m4, m1, t1, t4]];
}

/** Build real tread volumes for Pascal's segmented straight stairs and radial
 * curved/spiral stairs. Returned transforms are local to the parent Stair.
 */
export function buildBuilderStairParts(stair: NodeData, nodes: Record<string, NodeData>): BuilderStairPart[] {
  stair = withBuilderStairDefaults(stair);
  const position = Array.isArray(stair.position) ? stair.position : [0, 0, 0];
  if (stair.stairType === "curved" || stair.stairType === "spiral") {
    const width = n(stair.width, 0), innerRadius = n(stair.innerRadius, 0), sweep = n(stair.sweepAngle, 0), count = Math.round(n(stair.stepCount, 10)), totalRise = n(stair.totalRise, 2.5);
    if (width <= 0 || innerRadius <= 0 || Math.abs(sweep) <= 1e-8 || count < 1 || totalRise <= 0) return [];
    // Outer Stair group applies the stored yaw; local geometry starts at the
    // Builder-plan local angle so the saved rotation is applied exactly once.
    const start = -sweep / 2, stepHeight = totalRise / count, thickness = Math.max(n(stair.thickness, .25), .02), outerRadius = innerRadius + width, spiral = stair.stairType === "spiral", parts: BuilderStairPart[] = [];
    for (let index = 0; index < count; index += 1) {
      const currentHeight = stepHeight * (index + 1), bottom = spiral ? index * stepHeight : stair.fillToFloor === false ? Math.max(currentHeight - thickness, 0) : 0, stepDepth = spiral || stair.fillToFloor === false ? thickness : Math.max(currentHeight, thickness), mid = start + sweep * (index + .5) / count;
      parts.push({ geometry: makeRadialStep(innerRadius, outerRadius, start + sweep * index / count, start + sweep * (index + 1) / count, bottom, stepDepth), position: [0, 0, 0], rotationY: 0, sourceId: stair.id, role: "tread" });
      if (spiral && stair.showStepSupports !== false) {
        const columnRadius = Math.max(.05, Math.min(innerRadius * .72, innerRadius - .03)), supportWidth = Math.max(.04, innerRadius - columnRadius + .04), supportHeight = Math.max(thickness * .55, .025), supportDepth = Math.max(.04, Math.min(.12, supportHeight * 1.5));
        const support = new BoxGeometry(supportWidth, supportHeight, supportDepth);
        support.rotateY(-mid);
        parts.push({ geometry: support, position: [Math.cos(mid) * (columnRadius + supportWidth / 2 - .02), bottom + supportHeight / 2, Math.sin(mid) * (columnRadius + supportWidth / 2 - .02)], rotationY: 0, sourceId: stair.id, role: "support" });
      }
    }
    if (spiral && stair.showCenterColumn !== false) {
      const radius = Math.max(.05, Math.min(innerRadius * .72, innerRadius - .03)), geometry = new CylinderGeometry(radius, radius, totalRise + thickness, 10);
      geometry.translate(0, (totalRise + thickness) / 2, 0); parts.push({ geometry, position: [0, 0, 0], rotationY: 0, sourceId: stair.id, role: "column" });
    }
    if (spiral && stair.topLandingMode === "integrated") {
      const landingDepth = Math.max(.3, n(stair.topLandingDepth, Math.max(width * .9, .8))), landingSweep = Math.min(Math.PI * .75, landingDepth / Math.max(innerRadius + width / 2, .1)) * Math.sign(sweep || 1), lastTop = stepHeight * Math.max(count - 1, 0) + thickness, landingThickness = Math.max(.02, totalRise - lastTop);
      if (landingSweep !== 0) parts.push({ geometry: makeRadialStep(innerRadius, outerRadius, sweep / 2, sweep / 2 + landingSweep, lastTop, landingThickness), position: [0, 0, 0], rotationY: 0, sourceId: stair.id, role: "landing" });
    }
    appendCanonicalStairRails(parts, stair, []);
    return parts;
  }
  if (stair.stairType !== undefined && stair.stairType !== "straight") return [];

  const segments = stairSegments(stair, nodes).filter(visible).map(withBuilderStairSegmentDefaults);
  const parts: BuilderStairPart[] = [];
  let x = 0, y = 0, z = 0, localRotation = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    if (index > 0) {
      const previous = segments[index - 1]!;
      const previousWidth = n(previous.width, 0), previousLength = n(previous.length, 0), previousHeight = n(previous.height, 0);
      let attachX = 0, attachZ = previousLength, turn = 0;
      if (segment.attachmentSide === "left") { attachX = previousWidth / 2; attachZ = previousLength / 2; turn = Math.PI / 2; }
      else if (segment.attachmentSide === "right") { attachX = -previousWidth / 2; attachZ = previousLength / 2; turn = -Math.PI / 2; }
      const [dx, dz] = rotateXZ(attachX, attachZ, localRotation);
      x += dx; z += dz; y += previousHeight; localRotation += turn;
    }
    const geometry = makeStraightSegment(segment, y);
    if (geometry) parts.push({ geometry, position: [x, y, z], rotationY: localRotation, sourceId: segment.id, role: segment.segmentType === "landing" ? "landing" : "tread" });
  }
  appendCanonicalStairRails(parts, stair, segments);
  return parts;
}

function appendCanonicalStairRails(parts: BuilderStairPart[], stair: NodeData, segments: NodeData[]) {
  const paths = buildBuilderStairRailPaths(stair, segments), railHeight = n(stair.railingHeight, .92), midRailHeight = Math.max(railHeight * .45, .35);
  const append = (start: Vector3, end: Vector3, radius: number, path: (typeof paths)[number], role: "rail" | "baluster", local = true) => {
    const part = makeStairRail(start, end, radius, path.segmentId); part.role = role;
    part.position = local ? path.position : [0, 0, 0]; part.rotationY = local ? path.rotation : 0; parts.push(part);
  };
  for (const [index, path] of paths.entries()) {
    for (const side of path.sidePaths) {
      const points = side.points.map(([x, y, z]) => path.segmentType === "curved" || path.segmentType === "spiral" ? new Vector3(x, y, z) : new Vector3(z, y, x));
      // Builder balusters stand from each path point's tread to rail height.
      for (let p = 0; p < points.length; p += 1) append(points[p]!, points[p]!.clone().add(new Vector3(0, railHeight, 0)), .018, path, "baluster");
      for (let p = 0; p + 1 < points.length; p += 1) {
        append(points[p]!.clone().add(new Vector3(0, railHeight, 0)), points[p + 1]!.clone().add(new Vector3(0, railHeight, 0)), .022, path, "rail");
        append(points[p]!.clone().add(new Vector3(0, midRailHeight, 0)), points[p + 1]!.clone().add(new Vector3(0, midRailHeight, 0)), .0176, path, "rail");
      }
    }
    const previous = paths[index - 1];
    if (!previous || !path.connectFromPrevious || previous.segmentType === "landing" || path.segmentType === "landing") continue;
    for (const side of path.sidePaths) {
      const first = side.points[0]; if (!first) continue;
      const currentWorld = builderWorldRailPoint(path, first), priorWorld = closestRailPath(previous, currentWorld);
      if (!priorWorld) continue;
      const from = new Vector3(...priorWorld), to = new Vector3(...currentWorld);
      append(from.clone().add(new Vector3(0, railHeight, 0)), to.clone().add(new Vector3(0, railHeight, 0)), .022, path, "rail", false);
      append(from.clone().add(new Vector3(0, midRailHeight, 0)), to.clone().add(new Vector3(0, midRailHeight, 0)), .0176, path, "rail", false);
    }
  }
}

/** Build the complete pitched/folded architectural volume from the same pure
 * roof-face builder shipped by Pascal Core. No flat box fallback is fabricated.
 */
export function buildBuilderRoofSegmentGeometry(node: NodeData): BufferGeometry | null {
  const type = node.roofType;
  if (!["hip", "gable", "shed", "gambrel", "dutch", "mansard", "flat"].includes(String(type))) return null;
  const width = n(node.width, 8), depth = n(node.depth, 6), wallHeight = n(node.wallHeight, 0.5), wallThickness = n(node.wallThickness, 0.1), deckThickness = n(node.deckThickness, 0.1), overhang = n(node.overhang, 0.3), shingleThickness = n(node.shingleThickness, 0.05);
  if ([width, depth, wallHeight].some((value) => value <= 0)) return null;
  const ratios = {
    gambrelLowerWidthRatio: n(node.gambrelLowerWidthRatio, roofShapeDefaults.gambrelLowerWidthRatio),
    gambrelLowerHeightRatio: n(node.gambrelLowerHeightRatio, roofShapeDefaults.gambrelLowerHeightRatio),
    mansardSteepWidthRatio: n(node.mansardSteepWidthRatio, roofShapeDefaults.mansardSteepWidthRatio),
    mansardSteepHeightRatio: n(node.mansardSteepHeightRatio, roofShapeDefaults.mansardSteepHeightRatio),
    dutchHipWidthRatio: n(node.dutchHipWidthRatio, roofShapeDefaults.dutchHipWidthRatio),
    dutchHipHeightRatio: n(node.dutchHipHeightRatio, roofShapeDefaults.dutchHipHeightRatio),
  };
  const pitch = Math.max(0, n(node.pitch, 0)) * Math.PI / 180;
  const run = type === "shed" ? depth : type === "gable" ? depth / 2 : type === "gambrel" ? depth / 2 * ratios.gambrelLowerWidthRatio : type === "mansard" ? Math.min(width, depth) * ratios.mansardSteepWidthRatio : type === "dutch" ? Math.min(width, depth) * ratios.dutchHipWidthRatio : Math.min(width, depth) / 2;
  const riseFraction = type === "gambrel" ? ratios.gambrelLowerHeightRatio : type === "mansard" ? ratios.mansardSteepHeightRatio : type === "dutch" ? ratios.dutchHipHeightRatio : 1;
  const tanTheta = type === "flat" || !(pitch > 0) ? 0 : Math.tan(pitch);
  const cosTheta = type === "flat" || !(pitch > 0) ? 1 : Math.cos(pitch) || 1;
  const activeRh = tanTheta > 0 ? run * tanTheta / riseFraction : 0;
  const horizontalOverhang = overhang * cosTheta;
  const wallSpan = wallThickness / 2 + horizontalOverhang;
  const expandedWidth = width + 2 * wallSpan, expandedDepth = depth + 2 * wallSpan;
  const autoDrop = wallSpan * tanTheta;
  const roofBaseY = Math.max(0.01, wallHeight - autoDrop + deckThickness / Math.max(cosTheta, 1e-6));
  let roofRise = activeRh + autoDrop;
  if (type === "shed" && activeRh > 0) roofRise = activeRh + 2 * autoDrop;
  // Same deckTopGeo inputs as Builder's getRoofSegmentBrushes/getVol: its
  // volume footprint uses deckExt, while the shape module owns dutchI only.
  const insets = { front: 0, back: 0, left: 0, right: 0, dutchI: Math.min(width, depth) * .25 };
  const faces = roofFaces(type, expandedWidth, expandedDepth, roofBaseY, roofRise, insets, width, depth, tanTheta, ratios);
  const positions: number[] = [];
  for (const face of faces) {
    if (face.length < 3) continue;
    for (let index = 1; index < face.length - 1; index += 1) {
      for (const vertex of [face[0]!, face[index]!, face[index + 1]!]) positions.push(vertex.x, vertex.y, vertex.z);
    }
  }
  if (!positions.length) return null;
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Runtime path uses the installed Builder viewer's canonical four-layer roof
 * shell, then subtracts linked skylights in the segment-local surface frame. */
export function buildCanonicalBuilderRoofGeometry(node: NodeData, nodes: Record<string, NodeData>): { geometry: BufferGeometry; failed: boolean; diagnostic?: string } {
  const source = withBuilderRoofDefaults(node), roofType = source.roofType;
  if (!["hip", "gable", "shed", "gambrel", "dutch", "mansard", "flat"].includes(String(roofType))) return { geometry: new BufferGeometry(), failed: false };
  let geometry = generateRoofSegmentGeometry(source as any);
  const childIds = new Set(Array.isArray(node.children) ? node.children : []);
  const skylights = Object.values(nodes).filter((entry) => entry.type === "skylight" && visible(entry) && (entry.roofSegmentId === node.id || entry.parentId === node.id || childIds.has(entry.id))).map(withBuilderSkylightDefaults);
  if (skylights.length === 0) return { geometry, failed: false };
  const original = geometry;
  // The canonical roof shell has material groups that do not match the CSG
  // package's brush group cache. Flatten groups for the boolean, then return a
  // single Studio roof material in Preview.
  const csgInput = geometry.clone();
  csgInput.clearGroups();
  let result = new Brush(csgInput, roofCsgDummyMats[0]);
  const evaluator = new Evaluator();
  evaluator.attributes = ["position", "normal", "uv"];
  let ownsResultGeometry = false, failed = false, diagnostic: string | undefined;
  for (const skylight of skylights) {
    const width = n(skylight.width, 0) + 2 * n(skylight.frameThickness, 0) + 2 * Math.max(0, n(skylight.cutoutOffset, .01));
    const depth = n(skylight.height, 0) + 2 * n(skylight.frameThickness, 0) + 2 * Math.max(0, n(skylight.cutoutOffset, .01));
    if (!(width > 0 && depth > 0) || !Array.isArray(skylight.position)) continue;
    const lx = n(skylight.position[0], 0), lz = n(skylight.position[2], 0);
    const frame = getRoofOuterSurfaceFrameAtPoint(source as any, lx, lz);
    const normal = frame.normal.clone().normalize(), right = new Vector3().crossVectors(new Vector3(0, 1, 0), normal);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0); else right.normalize();
    const forward = new Vector3().crossVectors(right, normal).normalize();
    const cutterGeometry = new BoxGeometry(width, 2, depth);
    cutterGeometry.rotateY(n(skylight.rotation, 0));
    cutterGeometry.applyMatrix4(new Matrix4().makeBasis(right, normal, forward));
    cutterGeometry.translate(lx, frame.point.y, lz);
    const welded = mergeVertices(cutterGeometry, 1e-4);
    cutterGeometry.dispose();
    const cutter = new Brush(welded, roofCsgDummyMats[0]);
    for (const brush of [result, cutter]) {
      brush.updateMatrixWorld(true);
      const bounds = brush.geometry as BufferGeometry & { computeBoundsTree?: (...args: never[]) => unknown };
      if (typeof bounds.computeBoundsTree !== "function") (bounds as any).computeBoundsTree = computeBoundsTree;
      (bounds as any).computeBoundsTree({ maxLeafSize: 10 });
    }
    try {
      const next = evaluator.evaluate(result, cutter, SUBTRACTION) as Brush;
      const position = next.geometry.getAttribute("position");
      if (!position || position.count < 3 || Array.from(position.array).some((value) => !Number.isFinite(value))) { next.geometry.dispose(); throw new Error("roof_skylight_csg_invalid_geometry"); }
      result.geometry.dispose();
      result = next;
      ownsResultGeometry = true;
    } catch (error) {
      failed = true;
      diagnostic = error instanceof Error ? error.message : String(error);
    } finally {
      cutter.geometry.dispose();
    }
  }
  if (failed && !ownsResultGeometry) { csgInput.dispose(); return { geometry: original, failed, diagnostic }; }
  if (result.geometry !== csgInput) csgInput.dispose();
  if (result.geometry !== original) original.dispose();
  geometry = result.geometry;
  assignRoofMaterialGroups(geometry, n(source.wallHeight, .5));
  geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return { geometry, failed, diagnostic };
}

function makeLanternPanel(width: number, depth: number, height: number, topScale: number, side: number): BufferGeometry {
  const baseW = width / 2, baseD = depth / 2, topW = baseW * Math.max(0, Math.min(1, topScale)), topD = baseD * Math.max(0, Math.min(1, topScale));
  const faces: Array<[[number, number, number], [number, number, number], [number, number, number], [number, number, number]]> = [
    [[-baseW, 0, baseD], [baseW, 0, baseD], [topW, height, topD], [-topW, height, topD]],
    [[baseW, 0, baseD], [baseW, 0, -baseD], [topW, height, -topD], [topW, height, topD]],
    [[baseW, 0, -baseD], [-baseW, 0, -baseD], [-topW, height, -topD], [topW, height, -topD]],
    [[-baseW, 0, -baseD], [-baseW, 0, baseD], [-topW, height, topD], [-topW, height, -topD]],
  ];
  const [a, b, c, d] = faces[side]!, geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d], 3));
  geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

/** Source-dimension frame and glazing volumes placed in the canonical roof
 * surface frame by Preview. The roof opening is cut separately from the shell. */
export function buildBuilderSkylightParts(node: NodeData): BuilderStructuralPart[] {
  node = withBuilderSkylightDefaults(node);
  const width = n(node.width, 0), depth = n(node.height, 0), frame = n(node.frameThickness, .04), frameDepth = n(node.frameDepth, .08), curbHeight = node.curb === true ? n(node.curbHeight, .1) : 0;
  if (!(width > 0 && depth > 0 && frame > 0 && frameDepth > 0)) return [];
  const parts: BuilderStructuralPart[] = [], top = curbHeight + frameDepth / 2;
  const box = (w: number, h: number, d: number, p: [number, number, number], role: "joinery" | "glazing" = "joinery", rotation: [number, number, number] = [0, 0, 0]) => {
    if (!(w > 0 && h > 0 && d > 0)) return;
    parts.push({ geometry: new BoxGeometry(w, h, d), position: p, rotationY: 0, role, rotation });
  };
  // Builder's frame is a four-sided curb/frame around the clear glass area.
  box(width, frameDepth, frame, [0, top, -depth / 2 + frame / 2]);
  box(width, frameDepth, frame, [0, top, depth / 2 - frame / 2]);
  box(frame, frameDepth, Math.max(.001, depth - frame * 2), [-width / 2 + frame / 2, top, 0]);
  box(frame, frameDepth, Math.max(.001, depth - frame * 2), [width / 2 - frame / 2, top, 0]);
  const glass = String(node.skylightType ?? "flat") === "walk-on" ? n(node.glassThickness, .02) : Math.max(.002, n(node.glassThickness, .01)), paneWidth = Math.max(.001, width - frame * 2), paneDepth = Math.max(.001, depth - frame * 2), paneY = top + frameDepth / 2 + glass / 2;
  let panePosition: [number, number, number] = [0, paneY, 0], paneRotation: [number, number, number] = [0, 0, 0];
  if (node.skylightType === "opening") {
    const amount = Math.max(0, Math.min(1, n(node.operationState, 0))), angle = n(node.openingAngle, 0) * amount, side = node.openingSide;
    if (side === "left" || side === "right") {
      const sign = side === "left" ? -1 : 1, pivotX = sign * paneWidth / 2, offsetX = -sign * paneWidth / 2, rotatedX = offsetX * Math.cos(angle), rotatedY = offsetX * Math.sin(angle);
      panePosition = [pivotX + rotatedX, paneY + rotatedY, 0]; paneRotation = [0, 0, angle];
    } else {
      const sign = side === "top" ? 1 : -1, pivotZ = sign * paneDepth / 2, offsetZ = -sign * paneDepth / 2, rotatedY = -offsetZ * Math.sin(angle), rotatedZ = pivotZ + offsetZ * Math.cos(angle);
      panePosition = [0, paneY + rotatedY, rotatedZ]; paneRotation = [angle, 0, 0];
    }
  }
  if (node.skylightType === "sliding") {
    const track = Math.max(.02, n(node.trackWidth, .04)), fraction = Math.max(0, Math.min(1, n(node.slideFraction, 0))), sashWidth = Math.max(.001, (width - track) / 2), sashDepth = Math.max(.001, depth - .01), sashHeight = Math.max(glass * 1.25, frame * .18), sashRail = Math.max(.016, frame * .36);
    const panes: Array<{ x: number; y: number; z: number; width: number }> = node.slideDirection === "x"
      ? [{ x: -width / 4, y: curbHeight + glass / 2, z: 0, width: sashWidth }, { x: width / 4 - fraction * sashWidth, y: curbHeight + glass * 1.5 + .003, z: 0, width: sashWidth }]
      : [{ x: 0, y: curbHeight + glass / 2, z: -depth / 4, width: width - .01 }, { x: 0, y: curbHeight + glass * 1.5 + .003, z: depth / 4 - fraction * sashDepth, width: width - .01 }];
    for (const pane of panes) {
      const pdepth = node.slideDirection === "x" ? sashDepth : sashDepth / 2;
      box(pane.width, glass, pdepth, [pane.x, pane.y, pane.z], "glazing");
      box(pane.width + sashRail, sashHeight, sashRail, [pane.x, pane.y + glass / 2, pane.z + pdepth / 2], "joinery");
      box(pane.width + sashRail, sashHeight, sashRail, [pane.x, pane.y + glass / 2, pane.z - pdepth / 2], "joinery");
      box(sashRail, sashHeight, Math.max(.001, pdepth - sashRail * 2), [pane.x + pane.width / 2, pane.y + glass / 2, pane.z], "joinery");
      box(sashRail, sashHeight, Math.max(.001, pdepth - sashRail * 2), [pane.x - pane.width / 2, pane.y + glass / 2, pane.z], "joinery");
    }
    if (node.slideDirection === "x") {
      for (const side of [-1, 1]) box(width + track * 2, track, track, [0, curbHeight + glass + track / 2, side * depth / 2], "joinery");
    } else {
      for (const side of [-1, 1]) box(track, track, depth + track * 2, [side * width / 2, curbHeight + glass + track / 2, 0], "joinery");
    }
  } else {
    box(paneWidth, glass, paneDepth, panePosition, "glazing", paneRotation);
  }
  if (node.skylightType === "lantern") {
    const lanternHeight = n(node.lanternHeight, .35), scale = n(node.lanternTopScale, .8);
    // Sloped lantern glazing follows Builder's base-to-scaled-top profile.
    for (let side = 0; side < 4; side += 1) parts.push({ geometry: makeLanternPanel(width - frame * 2, depth - frame * 2, lanternHeight, scale, side), position: [0, top + frameDepth, 0], rotationY: 0, role: "glazing" });
    const baseCorners: Array<[number, number]> = [[-width / 2 + frame / 2, -depth / 2 + frame / 2], [width / 2 - frame / 2, -depth / 2 + frame / 2], [width / 2 - frame / 2, depth / 2 - frame / 2], [-width / 2 + frame / 2, depth / 2 - frame / 2]];
    const topCorners: Array<[number, number]> = [[-width / 2 * scale, -depth / 2 * scale], [width / 2 * scale, -depth / 2 * scale], [width / 2 * scale, depth / 2 * scale], [-width / 2 * scale, depth / 2 * scale]];
    for (let corner = 0; corner < 4; corner += 1) {
      const next = (corner + 1) % 4, start = new Vector3(baseCorners[corner]![0], 0, baseCorners[corner]![1]), end = new Vector3(topCorners[corner]![0], lanternHeight, topCorners[corner]![1]);
      const frameEdge = makeStairRail(start, end, Math.max(.006, frame * .12), node.id);
      parts.push({ geometry: frameEdge.geometry, position: [0, top + frameDepth, 0], rotationY: 0, role: "joinery" });
      if (scale > .001) {
        const topStart = new Vector3(topCorners[corner]![0], lanternHeight, topCorners[corner]![1]), topEnd = new Vector3(topCorners[next]![0], lanternHeight, topCorners[next]![1]), rail = makeStairRail(topStart, topEnd, Math.max(.006, frame * .12), node.id);
        parts.push({ geometry: rail.geometry, position: [0, top + frameDepth, 0], rotationY: 0, role: "joinery" });
      }
    }
  }
  return parts;
}

