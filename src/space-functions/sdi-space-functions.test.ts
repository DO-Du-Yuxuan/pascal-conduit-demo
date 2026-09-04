import { describe, expect, it } from "vitest";
import { SDI_SPACE_FUNCTIONS, isSdiSpaceFunctionCode, sdiFunctionalSemantics, sdiSpaceFunctionName } from "./sdi-space-functions";

describe("SDI space-function catalog", () => {
  it("contains the approved codes and exposes names and evaluator semantics", () => {
    expect(Object.keys(SDI_SPACE_FUNCTIONS)).toHaveLength(44);
    expect(isSdiSpaceFunctionCode("SF01")).toBe(true);
    expect(isSdiSpaceFunctionCode("SF34")).toBe(true);
    expect(sdiSpaceFunctionName("SF11")).toBe("主卧室");
    expect(sdiFunctionalSemantics("SF01")).toEqual(["kitchen", "open_kitchen"]);
    expect(sdiFunctionalSemantics("SF02")).toEqual(["kitchen", "closed_kitchen", "chinese_kitchen"]);
    expect(sdiSpaceFunctionName("SF34")).toBe("食品储藏间");
    expect(sdiSpaceFunctionName("SF35")).toBe("泥房");
    expect(sdiSpaceFunctionName("SF36")).toBe("儿童活动区");
    expect(sdiFunctionalSemantics("SF34")).toEqual(["pantry"]);
    expect(sdiFunctionalSemantics("SF35")).toEqual(["mud_room"]);
  });
});
