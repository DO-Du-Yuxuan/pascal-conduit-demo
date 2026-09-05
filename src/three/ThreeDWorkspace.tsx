import { CameraControls, CameraControlsImpl } from "@react-three/drei";
import { Canvas, type ThreeEvent, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackSide, Box3, Vector3 } from "three";
import { ConduitScene, type BranchPreview, type ConduitTool } from "../components/ConduitScene";
import { createEmptyOverlay, parseOverlay, SYSTEM_DEFAULTS, type ConduitOverlayDocument, type HostAttachment, type RoutePoint, type RouteSegment, type RoutingSystem, type SurfaceMode } from "../domain/overlay";
import { commitBranchRoute, commitPlannedRoute, deleteNetworkObject, planBranchContinuation, planRoute, type ConstructionVisualParameters, type PenetrationRequest, type PlannedRoute } from "../domain/routing";
import { validateBranchCandidate, withCollisionDiagnostics } from "../domain/routing-collision";
import { beginPenetration, directionStateForArrow, displayedRoutePoints, penetrationRequest, pointOnWorldAxis, previewRoutePoints, projectPenetrationExit, resolveConfirmedRoutePoint, type DirectionArrow, type PenetrationSession, type WorldAxis } from "../domain/drawing";
import { useOverlayStore } from "../domain/store";
import { PascalScenePreview, type ThreeDSurfaceHit } from "./PascalScenePreview";
import { projectRayToActiveWall } from "./active-host";
import type { ThreeDBounds, ThreeDSceneInput } from "./scene-input";
import { DEFAULT_3D_LAYERS, type ThreeDLevelMode, type ThreeDViewPreset, type ThreeDWallMode, viewStateForPreset } from "./view-state";

export type ThreeDLayerVisibility = { walls: boolean; floors: boolean; ceilings: boolean; roofs: boolean; openings: boolean; furniture: boolean; zones: boolean };
type ViewPreset = ThreeDViewPreset;
type LevelMode = ThreeDLevelMode;
type WallMode = ThreeDWallMode;
type ConstructionMode = "construction" | "finished" | "xray";
type Tool = ConduitTool;
type BranchStart = { segmentId: string; point: RoutePoint };

// R3F treats the Canvas camera object as configuration. Keep these references
// stable so a drawing-state render cannot momentarily re-apply the initial
// camera position before CameraControls renders the current view again.
const PERSPECTIVE_CAMERA = { position: [10, 10, 10] as [number, number, number], fov: 50 };
const ORTHOGRAPHIC_CAMERA = { position: [10, 10, 10] as [number, number, number], zoom: 30 };
const CANVAS_DPR: [number, number] = [1, 1.25];
const CANVAS_GL = { antialias: true, powerPreference: "high-performance" as const };
const CONTROL_MOUSE_BUTTONS = { left: CameraControlsImpl.ACTION.NONE, middle: CameraControlsImpl.ACTION.TRUCK, right: CameraControlsImpl.ACTION.ROTATE, wheel: CameraControlsImpl.ACTION.DOLLY };
const NO_CAMERA_COLLIDERS: never[] = [];
const GROUND_CAMERA_CLEARANCE = .04;
// The footer was intentionally removed from the workspace: status changes
// must not alter the canvas height while a route is being drawn.
const setStatus = (_message: string) => undefined;

