import type { Vec3 } from "../domain/overlay";
import { renderedWallFaceEndpoint } from "../geometry/walls/rendered-face-endpoint";

export type WallDimensionOpening = { id: string; start: number; end: number; bottomY?: number; topY?: number; type?: string };
/** A rendered wall span. `bottomY`/`topY` and opening elevations are world coordinates. */
export type WallDimensionFace = { id: string; start: Vec3; end: Vec3; halfThickness: number; levelId?: string; bottomY?: number; topY?: number; openings?: readonly WallDimensionOpening[] };
export type WallDimensionFrame = { face: WallDimensionFace; normal: Vec3; tangent: Vec3 };

export function wallReferenceMarkLabel(side: "左" | "右", millimeters: number, peer?: { name: string; envelope: boolean }): string {
  return peer ? `${peer.name} ${peer.envelope ? "外壳边" : "中心"} ${millimeters} mm` : `${side}基准 ${millimeters} mm`;
}

const dotXZ = (a: Vec3, b: Vec3) => a[0] * b[0] + a[2] * b[2];
const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit3 = (v: Vec3): Vec3 => { const length = Math.hypot(...v); return length > 1e-9 ? v.map(value => value === 0 ? 0 : value / length) as Vec3 : [0, 0, 0]; };

/** Build an orthonormal, right-handed canvas basis from an installation plane. */
export function surfaceDimensionTextBasis(normalHint: Vec3, upHint: Vec3, rightHint: Vec3): { right: Vec3; up: Vec3; normal: Vec3 } {
  const normal = unit3(normalHint), projectedUp: Vec3 = [upHint[0] - normal[0] * dot3(upHint, normal), upHint[1] - normal[1] * dot3(upHint, normal), upHint[2] - normal[2] * dot3(upHint, normal)];
  let up = unit3(projectedUp);
  if (Math.hypot(...up) < 1e-9) {
    const projectedRight: Vec3 = [rightHint[0] - normal[0] * dot3(rightHint, normal), rightHint[1] - normal[1] * dot3(rightHint, normal), rightHint[2] - normal[2] * dot3(rightHint, normal)];
    const right = unit3(projectedRight);
    up = unit3(cross3(normal, right));
  }
  const right = unit3(cross3(up, normal));
  up = unit3(cross3(normal, right));
  return { right, up, normal };
}

/** Select the nearest rendered wall span for an attachment, including segmented walls. */
export function nearestWallDimensionFrame(hostId: string, position: Vec3, normal: Vec3, faces: readonly WallDimensionFace[]): WallDimensionFrame | undefined {
  const candidates = faces.filter(face => face.id === hostId).flatMap(face => {
    const delta: Vec3 = [face.end[0] - face.start[0], 0, face.end[2] - face.start[2]], length = Math.hypot(delta[0], delta[2]);
    if (length < 1e-8) return [];
    const tangent: Vec3 = [delta[0] / length, 0, delta[2] / length];
    const t = Math.max(0, Math.min(length, dotXZ([position[0] - face.start[0], 0, position[2] - face.start[2]], tangent)));
    const nearest: Vec3 = [face.start[0] + tangent[0] * t, position[1], face.start[2] + tangent[2] * t];
    const sideNormal: Vec3 = [-tangent[2], 0, tangent[0]], sideLength = Math.hypot(normal[0], normal[2]);
    if (sideLength < 1e-8) return [];
    if (sideNormal[0] * normal[0] + sideNormal[2] * normal[2] < 0) { sideNormal[0] *= -1; sideNormal[2] *= -1; }
    return [{ face, tangent, normal: sideNormal.map(value => value === 0 ? 0 : value) as Vec3, distance: Math.hypot(position[0] - nearest[0], position[2] - nearest[2]) }];
  });
  const match = candidates.sort((a, b) => a.distance - b.distance)[0];
  return match ? { face: match.face, normal: match.normal, tangent: match.tangent } : undefined;
}

/** Project only the displayed mark onto the actual wall face; measurement witnesses stay untouched. */
export function projectDimensionPointToWall(point: Vec3, frame: WallDimensionFrame, lift = .006): Vec3 {
  const { face, normal, tangent } = frame, length = Math.hypot(face.end[0] - face.start[0], face.end[2] - face.start[2]);
  const along = Math.max(0, Math.min(length, dotXZ([point[0] - face.start[0], 0, point[2] - face.start[2]], tangent)));
  return [face.start[0] + tangent[0] * along + normal[0] * (face.halfThickness + lift), point[1], face.start[2] + tangent[2] * along + normal[2] * (face.halfThickness + lift)];
}

