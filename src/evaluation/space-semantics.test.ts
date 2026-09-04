import { describe, expect, it } from "vitest";
import { functionalSemanticsForZoneName, regulatoryUseForZoneName, resolveRegulatoryRoomSemantic, resolveZoneFunctionalSemantics } from "./space-semantics";

describe("shared space semantics", () => {
  it("keeps detailed functional labels separate from coarse regulatory use", () => {
    expect(functionalSemanticsForZoneName("MASTER BEDROOM")).toEqual(expect.arrayContaining(["bedroom", "primary_bedroom"]));
    expect(functionalSemanticsForZoneName("OPEN KITCHEN")).toEqual(expect.arrayContaining(["kitchen", "open_kitchen"]));
    expect(functionalSemanticsForZoneName("客厅")).toContain("living_room");
    expect(functionalSemanticsForZoneName("HALLWAY")).toContain("circulation");
    expect(functionalSemanticsForZoneName("DRESSING ROOM")).toContain("walk_in_closet");
    expect(regulatoryUseForZoneName("MASTER BEDROOM")).toBe("sleeping");
    expect(regulatoryUseForZoneName("OPEN KITCHEN")).toBe("kitchen");
  });

  it("preserves G2 override precedence and mixed-room handling", () => {
    expect(resolveRegulatoryRoomSemantic(["LIVING ROOM", "OPEN KITCHEN"]).use).toBe("habitable");
    expect(resolveRegulatoryRoomSemantic(["MASTER BATH"], "sleeping")).toMatchObject({ use: "sleeping", confidence: "high" });
  });

  it("uses valid SF codes authoritatively and reports name conflicts", () => {
    expect(resolveZoneFunctionalSemantics({ name: "任意文字", spaceFunctionCode: "SF11" })).toMatchObject({ semanticSource: "sdi_code", spaceFunctionName: "主卧室", semantics: new Set(["bedroom", "primary_bedroom"]) });
    expect(resolveZoneFunctionalSemantics({ name: "任意文字", spaceFunctionCode: "SF03" })).toMatchObject({ semanticSource: "sdi_code", spaceFunctionName: "主卫浴室", semantics: new Set(["bathroom", "primary_bathroom"]) });
    const conflict = resolveZoneFunctionalSemantics({ name: "OPEN KITCHEN", spaceFunctionCode: "SF11" });
    expect(conflict.semantics).toEqual(new Set(["bedroom", "primary_bedroom"]));
    expect(conflict.diagnostics[0]).toContain("冲突");
  });

  it("distinguishes name fallback and unknown semantics", () => {
    expect(resolveZoneFunctionalSemantics({ name: "MASTER BEDROOM" }).semanticSource).toBe("name_fallback");
    expect(resolveZoneFunctionalSemantics({ name: "OPEN TO BELOW" }).semanticSource).toBe("unknown");
  });
});
