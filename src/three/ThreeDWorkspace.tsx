import { CameraControls, CameraControlsImpl } from "@react-three/drei";
import { Canvas, type ThreeEvent, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackSide, Box3, Vector3 } from "three";
import { ConduitScene, type BranchPreview, type ConduitTool, type DevicePreview } from "../components/ConduitScene";
import { createEmptyOverlay, parseOverlay, SYSTEM_DEFAULTS, type Circuit, type ConduitOverlayDocument, type HostAttachment, type NetworkDevice, type NetworkDeviceType, type NetworkPort, type Penetration, type RoutePoint, type RouteSegment, type RoutingSystem, type SurfaceChase, type SurfaceMode } from "../domain/overlay";
import { commitBranchRoute, commitJunctionBoxRoute, commitPlannedRoute, deleteNetworkObject, junctionBoxPortCanStart, planBranchContinuation, planRoute, startRouteFromJunctionBox, type ConstructionVisualParameters, type JunctionBoxRouteStart, type PenetrationRequest, type PlannedRoute } from "../domain/routing";
import { validateBranchCandidate, withCollisionDiagnostics } from "../domain/routing-collision";
import { DEVICE_DEFAULTS, commitDeviceRoute, commitEndpointRoute, createNetworkDevice, createReferencePlaneDevice, deviceDiagnostics, deviceTargetPorts, insertDeviceOnSegment, nearestDeviceTargetPort, openRouteEndpoints, placeDeviceAtEndpoint, rootLegacyNetwork, startRouteFromDevice, type OpenRouteEndpoint } from "../domain/devices";
import { beginPenetration, directionStateForArrow, displayedRoutePoints, penetrationRequest, pointOnViewPlane, pointOnWorldAxis, previewRoutePoints, projectPenetrationExit, resolveConfirmedRoutePoint, routePointsForCompletion, type DirectionArrow, type PenetrationSession, type RouteCompletionMode, type WorldAxis } from "../domain/drawing";
import { describeDevicePosition, editDevicePosition, ensureInstallationReferencePlane, resizeDevicePoint, type DevicePositionDescription, type DevicePositioningContext } from "../domain/device-positioning";
import { createLightingControlGroup, removeLightingControlGroup, replaceLightingControlGroup } from "../domain/lighting-controls";
import { formatRouteLengthMm, routeSegmentLengthMm, routeSweepLengthMm } from "../domain/route-length";
import { connectedRouteElementIds } from "../domain/route-selection";
import { projectRoutePointToDirection, resolveOrthogonalDirection, resolveSnapCandidate, resolveTargetClick, type SnapCandidate } from "../domain/snapping";
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
type ControlBindingSession = { kind: "create"; luminaireDeviceIds: string[] } | { kind: "edit"; groupId: string; switchDeviceId: string; luminaireDeviceIds: string[] };

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
const gangLabel = (count: number) => `${["零", "一", "二", "三", "四", "五", "六", "七", "八"][count] ?? count}开`;
const sameRoutePoint = (left: RoutePoint | null, right: RoutePoint | null) => left === right || Boolean(left && right && left.attachment?.hostId === right.attachment?.hostId && left.position.every((value, axis) => Math.abs(value - right.position[axis]) < 1e-5));

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

function PointerCapture({ bounds, onRay, onEmptyClick }: { bounds: ThreeDBounds; onRay: (origin: [number, number, number], direction: [number, number, number]) => void; onEmptyClick: () => void }) {
  const radius = Math.max(10, bounds.span * 4);
  return <mesh position={bounds.center} onPointerMove={(event: ThreeEvent<PointerEvent>) => onRay([event.ray.origin.x, event.ray.origin.y, event.ray.origin.z], [event.ray.direction.x, event.ray.direction.y, event.ray.direction.z])} onClick={(event) => { if (event.nativeEvent.button !== 0) return; event.stopPropagation(); onEmptyClick(); }}>
    <sphereGeometry args={[radius, 12, 8]} /><meshBasicMaterial transparent opacity={0} side={BackSide} depthWrite={false} />
  </mesh>;
}

function InstallationPlane({ bounds, y, onPreview, onPlace }: { bounds: ThreeDBounds; y: number; onPreview: (position: [number, number, number] | null) => void; onPlace: (position: [number, number, number]) => void }) {
  const size = Math.max(4, bounds.span * 1.4);
  return <mesh position={[bounds.center[0], y, bounds.center[2]]} rotation={[-Math.PI / 2, 0, 0]} onPointerMove={(event) => { event.stopPropagation(); onPreview([event.point.x, y, event.point.z]); }} onPointerOut={() => onPreview(null)} onClick={(event) => { if (event.nativeEvent.button !== 0) return; event.stopPropagation(); onPlace([event.point.x, y, event.point.z]); }}>
    <planeGeometry args={[size, size]} /><meshBasicMaterial color="#60a5fa" transparent opacity={.12} depthWrite={false} side={2} />
  </mesh>;
}

