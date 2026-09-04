export type VisibilityStrategy =
  | "container"
  | "standalone"
  | "hosted"
  | "parent-emitted"
  | "view-specific"
  | "helper-view-specific"
  | "symbol-only"
  | "nonvisual"
  | "source-dependent";
export type OverallStatus =
  | "supported-exact"
  | "supported-pascal-equivalent"
  | "supported-demo-symbol"
  | "parsed-parent-emitted"
  | "parsed-container"
  | "parsed-intentionally-hidden"
  | "parsed-not-rendered"
  | "partially-supported"
  | "invalid-data"
  | "unknown-plugin-node";
export type DemoSupport = {
  schemaRecognition: "complete" | "partial" | "none";
  rawDataPreservation: "complete" | "partial" | "none";
  levelResolution: "complete" | "partial" | "not-applicable" | "none";
  transformResolution: "complete" | "partial" | "not-applicable" | "none";
  floorplanRendering:
    | "exact"
    | "pascal-equivalent"
    | "demo-custom-symbol"
    | "placeholder"
    | "parent-emitted"
    | "intentionally-hidden"
    | "none";
  inspectorSupport: "complete" | "partial" | "none";
  diagnosticSupport: "complete" | "partial" | "none";
  testCoverage: "complete" | "partial" | "none";
  overallStatus: OverallStatus;
  evidence: { files: string[]; functions: string[]; tests: string[] };
};
export type PascalCoreManifestEntry = {
  kind: string;
  upstream: {
    repository: string;
    commit: string;
    schemaPath: string;
    definitionPath: string;
    floorplanPath?: string;
    rendererPath?: string;
  };
  classification: {
    category: string;
    expectedVisibilityStrategy: VisibilityStrategy[];
  };
  schema: {
    schemaVersion: string;
    discriminators: string[];
    variants: string[];
    importantEnums: Record<string, string[]>;
    requiredFields: string[] | string;
    optionalFields: string[] | string;
    defaultedFields: Record<string, unknown> | string;
  };
  hierarchy: {
    allowedParentKinds: string[] | string;
    allowedChildKinds: string[] | string;
    hosts: string[];
    parentEmittedBy?: string;
  };
  coordinates: {
    coordinateSpace: string;
    positionFields: string[];
    rotationFields: string[];
    hostedCoordinateMeaning: string;
  };
  pascalCapabilities: {
    hasPascalFloorplan: boolean;
    hasPascal3DRenderer: boolean;
    hasGeometryBuilder: boolean | string;
    hasFloorplanLevelData: boolean | string;
    floorplanDependsOnParent: boolean;
    floorplanDependsOnSiblings: boolean | string;
  };
  currentDemoStatus: DemoSupport;
  reviewEvidence: string[];
};
