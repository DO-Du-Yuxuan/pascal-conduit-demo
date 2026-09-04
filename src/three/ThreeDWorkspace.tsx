import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { MOUSE } from "three";
import { ConduitScene } from "../components/ConduitScene";
import { assessOverlayHosts, createEmptyOverlay, parseOverlay, SYSTEM_DEFAULTS, type ConduitOverlayDocument, type RoutePoint, type RoutingSystem, type SurfaceMode } from "../domain/overlay";
import { branchAtSegment, commitPlannedRoute, planRoute, type ConstructionVisualParameters, type PlannedRoute } from "../domain/routing";
import { constrainToHostAxes, previewRoutePoints, type DirectionMode } from "../domain/drawing";
import { useOverlayStore } from "../domain/store";
import { PascalScenePreview, type ThreeDSurfaceHit } from "./PascalScenePreview";
import type { ThreeDBounds, ThreeDSceneInput } from "./scene-input";
import { DEFAULT_3D_LAYERS, type ThreeDLevelMode, type ThreeDViewPreset, type ThreeDWallMode, viewStateForPreset } from "./view-state";

export type ThreeDLayerVisibility = { walls: boolean; floors: boolean; ceilings: boolean; roofs: boolean; openings: boolean; furniture: boolean; zones: boolean };
type ViewPreset = ThreeDViewPreset;
type LevelMode = ThreeDLevelMode;
type WallMode = ThreeDWallMode;
type ConstructionMode = "construction" | "finished" | "xray";
type Tool = "select" | "draw" | "branch" | "penetrate";
type BranchStart = { segmentId: string; point: RoutePoint };

function Navigation({ bounds, preset }: { bounds: ThreeDBounds; preset: ViewPreset }) {
  const controls = useRef<any>(null);
  useEffect(() => {
    if (!controls.current) return;
    const [x, y, z] = bounds.center, distance = bounds.span * 1.35;
    const viewpoints: Record<ViewPreset, [number, number, number, number, number, number]> = {
      exterior: [x + distance, y + distance * .72, z + distance, x, y, z], interior: [x + distance * .55, Math.max(1.6, y), z + distance * .55, x, Math.max(1.35, y), z], floor: [x, y + distance * 1.6, z, x, 0, z], ceiling: [x, Math.max(.7, y - distance * .15), z, x, y + distance * .55, z], top: [x, y + distance * 1.6, z, x, y, z], front: [x, y + distance * .45, z + distance, x, y, z], back: [x, y + distance * .45, z - distance, x, y, z], left: [x - distance, y + distance * .45, z, x, y, z], right: [x + distance, y + distance * .45, z, x, y, z], isometric: [x + distance, y + distance, z + distance, x, y, z],
    };
    const [cameraX, cameraY, cameraZ, targetX, targetY, targetZ] = viewpoints[preset];
    controls.current.object.position.set(cameraX, cameraY, cameraZ); controls.current.target.set(targetX, targetY, targetZ); controls.current.update();
  }, [bounds, preset]);
  return <OrbitControls ref={controls} makeDefault enableDamping={false} minDistance={.01} mouseButtons={{ LEFT: undefined, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.ROTATE }} />;
}

const copy = (overlay: ConduitOverlayDocument) => structuredClone(overlay);
const routePoint = (hit: ThreeDSurfaceHit): RoutePoint => ({ position: hit.point, attachment: hit.attachment });

