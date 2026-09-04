import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import defaultLayout from "../sample-data/default-layout.json";
import { BuildingScene, type SurfaceHit } from "./components/BuildingScene";
import { ConduitScene } from "./components/ConduitScene";
import { PlanView } from "./components/PlanView";
import { parseBuilding, sceneFingerprint, type BuildingScene as Building, type Vec3 } from "./domain/building";
import { assessOverlayHosts, createEmptyOverlay, parseOverlay, SYSTEM_DEFAULTS, type RoutePoint, type RoutingSystem, type SurfaceMode } from "./domain/overlay";
import { branchAtSegment, commitPlannedRoute, planRoute, type PlannedRoute } from "./domain/routing";
import { useOverlayStore } from "./domain/store";

const DEFAULT_SHA = "32d135bef65a6a0fdb06485cc24a68a68cd864e9a4322907971c659b26c7e167";
type View = "3d" | "2d";
type ConstructionMode = "construction" | "finished" | "xray";
type BranchStart = { segmentId: string; point: RoutePoint };

function asRoutePoint(hit: SurfaceHit): RoutePoint { return { position: hit.point, attachment: hit.attachment }; }
function constrainPoint(first: RoutePoint, next: RoutePoint): RoutePoint {
  const dx = Math.abs(next.position[0] - first.position[0]), dy = Math.abs(next.position[1] - first.position[1]), dz = Math.abs(next.position[2] - first.position[2]);
  if (dx >= dy && dx >= dz) return { ...next, position: [next.position[0], first.position[1], first.position[2]] };
  if (dy >= dx && dy >= dz) return { ...next, position: [first.position[0], next.position[1], first.position[2]] };
  return { ...next, position: [first.position[0], first.position[1], next.position[2]] };
}

