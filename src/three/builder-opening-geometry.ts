import { BoxGeometry, Euler, ExtrudeGeometry, MathUtils, Matrix4, Shape, Vector3 } from "three";
import { BUILDER_DEFAULT_DOOR_SIZE, BUILDER_DEFAULT_WINDOW_SIZE } from "../geometry/effective-building";
import type { NodeData } from "../types";

/**
 * Read-only subset of Builder's DoorRenderer/WindowRenderer geometry (dsphere-main
 * packages/viewer/src/systems/{door,window}/*-system.tsx). This Demo pins SDK
 * 0.9.2 and intentionally keeps this adapter local; it does not dynamically
 * import the mutable dsphere workspace or attach authoring tools.
 */
export type BuilderOpeningPart = {
  geometry: BoxGeometry | ExtrudeGeometry;
  position: [number, number, number];
  rotationY: number;
  materialRole: "joinery" | "glazing";
  name: string;
};

export type BuilderOpeningGeometry = {
  /** Parts are centered at the opening's local origin (X width, Y up, Z depth). */
  parts: BuilderOpeningPart[];
  /** Same-local-coordinate solid used for the matching wall cut. */
  cutGeometry: ExtrudeGeometry;
  diagnostics: string[];
};

type OpeningNode = NodeData & Record<string, any>;
const n = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const positive = (value: unknown, fallback: number) => Math.max(0, n(value, fallback));
const arrayRatios = (value: unknown): number[] => Array.isArray(value) && value.length && value.every((x) => Number.isFinite(x) && x > 0) ? value as number[] : [1];
const isDoor = (node: OpeningNode) => node.type === "Door" || node.type === "door";
const effectiveOpeningShape = (node: OpeningNode) => isDoor(node) && ["folding", "pocket", "barn", "sliding"].includes(node.doorType)
  ? "rectangle"
  : (node.openingShape ?? "rectangle");

function addBox(parts: BuilderOpeningPart[], name: string, role: BuilderOpeningPart["materialRole"], width: number, height: number, depth: number, x: number, y: number, z: number, rotationY = 0) {
  if ([width, height, depth].some((v) => !Number.isFinite(v) || v <= 0.0001)) return;
  parts.push({ geometry: new BoxGeometry(width, height, depth), position: [x, y, z], rotationY, materialRole: role, name });
}

function normalizedRadii(radii: { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number }, width: number, height: number) {
  const scale = Math.min(
    1,
    width / Math.max(radii.topLeft + radii.topRight, 1e-6),
    width / Math.max(radii.bottomLeft + radii.bottomRight, 1e-6),
    height / Math.max(radii.topLeft + radii.bottomLeft, 1e-6),
    height / Math.max(radii.topRight + radii.bottomRight, 1e-6),
  );
  return Object.fromEntries(Object.entries(radii).map(([key, radius]) => [key, radius * scale])) as typeof radii;
}