function renderedWallEndpoint(point: Vec3, frame: WallDimensionFrame, faces: readonly WallDimensionFace[], lift: number): Vec3 | undefined {
  const sameLevelWalls = faces.filter(face => face.levelId === frame.face.levelId).map(face => ({
    id: face.id,
    start: [face.start[0], face.start[2]],
    end: [face.end[0], face.end[2]],
    thickness: face.halfThickness * 2,
  }));
  const corner = renderedWallFaceEndpoint(frame.face.id, [point[0], point[2]], [frame.normal[0], frame.normal[2]], sameLevelWalls);
  return corner ? [corner[0] + frame.normal[0] * lift, point[1], corner[1] + frame.normal[2] * lift] : undefined;
}

/** Find the shared visible corner where the selected side faces of two walls meet. */
export function adjacentWallCornerAnchor(targetFrame: WallDimensionFrame, hostFrame: WallDimensionFrame, witness: Vec3, lift = .0005): Vec3 | undefined {
  const targetNormal = targetFrame.normal, hostNormal = hostFrame.normal;
  const determinant = hostNormal[0] * targetNormal[2] - hostNormal[2] * targetNormal[0];
  if (Math.abs(determinant) < 1e-6) return undefined;
  const hostConstant = dotXZ(hostFrame.face.start, hostNormal) + hostFrame.face.halfThickness;
  const targetConstant = dotXZ(targetFrame.face.start, targetNormal) + targetFrame.face.halfThickness;
  const x = (hostConstant * targetNormal[2] - hostNormal[2] * targetConstant) / determinant;
  const z = (hostNormal[0] * targetConstant - hostConstant * targetNormal[0]) / determinant;
  if (!Number.isFinite(x) || !Number.isFinite(z)) return undefined;
  const hostProgress = dotXZ([x - hostFrame.face.start[0], 0, z - hostFrame.face.start[2]], hostFrame.tangent);
  const targetProgress = dotXZ([x - targetFrame.face.start[0], 0, z - targetFrame.face.start[2]], targetFrame.tangent);
  const hostLength = Math.hypot(hostFrame.face.end[0] - hostFrame.face.start[0], hostFrame.face.end[2] - hostFrame.face.start[2]);
  const targetLength = Math.hypot(targetFrame.face.end[0] - targetFrame.face.start[0], targetFrame.face.end[2] - targetFrame.face.start[2]);
  const hostMiterAllowance = hostFrame.face.halfThickness * 10, targetMiterAllowance = targetFrame.face.halfThickness * 10;
  if (hostProgress < -hostMiterAllowance || hostProgress > hostLength + hostMiterAllowance || targetProgress < -targetMiterAllowance || targetProgress > targetLength + targetMiterAllowance) return undefined;
  // Lift only toward the host face's visible side to avoid z-fighting while staying on the miter edge.
  const cornerSnapRadius = Math.max(hostFrame.face.halfThickness, targetFrame.face.halfThickness) * 3 + .025;
  const nearWitness = Math.hypot(x - witness[0], z - witness[2]) <= cornerSnapRadius;
  return nearWitness ? [x + hostNormal[0] * lift, witness[1], z + hostNormal[2] * lift] : undefined;
}

/** Resolve the single displayed anchor shared by a wall witness and its vertical reference mark. */
export function wallWitnessDisplayAnchor(witness: Vec3, targetFrame: WallDimensionFrame, hostFrame?: WallDimensionFrame, faces: readonly WallDimensionFace[] = [], allowMiterEndpoint = true): Vec3 {
  if (allowMiterEndpoint && hostFrame && targetFrame.face.id !== hostFrame.face.id) {
    const corner = adjacentWallCornerAnchor(targetFrame, hostFrame, witness);
    if (corner) return corner;
  }
  const renderedEndpoint = allowMiterEndpoint ? renderedWallEndpoint(witness, targetFrame, faces, .0005) : undefined;
  if (renderedEndpoint) return renderedEndpoint;
  return projectDimensionPointToWall(witness, targetFrame);
}

