import {
  createColumnBoxGeometry,
  createColumnCylinderGeometry,
  createColumnSphereGeometry,
  createColumnTorusGeometry,
  generateFenceGeometry,
} from "@pascal-app/viewer";
import { ColumnNode, FenceNode } from "@pascal-app/core";
import {
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  Euler,
  Matrix4,
  Quaternion,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { NodeData } from "../types";

/** Source: packages/nodes/src/column/renderer.tsx plus the canonical geometry
 * primitives in packages/viewer/src/systems/column/column-geometry.ts. These
 * are display-only local parts; node position/rotation and project ownership
 * remain with the caller. */
export type BuilderStructuralPart = {
  geometry: BufferGeometry;
  position: [number, number, number];
  rotationY: number;
};

const COLUMN_DEFAULTS = ColumnNode.parse({ id: "column_geometry_defaults", type: "column" });
const FENCE_DEFAULTS = FenceNode.parse({
  id: "fence_geometry_defaults",
  type: "fence",
  start: [0, 0],
  end: [1, 0],
});

/** Fill only absent fields from the public Zod schema while preserving unknown
 * future fields and the original raw node as an untouched input object. */
function withSchemaDefaults<T extends NodeData>(defaults: object, raw: T): T {
  const resolved = { ...defaults } as Record<string, unknown>;
  for (const [key, value] of Object.entries(raw)) {
    if (value !== undefined) resolved[key] = value;
  }
  return resolved as T;
}

/** Source: packages/viewer/src/systems/fence/fence-system.tsx. The public
 * viewer generator consumes the full saved FenceNode and merges its rails,
 * infill, posts, style factors, curve spans and floating/grounded base. */
export function buildBuilderFenceParts(node: NodeData): BuilderStructuralPart[] {
  if (!Array.isArray(node.start) || !Array.isArray(node.end)) return [];
  const geometry = generateFenceGeometry(withSchemaDefaults(FENCE_DEFAULTS, node) as unknown as FenceNode);
  if (geometry.getAttribute("position").count === 0) {
    geometry.dispose();
    return [];
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return [{ geometry, position: [0, 0, 0], rotationY: 0 }];
}

type PartDraft = { geometry: BufferGeometry; position: Vector3 };
const finite = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const positive = (value: unknown, fallback: number) => Math.max(0, finite(value, fallback));
const rotate = (angle: number) => new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle);

/**
 * Canonical parametric column mesh parts. Supports every column profile, cluster
 * shafts, base/capital tiers, rings, flutes, lathe bands, spirals and carved
 * embellishment controls represented by the Builder ColumnNode schema.
 */
export function buildBuilderColumnParts(node: NodeData): BuilderStructuralPart[] {
  node = withSchemaDefaults(COLUMN_DEFAULTS, node);
  const height = positive(node.height, 2.5);
  const width = positive(node.width, 0.44);
  const depth = positive(node.depth, width);
  const radius = positive(node.radius, width / 2);
  if (!(height > 0 && width > 0 && depth > 0 && radius > 0)) return [];

  const baseStyle = String(node.baseStyle ?? "round-rings");
  const capitalStyle = String(node.capitalStyle ?? "simple");
  const baseHeight = baseStyle === "none" ? 0 : Math.min(positive(node.baseHeight, 0.18), height * 0.4);
  const capitalHeight = capitalStyle === "none" ? 0 : Math.min(positive(node.capitalHeight, 0.18), height * 0.4);
  const shaftHeight = Math.max(0.1, height - baseHeight - capitalHeight);
  const shaftY = baseHeight;
  const capitalY = baseHeight + shaftHeight;
  const drafts: PartDraft[] = [];

  const add = (geometry: BufferGeometry, x = 0, y = 0, z = 0, yaw = 0) => {
    if (geometry.getAttribute("position").count === 0) {
      geometry.dispose();
      return;
    }
    if (yaw) geometry.applyQuaternion(rotate(yaw));
    drafts.push({ geometry, position: new Vector3(x, y, z) });
  };
  const box = (w: number, h: number, d: number, y: number, bevel = finite(node.edgeSoftness, 0.025), x = 0, z = 0, yaw = 0) => {
    if (w <= 0 || h <= 0 || d <= 0) return;
    const maxBevel = Math.min(Math.max(0, bevel), Math.min(w, h, d) * 0.35);
    add(createColumnBoxGeometry(w, h, d, maxBevel), x, y + h / 2, z, yaw);
  };
  const cylinder = (h: number, r: number, y: number, x = 0, z = 0, segments = 32, radiusX = 1, radiusZ = 1, topRadius = r, bottomRadius = r, yaw = 0) => {
    if (h <= 0 || r <= 0) return;
    add(createColumnCylinderGeometry({ height: h, radiusBottom: bottomRadius, radiusTop: topRadius, radiusX, radiusZ, segments }), x, y + h / 2, z, yaw);
  };
  const cone = (h: number, rx: number, rz: number, x: number, y: number, z: number, yaw = 0, tilt = 0, segments = 8) => {
    if (h <= 0 || rx <= 0 || rz <= 0) return;
    const geometry = new ConeGeometry(1, h, segments, 1);
    geometry.scale(rx, 1, rz);
    geometry.translate(0, -h / 2, 0);
    geometry.applyQuaternion(new Quaternion().setFromEuler(new Euler(tilt, 0, 0)));
    add(geometry, x, y, z, yaw);
  };
  const sphere = (r: number, x: number, y: number, z: number, seg = 10) => {
    if (r > 0) add(createColumnSphereGeometry(r, seg, Math.max(6, Math.round(seg * 0.8))), x, y, z);
  };
  const torus = (ringRadius: number, tubeRadius: number, x: number, y: number, z: number, yaw = 0, squash = 1) => {
    if (ringRadius > 0 && tubeRadius > 0) add(createColumnTorusGeometry({ ringRadius, tubeRadius, scaleX: ringRadius, scaleY: ringRadius, scaleZ: tubeRadius * squash }), x, y, z, yaw);
  };
  const isRound = node.crossSection === "round" || node.crossSection === "octagonal" || node.crossSection === "sixteen-sided";
  const segments = node.crossSection === "octagonal" ? 8 : node.crossSection === "sixteen-sided" ? 16 : 32;
  const block = (h: number, y: number, scale = 1, x = 0, z = 0) => {
    if (isRound) cylinder(h, radius * scale, y, x, z, segments);
    else box(width * scale, h, depth * scale, y, finite(node.shaftCornerRadius, 0.035) * scale, x, z);
  };

  const addColumnEnd = (style: string, h: number, y: number, widthScale: number, depthScale: number) => {
    if (h <= 0 || style === "none") return;
    if (style === "simple-square") {
      box(width * widthScale, h, depth * depthScale, y);
    } else if (style === "square-plinth") {
      box(width * widthScale, h * 0.35, depth * depthScale, y);
      box(width * Math.max(0.9, widthScale * 0.84), h * 0.65, depth * Math.max(0.9, depthScale * 0.84), y + h * 0.35);
    } else if (style === "stepped-square") {
      const count = Math.max(3, Math.round(finite(y === 0 ? node.baseTierCount : node.capitalTierCount, 3)));
      const spread = finite(y === 0 ? node.baseStepSpread : node.capitalStepSpread, 0.42);
      for (let i = 0; i < count; i += 1) {
        const t = i / Math.max(1, count - 1);
        const scale = Math.max(0.5, widthScale - (y === 0 ? t : 1 - t) * spread);
        const dScale = Math.max(0.5, depthScale - (y === 0 ? t : 1 - t) * spread);
        box(width * scale, h / count * 1.01, depth * dScale, y + i * h / count);
      }
    } else if (style === "round-rings") {
      const plinth = h * Math.min(0.7, Math.max(0.2, finite(node.basePlinthHeightRatio, 0.44)));
      const band = (h - plinth) * 0.57;
      box(width * widthScale, plinth, depth * depthScale, y);
      cylinder(band, 1, y + plinth, 0, 0, 32, width * widthScale * 0.46, depth * depthScale * 0.46, 1, 1);
      cylinder(h - plinth - band, 1, y + plinth + band, 0, 0, 32, width * widthScale * finite(node.baseNeckScale, 0.72) / 2, depth * depthScale * finite(node.baseNeckScale, 0.72) / 2, 1, 1);
    } else if (style === "lotus" || style === "ribbed-lotus") {
      const ribCount = Math.max(0, Math.round(finite(node.baseRibCount, style === "ribbed-lotus" ? 24 : 14)));
      const baseRadius = Math.max(radius * widthScale, width * widthScale * 0.5);
      box(width * 1.28, h * 0.22, depth * 1.28, y);
      cylinder(h * 0.24, baseRadius * 0.86, y + h * 0.22, 0, 0, 32);
      for (let i = 0; i < ribCount; i += 1) {
        const angle = i / ribCount * Math.PI * 2;
        cylinder(h * 0.38, Math.max(0.01, width * 0.025), y + h * 0.39, Math.cos(angle) * baseRadius * 0.86, Math.sin(angle) * baseRadius * 0.86, 6, 1, 1, Math.max(0.01, width * 0.025), Math.max(0.01, width * 0.025), -angle);
      }
      cylinder(h * 0.16, baseRadius * 0.72, y + h * 0.82, 0, 0, 32);
    } else if (style === "panelled-pedestal") {
      const inset = finite(node.basePanelInset, 0.02);
      box(width * widthScale, h, depth * depthScale, y);
      box(width * 0.36, h * 0.42, inset, y + h * 0.29, 0, 0, depth * depthScale * 0.51);
      box(width * 0.36, h * 0.42, inset, y + h * 0.29, 0, 0, -depth * depthScale * 0.51);
      box(inset, h * 0.42, depth * 0.36, y + h * 0.29, 0, width * widthScale * 0.51);
      box(inset, h * 0.42, depth * 0.36, y + h * 0.29, 0, -width * widthScale * 0.51);
    } else {
      block(h, y, 1.12);
    }
  };

  const supportStyle = String(node.supportStyle ?? "vertical");
  if (supportStyle !== "vertical") {
    const supportHeight = Math.max(0.2, height);
    const braceWidth = Math.min(1.6, Math.max(0.04, finite(node.braceWidth, width)));
    const braceDepth = Math.min(1.6, Math.max(0.04, finite(node.braceDepth, depth)));
    const bottomSpread = Math.max(0.2, finite(node.braceBottomSpread, Math.max(width * 3, 1.2)));
    const topSpread = Math.max(0.2, finite(node.braceTopSpread, 1));
    const beams: Array<[Vector3, Vector3]> = [];
    const plates: Vector3[] = [];
    const point = (x: number, y: number, z = 0) => new Vector3(x, y, z);
    const leftBottom = point(-bottomSpread / 2, 0), rightBottom = point(bottomSpread / 2, 0);
    const leftTop = point(-topSpread / 2, supportHeight), rightTop = point(topSpread / 2, supportHeight);
    const centerBottom = point(0, 0), centerTop = point(0, supportHeight);
    if (supportStyle === "a-frame") {
      beams.push([leftBottom, leftTop], [rightBottom, rightTop]);
      plates.push(leftBottom, rightBottom, centerTop);
    } else if (supportStyle === "y-frame") {
      const split = point(0, supportHeight * 0.56);
      beams.push([centerBottom, split], [split, leftTop], [split, rightTop]);
      plates.push(centerBottom, centerTop);
    } else if (supportStyle === "v-frame") {
      beams.push([centerBottom, leftTop], [centerBottom, rightTop]);
      plates.push(centerBottom, centerTop);
    } else if (supportStyle === "x-brace") {
      beams.push([leftBottom, rightTop], [rightBottom, leftTop]);
      plates.push(leftBottom, rightBottom, leftTop, rightTop);
    } else if (supportStyle === "k-brace") {
      const middle = point(0, supportHeight / 2), leftTopPoint = point(-bottomSpread / 2, supportHeight);
      beams.push([centerBottom, centerTop], [leftBottom, middle], [leftTopPoint, middle]);
      plates.push(leftBottom, centerBottom, leftTopPoint, centerTop);
    } else if (supportStyle === "single-strut") {
      beams.push([leftBottom, rightTop]);
      plates.push(leftBottom, rightTop);
    } else if (supportStyle === "tripod") {
      const footDepth = Math.max(0.2, finite(node.braceTopSpread, 1.1));
      const feet = [point(0, 0, -footDepth / 2), point(-bottomSpread / 2, 0, footDepth / 2), point(bottomSpread / 2, 0, footDepth / 2)];
      feet.forEach((foot) => beams.push([foot, centerTop]));
      plates.push(...feet, centerTop);
    } else if (supportStyle === "trestle") {
      const frameDepth = Math.max(0.2, finite(node.braceTopSpread, 1));
      for (const z of [-frameDepth / 2, frameDepth / 2]) {
        const top = point(0, supportHeight, z), lb = point(-bottomSpread / 2, 0, z), rb = point(bottomSpread / 2, 0, z);
        beams.push([lb, top], [rb, top]);
        plates.push(lb, rb, top);
      }
      beams.push([point(0, supportHeight, -frameDepth / 2), point(0, supportHeight, frameDepth / 2)]);
    } else if (supportStyle === "portal-frame") {
      const lb = point(-bottomSpread / 2, 0), rb = point(bottomSpread / 2, 0), lt = point(-bottomSpread / 2, supportHeight), rt = point(bottomSpread / 2, supportHeight);
      beams.push([lb, lt], [rb, rt], [lt, rt]);
      plates.push(lb, rb, lt, rt);
    } else if (supportStyle === "box-frame") {
      const w = bottomSpread, d = Math.max(0.2, finite(node.braceTopSpread, 1));
      const corners = [point(-w / 2, 0, -d / 2), point(w / 2, 0, -d / 2), point(w / 2, 0, d / 2), point(-w / 2, 0, d / 2)];
      const topCorners = corners.map((corner) => point(corner.x, supportHeight, corner.z));
      corners.forEach((corner, index) => {
        beams.push([corner, topCorners[index]!], [corner, corners[(index + 1) % 4]!], [topCorners[index]!, topCorners[(index + 1) % 4]!]);
      });
      plates.push(...corners, ...topCorners);
    }
    for (const [start, end] of beams) {
      const delta = end.clone().sub(start), length = delta.length();
      if (length <= 0.001) continue;
      const geometry = new BoxGeometry(braceWidth, length, braceDepth);
      geometry.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), delta.normalize()));
      add(geometry, (start.x + end.x) / 2, (start.y + end.y) / 2, (start.z + end.z) / 2);
    }
    if (node.bracePlateEnabled !== false) {
      const plateHeight = Math.max(0.035, Math.min(0.08, braceWidth * 0.45));
      const plateWidth = braceWidth * 1.9, plateDepth = braceDepth * 1.75;
      for (const plate of plates) {
        const y = plate.y <= 0 ? plateHeight / 2 : supportHeight - plateHeight / 2;
        box(plateWidth, plateHeight, plateDepth, y - plateHeight / 2, finite(node.edgeSoftness, 0.025), plate.x, plate.z);
      }
    }
    return drafts.map(({ geometry, position }) => ({ geometry, position: [position.x, position.y, position.z], rotationY: 0 }));
  }

  addColumnEnd(baseStyle, baseHeight, 0, finite(node.baseWidthScale, 1.24), finite(node.baseDepthScale, 1.24));

  // The canonical cluster shaft is one central pier plus four satellites.
  const cluster = node.style === "cluster";
  const shaftAxes: Array<[number, number, number]> = cluster
    ? [
        [0, 0, radius * 0.62],
        [Math.max(radius * 0.78, width * 0.22), 0, radius * 0.36],
        [-Math.max(radius * 0.78, width * 0.22), 0, radius * 0.36],
        [0, Math.max(radius * 0.78, width * 0.22), radius * 0.36],
        [0, -Math.max(radius * 0.78, width * 0.22), radius * 0.36],
      ]
    : [[0, 0, radius]];
  const profile = String(node.shaftProfile ?? "straight");
  const twistStep = finite(node.shaftTwistStep, 0);
  const shaftSegments = Math.max(Math.abs(twistStep) > 0.001 ? 4 : 1, profile === "straight" && finite(node.shaftTaper, 0) <= 0 && !twistStep ? 1 : Math.round(finite(node.shaftSegmentCount, 24)));
  const shaftTaper = Math.min(finite(node.shaftTaper, 0), 0.85);
  const bulge = finite(node.shaftBulge, profile === "bulged" ? 0.16 : profile === "baluster" ? 0.2 : profile === "hourglass" ? 0.18 : 0);
  const scaleAt = (t: number) => {
    const linear = (finite(node.shaftStartScale, 0.72) + (finite(node.shaftEndScale, finite(node.shaftStartScale, 0.72)) - finite(node.shaftStartScale, 0.72)) * t) * (1 - shaftTaper * t);
    const bulgeCurve = Math.sin(Math.PI * t);
    const hourglass = Math.abs(t - 0.5) * 2;
    const value = profile === "bulged" || profile === "baluster" ? linear + bulge * bulgeCurve : profile === "hourglass" ? linear - bulge * (1 - hourglass) : linear;
    return Math.max(0.1, value);
  };

  for (const [offsetX, offsetZ, clusterRadius] of shaftAxes) {
    if (cluster) {
      cylinder(shaftHeight, clusterRadius, shaftY, offsetX, offsetZ, 24);
      continue;
    }
    if (!isRound && finite(node.shaftCornerRadius, 0.035) > 0.001) {
      const stepHeight = shaftHeight / shaftSegments;
      for (let index = 0; index < shaftSegments; index += 1) {
        const t = (index + 0.5) / shaftSegments;
        const scale = scaleAt(t);
        const yaw = index * twistStep * Math.PI / 180;
        const bevel = Math.min(finite(node.shaftCornerRadius, 0.035) * scale, Math.min(width, depth) * scale * 0.45);
        box(width * scale, stepHeight * 1.015, depth * scale, shaftY + index * stepHeight, bevel, offsetX, offsetZ, yaw);
      }
    } else {
      const stepHeight = shaftHeight / shaftSegments;
      for (let index = 0; index < shaftSegments; index += 1) {
        const t = (index + 0.5) / shaftSegments;
        const scale = scaleAt(t);
        const yaw = index * twistStep * Math.PI / 180;
        cylinder(stepHeight * 1.015, radius * scale, shaftY + index * stepHeight, offsetX, offsetZ, segments, 1, 1, radius * scale, radius * scale, yaw);
      }
    }
  }

  // Canonical shaft rings / lathe bands / flutes / lower band decorations.
  const ringCount = Math.max(0, Math.min(16, Math.round(finite(node.ringCount, 0))));
  const ringSpread = Math.min(0.45, Math.max(0.04, finite(node.ringSpread, 0.16)));
  const ringHeight = Math.min(finite(node.ringThickness, 0.055), shaftHeight / Math.max(8, ringCount * 3));
  for (let index = 0; index < ringCount; index += 1) {
    const pair = Math.floor(index / 2), nearTop = index % 2 === 1;
    const offset = Math.min(0.48, 0.06 + pair / Math.max(1, Math.ceil(ringCount / 2) - 1) * Math.max(0, ringSpread - 0.06));
    const linear = 0.06 + index / Math.max(1, ringCount - 1) * Math.max(0, ringSpread - 0.06);
    const t = node.ringPlacement === "even" ? (index + 1) / (ringCount + 1) : node.ringPlacement === "top" ? 1 - Math.min(0.48, linear) : node.ringPlacement === "bottom" ? Math.min(0.48, linear) : nearTop ? 1 - offset : offset;
    block(ringHeight, shaftY + shaftHeight * t - ringHeight / 2, Math.min(1.4, scaleAt(t) + 0.12));
  }

  const latheCount = Math.max(Math.round(finite(node.latheRingCount, 0)), node.shaftDetail === "lathe-turned" ? 8 : 0);
  const latheHeight = Math.min(0.04, shaftHeight / Math.max(12, latheCount * 3));
  for (let index = 0; index < latheCount; index += 1) {
    const placement = node.latheRingSpacing ?? "ends";
    const nearTop = index % 2 === 1, offset = Math.min(0.48, 0.1 + Math.floor(index / 2) * 0.04);
    const t = placement === "even" ? (index + 1) / (latheCount + 1) : placement === "top" ? 1 - Math.min(0.48, 0.08 + index * 0.04) : placement === "bottom" ? Math.min(0.48, 0.08 + index * 0.04) : nearTop ? 1 - offset : offset;
    block(latheHeight, shaftY + shaftHeight * t - latheHeight / 2, 0.82 + (index % 2) * 0.08);
  }

  const fluteCount = Math.max(Math.round(finite(node.fluteCount, 0)), node.shaftDetail === "fluted" ? 16 : 0);
  if (fluteCount > 0 && node.crossSection === "round") {
    const fluteRadius = Math.max(0.006, finite(node.fluteWidth, finite(node.fluteDepth, 0.02)) * 0.42);
    for (let index = 0; index < fluteCount; index += 1) {
      const angle = index / fluteCount * Math.PI * 2;
      cylinder(shaftHeight * 0.92, fluteRadius, shaftY + shaftHeight * 0.04, Math.cos(angle) * radius * 0.74, Math.sin(angle) * radius * 0.74, 8, 1, 1, fluteRadius, fluteRadius, -angle);
    }
  }

  const panelCount = Math.max(Math.round(finite(node.panelCount, 0)), node.style === "dravidian-carved" || node.shaftDetail === "panelled" ? 3 : 0);
  if (panelCount > 0 && shaftHeight > 0) {
    const shaftWidth = width * 0.72, shaftDepth = depth * 0.72;
    const panelHeight = Math.min(0.42, shaftHeight / Math.max(4, panelCount + 2));
    const panelWidth = width * 0.26, rail = Math.max(0.012, width * 0.028), relief = Math.max(0.012, finite(node.panelInsetDepth, width * 0.025));
    const panelShape = node.panelShape ?? "rectangle";
    for (let row = 0; row < panelCount; row += 1) {
      const centerY = shaftY + shaftHeight * (row + 1) / (panelCount + 1);
      for (const face of [
        { x: 0, z: shaftDepth / 2 + relief / 2, yaw: 0 },
        { x: 0, z: -shaftDepth / 2 - relief / 2, yaw: 0 },
        { x: shaftWidth / 2 + relief / 2, z: 0, yaw: Math.PI / 2 },
        { x: -shaftWidth / 2 - relief / 2, z: 0, yaw: Math.PI / 2 },
      ]) {
        box(panelWidth, rail, relief, centerY + panelHeight / 2 - rail / 2, 0, face.x, face.z, face.yaw);
        box(panelWidth, rail, relief, centerY - panelHeight / 2 - rail / 2, 0, face.x, face.z, face.yaw);
        box(rail, panelHeight, relief, centerY - panelHeight / 2, 0, face.x - panelWidth / 2 + rail / 2, face.z, face.yaw);
        box(rail, panelHeight, relief, centerY - panelHeight / 2, 0, face.x + panelWidth / 2 - rail / 2, face.z, face.yaw);
        if (panelShape === "diamond") box(rail * 1.2, panelHeight * 0.42, relief, centerY - panelHeight * 0.21, 0, face.x, face.z, face.yaw + Math.PI / 4);
        if (panelShape === "arched") torus(panelWidth * 0.42, Math.max(rail, relief) * 0.18, face.x, centerY + panelHeight * 0.28, face.z, face.yaw, relief / Math.max(rail, relief));
      }
    }
  }

  const spiralTwist = finite(node.spiralTwist, 0);
  const spiralRibCount = Math.min(24, Math.max(Math.round(finite(node.spiralRibCount, 0)), node.shaftDetail === "spiral" ? 12 : 0));
  if (spiralRibCount > 0 && spiralTwist !== 0 && shaftHeight > 0) {
    const stepCount = 28, ribDistance = radius * 0.78, ribWidth = Math.max(0.012, radius * 0.06);
    for (let step = 0; step < stepCount; step += 1) {
      const t = (step + 0.5) / stepCount;
      for (let rib = 0; rib < spiralRibCount; rib += 1) {
        const angle = rib / spiralRibCount * Math.PI * 2 + t * spiralTwist * Math.PI * 2;
        const taperScale = 1 - shaftTaper * t;
        const geometry = createColumnCylinderGeometry({ height: shaftHeight / stepCount * 1.18, radiusBottom: ribWidth, radiusTop: ribWidth, segments: 8 });
        geometry.applyQuaternion(new Quaternion().setFromEuler(new Euler(0, -angle, spiralTwist > 0 ? -0.55 : 0.55)));
        add(geometry, Math.cos(angle) * ribDistance * taperScale, shaftY + shaftHeight * t, Math.sin(angle) * ribDistance * taperScale);
      }
    }
  }

  // Capital style tiers and its saved decorative controls.
  if (["south-indian-bracket", "wood-bracket"].includes(capitalStyle)) {
    const tiers = Math.max(1, Math.round(finite(node.bracketTierCount, 3)));
    for (let index = 0; index < tiers; index += 1) {
      const t = index / Math.max(1, tiers - 1), scale = finite(node.capitalWidthScale, 1.6) + t * 0.32;
      box(width * scale + finite(node.bracketDepth, 0.35) * t, capitalHeight / tiers, depth * scale + finite(node.bracketDepth, 0.35) * t, capitalY + index * capitalHeight / tiers);
    }
    const pendantCount = Math.max(0, Math.round(finite(node.pendantCount, 0)));
    for (let index = 0; index < pendantCount; index += 1) {
      const angle = index / pendantCount * Math.PI * 2, distance = Math.max(width, depth) * 0.56;
      cone(capitalHeight * 0.28, 0.035, 0.035, Math.cos(angle) * distance, capitalY - capitalHeight * 0.1, Math.sin(angle) * distance, -angle, 0, 6);
    }
  } else if (["rounded", "doric"].includes(capitalStyle)) {
    const w = width * finite(node.capitalWidthScale, 1.34), d = depth * finite(node.capitalDepthScale, 1.34);
    cylinder(capitalHeight * 0.24, 1, capitalY, 0, 0, 32, w * 0.36, d * 0.36, w * 0.36, w * 0.36);
    cylinder(capitalHeight * 0.32, 1, capitalY + capitalHeight * 0.24, 0, 0, 32, w * 0.46, d * 0.46, w * 0.46, w * 0.46);
    box(w, capitalHeight * 0.44, d, capitalY + capitalHeight * 0.56);
  } else if (capitalStyle === "stepped") {
    const count = Math.max(3, Math.round(finite(node.capitalTierCount, 3))), spread = finite(node.capitalStepSpread, 0.42), ws = finite(node.capitalWidthScale, 1.46), ds = finite(node.capitalDepthScale, ws);
    for (let index = 0; index < count; index += 1) {
      const t = index / Math.max(1, count - 1);
      box(width * Math.max(0.5, ws - (1 - t) * spread), capitalHeight / count * 1.01, depth * Math.max(0.5, ds - (1 - t) * spread), capitalY + index * capitalHeight / count);
    }
  } else if (["volute", "ionic-volute", "leaf-carved", "corinthian-leaf"].includes(capitalStyle)) {
    block(capitalHeight * 0.24, capitalY, 0.9);
    block(capitalHeight * 0.2, capitalY + capitalHeight * 0.24, 1.08);
    box(width * finite(node.capitalWidthScale, 1.46), capitalHeight * 0.28, depth * finite(node.capitalDepthScale, 1.46), capitalY + capitalHeight * 0.44);
    if (["volute", "ionic-volute"].includes(capitalStyle)) {
      const count = Math.max(0, Math.min(8, Math.round(finite(node.voluteCount, 4)))), r = finite(node.voluteSize, Math.min(0.085, Math.max(0.04, width * 0.12)));
      for (let index = 0; index < count; index += 1) {
        const angle = index / Math.max(1, count) * Math.PI * 2;
        torus(r, r * 0.18, Math.cos(angle) * width * 0.55, capitalY + capitalHeight * 0.62, Math.sin(angle) * depth * 0.7, angle, 0.28);
      }
    }
    if (["leaf-carved", "corinthian-leaf"].includes(capitalStyle)) {
      const count = Math.max(0, Math.min(48, Math.round(finite(node.leafCount, node.crossSection === "round" ? 18 : 12))));
      const rows = Math.max(0, Math.min(4, Math.round(finite(node.leafRows, 2))));
      const distance = Math.max(radius * 1.05, Math.max(width, depth) * 0.48);
      for (let row = 0; row < rows; row += 1) for (let index = 0; index < count; index += 1) {
        const angle = index / Math.max(1, count) * Math.PI * 2 + (row % 2 ? Math.PI / Math.max(1, count) : 0);
        cone(capitalHeight * Math.max(0.1, 0.28 - row * 0.04), 0.018, 0.01, Math.cos(angle) * distance, capitalY + capitalHeight * (0.3 + row * 0.16), Math.sin(angle) * distance, -angle, 0.48, 6);
      }
    }
  } else if (capitalStyle !== "none") {
    if (!isRound) box(width * finite(node.capitalWidthScale, capitalStyle === "simple-slab" ? 1.28 : 1.18), capitalHeight, depth * finite(node.capitalDepthScale, 1.28), capitalY);
    else cylinder(capitalHeight, Math.max(radius * finite(node.capitalWidthScale, 1.18), width * 0.5), capitalY, 0, 0, segments);
  }

  const carvingPlacement = String(node.carvingPlacement ?? "capital");
  const carvingAllowed = (place: string) => carvingPlacement === "all" || carvingPlacement === place;
  const baseCarving = Math.max(0, Math.min(4, Math.round(finite(node.baseCarvingLevel, 0))));
  if (baseCarving > 0 && baseHeight > 0 && carvingAllowed("base")) {
    const count = Math.max(8, baseCarving * 8), distance = Math.max(radius * 1.04, Math.max(width, depth) * 0.5);
    for (let index = 0; index < count; index += 1) {
      const angle = index / count * Math.PI * 2;
      cone(baseHeight * 0.28, 0.014, 0.01, Math.cos(angle) * distance, baseHeight * 0.52, Math.sin(angle) * distance, -angle, 0.36, 5);
    }
  }

  const capitalCarving = Math.max(Math.round(finite(node.carvingLevel, 0)), Math.round(finite(node.capitalCarvingLevel, 0)));
  const bandSetting = Math.max(0, Math.round(finite(node.capitalBandCount, 0)));
  if (capitalHeight > 0 && (capitalCarving > 0 || bandSetting > 0) && carvingAllowed("capital")) {
    const level = Math.min(4, Math.max(capitalCarving, bandSetting > 0 ? 1 : 0)), bandHeight = Math.min(0.035, capitalHeight / 8), count = Math.min(16, bandSetting > 0 ? bandSetting : level + 1);
    for (let index = 0; index < count; index += 1) {
      const y = capitalY + capitalHeight * (index + 1) / (count + 1) - bandHeight / 2;
      block(bandHeight, y, isRound ? 1.24 : 1.28);
    }
    const dentils = Math.max(Math.round(finite(node.dentilCount, 0)), level * 4, 4), dentilH = Math.min(0.08, capitalHeight * 0.28), dentilDepth = Math.min(0.08, Math.min(width, depth) * 0.16), dentilWidth = Math.max(0.025, width / (dentils * 1.75));
    for (let index = 0; index < dentils; index += 1) {
      const t = index / Math.max(1, dentils - 1);
      if (!isRound) {
        const x = -width * 0.56 + t * width * 1.12, z = -depth * 0.56 + t * depth * 1.12;
        box(dentilWidth, dentilH, dentilDepth, capitalY + capitalHeight * 0.14, 0, x, depth * 0.56);
        box(dentilWidth, dentilH, dentilDepth, capitalY + capitalHeight * 0.14, 0, x, -depth * 0.56);
        box(dentilDepth, dentilH, dentilWidth, capitalY + capitalHeight * 0.14, 0, width * 0.56, z);
        box(dentilDepth, dentilH, dentilWidth, capitalY + capitalHeight * 0.14, 0, -width * 0.56, z);
      } else {
        const angle = t * Math.PI * 2;
        sphere(Math.max(0.012, Math.min(0.03, radius * 0.12)), Math.cos(angle) * radius * 1.24, capitalY + capitalHeight * 0.24, Math.sin(angle) * radius * 1.24);
      }
    }
  }

  // The canonical lower carved shaft band and its repeating relief.
  if (node.lowerBandEnabled && shaftHeight > 0 && carvingAllowed("shaft")) {
    const bandHeight = Math.min(finite(node.lowerBandHeight, 0.24), shaftHeight * 0.35), y = shaftY + shaftHeight * 0.12;
    block(bandHeight, y, 0.84);
    const count = Math.max(6, Math.round(finite(node.lowerBandCarvingLevel, 1)) * 6), distance = Math.max(radius * 0.82, Math.max(width, depth) * 0.36);
    for (let index = 0; index < count; index += 1) {
      const angle = index / count * Math.PI * 2;
      cylinder(bandHeight * 0.62, 0.012, y + bandHeight * 0.19, Math.cos(angle) * distance, Math.sin(angle) * distance, 5, 1, 1, 0.012, 0.012, -angle);
    }
  }

  // Convert local meshes into canonical column-local geometry parts. Keeping
  // individual parts preserves the viewer's bevel/UV surface treatment.
  return drafts.map(({ geometry, position }) => ({
    geometry,
    position: [position.x, position.y, position.z],
    rotationY: 0,
  }));
}
