import type { EvaluationHandoff } from "../parser/evaluation-handoff";
import { G1_GEOMETRY_TOLERANCES } from "./tolerances";

type Opening = EvaluationHandoff["doors"][number] | EvaluationHandoff["windows"][number];
type Wall = EvaluationHandoff["walls"][number];

export type OpeningBoundaryRelation = {
  status: "inside" | "outside" | "invalid" | "unsupported";
  openingId: string;
  wallId: string | null;
  wallLengthMeters: number | null;
  openingStartMeters: number | null;
  openingEndMeters: number | null;
  openingCenterMeters: number | null;
  rightOvershootMeters: number | null;
  leftOvershootMeters: number | null;
  reason?: string;
};

/**
 * Validates the opening interval against a straight wall's centerline domain.
 * Curved-wall local placement is deliberately unsupported by the frozen handoff.
 */
export function relateOpeningToHostBoundary(opening: Opening, wall: Wall | undefined): OpeningBoundaryRelation {
  const unavailable = (status: "invalid" | "unsupported", reason: string, wallId = opening.hostWallId): OpeningBoundaryRelation => ({ status, openingId: opening.id, wallId, wallLengthMeters: null, openingStartMeters: null, openingEndMeters: null, openingCenterMeters: null, rightOvershootMeters: null, leftOvershootMeters: null, reason });
  if (!opening.hostWallId || !wall) return unavailable("invalid", "宿主墙缺失");
  if (!wall.footprintValidation.valid) return unavailable("invalid", `宿主墙 footprint 无效：${wall.footprintValidation.codes.join(", ")}`, wall.id);
  if (Math.abs(wall.curveOffsetMeters) > G1_GEOMETRY_TOLERANCES.lengthMeters) return unavailable("unsupported", "曲墙门窗定位在当前交接中不可靠", wall.id);
  if (!wall.start || !wall.end || !wall.start.every(Number.isFinite) || !wall.end.every(Number.isFinite)) return unavailable("invalid", "宿主墙几何无效", wall.id);
  const wallLengthMeters = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
  const local = opening.rawWallLocalPosition?.[0], width = opening.widthMeters;
  if (!Number.isFinite(local) || !Number.isFinite(width) || (width as number) <= 0 || wallLengthMeters <= G1_GEOMETRY_TOLERANCES.lengthMeters) return { status: "invalid", openingId: opening.id, wallId: wall.id, wallLengthMeters, openingStartMeters: null, openingEndMeters: null, openingCenterMeters: null, rightOvershootMeters: null, leftOvershootMeters: null, reason: "门窗位置、宽度或墙长无效" };
  const openingStartMeters = (local as number) - (width as number) / 2;
  const openingEndMeters = (local as number) + (width as number) / 2;
  const tolerance = G1_GEOMETRY_TOLERANCES.pointOnBoundaryMeters;
  const leftOvershootMeters = Math.max(0, -openingStartMeters), rightOvershootMeters = Math.max(0, openingEndMeters - wallLengthMeters);
  return { status: openingStartMeters >= -tolerance && openingEndMeters <= wallLengthMeters + tolerance ? "inside" : "outside", openingId: opening.id, wallId: wall.id, wallLengthMeters, openingStartMeters, openingEndMeters, openingCenterMeters: local as number, rightOvershootMeters, leftOvershootMeters };
}
