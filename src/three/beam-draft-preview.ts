import { constrainBeamEnd, type BeamNode, type SupportedBeamTopElevation } from "../domain/beams";

export type BeamDraftPreviewInput = {
  levelId: string;
  start: [number, number];
  end: [number, number];
  topElevation: SupportedBeamTopElevation;
  width: number;
  height: number;
  orthogonal: boolean;
};

/** Build a transient solid for the current pointer draft, including free or
 * otherwise unsupported endpoints. This helper intentionally does not validate
 * or attach the draft; only the supported-Beam commit path may persist it. */
export function beamDraftPreview(input: BeamDraftPreviewInput): BeamNode | null {
  const { levelId, topElevation, width, height } = input;
  if (typeof levelId !== "string" || !levelId || !validPoint(input.start) || !validPoint(input.end) ||
    !Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0 ||
    !Number.isFinite(topElevation?.meters) || topElevation.meters <= 0 || topElevation.basis !== "wall-top" ||
    typeof topElevation.sourceWallId !== "string" || !topElevation.sourceWallId ||
    !["explicit", "derived"].includes(topElevation.measurementBasis)) return null;

  const start: [number, number] = [input.start[0], input.start[1]];
  const rawEnd: [number, number] = [input.end[0], input.end[1]];
  const end = constrainBeamEnd(start, rawEnd, input.orthogonal);
  if (Math.hypot(end[0] - start[0], end[1] - start[1]) < 1e-8) return null;

  return {
    id: "beam-preview",
    type: "beam",
    parentId: levelId,
    name: "梁预览",
    start,
    end: [end[0], end[1]],
    width,
    height,
    ceilingIds: [],
    topElevation: { ...topElevation },
  };
}

function validPoint(value: unknown): value is [number, number] {
  return Array.isArray(value) && Number.isFinite(value[0]) && Number.isFinite(value[1]);
}