const copy = (overlay: ConduitOverlayDocument) => structuredClone(overlay);
const normalizeOverlay = (overlay: ConduitOverlayDocument | null, sourceFile: string, sourceSha: string) => overlay ? parseOverlay(copy(overlay)) : createEmptyOverlay(sourceFile, sourceSha);
const routePoint = (hit: ThreeDSurfaceHit): RoutePoint => ({ position: hit.point, attachment: hit.attachment });
const positioningContext = (scene: ThreeDSceneInput | null): DevicePositioningContext => {
  const levelFloorY: Record<string, number> = {}, wallSpans: Record<string, [number, number]> = {}, wallOpenings: Record<string, { id: string; start: number; end: number }[]> = {}, wallFaces: NonNullable<DevicePositioningContext["wallFaces"]>[number][] = [];
  if (!scene) return { levelFloorY, wallSpans, wallOpenings, wallFaces };
  const levelIdFor = (node: ThreeDSceneInput["nodes"][string]) => { let cursor = node, guard = new Set<string>(); while (cursor && !guard.has(cursor.id)) { guard.add(cursor.id); if (cursor.type === "level") return cursor.id; cursor = cursor.parentId ? scene.nodes[cursor.parentId] : undefined!; } return null; };
  for (const node of Object.values(scene.nodes)) {
    if (node.type === "level") levelFloorY[node.id] = (Number.isFinite(node.level) ? Number(node.level) : 0) * 3.2;
    if (node.type === "wall" && Array.isArray(node.start) && Array.isArray(node.end)) {
      const dx = Number(node.end[0]) - Number(node.start[0]), dz = Number(node.end[1]) - Number(node.start[1]), length = Math.hypot(dx, dz), levelId = levelIdFor(node);
      wallSpans[node.id] = [0, length];
      if (levelId && length > 1e-8) wallFaces.push({ id: node.id, levelId, point: [Number(node.start[0]), levelFloorY[levelId] ?? 0, Number(node.start[1])], normal: [-dz / length, 0, dx / length], start: [Number(node.start[0]), levelFloorY[levelId] ?? 0, Number(node.start[1])], end: [Number(node.end[0]), levelFloorY[levelId] ?? 0, Number(node.end[1])], halfThickness: Number.isFinite(node.thickness) ? Number(node.thickness) / 2 : 0 });
    }
    if ((node.type === "door" || node.type === "window") && (node.wallId || node.parentId) && Array.isArray(node.position) && Number.isFinite(node.position[0]) && Number.isFinite(node.width)) {
      const wallId = node.wallId ?? node.parentId!, center = Number(node.position[0]), half = Number(node.width) / 2;
      (wallOpenings[wallId] ??= []).push({ id: node.id, start: center - half, end: center + half });
    }
    const levelId = levelIdFor(node); if (levelId && !(levelId in levelFloorY)) levelFloorY[levelId] = 0;
  }
  return { levelFloorY, wallSpans, wallOpenings, wallFaces };
};
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
  const [overlay, setOverlay] = useState(() => normalizeOverlay(matchingOverlay, sourceFile, sourceSha)), [overlayDirty, setOverlayDirty] = useState(() => Boolean(matchingOverlay && initialSharedState.dirty)), [undoStack, setUndoStack] = useState<ConduitOverlayDocument[]>([]), [redoStack, setRedoStack] = useState<ConduitOverlayDocument[]>([]);
  const [tool, setTool] = useState<Tool>("select"), [system, setSystem] = useState<RoutingSystem>("receptacle"), [diameterMm, setDiameterMm] = useState(20), [surfaceMode, setSurfaceMode] = useState<SurfaceMode>("surface"), [constructionParameters, setConstructionParameters] = useState<ConstructionVisualParameters>({ chaseWidthMm: 30, chaseDepthMm: 25, penetrationDiameterMm: 30 }), [draft, setDraft] = useState<RoutePoint[]>([]), [orthogonal, setOrthogonal] = useState(true), [worldAxis, setWorldAxis] = useState<WorldAxis | null>(null), [panelCollapsed, setPanelCollapsed] = useState(false), [branchStart, setBranchStart] = useState<BranchStart | null>(null), [branchEnd, setBranchEnd] = useState<RoutePoint | null>(null), [branchPreview, setBranchPreview] = useState<BranchPreview | null>(null), [penetrationSession, setPenetrationSession] = useState<PenetrationSession | null>(null), [explicitPenetrations, setExplicitPenetrations] = useState<PenetrationRequest[]>([]), [hoverId, setHoverId] = useState<string | null>(null), [chaseFallbacks, setChaseFallbacks] = useState<Set<string>>(() => new Set());
  const [cursor, setCursor, scheduleCursor, latestCursor] = useRafCoalescedCursor(null);
  const [deviceType, setDeviceType] = useState<NetworkDeviceType>("strong-panel"), [deviceRouteStart, setDeviceRouteStart] = useState<DeviceRouteStart | null>(null), [junctionRouteStart, setJunctionRouteStart] = useState<JunctionBoxRouteStart | null>(null), [endpointRouteStart, setEndpointRouteStart] = useState<OpenRouteEndpoint | null>(null), [inlineDevicePreview, setInlineDevicePreview, scheduleInlineDevicePreview, latestDevicePreview] = useRafCoalescedDevicePreview(null);
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([]), [selectedSegmentIds, setSelectedSegmentIds] = useState<string[]>([]), [positionDraft, setPositionDraft] = useState<{ horizontal?: number; vertical?: number; elevation?: number; planar?: Record<string, number> }>({}), [departingSegments, setDepartingSegments] = useState<RouteSegment[]>([]);
  const [activeTargetPortId, setActiveTargetPortId] = useState<string | null>(null);
  const [controlBinding, setControlBinding] = useState<ControlBindingSession | null>(null);
  const levels = useMemo(() => Object.values(scene?.nodes ?? {}).filter((node) => node.type === "level").sort((a, b) => Number(a.level ?? 0) - Number(b.level ?? 0) || a.id.localeCompare(b.id)), [scene]);
  const [activeLevelId, setActiveLevelId] = useState<string | null>(null);
  const [appliedConstruction, setAppliedConstruction] = useState<AppliedConstruction>({ surfaceChases: [], penetrations: [] });
  const overlayInput = useRef<HTMLInputElement>(null);
  const rawSurfaceHit = useRef<ThreeDSurfaceHit | null>(null);
  const surfaceOccluded = useRef(false);
  const orthogonalDirection = useRef<[number, number, number] | null>(null);
  const selectedSegment = overlay.segments.find((segment) => segment.id === selectedId);
  const selectedRouteLengths = selectedSegmentIds.flatMap((id) => {
    const segment = overlay.segments.find((item) => item.id === id);
    if (segment) return [{ id, label: "管段", lengthMm: routeSegmentLengthMm(segment) }];
    const sweep = overlay.fittings.find((item) => item.id === id && Boolean(item.arc));
    return sweep ? [{ id, label: "大弯", lengthMm: routeSweepLengthMm(sweep) }] : [];
  });
  const selectedSegmentLengthMm = useMemo(() => selectedRouteLengths.reduce((total, item) => total + item.lengthMm, 0), [selectedRouteLengths]);
  const selectedFitting = overlay.fittings.find((fitting) => fitting.id === selectedId);
  const selectedBox = overlay.junctionBoxes.find((box) => box.id === selectedId);
  const selectedDevice = overlay.devices.find((device) => device.id === selectedId);
  const selectedDevices = selectedDeviceIds.map((id) => overlay.devices.find((device) => device.id === id)).filter((device): device is NetworkDevice => Boolean(device));
  const selectedHasLuminaire = selectedDevices.some((device) => device.deviceType === "luminaire");
  const boundLuminaireIds = new Set(overlay.lightingControlGroups.flatMap((group) => group.luminaireDeviceIds));
  const selectedOnlyUnboundLuminaires = selectedDevices.length > 0 && selectedDevices.length === selectedDeviceIds.length && selectedDevices.every((device) => device.deviceType === "luminaire" && !boundLuminaireIds.has(device.id));
  const selectedSwitchGroups = selectedDevice?.deviceType === "switch" ? overlay.lightingControlGroups.filter((group) => group.switchDeviceId === selectedDevice.id) : [];
  const visibleControlGroups = controlBinding?.kind === "edit"
    ? overlay.lightingControlGroups.filter((group) => group.id === controlBinding.groupId).map((group) => ({ ...group, luminaireDeviceIds: controlBinding.luminaireDeviceIds }))
    : selectedDevice ? overlay.lightingControlGroups.filter((group) => group.switchDeviceId === selectedDevice.id || group.luminaireDeviceIds.includes(selectedDevice.id)) : [];
  const relatedControlDeviceIds = new Set(visibleControlGroups.flatMap((group) => [group.switchDeviceId, ...group.luminaireDeviceIds]));
  const devicePositioningContext = useMemo(() => positioningContext(scene), [scene]);
  const positionDescription = useMemo(() => selectedDevice ? describeDevicePosition(overlay, selectedDevice.id, devicePositioningContext) : {}, [overlay, selectedDevice, devicePositioningContext]);
  useEffect(() => { if (!activeLevelId || !levels.some((level) => level.id === activeLevelId)) setActiveLevelId(levels[0]?.id ?? null); }, [levels, activeLevelId]);
  useEffect(() => { if (selectedDevice?.mount?.kind === "reference-plane") setActiveLevelId(selectedDevice.mount.levelId); }, [selectedDevice?.id]);
  const referencePlaneElevationMm = activeLevelId ? overlay.installationReferencePlanes.find((plane) => plane.levelId === activeLevelId)?.elevationMm ?? 2700 : 2700;
  const referencePlaneY = activeLevelId ? (devicePositioningContext.levelFloorY[activeLevelId] ?? 0) + referencePlaneElevationMm / 1000 : 2.7;
  const renderedOverlay = { ...overlay, devices: overlay.devices.map((device) => Object.assign({}, device, { displaySelected: selectedDeviceIds.includes(device.id) || relatedControlDeviceIds.has(device.id), ...(device.id === selectedDevice?.id ? { displayPosition: positionDescription } : {}) })) } as ConduitOverlayDocument & { devices: (NetworkDevice & { displayPosition?: DevicePositionDescription; displaySelected?: boolean })[] };
  const networkDiagnostics = useMemo(() => deviceDiagnostics(overlay), [overlay]);
  const cancelControlBinding = () => {
    if (controlBinding?.kind === "edit") { onSelect(controlBinding.switchDeviceId); setSelectedDeviceIds([controlBinding.switchDeviceId]); }
    setControlBinding(null);
  };
  const selectWhileBrowsing = (id: string | null, additive = false) => {
    if (controlBinding) { cancelControlBinding(); return; }
    if (tool !== "select") return;
    const isLengthBearingConduit = Boolean(id && (overlay.segments.some((segment) => segment.id === id) || overlay.fittings.some((fitting) => fitting.id === id && Boolean(fitting.arc))));
    if (isLengthBearingConduit) {
      const next = additive ? (selectedSegmentIds.includes(id!) ? selectedSegmentIds.filter((segmentId) => segmentId !== id) : [...selectedSegmentIds, id!]) : [id!];
      setSelectedSegmentIds(next); setSelectedDeviceIds([]); onSelect(next.includes(id!) ? id : next[next.length - 1] ?? null); return;
    }
    onSelect(id); setSelectedSegmentIds([]);
    const isDevice = Boolean(id && overlay.devices.some((device) => device.id === id));
    setSelectedDeviceIds((current) => isDevice ? (additive ? current.includes(id!) ? current : [...current, id!] : [id!]) : []);
  };
  const selectWholeRoute = (id: string) => {
    if (tool !== "select") return;
    const ids = connectedRouteElementIds(overlay, id);
    if (!ids.length) return;
    setSelectedSegmentIds(ids); setSelectedDeviceIds([]); onSelect(id);
  };
  const reportChaseFallback = useCallback((key: string, failed: boolean) => setChaseFallbacks((current) => {
    const next = new Set(current);
    if (failed) next.add(key); else next.delete(key);
    if (next.size === current.size && [...next].every((item) => current.has(item))) return current;
    return next;
  }), []);

  useEffect(() => {
    const stored = useOverlayStore.getState(), restored = stored.overlay?.source.sha256 === sourceSha ? stored.overlay : null;
    setOverlay(normalizeOverlay(restored, sourceFile, sourceSha)); setOverlayDirty(Boolean(restored && stored.dirty)); setUndoStack([]); setRedoStack([]); setDraft([]); setCursor(null); setBranchStart(null); setBranchEnd(null); setBranchPreview(null); setPenetrationSession(null); setExplicitPenetrations([]); setWorldAxis(null); setOrthogonal(true); setDeviceRouteStart(null); setJunctionRouteStart(null); setEndpointRouteStart(null); setInlineDevicePreview(null); setSelectedDeviceIds([]); setSelectedSegmentIds([]); setActiveTargetPortId(null); setControlBinding(null); setPositionDraft({}); setDepartingSegments([]); setAppliedConstruction({ surfaceChases: [], penetrations: [] });
  }, [scene?.sceneKey, sourceFile, sourceSha]);
  useEffect(() => { publishOverlay(overlay, overlayDirty); }, [overlay, overlayDirty, publishOverlay]);
  useEffect(() => { setChaseFallbacks(new Set()); }, [appliedConstruction.surfaceChases, appliedConstruction.penetrations, scene?.sceneKey]);
  useEffect(() => {
    if (!selectedDevice) { setPositionDraft({}); return; }
    setPositionDraft({ elevation: selectedDevice.mount?.kind === "reference-plane" ? selectedDevice.mount.elevationMm : undefined, horizontal: positionDescription.horizontal?.millimeters, vertical: positionDescription.vertical?.millimeters, planar: Object.fromEntries(positionDescription.planar?.map((item) => [item.wallId, item.millimeters]) ?? []) });
  }, [selectedDevice?.id, positionDescription.horizontal?.millimeters, positionDescription.vertical?.millimeters, positionDescription.planar?.map((item) => `${item.wallId}:${item.millimeters}`).join("|")]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const editable = event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement;
      if (editable) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); setOverlayDirty(true); if (event.shiftKey) setRedoStack((redo) => { const next = redo[redo.length - 1]; if (!next) return redo; setUndoStack((undo) => [...undo, overlay]); setOverlay(next); return redo.slice(0, -1); }); else setUndoStack((undo) => { const previous = undo[undo.length - 1]; if (!previous) return undo; setRedoStack((redo) => [...redo, overlay]); setOverlay(previous); return undo.slice(0, -1); }); return; }
      if (event.code === "Space") { event.preventDefault(); if (event.repeat) return; setTool("select"); setDraft([]); setCursor(null); setBranchStart(null); setBranchEnd(null); setBranchPreview(null); setPenetrationSession(null); setExplicitPenetrations([]); setWorldAxis(null); setDeviceRouteStart(null); setJunctionRouteStart(null); setEndpointRouteStart(null); setStatus("已切换到选择模式。"); return; }
      if (!event.metaKey && !event.ctrlKey && event.key.toLowerCase() === "l") { chooseTool("draw"); setStatus("已切换到画管模式。"); return; }
      if (!event.metaKey && !event.ctrlKey && event.key.toLowerCase() === "d") { chooseTool("point"); setStatus("已切换到点位模式。"); return; }
      if ((event.key === "Delete" || event.key === "Backspace") && tool === "select") { if (controlBinding) return; event.preventDefault(); deleteSelectedObjects(); return; }
      if (event.key === "Shift" && !event.repeat) { event.preventDefault(); orthogonalDirection.current = null; setOrthogonal((value) => !value); return; }
      if (["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(event.key) && (draft.length || event.key === "ArrowDown")) { const next = directionStateForArrow(event.key as DirectionArrow); event.preventDefault(); orthogonalDirection.current = null; setWorldAxis(next.worldAxis); setOrthogonal(next.orthogonal); return; }
      if (event.key === "Escape") { if (controlBinding) { cancelControlBinding(); return; } if (tool === "select") { selectWhileBrowsing(null); return; } if (penetrationSession) { setPenetrationSession(null); setCursor(null); return; } setBranchStart(null); setBranchEnd(null); setCursor(null); setExplicitPenetrations([]); setWorldAxis(null); setDraft((points) => points.length > 1 ? points.slice(0, -1) : []); }
      if (event.key === "Enter") { event.preventDefault(); if (controlBinding?.kind === "edit") { finishControlGroupEdit(); return; } finishCurrentRoute("confirmed-only"); }
      if (event.key === "Tab" && (tool === "draw" || tool === "branch" && branchStart) && latestCursor.current?.attachment && draft.length) {
        event.preventDefault();
        const liveCursor = latestCursor.current, displayedPoints = previewRoutePoints(draft, liveCursor, orthogonal ? "orthogonal" : "free"), displayed = displayedPoints[displayedPoints.length - 1] ?? liveCursor, session = beginPenetration(draft, displayed, orthogonal);
        if (session) { setPenetrationSession(session); setCursor(null); setStatus("已锁定入射方向；移至宿主另一侧并点击确认出口。"); }
      }
    };
    window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown);
  }, [overlay, draft, system, diameterMm, surfaceMode, constructionParameters, tool, cursor, branchStart, branchEnd, explicitPenetrations, worldAxis, orthogonal, penetrationSession, inlineDevicePreview, deviceType, latestCursor, selectedId, selectedDeviceIds, controlBinding]);

  const commit = (next: ConduitOverlayDocument) => { setUndoStack((history) => [...history, overlay]); setRedoStack([]); setOverlay(next); setOverlayDirty(true); };
  const finishControlGroupEdit = () => {
    if (controlBinding?.kind !== "edit") return;
    const result = replaceLightingControlGroup(overlay, controlBinding.groupId, controlBinding.luminaireDeviceIds);
    if (result.status !== "committed") { setStatus("所选灯具不能加入该控制组。"); return; }
    commit(result.overlay); cancelControlBinding();
  };
  const onControlDevice = (deviceId: string) => {
    if (!controlBinding) return;
    const device = overlay.devices.find((item) => item.id === deviceId);
    if (controlBinding.kind === "create") {
      if (device?.deviceType !== "switch") return;
      const result = createLightingControlGroup(overlay, deviceId, controlBinding.luminaireDeviceIds);
      if (result.status !== "committed") { setStatus("灯具已绑定或目标不是有效开关。"); return; }
      commit(result.overlay); setControlBinding(null); onSelect(deviceId); setSelectedDeviceIds([deviceId]); setStatus(`已创建第 ${result.overlay.lightingControlGroups.filter((group) => group.switchDeviceId === deviceId).length} 路灯具控制。`); return;
    }
    if (device?.deviceType !== "luminaire") return;
    const belongsElsewhere = overlay.lightingControlGroups.some((group) => group.id !== controlBinding.groupId && group.luminaireDeviceIds.includes(deviceId));
    if (belongsElsewhere) { setStatus("该灯具已属于其他控制组。"); return; }
    setControlBinding((current) => current?.kind === "edit" ? { ...current, luminaireDeviceIds: current.luminaireDeviceIds.includes(deviceId) ? current.luminaireDeviceIds.filter((id) => id !== deviceId) : [...current.luminaireDeviceIds, deviceId] } : current);
    setSelectedDeviceIds((current) => current.includes(deviceId) ? current.filter((id) => id !== deviceId) : [...current, deviceId]);
  };
  const deleteSelectedObjects = () => {
    const ids = [...new Set(selectedDeviceIds.length ? selectedDeviceIds : selectedId ? [selectedId] : [])];
    if (!ids.length) return;
    const next = ids.reduce((current, id) => deleteNetworkObject(current, id), overlay);
    if (next === overlay) return;
    commit(next); onSelect(null); setSelectedDeviceIds([]); setHoverId(null); setStatus(ids.length > 1 ? `已删除 ${ids.length} 个点位及孤立施工特征。` : "已删除对象及孤立施工特征。");
  };
  const applyDevicePosition = (change?: { horizontalClearanceMm?: number; bottomHeightMm?: number; elevationMm?: number; planarClearanceMm?: Record<string, number> }) => {
    if (!selectedDevice) return;
    if (!change || change.horizontalClearanceMm === undefined && change.bottomHeightMm === undefined && change.elevationMm === undefined && !change.planarClearanceMm) return;
    const bulkVertical = change?.elevationMm !== undefined || change?.bottomHeightMm !== undefined;
    const result = editDevicePosition(overlay, { deviceIds: bulkVertical ? selectedDeviceIds : [selectedDevice.id], ...change }, devicePositioningContext, "commit");
    if (result.status !== "committed") { setStatus(result.diagnostics[0] ?? "设备定位值无效。"); return; }
    const leaving = overlay.segments.filter((segment) => result.removedSegmentIds.includes(segment.id));
    setDepartingSegments(leaving); window.setTimeout(() => setDepartingSegments([]), 180);
    commit(result.overlay); setStatus(result.removedSegmentIds.length ? "设备已移动；相邻管段已断开，请从开放管端重新连接。" : "设备定位已更新。");
  };
  const selectSystem = (next: RoutingSystem) => { const nextDiameter = SYSTEM_DEFAULTS[next].diameterMm; setSystem(next); setDiameterMm(nextDiameter); setSurfaceMode(SYSTEM_DEFAULTS[next].mode); setConstructionParameters({ chaseWidthMm: nextDiameter + 10, chaseDepthMm: nextDiameter + 5, penetrationDiameterMm: nextDiameter + 10 }); setDraft([]); setBranchStart(null); };
  const canDrawWithoutSource = tool === "draw" && system === "network";
  const validatedPlan = (points: RoutePoint[], ignoredSegmentId?: string, ignoredDeviceId?: string): PlannedRoute => {
    const plan = ignoredSegmentId
      ? planBranchContinuation(overlay, ignoredSegmentId, points, constructionParameters, explicitPenetrations)
      : planRoute(system, diameterMm, surfaceMode, points, constructionParameters, explicitPenetrations, { bendRadiusMm: overlay.settings.bendRadiusMm, stockLengthMm: overlay.settings.stockLengthMm });
    if (!plan) throw new Error("目标分支管段不存在。");
    const ignoredDeviceIds = new Set([deviceRouteStart?.port.owner.id, junctionRouteStart?.box.id, ignoredDeviceId].filter((id): id is string => Boolean(id)));
    return withCollisionDiagnostics(overlay, plan, ignoredSegmentId, ignoredDeviceIds, endpointRouteStart ? { segmentId: endpointRouteStart.segmentId, point: endpointRouteStart.point.position } : undefined);
  };
  const resolveEffectiveCursor = (raw: RoutePoint | null): RoutePoint | null => {
    if (!raw || !draft.length) return raw;
    const candidates: SnapCandidate[] = [];
    if (branchPreview?.valid && branchPreview.system === system) candidates.push({ kind: "branch", point: { position: branchPreview.point, attachment: branchPreview.attachment }, targetId: branchPreview.segmentId, label: "合法分支位置", distancePixels: 0, compatible: true });
    if (hoverId?.startsWith("open-end:")) {
      const [, segmentId, end] = hoverId.split(":"), endpoint = openRouteEndpoints(overlay).find((item) => item.segmentId === segmentId && item.end === end && item.system === system);
      if (endpoint) candidates.push({ kind: "open-end", point: endpoint.point, targetId: `${endpoint.segmentId}:${endpoint.end}`, label: "开放管端", distancePixels: 0, compatible: true });
    }
    const hoveredDevice = overlay.devices.find((device) => device.id === hoverId);
    const targetPort = hoveredDevice && (deviceTargetPorts(hoveredDevice, system).find((port) => port.id === activeTargetPortId) ?? nearestDeviceTargetPort(hoveredDevice, system, raw.position));
    if (targetPort) candidates.push({ kind: "device-port", point: targetPort.position, targetId: targetPort.id, label: `${hoveredDevice?.name || DEVICE_DEFAULTS[hoveredDevice!.deviceType].label}端口`, distancePixels: 0, compatible: true });
    const snapped = resolveSnapCandidate(draft[draft.length - 1], candidates, { tolerancePixels: 16, worldAxis, hostOrthogonal: orthogonal, orthogonalDirection: orthogonalDirection.current });
    if (snapped.point) return snapped.point;
    if (orthogonal && orthogonalDirection.current) return projectRoutePointToDirection(draft[draft.length - 1], raw, orthogonalDirection.current);
    const points = displayedRoutePoints(draft, raw, orthogonal ? "orthogonal" : "free", { worldAxis, penetration: penetrationSession, allowUnhostedCursor: canDrawWithoutSource });
    return points[points.length - 1] ?? raw;
  };
  const routePointsToTarget = (target: RoutePoint, targetId: string, label: string, ignoredDeviceId: string): RoutePoint[] | null => {
    const targetResolution = resolveTargetClick(draft[draft.length - 1], { kind: "device-port", point: target, targetId, label, distancePixels: 0, compatible: true }, { tolerancePixels: 16, worldAxis, hostOrthogonal: orthogonal, orthogonalDirection: orthogonalDirection.current });
    if (targetResolution.kind === "confirm-alignment") {
      if (!sameRoutePoint(draft[draft.length - 1], targetResolution.point)) {
        const candidate = [...draft, targetResolution.point], plan = validatedPlan(candidate, branchStart?.segmentId, ignoredDeviceId);
        if (!plan.canCommit) { rejectDiagnostics(plan); return null; }
        setDraft(candidate); setBranchEnd(targetResolution.point); orthogonalDirection.current = null;
      }
      setCursor(null); setStatus("已确认设备端口辅助对齐点；管道尚未连接设备，请继续逐点绘制。");
      return null;
    }
    if (targetResolution.kind !== "connect") return null;
    return [...draft, targetResolution.point].filter((point, index, points) => index === 0 || !sameRoutePoint(points[index - 1], point));
  };
  const clearCompletedDraft = () => { setDraft([]); setCursor(null); setBranchStart(null); setBranchEnd(null); setBranchPreview(null); setExplicitPenetrations([]); setPenetrationSession(null); setWorldAxis(null); setJunctionRouteStart(null); setEndpointRouteStart(null); setActiveTargetPortId(null); orthogonalDirection.current = null; };
  const rejectDiagnostics = (plan: PlannedRoute) => { const first = plan.diagnostics[0]; setStatus(first?.message ?? "当前路径无效，不能生成。"); };
  const finishCurrentRoute = (completionMode: RouteCompletionMode = "include-preview") => {
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
    if (tool === "draw" && !deviceRouteStart && !junctionRouteStart && !endpointRouteStart && !canDrawWithoutSource) return;
    if (penetrationSession) return;
    const preview = completionMode === "include-preview" ? resolveEffectiveCursor(latestCursor.current) : null;
    const points = routePointsForCompletion(draft, preview, completionMode);
    if (points.length < 2) return;
    const plan = validatedPlan(points, branchStart?.segmentId);
    if (!plan.canCommit) { rejectDiagnostics(plan); return; }
    if (tool === "branch" && branchStart) { const next = commitBranchRoute(overlay, branchStart.segmentId, points, constructionParameters, explicitPenetrations, plan); if (next === overlay) { setStatus("分支转角或节点空间不足，不能生成。"); return; } commit(next); } else if (deviceRouteStart) commit(commitDeviceRoute(deviceRouteStart.overlay, plan, deviceRouteStart.circuit, deviceRouteStart.port)); else if (junctionRouteStart) commit(commitJunctionBoxRoute(junctionRouteStart.overlay, junctionRouteStart, plan)); else if (endpointRouteStart) commit(commitEndpointRoute(overlay, endpointRouteStart, plan)); else if (canDrawWithoutSource) commit(commitPlannedRoute(overlay, plan));
    clearCompletedDraft(); setDeviceRouteStart(null); setStatus(tool === "branch" ? (system === "sprinkler" ? "已生成消防三通分支。" : "已生成 86 检修盒分支。") : "已直接生成管线与施工影响。");
  };
  const finishPath = () => finishCurrentRoute("include-preview");
  const finishAtCursor = () => {
    if ((tool !== "draw" && tool !== "branch") || !cursor) return finishCurrentRoute();
    if (penetrationSession) return;
    const point = resolveEffectiveCursor(latestCursor.current);
    if (!point) return;
    const points = [...draft, point];
    if (points.length < 2) return;
    const plan = validatedPlan(points, branchStart?.segmentId);
    if (!plan.canCommit) { rejectDiagnostics(plan); return; }
    if (tool === "branch" && branchStart) { const next = commitBranchRoute(overlay, branchStart.segmentId, points, constructionParameters, explicitPenetrations, plan); if (next === overlay) { setStatus("分支转角或节点空间不足，不能生成。"); return; } commit(next); } else if (deviceRouteStart) commit(commitDeviceRoute(deviceRouteStart.overlay, plan, deviceRouteStart.circuit, deviceRouteStart.port)); else if (junctionRouteStart) commit(commitJunctionBoxRoute(junctionRouteStart.overlay, junctionRouteStart, plan)); else if (endpointRouteStart) commit(commitEndpointRoute(overlay, endpointRouteStart, plan)); else if (canDrawWithoutSource) commit(commitPlannedRoute(overlay, plan)); else return;
    clearCompletedDraft(); setDeviceRouteStart(null); setStatus(tool === "branch" ? (system === "sprinkler" ? "已生成消防三通分支。" : "已生成 86 检修盒分支。") : "已直接生成管线与施工影响。");
  };
  const effectiveCursor = resolveEffectiveCursor(cursor);
  const activeTargetDevice = overlay.devices.find((device) => device.id === hoverId);
  const activeTargetPort = activeTargetDevice && deviceTargetPorts(activeTargetDevice, system).find((port) => port.id === activeTargetPortId);
  const activeTargetResolution = draft.length && activeTargetPort ? resolveTargetClick(draft[draft.length - 1], { kind: "device-port", point: activeTargetPort.position, targetId: activeTargetPort.id, label: `${activeTargetDevice?.name || DEVICE_DEFAULTS[activeTargetDevice!.deviceType].label}端口`, distancePixels: 0, compatible: true }, { tolerancePixels: 16, worldAxis, hostOrthogonal: orthogonal, orthogonalDirection: orthogonalDirection.current }) : null;
  const deviceTargetMode = activeTargetResolution?.kind === "connect" ? "connect" : activeTargetResolution?.kind === "confirm-alignment" ? "alignment" : null;
  const snapStatus = !draft.length ? null : activeTargetDevice && activeTargetPort
    ? `设备端口 · ${deviceTargetMode === "connect" ? "连接后结束" : "辅助对齐"}`
    : branchPreview?.valid ? "分支捕捉" : hoverId?.startsWith("open-end:") ? "开放管端 · 捕捉" : null;
  const previewPoints = useMemo(() => displayedRoutePoints(draft, effectiveCursor, "free", { worldAxis, penetration: penetrationSession, allowUnhostedCursor: canDrawWithoutSource }), [draft, effectiveCursor, penetrationSession, worldAxis, canDrawWithoutSource]);
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
    if (tool === "draw" && !deviceRouteStart && !junctionRouteStart && !endpointRouteStart && !canDrawWithoutSource) { scheduleCursor(null); return; }
    if (penetrationSession) { scheduleCursor(hit.attachment.hostId === penetrationSession.host.hostId ? null : projectPenetrationExit(penetrationSession, routePoint(hit))); return; }
    if (orthogonal && active) orthogonalDirection.current = resolveOrthogonalDirection(active, routePoint(hit), orthogonalDirection.current);
    if (!worldAxis && (tool === "draw" || (tool === "branch" && branchStart)) && (!active?.attachment || active.attachment.hostKind !== "wall")) scheduleCursor(routePoint(hit));
  };
  const onDeviceTarget = (device: NetworkDevice, point: [number, number, number] | null) => {
    if (!point) { setHoverId(null); setActiveTargetPortId(null); return; }
    setHoverId(device.id);
    if (!draft.length) { setActiveTargetPortId(null); return; }
    if (orthogonal && !worldAxis) orthogonalDirection.current = resolveOrthogonalDirection(draft[draft.length - 1], { position: point }, orthogonalDirection.current);
    setActiveTargetPortId(nearestDeviceTargetPort(device, system, point)?.id ?? null);
    scheduleCursor({ position: point });
  };
  const onSurfaceHit = (hit: ThreeDSurfaceHit) => {
    if (tool === "point") { try { commit({ ...overlay, devices: [...overlay.devices, createNetworkDevice(deviceType, routePoint(hit))] }); setCursor(null); } catch { setStatus(`${DEVICE_DEFAULTS[deviceType].label}不能放置在当前宿主。`); } return; }
    if (tool === "draw" && !deviceRouteStart && !junctionRouteStart && !endpointRouteStart && !canDrawWithoutSource) return;
    if (tool !== "draw" && !(tool === "branch" && branchStart)) return;
    const point = resolveConfirmedRoutePoint(resolveEffectiveCursor(latestCursor.current), routePoint(hit));
    if (!point) return;
    if (penetrationSession) { const exit = projectPenetrationExit(penetrationSession, point); if (!exit) return; setDraft((points) => [...points, penetrationSession.entry, exit]); setExplicitPenetrations((items) => [...items, penetrationRequest(penetrationSession, exit)]); setOrthogonal(penetrationSession.orthogonal); setWorldAxis(null); setPenetrationSession(null); setCursor(null); setStatus("已确认穿透出口并恢复目标宿主约束；继续画管或按 Enter 直接生成。"); return; }
    const constrained = point, candidate = [...draft, constrained];
    if (candidate.length >= 2) { const plan = validatedPlan(candidate, branchStart?.segmentId); if (!plan.canCommit) { rejectDiagnostics(plan); return; } }
    setDraft(candidate); setBranchEnd(constrained); setCursor(null); orthogonalDirection.current = null; setStatus("已确定落点；移动鼠标预览下一段，按 Enter、双击或完成路径直接生成。");
  };
  const onStartDeviceRoute = (device: NetworkDevice, portId?: string, targetPoint?: [number, number, number]) => {
    if (tool !== "draw") { onSelect(device.id); return; }
    const targetPort = () => {
      const reference = targetPoint ?? draft[draft.length - 1]?.position;
      return portId ? deviceTargetPorts(device, system).find((port) => port.id === portId) : reference ? nearestDeviceTargetPort(device, system, reference) : undefined;
    };
    if (endpointRouteStart && draft.length) {
      const endPort = targetPort();
      if (!endPort) { setStatus("目标设备没有兼容的开放端口。"); return; }
      const points = routePointsToTarget(endPort.position, endPort.id, `${device.name || DEVICE_DEFAULTS[device.deviceType].label}端口`, device.id);
      if (!points) return;
      const plan = validatedPlan(points, undefined, device.id);
      if (!plan.canCommit) { rejectDiagnostics(plan); return; }
      commit(commitEndpointRoute(overlay, endpointRouteStart, plan, device.id, endPort.id)); clearCompletedDraft(); setStatus("已从开放管端重新连接设备点位。"); return;
    }
    if (deviceRouteStart && draft.length) {
      const endPort = targetPort();
      if (!endPort) return;
      const points = routePointsToTarget(endPort.position, endPort.id, `${device.name || DEVICE_DEFAULTS[device.deviceType].label}端口`, device.id);
      if (!points) return;
      const plan = validatedPlan(points, undefined, device.id);
      if (!plan.canCommit) { rejectDiagnostics(plan); return; }
      commit(commitDeviceRoute(deviceRouteStart.overlay, plan, deviceRouteStart.circuit, deviceRouteStart.port, device.id, endPort.id)); clearCompletedDraft(); setDeviceRouteStart(null); return;
    }
    const availableSystem = device.systems.includes(system) ? system : device.systems[0];
    if (!availableSystem) return;
    try {
      const started = startRouteFromDevice(overlay, device.id, availableSystem, portId);
      selectSystem(availableSystem); setDeviceRouteStart(started); setJunctionRouteStart(null); setEndpointRouteStart(null); setDraft([structuredClone(started.port.position)]); setCursor(null);
    } catch { setStatus("该设备没有合法的开放输出端口。"); }
  };
  const onStartEndpoint = (endpoint: OpenRouteEndpoint) => {
    if (tool !== "draw" || deviceRouteStart || junctionRouteStart || endpointRouteStart) return;
    selectSystem(endpoint.system); setEndpointRouteStart(endpoint); setDraft([structuredClone(endpoint.point)]); setCursor(null); setStatus("已从开放管端开始续画。");
  };
  const onStartJunctionRoute = (boxId: string, portId: string) => {
    if (tool !== "draw" || deviceRouteStart || junctionRouteStart || endpointRouteStart) return;
    try {
      const started = startRouteFromJunctionBox(overlay, boxId, portId);
      selectSystem(started.box.system); setJunctionRouteStart(started); setDraft([structuredClone(started.port.position)]); setCursor(null);
    } catch { setStatus("该 86 底盒孔位没有可用的同侧连接或合法来源。"); }
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
  const resetRouteSession = () => { setDraft([]); setCursor(null); setBranchStart(null); setBranchEnd(null); setBranchPreview(null); setInlineDevicePreview(null); setPenetrationSession(null); setExplicitPenetrations([]); setWorldAxis(null); setDeviceRouteStart(null); setJunctionRouteStart(null); setEndpointRouteStart(null); setControlBinding(null); orthogonalDirection.current = null; };
  const chooseTool = (next: Tool) => { setTool(next); resetRouteSession(); };
  const routeInProgress = Boolean(draft.length || branchStart || penetrationSession || deviceRouteStart || junctionRouteStart || endpointRouteStart);
  const onPointerRay = (origin: [number, number, number], direction: [number, number, number]) => {
    const surfaceHit = rawSurfaceHit.current;
    const blockedByOpening = surfaceOccluded.current;
    rawSurfaceHit.current = null;
    surfaceOccluded.current = false;
    if (worldAxis && draft.length) { scheduleCursor(pointOnWorldAxis(draft[draft.length - 1], worldAxis, origin, direction)); return; }
    if (canDrawWithoutSource && !surfaceHit) {
      const point = pointOnViewPlane(draft[draft.length - 1]?.position ?? scene?.bounds.center ?? [0, 0, 0], origin, direction);
      if (orthogonal && draft.length) orthogonalDirection.current = resolveOrthogonalDirection(draft[draft.length - 1], point, orthogonalDirection.current);
      scheduleCursor(point); return;
    }
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
  const onEmptyCanvasClick = () => {
    if (!canDrawWithoutSource) { selectWhileBrowsing(null); return; }
    const point = resolveEffectiveCursor(latestCursor.current);
    if (!point) return;
    const candidate = [...draft, point].filter((item, index, points) => index === 0 || !sameRoutePoint(points[index - 1], item));
    if (candidate.length >= 2) {
      const plan = validatedPlan(candidate);
      if (!plan.canCommit) { rejectDiagnostics(plan); return; }
    }
    setDraft(candidate); setCursor(null); orthogonalDirection.current = null;
    setStatus(candidate.length === 1 ? "已确定白色管道悬空起点；继续逐点绘制。" : "已确定悬空落点；按 Enter 或双击生成白色管道。");
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
        <div className="conduit-panel-head">
          {!panelCollapsed && <div><b>管线编辑</b><small>{({ select: "选择与属性", draw: "绘制新管线", branch: "从已有管线分支", point: "放置设备点位", delete: "删除网络对象" } as const)[tool]}</small></div>}
          <button className="conduit-panel-collapse" aria-expanded={!panelCollapsed} onClick={() => setPanelCollapsed((value) => !value)}>{panelCollapsed ? "管线" : "收起"}</button>
        </div>
        {!panelCollapsed && <>
          <nav className="conduit-tool-grid" aria-label="编辑工具">
            {(["select", "draw", "branch", "point", "delete"] as Tool[]).map((item) => <button key={item} title={({ select: "选择对象", draw: "绘制管线", branch: "从已有管段拉出分支", point: "放置设备点位", delete: "删除管网对象" } as const)[item]} className={tool === item ? `active tool-${item}` : `tool-${item}`} onClick={() => item === "delete" && (selectedId || selectedDeviceIds.length) ? deleteSelectedObjects() : chooseTool(item)}>{({ select: "选择", draw: "画管", branch: "分支", point: "点位", delete: "删除" } as const)[item]}</button>)}
          </nav>

          {(tool === "draw" || tool === "branch") && <section className="conduit-context-section">
            <div className="conduit-section-title"><b>{tool === "branch" ? "分支设置" : "画管设置"}</b><span>{SYSTEM_DEFAULTS[system].label}</span></div>
            {tool === "draw" && <div className="conduit-system-grid">{(Object.keys(SYSTEM_DEFAULTS) as RoutingSystem[]).map((key) => <button key={key} className={system === key ? "active" : ""} onClick={() => selectSystem(key)}>{SYSTEM_DEFAULTS[key].label}</button>)}</div>}
            {tool === "branch" && !branchStart && <small>指向已有管段预览分支点，点击后自动继承系统与管径。</small>}
            <div className="conduit-field-row">
              <label>外径<input disabled={tool === "branch"} type="number" min="5" max="200" value={diameterMm} onChange={(event) => setDiameterMm(Number(event.target.value))} /><i>mm</i></label>
              <label>敷设<select value={surfaceMode} onChange={(event) => setSurfaceMode(event.target.value as SurfaceMode)}><option value="surface">贴面暗敷</option><option value="suspended">吊顶内明敷</option></select></label>
            </div>
            <div className="conduit-mode-row">
              <button className={orthogonal ? "active" : ""} onClick={() => { orthogonalDirection.current = null; setOrthogonal((value) => !value); }}>{orthogonal ? "正交开启" : "面内自由"}</button>
              <button className={worldAxis ? "active" : ""} disabled={!worldAxis} onClick={() => setWorldAxis(null)}>{worldAxis ? `世界 ${worldAxis.toUpperCase()} · 取消` : "宿主面"}</button>
            </div>
            {routeInProgress && <div className="conduit-route-actions"><button className="primary" disabled={Boolean(penetrationSession) || displayDraft.length < 2 || Boolean(previewPlan && !previewPlan.canCommit)} onClick={finishPath}>完成路径</button><button onClick={resetRouteSession}>取消</button></div>}
            <small className="conduit-context-hint">{system === "network" && tool === "draw" ? "白色网络管可在空白处直接起画；" : "先选合法来源或开放管端；"}Shift 切正交，Tab 穿透，方向键锁定世界轴。</small>
          </section>}

          {tool === "point" && <section className="conduit-context-section">
            <div className="conduit-section-title"><b>放置点位</b><span>{DEVICE_DEFAULTS[deviceType].label}</span></div>
            <label className="conduit-full-field">设备<select value={deviceType} onChange={(event) => setDeviceType(event.target.value as NetworkDeviceType)}>
              <optgroup label="来源设备">{(["strong-panel", "weak-panel", "fire-inlet"] satisfies NetworkDeviceType[]).map((key) => <option key={key} value={key}>{DEVICE_DEFAULTS[key].label}</option>)}</optgroup>
              <optgroup label="终端点位">{(["socket", "switch", "luminaire", "network-outlet", "sprinkler-head"] satisfies NetworkDeviceType[]).map((key) => <option key={key} value={key}>{DEVICE_DEFAULTS[key].label}</option>)}</optgroup>
            </select></label>
            {(deviceType === "luminaire" || deviceType === "sprinkler-head") && levels.length > 0 && <label className="conduit-full-field">安装楼层<select value={activeLevelId ?? ""} onChange={(event) => setActiveLevelId(event.target.value)}>{levels.map((level) => <option key={level.id} value={level.id}>{level.name || level.id}</option>)}</select></label>}
            <small className="conduit-context-hint">移到合法宿主、兼容管段或开放管端后点击放置。</small>
          </section>}

          {tool === "delete" && <section className="conduit-context-section conduit-delete-context"><b>删除对象</b><small>可删除的管段、管件或点位会显示红色预览，点击直接删除并可撤销。</small></section>}

          {tool === "select" && <section className="conduit-context-section">
            <div className="conduit-section-title"><b>对象属性</b>{selectedId && <span>已选择</span>}</div>
            {!selectedId && <small>点击管段、管件或设备查看属性；Ctrl/Command 多选，双击选中整条连通管道。</small>}
            {selectedRouteLengths.length > 0 && <div className="conduit-length-summary" aria-label="已选管道长度"><b>已选管道 · {selectedRouteLengths.length}</b><div>{selectedRouteLengths.map((item, index) => <span key={item.id}>{item.label} {index + 1}<strong>{formatRouteLengthMm(item.lengthMm)}</strong></span>)}</div>{selectedRouteLengths.length > 1 && <label>合计<strong>{formatRouteLengthMm(selectedSegmentLengthMm)}</strong></label>}</div>}
            {controlBinding ? <div className="lighting-control-editor">
              <b>{controlBinding.kind === "create" ? "选择控制开关" : "重新选择灯具"}</b>
              <small>{controlBinding.kind === "create" ? `已选择 ${controlBinding.luminaireDeviceIds.length} 盏灯；点击绿色开关完成绑定，Esc 取消。` : `当前选择 ${controlBinding.luminaireDeviceIds.length} 盏灯；点击灯具增减，完成后一次提交。`}</small>
              <div className="conduit-route-actions">{controlBinding.kind === "edit" && <button className="primary" onClick={finishControlGroupEdit}>完成</button>}<button onClick={cancelControlBinding}>取消</button></div>
            </div> : selectedHasLuminaire && <div className="lighting-control-editor">
              <button className="primary" disabled={!selectedOnlyUnboundLuminaires} onClick={() => setControlBinding({ kind: "create", luminaireDeviceIds: [...selectedDeviceIds] })}>绑定开关</button>
              {!selectedOnlyUnboundLuminaires && <small>只能选择尚未绑定的灯具点位；已有绑定请从对应开关修改。</small>}
            </div>}
            {selectedDevice?.deviceType === "switch" && !controlBinding && <div className="lighting-control-groups">
              <label>开关规格<span>{gangLabel(selectedSwitchGroups.length)}</span></label>
              {selectedSwitchGroups.length === 0 && <small>尚未绑定灯具。</small>}
              {selectedSwitchGroups.map((group, index) => <div className="lighting-control-group" key={group.id}><span>第 {index + 1} 路 · {group.luminaireDeviceIds.length} 盏</span><div><button onClick={() => { setControlBinding({ kind: "edit", groupId: group.id, switchDeviceId: group.switchDeviceId, luminaireDeviceIds: [...group.luminaireDeviceIds] }); setSelectedDeviceIds([...group.luminaireDeviceIds]); }}>重新选择灯具</button><button onClick={() => commit(removeLightingControlGroup(overlay, group.id))}>解除该路</button></div></div>)}
            </div>}
            {selectedDevice && <><label>名称<input value={selectedDevice.name} onChange={(event) => commit({ ...overlay, devices: overlay.devices.map((device) => device.id === selectedDevice.id ? { ...device, name: event.target.value } : device) })} /></label><label>类型<span>{DEVICE_DEFAULTS[selectedDevice.deviceType].label}</span></label><label>连接端口<span>{selectedDevice.ports.filter((port) => port.connectedSegmentIds.length).length}/{selectedDevice.ports.length}</span></label>
              <div className="conduit-position-fields" aria-label="设备边缘定位">
                {selectedDevice.mount?.kind === "reference-plane" && <label>完成地标高<span><input type="number" min="0" value={positionDraft.elevation ?? ""} onChange={(event) => setPositionDraft((value) => ({ ...value, elevation: event.target.value === "" ? undefined : Number(event.target.value) }))} onBlur={(event) => event.target.value !== "" && applyDevicePosition({ elevationMm: Number(event.target.value) })} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /> mm</span></label>}
                {positionDescription.horizontal && <label>{positionDescription.horizontal.kind === "opening" ? "洞口边净距" : "墙端净距"}<span><input type="number" min="0" value={positionDraft.horizontal ?? ""} onChange={(event) => setPositionDraft((value) => ({ ...value, horizontal: event.target.value === "" ? undefined : Number(event.target.value) }))} onBlur={(event) => event.target.value !== "" && applyDevicePosition({ horizontalClearanceMm: Number(event.target.value) })} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /> mm</span></label>}
                {positionDescription.vertical?.kind === "finished-floor" && <label>下边缘离地<span><input type="number" min="0" value={positionDraft.vertical ?? ""} onChange={(event) => setPositionDraft((value) => ({ ...value, vertical: event.target.value === "" ? undefined : Number(event.target.value) }))} onBlur={(event) => event.target.value !== "" && applyDevicePosition({ bottomHeightMm: Number(event.target.value) })} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /> mm</span></label>}
                {positionDescription.planar?.map((reference, index) => <label key={reference.wallId}>平面净距 {index + 1}<span><input type="number" min="0" value={positionDraft.planar?.[reference.wallId] ?? ""} onChange={(event) => setPositionDraft((value) => ({ ...value, planar: { ...value.planar, [reference.wallId]: Number(event.target.value) } }))} onBlur={(event) => event.target.value !== "" && applyDevicePosition({ planarClearanceMm: { [reference.wallId]: Number(event.target.value) } })} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /> mm</span></label>)}
                <small>回车或离开输入框即生效{selectedDeviceIds.length > 1 ? `；离地/标高将应用到 ${selectedDeviceIds.length} 个可用点位` : ""}。</small>
              </div>
              <details className="conduit-object-details"><summary>尺寸与宿主</summary>{(["宽", "高", "深"] as const).map((label, axis) => <label key={label}>{label}<span><input type="number" min="1" value={selectedDevice.sizeMm[axis]} onChange={(event) => { const size = [...selectedDevice.sizeMm] as [number, number, number]; size[axis] = Math.max(1, Number(event.target.value)); commit(resizeDevicePoint(overlay, selectedDevice.id, size)); }} /> mm</span></label>)}<small>{selectedDevice.mount?.kind === "reference-plane" ? `安装参考平面 · ${selectedDevice.mount.levelId}` : selectedDevice.position.attachment?.hostId ?? "悬空管段挂载"}</small></details></>}
            {selectedSegment && <><label>系统<span>{SYSTEM_DEFAULTS[selectedSegment.system].label}</span></label><label>外径<span><input type="number" value={selectedSegment.diameterMm} onChange={(event) => { const value = Number(event.target.value); if (value > 0) commit({ ...overlay, segments: overlay.segments.map((segment) => segment.id === selectedSegment.id ? { ...segment, diameterMm: value } : segment) }); }} /> mm</span></label></>}
            {selectedFitting && <label>管件<span>{selectedFitting.fitting === "tee" ? "三通" : selectedFitting.fitting === "coupling" ? "直接接头" : selectedFitting.fitting === "bridge-bend" ? "过桥弯" : selectedFitting.bendStyle === "sweep" ? "圆角大弯" : "弯头"}</span></label>}
            {selectedBox && <><label>类型<span>86 检修盒</span></label><label>尺寸<span>{selectedBox.sizeMm.join(" × ")} mm</span></label></>}
            {selectedId && <details className="conduit-object-details"><summary>对象标识</summary><small>{selectedId}</small></details>}
          </section>}

          <details className="conduit-panel-details">
            <summary><b>管线图层</b></summary>
            <div className="conduit-details-body conduit-layer-grid">{(Object.keys(SYSTEM_DEFAULTS) as RoutingSystem[]).map((key) => <label key={key}><input type="checkbox" checked={overlay.settings.visibleSystems[key]} onChange={() => { setOverlay((current) => ({ ...current, settings: { ...current.settings, visibleSystems: { ...current.settings.visibleSystems, [key]: !current.settings.visibleSystems[key] } } })); setOverlayDirty(true); }} />{SYSTEM_DEFAULTS[key].label}</label>)}</div>
          </details>

          {(networkDiagnostics.length > 0 || chaseFallbacks.size > 0) && <details className="conduit-panel-details conduit-diagnostics">
            <summary><b>诊断</b><span className="conduit-warning-dot" /></summary>
            <div className="conduit-details-body">{networkDiagnostics.slice(0, 8).map((message) => <small role="alert" key={message}>{message}</small>)}{chaseFallbacks.size > 0 && <small role="alert">宿主浅槽切割失败，已保留 Overlay 并显示替代槽线。</small>}</div>
          </details>}

          <details className="conduit-panel-details conduit-shortcuts"><summary><b>快捷键</b></summary><div className="conduit-details-body"><small>空格选择 · Ctrl/Command 多选 · 双击整条管道 · L 画管 · D 点位</small><small>Shift 正交 · Tab 穿透 · ← X / ↑ Y / → Z · ↓ 取消世界轴</small><small>Enter 完成 · Esc 撤销当前步骤</small></div></details>

          <div className="conduit-utility-grid"><button disabled={!undoStack.length} onClick={() => { const previous = undoStack[undoStack.length - 1]; if (previous) { setRedoStack((history) => [...history, overlay]); setUndoStack((history) => history.slice(0, -1)); setOverlay(previous); setOverlayDirty(true); } }}>撤销</button><button disabled={!redoStack.length} onClick={() => { const next = redoStack[redoStack.length - 1]; if (next) { setUndoStack((history) => [...history, overlay]); setRedoStack((history) => history.slice(0, -1)); setOverlay(next); setOverlayDirty(true); } }}>重做</button><button onClick={() => overlayInput.current?.click()}>导入</button><button className="primary" onClick={exportOverlay}>导出</button></div>
          <input ref={overlayInput} hidden type="file" accept="application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importOverlay(file); event.currentTarget.value = ""; }} />
        </>}
      </aside>
  <Canvas key={projection} frameloop="demand" orthographic={projection === "orthographic"} camera={projection === "orthographic" ? ORTHOGRAPHIC_CAMERA : PERSPECTIVE_CAMERA} dpr={CANVAS_DPR} gl={CANVAS_GL} onPointerMissed={() => selectWhileBrowsing(null)}><color attach="background" args={["#dfe6e9"]} />
    {activeLevelId && (tool === "point" && (deviceType === "luminaire" || deviceType === "sprinkler-head") || selectedDevice?.mount?.kind === "reference-plane") && <InstallationPlane bounds={scene.bounds} y={referencePlaneY} onPreview={(position) => { if (tool === "point") scheduleCursor(position ? { position } : null); }} onPlace={(position) => { if (tool !== "point") { selectWhileBrowsing(null); return; } const withPlane = ensureInstallationReferencePlane(overlay, activeLevelId, referencePlaneElevationMm); const device = createReferencePlaneDevice(deviceType as "luminaire" | "sprinkler-head", position, activeLevelId, referencePlaneElevationMm); commit({ ...withPlane, devices: [...withPlane.devices, device] }); setCursor(null); onSelect(device.id); setSelectedDeviceIds([device.id]); }} />}
  <PascalScenePreview scene={scene} layers={layers} hiddenNodeIds={hiddenNodeIds} levelMode={levelMode} wallMode={wallMode} selectedId={selectedId} highlightHostId={tool === "draw" || tool === "point" || tool === "branch" && branchStart ? effectiveCursor?.attachment?.hostId : null} previousRoutePoint={draft[draft.length - 1]} penetrationBypassHostId={penetrationSession?.host.hostId} onSelect={selectWhileBrowsing} overlay={overlay} appliedSurfaceChases={appliedConstruction.surfaceChases} appliedPenetrations={appliedConstruction.penetrations} constructionMode="construction" onSurfaceHit={onSurfaceHit} onSurfaceMove={onSurfaceMove} onSurfaceFinish={finishAtCursor} onChaseFallback={reportChaseFallback} /><ConduitScene overlay={renderedOverlay} departingSegments={departingSegments} selectedId={selectedId} selectedSegmentIds={selectedSegmentIds} constructionMode="construction" visibleSystems={overlay.settings.visibleSystems} appliedSurfaceChases={appliedConstruction.surfaceChases} fallbackChaseKeys={chaseFallbacks} draft={displayDraft.map((point) => point.position)} draftColor={overlay.settings.colors[system]} previewPlan={previewPlan} conflictPoints={previewPlan?.diagnostics.flatMap((item) => item.point ? [item.point] : [])} branchPreview={branchPreview} previewHost={effectiveCursor?.attachment} alignmentAssist={Boolean(worldAxis || orthogonal)} deviceTarget={draft.length ? { system, portId: activeTargetPortId, mode: deviceTargetMode } : null} deviceType={deviceType} devicePreview={inlineDevicePreview ?? (tool === "point" && cursor ? { deviceType, point: cursor, valid: cursor.attachment ? DEVICE_DEFAULTS[deviceType].hostKinds.includes(cursor.attachment.hostKind) : deviceType === "luminaire" || deviceType === "sprinkler-head" } : null)} controlBinding={controlBinding?.kind ?? null} visibleControlGroups={visibleControlGroups} onControlDevice={onControlDevice} tool={tool} hoverId={hoverId} onHover={setHoverId} onDeviceTarget={onDeviceTarget} onBranchPreview={(preview) => { if (!preview) { setBranchPreview(null); return; } const radius = preview.kind === "junction-box" ? Math.hypot(...preview.sizeMm) / 2000 : SYSTEM_DEFAULTS.sprinkler.diameterMm / 1000; setBranchPreview({ ...preview, valid: preview.valid && validateBranchCandidate(overlay, preview.segmentId, preview.point, radius).length === 0 }); }} onDevicePreview={scheduleInlineDevicePreview} onSelect={selectWhileBrowsing} onSelectRoute={selectWholeRoute} onBranch={(segment, position) => onBranch(segment.id, position)} onInsertDevice={(segment, position) => { const next = insertDeviceOnSegment(overlay, segment.id, deviceType, position); if (next !== overlay) { commit(next); setStatus(`已在管段上插入${DEVICE_DEFAULTS[deviceType].label}。`); } else setStatus(`${DEVICE_DEFAULTS[deviceType].label}不能插入当前管段。`); setInlineDevicePreview(null); }} onInsertEndpointDevice={(endpoint) => { const next = placeDeviceAtEndpoint(overlay, endpoint, deviceType); if (next !== overlay) { commit(next); setStatus(`已在开放端放置${DEVICE_DEFAULTS[deviceType].label}。`); } else setStatus(`${DEVICE_DEFAULTS[deviceType].label}只能连接当前开放端。`); }} onConnectLegacy={onConnectLegacy} onStartDeviceRoute={onStartDeviceRoute} onStartJunctionRoute={onStartJunctionRoute} onStartEndpoint={onStartEndpoint} onDelete={deleteObject} /><PointerCapture bounds={scene.bounds} onRay={onPointerRay} onEmptyClick={onEmptyCanvasClick} /><Navigation bounds={scene.bounds} preset={preset} /></Canvas>{snapStatus && <div className="conduit-snap-status">{snapStatus}</div>}<div className="three-d-walkthrough-hint">空格选择 · 左键确认 · Shift 正交开关 · Tab 穿透 · ← X / ↑ Y / → Z 悬空轴 · ↓ 取消轴 · 右键旋转 · Enter 直接生成</div>
    </div>
  </section>;
}
