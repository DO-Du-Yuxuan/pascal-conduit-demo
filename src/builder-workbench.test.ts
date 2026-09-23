import { describe, expect, it } from "vitest";
import { BUILDER_CARD_SECTION_LABELS, BUILDER_CARDS, BUILDER_SYSTEMS, canUseCatalogSystem, canUseCatalogTool, catalogLockForBuilderCard } from "./builder-workbench";

describe("Builder system workbench", () => {
  it("keeps the ten visible systems in the agreed order", () => {
    expect(BUILDER_SYSTEMS.map((system) => system.label)).toEqual(["电气", "给排水", "照明", "空调", "智能", "净水", "卫浴", "消防", "灌溉", "燃气"]);
    expect(new Set(BUILDER_SYSTEMS.map((system) => system.id)).size).toBe(10);
  });

  it("exposes only implemented authoring tools and honest empty systems", () => {
    for (const system of BUILDER_SYSTEMS) expect(BUILDER_CARDS[system.id]).toBeDefined();
    for (const id of ["plumbing", "water", "bath", "irrigation", "gas"] as const) expect(BUILDER_CARDS[id]).toEqual([]);
    expect(BUILDER_CARDS.electrical).toContainEqual(expect.objectContaining({ tool: "point", deviceType: "socket", system: "receptacle" }));
    expect(BUILDER_CARDS.electrical).toContainEqual(expect.objectContaining({ tool: "draw", system: "network" }));
    expect(BUILDER_CARDS.electrical).toContainEqual(expect.objectContaining({ tool: "point", deviceType: "strong-panel" }));
    expect(BUILDER_CARDS.lighting).toContainEqual(expect.objectContaining({ tool: "point", deviceType: "luminaire", system: "lighting" }));
    expect(BUILDER_CARDS.lighting.some((card) => card.deviceType === "strong-panel")).toBe(false);
    expect(BUILDER_CARDS.hvac).toContainEqual(expect.objectContaining({ tool: "hvac-duct" }));
    expect(BUILDER_CARDS.hvac).toContainEqual(expect.objectContaining({ tool: "point", deviceType: "sensor" }));
    expect(BUILDER_CARDS.smart).toEqual([expect.objectContaining({ tool: "point", deviceType: "rfid-reader" })]);
    expect(BUILDER_CARDS.fire).toEqual([
      expect.objectContaining({ label: "喷淋头", tool: "point", deviceType: "sprinkler-head" }),
      expect.objectContaining({ label: "绘制消防管", tool: "draw", system: "sprinkler" }),
      expect.objectContaining({ label: "创建管线分支", tool: "branch", system: "sprinkler" }),
    ]);
  });

  it("groups each implemented system into placement, drawing, and editing actions", () => {
    expect(BUILDER_CARD_SECTION_LABELS).toEqual({ place: "放置设备", draw: "绘制", edit: "编辑动作" });
    expect(BUILDER_CARDS.electrical.filter((card) => card.section === "place").map((card) => card.label)).toEqual(["强电箱", "弱电箱", "插座", "网络插座"]);
    expect(BUILDER_CARDS.electrical.filter((card) => card.section === "draw").map((card) => card.label)).toEqual(["绘制插座管", "绘制网络管"]);
    expect(BUILDER_CARDS.lighting.filter((card) => card.section === "edit").map((card) => card.tool)).toEqual(["branch"]);
    expect(BUILDER_CARDS.hvac.filter((card) => card.section === "place").map((card) => card.label)).toEqual(["FCU 空调内机", "FCU 温控器", "温湿度传感器"]);
    expect(BUILDER_CARDS.hvac.filter((card) => card.section === "draw").map((card) => card.label)).toEqual(["绘制镀锌铁皮风管"]);
    expect(BUILDER_CARDS.hvac.filter((card) => card.section === "edit").map((card) => card.label)).toEqual(["添加风口"]);
    expect(BUILDER_CARDS.hvac.some((card) => card.tool === "hvac-bind")).toBe(false);
    expect(BUILDER_CARDS.smart.map((card) => card.label)).toEqual(["RFID 读写器"]);
    expect(BUILDER_CARDS.fire.map((card) => card.section)).toEqual(["place", "draw", "edit"]);
  });

  it("keeps a Builder card inside its own allowed system or device catalogue", () => {
    const smart = catalogLockForBuilderCard(BUILDER_CARDS.smart[0]!);
    expect(smart).toEqual({ tools: ["point"], deviceTypes: ["rfid-reader"] });
    const lighting = catalogLockForBuilderCard(BUILDER_CARDS.lighting.find((card) => card.tool === "draw")!);
    expect(lighting).toEqual({ tools: ["draw"], systems: ["lighting"] });
    expect(canUseCatalogSystem(lighting, "lighting")).toBe(true);
    expect(canUseCatalogSystem(lighting, "sprinkler")).toBe(false);
    expect(canUseCatalogTool(smart, "draw")).toBe(false);
    expect(canUseCatalogTool(lighting, "point")).toBe(false);
    expect(canUseCatalogTool(undefined, "draw")).toBe(true);
  });
});
