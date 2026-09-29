// @ts-nocheck -- Vitest runs this Node-only source contract outside the browser bundle.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/main.tsx"), "utf8");
const planSource = readFileSync(resolve(process.cwd(), "src/plan/ConduitPlan.tsx"), "utf8");
const hvacPlanSource = readFileSync(resolve(process.cwd(), "src/plan/HvacPlan.tsx"), "utf8");
const threeDSource = readFileSync(resolve(process.cwd(), "src/three/ThreeDWorkspace.tsx"), "utf8");
const compactThreeDSource = threeDSource.replace(/\s+/g, " ");
const pascalSceneSource = readFileSync(resolve(process.cwd(), "src/three/PascalScenePreview.tsx"), "utf8");
const conduitSceneSource = readFileSync(resolve(process.cwd(), "src/components/ConduitScene.tsx"), "utf8");
const hvacSceneSource = readFileSync(resolve(process.cwd(), "src/components/HvacScene.tsx"), "utf8");
const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

describe("conduit workspace UI contract", () => {
  it("exposes one 2D fire drawing toggle that controls both fire systems", () => {
    expect(source).toContain('conduitSprinkler: "消防施工图"');
    expect(source).not.toContain('conduitFireSignal: "消防信号施工图"');
    expect(source).toContain("setFireDrawingVisibility");
  });

  it("starts point annotation scale at 50 percent", () => {
    expect(source).toContain("[pointAnnotationScale, setPointAnnotationScale] = useState(.5)");
  });

  it("keeps separate 2D, split and 3D view controls", () => {
    expect(source).toContain("视图与楼层");
    expect(source).toContain("builder-view-toggle");
    expect(source).toContain("selectWorkspaceLevel");
  });

  it("shows the immutable build label in the top bar and crash report", () => {
    expect(source).toContain('className="build-version"');
    expect(source).toContain("构建版本：{__BUILD_LABEL__}");
    expect(styles).toContain(".build-version");
  });

  it("opens and saves one 3.0 project and protects dirty workspace replacement", () => {
    expect(source).toContain("decodeUnifiedProject");
    expect(source).toContain("encodeUnifiedProject");
    expect(source).toContain("当前项目有未保存的更改");
    expect(source).not.toContain("exportConduitOverlayFromTwoD");
    expect(threeDSource).not.toContain("exportOverlay");
  });

  it("starts empty and waits for a project import", () => {
    expect(source).toContain('useState("未导入文件")');
    expect(source).not.toContain("default-unified-project.json");
    expect(source).toContain("导入 JSON");
  });

  it("places drawing tools in the shared sidebar and keeps an accessible split divider", () => {
    expect(source).toContain("builder-drawing-tools");
    expect(source).not.toContain("two-d-floating-panel");
    expect(source).not.toContain("+ 添加画布");
    expect(threeDSource).not.toContain("three-d-toolbar");
    expect(source).toContain("调整 2D 与 3D 视图宽度");
    expect(styles).toContain("--split-ratio");
    expect(styles).toContain(".workspace-split-divider");
  });

  it("keeps HVAC as one independently switchable 2D construction drawing", () => {
    expect(source).toContain('conduitHvac: "空调施工图"');
    expect(planSource).toContain('hvacVisible = true');
    expect(planSource).toContain('{hvacVisible && <HvacPlan');
  });

  it("gives wall thermostats the same four-direction center positioning as other points", () => {
    expect(threeDSource).toContain('aria-label="空调控温器中心定位"');
    expect(threeDSource).toContain("thermostatPositionDraft.planar");
    expect(threeDSource).toContain("applyThermostatPosition");
    expect(threeDSource).toContain("thermostatPositioningProxy");
    expect(hvacSceneSource).toContain("HvacThermostatDimensions");
  });

  it("keeps the thermostat control port marker clickable without an obstructing label", () => {
    expect(hvacSceneSource).toContain("hvacThermostatPortCandidates(item.position, item.sizeMm)");
    expect(hvacSceneSource).toContain("name={`${item.id}:control-port:${candidate.key}`}");
    expect(hvacSceneSource).toContain("onStartControlRoute?.(item.id, candidate)");
    expect(hvacSceneSource).toContain('thermostatCanStart(item) && (routeStartChooser || controlRouteActive)');
    expect(hvacSceneSource).toContain('controlRouteActive');
    expect(hvacSceneSource).not.toContain('>控制端口</span>');
  });

  it("highlights HVAC ports green only while they are valid route endpoints", () => {
    expect(hvacSceneSource).toContain("const actionable = controlTarget || powerTarget;");
    expect(hvacSceneSource).toContain("actionable ? '#22c55e' : color");
    expect(hvacSceneSource).toContain("canChooseHole ? '#22c55e' : '#a78bfa'");
    expect(hvacSceneSource).toContain("port!.id === unit.powerPort?.id ? '#ef4444' : '#a78bfa'");
  });

  it("previews FCU power and control port alignment before clicking the connector", () => {
    expect(hvacSceneSource).toContain("onHoverTargetPort");
    expect(hvacSceneSource).toContain("onPointerOver");
    expect(hvacSceneSource).toContain("onPointerOut");
    expect(threeDSource).toContain("hoveredHvacTarget");
    expect(threeDSource).toContain("hoveredHvacAssist.mode === \"connect\" ? \"连接后结束\" : \"辅助对齐\"");
    expect(threeDSource).toContain("targetAssist={hoveredHvacAssist}");
    expect(threeDSource).toContain("draftControlRoute={hvacControlThermostatId");
  });

  it("renders HVAC control drafts and saved elbows with the shared planned-route conduit geometry", () => {
    expect(hvacSceneSource).toContain("planHvacControlDraft(overlay, draftControlRoute.thermostatId");
    expect(hvacSceneSource).toContain("<RoutePlanPreview plan={controlPreviewPlan}");
    expect(hvacSceneSource).toContain("controlPreviewPlan.canCommit ? '#ffffff' : '#ef4444'");
    expect(hvacSceneSource).toContain("<RoutePipeGeometry segment={routeSegment}");
    expect(hvacSceneSource).toContain("<RouteFittingGeometry fitting={fitting}");
    expect(hvacSceneSource).toContain("couplingDirection={couplingDirection}");
    expect(hvacSceneSource).toContain("const delta = adjacent ? vector(adjacent.end.position).sub(vector(adjacent.start.position)).normalize() : null;");
    expect(hvacSceneSource).not.toContain('name="hvac-control-draft"');
  });

  it("keeps HVAC port labels out of the way of clickable connection markers", () => {
    expect(hvacSceneSource).toContain("{!preview && selected && <Html center position=");
    expect(hvacSceneSource).not.toContain("{actionable && <><mesh");
    expect(hvacSceneSource).toContain("function HvacPortConnector");
    expect(hvacSceneSource).toContain("<HvacPortConnector key={port!.id}");
    expect(hvacSceneSource).toContain("new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction)");
  });

  it("renders the transient 3D route preview in the 2D plan overlay", () => {
    expect(planSource).toContain("state.preview");
    expect(planSource).toContain("conduit-plan-preview");
    expect(planSource).toContain("preview.plan.segments.map");
  });

  it("exposes device placement, rooted drawing and synchronized device symbols", () => {
    expect(threeDSource).toContain('point: "点位"');
    expect(threeDSource).toContain("DEVICE_DEFAULTS");
    expect(threeDSource).toContain("startRouteFromDevice");
    expect(threeDSource).toContain("devicePreview=");
    expect(threeDSource).toContain("onDevicePreview={scheduleInlineDevicePreview}");
    expect(threeDSource).toContain("rootLegacyNetwork");
    expect(threeDSource).toContain("完成地标高");
    expect(threeDSource).toContain("下方首个实体净距");
    expect(threeDSource).toContain("deviceIds: bulkVertical ? selectedDeviceIds");
    expect(threeDSource).toContain('if (tool === "point")');
    expect(conduitSceneSource).toContain("ignorePreviewRay");
    expect(threeDSource).not.toContain("网络线路必须连接到网络面板终点");
    expect(threeDSource).not.toContain('setConstructionMode');
    expect(threeDSource).toContain('aria-label="大弯半径"');
    expect(threeDSource).not.toContain('<label>定尺长度');
    expect(planSource).toContain("overlay.devices.filter");
    expect(planSource).toContain("preview.deviceNode");
  });

  it("applies size edits to same-type multi-selected devices without partial connected resizing", () => {
    expect(threeDSource).toContain("selectedSizeDevices.every((device) => device.deviceType === selectedDevice.deviceType)");
    expect(threeDSource).toContain("const applyDeviceSize = (axis: 0 | 1 | 2, value: number)");
    expect(threeDSource).toContain("for (const device of selectedSizeDevices)");
    expect(threeDSource).toContain("resizeDevicePoint(next, device.id, size)");
    expect(threeDSource).toContain("resizeSpotlight(next, device.id, diameter, depth)");
    expect(threeDSource).toContain("disabled={!sizeSelectionHasSameType || sizeSelectionHasConnections}");
    expect(threeDSource).toContain("有端口已接管，直径已锁定；深度仍可批量修改。");
  });

  it("replaces the route layup selector with an editable radius for new sweep bends", () => {
    expect(threeDSource).toContain('min="50"');
    expect(threeDSource).toContain('max="1000"');
    expect(threeDSource).toContain('setBendRadiusInput(event.target.value)');
    expect(threeDSource).not.toContain("贴面暗敷");
    expect(threeDSource).not.toContain("吊顶内明敷");
    expect(threeDSource).toContain("bendRadiusMm: parseBendRadiusMm(bendRadiusInput)");
  });

  it("does not turn drawing clicks into global scene selections in split view", () => {
    expect(threeDSource).toContain('if (tool !== "select") return;');
    expect(threeDSource).toContain("onPointerMissed={() => selectWhileBrowsing(null)}");
    expect(threeDSource).toContain("onSelect={selectWhileBrowsing}");
    expect(styles).toContain("contain:layout paint");
  });

  it("keeps Canvas camera and controls configuration stable across drawing renders", () => {
    expect(compactThreeDSource).toContain("camera={ projection === \"orthographic\" ? ORTHOGRAPHIC_CAMERA : PERSPECTIVE_CAMERA }");
    expect(threeDSource).toContain("dpr={CANVAS_DPR}");
    expect(threeDSource).toContain("gl={CANVAS_GL}");
    expect(threeDSource).toContain("mouseButtons={cameraMouseButtons(projection)}");
    expect(threeDSource).toContain("colliderMeshes={NO_CAMERA_COLLIDERS}");
    expect(threeDSource).toContain("GROUND_CAMERA_CLEARANCE");
    expect(threeDSource).toContain("boundaryEnclosesCamera");
    expect(threeDSource).toContain("boundaryFriction={0}");
    expect(threeDSource).toContain("minDistance={Math.max(.12, bounds.span * .01)}");
    expect(threeDSource).toContain("}, [preset, presetRevision]);");
    expect(threeDSource).not.toContain("}, [bounds, preset]);");
  });

  it("coalesces live pointer work and renders the 3D canvas only on demand", () => {
    expect(threeDSource).toContain("useRafCoalescedCursor");
    expect(threeDSource).toContain("useRafCoalescedDevicePreview");
    expect(threeDSource).toContain("onDevicePreview={scheduleInlineDevicePreview}");
    expect(threeDSource).toContain("latestCursor.current");
    expect(threeDSource).toContain('frameloop="demand"');
  });

  it("keeps construction rendering data-compatible while hiding its controls", () => {
    expect(threeDSource).not.toContain("constructionPending");
    expect(threeDSource).not.toContain("生成/更新槽孔");
    expect(threeDSource).toContain("appliedSurfaceChases={appliedConstruction.surfaceChases}");
    expect(threeDSource).toContain("appliedPenetrations={appliedConstruction.penetrations}");
    expect(threeDSource).toContain("fallbackChaseKeys={chaseFallbacks}");
    expect(conduitSceneSource).toContain("appliedSurfaceChases.filter");
    expect(conduitSceneSource).toContain("fallbackChaseKeys");
    expect(threeDSource).not.toContain("个槽待更新");
  });

  it("keeps the 3D editor panel scrollable without a visible scrollbar", () => {
    expect(styles).toContain(".conduit-panel::-webkit-scrollbar{display:none}");
    expect(styles).toContain("scrollbar-width:none");
  });

  it("keeps the 3D editor task-focused and moves low-frequency controls into compact sections", () => {
    expect(threeDSource).toContain('className="conduit-tool-grid"');
    expect(threeDSource).toContain('tool === "draw" || tool === "branch"');
    expect(threeDSource).toContain('tool === "point"');
    expect(threeDSource).toContain('tool === "select"');
    expect(threeDSource).toContain('className="conduit-panel-details conduit-shortcuts"');
    expect(threeDSource).not.toContain("施工与槽孔");
    expect(threeDSource).not.toContain("管线图层");
    expect(threeDSource).toContain('className="conduit-utility-grid"');
    expect(styles).toContain("grid-template-columns:repeat(5,minmax(0,1fr))");
  });

  it("exposes independent 3D building and ten-system layers from the canvas", () => {
    expect(threeDSource).toContain('className="three-d-layer-popover"');
    expect(threeDSource).toContain('aria-label="3D 图层"');
    expect(threeDSource).toContain('["ceilings", "天花"]');
    expect(threeDSource).toContain('["furniture", "家具与楼梯"]');
    expect(threeDSource).toContain('aria-label="系统图层"');
    expect(threeDSource).toContain("PROJECT_SYSTEM_LAYER_OPTIONS.map(([key, label])");
    expect(threeDSource).toContain("checked={systemLayerVisibility[key]} onChange={() => toggleSystemLayer(key)}");
    expect(threeDSource).toContain("systemLayerVisibility={systemLayerVisibility}");
    expect(threeDSource).toContain("systemVisible={systemLayerVisibility.HVACSystem}");
    expect(threeDSource).not.toContain('onChange={toggleSensorLayer}');
    expect(threeDSource).toContain('checked={layers[layer]} onChange={() => toggleBuildingLayer(layer)}');
    expect(threeDSource).toContain("setSystemLayerVisibility((current) => ({ ...current, [key]: !current[key] }))");
    expect(styles).toContain(".three-d-layer-popover{position:absolute;right:12px;top:12px");
    expect(styles).toContain(".three-d-layer-popover-content");
    expect(conduitSceneSource).toContain("overlay.devices.filter(deviceVisible)");
    expect(conduitSceneSource).toContain("systemLayerVisibility ? isDeviceSystemLayerVisible");
    expect(hvacSceneSource).toContain("if (!(systemVisible ?? overlay.hvac.visible)) return null");
  });

  it("keeps 3D system visibility session-local and separate from the 2D drawing switches", () => {
    const toggle = threeDSource.slice(threeDSource.indexOf("const toggleSystemLayer"), threeDSource.indexOf("const allowedSystems"));
    expect(toggle).toContain("setSystemLayerVisibility");
    expect(toggle).not.toContain("setOverlayDirty");
    expect(toggle).not.toContain("commit(");
    expect(source).toContain("conduitReceptacle");
    expect(source).toContain("conduitLighting");
    expect(source).toContain("conduitHvac");
  });

  it("shows selected object properties in a narrow right-side system panel", () => {
    expect(threeDSource).toContain('className="conduit-panel conduit-selection-panel"');
    expect(threeDSource).toContain('aria-label={selectedObjectPanelTitle}');
    expect(threeDSource).toContain('hasSelectedObject && (');
    expect(styles).toContain('.conduit-selection-panel{left:auto;right:12px;top:58px;width:min(260px');
  });

  it("keeps an explicit indoor-unit placement action inside the HVAC tool group", () => {
    expect(threeDSource).toContain("<b>空调</b>");
    expect(threeDSource).toContain("onClick={() => chooseTool('hvac-unit')}>放内机</button>");
  });

  it("keeps HVAC previews click-through and scopes its panel to HVAC work", () => {
    expect(hvacSceneSource).toContain("const previewRaycast = preview ? () => null : undefined");
    expect(hvacSceneSource).toContain("raycast={previewRaycast}");
    expect(threeDSource).toContain("const hvacPanelOpen = tool.startsWith('hvac-') || Boolean(selectedHvacUnit || selectedHvacSegment || selectedHvacControlSegment || selectedHvacControlFitting || selectedHvacOutlet || selectedThermostat)");
    expect(threeDSource).toContain("{hvacPanelOpen && (");
  });

  it("keeps shared layout-reference-plane visibility and elevation controls available while placing an indoor unit", () => {
    expect(threeDSource).toContain("tool === 'hvac-unit' && layoutReferencePlane");
    expect(threeDSource).toContain('aria-label="布局参考面高度"');
  });

  it("starts a duct directly from an indoor-unit port and reserves the helper plane for indoor-unit placement", () => {
    expect(threeDSource).toContain("setTool(system === 'supply' ? 'hvac-supply' : 'hvac-return')");
    expect(threeDSource).not.toContain("tool === 'hvac-supply' || tool === 'hvac-return') && Boolean(activeHvacDuctId || hvacRouteStart)");
  });

  it("keeps direct duct drafting orthogonal by default from its physical port", () => {
    expect(threeDSource).toContain("const hvacStart = activeSegment?.end");
    expect(threeDSource).toContain("projectFirstDuctSegmentFromPort(routeUnit!, hvacRouteStart!.system, target)");
  });

  it("puts indoor-unit positioning and power-port guidance on the selected indoor-unit panel", () => {
    expect(threeDSource).toContain('aria-label="空调内机定位"');
    expect(threeDSource).toContain("电源接线：选择“画管”，从强电箱红色端口起画，再点击 FCU 电源绿色端口。");
    expect(threeDSource).not.toContain(">关联控温器</button>");
    expect(threeDSource).not.toContain("bindThermostat");
  });

  it("authors thermostat control as a physical one-to-one route between clickable HVAC ports", () => {
    expect(threeDSource).toContain(">画控制线管</button>");
    expect(threeDSource).toContain("onStartControlRoute={(thermostatId, candidate) =>");
    expect(threeDSource).toContain("selectHvacThermostatPort(overlay, thermostatId, candidate.key)");
    expect(threeDSource).toContain("createHvacControlConduit(overlay, hvacControlThermostatId, unitId, hvacControlWaypoints, { bendRadiusMm:");
    expect(threeDSource).toContain("onTargetPowerPort={onTargetHvacPowerPort}");
    expect(threeDSource).toContain("if (next === deviceRouteStart.overlay)");
    expect(threeDSource).toContain('next === "hvac-supply" || next === "hvac-return" ? canUseCatalogTool(catalogLock, "hvac-duct") : canUseCatalogTool(catalogLock, next)');
    expect(threeDSource).toContain("已删除 HVAC 控制管及两端端口占用");
    expect(hvacSceneSource).toContain("onStartControlRoute?.(item.id, candidate)");
    expect(hvacSceneSource).toContain("onTargetControlPort?.(unit.id)");
    expect(hvacSceneSource).toContain("onTargetPowerPort?.(unit.id, port!.id, port!.position)");
    expect(hvacSceneSource).toContain("<RoutePlanPreview plan={controlPreviewPlan}");
    expect(hvacSceneSource).toContain("overlay.hvac.controlFittings.map(fitting => <HvacControlFittingVisual");
    expect(hvacSceneSource).toContain("<RouteFittingGeometry fitting={fitting}");
    expect(hvacSceneSource).toContain("systemVisible ?? overlay.hvac.visible");
    expect(threeDSource).toContain("selectedThermostatConnected ? '控温器已连接控制管");
  });

  it("offers the same explicit orthogonal duct-drawing entry and Shift affordance as other routing tools", () => {
    expect(threeDSource).toContain("chooseTool('hvac-duct')");
    expect(threeDSource).toContain(">画风管</button>");
    expect(threeDSource).toContain("tool === 'hvac-duct'");
    expect(threeDSource).toContain("Shift 切换正交");
  });

  it("keeps HVAC duct clicks as confirmed vertices and finishes only on Enter or double-click", () => {
    expect(threeDSource).toContain("const finishHvacDuct = () =>");
    expect(threeDSource).toContain("finishHvacDuct(); return;");
    expect(threeDSource).toContain("onSurfaceFinish={finishAtCursor}");
    expect(threeDSource).toContain("单击逐段确认，双击或 Enter 完成");
  });

  it("keeps the first HVAC segment controllable by the same XYZ and cancel arrow keys", () => {
    expect(threeDSource).toContain("shouldHandleWorldAxisArrow(event.key, routeIsActive, tool)");
    expect(threeDSource).toContain("hvacControlThermostatId");
    expect(threeDSource).toContain("routeModeAfterShift(orthogonal, worldAxis)");
    expect(threeDSource).toContain("if (tool === 'hvac-supply' || tool === 'hvac-return')");
  });

  it("starts every new route session orthogonal and clears the previous XYZ lock", () => {
    expect(threeDSource).toContain("const resetRouteConstraints = () => { setOrthogonal(true); setWorldAxis(null); orthogonalDirection.current = null; }");
    expect(threeDSource).toContain("if (['draw', 'branch', 'hvac-supply', 'hvac-return', 'hvac-control'].includes(next)) resetRouteConstraints()");
    expect(threeDSource).toContain("selectSystem(availableSystem); resetRouteConstraints(); setDeviceRouteStart(started)");
    expect(threeDSource).toContain("selectSystem(endpoint.system); resetRouteConstraints(); setEndpointRouteStart(endpoint)");
    expect(threeDSource).toContain("selectSystem(started.box.system); resetRouteConstraints(); setJunctionRouteStart(started)");
  });

  it("applies route cursor constraints to HVAC control pipe previews and terminal alignment", () => {
    expect(threeDSource).toContain("projectRoutePointToWorldAxis(anchor, candidate, worldAxis)");
    expect(threeDSource).toContain("projectRoutePointToDirection(anchor, candidate, direction)");
    expect(threeDSource).toContain("当前方向尚未对准 FCU；已确认辅助对齐点");
    expect(threeDSource).toContain("tool === \"hvac-control\" && hvacControlThermostatId && worldAxis");
  });

  it("confirms active HVAC world-axis points in empty space and keeps panel modes exclusive", () => {
    expect(threeDSource).toContain("hvacEmptyCanvasRouteAction(tool, Boolean(hvacControlThermostatId || hvacRouteStart || activeHvacDuctId), worldAxis)");
    expect(threeDSource).toContain('hvacEmptyClick === "control-waypoint"');
    expect(threeDSource).toContain('hvacEmptyClick === "duct-point"');
    expect(threeDSource).toContain("onClick={toggleRouteOrthogonalMode}");
    expect(threeDSource).toContain("onClick={() => chooseRouteWorldAxis('x')}");
    expect(threeDSource).toContain("className={orthogonal && !worldAxis ? 'active' : ''}");
    expect(threeDSource.indexOf("const hvacEmptyClick = hvacEmptyCanvasRouteAction")).toBeLessThan(threeDSource.indexOf("if (!canDrawWithoutSource && !fireSignalStart) { selectWhileBrowsing(null); return; }"));
  });

  it("locks a newly started duct to the clicked port's outward direction before using free orthogonal choice", () => {
    expect(threeDSource).toContain("indoorUnitPortDirection(routeUnit!, hvacRouteStart!.system)");
    expect(threeDSource).toContain("activeSegment ? resolveOrthogonalDirection");
  });

  it("places duct outlets from the hovered physical face with a live preview, not a preselected face", () => {
    expect(threeDSource).not.toContain("hvacOutletFace");
    expect(threeDSource).toContain("outletPreview={tool === 'hvac-outlet' ? hvacOutletPreview : null}");
    expect(hvacSceneSource).toContain("onDuctOutletPreview");
    expect(hvacSceneSource).toContain('name={preview ? "hvac-outlet-preview" : "hvac-outlet"}');
  });

  it("keeps the placed duct face fixed while exposing its two editable edge clearances", () => {
    expect(threeDSource).not.toContain("风口方向");
    expect(threeDSource).toContain("起点净距");
    expect(threeDSource).toContain("终点净距");
    expect(threeDSource).toContain("editHvacOutlet(overlay, selectedHvacOutlet.id");
    expect(hvacSceneSource).toContain('function HvacOutletDimensions');
    expect(hvacSceneSource).toContain('color="#ffffff"');
    expect(hvacSceneSource).toContain('depthTest={false}');
  });

  it("uses a compact, direction-readable indoor-unit plan symbol instead of overlapping supply and return pills", () => {
    expect(hvacPlanSource).toContain("hvac-plan-unit");
    expect(hvacPlanSource).toContain("送风");
    expect(hvacPlanSource).toContain("回风");
    expect(hvacPlanSource).not.toContain("hvac-plan-port-pill");
  });

  it("shows selected indoor-unit 3D positioning dimensions using the shared suspended-device guide pattern", () => {
    expect(threeDSource).toContain("selectedIndoorUnitDimensions={selectedHvacUnit ?");
    expect(hvacSceneSource).toContain("function HvacIndoorUnitDimensions");
    expect(hvacSceneSource).toContain("内机底部标高");
  });

  it("shows signed X/Z indoor-unit dimensions from physical envelopes to walls or other indoor units", () => {
    expect(threeDSource).toContain("hvacAxisPlanarReferences");
    expect(threeDSource).toContain("{reference.label} 净距");
    expect(hvacSceneSource).toContain("reference.start");
    expect(hvacSceneSource).toContain("reference.end");
  });

  it("keeps permanent 2D network rendering separate from transient previews", () => {
    expect(planSource).toContain("ConduitPlanPermanent = React.memo");
    expect(planSource).toContain("<ConduitPlanPermanent");
    expect(pascalSceneSource).toContain("EMPTY_CHASES");
    expect(pascalSceneSource).toContain("sceneIndex");
  });

  it("does not render a height-changing 3D workspace footer", () => {
    expect(threeDSource).not.toContain('<footer className="three-d-status">');
    expect(styles).not.toContain(".three-d-status");
  });

  it("keeps shallow-cut fallback internal instead of showing a diagnostics panel", () => {
    expect(pascalSceneSource).toContain("subtractHorizontalChases");
    expect(pascalSceneSource).toContain("subtractWallChases");
    expect(threeDSource).toContain("onChaseFallback={reportChaseFallback}");
    expect(threeDSource).not.toContain("<b>诊断</b>");
    expect(threeDSource).not.toContain("deviceDiagnostics(overlay)");
  });

  it("renders a quiet non-interactive edge overlay for 3D building geometry", () => {
    expect(pascalSceneSource).toContain("function MeshEdges");
    expect(pascalSceneSource).toContain("const EDGE_OPACITY = .24");
    expect(pascalSceneSource).toContain('raycast={() => null}');
    expect(pascalSceneSource).toContain("<MeshEdges geometry={geometry}");
  });

  it("keeps Beam authoring isolated from Overlay editing while exposing both view layers", () => {
    expect(threeDSource).toContain('beam: "梁"');
    expect(threeDSource).toContain("const beamPreview = beamStart && beamPointer");
    expect(threeDSource).toContain("commitSharedWorkspace(nextProject, current.overlay, true, current.dirty)");
    expect(threeDSource).toContain("tool === \"beam\" ? \"select\" : tool");
    expect(pascalSceneSource).toContain("layers.beams && beamPreview");
    expect(source).toContain('beams: "梁"');
    expect(source).toContain("<BeamFootprint");
    expect(source).not.toContain("BeamFootprint.*尺寸");
  });

  it("gives Beam reference-plane confirmation an obstacle-independent Canvas pointer-down path", () => {
    expect(threeDSource).toContain('function BeamPlanePointerCapture');
    expect(threeDSource).toContain('canvas.addEventListener("pointerdown", onPointerDown, true)');
    expect(compactThreeDSource).toContain('<BeamPlanePointerCapture y={layoutReferencePlaneY} onPlace={onLayoutReferenceHit} />');
    expect(threeDSource).toContain('data-beam-authoring-status');
    expect(threeDSource).not.toContain('const setStatus = (_message: string) => undefined;');
  });

  it("exposes 3D-only Beam numeric geometry controls and scene dimensions", () => {
    expect(threeDSource).toContain("Beam 属性（3D）");
    expect(threeDSource).toContain("commitBeamEdit");
    expect(threeDSource).toContain("梁位置");
    expect(threeDSource).toContain("editBeamPlanarClearance");
    expect(threeDSource).toContain('aria-label="Beam cross-axis clearance"');
    expect(threeDSource).toContain('return dz < 1e-7 ? "Z 向净距" : dx < 1e-7 ? "X 向净距" : "垂直梁净距"');
    expect(threeDSource).toContain("beamEditPreview ?? beamPreview");
    expect(threeDSource).toContain("selectedBeam.start.join");
    expect(threeDSource).not.toContain('addEventListener("beam-drag"');
    expect(pascalSceneSource).toContain("function BeamPlanarDimensionGuides");
    expect(pascalSceneSource).toContain('name="beam-planar-dimension:cross-axis"');
    expect(pascalSceneSource).not.toContain("setBodyDrag");
    expect(pascalSceneSource).not.toContain("data-beam-handle");
    expect(pascalSceneSource).toContain("const rendered = beamPreview?.id === node.id ? beamPreview : node");
    expect(pascalSceneSource).toContain("onPointerMove");
    expect(source).not.toContain("Beam 属性（3D）");
  });

  it("keeps physical Beam snap identities for creation and numeric clearance inputs for selection", () => {
    expect(threeDSource).toContain("snapBeamPoint");
    expect(threeDSource).toContain("梁表面捕捉");
    expect(threeDSource).not.toContain("snapBeamEdit");
    expect(threeDSource).toContain("selectedBeamPlanarClearances");
    expect(threeDSource).toContain('aria-label="Beam cross-axis clearance"');
    expect(source).not.toContain("Beam left clearance");
  });

  it("clears a deleted Beam preview and commits Beam positioning only on Enter", () => {
    const deleteBeamSource = threeDSource.slice(
      threeDSource.indexOf("const deleteSelectedObjects"),
      threeDSource.indexOf("const applyDevicePosition"),
    );
    const beamPositionSource = threeDSource.slice(
      threeDSource.indexOf("<b>梁位置</b>"),
      threeDSource.indexOf("{(tool === \"draw\""),
    );
    expect(deleteBeamSource).toContain("setBeamEditPreview(null)");
    expect(beamPositionSource).not.toContain("onChange=");
    expect(beamPositionSource).not.toContain("onBlur=");
    expect(beamPositionSource).not.toContain("clearance.witness.kind");
  });

  it("keeps Beam lock, modifier and pointer feedback discoverable", () => {
    expect(threeDSource).toContain("beam-orthogonal-lock");
    expect(threeDSource).toContain("aria-pressed={orthogonal}");
    expect(threeDSource).toContain('data-beam-pointer-state={beamPointerState}');
    expect(threeDSource).not.toContain('data-beam-reticle-state={state}');
    expect(threeDSource).toContain("Explicit Ceiling elevation crossing");
    expect(threeDSource).toContain("event.nativeEvent.ctrlKey || event.nativeEvent.metaKey");
    expect(styles).toContain(".beam-pointer-feedback");
  });

  it("confirms the current Beam candidate from either a scene click or Enter", () => {
    expect(threeDSource).toContain("function confirmBeamEndpoint");
    expect(threeDSource).toContain('if (tool === "beam" && event.key === "Enter")');
    expect(threeDSource).toContain("confirmBeamEndpoint();");
    expect(threeDSource).toContain("confirmBeamEndpoint({ point: hit.point");
    expect(threeDSource).toContain("confirmBeamEndpoint({ point, shiftKey: false, ctrlKey })");
  });

  it("routes Escape through active-route undo before editable-focus suppression", () => {
    const keydown = threeDSource.slice(threeDSource.indexOf("const onKeyDown = (event: KeyboardEvent) => {"), threeDSource.indexOf("window.addEventListener(\"keydown\", onKeyDown, true)"));
    expect(keydown).toContain("routeEscapeAction(");
    expect(keydown).toContain("shouldIgnoreEditableKeydown(event.key, editable, escapeAction !== \"none\")");
    expect(keydown.indexOf("shouldIgnoreEditableKeydown")).toBeLessThan(keydown.indexOf("if ((event.metaKey || event.ctrlKey)"));
    expect(keydown).toContain('escapeAction === "pop-draft-point"');
    expect(keydown).toContain('escapeAction === "pop-hvac-control-waypoint"');
    expect(keydown).toContain('escapeAction === "pop-hvac-duct-segment"');
    expect(keydown).toContain("sameRoutePoint(request.entry, removedPoint)");
    expect(keydown).toContain("sameRoutePoint(request.exit, removedPoint)");
    expect(keydown).toContain("event.stopPropagation();");
    expect(threeDSource).toContain('window.addEventListener("keydown", onKeyDown, true)');
    expect(threeDSource).toContain('window.removeEventListener("keydown", onKeyDown, true)');
    expect(threeDSource).toContain("selectedDeviceIds, selectedSegmentIds, deviceRouteStart, sprinklerRouteStart, fireSignalStart, junctionRouteStart, endpointRouteStart, hvacRouteStart");
  });

  it("uses the selected physical port coordinate for its orthogonal arrival direction", () => {
    expect(conduitSceneSource).toContain("onDeviceTarget(device, [event.point.x, event.point.y, event.point.z], port.id)");
    expect(threeDSource).toContain("resolveDeviceTargetDirection(draft[draft.length - 1], { position: point }, targetPort?.position ?? { position: point }, Boolean(portId && targetPort)");
    expect(threeDSource).toContain("if (portId && port && draft.length && orthogonal && !worldAxis)");
    expect(threeDSource).toContain("resolveDeviceTargetDirection(draft[draft.length - 1], { position: reference ?? port.position.position }, port.position, true)");
  });

  it("uses the shared Layout reference plane for eligible horizontal device points", () => {
    expect(threeDSource).toContain("const eligibleLayoutPoint");
    expect(threeDSource).toContain("const sharedPointPlane");
    expect(threeDSource).toContain("eligibleLayoutPoint && layoutReferencePlane");
    expect(threeDSource).toContain("布局参考面");
    expect(threeDSource).toContain("sharedPointPlane.elevationMm");
    expect(threeDSource).toContain("never a fake");
    expect(threeDSource).toContain("布局参考面已关闭");
  });
});
