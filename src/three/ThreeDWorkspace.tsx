import { OrbitControls } from "@react-three/drei";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { BackSide, MOUSE } from "three";
import { ConduitScene, type ConduitTool } from "../components/ConduitScene";
import { assessOverlayHosts, createEmptyOverlay, parseOverlay, SYSTEM_DEFAULTS, type ConduitOverlayDocument, type RoutePoint, type RoutingSystem, type SurfaceMode } from "../domain/overlay";
import { branchAtSegment, commitPlannedRoute, planRoute, type ConstructionVisualParameters, type PlannedRoute } from "../domain/routing";
import { constrainToHostAxes, pointOnWorldAxis, previewRoutePoints, type WorldAxis } from "../domain/drawing";
import { useOverlayStore } from "../domain/store";
import { PascalScenePreview, type ThreeDSurfaceHit } from "./PascalScenePreview";
import type { ThreeDBounds, ThreeDSceneInput } from "./scene-input";
import { DEFAULT_3D_LAYERS, type ThreeDLevelMode, type ThreeDViewPreset, type ThreeDWallMode, viewStateForPreset } from "./view-state";

export type ThreeDLayerVisibility = { walls: boolean; floors: boolean; ceilings: boolean; roofs: boolean; openings: boolean; furniture: boolean; zones: boolean };
type ViewPreset = ThreeDViewPreset;
type LevelMode = ThreeDLevelMode;
type WallMode = ThreeDWallMode;
type ConstructionMode = "construction" | "finished" | "xray";
type Tool = ConduitTool;
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
  return <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={.08} zoomToCursor minDistance={.01} mouseButtons={{ LEFT: undefined, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.ROTATE }} />;
}

function PointerCapture({ bounds, onRay }: { bounds: ThreeDBounds; onRay: (origin: [number, number, number], direction: [number, number, number]) => void }) {
  const radius = Math.max(10, bounds.span * 4);
  return <mesh position={bounds.center} onPointerMove={(event: ThreeEvent<PointerEvent>) => onRay([event.ray.origin.x, event.ray.origin.y, event.ray.origin.z], [event.ray.direction.x, event.ray.direction.y, event.ray.direction.z])}>
    <sphereGeometry args={[radius, 12, 8]} /><meshBasicMaterial transparent opacity={0} side={BackSide} depthWrite={false} />
  </mesh>;
}

const copy = (overlay: ConduitOverlayDocument) => structuredClone(overlay);
const routePoint = (hit: ThreeDSurfaceHit): RoutePoint => ({ position: hit.point, attachment: hit.attachment });

