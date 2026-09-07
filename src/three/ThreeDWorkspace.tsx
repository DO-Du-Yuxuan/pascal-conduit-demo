import { CameraControls, CameraControlsImpl } from "@react-three/drei";
import { Canvas, type ThreeEvent, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackSide, Box3, Vector3 } from "three";
import { ConduitScene, type BranchPreview, type ConduitTool, type DevicePreview } from "../components/ConduitScene";
import { createEmptyOverlay, parseOverlay, SYSTEM_DEFAULTS, type Circuit, type ConduitOverlayDocument, type HostAttachment, type NetworkDevice, type NetworkDeviceType, type NetworkPort, type Penetration, type RoutePoint, type RouteSegment, type RoutingSystem, type SurfaceChase, type SurfaceMode } from "../domain/overlay";
import { commitBranchRoute, commitPlannedRoute, deleteNetworkObject, planBranchContinuation, planRoute, type ConstructionVisualParameters, type PenetrationRequest, type PlannedRoute } from "../domain/routing";
import { validateBranchCandidate, withCollisionDiagnostics } from "../domain/routing-collision";
import { DEVICE_DEFAULTS, commitDeviceRoute, commitEndpointRoute, createNetworkDevice, deviceDiagnostics, insertDeviceOnSegment, placeDeviceAtEndpoint, rootLegacyNetwork, startRouteFromDevice, type OpenRouteEndpoint } from "../domain/devices";
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
type Tool = ConduitTool;
type BranchStart = { segmentId: string; point: RoutePoint };
type DeviceRouteStart = { circuit: Circuit; port: NetworkPort; overlay: ConduitOverlayDocument };
type AppliedConstruction = { surfaceChases: SurfaceChase[]; penetrations: Penetration[] };

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
const sameRoutePoint = (left: RoutePoint | null, right: RoutePoint | null) => left === right || Boolean(left && right && left.attachment?.hostId === right.attachment?.hostId && left.position.every((value, axis) => Math.abs(value - right.position[axis]) < 1e-5));
const sameFeatureRevision = <T,>(applied: T[], current: T[]) => applied === current || applied.length === 0 && current.length === 0;

