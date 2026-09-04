import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { MOUSE } from "three";
import { ConduitScene } from "../components/ConduitScene";
import { assessOverlayHosts, createEmptyOverlay, parseOverlay, SYSTEM_DEFAULTS, type ConduitOverlayDocument, type RoutePoint, type RoutingSystem, type SurfaceMode } from "../domain/overlay";
import { branchAtSegment, commitPlannedRoute, planRoute, type PlannedRoute } from "../domain/routing";
import { useOverlayStore } from "../domain/store";
import { PascalScenePreview, type ThreeDSurfaceHit } from "./PascalScenePreview";
import type { ThreeDBounds, ThreeDSceneInput } from "./scene-input";
import { DEFAULT_3D_LAYERS, type ThreeDLevelMode, type ThreeDViewPreset, type ThreeDWallMode, viewStateForPreset } from "./view-state";

export type ThreeDLayerVisibility = { walls: boolean; floors: boolean; ceilings: boolean; roofs: boolean; openings: boolean; furniture: boolean; zones: boolean };
type ViewPreset = ThreeDViewPreset;
type LevelMode = ThreeDLevelMode;
type WallMode = ThreeDWallMode;
type ConstructionMode = "construction" | "finished" | "xray";
type Tool = "select" | "draw" | "branch";
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
const constrainPoint = (first: RoutePoint, point: RoutePoint): RoutePoint => {
  const dx = Math.abs(point.position[0] - first.position[0]), dy = Math.abs(point.position[1] - first.position[1]), dz = Math.abs(point.position[2] - first.position[2]);
  if (dx >= dy && dx >= dz) return { ...point, position: [point.position[0], first.position[1], first.position[2]] };
  if (dy >= dx && dy >= dz) return { ...point, position: [first.position[0], point.position[1], first.position[2]] };
  return { ...point, position: [first.position[0], first.position[1], point.position[2]] };
};