/** Resolve the rendered host wall for either a wall witness or an opening-edge witness. */
export function wallIdForDimensionWitness(witness: { objectId: string; objectKind: string }, faces: readonly WallDimensionFace[]): string | undefined {
  if (witness.objectKind === "wall") return witness.objectId;
  if (witness.objectKind === "opening") return faces.find(face => face.openings?.some(opening => opening.id === witness.objectId))?.id;
  return undefined;
}

export function wallOpeningEdgeLabel(witness: { objectId: string; objectKind: string }, faces: readonly WallDimensionFace[], side: "左" | "右") {
  if (witness.objectKind !== "opening") return undefined;
  const opening = faces.flatMap(face => face.openings ?? []).find(candidate => candidate.id === witness.objectId);
  const type = opening?.type?.toLowerCase();
  const kind = type === "door" || type === "门" ? "门洞口边" : type === "window" || type === "窗" ? "窗洞口边" : "洞口边";
  return `${side}${kind}`;
}

/** Full-height wall-face marks, clipped to a shared corner span and any real opening void. */
export function wallVerticalReferenceSegments(witness: Vec3, targetFrame: WallDimensionFrame, hostFrame: WallDimensionFrame | undefined, faces: readonly WallDimensionFace[], openingId?: string): { start: Vec3; end: Vec3 }[] {
  const face = targetFrame.face;
  if (face.bottomY === undefined || face.topY === undefined || face.topY <= face.bottomY) return [];
  const allowMiterEndpoint = !openingId;
  const crossWallCorner = allowMiterEndpoint && hostFrame && hostFrame.face.id !== targetFrame.face.id ? adjacentWallCornerAnchor(targetFrame, hostFrame, witness, .0005) : undefined;
  const sameWallEndpoint = allowMiterEndpoint && !crossWallCorner ? renderedWallEndpoint(witness, targetFrame, faces, .0005) : undefined;
  const sharedCorner = crossWallCorner ?? sameWallEndpoint;
  const anchor = sharedCorner ?? projectDimensionPointToWall(witness, targetFrame, .0005), corner = Boolean(sharedCorner);
  let bottomY = face.bottomY, topY = face.topY;
  if (corner && hostFrame?.face.bottomY !== undefined && hostFrame.face.topY !== undefined) {
    bottomY = Math.max(bottomY, hostFrame.face.bottomY);
    topY = Math.min(topY, hostFrame.face.topY);
  }
  if (topY <= bottomY) return [];
  const tangent = unit3([face.end[0] - face.start[0], 0, face.end[2] - face.start[2]]);
  const anchorAlong = dotXZ([anchor[0] - face.start[0], 0, anchor[2] - face.start[2]], tangent);
  const cuts = face.openings?.filter(opening => {
    if (openingId) return opening.id === openingId;
    const openingLength = opening.end - opening.start;
    return anchorAlong >= opening.start - 1e-4 && anchorAlong <= opening.end + 1e-4 && openingLength > 1e-6;
  }).flatMap(opening => opening.bottomY !== undefined && opening.topY !== undefined ? [[Math.max(bottomY, opening.bottomY), Math.min(topY, opening.topY)] as const] : []) ?? [];
  const intervals: [number, number][] = [];
  let cursor = bottomY;
  for (const [cutStart, cutEnd] of cuts.sort((a, b) => a[0] - b[0])) {
    if (cutStart > cursor + 1e-6) intervals.push([cursor, cutStart]);
    cursor = Math.max(cursor, cutEnd);
  }
  if (cursor < topY - 1e-6) intervals.push([cursor, topY]);
  return intervals.filter(([start, end]) => end > start + 1e-6).map(([startY, endY]) => ({ start: [anchor[0], startY, anchor[2]], end: [anchor[0], endY, anchor[2]] }));
}

/** Stable, readable wall-facing basis on either wall side without mirrored text. */
export function wallDimensionTextBasis(frame: WallDimensionFrame) {
  const rawRight = dotXZ([-frame.tangent[2], 0, frame.tangent[0]], frame.normal) >= 0 ? frame.tangent : [-frame.tangent[0], 0, -frame.tangent[2]] as Vec3;
  const right = rawRight.map(value => value === 0 ? 0 : value) as Vec3;
  const normal: Vec3 = [-right[2] || 0, 0, right[0] || 0];
  return { right, up: [0, 1, 0] as Vec3, normal };
}
