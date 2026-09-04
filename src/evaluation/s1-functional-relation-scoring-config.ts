export const S1_FUNCTIONAL_RELATION_SCORING_RULE_VERSION = "v0.1" as const;
export const S1_FUNCTIONAL_RELATION_SCORING_RULE_STATUS = "待校准" as const;
export const S1_FUNCTIONAL_RELATION_METRIC_ID = "S1-FR" as const;
export const S1_FUNCTIONAL_RELATION_METRIC_NAME = "功能空间关系适配度" as const;

/** Ordered from the most specific case to the fallback for each relationship pair. */
export const S1_FUNCTIONAL_RELATION_SCORING_RULES = [
  { ruleId: "S1-FR-001-R01", pairId: "S1-REL-001", score: 100, rationale: "厨房与餐厅位于同一开放空间" },
  { ruleId: "S1-FR-001-R02", pairId: "S1-REL-001", score: 100, rationale: "厨房与餐厅通过门或开放连接直接相连，且不跨楼层" },
  { ruleId: "S1-FR-001-R03", pairId: "S1-REL-001", score: 90, rationale: "一个可靠识别的餐厨服务空间位于厨房与餐厅之间" },
  { ruleId: "S1-FR-001-R04", pairId: "S1-REL-001", score: 70, rationale: "一个可靠识别的交通空间位于厨房与餐厅之间" },
  { ruleId: "S1-FR-001-R05", pairId: "S1-REL-001", score: 40, rationale: "一个其他主要功能空间位于厨房与餐厅之间" },
  { ruleId: "S1-FR-001-R06", pairId: "S1-REL-001", score: 20, rationale: "厨房与餐厅之间需要经过两个及以上空间" },
  { ruleId: "S1-FR-001-R07", pairId: "S1-REL-001", score: 0, rationale: "厨房与餐厅位于不同楼层" },
  { ruleId: "S1-FR-001-R08", pairId: "S1-REL-001", score: 0, rationale: "可靠数据表明厨房与餐厅不连通" },
  { ruleId: "S1-FR-002-R01", pairId: "S1-REL-002", score: 100, rationale: "主卧与主卫通过门直接连接，且不跨楼层" },
  { ruleId: "S1-FR-002-R02", pairId: "S1-REL-002", score: 95, rationale: "一个可靠识别的步入式衣帽间或更衣区位于主卧与主卫之间" },
  { ruleId: "S1-FR-002-R03", pairId: "S1-REL-002", score: 60, rationale: "一个可靠识别的交通空间位于主卧与主卫之间" },
  { ruleId: "S1-FR-002-R04", pairId: "S1-REL-002", score: 30, rationale: "主卧与主卫处于同一无隔断 Room Region" },
  { ruleId: "S1-FR-002-R05", pairId: "S1-REL-002", score: 30, rationale: "主卧与主卫仅通过开放连接相邻，缺少门形成隐私分隔" },
  { ruleId: "S1-FR-002-R06", pairId: "S1-REL-002", score: 30, rationale: "一个其他主要功能空间位于主卧与主卫之间" },
  { ruleId: "S1-FR-002-R07", pairId: "S1-REL-002", score: 10, rationale: "主卧与主卫之间需要经过两个及以上空间" },
  { ruleId: "S1-FR-002-R08", pairId: "S1-REL-002", score: 0, rationale: "主卧与主卫位于不同楼层" },
  { ruleId: "S1-FR-002-R09", pairId: "S1-REL-002", score: 0, rationale: "可靠数据表明主卧与主卫不连通" },
] as const;
