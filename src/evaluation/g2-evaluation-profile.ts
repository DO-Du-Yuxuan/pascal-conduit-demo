import { BELLEVUE_DETACHED_DWELLING_G2_CONTEXT, type G2EvaluationContext } from "./g2-rules";

/**
 * Evaluation configuration belongs to the demo session rather than Pascal JSON.
 * More profiles can be added here only after their corresponding G2 rules and
 * regulatory parameters have been implemented.
 */
export const G2_PROJECT_USE_OPTIONS = [
  { value: "detached_dwelling", label: "独立住宅" },
] as const;

export const G2_JURISDICTION_OPTIONS = [
  { value: "bellevue_wa", label: "Bellevue, WA" },
] as const;

export type G2ProjectUseSelection = (typeof G2_PROJECT_USE_OPTIONS)[number]["value"];
export type G2JurisdictionSelection = (typeof G2_JURISDICTION_OPTIONS)[number]["value"];

export const DEFAULT_G2_PROJECT_USE: G2ProjectUseSelection = "detached_dwelling";
export const DEFAULT_G2_JURISDICTION: G2JurisdictionSelection = "bellevue_wa";

export function g2ContextForEvaluationProfile(
  projectUse: G2ProjectUseSelection,
  jurisdiction: G2JurisdictionSelection,
): G2EvaluationContext {
  if (projectUse === "detached_dwelling" && jurisdiction === "bellevue_wa") {
    return BELLEVUE_DETACHED_DWELLING_G2_CONTEXT;
  }
  // Kept as a safe fallback if a future UI option is added before its ruleset.
  return { codeApplicability: "unknown", projectUse: "unknown" };
}
