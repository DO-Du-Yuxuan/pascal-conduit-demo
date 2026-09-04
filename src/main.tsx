import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import defaultLayoutText from "../sample-data/default-layout.json?raw";
import sampleText from "../sample-data/Bellevue demo.json?raw";
import passingSampleText from "../sample-data/Bellevue passing demo.json?raw";
import bellevueRequirementText from "../sample-data/requirements/Bellevue requirements demo.json?raw";
import "./styles.css";
import "./evaluation.css";
import { parseProject } from "./parser/parse";
import { Diagnostic, NodeData, Parsed } from "./types";
import {
  composePascalTransformWithWorldToSvg,
  compassArrowRotation,
  finalDimensions,
  normalizeDegrees,
  resolveDoorOperationOrientation,
  resolveAncestorLevelId,
  resolveItemPlanTransform,
  resolveWallOpeningTransform,
  rotatedPanDelta,
  svgMatrixString,
  ViewBox,
  zoomExtents,
} from "./geometry/transform";
import { canvasWheelGesture, canvasWheelZoomFactor, SAFARI_GESTURE_ZOOM_EXPONENT, TRACKPAD_PINCH_ZOOM_SENSITIVITY, zoomCanvasViewBox } from "./geometry/canvas-navigation";
import { inspectNodes } from "./diagnostics/check";
import { buildExperimentalWalls, Wall as PascalWall } from "./geometry/walls";
import { hasValidShelfFootprint, resolveShelfData, resolveShelfPlanTransform, shelfCorners, shelfDividerXs, shelfMatrix } from "./geometry/shelf";
import { buildSpiralStairDestinationEntry, buildSpiralStairPlanGeometry, spiralStairCorners } from "./geometry/spiral-stair";
import { buildSlabPlanGeometry } from "./geometry/slab";
import { buildCurvedStairPlanGeometry, buildStraightStairPlanGeometry, stairCorners } from "./geometry/stairs";
import { zoneColor, zoneLabelPoint, zonePoints } from "./geometry/zone";
import { buildAlignedDimensionDisplay, buildExteriorDimensions, DimensionSegment, dimensionDisplayGeometry, dimensionOverlayBounds, EXTENSION_OVERSHOOT_M, INNER_CHAIN_OFFSET_M, OVERALL_CHAIN_OFFSET_M, uprightDimensionAngle } from "./geometry/exterior-dimensions";
import { buildManualMeasurementGeometry, buildMeasurementSnapSegments, formatArea, formatMeasurement, ManualMeasurement, MeasurementMode, MeasurementSnap, MeasurementUnit, resolveMeasurementMode, snapMeasurementPoint } from "./geometry/manual-measurement";
import { ALPHA_THRESHOLD, computeCropPlacement, floorplanImageCropDiagnostics, FloorplanImageCropCacheEntry, loadFloorplanImageCrop, peekFloorplanImageCrop, subscribeFloorplanImageCrop } from "./geometry/floorplan-image-crop";
import { auditSceneCoverage } from "./coverage/auditSceneCoverage";
import { buildEvaluationHandoff } from "./parser/evaluation-handoff";
import { evaluateAll, evaluateG4RequirementsOnly, requirementGateBlocks, EvaluationReport, RuleStatus } from "./evaluation/evaluate";
import { DEFAULT_G2_JURISDICTION, DEFAULT_G2_PROJECT_USE, G2_JURISDICTION_OPTIONS, G2_PROJECT_USE_OPTIONS, g2ContextForEvaluationProfile, type G2JurisdictionSelection, type G2ProjectUseSelection } from "./evaluation/g2-evaluation-profile";
import { designerRulePresentation, evaluationIssueTargets, EvaluationFocusTarget, isDependencyOnlyTechnicalRule, orderEvaluationRulesForDisplay } from "./evaluation-ui/presentation";
import { evaluationHighlightFor, evaluationHighlightRole, evaluationPathViewBox, EvaluationHighlight, resolveEvaluationFocus } from "./evaluation-ui/focus";
import { buildBuildingEnvelopes, BuildingEnvelope } from "./evaluation/envelope";
import { buildRoomRegionAnalysis, RoomRegionAnalysis } from "./evaluation/room-regions";
import { buildRoomConnectivityGraph, reachableNodeIds, RoomConnectivityGraph } from "./evaluation/connectivity";
import { buildDoorOperations, type DoorOperation } from "./evaluation/door-operations";
import { navigationAnalysis } from "./evaluation/g3-navigation-rules";
import type { RoomNavigationAnalysis } from "./evaluation/navigation";
import { buildReachableAreaRects } from "./evaluation-ui/navigable-overlay";
import { furnitureUseAnalysis } from "./evaluation/g3-furniture-rules";
import type { FurnitureUseAnalysis } from "./evaluation/furniture-use";
import { fixtureUseAnalysis } from "./evaluation/g3-fixture-rules";
import type { FixtureUseAnalysis } from "./evaluation/fixture-use";
import { operationUseAnalysis } from "./evaluation/g3-final-rules";
import { operationZoneDisplayGroup, type OperationUseAnalysis, type OperationZoneDisplayGroup } from "./evaluation/operation-use";
import { buildUnifiedEvaluationReport, compareFindingsForDisplay, reportHasSourceGroup, visibleReportFindings, type Finding } from "./evaluation-report/report";
import { loadRequirementHandoffJson, type RequirementHandoff } from "./requirements/requirement-handoff";
import { createSceneVisibilityHistory, hideSceneNode, isHideableSceneNode, redoSceneVisibility, restoreAllSceneNodes, undoSceneVisibility } from "./scene-visibility";
import { buildThreeDSceneInput } from "./three/scene-input";
import ThreeDWorkspace from "./three/ThreeDWorkspace";
import { useOverlayStore } from "./domain/store";
import { createEmptyOverlay, type BendArc, type ConduitOverlayDocument, type Vec3 } from "./domain/overlay";
import { planFittingDisplay } from "./domain/network-plan";
import { clampSplitRatio, visibleTwoDCanvasIds, type WorkspaceViewMode } from "./domain/workspace-layout";
import { evaluateS1Gate, measureS1FunctionalRelationshipPairs, type S1FunctionalRelationshipMeasurement, type S1FunctionalRelationshipReport, type S1GateResult } from "./evaluation/s1";
import { scoreS1FunctionalRelationships } from "./evaluation/s1-functional-relation-scoring";
import { measureS1EntrySequence, scoreS1SpaceOrganization, type S1SpaceOrganizationReport } from "./evaluation/s1-space-organization";
import { scoreS1ActivityZoning, type S1ActivityZoningReport, type S1Dz01Measurement, type S1Dz02Measurement } from "./evaluation/s1-activity-zoning";
import { scoreS1SpaceUtilization, type S1SpaceUtilizationReport } from "./evaluation/s1-space-utilization";
import { scoreS1StorageConfiguration, type S1StorageConfigurationReport } from "./evaluation/s1-storage-configuration";
import { aggregateS1V01, type S1AggregateReport } from "./evaluation/s1-aggregate";
import type { S1PublicCirculationRouteMeasurement } from "./evaluation/s1-public-circulation-privacy";
import { measureS1HighFrequencyPaths, type S1HighFrequencyPathMeasurement, type S1HighFrequencyPathReport } from "./evaluation/s1-high-frequency-path";
import { scoreS1HighFrequencyPaths, type S1HighFrequencyPathScoreSummary } from "./evaluation/s1-high-frequency-path-scoring";
import type { S1PathConflictPairMeasurement } from "./evaluation/s1-path-conflict";
import type { S1SpaceFragmentMeasurement } from "./evaluation/s1-space-fragment";
import type { S1FurnitureRelationMeasurement, S1FurnitureUseMeasurement } from "./evaluation/s1-furniture";

