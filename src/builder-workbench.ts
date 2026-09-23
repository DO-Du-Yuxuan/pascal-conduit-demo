import type { NetworkDeviceType, RoutingSystem } from "./domain/overlay";

export type BuilderSystemId = "electrical" | "plumbing" | "lighting" | "hvac" | "smart" | "water" | "bath" | "fire" | "irrigation" | "gas";
export type BuilderAuthorTool = "select" | "draw" | "branch" | "point" | "beam" | "delete" | "hvac-unit" | "hvac-duct" | "hvac-outlet" | "hvac-thermostat" | "hvac-bind";
export type BuilderCardSection = "place" | "draw" | "edit";
export type BuilderCard = { label: string; icon: string; section: BuilderCardSection; tool: BuilderAuthorTool; system?: RoutingSystem; deviceType?: NetworkDeviceType };
export type BuilderCatalogLock = { tools?: readonly BuilderAuthorTool[]; systems?: readonly RoutingSystem[]; deviceTypes?: readonly NetworkDeviceType[] };

export const BUILDER_CARD_SECTION_LABELS: Record<BuilderCardSection, string> = {
  place: "放置设备",
  draw: "绘制",
  edit: "编辑动作",
};

/** A card starts one bounded authoring flow; its portal must not reopen the old global picker. */
export function catalogLockForBuilderCard(card: Pick<BuilderCard, "tool" | "system" | "deviceType">): BuilderCatalogLock {
  return {
    // Binding is an object-property action on the selected FCU, not a catalog card.
    tools: card.tool === "hvac-unit" ? [card.tool, "hvac-bind"] : [card.tool],
    ...(card.system ? { systems: [card.system] } : {}),
    ...(card.deviceType ? { deviceTypes: [card.deviceType] } : {}),
  };
}

export function canUseCatalogSystem(lock: BuilderCatalogLock | undefined, system: RoutingSystem) {
  return !lock?.systems || lock.systems.includes(system);
}

export function canUseCatalogTool(lock: BuilderCatalogLock | undefined, tool: BuilderAuthorTool) {
  return !lock?.tools || lock.tools.includes(tool);
}

export const BUILDER_SYSTEMS: ReadonlyArray<{ id: BuilderSystemId; label: string; icon: string }> = [
  { id: "electrical", label: "电气", icon: "⚡" },
  { id: "plumbing", label: "给排水", icon: "◉" },
  { id: "lighting", label: "照明", icon: "☼" },
  { id: "hvac", label: "空调", icon: "❄" },
  { id: "smart", label: "智能", icon: "⌁" },
  { id: "water", label: "净水", icon: "◇" },
  { id: "bath", label: "卫浴", icon: "▣" },
  { id: "fire", label: "消防", icon: "◈" },
  { id: "irrigation", label: "灌溉", icon: "✿" },
  { id: "gas", label: "燃气", icon: "◐" },
];

export const BUILDER_CARDS: Readonly<Record<BuilderSystemId, ReadonlyArray<BuilderCard>>> = {
  electrical: [
    { label: "强电箱", icon: "▣", section: "place", tool: "point", system: "receptacle", deviceType: "strong-panel" },
    { label: "弱电箱", icon: "▣", section: "place", tool: "point", system: "network", deviceType: "weak-panel" },
    { label: "插座", icon: "▤", section: "place", tool: "point", system: "receptacle", deviceType: "socket" },
    { label: "网络插座", icon: "▤", section: "place", tool: "point", system: "network", deviceType: "network-outlet" },
    { label: "绘制插座管", icon: "⌁", section: "draw", tool: "draw", system: "receptacle" },
    { label: "绘制网络管", icon: "⌁", section: "draw", tool: "draw", system: "network" },
    { label: "创建管线分支", icon: "⑂", section: "edit", tool: "branch", system: "receptacle" },
  ],
  plumbing: [],
  lighting: [
    { label: "开关", icon: "◫", section: "place", tool: "point", system: "lighting", deviceType: "switch" },
    { label: "圆柱形射灯", icon: "☼", section: "place", tool: "point", system: "lighting", deviceType: "luminaire" },
    { label: "绘制照明管", icon: "⌁", section: "draw", tool: "draw", system: "lighting" },
    { label: "创建管线分支", icon: "⑂", section: "edit", tool: "branch", system: "lighting" },
  ],
  hvac: [
    { label: "FCU 空调内机", icon: "▰", section: "place", tool: "hvac-unit" },
    { label: "FCU 温控器", icon: "◫", section: "place", tool: "hvac-thermostat" },
    { label: "温湿度传感器", icon: "◉", section: "place", tool: "point", deviceType: "sensor" },
    { label: "绘制镀锌铁皮风管", icon: "▱", section: "draw", tool: "hvac-duct" },
    { label: "添加风口", icon: "▥", section: "edit", tool: "hvac-outlet" },
  ],
  smart: [
    { label: "RFID 读写器", icon: "◉", section: "place", tool: "point", deviceType: "rfid-reader" },
  ],
  water: [],
  bath: [],
  fire: [
    { label: "喷淋头", icon: "✳", section: "place", tool: "point", system: "sprinkler", deviceType: "sprinkler-head" },
    { label: "绘制消防管", icon: "⌁", section: "draw", tool: "draw", system: "sprinkler" },
    { label: "创建管线分支", icon: "⑂", section: "edit", tool: "branch", system: "sprinkler" },
  ],
  irrigation: [],
  gas: [],
};
