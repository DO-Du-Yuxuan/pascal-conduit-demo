import type { EvaluationHandoff } from "../parser/evaluation-handoff";
import type { Diagnostic } from "../types";
import type { RequirementType } from "../requirements/requirement-handoff";

export type RuleStatus = "pass" | "issue" | "unable_to_determine" | "not_applicable";
export type RuleSeverity = "info" | "warning" | "error";
export type ConfidenceLevel = "high" | "medium" | "low";

export type RuleMeasurement = {
  name: string;
  value: number | string | boolean | null;
  unit?: string;
  normalizedObjectId?: string;
  measurementBasis?: "explicit" | "derived";
  assumptions?: string[];
  confidence?: ConfidenceLevel;
  thresholdValue?: number;
  margin?: number | null;
  lowerBound?: number | null;
  upperBound?: number | null;
  borderline?: boolean;
};

export type RuleThreshold = {
  name: string;
  value: number | string | boolean;
  unit?: string;
  originalValue?: number | string;
  originalUnit?: "in" | "in²" | "ft" | "ft²" | "%" | "count";
  convertedValue?: number;
  convertedUnit?: "m" | "m²" | "ratio" | "count";
};

export type RuleApplicability = {
  status: "applicable" | "not_applicable" | "unable_to_determine";
  reasons: string[];
};

export type RuleDataSufficiency = {
  status: "sufficient" | "insufficient" | "not_required";
  missingFields: string[];
};

export type RegulatoryCitation = {
  jurisdiction: string;
  codeName: string;
  codeVersion: string;
  section: string;
  sourceId: string;
  adoptionId: string;
};

export type RuleDiagnostic = {
  severity: RuleSeverity;
  code: string;
  message: string;
  normalizedObjectIds: string[];
  field?: string;
  actualValue?: number | string | boolean | null;
  expectedValue?: string;
  origin?: "source_data" | "parser" | "handoff" | "rule" | "geometry_tolerance" | "insufficient_information";
  recommendation?: string;
};

export type RuleConfidence = {
  level: ConfidenceLevel;
  score: number;
  reasons: string[];
};

export type RuleResult = {
  ruleId: string;
  ruleName: string;
  status: RuleStatus;
  severity: RuleSeverity;
  summary: string;
  details: string[];
  normalizedObjectIds: string[];
  pascalSourceIds: string[];
  measurements: RuleMeasurement[];
  thresholds: RuleThreshold[];
  missingData: string[];
  confidence: RuleConfidence;
  diagnostics: RuleDiagnostic[];
  applicability?: RuleApplicability;
  dataSufficiency?: RuleDataSufficiency;
  regulation?: RegulatoryCitation;
  customerRequirement?: {
    requirementId: string;
    requirementType: RequirementType;
    targetDescription: string;
    actualResult: string;
    reason: string;
    originalDescription?: string;
  };
};

export type EvaluationReport = {
  reportVersion: "1.0";
  handoffSchemaVersion: string;
  generatedAt: string;
  scope: "G1-foundation" | "G1-G3-foundation" | "G1-G2-G3-foundation" | "G1-G2-G3-G4-foundation" | "G2-technical" | "G4-requirements";
  overallStatus: RuleStatus;
  counts: Record<RuleStatus, number>;
  g2Summary?: G2EvaluationSummary;
  g3Summary?: G3EvaluationSummary;
  tolerances: GeometryTolerances;
  rules: RuleResult[];
  diagnostics: Diagnostic[];
};

export type G2EvaluationSummary = {
  overallStatus: RuleStatus;
  counts: Record<RuleStatus, number>;
  checkedObjectCount: number;
  issueObjectCount: number;
  unableReasonCount: number;
  jurisdiction: string;
  codeVersion: string;
};

export type G3EvaluationSummary = {
  overallStatus: RuleStatus;
  counts: Record<RuleStatus, number>;
  severityCounts: { severe: number; major: number; general: number };
  involvedRoomCount: number;
  involvedObjectCount: number;
  sections: {
    sameFloorUsability: Record<RuleStatus, number>;
    crossFloorUsability: Record<RuleStatus, number>;
    specialistChecks: Record<RuleStatus, number>;
    dataGaps: number;
  };
};

export type GeometryTolerances = {
  lengthMeters: number;
  areaSquareMeters: number;
  pointOnBoundaryMeters: number;
  overlapAreaSquareMeters: number;
  operationZoneOutsideAreaSquareMeters: number;
  roomMinimumAreaSquareMeters: number;
  roomNumericalSliverAreaSquareMeters: number;
  roomSlendernessMinimum: number;
  roomWallGapMeters: number;
  zoneRoomMatchMinimumRatio: number;
  zoneCrossRoomMinimumRatio: number;
  zoneOverlapMaximumRatio: number;
  doorPortalSampleClearanceMeters: number;
  doorPortalEndClearanceMeters: number;
  doorEntryDepthMeters: number;
  doorEntryMinimumClearRatio: number;
  doorOperationMinimumAngleRadians: number;
  doorCollisionAreaSquareMeters: number;
  doorLeafThicknessMeters: number;
  basicPassageWidthMeters: number;
  personRadiusMeters: number;
  navigationGridMeters: number;
  portalLandingSearchMeters: number;
  largeFurnitureMinimumAreaSquareMeters: number;
  smallObjectMaximumAreaSquareMeters: number;
  furnitureUseZoneClearRatio: number;
  bedAccessDepthMeters: number;
  seatingAccessDepthMeters: number;
  diningChairPulloutDepthMeters: number;
  fixtureStandingDepthMeters: number;
  bathEntryDepthMeters: number;
  kitchenCounterRelationMeters: number;
  cabinetOperationDepthMeters: number;
  drawerOperationDepthMeters: number;
  applianceOperationDepthMeters: number;
  windowOperationDepthMeters: number;
  windowOperationPassClearRatio: number;
  windowOperationIssueClearRatio: number;
  physicalCollisionAreaSquareMeters: number;
  physicalCollisionPenetrationMeters: number;
  physicalCollisionVerticalMeters: number;
  stairLandingSampleClearanceMeters: number;
  stairLandingSampleDepthMeters: number;
};

export type G1Rule = (handoff: EvaluationHandoff) => RuleResult;
export type G3Rule = (handoff: EvaluationHandoff) => RuleResult;
