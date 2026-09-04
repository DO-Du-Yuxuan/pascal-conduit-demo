export type WorkspaceViewMode = "2d" | "split" | "3d";

export const clampSplitRatio = (value: number) => Math.max(25, Math.min(75, value));

export function visibleTwoDCanvasIds(ids: number[], mode: WorkspaceViewMode): number[] {
  return mode === "split" ? ids.slice(0, 1) : ids;
}