type Visibility = {
  images: boolean;
  boxes: boolean;
  centers: boolean;
  axes: boolean;
  names: boolean;
  zones: boolean;
  slabs: boolean;
  walls: boolean;
  shelves: boolean;
  stairs: boolean;
  openings: boolean;
  dimensions: boolean;
};
type CanvasState = {
  id: number;
  levelId: string;
  viewBox: ViewBox;
  rotation: number;
};
type S1PathDebugLayers = { rawGrid: boolean; smoothed: boolean; anchors: boolean; portals: boolean; finalPolyline: boolean };
type S1PathPocProvider = "current" | "yuka" | "visibilityGraph";
const defaultS1PathDebugLayers: S1PathDebugLayers = { rawGrid: false, smoothed: false, anchors: false, portals: false, finalPolyline: true };
const visibilityDefault: Visibility = {
  images: true,
  boxes: false,
  centers: false,
  axes: false,
  names: false,
  zones: true,
  slabs: true,
  walls: true,
  shelves: true,
  stairs: true,
  openings: true,
  dimensions: true,
};
const emptyView: ViewBox = { minX: -5, minZ: -5, width: 10, height: 10 };
const DEFAULT_CANVAS_ROTATION = 90;
const DEFAULT_CONDUIT_SOURCE_SHA = "32d135bef65a6a0fdb06485cc24a68a68cd864e9a4322907971c659b26c7e167";
type EvaluationRunState = { running: boolean; progress: number; label: string; lastDurationMs: number | null };
type S1UiReport = { highFrequencyPathEfficiency: S1HighFrequencyPathReport; highFrequencyPathEfficiencyScoring: S1HighFrequencyPathScoreSummary; spaceOrganization: S1SpaceOrganizationReport; activityZoning: S1ActivityZoningReport; spaceUtilization: S1SpaceUtilizationReport; storageConfiguration: S1StorageConfigurationReport; aggregate: S1AggregateReport };
const initialEvaluationRunState: EvaluationRunState = { running: false, progress: 0, label: "", lastDurationMs: null };
const allowUiPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => window.setTimeout(resolve, 0)));
const formatPanelLength = (valueMeters: number, unit: MeasurementUnit) => unit === "millimeters" ? `${formatMeasurement(valueMeters, unit)} mm` : formatMeasurement(valueMeters, unit);
const builtInRequirementLoad = loadRequirementHandoffJson(bellevueRequirementText);
if (!builtInRequirementLoad.ok) throw new Error(builtInRequirementLoad.error);
const BELLEVUE_DEMO_REQUIREMENTS = builtInRequirementLoad.handoff;
function App() {
  const [data, setData] = useState<Parsed | null>(null),
    [file, setFile] = useState("未导入文件"),
    [sourceSha, setSourceSha] = useState(""),
    [canvases, setCanvases] = useState<CanvasState[]>([
      { id: 1, levelId: "", viewBox: emptyView, rotation: DEFAULT_CANVAS_ROTATION },
    ]),
    [nextId, setNextId] = useState(2),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [selectedDimension, setSelectedDimension] = useState<DimensionSegment | null>(null),
    [selectedManualId, setSelectedManualId] = useState<string | null>(null),
    [sceneVisibility, setSceneVisibility] = useState(createSceneVisibilityHistory),
    [manualMeasurements, setManualMeasurements] = useState<ManualMeasurement[]>([]),
    [measurementMode, setMeasurementMode] = useState<MeasurementMode>("off"),
    [measurementUnit, setMeasurementUnit] = useState<MeasurementUnit>("millimeters"),
    [imageCropRevision, setImageCropRevision] = useState(0),
    [evaluationReport, setEvaluationReport] = useState<EvaluationReport | null>(null),
    [s1Report, setS1Report] = useState<S1FunctionalRelationshipReport | null>(null),
    [s1HpeReport, setS1HpeReport] = useState<S1UiReport | null>(null),
    [evaluationRunState, setEvaluationRunState] = useState<EvaluationRunState>(initialEvaluationRunState),
    [s1RunState, setS1RunState] = useState<EvaluationRunState>(initialEvaluationRunState),
    [s1Error, setS1Error] = useState<string | null>(null),
    [evaluationGroup, setEvaluationGroup] = useState<EvaluationGroup>("all"),
    [requirementHandoff, setRequirementHandoff] = useState<RequirementHandoff | null>(null),
    [requirementFile, setRequirementFile] = useState("暂不评价客户需求"),
    [requirementError, setRequirementError] = useState<string | null>(null),
    [g2ProjectUse, setG2ProjectUse] = useState<G2ProjectUseSelection>(DEFAULT_G2_PROJECT_USE),
    [g2Jurisdiction, setG2Jurisdiction] = useState<G2JurisdictionSelection>(DEFAULT_G2_JURISDICTION),
    [buildingEnvelopes, setBuildingEnvelopes] = useState<BuildingEnvelope[]>([]),
    [showBuildingEnvelope, setShowBuildingEnvelope] = useState(false),
    [roomRegionAnalysis, setRoomRegionAnalysis] = useState<RoomRegionAnalysis | null>(null),
    [showRoomRegions, setShowRoomRegions] = useState(false),
    [s1PathPocProvider] = useState<S1PathPocProvider>("current"),
    [connectivityGraph, setConnectivityGraph] = useState<RoomConnectivityGraph | null>(null),
    [showConnectivity, setShowConnectivity] = useState(false),
    [doorOperations, setDoorOperations] = useState<DoorOperation[]>([]),
    [showDoorOperationDebug, setShowDoorOperationDebug] = useState(false),
    [roomNavigationAnalysis, setRoomNavigationAnalysis] = useState<RoomNavigationAnalysis | null>(null),
    [showNavigableSpace, setShowNavigableSpace] = useState(false),
    [furnitureUseZones, setFurnitureUseZones] = useState<FurnitureUseAnalysis | null>(null),
    [showFurnitureUseZones, setShowFurnitureUseZones] = useState(false),
    [fixtureUseZones, setFixtureUseZones] = useState<FixtureUseAnalysis | null>(null),
    [showFixtureUseZones, setShowFixtureUseZones] = useState(false),
    [operationUseZones, setOperationUseZones] = useState<OperationUseAnalysis | null>(null),
    [showOperationUseZones, setShowOperationUseZones] = useState(false),
    [s1PathDebugLayers] = useState<S1PathDebugLayers>(defaultS1PathDebugLayers),
    [evaluationError, setEvaluationError] = useState<string | null>(null),
    [evaluationHighlights, setEvaluationHighlights] = useState<EvaluationHighlight[]>([]),
    [activeEvaluationHighlight, setActiveEvaluationHighlight] = useState<EvaluationHighlight | null>(null),
    [evaluationFocusMessage, setEvaluationFocusMessage] = useState<string | null>(null),
    [visibility, setVisibility] = useState(visibilityDefault),
    [workspaceViewMode, setWorkspaceViewMode] = useState<WorkspaceViewMode>("2d"),
    [threeDActivated, setThreeDActivated] = useState(false),
    [splitRatio, setSplitRatio] = useState(45),
    [twoDPanelCollapsed, setTwoDPanelCollapsed] = useState(false);
  const input = useRef<HTMLInputElement>(null), nextMeasurementId = useRef(1), evaluationRuleElements = useRef<Record<string, HTMLElement | null>>({}), splitResize = useRef<{ startX: number; startRatio: number; width: number } | null>(null);
  const nodes = data?.nodes || {};
  const conduitOverlay = useOverlayStore((state) => state.overlay);
  const conduitOverlayDirty = useOverlayStore((state) => state.dirty);
  const resetConduitOverlay = useOverlayStore((state) => state.load);
  const levels = Object.values(nodes).filter((n) => n.type === "level");
  const threeDScene = useMemo(() => data ? buildThreeDSceneInput(data) : null, [data]);
  const hiddenNodeIds = useMemo(() => new Set(sceneVisibility.hiddenNodeIds), [sceneVisibility.hiddenNodeIds]);
  useEffect(() => { const closeTransientUi = (event: KeyboardEvent) => { if (event.key !== "Escape") return; setMeasurementMode("off"); if (activeEvaluationHighlight) { setActiveEvaluationHighlight(null); setEvaluationFocusMessage(null); return; } setEvaluationHighlights([]); setEvaluationFocusMessage(null); }; window.addEventListener("keydown", closeTransientUi); return () => window.removeEventListener("keydown", closeTransientUi); }, [activeEvaluationHighlight]);
  useEffect(() => {
    if (!conduitOverlayDirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [conduitOverlayDirty]);
  useEffect(() => subscribeFloorplanImageCrop(() => setImageCropRevision((revision) => revision + 1)), []);
  const clearEvaluationResults = () => {
    setEvaluationReport(null);
    setS1Report(null);
    setS1HpeReport(null);
    setEvaluationRunState(initialEvaluationRunState);
    setS1RunState(initialEvaluationRunState);
    setS1Error(null);
    setEvaluationHighlights([]);
    setActiveEvaluationHighlight(null);
    setEvaluationFocusMessage(null);
    setEvaluationGroup((current) => current === "G4" ? "all" : current);
  };
  const useBellevueRequirements = () => {
    setRequirementHandoff(BELLEVUE_DEMO_REQUIREMENTS);
    setRequirementFile("Bellevue Demo 客户需求");
    setRequirementError(null);
    clearEvaluationResults();
  };
  const disableCustomerRequirements = () => {
    setRequirementHandoff(null);
    setRequirementFile("暂不评价客户需求");
    setRequirementError(null);
    clearEvaluationResults();
  };
  const loadRequirementFile = async (uploaded: File) => {
    const result = loadRequirementHandoffJson(await uploaded.text());
    if (result.ok) {
      setRequirementHandoff(result.handoff);
      setRequirementFile(uploaded.name);
      setRequirementError(null);
    } else {
      setRequirementHandoff(null);
      setRequirementFile("暂不评价客户需求");
      setRequirementError(result.error);
    }
    clearEvaluationResults();
  };
  const load = async (text: string, name: string, useDemoRequirements = false) => {
    try {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      const sha256 = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
      const parsed = parseProject(JSON.parse(text));
      parsed.diagnostics = [
        ...parsed.diagnostics,
        ...inspectNodes(parsed.nodes),
      ];
      const first =
        Object.values(parsed.nodes).find((n) => n.type === "level")?.id || "";
      setData(parsed);
      setEvaluationReport(null);
      setS1Report(null);
      setS1HpeReport(null);
      setEvaluationRunState(initialEvaluationRunState);
      setS1RunState(initialEvaluationRunState);
      setS1Error(null);
      setBuildingEnvelopes([]);
      setShowBuildingEnvelope(false);
      setRoomRegionAnalysis(null);
      setShowRoomRegions(false);
      setConnectivityGraph(null);
      setShowConnectivity(false);
      setDoorOperations([]);
      setShowDoorOperationDebug(false);
      setRoomNavigationAnalysis(null);
      setShowNavigableSpace(false);
      setFurnitureUseZones(null);
      setFixtureUseZones(null);
      setShowFixtureUseZones(false);
      setOperationUseZones(null);
      setShowOperationUseZones(false);
      setShowFurnitureUseZones(false);
      setEvaluationError(null);
      setEvaluationHighlights([]);
      setActiveEvaluationHighlight(null);
      setEvaluationFocusMessage(null);
      if (useDemoRequirements) {
        setRequirementHandoff(BELLEVUE_DEMO_REQUIREMENTS);
        setRequirementFile("Bellevue Demo 客户需求");
      } else {
        setRequirementHandoff(null);
        setRequirementFile("暂不评价客户需求");
      }
      setRequirementError(null);
      setFile(name);
      setSourceSha(sha256);
      resetConduitOverlay(createEmptyOverlay(name, sha256));
      setWorkspaceViewMode("2d");
      setSelectedId(null);
      setSelectedDimension(null);
      setSelectedManualId(null);
      setSceneVisibility(createSceneVisibilityHistory());
      setManualMeasurements([]);
      setMeasurementMode("off");
      nextMeasurementId.current = 1;
      setCanvases([
        {
          id: 1,
          levelId: first,
          viewBox: computeViewBox(parsed.nodes, first, true),
          rotation: DEFAULT_CANVAS_ROTATION,
        },
      ]);
      setNextId(2);
    } catch {
      setEvaluationReport(null);
      setS1Report(null);
      setS1HpeReport(null);
      setEvaluationRunState(initialEvaluationRunState);
      setS1RunState(initialEvaluationRunState);
      setS1Error(null);
      setBuildingEnvelopes([]);
      setShowBuildingEnvelope(false);
      setRoomRegionAnalysis(null);
      setShowRoomRegions(false);
      setConnectivityGraph(null);
      setShowConnectivity(false);
      setDoorOperations([]);
      setShowDoorOperationDebug(false);
      setRoomNavigationAnalysis(null);
      setShowNavigableSpace(false);
      setFurnitureUseZones(null);
      setFixtureUseZones(null);
      setShowFixtureUseZones(false);
      setOperationUseZones(null);
      setShowOperationUseZones(false);
      setShowFurnitureUseZones(false);
      setEvaluationError(null);
      setEvaluationHighlights([]);
      setActiveEvaluationHighlight(null);
      setEvaluationFocusMessage(null);
      setSceneVisibility(createSceneVisibilityHistory());
      setRequirementHandoff(null);
      setRequirementFile("暂不评价客户需求");
      setRequirementError(null);
      setData({
        nodes: {},
        raw: null,
        diagnostics: [
          {
            severity: "error",
            code: "invalid_json",
            message: "无法解析 JSON 文件",
          },
        ],
      });
    }
  };
  useEffect(() => { void load(defaultLayoutText, "default-layout.json"); }, []);
  const updateCanvas = (id: number, update: Partial<CanvasState>) =>
    setCanvases((current) =>
      current.map((canvas) =>
        canvas.id === id ? { ...canvas, ...update } : canvas,
      ),
    );
  const addCanvas = () => {
    const levelId = canvases[0]?.levelId || levels[0]?.id || "";
    setCanvases((current) => [
      ...current,
      {
        id: nextId,
        levelId,
        viewBox: computeViewBox(nodes, levelId, visibility.dimensions),
        rotation: DEFAULT_CANVAS_ROTATION,
      },
    ]);
    setNextId((id) => id + 1);
  };
  const removeCanvas = (id: number) =>
    setCanvases((current) =>
      current.length > 1
        ? current.filter((canvas) => canvas.id !== id)
        : current,
    );
  const dimensionDiagnostics = useMemo(() => Object.values(nodes).filter((node) => node.type === "level").flatMap((level) => buildExteriorDimensions(nodes, level.id).diagnostics), [nodes]);
  const imageDiagnostics = useMemo(() => floorplanImageCropDiagnostics(nodes), [nodes, imageCropRevision]);
  const coverage = useMemo(() => auditSceneCoverage(nodes, Array.isArray(data?.raw?.installedPlugins) ? data.raw.installedPlugins : [], visibility), [nodes, data, visibility]), diagnostics = useMemo(
    () => (data ? [...data.diagnostics, ...transformDiagnostics(nodes), ...coverage.diagnostics, ...dimensionDiagnostics, ...imageDiagnostics] : []),
    [data, nodes, coverage, dimensionDiagnostics, imageDiagnostics],
  );
  const toggleVisibility = (key: keyof Visibility) => {
    const next = !visibility[key];
      setVisibility((current) => key === "images" ? { ...current, images: next, shelves: next } : key === "centers" ? { ...current, boxes: next, centers: next, axes: next } : { ...current, [key]: next });
    if (key === "dimensions") setCanvases((current) => current.map((canvas) => ({ ...canvas, viewBox: computeViewBox(nodes, canvas.levelId, next) })));
  };
  const runFoundationEvaluation = async (continueAfterRequirementGate = false) => {
    if (!data || evaluationRunState.running) return;
    const startedAt = performance.now();
    const advance = async (progress: number, label: string) => {
      setEvaluationRunState((current) => ({ ...current, running: true, progress, label }));
      await allowUiPaint();
    };
    try {
      setEvaluationError(null);
      setS1Report(null);
      setS1HpeReport(null);
      setS1RunState(initialEvaluationRunState);
      setS1Error(null);
      await advance(8, "正在整理解析结果");
      const handoff = buildEvaluationHandoff(data), g2Context = g2ContextForEvaluationProfile(g2ProjectUse, g2Jurisdiction);
      await advance(25, "正在识别建筑边界和房间");
      const analysis = buildRoomRegionAnalysis(handoff), graph = buildRoomConnectivityGraph(handoff, analysis);
      if (requirementHandoff && !continueAfterRequirementGate) {
        await advance(42, "正在检查客户需求");
        const requirementReport = evaluateG4RequirementsOnly(handoff, requirementHandoff, new Date().toISOString(), analysis, graph);
        if (requirementGateBlocks(requirementReport.rules)) {
          setEvaluationReport(requirementReport);
          setBuildingEnvelopes(buildBuildingEnvelopes(handoff));
          setRoomRegionAnalysis(analysis);
          setConnectivityGraph(graph);
          setDoorOperations([]);
          setRoomNavigationAnalysis(null);
          setFurnitureUseZones(null);
          setFixtureUseZones(null);
          setOperationUseZones(null);
          setEvaluationGroup("G4");
          setEvaluationHighlights(evaluationIssueTargets(requirementReport.rules, nodes, analysis).map((target) => evaluationHighlightFor(target.ruleId, target, target.targetIndex)));
          setActiveEvaluationHighlight(null);
          setEvaluationFocusMessage(null);
          setEvaluationRunState({ running: false, progress: 100, label: "客户需求初筛已暂停", lastDurationMs: Math.round(performance.now() - startedAt) });
          return;
        }
      }
      await advance(48, requirementHandoff ? "客户需求已满足，正在执行 G1、G2、G3 规则" : "正在执行 G1、G2、G3 规则");
      const report = evaluateAll(handoff, g2Context, new Date().toISOString(), requirementHandoff);
      await advance(72, "正在计算通行路径和家具使用区");
      const operations = buildDoorOperations(handoff), navigation = navigationAnalysis(handoff), furnitureUses = furnitureUseAnalysis(handoff), fixtureUses = fixtureUseAnalysis(handoff), operationUses = operationUseAnalysis(handoff);
      await advance(90, "正在整理问题卡片和画布标注");
      setEvaluationReport(report);
      setBuildingEnvelopes(buildBuildingEnvelopes(handoff));
      setRoomRegionAnalysis(analysis);
      setConnectivityGraph(graph);
      setDoorOperations(operations);
      setRoomNavigationAnalysis(navigation);
      setFurnitureUseZones(furnitureUses);
      setFixtureUseZones(fixtureUses);
      setOperationUseZones(operationUses);
      const visibleRules = report.rules.filter((rule) => evaluationGroup === "all" || rule.ruleId.startsWith(`${evaluationGroup}-`));
      setEvaluationHighlights(evaluationIssueTargets(visibleRules, nodes, analysis).map((target) => evaluationHighlightFor(target.ruleId, target, target.targetIndex)));
      setActiveEvaluationHighlight(null);
      setEvaluationError(null);
      setEvaluationFocusMessage(null);
      setEvaluationRunState({ running: false, progress: 100, label: "评价完成", lastDurationMs: Math.round(performance.now() - startedAt) });
    } catch (error) {
      setEvaluationReport(null);
      setEvaluationError(error instanceof Error ? error.message : "评价器发生未知错误");
      setEvaluationRunState({ running: false, progress: 0, label: "", lastDurationMs: Math.round(performance.now() - startedAt) });
    }
  };
  const runS1Evaluation = async () => {
    if (!data || !evaluationReport || s1RunState.running) return;
    const gate = evaluateS1Gate(evaluationReport.rules);
    if (!gate.allowed) return;
    const startedAt = performance.now();
    const advance = async (progress: number, label: string) => {
      setS1RunState((current) => ({ ...current, running: true, progress, label }));
      await allowUiPaint();
    };
    try {
      setS1Error(null);
      setS1HpeReport(null);
      await advance(12, "正在准备空间与动线数据");
      const handoff = buildEvaluationHandoff(data);
      const graph = connectivityGraph ?? buildRoomConnectivityGraph(handoff);
      await advance(35, "正在构建可通行空间");
      const navigation = roomNavigationAnalysis ?? navigationAnalysis(handoff);
      await advance(35, "正在计算空间组织");
      const functionalRelationships = measureS1FunctionalRelationshipPairs(handoff, graph, requirementHandoff);
      const functionalRelationScoring = scoreS1FunctionalRelationships(functionalRelationships, handoff, graph);
      const entrySequence = measureS1EntrySequence(handoff, graph);
      const spaceOrganization = scoreS1SpaceOrganization(functionalRelationScoring, entrySequence);
      await advance(45, "正在计算动静分区");
      const activityZoning = scoreS1ActivityZoning(handoff, graph);
      await advance(50, "正在计算空间利用");
      const spaceUtilization = scoreS1SpaceUtilization(handoff, graph);
      await advance(55, "正在计算收纳配置");
      const storageConfiguration = scoreS1StorageConfiguration(handoff, graph);
      await advance(60, "正在计算高频活动路径");
      const highFrequencyPathEfficiency = measureS1HighFrequencyPaths(handoff, graph, navigation);
      await advance(88, "正在计算动线效率分数");
      const highFrequencyPathEfficiencyScoring = scoreS1HighFrequencyPaths(highFrequencyPathEfficiency, handoff, graph);
      const aggregate = aggregateS1V01(gate, { spaceOrganization, highFrequencyPathEfficiency: highFrequencyPathEfficiencyScoring, activityZoning, spaceUtilization, storageConfiguration });
      setS1HpeReport({ highFrequencyPathEfficiency, highFrequencyPathEfficiencyScoring, spaceOrganization, activityZoning, spaceUtilization, storageConfiguration, aggregate });
      setEvaluationHighlights([]);
      setActiveEvaluationHighlight(null);
      setEvaluationFocusMessage(null);
      setS1RunState({ running: false, progress: 100, label: "空间组织、动静分区、空间利用、收纳配置与动线效率评分完成", lastDurationMs: Math.round(performance.now() - startedAt) });
    } catch (error) {
      setS1HpeReport(null);
      setS1Error(error instanceof Error ? error.message : "动线效率评分发生未知错误");
      setS1RunState({ running: false, progress: 0, label: "", lastDurationMs: Math.round(performance.now() - startedAt) });
    }
  };
  const revealEvaluationRule = (ruleId: string) => {
    window.setTimeout(() => evaluationRuleElements.current[ruleId]?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
  };
  const changeEvaluationGroup = (group: EvaluationGroup) => {
    setEvaluationGroup(group);
    setActiveEvaluationHighlight(null);
    setEvaluationFocusMessage(null);
    if (!evaluationReport || !roomRegionAnalysis) return;
    const visibleRules = evaluationReport.rules.filter((rule) => group === "all" || rule.ruleId.startsWith(`${group}-`));
    setEvaluationHighlights(evaluationIssueTargets(visibleRules, nodes, roomRegionAnalysis).map((target) => evaluationHighlightFor(target.ruleId, target, target.targetIndex)));
  };
  const focusEvaluationTarget = (ruleId: string, target: EvaluationFocusTarget, targetIndex: number, revealRule = false, moveCanvas = true) => {
    setWorkspaceViewMode("2d");
    const focus = resolveEvaluationFocus(nodes, target.primaryId, roomRegionAnalysis);
    setEvaluationFocusMessage(focus.renderable ? null : focus.reason ?? "该对象暂时无法在画布中显示。");
    if (!focus.renderable || !focus.levelId) { setActiveEvaluationHighlight(null); return; }
    setActiveEvaluationHighlight(evaluationHighlightFor(ruleId, target, targetIndex));
    if (revealRule) revealEvaluationRule(ruleId);
    setSelectedId(target.primaryId);
    setSelectedDimension(null);
    setSelectedManualId(null);
    setMeasurementMode("off");
    const type = nodes[target.primaryId]?.type;
    setVisibility((current) => ({ ...current, walls: type === "wall" || target.relatedIds.some((id) => nodes[id]?.type === "wall") ? true : current.walls, openings: type === "door" || type === "window" || target.relatedIds.some((id) => nodes[id]?.type === "door" || nodes[id]?.type === "window") ? true : current.openings, stairs: type === "stair" || target.relatedIds.some((id) => nodes[id]?.type === "stair") ? true : current.stairs }));
    if (moveCanvas) {
      setCanvases((current) => {
        const matching = current.findIndex((canvas) => canvas.levelId === focus.levelId), targetCanvas = matching >= 0 ? matching : 0;
        return current.map((canvas, index) => index === targetCanvas ? { ...canvas, levelId: focus.levelId!, viewBox: computeViewBox(nodes, focus.levelId!, visibility.dimensions) } : canvas);
      });
    }
  };
  const activateEvaluationHighlight = (highlight: EvaluationHighlight) => {
    if (highlight.ruleId.startsWith("S1-FUR:USE:")) {
      const measurement = s1Report?.furnitureRelationshipAndUseSpace.itemMeasurements.find((item) => item.measurementId === highlight.ruleId);
      if (measurement) focusS1FurnitureUse(measurement);
      return;
    }
    if (highlight.ruleId.startsWith("S1-FUR:REL:")) {
      const measurement = s1Report?.furnitureRelationshipAndUseSpace.relationMeasurements.find((item) => item.relationId === highlight.ruleId);
      if (measurement) focusS1FurnitureRelation(measurement);
      return;
    }
    if (highlight.ruleId.startsWith("S1-SFS:")) {
      const measurement = s1Report?.spaceFragmentShape.measurements.find((item) => item.spaceInstanceId === highlight.ruleId);
      if (measurement) focusS1SpaceFragment(measurement);
      return;
    }
    if (highlight.ruleId.startsWith("S1-PCI-")) {
      const measurement = s1Report?.pathConflictInteraction.routePairs.find((item) => item.routePairId === highlight.ruleId);
      if (measurement) focusS1PathConflict(measurement, highlight.targetIndex);
      return;
    }
    if (highlight.ruleId.startsWith("S1-HPE-")) {
      const measurement = s1HpeReport?.highFrequencyPathEfficiency.measurements.find((item) => item.routeId === highlight.ruleId);
      if (measurement) focusS1HighFrequencyPath(measurement, highlight.targetIndex);
      return;
    }
    if (highlight.ruleId.startsWith("S1-PCP-")) {
      const measurement = s1Report?.publicCirculationPrivacy.measurements.find((item) => item.routeId === highlight.ruleId);
      if (measurement) focusS1PublicRoute(measurement, highlight.targetIndex);
      return;
    }
    if (highlight.ruleId.startsWith("S1-REL-")) {
      const measurement = s1Report?.measurements.find((item) => item.measurementId === highlight.ruleId);
      if (measurement) focusS1Measurement(measurement, highlight.targetIndex);
      return;
    }
    const rule = evaluationReport?.rules.find((item) => item.ruleId === highlight.ruleId);
    const target = rule && designerRulePresentation(rule, nodes, roomRegionAnalysis).targets[highlight.targetIndex];
    if (target) focusEvaluationTarget(highlight.ruleId, target, highlight.targetIndex, true, false);
  };
  const focusS1Measurement = (measurement: S1FunctionalRelationshipMeasurement, targetIndex: number) => {
    if (measurement.status !== "measured" || !measurement.source || !measurement.target) return;
    const primary = targetIndex === 1 ? measurement.target : measurement.source;
    const sameLevelPathRoomIds = measurement.pathRoomRegionIds.filter((roomRegionId) => roomRegionAnalysis?.rooms.find((room) => room.roomRegionId === roomRegionId)?.levelId === primary.levelId);
    const sameLevelZoneIds = [measurement.source, measurement.target].filter((space) => space.levelId === primary.levelId).flatMap((space) => space.zoneIds);
    const sameLevelConnectionIds = [...measurement.connectionDoorIds, ...measurement.connectionStairIds].filter((id) => resolveAncestorLevelId(id, nodes).levelId === primary.levelId);
    const target: EvaluationFocusTarget = {
      primaryId: primary.roomRegionId,
      relatedIds: [...new Set([...sameLevelPathRoomIds.filter((id) => id !== primary.roomRegionId), ...sameLevelZoneIds, ...sameLevelConnectionIds])],
      label: `${measurement.label} · ${primary.zoneNames.join(" / ")}`,
      levelId: primary.levelId,
      levelName: nodes[primary.levelId]?.name ?? "未命名楼层",
      status: "measured",
    };
    setEvaluationHighlights([evaluationHighlightFor(measurement.measurementId, target, targetIndex)]);
    focusEvaluationTarget(measurement.measurementId, target, targetIndex);
  };
  const focusS1PublicRoute = (measurement: S1PublicCirculationRouteMeasurement, targetIndex: number) => {
    if (measurement.status !== "measured" || !measurement.source || !measurement.target || measurement.resultType === "baseline_unreachable") return;
    const primary = targetIndex === 1 ? measurement.target : measurement.source;
    const pathRoomIds = measurement.resultType === "privacy_safe_route_available" ? measurement.privacySafePathRoomRegionIds : measurement.witnessPathRoomRegionIds;
    const sameLevelPathRoomIds = pathRoomIds.filter((roomRegionId) => roomRegionAnalysis?.rooms.find((room) => room.roomRegionId === roomRegionId)?.levelId === primary.levelId);
    const sameLevelZoneIds = [measurement.source, measurement.target].filter((space) => space.levelId === primary.levelId).flatMap((space) => space.zoneIds);
    const sameLevelConnectionIds = [...measurement.connectionDoorIds, ...measurement.connectionStairIds].filter((id) => resolveAncestorLevelId(id, nodes).levelId === primary.levelId);
    const privateIds = measurement.privateIntermediateRoomRegionIds.filter((roomId) => roomRegionAnalysis?.rooms.find((room) => room.roomRegionId === roomId)?.levelId === primary.levelId);
    const target: EvaluationFocusTarget = { primaryId: primary.roomRegionId, relatedIds: [...new Set([...sameLevelPathRoomIds.filter((id) => id !== primary.roomRegionId), ...sameLevelZoneIds, ...sameLevelConnectionIds])], label: `${measurement.routeGroupLabel} · ${primary.zoneNames.join(" / ") || primary.roomRegionId}`, levelId: primary.levelId, levelName: nodes[primary.levelId]?.name ?? "未命名楼层", status: "measured" };
    const highlight = { ...evaluationHighlightFor(measurement.routeId, target, targetIndex), emphasizedIds: privateIds };
    setEvaluationHighlights([highlight]);
    focusEvaluationTarget(measurement.routeId, target, targetIndex);
    setEvaluationHighlights([highlight]);
  };
  const focusS1HighFrequencyPath = (measurement: S1HighFrequencyPathMeasurement, targetIndex: number) => {
    if (measurement.status !== "measured" || !measurement.source || !measurement.target || !measurement.pathPoints.length) return;
    const primary = targetIndex === 1 ? measurement.target : measurement.source, levelPath = measurement.pathPoints.filter((item) => item.levelId === primary.levelId), levelRoomIds = measurement.roomPathIds.filter((roomId) => roomRegionAnalysis?.rooms.find((room) => room.roomRegionId === roomId)?.levelId === primary.levelId), levelZoneIds = [measurement.source, measurement.target].filter((space) => space.levelId === primary.levelId).flatMap((space) => space.zoneIds), levelConnections = [...measurement.doorIds, ...measurement.stairIds, ...measurement.sourceBehaviorObjectIds, ...measurement.targetBehaviorObjectIds].filter((id) => resolveAncestorLevelId(id, nodes).levelId === primary.levelId);
    const target: EvaluationFocusTarget = { primaryId: primary.roomRegionId, relatedIds: [...new Set([...levelRoomIds.filter((id) => id !== primary.roomRegionId), ...levelZoneIds, ...levelConnections])], label: measurement.routeLabel, levelId: primary.levelId, levelName: nodes[primary.levelId]?.name ?? "未命名楼层", status: "measured" };
    const highlight: EvaluationHighlight = { ...evaluationHighlightFor(measurement.routeId, target, targetIndex), pathPoints: measurement.pathPoints, hpeDebugTrace: measurement.debugTrace ? { rawGridSegments: measurement.debugTrace.rawGridSegments, smoothedSegments: measurement.debugTrace.smoothedSegments, portalPoints: measurement.debugTrace.portalPoints, sourceAnchor: measurement.sourceAnchorPoint ? { levelId: measurement.sourceLevelId!, point: measurement.sourceAnchorPoint } : null, targetAnchor: measurement.targetAnchorPoint ? { levelId: measurement.targetLevelId!, point: measurement.targetAnchorPoint } : null } : undefined };
    focusEvaluationTarget(measurement.routeId, target, targetIndex);
    setEvaluationHighlights([highlight]); setActiveEvaluationHighlight(highlight);
    if (import.meta.env.DEV && roomNavigationAnalysis) { const pocModuleUrl = "/src/evaluation/s1-pathfinding-poc.ts"; void import(/* @vite-ignore */ pocModuleUrl).then((module) => {
      const comparison = module.compareHpeRoutePathfindingPoc(measurement, roomNavigationAnalysis), withPoc: EvaluationHighlight = { ...highlight, hpePocPaths: { yuka: comparison.yuka.pathPoints, visibilityGraph: comparison.visibilityGraph.pathPoints } };
      setEvaluationHighlights([withPoc]); setActiveEvaluationHighlight(withPoc);
    }); }
    const pathViewBox = evaluationPathViewBox(levelPath.map((item) => item.point));
    if (pathViewBox) setCanvases((current) => current.map((canvas) => canvas.levelId === primary.levelId ? { ...canvas, viewBox: pathViewBox } : canvas));
  };
  const focusS1ObjectEvidence = (ruleId: string, primaryId: string, relatedIds: string[], label: string) => {
    const levelId = resolveAncestorLevelId(primaryId, nodes).levelId;
    if (!levelId) return;
    focusEvaluationTarget(ruleId, { primaryId, relatedIds: [...new Set(relatedIds.filter((id) => id !== primaryId))], label, levelId, levelName: nodes[levelId]?.name ?? "未命名楼层", status: "measured" }, 0);
  };
  const focusS1PathConflict = (measurement: S1PathConflictPairMeasurement, levelIndex: number) => {
    if (measurement.status !== "measured" || !s1Report) return;
    const routeA = s1Report.highFrequencyPathEfficiency.measurements.find((route) => route.routeId === measurement.routeAId), routeB = s1Report.highFrequencyPathEfficiency.measurements.find((route) => route.routeId === measurement.routeBId), fallbackLevels = [...new Set([...(routeA?.pathPoints ?? []), ...(routeB?.pathPoints ?? [])].map((item) => item.levelId))].sort(), levelId = measurement.comparedLevelIds[levelIndex] ?? fallbackLevels[levelIndex] ?? fallbackLevels[0];
    if (!routeA || !routeB || !levelId) return;
    const roomIds = [...new Set([...routeA.roomPathIds, ...routeB.roomPathIds])].filter((roomId) => roomRegionAnalysis?.rooms.find((room) => room.roomRegionId === roomId)?.levelId === levelId), primaryId = roomIds[0] ?? [...routeA.sourceZoneIds, ...routeB.sourceZoneIds].find((id) => resolveAncestorLevelId(id, nodes).levelId === levelId);
    if (!primaryId) return;
    const zoneIds = [...routeA.sourceZoneIds, ...routeA.targetZoneIds, ...routeB.sourceZoneIds, ...routeB.targetZoneIds].filter((id) => resolveAncestorLevelId(id, nodes).levelId === levelId), sharedConnections = [...measurement.sharedDoorIds, ...measurement.sharedStairIds].filter((id) => resolveAncestorLevelId(id, nodes).levelId === levelId), target: EvaluationFocusTarget = { primaryId, relatedIds: [...new Set([...roomIds.filter((id) => id !== primaryId), ...zoneIds, ...sharedConnections])], label: "常用路径交汇与冲突", levelId, levelName: nodes[levelId]?.name ?? "未命名楼层", status: "measured" };
    const highlight: EvaluationHighlight = { ...evaluationHighlightFor(measurement.routePairId, target, levelIndex), pathPoints: routeA.pathPoints, secondaryPathPoints: routeB.pathPoints, crossingPoints: measurement.crossingPointsByLevel, overlapSegments: measurement.overlapSegmentsByLevel.map((item) => ({ levelId: item.levelId, start: item.start, end: item.end })) };
    focusEvaluationTarget(measurement.routePairId, target, levelIndex); setEvaluationHighlights([highlight]); setActiveEvaluationHighlight(highlight);
    const points = [...routeA.pathPoints, ...routeB.pathPoints].filter((item) => item.levelId === levelId).map((item) => item.point), viewBox = evaluationPathViewBox(points);
    if (viewBox) setCanvases((current) => current.map((canvas) => canvas.levelId === levelId ? { ...canvas, viewBox } : canvas));
  };
  const focusS1SpaceFragment = (measurement: S1SpaceFragmentMeasurement) => {
    if (measurement.status !== "measured" || !measurement.roomRegionId || !measurement.levelId || !measurement.footprintPolygons.length || !measurement.gridMeters) return;
    const target: EvaluationFocusTarget = { primaryId: measurement.roomRegionId, relatedIds: measurement.zoneIds, label: `${measurement.spaceFunctionName} · ${measurement.spaceFunctionCode}`, levelId: measurement.levelId, levelName: nodes[measurement.levelId]?.name ?? "未命名楼层", status: "measured" };
    const primary = measurement.navigableComponents[0]?.cells ?? [], fragments = measurement.fragmentPolygonsOrCells.flatMap((component) => component.cells), highlight: EvaluationHighlight = { ...evaluationHighlightFor(measurement.spaceInstanceId, target, 0), spaceBoundaryPolygons: measurement.footprintPolygons.map((rings) => ({ levelId: measurement.levelId!, rings })), primaryNavigableCells: primary.map((point) => ({ levelId: measurement.levelId!, point, gridMeters: measurement.gridMeters! })), fragmentNavigableCells: fragments.map((point) => ({ levelId: measurement.levelId!, point, gridMeters: measurement.gridMeters! })) };
    focusEvaluationTarget(measurement.spaceInstanceId, target, 0); setEvaluationHighlights([highlight]); setActiveEvaluationHighlight(highlight);
    const points = measurement.footprintPolygons.flatMap((polygon) => polygon.flatMap((ring) => ring)), viewBox = evaluationPathViewBox(points);
    if (viewBox) setCanvases((current) => current.map((canvas) => canvas.levelId === measurement.levelId ? { ...canvas, viewBox } : canvas));
  };
  const focusS1FurnitureUse = (measurement: S1FurnitureUseMeasurement) => {
    if (!measurement.levelId || !nodes[measurement.itemId] || measurement.status === "unable_to_determine") return;
    const relatedIds = [...new Set([...measurement.zoneIds, ...measurement.minimumUseSpaceConflictItemIds, ...measurement.minimumUseSpaceConflictBuildingElementIds, ...measurement.maximumOpeningConflictItemIds, ...measurement.maximumOpeningConflictBuildingElementIds])], target: EvaluationFocusTarget = { primaryId: measurement.itemId, relatedIds, label: `${measurement.itemName} · 家具使用空间`, levelId: measurement.levelId, levelName: nodes[measurement.levelId]?.name ?? "未命名楼层", status: "measured" }, highlight: EvaluationHighlight = { ...evaluationHighlightFor(measurement.measurementId, target, 0), furnitureMinimumUsePolygons: measurement.minimumUsePolygons.map((polygon) => ({ levelId: measurement.levelId!, polygon })), furnitureOpeningPolygons: measurement.maximumOpeningPolygons.map((polygon) => ({ levelId: measurement.levelId!, polygon })) };
    focusEvaluationTarget(measurement.measurementId, target, 0); setEvaluationHighlights([highlight]); setActiveEvaluationHighlight(highlight);
    const points = [...measurement.minimumUsePolygons, ...measurement.maximumOpeningPolygons, ...(measurement.footprint ? [measurement.footprint] : [])].flat(), viewBox = evaluationPathViewBox(points);
    if (viewBox) setCanvases((current) => current.map((canvas) => canvas.levelId === measurement.levelId ? { ...canvas, viewBox } : canvas));
  };
  const focusS1FurnitureRelation = (measurement: S1FurnitureRelationMeasurement) => {
    if (measurement.status !== "measured" || !measurement.itemAId || !measurement.levelId || !measurement.itemACenter || !measurement.itemBCenter) return;
    const target: EvaluationFocusTarget = { primaryId: measurement.itemAId, relatedIds: [measurement.itemBId, ...measurement.sharedZoneIds], label: measurement.pairLabel, levelId: measurement.levelId, levelName: nodes[measurement.levelId]?.name ?? "未命名楼层", status: "measured" }, highlight: EvaluationHighlight = { ...evaluationHighlightFor(measurement.relationId, target, 0), furnitureRelationLine: { levelId: measurement.levelId, start: measurement.itemACenter, end: measurement.itemBCenter } };
    focusEvaluationTarget(measurement.relationId, target, 0); setEvaluationHighlights([highlight]); setActiveEvaluationHighlight(highlight);
    const points = [...(measurement.itemAFootprint ?? []), ...(measurement.itemBFootprint ?? []), measurement.itemACenter, measurement.itemBCenter], viewBox = evaluationPathViewBox(points);
    if (viewBox) setCanvases((current) => current.map((canvas) => canvas.levelId === measurement.levelId ? { ...canvas, viewBox } : canvas));
  };
  const selectCanvasObject = (id: string | null) => {
    setSelectedId(id);
    setSelectedDimension(null);
    setSelectedManualId(null);
  };
  const selectedSceneNode = selectedId ? nodes[selectedId] : null;
  const hideSelectedSceneNode = () => {
    if (!isHideableSceneNode(selectedSceneNode)) return;
    const nodeId = selectedSceneNode.id;
    setSceneVisibility((current) => hideSceneNode(current, nodeId));
    selectCanvasObject(null);
  };
  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
    const onSceneHistoryShortcut = (event: KeyboardEvent) => {
      if (event.isComposing || isEditableTarget(event.target) || !(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        setSceneVisibility((current) => event.shiftKey ? redoSceneVisibility(current) : undoSceneVisibility(current));
      } else if (key === "y") {
        event.preventDefault();
        setSceneVisibility(redoSceneVisibility);
      }
    };
    window.addEventListener("keydown", onSceneHistoryShortcut, true);
    return () => window.removeEventListener("keydown", onSceneHistoryShortcut, true);
  }, []);
  const layerControls = <details className="floating-layer-panel">
    <summary>显示图层</summary>
    <div className="visibility">
      {Object.entries({
        images: "家具模型",
        centers: "家具中心",
        names: "家具名称",
        zones: "Zone",
        dimensions: "外围尺寸",
      }).map(([key, label]) => (
        <label key={key}>
          <input
            type="checkbox"
            checked={key === "centers" ? visibility.centers && visibility.boxes : visibility[key as keyof Visibility]}
            onChange={() => toggleVisibility(key as keyof Visibility)}
          />
          {label}
        </label>
      ))}
    </div>
  </details>;
  const reportPanels = <>
    <EvaluationPanel report={evaluationReport} nodes={nodes} roomAnalysis={roomRegionAnalysis} error={evaluationError} requirementError={requirementError} requirementFile={requirementFile} hasRequirements={Boolean(requirementHandoff)} focusMessage={evaluationFocusMessage} activeHighlight={activeEvaluationHighlight} selectedGroup={evaluationGroup} g2ProjectUse={g2ProjectUse} g2Jurisdiction={g2Jurisdiction} runState={evaluationRunState} disabled={!data || !Object.keys(nodes).length} onRun={() => runFoundationEvaluation(false)} onContinueFull={() => runFoundationEvaluation(true)} onGroupChange={changeEvaluationGroup} onG2ProjectUseChange={setG2ProjectUse} onG2JurisdictionChange={setG2Jurisdiction} onUseBellevueRequirements={useBellevueRequirements} onDisableRequirements={disableCustomerRequirements} onLoadRequirementFile={loadRequirementFile} onFocus={focusEvaluationTarget} onRegisterRule={(ruleId, element) => { evaluationRuleElements.current[ruleId] = element; }} />
    <S1Panel gate={evaluationReport ? evaluateS1Gate(evaluationReport.rules) : null} report={s1HpeReport} runState={s1RunState} error={s1Error} onRun={runS1Evaluation} onFocusHighFrequencyPath={focusS1HighFrequencyPath} onFocusActivityZoning={(measurement) => {
      const space = measurement.space;
      if (!space) return;
      const relatedIds = "quietIntermediateRoomRegionIds" in measurement ? [...measurement.quietIntermediateRoomRegionIds, ...measurement.doorIds, ...space.zoneIds] : [...measurement.neighborRoomRegionIds, ...measurement.doorIds, ...space.zoneIds];
      focusEvaluationTarget(measurement.measurementId, { primaryId: space.roomRegionId, relatedIds: [...new Set(relatedIds.filter((id) => id !== space.roomRegionId))], label: "动静分区", levelId: space.levelId, levelName: nodes[space.levelId]?.name ?? "未命名楼层", status: "measured" }, 0);
    }} onFocusUtilization={(measurement) => focusEvaluationTarget(`S1-LY-${measurement.zoneId}`, { primaryId: measurement.zoneId, relatedIds: [], label: "空间利用", levelId: measurement.levelId, levelName: nodes[measurement.levelId]?.name ?? "未命名楼层", status: "measured" }, 0)} onFocusObjectEvidence={focusS1ObjectEvidence} />
  </>;
  const twoDPanel = <aside className={`two-d-floating-panel ${twoDPanelCollapsed ? "collapsed" : ""}`}>
    <div className="two-d-panel-head"><b>2D 工具</b><button aria-label={twoDPanelCollapsed ? "展开 2D 工具" : "折叠 2D 工具"} onClick={() => setTwoDPanelCollapsed((value) => !value)}>{twoDPanelCollapsed ? "展开" : "收起"}</button></div>
    {!twoDPanelCollapsed && <>
      <Inspector node={selectedId ? nodes[selectedId] : null} nodes={nodes} coverage={coverage} dimension={selectedDimension} manualMeasurement={manualMeasurements.find((item) => item.id === selectedManualId) ?? null} measurementUnit={measurementUnit} />
      <section className="two-d-tool-section">
        {layerControls}
        <label>全局单位 <select value={measurementUnit} onChange={(event) => setMeasurementUnit(event.target.value as MeasurementUnit)}><option value="millimeters">公制（mm / m²）</option><option value="feet-inches">英制（ft-in / ft²）</option></select></label>
        <button className={`measure-toggle ${measurementMode !== "off" ? "active" : ""}`} title="开启后点击两点测量；按一次 Shift 切换正交；Esc 退出" onClick={() => setMeasurementMode((current) => current === "off" ? "aligned" : "off")}>{measurementMode === "off" ? "测量" : "退出测量"}</button>
      </section>
      <section className="two-d-tool-section" aria-label="对象隐藏">
        <button disabled={!isHideableSceneNode(selectedSceneNode)} onClick={hideSelectedSceneNode}>隐藏所选</button>
        <button disabled={!sceneVisibility.hiddenNodeIds.length} onClick={() => setSceneVisibility(restoreAllSceneNodes)}>恢复全部{sceneVisibility.hiddenNodeIds.length ? ` (${sceneVisibility.hiddenNodeIds.length})` : ""}</button>
        <div className="two-d-history-buttons"><button disabled={!sceneVisibility.undoStack.length} aria-label="撤销隐藏" onClick={() => setSceneVisibility(undoSceneVisibility)}>↶</button><button disabled={!sceneVisibility.redoStack.length} aria-label="重做隐藏" onClick={() => setSceneVisibility(redoSceneVisibility)}>↷</button></div>
      </section>
      {workspaceViewMode === "2d" && <button className="primary" onClick={addCanvas}>+ 添加画布</button>}
      {import.meta.env.DEV && <details className="developer-tools"><summary>开发信息</summary><Stats nodes={nodes} /><Diagnostics diagnostics={diagnostics} /></details>}
    </>}
  </aside>;
  const visibleTwoDIds = new Set(visibleTwoDCanvasIds(canvases.map((canvas) => canvas.id), workspaceViewMode));
  const displayedCanvases = canvases.filter((canvas) => visibleTwoDIds.has(canvas.id));
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <b>Pascal 施工管线路由</b>
        </div>
        <div className="actions">
          <div className="workspace-view-toggle" role="group" aria-label="工作区视图">
            <button className={workspaceViewMode === "2d" ? "active" : ""} onClick={() => { setWorkspaceViewMode("2d"); setMeasurementMode("off"); }}>2D 平面</button>
            <button className={workspaceViewMode === "split" ? "active" : ""} disabled={!data || !Object.keys(nodes).length} onClick={() => { setThreeDActivated(true); setWorkspaceViewMode("split"); setMeasurementMode("off"); }}>2D + 3D</button>
            <button className={workspaceViewMode === "3d" ? "active" : ""} disabled={!data || !Object.keys(nodes).length} onClick={() => { setThreeDActivated(true); setWorkspaceViewMode("3d"); setMeasurementMode("off"); }}>3D 查看</button>
          </div>
          <button className="primary" onClick={() => input.current?.click()}>
            导入 JSON
          </button>
          <input
            ref={input}
            hidden
            type="file"
            accept=".json,application/json"
            onChange={(e) =>
              e.target.files?.[0]
                ?.text()
                .then((text) => load(text, e.target.files![0].name))
            }
          />
          <span className="file">{file}</span>
        </div>
      </header>
      <main className="workspace conduit-workspace">
        <section className="canvas-workspace">
          <div className={`workspace-views mode-${workspaceViewMode}`} style={{ "--split-ratio": `${splitRatio}%` } as React.CSSProperties}>
          <div className={`workspace-view-pane workspace-view-pane-2d ${workspaceViewMode === "3d" ? "workspace-view-pane-hidden" : ""}`}>
            {twoDPanel}
          <div className={`canvas-grid count-${Math.min(displayedCanvases.length, 4)}`}>
            {displayedCanvases.map((canvas) => (
              <CanvasPanel
                key={canvas.id}
                canvas={canvas}
                nodes={nodes}
                levels={levels}
                visibility={visibility}
                hiddenNodeIds={hiddenNodeIds}
                conduitOverlay={conduitOverlay}
                selectedId={selectedId}
                evaluationHighlights={evaluationHighlights}
                activeEvaluationHighlight={activeEvaluationHighlight}
                buildingEnvelopes={buildingEnvelopes}
                showBuildingEnvelope={showBuildingEnvelope}
                roomAnalysis={roomRegionAnalysis}
                showRoomRegions={showRoomRegions}
                connectivityGraph={connectivityGraph}
                showConnectivity={showConnectivity}
                doorOperations={doorOperations}
                showDoorOperationDebug={showDoorOperationDebug}
                navigationAnalysis={roomNavigationAnalysis}
                showNavigableSpace={showNavigableSpace}
                furnitureUseAnalysis={furnitureUseZones}
                showFurnitureUseZones={showFurnitureUseZones}
                fixtureUseAnalysis={fixtureUseZones}
                showFixtureUseZones={showFixtureUseZones}
                operationUseAnalysis={operationUseZones}
                showOperationUseZones={showOperationUseZones}
                s1PathDebugLayers={s1PathDebugLayers}
                s1PathPocProvider={s1PathPocProvider}
                measurementMode={measurementMode}
                measurementUnit={measurementUnit}
                manualMeasurements={manualMeasurements.filter((item) => item.levelId === (canvas.levelId || levels[0]?.id || ""))}
                selectedManualId={selectedManualId}
                onSelect={selectCanvasObject}
                onClearEvaluationHighlight={() => { setEvaluationHighlights([]); setActiveEvaluationHighlight(null); setEvaluationFocusMessage(null); }}
                onRestoreEvaluationOverview={() => { if (activeEvaluationHighlight) { setActiveEvaluationHighlight(null); setEvaluationFocusMessage(null); } }}
                onActivateEvaluationHighlight={activateEvaluationHighlight}
                onSelectDimension={(dimension) => { setSelectedId(null); setSelectedDimension(dimension); setSelectedManualId(null); }}
                onCreateMeasurement={(measurement) => { const created = { ...measurement, id: `measure-${nextMeasurementId.current++}`, createdAt: Date.now() }; setManualMeasurements((current) => [...current, created]); setSelectedId(null); setSelectedDimension(null); setSelectedManualId(created.id); }}
                onSelectManual={(id) => { setSelectedId(null); setSelectedDimension(null); setSelectedManualId(id); }}
                onDeleteManual={(id) => { setManualMeasurements((current) => current.filter((item) => item.id !== id)); setSelectedManualId((current) => current === id ? null : current); }}
                onUpdate={updateCanvas}
                onRemove={removeCanvas}
                canRemove={canvases.length > 1}
              />
            ))}
          </div>
          </div>
          {workspaceViewMode === "split" && <div
            className="workspace-split-divider"
            role="separator"
            aria-label="调整 2D 与 3D 视图宽度"
            aria-orientation="vertical"
            aria-valuemin={25}
            aria-valuemax={75}
            aria-valuenow={Math.round(splitRatio)}
            tabIndex={0}
            onPointerDown={(event) => {
              const width = event.currentTarget.parentElement?.getBoundingClientRect().width ?? 0;
              if (!width) return;
              splitResize.current = { startX: event.clientX, startRatio: splitRatio, width };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const resize = splitResize.current;
              if (resize) setSplitRatio(clampSplitRatio(resize.startRatio + (event.clientX - resize.startX) / resize.width * 100));
            }}
            onPointerUp={(event) => {
              splitResize.current = null;
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => { splitResize.current = null; }}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                setSplitRatio((ratio) => clampSplitRatio(ratio + (event.key === "ArrowLeft" ? -2 : 2)));
              }
            }}
          />}
          {data && threeDActivated && <div className={`workspace-view-pane workspace-view-pane-3d ${workspaceViewMode === "2d" ? "workspace-view-pane-hidden" : ""}`}>
            <ThreeDWorkspace scene={threeDScene} hiddenNodeIds={hiddenNodeIds} selectedId={selectedId} onSelect={selectCanvasObject} sourceFile={file} sourceSha={sourceSha} />
          </div>}
          </div>
        </section>
      </main>
    </div>
  );
}
function CanvasPanel({
  canvas,
  nodes,
  levels,
  visibility,
  hiddenNodeIds,
  conduitOverlay,
  selectedId,
  evaluationHighlights,
  activeEvaluationHighlight,
  buildingEnvelopes,
  showBuildingEnvelope,
  roomAnalysis,
  showRoomRegions,
  connectivityGraph,
  showConnectivity,
  doorOperations,
  showDoorOperationDebug,
  navigationAnalysis,
  showNavigableSpace,
  furnitureUseAnalysis,
  showFurnitureUseZones,
  fixtureUseAnalysis,
  showFixtureUseZones,
  operationUseAnalysis,
  showOperationUseZones,
  s1PathDebugLayers,
  s1PathPocProvider,
  onSelect,
  onClearEvaluationHighlight,
  onRestoreEvaluationOverview,
  onActivateEvaluationHighlight,
  onSelectDimension,
  measurementMode,
  measurementUnit,
  manualMeasurements,
  selectedManualId,
  onCreateMeasurement,
  onSelectManual,
  onDeleteManual,
  onUpdate,
  onRemove,
  canRemove,
}: {
  canvas: CanvasState;
  nodes: Record<string, NodeData>;
  levels: NodeData[];
  visibility: Visibility;
  hiddenNodeIds: ReadonlySet<string>;
  conduitOverlay: ConduitOverlayDocument | null;
  selectedId: string | null;
  evaluationHighlights: EvaluationHighlight[];
  activeEvaluationHighlight: EvaluationHighlight | null;
  buildingEnvelopes: BuildingEnvelope[];
  showBuildingEnvelope: boolean;
  roomAnalysis: RoomRegionAnalysis | null;
  showRoomRegions: boolean;
  connectivityGraph: RoomConnectivityGraph | null;
  showConnectivity: boolean;
  doorOperations: DoorOperation[];
  showDoorOperationDebug: boolean;
  navigationAnalysis: RoomNavigationAnalysis | null;
  showNavigableSpace: boolean;
  furnitureUseAnalysis: FurnitureUseAnalysis | null;
  showFurnitureUseZones: boolean;
  fixtureUseAnalysis: FixtureUseAnalysis | null;
  showFixtureUseZones: boolean;
  operationUseAnalysis: OperationUseAnalysis | null;
  showOperationUseZones: boolean;
  s1PathDebugLayers: S1PathDebugLayers;
  s1PathPocProvider: S1PathPocProvider;
  onSelect: (id: string | null) => void;
  onClearEvaluationHighlight: () => void;
  onRestoreEvaluationOverview: () => void;
  onActivateEvaluationHighlight: (highlight: EvaluationHighlight) => void;
  onSelectDimension: (dimension: DimensionSegment) => void;
  measurementMode: MeasurementMode;
  measurementUnit: MeasurementUnit;
  manualMeasurements: ManualMeasurement[];
  selectedManualId: string | null;
  onCreateMeasurement: (measurement: Omit<ManualMeasurement, "id" | "createdAt">) => void;
  onSelectManual: (id: string | null) => void;
  onDeleteManual: (id: string) => void;
  onUpdate: (id: number, u: Partial<CanvasState>) => void;
  onRemove: (id: number) => void;
  canRemove: boolean;
}) {
  const levelId = canvas.levelId || levels[0]?.id || "";
  return (
    <article className="canvas-card">
      <div className="canvas-card-head">
        <label>
          楼层{" "}
          <select
            value={levelId}
            onChange={(e) =>
              onUpdate(canvas.id, {
                levelId: e.target.value,
                viewBox: computeViewBox(nodes, e.target.value, visibility.dimensions),
              })
            }
          >
            {levels.map((level) => (
              <option value={level.id} key={level.id}>
                {level.name || level.id}
              </option>
            ))}
          </select>
        </label>
        <div className="canvas-tools">
          <button
            title="逆时针旋转 90°"
            onClick={() =>
              onUpdate(canvas.id, { rotation: (canvas.rotation + 270) % 360 })
            }
          >
            ↶ 90°
          </button>
          <button
            title="顺时针旋转 90°"
            onClick={() =>
              onUpdate(canvas.id, { rotation: (canvas.rotation + 90) % 360 })
            }
          >
            ↷ 90°
          </button>
          <button
            onClick={() =>
              onUpdate(canvas.id, { viewBox: computeViewBox(nodes, levelId, visibility.dimensions) })
            }
          >
            适配
          </button>
          {canRemove && (
            <button
              className="danger"
              title="移除此画布"
              onClick={() => onRemove(canvas.id)}
            >
              ×
            </button>
          )}
        </div>
      </div>
      <Plan
        nodes={nodes}
        levelId={levelId}
        viewBox={canvas.viewBox}
        rotation={canvas.rotation}
        setViewBox={(viewBox) => onUpdate(canvas.id, { viewBox })}
        visibility={visibility}
        hiddenNodeIds={hiddenNodeIds}
        conduitOverlay={conduitOverlay}
        selectedId={selectedId}
        evaluationHighlights={evaluationHighlights}
        activeEvaluationHighlight={activeEvaluationHighlight}
        buildingEnvelope={buildingEnvelopes.find((envelope) => envelope.levelId === levelId) ?? null}
        showBuildingEnvelope={showBuildingEnvelope}
        roomAnalysis={roomAnalysis}
        showRoomRegions={showRoomRegions}
        connectivityGraph={connectivityGraph}
        showConnectivity={showConnectivity}
        doorOperations={doorOperations}
        showDoorOperationDebug={showDoorOperationDebug}
        navigationAnalysis={navigationAnalysis}
        showNavigableSpace={showNavigableSpace}
        furnitureUseAnalysis={furnitureUseAnalysis}
        showFurnitureUseZones={showFurnitureUseZones}
        fixtureUseAnalysis={fixtureUseAnalysis}
        showFixtureUseZones={showFixtureUseZones}
        operationUseAnalysis={operationUseAnalysis}
        showOperationUseZones={showOperationUseZones}
        s1PathDebugLayers={s1PathDebugLayers}
        s1PathPocProvider={s1PathPocProvider}
        onSelect={onSelect}
        onClearEvaluationHighlight={onClearEvaluationHighlight}
        onRestoreEvaluationOverview={onRestoreEvaluationOverview}
        onActivateEvaluationHighlight={onActivateEvaluationHighlight}
        onSelectDimension={onSelectDimension}
        measurementMode={measurementMode}
        measurementUnit={measurementUnit}
        manualMeasurements={manualMeasurements}
        selectedManualId={selectedManualId}
        onCreateMeasurement={onCreateMeasurement}
        onSelectManual={onSelectManual}
        onDeleteManual={onDeleteManual}
      />
    </article>
  );
}
function planArcPoints(arc: BendArc): Vec3[] {
  const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], center = arc.center, start = subtract(arc.start, center), radius = Math.hypot(...start), normalLength = Math.max(1e-9, Math.hypot(...arc.normal)), normal = arc.normal.map((value) => value / normalLength) as Vec3;
  const tangent: Vec3 = [(normal[1] * start[2] - normal[2] * start[1]) / Math.max(1e-9, radius), (normal[2] * start[0] - normal[0] * start[2]) / Math.max(1e-9, radius), (normal[0] * start[1] - normal[1] * start[0]) / Math.max(1e-9, radius)];
  return Array.from({ length: 17 }, (_, index) => { const angle = arc.sweepRadians * index / 16; return [center[0] + start[0] * Math.cos(angle) + tangent[0] * radius * Math.sin(angle), center[1] + start[1] * Math.cos(angle) + tangent[1] * radius * Math.sin(angle), center[2] + start[2] * Math.cos(angle) + tangent[2] * radius * Math.sin(angle)]; });
}
function ConduitPlanOverlay({ overlay, levelId, selectedId, onSelect }: { overlay: ConduitOverlayDocument | null; levelId: string; selectedId: string | null; onSelect: (id: string | null) => void }) {
  const sharedPreview = useOverlayStore((state) => state.preview);
  if (!overlay) return null;
  const preview = sharedPreview?.sourceSha === overlay.source.sha256 && (!sharedPreview.levelId || sharedPreview.levelId === levelId) ? sharedPreview : null;
  const belongsToLevel = (attachment: { levelId: string | null } | undefined) => !attachment?.levelId || attachment.levelId === levelId;
  return <g className="conduit-plan-overlay" aria-label="只读管线平面图">
    {overlay.segments.filter((segment) => overlay.settings.visibleSystems[segment.system] && (belongsToLevel(segment.start.attachment) || belongsToLevel(segment.end.attachment))).map((segment) => <g key={segment.id} onClick={(event) => { event.stopPropagation(); onSelect(segment.id); }}><line x1={segment.start.position[0]} y1={segment.start.position[2]} x2={segment.end.position[0]} y2={segment.end.position[2]} stroke={selectedId === segment.id ? "#f59e0b" : overlay.settings.colors[segment.system]} strokeWidth={Math.max(.025, segment.diameterMm / 1000)} strokeLinecap="round" />{Math.abs(segment.start.position[0] - segment.end.position[0]) < .001 && Math.abs(segment.start.position[2] - segment.end.position[2]) < .001 && <text x={segment.start.position[0] + .08} y={segment.start.position[2] - .08} fontSize=".22" fill="#334155">{segment.end.position[1] >= segment.start.position[1] ? "↑" : "↓"}</text>}</g>)}
    {overlay.fittings.filter((fitting) => overlay.settings.visibleSystems[fitting.system] && belongsToLevel(fitting.position.attachment)).map((fitting) => { const display = planFittingDisplay(fitting), color = selectedId === fitting.id ? "#f59e0b" : overlay.settings.colors[fitting.system], width = Math.max(.025, fitting.diameterMm / 1000); if (display.kind === "arc") return <polyline key={fitting.id} points={planArcPoints(fitting.arc!).map((point) => `${point[0]},${point[2]}`).join(" ")} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" onClick={(event) => { event.stopPropagation(); onSelect(fitting.id); }} />; if (display.kind === "connectors") return <g key={fitting.id} onClick={(event) => { event.stopPropagation(); onSelect(fitting.id); }}>{display.lines.map((line, index) => <line key={index} x1={line.start[0]} y1={line.start[2]} x2={line.end[0]} y2={line.end[2]} stroke={color} strokeWidth={width} strokeLinecap="round" />)}</g>; return null; })}
    {overlay.junctionBoxes.filter((box) => overlay.settings.visibleSystems[box.system] && belongsToLevel(box.position.attachment)).map((box) => { const size = box.sizeMm[0] / 1000, signal = box.system === "signal"; return <rect key={box.id} x={box.position.position[0] - size / 2} y={box.position.position[2] - size / 2} width={size} height={size} fill={selectedId === box.id ? "#f59e0b" : overlay.settings.colors[box.system]} stroke={signal ? "#94a3b8" : "none"} strokeWidth={signal ? ".012" : undefined} onClick={(event) => { event.stopPropagation(); onSelect(box.id); }} />; })}
    {overlay.penetrations.filter((feature) => belongsToLevel(feature.point.attachment)).map((feature) => <path key={feature.id} d={`M ${feature.point.position[0] - .08} ${feature.point.position[2] - .08} L ${feature.point.position[0] + .08} ${feature.point.position[2] + .08} M ${feature.point.position[0] + .08} ${feature.point.position[2] - .08} L ${feature.point.position[0] - .08} ${feature.point.position[2] + .08}`} stroke="#d97706" strokeWidth=".025" />)}
    {preview && <g className="conduit-plan-preview" pointerEvents="none" opacity=".78">
      {(() => { const color = preview.plan?.canCommit === false ? "#ef4444" : overlay.settings.colors[preview.system], width = Math.max(.03, preview.diameterMm / 850); if (preview.plan) return <>{preview.plan.segments.map((segment) => <line key={segment.id} x1={segment.start.position[0]} y1={segment.start.position[2]} x2={segment.end.position[0]} y2={segment.end.position[2]} stroke={color} strokeWidth={width} strokeLinecap="round" strokeDasharray=".12 .07" />)}{preview.plan.fittings.filter((fitting) => Boolean(fitting.arc)).map((fitting) => <polyline key={fitting.id} points={planArcPoints(fitting.arc!).map((point) => `${point[0]},${point[2]}`).join(" ")} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" strokeDasharray=".12 .07" />)}</>; if (preview.points.length >= 2) return <polyline points={preview.points.map((point) => `${point.position[0]},${point.position[2]}`).join(" ")} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" strokeDasharray=".12 .07" />; return null; })()}
      {preview.points.length > 0 && <circle cx={preview.points[preview.points.length - 1].position[0]} cy={preview.points[preview.points.length - 1].position[2]} r=".055" fill={preview.plan?.canCommit === false ? "#ef4444" : overlay.settings.colors[preview.system]} />}
      {preview.branchNode?.kind === "junction-box" && (() => { const size = preview.branchNode.sizeMm[0] / 1000, signal = preview.system === "signal"; return <rect x={preview.branchNode.position[0] - size / 2} y={preview.branchNode.position[2] - size / 2} width={size} height={size} fill={overlay.settings.colors[preview.system]} stroke={signal ? "#94a3b8" : "none"} strokeWidth={signal ? ".012" : undefined} />; })()}
    </g>}
  </g>;
}

function objectsOnLevel(nodes: Record<string, NodeData>, levelId: string) {
  return Object.values(nodes).filter(
    (node) => resolveAncestorLevelId(node.id, nodes).levelId === levelId,
  );
}
function stairEntriesOnLevel(nodes: Record<string, NodeData>, levelId: string) {
  return Object.values(nodes).filter((node) => node.type === 'stair' && node.stairType === 'spiral' && node.toLevelId === levelId && resolveAncestorLevelId(node.id, nodes).levelId !== levelId);
}
function computeViewBox(
  nodes: Record<string, NodeData>,
  levelId: string,
  includeDimensions = true,
): ViewBox {
  const points: { x: number; z: number }[] = [];
  const rendered = objectsOnLevel(nodes, levelId), exactWallById = new Map(buildExperimentalWalls(rendered.filter((node) => node.type === 'wall') as PascalWall[]).map((wall) => [wall.wallId, wall]));
  for (const node of rendered) {
    if (node.type === "wall") {
      const exact = exactWallById.get(node.id);
      if (exact?.validation.valid) points.push(...exact.footprint.map((point) => ({ x: point.x, z: point.y })));
    } else if (
      (node.type === "zone" || node.type === "slab") &&
      Array.isArray(node.polygon)
    ) {
      for (const point of node.polygon)
        if (Array.isArray(point))
          points.push({ x: point[0], z: point[2] ?? point[1] });
    } else if (node.type === "item") {
      const transform = resolveItemPlanTransform(node.id, nodes),
        dimensions = finalDimensions(node);
      if (transform.status === "ok" && dimensions)
        points.push(
          {
            x: transform.x - dimensions.width / 2,
            z: transform.z - dimensions.depth / 2,
          },
          {
            x: transform.x + dimensions.width / 2,
            z: transform.z + dimensions.depth / 2,
          },
        );
    } else if (node.type === "shelf") {
      points.push(...shelfCorners(node, nodes));
    } else if (node.type === "stair") {
      points.push(...stairCorners(node, nodes));
    }
  }
  for (const stair of stairEntriesOnLevel(nodes, levelId)) points.push(...spiralStairCorners(stair));
  if (includeDimensions && levelId) points.push(...dimensionOverlayBounds(buildExteriorDimensions(nodes, levelId)));
  return zoomExtents(points, 1);
}
function Plan({
  nodes,
  levelId,
  viewBox,
  rotation,
  setViewBox,
  visibility,
  hiddenNodeIds,
  conduitOverlay,
  selectedId,
  evaluationHighlights,
  activeEvaluationHighlight,
  buildingEnvelope,
  showBuildingEnvelope,
  roomAnalysis,
  showRoomRegions,
  connectivityGraph,
  showConnectivity,
  doorOperations,
  showDoorOperationDebug,
  navigationAnalysis,
  showNavigableSpace,
  furnitureUseAnalysis,
  showFurnitureUseZones,
  fixtureUseAnalysis,
  showFixtureUseZones,
  operationUseAnalysis,
  showOperationUseZones,
  s1PathDebugLayers,
  s1PathPocProvider,
  onSelect,
  onClearEvaluationHighlight,
  onRestoreEvaluationOverview,
  onActivateEvaluationHighlight,
  onSelectDimension,
  measurementMode,
  measurementUnit,
  manualMeasurements,
  selectedManualId,
  onCreateMeasurement,
  onSelectManual,
  onDeleteManual,
}: {
  nodes: Record<string, NodeData>;
  levelId: string;
  viewBox: ViewBox;
  rotation: number;
  setViewBox: (v: ViewBox) => void;
  visibility: Visibility;
  hiddenNodeIds: ReadonlySet<string>;
  conduitOverlay: ConduitOverlayDocument | null;
  selectedId: string | null;
  evaluationHighlights: EvaluationHighlight[];
  activeEvaluationHighlight: EvaluationHighlight | null;
  buildingEnvelope: BuildingEnvelope | null;
  showBuildingEnvelope: boolean;
  roomAnalysis: RoomRegionAnalysis | null;
  showRoomRegions: boolean;
  connectivityGraph: RoomConnectivityGraph | null;
  showConnectivity: boolean;
  doorOperations: DoorOperation[];
  showDoorOperationDebug: boolean;
  navigationAnalysis: RoomNavigationAnalysis | null;
  showNavigableSpace: boolean;
  furnitureUseAnalysis: FurnitureUseAnalysis | null;
  showFurnitureUseZones: boolean;
  fixtureUseAnalysis: FixtureUseAnalysis | null;
  showFixtureUseZones: boolean;
  operationUseAnalysis: OperationUseAnalysis | null;
  showOperationUseZones: boolean;
  s1PathDebugLayers: S1PathDebugLayers;
  s1PathPocProvider: S1PathPocProvider;
  onSelect: (id: string | null) => void;
  onClearEvaluationHighlight: () => void;
  onRestoreEvaluationOverview: () => void;
  onActivateEvaluationHighlight: (highlight: EvaluationHighlight) => void;
  onSelectDimension: (dimension: DimensionSegment) => void;
  measurementMode: MeasurementMode;
  measurementUnit: MeasurementUnit;
  manualMeasurements: ManualMeasurement[];
  selectedManualId: string | null;
  onCreateMeasurement: (measurement: Omit<ManualMeasurement, "id" | "createdAt">) => void;
  onSelectManual: (id: string | null) => void;
  onDeleteManual: (id: string) => void;
}) {
  const drag = useRef<{ x: number; y: number; box: ViewBox; moved: boolean } | null>(null), suppressClick = useRef(false), planRef = useRef<HTMLDivElement>(null), svgRef = useRef<SVGSVGElement>(null), sceneRef = useRef<SVGGElement>(null), viewBoxRef = useRef(viewBox), setViewBoxRef = useRef(setViewBox), safariGesture = useRef<{ scale: number } | null>(null),
    [measurementStart, setMeasurementStart] = useState<MeasurementSnap | null>(null),
    [measurementHover, setMeasurementHover] = useState<MeasurementSnap | null>(null),
    [orthogonalLock, setOrthogonalLock] = useState(false),
    rendered = objectsOnLevel(nodes, levelId).filter((node) => !hiddenNodeIds.has(node.id)),
    items = rendered.filter((n) => n.type === "item"),
    zones = rendered.filter((n) => n.type === "zone"),
    wallNodes = rendered.filter((n) => n.type === "wall") as PascalWall[],
    exactWalls = useMemo(
      () => buildExperimentalWalls(wallNodes),
      [wallNodes],
    ),
    stairEntries = stairEntriesOnLevel(nodes, levelId).filter((node) => !hiddenNodeIds.has(node.id)),
    exteriorDimensions = useMemo(() => buildExteriorDimensions(nodes, levelId), [nodes, levelId]),
    cx = viewBox.minX + viewBox.width / 2,
    cz = viewBox.minZ + viewBox.height / 2,
    vb = `${viewBox.minX} ${viewBox.minZ} ${viewBox.width} ${viewBox.height}`;
  viewBoxRef.current = viewBox;
  setViewBoxRef.current = setViewBox;
  const visibleEvaluationHighlights = activeEvaluationHighlight ? evaluationHighlights.filter((highlight) => highlight.ruleId === activeEvaluationHighlight.ruleId && highlight.targetIndex === activeEvaluationHighlight.targetIndex) : evaluationHighlights;
  const highlightsOnLevel = visibleEvaluationHighlights.filter((highlight) => (resolveAncestorLevelId(highlight.primaryId, nodes).levelId ?? roomAnalysis?.rooms.find((room) => room.roomRegionId === highlight.primaryId)?.levelId) === levelId);
  const snapSegments = useMemo(() => buildMeasurementSnapSegments(nodes, levelId), [nodes, levelId]);
  const activeMeasurementMode = resolveMeasurementMode(measurementStart?.point ?? null, measurementHover?.point ?? null, orthogonalLock);
  useEffect(() => { setMeasurementStart(null); setMeasurementHover(null); setOrthogonalLock(false); }, [measurementMode, levelId]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Shift" && !event.repeat) setOrthogonalLock((locked) => !locked);
      if (event.key === "Escape") { setMeasurementStart(null); setMeasurementHover(null); }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedManualId) { event.preventDefault(); onDeleteManual(selectedManualId); }
    };
    window.addEventListener("keydown", onKeyDown); return () => { window.removeEventListener("keydown", onKeyDown); };
  }, [selectedManualId, onDeleteManual]);
  useEffect(() => {
    const plan = planRef.current, svg = svgRef.current;
    if (!plan || !svg) return;
    const worldPointAt = (clientX: number, clientY: number) => {
      const matrix = sceneRef.current?.getScreenCTM();
      if (!matrix) return null;
      const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
      return { x: point.x, z: point.y };
    };
    const zoomAt = (clientX: number, clientY: number, factor: number) => {
      const point = worldPointAt(clientX, clientY);
      if (point) setViewBoxRef.current(zoomCanvasViewBox(viewBoxRef.current, point, factor));
    };
    const onWheel = (event: WheelEvent) => {
      if (event.cancelable) event.preventDefault();
      const gesture = canvasWheelGesture(event);
      if (gesture === "zoom") {
        zoomAt(event.clientX, event.clientY, canvasWheelZoomFactor(event.deltaY, event.deltaMode, svg.clientHeight, event.ctrlKey ? TRACKPAD_PINCH_ZOOM_SENSITIVITY : undefined));
      }
    };
    const gestureCenter = (event: Event) => {
      const gesture = event as Event & { clientX?: number; clientY?: number }, bounds = svg.getBoundingClientRect();
      return { x: gesture.clientX ?? bounds.left + bounds.width / 2, y: gesture.clientY ?? bounds.top + bounds.height / 2 };
    };
    const onGestureStart = (event: Event) => {
      if (event.cancelable) event.preventDefault();
      const gesture = event as Event & { scale?: number };
      safariGesture.current = { scale: gesture.scale ?? 1 };
    };
    const onGestureChange = (event: Event) => {
      if (event.cancelable) event.preventDefault();
      const gesture = event as Event & { scale?: number }, previous = safariGesture.current, scale = gesture.scale ?? previous?.scale ?? 1;
      if (previous && scale > 0) {
        const center = gestureCenter(event);
        zoomAt(center.x, center.y, Math.pow(previous.scale / scale, SAFARI_GESTURE_ZOOM_EXPONENT));
      }
      safariGesture.current = { scale };
    };
    const onGestureEnd = (event: Event) => { if (event.cancelable) event.preventDefault(); safariGesture.current = null; };
    plan.addEventListener("wheel", onWheel, { passive: false });
    plan.addEventListener("gesturestart", onGestureStart, { passive: false });
    plan.addEventListener("gesturechange", onGestureChange, { passive: false });
    plan.addEventListener("gestureend", onGestureEnd, { passive: false });
    return () => {
      plan.removeEventListener("wheel", onWheel);
      plan.removeEventListener("gesturestart", onGestureStart);
      plan.removeEventListener("gesturechange", onGestureChange);
      plan.removeEventListener("gestureend", onGestureEnd);
    };
  }, []);
  const eventWorldPoint = (event: { clientX: number; clientY: number }): [number, number] | null => {
    const matrix = sceneRef.current?.getScreenCTM(); if (!matrix) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()); return [point.x, point.y];
  };
  const snapAtEvent = (event: { clientX: number; clientY: number }) => {
    const point = eventWorldPoint(event); if (!point) return null;
    const width = svgRef.current?.clientWidth || 1, height = svgRef.current?.clientHeight || 1, tolerance = Math.max(viewBox.width / width, viewBox.height / height) * 12;
    return snapMeasurementPoint(point, snapSegments, tolerance);
  };
  const commitMeasurementPoint = (snap: MeasurementSnap) => {
    if (!measurementStart) { setMeasurementStart(snap); setMeasurementHover(snap); return; }
    if (measurementMode === "off") return;
    const mode = resolveMeasurementMode(measurementStart.point, snap.point, orthogonalLock), geometry = buildManualMeasurementGeometry(measurementStart.point, snap.point, mode);
    if (geometry.valueMeters > .0005) onCreateMeasurement({ levelId, mode, start: measurementStart, end: snap });
    setMeasurementStart(null); setMeasurementHover(null);
  };
  return (
    <div
      ref={planRef}
      className={`plan ${measurementMode !== "off" ? "measuring" : ""}`}
      style={{ userSelect: "none", WebkitUserSelect: "none" }}
      onPointerDown={(e) => {
        if (measurementMode !== "off" || e.button !== 0) return;
        drag.current = { x: e.clientX, y: e.clientY, box: viewBox, moved: false };
      }}
      onPointerMove={(e) => {
        if (measurementMode !== "off") return;
        if (!drag.current) return;
        const screenDx = e.clientX - drag.current.x, screenDz = e.clientY - drag.current.y;
        if (!drag.current.moved && Math.hypot(screenDx, screenDz) < 3) return;
        if (!drag.current.moved) {
          drag.current.moved = true;
          e.currentTarget.setPointerCapture?.(e.pointerId);
        }
        const dx =
            (screenDx * drag.current.box.width) /
            (e.currentTarget.clientWidth || 1),
          dz =
            (screenDz * drag.current.box.height) /
            (e.currentTarget.clientHeight || 1),
          pan = rotatedPanDelta(dx, dz, rotation);
        setViewBox({
          ...drag.current.box,
          minX: drag.current.box.minX + pan.x,
          minZ: drag.current.box.minZ + pan.z,
        });
      }}
      onPointerUp={(e) => {
        if (!drag.current) return;
        if (drag.current?.moved) {
          suppressClick.current = true;
          window.setTimeout(() => { suppressClick.current = false; }, 0);
        }
        drag.current = null;
        if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => { drag.current = null; }}
    >
      <svg ref={svgRef} viewBox={vb}
        onPointerMove={(event) => { if (measurementMode !== "off") { const snap = snapAtEvent(event); if (snap) setMeasurementHover(snap); } }}
        onPointerLeave={() => { if (!measurementStart) setMeasurementHover(null); }}
        onContextMenu={(event) => { if (measurementMode !== "off") { event.preventDefault(); setMeasurementStart(null); setMeasurementHover(null); } }}
        onClickCapture={(event) => {
          if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; return; }
          const target = event.target as Element, deleteId = target.closest("[data-delete-measurement]")?.getAttribute("data-delete-measurement"), measurementId = target.closest("[data-manual-measurement]")?.getAttribute("data-manual-measurement");
          if (deleteId || measurementId) {
            event.preventDefault(); event.stopPropagation();
            if (deleteId) onDeleteManual(deleteId); else if (measurementId) onSelectManual(measurementId);
            return;
          }
          if (measurementMode === "off") return;
          event.preventDefault(); event.stopPropagation();
          const snap = snapAtEvent(event); if (snap) commitMeasurementPoint(snap);
        }}
        onClick={(event) => { if (!(event.target as Element).closest("[data-selectable]")) { onSelect(null); onSelectManual(null); onRestoreEvaluationOverview(); } }}>
        <defs>
          <marker
            id={`arrow-${levelId}`}
            markerWidth=".18"
            markerHeight=".18"
            refX=".16"
            refY=".09"
            orient="auto"
          >
            <path d="M0,0 L.18,.09 L0,.18z" fill="#e75c3c" />
          </marker>
          <marker id="stair-up" markerWidth=".18" markerHeight=".18" refX=".16" refY=".09" orient="auto"><path d="M0,0 L.18,.09 L0,.18z" fill="#171717" /></marker>
          <marker id="stair-down" markerWidth=".18" markerHeight=".18" refX=".16" refY=".09" orient="auto"><path d="M0,0 L.18,.09 L0,.18z" fill="#59635f" /></marker>
        </defs>
        <rect
          x={viewBox.minX}
          y={viewBox.minZ}
          width={viewBox.width}
          height={viewBox.height}
          fill="#fdfbf6"
        />
        <g ref={sceneRef} style={{ transform: `rotate(${rotation}deg)`, transformOrigin: `${cx}px ${cz}px`, transition: "transform 240ms cubic-bezier(.2,.8,.2,1)" }}>
          <g className={highlightsOnLevel.length ? "evaluation-scene-dimmed" : undefined}>
          {visibility.slabs && rendered.filter((n) => n.type === "slab" && n.visible !== false).map((n) => <Slab key={n.id} node={n} selected={selectedId === n.id} onSelect={onSelect} />)}
          {visibility.zones &&
            zones.map((n) => <Polygon key={n.id} node={n} onSelect={onSelect} />)}
          {visibility.walls &&
            exactWalls.map((n) => (
                <Wall
                  key={n.wallId}
                  node={nodes[n.wallId]}
                  footprint={n.footprint}
                  valid={n.validation.valid}
                  diagnosticCodes={n.validation.codes}
                  selected={selectedId === n.wallId}
                  onSelect={onSelect}
                />
              ))}
          {(visibility.shelves || visibility.centers) && rendered.filter((n) => n.type === "shelf").map((n) => <Shelf key={n.id} node={n} nodes={nodes} visibility={visibility} selected={selectedId === n.id} markerId={`arrow-${levelId}`} onSelect={onSelect} />)}
          {visibility.openings &&
            rendered
              .filter((n) => n.type === "door" || n.type === "window")
              .map((n) => (
                <Opening
                  key={n.id}
                  node={n}
                  nodes={nodes}
                  selected={selectedId === n.id}
                  onSelect={onSelect}
                />
              ))}
          {visibility.stairs && rendered
            .filter((n) => n.type === "stair")
            .map((n) => (
              <Stair key={n.id} node={n} nodes={nodes} onSelect={onSelect} />
            ))}
          {visibility.stairs && stairEntries.map((n) => <StairEntry key={`entry-${n.id}`} node={n} onSelect={onSelect} />)}
          {items.map((n) => (
            <Furniture
              key={n.id}
              node={n}
              nodes={nodes}
              visibility={visibility}
              selected={selectedId === n.id}
              viewRotation={rotation}
              markerId={`arrow-${levelId}`}
              onSelect={onSelect}
            />
          ))}
          {visibility.zones && zones.map((n) => <ZoneLabel key={`zone-label-${n.id}`} node={n} viewRotation={rotation} />)}
          {visibility.dimensions && <ExteriorDimensions report={exteriorDimensions} viewRotation={rotation} unit={measurementUnit} onSelect={onSelectDimension} />}
          <ConduitPlanOverlay overlay={conduitOverlay} levelId={levelId} selectedId={selectedId} onSelect={onSelect} />
          <ManualMeasurements measurements={manualMeasurements} preview={measurementMode !== "off" && measurementStart && measurementHover ? { mode: activeMeasurementMode, start: measurementStart, end: measurementHover } : null} unit={measurementUnit} viewRotation={rotation} selectedId={selectedManualId} onSelect={onSelectManual} onDelete={onDeleteManual} />
          {measurementMode !== "off" && measurementHover && <SnapIndicator snap={measurementHover} active={Boolean(measurementStart)} />}
          </g>
          {furnitureUseAnalysis && (showFurnitureUseZones || Boolean(activeEvaluationHighlight && /^G3-0(?:1[4-9]|2[0-4])$/.test(activeEvaluationHighlight.ruleId))) && <FurnitureUseZoneOverlay analysis={furnitureUseAnalysis} levelId={levelId} activeHighlight={activeEvaluationHighlight} showDebug={showFurnitureUseZones} />}
          {fixtureUseAnalysis && (showFixtureUseZones || Boolean(activeEvaluationHighlight && /^G3-0(?:2[5-9]|3[0-8])$/.test(activeEvaluationHighlight.ruleId))) && <FixtureUseZoneOverlay analysis={fixtureUseAnalysis} levelId={levelId} activeHighlight={activeEvaluationHighlight} showDebug={showFixtureUseZones} />}
          {operationUseAnalysis && showFurnitureUseZones && !showOperationUseZones && <OperationUseZoneOverlay analysis={operationUseAnalysis} levelId={levelId} activeHighlight={null} showDebug scope="furniture" />}
          {operationUseAnalysis && showFixtureUseZones && !showOperationUseZones && <OperationUseZoneOverlay analysis={operationUseAnalysis} levelId={levelId} activeHighlight={null} showDebug scope="fixture" />}
          {operationUseAnalysis && (showOperationUseZones || Boolean(activeEvaluationHighlight && /^G3-0(?:0[9]|1[0-2]|3[9]|4[0-4])$/.test(activeEvaluationHighlight.ruleId))) && <OperationUseZoneOverlay analysis={operationUseAnalysis} levelId={levelId} activeHighlight={activeEvaluationHighlight} showDebug={showOperationUseZones} />}
          {highlightsOnLevel.some((highlight) => highlight.pathPoints?.some((point) => point.levelId === levelId) || highlight.secondaryPathPoints?.some((point) => point.levelId === levelId)) && <S1PathOverlay highlights={highlightsOnLevel} levelId={levelId} showPrimary={s1PathDebugLayers.finalPolyline} />}
          {import.meta.env.DEV && <S1PathDebugOverlay highlights={highlightsOnLevel} levelId={levelId} layers={s1PathDebugLayers} pocProvider={s1PathPocProvider} />}
          {highlightsOnLevel.some((highlight) => highlight.spaceBoundaryPolygons?.some((polygon) => polygon.levelId === levelId)) && <S1SpaceFragmentOverlay highlights={highlightsOnLevel} levelId={levelId} />}
          {highlightsOnLevel.some((highlight) => highlight.furnitureMinimumUsePolygons?.some((polygon) => polygon.levelId === levelId) || highlight.furnitureOpeningPolygons?.some((polygon) => polygon.levelId === levelId) || highlight.furnitureRelationLine?.levelId === levelId) && <S1FurnitureOverlay highlights={highlightsOnLevel} levelId={levelId} />}
          {highlightsOnLevel.length > 0 && <EvaluationHighlightOverlay highlights={highlightsOnLevel} activeHighlight={activeEvaluationHighlight} nodes={nodes} exactWalls={exactWalls} onActivate={onActivateEvaluationHighlight} />}
          {(showDoorOperationDebug || Boolean(activeEvaluationHighlight && ["G3-002", "G3-007", "G3-008", "G3-009"].includes(activeEvaluationHighlight.ruleId))) && <DoorOperationOverlay operations={doorOperations} levelId={levelId} activeHighlight={activeEvaluationHighlight} showDebug={showDoorOperationDebug} />}
          {navigationAnalysis && showNavigableSpace && <NavigableSpaceOverlay analysis={navigationAnalysis} levelId={levelId} />}
          {showBuildingEnvelope && buildingEnvelope?.usableForEvaluation && <BuildingEnvelopeOverlay envelope={buildingEnvelope} />}
          {roomAnalysis && (showRoomRegions || highlightsOnLevel.some((highlight) => roomAnalysis.rooms.some((room) => room.roomRegionId === highlight.primaryId))) && <RoomRegionOverlay analysis={roomAnalysis} nodes={nodes} levelId={levelId} showAll={showRoomRegions} highlights={highlightsOnLevel} onActivate={onActivateEvaluationHighlight} />}
          {showConnectivity && connectivityGraph && <ConnectivityOverlay graph={connectivityGraph} nodes={nodes} levelId={levelId} />}
        </g>
      </svg>
      {measurementMode !== "off" && <div className="measure-hint">{measurementStart ? `${orthogonalLock ? activeMeasurementMode === "horizontal" ? "水平正交已开启" : "垂直正交已开启" : "自由对齐"} · 点击第二点 · Shift 切换正交 · Esc 退出` : `${orthogonalLock ? "正交已开启" : "正交已关闭"} · 点击第一点 · Shift 切换正交 · Esc 退出`}</div>}
      <Compass rotation={rotation} />
      {highlightsOnLevel.length > 0 && <div className="evaluation-highlight-legend"><span><i className={highlightsOnLevel.some((highlight) => highlight.status === "measured") ? "measured" : "primary"} />{highlightsOnLevel.some((highlight) => highlight.status === "measured") ? "测量空间" : "确定问题"}</span>{highlightsOnLevel.some((highlight) => highlight.status === "unable_to_determine") && <span><i className="unresolved" />待核验对象</span>}{highlightsOnLevel.some((highlight) => highlight.emphasizedIds?.length) && <span><i className="private" />私密中间空间</span>}<span><i className="related" />关联对象</span><span><i className="muted" />其他对象</span>{activeEvaluationHighlight && <button onClick={onRestoreEvaluationOverview}>返回全部问题</button>}<button onClick={onClearEvaluationHighlight}>关闭高亮</button></div>}
      {showRoomRegions && <div className="room-region-legend"><span><i className="room" />Room Region（物理空间）</span><span><i className="zone" />Zone（功能区域）</span><span><i className="warning" />未匹配/部分匹配</span></div>}
      {showConnectivity && connectivityGraph && <div className="connectivity-legend"><span><i className="reachable" />可达节点</span><span><i className="unreachable" />不可达/无入口</span><span><i className="portal" />有效门连接</span><span><i className="unresolved" />未解析门或楼梯</span></div>}
      {showDoorOperationDebug && <div className="door-operation-legend"><span><i className="swing" />门扇扫掠</span><span><i className="entry" />入口检测区域</span></div>}
      {showNavigableSpace && navigationAnalysis && <div className="navigable-space-legend"><span><i className="free" />400毫米单人基本通行范围</span></div>}
      {showFurnitureUseZones && furnitureUseAnalysis && <div className="furniture-use-legend"><span><i className="opening" />开启范围</span><span><i className="usable" />使用/取物区可用</span><span><i className="blocked" />使用/取物区不足</span><span><i className="candidate" />方向待确认</span></div>}
      {showFixtureUseZones && fixtureUseAnalysis && <div className="fixture-use-legend"><span><i className="opening" />开启范围</span><span><i className="usable" />使用区可用</span><span><i className="blocked" />使用区不足</span><span><i className="candidate" />数据待确认</span></div>}
      {showOperationUseZones && operationUseAnalysis && <div className="fixture-use-legend"><span><i className="usable" />可用操作/接近区</span><span><i className="blocked" />问题操作/接近区</span><span><i className="candidate" />部分受阻或数据待确认</span></div>}
      <div className="legend">{formatPanelLength(viewBox.width, measurementUnit)} × {formatPanelLength(viewBox.height, measurementUnit)}</div>
    </div>
  );
}
function DoorOperationOverlay({ operations, levelId, activeHighlight, showDebug }: { operations: DoorOperation[]; levelId: string; activeHighlight: EvaluationHighlight | null; showDebug: boolean }) {
  const activeDoorIds = new Set(activeHighlight && ["G3-002", "G3-007", "G3-008"].includes(activeHighlight.ruleId) ? [activeHighlight.primaryId, ...activeHighlight.relatedIds] : []);
  return <g className="door-operation-overlay" pointerEvents="none">
    {operations.filter((operation) => operation.levelId === levelId && operation.usableForEvaluation && (showDebug || activeDoorIds.has(operation.doorId))).map((operation) => {
      const active = activeDoorIds.has(operation.doorId), activeColor = activeHighlight?.status === "unable_to_determine" ? "#d8a449" : "#e23d35";
      return <g key={operation.doorId} data-door-operation={operation.doorId}>
        {operation.entryPolygon.length >= 3 && (showDebug || activeHighlight?.ruleId === "G3-002") && <polygon points={operation.entryPolygon.map(([x, z]) => `${x},${z}`).join(" ")} fill="#ed8b2c" fillOpacity={active ? ".18" : ".06"} stroke="#ed8b2c" strokeDasharray="5 3" strokeWidth={active ? "2" : "1"} vectorEffect="non-scaling-stroke" />}
        {(showDebug || activeHighlight?.ruleId === "G3-007" || activeHighlight?.ruleId === "G3-008") && operation.leaves.map((leaf) => { const polygon = active ? leaf.requiredSwingPolygon : leaf.swingPolygon; return <g key={leaf.leafIndex}><polygon points={polygon.map(([x, z]) => `${x},${z}`).join(" ")} fill={active ? activeColor : "#7b8790"} fillOpacity={active ? ".22" : ".05"} stroke={active ? activeColor : "#7b8790"} strokeDasharray="5 3" strokeWidth={active ? "2" : "1"} vectorEffect="non-scaling-stroke" /><circle cx={leaf.hingePoint[0]} cy={leaf.hingePoint[1]} r={active ? ".08" : ".05"} fill={active ? activeColor : "#7b8790"} /></g>; })}
      </g>;
    })}
  </g>;
}
function NavigableSpaceOverlay({ analysis, levelId }: { analysis: RoomNavigationAnalysis; levelId: string }) {
  const rooms = analysis.rooms.filter((room) => room.levelId === levelId);
  return <g className="navigable-space-overlay" pointerEvents="none">
    {rooms.flatMap((room) => buildReachableAreaRects(room.furnishedPortalReachableFreeCells ?? [], room.gridMeters).map((rect, index) => <rect key={`${room.roomRegionId}-reachable-${index}`} x={rect.x} y={rect.z} width={rect.width} height={rect.height} fill="#9fd8b5" fillOpacity=".44" stroke="#9fd8b5" strokeWidth={room.gridMeters * .04} />))}
  </g>;
}
function FurnitureUseZoneOverlay({ analysis, levelId, activeHighlight, showDebug }: { analysis: FurnitureUseAnalysis; levelId: string; activeHighlight: EvaluationHighlight | null; showDebug: boolean }) {
  const activeOwnerId = activeHighlight && /^G3-0(?:1[4-9]|2[0-4])$/.test(activeHighlight.ruleId) ? activeHighlight.primaryId : null;
  const assessments = new Map(analysis.assessments.map((assessment) => [assessment.zone.useZoneId, assessment]));
  return <g className="furniture-use-zone-overlay" pointerEvents="none">
    {analysis.useZones.filter((zone) => zone.levelId === levelId && (showDebug || zone.ownerObjectId === activeOwnerId)).map((zone) => {
      const assessment = assessments.get(zone.useZoneId), active = zone.ownerObjectId === activeOwnerId, unresolved = !zone.usableForEvaluation, usable = assessment?.usable === true, color = unresolved ? "#d8a449" : usable ? "#36a269" : "#e23d35";
      return <polygon key={zone.useZoneId} data-furniture-use-zone={zone.useZoneId} points={zone.polygon.map(([x, z]) => `${x},${z}`).join(" ")} fill={color} fillOpacity={active ? ".24" : ".12"} stroke={color} strokeDasharray={unresolved ? "6 4" : undefined} strokeWidth={active ? "2.5" : "1.4"} vectorEffect="non-scaling-stroke" />;
    })}
  </g>;
}
function FixtureUseZoneOverlay({ analysis, levelId, activeHighlight, showDebug }: { analysis: FixtureUseAnalysis; levelId: string; activeHighlight: EvaluationHighlight | null; showDebug: boolean }) {
  const activeOwnerId = activeHighlight && /^G3-0(?:2[5-9]|3[0-8])$/.test(activeHighlight.ruleId) ? activeHighlight.primaryId : null;
  const assessments = new Map(analysis.assessments.map((assessment) => [assessment.zone.useZoneId, assessment]));
  return <g className="fixture-use-zone-overlay" pointerEvents="none">
    {analysis.useZones.filter((zone) => zone.levelId === levelId && (!showDebug || zone.measurementBasis !== "explicit") && (showDebug || zone.ownerObjectId === activeOwnerId)).map((zone) => { const assessment = assessments.get(zone.useZoneId), active = zone.ownerObjectId === activeOwnerId, unresolved = !zone.usableForEvaluation, usable = assessment?.usable === true, color = unresolved ? "#d8a449" : usable ? "#36a269" : "#e23d35"; return <polygon key={zone.useZoneId} data-fixture-use-zone={zone.useZoneId} points={zone.polygon.map(([x,z]) => `${x},${z}`).join(" ")} fill={color} fillOpacity={active ? ".26" : ".13"} stroke={color} strokeDasharray={unresolved ? "6 4" : undefined} strokeWidth={active ? "2.5" : "1.4"} vectorEffect="non-scaling-stroke" />; })}
  </g>;
}
function OperationUseZoneOverlay({ analysis, levelId, activeHighlight, showDebug, scope = "all" }: { analysis: OperationUseAnalysis; levelId: string; activeHighlight: EvaluationHighlight | null; showDebug: boolean; scope?: OperationZoneDisplayGroup | "all" }) {
  const activeOwnerId = activeHighlight && /^G3-0(?:0[9]|1[0-2]|3[9]|4[0-4])$/.test(activeHighlight.ruleId) ? activeHighlight.primaryId : null;
  const assessments = new Map(analysis.assessments.map((assessment) => [assessment.zone.operationZoneId, assessment]));
  const displayGroups = new Map(analysis.items.map((owner) => [owner.item.id, operationZoneDisplayGroup(owner)]));
  return <g className="fixture-use-zone-overlay" pointerEvents="none">
    {analysis.zones.filter((zone) => zone.levelId === levelId && (scope === "all" || displayGroups.get(zone.ownerObjectId) === scope) && (showDebug || zone.ownerObjectId === activeOwnerId)).map((zone) => {
      const assessment = assessments.get(zone.operationZoneId), active = zone.ownerObjectId === activeOwnerId, unresolved = !zone.geometryReliable || !assessment;
      const usable = assessment?.usable === true,
        color = unresolved ? "#d8a449" : !usable ? "#e23d35" : "#36a269";
      return <g key={zone.operationZoneId} data-operation-zone={zone.operationZoneId} data-operation-zone-kind={zone.kind}>
        {zone.openingPolygon && <polygon data-operation-opening-zone={zone.operationZoneId} points={zone.openingPolygon.map(([x,z]) => `${x},${z}`).join(" ")} fill="#547aa5" fillOpacity={active ? ".18" : ".08"} stroke="#547aa5" strokeDasharray="6 4" strokeWidth={active ? "2.5" : "1.4"} vectorEffect="non-scaling-stroke" />}
        <polygon data-operation-use-zone={zone.operationZoneId} points={(zone.openedUsePolygon ?? zone.polygon).map(([x,z]) => `${x},${z}`).join(" ")} fill={color} fillOpacity={active ? ".30" : ".16"} stroke={color} strokeDasharray={unresolved ? "4 3" : undefined} strokeWidth={active ? "2.5" : "1.4"} vectorEffect="non-scaling-stroke" />
      </g>;
    })}
  </g>;
}
function BuildingEnvelopeOverlay({ envelope }: { envelope: BuildingEnvelope }) {
  return <g className="building-envelope-overlay" pointerEvents="none">{envelope.polygons.map((polygon, index) => <g key={index}>{polygon.map((ring, ringIndex) => <polygon key={ringIndex} points={ring.map(([x, z]) => `${x},${z}`).join(" ")} fill={ringIndex === 0 ? "#ed8b2c" : "#f7f8f5"} fillOpacity={ringIndex === 0 ? ".05" : "1"} stroke="#ed8b2c" strokeWidth={ringIndex === 0 ? "2" : "1"} vectorEffect="non-scaling-stroke" />)}</g>)}</g>;
}
function S1PathOverlay({ highlights, levelId, showPrimary = true }: { highlights: EvaluationHighlight[]; levelId: string; showPrimary?: boolean }) {
  return <g className="s1-path-overlay" pointerEvents="none">{highlights.flatMap((highlight) => {
    const points = highlight.pathPoints?.filter((item) => item.levelId === levelId).map((item) => item.point) ?? [], secondary = highlight.secondaryPathPoints?.filter((item) => item.levelId === levelId).map((item) => item.point) ?? [], crossings = highlight.crossingPoints?.filter((item) => item.levelId === levelId) ?? [], overlaps = highlight.overlapSegments?.filter((item) => item.levelId === levelId) ?? [], elements: React.ReactNode[] = [];
    if (showPrimary && points.length >= 2) elements.push(<polyline key={`${highlight.ruleId}:a`} points={points.map(([x, z]) => `${x},${z}`).join(" ")} fill="none" stroke="#3569a8" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />, <circle key={`${highlight.ruleId}:a-start`} cx={points[0]![0]} cy={points[0]![1]} r=".14" fill="#3569a8" />, <circle key={`${highlight.ruleId}:a-end`} cx={points[points.length - 1]![0]} cy={points[points.length -1]![1]} r=".14" fill="#3569a8" />);
    if (secondary.length >= 2) elements.push(<polyline key={`${highlight.ruleId}:b`} points={secondary.map(([x, z]) => `${x},${z}`).join(" ")} fill="none" stroke="#4f8f72" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="8 4" vectorEffect="non-scaling-stroke" />, <circle key={`${highlight.ruleId}:b-start`} cx={secondary[0]![0]} cy={secondary[0]![1]} r=".14" fill="#4f8f72" />, <circle key={`${highlight.ruleId}:b-end`} cx={secondary[secondary.length - 1]![0]} cy={secondary[secondary.length - 1]![1]} r=".14" fill="#4f8f72" />);
    overlaps.forEach((segment, index) => elements.push(<line key={`${highlight.ruleId}:overlap:${index}`} x1={segment.start[0]} y1={segment.start[1]} x2={segment.end[0]} y2={segment.end[1]} stroke="#d39a32" strokeWidth="7" strokeLinecap="round" strokeOpacity=".82" vectorEffect="non-scaling-stroke" />));
    crossings.forEach((crossing, index) => elements.push(<g key={`${highlight.ruleId}:crossing:${index}`} transform={`translate(${crossing.point[0]} ${crossing.point[1]})`}><circle r=".18" fill="#fff" stroke="#d39a32" strokeWidth="3" vectorEffect="non-scaling-stroke"/><path d="M-.11,-.11 L.11,.11 M.11,-.11 L-.11,.11" stroke="#d39a32" strokeWidth="2" vectorEffect="non-scaling-stroke"/></g>));
    return elements;
  })}</g>;
}
function S1PathDebugOverlay({ highlights, levelId, layers, pocProvider }: { highlights: EvaluationHighlight[]; levelId: string; layers: S1PathDebugLayers; pocProvider: S1PathPocProvider }) {
  return <g className="s1-path-debug-overlay" pointerEvents="none">{highlights.flatMap((highlight) => {
    const trace = highlight.hpeDebugTrace; if (!trace) return [];
    const lines = (segments: typeof trace.rawGridSegments, color: string, dash: string, prefix: string) => segments.filter((segment) => segment.levelId === levelId && segment.points.length > 1).map((segment, index) => <polyline key={`${highlight.ruleId}:${prefix}:${index}`} points={segment.points.map(([x, z]) => `${x},${z}`).join(" ")} fill="none" stroke={color} strokeWidth={prefix === "raw" ? "1.4" : "2.4"} strokeDasharray={dash} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />);
    const pocPoints = pocProvider === "yuka" ? trace && highlight.hpePocPaths?.yuka.filter((item) => item.levelId === levelId).map((item) => item.point) : pocProvider === "visibilityGraph" ? trace && highlight.hpePocPaths?.visibilityGraph.filter((item) => item.levelId === levelId).map((item) => item.point) : [];
    return [
      ...(pocProvider !== "current" && pocPoints && pocPoints.length > 1 ? [<polyline key={`${highlight.ruleId}:poc:${pocProvider}`} points={pocPoints.map(([x,z]) => `${x},${z}`).join(" ")} fill="none" stroke={pocProvider === "yuka" ? "#9b59b6" : "#16a085"} strokeWidth="4" strokeDasharray="9 3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />] : []),
      ...(layers.rawGrid ? lines(trace.rawGridSegments, "#d37931", "2 3", "raw") : []),
      ...(layers.smoothed ? lines(trace.smoothedSegments, "#8b5fa6", "7 3", "smooth") : []),
      ...(layers.portals ? trace.portalPoints.filter((point) => point.levelId === levelId).map((point, index) => <g key={`${highlight.ruleId}:portal:${index}`}><circle cx={point.point[0]} cy={point.point[1]} r=".12" fill="#d39a32" stroke="#fff" strokeWidth=".03"/><text x={point.point[0] + .12} y={point.point[1] - .12} fontSize=".28" fill="#8a6417">{point.doorId ? "D" : "S"}</text></g>) : []),
      ...(layers.anchors ? [trace.sourceAnchor, trace.targetAnchor].filter((point): point is NonNullable<typeof point> => Boolean(point && point.levelId === levelId)).map((point, index) => <g key={`${highlight.ruleId}:anchor:${index}`}><circle cx={point.point[0]} cy={point.point[1]} r=".16" fill={index ? "#c65d61" : "#4f8f72"} stroke="#fff" strokeWidth=".04"/><text x={point.point[0] + .16} y={point.point[1] + .16} fontSize=".28" fill="#31414d">{index ? "T" : "S"}</text></g>) : []),
    ];
  })}</g>;
}
function S1SpaceFragmentOverlay({ highlights, levelId }: { highlights: EvaluationHighlight[]; levelId: string }) {
  return <g className="s1-space-fragment-overlay" pointerEvents="none">{highlights.flatMap((highlight) => {
    const cells = (items: NonNullable<EvaluationHighlight["primaryNavigableCells"]>, fill: string, prefix: string) => items.filter((item) => item.levelId === levelId).map((item, index) => <rect key={`${highlight.ruleId}:${prefix}:${index}`} x={item.point[0] - item.gridMeters / 2} y={item.point[1] - item.gridMeters / 2} width={item.gridMeters} height={item.gridMeters} fill={fill} fillOpacity=".30" />);
    return [
      ...cells(highlight.primaryNavigableCells ?? [], "#4f8f72", "main"),
      ...cells(highlight.fragmentNavigableCells ?? [], "#b58a52", "fragment"),
      ...(highlight.spaceBoundaryPolygons ?? []).filter((polygon) => polygon.levelId === levelId).flatMap((polygon, polygonIndex) => polygon.rings.map((ring, ringIndex) => <polygon key={`${highlight.ruleId}:boundary:${polygonIndex}:${ringIndex}`} points={ring.map(([x, z]) => `${x},${z}`).join(" ")} fill={ringIndex ? "#fff" : "#3569a8"} fillOpacity={ringIndex ? ".88" : ".07"} stroke="#3569a8" strokeWidth="3" strokeDasharray="7 4" vectorEffect="non-scaling-stroke" />)),
    ];
  })}</g>;
}
function S1FurnitureOverlay({ highlights, levelId }: { highlights: EvaluationHighlight[]; levelId: string }) {
  return <g className="s1-furniture-overlay" pointerEvents="none">{highlights.flatMap((highlight) => {
    const minimum = (highlight.furnitureMinimumUsePolygons ?? []).filter((item) => item.levelId === levelId), opening = (highlight.furnitureOpeningPolygons ?? []).filter((item) => item.levelId === levelId), line = highlight.furnitureRelationLine?.levelId === levelId ? highlight.furnitureRelationLine : null;
    return [
      ...minimum.map((item, index) => <polygon key={`${highlight.ruleId}:minimum:${index}`} points={item.polygon.map(([x,z]) => `${x},${z}`).join(" ")} fill="#4f8f72" fillOpacity=".16" stroke="#4f8f72" strokeWidth="2.5" strokeDasharray="5 3" vectorEffect="non-scaling-stroke" />),
      ...opening.map((item, index) => <polygon key={`${highlight.ruleId}:opening:${index}`} points={item.polygon.map(([x,z]) => `${x},${z}`).join(" ")} fill="#547aa5" fillOpacity=".12" stroke="#547aa5" strokeWidth="2.5" strokeDasharray="7 4" vectorEffect="non-scaling-stroke" />),
      ...(line ? [<g key={`${highlight.ruleId}:relation`}><line x1={line.start[0]} y1={line.start[1]} x2={line.end[0]} y2={line.end[1]} stroke="#6d6fa3" strokeWidth="3" strokeDasharray="8 4" vectorEffect="non-scaling-stroke"/><circle cx={line.start[0]} cy={line.start[1]} r=".11" fill="#6d6fa3"/><circle cx={line.end[0]} cy={line.end[1]} r=".11" fill="#6d6fa3"/></g>] : []),
    ];
  })}</g>;
}
function RoomRegionOverlay({ analysis, nodes, levelId, showAll, highlights, onActivate }: { analysis: RoomRegionAnalysis; nodes: Record<string, NodeData>; levelId: string; showAll: boolean; highlights: EvaluationHighlight[]; onActivate: (highlight: EvaluationHighlight) => void }) {
  const rooms = analysis.rooms.filter((room) => room.levelId === levelId), matches = new Map(analysis.zoneMatches.map((match) => [match.zoneId, match]));
  return <g className="room-region-overlay">
    {rooms.map((room, index) => { const highlight = highlights.find((item) => item.primaryId === room.roomRegionId || item.relatedIds.includes(room.roomRegionId) || item.emphasizedIds?.includes(room.roomRegionId)), primary = highlight?.primaryId === room.roomRegionId, emphasized = highlight?.emphasizedIds?.includes(room.roomRegionId), highlightColor = emphasized ? "#76539b" : highlight?.status === "measured" ? primary ? "#3569a8" : "#ed8b2c" : highlight?.status === "unable_to_determine" ? "#d8a449" : primary ? "#e23d35" : "#ed8b2c", warning = !room.usableForEvaluation || analysis.unmatchedRoomRegionIds.includes(room.roomRegionId), outer = room.polygons[0]?.[0] ?? [], center = outer.length ? { x: outer.reduce((sum, point) => sum + point[0], 0) / outer.length, z: outer.reduce((sum, point) => sum + point[1], 0) / outer.length } : null; if (!showAll && !highlight) return null; return <g key={room.roomRegionId} data-room-region={room.roomRegionId} className={highlight ? "problem-room" : warning ? "warning-room" : "matched-room"} onClick={highlight ? (event) => { event.stopPropagation(); onActivate(highlight); } : undefined}>{room.polygons.flatMap((polygon, polygonIndex) => polygon.map((ring, ringIndex) => <polygon key={`${polygonIndex}-${ringIndex}`} points={ring.map(([x, z]) => `${x},${z}`).join(" ")} fill={ringIndex ? "#f7f8f5" : highlight ? highlightColor : warning ? "#d8a449" : "#4f8f72"} fillOpacity={ringIndex ? 1 : .14} stroke={highlight ? highlightColor : warning ? "#d8a449" : "#4f8f72"} strokeWidth={highlight ? "3" : "1.5"} vectorEffect="non-scaling-stroke" />))}{showAll && center && <text x={center.x} y={center.z} className="room-region-label" textAnchor="middle" dominantBaseline="middle">R{index + 1} · {room.areaSquareMeters.toFixed(1)} m²</text>}</g>; })}
    {showAll && Object.values(nodes).filter((node) => node.type === "zone" && resolveAncestorLevelId(node.id, nodes).levelId === levelId).map((zone) => { const points = zonePoints(zone), match = matches.get(zone.id), warning = match?.relationship === "unmatched-zone" || match?.relationship === "zone-crosses-rooms" || match?.relationship === "partial"; return points.length >= 3 ? <polygon key={zone.id} data-zone-match={match?.relationship ?? "unmatched-zone"} points={points.map((point) => `${point.x},${point.z}`).join(" ")} fill="none" stroke={warning ? "#d86756" : "#3569a8"} strokeDasharray="6 4" strokeWidth="2" vectorEffect="non-scaling-stroke" /> : null; })}
  </g>;
}
function ConnectivityOverlay({ graph, nodes, levelId }: { graph: RoomConnectivityGraph; nodes: Record<string, NodeData>; levelId: string }) {
  const centerOfRoom = (roomId: string) => { const room = graph.roomAnalysis.rooms.find((item) => item.roomRegionId === roomId), ring = room?.polygons[0]?.[0] ?? []; return ring.length ? { x: ring.reduce((sum, point) => sum + point[0], 0) / ring.length, z: ring.reduce((sum, point) => sum + point[1], 0) / ring.length } : null; };
  const average = (points: Array<[number, number]>) => points.length ? { x: points.reduce((sum, point) => sum + point[0], 0) / points.length, z: points.reduce((sum, point) => sum + point[1], 0) / points.length } : null;
  const degree = new Map<string, number>(); graph.edges.forEach((edge) => { degree.set(edge.fromNodeId, (degree.get(edge.fromNodeId) ?? 0) + 1); degree.set(edge.toNodeId, (degree.get(edge.toNodeId) ?? 0) + 1); });
  const exteriorStartRooms = graph.portals.filter((portal) => portal.usableForConnectivity && portal.connectsExterior).flatMap((portal) => {
    const roomRegionId = portal.roomRegionAId ?? portal.roomRegionBId;
    return roomRegionId ? [roomRegionId] : [];
  });
  const reached = new Set(exteriorStartRooms.flatMap((roomRegionId) => [...reachableNodeIds(graph, roomRegionId)]));
  const rooms = graph.roomAnalysis.rooms.filter((room) => room.levelId === levelId && room.usableForEvaluation), portals = graph.portals.filter((portal) => portal.levelId === levelId), stairs = graph.stairConnections.filter((connection) => connection.fromLevelId === levelId || connection.toLevelId === levelId);
  return <g className="connectivity-overlay" pointerEvents="none">
    {rooms.filter((room) => !(degree.get(room.roomRegionId) ?? 0)).flatMap((room) => room.polygons.flatMap((polygon, polygonIndex) => polygon.slice(0, 1).map((ring) => <polygon key={`${room.roomRegionId}-${polygonIndex}`} points={ring.map(([x, z]) => `${x},${z}`).join(" ")} fill="#e23d35" fillOpacity=".08" stroke="#e23d35" strokeDasharray="5 4" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />)))}
    {portals.map((portal) => { const a = average(portal.samplePointsA), b = average(portal.samplePointsB), center = portal.openingCenter; return portal.usableForConnectivity && a && b ? <g key={portal.doorId}><line x1={a.x} y1={a.z} x2={b.x} y2={b.z} stroke={portal.connectsExterior ? "#ed8b2c" : "#2c8c63"} strokeWidth="3" vectorEffect="non-scaling-stroke"/><circle cx={center?.[0]} cy={center?.[1]} r=".09" fill="#fff" stroke="#2c8c63" strokeWidth="2" vectorEffect="non-scaling-stroke"/></g> : center ? <g key={portal.doorId} transform={`translate(${center[0]} ${center[1]})`}><circle r=".16" fill="#fff3dd" stroke="#d86756" strokeWidth="2" vectorEffect="non-scaling-stroke"/><path d="M-.08,-.08 L.08,.08 M.08,-.08 L-.08,.08" stroke="#d86756" strokeWidth="2" vectorEffect="non-scaling-stroke"/></g> : null; })}
    {rooms.map((room) => { const center = centerOfRoom(room.roomRegionId); if (!center) return null; const isolated = !(degree.get(room.roomRegionId) ?? 0), reachable = reached.has(room.roomRegionId), color = isolated ? "#e23d35" : exteriorStartRooms.length ? reachable ? "#2c8c63" : "#d86756" : "#7b8790"; return <g key={room.roomRegionId} transform={`translate(${center.x} ${center.z})`}><circle r=".14" fill="#fff" stroke={color} strokeWidth="3" vectorEffect="non-scaling-stroke"/><text y="-.22" className="connectivity-node-label" textAnchor="middle">{degree.get(room.roomRegionId) ?? 0}入口</text></g>; })}
    {stairs.map((connection) => { const node = nodes[connection.stairId], corners = node ? stairCorners(node, nodes) : [], center = corners.length ? { x: corners.reduce((sum, point) => sum + point.x, 0) / corners.length, z: corners.reduce((sum, point) => sum + point.z, 0) / corners.length } : null; return center ? <g key={connection.stairId} transform={`translate(${center.x} ${center.z})`}><circle r=".2" fill={connection.usableForConnectivity ? "#e8f5ee" : "#fff3dd"} stroke={connection.usableForConnectivity ? "#2c8c63" : "#d86756"} strokeWidth="2" vectorEffect="non-scaling-stroke"/><text className="connectivity-stair-label" textAnchor="middle" dominantBaseline="middle">{connection.usableForConnectivity ? "↕" : "!"}</text></g> : null; })}
  </g>;
}
function EvaluationHighlightOverlay({ highlights, activeHighlight, nodes, exactWalls, onActivate }: { highlights: EvaluationHighlight[]; activeHighlight: EvaluationHighlight | null; nodes: Record<string, NodeData>; exactWalls: ReturnType<typeof buildExperimentalWalls>; onActivate: (highlight: EvaluationHighlight) => void }) {
  const wallById = new Map(exactWalls.map((wall) => [wall.wallId, wall]));
  const marked = new Map<string, { highlight: EvaluationHighlight; role: "primary" | "emphasized" | "related" }>();
  highlights.forEach((highlight) => [highlight.primaryId, ...highlight.relatedIds, ...(highlight.emphasizedIds ?? [])].forEach((id) => {
    const role = evaluationHighlightRole(highlight, id);
    if (role && (!marked.has(id) || role === "primary" || role === "emphasized")) marked.set(id, { highlight, role });
  }));
  return <g className="evaluation-highlight-overlay">{[...marked.entries()].map(([id, marker]) => {
    const { highlight, role } = marker, node = nodes[id];
    if (!node || !role) return null;
    const color = role === "emphasized" ? "#76539b" : role === "primary" ? highlight.status === "measured" ? "#3569a8" : highlight.status === "unable_to_determine" ? "#d8a449" : "#e23d35" : "#ed8b2c", fillOpacity = role === "primary" || role === "emphasized" ? .28 : .18, active = activeHighlight?.primaryId === highlight.primaryId;
    const activate = (event: React.MouseEvent<SVGElement>) => { event.preventDefault(); event.stopPropagation(); onActivate(highlight); };
    if (node.type === "wall") {
      const wall = wallById.get(id);
      if (wall?.validation.valid && wall.footprint.length >= 3) return <polygon key={id} className={active ? "active" : undefined} data-evaluation-highlight={id} data-highlight-role={role} points={wall.footprint.map((point) => `${point.x},${point.y}`).join(" ")} fill={color} fillOpacity={fillOpacity} stroke={color} strokeWidth="3" vectorEffect="non-scaling-stroke" onClick={activate} />;
      if (Array.isArray(node.start) && node.start.length >= 2 && node.start.slice(0, 2).every(Number.isFinite)) return <g key={id} className={active ? "active" : undefined} data-evaluation-highlight={id} data-highlight-role={role} onClick={activate}><circle cx={node.start[0]} cy={node.start[1]} r=".24" fill={color} fillOpacity={fillOpacity} stroke={color} strokeWidth="3" vectorEffect="non-scaling-stroke"/><line x1={node.start[0] - .32} y1={node.start[1]} x2={node.start[0] + .32} y2={node.start[1]} stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke"/><line x1={node.start[0]} y1={node.start[1] - .32} x2={node.start[0]} y2={node.start[1] + .32} stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke"/></g>;
    }
    if (node.type === "door" || node.type === "window") {
      const transform = resolveWallOpeningTransform(node, nodes), width = Number(node.width);
      if (transform && Number.isFinite(width) && width > 0) return <g key={id} className={active ? "active" : undefined} data-evaluation-highlight={id} data-highlight-role={role} transform={`translate(${transform.x} ${transform.z}) rotate(${transform.rotationY * 180 / Math.PI})`} onClick={activate}><rect x={-width / 2} y="-.16" width={width} height=".32" fill={color} fillOpacity={fillOpacity} stroke={color} strokeWidth="3" vectorEffect="non-scaling-stroke" /></g>;
    }
    if (node.type === "stair") {
      const corners = stairCorners(node, nodes);
      if (corners.length >= 3) return <polygon key={id} className={active ? "active" : undefined} data-evaluation-highlight={id} data-highlight-role={role} points={corners.map((point) => `${point.x},${point.z}`).join(" ")} fill={color} fillOpacity={fillOpacity} stroke={color} strokeWidth="3" vectorEffect="non-scaling-stroke" onClick={activate} />;
    }
    if (node.type === "shelf") {
      const corners = shelfCorners(node, nodes);
      if (corners.length >= 3) return <polygon key={id} className={active ? "active" : undefined} data-evaluation-highlight={id} data-highlight-role={role} points={corners.map((point) => `${point.x},${point.z}`).join(" ")} fill={color} fillOpacity={fillOpacity} stroke={color} strokeWidth="3" vectorEffect="non-scaling-stroke" onClick={activate} />;
    }
    if (node.type === "zone") {
      const points = zonePoints(node);
      if (points.length >= 3) return <polygon key={id} className={active ? "active" : undefined} data-evaluation-highlight={id} data-highlight-role={role} points={points.map((point) => `${point.x},${point.z}`).join(" ")} fill={color} fillOpacity={fillOpacity} stroke={color} strokeWidth="3" vectorEffect="non-scaling-stroke" onClick={activate} />;
    }
    if (node.type === "item") {
      const transform = resolveItemPlanTransform(node.id, nodes), dimensions = finalDimensions(node);
      if (transform.status === "ok" && dimensions) return <g key={id} className={active ? "active" : undefined} data-evaluation-highlight={id} data-highlight-role={role} transform={`translate(${transform.x} ${transform.z}) rotate(${transform.rotationY * 180 / Math.PI})`} onClick={activate}><rect x={-dimensions.width / 2} y={-dimensions.depth / 2} width={dimensions.width} height={dimensions.depth} fill={color} fillOpacity={fillOpacity} stroke={color} strokeWidth="3" vectorEffect="non-scaling-stroke" /></g>;
    }
    return null;
  })}</g>;
}
function Compass({ rotation }: { rotation: number }) {
  return (
    <div className="compass" title={`视图旋转 ${rotation}°`}>
      <div
        className="compass-arrow"
        style={{ transform: `rotate(${compassArrowRotation(rotation, DEFAULT_CANVAS_ROTATION)}deg)` }}
      >
        ▲
      </div>
      <b>N</b>
    </div>
  );
}
function Polygon({ node, onSelect }: { node: NodeData; onSelect: (id: string) => void }) {
  const polygon = zonePoints(node), color = zoneColor(node);
  if (polygon.length < 3) return null;
  const points = polygon.map((point) => `${point.x},${point.z}`).join(" ");
  return <polygon data-selectable points={points} fill={color} fillOpacity=".12" stroke={color} strokeOpacity=".32" strokeWidth=".03" onClick={() => onSelect(node.id)} />;
}
function ZoneLabel({ node, viewRotation }: { node: NodeData; viewRotation: number }) {
  const label = zoneLabelPoint(node), color = zoneColor(node);
  if (!label) return null;
  return <text x={label.x} y={label.z} className="zone-label" fontSize=".22" fontWeight="700" textAnchor="middle" dominantBaseline="middle" style={{ fill: color, transform: `rotate(${-viewRotation}deg)`, transformOrigin: `${label.x}px ${label.z}px`, transition: "transform 240ms cubic-bezier(.2,.8,.2,1)" }} stroke="#ffffff" strokeWidth=".035" strokeOpacity=".9" paintOrder="stroke" pointerEvents="none">{node.name || "Zone"}</text>;
}
function ExteriorDimensions({ report, viewRotation, unit, onSelect }: { report: ReturnType<typeof buildExteriorDimensions>; viewRotation: number; unit: MeasurementUnit; onSelect: (dimension: DimensionSegment) => void }) {
  const color = "#4b5563";
  return <g className="exterior-dimensions">{buildAlignedDimensionDisplay(report).map((dimension) => {
    const displayValue = formatMeasurement(dimension.valueMeters, unit), display = dimensionDisplayGeometry(report, dimension), offset = dimension.dimensionLayer === "inner-chain" ? INNER_CHAIN_OFFSET_M : OVERALL_CHAIN_OFFSET_M,
      start: [number, number] = [display.faceStart[0] + dimension.outwardNormal[0] * offset, display.faceStart[1] + dimension.outwardNormal[1] * offset],
      end: [number, number] = [display.faceEnd[0] + dimension.outwardNormal[0] * offset, display.faceEnd[1] + dimension.outwardNormal[1] * offset],
      midpoint: [number, number] = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2],
      textWidth = Math.max(.24, displayValue.length * .105), fitsInside = dimension.valueMeters > textWidth + .16,
      label: [number, number] = fitsInside ? midpoint : [end[0] + dimension.direction[0] * (textWidth / 2 + .14), end[1] + dimension.direction[1] * (textWidth / 2 + .14)],
      gapHalf = Math.min(textWidth / 2 + .05, dimension.valueMeters * .4),
      beforeGap: [number, number] = [midpoint[0] - dimension.direction[0] * gapHalf, midpoint[1] - dimension.direction[1] * gapHalf],
      afterGap: [number, number] = [midpoint[0] + dimension.direction[0] * gapHalf, midpoint[1] + dimension.direction[1] * gapHalf],
      extensionStart: [number, number] = [start[0] + dimension.outwardNormal[0] * EXTENSION_OVERSHOOT_M, start[1] + dimension.outwardNormal[1] * EXTENSION_OVERSHOOT_M],
      extensionEnd: [number, number] = [end[0] + dimension.outwardNormal[0] * EXTENSION_OVERSHOOT_M, end[1] + dimension.outwardNormal[1] * EXTENSION_OVERSHOOT_M],
      tick: [number, number] = [(dimension.direction[0] + dimension.outwardNormal[0]) * .065, (dimension.direction[1] + dimension.outwardNormal[1]) * .065], angle = uprightDimensionAngle(dimension.direction, viewRotation);
    return <g data-selectable key={dimension.id} onClick={() => onSelect(dimension)} style={{ cursor: "pointer" }}>
      <line x1={display.edgeStart[0]} y1={display.edgeStart[1]} x2={extensionStart[0]} y2={extensionStart[1]} stroke={color} strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <line x1={display.edgeEnd[0]} y1={display.edgeEnd[1]} x2={extensionEnd[0]} y2={extensionEnd[1]} stroke={color} strokeWidth="1" vectorEffect="non-scaling-stroke" />
      {fitsInside ? <><line x1={start[0]} y1={start[1]} x2={beforeGap[0]} y2={beforeGap[1]} stroke={color} strokeWidth="1" vectorEffect="non-scaling-stroke"/><line x1={afterGap[0]} y1={afterGap[1]} x2={end[0]} y2={end[1]} stroke={color} strokeWidth="1" vectorEffect="non-scaling-stroke"/></> : <line x1={start[0]} y1={start[1]} x2={label[0] + dimension.direction[0] * textWidth / 2} y2={label[1] + dimension.direction[1] * textWidth / 2} stroke={color} strokeWidth="1" vectorEffect="non-scaling-stroke"/>}
      {[start, end].map((point, index) => <line key={index} x1={point[0] - tick[0]} y1={point[1] - tick[1]} x2={point[0] + tick[0]} y2={point[1] + tick[1]} stroke={color} strokeWidth="1.2" vectorEffect="non-scaling-stroke" />)}
      <text x={label[0]} y={label[1]} transform={`rotate(${angle} ${label[0]} ${label[1]})`} textAnchor="middle" dominantBaseline="middle" fontFamily="DM Mono, monospace" fontSize=".18" fill={color} stroke="#f7f8f5" strokeWidth=".04" paintOrder="stroke">{displayValue}</text>
    </g>;
  })}</g>;
}
function ManualMeasurements({ measurements, preview, unit, viewRotation, selectedId, onSelect, onDelete }: { measurements: ManualMeasurement[]; preview: { mode: Exclude<MeasurementMode, "off">; start: MeasurementSnap; end: MeasurementSnap } | null; unit: MeasurementUnit; viewRotation: number; selectedId: string | null; onSelect: (id: string | null) => void; onDelete: (id: string) => void }) {
  return <g className="manual-measurements">
    {measurements.map((measurement) => <ManualMeasurementGraphic key={measurement.id} measurement={measurement} unit={unit} viewRotation={viewRotation} selected={selectedId === measurement.id} onSelect={onSelect} onDelete={onDelete} />)}
    {preview && <ManualMeasurementGraphic measurement={{ id: "measurement-preview", levelId: "", createdAt: 0, ...preview }} unit={unit} viewRotation={viewRotation} selected={false} preview />}
  </g>;
}
function ManualMeasurementGraphic({ measurement, unit, viewRotation, selected, preview = false, onSelect, onDelete }: { measurement: ManualMeasurement; unit: MeasurementUnit; viewRotation: number; selected: boolean; preview?: boolean; onSelect?: (id: string | null) => void; onDelete?: (id: string) => void }) {
  const geometry = buildManualMeasurementGeometry(measurement.start.point, measurement.end.point, measurement.mode), color = preview ? "#d97706" : selected ? "#e75c3c" : "#246b72", label = formatMeasurement(geometry.valueMeters, unit), angle = uprightDimensionAngle(geometry.direction, viewRotation), tick: [number, number] = [geometry.normal[0] * .08, geometry.normal[1] * .08], deletePoint: [number, number] = [geometry.labelPoint[0] + geometry.normal[0] * .32, geometry.labelPoint[1] + geometry.normal[1] * .32];
  if (geometry.valueMeters <= .0005) return null;
  return <g data-selectable={!preview || undefined} data-manual-measurement={!preview ? measurement.id : undefined} onClick={(event) => { if (!preview) { event.stopPropagation(); onSelect?.(measurement.id); } }} style={{ cursor: preview ? "crosshair" : "pointer" }}>
    {geometry.extensionLines.map((line, index) => <line key={index} x1={line.start[0]} y1={line.start[1]} x2={line.end[0]} y2={line.end[1]} stroke={color} strokeWidth="1" strokeDasharray={preview ? "4 3" : undefined} vectorEffect="non-scaling-stroke" />)}
    <line x1={geometry.measurementStart[0]} y1={geometry.measurementStart[1]} x2={geometry.measurementEnd[0]} y2={geometry.measurementEnd[1]} stroke={color} strokeWidth={selected ? "1.8" : "1.2"} strokeDasharray={preview ? "5 4" : undefined} vectorEffect="non-scaling-stroke" />
    {[geometry.measurementStart, geometry.measurementEnd].map((point, index) => <line key={index} x1={point[0] - tick[0]} y1={point[1] - tick[1]} x2={point[0] + tick[0]} y2={point[1] + tick[1]} stroke={color} strokeWidth="1.3" vectorEffect="non-scaling-stroke" />)}
    <circle cx={measurement.start.point[0]} cy={measurement.start.point[1]} r=".045" fill={color} />
    <circle cx={measurement.end.point[0]} cy={measurement.end.point[1]} r=".045" fill={color} />
    <text x={geometry.labelPoint[0]} y={geometry.labelPoint[1]} transform={`rotate(${angle} ${geometry.labelPoint[0]} ${geometry.labelPoint[1]})`} textAnchor="middle" dominantBaseline="middle" fontFamily="DM Mono, monospace" fontSize=".18" fill={color} stroke="#f7f8f5" strokeWidth=".045" paintOrder="stroke" pointerEvents="none">{label}</text>
    {selected && !preview && <g data-delete-measurement={measurement.id} onClick={(event) => { event.stopPropagation(); onDelete?.(measurement.id); }} style={{ cursor: "pointer" }}><circle cx={deletePoint[0]} cy={deletePoint[1]} r=".14" fill="#fff" stroke="#d84f42" strokeWidth="1.4" vectorEffect="non-scaling-stroke"/><line x1={deletePoint[0] - .05} y1={deletePoint[1] - .05} x2={deletePoint[0] + .05} y2={deletePoint[1] + .05} stroke="#d84f42" strokeWidth="1.8" vectorEffect="non-scaling-stroke"/><line x1={deletePoint[0] + .05} y1={deletePoint[1] - .05} x2={deletePoint[0] - .05} y2={deletePoint[1] + .05} stroke="#d84f42" strokeWidth="1.8" vectorEffect="non-scaling-stroke"/></g>}
  </g>;
}
function SnapIndicator({ snap, active }: { snap: MeasurementSnap; active: boolean }) {
  const color = snap.kind === "free" ? "#d97706" : "#16a085";
  return <g pointerEvents="none"><circle cx={snap.point[0]} cy={snap.point[1]} r={active ? ".095" : ".075"} fill="#fff" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke"/><line x1={snap.point[0] - .05} y1={snap.point[1]} x2={snap.point[0] + .05} y2={snap.point[1]} stroke={color} strokeWidth="1" vectorEffect="non-scaling-stroke"/><line x1={snap.point[0]} y1={snap.point[1] - .05} x2={snap.point[0]} y2={snap.point[1] + .05} stroke={color} strokeWidth="1" vectorEffect="non-scaling-stroke"/></g>;
}
function Slab({ node, selected, onSelect }: { node: NodeData; selected: boolean; onSelect: (id: string) => void }) {
  const geometry = buildSlabPlanGeometry(node);
  if (!geometry) return null;
  return <path data-selectable d={geometry.path} fill={selected ? "#dbe8dc" : "#e8eee8"} fillRule="evenodd" clipRule="evenodd" stroke={selected ? "#e75c3c" : "#b5c2b8"} strokeWidth={selected ? ".04" : ".018"} opacity=".78" onClick={() => onSelect(node.id)} />;
}
function Wall({
  node,
  footprint,
  valid,
  diagnosticCodes,
  selected,
  onSelect,
}: {
  node: NodeData;
  footprint?: Array<{ x: number; y: number }>;
  valid?: boolean;
  diagnosticCodes?: string[];
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  if (!Array.isArray(node.start) || !Array.isArray(node.end)) return null;
  if (footprint?.length && valid)
    return (
      <polygon
        data-selectable
        points={footprint.map((point) => `${point.x},${point.y}`).join(" ")}
        fill={selected ? "#e75c3c" : "#303a3b"}
        stroke="#202929"
        strokeWidth=".018"
        vectorEffect="non-scaling-stroke"
        onClick={() => onSelect(node.id)}
      />
    );
  if (footprint && !valid)
    return (
      <g
        data-selectable
        aria-label={`experimental wall diagnostic: ${diagnosticCodes?.join(", ") || "unknown"}`}
        onClick={() => onSelect(node.id)}
      >
        <title>{diagnosticCodes?.join(", ") || "wall_invalid_footprint"}</title>
        <line
          x1={node.start[0]}
          y1={node.start[1]}
          x2={node.end[0]}
          y2={node.end[1]}
          stroke="#d95446"
          strokeWidth=".05"
        />
        <circle cx={node.start[0]} cy={node.start[1]} r=".12" fill="#d95446" />
      </g>
    );
  return null;
}
function Shelf({ node, nodes, visibility, selected, markerId, onSelect }: { node: NodeData; nodes: Record<string, NodeData>; visibility: Visibility; selected: boolean; markerId: string; onSelect: (id: string) => void }) {
  const data = resolveShelfData(node), matrix = shelfMatrix(node, nodes);
  if (!matrix || !hasValidShelfFootprint(node)) return null;
  return <g data-selectable transform={svgMatrixString(matrix)} onClick={() => onSelect(node.id)} className="shelf">
    {visibility.shelves && <><rect x={-data.width / 2} y={-data.depth / 2} width={data.width} height={data.depth} fill="#d6d3d1" stroke={selected ? "#e75c3c" : "#1f2937"} strokeWidth={selected ? ".045" : ".015"} opacity=".9" />
    {shelfDividerXs(data).map((x) => <line key={x} x1={x} x2={x} y1={-data.depth / 2 + data.thickness} y2={data.depth / 2 - data.thickness} stroke="#1f2937" strokeWidth=".012" opacity=".7" />)}</>}
    {(visibility.boxes || selected) && <rect x={-data.width / 2} y={-data.depth / 2} width={data.width} height={data.depth} fill="none" stroke={selected ? "#e75c3c" : "#b88348"} strokeWidth={selected ? ".06" : ".025"} />}
    {visibility.centers && <><circle r=".04" fill="#e75c3c" /><line x2="0" y2={data.depth / 2} stroke="#e75c3c" strokeWidth=".025" markerEnd={`url(#${markerId})`} /></>}
  </g>;
}
function Opening({
  node,
  nodes,
  selected,
  onSelect,
}: {
  node: NodeData;
  nodes: Record<string, NodeData>;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const transform = resolveWallOpeningTransform(node, nodes);
  if (!transform) return null;
  const width = Number.isFinite(node.width) ? node.width : 0.9,
    depth = 0.12,
    angle = (transform.rotationY * 180) / Math.PI;
  if (node.type === "door") {
    const color = selected ? "#e75c3c" : "#9b6736",
      doorType = node.doorType ?? "hinged",
      isDouble = doorType === "double" || doorType === "french",
      orientation = resolveDoorOperationOrientation(node),
      hinges = orientation.effectiveHingesSide,
      swing = orientation.effectiveSwingDirection,
      swingSign = swing === "inward" ? 1 : -1;
    const leaf = (hingeX: number, closedVectorX: number, signedQuarterTurn: number, key: string) => {
      const radius = Math.abs(closedVectorX), closedTipX = hingeX + closedVectorX,
        openTipX = hingeX, openTipY = closedVectorX * Math.sin(signedQuarterTurn),
        sweepFlag = signedQuarterTurn >= 0 ? 1 : 0;
      return <React.Fragment key={key}><line x1={hingeX} y1="0" x2={openTipX} y2={openTipY} stroke={color} strokeWidth={selected ? "2.4" : "1.7"} vectorEffect="non-scaling-stroke"/><path d={`M ${closedTipX} 0 A ${radius} ${radius} 0 0 ${sweepFlag} ${openTipX} ${openTipY}`} fill="none" stroke={color} strokeWidth={selected ? "1.6" : "1.1"} strokeDasharray="5 4" strokeLinecap="round" vectorEffect="non-scaling-stroke"/></React.Fragment>;
    };
    return (
      <g
        data-selectable
        transform={`translate(${transform.x} ${transform.z}) rotate(${angle})`}
        onClick={() => onSelect(node.id)}
      >
        <rect
          x={-width / 2}
          y={-depth / 2}
          width={width}
          height={depth}
          fill="#f7f8f5"
          stroke={color}
          strokeWidth={selected ? ".045" : ".025"}
        />
        {node.openingKind !== "opening" && (isDouble
          ? <>{leaf(-width / 2, width / 2, swingSign * Math.PI / 2, "left")}{leaf(width / 2, -width / 2, -swingSign * Math.PI / 2, "right")}</>
          : doorType === "hinged" && leaf(hinges === "left" ? -width / 2 : width / 2, hinges === "left" ? width : -width, swingSign * (hinges === "left" ? 1 : -1) * Math.PI / 2, "single"))}
      </g>
    );
  }
  return (
    <g
      data-selectable
      transform={`translate(${transform.x} ${transform.z}) rotate(${angle})`}
      onClick={() => onSelect(node.id)}
    >
      <rect
        x={-width / 2}
        y={-depth / 2}
        width={width}
        height={depth}
        fill="#f7f8f5"
        stroke={selected ? "#e75c3c" : "#287b8e"}
        strokeWidth={selected ? 0.045 : 0.025}
      />
      <line x1={-width / 2} x2={width / 2} stroke="#65a9b8" strokeWidth=".025" />
    </g>
  );
}
function Stair({
  node,
  nodes,
  onSelect,
}: {
  node: NodeData;
  nodes: Record<string, NodeData>;
  onSelect: (id: string) => void;
}) {
  if (node.stairType === 'spiral') {
    const geometry = buildSpiralStairPlanGeometry(node); if (!geometry) return null;
    return <g data-selectable onClick={() => onSelect(node.id)}><path d={geometry.footprintPath} fill="rgba(255,255,255,.08)" stroke="#171717" strokeWidth=".025" />{geometry.treadLines.map((line,index)=><line key={index} x1={line.start.x} y1={line.start.z} x2={line.end.x} y2={line.end.z} stroke="#262626" strokeWidth={index===geometry.treadLines.length-1?'.035':'.018'} />)}{geometry.railingPaths.map((path,index)=><polyline key={index} points={path.map(p=>`${p.x},${p.z}`).join(' ')} fill="none" stroke="#171717" strokeWidth=".025" />)}{geometry.centerColumn&&<circle cx={geometry.centerColumn.x} cy={geometry.centerColumn.z} r={Math.max(geometry.innerRadius*.18,.06)} fill="#d6d3d1" stroke="#171717" strokeWidth=".02"/>}<line x1={geometry.upDirection.from.x} y1={geometry.upDirection.from.z} x2={geometry.upDirection.to.x} y2={geometry.upDirection.to.z} stroke="#171717" strokeWidth=".03" markerEnd="url(#stair-up)"/></g>;
  }
  if (node.stairType === 'curved') {
    const geometry = buildCurvedStairPlanGeometry(node); if (!geometry) return null;
    return <g data-selectable onClick={() => onSelect(node.id)}><path d={geometry.footprintPath} fill="rgba(255,255,255,.08)" stroke="#171717" strokeWidth=".025" />{geometry.treadLines.map((line,index)=><line key={index} x1={line.start.x} y1={line.start.z} x2={line.end.x} y2={line.end.z} stroke="#262626" strokeWidth={index===0 || index===geometry.treadLines.length-1?'.03':'.018'} />)}<line x1={geometry.upDirection.from.x} y1={geometry.upDirection.from.z} x2={geometry.upDirection.to.x} y2={geometry.upDirection.to.z} stroke="#171717" strokeWidth=".03" markerEnd="url(#stair-up)"/></g>;
  }
  const geometry = buildStraightStairPlanGeometry(node, nodes); if (!geometry) return null;
  return <g data-selectable onClick={() => onSelect(node.id)}>{geometry.segments.map((segment) => <g key={segment.node.id}><polygon points={segment.polygon.map((point) => `${point.x},${point.z}`).join(' ')} fill="rgba(255,255,255,.08)" stroke="#171717" strokeWidth=".025" />{segment.treads.map((tread, index) => <line key={index} x1={tread.start.x} y1={tread.start.z} x2={tread.end.x} y2={tread.end.z} stroke="#262626" strokeWidth=".018" />)}</g>)}<line x1={geometry.upDirection.from.x} y1={geometry.upDirection.from.z} x2={geometry.upDirection.to.x} y2={geometry.upDirection.to.z} stroke="#171717" strokeWidth=".03" fill="none" markerEnd="url(#stair-up)"/></g>;
}
function StairEntry({ node, onSelect }: { node: NodeData; onSelect: (id: string) => void }) {
  const entry = buildSpiralStairDestinationEntry(node); if (!entry) return null;
  return <g data-selectable onClick={() => onSelect(node.id)}><path d={`M ${entry.footprint.map(p=>`${p.x} ${p.z}`).join(' L ')} Z`} fill="rgba(255,255,255,.02)" stroke="#59635f" strokeWidth=".025" strokeDasharray=".08 .05"/><line x1={entry.downDirection.from.x} y1={entry.downDirection.from.z} x2={entry.downDirection.to.x} y2={entry.downDirection.to.z} stroke="#59635f" strokeWidth=".03" markerEnd="url(#stair-down)"/></g>;
}
function useFloorplanImageCrop(imageUrl?: string): FloorplanImageCropCacheEntry | null {
  const [entry, setEntry] = useState<FloorplanImageCropCacheEntry | null>(() => imageUrl ? peekFloorplanImageCrop(imageUrl) : null);
  useEffect(() => {
    let cancelled = false; setEntry(imageUrl ? peekFloorplanImageCrop(imageUrl) : null);
    if (imageUrl) loadFloorplanImageCrop(imageUrl).then((result) => { if (!cancelled) setEntry(result); });
    return () => { cancelled = true; };
  }, [imageUrl]);
  return entry;
}
function Furniture({
  node,
  nodes,
  visibility,
  selected,
  viewRotation,
  markerId,
  onSelect,
}: {
  node: NodeData;
  nodes: Record<string, NodeData>;
  visibility: Visibility;
  selected: boolean;
  viewRotation: number;
  markerId: string;
  onSelect: (id: string) => void;
}) {
  const dimensions = finalDimensions(node),
    transform = resolveItemPlanTransform(node.id, nodes), imageUrl = node.asset?.floorPlanUrl as string | undefined, cropEntry = useFloorplanImageCrop(imageUrl);
  if (!dimensions || transform.status === "error") return null;
  const matrix = composePascalTransformWithWorldToSvg(transform),
    cropPlacement = cropEntry && !cropEntry.isFallback ? computeCropPlacement({ x: cropEntry.cropX, y: cropEntry.cropY, width: cropEntry.cropWidth, height: cropEntry.cropHeight }, dimensions.width, dimensions.depth) : null,
    labelY = dimensions.depth / 2 + 0.15,
    labelCounterRotation = transform.rotationY * 180 / Math.PI - viewRotation;
  return (
    <g
      data-selectable
      className="furniture"
      transform={svgMatrixString(matrix)}
      onClick={() => onSelect(node.id)}
    >
      {visibility.images && imageUrl && (
        cropEntry && cropPlacement
          ? <svg x={-dimensions.width / 2 + cropPlacement.offsetX} y={-dimensions.depth / 2 + cropPlacement.offsetY} width={cropPlacement.drawWidth} height={cropPlacement.drawHeight} viewBox={`${cropEntry.cropX} ${cropEntry.cropY} ${cropEntry.cropWidth} ${cropEntry.cropHeight}`} preserveAspectRatio="none" overflow="hidden"><image href={imageUrl} x="0" y="0" width={cropEntry.naturalWidth} height={cropEntry.naturalHeight} preserveAspectRatio="xMidYMid meet" /></svg>
          : <image href={imageUrl} x={-dimensions.width / 2} y={-dimensions.depth / 2} width={dimensions.width} height={dimensions.depth} preserveAspectRatio="none" />
      )}
      {(visibility.boxes || selected) && (
        <rect
          x={-dimensions.width / 2}
          y={-dimensions.depth / 2}
          width={dimensions.width}
          height={dimensions.depth}
          fill="none"
          stroke={selected ? "#e75c3c" : "#b88348"}
          strokeWidth={selected ? 0.06 : 0.025}
        />
      )}{" "}
      {visibility.images && !imageUrl && (
        <>
          <line
            x1={-dimensions.width / 2}
            y1={-dimensions.depth / 2}
            x2={dimensions.width / 2}
            y2={dimensions.depth / 2}
            stroke="#b88348"
            strokeWidth=".025"
          />
          <line
            x1={dimensions.width / 2}
            y1={-dimensions.depth / 2}
            x2={-dimensions.width / 2}
            y2={dimensions.depth / 2}
            stroke="#b88348"
            strokeWidth=".025"
          />
        </>
      )}
      {visibility.centers && <circle r=".04" fill="#e75c3c" />}
      {visibility.centers && (
        <line
          x2="0"
          y2={dimensions.depth / 2}
          stroke="#e75c3c"
          strokeWidth=".025"
          markerEnd={`url(#${markerId})`}
        />
      )}{" "}
      {visibility.names && (
        <text
          y={labelY}
          textAnchor="middle"
          className="item-label"
          fontSize=".14"
          style={{ transform: `rotate(${labelCounterRotation}deg)`, transformOrigin: `0px ${labelY}px`, transition: "transform 240ms cubic-bezier(.2,.8,.2,1)" }}
        >
          {node.name || node.asset?.name || node.id}
        </text>
      )}
    </g>
  );
}
function Inspector({
  node,
  nodes,
  coverage,
  dimension,
  manualMeasurement,
  measurementUnit,
}: {
  node: NodeData | null;
  nodes: Record<string, NodeData>;
  coverage: ReturnType<typeof auditSceneCoverage>;
  dimension: DimensionSegment | null;
  manualMeasurement: ManualMeasurement | null;
  measurementUnit: MeasurementUnit;
}) {
  if (manualMeasurement) { const geometry = buildManualMeasurementGeometry(manualMeasurement.start.point, manualMeasurement.end.point, manualMeasurement.mode); return <InspectorSection title="手动尺寸" rows={[["数值", formatMeasurement(geometry.valueMeters, measurementUnit)], ["模式", manualMeasurement.mode], ["楼层", levelName(manualMeasurement.levelId, nodes)], ["起点吸附", manualMeasurement.start.kind], ["终点吸附", manualMeasurement.end.kind]]} />; }
  if (dimension) return <InspectorSection title="外围尺寸" rows={[["数值", formatMeasurement(dimension.valueMeters, measurementUnit)], ["标注层", dimension.dimensionLayer], ["楼层", levelName(dimension.levelId, nodes)], ["来源墙体", String(dimension.sourceWallIds.length)], ["来源洞口", String(dimension.sourceOpeningIds.length)]]} />;
  if (!node) return null;
  if (node.type === "item") return <ItemInspector node={node} nodes={nodes} unit={measurementUnit} />;
  if (node.type === "shelf") {
    const shelf = resolveShelfData(node);
    return <InspectorSection title={node.name || "Shelf"} node={node} rows={baseNodeRows(node, nodes).concat([["尺寸 W/D/H", `${formatPanelLength(shelf.width, measurementUnit)} / ${formatPanelLength(shelf.depth, measurementUnit)} / ${formatPanelLength(shelf.height, measurementUnit)}`], ["分格", `${shelf.rows} 行 × ${shelf.columns} 列`], ["样式", shelf.style], ["子 Item", String((node.children ?? []).length)]])} />;
  }
  if (node.type === "slab") {
    const geometry = buildSlabPlanGeometry(node), audit = coverage.entries.find((entry) => entry.nodeId === node.id);
    return <InspectorSection title={node.name || "Slab（楼地面）"} node={node} rows={baseNodeRows(node, nodes).concat([["净面积", geometry ? formatArea(geometry.netArea, measurementUnit) : "未解析"], ["标高", formatPanelLength(node.elevation ?? .05, measurementUnit)], ["轮廓 / 洞", `${node.polygon?.length ?? 0} / ${node.holes?.length ?? 0}`], ["渲染状态", audit?.actualRenderStatus ?? "—"]])} />;
  }
  return <GenericNodeInspector node={node} nodes={nodes} unit={measurementUnit} />;
}
function levelName(levelId: string | undefined, nodes: Record<string, NodeData>) { return levelId ? nodes[levelId]?.name || levelId : "未确定"; }
function baseNodeRows(node: NodeData, nodes: Record<string, NodeData>): Array<[string, string]> { const ancestor = resolveAncestorLevelId(node.id, nodes); return [["类型", node.type], ["所属楼层", levelName(ancestor.levelId, nodes)], ["父节点", node.parentId ? nodes[node.parentId]?.name || nodes[node.parentId]?.type || node.parentId : "—"]]; }
function InspectorSection({ title, rows, node }: { title: string; rows: Array<[string, string]>; node?: NodeData }) { return <section className="side-section inspector"><h2>{title}</h2><dl>{rows.map(([label, value]) => <React.Fragment key={label}><dt>{label}</dt><dd>{value}</dd></React.Fragment>)}</dl>{node && <details><summary>原始 JSON</summary><pre>{JSON.stringify(node, null, 2)}</pre></details>}</section>; }
function ItemInspector({ node, nodes, unit }: { node: NodeData; nodes: Record<string, NodeData>; unit: MeasurementUnit }) {
  const dimensions = finalDimensions(node), transform = resolveItemPlanTransform(node.id, nodes), imageUrl = node.asset?.floorPlanUrl as string | undefined, cropEntry = useFloorplanImageCrop(imageUrl), placement = dimensions && cropEntry && !cropEntry.isFallback && cropEntry.cropWidth > 0 && cropEntry.cropHeight > 0 ? computeCropPlacement({ x: cropEntry.cropX, y: cropEntry.cropY, width: cropEntry.cropWidth, height: cropEntry.cropHeight }, dimensions.width, dimensions.depth) : null;
  const imageStatus = !imageUrl ? "无平面图图片" : !cropEntry ? "图片加载中" : cropEntry.isFallback ? `整图回退：${cropEntry.fallbackReason}` : "已加载并裁剪";
  return <InspectorSection title={node.name || node.asset?.name || "家具"} node={node} rows={baseNodeRows(node, nodes).concat([["尺寸 W/H/D", dimensions ? `${formatPanelLength(dimensions.width, unit)} / ${formatPanelLength(dimensions.height, unit)} / ${formatPanelLength(dimensions.depth, unit)}` : "无效"], ["朝向", transform.status === "ok" ? `${normalizeDegrees(transform.rotationY)}°` : "未解析"], ["平面图", imageStatus], ["图片贴合", placement ? "四边贴合" : "—"]])} />;
}
function GenericNodeInspector({ node, nodes, unit }: { node: NodeData; nodes: Record<string, NodeData>; unit: MeasurementUnit }) {
  const rows = baseNodeRows(node, nodes);
  if (node.type === "level") rows.splice(1, 0, ["名称", node.name || "未命名"], ["子节点", String(Object.values(nodes).filter((candidate) => candidate.parentId === node.id).length)]);
  if (node.type === "wall") { const length = Array.isArray(node.start) && Array.isArray(node.end) ? Math.hypot(node.end[0] - node.start[0], node.end[1] - node.start[1]) : null; rows.push(["长度", length === null ? "未解析" : formatPanelLength(length, unit)], ["墙厚", formatPanelLength(node.thickness ?? .1, unit)], ["几何", Number.isFinite(node.curveOffset) && node.curveOffset !== 0 ? "曲墙" : "直墙"]); }
  if (node.type === "door" || node.type === "window") rows.push(["宿主墙", node.wallId ? nodes[node.wallId]?.name || "墙体" : "未关联"], ["尺寸 W/H", `${formatPanelLength(node.width ?? .9, unit)} / ${formatPanelLength(node.height ?? 2, unit)}`], ["类型", node.type === "door" ? node.doorType ?? "hinged" : node.windowType ?? "window"], ["开口", node.openingKind ?? "door/window"]);
  if (node.type === "zone") { const points = zonePoints(node), area = Math.abs(points.reduce((sum, point, index) => { const next = points[(index + 1) % points.length]; return sum + point.x * next.z - point.z * next.x; }, 0) / 2); rows.push(["面积", points.length > 2 ? formatArea(area, unit) : "未解析"], ["轮廓点", String(points.length)]); }
  if (node.type === "stair") rows.push(["楼梯类型", node.stairType ?? "straight"], ["宽度", Number.isFinite(node.width) ? formatPanelLength(node.width, unit) : "—"], ["级数", String(node.stepCount ?? node.steps?.length ?? "—")]);
  return <InspectorSection title={node.name || node.type} node={node} rows={rows} />;
}
function Stats({ nodes }: { nodes: Record<string, NodeData> }) {
  const c = (type: string) =>
    Object.values(nodes).filter((n) => n.type === type).length;
  const shelves = Object.values(nodes).filter((n) => n.type === "shelf"), invalidShelves = shelves.filter((s) => !hasValidShelfFootprint(s)), parentIssueShelves = shelves.filter((s) => resolveShelfPlanTransform(s.id, nodes).status === 'error'), styles = shelves.reduce<Record<string, number>>((counts, shelf) => { const style = resolveShelfData(shelf).style; counts[style] = (counts[style] || 0) + 1; return counts; }, {});
  return (
    <section className="side-section">
      <h2>文件统计</h2>
      <div className="stat-grid">
        <span>
          节点<b>{Object.keys(nodes).length}</b>
        </span>
        <span>
          Level<b>{c("level")}</b>
        </span>
        <span>
          Wall<b>{c("wall")}</b>
        </span>
        <span>
          Item<b>{c("item")}</b>
        </span>
        <span>Stair<b>{c("stair")}</b></span>
        <span>Shelf<b>{shelves.length}</b></span>
        <span>无效 Shelf<b>{invalidShelves.length}</b></span>
        <span>父级异常 Shelf<b>{parentIssueShelves.length}</b></span>
        {Object.entries(styles).map(([style, count]) => <span key={style}>{style}<b>{count}</b></span>)}
      </div>
    </section>
  );
}
const evaluationStatusLabel: Record<RuleStatus, string> = { pass: "通过", issue: "存在问题", unable_to_determine: "无法判断", not_applicable: "不适用" };
const evaluationOriginLabel = { source_data: "源数据", parser: "解析", handoff: "交接映射", rule: "评价规则", geometry_tolerance: "几何容差", insufficient_information: "信息不足" };
const evaluationValue = (value: unknown) => value === null || value === undefined ? "—" : typeof value === "string" ? value : String(value);
const displayEvaluationNumber = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? Number(value.toFixed(2)).toString() : null;
const displayEvaluationMetric = (value: unknown, unit?: string) => {
  const formatted = displayEvaluationNumber(value);
  if (formatted === null || !unit || Math.abs(value as number) < .001) return null;
  const displayUnit = ({ count: "项", meter: "m", "square-meter": "m²" } as Record<string, string>)[unit] ?? unit;
  return `${formatted} ${displayUnit}`;
};
type EvaluationGroup = "all" | "G1" | "G2" | "G3" | "G4";
const evaluationGroupLabel: Record<EvaluationGroup, string> = { all: "全部", G1: "G1 基础成图", G2: "G2 技术安全", G3: "G3 功能使用", G4: "G4 客户需求" };
function EvaluationPanel({ report, nodes, roomAnalysis, error, requirementError, requirementFile, hasRequirements, focusMessage, activeHighlight, selectedGroup, g2ProjectUse, g2Jurisdiction, runState, disabled, onRun, onContinueFull, onGroupChange, onG2ProjectUseChange, onG2JurisdictionChange, onUseBellevueRequirements, onDisableRequirements, onLoadRequirementFile, onFocus, onRegisterRule }: { report: EvaluationReport | null; nodes: Record<string, NodeData>; roomAnalysis: RoomRegionAnalysis | null; error: string | null; requirementError: string | null; requirementFile: string; hasRequirements: boolean; focusMessage: string | null; activeHighlight: EvaluationHighlight | null; selectedGroup: EvaluationGroup; g2ProjectUse: G2ProjectUseSelection; g2Jurisdiction: G2JurisdictionSelection; runState: EvaluationRunState; disabled: boolean; onRun: () => void; onContinueFull: () => void; onGroupChange: (group: EvaluationGroup) => void; onG2ProjectUseChange: (value: G2ProjectUseSelection) => void; onG2JurisdictionChange: (value: G2JurisdictionSelection) => void; onUseBellevueRequirements: () => void; onDisableRequirements: () => void; onLoadRequirementFile: (file: File) => void; onFocus: (ruleId: string, target: EvaluationFocusTarget, targetIndex: number) => void; onRegisterRule: (ruleId: string, element: HTMLElement | null) => void }) {
  const requirementInput = useRef<HTMLInputElement>(null);
  const orderedRules = report ? ["G4-", "G1-", "G2-", "G3-"].flatMap((prefix) => orderEvaluationRulesForDisplay(report.rules.filter((rule) => rule.ruleId.startsWith(prefix)))) : [];
  const visibleRules = orderedRules.filter((rule) => (selectedGroup === "all" || rule.ruleId.startsWith(`${selectedGroup}-`)) && !isDependencyOnlyTechnicalRule(rule));
  const groupCounts = (group: EvaluationGroup) => group === "all" ? report?.counts : Object.fromEntries((Object.keys(evaluationStatusLabel) as RuleStatus[]).map((status) => [status, report?.rules.filter((rule) => rule.ruleId.startsWith(`${group}-`) && rule.status === status).length ?? 0])) as Record<RuleStatus, number>;
  const selectedCounts = groupCounts(selectedGroup);
  const unifiedReport = report ? buildUnifiedEvaluationReport(report) : null;
  const groupOptions = (Object.keys(evaluationGroupLabel) as EvaluationGroup[]).filter((group) => group === "all" || reportHasSourceGroup(unifiedReport, group));
  const selectedStatusLabel = selectedGroup === "G4" ? { pass: "已满足", issue: "未满足客户需求", unable_to_determine: "需要人工检查", not_applicable: "不适用" } : evaluationStatusLabel;
  const selectedTotal = selectedCounts ? Object.values(selectedCounts).reduce((sum, count) => sum + count, 0) : 0;
  const selectedIssue = selectedCounts?.issue ?? 0, selectedUnable = selectedCounts?.unable_to_determine ?? 0, selectedPass = selectedCounts?.pass ?? 0, selectedNotApplicable = selectedCounts?.not_applicable ?? 0;
  const issueAngle = selectedTotal ? selectedIssue / selectedTotal * 360 : 0, unableAngle = issueAngle + (selectedTotal ? selectedUnable / selectedTotal * 360 : 0), passAngle = unableAngle + (selectedTotal ? selectedPass / selectedTotal * 360 : 0);
  const overviewBackground = selectedTotal ? `conic-gradient(#d96354 0deg ${issueAngle}deg, #d99b36 ${issueAngle}deg ${unableAngle}deg, #4b9a68 ${unableAngle}deg ${passAngle}deg, #aaa39a ${passAngle}deg 360deg)` : "#ece5da";
  const requirementGateBlocked = report?.scope === "G4-requirements";
  const projectUseLabel = G2_PROJECT_USE_OPTIONS.find((option) => option.value === g2ProjectUse)?.label ?? g2ProjectUse;
  const jurisdictionLabel = G2_JURISDICTION_OPTIONS.find((option) => option.value === g2Jurisdiction)?.label ?? g2Jurisdiction;
  return (
    <section className={`side-section evaluation-panel group-${selectedGroup}`}>
      <div className="side-heading"><h2>方案检查</h2><button className="primary evaluation-run-button" aria-busy={runState.running} disabled={disabled || runState.running} onClick={onRun}>{runState.running && <i className="evaluation-spinner" aria-hidden="true" />}{runState.running ? `检查中 ${runState.progress}%` : report ? "重新检查" : "开始检查"}</button></div>
      {runState.running && <div className="evaluation-run-progress" role="status" aria-live="polite"><div><i style={{ width: `${runState.progress}%` }} /></div><span>{runState.label}，请稍候…</span></div>}
      <details className="evaluation-settings" open={!report}>
        <summary>检查设置 <span>{projectUseLabel} · {jurisdictionLabel}</span></summary>
        <div className="requirement-input" aria-label="客户需求输入">
          <div><b>客户需求</b><span>{requirementFile}</span></div>
          <div>
            {import.meta.env.DEV && <button onClick={onUseBellevueRequirements}>使用 Bellevue Demo 需求</button>}
            <button onClick={() => requirementInput.current?.click()}>上传客户需求</button>
            <button onClick={onDisableRequirements}>不检查客户需求</button>
          </div>
          <input ref={requirementInput} hidden type="file" accept=".json,application/json" onChange={(event) => { const selected = event.target.files?.[0]; if (selected) onLoadRequirementFile(selected); event.currentTarget.value = ""; }} />
        </div>
        <div className="g2-evaluation-profile" aria-label="G2 评价配置">
          <label>项目类型<select value={g2ProjectUse} onChange={(event) => onG2ProjectUseChange(event.target.value as G2ProjectUseSelection)}>{G2_PROJECT_USE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label>法规地区<select value={g2Jurisdiction} onChange={(event) => onG2JurisdictionChange(event.target.value as G2JurisdictionSelection)}>{G2_JURISDICTION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        </div>
      </details>
      {error && <div className="evaluation-error"><b>评价失败</b><span>{error}</span></div>}
      {requirementError && <div className="evaluation-error requirement-error"><b>客户需求未加载</b><span>{requirementError}</span><small>仍可继续运行 G1、G2、G3。</small></div>}
      {requirementGateBlocked && <div className="evaluation-error requirement-error"><b>客户需求需要确认</b><span>基础检查尚未自动运行。</span><button disabled={runState.running} onClick={onContinueFull}>继续检查基础方案</button></div>}
      {focusMessage && <div className="evaluation-focus-message">{focusMessage}</div>}
      {!report && !error && <p>解析完成后手动运行；评价不会随画布变化自动重复。</p>}
      {report && <>
        <div className="evaluation-group-tabs" role="tablist" aria-label="评价分组">
          {groupOptions.map((group) => <button key={group} className={selectedGroup === group ? "active" : undefined} role="tab" aria-selected={selectedGroup === group} onClick={() => onGroupChange(group)}>{evaluationGroupLabel[group]}</button>)}
        </div>
        <div className="evaluation-overview">
          <div className="evaluation-donut" style={{ background: overviewBackground }}><div><b>{selectedIssue + selectedUnable}</b><span>需要关注</span></div></div>
          <div className="evaluation-overview-legend">
            <span className="status-issue"><i />{selectedStatusLabel.issue}<b>{selectedIssue}</b></span>
            <span className="status-unable"><i />{selectedStatusLabel.unable_to_determine}<b>{selectedUnable}</b></span>
            <span className="status-pass"><i />{selectedStatusLabel.pass}<b>{selectedPass}</b></span>
            <span className="status-na"><i />{selectedStatusLabel.not_applicable}<b>{selectedNotApplicable}</b></span>
          </div>
        </div>
        <p className="evaluation-complete">{selectedIssue}项需要处理 · {selectedUnable}项待补信息</p>
        {false ? <div className="evaluation-rules">
          {visibleRules.map((item) => { const presentation = designerRulePresentation(item, nodes, roomAnalysis), locations = [...new Set(presentation.targets.map((target) => target.levelName))], activeIndex = activeHighlight?.ruleId === item.ruleId ? activeHighlight.targetIndex : 0, targetIndex = Math.min(activeIndex, Math.max(0, presentation.targets.length - 1)), target = presentation.targets[targetIndex], isActive = activeHighlight?.ruleId === item.ruleId, activateCard = (event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) => { if (!target) return; const element = event.target as Element; if (element.closest("button, details, summary, a, input, select")) return; if ("key" in event && event.key !== "Enter" && event.key !== " ") return; event.preventDefault(); onFocus(item.ruleId, target, targetIndex); }; return <article key={item.ruleId} ref={(element) => onRegisterRule(item.ruleId, element)} className={`evaluation-rule status-${item.status}${isActive ? " active-evaluation-rule" : ""}${target ? " is-focusable" : ""}`} role={target ? "button" : undefined} tabIndex={target ? 0 : undefined} onClick={activateCard} onKeyDown={activateCard}>
            <details className="evaluation-rule-content" open={item.status !== "pass"}>
              <summary className="evaluation-rule-heading"><div><code>{item.ruleId}</code><strong>{presentation.title}</strong></div><em>{evaluationStatusLabel[item.status]}</em></summary>
              <p>{presentation.description}</p>
              <div className="designer-guidance"><span><b>为什么要处理</b>{presentation.rationale}</span><span><b>建议</b>{presentation.recommendation}</span>{presentation.supplemental && <span className="supplemental">{presentation.supplemental}</span>}</div>
              <div className="evaluation-card-meta"><span>{item.status === "unable_to_determine" ? "待核验数量" : "问题数量"} <b>{presentation.problemCountLabel}</b></span><span>所在楼层 <b>{locations.length ? locations.join("、") : "—"}</b></span></div>
              {target && <div className="evaluation-object-nav">
              <span className="evaluation-object-label">{target.label}</span>
              <div><button disabled={targetIndex === 0} aria-label={`${presentation.title} 上一处`} onClick={() => onFocus(item.ruleId, presentation.targets[targetIndex - 1]!, targetIndex - 1)}>上一处</button><b>{targetIndex + 1} / {presentation.targets.length}</b><button disabled={targetIndex >= presentation.targets.length - 1} aria-label={`${presentation.title} 下一处`} onClick={() => onFocus(item.ruleId, presentation.targets[targetIndex + 1]!, targetIndex + 1)}>下一处</button></div>
              <button className="view-on-canvas" onClick={() => onFocus(item.ruleId, target, targetIndex)}>在图中查看</button>
              </div>}
              <details>
              <summary>技术明细</summary>
              <small><b>规则</b>{item.ruleId} · {item.ruleName}</small>
              {item.normalizedObjectIds.length > 0 && <small><b>标准化 ID</b>{item.normalizedObjectIds.join(", ")}</small>}
              {item.pascalSourceIds.length > 0 && <small><b>Pascal ID</b>{item.pascalSourceIds.join(", ")}</small>}
              {item.missingData.length > 0 && <small><b>缺失数据</b>{item.missingData.join("；")}</small>}
              {item.regulation && <small><b>法规依据</b>{item.regulation.codeName} · {item.regulation.section} · {item.regulation.jurisdiction} · {item.regulation.codeVersion}</small>}
              {item.applicability && <small><b>规则适用性</b>{item.applicability.status}{item.applicability.reasons.length ? ` · ${item.applicability.reasons.join("；")}` : ""}</small>}
              {item.dataSufficiency && <small><b>数据充分性</b>{item.dataSufficiency.status}{item.dataSufficiency.missingFields.length ? ` · ${item.dataSufficiency.missingFields.join("；")}` : ""}</small>}
              <small><b>置信度</b>{item.confidence.level} ({item.confidence.score}){item.confidence.reasons.length ? ` · ${item.confidence.reasons.join("；")}` : ""}</small>
              {item.diagnostics.length > 0 && <small><b>原始字段与诊断</b>{item.diagnostics.map((diagnostic) => `${diagnostic.field ?? diagnostic.code}: 实际=${evaluationValue(diagnostic.actualValue)}；要求=${diagnostic.expectedValue ?? "—"}；来源=${diagnostic.origin ? evaluationOriginLabel[diagnostic.origin] : "—"}；${diagnostic.message}`).join("；")}</small>}
              {item.measurements.length > 0 && <small><b>测量值</b>{item.measurements.map((measurement) => `${measurement.normalizedObjectId ? `${measurement.normalizedObjectId}.` : ""}${measurement.name}=${evaluationValue(measurement.value)}${measurement.unit ? ` ${measurement.unit}` : ""}`).join("；")}</small>}
              {item.thresholds.length > 0 && <small><b>阈值/容差</b>{item.thresholds.map((threshold) => `${threshold.name}=${evaluationValue(threshold.value)}${threshold.unit ? ` ${threshold.unit}` : ""}`).join("；")}</small>}
              </details>
            </details>
          </article>; })}
        </div> : <UnifiedReportPanel report={unifiedReport!} selectedGroup={selectedGroup} nodes={nodes} roomAnalysis={roomAnalysis} activeHighlight={activeHighlight} onFocus={onFocus} onRegisterRule={onRegisterRule} />}
      </>}
    </section>
  );
}

function UnifiedReportPanel({ report, selectedGroup, nodes, roomAnalysis, activeHighlight, onFocus, onRegisterRule }: { report: ReturnType<typeof buildUnifiedEvaluationReport>; selectedGroup: EvaluationGroup; nodes: Record<string, NodeData>; roomAnalysis: RoomRegionAnalysis | null; activeHighlight: EvaluationHighlight | null; onFocus: (ruleId: string, target: EvaluationFocusTarget, targetIndex: number) => void; onRegisterRule: (ruleId: string, element: HTMLElement | null) => void }) {
  const presentation = (finding: Finding) => designerRulePresentation(finding.rawRuleResult, nodes, roomAnalysis);
  const findings = visibleReportFindings(report, { groups: selectedGroup === "all" ? undefined : [selectedGroup] }).sort(compareFindingsForDisplay);
  const mainFindings = findings.filter((finding) => finding.status === "issue" || finding.status === "unable_to_determine");
  const passed = findings.filter((finding) => finding.status === "pass"), notApplicable = findings.filter((finding) => finding.status === "not_applicable");
  return <div className="unified-report">
    <div className="unified-findings">{mainFindings.map((finding) => <UnifiedFindingCard key={finding.findingId} finding={finding} presentation={presentation(finding)} activeHighlight={activeHighlight} onFocus={onFocus} onRegisterRule={onRegisterRule} />)}</div>
    <details className="passed-findings"><summary>已通过检查 {passed.length}项</summary>{passed.map((finding) => <UnifiedFindingCard key={finding.findingId} finding={finding} presentation={presentation(finding)} activeHighlight={activeHighlight} onFocus={onFocus} onRegisterRule={onRegisterRule} />)}</details>
    <details className="passed-findings"><summary>不适用检查 {notApplicable.length}项</summary>{notApplicable.map((finding) => <UnifiedFindingCard key={finding.findingId} finding={finding} presentation={presentation(finding)} activeHighlight={activeHighlight} onFocus={onFocus} onRegisterRule={onRegisterRule} />)}</details>
  </div>;
}

function UnifiedFindingCard({ finding, presentation, activeHighlight, onFocus, onRegisterRule }: { finding: Finding; presentation: ReturnType<typeof designerRulePresentation>; activeHighlight: EvaluationHighlight | null; onFocus: (ruleId: string, target: EvaluationFocusTarget, targetIndex: number) => void; onRegisterRule: (ruleId: string, element: HTMLElement | null) => void }) {
  const isActive = activeHighlight?.ruleId === finding.ruleId, targetIndex = isActive ? Math.min(activeHighlight.targetIndex, Math.max(0, presentation.targets.length - 1)) : 0, target = presentation.targets[targetIndex], locations = [...new Set(presentation.targets.map((item) => item.levelName))], metric = finding.technicalDetails.measurements[0], measured = displayEvaluationMetric(finding.measuredValue, metric?.unit), threshold = finding.threshold ? displayEvaluationMetric(finding.threshold.value, finding.threshold.unit) : null, margin = metric?.unit ? displayEvaluationMetric(finding.margin, metric.unit) : null, cardProps = { ref: (element: HTMLElement | null) => onRegisterRule(finding.ruleId, element), "data-evaluation-rule-id": finding.ruleId, className: `unified-finding status-${finding.status}${isActive ? " active-unified-finding" : ""}` };
  if (finding.customerRequirement) {
    const requirement = finding.customerRequirement, statusLabel = finding.status === "pass" ? "已满足" : finding.status === "issue" ? "未满足客户需求" : "需要人工检查";
    return <article {...cardProps} className={`${cardProps.className} g4-finding`}><div className="unified-finding-heading"><strong>{presentation.title}</strong><em className={`finding-status status-${finding.status}`}>{statusLabel}</em></div>{target && <span className="finding-location">{target.label}</span>}<dl className="g4-result"><dt>目标要求</dt><dd>{requirement.targetDescription}</dd><dt>方案实际</dt><dd>{requirement.actualResult}</dd><dt>{finding.status === "unable_to_determine" ? "人工检查原因" : finding.status === "issue" ? "未满足原因" : "判断依据"}</dt><dd>{requirement.reason}</dd></dl>{target && <button className="view-on-canvas" onClick={() => onFocus(finding.ruleId, target, targetIndex)}>在图中查看</button>}<details><summary>查看详情</summary><small><b>规则</b>{finding.sourceGroup} · {finding.ruleId}</small>{requirement.originalDescription && <small><b>原始需求说明</b>{requirement.originalDescription}</small>}<small><b>需求类型</b>{requirement.requirementType}</small><small><b>measurementBasis</b>{finding.measurementBasis ?? "—"}</small><small><b>confidence</b>{finding.confidence.level} ({finding.confidence.score})</small>{finding.assumptions.length > 0 && <small><b>assumptions</b>{finding.assumptions.join("；")}</small>}{finding.missingData.length > 0 && <small><b>missingData</b>{finding.missingData.join("；")}</small>}{finding.dependencyRuleIds.length > 0 && <small><b>相关规则和依赖</b>{finding.dependencyRuleIds.join("；")}</small>}<small><b>原始 RuleResult</b>{finding.rawRuleResult.ruleName} · 对象 {finding.primaryObjectIds.concat(finding.relatedObjectIds).join(", ") || "—"}</small><small><b>技术测量数据</b>{finding.technicalDetails.measurements.map((measurement) => `${measurement.name}=${evaluationValue(measurement.value)}${measurement.unit ? ` ${measurement.unit}` : ""}`).join("；") || "—"}</small></details></article>;
  }
  return <article {...cardProps}><div className="unified-finding-heading"><strong>{presentation.title}</strong><em className={`finding-status status-${finding.status}`}>{evaluationStatusLabel[finding.rawRuleResult.status]}</em></div><span className="finding-location">{target?.label ?? (locations.length ? locations.join("、") : "楼层未确定")}</span><p>{finding.userSummary}</p>{(measured || threshold || margin !== null) && <div className="unified-metrics">{measured && <span>实测 {measured}</span>}{threshold && <span>要求 {threshold}</span>}{margin !== null && <span>余量 {margin}</span>}</div>}<span><b>{finding.status === "unable_to_determine" ? "补数建议：" : "修改建议："}</b>{presentation.recommendation}</span>{presentation.targets.length > 1 && <div className="finding-target-nav"><button disabled={targetIndex === 0} onClick={() => onFocus(finding.ruleId, presentation.targets[targetIndex - 1]!, targetIndex - 1)}>上一处</button><small className="finding-target-position">当前定位 {targetIndex + 1} / {presentation.targets.length}{target ? ` · ${target.label}` : ""}</small><button disabled={targetIndex >= presentation.targets.length - 1} onClick={() => onFocus(finding.ruleId, presentation.targets[targetIndex + 1]!, targetIndex + 1)}>下一处</button></div>}{target && <button className="view-on-canvas" onClick={() => onFocus(finding.ruleId, target, targetIndex)}>在图中查看</button>}<details><summary>查看详情</summary><small><b>规则</b>{finding.sourceGroup} · {finding.ruleId}</small><small><b>measurementBasis</b>{finding.measurementBasis ?? "—"}</small><small><b>confidence</b>{finding.confidence.level} ({finding.confidence.score})</small>{finding.assumptions.length > 0 && <small><b>assumptions</b>{finding.assumptions.join("；")}</small>}{finding.missingData.length > 0 && <small><b>missingData</b>{finding.missingData.join("；")}</small>}{finding.dependencyRuleIds.length > 0 && <small><b>相关规则和依赖</b>{finding.dependencyRuleIds.join("；")}</small>}<small><b>原始 RuleResult</b>{finding.rawRuleResult.ruleName} · 对象 {finding.primaryObjectIds.concat(finding.relatedObjectIds).join(", ") || "—"}</small><small><b>技术测量数据</b>{finding.technicalDetails.measurements.map((measurement) => `${measurement.name}=${evaluationValue(measurement.value)}${measurement.unit ? ` ${measurement.unit}` : ""}`).join("；") || "—"}</small></details></article>;
}

const s1RelationLabel = { same_open_space: "位于同一开放空间", direct_connection: "直接连接", one_intermediate_space: "需要经过 1 个空间", multiple_intermediate_spaces: "需要经过多个空间", different_level: "位于不同楼层" } as const;

function S1Radar({ aggregate }: { aggregate: S1AggregateReport }) {
  const center = 110, radius = 64, axes = aggregate.axes, pointAt = (index: number, value: number) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / axes.length, scaled = radius * value / 100;
    return [center + Math.cos(angle) * scaled, center + Math.sin(angle) * scaled] as const;
  }, outer = axes.map((_, index) => pointAt(index, 100).join(",")).join(" "), scores = axes.every((axis) => axis.status === "scored" && axis.score !== null), result = scores ? axes.map((axis, index) => pointAt(index, axis.score!).join(",")).join(" ") : null, centerLabel = aggregate.score === null ? "暂无法评分" : aggregate.score.toFixed(1), axisLabel = (index: number) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / axes.length, labelRadius = radius + 18, x = center + Math.cos(angle) * labelRadius, y = center + Math.sin(angle) * labelRadius;
    return { x, y, textAnchor: Math.abs(Math.cos(angle)) < .25 ? "middle" : Math.cos(angle) > 0 ? "start" : "end" } as const;
  };
  return <div className="s1-radar" role="img" aria-label={`S1 五轴雷达图，总分 ${centerLabel}`}>
    <svg viewBox="-18 -18 256 256"><polygon points={outer} className="s1-radar-grid" />{[25, 50, 75].map((value) => <polygon key={value} points={axes.map((_, index) => pointAt(index, value).join(",")).join(" ")} className="s1-radar-grid" />)}{axes.map((_, index) => <line key={index} x1={center} y1={center} x2={pointAt(index, 100)[0]} y2={pointAt(index, 100)[1]} className="s1-radar-axis" />)}{result && <polygon points={result} className="s1-radar-result" />}{axes.map((axis, index) => axis.status === "scored" && axis.score !== null ? <circle key={axis.axisId} cx={pointAt(index, axis.score)[0]} cy={pointAt(index, axis.score)[1]} r="3" className="s1-radar-point" /> : null)}{axes.map((axis, index) => { const label = axisLabel(index); return <text key={axis.axisId} x={label.x} y={label.y} textAnchor={label.textAnchor} dominantBaseline="middle" className="s1-radar-axis-label">{axis.name}</text>; })}<text x={center} y="104" textAnchor="middle" className="s1-radar-score">{centerLabel}</text><text x={center} y="123" textAnchor="middle" className="s1-radar-unit">/ 100</text></svg>
  </div>;
}

function S1Panel({ gate, report, runState, error, onRun, onFocusHighFrequencyPath, onFocusActivityZoning, onFocusUtilization, onFocusObjectEvidence }: { gate: S1GateResult | null; report: S1UiReport | null; runState: EvaluationRunState; error: string | null; onRun: () => void; onFocusHighFrequencyPath: (measurement: S1HighFrequencyPathMeasurement, targetIndex: number) => void; onFocusActivityZoning: (measurement: S1Dz01Measurement | S1Dz02Measurement) => void; onFocusUtilization: (measurement: S1SpaceUtilizationReport["ly02"]["measurements"][number]) => void; onFocusObjectEvidence: (ruleId: string, primaryId: string, relatedIds: string[], label: string) => void }) {
  const blocked = Boolean(gate && !gate.allowed), scoring = report?.highFrequencyPathEfficiencyScoring, hpe = report?.highFrequencyPathEfficiency, organization = report?.spaceOrganization, zoning = report?.activityZoning, utilization = report?.spaceUtilization, storage = report?.storageConfiguration, aggregate = report?.aggregate;
  const scoreLabel = (score: number | null, status: "scored" | "not_applicable" | "unable_to_determine") => score === null ? status === "not_applicable" ? "不适用" : "暂无法评分" : `${score.toFixed(1)} / 100`;
  const affectedQuietRoute = zoning?.dz01.measurements.find((item) => item.result === "quiet_mandatory");
  if (!gate?.allowed && !report && !runState.running && !error) return null;
  return <section className="side-section s1-panel">
    <div className="side-heading"><div><h2>住宅设计表现</h2></div><button className="primary evaluation-run-button" aria-busy={runState.running} disabled={!gate?.allowed || runState.running} onClick={onRun}>{runState.running && <i className="evaluation-spinner" aria-hidden="true" />}{runState.running ? `评分中 ${runState.progress}%` : report ? "重新评分" : "开始评分"}</button></div>
    {blocked && <div className="s1-gate status-blocked"><b>设计表现暂不可评价</b><span>请先处理方案检查中的问题。</span></div>}
    {gate?.allowed && !report && !runState.running && <div className="s1-gate status-ready"><b>可以开始评分</b><span>将评价空间组织、动静分区、空间利用、收纳配置及高频日常路线。</span></div>}
    {runState.running && <div className="evaluation-run-progress" role="status" aria-live="polite"><div><span>{runState.label}</span><strong>{runState.progress}%</strong></div><progress max="100" value={runState.progress} /></div>}
    {error && <div className="evaluation-error"><b>评分未完成</b><span>{error}</span></div>}
    {aggregate && <section className="s1-metric-section s1-total-report">
      <S1Radar aggregate={aggregate} />
    </section>}
    <div className="s1-axis-details">
    {organization && <details>
      <summary><span>空间组织</span><strong>{scoreLabel(organization.score, organization.status)}</strong></summary>
      <p>厨房、卧室与入户的空间关系。</p>
      <div className="s1-route-groups">{organization.rules.map((rule) => <article key={rule.ruleId}><b>{rule.ruleName}</b><span>{scoreLabel(rule.score, rule.status)}</span><small>{rule.explanation}</small></article>)}</div>
      {organization.entrySequence.status === "scored" && <article className="s1-relationship-card s1-route-card"><b>{organization.entrySequence.entranceKind === "garage_origin" ? "车库归家入口" : "住宅主要入口"}</b><p>{organization.entrySequence.spaceFunctionNamesByRoom.map((names, index) => { const codes = organization.entrySequence.spaceFunctionCodesByRoom[index] ?? [], publicNames = names.filter((_, nameIndex) => codes[nameIndex] === "SF06" || codes[nameIndex] === "SF07"); return (publicNames.length ? publicNames : names).join(" / ") || organization.entrySequence.roomRegionIds[index]; }).join(" → ")}</p>{organization.entrySequence.zoneIdsByRoom.flat()[0] && <button className="view-on-canvas" onClick={() => { const zoneIds = organization.entrySequence.zoneIdsByRoom.flat(); onFocusObjectEvidence("S1-SO-03", zoneIds[0]!, zoneIds.slice(1), "主要入户序列"); }}>在图中查看</button>}</article>}
    </details>}
    {zoning && <details>
      <summary><span>动静分区</span><strong>{scoreLabel(zoning.score, zoning.status)}</strong></summary>
      <p>日常活动是否干扰安静休息区域，以及静区入口是否有缓冲。</p>
      <div className="s1-route-groups"><article><b>动线扰静</b><span>{scoreLabel(zoning.dz01.score, zoning.dz01.status)}</span><small>{zoning.dz01.affectedCount ? `${zoning.dz01.affectedCount} 个活动空间前往公共核心时会经过安静区域。` : "前往公共核心的活动路线可避开安静区域。"}</small>{affectedQuietRoute?.space && <button className="view-on-canvas" onClick={() => onFocusActivityZoning(affectedQuietRoute)}>在图中查看</button>}</article><article><b>静区缓冲</b><span>{scoreLabel(zoning.dz02.score, zoning.dz02.status)}</span><small>评价安静区域入口与公共活动区域之间的缓冲关系。</small></article></div>
    </details>}
    {utilization && <details>
      <summary><span>空间利用</span><strong>{scoreLabel(utilization.score, utilization.status)}</strong></summary>
      <p>走道占用与明显不规则空间。</p>
      <div className="s1-route-groups"><article><b>走道占用</b><span>{scoreLabel(utilization.ly01.score, utilization.ly01.status)}</span><small>走道占住宅室内面积 {utilization.ly01.corridorRatio === null ? "—" : `${(utilization.ly01.corridorRatio * 100).toFixed(1)}%`}。</small>{utilization.ly01.corridorZoneIds[0] && <button className="view-on-canvas" onClick={() => onFocusObjectEvidence("S1-LY-01", utilization.ly01.corridorZoneIds[0]!, utilization.ly01.corridorZoneIds.slice(1), "走道区域")}>在图中查看</button>}</article><article><b>空间形状</b><span>{scoreLabel(utilization.ly02.score, utilization.ly02.status)}</span><small>{utilization.ly02.measurements.filter((item) => item.status === "inefficient_shape").length ? "存在需要关注的空间形状。" : "未发现明显不规则空间。"}</small></article></div>
      {utilization.ly02.measurements.filter((item) => item.status === "inefficient_shape").map((item) => <article key={item.zoneId} className="s1-relationship-card"><b>{item.zoneName}</b><span>需要关注的空间形状</span><button className="view-on-canvas" onClick={() => onFocusUtilization(item)}>在图中查看</button></article>)}
    </details>}
    {storage && <details>
      <summary><span>收纳配置</span><strong>{scoreLabel(storage.score, storage.status)}</strong></summary>
      <p>按家具外廓尺寸估算的收纳支持，不代表实际净容积。</p>
      <div className="s1-route-groups"><article><b>卧室收纳</b><span>{scoreLabel(storage.sn01.score, storage.sn01.status)}</span><small>{storage.sn01.bedrooms.length} 间卧室参与评价。</small></article><article><b>厨房 / 食品收纳</b><span>{scoreLabel(storage.sn02.score, storage.sn02.status)}</span><small>估算收纳体积 {storage.sn02.kitchenSystems.reduce((total, system) => total + (system.totalStorageVolumeCubicMeters ?? 0), 0).toFixed(1)} m³。</small></article><article><b>归家收纳</b><span>{scoreLabel(storage.sn03.score, storage.sn03.status)}</span><small>估算收纳体积 {storage.sn03.grossStorageVolumeCubicMeters?.toFixed(1) ?? "—"} m³。</small></article></div>
    </details>}
    {report && scoring && hpe && <details>
      <summary><span>动线效率</span><strong>{scoreLabel(scoring.score, scoring.status)}</strong></summary>
      <p>归家和卧室日常路线的距离与绕行。</p>
      <div className="s1-route-groups">{scoring.sceneScores.map((scene) => <article key={scene.scene}><b>{scene.label}</b><span>{scoreLabel(scene.score, scene.status)}</span></article>)}</div>
      <div className="s1-relationships">{hpe.measurements.map((route) => {
        const routeScore = scoring.routeScores.find((item) => item.routeId === route.routeId), source = route.source?.zoneNames.join(" / ") || "起点", target = route.target?.zoneNames.join(" / ") || "终点", locatable = route.status === "measured" && route.pathPoints.length > 0;
        return <article key={route.routeId} className={`s1-relationship-card s1-route-card status-${route.status}`}>
          <div className="unified-finding-heading"><strong>{source} → {target}</strong></div>
          {route.status === "measured" ? <dl><dt>实际距离</dt><dd>{route.actualPathLengthMeters?.toFixed(1)} m</dd><dt>绕行程度</dt><dd>{route.detourRatio === null ? "—" : `${route.detourRatio.toFixed(2)} 倍`}</dd><dt>路线得分</dt><dd>{routeScore?.routeScore === null || routeScore?.routeScore === undefined ? "暂无法评分" : `${routeScore.routeScore.toFixed(1)} / 100`}</dd></dl> : <p>{route.status === "not_applicable" ? "本户型不适用这条路线。" : "这条路线暂时无法可靠测量。"}</p>}
          {locatable && <button className="view-on-canvas" onClick={() => onFocusHighFrequencyPath(route, 0)}>在图中查看路线</button>}
        </article>;
      })}</div>
    </details>}
    </div>
  </section>;
}

function LegacyS1Panel({ gate, report, nodes, roomAnalysis, onRun, onFocus, onFocusPublicRoute, onFocusHighFrequencyPath, onFocusPathConflict, onFocusSpaceFragment, onFocusFurnitureUse, onFocusFurnitureRelation }: { gate: S1GateResult | null; report: S1FunctionalRelationshipReport | null; nodes: Record<string, NodeData>; roomAnalysis: RoomRegionAnalysis | null; onRun: () => void; onFocus: (measurement: S1FunctionalRelationshipMeasurement, targetIndex: number) => void; onFocusPublicRoute: (measurement: S1PublicCirculationRouteMeasurement, targetIndex: number) => void; onFocusHighFrequencyPath: (measurement: S1HighFrequencyPathMeasurement, targetIndex: number) => void; onFocusPathConflict: (measurement: S1PathConflictPairMeasurement, levelIndex: number) => void; onFocusSpaceFragment: (measurement: S1SpaceFragmentMeasurement) => void; onFocusFurnitureUse: (measurement: S1FurnitureUseMeasurement) => void; onFocusFurnitureRelation: (measurement: S1FurnitureRelationMeasurement) => void }) {
  const blocked = Boolean(gate && !gate.allowed);
  const blockerGroups = gate ? [...new Set(gate.blockingResults.map((item) => item.ruleId.match(/^(G[1-4])/ )?.[1]).filter(Boolean))].join("、") : "";
  const roomLabel = (roomRegionId: string) => {
    const zoneIds = roomAnalysis?.roomToZoneIds[roomRegionId] ?? [], names = zoneIds.map((id) => nodes[id]?.name?.trim()).filter((name): name is string => Boolean(name));
    return names.join(" / ") || roomRegionId;
  };
  const hpeRouteLabel = (routeId: string) => { const route = report?.highFrequencyPathEfficiency.measurements.find((item) => item.routeId === routeId), source = route?.source?.zoneNames.join(" / ") || route?.sourceRoomRegionId || "—", target = route?.target?.zoneNames.join(" / ") || route?.targetRoomRegionId || "—"; return `${source} → ${target}`; };
  const interactionLabel: Record<string, string> = { no_interaction: "无几何交互", shared_endpoint: "共用端点", path_crossing: "路径交叉", path_overlap_same_direction: "同向路径重叠", path_overlap_opposite_direction: "反向路径重叠", path_overlap_mixed_direction: "混合方向重叠", shared_door: "共用门", shared_stair: "共用楼梯", unable_to_determine: "无法判断" };
  return <section className="side-section s1-panel">
    <div className="side-heading"><div><span className="eyebrow">S1 PERFORMANCE</span><h2>S1 功能空间关系</h2></div><button className="primary" disabled={!gate?.allowed} onClick={onRun}>{report ? "重新测量" : "启动 S1"}</button></div>
    {!gate && <p><b>S1 尚未启动</b>。需先完成并通过全部适用的 G1–G4 检查。</p>}
    {blocked && <div className="s1-gate status-blocked"><b>S1 尚未启动</b><span>需先完成并通过全部适用的 G1–G4 检查。当前有 {gate!.blockingResults.length} 项未解决结果{blockerGroups ? `（${blockerGroups}）` : ""}；白名单之外的任何状态都会阻止 S1。</span><details><summary>查看阻塞项</summary><small>{gate!.blockingResults.map((item) => `${item.ruleId}: ${item.status}`).join("；")}</small></details></div>}
    {gate?.allowed && !report && <div className="s1-gate status-ready"><b>G1–G4 准入通过</b><span>{gate.evaluatedRuleCount} 项结果均为 pass 或 not_applicable，可以启动关系测量。</span></div>}
    {report && <>
      <div className="s1-gate status-ready"><b>关系已测量</b><span>仅展示当前住宅的拓扑事实，不判断关系好坏。</span></div>
      <div className="s1-counts"><span>已测量 <b>{report.counts.measured}</b></span><span>无法判断 <b>{report.counts.unable_to_determine}</b></span><span>不适用 <b>{report.counts.not_applicable}</b></span></div>
      <article className={`s1-score-summary status-${report.functionalRelationScoring.scoringStatus}`}>
        <div className="unified-finding-heading"><span>{report.functionalRelationScoring.metricId} · {report.functionalRelationScoring.ruleVersion} · {report.functionalRelationScoring.ruleStatus}</span><strong>{report.functionalRelationScoring.metricName}</strong></div>
        <div className="s1-score-value">{report.functionalRelationScoring.score === null ? "—" : `${report.functionalRelationScoring.score.toFixed(1)} / 100`}</div>
        <p>这是 S1 子项局部分数，尚未纳入 S1 总分。</p>
        <small>参与计分 {report.functionalRelationScoring.counts.scored} · G4 排除 {report.functionalRelationScoring.counts.excluded} · 不适用 {report.functionalRelationScoring.counts.not_applicable} · 无法判断 {report.functionalRelationScoring.counts.unable_to_determine}</small>
      </article>
      <div className="s1-relationships">
        {report.measurements.map((measurement) => {
          const score = report.functionalRelationScoring.pairScores.find((item) => item.pairId === measurement.measurementId);
          const source = measurement.source, target = measurement.target, measured = measurement.status === "measured" && source && target;
          const levelNames = measured ? [...new Set([source.levelId, target.levelId].map((levelId) => nodes[levelId]?.name ?? "未命名楼层"))].join(" ↔ ") : "空间未能完整解析";
          const resultLabel = measured && measurement.relationType ? measurement.relationType === "multiple_intermediate_spaces" ? `需要经过 ${measurement.intermediateRoomRegionIds.length} 个空间` : s1RelationLabel[measurement.relationType] : measurement.status === "not_applicable" ? "不适用" : "无法判断";
          const activate = (event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) => { if (!measured || (event.target as Element).closest("button, details, summary")) return; if ("key" in event && event.key !== "Enter" && event.key !== " ") return; event.preventDefault(); onFocus(measurement, 0); };
          return <article key={measurement.measurementId} className={`s1-relationship-card status-${measurement.status}`} role={measured ? "button" : undefined} tabIndex={measured ? 0 : undefined} onClick={activate} onKeyDown={activate}>
            <div className="unified-finding-heading"><span>{measurement.measurementId} · {measurement.status === "measured" ? "已测量" : measurement.status === "not_applicable" ? "不适用" : "无法判断"}</span><strong>{measurement.label}</strong></div>
            <span className="finding-location">{levelNames}</span>
            <div className="s1-relation-kinds"><em>{resultLabel}</em></div>
            {score && <div className="s1-score-detail"><b>{score.score === null ? score.scoringStatus === "excluded" ? "G4 已排除" : score.scoringStatus === "not_applicable" ? "不适用" : "无法评分" : `${score.score} / 100`}</b><span>{score.scoreExplanation}</span>{score.matchedRuleId && <small>评分规则：{score.matchedRuleId} · {score.ruleVersion}</small>}</div>}
            {measured && <dl><dt>拓扑步数</dt><dd>{measurement.topologicalSteps}</dd><dt>中间空间</dt><dd>{measurement.intermediateRoomRegionIds.map(roomLabel).join(" → ") || "无"}</dd><dt>经过门/楼梯</dt><dd>{[...measurement.connectionDoorIds, ...measurement.connectionStairIds].join(", ") || "无"}</dd><dt>置信度</dt><dd>{measurement.confidence}</dd></dl>}
            {measurement.coveredByG4Requirement && <small className="s1-covered">该空间关系已由客户需求 G4 检查，本项不重复计入 S1 评分（{measurement.coveredByG4RequirementIds.join("、")}）。</small>}
            {!measured && <p>{measurement.diagnostics.join("；") || "当前没有足够数据完成测量。"}</p>}
            {measured && <div className="s1-card-actions"><button className="view-on-canvas" onClick={() => onFocus(measurement, 0)}>查看起始空间</button><button className="view-on-canvas" onClick={() => onFocus(measurement, 1)}>查看目标空间</button></div>}
            <details><summary>测量明细</summary><small><b>路径 Room Region</b>{measurement.pathRoomRegionIds.join(" → ") || "—"}</small><small><b>源 Zone</b>{source?.zoneIds.join(", ") || "—"}</small><small><b>源语义</b>{source ? `${source.semanticSource} · ${source.spaceFunctionCodes.join(", ") || "未编码"}` : "—"}</small><small><b>目标 Zone</b>{target?.zoneIds.join(", ") || "—"}</small><small><b>目标语义</b>{target ? `${target.semanticSource} · ${target.spaceFunctionCodes.join(", ") || "未编码"}` : "—"}</small>{measurement.missingData.length > 0 && <small><b>缺失数据</b>{measurement.missingData.join("；")}</small>}</details>
          </article>;
        })}
      </div>
      <div className="s1-metric-section">
        <div className="unified-finding-heading"><span>S1-PCP · {report.publicCirculationPrivacyScoring.ruleVersion} · {report.publicCirculationPrivacyScoring.ruleStatus}</span><strong>公共动线穿越私密空间</strong></div>
        <article className={`s1-score-summary status-${report.publicCirculationPrivacyScoring.status}`}>
          <div className="s1-score-value">{report.publicCirculationPrivacyScoring.score === null ? "无法生成正式分数" : `${report.publicCirculationPrivacyScoring.score.toFixed(1)} / 100`}</div>
          <p>这是 S1 子项局部分数，尚未纳入 S1 总分。</p>
          <small>适用路线组 {report.publicCirculationPrivacyScoring.applicableGroupCount} · 不适用路线组 {report.publicCirculationPrivacyScoring.notApplicableGroupCount} · 无法判断路线组 {report.publicCirculationPrivacyScoring.unableGroupCount} · 安全路线 {report.publicCirculationPrivacyScoring.safeRouteCount} · 强制穿越路线 {report.publicCirculationPrivacyScoring.mandatoryPrivateRouteCount}</small>
        </article>
        <p>原始测量与评分分离：评分仅使用已由 SDI 空间功能编码支持的路线事实。</p>
        <div className="s1-counts"><span>生成路线 <b>{report.publicCirculationPrivacy.counts.generatedRoutes}</b></span><span>存在安全路线 <b>{report.publicCirculationPrivacy.counts.privacySafeRoutes}</b></span><span>必须穿越 <b>{report.publicCirculationPrivacy.counts.privateMandatoryRoutes}</b></span><span>无法判断 <b>{report.publicCirculationPrivacy.counts.unableToDetermineRoutes}</b></span><span>原图不可达 <b>{report.publicCirculationPrivacy.counts.baselineUnreachableRoutes}</b></span><span>不适用路线组 <b>{report.publicCirculationPrivacy.counts.notApplicableRouteGroups}</b></span></div>
        <div className="s1-route-groups">{report.publicCirculationPrivacyScoring.groupScores.map((group) => <article key={group.routeGroup}><b>{group.label}</b><span>{group.status === "scored" ? `组分数：${group.score!.toFixed(1)} / 100` : group.status === "not_applicable" ? "不适用" : "无法生成正式分数"}</span><small>参与评分路线 {group.evaluableRouteCount} · 安全 {group.safeRouteCount} · 强制穿越 {group.mandatoryPrivateRouteCount}</small>{group.diagnostics.length > 0 && <small>{group.diagnostics.join("；")}</small>}</article>)}</div>
        <div className="s1-relationships">{report.publicCirculationPrivacy.measurements.map((measurement) => {
          const routeScore = report.publicCirculationPrivacyScoring.routeScores.find((item) => item.routeId === measurement.routeId);
          const locatable = measurement.status === "measured" && measurement.resultType !== "baseline_unreachable" && measurement.source && measurement.target;
          const resultLabel = measurement.resultType === "privacy_safe_route_available" ? "存在不穿越私密空间的可行路线。" : measurement.resultType === "private_space_mandatory" ? "前往该公共空间的所有可行路线都必须经过私密空间。" : measurement.resultType === "baseline_unreachable" ? "起点与目的空间在原始空间图中不可达，本项不重复评价。" : measurement.resultType === "not_applicable" ? "不适用" : "空间语义或拓扑数据不足，无法完成测量。";
          const sourceLabel = measurement.source?.zoneNames.join(" / ") || measurement.sourceRoomRegionId || "—", targetLabel = measurement.target?.zoneNames.join(" / ") || measurement.targetRoomRegionId || "—";
          return <article key={measurement.routeId} className={`s1-relationship-card s1-route-card status-${measurement.status}`} role={locatable ? "button" : undefined} tabIndex={locatable ? 0 : undefined} onClick={(event) => { if (locatable && !(event.target as Element).closest("button, details, summary")) onFocusPublicRoute(measurement, 0); }}>
            <div className="unified-finding-heading"><span>{measurement.routeGroupLabel} · {measurement.status === "measured" ? "已测量" : measurement.status === "not_applicable" ? "不适用" : "无法判断"}</span><strong>{sourceLabel} → {targetLabel}</strong></div>
            <div className="s1-relation-kinds"><em>{resultLabel}</em></div>
            {routeScore && <div className="s1-score-detail"><b>{routeScore.score === null ? "无法评分" : `路线得分：${routeScore.score} / 100`}</b><span>评分依据：{routeScore.scoreExplanation}</span>{routeScore.matchedRuleId && <small>评分规则：{routeScore.matchedRuleId} · {routeScore.ruleVersion}</small>}</div>}
            {measurement.status === "measured" && <dl><dt>安全路线</dt><dd>{measurement.privacySafeReachable === null ? "不重复评价" : measurement.privacySafeReachable ? "存在" : "不存在"}</dd><dt>私密空间</dt><dd>{measurement.privateIntermediateRoomRegionIds.map(roomLabel).join(" → ") || "无"}</dd><dt>经过门/楼梯</dt><dd>{[...measurement.connectionDoorIds, ...measurement.connectionStairIds].join(", ") || "无"}</dd><dt>楼层</dt><dd>{measurement.levelIds.map((id) => nodes[id]?.name ?? id).join(" ↔ ") || "—"}</dd><dt>置信度</dt><dd>{measurement.confidence}</dd></dl>}
            {measurement.status !== "measured" && <p>{measurement.diagnostics.join("；")}</p>}
            {locatable && <div className="s1-card-actions"><button className="view-on-canvas" onClick={() => onFocusPublicRoute(measurement, 0)}>查看起点路线</button><button className="view-on-canvas" onClick={() => onFocusPublicRoute(measurement, 1)}>查看终点路线</button></div>}
            <details><summary>测量明细</summary><small><b>routeId</b>{measurement.routeId}</small><small><b>原始路径</b>{measurement.baselinePathRoomRegionIds.join(" → ") || "—"}</small><small><b>安全路径</b>{measurement.privacySafePathRoomRegionIds.join(" → ") || "—"}</small><small><b>稳定见证路径</b>{measurement.witnessPathRoomRegionIds.join(" → ") || "—"}</small><small><b>语义来源</b>{measurement.semanticSource}</small>{measurement.diagnostics.length > 0 && <small><b>诊断</b>{measurement.diagnostics.join("；")}</small>}{measurement.missingData.length > 0 && <small><b>缺失数据</b>{measurement.missingData.join("；")}</small>}</details>
          </article>;
        })}</div>
      </div>
      <div className="s1-metric-section">
        <div className="unified-finding-heading"><span>S1-HPE · {report.highFrequencyPathEfficiency.measurementVersion} · {report.highFrequencyPathEfficiency.measurementStatus}</span><strong>高频活动路径效率</strong></div>
         <p>{report.highFrequencyPathEfficiencyScoring.status === "scored" ? `局部分数：${report.highFrequencyPathEfficiencyScoring.score!.toFixed(1)} / 100` : report.highFrequencyPathEfficiencyScoring.status === "unable_to_determine" ? "无法生成完整正式分数" : "不适用"}。当前为 v0.1 Demo 校准值，后续将通过真实住宅样本校准；尚未纳入 S1 总分。</p>
        <div className="s1-counts"><span>有效室内面积 <b>{report.highFrequencyPathEfficiencyScoring.effectiveResidentialIndoorArea.squareMeters === null ? "—" : `${report.highFrequencyPathEfficiencyScoring.effectiveResidentialIndoorArea.squareMeters.toFixed(2)} m²`}</b></span><span>适用场景 <b>{report.highFrequencyPathEfficiencyScoring.applicableSceneCount}</b></span><span>无法判断场景 <b>{report.highFrequencyPathEfficiencyScoring.unableSceneCount}</b></span><span>不适用场景 <b>{report.highFrequencyPathEfficiencyScoring.notApplicableSceneCount}</b></span></div>
        <div className="s1-counts"><span>已测量路线 <b>{report.highFrequencyPathEfficiency.counts.measured}</b></span><span>不可达 <b>{report.highFrequencyPathEfficiency.counts.baselineUnreachable}</b></span><span>无法判断 <b>{report.highFrequencyPathEfficiency.counts.unableToDetermine}</b></span><span>不适用路线组 <b>{report.highFrequencyPathEfficiency.counts.notApplicableRouteGroups}</b></span><span>平均路径长度 <b>{report.highFrequencyPathEfficiency.averages.actualPathLengthMeters === null ? "—" : `${report.highFrequencyPathEfficiency.averages.actualPathLengthMeters.toFixed(2)} m`}</b></span><span>平均拓扑步数 <b>{report.highFrequencyPathEfficiency.averages.topologicalSteps ?? "—"}</b></span><span>平均转向次数 <b>{report.highFrequencyPathEfficiency.averages.turnCount ?? "—"}</b></span></div>
        <div className="s1-route-groups">{report.highFrequencyPathEfficiencyScoring.sceneScores.map((scene) => <article key={scene.scene}><b>{scene.label}</b><span>{scene.status === "scored" ? `场景分数：${scene.score!.toFixed(1)} / 100` : scene.status === "unable_to_determine" ? "无法生成完整正式分数" : "不适用"}</span><small>参与评分路线 {scene.evaluableRouteCount} · 无法判断 {scene.unableRouteCount}</small>{scene.diagnostics.length > 0 && <small>{scene.diagnostics.join("；")}</small>}</article>)}</div>
        <div className="s1-route-groups">{report.highFrequencyPathEfficiency.groups.map((group) => <article key={group.routeGroup}><b>{group.label}</b><span>{group.status === "measured" ? `${group.routeCount} 条路线` : group.status === "not_applicable" ? "不适用" : "无法判断"}</span>{group.diagnostics.length > 0 && <small>{group.diagnostics.join("；")}</small>}</article>)}</div>
        <div className="s1-relationships">{report.highFrequencyPathEfficiency.measurements.map((measurement) => {
          const routeScore = report.highFrequencyPathEfficiencyScoring.routeScores.find((item) => item.routeId === measurement.routeId), locatable = measurement.status === "measured" && measurement.source && measurement.target && measurement.pathPoints.length > 0, sourceLabel = measurement.source?.zoneNames.join(" / ") || measurement.sourceRoomRegionId || "—", targetLabel = measurement.target?.zoneNames.join(" / ") || measurement.targetRoomRegionId || "—";
          const statusLabel = measurement.status === "measured" ? "已测量" : measurement.status === "baseline_unreachable" ? "原图不可达" : measurement.status === "not_applicable" ? "不适用" : "无法判断";
          const activate = (event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) => { if (!locatable || (event.target as Element).closest("button, details, summary")) return; if ("key" in event && event.key !== "Enter" && event.key !== " ") return; event.preventDefault(); onFocusHighFrequencyPath(measurement, 0); };
          return <article key={measurement.routeId} className={`s1-relationship-card s1-route-card status-${measurement.status}`} role={locatable ? "button" : undefined} tabIndex={locatable ? 0 : undefined} onClick={activate} onKeyDown={activate}>
            <div className="unified-finding-heading"><span>{measurement.routeLabel} · {statusLabel}</span><strong>{sourceLabel} → {targetLabel}</strong></div>
            {measurement.fallbackTargetUsed && <small>主卫不可达或不存在，当前使用其他可用卫生间。</small>}
            {measurement.status === "measured" && <dl><dt>实际长度</dt><dd>{measurement.actualPathLengthMeters?.toFixed(2)} m</dd><dt>直线距离</dt><dd>{measurement.straightLineDistanceMeters === null ? "跨楼层/不可计算" : `${measurement.straightLineDistanceMeters.toFixed(2)} m`}</dd><dt>绕行比</dt><dd>{measurement.detourRatio === null ? "—" : measurement.detourRatio.toFixed(3)}</dd><dt>相对距离</dt><dd>{routeScore?.normalizedDistance === null || routeScore?.normalizedDistance === undefined ? "—" : routeScore.normalizedDistance.toFixed(3)}</dd><dt>相对距离分</dt><dd>{routeScore?.normalizedDistanceScore === null || routeScore?.normalizedDistanceScore === undefined ? "—" : routeScore.normalizedDistanceScore.toFixed(1)}</dd><dt>绕行分</dt><dd>{routeScore?.detourScore === null || routeScore?.detourScore === undefined ? "—" : routeScore.detourScore.toFixed(1)}</dd><dt>路线最终分</dt><dd>{routeScore?.routeScore === null || routeScore?.routeScore === undefined ? "无法生成正式分数" : `${routeScore.routeScore.toFixed(1)} / 100`}</dd><dt>拓扑步数</dt><dd>{measurement.topologicalSteps}</dd><dt>中间空间</dt><dd>{measurement.intermediateRoomCount}（{measurement.roomPathIds.slice(1, -1).map(roomLabel).join(" → ") || "无"}）</dd><dt>转向次数</dt><dd>{measurement.turnCount}</dd><dt>门/楼梯</dt><dd>{[...measurement.doorIds, ...measurement.stairIds].join(", ") || "无"}</dd><dt>经过空间</dt><dd>{measurement.roomPathIds.map(roomLabel).join(" → ")}</dd></dl>}
            {measurement.diagnostics.length > 0 && <p>{measurement.diagnostics.join("；")}</p>}
            {locatable && <div className="s1-card-actions"><button className="view-on-canvas" onClick={() => onFocusHighFrequencyPath(measurement, 0)}>查看起点路径</button><button className="view-on-canvas" onClick={() => onFocusHighFrequencyPath(measurement, 1)}>查看终点路径</button></div>}
             <details><summary>测量明细</summary><small><b>routeId</b>{measurement.routeId}</small><small><b>行为来源</b>{measurement.behaviorSources.join(" + ") || "—"}</small><small><b>生产寻路</b>{measurement.pathProvider}</small><small><b>RoomRegion 路径</b>{measurement.roomPathIds.join(" → ") || "—"}</small><small><b>源 SF</b>{measurement.sourceSpaceFunctionCodes.join(", ") || "—"}</small><small><b>选中 Kitchen Zone</b>{measurement.selectedTargetZoneId ? `${measurement.selectedTargetZoneId} · ${measurement.selectedTargetSpaceFunctionCode ?? "未编码"}` : "—"}</small><small><b>目标 SF</b>{measurement.targetSpaceFunctionCodes.join(", ") || "—"}</small><small><b>行为锚点</b>{measurement.sourceAnchorType && measurement.targetAnchorType ? `${measurement.sourceAnchorType} → ${measurement.targetAnchorType}` : "—"}</small><small><b>行为对象</b>{[...measurement.sourceBehaviorObjectIds, ...measurement.targetBehaviorObjectIds].join(", ") || "—"}</small><small><b>锚点坐标</b>{measurement.sourceAnchorPoint && measurement.targetAnchorPoint ? `${measurement.sourceAnchorPoint.map((value) => value.toFixed(2)).join(", ")} → ${measurement.targetAnchorPoint.map((value) => value.toFixed(2)).join(", ")}` : "—"}</small><small><b>独立几何复核</b>{measurement.independentGeometryValidated ? "通过" : "未通过/不适用"}</small><small><b>turnCount</b>measurement_only</small>{measurement.tiedCandidateTargetRoomIds.length > 0 && <small><b>等长卫生间候选</b>{measurement.tiedCandidateTargetRoomIds.join(", ")}</small>}{measurement.missingData.length > 0 && <small><b>缺失数据</b>{measurement.missingData.join("；")}</small>}</details>
          </article>;
        })}</div>
      </div>
      <div className="s1-metric-section">
        <div className="unified-finding-heading"><span>S1-PCI · {report.pathConflictInteraction.ruleVersion} · {report.pathConflictInteraction.measurementStatus}</span><strong>常用路径交汇与冲突</strong></div>
        <p>直接比较 S1-HPE 已测量的正式平滑路径，仅展示交叉、重叠和共同使用对象等事实。</p>
        <div className="s1-counts"><span>参与路线 <b>{report.pathConflictInteraction.counts.eligibleRoutes}</b></span><span>路线对 <b>{report.pathConflictInteraction.counts.routePairs}</b></span><span>无交互 <b>{report.pathConflictInteraction.counts.noInteractionPairs}</b></span><span>交叉路线对 <b>{report.pathConflictInteraction.counts.crossingPairs}</b></span><span>重叠路线对 <b>{report.pathConflictInteraction.counts.overlapPairs}</b></span><span>反向/混合重叠 <b>{report.pathConflictInteraction.counts.oppositeOverlapPairs}</b></span><span>共用门 <b>{report.pathConflictInteraction.counts.sharedDoorPairs}</b></span><span>共用楼梯 <b>{report.pathConflictInteraction.counts.sharedStairPairs}</b></span><span>无法判断 <b>{report.pathConflictInteraction.counts.unablePairs}</b></span></div>
        {report.pathConflictInteraction.status === "not_applicable" && <p>{report.pathConflictInteraction.diagnostics.join("；")}</p>}
        <details><summary>路线使用热点</summary><small><b>门</b>{report.pathConflictInteraction.hotspots.doors.filter((item) => item.routeCount > 1).map((item) => `${item.objectId}（${item.routeCount}条）`).join("；") || "无多路线共用门"}</small><small><b>楼梯</b>{report.pathConflictInteraction.hotspots.stairs.filter((item) => item.routeCount > 1).map((item) => `${item.objectId}（${item.routeCount}条）`).join("；") || "无多路线共用楼梯"}</small><small><b>RoomRegion</b>{report.pathConflictInteraction.hotspots.roomRegions.filter((item) => item.routeCount > 1).map((item) => `${roomLabel(item.objectId)}（${item.routeCount}条）`).join("；") || "无多路线共用空间"}</small><small><b>交叉点</b>{report.pathConflictInteraction.hotspots.crossingPoints.map((item) => `${nodes[item.levelId]?.name ?? item.levelId} ${item.point.map((value) => value.toFixed(2)).join(",")}（${item.routeCount}条）`).join("；") || "无"}</small></details>
        <div className="s1-relationships">{report.pathConflictInteraction.routePairs.map((measurement) => {
          const locatable = measurement.status === "measured", levels = measurement.comparedLevelIds.length ? measurement.comparedLevelIds : [...new Set([measurement.routeAId, measurement.routeBId].flatMap((routeId) => report.highFrequencyPathEfficiency.measurements.find((route) => route.routeId === routeId)?.pathPoints.map((item) => item.levelId) ?? []))].sort();
          const activate = (event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) => { if (!locatable || (event.target as Element).closest("button, details, summary")) return; if ("key" in event && event.key !== "Enter" && event.key !== " ") return; event.preventDefault(); onFocusPathConflict(measurement, 0); };
          return <article key={measurement.routePairId} className={`s1-relationship-card s1-route-card status-${measurement.status}`} role={locatable ? "button" : undefined} tabIndex={locatable ? 0 : undefined} onClick={activate} onKeyDown={activate}>
            <div className="unified-finding-heading"><span>路线对 · {measurement.status === "measured" ? "已测量" : "无法判断"}</span><strong>{hpeRouteLabel(measurement.routeAId)} ↔ {hpeRouteLabel(measurement.routeBId)}</strong></div>
            <div className="s1-relation-kinds">{measurement.interactionTypes.map((type) => <em key={type}>{interactionLabel[type] ?? type}</em>)}</div>
            {measurement.status === "measured" && <dl><dt>交叉次数</dt><dd>{measurement.crossingCount}</dd><dt>共享路径</dt><dd>{measurement.sharedPathLengthMeters.toFixed(2)} m</dd><dt>路线A共享比例</dt><dd>{measurement.routeASharedRatio === null ? "—" : `${(measurement.routeASharedRatio * 100).toFixed(1)}%`}</dd><dt>路线B共享比例</dt><dd>{measurement.routeBSharedRatio === null ? "—" : `${(measurement.routeBSharedRatio * 100).toFixed(1)}%`}</dd><dt>重叠方向</dt><dd>{measurement.overlapDirection === "same_direction" ? "同向" : measurement.overlapDirection === "opposite_direction" ? "反向" : measurement.overlapDirection === "mixed" ? "混合" : "不适用"}</dd><dt>共用门</dt><dd>{measurement.sharedDoorIds.join("、") || "无"}</dd><dt>共用楼梯</dt><dd>{measurement.sharedStairIds.join("、") || "无"}</dd><dt>共用RoomRegion</dt><dd>{measurement.sharedRoomRegionIds.map(roomLabel).join(" → ") || "无"}</dd></dl>}
            {measurement.diagnostics.length > 0 && <p>{measurement.diagnostics.join("；")}</p>}
            {locatable && <div className="s1-card-actions">{levels.length ? levels.map((levelId, index) => <button key={levelId} className="view-on-canvas" onClick={() => onFocusPathConflict(measurement, index)}>查看{nodes[levelId]?.name ?? `楼层${index + 1}`}</button>) : <button className="view-on-canvas" onClick={() => onFocusPathConflict(measurement, 0)}>查看两条路线</button>}</div>}
            <details><summary>测量明细</summary><small><b>routePairId</b>{measurement.routePairId}</small><small><b>比较楼层</b>{measurement.comparedLevelIds.join("、") || "无相同楼层片段"}</small><small><b>重叠段数量</b>{measurement.overlapSegmentCount}</small><small><b>交叉点</b>{measurement.crossingPointsByLevel.map((item) => `${item.levelId}:${item.point.map((value) => value.toFixed(2)).join(",")}`).join("；") || "无"}</small>{measurement.missingData.length > 0 && <small><b>缺失数据</b>{measurement.missingData.join("；")}</small>}</details>
          </article>;
        })}</div>
      </div>
      <div className="s1-metric-section">
        <div className="unified-finding-heading"><span>{report.spaceFragmentShape.metricId} · {report.spaceFragmentShape.ruleVersion}</span><strong>{report.spaceFragmentShape.metricName}</strong></div>
        <p>状态：{report.spaceFragmentShape.measurementStatus}。仅展示功能空间边界与家具后自由网格的几何事实。</p>
        <div className="s1-counts"><span>已测量空间 <b>{report.spaceFragmentShape.counts.measured}</b></span><span>无法判断 <b>{report.spaceFragmentShape.counts.unableToDetermine}</b></span><span>不适用 <b>{report.spaceFragmentShape.counts.notApplicable}</b></span><span>多连通分量空间 <b>{report.spaceFragmentShape.counts.multipleNavigableComponents}</b></span><span>碎片面积总量 <b>{report.spaceFragmentShape.totals.fragmentAreaSquareMeters.toFixed(2)} m²</b></span><span>平均紧凑度 <b>{report.spaceFragmentShape.averages.compactness?.toFixed(3) ?? "—"}</b></span><span>平均凸度 <b>{report.spaceFragmentShape.averages.convexityRatio?.toFixed(3) ?? "—"}</b></span><span>平均最大连通分量比例 <b>{report.spaceFragmentShape.averages.largestNavigableComponentRatio === null ? "—" : `${(report.spaceFragmentShape.averages.largestNavigableComponentRatio * 100).toFixed(1)}%`}</b></span></div>
        {report.spaceFragmentShape.diagnostics.length > 0 && <p>{report.spaceFragmentShape.diagnostics.join("；")}</p>}
        <div className="s1-relationships">{report.spaceFragmentShape.measurements.map((measurement) => {
          const locatable = measurement.status === "measured" && Boolean(measurement.roomRegionId && measurement.levelId && measurement.footprintPolygons.length), statusLabel = measurement.status === "measured" ? "已测量" : measurement.status === "not_applicable" ? "不适用" : "无法判断";
          const activate = (event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) => { if (!locatable || (event.target as Element).closest("button, details, summary")) return; if ("key" in event && event.key !== "Enter" && event.key !== " ") return; event.preventDefault(); onFocusSpaceFragment(measurement); };
          return <article key={measurement.spaceInstanceId} className={`s1-relationship-card status-${measurement.status}`} role={locatable ? "button" : undefined} tabIndex={locatable ? 0 : undefined} onClick={activate} onKeyDown={activate}>
            <div className="unified-finding-heading"><span>{measurement.spaceFunctionCode} · {statusLabel}</span><strong>{measurement.zoneNames.join(" / ")}（{measurement.spaceFunctionName}）</strong></div>
            {measurement.status === "measured" && <dl><dt>楼层</dt><dd>{measurement.levelId ? nodes[measurement.levelId]?.name ?? measurement.levelId : "—"}</dd><dt>面积 / 周长</dt><dd>{measurement.footprintAreaSquareMeters?.toFixed(2)} m² / {measurement.footprintPerimeterMeters?.toFixed(2)} m</dd><dt>compactness</dt><dd>{measurement.compactness?.toFixed(4)}</dd><dt>convexityRatio</dt><dd>{measurement.convexityRatio?.toFixed(4)}</dd><dt>凹入面积 / 比例</dt><dd>{measurement.concavePocketAreaSquareMeters?.toFixed(2)} m² / {measurement.concavePocketRatio === null ? "—" : `${(measurement.concavePocketRatio! * 100).toFixed(1)}%`}</dd><dt>可通行面积</dt><dd>{measurement.totalNavigableAreaSquareMeters?.toFixed(2)} m²</dd><dt>自由空间连通分量</dt><dd>{measurement.navigableComponentCount}</dd><dt>最大连通分量比例</dt><dd>{measurement.largestNavigableComponentRatio === null ? "—" : `${(measurement.largestNavigableComponentRatio! * 100).toFixed(1)}%`}</dd><dt>碎片数量 / 面积 / 比例</dt><dd>{measurement.fragmentComponentCount} / {measurement.fragmentAreaSquareMeters?.toFixed(2)} m² / {measurement.fragmentAreaRatio === null ? "—" : `${(measurement.fragmentAreaRatio! * 100).toFixed(1)}%`}</dd></dl>}
            {measurement.diagnostics.length > 0 && <p>{measurement.diagnostics.join("；")}</p>}
            {locatable && <button className="view-on-canvas" onClick={() => onFocusSpaceFragment(measurement)}>在图中查看</button>}
            <details><summary>测量明细</summary><small><b>spaceInstanceId</b>{measurement.spaceInstanceId}</small><small><b>Zone</b>{measurement.zoneIds.join("、")}</small><small><b>RoomRegion</b>{measurement.roomRegionId ?? "—"}</small><small><b>凸包面积</b>{measurement.convexHullAreaSquareMeters?.toFixed(3) ?? "—"} m²</small><small><b>网格</b>{measurement.gridMeters ?? "—"} m</small>{measurement.fragmentPolygonsOrCells.map((fragment) => <small key={fragment.componentId}><b>{fragment.componentId}</b>{fragment.areaSquareMeters.toFixed(2)} m²（{fragment.cellCount} 个网格点）</small>)}{measurement.missingData.length > 0 && <small><b>缺失数据</b>{measurement.missingData.join("；")}</small>}</details>
          </article>;
        })}</div>
      </div>
      <div className="s1-metric-section">
        <div className="unified-finding-heading"><span>{report.furnitureRelationshipAndUseSpace.metricId} · {report.furnitureRelationshipAndUseSpace.ruleVersion}</span><strong>{report.furnitureRelationshipAndUseSpace.metricName}</strong></div>
        <p>状态：{report.furnitureRelationshipAndUseSpace.measurementStatus}。使用空间与家具关系分开记录，正式语义仅来自 functionTags。</p>
        <div className="s1-counts"><span>参与 Item <b>{report.furnitureRelationshipAndUseSpace.counts.participatingItems}</b></span><span>最小使用空间 <b>{report.furnitureRelationshipAndUseSpace.counts.itemsWithMinimumUseSpace}</b></span><span>最大开启范围 <b>{report.furnitureRelationshipAndUseSpace.counts.itemsWithMaximumOpening}</b></span><span>使用空间存在重叠/不足 <b>{report.furnitureRelationshipAndUseSpace.counts.minimumUseConflictItems}</b></span><span>开启范围存在重叠/越界 <b>{report.furnitureRelationshipAndUseSpace.counts.maximumOpeningConflictItems}</b></span><span>已测量关系 <b>{report.furnitureRelationshipAndUseSpace.counts.measuredRelations}</b></span><span>关系无法判断 <b>{report.furnitureRelationshipAndUseSpace.counts.unableToDetermine}</b></span><span>不适用关系组 <b>{report.furnitureRelationshipAndUseSpace.counts.notApplicable}</b></span></div>
        <div className="s1-route-groups">{report.furnitureRelationshipAndUseSpace.relationGroups.map((group) => <article key={group.pairType}><b>{group.label}</b><span>{group.status === "measured" ? `${group.measurementCount} 个关系` : group.status === "not_applicable" ? "不适用" : "存在无法判断关系"}</span><small>无法判断 {group.unableToDetermineCount} · 不适用 {group.notApplicableCount}</small>{group.diagnostics.length > 0 && <small>{group.diagnostics.join("；")}</small>}</article>)}</div>
        <details><summary>家具使用空间测量（{report.furnitureRelationshipAndUseSpace.itemMeasurements.length}）</summary><div className="s1-relationships">{report.furnitureRelationshipAndUseSpace.itemMeasurements.map((measurement) => {
          const locatable = measurement.status !== "unable_to_determine" && Boolean(measurement.levelId && nodes[measurement.itemId]), statusLabel = measurement.status === "measured" ? "已测量" : measurement.status === "not_applicable" ? "不适用" : "无法判断";
          return <article key={measurement.measurementId} className={`s1-relationship-card status-${measurement.status}`} role={locatable ? "button" : undefined} tabIndex={locatable ? 0 : undefined} onClick={(event) => { if (locatable && !(event.target as Element).closest("button, details, summary")) onFocusFurnitureUse(measurement); }}>
            <div className="unified-finding-heading"><span>Item · {statusLabel}</span><strong>{measurement.itemName}</strong></div><small>functionTags：{measurement.functionTags.join("、") || "无"}</small><small>所在空间：{measurement.zoneIds.map((id) => nodes[id]?.name ?? id).join(" / ") || (measurement.roomRegionId ? roomLabel(measurement.roomRegionId) : "—")}</small>
            {measurement.status === "measured" && <dl><dt>最小使用空间</dt><dd>{measurement.minimumUseSpaceAreaSquareMeters?.toFixed(2)} m² · {measurement.minimumUseSpaceAvailable ? "可用" : "存在重叠或可达不足"}</dd><dt>使用空间重叠</dt><dd>{measurement.minimumUseSpaceConflictAreaSquareMeters?.toFixed(3)} m²（{measurement.minimumUseSpaceConflictRatio === null ? "—" : `${(measurement.minimumUseSpaceConflictRatio * 100).toFixed(1)}%`}）</dd><dt>最大开启范围</dt><dd>{measurement.maximumOpeningAreaSquareMeters?.toFixed(2)} m² · {measurement.maximumOpeningAvailable ? "可完整展开" : "存在重叠或越界"}</dd><dt>开启范围重叠</dt><dd>{measurement.maximumOpeningConflictAreaSquareMeters?.toFixed(3)} m²（{measurement.maximumOpeningConflictRatio === null ? "—" : `${(measurement.maximumOpeningConflictRatio * 100).toFixed(1)}%`}）</dd><dt>涉及对象</dt><dd>{[...measurement.minimumUseSpaceConflictItemIds, ...measurement.maximumOpeningConflictItemIds].join("、") || "无"}</dd><dt>建筑构件</dt><dd>{[...measurement.minimumUseSpaceConflictBuildingElementIds, ...measurement.maximumOpeningConflictBuildingElementIds].join("、") || "无"}</dd></dl>}
            {measurement.diagnostics.length > 0 && <p>{measurement.diagnostics.join("；")}</p>}{locatable && <button className="view-on-canvas" onClick={() => onFocusFurnitureUse(measurement)}>在图中查看</button>}
            {measurement.missingData.length > 0 && <details><summary>缺失数据</summary><small>{measurement.missingData.join("；")}</small></details>}
          </article>;
        })}</div></details>
        <div className="s1-relationships">{report.furnitureRelationshipAndUseSpace.relationMeasurements.map((measurement) => {
          const locatable = measurement.status === "measured" && Boolean(measurement.itemAId && measurement.levelId), statusLabel = measurement.status === "measured" ? "已测量" : "无法判断";
          return <article key={measurement.relationId} className={`s1-relationship-card status-${measurement.status}`} role={locatable ? "button" : undefined} tabIndex={locatable ? 0 : undefined} onClick={(event) => { if (locatable && !(event.target as Element).closest("button, details, summary")) onFocusFurnitureRelation(measurement); }}>
            <div className="unified-finding-heading"><span>{measurement.pairLabel} · {statusLabel}</span><strong>{measurement.itemAName ?? "候选未唯一"} ↔ {measurement.itemBName}</strong></div>
            {measurement.status === "measured" && <dl><dt>同一RoomRegion</dt><dd>{measurement.sameRoomRegion ? "是" : "否"}</dd><dt>同一功能Zone</dt><dd>{measurement.sameZoneOrFunctionalSpace ? "是" : "否"}</dd><dt>中心距离</dt><dd>{measurement.centerDistanceMeters?.toFixed(3)} m</dd><dt>边界距离</dt><dd>{measurement.boundaryDistanceMeters?.toFixed(3)} m</dd><dt>相对方向/角度</dt><dd>{measurement.relativeDirection} / {measurement.relativeAngleDegrees?.toFixed(1)}°</dd></dl>}
            {measurement.status === "unable_to_determine" && <small>并列候选：{measurement.candidateItemAIds.join("、") || "无"}</small>}
            {measurement.diagnostics.length > 0 && <p>{measurement.diagnostics.join("；")}</p>}{locatable && <button className="view-on-canvas" onClick={() => onFocusFurnitureRelation(measurement)}>在图中查看</button>}
          </article>;
        })}</div>
      </div>
    </>}
  </section>;
}

function transformDiagnostics(nodes: Record<string, NodeData>): Diagnostic[] {
  const itemDiagnostics = Object.values(nodes)
    .filter((n) => n.type === "item")
    .flatMap((node) => {
      const r = resolveItemPlanTransform(node.id, nodes);
      return r.status === "error"
        ? [
            {
              severity: "error" as const,
              code: r.error || "unsupported_parent_transform",
              message: "无法确定家具楼层坐标",
              nodeId: node.id,
            },
          ]
        : [];
    });
  const shelfDiagnostics = Object.values(nodes).filter((node) => node.type === 'shelf').flatMap((node) => {
    const transform = resolveShelfPlanTransform(node.id, nodes), data = resolveShelfData(node), diagnostics: Diagnostic[] = [];
    if (!hasValidShelfFootprint(node)) diagnostics.push({ severity: 'error', code: 'invalid_shelf_dimensions', message: 'Shelf width/depth 无效；未绘制虚假占地', nodeId: node.id, sourcePath: `nodes.${node.id}` });
    if (node.rows !== undefined && (!Number.isInteger(node.rows) || node.rows < 1 || node.rows > 8)) diagnostics.push({ severity: 'error', code: 'invalid_shelf_rows', message: 'Shelf rows 必须为 1–8 的整数', nodeId: node.id, sourcePath: `nodes.${node.id}.rows` });
    if (node.columns !== undefined && (!Number.isInteger(node.columns) || node.columns < 1 || node.columns > 6)) diagnostics.push({ severity: 'error', code: 'invalid_shelf_columns', message: 'Shelf columns 必须为 1–6 的整数', nodeId: node.id, sourcePath: `nodes.${node.id}.columns` });
    if (transform.status === 'error') diagnostics.push({ severity: 'error', code: transform.error === 'parent_cycle' ? 'shelf_parent_cycle' : transform.error === 'missing_parent' ? 'missing_shelf_parent' : 'unsupported_shelf_parent_transform', message: '无法确定 Shelf 的楼层坐标', nodeId: node.id, sourcePath: `nodes.${node.id}.parentId` });
    void data; return diagnostics;
  });
  return [...itemDiagnostics, ...shelfDiagnostics];
}
function Diagnostics({ diagnostics }: { diagnostics: Diagnostic[] }) {
  return (
    <section className="side-section diagnostics-panel">
      <details>
        <summary className="side-heading"><h2>诊断</h2><span className="pill">{diagnostics.length}</span></summary>
        {diagnostics.slice(0, 30).map((d, i) => (
          <div className={`diag ${d.severity}`} key={`${d.code}-${i}`}>
            <b>{d.code}</b>
            <span>{d.message}</span>
            <small>{d.nodeId || ""}</small>
          </div>
        ))}
      </details>
    </section>
  );
}
function CoverageReport({
  coverage,
}: {
  coverage: ReturnType<typeof auditSceneCoverage>;
}) {
  return (
    <section className="side-section diagnostics-panel">
      <div className="side-heading">
        <h2>解析覆盖</h2>
        <span className="pill">{Object.keys(coverage.byKind).length}</span>
      </div>
      <small>
        Core {coverage.summary.builtInNodes} · 完整 {coverage.summary.fullySupportedNodes} ·
        部分 {coverage.summary.partiallySupportedNodes} · 未知 {coverage.summary.unknownPluginNodes} ·
        未渲染 {coverage.summary.parsedNotRenderedNodes} · 无效 {coverage.summary.invalidNodes}
      </small>
      {Object.entries(coverage.byKind).map(([kind, entries]) => (
        <details key={kind}>
          <summary>{kind} · {entries.length} · {entries[0].overallStatus}</summary>
          <table className="coverage-table">
            <thead><tr><th>Variant</th><th>解析</th><th>坐标</th><th>预计</th><th>实际</th><th>状态</th></tr></thead>
            <tbody>{entries.map((entry) => <tr key={entry.nodeId}><td>{entry.variant || "—"}</td><td>{entry.schemaStatus}</td><td>{entry.transformStatus}</td><td>{entry.expectedVisibility.join(", ")}</td><td>{entry.actualRenderStatus}</td><td>{entry.overallStatus}</td></tr>)}</tbody>
          </table>
          <pre>{JSON.stringify(entries.map((entry) => ({ nodeId: entry.nodeId, variant: entry.variant, parentChain: entry.parentChain, sourcePath: entry.sourcePath, evidence: entry.evidence, reason: entry.reason })), null, 2)}</pre>
        </details>
      ))}
      {coverage.unknownKinds.length > 0 && <pre>{JSON.stringify({ unknownKinds: coverage.unknownKinds, installedPlugins: coverage.installedPlugins }, null, 2)}</pre>}
    </section>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
