/**
 * Evaluation-facing object semantics.
 *
 * `functionTags` is the only product-use taxonomy. Asset names, display names,
 * styles and legacy categories may be shown as diagnostics, but must not create
 * a use classification by keyword guessing.
 */
export type TaggedObject = { functionTags?: readonly string[] | null };

export type FurnitureSemantic = "bed" | "sofa" | "dining-table" | "dining-chair" | "desk" | "office-chair" | "armchair" | "bench" | "coffee-table" | "bedside-table" | "wardrobe" | "other";
export type FixtureSemantic = "sink" | "toilet" | "bathtub" | "shower" | "showerhead" | "stove" | "oven" | "dishwasher" | "refrigerator" | "counter" | "base-cabinet" | "island" | "washer" | "other";
export type ObjectPlacementRole = "fixed" | "placed-furniture" | "light-movable" | "vehicle" | "other";

const normalize = (tag: string) => tag.trim().toLowerCase().replace(/_/g, "-");
export const functionTagsOf = (object: TaggedObject): string[] => [...new Set((object.functionTags ?? []).filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0).map(normalize))];
export const hasFunctionTag = (object: TaggedObject, ...tags: string[]) => {
  const actual = new Set(functionTagsOf(object));
  return tags.some((tag) => actual.has(normalize(tag)));
};

export function furnitureSemanticOf(object: TaggedObject): FurnitureSemantic {
  if (hasFunctionTag(object, "double-beds", "single-beds", "beds", "bed")) return "bed";
  if (hasFunctionTag(object, "sofas", "sofa")) return "sofa";
  if (hasFunctionTag(object, "dining-tables", "dining-table")) return "dining-table";
  if (hasFunctionTag(object, "dining-chairs", "dining-chair")) return "dining-chair";
  if (hasFunctionTag(object, "desks", "desk")) return "desk";
  if (hasFunctionTag(object, "office-chairs", "office-chair")) return "office-chair";
  if (hasFunctionTag(object, "armchairs", "armchair")) return "armchair";
  if (hasFunctionTag(object, "benches", "bench")) return "bench";
  if (hasFunctionTag(object, "coffee-tables", "coffee-table")) return "coffee-table";
  if (hasFunctionTag(object, "bedside-tables", "bedside-table", "nightstands")) return "bedside-table";
  if (hasFunctionTag(object, "wardrobes", "wardrobe")) return "wardrobe";
  return "other";
}

export function fixtureSemanticOf(object: TaggedObject): FixtureSemantic {
  if (hasFunctionTag(object, "toilets", "toilet", "water-closets")) return "toilet";
  if (hasFunctionTag(object, "bathtubs", "bathtub")) return "bathtub";
  if (hasFunctionTag(object, "shower-enclosures", "shower-enclosure", "showers")) return "shower";
  if (hasFunctionTag(object, "showerheads", "showerhead")) return "showerhead";
  if (hasFunctionTag(object, "sinks", "sink", "utility-sink", "basins", "lavatories")) return "sink";
  // Combined range/oven assets remain cooking appliances for the kitchen-core
  // relationship. Rules that need an operable oven door inspect the explicit
  // `ovens` function tag separately instead of turning every stove into an oven.
  if (hasFunctionTag(object, "stoves", "stove", "cooktops")) return "stove";
  if (hasFunctionTag(object, "ovens", "oven")) return "oven";
  if (hasFunctionTag(object, "dishwashers", "dishwasher")) return "dishwasher";
  if (hasFunctionTag(object, "refrigerators", "refrigerator", "fridges")) return "refrigerator";
  if (hasFunctionTag(object, "kitchen-islands", "islands")) return "island";
  if (hasFunctionTag(object, "counters", "countertops")) return "counter";
  if (hasFunctionTag(object, "cabinets", "base-cabinets")) return "base-cabinet";
  if (hasFunctionTag(object, "washing-machines", "washers", "laundry-appliances")) return "washer";
  return "other";
}

export function placementRoleOf(object: TaggedObject): ObjectPlacementRole {
  if (hasFunctionTag(object, "vehicles", "vehicle")) return "vehicle";
  if (hasFunctionTag(object, "dining-chairs", "dining-chair", "office-chairs", "office-chair", "armchairs", "armchair", "chairs", "stools", "ottomans")) return "light-movable";
  if (fixtureSemanticOf(object) !== "other" || hasFunctionTag(object, "cabinets", "kitchen-islands", "air-conditioning-units", "power-towers")) return "fixed";
  if (furnitureSemanticOf(object) !== "other" || hasFunctionTag(object, "pool-tables", "computers")) return "placed-furniture";
  return "other";
}

export type OperationCapability = "fixed-cabinet" | "storage-cabinet" | "drawer" | "major-appliance" | "laundry-appliance" | "household-fixture" | "open-shelf";

export function operationCapabilitiesOf(object: TaggedObject): OperationCapability[] {
  const result: OperationCapability[] = [];
  if (hasFunctionTag(object, "washing-machines", "washers", "laundry-appliances")) result.push("laundry-appliance", "major-appliance");
  else if (hasFunctionTag(object, "refrigerators", "stoves", "ovens", "dishwashers", "kitchen-appliances")) result.push("major-appliance");
  if (hasFunctionTag(object, "drawers", "bedside-tables", "bedside-table", "nightstands")) result.push("drawer");
  if (hasFunctionTag(object, "wardrobes")) result.push("storage-cabinet");
  if (hasFunctionTag(object, "cabinets", "base-cabinets", "kitchen-islands")) result.push("fixed-cabinet");
  if (hasFunctionTag(object, "sinks", "sink", "utility-sink", "shower-enclosures", "shower-enclosure", "ironing-stations")) result.push("household-fixture");
  if (hasFunctionTag(object, "bookshelf", "bookshelves", "open-rack", "open-shelf")) result.push("open-shelf");
  return [...new Set(result)];
}