export default function App() {
  const [building, setBuilding] = useState<Building>(() => parseBuilding(defaultLayout));
  const [buildingSha, setBuildingSha] = useState(DEFAULT_SHA);
  const overlay = useOverlayStore((state) => state.overlay);
  const load = useOverlayStore((state) => state.load), commit = useOverlayStore((state) => state.commit), undo = useOverlayStore((state) => state.undo), redo = useOverlayStore((state) => state.redo);
  const [view, setView] = useState<View>("3d"), [constructionMode, setConstructionMode] = useState<ConstructionMode>("construction");
  const [system, setSystem] = useState<RoutingSystem>("power"), [diameterMm, setDiameterMm] = useState(20), [surfaceMode, setSurfaceMode] = useState<SurfaceMode>("surface");
  const [visibleSystems, setVisibleSystems] = useState<Record<RoutingSystem, boolean>>({ power: true, "low-voltage": true, signal: true, sprinkler: true });
  const [tool, setTool] = useState<"select" | "draw" | "branch">("select"), [draft, setDraft] = useState<RoutePoint[]>([]), [hover, setHover] = useState<RoutePoint | null>(null), [pending, setPending] = useState<PlannedRoute | null>(null), [branchStart, setBranchStart] = useState<BranchStart | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null), [selectedHostId, setSelectedHostId] = useState<string | null>(null), [status, setStatus] = useState("默认底图已加载，选择系统后可在 3D 中开始绘制。");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { load(createEmptyOverlay("default-layout.json", DEFAULT_SHA)); }, [load]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
      if (event.key === "Escape") { setDraft((current) => current.length > 1 ? current.slice(0, -1) : []); setBranchStart(null); setPending(null); return; }
      if (event.key === "Enter") { event.preventDefault(); finishDraft(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const activeOverlay = overlay;
  const hostAssessment = useMemo(() => activeOverlay ? assessOverlayHosts(activeOverlay, Object.keys(building.nodes)) : { referencedHostIds: [], missingHostIds: [] }, [activeOverlay, building]);
  const previewPoints: Vec3[] = useMemo(() => [...draft, ...(hover && tool === "draw" ? [hover] : [])].map((point) => point.position), [draft, hover, tool]);
  const onSystemChange = (next: RoutingSystem) => { setSystem(next); setDiameterMm(SYSTEM_DEFAULTS[next].diameterMm); setSurfaceMode(SYSTEM_DEFAULTS[next].mode); setDraft([]); setBranchStart(null); };
  const finishDraft = () => {
    if (draft.length < 2) return;
    setPending(planRoute(system, diameterMm, surfaceMode, draft));
    setDraft([]); setHover(null);
  };
  const onSurfaceMove = (hit: SurfaceHit) => {
    setSelectedHostId(hit.attachment.hostId);
    if (tool === "draw" && draft.length) setHover(asRoutePoint(hit));
  };
  const onSurfaceClick = (hit: SurfaceHit) => {
    const point = asRoutePoint(hit);
    setSelectedHostId(hit.attachment.hostId);
    if (pending) return;
    if (tool === "branch" && branchStart && activeOverlay) {
      commit(branchAtSegment(activeOverlay, branchStart.segmentId, branchStart.point, point));
      setBranchStart(null); setStatus("已插入三通与分支。"); return;
    }
    if (tool !== "draw") return;
    setDraft((current) => {
      const next = current.length && hit.shiftKey ? constrainPoint(current[current.length - 1], point) : point;
      return [...current, next];
    });
    setStatus(draft.length ? "继续点击添加转角；按 Enter 或点击完成按钮确认。" : "已确定起点，继续选择表面落点。");
  };
  const onBranch = (segmentId: string, position: Vec3) => {
    if (tool !== "branch" || !activeOverlay) return;
    const segment = activeOverlay.segments.find((candidate) => candidate.id === segmentId);
    if (!segment) return;
    if (segment.system !== system) { setStatus("分支只能连接相同系统的管段。请切换系统后重试。"); return; }
    setBranchStart({ segmentId, point: { position } });
    setStatus("已选择分支起点，请点击建筑表面确定分支终点。");
  };
  const confirmPlan = () => { if (!activeOverlay || !pending) return; commit(commitPlannedRoute(activeOverlay, pending)); setSelectedId(pending.segments[0]?.id ?? null); setStatus(`已提交 ${pending.segments.length} 段管线、${pending.fittings.length} 个接头。`); setPending(null); setTool("select"); };
  const loadBuildingFile = async (file: File) => { const buffer = await file.arrayBuffer(), raw = JSON.parse(new TextDecoder().decode(buffer)), sha256 = await sceneFingerprint(buffer); setBuilding(parseBuilding(raw)); setBuildingSha(sha256); load(createEmptyOverlay(file.name, sha256)); setDraft([]); setPending(null); setStatus(`已导入 ${file.name}，Overlay 已重置为空。`); };
  const importOverlay = async (file: File) => { const imported = parseOverlay(JSON.parse(await file.text())), assessment = assessOverlayHosts(imported, Object.keys(building.nodes)); load(imported); setStatus(imported.source.sha256 === buildingSha ? "Overlay 已恢复。" : assessment.missingHostIds.length ? `Overlay 底图指纹不同；${assessment.missingHostIds.length} 个宿主缺失，相关槽孔不会重建。` : "Overlay 底图指纹不同，但宿主仍存在；已允许只读预览。"); };
  const exportOverlay = () => { if (!activeOverlay) return; const url = URL.createObjectURL(new Blob([JSON.stringify(activeOverlay, null, 2)], { type: "application/json" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "conduit-overlay.json"; anchor.click(); URL.revokeObjectURL(url); };

  if (!activeOverlay) return <main className="app-loading">正在建立空白管线 Overlay…</main>;
  return <main className="app-shell">
    <aside className="left-panel">
      <header><p>Pascal 施工 Demo</p><h1>管线路由</h1><small>建筑底图只读 · 管线独立保存</small></header>
      <section><h2>工作区</h2><div className="button-row"><button className={view === "3d" ? "active" : ""} onClick={() => setView("3d")}>3D 绘制</button><button className={view === "2d" ? "active" : ""} onClick={() => setView("2d")}>2D 查看</button></div></section>
      <section><h2>系统</h2>{(Object.keys(SYSTEM_DEFAULTS) as RoutingSystem[]).map((key) => <button key={key} className={`system-button ${system === key ? "active" : ""}`} style={{ "--system": SYSTEM_DEFAULTS[key].color } as React.CSSProperties} onClick={() => onSystemChange(key)}><i />{SYSTEM_DEFAULTS[key].label}<span>{SYSTEM_DEFAULTS[key].diameterMm} mm</span></button>)}</section>
      <section><h2>敷设</h2><label>直径 <input type="number" min="5" max="200" value={diameterMm} onChange={(event) => setDiameterMm(Number(event.target.value))} /> mm</label><label>方式 <select value={surfaceMode} onChange={(event) => setSurfaceMode(event.target.value as SurfaceMode)}><option value="surface">贴面暗敷</option><option value="suspended">吊顶内明敷</option><option value="penetrate">穿透宿主</option></select></label></section>
      <section><h2>工具</h2><div className="button-row"><button className={tool === "select" ? "active" : ""} onClick={() => { setTool("select"); setDraft([]); }}>选择</button><button className={tool === "draw" ? "active" : ""} onClick={() => { setTool("draw"); setBranchStart(null); }}>画管</button><button className={tool === "branch" ? "active" : ""} onClick={() => { setTool("branch"); setDraft([]); }}>分支</button></div><div className="button-row"><button onClick={finishDraft} disabled={draft.length < 2}>完成路径</button><button onClick={() => setDraft([])} disabled={!draft.length}>取消路径</button></div></section>
      <section><h2>显示</h2><div className="button-row">{(["construction", "finished", "xray"] as ConstructionMode[]).map((item) => <button key={item} className={constructionMode === item ? "active" : ""} onClick={() => setConstructionMode(item)}>{({ construction: "施工态", finished: "完工态", xray: "X-Ray" } as const)[item]}</button>)}</div></section>
      <section><h2>图层</h2>{(Object.keys(SYSTEM_DEFAULTS) as RoutingSystem[]).map((key) => <label className="layer-toggle" key={key}><input type="checkbox" checked={visibleSystems[key]} onChange={(event) => setVisibleSystems((current) => ({ ...current, [key]: event.target.checked }))} /><i style={{ background: SYSTEM_DEFAULTS[key].color }} />{SYSTEM_DEFAULTS[key].label}</label>)}</section>
      <section><h2>文件</h2><input ref={inputRef} className="hidden-input" type="file" accept="application/json" onChange={(event) => event.target.files?.[0] && loadBuildingFile(event.target.files[0])} /><button onClick={() => inputRef.current?.click()}>导入建筑 JSON</button><label className="file-label">导入 Overlay<input className="hidden-input" type="file" accept="application/json" onChange={(event) => event.target.files?.[0] && importOverlay(event.target.files[0])} /></label><button onClick={exportOverlay}>导出 Overlay</button></section>
      <footer><button onClick={undo}>撤销</button><button onClick={redo}>重做</button><p>{status}</p></footer>
    </aside>
    <section className="workspace">
      {view === "3d" ? <div className="canvas-wrap"><Canvas camera={{ position: [12, 10, 12], fov: 48 }} dpr={[1, 1.25]} gl={{ antialias: true, powerPreference: "high-performance" }} onPointerMissed={() => setSelectedId(null)}><color attach="background" args={["#dde7eb"]} /><BuildingScene building={building} mode={constructionMode} selectedHostId={selectedHostId} wallChases={activeOverlay.wallChases} penetrations={activeOverlay.penetrations} onSurfaceMove={onSurfaceMove} onSurfaceClick={onSurfaceClick} onSurfaceFinish={finishDraft} /><ConduitScene overlay={activeOverlay} selectedId={selectedId} constructionMode={constructionMode} visibleSystems={visibleSystems} draft={previewPoints} draftColor={activeOverlay.settings.colors[system]} onSelect={setSelectedId} onBranch={(segment, position) => onBranch(segment.id, position)} /><OrbitControls makeDefault enableDamping={false} mouseButtons={{ LEFT: undefined, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE }} /></Canvas><div className="canvas-hint">左键落点 / 右键旋转 / 中键平移 / 滚轮缩放 / Enter 或双击完成 / Esc 取消</div></div> : <PlanView building={building} overlay={activeOverlay} selectedId={selectedId} visibleSystems={visibleSystems} onSelect={setSelectedId} />}
    </section>
    <aside className="right-panel"><h2>施工影响</h2><p>{activeOverlay.segments.length} 段管线</p><p>{activeOverlay.fittings.length} 个接头</p><p>{activeOverlay.wallChases.length} 条墙槽</p><p>{activeOverlay.penetrations.length} 个穿孔</p><hr /><h2>选择状态</h2><code>{selectedId ?? "未选择对象"}</code>{hostAssessment.missingHostIds.length > 0 && <p className="notice">{hostAssessment.missingHostIds.length} 个 Overlay 宿主悬空；坐标保留，槽孔不重建。</p>}{branchStart && <p className="notice">已选分支起点，请选择终点。</p>}</aside>
    {pending && <div className="confirm-backdrop"><section className="confirm-card"><p>施工影响确认</p><h2>提交这条路径？</h2><ul><li>{pending.segments.length} 段直管</li><li>{pending.fittings.length} 个弯头</li><li>{pending.wallChases.length} 条墙槽</li><li>{pending.penetrations.length} 个穿孔</li></ul><small>槽孔为独立 Overlay 数据；不会修改原始 Pascal JSON。</small><div className="button-row"><button className="active" onClick={confirmPlan}>确认提交</button><button onClick={() => setPending(null)}>返回修改</button></div></section></div>}
  </main>;
}
