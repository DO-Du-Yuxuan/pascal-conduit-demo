import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./plan/plan.css";
import { ExteriorDimensions } from "./plan/ExteriorDimensions";
import { ConduitPlanOverlay } from "./plan/ConduitPlan";
import { ConstructionAnnotations, ConstructionDrawingLayoutPersistence, ConstructionNotices, useConstructionPlan } from "./plan/ConstructionAnnotations";
import { PointPositionDimensions } from "./plan/PointPositionDimensions";
import { HvacSectionCallouts } from "./plan/HvacConstruction";
import { ConstructionLegend } from "./plan/ConstructionLegend";
import { ManualCallouts } from "./plan/ManualCallouts";
import { manualCalloutTargetAnchor, newManualCalloutDraft } from "./plan/manual-callout-model";
import { allConstructionDrawingsSelected, fireDrawingIsVisible, setAllConstructionDrawings, setFireDrawingVisibility } from "./plan/construction-drawings";
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
import { zoneLabelPoint, zonePoints } from "./geometry/zone";
import { buildExteriorDimensions, DimensionSegment, dimensionOverlayBounds, uprightDimensionAngle } from "./geometry/exterior-dimensions";
import { buildManualMeasurementGeometry, buildMeasurementSnapSegments, formatArea, formatMeasurement, ManualMeasurement, MeasurementMode, MeasurementSnap, MeasurementUnit, resolveMeasurementMode, snapMeasurementPoint } from "./geometry/manual-measurement";
import { ALPHA_THRESHOLD, computeCropPlacement, floorplanImageCropDiagnostics, FloorplanImageCropCacheEntry, loadFloorplanImageCrop, peekFloorplanImageCrop, subscribeFloorplanImageCrop } from "./geometry/floorplan-image-crop";
import { auditSceneCoverage } from "./coverage/auditSceneCoverage";
import { createSceneVisibilityHistory, hideSceneNode, isHideableSceneNode, redoSceneVisibility, restoreAllSceneNodes, undoSceneVisibility } from "./scene-visibility";
import { buildThreeDSceneInput } from "./three/scene-input";
import ThreeDWorkspace from "./three/ThreeDWorkspace";
import type { ThreeDAuthorCommand } from "./three/ThreeDWorkspace";
import { BUILDER_CARD_SECTION_LABELS, BUILDER_CARDS, BUILDER_SYSTEMS, catalogLockForBuilderCard, type BuilderAuthorTool, type BuilderCard, type BuilderCardSection, type BuilderSystemId } from "./builder-workbench";
import { saveJsonFile } from "./three/save-json-file";
import { useOverlayStore } from "./domain/store";
import { sha256Text } from "./domain/hash";
import { type ConduitOverlayDocument, type ManualCallout } from "./domain/overlay";
import { projectDocument, readProjectIdentity } from "./domain/workspace";
import { decodeUnifiedProject, encodeUnifiedProject } from "./domain/unified-project";
import { buildCrashDiagnostic, createRecoveryDownloadSnapshot, explainReactError, getLastSuccessfulRecoverySnapshot } from "./crash-recovery";
import { validateBeam } from "./domain/beams";
import { addManualCallout, deleteManualCallout, updateManualCallout } from "./domain/manual-callouts";
import { clampSplitRatio, type WorkspaceViewMode } from "./domain/workspace-layout";
type Visibility = {
  images: boolean;
  boxes: boolean;
  centers: boolean;
  axes: boolean;
  names: boolean;
  zones: boolean;
  slabs: boolean;
  walls: boolean;
  beams: boolean;
  shelves: boolean;
  stairs: boolean;
  openings: boolean;
  dimensions: boolean;
  devices: boolean;
  conduitReceptacle: boolean;
  conduitLighting: boolean;
  conduitNetwork: boolean;
  conduitSprinkler: boolean;
  conduitFireSignal: boolean;
  conduitSensor: boolean;
  conduitHvac: boolean;
  constructionAnnotations: boolean;
  pointPositionDimensions: boolean;
  conduits: boolean;
};
type CanvasState = {
  id: number;
  levelId: string;
  viewBox: ViewBox;
  rotation: number;
};
const visibilityDefault: Visibility = {
  images: true,
  boxes: false,
  centers: false,
  axes: false,
  names: false,
  zones: true,
  slabs: true,
  walls: true,
  beams: true,
  shelves: true,
  stairs: true,
  openings: true,
  dimensions: true,
  devices: true,
  conduitReceptacle: true,
  conduitLighting: false,
  conduitNetwork: false,
  conduitSprinkler: false,
  conduitFireSignal: false,
  conduitSensor: true,
  conduitHvac: true,
  constructionAnnotations: true,
  pointPositionDimensions: true,
  conduits: true,
};
const emptyView: ViewBox = { minX: -5, minZ: -5, width: 10, height: 10 };
const DEFAULT_CANVAS_ROTATION = 90;
const formatPanelLength = (valueMeters: number, unit: MeasurementUnit) => unit === "millimeters" ? `${formatMeasurement(valueMeters, unit)} mm` : formatMeasurement(valueMeters, unit);

class DebugErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null; componentStack: string; recoveryStatus: string }> {
  state: { error: Error | null; componentStack: string; recoveryStatus: string } = { error: null, componentStack: "", recoveryStatus: "" };
  private recoveryUsedFallback = false;

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[UI-render-crash]", error, info.componentStack);
    this.setState({ componentStack: info.componentStack || "未提供 React 组件栈" });
  }

  private downloadRecovery = async () => {
    try {
      const snapshot = createRecoveryDownloadSnapshot();
      if (!snapshot) return;
      this.recoveryUsedFallback = snapshot.usedFallback;
      const label = snapshot.usedFallback ? "pascal-conduit-recovery-last-successful.json" : "pascal-conduit-recovery.json";
      const result = await saveJsonFile(new Blob([JSON.stringify(snapshot.project, null, 2)], { type: "application/json" }), label);
      this.setState({ recoveryStatus: result === "cancelled" ? "已取消恢复 JSON 保存。" : `恢复快照时间：${snapshot.snapshotAt}${snapshot.usedFallback ? "（使用最近一次成功编码的快照）" : ""}` });
      if (result === "cancelled") return;
    } catch (error) {
      console.error("[recovery-project-export-failed]", error);
      this.setState({ recoveryStatus: `恢复 JSON 导出失败：${error instanceof Error ? error.message : String(error)}` });
    }
  };

  private downloadDiagnostic = async () => {
    const state = useOverlayStore.getState(), project = state.project;
    const recoverySnapshot = createRecoveryDownloadSnapshot() ?? getLastSuccessfulRecoverySnapshot();
    const recoveryUsedFallback = recoverySnapshot && "usedFallback" in recoverySnapshot ? Boolean(recoverySnapshot.usedFallback) : this.recoveryUsedFallback;
    const report = buildCrashDiagnostic({
      error: this.state.error!, componentStack: this.state.componentStack, buildLabel: __BUILD_LABEL__,
      url: window.location.href, userAgent: navigator.userAgent,
      projectId: project?.projectId ?? null, sourceSha: project?.revisionSha256 ?? null,
      projectDirty: state.projectDirty, overlayDirty: state.dirty,
      recoverySnapshotAt: recoverySnapshot?.snapshotAt ?? null,
      recoveryUsedFallback,
      recoveryProjectId: recoverySnapshot?.projectId ?? null, recoverySourceSha: recoverySnapshot?.sourceSha ?? null,
    });
    try {
      await saveJsonFile(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }), "pascal-conduit-crash-diagnostic.json");
      this.setState({ recoveryStatus: "诊断报告已下载。" });
    } catch (error) {
      console.error("[crash-diagnostic-export-failed]", error);
      this.setState({ recoveryStatus: `诊断报告导出失败：${error instanceof Error ? error.message : String(error)}` });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    const workspace = useOverlayStore.getState(), canRecover = Boolean((workspace.project && workspace.overlay) || getLastSuccessfulRecoverySnapshot());
    const explanation = explainReactError(this.state.error.message);
    return <main style={{ margin: 24, maxWidth: 900, fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
      <h1>页面渲染错误</h1>
      <p>构建版本：{__BUILD_LABEL__}</p>
      <p>{explanation}</p>
      {this.state.error.message.includes("Minified React error #") && <p>React 错误说明：<a href={this.state.error.message.match(/https:\/\/react\.dev\/errors\/\d+/)?.[0] ?? "https://react.dev/errors"} target="_blank" rel="noreferrer">React 官方错误说明</a></p>}
      <h2>原始错误与调用栈</h2>
      <pre data-debug-error="beam-white-screen">{`${this.state.error.name}: ${this.state.error.message}\n\n${this.state.error.stack || "未提供调用栈"}`}</pre>
      <h2>React 组件栈</h2>
      <pre>{this.state.componentStack || "正在读取组件栈…"}</pre>
      <p>当前项目：{workspace.project?.projectId ?? "无"}；源文件 SHA：{workspace.project?.revisionSha256 ?? "无"}；未保存：{workspace.projectDirty || workspace.dirty ? "是" : "否"}</p>
      <button disabled={!canRecover} onClick={() => void this.downloadRecovery()}>下载恢复 JSON</button>{!canRecover && <span> 尚无可恢复的已导入项目</span>}{" "}
      <button onClick={() => void this.downloadDiagnostic()}>下载诊断报告</button>{" "}
      <button onClick={() => window.location.reload()}>刷新并重试</button>
      {this.state.recoveryStatus && <p role="status">{this.state.recoveryStatus}</p>}
    </main>;
  }
}

function App() {
  const [data, setData] = useState<Parsed | null>(null),
    [file, setFile] = useState("未导入文件"),
    [sourceSha, setSourceSha] = useState(""),
    [canvases, setCanvases] = useState<CanvasState[]>([
      { id: 1, levelId: "", viewBox: emptyView, rotation: DEFAULT_CANVAS_ROTATION },
    ]),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [selectedDimension, setSelectedDimension] = useState<DimensionSegment | null>(null),
    [selectedManualId, setSelectedManualId] = useState<string | null>(null),
    [selectedCalloutId, setSelectedCalloutId] = useState<string | null>(null),
    [calloutTargetId, setCalloutTargetId] = useState<string | null>(null),
    [sceneVisibility, setSceneVisibility] = useState(createSceneVisibilityHistory),
    [manualMeasurements, setManualMeasurements] = useState<ManualMeasurement[]>([]),
    [measurementMode, setMeasurementMode] = useState<MeasurementMode>("off"),
    [measurementUnit, setMeasurementUnit] = useState<MeasurementUnit>("millimeters"),
    [pointAnnotationScale, setPointAnnotationScale] = useState(.5),
    [imageCropRevision, setImageCropRevision] = useState(0),
    [visibility, setVisibility] = useState(visibilityDefault),
    [workspaceViewMode, setWorkspaceViewMode] = useState<WorkspaceViewMode>("2d"),
    [builderSidebarWidth, setBuilderSidebarWidth] = useState(328),
    [builderSidebarOpen, setBuilderSidebarOpen] = useState(true),
    [builderSidebarTab, setBuilderSidebarTab] = useState<"systems" | "drawings">("systems"),
    [selectedBuilderSystem, setSelectedBuilderSystem] = useState<BuilderSystemId | null>(null),
    [builderSubmenu, setBuilderSubmenu] = useState<"systems" | "build" | null>(null),
    [builderAuthorCommand, setBuilderAuthorCommand] = useState<ThreeDAuthorCommand | null>(null),
    [builderPanelHost, setBuilderPanelHost] = useState<HTMLElement | null>(null),
    [constructionLegendHost, setConstructionLegendHost] = useState<HTMLDivElement | null>(null),
    [threeDActivated, setThreeDActivated] = useState(false),
    [splitRatio, setSplitRatio] = useState(45),
    [threeDOverlayVersion, setThreeDOverlayVersion] = useState(0);
  const input = useRef<HTMLInputElement>(null), nextMeasurementId = useRef(1), splitResize = useRef<{ startX: number; startRatio: number; width: number } | null>(null), builderSidebarResize = useRef<{ startX: number; width: number } | null>(null), nextBuilderCommandId = useRef(0);
  const nodes = data?.nodes || {};
  const conduitOverlay = useOverlayStore((state) => state.overlay);
  const conduitOverlayDirty = useOverlayStore((state) => state.dirty);
  const projectDirty = useOverlayStore((state) => state.projectDirty);
  const workspaceProject = useOverlayStore((state) => state.project);
  const loadWorkspace = useOverlayStore((state) => state.loadWorkspace);
  const commitConduitOverlay = useOverlayStore((state) => state.commit);
  const commitWorkspace = useOverlayStore((state) => state.commitWorkspace);
  const markProjectExported = useOverlayStore((state) => state.markProjectExported);
  const levels = Object.values(nodes).filter((n) => n.type === "level");
  const threeDScene = useMemo(() => data ? buildThreeDSceneInput(data) : null, [data]);
  const hiddenNodeIds = useMemo(() => new Set(sceneVisibility.hiddenNodeIds), [sceneVisibility.hiddenNodeIds]);
  useEffect(() => { const closeTransientUi = (event: KeyboardEvent) => { if (event.key !== "Escape") return; setMeasurementMode("off"); setCalloutTargetId(null); }; window.addEventListener("keydown", closeTransientUi); return () => window.removeEventListener("keydown", closeTransientUi); }, []);
  useEffect(() => {
    if (!projectDirty && !conduitOverlayDirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [projectDirty, conduitOverlayDirty]);
  useEffect(() => subscribeFloorplanImageCrop(() => setImageCropRevision((revision) => revision + 1)), []);
  useEffect(() => {
    if (!workspaceProject || JSON.stringify(data?.raw) === JSON.stringify(workspaceProject.raw)) return;
    const parsed = parseProject(workspaceProject.raw);
    parsed.diagnostics = [...parsed.diagnostics, ...inspectNodes(parsed.nodes)];
    setData(parsed);
    setFile(workspaceProject.fileName);
    setSourceSha(workspaceProject.revisionSha256);
  }, [workspaceProject, data?.raw]);
  const load = async (text: string, name: string) => {
    try {
      const sha256 = await sha256Text(text);
      const decoded = decodeUnifiedProject(JSON.parse(text), name, sha256);
      const importedProject = projectDocument(decoded.projectRaw, name, sha256);
      if (data && (projectDirty || conduitOverlayDirty) && !window.confirm("当前项目有未保存的更改；仍要打开另一份项目文件吗？")) return;
      const parsed = parseProject(decoded.projectRaw);
      parsed.diagnostics = [...parsed.diagnostics, ...inspectNodes(parsed.nodes)];
      const first =
        Object.values(parsed.nodes).find((n) => n.type === "level")?.id || "";
      setData(parsed);
      setFile(name);
      setSourceSha(sha256);
      loadWorkspace(importedProject, decoded.overlay);
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
    } catch (error) {
      window.alert(`无法打开项目：${error instanceof Error ? error.message : "文件不是有效的统一项目 JSON"}`);
    }
  };
  const exportProjectJson = async () => {
    if (!data?.raw || typeof data.raw !== "object" || !conduitOverlay) return;
    try {
      const unified = encodeUnifiedProject(data.raw as Record<string, unknown>, conduitOverlay);
      const projectText = JSON.stringify(unified, null, 2);
      const revisionSha256 = await sha256Text(projectText);
      const extension = file.toLowerCase().endsWith(".json") ? ".json" : "";
      const downloadedName = `${file.slice(0, extension ? -extension.length : undefined) || "project"}-export.json`;
      const result = await saveJsonFile(new Blob([projectText], { type: "application/json" }), downloadedName);
      if (result === "cancelled") return;
      const decoded = decodeUnifiedProject(unified, file, revisionSha256);
      const exported = projectDocument(decoded.projectRaw, file, revisionSha256);
      const nextParsed = parseProject(decoded.projectRaw);
      nextParsed.diagnostics = [...nextParsed.diagnostics, ...inspectNodes(nextParsed.nodes)];
      setData(nextParsed);
      setSourceSha(revisionSha256);
      commitWorkspace(exported, decoded.overlay, false, false);
      markProjectExported();
      useOverlayStore.getState().markExported();
    } catch (error) {
      window.alert(`无法保存项目：${error instanceof Error ? error.message : "未知错误"}`);
    }
  };
  const updateCanvas = (id: number, update: Partial<CanvasState>) =>
    setCanvases((current) =>
      current.map((canvas) =>
        canvas.id === id ? { ...canvas, ...update } : canvas,
      ),
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
  const toggleFireDrawingVisibility = () => setVisibility(current => {
    const visible = !fireDrawingIsVisible({ sprinkler: current.conduitSprinkler, "fire-signal": current.conduitFireSignal });
    const next = setFireDrawingVisibility({ sprinkler: current.conduitSprinkler, "fire-signal": current.conduitFireSignal }, visible);
    return { ...current, conduitSprinkler: next.sprinkler, conduitFireSignal: next["fire-signal"] };
  });
  const selectCanvasObject = (id: string | null) => {
    setSelectedId(id);
    setSelectedDimension(null);
    setSelectedManualId(null);
    setSelectedCalloutId(null);
  };
  const selectedCalloutTarget = selectedId && conduitOverlay ? manualCalloutTargetAnchor(nodes, conduitOverlay, selectedId) : null;
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
      if (document.querySelector('[data-point-position-dimension-selected="true"], [data-construction-annotation-selected="true"]')) return;
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
  const layerGroup = (title: string, entries: Partial<Record<keyof Visibility, string>>, footer?: React.ReactNode) => <details className="floating-layer-panel">
    <summary>{title}</summary>
    <div className="visibility">{Object.entries(entries).map(([key, label]) => <label key={key}><input aria-label={label} type="checkbox" checked={key === "conduitSprinkler" ? fireDrawingIsVisible({ sprinkler: visibility.conduitSprinkler, "fire-signal": visibility.conduitFireSignal }) : visibility[key as keyof Visibility]} onChange={() => key === "conduitSprinkler" ? toggleFireDrawingVisibility() : toggleVisibility(key as keyof Visibility)} />{label}</label>)}{footer}</div>
  </details>;
  const layerControls = <>
    {layerGroup("建筑图层", { walls: "墙体", beams: "梁", slabs: "楼板", openings: "门窗", stairs: "楼梯", images: "家具", zones: "空间名称", dimensions: "外围尺寸" })}
    {layerGroup("施工图层", { conduitReceptacle: "插座施工图", conduitLighting: "灯位接线盒施工图", conduitNetwork: "弱电施工图", conduitSprinkler: "消防施工图", conduitSensor: "传感器", conduitHvac: "空调施工图", conduits: "管道", pointPositionDimensions: "点位定位尺寸" }, <label className="construction-drawing-all"><input aria-label="全部施工图" type="checkbox" checked={allConstructionDrawingsSelected({ receptacle: visibility.conduitReceptacle, lighting: visibility.conduitLighting, network: visibility.conduitNetwork, sprinkler: visibility.conduitSprinkler, 'fire-signal': visibility.conduitFireSignal, sensor: visibility.conduitSensor }) && visibility.conduitHvac} onChange={(event) => { const next = setAllConstructionDrawings(event.target.checked); setVisibility(current => ({ ...current, conduitReceptacle: next.receptacle, conduitLighting: next.lighting, conduitNetwork: next.network, conduitSprinkler: next.sprinkler, conduitFireSignal: next['fire-signal'], conduitSensor: next.sensor ?? true, conduitHvac: event.target.checked })); }} />全部施工图</label>)}
    <label className="point-annotation-scale">点位标注比例 <input aria-label="点位标注比例" type="range" min="50" max="200" step="10" value={pointAnnotationScale * 100} onChange={(event) => setPointAnnotationScale(Number(event.target.value) / 100)} /><output>{Math.round(pointAnnotationScale * 100)}%</output></label>
  </>;
  const twoDPanel = <div className="builder-drawing-tools">
    <div className="builder-drawing-heading"><b>图纸工具</b><small>测量、标注与图层</small></div>
      <Inspector node={selectedId ? nodes[selectedId] : null} nodes={nodes} coverage={coverage} dimension={selectedDimension} manualMeasurement={manualMeasurements.find((item) => item.id === selectedManualId) ?? null} measurementUnit={measurementUnit} />
      <section className="two-d-tool-section">
        {layerControls}
        <label>全局单位 <select value={measurementUnit} onChange={(event) => setMeasurementUnit(event.target.value as MeasurementUnit)}><option value="millimeters">公制（mm / m²）</option><option value="feet-inches">英制（ft-in / ft²）</option></select></label>
        <button className={`measure-toggle ${measurementMode !== "off" ? "active" : ""}`} title="开启后点击两点测量；按一次 Shift 切换正交；Esc 退出" onClick={() => setMeasurementMode((current) => current === "off" ? "aligned" : "off")}>{measurementMode === "off" ? "测量" : "退出测量"}</button>
        <button className={calloutTargetId ? "active" : ""} disabled={!calloutTargetId&&!selectedCalloutTarget} title="选择对象后添加文字引线标注" onClick={() => { if(calloutTargetId){setCalloutTargetId(null);return;}if (selectedId && selectedCalloutTarget) { setMeasurementMode("off"); setCalloutTargetId(selectedId); } }}>{calloutTargetId ? "取消添加标注" : "添加标注"}</button>
      </section>
      <section className="two-d-tool-section" aria-label="对象隐藏">
        <button disabled={!isHideableSceneNode(selectedSceneNode)} onClick={hideSelectedSceneNode}>隐藏所选</button>
        <button disabled={!sceneVisibility.hiddenNodeIds.length} onClick={() => setSceneVisibility(restoreAllSceneNodes)}>恢复全部{sceneVisibility.hiddenNodeIds.length ? ` (${sceneVisibility.hiddenNodeIds.length})` : ""}</button>
        <div className="two-d-history-buttons"><button disabled={!sceneVisibility.undoStack.length} aria-label="撤销隐藏" onClick={() => setSceneVisibility(undoSceneVisibility)}>↶</button><button disabled={!sceneVisibility.redoStack.length} aria-label="重做隐藏" onClick={() => setSceneVisibility(redoSceneVisibility)}>↷</button></div>
      </section>
  </div>;
  const displayedCanvases = canvases.slice(0, 1);
  const activeCanvas = displayedCanvases[0];
  const activeLevelId = activeCanvas?.levelId || levels[0]?.id || "";
  const selectWorkspaceLevel = (levelId: string) => {
    if (!nodes[levelId] || nodes[levelId].type !== "level") return;
    setCanvases((current) => current.map((canvas, index) => index === 0 ? { ...canvas, levelId, viewBox: computeViewBox(nodes, levelId, visibility.dimensions) } : canvas));
  };
  const openBuilderTool = (card: Pick<BuilderCard, "tool" | "system" | "deviceType">) => {
    if (!data || !Object.keys(nodes).length) return;
    setBuilderSidebarOpen(true);
    setBuilderSidebarTab("systems");
    setThreeDActivated(true);
    if (workspaceViewMode === "2d") setWorkspaceViewMode("3d");
    setMeasurementMode("off");
    setBuilderAuthorCommand({ ...card, id: ++nextBuilderCommandId.current, catalogLock: catalogLockForBuilderCard(card) });
  };
  const sendBuilderTool = (tool: BuilderAuthorTool) => {
    if (!data || !Object.keys(nodes).length) return;
    setThreeDActivated(true);
    setBuilderAuthorCommand({ id: ++nextBuilderCommandId.current, tool });
    if (tool !== "select" && workspaceViewMode === "2d") setWorkspaceViewMode("3d");
  };
  const showBuilderTopView = () => {
    if (!data || !Object.keys(nodes).length) return;
    setThreeDActivated(true);
    if (workspaceViewMode === "2d") setWorkspaceViewMode("3d");
    setBuilderAuthorCommand({ id: ++nextBuilderCommandId.current, tool: null, viewPreset: "top" });
  };
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <b>Pascal 施工管线路由</b>
        </div>
        <div className="actions">
          <span className="build-version" title="当前页面的构建版本与时间">{__BUILD_LABEL__}</span>
          <button className="primary" onClick={() => input.current?.click()}>
            导入 JSON
          </button>
          <button disabled={!data?.raw || typeof data.raw !== "object"} onClick={() => void exportProjectJson()} title="保存统一项目 JSON，包含建筑、系统和图纸">
            导出项目 JSON
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
      <main className={`workspace conduit-workspace builder-workspace ${builderSidebarOpen ? "" : "builder-sidebar-hidden"}`} style={{ "--builder-sidebar-width": `${builderSidebarWidth}px` } as React.CSSProperties}>
        <aside className="builder-sidebar" aria-label="工作区常驻栏">
          <div className="builder-sidebar-heading"><div><span className="builder-eyebrow">WORKSPACE</span><b>设计工作区</b></div><button aria-label="隐藏常驻栏" onClick={() => setBuilderSidebarOpen(false)}>«</button></div>
          <div className="builder-sidebar-tabs" role="tablist" aria-label="左栏内容">
            <button role="tab" aria-selected={builderSidebarTab === "systems"} className={builderSidebarTab === "systems" ? "active" : ""} onClick={() => setBuilderSidebarTab("systems")}>系统</button>
            <button role="tab" aria-selected={builderSidebarTab === "drawings"} className={builderSidebarTab === "drawings" ? "active" : ""} onClick={() => setBuilderSidebarTab("drawings")}>图纸</button>
          </div>
          <div className="builder-sidebar-scroll">
              <div hidden={builderSidebarTab !== "systems"}>
              {selectedBuilderSystem && <>
              <div className="builder-system-heading"><span>{BUILDER_SYSTEMS.find((item) => item.id === selectedBuilderSystem)?.icon}</span><div><b>{BUILDER_SYSTEMS.find((item) => item.id === selectedBuilderSystem)?.label}系统</b><small>选择设备或绘制工具</small></div></div>
              {BUILDER_CARDS[selectedBuilderSystem].length ? <div className="builder-card-sections" aria-label={`${BUILDER_SYSTEMS.find((item) => item.id === selectedBuilderSystem)?.label}工具`}>
                {(["place", "draw", "edit"] as const satisfies readonly BuilderCardSection[]).map((section) => {
                  const cards = BUILDER_CARDS[selectedBuilderSystem].filter((card) => card.section === section);
                  if (!cards.length) return null;
                  return <section className="builder-card-section" key={section} aria-label={BUILDER_CARD_SECTION_LABELS[section]}><h3>{BUILDER_CARD_SECTION_LABELS[section]}</h3><div className="builder-card-grid">
                    {cards.map((card) => <button key={`${card.tool}-${card.deviceType ?? card.system ?? ""}`} className="builder-device-card" disabled={!data || !Object.keys(nodes).length} title={!data ? "导入项目后可使用" : card.label} onClick={() => openBuilderTool(card)}><span aria-hidden="true">{card.icon}</span><b>{card.label}</b></button>)}
                  </div></section>;
                })}
              </div> : <div className="builder-system-empty"><span aria-hidden="true">◇</span><b>当前版本暂无编辑工具</b><p>可查看并保留导入的系统数据。后续工具将在此显示。</p></div>}
              </>}
              <div className="builder-author-panel-host" hidden={!selectedBuilderSystem || !BUILDER_CARDS[selectedBuilderSystem].length} ref={setBuilderPanelHost} />
              </div>
            <div hidden={builderSidebarTab !== "drawings"} id="builder-drawings-panel" className="builder-drawings-panel">{twoDPanel}</div>
          </div>
        </aside>
        <div className="builder-sidebar-resizer" role="separator" aria-label="调整常驻栏宽度" aria-orientation="vertical" aria-valuemin={260} aria-valuemax={560} aria-valuenow={builderSidebarWidth} tabIndex={0}
          onPointerDown={(event) => { builderSidebarResize.current = { startX: event.clientX, width: builderSidebarWidth }; event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerMove={(event) => { if (builderSidebarResize.current) setBuilderSidebarWidth(Math.max(260, Math.min(560, builderSidebarResize.current.width + event.clientX - builderSidebarResize.current.startX))); }}
          onPointerUp={(event) => { builderSidebarResize.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
          onPointerCancel={() => { builderSidebarResize.current = null; }}
          onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setBuilderSidebarWidth((width) => Math.max(260, Math.min(560, width + (event.key === "ArrowLeft" ? -16 : 16)))); } }} />
        <section className="canvas-workspace">
          {!builderSidebarOpen && <button className="builder-sidebar-reopen" onClick={() => setBuilderSidebarOpen(true)} aria-label="显示常驻栏">» <span>工具</span></button>}
          <div className="builder-view-controls" aria-label="视图与楼层">
            <div className="workspace-view-toggle builder-view-toggle" role="group" aria-label="工作区视图">
              <button className={workspaceViewMode === "3d" ? "active" : ""} disabled={!data || !Object.keys(nodes).length} onClick={() => { setThreeDActivated(true); setWorkspaceViewMode("3d"); setMeasurementMode("off"); }}>3D</button>
              <button className={workspaceViewMode === "2d" ? "active" : ""} onClick={() => { setWorkspaceViewMode("2d"); setMeasurementMode("off"); }}>2D</button>
              <button className={workspaceViewMode === "split" ? "active" : ""} disabled={!data || !Object.keys(nodes).length} onClick={() => { setThreeDActivated(true); setWorkspaceViewMode("split"); setMeasurementMode("off"); }}>分屏</button>
          </div>
            <label className="builder-level-select">
              <span className="sr-only">楼层</span>
              <select aria-label="楼层" value={activeLevelId} disabled={!levels.length} onChange={(event) => selectWorkspaceLevel(event.target.value)}>
                {!levels.length && <option value="">无楼层</option>}
                {levels.map((level) => <option key={level.id} value={level.id}>{level.name || level.id}</option>)}
              </select>
            </label>
          </div>
          <div className={`workspace-views mode-${workspaceViewMode}`} style={{ "--split-ratio": `${splitRatio}%` } as React.CSSProperties}>
          <div className={`workspace-view-pane workspace-view-pane-2d ${workspaceViewMode === "3d" ? "workspace-view-pane-hidden" : ""}`}>
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
                measurementMode={measurementMode}
                measurementUnit={measurementUnit}
                pointAnnotationScale={pointAnnotationScale}
                constructionLegendHost={workspaceViewMode === "3d" ? null : constructionLegendHost}
                manualMeasurements={manualMeasurements.filter((item) => item.levelId === (canvas.levelId || levels[0]?.id || ""))}
                selectedManualId={selectedManualId}
                selectedCalloutId={selectedCalloutId}
                calloutTargetId={calloutTargetId}
                onSelect={selectCanvasObject}
                onSelectDimension={(dimension) => { setSelectedId(null); setSelectedDimension(dimension); setSelectedManualId(null); }}
                onCreateMeasurement={(measurement) => { const created = { ...measurement, id: `measure-${nextMeasurementId.current++}`, createdAt: Date.now() }; setManualMeasurements((current) => [...current, created]); setSelectedId(null); setSelectedDimension(null); setSelectedManualId(created.id); }}
                onSelectManual={(id) => { setSelectedId(null); setSelectedDimension(null); setSelectedManualId(id); }}
                onDeleteManual={(id) => { setManualMeasurements((current) => current.filter((item) => item.id !== id)); setSelectedManualId((current) => current === id ? null : current); }}
                onCreateCallout={(value) => { if (!conduitOverlay) return null; const result=addManualCallout(conduitOverlay,value);commitConduitOverlay(result.overlay);setCalloutTargetId(null);setSelectedId(null);setSelectedCalloutId(result.callout.id);return result.callout.id; }}
                onUpdateCallout={(id,update) => { if(conduitOverlay)commitConduitOverlay(updateManualCallout(conduitOverlay,id,update)); }}
                onDeleteCallout={(id) => { if(conduitOverlay)commitConduitOverlay(deleteManualCallout(conduitOverlay,id));setSelectedCalloutId(current=>current===id?null:current); }}
                onSelectCallout={(id) => { setSelectedId(null);setSelectedDimension(null);setSelectedManualId(null);setSelectedCalloutId(id); }}
                onUpdatePointPositionDimensionLabel={(id, position, lineOffset) => { if (conduitOverlay) commitConduitOverlay({ ...conduitOverlay, pointPositionDimensionLabelPositions: { ...conduitOverlay.pointPositionDimensionLabelPositions, [id]: position }, pointPositionDimensionLineOffsets: { ...conduitOverlay.pointPositionDimensionLineOffsets, [id]: lineOffset } }); }}
                onUpdateConstructionAnnotationLabel={(id, label, signature) => { if (conduitOverlay) commitConduitOverlay({ ...conduitOverlay, constructionAnnotationLabelPositions: { ...conduitOverlay.constructionAnnotationLabelPositions, [id]: label }, constructionAnnotationLabelPlacementSignatures: { ...conduitOverlay.constructionAnnotationLabelPlacementSignatures, [id]: signature } }); }}
                onUpdate={updateCanvas}
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
            <ThreeDWorkspace key={threeDOverlayVersion} scene={threeDScene} hiddenNodeIds={hiddenNodeIds} selectedId={selectedId} onSelect={selectCanvasObject} sourceFile={file} sourceSha={sourceSha} projectId={readProjectIdentity(data?.raw)} authorCommand={builderAuthorCommand} panelHost={builderPanelHost} activeLevelId={activeLevelId} keyboardActive={workspaceViewMode !== "2d"} selectedBuilderSystem={selectedBuilderSystem} onAuthoringSystemChange={system => { setSelectedBuilderSystem(system); setBuilderSidebarOpen(true); setBuilderSidebarTab("systems"); }} />
          </div>}
          </div>
          <div className="builder-toolbar-stack">
            {workspaceViewMode !== "3d" && <div className="builder-construction-legend-host" ref={setConstructionLegendHost} />}
            {builderSubmenu === "systems" && <div className="builder-subtoolbar" role="group" aria-label="系统分类">{BUILDER_SYSTEMS.map((item) => <button key={item.id} className={selectedBuilderSystem === item.id ? "active" : ""} aria-pressed={selectedBuilderSystem === item.id} onClick={() => { setSelectedBuilderSystem(item.id); setBuilderSidebarOpen(true); setBuilderSidebarTab("systems"); }}><span aria-hidden="true">{item.icon}</span><b>{item.label}</b></button>)}</div>}
            {builderSubmenu === "build" && <div className="builder-subtoolbar builder-build-subtoolbar" role="group" aria-label="建造工具"><button onClick={() => openBuilderTool({ tool: "beam" })} disabled={!data} aria-label="梁"><span aria-hidden="true">▰</span><b>梁</b></button><span className="builder-unavailable-caption">其他建筑工具将在 Builder 合并后接入</span></div>}
            <nav className="builder-main-toolbar" aria-label="Builder 主操作栏">
              <button aria-label="选择" title="选择" onClick={() => sendBuilderTool("select")}><span>➤</span><small>选择</small></button>
              <button disabled title="暂不可用：框选"><span>⬚</span><small>框选</small></button>
              <button disabled title="暂不可用：编辑场地"><span>♧</span><small>场地</small></button>
              <button className={builderSubmenu === "build" ? "active" : ""} aria-expanded={builderSubmenu === "build"} onClick={() => setBuilderSubmenu((current) => current === "build" ? null : "build")}><span>⚒</span><small>建造</small></button>
              <button disabled title="暂不可用：布置普通 Item"><span>▰</span><small>布置</small></button>
              <button className={builderSubmenu === "systems" ? "active" : ""} aria-expanded={builderSubmenu === "systems"} onClick={() => { setBuilderSubmenu((current) => current === "systems" ? null : "systems"); setBuilderSidebarOpen(true); setBuilderSidebarTab("systems"); }}><span>⌁</span><small>系统</small></button>
              <button disabled title="暂不可用：绘制 Zone"><span>⬡</span><small>区域</small></button>
              <button title="删除网络对象" onClick={() => sendBuilderTool("delete")} disabled={!data}><span>⌫</span><small>删除</small></button>
              <i aria-hidden="true" />
              <button disabled title="暂不可用：网络吸附"><span>⊞</span><small>吸附</small></button>
              <button disabled title="暂不可用：参考图"><span>▧</span><small>参考图</small></button>
              <i aria-hidden="true" />
              <button disabled={workspaceViewMode === "3d" || !displayedCanvases.length} title="顺时针旋转 2D 图纸" onClick={() => { const canvas = displayedCanvases[0]; if (canvas) updateCanvas(canvas.id, { rotation: (canvas.rotation + 90) % 360 }); }}><span>↻</span><small>顺时针</small></button>
              <button disabled={workspaceViewMode === "3d" || !displayedCanvases.length} title="逆时针旋转 2D 图纸" onClick={() => { const canvas = displayedCanvases[0]; if (canvas) updateCanvas(canvas.id, { rotation: (canvas.rotation + 270) % 360 }); }}><span>↺</span><small>逆时针</small></button>
              <button disabled={!data} title="3D 顶视图" onClick={showBuilderTopView}><span>⬆</span><small>顶视图</small></button>
            </nav>
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
  onSelect,
  onSelectDimension,
  measurementMode,
  measurementUnit,
  pointAnnotationScale,
  constructionLegendHost,
  manualMeasurements,
  selectedManualId,
  selectedCalloutId,
  calloutTargetId,
  onCreateMeasurement,
  onSelectManual,
  onDeleteManual,
  onCreateCallout,
  onUpdateCallout,
  onDeleteCallout,
  onSelectCallout,
  onUpdatePointPositionDimensionLabel,
  onUpdateConstructionAnnotationLabel,
  onUpdate,
}: {
  canvas: CanvasState;
  nodes: Record<string, NodeData>;
  levels: NodeData[];
  visibility: Visibility;
  hiddenNodeIds: ReadonlySet<string>;
  conduitOverlay: ConduitOverlayDocument | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onSelectDimension: (dimension: DimensionSegment) => void;
  measurementMode: MeasurementMode;
  measurementUnit: MeasurementUnit;
  pointAnnotationScale: number;
  constructionLegendHost: HTMLDivElement | null;
  manualMeasurements: ManualMeasurement[];
  selectedManualId: string | null;
  selectedCalloutId: string | null;
  calloutTargetId: string | null;
  onCreateMeasurement: (measurement: Omit<ManualMeasurement, "id" | "createdAt">) => void;
  onSelectManual: (id: string | null) => void;
  onDeleteManual: (id: string) => void;
  onCreateCallout: (value: Omit<ManualCallout,'id'|'createdAt'>) => string | null;
  onUpdateCallout: (id: string, update: Partial<Pick<ManualCallout,'text'|'label'>>) => void;
  onDeleteCallout: (id: string) => void;
  onSelectCallout: (id: string) => void;
  onUpdatePointPositionDimensionLabel: (id: string, position: number, lineOffset: number) => void;
  onUpdateConstructionAnnotationLabel: (id: string, label: [number, number], signature: string) => void;
  onUpdate: (id: number, u: Partial<CanvasState>) => void;
}) {
  const levelId = canvas.levelId || levels[0]?.id || "";
  return (
    <article className="canvas-card">
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
        onSelect={onSelect}
        onSelectDimension={onSelectDimension}
        measurementMode={measurementMode}
        measurementUnit={measurementUnit}
        pointAnnotationScale={pointAnnotationScale}
        constructionLegendHost={constructionLegendHost}
        manualMeasurements={manualMeasurements}
        selectedManualId={selectedManualId}
        selectedCalloutId={selectedCalloutId}
        calloutTargetId={calloutTargetId}
        onCreateMeasurement={onCreateMeasurement}
        onSelectManual={onSelectManual}
        onDeleteManual={onDeleteManual}
        onCreateCallout={onCreateCallout}
        onUpdateCallout={onUpdateCallout}
        onDeleteCallout={onDeleteCallout}
        onSelectCallout={onSelectCallout}
        onUpdatePointPositionDimensionLabel={onUpdatePointPositionDimensionLabel}
        onUpdateConstructionAnnotationLabel={onUpdateConstructionAnnotationLabel}
      />
    </article>
  );
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
  return zoomExtents(points, includeDimensions ? 2.5 : 1);
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
  onSelect,
  onSelectDimension,
  measurementMode,
  measurementUnit,
  pointAnnotationScale,
  constructionLegendHost,
  manualMeasurements,
  selectedManualId,
  selectedCalloutId,
  calloutTargetId,
  onCreateMeasurement,
  onSelectManual,
  onDeleteManual,
  onCreateCallout,
  onUpdateCallout,
  onDeleteCallout,
  onSelectCallout,
  onUpdatePointPositionDimensionLabel,
  onUpdateConstructionAnnotationLabel,
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
  onSelect: (id: string | null) => void;
  onSelectDimension: (dimension: DimensionSegment) => void;
  measurementMode: MeasurementMode;
  measurementUnit: MeasurementUnit;
  pointAnnotationScale: number;
  constructionLegendHost: HTMLDivElement | null;
  manualMeasurements: ManualMeasurement[];
  selectedManualId: string | null;
  selectedCalloutId: string | null;
  calloutTargetId: string | null;
  onCreateMeasurement: (measurement: Omit<ManualMeasurement, "id" | "createdAt">) => void;
  onSelectManual: (id: string | null) => void;
  onDeleteManual: (id: string) => void;
  onCreateCallout: (value: Omit<ManualCallout,'id'|'createdAt'>) => string | null;
  onUpdateCallout: (id: string, update: Partial<Pick<ManualCallout,'text'|'label'>>) => void;
  onDeleteCallout: (id: string) => void;
  onSelectCallout: (id: string) => void;
  onUpdatePointPositionDimensionLabel: (id: string, position: number, lineOffset: number) => void;
  onUpdateConstructionAnnotationLabel: (id: string, label: [number, number], signature: string) => void;
}) {
  const drag = useRef<{ x: number; y: number; box: ViewBox; moved: boolean } | null>(null), suppressClick = useRef(false), planRef = useRef<HTMLDivElement>(null), svgRef = useRef<SVGSVGElement>(null), sceneRef = useRef<SVGGElement>(null), viewBoxRef = useRef(viewBox), setViewBoxRef = useRef(setViewBox), safariGesture = useRef<{ scale: number } | null>(null),
    [measurementStart, setMeasurementStart] = useState<MeasurementSnap | null>(null),
    [measurementHover, setMeasurementHover] = useState<MeasurementSnap | null>(null),
    [orthogonalLock, setOrthogonalLock] = useState(false),
    [calloutHover,setCalloutHover]=useState<[number,number]|null>(null),
    [autoEditCalloutId,setAutoEditCalloutId]=useState<string|null>(null),
    [calloutDrag,setCalloutDrag]=useState<{id:string;label:[number,number];pointerId:number}|null>(null),
    [drawingSelectionClearVersion,setDrawingSelectionClearVersion]=useState(0),
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
  const systemVisibility = useMemo(() => ({ receptacle: visibility.conduitReceptacle, lighting: visibility.conduitLighting, network: visibility.conduitNetwork, sprinkler: visibility.conduitSprinkler, 'fire-signal': visibility.conduitFireSignal }), [visibility.conduitReceptacle, visibility.conduitLighting, visibility.conduitNetwork, visibility.conduitSprinkler, visibility.conduitFireSignal]);
  const constructionPlan = useConstructionPlan({ nodes, overlay: conduitOverlay, levelId, hiddenNodeIds, unit: measurementUnit, rotation, viewBox, planRef, selectedId, exterior: exteriorDimensions, dimensionsVisible: visibility.dimensions, measurements: manualMeasurements, systemVisibility, sensorVisible: visibility.conduitSensor, devicesVisible: visibility.devices, hvacVisible: visibility.conduitHvac, annotationScale: pointAnnotationScale });
  viewBoxRef.current = viewBox;
  setViewBoxRef.current = setViewBox;
  const snapSegments = useMemo(() => buildMeasurementSnapSegments(nodes, levelId), [nodes, levelId]);
  const activeMeasurementMode = resolveMeasurementMode(measurementStart?.point ?? null, measurementHover?.point ?? null, orthogonalLock);
  const calloutTarget=calloutTargetId&&conduitOverlay?manualCalloutTargetAnchor(nodes,conduitOverlay,calloutTargetId):null;
  const visibleCallouts=(conduitOverlay?.manualCallouts??[]).filter(item=>manualCalloutTargetAnchor(nodes,conduitOverlay,item.targetId)?.levelId===levelId&&!hiddenNodeIds.has(item.targetId)&&(()=>{const device=conduitOverlay?.devices.find(d=>d.id===item.targetId);if(device)return visibility.devices&&(device.deviceType==='sensor'?visibility.conduitSensor:device.systems.some(system=>systemVisibility[system]));const segment=conduitOverlay?.segments.find(s=>s.id===item.targetId);if(segment)return visibility.conduits&&systemVisibility[segment.system];const fitting=conduitOverlay?.fittings.find(f=>f.id===item.targetId);if(fitting)return visibility.conduits&&systemVisibility[fitting.system];const box=conduitOverlay?.junctionBoxes.find(b=>b.id===item.targetId);if(box)return visibility.devices&&systemVisibility[box.system];const node=nodes[item.targetId];if(!node)return false;return node.type==='wall'?visibility.walls:node.type==='slab'?visibility.slabs:node.type==='door'||node.type==='window'?visibility.openings:node.type==='stair'?visibility.stairs:node.type==='zone'?visibility.zones:node.type==='item'?visibility.images:node.type==='shelf'?(visibility.shelves||visibility.centers):true;})()).map(item=>({...item,anchor:manualCalloutTargetAnchor(nodes,conduitOverlay,item.targetId)!.anchor,label:calloutDrag?.id===item.id?calloutDrag.label:item.label}));
  useEffect(() => { setMeasurementStart(null); setMeasurementHover(null); setOrthogonalLock(false); }, [measurementMode, levelId]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if(event.target instanceof HTMLElement&&(event.target.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName)))return;
      if (event.key === "Shift" && !event.repeat) setOrthogonalLock((locked) => !locked);
      if (event.key === "Escape") { setMeasurementStart(null); setMeasurementHover(null); setDrawingSelectionClearVersion(version=>version+1); onSelect(null); }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedManualId) { event.preventDefault(); onDeleteManual(selectedManualId); }
      else if ((event.key === "Delete" || event.key === "Backspace") && selectedCalloutId) { event.preventDefault(); onDeleteCallout(selectedCalloutId); }
    };
    window.addEventListener("keydown", onKeyDown); return () => { window.removeEventListener("keydown", onKeyDown); };
  }, [selectedManualId, selectedCalloutId, onDeleteManual, onDeleteCallout]);
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
        if (measurementMode !== "off" || calloutTargetId || e.button !== 0) return;
        drag.current = { x: e.clientX, y: e.clientY, box: viewBox, moved: false };
      }}
      onPointerMove={(e) => {
        if (measurementMode !== "off" || calloutTargetId) return;
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
        onPointerMove={(event) => { const point=eventWorldPoint(event);if(calloutTargetId){setCalloutHover(point);return;}if (measurementMode !== "off") { const snap = snapAtEvent(event); if (snap) setMeasurementHover(snap); } }}
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
          if(calloutTargetId&&calloutTarget&&calloutHover){event.preventDefault();event.stopPropagation();const id=onCreateCallout(newManualCalloutDraft(calloutTargetId,calloutTarget.levelId,calloutTarget.anchor,calloutHover));setAutoEditCalloutId(id);setCalloutHover(null);return;}
          if (measurementMode === "off") return;
          event.preventDefault(); event.stopPropagation();
          const snap = snapAtEvent(event); if (snap) commitMeasurementPoint(snap);
        }}
        onClick={(event) => { if (!(event.target as Element).closest("[data-selectable]")) { onSelect(null); onSelectManual(null); setDrawingSelectionClearVersion(version=>version+1); } }}>
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
          fill="#fdfdfc"
        />
        <g ref={sceneRef} style={{ transform: `rotate(${rotation}deg)`, transformOrigin: `${cx}px ${cz}px`, transition: "transform 240ms cubic-bezier(.2,.8,.2,1)" }}>
          {visibility.slabs && rendered.filter((n) => n.type === "slab" && n.visible !== false).map((n) => <Slab key={n.id} node={n} selected={selectedId === n.id} onSelect={onSelect} />)}
          {visibility.zones &&
            zones.map((n) => <Polygon key={n.id} node={n} onSelect={onSelect} />)}
          {visibility.beams && rendered.filter((n) => n.type === "beam" && validateBeam(n, nodes).valid).map((n) => <BeamFootprint key={n.id} node={n} selected={selectedId === n.id} penetrations={(conduitOverlay?.penetrations ?? []).filter((item) => item.hostKind === "beam" && item.hostId === n.id)} onSelect={onSelect} />)}
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
          <ConstructionDrawingLayoutPersistence plan={constructionPlan} />
          <ConduitPlanOverlay overlay={conduitOverlay} levelId={levelId} selectedId={selectedId} onSelect={onSelect} context={constructionPlan.context} scale={constructionPlan.scale} rotation={rotation} devicesVisible={visibility.devices} conduitsVisible={visibility.conduits} hvacVisible={visibility.conduitHvac} annotationScale={pointAnnotationScale} deviceVariants={constructionPlan.deviceVariants} />
          {visibility.beams && rendered.filter((n) => n.type === "beam" && validateBeam(n, nodes).valid).map((n) => <BeamFootprint key={`visual-${n.id}`} node={n} selected={selectedId === n.id} penetrations={(conduitOverlay?.penetrations ?? []).filter((item) => item.hostKind === "beam" && item.hostId === n.id)} onSelect={onSelect} visualOnly />)}
          {visibility.pointPositionDimensions && <PointPositionDimensions dimensions={constructionPlan.positionDimensions} unit={measurementUnit} viewRotation={rotation} annotationScale={pointAnnotationScale} onSelect={onSelect} labelPositions={conduitOverlay?.pointPositionDimensionLabelPositions} lineOffsets={conduitOverlay?.pointPositionDimensionLineOffsets} onPositionChange={onUpdatePointPositionDimensionLabel} toPlanPoint={(clientX,clientY)=>eventWorldPoint({clientX,clientY})} selectionClearVersion={drawingSelectionClearVersion} />}
          {visibility.constructionAnnotations && <ConstructionAnnotations plan={constructionPlan} rotation={rotation} onSelect={onSelect} onLabelPositionChange={onUpdateConstructionAnnotationLabel} toPlanPoint={(clientX,clientY)=>eventWorldPoint({clientX,clientY})} selectionClearVersion={drawingSelectionClearVersion} />}
          {conduitOverlay && visibility.conduitHvac && <HvacSectionCallouts overlay={conduitOverlay} levelId={levelId} rotation={rotation} annotationScale={pointAnnotationScale} labelPositions={conduitOverlay.constructionAnnotationLabelPositions} onLabelPositionChange={onUpdateConstructionAnnotationLabel} toPlanPoint={(clientX,clientY)=>eventWorldPoint({clientX,clientY})}/>}
          <ManualCallouts callouts={visibleCallouts} preview={calloutTarget&&calloutHover?{anchor:calloutTarget.anchor,label:calloutHover}:null} rotation={rotation} annotationScale={pointAnnotationScale} selectedId={selectedCalloutId} autoEditId={autoEditCalloutId} onSelect={onSelectCallout} onUpdate={onUpdateCallout} onDelete={onDeleteCallout} onEditFinished={()=>setAutoEditCalloutId(null)} onMoveStart={(id,event)=>{event.stopPropagation();event.currentTarget.setPointerCapture(event.pointerId);const item=visibleCallouts.find(callout=>callout.id===id);if(item)setCalloutDrag({id,label:item.label,pointerId:event.pointerId});onSelectCallout(id);}} onMove={event=>{if(!calloutDrag||event.pointerId!==calloutDrag.pointerId)return;const point=eventWorldPoint(event);if(point)setCalloutDrag({...calloutDrag,label:point});}} onMoveEnd={event=>{if(!calloutDrag||event.pointerId!==calloutDrag.pointerId)return;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);onUpdateCallout(calloutDrag.id,{label:eventWorldPoint(event)??calloutDrag.label});setCalloutDrag(null);}}/>
          <ManualMeasurements measurements={manualMeasurements} preview={measurementMode !== "off" && measurementStart && measurementHover ? { mode: activeMeasurementMode, start: measurementStart, end: measurementHover } : null} unit={measurementUnit} viewRotation={rotation} selectedId={selectedManualId} onSelect={onSelectManual} onDelete={onDeleteManual} />
          {measurementMode !== "off" && measurementHover && <SnapIndicator snap={measurementHover} active={Boolean(measurementStart)} />}
        </g>
      </svg>
      {constructionLegendHost && createPortal(<ConstructionLegend sections={constructionPlan.installationSchedule} annotationScale={pointAnnotationScale} />, constructionLegendHost)}
      {measurementMode !== "off" && <div className="measure-hint">{measurementStart ? `${orthogonalLock ? activeMeasurementMode === "horizontal" ? "水平正交已开启" : "垂直正交已开启" : "自由对齐"} · 点击第二点 · Shift 切换正交 · Esc 退出` : `${orthogonalLock ? "正交已开启" : "正交已关闭"} · 点击第一点 · Shift 切换正交 · Esc 退出`}</div>}
      {calloutTargetId&&<div className="measure-hint">移动鼠标确定引线位置 · 单击放置 · Esc 取消</div>}
      {visibility.constructionAnnotations && <ConstructionNotices plan={constructionPlan} onFocus={(id, anchor) => { onSelect(id); if (anchor) setViewBox({ minX: anchor[0] - 3, minZ: anchor[1] - 3, width: 6, height: 6 }); }} />}
      <Compass rotation={rotation} />
      <div className="legend">{formatPanelLength(viewBox.width, measurementUnit)} × {formatPanelLength(viewBox.height, measurementUnit)}</div>
    </div>
  );
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
  const polygon = zonePoints(node), color = "#888888";
  if (polygon.length < 3) return null;
  const points = polygon.map((point) => `${point.x},${point.z}`).join(" ");
  return <polygon data-selectable points={points} fill={color} fillOpacity=".015" stroke={color} strokeOpacity=".12" strokeWidth=".03" onClick={() => onSelect(node.id)} />;
}
function ZoneLabel({ node, viewRotation }: { node: NodeData; viewRotation: number }) {
  const label = zoneLabelPoint(node), color = "#565656";
  if (!label) return null;
  return <text x={label.x} y={label.z} className="zone-label" fontSize=".22" fontWeight="700" textAnchor="middle" dominantBaseline="middle" style={{ fill: color, transform: `rotate(${-viewRotation}deg)`, transformOrigin: `${label.x}px ${label.z}px`, transition: "transform 240ms cubic-bezier(.2,.8,.2,1)" }} stroke="#ffffff" strokeWidth=".035" strokeOpacity=".9" paintOrder="stroke" pointerEvents="none">{node.name || "Zone"}</text>;
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
  return <path data-selectable d={geometry.path} fill={selected ? "#dbe8dc" : "#fafaf9"} fillRule="evenodd" clipRule="evenodd" stroke={selected ? "#e75c3c" : "#d2d2cf"} strokeWidth={selected ? ".04" : ".018"} opacity=".78" onClick={() => onSelect(node.id)} />;
}
function BeamFootprint({ node, selected, penetrations, onSelect, visualOnly = false }: { node: NodeData; selected: boolean; penetrations: ConduitOverlayDocument["penetrations"]; onSelect: (id: string) => void; visualOnly?: boolean }) {
  const start = Array.isArray(node.start) ? node.start : [], end = Array.isArray(node.end) ? node.end : [], width = Number(node.width);
  if (!Number.isFinite(start[0]) || !Number.isFinite(start[1]) || !Number.isFinite(end[0]) || !Number.isFinite(end[1]) || !Number.isFinite(width) || width <= 0) return null;
  const dx = end[0] - start[0], dz = end[1] - start[1], length = Math.hypot(dx, dz);
  if (length < 1e-8) return null;
  const x = (start[0] + end[0]) / 2, z = (start[1] + end[1]) / 2, rotation = Math.atan2(dz, dx) * 180 / Math.PI;
  return <g data-selectable={visualOnly ? undefined : "beam"} transform={`translate(${x} ${z}) rotate(${rotation})`} pointerEvents={visualOnly ? "none" : undefined} onClick={visualOnly ? undefined : (event) => { event.stopPropagation(); onSelect(node.id); }}><rect x={-length / 2} y={-width / 2} width={length} height={width} fill={selected ? "#fb923c" : "#818894"} stroke={selected ? "#c2410c" : "#525a65"} strokeWidth={selected ? ".06" : ".025"} opacity=".76" />{penetrations.map((penetration) => { const px = penetration.entry.position[0] - x, pz = penetration.entry.position[2] - z, localX = px * Math.cos(-rotation * Math.PI / 180) - pz * Math.sin(-rotation * Math.PI / 180), localZ = px * Math.sin(-rotation * Math.PI / 180) + pz * Math.cos(-rotation * Math.PI / 180); return <g key={penetration.id}><circle cx={localX} cy={localZ} r={penetration.diameterMm / 2000} fill="#f8fafc" stroke="#111827" strokeWidth=".02" />{selected && <text x={localX} y={localZ - .12} textAnchor="middle" fontSize=".12" fill="#111827">Ø{penetration.diameterMm} · {penetration.segmentId}</text>}</g>; })}</g>;
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
        fill={selected ? "#e75c3c" : "#dededb"}
        stroke="#454545"
        strokeWidth="1.3"
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
    {(visibility.boxes || selected) && <rect x={-data.width / 2} y={-data.depth / 2} width={data.width} height={data.depth} fill="none" stroke={selected ? "#e75c3c" : "#9b9b98"} strokeWidth={selected ? ".06" : ".025"} />}
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
    const color = selected ? "#e75c3c" : "#666666",
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
      return <React.Fragment key={key}><line x1={hingeX} y1="0" x2={openTipX} y2={openTipY} stroke={color} strokeWidth={selected ? "2.4" : "1.1"} vectorEffect="non-scaling-stroke"/><path d={`M ${closedTipX} 0 A ${radius} ${radius} 0 0 ${sweepFlag} ${openTipX} ${openTipY}`} fill="none" stroke={color} strokeWidth={selected ? "1.6" : ".8"} strokeDasharray="5 4" strokeLinecap="round" vectorEffect="non-scaling-stroke"/></React.Fragment>;
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
        stroke={selected ? "#e75c3c" : "#666666"}
        strokeWidth={selected ? 0.045 : 0.025}
      />
      <line x1={-width / 2} x2={width / 2} stroke="#888888" strokeWidth=".025" />
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
      {visibility.images && imageUrl && cropEntry?.fallbackReason !== "image-load-failed" && (
        cropEntry && cropPlacement
          ? <svg x={-dimensions.width / 2 + cropPlacement.offsetX} y={-dimensions.depth / 2 + cropPlacement.offsetY} width={cropPlacement.drawWidth} height={cropPlacement.drawHeight} viewBox={`${cropEntry.cropX} ${cropEntry.cropY} ${cropEntry.cropWidth} ${cropEntry.cropHeight}`} preserveAspectRatio="none" overflow="hidden"><image href={imageUrl} x="0" y="0" width={cropEntry.naturalWidth} height={cropEntry.naturalHeight} preserveAspectRatio="xMidYMid meet" /></svg>
          : <image href={imageUrl} x={-dimensions.width / 2} y={-dimensions.depth / 2} width={dimensions.width} height={dimensions.depth} preserveAspectRatio="none" />
      )}
      {(visibility.boxes || selected || (visibility.images && (!imageUrl || cropEntry?.isFallback))) && (
        <rect
          x={-dimensions.width / 2}
          y={-dimensions.depth / 2}
          width={dimensions.width}
          height={dimensions.depth}
          fill="none"
          stroke={selected ? "#e75c3c" : "#9b9b98"}
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
            stroke="#a0a09d"
            strokeWidth=".025"
          />
          <line
            x1={dimensions.width / 2}
            y1={-dimensions.depth / 2}
            x2={-dimensions.width / 2}
            y2={dimensions.depth / 2}
            stroke="#a0a09d"
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
  if (node.type === "beam") { const length = Array.isArray(node.start) && Array.isArray(node.end) ? Math.hypot(node.end[0] - node.start[0], node.end[1] - node.start[1]) : null, elevation = node.effectiveCeilingElevation as { meters?: number; basis?: string } | undefined; rows.push(["长度", length === null ? "未解析" : formatPanelLength(length, unit)], ["截面 W/H", `${formatPanelLength(node.width ?? 0, unit)} / ${formatPanelLength(node.height ?? 0, unit)}`], ["Ceiling", Array.isArray(node.ceilingIds) ? node.ceilingIds.join("、") : "—"], ["顶标高", elevation?.meters ? `${formatPanelLength(elevation.meters, unit)} (${elevation.basis === "derived-default-2700mm" ? "推导 2700 mm" : "明确 Ceiling 高度"})` : "未解析"]); }
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
createRoot(document.getElementById("root")!).render(<DebugErrorBoundary><App /></DebugErrorBoundary>);
