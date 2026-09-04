export const S1_STORAGE_CONFIGURATION_RULE_VERSION = "v0.1-demo" as const;
export const S1_STORAGE_CONFIGURATION_RULE_STATUS = "Demo provisional calibration" as const;

export const S1_STORAGE_BEDROOM_CODES = new Set(["SF11", "SF12", "SF13", "SF14", "SF21"]);
export const S1_STORAGE_ARRIVAL_SUPPORT_CODES = new Set(["SF08", "SF10", "SF35"]);
export const S1_STORAGE_PANTRY_CODE = "SF34" as const;

export const S1_STORAGE_WARDROBE_TAGS = new Set(["wardrobes", "wardrobe"]);
export const S1_STORAGE_KITCHEN_TAGS = new Set(["cabinets", "base-cabinets", "open-rack", "open-shelf"]);
export const S1_STORAGE_ARRIVAL_TAGS = new Set(["wardrobes", "wardrobe", "cabinets", "base-cabinets", "open-rack", "open-shelf"]);

export const S1_STORAGE_BEDROOM_ANCHORS = [
  { value: 0, score: 0 }, { value: 0.8, score: 40 }, { value: 1.5, score: 70 },
  { value: 2.2, score: 90 }, { value: 3.0, score: 100 },
] as const;
export const S1_STORAGE_KITCHEN_ANCHORS = [
  { value: 0, score: 0 }, { value: 1.0, score: 40 }, { value: 2.0, score: 70 },
  { value: 3.5, score: 90 }, { value: 5.0, score: 100 },
] as const;
export const S1_STORAGE_ARRIVAL_ANCHORS = [
  { value: 0, score: 0 }, { value: 0.3, score: 40 }, { value: 0.7, score: 70 },
  { value: 1.2, score: 90 }, { value: 1.8, score: 100 },
] as const;