export default function ThreeDWorkspace({ scene, hiddenNodeIds, selectedId, onSelect, sourceFile, sourceSha }: { scene: ThreeDSceneInput | null; hiddenNodeIds: ReadonlySet<string>; selectedId: string | null; onSelect: (id: string | null) => void; sourceFile: string; sourceSha: string }) {
  const [preset, setPreset] = useState<ViewPreset>("exterior"), [layers, setLayers] = useState<ThreeDLayerVisibility>(DEFAULT_3D_LAYERS), [levelMode, setLevelMode] = useState<LevelMode>("stacked"), [wallMode, setWallMode] = useState<WallMode>("up"), [projection, setProjection] = useState<"perspective" | "orthographic">("perspective");
  const [overlay, setOverlay] = useState(() => createEmptyOverlay(sourceFile, sourceSha)), [undoStack, setUndoStack] = useState<ConduitOverlayDocument[]>([]), [redoStack, setRedoStack] = useState<ConduitOverlayDocument[]>([]);
  const [tool, setTool] = useState<Tool>("select"), [system, setSystem] = useState<RoutingSystem>("power"), [diameterMm, setDiameterMm] = useState(20), [surfaceMode, setSurfaceMode] = useState<SurfaceMode>("surface"), [constructionParameters, setConstructionParameters] = useState<ConstructionVisualParameters>({ chaseWidthMm: 30, chaseDepthMm: 25, penetrationDiameterMm: 30 }), [draft, setDraft] = useState<RoutePoint[]>([]), [cursor, setCursor] = useState<RoutePoint | null>(null), [orthogonal, setOrthogonal] = useState(false), [worldAxis, setWorldAxis] = useState<WorldAxis | null>(null), [panelCollapsed, setPanelCollapsed] = useState(false), [branchStart, setBranchStart] = useState<BranchStart | null>(null), [branchEnd, setBranchEnd] = useState<RoutePoint | null>(null), [penetrationEntry, setPenetrationEntry] = useState<RoutePoint | null>(null), [explicitPenetrations, setExplicitPenetrations] = useState<RoutePoint[]>([]), [hoverId, setHoverId] = useState<string | null>(null), [constructionMode, setConstructionMode] = useState<ConstructionMode>("construction"), [status, setStatus] = useState("Overlay 为空；选择系统后可在 3D 中开始画管。");
  const overlayInput = useRef<HTMLInputElement>(null);
  const publishOverlay = useOverlayStore((state) => state.load);
  const hostAssessment = useMemo(() => assessOverlayHosts(overlay, Object.keys(scene?.nodes ?? {})), [overlay, scene]);
  const selectedSegment = overlay.segments.find((segment) => segment.id === selectedId);
  const selectedFitting = overlay.fittings.find((fitting) => fitting.id === selectedId);

  useEffect(() => { setOverlay(createEmptyOverlay(sourceFile, sourceSha)); setUndoStack([]); setRedoStack([]); setDraft([]); setCursor(null); setBranchStart(null); setBranchEnd(null); setPenetrationEntry(null); setExplicitPenetrations([]); setWorldAxis(null); setStatus("已为当前建筑建立空白 Overlay。"); }, [scene?.sceneKey, sourceFile, sourceSha]);
  useEffect(() => { publishOverlay(overlay); }, [overlay, publishOverlay]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const editable = event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement;
      if (editable) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) setRedoStack((redo) => { const next = redo[redo.length - 1]; if (!next) return redo; setUndoStack((undo) => [...undo, copy(overlay)]); setOverlay(copy(next)); return redo.slice(0, -1); }); else setUndoStack((undo) => { const previous = undo[undo.length - 1]; if (!previous) return undo; setRedoStack((redo) => [...redo, copy(overlay)]); setOverlay(copy(previous)); return undo.slice(0, -1); }); return; }
      if (event.key === "Shift" && !event.repeat) { event.preventDefault(); setOrthogonal((value) => !value); return; }
      if (event.key === "ArrowLeft" && draft.length) { event.preventDefault(); setWorldAxis("x"); return; }
      if (event.key === "ArrowUp" && draft.length) { event.preventDefault(); setWorldAxis("y"); return; }
      if (event.key === "ArrowRight" && draft.length) { event.preventDefault(); setWorldAxis("z"); return; }
      if (event.key === "ArrowDown") { event.preventDefault(); setWorldAxis(null); return; }
      if (event.key === "Escape") { setBranchStart(null); setBranchEnd(null); setPenetrationEntry(null); setCursor(null); setExplicitPenetrations([]); setWorldAxis(null); setDraft((points) => points.length > 1 ? points.slice(0, -1) : []); }
      if (event.key === "Enter") { event.preventDefault(); finishCurrentRoute(); }
      if (event.key === "Tab" && tool === "draw" && cursor?.attachment && draft.length) { event.preventDefault(); setPenetrationEntry(cursor); setStatus("已标记穿透入口；移至宿主另一侧并点击确认出口。"); }
    };
    window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown);
  }, [overlay, draft, system, diameterMm, surfaceMode, constructionParameters, tool, cursor, branchStart, branchEnd, explicitPenetrations, worldAxis]);

  const commit = (next: ConduitOverlayDocument) => { setUndoStack((history) => [...history, copy(overlay)]); setRedoStack([]); setOverlay(copy(next)); };
  const selectSystem = (next: RoutingSystem) => { const nextDiameter = SYSTEM_DEFAULTS[next].diameterMm; setSystem(next); setDiameterMm(nextDiameter); setSurfaceMode(SYSTEM_DEFAULTS[next].mode); setConstructionParameters({ chaseWidthMm: nextDiameter + 10, chaseDepthMm: nextDiameter + 5, penetrationDiameterMm: nextDiameter + 10 }); setDraft([]); setBranchStart(null); };
  const finishCurrentRoute = () => {
    if (tool === "branch" && branchStart && branchEnd) { commit(branchAtSegment(overlay, branchStart.segmentId, branchStart.point, branchEnd)); setBranchStart(null); setBranchEnd(null); setCursor(null); setStatus("已生成分支与三通。"); return; }
    if (tool !== "draw" || draft.length < 2) return;
    commit(commitPlannedRoute(overlay, planRoute(system, diameterMm, surfaceMode, draft, constructionParameters, explicitPenetrations)));
    setDraft([]); setCursor(null); setExplicitPenetrations([]); setPenetrationEntry(null); setWorldAxis(null); setStatus("已直接生成管线与施工影响。");
  };
  const finishPath = finishCurrentRoute;
  const finishAtCursor = () => {
    if (tool === "branch" && branchStart && cursor) { commit(branchAtSegment(overlay, branchStart.segmentId, branchStart.point, cursor)); setBranchStart(null); setBranchEnd(null); setCursor(null); setStatus("已直接生成分支与三通。"); return; }
    if (tool !== "draw" || !cursor) return finishCurrentRoute();
    const point = draft.length ? constrainToHostAxes(draft[draft.length - 1], cursor, orthogonal ? "orthogonal" : "free") : cursor;
    const points = [...draft, point];
    if (points.length < 2) return;
    commit(commitPlannedRoute(overlay, planRoute(system, diameterMm, surfaceMode, points, constructionParameters, explicitPenetrations)));
    setDraft([]); setCursor(null); setExplicitPenetrations([]); setPenetrationEntry(null); setWorldAxis(null); setStatus("已直接生成管线与施工影响。");
  };
  const previewPoints = useMemo(() => previewRoutePoints(draft, cursor, orthogonal ? "orthogonal" : "free"), [draft, cursor, orthogonal]);
  const effectiveCursor = cursor && draft.length ? previewPoints[previewPoints.length - 1] : cursor;
  const displayDraft = draft.length ? previewPoints : cursor ? [cursor] : [];
  const onSurfaceMove = (hit: ThreeDSurfaceHit) => {
    if (!worldAxis && (tool === "draw" || (tool === "branch" && branchStart))) setCursor(routePoint(hit));
  };
  const onSurfaceHit = (hit: ThreeDSurfaceHit) => {
    const point = routePoint(hit);
    if (tool === "branch" && branchStart) { setBranchEnd(point); setCursor(point); setStatus("分支终点已预览；按 Enter、双击或完成路径直接生成。 "); return; }
    if (tool !== "draw") return;
    if (penetrationEntry) { setDraft((points) => [...points, penetrationEntry, point]); setExplicitPenetrations((points) => [...points, penetrationEntry, point]); setPenetrationEntry(null); setCursor(null); setStatus("已确认穿透出口；继续画管或按 Enter 直接生成。"); return; }
    setDraft((points) => [...points, points.length ? constrainToHostAxes(points[points.length - 1], point, orthogonal ? "orthogonal" : "free") : point]); setCursor(null); setStatus("已确定落点；移动鼠标预览下一段，按 Enter、双击或完成路径直接生成。");
  };
  const onBranch = (segmentId: string, position: [number, number, number]) => {
    if (tool !== "branch") return;
    const segment = overlay.segments.find((item) => item.id === segmentId);
    if (!segment) return;
    if (segment.system !== system) { setStatus("分支只能连接同一系统；请先切换系统。"); return; }
    setBranchStart({ segmentId, point: { position } }); setBranchEnd(null); setCursor(null); setStatus("已选分支起点；移动鼠标预览分支终点，再点击确认。 ");
  };
  const deleteObject = (id: string) => {
    const remainingSegments = overlay.segments.filter((segment) => segment.id !== id);
    const remainingFittings = overlay.fittings.filter((fitting) => fitting.id !== id && fitting.segmentIds.every((segmentId) => remainingSegments.some((segment) => segment.id === segmentId)));
    const removedSegmentIds = new Set(overlay.segments.filter((segment) => !remainingSegments.includes(segment)).map((segment) => segment.id));
    commit({ ...overlay, segments: remainingSegments, fittings: remainingFittings, wallChases: overlay.wallChases.filter((chase) => chase.id !== id && !removedSegmentIds.has(chase.segmentId)), penetrations: overlay.penetrations.filter((penetration) => penetration.id !== id && !removedSegmentIds.has(penetration.segmentId)) });
    onSelect(null); setHoverId(null); setStatus("已删除对象及孤立施工特征。");
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
          <section><b>编辑工具</b><div className="conduit-button-grid">{(["select", "draw", "branch", "delete"] as Tool[]).map((item) => <button key={item} className={tool === item ? "active" : ""} onClick={() => { setTool(item); setDraft([]); setCursor(null); setBranchStart(null); setBranchEnd(null); setPenetrationEntry(null); setExplicitPenetrations([]); }}>{({ select: "选择", draw: "画管", branch: "分支", delete: "删除" } as const)[item]}</button>)}</div><div className="conduit-button-grid"><button disabled={tool === "draw" ? draft.length < 2 : !(tool === "branch" && branchStart && branchEnd)} onClick={finishPath}>完成路径</button><button disabled={!draft.length && !branchStart && !penetrationEntry} onClick={() => { setDraft([]); setCursor(null); setBranchStart(null); setBranchEnd(null); setPenetrationEntry(null); setExplicitPenetrations([]); setWorldAxis(null); }}>取消</button></div></section>
          <section><b>管线参数</b><label>系统<select value={system} onChange={(event) => selectSystem(event.target.value as RoutingSystem)}>{(Object.keys(SYSTEM_DEFAULTS) as RoutingSystem[]).map((key) => <option key={key} value={key}>{SYSTEM_DEFAULTS[key].label}</option>)}</select></label><label>外径 <input type="number" min="5" max="200" value={diameterMm} onChange={(event) => setDiameterMm(Number(event.target.value))} /> mm</label><label>敷设<select value={surfaceMode} onChange={(event) => setSurfaceMode(event.target.value as SurfaceMode)}><option value="surface">贴面暗敷</option><option value="suspended">吊顶内明敷</option></select></label><div className="conduit-button-grid"><button className={orthogonal ? "active" : ""} onClick={() => setOrthogonal((value) => !value)}>正交 {orthogonal ? "开" : "关"}</button><button className={worldAxis ? "active" : ""} onClick={() => setWorldAxis(null)}>{worldAxis ? `世界 ${worldAxis.toUpperCase()}` : "宿主面"}</button></div><small>按 Shift 切换正交；← X、↑ Y、→ Z 锁定世界轴；↓ 恢复宿主面；Tab 穿透当前宿主。</small></section>
          <section><b>施工显示</b><div className="conduit-button-grid">{(["construction", "finished", "xray"] as ConstructionMode[]).map((item) => <button key={item} className={constructionMode === item ? "active" : ""} onClick={() => setConstructionMode(item)}>{({ construction: "施工态", finished: "完工态", xray: "X-Ray" } as const)[item]}</button>)}</div><label>墙槽宽 <input type="number" min="1" value={constructionParameters.chaseWidthMm} onChange={(event) => setConstructionParameters((current) => ({ ...current, chaseWidthMm: Math.max(1, Number(event.target.value)) }))} /> mm</label><label>墙槽深 <input type="number" min="1" value={constructionParameters.chaseDepthMm} onChange={(event) => setConstructionParameters((current) => ({ ...current, chaseDepthMm: Math.max(1, Number(event.target.value)) }))} /> mm</label><label>穿孔径 <input type="number" min="1" value={constructionParameters.penetrationDiameterMm} onChange={(event) => setConstructionParameters((current) => ({ ...current, penetrationDiameterMm: Math.max(1, Number(event.target.value)) }))} /> mm</label><small>以上为 Demo 视觉参数，非施工规范结论。</small></section>
          <section><b>图层</b>{(Object.keys(SYSTEM_DEFAULTS) as RoutingSystem[]).map((key) => <label key={key}><input type="checkbox" checked={overlay.settings.visibleSystems[key]} onChange={() => setOverlay((current) => ({ ...current, settings: { ...current.settings, visibleSystems: { ...current.settings.visibleSystems, [key]: !current.settings.visibleSystems[key] } } }))} />{SYSTEM_DEFAULTS[key].label}</label>)}</section>
          <section><b>历史与文件</b><div className="conduit-button-grid"><button disabled={!undoStack.length} onClick={() => { const previous = undoStack[undoStack.length - 1]; if (previous) { setRedoStack((history) => [...history, copy(overlay)]); setUndoStack((history) => history.slice(0, -1)); setOverlay(copy(previous)); } }}>撤销</button><button disabled={!redoStack.length} onClick={() => { const next = redoStack[redoStack.length - 1]; if (next) { setUndoStack((history) => [...history, copy(overlay)]); setRedoStack((history) => history.slice(0, -1)); setOverlay(copy(next)); } }}>重做</button></div><div className="conduit-button-grid"><button onClick={() => overlayInput.current?.click()}>导入</button><button onClick={exportOverlay}>导出</button></div><input ref={overlayInput} hidden type="file" accept="application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importOverlay(file); event.currentTarget.value = ""; }} /></section>
          {selectedId && <section><b>已选对象</b><span>{selectedId}</span>{selectedSegment && <><label>系统<select value={selectedSegment.system} onChange={(event) => { const nextSystem = event.target.value as RoutingSystem; commit({ ...overlay, segments: overlay.segments.map((segment) => segment.id === selectedSegment.id ? { ...segment, system: nextSystem, type: nextSystem === "sprinkler" ? "sprinkler-segment" : "conduit-segment" } : segment) }); }}>{(Object.keys(SYSTEM_DEFAULTS) as RoutingSystem[]).map((key) => <option key={key} value={key}>{SYSTEM_DEFAULTS[key].label}</option>)}</select></label><label>外径 <input type="number" value={selectedSegment.diameterMm} onChange={(event) => { const value = Number(event.target.value); if (value > 0) commit({ ...overlay, segments: overlay.segments.map((segment) => segment.id === selectedSegment.id ? { ...segment, diameterMm: value } : segment) }); }} /> mm</label></>}{selectedFitting && <label>接头 {selectedFitting.fitting === "tee" ? "三通" : "弯头"}</label>}<small>管段、接头、墙槽和穿孔均与 2D 共享选择状态。</small></section>}
        </>}
      </aside>
      <Canvas key={projection} orthographic={projection === "orthographic"} camera={projection === "orthographic" ? { position: [10, 10, 10], zoom: 30 } : { position: [10, 10, 10], fov: 50 }} dpr={[1, 1.25]} gl={{ antialias: true, powerPreference: "high-performance" }} onPointerMissed={() => onSelect(null)}><color attach="background" args={["#dfe6e9"]} /><PascalScenePreview scene={scene} layers={layers} hiddenNodeIds={hiddenNodeIds} levelMode={levelMode} wallMode={wallMode} selectedId={selectedId} highlightHostId={tool === "draw" ? effectiveCursor?.attachment?.hostId : null} onSelect={(id) => onSelect(id)} overlay={overlay} constructionMode={constructionMode} onSurfaceHit={onSurfaceHit} onSurfaceMove={onSurfaceMove} onSurfaceFinish={finishAtCursor} /><ConduitScene overlay={overlay} selectedId={selectedId} constructionMode={constructionMode} visibleSystems={overlay.settings.visibleSystems} activeSystem={system} draft={displayDraft.map((point) => point.position)} draftColor={overlay.settings.colors[system]} previewHost={effectiveCursor?.attachment} tool={tool} hoverId={hoverId} onHover={setHoverId} onSelect={onSelect} onBranch={(segment, position) => onBranch(segment.id, position)} onDelete={deleteObject} /><PointerCapture bounds={scene.bounds} onRay={(origin, direction) => { if (worldAxis && draft.length) setCursor(pointOnWorldAxis(draft[draft.length - 1], worldAxis, origin, direction)); }} /><Navigation bounds={scene.bounds} preset={preset} /></Canvas><div className="three-d-walkthrough-hint">左键确认 · Shift 正交开关 · Tab 穿透 · ← X / ↑ Y / → Z 悬空轴 · ↓ 取消轴 · 右键旋转 · Enter 直接生成</div>
    </div>
    <footer className="three-d-status"><span>{scene.itemCount} 件家具 · 不加载 GLB · {scene.hasRoofData ? "已读取屋顶数据" : "当前文件无屋顶数据"}</span><span>{overlay.segments.length} 段管线 · {overlay.fittings.length} 个接头 · {overlay.wallChases.length} 条墙槽 · {overlay.penetrations.length} 个穿孔</span><span>{status}</span>{hostAssessment.missingHostIds.length > 0 && <span className="three-d-warning">{hostAssessment.missingHostIds.length} 个 Overlay 宿主悬空</span>}{scene.diagnostics.map((diagnostic) => <span className={`three-d-${diagnostic.severity}`} key={diagnostic.code}>{diagnostic.message}</span>)}</footer>
  </section>;
}
