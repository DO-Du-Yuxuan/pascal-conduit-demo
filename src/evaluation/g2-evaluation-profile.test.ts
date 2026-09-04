import { describe, expect, it } from "vitest";
import {
  DEFAULT_G2_JURISDICTION,
  DEFAULT_G2_PROJECT_USE,
  g2ContextForEvaluationProfile,
} from "./g2-evaluation-profile";

describe("G2 evaluation profile", () => {
  it("uses the supported Bellevue detached-dwelling profile independently of the imported filename", () => {
    expect(g2ContextForEvaluationProfile(DEFAULT_G2_PROJECT_USE, DEFAULT_G2_JURISDICTION)).toMatchObject({
      codeApplicability: "applicable",
      projectUse: "detached_dwelling",
      jurisdiction: "Bellevue, WA",
    });
  });
});