function useRafCoalescedCursor(initial: RoutePoint | null) {
  const [value, setValue] = useState(initial), latest = useRef(initial), frame = useRef<number | null>(null);
  const setImmediate = useCallback((next: RoutePoint | null) => {
    latest.current = next;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    setValue((current) => sameRoutePoint(current, next) ? current : next);
  }, []);
  const schedule = useCallback((next: RoutePoint | null) => {
    latest.current = next;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const pending = latest.current;
      setValue((current) => sameRoutePoint(current, pending) ? current : pending);
    });
  }, []);
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
  return [value, setImmediate, schedule, latest] as const;
}
const sameDevicePreview = (left: DevicePreview | null, right: DevicePreview | null) => left === right || Boolean(left && right && left.deviceType === right.deviceType && left.segmentId === right.segmentId && left.valid === right.valid && left.point.attachment?.hostId === right.point.attachment?.hostId && left.point.position.every((value, axis) => Math.abs(value - right.point.position[axis]) < 1e-5));
function useRafCoalescedDevicePreview(initial: DevicePreview | null) {
  const [value, setValue] = useState(initial), latest = useRef(initial), frame = useRef<number | null>(null);
  const setImmediate = useCallback((next: DevicePreview | null) => {
    latest.current = next;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    setValue((current) => sameDevicePreview(current, next) ? current : next);
  }, []);
  const schedule = useCallback((next: DevicePreview | null) => {
    latest.current = next;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const pending = latest.current;
      setValue((current) => sameDevicePreview(current, pending) ? current : pending);
    });
  }, []);
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
  return [value, setImmediate, schedule, latest] as const;
}
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
  const publishOverlay = useOverlayStore((state) => state.publish);
  const loadSharedOverlay = useOverlayStore((state) => state.load);
  const markOverlayExported = useOverlayStore((state) => state.markExported);
  const publishRoutePreview = useOverlayStore((state) => state.publishPreview);
  const clearRoutePreview = useOverlayStore((state) => state.clearPreview);
  const initialSharedState = useRef(useOverlayStore.getState()).current;
  const matchingOverlay = initialSharedState.overlay?.source.sha256 === sourceSha ? initialSharedState.overlay : null;
  const [preset, setPreset] = useState<ViewPreset>("exterior"), [layers, setLayers] = useState<ThreeDLayerVisibility>(DEFAULT_3D_LAYERS), [levelMode, setLevelMode] = useState<LevelMode>("stacked"), [wallMode, setWallMode] = useState<WallMode>("up"), [projection, setProjection] = useState<"perspective" | "orthographic">("perspective");
  const [overlay, setOverlay] = useState(() => copy(matchingOverlay ?? createEmptyOverlay(sourceFile, sourceSha))), [overlayDirty, setOverlayDirty] = useState(() => Boolean(matchingOverlay && initialSharedState.dirty)), [undoStack, setUndoStack] = useState<ConduitOverlayDocument[]>([]), [redoStack, setRedoStack] = useState<ConduitOverlayDocument[]>([]);
  const [tool, setTool] = useState<Tool>("select"), [system, setSystem] = useState<RoutingSystem>("receptacle"), [diameterMm, setDiameterMm] = useState(20), [surfaceMode, setSurfaceMode] = useState<SurfaceMode>("surface"), [constructionParameters, setConstructionParameters] = useState<ConstructionVisualParameters>({ chaseWidthMm: 30, chaseDepthMm: 25, penetrationDiameterMm: 30 }), [draft, setDraft] = useState<RoutePoint[]>([]), [orthogonal, setOrthogonal] = useState(true), [worldAxis, setWorldAxis] = useState<WorldAxis | null>(null), [panelCollapsed, setPanelCollapsed] = useState(false), [branchStart, setBranchStart] = useState<BranchStart | null>(null), [branchEnd, setBranchEnd] = useState<RoutePoint | null>(null), [branchPreview, setBranchPreview] = useState<BranchPreview | null>(null), [penetrationSession, setPenetrationSession] = useState<PenetrationSession | null>(null), [explicitPenetrations, setExplicitPenetrations] = useState<PenetrationRequest[]>([]), [hoverId, setHoverId] = useState<string | null>(null), [chaseFallbacks, setChaseFallbacks] = useState<Set<string>>(() => new Set());
  const [cursor, setCursor, scheduleCursor, latestCursor] = useRafCoalescedCursor(null);
  const [deviceType, setDeviceType] = useState<NetworkDeviceType>("strong-panel"), [deviceRouteStart, setDeviceRouteStart] = useState<DeviceRouteStart | null>(null), [endpointRouteStart, setEndpointRouteStart] = useState<OpenRouteEndpoint | null>(null), [inlineDevicePreview, setInlineDevicePreview, scheduleInlineDevicePreview, latestDevicePreview] = useRafCoalescedDevicePreview(null);
  const [appliedConstruction, setAppliedConstruction] = useState<AppliedConstruction>({ surfaceChases: [], penetrations: [] });
  const overlayInput = useRef<HTMLInputElement>(null);
  const rawSurfaceHit = useRef<ThreeDSurfaceHit | null>(null);
  const surfaceOccluded = useRef(false);
  const selectedSegment = overlay.segments.find((segment) => segment.id === selectedId);
  const selectedFitting = overlay.fittings.find((fitting) => fitting.id === selectedId);
  const selectedBox = overlay.junctionBoxes.find((box) => box.id === selectedId);
  const selectedDevice = overlay.devices.find((device) => device.id === selectedId);
  const networkDiagnostics = useMemo(() => deviceDiagnostics(overlay), [overlay]);
  const constructionPending = !sameFeatureRevision(appliedConstruction.surfaceChases, overlay.surfaceChases) || !sameFeatureRevision(appliedConstruction.penetrations, overlay.penetrations);
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
    setOverlay(copy(restored ?? createEmptyOverlay(sourceFile, sourceSha))); setOverlayDirty(Boolean(restored && stored.dirty)); setUndoStack([]); setRedoStack([]); setDraft([]); setCursor(null); setBranchStart(null); setBranchEnd(null); setBranchPreview(null); setPenetrationSession(null); setExplicitPenetrations([]); setWorldAxis(null); setOrthogonal(true); setDeviceRouteStart(null); setEndpointRouteStart(null); setInlineDevicePreview(null); setAppliedConstruction({ surfaceChases: [], penetrations: [] });
  }, [scene?.sceneKey, sourceFile, sourceSha]);
  useEffect(() => { publishOverlay(overlay, overlayDirty); }, [overlay, overlayDirty, publishOverlay]);
  useEffect(() => { setChaseFallbacks(new Set()); }, [appliedConstruction.surfaceChases, appliedConstruction.penetrations, scene?.sceneKey]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const editable = event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement;
      if (editable) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); setOverlayDirty(true); if (event.shiftKey) setRedoStack((redo) => { const next = redo[redo.length - 1]; if (!next) return redo; setUndoStack((undo) => [...undo, overlay]); setOverlay(next); return redo.slice(0, -1); }); else setUndoStack((undo) => { const previous = undo[undo.length - 1]; if (!previous) return undo; setRedoStack((redo) => [...redo, overlay]); setOverlay(previous); return undo.slice(0, -1); }); return; }
      if (event.code === "Space") { event.preventDefault(); if (event.repeat) return; setTool("select"); setDraft([]); setCursor(null); setBranchStart(null); setBranchEnd(null); setBranchPreview(null); setPenetrationSession(null); setExplicitPenetrations([]); setWorldAxis(null); setDeviceRouteStart(null); setEndpointRouteStart(null); setStatus("已切换到选择模式。"); return; }
      if (event.key === "Shift" && !event.repeat) { event.preventDefault(); setOrthogonal((value) => !value); return; }
      if (["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(event.key) && (draft.length || event.key === "ArrowDown")) { const next = directionStateForArrow(event.key as DirectionArrow); event.preventDefault(); setWorldAxis(next.worldAxis); setOrthogonal(next.orthogonal); return; }
      if (event.key === "Escape") { if (penetrationSession) { setPenetrationSession(null); setCursor(null); return; } setBranchStart(null); setBranchEnd(null); setCursor(null); setExplicitPenetrations([]); setWorldAxis(null); setDraft((points) => points.length > 1 ? points.slice(0, -1) : []); }
      if (event.key === "Enter") { event.preventDefault(); finishCurrentRoute(); }
      if (event.key === "Tab" && (tool === "draw" || tool === "branch" && branchStart) && latestCursor.current?.attachment && draft.length) {
        event.preventDefault();
        const liveCursor = latestCursor.current, displayedPoints = previewRoutePoints(draft, liveCursor, orthogonal ? "orthogonal" : "free"), displayed = displayedPoints[displayedPoints.length - 1] ?? liveCursor, session = beginPenetration(draft, displayed, orthogonal);
        if (session) { setPenetrationSession(session); setCursor(null); setStatus("已锁定入射方向；移至宿主另一侧并点击确认出口。"); }
      }
    };
    window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown);
  }, [overlay, draft, system, diameterMm, surfaceMode, constructionParameters, tool, cursor, branchStart, branchEnd, explicitPenetrations, worldAxis, orthogonal, penetrationSession, inlineDevicePreview, deviceType, latestCursor]);

  const commit = (next: ConduitOverlayDocument) => { setUndoStack((history) => [...history, overlay]); setRedoStack([]); setOverlay(next); setOverlayDirty(true); };
  const selectSystem = (next: RoutingSystem) => { const nextDiameter = SYSTEM_DEFAULTS[next].diameterMm; setSystem(next); setDiameterMm(nextDiameter); setSurfaceMode(SYSTEM_DEFAULTS[next].mode); setConstructionParameters({ chaseWidthMm: nextDiameter + 10, chaseDepthMm: nextDiameter + 5, penetrationDiameterMm: nextDiameter + 10 }); setDraft([]); setBranchStart(null); };
  const validatedPlan = (points: RoutePoint[], ignoredSegmentId?: string, ignoredDeviceId?: string): PlannedRoute => {
    const plan = ignoredSegmentId
      ? planBranchContinuation(overlay, ignoredSegmentId, points, constructionParameters, explicitPenetrations)
      : planRoute(system, diameterMm, surfaceMode, points, constructionParameters, explicitPenetrations, { bendRadiusMm: overlay.settings.bendRadiusMm, stockLengthMm: overlay.settings.stockLengthMm });
    if (!plan) throw new Error("目标分支管段不存在。");
    const ignoredDeviceIds = new Set([deviceRouteStart?.port.owner.id, ignoredDeviceId].filter((id): id is string => Boolean(id)));
    return withCollisionDiagnostics(overlay, plan, ignoredSegmentId, ignoredDeviceIds);
  };
  const resolveEffectiveCursor = (raw: RoutePoint | null): RoutePoint | null => {
    if (!raw || !draft.length) return raw;
    const points = displayedRoutePoints(draft, raw, orthogonal ? "orthogonal" : "free", { worldAxis, penetration: penetrationSession });
    return points[points.length - 1] ?? raw;
  };
  const clearCompletedDraft = () => { setDraft([]); setCursor(null); setBranchStart(null); setBranchEnd(null); setBranchPreview(null); setExplicitPenetrations([]); setPenetrationSession(null); setWorldAxis(null); setEndpointRouteStart(null); };
  const rejectDiagnostics = (plan: PlannedRoute) => { const first = plan.diagnostics[0]; setStatus(first?.message ?? "当前路径无效，不能生成。"); };
  const finishCurrentRoute = () => {
    if (tool === "point") {
      const devicePreview = latestDevicePreview.current;
      if (devicePreview?.valid && devicePreview.segmentId) {
        const next = insertDeviceOnSegment(overlay, devicePreview.segmentId, deviceType, devicePreview.point.position);
        if (next !== overlay) { commit(next); setInlineDevicePreview(null); setStatus(`已在管段上插入${DEVICE_DEFAULTS[deviceType].label}。`); }
        else setStatus(`${DEVICE_DEFAULTS[deviceType].label}不能插入当前管段。`);
      } else if (cursor) {
        try { commit({ ...overlay, devices: [...overlay.devices, createNetworkDevice(deviceType, cursor)] }); setCursor(null); setStatus(`已放置${DEVICE_DEFAULTS[deviceType].label}。`); }
        catch { setStatus(`${DEVICE_DEFAULTS[deviceType].label}不能放置在当前宿主。`); }
      }
      return;
    }
    if (tool !== "draw" && tool !== "branch") return;
    if (tool === "draw" && !deviceRouteStart && !endpointRouteStart) return;
    if (penetrationSession) return;
    const preview = resolveEffectiveCursor(latestCursor.current);
    const points = preview && (!draft.length || preview.position.some((value, axis) => Math.abs(value - draft[draft.length - 1].position[axis]) > 1e-7)) ? [...draft, preview] : draft;
    if (points.length < 2) return;
    const plan = validatedPlan(points, branchStart?.segmentId);
    if (!plan.canCommit) { rejectDiagnostics(plan); return; }
    if (tool === "branch" && branchStart) { const next = commitBranchRoute(overlay, branchStart.segmentId, points, constructionParameters, explicitPenetrations, plan); if (next === overlay) { setStatus("分支转角或节点空间不足，不能生成。"); return; } commit(next); } else if (deviceRouteStart) commit(commitDeviceRoute(deviceRouteStart.overlay, plan, deviceRouteStart.circuit, deviceRouteStart.port)); else if (endpointRouteStart) commit(commitEndpointRoute(overlay, endpointRouteStart, plan));
    clearCompletedDraft(); setDeviceRouteStart(null); setStatus(tool === "branch" ? (system === "sprinkler" ? "已生成消防三通分支。" : "已生成 86 检修盒分支。") : "已直接生成管线与施工影响。");
  };
  const finishPath = finishCurrentRoute;
  const finishAtCursor = () => {
    if ((tool !== "draw" && tool !== "branch") || !cursor) return finishCurrentRoute();
    if (penetrationSession) return;
    const point = resolveEffectiveCursor(latestCursor.current);
    if (!point) return;
    const points = [...draft, point];
    if (points.length < 2) return;
    const plan = validatedPlan(points, branchStart?.segmentId);
    if (!plan.canCommit) { rejectDiagnostics(plan); return; }
    if (tool === "branch" && branchStart) { const next = commitBranchRoute(overlay, branchStart.segmentId, points, constructionParameters, explicitPenetrations, plan); if (next === overlay) { setStatus("分支转角或节点空间不足，不能生成。"); return; } commit(next); } else if (deviceRouteStart) commit(commitDeviceRoute(deviceRouteStart.overlay, plan, deviceRouteStart.circuit, deviceRouteStart.port)); else if (endpointRouteStart) commit(commitEndpointRoute(overlay, endpointRouteStart, plan)); else return;
    clearCompletedDraft(); setDeviceRouteStart(null); setStatus(tool === "branch" ? (system === "sprinkler" ? "已生成消防三通分支。" : "已生成 86 检修盒分支。") : "已直接生成管线与施工影响。");
  };
  const previewPoints = useMemo(() => displayedRoutePoints(draft, cursor, orthogonal ? "orthogonal" : "free", { worldAxis, penetration: penetrationSession }), [draft, cursor, orthogonal, penetrationSession, worldAxis]);
  const effectiveCursor = resolveEffectiveCursor(cursor);
  const displayDraft = draft.length ? previewPoints : cursor ? [cursor] : [];
  const previewPlan = useMemo(() => displayDraft.length >= 2 && (tool === "draw" || tool === "branch" && branchStart) ? validatedPlan(displayDraft, branchStart?.segmentId) : null, [displayDraft, tool, branchStart, overlay, system, diameterMm, surfaceMode, constructionParameters, explicitPenetrations, deviceRouteStart]);
  useEffect(() => {
    const drawing = tool === "draw" || tool === "branch";
    const deviceNode = inlineDevicePreview ?? (tool === "point" && cursor ? { deviceType, point: cursor, valid: DEVICE_DEFAULTS[deviceType].hostKinds.includes(cursor.attachment?.hostKind ?? "wall") } : undefined);
    const branchNode = branchPreview
      ? { kind: branchPreview.kind, position: branchPreview.point, sizeMm: branchPreview.sizeMm }
      : branchStart
        ? { kind: system === "sprinkler" ? "tee" as const : "junction-box" as const, position: branchStart.point.position, sizeMm: overlay.settings.junctionBoxSizeMm }
        : undefined;
    if ((!drawing || !displayDraft.length && !branchNode) && !deviceNode) { clearRoutePreview(); return; }
    const levelId = [...displayDraft].reverse().find((point) => point.attachment?.levelId)?.attachment?.levelId
      ?? deviceNode?.point.attachment?.levelId
      ?? branchStart?.point.attachment?.levelId
      ?? (branchPreview ? overlay.segments.find((segment) => segment.id === branchPreview.segmentId)?.start.attachment?.levelId : null)
      ?? null;
    publishRoutePreview({ sourceSha, system, diameterMm, levelId, points: displayDraft, plan: previewPlan, branchNode, deviceNode: deviceNode ? { deviceType: deviceNode.deviceType, position: deviceNode.point, valid: deviceNode.valid } : undefined });
  }, [tool, sourceSha, system, diameterMm, displayDraft, previewPlan, branchPreview, branchStart, overlay.settings.junctionBoxSizeMm, overlay.segments, publishRoutePreview, clearRoutePreview, cursor, deviceType, inlineDevicePreview]);
  useEffect(() => () => clearRoutePreview(), [clearRoutePreview]);
  useEffect(() => {
    if (!previewPlan || previewPlan.canCommit) return;
    const first = previewPlan.diagnostics[0], ids = first?.objectIds?.length ? `（${first.objectIds.join("、")}）` : "";
    setStatus(`${first?.message ?? "当前路径无效。"}${ids}`);
  }, [previewPlan?.canCommit, previewPlan?.diagnostics[0]?.code, previewPlan?.diagnostics[0]?.objectIds?.join(":")]);
  const onSurfaceMove = (hit: ThreeDSurfaceHit | null) => {
    if (!hit) { rawSurfaceHit.current = null; surfaceOccluded.current = true; if (!worldAxis) scheduleCursor(null); return; }
    surfaceOccluded.current = false;
    rawSurfaceHit.current = hit;
    const active = draft[draft.length - 1];
    if (tool === "point") { scheduleCursor(routePoint(hit)); return; }
    if (tool === "draw" && !deviceRouteStart && !endpointRouteStart) { scheduleCursor(null); return; }
    if (penetrationSession) { scheduleCursor(hit.attachment.hostId === penetrationSession.host.hostId ? null : projectPenetrationExit(penetrationSession, routePoint(hit))); return; }
    if (!worldAxis && (tool === "draw" || (tool === "branch" && branchStart)) && (!active?.attachment || active.attachment.hostKind !== "wall")) scheduleCursor(routePoint(hit));
  };
  const onSurfaceHit = (hit: ThreeDSurfaceHit) => {
    if (tool === "point") { try { commit({ ...overlay, devices: [...overlay.devices, createNetworkDevice(deviceType, routePoint(hit))] }); setCursor(null); } catch { setStatus(`${DEVICE_DEFAULTS[deviceType].label}不能放置在当前宿主。`); } return; }
    if (tool === "draw" && !deviceRouteStart && !endpointRouteStart) return;
    if (tool !== "draw" && !(tool === "branch" && branchStart)) return;
    const point = resolveConfirmedRoutePoint(resolveEffectiveCursor(latestCursor.current), routePoint(hit));
    if (!point) return;
    if (penetrationSession) { const exit = projectPenetrationExit(penetrationSession, point); if (!exit) return; setDraft((points) => [...points, penetrationSession.entry, exit]); setExplicitPenetrations((items) => [...items, penetrationRequest(penetrationSession, exit)]); setOrthogonal(penetrationSession.orthogonal); setWorldAxis(null); setPenetrationSession(null); setCursor(null); setStatus("已确认穿透出口并恢复目标宿主约束；继续画管或按 Enter 直接生成。"); return; }
    const constrained = point, candidate = [...draft, constrained];
    if (candidate.length >= 2) { const plan = validatedPlan(candidate, branchStart?.segmentId); if (!plan.canCommit) { rejectDiagnostics(plan); return; } }
    setDraft(candidate); setBranchEnd(constrained); setCursor(null); setStatus("已确定落点；移动鼠标预览下一段，按 Enter、双击或完成路径直接生成。");
  };
  const onStartDeviceRoute = (device: NetworkDevice, portId?: string) => {
    if (tool !== "draw") { onSelect(device.id); return; }
    if (deviceRouteStart && draft.length) {
      const endPort = device.ports.find((port) => port.system === system && port.role !== "source" && port.connectedSegmentIds.length === 0);
      if (!endPort) return;
      const plan = validatedPlan([...draft, endPort.position], undefined, device.id);
      if (!plan.canCommit) { rejectDiagnostics(plan); return; }
      commit(commitDeviceRoute(deviceRouteStart.overlay, plan, deviceRouteStart.circuit, deviceRouteStart.port, device.id)); clearCompletedDraft(); setDeviceRouteStart(null); return;
    }
    const availableSystem = device.systems.includes(system) ? system : device.systems[0];
    if (!availableSystem) return;
    try {
      const started = startRouteFromDevice(overlay, device.id, availableSystem, portId);
      selectSystem(availableSystem); setDeviceRouteStart(started); setEndpointRouteStart(null); setDraft([structuredClone(started.port.position)]); setCursor(null);
    } catch { setStatus("该设备没有合法的开放输出端口。"); }
  };
  const onStartEndpoint = (endpoint: OpenRouteEndpoint) => {
    if (tool !== "draw" || deviceRouteStart || endpointRouteStart) return;
    selectSystem(endpoint.system); setEndpointRouteStart(endpoint); setDraft([structuredClone(endpoint.point)]); setCursor(null); setStatus("已从开放管端开始续画。");
  };
  const onConnectLegacy = (segment: RouteSegment, projected: [number, number, number]) => {
    if (tool !== "draw" || !deviceRouteStart || !draft.length || !segment.legacyUnrooted) return;
    if (segment.system !== system) { setStatus("旧线路与当前来源系统不兼容。"); return; }
    const distance = (point: RoutePoint) => Math.hypot(...point.position.map((value, axis) => value - projected[axis]));
    const target = distance(segment.start) <= distance(segment.end) ? segment.start : segment.end;
    if (distance(target) > .15) { setStatus("只能把合法来源接到旧线路的开放管端，不能接入管段中部。"); return; }
    const plan = validatedPlan([...draft, structuredClone(target)], segment.id);
    if (!plan.canCommit) { rejectDiagnostics(plan); return; }
    const routed = commitDeviceRoute(deviceRouteStart.overlay, plan, deviceRouteStart.circuit, deviceRouteStart.port);
    const rooted = rootLegacyNetwork(routed, segment.id, deviceRouteStart.circuit.id);
    if (rooted === routed) { setStatus("旧线路无法重新建立来源，请检查系统和旧 Circuit。"); return; }
    commit(rooted); clearCompletedDraft(); setDeviceRouteStart(null); setStatus("旧线路已接入合法来源并恢复为可编辑 Circuit。");
  };
  const onBranch = (segmentId: string, position: [number, number, number]) => {
    if (tool !== "branch") return;
    const segment = overlay.segments.find((item) => item.id === segmentId);
    if (!segment) return;
    if (segment.system === "network") { setStatus("网络线路不允许分支。"); return; }
    if (segment.legacyUnrooted) { setStatus("旧线路尚未接入合法源设备，不能继续分支。"); return; }
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
  const importOverlay = async (file: File) => { const imported = parseOverlay(JSON.parse(await file.text())); setOverlay(imported); setOverlayDirty(false); loadSharedOverlay(imported); setUndoStack([]); setRedoStack([]); setAppliedConstruction({ surfaceChases: [], penetrations: [] }); };
  const exportOverlay = () => { const url = URL.createObjectURL(new Blob([JSON.stringify(overlay, null, 2)], { type: "application/json" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "conduit-overlay.json"; anchor.click(); URL.revokeObjectURL(url); setOverlayDirty(false); markOverlayExported(); };
  const choosePreset = (next: Extract<ViewPreset, "exterior" | "interior" | "floor" | "ceiling">) => { const nextState = viewStateForPreset({ preset, layers, levelMode, wallMode, walkthrough: false }, next); setPreset(nextState.preset); setLayers(nextState.layers); setLevelMode(nextState.levelMode); setWallMode(nextState.wallMode); };
  const onPointerRay = (origin: [number, number, number], direction: [number, number, number]) => {
    const surfaceHit = rawSurfaceHit.current;
    const blockedByOpening = surfaceOccluded.current;
    rawSurfaceHit.current = null;
    surfaceOccluded.current = false;
    if (worldAxis && draft.length) { scheduleCursor(pointOnWorldAxis(draft[draft.length - 1], worldAxis, origin, direction)); return; }
    if (blockedByOpening) { scheduleCursor(null); return; }
    const active = draft[draft.length - 1];
    if (penetrationSession) { scheduleCursor(surfaceHit && surfaceHit.attachment.hostId !== penetrationSession.host.hostId ? projectPenetrationExit(penetrationSession, routePoint(surfaceHit)) : null); return; }
    if ((tool === "draw" || tool === "branch" && branchStart) && active?.attachment?.hostKind === "wall") {
      const projected = projectRayToActiveWall(scene?.nodes[active.attachment.hostId], active, origin, direction);
      if (projected) { scheduleCursor(projected); return; }
      if (surfaceHit) scheduleCursor(routePoint(surfaceHit));
      else scheduleCursor(null);
    } else if ((tool === "draw" || tool === "branch" && branchStart) && !surfaceHit) {
      scheduleCursor(null);
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
          {networkDiagnostics.length > 0 && <section><b>网络诊断</b>{networkDiagnostics.slice(0, 8).map((message) => <small role="alert" key={message}>{message}</small>)}</section>}
          {selectedDevice && <section><b>设备属性</b><span>{selectedDevice.id}</span><label>名称<input value={selectedDevice.name} onChange={(event) => commit({ ...overlay, devices: overlay.devices.map((device) => device.id === selectedDevice.id ? { ...device, name: event.target.value } : device) })} /></label><label>类型 {DEVICE_DEFAULTS[selectedDevice.deviceType].label}</label>{(["宽", "高", "深"] as const).map((label, axis) => <label key={label}>{label}<input type="number" min="1" value={selectedDevice.sizeMm[axis]} onChange={(event) => { const size = [...selectedDevice.sizeMm] as [number, number, number]; size[axis] = Math.max(1, Number(event.target.value)); commit({ ...overlay, devices: overlay.devices.map((device) => device.id === selectedDevice.id ? { ...device, sizeMm: size } : device) }); }} /> mm</label>)}<label>宿主 {selectedDevice.position.attachment?.hostId ?? "悬空"}</label><label>方向 {selectedDevice.orientation.map((value) => value.toFixed(2)).join(", ")}</label><label>已连接端口 {selectedDevice.ports.filter((port) => port.connectedSegmentIds.length).length}/{selectedDevice.ports.length}</label></section>}
          <section><b>编辑工具</b><div className="conduit-button-grid">{(["select", "draw", "branch", "point", "delete"] as Tool[]).map((item) => <button key={item} className={tool === item ? "active" : ""} onClick={() => { setTool(item); setDraft([]); setCursor(null); setBranchStart(null); setBranchEnd(null); setBranchPreview(null); setInlineDevicePreview(null); setPenetrationSession(null); setExplicitPenetrations([]); setDeviceRouteStart(null); setEndpointRouteStart(null); }}>{({ select: "选择", draw: "画管", branch: "分支", point: "点位", delete: "删除" } as const)[item]}</button>)}</div><div className="conduit-button-grid"><button disabled={Boolean(penetrationSession) || displayDraft.length < 2 || Boolean(previewPlan && !previewPlan.canCommit)} onClick={finishPath}>完成路径</button><button disabled={!draft.length && !branchStart && !penetrationSession} onClick={() => { setDraft([]); setCursor(null); setBranchStart(null); setBranchEnd(null); setBranchPreview(null); setInlineDevicePreview(null); setPenetrationSession(null); setExplicitPenetrations([]); setWorldAxis(null); setDeviceRouteStart(null); setEndpointRouteStart(null); }}>取消</button></div><small>新线路先点击合法设备端口，或点击任一已接源的开放管端。</small></section>
          <section><b>设备点位</b><label>设备<select value={deviceType} onChange={(event) => setDeviceType(event.target.value as NetworkDeviceType)}>{(Object.keys(DEVICE_DEFAULTS) as NetworkDeviceType[]).map((key) => <option key={key} value={key}>{DEVICE_DEFAULTS[key].label}</option>)}</select></label><small>点位工具可放置设备；终端设备和喷淋头也可插入兼容管段。</small></section>
          <section><b>管线参数</b><label>系统<select disabled={tool === "branch" && Boolean(branchStart)} value={system} onChange={(event) => selectSystem(event.target.value as RoutingSystem)}>{(Object.keys(SYSTEM_DEFAULTS) as RoutingSystem[]).map((key) => <option key={key} value={key}>{SYSTEM_DEFAULTS[key].label}</option>)}</select></label><label>外径 <input disabled={tool === "branch" && Boolean(branchStart)} type="number" min="5" max="200" value={diameterMm} onChange={(event) => setDiameterMm(Number(event.target.value))} /> mm</label><label>敷设<select value={surfaceMode} onChange={(event) => setSurfaceMode(event.target.value as SurfaceMode)}><option value="surface">贴面暗敷</option><option value="suspended">吊顶内明敷</option></select></label><div className="conduit-button-grid"><button className={orthogonal ? "active" : ""} onClick={() => setOrthogonal((value) => !value)}>正交 {orthogonal ? "开" : "关"}</button><button className={worldAxis ? "active" : ""} onClick={() => setWorldAxis(null)}>{worldAxis ? `世界 ${worldAxis.toUpperCase()}` : "宿主面"}</button></div><small>按 Shift 切换正交；← X、↑ Y、→ Z 锁定世界轴；↓ 恢复宿主面；Tab 穿透当前宿主。大弯固定 200 mm，定尺固定 4000 mm。</small></section>
          <section><b>施工参数</b><label>槽宽 <input type="number" min="1" value={constructionParameters.chaseWidthMm} onChange={(event) => setConstructionParameters((current) => ({ ...current, chaseWidthMm: Math.max(1, Number(event.target.value)) }))} /> mm</label><label>槽深 <input type="number" min="1" value={constructionParameters.chaseDepthMm} onChange={(event) => setConstructionParameters((current) => ({ ...current, chaseDepthMm: Math.max(1, Number(event.target.value)) }))} /> mm</label><label>穿孔径 <input type="number" min="1" value={constructionParameters.penetrationDiameterMm} onChange={(event) => setConstructionParameters((current) => ({ ...current, penetrationDiameterMm: Math.max(1, Number(event.target.value)) }))} /> mm</label><button className={constructionPending ? "construction-update active" : "construction-update"} disabled={!constructionPending} onClick={() => { setChaseFallbacks(new Set()); setAppliedConstruction({ surfaceChases: overlay.surfaceChases, penetrations: overlay.penetrations }); }}>生成/更新槽孔</button><small>槽孔数据随管线保存；建筑切割仅在点击更新后生成。</small>{chaseFallbacks.size > 0 && <small role="alert">{chaseFallbacks.size} 个宿主浅槽切割失败，已保留 Overlay 并显示替代槽线。</small>}</section>
          <section><b>图层</b>{(Object.keys(SYSTEM_DEFAULTS) as RoutingSystem[]).map((key) => <label key={key}><input type="checkbox" checked={overlay.settings.visibleSystems[key]} onChange={() => { setOverlay((current) => ({ ...current, settings: { ...current.settings, visibleSystems: { ...current.settings.visibleSystems, [key]: !current.settings.visibleSystems[key] } } })); setOverlayDirty(true); }} />{SYSTEM_DEFAULTS[key].label}</label>)}</section>
          <section><b>历史与文件</b><div className="conduit-button-grid"><button disabled={!undoStack.length} onClick={() => { const previous = undoStack[undoStack.length - 1]; if (previous) { setRedoStack((history) => [...history, overlay]); setUndoStack((history) => history.slice(0, -1)); setOverlay(previous); setOverlayDirty(true); } }}>撤销</button><button disabled={!redoStack.length} onClick={() => { const next = redoStack[redoStack.length - 1]; if (next) { setUndoStack((history) => [...history, overlay]); setRedoStack((history) => history.slice(0, -1)); setOverlay(next); setOverlayDirty(true); } }}>重做</button></div><div className="conduit-button-grid"><button onClick={() => overlayInput.current?.click()}>导入</button><button onClick={exportOverlay}>导出</button></div><input ref={overlayInput} hidden type="file" accept="application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importOverlay(file); event.currentTarget.value = ""; }} /></section>
          {selectedId && <section><b>已选对象</b><span>{selectedId}</span>{selectedSegment && <><label>系统 {SYSTEM_DEFAULTS[selectedSegment.system].label}</label><small>系统由 Circuit 来源决定，不能单独修改管段系统。</small><label>外径 <input type="number" value={selectedSegment.diameterMm} onChange={(event) => { const value = Number(event.target.value); if (value > 0) commit({ ...overlay, segments: overlay.segments.map((segment) => segment.id === selectedSegment.id ? { ...segment, diameterMm: value } : segment) }); }} /> mm</label></>}{selectedFitting && <label>接头 {selectedFitting.fitting === "tee" ? "三通" : selectedFitting.fitting === "coupling" ? "直接接头" : selectedFitting.bendStyle === "sweep" ? "圆角大弯" : "弯头"}</label>}{selectedBox && <label>86 检修盒 {selectedBox.sizeMm.join(" × ")} mm</label>}<small>管段、接头、检修盒、墙槽和穿孔均与 2D 共享选择状态。</small></section>}
        </>}
      </aside>
      <Canvas key={projection} frameloop="demand" orthographic={projection === "orthographic"} camera={projection === "orthographic" ? ORTHOGRAPHIC_CAMERA : PERSPECTIVE_CAMERA} dpr={CANVAS_DPR} gl={CANVAS_GL} onPointerMissed={() => selectWhileBrowsing(null)}><color attach="background" args={["#dfe6e9"]} /><PascalScenePreview scene={scene} layers={layers} hiddenNodeIds={hiddenNodeIds} levelMode={levelMode} wallMode={wallMode} selectedId={selectedId} highlightHostId={tool === "draw" || tool === "point" || tool === "branch" && branchStart ? effectiveCursor?.attachment?.hostId : null} previousRoutePoint={draft[draft.length - 1]} penetrationBypassHostId={penetrationSession?.host.hostId} onSelect={selectWhileBrowsing} overlay={overlay} appliedSurfaceChases={appliedConstruction.surfaceChases} appliedPenetrations={appliedConstruction.penetrations} constructionMode="construction" onSurfaceHit={onSurfaceHit} onSurfaceMove={onSurfaceMove} onSurfaceFinish={finishAtCursor} onChaseFallback={reportChaseFallback} /><ConduitScene overlay={overlay} selectedId={selectedId} constructionMode="construction" visibleSystems={overlay.settings.visibleSystems} appliedSurfaceChases={appliedConstruction.surfaceChases} fallbackChaseKeys={chaseFallbacks} draft={displayDraft.map((point) => point.position)} draftColor={overlay.settings.colors[system]} previewPlan={previewPlan} conflictPoints={previewPlan?.diagnostics.flatMap((item) => item.point ? [item.point] : [])} branchPreview={branchPreview} previewHost={effectiveCursor?.attachment} deviceType={deviceType} devicePreview={inlineDevicePreview ?? (tool === "point" && cursor ? { deviceType, point: cursor, valid: DEVICE_DEFAULTS[deviceType].hostKinds.includes(cursor.attachment?.hostKind ?? "wall") } : null)} tool={tool} hoverId={hoverId} onHover={setHoverId} onBranchPreview={(preview) => { if (!preview) { setBranchPreview(null); return; } const radius = preview.kind === "junction-box" ? Math.hypot(...preview.sizeMm) / 2000 : SYSTEM_DEFAULTS.sprinkler.diameterMm / 1000; setBranchPreview({ ...preview, valid: preview.valid && validateBranchCandidate(overlay, preview.segmentId, preview.point, radius).length === 0 }); }} onDevicePreview={scheduleInlineDevicePreview} onSelect={(id) => selectWhileBrowsing(id)} onBranch={(segment, position) => onBranch(segment.id, position)} onInsertDevice={(segment, position) => { const next = insertDeviceOnSegment(overlay, segment.id, deviceType, position); if (next !== overlay) { commit(next); setStatus(`已在管段上插入${DEVICE_DEFAULTS[deviceType].label}。`); } else setStatus(`${DEVICE_DEFAULTS[deviceType].label}不能插入当前管段。`); setInlineDevicePreview(null); }} onInsertEndpointDevice={(endpoint) => { const next = placeDeviceAtEndpoint(overlay, endpoint, deviceType); if (next !== overlay) { commit(next); setStatus(`已在开放端放置${DEVICE_DEFAULTS[deviceType].label}。`); } else setStatus(`${DEVICE_DEFAULTS[deviceType].label}只能连接当前开放端。`); }} onConnectLegacy={onConnectLegacy} onStartDeviceRoute={onStartDeviceRoute} onStartEndpoint={onStartEndpoint} onDelete={deleteObject} /><PointerCapture bounds={scene.bounds} onRay={onPointerRay} /><Navigation bounds={scene.bounds} preset={preset} /></Canvas><div className="three-d-walkthrough-hint">空格选择 · 左键确认 · Shift 正交开关 · Tab 穿透 · ← X / ↑ Y / → Z 悬空轴 · ↓ 取消轴 · 右键旋转 · Enter 直接生成</div>
    </div>
  </section>;
}
