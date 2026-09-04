export const S1_FURNITURE_CONFIG = Object.freeze({
  metricId: "S1-FUR" as const,
  metricName: "核心家具关系与使用空间",
  ruleVersion: "v0.1",
  measurementStatus: "原始测量，尚未评分" as const,
  pairingTieToleranceMeters: 0.01,
});

export const S1_FURNITURE_RELATION_CONFIG = Object.freeze([
  { pairType: "dining_table_dining_chair" as const, label: "餐桌—餐椅", anchorSemantic: "dining-table" as const, partnerSemantic: "dining-chair" as const },
  { pairType: "bed_bedside_table" as const, label: "床—床头柜", anchorSemantic: "bed" as const, partnerSemantic: "bedside-table" as const },
  { pairType: "sofa_coffee_table" as const, label: "沙发—茶几", anchorSemantic: "sofa" as const, partnerSemantic: "coffee-table" as const },
  { pairType: "desk_office_chair" as const, label: "书桌—工作椅", anchorSemantic: "desk" as const, partnerSemantic: "office-chair" as const },
]);