export default function ThreeDWorkspace({ scene, hiddenNodeIds, selectedId, onSelect, sourceFile, sourceSha }: { scene: ThreeDSceneInput | null; hiddenNodeIds: ReadonlySet<string>; selectedId: string | null; onSelect: (id: string | null) => void; sourceFile: string; sourceSha: string }) {
  const [preset, setPreset] = useState<ViewPreset>("exterior"), [layers, setLayers] = useState<ThreeDLayerVisibility>(DEFAULT_3D_LAYERS), [levelMode, setLevelMode] = useState<LevelMode>("stacked"), [wallMode, setWallMode] = useState<WallMode>("up"), [projection, setProjection] = useState<"perspective" | "orthographic">("perspective");
  const [overlay, setOverlay] = useState(() => createEmptyOverlay(sourceFile, sourceSha)), [undoStack, setUndoStack] = useState<ConduitOverlayDocument[]>([]), [redoStack, setRedoStack] = useState<ConduitOverlayDocument[]>([]);
  const [tool, setTool] = useState<Tool>("select"), [system, setSystem] = useState<RoutingSystem>("power"), [diameterMm, setDiameterMm] = useState(20), [surfaceMode, setSurfaceMode] = useState<SurfaceMode>("surface"), [draft, setDraft] = useState<RoutePoint[]>([]), [pending, setPending] = useState<PlannedRoute | null>(null), [branchStart, setBranchStart] = useState<BranchStart | null>(null), [constructionMode, setConstructionMode] = useState<ConstructionMode>("construction"), [visibleSystems, setVisibleSystems] = useState<Record<RoutingSystem, boolean>>({ power: true, "low-voltage": true, signal: true, sprinkler: true }), [status, setStatus] = useState("Overlay 为空；选择系统后可在 3D 中开始画管。");
  const overlayInput = useRef<HTMLInputElement>(null);
  const publishOverlay = useOverlayStore((state) => state.load);
  const hostAssessment = useMemo(() => assessOverlayHosts(overlay, Object.keys(scene?.nodes ?? {})), [overlay, scene]);

  useEffect(() => { setOverlay(createEmptyOverlay(sourceFile, sourceSha)); setUndoStack([]); setRedoStack([]); setDraft([]); setPending(null); setBranchStart(null); setStatus("已为当前建筑建立空白 Overlay。"); }, [scene?.sceneKey, sourceFile, sourceSha]);
  useEffect(() => { publishOverlay(overlay); }, [overlay, publishOverlay]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) setRedoStack((redo) => { const next = redo[redo.length - 1]; if (!next) return redo; setUndoStack((undo) => [...undo, copy(overlay)]); setOverlay(copy(next)); return redo.slice(0, -1); }); else setUndoStack((undo) => { const previous = undo[undo.length - 1]; if (!previous) return undo; setRedoStack((redo) => [...redo, copy(overlay)]); setOverlay(copy(previous)); return undo.slice(0, -1); }); return; }
      if (event.key === "Escape") { setPending(null); setBranchStart(null); setDraft((points) => points.length > 1 ? points.slice(0, -1) : []); }
      if (event.key === "Enter" && draft.length > 1) { event.preventDefault(); setPending(planRoute(system, diameterMm, surfaceMode, draft)); setDraft([]); }
    };
    window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown);
  }, [overlay, draft, system, diameterMm, surfaceMode]);

  const commit = (next: ConduitOverlayDocument) => { setUndoStack((history) => [...history, copy(overlay)]); setRedoStack([]); setOverlay(copy(next)); };
  const selectSystem = (next: RoutingSystem) => { setSystem(next); setDiameterMm(SYSTEM_DEFAULTS[next].diameterMm); setSurfaceMode(SYSTEM_DEFAULTS[next].mode); setDraft([]); setBranchStart(null); };
  const finishPath = () => { if (draft.length < 2) return; setPending(planRoute(system, diameterMm, surfaceMode, draft)); setDraft([]); };
  const onSurfaceHit = (hit: ThreeDSurfaceHit) => {
    if (pending) return;
    const point = routePoint(hit);
    if (tool === "branch" && branchStart) { commit(branchAtSegment(overlay, branchStart.segmentId, branchStart.point, point)); setBranchStart(null); setStatus("已插入三通并提交分支。"); return; }
    if (tool !== "draw") return;
    setDraft((points) => [...points, points.length && hit.shiftKey ? constrainPoint(points[points.length - 1], point) : point]); setStatus("已确定落点；继续点击转角，Enter 或“完成路径”提交预览。");
  };
  const onBranch = (segmentId: string, position: [number, number, number]) => {
    if (tool !== "branch") return;
    const segment = overlay.segments.find((item) => item.id === segmentId);
    if (!segment) return;
    if (segment.system !== system) { setStatus("分支只能连接同一系统；请先切换系统。"); return; }
    setBranchStart({ segmentId, point: { position } }); setStatus("已选分支起点，请点击墙、地板或天花确认分支终点。");
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
      <div className="three-d-group"><b>管线</b>{(["select", "draw", "branch"] as Tool[]).map((item) => <button key={item} className={tool === item ? "active" : ""} onClick={() => { setTool(item); if (item !== "draw") setDraft([]); }}>{({ select: "选择", draw: "画管", branch: "分支" } as const)[item]}</button>)}<button disabled={draft.length < 2} onClick={finishPath}>完成路径</button></div>
      <div className="three-d-group"><select value={system} onChange={(event) => selectSystem(event.target.value as RoutingSystem)}>{(Object.keys(SYSTEM_DEFAULTS) as RoutingSystem[]).map((key) => <option key={key} value={key}>{SYSTEM_DEFAULTS[key].label}</option>)}</select><label>Ø <input type="number" min="5" max="200" value={diameterMm} onChange={(event) => setDiameterMm(Number(event.target.value))} /> mm</label><select value={surfaceMode} onChange={(event) => setSurfaceMode(event.target.value as SurfaceMode)}><option value="surface">贴面暗敷</option><option value="suspended">吊顶内明敷</option><option value="penetrate">穿透宿主</option></select></div>
      <div className="three-d-group three-d-layers">{(Object.keys(SYSTEM_DEFAULTS) as RoutingSystem[]).map((key) => <label key={key}><input type="checkbox" checked={visibleSystems[key]} onChange={() => setVisibleSystems((current) => ({ ...current, [key]: !current[key] }))} />{SYSTEM_DEFAULTS[key].label}</label>)}</div>
      <div className="three-d-group">{(["construction", "finished", "xray"] as ConstructionMode[]).map((item) => <button key={item} className={constructionMode === item ? "active" : ""} onClick={() => setConstructionMode(item)}>{({ construction: "施工态", finished: "完工态", xray: "X-Ray" } as const)[item]}</button>)}<button onClick={() => overlayInput.current?.click()}>导入 Overlay</button><button onClick={exportOverlay}>导出 Overlay</button><input ref={overlayInput} hidden type="file" accept="application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importOverlay(file); event.currentTarget.value = ""; }} /></div>
    </header>
    <div className="three-d-canvas"><Canvas key={projection} orthographic={projection === "orthographic"} camera={projection === "orthographic" ? { position: [10, 10, 10], zoom: 30 } : { position: [10, 10, 10], fov: 50 }} dpr={[1, 1.25]} gl={{ antialias: true, powerPreference: "high-performance" }} onPointerMissed={() => onSelect(null)}><color attach="background" args={["#dfe6e9"]} /><PascalScenePreview scene={scene} layers={layers} hiddenNodeIds={hiddenNodeIds} levelMode={levelMode} wallMode={wallMode} selectedId={selectedId} onSelect={(id) => onSelect(id)} overlay={overlay} constructionMode={constructionMode} onSurfaceHit={onSurfaceHit} onSurfaceFinish={finishPath} /><ConduitScene overlay={overlay} selectedId={selectedId} constructionMode={constructionMode} visibleSystems={visibleSystems} draft={draft.map((point) => point.position)} draftColor={overlay.settings.colors[system]} onSelect={onSelect} onBranch={(segment, position) => onBranch(segment.id, position)} /><Navigation bounds={scene.bounds} preset={preset} /></Canvas><div className="three-d-walkthrough-hint">左键选择/落点 · Shift 锁主轴 · 右键旋转 · 中键平移 · 滚轮缩放 · 双击/Enter 完成 · Esc 取消</div></div>
    <footer className="three-d-status"><span>{scene.itemCount} 件家具 · 不加载 GLB · {scene.hasRoofData ? "已读取屋顶数据" : "当前文件无屋顶数据"}</span><span>{overlay.segments.length} 段管线 · {overlay.fittings.length} 个接头 · {overlay.wallChases.length} 条墙槽 · {overlay.penetrations.length} 个穿孔</span><span>{status}</span>{hostAssessment.missingHostIds.length > 0 && <span className="three-d-warning">{hostAssessment.missingHostIds.length} 个 Overlay 宿主悬空</span>}{scene.diagnostics.map((diagnostic) => <span className={`three-d-${diagnostic.severity}`} key={diagnostic.code}>{diagnostic.message}</span>)}</footer>
    {pending && <div className="conduit-confirm"><b>施工影响确认</b><span>{pending.segments.length} 段直管、{pending.fittings.length} 个弯头、{pending.wallChases.length} 条墙槽、{pending.penetrations.length} 个穿孔。</span><button className="active" onClick={() => { commit(commitPlannedRoute(overlay, pending)); setPending(null); setTool("select"); setStatus("已提交管线路由与施工影响。") }}>确认提交</button><button onClick={() => setPending(null)}>返回修改</button></div>}
  </section>;
}