function Navigation({ bounds, preset }: { bounds: ThreeDBounds; preset: ViewPreset }) {
  const controls = useRef<CameraControlsImpl>(null!);
  const canvas = useThree((state) => state.gl.domElement);
  useEffect(() => {
    const suppressBrowserZoom = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    canvas.addEventListener("wheel", suppressBrowserZoom, { capture: true, passive: false });
    return () => canvas.removeEventListener("wheel", suppressBrowserZoom, true);
  }, [canvas]);
  useEffect(() => {
    if (!controls.current) return;
    const extent = Number.MAX_SAFE_INTEGER;
    controls.current.setBoundary(new Box3(new Vector3(-extent, GROUND_CAMERA_CLEARANCE, -extent), new Vector3(extent, extent, extent)));
    const [x, y, z] = bounds.center, distance = bounds.span * 1.35;
    const viewpoints: Record<ViewPreset, [number, number, number, number, number, number]> = {
      exterior: [x + distance, y + distance * .72, z + distance, x, y, z], interior: [x + distance * .55, Math.max(1.6, y), z + distance * .55, x, Math.max(1.35, y), z], floor: [x, y + distance * 1.6, z, x, 0, z], ceiling: [x, Math.max(.7, y - distance * .15), z, x, y + distance * .55, z], top: [x, y + distance * 1.6, z, x, y, z], front: [x, y + distance * .45, z + distance, x, y, z], back: [x, y + distance * .45, z - distance, x, y, z], left: [x - distance, y + distance * .45, z, x, y, z], right: [x + distance, y + distance * .45, z, x, y, z], isometric: [x + distance, y + distance, z + distance, x, y, z],
    };
    const [cameraX, cameraY, cameraZ, targetX, targetY, targetZ] = viewpoints[preset];
    void controls.current.setLookAt(cameraX, cameraY, cameraZ, targetX, targetY, targetZ, false);
  }, [bounds, preset]);
  // `infinityDolly` deliberately moves the orbit target after reaching the
  // closest distance. No scene geometry is registered as a collider, so the
  // camera can pass through walls, ceilings, furniture and conduit. The only
  // boundary is the world ground plane configured above.
  // Infinity dolly only advances the target after minDistance is reached. A
  // near-zero minimum makes wheel motion decay until it feels blocked at the
  // orbit target, so enter pass-through mode at a practical scene-relative
  // distance instead. Hidden or visible scene meshes are never colliders.
  return <CameraControls ref={controls} makeDefault smoothTime={0} draggingSmoothTime={0} dollyToCursor infinityDolly minDistance={Math.max(.12, bounds.span * .01)} maxDistance={Infinity} minZoom={.001} maxZoom={Infinity} boundaryFriction={.12} boundaryEnclosesCamera colliderMeshes={NO_CAMERA_COLLIDERS} mouseButtons={CONTROL_MOUSE_BUTTONS} />;
}

function PointerCapture({ bounds, onRay }: { bounds: ThreeDBounds; onRay: (origin: [number, number, number], direction: [number, number, number]) => void }) {
  const radius = Math.max(10, bounds.span * 4);
  return <mesh position={bounds.center} onPointerMove={(event: ThreeEvent<PointerEvent>) => onRay([event.ray.origin.x, event.ray.origin.y, event.ray.origin.z], [event.ray.direction.x, event.ray.direction.y, event.ray.direction.z])}>
    <sphereGeometry args={[radius, 12, 8]} /><meshBasicMaterial transparent opacity={0} side={BackSide} depthWrite={false} />
  </mesh>;
}

const copy = (overlay: ConduitOverlayDocument) => structuredClone(overlay);
const routePoint = (hit: ThreeDSurfaceHit): RoutePoint => ({ position: hit.point, attachment: hit.attachment });
const branchAttachment = (segment: RouteSegment, t: number): HostAttachment | undefined => {
  const start = segment.start.attachment, end = segment.end.attachment;
  if (!start || !end || start.hostId !== end.hostId) return undefined;
  return { ...start, localPosition: start.localPosition && end.localPosition ? start.localPosition.map((value, axis) => value + (end.localPosition![axis] - value) * t) as [number, number, number] : start.localPosition, curveT: start.curveT !== undefined && end.curveT !== undefined ? start.curveT + (end.curveT - start.curveT) * t : start.curveT };
};

