// @ts-nocheck -- Vitest runs this Node-only source contract outside the browser bundle.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/main.tsx"), "utf8");
const planSource = readFileSync(resolve(process.cwd(), "src/plan/ConduitPlan.tsx"), "utf8");
const threeDSource = readFileSync(resolve(process.cwd(), "src/three/ThreeDWorkspace.tsx"), "utf8");
const compactThreeDSource = threeDSource.replace(/\s+/g, " ");
const pascalSceneSource = readFileSync(resolve(process.cwd(), "src/three/PascalScenePreview.tsx"), "utf8");
const conduitSceneSource = readFileSync(resolve(process.cwd(), "src/components/ConduitScene.tsx"), "utf8");
const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

describe("conduit workspace UI contract", () => {
  it("keeps separate 2D, split and 3D view controls", () => {
    expect(source).toContain("2D 平面");
    expect(source).toContain("2D + 3D");
    expect(source).toContain("3D 查看");
  });

  it("offers independent project export and protects dirty workspace replacement", () => {
    expect(source).toContain("导出项目 JSON");
    expect(source).toContain("makeProjectWritable");
    expect(source).toContain("当前项目或施工 Overlay 尚有未导出的更改");
    expect(threeDSource).toContain("source.projectId");
  });

  it("provides a collapsible 2D overlay panel and an accessible divider", () => {
    expect(source).toContain("two-d-floating-panel");
    expect(source).toContain("调整 2D 与 3D 视图宽度");
    expect(styles).toContain("--split-ratio");
    expect(styles).toContain(".workspace-split-divider");
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
    expect(threeDSource).toContain('if (tool === "point")');
    expect(conduitSceneSource).toContain("ignorePreviewRay");
    expect(threeDSource).not.toContain("网络线路必须连接到网络面板终点");
    expect(threeDSource).not.toContain('setConstructionMode');
    expect(threeDSource).not.toContain('<label>大弯半径');
    expect(threeDSource).not.toContain('<label>定尺长度');
    expect(planSource).toContain("overlay.devices.filter");
    expect(planSource).toContain("preview.deviceNode");
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
    expect(threeDSource).toContain("mouseButtons={CONTROL_MOUSE_BUTTONS}");
    expect(threeDSource).toContain("colliderMeshes={NO_CAMERA_COLLIDERS}");
    expect(threeDSource).toContain("GROUND_CAMERA_CLEARANCE");
    expect(threeDSource).toContain("boundaryEnclosesCamera");
    expect(threeDSource).toContain("boundaryFriction={.12}");
    expect(threeDSource).toContain("minDistance={Math.max(.12, bounds.span * .01)}");
    expect(threeDSource).toContain("}, [preset]);");
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
    expect(threeDSource).toContain('className="conduit-panel-details"');
    expect(threeDSource).not.toContain("施工与槽孔");
    expect(threeDSource).toContain("管线图层");
    expect(threeDSource).toContain('className="conduit-utility-grid"');
    expect(styles).toContain("grid-template-columns:repeat(5,minmax(0,1fr))");
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
    expect(pascalSceneSource).toContain('data-beam-planar-dimension="cross-axis"');
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
