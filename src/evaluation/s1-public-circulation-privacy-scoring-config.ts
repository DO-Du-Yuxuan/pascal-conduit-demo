export const S1_PUBLIC_CIRCULATION_PRIVACY_SCORING_RULE_VERSION = "v0.1" as const;
export const S1_PUBLIC_CIRCULATION_PRIVACY_SCORING_RULE_STATUS = "待校准" as const;
export const S1_PUBLIC_CIRCULATION_PRIVACY_METRIC_ID = "S1-PCP" as const;
export const S1_PUBLIC_CIRCULATION_PRIVACY_METRIC_NAME = "公共动线穿越私密空间" as const;

export const S1_PUBLIC_CIRCULATION_PRIVACY_SCORING_RULES = [
  { ruleId: "S1-PCP-R01", resultType: "privacy_safe_route_available", score: 100, rationale: "存在不穿越私密空间的可行路线" },
  { ruleId: "S1-PCP-R02", resultType: "private_space_mandatory", score: 0, rationale: "所有可行路线都必须经过至少一个私密中间空间" },
  { ruleId: "S1-PCP-R03", resultType: "baseline_unreachable", score: null, rationale: "原始空间图不可达，无法评价隐私穿越表现" },
  { ruleId: "S1-PCP-R04", resultType: "unable_to_determine", score: null, rationale: "空间语义或拓扑数据不足，无法完成正式评分" },
  { ruleId: "S1-PCP-R05", resultType: "not_applicable", score: null, rationale: "路线或路线组不适用，不进入评分分母" },
] as const;
