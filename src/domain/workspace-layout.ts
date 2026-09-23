export type WorkspaceViewMode = "2d" | "split" | "3d";

export const clampSplitRatio = (value: number) => Math.max(25, Math.min(75, value));
