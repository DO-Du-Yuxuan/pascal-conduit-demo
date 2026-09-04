import { pascalCoreManifest } from "./pascalCoreManifest";
export const currentDemoSupportMatrix = Object.fromEntries(
  pascalCoreManifest.map((entry) => [entry.kind, entry.currentDemoStatus]),
);
export const currentVariantSupport = {
  stair: {
    spiral: "supported-demo-symbol",
    curved: "supported-pascal-equivalent",
    straight: "supported-pascal-equivalent",
  },
  shelf: {
    "wall-shelf": "supported-pascal-equivalent",
    bookshelf: "supported-pascal-equivalent",
    "open-rack": "supported-pascal-equivalent",
    cubby: "supported-pascal-equivalent",
  },
  door: {
    hinged: "partially-supported",
    double: "partially-supported",
    french: "partially-supported",
    folding: "partially-supported",
    pocket: "partially-supported",
    barn: "partially-supported",
    sliding: "partially-supported",
    "garage-sectional": "partially-supported",
    "garage-rollup": "partially-supported",
    "garage-tiltup": "partially-supported",
  },
  window: {
    fixed: "partially-supported",
    sliding: "partially-supported",
    casement: "partially-supported",
    awning: "partially-supported",
    hopper: "partially-supported",
    "single-hung": "partially-supported",
    "double-hung": "partially-supported",
    bay: "partially-supported",
    bow: "partially-supported",
    louvered: "partially-supported",
  },
} as const;