/** Builder-order perimeter path; exported so callers/tests can share the exact cut outline. */
export function createBuilderOpeningShape(rawNode: NodeData, width?: number, height?: number): Shape {
  const node = rawNode as OpeningNode;
  const defaults = isDoor(node) ? BUILDER_DEFAULT_DOOR_SIZE : BUILDER_DEFAULT_WINDOW_SIZE;
  const actualWidth = positive(width ?? node.width, defaults.width), actualHeight = positive(height ?? node.height, defaults.height);
  const left = -actualWidth / 2, right = actualWidth / 2, bottom = -actualHeight / 2, top = actualHeight / 2;
  const shape = new Shape();
  const form = effectiveOpeningShape(node);
  if (form === "arch") {
    shape.moveTo(left, bottom);
    shape.lineTo(right, bottom);
    const rise = Math.min(positive(node.archHeight, actualWidth / 2), actualHeight);
    const springY = top - rise;
    shape.lineTo(right, springY);
    const segments = 32;
    for (let index = 1; index <= segments; index++) {
      const x = right + (left - right) * (index / segments);
      const dx = Math.abs(x) / (actualWidth / 2);
      shape.lineTo(x, springY + rise * Math.sqrt(Math.max(1 - dx * dx, 0)));
    }
    shape.lineTo(left, bottom);
  } else if (form === "rounded") {
    const fallback = Math.min(positive(node.cornerRadius, 0.15), actualWidth / 2, actualHeight / 2);
    let radii: { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number };
    if (isDoor(node)) {
      const source = node.openingRadiusMode === "individual" && Array.isArray(node.openingTopRadii)
        ? node.openingTopRadii
        : [fallback, fallback];
      let [topLeft, topRight] = source.map((r: unknown) => positive(r, 0));
      const scale = Math.min(1, actualWidth / Math.max(topLeft + topRight, 1e-6), actualHeight / Math.max(topLeft, 1e-6), actualHeight / Math.max(topRight, 1e-6));
      topLeft *= scale; topRight *= scale;
      radii = { topLeft, topRight, bottomRight: 0, bottomLeft: 0 };
    } else if (node.openingRadiusMode === "individual") {
      const values = Array.isArray(node.openingCornerRadii) ? node.openingCornerRadii : [0.15, 0.15, 0.15, 0.15];
      radii = normalizedRadii({ topLeft: positive(values[0], 0), topRight: positive(values[1], 0), bottomRight: positive(values[2], 0), bottomLeft: positive(values[3], 0) }, actualWidth, actualHeight);
    } else {
      radii = { topLeft: fallback, topRight: fallback, bottomRight: fallback, bottomLeft: fallback };
    }
    const { topLeft, topRight, bottomRight, bottomLeft } = radii;
    // Same clockwise perimeter and arc centers as Builder createRoundedShape.
    shape.moveTo(left + bottomLeft, bottom);
    shape.lineTo(right - bottomRight, bottom);
    if (bottomRight > 1e-6) shape.absarc(right - bottomRight, bottom + bottomRight, bottomRight, -Math.PI / 2, 0, false);
    else shape.lineTo(right, bottom);
    shape.lineTo(right, top - topRight);
    if (topRight > 1e-6) shape.absarc(right - topRight, top - topRight, topRight, 0, Math.PI / 2, false);
    else shape.lineTo(right, top);
    shape.lineTo(left + topLeft, top);
    if (topLeft > 1e-6) shape.absarc(left + topLeft, top - topLeft, topLeft, Math.PI / 2, Math.PI, false);
    else shape.lineTo(left, top);
    shape.lineTo(left, bottom + bottomLeft);
    if (bottomLeft > 1e-6) shape.absarc(left + bottomLeft, bottom + bottomLeft, bottomLeft, Math.PI, Math.PI * 1.5, false);
    else shape.lineTo(left, bottom);
    shape.closePath();
  } else {
    shape.moveTo(left, bottom);
    shape.lineTo(right, bottom);
    shape.lineTo(right, top);
    shape.lineTo(left, top);
    shape.lineTo(left, bottom);
    shape.closePath();
  }
  return shape;
}

