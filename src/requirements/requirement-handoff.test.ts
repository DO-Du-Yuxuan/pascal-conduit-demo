import { describe, expect, it } from "vitest";
import bellevueRequirements from "../../sample-data/requirements/Bellevue requirements demo.json";
import { loadRequirementHandoffJson, parseRequirementHandoff } from "./requirement-handoff";

describe("Requirement Handoff loading", () => {
  it("loads the built-in Bellevue Requirement Handoff", () => {
    const result = parseRequirementHandoff(bellevueRequirements);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.handoff.requirements).toHaveLength(9);
      expect(result.handoff.requirements.every((requirement) => !("priority" in requirement))).toBe(true);
    }
  });

  it("accepts and ignores the retired priority field in older generated JSON", () => {
    const legacy = structuredClone(bellevueRequirements) as typeof bellevueRequirements & { requirements: Array<(typeof bellevueRequirements.requirements)[number] & { priority?: string }> };
    legacy.requirements[0]!.priority = "nice_to_have";
    const result = parseRequirementHandoff(legacy);
    expect(result.ok).toBe(true);
    if (result.ok) expect("priority" in result.handoff.requirements[0]!).toBe(false);
  });

  it("loads an uploaded JSON string", () => {
    const result = loadRequirementHandoffJson(JSON.stringify(bellevueRequirements));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.handoff.source.name).toBe("Bellevue Demo 客户需求");
  });

  it("returns a clear error for malformed JSON without throwing", () => {
    const result = loadRequirementHandoffJson("{broken");
    expect(result).toEqual({ ok: false, error: "客户需求 JSON 格式错误：文件不是有效 JSON。" });
  });

  it("rejects duplicate requirement IDs and invalid fields", () => {
    const duplicate = structuredClone(bellevueRequirements);
    duplicate.requirements[1]!.id = duplicate.requirements[0]!.id;
    const result = parseRequirementHandoff(duplicate);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("需求 ID 重复");
  });
});
