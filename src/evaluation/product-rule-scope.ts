import { ruleG1007, ruleG1009, ruleG1012, ruleG1013, ruleG1019, ruleG1023 } from "./g1-rules";
import { ruleG3001 } from "./g3-rules";
import { ruleG3002 } from "./g3-operation-rules";
import { ruleG3003 } from "./g3-navigation-rules";
import { ruleG3025, ruleG3027, ruleG3031 } from "./g3-fixture-rules";
import type { G1Rule, G3Rule } from "./types";

/**
 * Product-approved plan-evaluator rules.
 *
 * The rule implementation modules intentionally retain reusable measurement
 * helpers and historical rule functions, but only this registry is executed
 * by the product report. Physical opening/use-space checks moved to the 3D
 * editor and must not be reintroduced here through a module-wide rule array.
 */
export const CONFIRMED_G1_RULES: G1Rule[] = [
  ruleG1007,
  ruleG1009,
  ruleG1012,
  ruleG1013,
  ruleG1019,
  ruleG1023,
];

export const CONFIRMED_G3_RULES: G3Rule[] = [
  ruleG3001,
  ruleG3002,
  ruleG3003,
  ruleG3025,
  ruleG3027,
  ruleG3031,
];

export const CONFIRMED_G1_RULE_IDS = ["G1-007", "G1-009", "G1-012", "G1-013", "G1-019", "G1-023"] as const;
export const CONFIRMED_G3_RULE_IDS = ["G3-001", "G3-002", "G3-003", "G3-025", "G3-027", "G3-031"] as const;
