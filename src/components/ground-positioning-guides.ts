import type { DevicePositionDescription } from "../domain/device-positioning";
import { isFloorMountedDevice } from "../domain/devices";
import type { NetworkDevice, Vec3 } from "../domain/overlay";
import { adjacentWallCornerAnchor, nearestWallDimensionFrame, projectDimensionPointToWall, type WallDimensionFace, type WallDimensionFrame } from "./wall-dimension-placement";

export type GroundPositionReference = {
  key: string;
  code: string;
  wallId: string;
  side: "+" | "-";
  millimeters: number;
  direction: Vec3;
  witness: NonNullable<NonNullable<DevicePositionDescription["planar"]>[number]["witness"]>;
  frame: WallDimensionFrame;
  panelLabel: string;
};

export type GroundBaselineChunk = { start: Vec3; end: Vec3; code: string; wallId: string; key: string; frame: WallDimensionFrame; label: string };

const dotXZ = (a: Vec3, b: Vec3) => a[0] * b[0] + a[2] * b[2];
const lengthXZ = (value: Vec3) => Math.hypot(value[0], value[2]);
const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, n: number): Vec3 => [a[0] * n, a[1] * n, a[2] * n];
const unitXZ = (value: Vec3): Vec3 => { const length = lengthXZ(value); return length > 1e-9 ? [value[0] / length, 0, value[2] / length] : [0, 0, 0]; };

function wallIdForWitness(witness: NonNullable<NonNullable<DevicePositionDescription["planar"]>[number]["witness"]>, faces: readonly WallDimensionFace[]) {
  if (witness.objectKind === "wall") return witness.objectId;
  return faces.find(face => face.openings?.some(opening => opening.id === witness.objectId))?.id;
}

function sideForFrame(frame: WallDimensionFrame): "+" | "-" {
  const tangent = unitXZ(subtract(frame.face.end, frame.face.start)), canonical: Vec3 = [-tangent[2], 0, tangent[0]];
  return dotXZ(frame.normal, canonical) >= 0 ? "+" : "-";
}

function levelIdForDevice(device: NetworkDevice, faces: readonly WallDimensionFace[]) {
  if (device.mount?.kind === "finished-floor") return device.mount.levelId;
  const attachment = device.position.attachment;
  if (attachment?.levelId) return attachment.levelId;
  return faces.find(face => face.id === attachment?.hostId)?.levelId;
}

/** Resolve floor-wall references once so the 3D marks and property panel share IDs, codes and distances. */
export function describeGroundPositionReferences(device: NetworkDevice, description: DevicePositionDescription, faces: readonly WallDimensionFace[]): GroundPositionReference[] {
  if (!isFloorMountedDevice(device)) return [];
  const levelId = levelIdForDevice(device, faces), levelFaces = faces.filter(face => !levelId || !face.levelId || face.levelId === levelId);
  const codes = new Map<string, string>();
  const stableSides = [...new Set(levelFaces.flatMap(face => [`${face.id}|+`, `${face.id}|-`]))].sort((a, b) => {
    const [aId, aSide] = a.split("|"), [bId, bSide] = b.split("|");
    return aId!.localeCompare(bId!) || (aSide === bSide ? 0 : aSide === "+" ? -1 : 1);
  });
  stableSides.forEach((key, index) => codes.set(key, `G${String(index + 1).padStart(2, "0")}`));

  const resolved = (description.planar ?? []).flatMap(reference => {
    const witness = reference.witness;
    if (!witness || (witness.objectKind !== "wall" && witness.objectKind !== "opening")) return [];
    const wallId = wallIdForWitness(witness, levelFaces);
    if (!wallId) return [];
    const frame = nearestWallDimensionFrame(wallId, witness.point, subtract(device.position.position, witness.point), levelFaces);
    if (!frame) return [];
    const side = sideForFrame(frame), code = codes.get(`${wallId}|${side}`);
    return code ? [{ key: reference.key, code, wallId, side, millimeters: reference.millimeters, direction: reference.direction, witness, frame, panelLabel: `中心至 ${code} 基准线` }] : [];
  });
  return resolved;
}

