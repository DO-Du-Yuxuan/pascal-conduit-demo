import type { SdiSpaceFunctionCode } from "../space-functions/sdi-space-functions";

export const S1_SPACE_UTILIZATION_RULE_VERSION = "v0.1-demo" as const;
export const S1_SPACE_UTILIZATION_RULE_STATUS = "Demo provisional calibration" as const;
export const S1_SPACE_UTILIZATION_CORRIDOR_CODES = new Set<SdiSpaceFunctionCode>(["SF09"]);

/** Product-confirmed LY-02 exclusions: generic, balcony, circulation, equipment and architectural transition. */
export const S1_SPACE_UTILIZATION_SHAPE_EXCLUDED_CODES = new Set<SdiSpaceFunctionCode>([
  "SF00", "SF08", "SF09", "SF10", "SF17", "SF19", "SF23", "SF24", "SF30", "SF32",
]);

export const S1_SPACE_UTILIZATION_CORRIDOR_ANCHORS = [
  { value: 0.05, score: 100 }, { value: 0.07, score: 90 }, { value: 0.10, score: 75 },
  { value: 0.13, score: 50 }, { value: 0.16, score: 25 }, { value: 0.20, score: 0 },
] as const;
export const S1_SPACE_UTILIZATION_INEFFICIENT_AREA_ANCHORS = [
  { value: 0.02, score: 100 }, { value: 0.05, score: 90 }, { value: 0.10, score: 75 },
  { value: 0.15, score: 50 }, { value: 0.20, score: 25 }, { value: 0.30, score: 0 },
] as const;
export const S1_SPACE_UTILIZATION_COMPACTNESS_THRESHOLD = 0.45;
export const S1_SPACE_UTILIZATION_CONVEXITY_THRESHOLD = 0.70;
