export const S1_HIGH_FREQUENCY_PATH_SCORING_RULE_VERSION = "v0.1-demo" as const;
export const S1_HIGH_FREQUENCY_PATH_SCORING_RULE_STATUS = "Demo provisional calibration" as const;

export const S1_HIGH_FREQUENCY_PATH_DISTANCE_WEIGHT = 0.60;
export const S1_HIGH_FREQUENCY_PATH_DETOUR_WEIGHT = 0.40;

export const S1_HIGH_FREQUENCY_PATH_BEDROOM_DISTANCE_ANCHORS = [
  { value: 0.20, score: 100 }, { value: 0.35, score: 90 }, { value: 0.50, score: 75 },
  { value: 0.70, score: 50 }, { value: 0.90, score: 25 }, { value: 1.10, score: 0 },
] as const;

export const S1_HIGH_FREQUENCY_PATH_RETURN_DISTANCE_ANCHORS = [
  { value: 0.35, score: 100 }, { value: 0.55, score: 90 }, { value: 0.75, score: 75 },
  { value: 1.00, score: 50 }, { value: 1.25, score: 25 }, { value: 1.50, score: 0 },
] as const;

export const S1_HIGH_FREQUENCY_PATH_DETOUR_ANCHORS = [
  { value: 1.10, score: 100 }, { value: 1.20, score: 90 }, { value: 1.35, score: 75 },
  { value: 1.50, score: 60 }, { value: 1.75, score: 35 }, { value: 2.00, score: 0 },
] as const;

/** SF-coded zones excluded from the v0.1 Demo effective residential indoor-area denominator. */
export const S1_HIGH_FREQUENCY_PATH_EFFECTIVE_AREA_EXCLUDED_CODES = new Set(["SF24", "SF30", "SF32"]);
