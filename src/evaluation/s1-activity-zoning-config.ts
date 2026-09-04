import type { SdiSpaceFunctionCode } from "../space-functions/sdi-space-functions";

/** Product-owned, exhaustive classification for every current indoor SDI code. */
export type S1ActivityZoneClass = "active" | "quiet" | "neutral";
export type S1IndoorSpaceFunctionCode = Exclude<SdiSpaceFunctionCode, "SF50" | "SF51" | "SF52" | "SF53" | "SF54" | "SF55" | "SF56">;
export const S1_ACTIVITY_ZONING_RULE_VERSION = "v0.1-demo" as const;
export const S1_ACTIVITY_ZONING_RULE_STATUS = "Demo provisional calibration" as const;

export const S1_INDOOR_ACTIVITY_ZONE_CLASSIFICATION: Readonly<Record<S1IndoorSpaceFunctionCode, S1ActivityZoneClass>> = {
  SF00: "neutral", SF01: "active", SF02: "active", SF03: "neutral", SF04: "neutral", SF05: "neutral",
  SF06: "active", SF07: "active", SF08: "neutral", SF09: "neutral", SF10: "neutral", SF11: "quiet",
  SF12: "quiet", SF13: "quiet", SF14: "quiet", SF15: "neutral", SF16: "quiet", SF17: "neutral",
  SF18: "neutral", SF19: "neutral", SF20: "neutral", SF21: "quiet", SF22: "active", SF23: "neutral",
  SF24: "neutral", SF25: "quiet", SF26: "active", SF27: "active", SF28: "active", SF29: "neutral",
  SF30: "neutral", SF31: "quiet", SF32: "neutral", SF33: "neutral", SF34: "neutral", SF35: "neutral", SF36: "active",
};

export const S1_ACTIVITY_PUBLIC_CORE_CODES = ["SF06", "SF07"] as const;
export const S1_ACTIVITY_ZONING_DZ01_SCORE_RULES = [
  { maximumAffectedRatio: 0, score: 100 },
  { maximumAffectedRatio: 0.2, score: 80 },
  { maximumAffectedRatio: 0.5, score: 50 },
  { maximumAffectedRatio: 0.999999, score: 20 },
  { maximumAffectedRatio: 1, score: 0 },
] as const;

export const S1_ACTIVITY_ZONING_DZ02_SCORES = {
  neutral_only: 100,
  neutral_and_active: 80,
  quiet_only: 70,
  active_direct: 50,
  active_mandatory: 20,
} as const;

export function s1ActivityZoneClass(code: SdiSpaceFunctionCode): S1ActivityZoneClass | null {
  return code in S1_INDOOR_ACTIVITY_ZONE_CLASSIFICATION ? S1_INDOOR_ACTIVITY_ZONE_CLASSIFICATION[code as S1IndoorSpaceFunctionCode] : null;
}