function buildCut(node: OpeningNode, width: number, height: number, depth: number): ExtrudeGeometry {
  const cutDepth = Math.max(depth, 0.01);
  const geometry = new ExtrudeGeometry(createBuilderOpeningShape(node, width, height), { depth: cutDepth, bevelEnabled: false, curveSegments: 24, steps: 1 });
  geometry.translate(0, 0, -cutDepth / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function addRatiosGrid(parts: BuilderOpeningPart[], options: { prefix: string; width: number; height: number; depth: number; centerX: number; centerY: number; z: number; columns: number[]; rows: number[]; columnDivider: number; rowDivider: number; frame: number; glass: boolean }) {
  const innerW = options.width - options.frame * 2, innerH = options.height - options.frame * 2;
  if (innerW <= 0 || innerH <= 0) return;
  const colSum = options.columns.reduce((a, b) => a + b, 0), rowSum = options.rows.reduce((a, b) => a + b, 0);
  const usableW = innerW - (options.columns.length - 1) * options.columnDivider;
  const usableH = innerH - (options.rows.length - 1) * options.rowDivider;
  if (usableW <= 0 || usableH <= 0) return;
  const colWidths = options.columns.map((r) => (r / colSum) * usableW);
  const rowHeights = options.rows.map((r) => (r / rowSum) * usableH);
  let x = options.centerX - innerW / 2;
  const centersX = colWidths.map((w, i) => { const center = x + w / 2; x += w + (i < colWidths.length - 1 ? options.columnDivider : 0); return center; });
  let yTop = options.centerY + innerH / 2;
  const centersY = rowHeights.map((h, i) => { const center = yTop - h / 2; yTop -= h + (i < rowHeights.length - 1 ? options.rowDivider : 0); return center; });
  x = options.centerX - innerW / 2;
  for (let c = 0; c < colWidths.length - 1; c++) {
    x += colWidths[c]!;
    addBox(parts, `${options.prefix}-column-divider-${c}`, "joinery", options.columnDivider, innerH, options.depth, x + options.columnDivider / 2, options.centerY, options.z);
    x += options.columnDivider;
  }
  yTop = options.centerY + innerH / 2;
  for (let r = 0; r < rowHeights.length - 1; r++) {
    yTop -= rowHeights[r]!;
    for (let c = 0; c < colWidths.length; c++) addBox(parts, `${options.prefix}-row-divider-${r}-${c}`, "joinery", colWidths[c]!, options.rowDivider, options.depth, centersX[c]!, yTop - options.rowDivider / 2, options.z);
    yTop -= options.rowDivider;
  }
  if (options.glass) {
    const glassDepth = Math.max(0.004, options.depth * 0.08);
    colWidths.forEach((w, c) => rowHeights.forEach((h, r) => addBox(parts, `${options.prefix}-pane-${c}-${r}`, "glazing", w, h, glassDepth, centersX[c]!, centersY[r]!, options.z)));
  }
}

function buildWindow(node: OpeningNode, width: number, height: number, frame: number, frameDepth: number, parts: BuilderOpeningPart[]) {
  const innerH = height - 2 * frame;
  addBox(parts, "window-frame-top", "joinery", width, frame, frameDepth, 0, height / 2 - frame / 2, 0);
  addBox(parts, "window-frame-bottom", "joinery", width, frame, frameDepth, 0, -height / 2 + frame / 2, 0);
  addBox(parts, "window-frame-left", "joinery", frame, innerH, frameDepth, -width / 2 + frame / 2, 0, 0);
  addBox(parts, "window-frame-right", "joinery", frame, innerH, frameDepth, width / 2 - frame / 2, 0, 0);
  addRatiosGrid(parts, { prefix: "window", width, height, depth: frameDepth, centerX: 0, centerY: 0, z: 0, columns: arrayRatios(node.columnRatios), rows: arrayRatios(node.rowRatios), columnDivider: positive(node.columnDividerThickness, 0.03), rowDivider: positive(node.rowDividerThickness, 0.03), frame, glass: true });
  if (node.sill === true) {
    const sillDepth = positive(node.sillDepth, 0.08), sillThickness = positive(node.sillThickness, 0.03);
    addBox(parts, "window-sill", "joinery", width + sillDepth * 0.4, sillThickness, sillDepth, 0, -height / 2 - sillThickness / 2, frameDepth / 2 + sillDepth / 2);
  }
}

function buildDoor(node: OpeningNode, width: number, height: number, frame: number, frameDepth: number, parts: BuilderOpeningPart[], diagnostics: string[]) {
  const type = node.doorType ?? "hinged";
  if (type !== "hinged" && type !== "barn") diagnostics.push(`door_variant_fallback:${String(type)}:rendered_as_hinged`);
  const frameT = Math.min(frame, width / 2, height / 2), innerW = width - 2 * frameT, innerH = height - frameT;
  addBox(parts, "door-frame-top", "joinery", width, frameT, frameDepth, 0, height / 2 - frameT / 2, 0);
  addBox(parts, "door-frame-left", "joinery", frameT, innerH, frameDepth, -width / 2 + frameT / 2, -frameT / 2, 0);
  addBox(parts, "door-frame-right", "joinery", frameT, innerH, frameDepth, width / 2 - frameT / 2, -frameT / 2, 0);
  if (node.threshold !== false) addBox(parts, "door-threshold", "joinery", width, positive(node.thresholdHeight, 0.02), frameDepth, 0, -height / 2 + positive(node.thresholdHeight, 0.02) / 2, 0);
  const padding = Array.isArray(node.contentPadding) ? node.contentPadding : [0.04, 0.04];
  const padX = positive(padding[0], 0.04), padY = positive(padding[1], 0.04);
  const leafWidth = Math.max(0.01, innerW), leafHeight = Math.max(0.01, height - 2 * frameT);
  const leafCenterY = -frameT / 2;
  let leafCenterX = 0, leafYaw = 0;
  if (type === "barn") {
    const open = MathUtils.clamp(n(node.operationState, 0), 0, 1);
    const direction = node.slideDirection === "right" ? 1 : -1;
    leafCenterX = direction * innerW * open;
    addBox(parts, "barn-track", "joinery", innerW * 2.25, 0.035, 0.035, direction * innerW * 0.56, height / 2 + Math.max(frameT * 0.55, 0.045), frameDepth / 2 + 0.05);
    for (const side of [-1, 1]) addBox(parts, `barn-stop-${side}`, "joinery", 0.05, 0.13, 0.035, side * innerW / 2, height / 2 + 0.02, frameDepth / 2 + 0.05);
  } else {
    // Builder persists hinged pose in `swingAngle`; `operationState` is used
    // by sliding families (barn) and runtime controls, not a hinged angle scale.
    const maxAngle = MathUtils.clamp(n(node.swingAngle, 0), 0, Math.PI / 2);
    const hingeSign = node.hingesSide === "right" ? 1 : -1;
    const directionSign = node.swingDirection === "outward" ? -1 : 1;
    leafYaw = hingeSign * directionSign * maxAngle;
    leafCenterX = hingeSign < 0 ? -innerW / 2 : innerW / 2;
  }
  const depth = Math.max(0.015, positive(node.leafDepth, frameDepth * 0.55));
  const rotatePoint = (x: number, y: number, z = 0): [number, number, number] => {
    if (type === "barn") return [x + leafCenterX, y, z + frameDepth / 2 + depth / 2 + 0.028];
    const localX = x - leafCenterX, c = Math.cos(leafYaw), s = Math.sin(leafYaw);
    return [leafCenterX + localX * c + z * s, y, -localX * s + z * c];
  };
  const box = (name: string, role: BuilderOpeningPart["materialRole"], w: number, h: number, d: number, x: number, y: number, z = 0) => {
    const center = rotatePoint(x, y, z);
    addBox(parts, name, role, w, h, d, center[0], center[1], center[2], type === "barn" ? 0 : leafYaw);
  };
  // Builder frames the leaf content using contentPadding and segment ratios.
  if (padY > 0) {
    box("door-leaf-frame-top", "joinery", leafWidth, padY, depth, 0, leafCenterY + leafHeight / 2 - padY / 2);
    box("door-leaf-frame-bottom", "joinery", leafWidth, padY, depth, 0, leafCenterY - leafHeight / 2 + padY / 2);
  }
  if (padX > 0) {
    box("door-leaf-frame-left", "joinery", padX, Math.max(0.01, leafHeight - 2 * padY), depth, -leafWidth / 2 + padX / 2, leafCenterY);
    box("door-leaf-frame-right", "joinery", padX, Math.max(0.01, leafHeight - 2 * padY), depth, leafWidth / 2 - padX / 2, leafCenterY);
  }
  const segments = Array.isArray(node.segments) && node.segments.length ? node.segments : [{ type: "panel", heightRatio: 1, columnRatios: [1], dividerThickness: 0.03, panelDepth: 0.01, panelInset: 0.04 }];
  const contentW = leafWidth - 2 * padX, contentH = leafHeight - 2 * padY;
  const totalHeightRatio = segments.reduce((sum: number, seg: any) => sum + positive(seg.heightRatio, 1), 0);
  let top = leafCenterY + contentH / 2;
  segments.forEach((seg: any, s: number) => {
    const segmentHeight = contentH * positive(seg.heightRatio, 1) / totalHeightRatio;
    const segmentTop = top, segmentBottom = top - segmentHeight, segCenterY = (segmentTop + segmentBottom) / 2;
    const columns = arrayRatios(seg.columnRatios), sum = columns.reduce((a, b) => a + b, 0);
    const divider = positive(seg.dividerThickness, 0.03), usableW = Math.max(0, contentW - (columns.length - 1) * divider);
    let x = -contentW / 2;
    columns.forEach((ratio, c) => {
      const w = usableW * ratio / sum, cx = x + w / 2;
      if (seg.type === "glass") box(`door-segment-${s}-glass-${c}`, "glazing", w, segmentHeight, Math.max(0.004, depth * 0.15), cx, segCenterY);
      if (seg.type === "panel") {
        box(`door-segment-${s}-panel-${c}`, "joinery", w, segmentHeight, depth, cx, segCenterY);
        const inset = positive(seg.panelInset, 0.04), panelW = w - inset * 2, panelH = segmentHeight - inset * 2;
        if (panelW > 0.01 && panelH > 0.01) box(`door-segment-${s}-inset-${c}`, "joinery", panelW, panelH, Math.max(0.005, positive(seg.panelDepth, 0.01)), cx, segCenterY, depth / 2 + Math.abs(n(seg.panelDepth, 0.01)) / 2);
      }
      x += w + divider;
    });
    // Divider members are explicit Builder geometry for multi-column segments.
    for (let c = 0; c < columns.length - 1; c++) {
      const dividerX = -contentW / 2 + usableW * columns.slice(0, c + 1).reduce((a, b) => a + b, 0) / sum + divider * c + divider / 2;
      box(`door-segment-${s}-divider-${c}`, "joinery", divider, segmentHeight, depth + 0.001, dividerX, segCenterY);
    }
    top = segmentBottom;
  });
  if (node.handle !== false) {
    const sign = node.handleSide === "left" ? -1 : 1;
    const handle = rotatePoint(sign * (leafWidth / 2 - 0.075), n(node.handleHeight, 1.05) - height / 2, depth / 2 + 0.025);
    addBox(parts, "door-handle", "joinery", 0.025, 0.12, 0.035, ...handle, type === "barn" ? 0 : leafYaw);
  }
  if (type === "barn") {
    const y = height / 2 + Math.max(frameT * 0.55, 0.045) - 0.075;
    for (const offset of [-leafWidth * 0.28, leafWidth * 0.28]) addBox(parts, `barn-roller-${offset}`, "joinery", 0.085, 0.085, 0.035, leafCenterX + offset, y, frameDepth / 2 + depth + 0.05);
  }
  if (!Number.isFinite(n(node.operationState, 0))) diagnostics.push("door_operation_state_invalid:closed_pose_used");
}

/** Build local display geometry and matching local wall-cut geometry from one saved node. */
export function buildBuilderOpeningGeometry(rawNode: NodeData, options: { cutDepth?: number } = {}): BuilderOpeningGeometry {
  const node = rawNode as OpeningNode;
  const diagnostics: string[] = [];
  const defaults = isDoor(node) ? BUILDER_DEFAULT_DOOR_SIZE : BUILDER_DEFAULT_WINDOW_SIZE;
  const width = positive(node.width, defaults.width), height = positive(node.height, defaults.height);
  const frame = Math.min(positive(node.frameThickness, 0.05), width / 2, height / 2);
  const frameDepth = positive(node.frameDepth, 0.07);
  const parts: BuilderOpeningPart[] = [];
  if (node.openingShape && !["rectangle", "rounded", "arch"].includes(node.openingShape)) diagnostics.push(`opening_shape_fallback:${String(node.openingShape)}:rectangle`);
  // A generous default makes the cutter suitable for typical wall thicknesses;
  // integrations should pass their host's `thickness * 4 + epsilon` explicitly.
  const cutGeometry = buildCut(node, width, height, positive(options.cutDepth, Math.max(frameDepth, 1)));
  if (node.openingKind !== "opening") {
    if (node.type === "Window" || node.type === "window") {
      const variant = node.windowType ?? "fixed";
      if (variant !== "fixed") diagnostics.push(`window_variant_fallback:${String(variant)}:fixed_frame`);
      if (effectiveOpeningShape(node) !== "rectangle") diagnostics.push(`window_shape_display_fallback:${String(node.openingShape)}:rectangular_frame_cut_shape_preserved`);
      buildWindow(node, width, height, frame, frameDepth, parts);
    } else if (node.type === "Door" || node.type === "door") {
      buildDoor(node, width, height, frame, frameDepth, parts, diagnostics);
      if (effectiveOpeningShape(node) !== "rectangle") diagnostics.push(`door_shape_display_fallback:${String(node.openingShape)}:rectangular_leaf_cut_shape_preserved`);
    } else {
      diagnostics.push(`opening_node_type_unsupported:${String(node.type)}`);
    }
  }
  return { parts, cutGeometry, diagnostics: [...new Set(diagnostics)] };
}

/** Transform opening-local coordinates into host-wall coordinates for render/cut callers. */
export function transformBuilderOpeningPoint(point: [number, number, number], opening: NodeData): [number, number, number] {
  const node = opening as OpeningNode;
  const pos = Array.isArray(node.position) ? node.position : [0, 0, 0];
  const rotation = Array.isArray(node.rotation) ? node.rotation : [0, 0, 0];
  const matrix = new Matrix4().makeRotationFromEuler(new Euler(n(rotation[0], 0), n(rotation[1], 0), n(rotation[2], 0), "XYZ"));
  const transformed = new Vector3(...point).applyMatrix4(matrix);
  return [transformed.x + n(pos[0], 0), transformed.y + n(pos[1], 0), transformed.z + n(pos[2], 0)];
}

export type BuilderOpeningWallTransform = {
  /** Opening center in world XZ plus its wall-local height; level Y remains caller-owned. */
  position: [number, number, number];
  /** Builder's wall mesh rotation; opening.rotation is a child-local Euler and stays separate. */
  wallRotationY: number;
  openingRotation: [number, number, number];
};

/**
 * Converts Builder wall-child coordinates to a parented display transform.
 * Builder rotates the parent wall mesh by `-atan2(dz, dx)` and then applies the
 * saved opening.rotation as the child Euler. Keeping these rotations separate
 * preserves source turns such as 2π/4π and front/back π without double-rotating.
 */
export function resolveBuilderOpeningWallTransform(opening: NodeData, wall: NodeData): BuilderOpeningWallTransform | null {
  if (wall.type.toLowerCase() !== "wall" || !Array.isArray(wall.start) || !Array.isArray(wall.end)) return null;
  const startX = n(wall.start[0], NaN), startZ = n(wall.start[1], NaN);
  const endX = n(wall.end[0], NaN), endZ = n(wall.end[1], NaN);
  const dx = endX - startX, dz = endZ - startZ, length = Math.hypot(dx, dz);
  if (![startX, startZ, endX, endZ].every(Number.isFinite) || !Number.isFinite(length) || length <= 1e-9) return null;
  const position = Array.isArray(opening.position) ? opening.position : [0, 0, 0];
  const localAlong = n(position[0], 0), localDepth = n(position[2], 0);
  const wallAngle = Math.atan2(dz, dx);
  const wallRotationY = -wallAngle;
  const c = Math.cos(wallAngle), s = Math.sin(wallAngle);
  const rotation = Array.isArray(opening.rotation) ? opening.rotation : [0, 0, 0];
  return {
    position: [startX + localAlong * c - localDepth * s, n(position[1], 0), startZ + localAlong * s + localDepth * c],
    wallRotationY,
    openingRotation: [n(rotation[0], 0), n(rotation[1], 0), n(rotation[2], 0)],
  };
}