export default function ThreeDWorkspace({ scene, hiddenNodeIds, selectedId, onSelect, sourceFile, sourceSha }: { scene: ThreeDSceneInput | null; hiddenNodeIds: ReadonlySet<string>; selectedId: string | null; onSelect: (id: string | null) => void; sourceFile: string; sourceSha: string }) {
  const sharedOverlay = useOverlayStore((state) => state.overlay);
  const sharedOverlayDirty = useOverlayStore((state) => state.dirty);
  const publishOverlay = useOverlayStore((state) => state.publish);
  const loadSharedOverlay = useOverlayStore((state) => state.load);
  const markOverlayExported = useOverlayStore((state) => state.markExported);
  const publishRoutePreview = useOverlayStore((state) => state.publishPreview);
  const clearRoutePreview = useOverlayStore((state) => state.clearPreview);
  const matchingOverlay = sharedOverlay?.source.sha256 === sourceSha ? sharedOverlay : null;
  const [preset, setPreset] = useState<ViewPreset>("exterior"), [layers, setLayers] = useState<ThreeDLayerVisibility>(DEFAULT_3D_LAYERS), [levelMode, setLevelMode] = useState<LevelMode>("stacked"), [wallMode, setWallMode] = useState<WallMode>("up"), [projection, setProjection] = useState<"perspective" | "orthographic">("perspective");
  const [overlay, setOverlay] = useState(() => copy(matchingOverlay ?? createEmptyOverlay(sourceFile, sourceSha))), [overlayDirty, setOverlayDirty] = useState(() => Boolean(matchingOverlay && sharedOverlayDirty)), [undoStack, setUndoStack] = useState<ConduitOverlayDocument[]>([]), [redoStack, setRedoStack] = useState<ConduitOverlayDocument[]>([]);
  const [tool, setTool] = useState<Tool>("select"), [system, setSystem] = useState<RoutingSystem>("power"), [diameterMm, setDiameterMm] = useState(20), [surfaceMode, setSurfaceMode] = useState<SurfaceMode>("surface"), [constructionParameters, setConstructionParameters] = useState<ConstructionVisualParameters>({ chaseWidthMm: 30, chaseDepthMm: 25, penetrationDiameterMm: 30 }), [draft, setDraft] = useState<RoutePoint[]>([]), [cursor, setCursor] = useState<RoutePoint | null>(null), [orthogonal, setOrthogonal] = useState(true), [worldAxis, setWorldAxis] = useState<WorldAxis | null>(null), [panelCollapsed, setPanelCollapsed] = useState(false), [branchStart, setBranchStart] = useState<BranchStart | null>(null), [branchEnd, setBranchEnd] = useState<RoutePoint | null>(null), [branchPreview, setBranchPreview] = useState<BranchPreview | null>(null), [penetrationSession, setPenetrationSession] = useState<PenetrationSession | null>(null), [explicitPenetrations, setExplicitPenetrations] = useState<PenetrationRequest[]>([]), [hoverId, setHoverId] = useState<string | null>(null), [constructionMode, setConstructionMode] = useState<ConstructionMode>("construction"), [chaseFallbacks, setChaseFallbacks] = useState<Set<string>>(() => new Set());
  const overlayInput = useRef<HTMLInputElement>(null);
  const rawSurfaceHit = useRef<ThreeDSurfaceHit | null>(null);
  const surfaceOccluded = useRef(false);
  const selectedSegment = overlay.segments.find((segment) => segment.id === selectedId);
  const selectedFitting = overlay.fittings.find((fitting) => fitting.id === selectedId);
  const selectedBox = overlay.junctionBoxes.find((box) => box.id === selectedId);
  const selectWhileBrowsing = (id: string | null) => {
    if (tool === "select") onSelect(id);
  };
  const reportChaseFallback = useCallback((key: string, failed: boolean) => setChaseFallbacks((current) => {
    const next = new Set(current);
    if (failed) next.add(key); else next.delete(key);
    if (next.size === current.size && [...next].every((item) => current.has(item))) return current;
    return next;
  }), []);

  useEffect(() => {
    const stored = useOverlayStore.getState(), restored = stored.overlay?.source.sha256 === sourceSha ? stored.overlay : null;
    setOverlay(copy(restored ?? createEmptyOverlay(sourceFile, sourceSha))); setOverlayDirty(Boolean(restored && stored.dirty)); setUndoStack([]); setRedoStack([]); setDraft([]); setCursor(null); setBranchStart(null); setBranchEnd(null); setBranchPreview(null); setPenetrationSession(null); setExplicitPenetrations([]); setWorldAxis(null); setOrthogonal(true);
  }, [scene?.sceneKey, sourceFile, sourceSha]);
  useEffect(() => { publishOverlay(overlay, overlayDirty); }, [overlay, overlayDirty, publishOverlay]);
  useEffect(() => { setChaseFallbacks(new Set()); }, [overlay.surfaceChases, scene?.sceneKey]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const editable = event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement;
      if (editable) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); setOverlayDirty(true); if (event.shiftKey) setRedoStack((redo) => { const next = redo[redo.length - 1]; if (!next) return redo; setUndoStack((undo) => [...undo, copy(overlay)]); setOverlay(copy(next)); return redo.slice(0, -1); }); else setUndoStack((undo) => { const previous = undo[undo.length - 1]; if (!previous) return undo; setRedoStack((redo) => [...redo, copy(overlay)]); setOverlay(copy(previous)); return undo.slice(0, -1); }); return; }
      if (event.code === "Space") { event.preventDefault(); if (event.repeat) return; setTool("select"); setDraft([]); setCursor(null); setBranchStart(null); setBranchEnd(null); setBranchPreview(null); setPenetrationSession(null); setExplicitPenetrations([]); setWorldAxis(null); setStatus("已切换到选择模式。"); return; }
      if (event.key === "Shift" && !event.repeat) { event.preventDefault(); setOrthogonal((value) => !value); return; }
      if (["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(event.key) && (draft.length || event.key === "ArrowDown")) { const next = directionStateForArrow(event.key as DirectionArrow); event.preventDefault(); setWorldAxis(next.worldAxis); setOrthogonal(next.orthogonal); return; }
      if (event.key === "Escape") { if (penetrationSession) { setPenetrationSession(null); setCursor(null); return; } setBranchStart(null); setBranchEnd(null); setCursor(null); setExplicitPenetrations([]); setWorldAxis(null); setDraft((points) => points.length > 1 ? points.slice(0, -1) : []); }
      if (event.key === "Enter") { event.preventDefault(); finishCurrentRoute(); }
      if (event.key === "Tab" && (tool === "draw" || tool === "branch" && branchStart) && cursor?.attachment && draft.length) {
        event.preventDefault();
        const displayedPoints = previewRoutePoints(draft, cursor, orthogonal ? "orthogonal" : "free"), displayed = displayedPoints[displayedPoints.length - 1] ?? cursor, session = beginPenetration(draft, displayed, orthogonal);
        if (session) { setPenetrationSession(session); setCursor(null); setStatus("已锁定入射方向；移至宿主另一侧并点击确认出口。"); }
      }
    };
    window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown);
  }, [overlay, draft, system, diameterMm, surfaceMode, constructionParameters, tool, cursor, branchStart, branchEnd, explicitPenetrations, worldAxis, orthogonal, penetrationSession]);

  const commit = (next: ConduitOverlayDocument) => { setUndoStack((history) => [...history, copy(overlay)]); setRedoStack([]); setOverlay(copy(next)); setOverlayDirty(true); };
  const selectSystem = (next: RoutingSystem) => { const nextDiameter = SYSTEM_DEFAULTS[next].diameterMm; setSystem(next); setDiameterMm(nextDiameter); setSurfaceMode(SYSTEM_DEFAULTS[next].mode); setConstructionParameters({ chaseWidthMm: nextDiameter + 10, chaseDepthMm: nextDiameter + 5, penetrationDiameterMm: nextDiameter + 10 }); setDraft([]); setBranchStart(null); };
  const validatedPlan = (points: RoutePoint[], ignoredSegmentId?: string): PlannedRoute => {
    const plan = ignoredSegmentId
      ? planBranchContinuation(overlay, ignoredSegmentId, points, constructionParameters, explicitPenetrations)
      : planRoute(system, diameterMm, surfaceMode, points, constructionParameters, explicitPenetrations, { bendRadiusMm: overlay.settings.bendRadiusMm, stockLengthMm: overlay.settings.stockLengthMm });
    if (!plan) throw new Error("目标分支管段不存在。");
    return withCollisionDiagnostics(overlay, plan, ignoredSegmentId);
  };
  const clearCompletedDraft = () => { setDraft([]); setCursor(null); setBranchStart(null); setBranchEnd(null); setBranchPreview(null); setExplicitPenetrations([]); setPenetrationSession(null); setWorldAxis(null); };
  const rejectDiagnostics = (plan: PlannedRoute) => { const first = plan.diagnostics[0]; setStatus(first?.message ?? "当前路径无效，不能生成。"); };
  const finishCurrentRoute = () => {
    if (tool !== "draw" && tool !== "branch") return;
    if (penetrationSession) return;
    const preview = effectiveCursor;
    const points = preview && (!draft.length || preview.position.some((value, axis) => Math.abs(value - draft[draft.length - 1].position[axis]) > 1e-7)) ? [...draft, preview] : draft;
    if (points.length < 2) return;
    const plan = validatedPlan(points, branchStart?.segmentId);
    if (!plan.canCommit) { rejectDiagnostics(plan); return; }
    if (tool === "branch" && branchStart) { const next = commitBranchRoute(overlay, branchStart.segmentId, points, constructionParameters, explicitPenetrations); if (next === overlay) { setStatus("分支转角或节点空间不足，不能生成。"); return; } commit(next); } else commit(commitPlannedRoute(overlay, plan));
    clearCompletedDraft(); setStatus(tool === "branch" ? (system === "sprinkler" ? "已生成消防三通分支。" : "已生成 86 检修盒分支。") : "已直接生成管线与施工影响。");
  };
  const finishPath = finishCurrentRoute;
  const finishAtCursor = () => {
    if ((tool !== "draw" && tool !== "branch") || !cursor) return finishCurrentRoute();
    if (penetrationSession) return;
    const point = effectiveCursor;
    if (!point) return;
    const points = [...draft, point];
    if (points.length < 2) return;
    const plan = validatedPlan(points, branchStart?.segmentId);
    if (!plan.canCommit) { rejectDiagnostics(plan); return; }
    if (tool === "branch" && branchStart) { const next = commitBranchRoute(overlay, branchStart.segmentId, points, constructionParameters, explicitPenetrations); if (next === overlay) { setStatus("分支转角或节点空间不足，不能生成。"); return; } commit(next); } else commit(commitPlannedRoute(overlay, plan));
    clearCompletedDraft(); setStatus(tool === "branch" ? (system === "sprinkler" ? "已生成消防三通分支。" : "已生成 86 检修盒分支。") : "已直接生成管线与施工影响。");
  };
  const previewPoints = useMemo(() => displayedRoutePoints(draft, cursor, orthogonal ? "orthogonal" : "free", { worldAxis, penetration: penetrationSession }), [draft, cursor, orthogonal, penetrationSession, worldAxis]);
  const effectiveCursor = cursor && draft.length ? previewPoints[previewPoints.length - 1] : cursor;
  const displayDraft = draft.length ? previewPoints : cursor ? [cursor] : [];
  const previewPlan = useMemo(() => displayDraft.length >= 2 && (tool === "draw" || tool === "branch" && branchStart) ? validatedPlan(displayDraft, branchStart?.segmentId) : null, [displayDraft, tool, branchStart, overlay, system, diameterMm, surfaceMode, constructionParameters, explicitPenetrations]);
  useEffect(() => {
    const drawing = tool === "draw" || tool === "branch";
    const branchNode = branchPreview
      ? { kind: branchPreview.kind, position: branchPreview.point, sizeMm: branchPreview.sizeMm }
      : branchStart
        ? { kind: system === "sprinkler" ? "tee" as const : "junction-box" as const, position: branchStart.point.position, sizeMm: overlay.settings.junctionBoxSizeMm }
        : undefined;
    if (!drawing || !displayDraft.length && !branchNode) { clearRoutePreview(); return; }
    const levelId = [...displayDraft].reverse().find((point) => point.attachment?.levelId)?.attachment?.levelId
      ?? branchStart?.point.attachment?.levelId
      ?? (branchPreview ? overlay.segments.find((segment) => segment.id === branchPreview.segmentId)?.start.attachment?.levelId : null)
      ?? null;
    publishRoutePreview({ sourceSha, system, diameterMm, levelId, points: displayDraft, plan: previewPlan, branchNode });
  }, [tool, sourceSha, system, diameterMm, displayDraft, previewPlan, branchPreview, branchStart, overlay.settings.junctionBoxSizeMm, overlay.segments, publishRoutePreview, clearRoutePreview]);
  useEffect(() => () => clearRoutePreview(), [clearRoutePreview]);
  useEffect(() => {
    if (!previewPlan || previewPlan.canCommit) return;
    const first = previewPlan.diagnostics[0], ids = first?.objectIds?.length ? `（${first.objectIds.join("、")}）` : "";
    setStatus(`${first?.message ?? "当前路径无效。"}${ids}`);
  }, [previewPlan?.canCommit, previewPlan?.diagnostics[0]?.code, previewPlan?.diagnostics[0]?.objectIds?.join(":")]);
  const onSurfaceMove = (hit: ThreeDSurfaceHit | null) => {
    if (!hit) { rawSurfaceHit.current = null; surfaceOccluded.current = true; if (!worldAxis) setCursor(null); return; }
    surfaceOccluded.current = false;
    rawSurfaceHit.current = hit;
    const active = draft[draft.length - 1];
    if (penetrationSession) { setCursor(hit.attachment.hostId === penetrationSession.host.hostId ? null : projectPenetrationExit(penetrationSession, routePoint(hit))); return; }
    if (!worldAxis && (tool === "draw" || (tool === "branch" && branchStart)) && (!active?.attachment || active.attachment.hostKind !== "wall")) setCursor(routePoint(hit));
  };
  const onSurfaceHit = (hit: ThreeDSurfaceHit) => {
    if (tool !== "draw" && !(tool === "branch" && branchStart)) return;
    const point = resolveConfirmedRoutePoint(effectiveCursor, routePoint(hit));
    if (!point) return;
    if (penetrationSession) { const exit = projectPenetrationExit(penetrationSession, point); if (!exit) return; setDraft((points) => [...points, penetrationSession.entry, exit]); setExplicitPenetrations((items) => [...items, penetrationRequest(penetrationSession, exit)]); setOrthogonal(penetrationSession.orthogonal); setWorldAxis(null); setPenetrationSession(null); setCursor(null); setStatus("已确认穿透出口并恢复目标宿主约束；继续画管或按 Enter 直接生成。"); return; }
    const constrained = point, candidate = [...draft, constrained];
    if (candidate.length >= 2) { const plan = validatedPlan(candidate, branchStart?.segmentId); if (!plan.canCommit) { rejectDiagnostics(plan); return; } }
    setDraft(candidate); setBranchEnd(constrained); setCursor(null); setStatus("已确定落点；移动鼠标预览下一段，按 Enter、双击或完成路径直接生成。");
  };
  const onBranch = (segmentId: string, position: [number, number, number]) => {
    if (tool !== "branch") return;
    const segment = overlay.segments.find((item) => item.id === segmentId);
    if (!segment) return;
    const total = Math.hypot(...segment.end.position.map((value, axis) => value - segment.start.position[axis])), fromStart = Math.hypot(...position.map((value, axis) => value - segment.start.position[axis])), clearance = segment.system === "sprinkler" ? segment.diameterMm / 1000 : overlay.settings.junctionBoxSizeMm[0] / 2000;
    if (fromStart <= clearance || total - fromStart <= clearance) { setStatus("该分支点距离管端或管件太近，不能放置分支节点。"); return; }
    const nodeRadius = segment.system === "sprinkler" ? segment.diameterMm / 1000 : Math.hypot(...overlay.settings.junctionBoxSizeMm) / 2000, nodeConflicts = validateBranchCandidate(overlay, segmentId, position, nodeRadius);
    if (nodeConflicts.length) { setStatus(`${nodeConflicts[0].message}（${nodeConflicts[0].objectIds?.join("、") ?? "未知对象"}）`); return; }
    const t = total < 1e-9 ? 0 : fromStart / total, attachment = branchAttachment(segment, t), start: RoutePoint = attachment ? { position, attachment } : { position };
    setSystem(segment.system); setDiameterMm(segment.diameterMm); setSurfaceMode(SYSTEM_DEFAULTS[segment.system].mode); setBranchStart({ segmentId, point: start }); setDraft([start]); setBranchEnd(null); setBranchPreview(null); setCursor(null); setStatus(segment.system === "sprinkler" ? "已确定三通位置；继续绘制消防分支。" : "已确定 86 检修盒位置；继续绘制分支线管。");
  };
  const deleteObject = (id: string) => {
    commit(deleteNetworkObject(overlay, id));
    onSelect(null); setHoverId(null); setStatus("已删除对象及孤立施工特征。");
  };
  const importOverlay = async (file: File) => { const imported = parseOverlay(JSON.parse(await file.text())); setOverlay(imported); setOverlayDirty(false); loadSharedOverlay(imported); setUndoStack([]); setRedoStack([]); };
  const exportOverlay = () => { const url = URL.createObjectURL(new Blob([JSON.stringify(overlay, null, 2)], { type: "application/json" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "conduit-overlay.json"; anchor.click(); URL.revokeObjectURL(url); setOverlayDirty(false); markOverlayExported(); };
  const choosePreset = (next: Extract<ViewPreset, "exterior" | "interior" | "floor" | "ceiling">) => { const nextState = viewStateForPreset({ preset, layers, levelMode, wallMode, walkthrough: false }, next); setPreset(nextState.preset); setLayers(nextState.layers); setLevelMode(nextState.levelMode); setWallMode(nextState.wallMode); };
  const onPointerRay = (origin: [number, number, number], direction: [number, number, number]) => {
    const surfaceHit = rawSurfaceHit.current;
    const blockedByOpening = surfaceOccluded.current;
    rawSurfaceHit.current = null;
    surfaceOccluded.current = false;
    if (worldAxis && draft.length) { setCursor(pointOnWorldAxis(draft[draft.length - 1], worldAxis, origin, direction)); return; }
    if (blockedByOpening) { setCursor(null); return; }
    const active = draft[draft.length - 1];
    if (penetrationSession) { setCursor(surfaceHit && surfaceHit.attachment.hostId !== penetrationSession.host.hostId ? projectPenetrationExit(penetrationSession, routePoint(surfaceHit)) : null); return; }
    if ((tool === "draw" || tool === "branch" && branchStart) && active?.attachment?.hostKind === "wall") {
      const projected = projectRayToActiveWall(scene?.nodes[active.attachment.hostId], active, origin, direction);
      if (projected) { setCursor(projected); return; }
      if (surfaceHit) setCursor(routePoint(surfaceHit));
      else setCursor(null);
    } else if ((tool === "draw" || tool === "branch" && branchStart) && !surfaceHit) {
      setCursor(null);
    }
  };

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
          <section><b>编辑工具</b><div className="conduit-button-grid">{(["select", "draw", "branch", "delete"] as Tool[]).map((item) => <button key={item} className={tool === item ? "active" : ""} onClick={() => { setTool(item); setDraft([]); setCursor(null); setBranchStart(null); setBranchEnd(null); setBranchPreview(null); setPenetrationSession(null); setExplicitPenetrations([]); }}>{({ select: "选择", draw: "画管", branch: "分支", delete: "删除" } as const)[item]}</button>)}</div><div className="conduit-button-grid"><button disabled={Boolean(penetrationSession) || displayDraft.length < 2 || Boolean(previewPlan && !previewPlan.canCommit)} onClick={finishPath}>完成路径</button><button disabled={!draft.length && !branchStart && !penetrationSession} onClick={() => { setDraft([]); setCursor(null); setBranchStart(null); setBranchEnd(null); setBranchPreview(null); setPenetrationSession(null); setExplicitPenetrations([]); setWorldAxis(null); }}>取消</button></div></section>
          <section><b>管线参数</b><label>系统<select disabled={tool === "branch" && Boolean(branchStart)} value={system} onChange={(event) => selectSystem(event.target.value as RoutingSystem)}>{(Object.keys(SYSTEM_DEFAULTS) as RoutingSystem[]).map((key) => <option key={key} value={key}>{SYSTEM_DEFAULTS[key].label}</option>)}</select></label><label>外径 <input disabled={tool === "branch" && Boolean(branchStart)} type="number" min="5" max="200" value={diameterMm} onChange={(event) => setDiameterMm(Number(event.target.value))} /> mm</label><label>敷设<select value={surfaceMode} onChange={(event) => setSurfaceMode(event.target.value as SurfaceMode)}><option value="surface">贴面暗敷</option><option value="suspended">吊顶内明敷</option></select></label><label>大弯半径 <input type="number" min="1" value={overlay.settings.bendRadiusMm} onChange={(event) => { setOverlay((current) => ({ ...current, settings: { ...current.settings, bendRadiusMm: Math.max(1, Number(event.target.value)) } })); setOverlayDirty(true); }} /> mm</label><label>定尺长度 <input type="number" min="100" value={overlay.settings.stockLengthMm} onChange={(event) => { setOverlay((current) => ({ ...current, settings: { ...current.settings, stockLengthMm: Math.max(100, Number(event.target.value)) } })); setOverlayDirty(true); }} /> mm</label><div className="conduit-button-grid"><button className={orthogonal ? "active" : ""} onClick={() => setOrthogonal((value) => !value)}>正交 {orthogonal ? "开" : "关"}</button><button className={worldAxis ? "active" : ""} onClick={() => setWorldAxis(null)}>{worldAxis ? `世界 ${worldAxis.toUpperCase()}` : "宿主面"}</button></div><small>按 Shift 切换正交；← X、↑ Y、→ Z 锁定世界轴；↓ 恢复宿主面；Tab 穿透当前宿主。</small></section>
          <section><b>施工显示</b><div className="conduit-button-grid">{(["construction", "finished", "xray"] as ConstructionMode[]).map((item) => <button key={item} className={constructionMode === item ? "active" : ""} onClick={() => setConstructionMode(item)}>{({ construction: "施工态", finished: "完工态", xray: "X-Ray" } as const)[item]}</button>)}</div><label>槽宽 <input type="number" min="1" value={constructionParameters.chaseWidthMm} onChange={(event) => setConstructionParameters((current) => ({ ...current, chaseWidthMm: Math.max(1, Number(event.target.value)) }))} /> mm</label><label>槽深 <input type="number" min="1" value={constructionParameters.chaseDepthMm} onChange={(event) => setConstructionParameters((current) => ({ ...current, chaseDepthMm: Math.max(1, Number(event.target.value)) }))} /> mm</label><label>穿孔径 <input type="number" min="1" value={constructionParameters.penetrationDiameterMm} onChange={(event) => setConstructionParameters((current) => ({ ...current, penetrationDiameterMm: Math.max(1, Number(event.target.value)) }))} /> mm</label><small>以上为 Demo 视觉参数，非施工规范结论。</small>{chaseFallbacks.size > 0 && <small role="alert">{chaseFallbacks.size} 个宿主浅槽切割失败，已保留 Overlay 并显示替代槽线。</small>}</section>
          <section><b>图层</b>{(Object.keys(SYSTEM_DEFAULTS) as RoutingSystem[]).map((key) => <label key={key}><input type="checkbox" checked={overlay.settings.visibleSystems[key]} onChange={() => { setOverlay((current) => ({ ...current, settings: { ...current.settings, visibleSystems: { ...current.settings.visibleSystems, [key]: !current.settings.visibleSystems[key] } } })); setOverlayDirty(true); }} />{SYSTEM_DEFAULTS[key].label}</label>)}</section>
          <section><b>历史与文件</b><div className="conduit-button-grid"><button disabled={!undoStack.length} onClick={() => { const previous = undoStack[undoStack.length - 1]; if (previous) { setRedoStack((history) => [...history, copy(overlay)]); setUndoStack((history) => history.slice(0, -1)); setOverlay(copy(previous)); setOverlayDirty(true); } }}>撤销</button><button disabled={!redoStack.length} onClick={() => { const next = redoStack[redoStack.length - 1]; if (next) { setUndoStack((history) => [...history, copy(overlay)]); setRedoStack((history) => history.slice(0, -1)); setOverlay(copy(next)); setOverlayDirty(true); } }}>重做</button></div><div className="conduit-button-grid"><button onClick={() => overlayInput.current?.click()}>导入</button><button onClick={exportOverlay}>导出</button></div><input ref={overlayInput} hidden type="file" accept="application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importOverlay(file); event.currentTarget.value = ""; }} /></section>
          {selectedId && <section><b>已选对象</b><span>{selectedId}</span>{selectedSegment && <><label>系统<select value={selectedSegment.system} onChange={(event) => { const nextSystem = event.target.value as RoutingSystem; commit({ ...overlay, segments: overlay.segments.map((segment) => segment.id === selectedSegment.id ? { ...segment, system: nextSystem, type: nextSystem === "sprinkler" ? "sprinkler-segment" : "conduit-segment" } : segment) }); }}>{(Object.keys(SYSTEM_DEFAULTS) as RoutingSystem[]).map((key) => <option key={key} value={key}>{SYSTEM_DEFAULTS[key].label}</option>)}</select></label><label>外径 <input type="number" value={selectedSegment.diameterMm} onChange={(event) => { const value = Number(event.target.value); if (value > 0) commit({ ...overlay, segments: overlay.segments.map((segment) => segment.id === selectedSegment.id ? { ...segment, diameterMm: value } : segment) }); }} /> mm</label></>}{selectedFitting && <label>接头 {selectedFitting.fitting === "tee" ? "三通" : selectedFitting.fitting === "coupling" ? "直接接头" : selectedFitting.bendStyle === "sweep" ? "圆角大弯" : "弯头"}</label>}{selectedBox && <label>86 检修盒 {selectedBox.sizeMm.join(" × ")} mm</label>}<small>管段、接头、检修盒、墙槽和穿孔均与 2D 共享选择状态。</small></section>}
        </>}
      </aside>
      <Canvas key={projection} orthographic={projection === "orthographic"} camera={projection === "orthographic" ? ORTHOGRAPHIC_CAMERA : PERSPECTIVE_CAMERA} dpr={CANVAS_DPR} gl={CANVAS_GL} onPointerMissed={() => selectWhileBrowsing(null)}><color attach="background" args={["#dfe6e9"]} /><PascalScenePreview scene={scene} layers={layers} hiddenNodeIds={hiddenNodeIds} levelMode={levelMode} wallMode={wallMode} selectedId={selectedId} highlightHostId={tool === "draw" || tool === "branch" && branchStart ? effectiveCursor?.attachment?.hostId : null} previousRoutePoint={draft[draft.length - 1]} penetrationBypassHostId={penetrationSession?.host.hostId} onSelect={selectWhileBrowsing} overlay={overlay} constructionMode={constructionMode} onSurfaceHit={onSurfaceHit} onSurfaceMove={onSurfaceMove} onSurfaceFinish={finishAtCursor} onChaseFallback={reportChaseFallback} /><ConduitScene overlay={overlay} selectedId={selectedId} constructionMode={constructionMode} visibleSystems={overlay.settings.visibleSystems} draft={displayDraft.map((point) => point.position)} draftColor={overlay.settings.colors[system]} previewPlan={previewPlan} conflictPoints={previewPlan?.diagnostics.flatMap((item) => item.point ? [item.point] : [])} branchPreview={branchPreview} previewHost={effectiveCursor?.attachment} tool={tool} hoverId={hoverId} onHover={setHoverId} onBranchPreview={(preview) => { if (!preview) { setBranchPreview(null); return; } const radius = preview.kind === "junction-box" ? Math.hypot(...preview.sizeMm) / 2000 : SYSTEM_DEFAULTS.sprinkler.diameterMm / 1000; setBranchPreview({ ...preview, valid: preview.valid && validateBranchCandidate(overlay, preview.segmentId, preview.point, radius).length === 0 }); }} onSelect={(id) => selectWhileBrowsing(id)} onBranch={(segment, position) => onBranch(segment.id, position)} onDelete={deleteObject} /><PointerCapture bounds={scene.bounds} onRay={onPointerRay} /><Navigation bounds={scene.bounds} preset={preset} /></Canvas><div className="three-d-walkthrough-hint">空格选择 · 左键确认 · Shift 正交开关 · Tab 穿透 · ← X / ↑ Y / → Z 悬空轴 · ↓ 取消轴 · 右键旋转 · Enter 直接生成</div>
    </div>
  </section>;
}
