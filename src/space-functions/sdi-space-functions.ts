export const SDI_SPACE_FUNCTIONS = {
  SF00: "室内通用", SF01: "开放厨房", SF02: "封闭厨房", SF03: "主卫浴室", SF04: "公卫浴室", SF05: "次卫浴室",
  SF06: "客厅", SF07: "餐厅", SF08: "玄关", SF09: "走道", SF10: "入户", SF11: "主卧室", SF12: "次卧室",
  SF13: "小孩卧室", SF14: "老人卧室", SF15: "衣帽间", SF16: "书房", SF17: "阳台", SF18: "洗衣房",
  SF19: "楼梯间", SF20: "储藏室", SF21: "保姆房", SF22: "健身房", SF23: "天井", SF24: "设备间",
  SF25: "工作室", SF26: "影音室", SF27: "娱乐室", SF28: "茶室", SF29: "酒窖", SF30: "车库", SF31: "佛堂",
  SF32: "电梯间", SF33: "观赏间", SF50: "户外通用", SF51: "花园", SF52: "露台", SF53: "车位", SF54: "庭院",
  SF55: "屋顶", SF56: "建筑立面", SF34: "食品储藏间", SF35: "泥房", SF36: "儿童活动区",
} as const;

export type SdiSpaceFunctionCode = keyof typeof SDI_SPACE_FUNCTIONS;
export type SdiFunctionalSemantic = "bathroom" | "bedroom" | "chinese_kitchen" | "closed_kitchen" | "circulation" | "dining" | "entry" | "foyer" | "garage" | "kitchen" | "laundry" | "living_room" | "mud_room" | "office" | "open_kitchen" | "pantry" | "primary_bathroom" | "primary_bedroom" | "recreation" | "service" | "storage" | "study" | "walk_in_closet";

const SEMANTICS_BY_CODE: Partial<Record<SdiSpaceFunctionCode, readonly SdiFunctionalSemantic[]>> = {
  SF01: ["kitchen", "open_kitchen"], SF02: ["kitchen", "closed_kitchen", "chinese_kitchen"], SF03: ["bathroom", "primary_bathroom"],
  SF04: ["bathroom"], SF05: ["bathroom"], SF06: ["living_room"], SF07: ["dining"], SF08: ["foyer", "circulation"],
  SF09: ["circulation"], SF10: ["entry", "circulation"], SF11: ["bedroom", "primary_bedroom"], SF12: ["bedroom"], SF13: ["bedroom"],
  SF14: ["bedroom"], SF15: ["walk_in_closet"], SF16: ["study"], SF18: ["laundry"], SF19: ["circulation"],
  SF20: ["storage"], SF24: ["service"], SF25: ["office"], SF27: ["recreation"], SF30: ["garage"],
  SF34: ["pantry"], SF35: ["mud_room"], SF36: ["recreation"],
};

export const isSdiSpaceFunctionCode = (value: unknown): value is SdiSpaceFunctionCode => typeof value === "string" && Object.prototype.hasOwnProperty.call(SDI_SPACE_FUNCTIONS, value);
export const sdiSpaceFunctionName = (code: string | null | undefined) => isSdiSpaceFunctionCode(code) ? SDI_SPACE_FUNCTIONS[code] : null;
export const sdiFunctionalSemantics = (code: SdiSpaceFunctionCode): readonly SdiFunctionalSemantic[] => SEMANTICS_BY_CODE[code] ?? [];