function endpointMiter(face: WallDimensionFace, frame: WallDimensionFrame, atStart: boolean, faces: readonly WallDimensionFace[], y: number): Vec3 {
  const endpoint = atStart ? face.start : face.end;
  const adjacent = faces.filter(candidate => candidate.id !== face.id && [candidate.start, candidate.end].some(point => Math.hypot(point[0] - endpoint[0], point[2] - endpoint[2]) < 1e-5));
  for (const candidate of adjacent) {
    const towardSource: Vec3 = [face.start[0] + face.end[0] - 2 * endpoint[0] + frame.normal[0] * face.halfThickness, 0, face.start[2] + face.end[2] - 2 * endpoint[2] + frame.normal[2] * face.halfThickness];
    const adjacentFrame = nearestWallDimensionFrame(candidate.id, [endpoint[0], y, endpoint[2]], towardSource, faces);
    if (!adjacentFrame) continue;
    const corner = adjacentWallCornerAnchor(frame, adjacentFrame, [endpoint[0], y, endpoint[2]]);
    if (corner) return corner;
  }
  return projectDimensionPointToWall([endpoint[0], y, endpoint[2]], frame, .001);
}

function visibleAlongIntervals(face: WallDimensionFace, y: number, length: number) {
  const cuts = (face.openings ?? []).filter(opening => {
    if (opening.bottomY === undefined || opening.topY === undefined) return false;
    return y >= opening.bottomY - 1e-6 && y < opening.topY - 1e-6;
  }).map(opening => [Math.max(0, Math.min(length, opening.start)), Math.max(0, Math.min(length, opening.end))] as const).filter(([start, end]) => end > start + 1e-6).sort((a, b) => a[0] - b[0]);
  const visible: [number, number][] = [];
  let cursor = 0;
  for (const [start, end] of cuts) {
    if (start > cursor + 1e-6) visible.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (cursor < length - 1e-6) visible.push([cursor, length]);
  return visible;
}

/** Return actual wall-face/finish-plane seam chunks, clipped at door or window voids. */
export function groundWallBaselineChunks(reference: GroundPositionReference, faces: readonly WallDimensionFace[], y = reference.witness.point[1]): GroundBaselineChunk[] {
  const matching = faces.filter(face => face.id === reference.wallId && (!face.levelId || !reference.frame.face.levelId || face.levelId === reference.frame.face.levelId));
  return matching.flatMap(face => {
    const tangentVector = subtract(face.end, face.start), length = lengthXZ(tangentVector);
    if (length < 1e-8) return [];
    const tangent = unitXZ(tangentVector), startFacePoint = projectDimensionPointToWall([face.start[0], y, face.start[2]], reference.frame, .001), endFacePoint = projectDimensionPointToWall([face.end[0], y, face.end[2]], reference.frame, .001);
    return visibleAlongIntervals(face, y, length).map(([startT, endT]) => {
      const start: Vec3 = [startFacePoint[0] + tangent[0] * startT, y, startFacePoint[2] + tangent[2] * startT], end: Vec3 = [startFacePoint[0] + tangent[0] * endT, y, startFacePoint[2] + tangent[2] * endT];
      const miteredStart = startT <= 1e-6 ? endpointMiter(face, reference.frame, true, faces, y) : start;
      const miteredEnd = endT >= length - 1e-6 ? endpointMiter(face, reference.frame, false, faces, y) : end;
      return { start: miteredStart, end: miteredEnd, code: reference.code, wallId: face.id, key: reference.key, frame: reference.frame, label: reference.code };
    }).filter(chunk => Math.hypot(chunk.end[0] - chunk.start[0], chunk.end[2] - chunk.start[2]) > 1e-6);
  });
}
