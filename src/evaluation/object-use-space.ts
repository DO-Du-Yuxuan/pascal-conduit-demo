import { rotatePascalPlanVector } from "../geometry/transform";
import type { Point, Ring } from "./envelope";

export type LocalUseDirection = "front" | "back" | "left" | "right" | "up" | "down";
export type UseSpaceOwner = {
  id: string;
  dimensionsMeters: readonly number[] | null;
  itemScale?: readonly number[] | null;
  openingDirections?: readonly string[] | null;
  rawMaxOpeningDepthMeters?: number | null;
  rawMinOpeningUseClearanceMeters?: number | null;
  resolvedWorldPosition: readonly number[] | null;
  resolvedRotationRadians: number | null;
};
export type PlanUseSpace = {
  ownerObjectId: string;
  direction: Exclude<LocalUseDirection, "up" | "down">;
  maximumOpeningDepthMeters: number;
  minimumUseClearanceMeters: number;
  openingPolygon: Ring;
  openedUsePolygon: Ring;
  minimumUsePolygon: Ring;
  fullUsePolygon: Ring;
  measurementBasis: "explicit";
  assumptions: string[];
};

const validDirections = new Set<LocalUseDirection>(["front", "back", "left", "right", "up", "down"]);
export const openingDirectionsOf = (owner: UseSpaceOwner): LocalUseDirection[] => [...new Set((owner.openingDirections ?? []).filter((value): value is LocalUseDirection => typeof value === "string" && validDirections.has(value as LocalUseDirection)))];
const axisScale = (owner: UseSpaceOwner, direction: LocalUseDirection) => direction === "front" || direction === "back" ? owner.itemScale?.[2] : direction === "left" || direction === "right" ? owner.itemScale?.[0] : owner.itemScale?.[1];
export const scaledOpeningDepth = (owner: UseSpaceOwner, direction: LocalUseDirection) => Math.max(0, owner.rawMaxOpeningDepthMeters ?? 0) * (axisScale(owner, direction) ?? 1);
export const scaledMinimumUseClearance = (owner: UseSpaceOwner, direction: LocalUseDirection) => Math.max(0, owner.rawMinOpeningUseClearanceMeters ?? 0) * (axisScale(owner, direction) ?? 1);
export const isExplicitlyOpenable = (owner: UseSpaceOwner) => openingDirectionsOf(owner).length > 0 && (owner.rawMaxOpeningDepthMeters ?? 0) > 0;

const rectangle = (center: Point, tangent: Point, normal: Point, width: number, start: number, depth: number): Ring => {
  const near: Point = [center[0] + normal[0] * start, center[1] + normal[1] * start], far: Point = [near[0] + normal[0] * depth, near[1] + normal[1] * depth], half: Point = [tangent[0] * width / 2, tangent[1] * width / 2];
  return [[near[0] - half[0], near[1] - half[1]], [near[0] + half[0], near[1] + half[1]], [far[0] + half[0], far[1] + half[1]], [far[0] - half[0], far[1] - half[1]]];
};

export function planUseSpaces(owner: UseSpaceOwner): PlanUseSpace[] {
  if (!owner.dimensionsMeters || owner.dimensionsMeters.length < 3 || !owner.resolvedWorldPosition || owner.resolvedWorldPosition.length < 2 || !Number.isFinite(owner.resolvedRotationRadians) || !isExplicitlyOpenable(owner)) return [];
  const [width, , depth] = owner.dimensionsMeters, center: Point = [owner.resolvedWorldPosition[0]!, owner.resolvedWorldPosition[1]!], rotation = owner.resolvedRotationRadians!;
  return openingDirectionsOf(owner).flatMap((direction): PlanUseSpace[] => {
    if (direction === "up" || direction === "down") return [];
    const localNormal = direction === "front" ? [0, 1] : direction === "back" ? [0, -1] : direction === "right" ? [1, 0] : [-1, 0], localTangent = direction === "front" || direction === "back" ? [1, 0] : [0, 1], normalRotated = rotatePascalPlanVector(localNormal[0], localNormal[1], rotation), tangentRotated = rotatePascalPlanVector(localTangent[0], localTangent[1], rotation), normal: Point = [normalRotated.x, normalRotated.z], tangent: Point = [tangentRotated.x, tangentRotated.z], faceWidth = direction === "front" || direction === "back" ? width! : depth!, physicalHalfDepth = direction === "front" || direction === "back" ? depth! / 2 : width! / 2, opening = scaledOpeningDepth(owner, direction), clearance = scaledMinimumUseClearance(owner, direction);
    return [{ ownerObjectId: owner.id, direction, maximumOpeningDepthMeters: opening, minimumUseClearanceMeters: clearance, openingPolygon: rectangle(center, tangent, normal, faceWidth!, physicalHalfDepth, opening), openedUsePolygon: rectangle(center, tangent, normal, faceWidth!, physicalHalfDepth + opening, clearance), minimumUsePolygon: rectangle(center, tangent, normal, faceWidth!, physicalHalfDepth, clearance), fullUsePolygon: rectangle(center, tangent, normal, faceWidth!, physicalHalfDepth, opening + clearance), measurementBasis: "explicit", assumptions: ["方向按物体局部坐标解释并随物体旋转", "开启深度与最小使用空间按对应局部轴缩放", "完全开启后的人员使用区从最大开启范围末端开始"] }];
  });
}