export default function ThreeDWorkspace({ scene, hiddenNodeIds, selectedId, onSelect, sourceFile, sourceSha }: { scene: ThreeDSceneInput | null; hiddenNodeIds: ReadonlySet<string>; selectedId: string | null; onSelect: (id: string | null) => void; sourceFile: string; sourceSha: string }) {
  const [preset, setPreset] = useState<ViewPreset>("exterior"), [layers, setLayers] = useState<ThreeDLayerVisibility>(DEFAULT_3D_LAYERS), [levelMode, setLevelMode] = useState<LevelMode>("stacked"), [wallMode, setWallMode] = useState<WallMode>("up"), [projection, setProjection] = useState<"perspective" | "orthographic">("perspective");
  const [overlay, setOverlay] = useState(() => createEmptyOverlay(sourceFile, sourceSha)), [undoStack, setUndoStack] = useState<ConduitOverlayDocument[]>([]), [redoStack, setRedoStack] = useState<ConduitOverlayDocument[]>([]);
  const [tool, setTool] = useState<Tool>("select"), [system, setSystem] = useState<RoutingSystem>("power"), [diameterMm, setDiameterMm] = useState(20), [surfaceMode, setSurfaceMode] = useState<SurfaceMode>("surface"), [constructionParameters, setConstructionParameters] = useState<ConstructionVisualParameters>({ chaseWidthMm: 30, chaseDepthMm: 25, penetrationDiameterMm: 30 }), [draft, setDraft] = useState<RoutePoint[]>([]), [cursor, setCursor] = useState<RoutePoint | null>(null), [directionMode, setDirectionMode] = useState<DirectionMode>("orthogonal"), [panelCollapsed, setPanelCollapsed] = useState(false), [pending, setPending] = useState<PlannedRoute | null>(null), [branchStart, setBranchStart] = useState<BranchStart | null>(null), [penetrationEntry, setPenetrationEntry] = useState<RoutePoint | null>(null), [constructionMode, setConstructionMode] = useState<ConstructionMode>("construction"), [status, setStatus] = useState("Overlay 为空；选择系统后可在 3D 中开始画管。");
  const overlayInput = useRef<HTMLInputElement>(null);
  const publishOverlay = useOverlayStore((state) => state.load);
  const hostAssessment = useMemo(() => assessOverlayHosts(overlay, Object.keys(scene?.nodes ?? {})), [overlay, scene]);
  const selectedSegment = overlay.segments.find((segment) => segment.id === selectedId);
  const selectedFitting = overlay.fittings.find((fitting) => fitting.id === selectedId);

  useEffect(() => { setOverlay(createEmptyOverlay(sourceFile, sourceSha)); setUndoStack([]); setRedoStack([]); setDraft([]); setCursor(null); setPending(null); setBranchStart(null); setPenetrationEntry(null); setStatus("已为当前建筑建立空白 Overlay。"); }, [scene?.sceneKey, sourceFile, sourceSha]);
  useEffect(() => { publishOverlay(overlay); }, [overlay, publishOverlay]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) setRedoStack((redo) => { const next = redo[redo.length - 1]; if (!next) return redo; setUndoStack((undo) => [...undo, copy(overlay)]); setOverlay(copy(next)); return redo.slice(0, -1); }); else setUndoStack((undo) => { const previous = undo[undo.length - 1]; if (!previous) return undo; setRedoStack((redo) => [...redo, copy(overlay)]); setOverlay(copy(previous)); return undo.slice(0, -1); }); return; }
      if (event.key === "Escape") { setPending(null); setBranchStart(null); setPenetrationEntry(null); setCursor(null); setDraft((points) => points.length > 1 ? points.slice(0, -1) : []); }
      if (event.key === "Enter" && draft.length > 1) { event.preventDefault(); setPending(planRoute(system, diameterMm, surfaceMode, draft, constructionParameters)); setDraft([]); setCursor(null); }
      if (event.key === "Tab" && tool !== "select") { event.preventDefault(); setStatus("已切换重叠宿主候选；点击确认当前预览面。"); }
    };
    window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown);
  }, [overlay, draft, system, diameterMm, surfaceMode, constructionParameters, tool]);

  const commit = (next: ConduitOverlayDocument) => { setUndoStack((history) => [...history, copy(overlay)]); setRedoStack([]); setOverlay(copy(next)); };
  const selectSystem = (next: RoutingSystem) => { const nextDiameter = SYSTEM_DEFAULTS[next].diameterMm; setSystem(next); setDiameterMm(nextDiameter); setSurfaceMode(SYSTEM_DEFAULTS[next].mode); setConstructionParameters({ chaseWidthMm: nextDiameter + 10, chaseDepthMm: nextDiameter + 5, penetrationDiameterMm: nextDiameter + 10 }); setDraft([]); setBranchStart(null); };
  const finishPath = () => { if (draft.length < 2) return; setPending(planRoute(system, diameterMm, surfaceMode, draft, constructionParameters)); setDraft([]); setCursor(null); };
  const previewPoints = useMemo(() => previewRoutePoints(draft, cursor, directionMode), [draft, cursor, directionMode]);
  const effectiveCursor = cursor && draft.length ? previewPoints[previewPoints.length - 1] : cursor;
  const onSurfaceMove = (hit: ThreeDSurfaceHit) => {
    if (tool === "draw" || (tool === "branch" && branchStart) || (tool === "penetrate" && penetrationEntry)) setCursor(routePoint(hit));
  };
  const onSurfaceHit = (hit: ThreeDSurfaceHit) => {
    if (pending) return;
    const point = routePoint(hit);
    if (tool === "branch" && branchStart) { commit(branchAtSegment(overlay, branchStart.segmentId, branchStart.point, point)); setBranchStart(null); setCursor(null); setStatus("已插入三通并提交分支。"); return; }
    if (tool === "penetrate") {
      if (!penetrationEntry) { setPenetrationEntry(point); setStatus("已确认穿透入口；移动到出口宿主预览后再次点击确认。"); return; }
      setPending(planRoute(system, diameterMm, "penetrate", [penetrationEntry, point], constructionParameters)); setPenetrationEntry(null); setCursor(null); return;
    }
    if (tool !== "draw") return;
    setDraft((points) => [...points, points.length ? constrainToHostAxes(points[points.length - 1], point, hit.shiftKey ? (directionMode === "free" ? "orthogonal" : "free") : directionMode) : point]); setCursor(null); setStatus("已确定落点；移动鼠标预览下一段，Enter 或“完成路径”进入施工影响确认。");
  };
  const onBranch = (segmentId: string, position: [number, number, number]) => {
    if (tool !== "branch") return;
    const segment = overlay.segments.find((item) => item.id === segmentId);
    if (!segment) return;
    if (segment.system !== system) { setStatus("分支只能连接同一系统；请先切换系统。"); return; }
    setBranchStart({ segmentId, point: { position } }); setCursor(null); setStatus("已选分支起点；移动鼠标预览分支，再点击墙、地板或天花确认。");
  };
  const importOverlay = async (file: File) => { const imported = parseOverlay(JSON.parse(await file.text())); setOverlay(imported); setUndoStack([]); setRedoStack([]); const assessment = assessOverlayHosts(imported, Object.keys(scene?.nodes ?? {})); setStatus(imported.source.sha256 === sourceSha ? "Overlay 已恢复。" : assessment.missingHostIds.length ? `底图不同，${assessment.missingHostIds.length} 个宿主悬空；对应槽孔不会重建。` : "底图指纹不同，但宿主仍存在，已允许预览。"); };
  const exportOverlay = () => { const url = URL.createObjectURL(new Blob([JSON.stringify(overlay, null, 2)], { type: "application/json" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "conduit-overlay.json"; anchor.click(); URL.revokeObjectURL(url); };
  const choosePreset = (next: Extract<ViewPreset, "exterior" | "interior" | "floor" | "ceiling">) => { const nextState = viewStateForPreset({ preset, layers, levelMode, wallMode, walkthrough: false }, next); setPreset(nextState.preset); setLayers(nextState.layers); setLevelMode(nextState.levelMode); setWallMode(nextState.wallMode); };

  if (!scene) return <section className="three-d-empty"><b>尚未导入 JSON</b><span>导入布局后即可切换到 3D 查看。</span></section>;
  if (!scene.rootNodeIds.length) return <section className="three-d-empty"><b>无法建立 3D 场景</b>{scene.diagnostics.map((diagnostic) => <span key={diagnostic.code}>{diagnostic.message}</span>)}</section>;
  return <section className="three-d-workspace">
    <header className="three-d-toolbar">
      <div className="three-d-group"><b>3D 视图</b>{(["exterior", "interior", "floor", "ceiling"] as const).map((item) => <button className={preset === item ? "active" : ""} onClick={() => choosePreset(item)} key={item}>{({ exterior: "外观", interior: "室内", floor: "地板", ceiling: "天花" } as const)[item]}</button>)}</div>
      <div className="three-d-group"><span>角度</span>{(["top", "front", "back", "left", "right", "isometric"] as const).map((item) => <button onClick={() => setPreset(item)} key={item}>{({ top: "顶", front: "前", back: "后", left: "左", right: "右", isometric: "等轴" } as const)[item]}</button>)}</div>
      <div className="three-d-group"><label>投影 <select value={projection} onChange={(event) => setProjection(event.target.value as typeof projection)}><option value="perspective">透视</option><option value="orthographic">正交</option></select></label><label>楼层 <select value={levelMode} onChange={(event) => setLevelMode(event.target.value as LevelMode)}><option value="stacked">叠放</option><option value="exploded">爆炸</option><option value="solo">单层</option></select></label><label>墙体 <select value={wallMode} onChange={(event) => setWallMode(event.target.value as WallMode)}><option value="up">完整</option><option value="cutaway">剖开</option><option value="translucent">半透明</option><option value="down">隐藏</option></select></label></div>
      <div className="three-d-group three-d-layers">{(Object.entries({ walls: "墙", floors: "地板", ceilings: "天花", roofs: "屋顶", openings: "门窗", furniture: "家具", zones: "Zone" }) as Array<[keyof ThreeDLayerVisibility, string]>).map(([key, label]) => <label key={key}><input type="checkbox" checked={layers[key]} onChange={() => setLayers((current) => ({ ...current, [key]: !current[key] }))} />{label}</label>)}</div>
    </header>
    <div className="three-d-canvas">
      <aside className={`conduit-panel ${panelCollapsed ? "collapsed" : ""}`} aria-label="管线编辑工具">
        <button className="conduit-panel-collapse" onClick={() => setPanelCollapsed((value) => !value)}>{panelCollapsed ? "展开管线" : "收起"}</button>
        {!panelCollapsed && <>
          <section><b>编辑工具</b><div className="conduit-button-grid">{(["select", "draw", "branch", "penetrate"] as Tool[]).map((item) => <button key={item} className={tool === item ? "active" : ""} onClick={() => { setTool(item); setDraft([]); setCursor(null); setBranchStart(null); setPenetrationEntry(null); }}>{({ select: "选择", draw: "画管", branch: "分支", penetrate: "穿透" } as const)[item]}</button>)}</div><div className="conduit-button-grid"><button disabled={draft.length < 2} onClick={finishPath}>完成路径</button><button disabled={!draft.length && !penetrationEntry} onClick={() => { setDraft([]); setCursor(null); setPenetrationEntry(null); }}>取消</button></div></section>
          <section><b>管线参数</b><label>系统<select value={system} onChange={(event) => selectSystem(event.target.value as RoutingSystem)}>{(Object.keys(SYSTEM_DEFAULTS) as RoutingSystem[]).map((key) => <option key={key} value={key}>{SYSTEM_DEFAULTS[key].label}</option>)}</select></label><label>外径 <input type="number" min="5" max="200" value={diameterMm} onChange={(event) => setDiameterMm(Number(event.target.value))} /> mm</label><label>敷设<select value={surfaceMode} onChange={(event) => setSurfaceMode(event.target.value as SurfaceMode)}><option value="surface">贴面暗敷</option><option value="suspended">吊顶内明敷</option><option value="penetrate">穿透宿主</option></select></label><div className="conduit-button-grid"><button className={directionMode === "free" ? "active" : ""} onClick={() => setDirectionMode("free")}>自由方向</button><button className={directionMode === "orthogonal" ? "active" : ""} onClick={() => setDirectionMode("orthogonal")}>正交方向</button></div><small>Shift 临时切换自由/正交；正交以当前宿主表面为准。</small></section>
          <section><b>施工显示</b><div className="conduit-button-grid">{(["construction", "finished", "xray"] as ConstructionMode[]).map((item) => <button key={item} className={constructionMode === item ? "active" : ""} onClick={() => setConstructionMode(item)}>{({ construction: "施工态", finished: "完工态", xray: "X-Ray" } as const)[item]}</button>)}</div><label>墙槽宽 <input type="number" min="1" value={constructionParameters.chaseWidthMm} onChange={(event) => setConstructionParameters((current) => ({ ...current, chaseWidthMm: Math.max(1, Number(event.target.value)) }))} /> mm</label><label>墙槽深 <input type="number" min="1" value={constructionParameters.chaseDepthMm} onChange={(event) => setConstructionParameters((current) => ({ ...current, chaseDepthMm: Math.max(1, Number(event.target.value)) }))} /> mm</label><label>穿孔径 <input type="number" min="1" value={constructionParameters.penetrationDiameterMm} onChange={(event) => setConstructionParameters((current) => ({ ...current, penetrationDiameterMm: Math.max(1, Number(event.target.value)) }))} /> mm</label><small>以上为 Demo 视觉参数，非施工规范结论。</small></section>
          <section><b>图层</b>{(Object.keys(SYSTEM_DEFAULTS) as RoutingSystem[]).map((key) => <label key={key}><input type="checkbox" checked={overlay.settings.visibleSystems[key]} onChange={() => setOverlay((current) => ({ ...current, settings: { ...current.settings, visibleSystems: { ...current.settings.visibleSystems, [key]: !current.settings.visibleSystems[key] } } }))} />{SYSTEM_DEFAULTS[key].label}</label>)}</section>
          <section><b>历史与文件</b><div className="conduit-button-grid"><button disabled={!undoStack.length} onClick={() => { const previous = undoStack[undoStack.length - 1]; if (previous) { setRedoStack((history) => [...history, copy(overlay)]); setUndoStack((history) => history.slice(0, -1)); setOverlay(copy(previous)); } }}>撤销</button><button disabled={!redoStack.length} onClick={() => { const next = redoStack[redoStack.length - 1]; if (next) { setUndoStack((history) => [...history, copy(overlay)]); setRedoStack((history) => history.slice(0, -1)); setOverlay(copy(next)); } }}>重做</button></div><div className="conduit-button-grid"><button onClick={() => overlayInput.current?.click()}>导入</button><button onClick={exportOverlay}>导出</button></div><input ref={overlayInput} hidden type="file" accept="application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importOverlay(file); event.currentTarget.value = ""; }} /></section>
          {selectedId && <section><b>已选对象</b><span>{selectedId}</span>{selectedSegment && <><label>系统<select value={selectedSegment.system} onChange={(event) => { const nextSystem = event.target.value as RoutingSystem; commit({ ...overlay, segments: overlay.segments.map((segment) => segment.id === selectedSegment.id ? { ...segment, system: nextSystem, type: nextSystem === "sprinkler" ? "sprinkler-segment" : "conduit-segment" } : segment) }); }}>{(Object.keys(SYSTEM_DEFAULTS) as RoutingSystem[]).map((key) => <option key={key} value={key}>{SYSTEM_DEFAULTS[key].label}</option>)}</select></label><label>外径 <input type="number" value={selectedSegment.diameterMm} onChange={(event) => { const value = Number(event.target.value); if (value > 0) commit({ ...overlay, segments: overlay.segments.map((segment) => segment.id === selectedSegment.id ? { ...segment, diameterMm: value } : segment) }); }} /> mm</label></>}{selectedFitting && <label>接头 {selectedFitting.fitting === "tee" ? "三通" : "弯头"}</label>}<small>管段、接头、墙槽和穿孔均与 2D 共享选择状态。</small></section>}
        </>}
      </aside>
      <Canvas key={projection} orthographic={projection === "orthographic"} camera={projection === "orthographic" ? { position: [10, 10, 10], zoom: 30 } : { position: [10, 10, 10], fov: 50 }} dpr={[1, 1.25]} gl={{ antialias: true, powerPreference: "high-performance" }} onPointerMissed={() => onSelect(null)}><color attach="background" args={["#dfe6e9"]} /><PascalScenePreview scene={scene} layers={layers} hiddenNodeIds={hiddenNodeIds} levelMode={levelMode} wallMode={wallMode} selectedId={selectedId} onSelect={(id) => onSelect(id)} overlay={overlay} constructionMode={constructionMode} onSurfaceHit={onSurfaceHit} onSurfaceMove={onSurfaceMove} onSurfaceFinish={finishPath} /><ConduitScene overlay={overlay} selectedId={selectedId} constructionMode={constructionMode} visibleSystems={overlay.settings.visibleSystems} draft={previewPoints.map((point) => point.position)} draftColor={overlay.settings.colors[system]} previewHost={effectiveCursor?.attachment} onSelect={onSelect} onBranch={(segment, position) => onBranch(segment.id, position)} /><Navigation bounds={scene.bounds} preset={preset} /></Canvas><div className="three-d-walkthrough-hint">左键确认 · Shift 临时切换方向 · Tab 切换候选宿主 · 右键旋转 · 中键平移 · 滚轮缩放 · 双击/Enter 完成 · Esc 取消</div>
    </div>
    <footer className="three-d-status"><span>{scene.itemCount} 件家具 · 不加载 GLB · {scene.hasRoofData ? "已读取屋顶数据" : "当前文件无屋顶数据"}</span><span>{overlay.segments.length} 段管线 · {overlay.fittings.length} 个接头 · {overlay.wallChases.length} 条墙槽 · {overlay.penetrations.length} 个穿孔</span><span>{status}</span>{hostAssessment.missingHostIds.length > 0 && <span className="three-d-warning">{hostAssessment.missingHostIds.length} 个 Overlay 宿主悬空</span>}{scene.diagnostics.map((diagnostic) => <span className={`three-d-${diagnostic.severity}`} key={diagnostic.code}>{diagnostic.message}</span>)}</footer>
    {pending && <div className="conduit-confirm"><b>施工影响确认</b><span>{pending.segments.length} 段直管、{pending.fittings.length} 个弯头、{pending.wallChases.length} 条墙槽、{pending.penetrations.length} 个穿孔。</span><button className="active" onClick={() => { commit(commitPlannedRoute(overlay, pending)); setPending(null); setTool("select"); setStatus("已提交管线路由与施工影响。") }}>确认提交</button><button onClick={() => setPending(null)}>返回修改</button></div>}
  </section>;
}
