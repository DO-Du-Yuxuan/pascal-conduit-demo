import { Line } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useMemo } from "react";
import { CatmullRomCurve3, Matrix4, Quaternion, Vector3 } from "three";
import type { BendArc, ConduitOverlayDocument, HostAttachment, JunctionBox, RouteFitting, RouteSegment, RoutingSystem, SurfaceChase, Vec3 } from "../domain/overlay";
import type { PlannedRoute } from "../domain/routing";
import { teeSocketSegments } from "../domain/network-geometry";
import { sampleChase } from "../three/chase-geometry";

export type ConduitTool = "select" | "draw" | "branch" | "delete";
export type BranchPreview = { segmentId: string; point: Vec3; attachment?: HostAttachment; system: RoutingSystem; kind: "junction-box" | "tee"; sizeMm: [number, number, number]; valid: boolean };
type Props = { overlay: ConduitOverlayDocument; selectedId: string | null; constructionMode: "construction" | "finished" | "xray"; visibleSystems: Record<RoutingSystem, boolean>; draft: Vec3[]; draftColor: string; previewPlan?: PlannedRoute | null; conflictPoints?: Vec3[]; branchPreview?: BranchPreview | null; previewHost?: HostAttachment; tool: ConduitTool; hoverId: string | null; onSelect: (id: string) => void; onHover: (id: string | null) => void; onBranchPreview: (preview: BranchPreview | null) => void; onBranch: (segment: RouteSegment, point: Vec3) => void; onDelete: (id: string) => void };

const point = (value: Vec3) => new Vector3(value[0], value[1], value[2]);
const vec = (value: Vector3): Vec3 => [value.x, value.y, value.z];
const projectionOnSegment = (segment: RouteSegment, world: Vector3) => {
  const start = point(segment.start.position), delta = point(segment.end.position).sub(start), lengthSquared = delta.lengthSq(), t = lengthSquared < 1e-10 ? 0 : Math.max(0, Math.min(1, world.clone().sub(start).dot(delta) / lengthSquared));
  return { point: vec(start.addScaledVector(delta, t)), t };
};

function segmentTransform(segment: RouteSegment) {
  const start = point(segment.start.position), end = point(segment.end.position), direction = end.clone().sub(start);
  return { midpoint: start.clone().add(end).multiplyScalar(.5), length: direction.length(), rotation: new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize()) };
}

function PipeMesh({ segment, color, opacity = 1 }: { segment: RouteSegment; color: string; opacity?: number }) {
  const transform = useMemo(() => segmentTransform(segment), [segment]);
  if (transform.length < .001) return null;
  const radius = segment.diameterMm / 2000, signal = segment.system === "signal";
  return <group position={transform.midpoint} quaternion={transform.rotation}>
    {signal && <mesh><cylinderGeometry args={[radius + .002, radius + .002, transform.length, 12]} /><meshStandardMaterial color="#94a3b8" transparent={opacity < 1} opacity={opacity} roughness={.42} /></mesh>}
    <mesh><cylinderGeometry args={[radius, radius, transform.length + .002, 12]} /><meshStandardMaterial color={color} transparent={opacity < 1} opacity={opacity} roughness={.42} /></mesh>
  </group>;
}

function SegmentMesh({ segment, color, selected, hovered, visible, tool, branchable, boxSize, onSelect, onHover, onBranchPreview, onBranch, onDelete }: { segment: RouteSegment; color: string; selected: boolean; hovered: boolean; visible: boolean; tool: ConduitTool; branchable: boolean; boxSize: [number, number, number]; onSelect: () => void; onHover: (active: boolean) => void; onBranchPreview: (preview: BranchPreview | null) => void; onBranch: (point: Vec3) => void; onDelete: () => void }) {
  const transform = useMemo(() => segmentTransform(segment), [segment]);
  if (transform.length < .001 || !visible) return null;
  const display = tool === "delete" && hovered ? "#ef4444" : tool === "branch" && hovered && branchable ? "#facc15" : selected ? "#f59e0b" : color;
  return <group position={transform.midpoint} quaternion={transform.rotation} onPointerMove={(event) => { event.stopPropagation(); onHover(true); if (tool === "branch" && branchable) { const projected = projectionOnSegment(segment, event.point), clearance = segment.system === "sprinkler" ? segment.diameterMm / 1000 : boxSize[0] / 2000, valid = projected.t * transform.length > clearance && (1 - projected.t) * transform.length > clearance, attachment = segment.start.attachment?.hostId === segment.end.attachment?.hostId ? segment.start.attachment : undefined; onBranchPreview({ segmentId: segment.id, point: projected.point, attachment, system: segment.system, kind: segment.system === "sprinkler" ? "tee" : "junction-box", sizeMm: boxSize, valid }); } }} onPointerOut={() => { onHover(false); onBranchPreview(null); }} onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); if (tool === "delete") onDelete(); else { onSelect(); if (tool === "branch" && branchable) onBranch(projectionOnSegment(segment, event.point).point); } }}>
    <PipeMesh segment={{ ...segment, start: { position: [0, -transform.length / 2, 0] }, end: { position: [0, transform.length / 2, 0] } }} color={display} />
  </group>;
}

function arcCurve(arc: BendArc) {
  const center = point(arc.center), start = point(arc.start).sub(center), radius = start.length(), normal = point(arc.normal).normalize(), tangent = new Vector3().crossVectors(normal, start).normalize();
  const samples = Array.from({ length: 17 }, (_, index) => center.clone().addScaledVector(start, Math.cos(arc.sweepRadians * index / 16)).addScaledVector(tangent, radius * Math.sin(arc.sweepRadians * index / 16)));
  return new CatmullRomCurve3(samples, false, "centripetal");
}

function FittingGeometry({ fitting, color, opacity = 1 }: { fitting: RouteFitting; color: string; opacity?: number }) {
  const radius = fitting.diameterMm / 1800;
  if (fitting.arc) return <mesh><tubeGeometry args={[arcCurve(fitting.arc), 24, fitting.diameterMm / 2000, 10, false]} /><meshStandardMaterial color={color} transparent={opacity < 1} opacity={opacity} roughness={.4} /></mesh>;
  if (fitting.fitting === "tee") return <group>{teeSocketSegments(fitting).map((segment) => <PipeMesh key={segment.id} segment={segment} color={color} opacity={opacity} />)}</group>;
  if (fitting.fitting === "coupling") {
    const direction = fitting.ports[1]?.direction ?? [1, 0, 0], length = Math.max(.035, fitting.diameterMm / 500), rotation = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), point(direction).normalize());
    return <mesh position={fitting.position.position} quaternion={rotation}><cylinderGeometry args={[radius * 1.15, radius * 1.15, length, 12]} /><meshStandardMaterial color={color} transparent={opacity < 1} opacity={opacity} roughness={.4} /></mesh>;
  }
  return <mesh position={fitting.position.position}><sphereGeometry args={[radius, 12, 10]} /><meshStandardMaterial color={color} transparent={opacity < 1} opacity={opacity} roughness={.4} /></mesh>;
}

function FittingMesh({ fitting, color, selected, hovered, visible, tool, onSelect, onHover, onDelete }: { fitting: RouteFitting; color: string; selected: boolean; hovered: boolean; visible: boolean; tool: ConduitTool; onSelect: () => void; onHover: (active: boolean) => void; onDelete: () => void }) {
  if (!visible) return null;
  const display = tool === "delete" && hovered ? "#ef4444" : selected ? "#f59e0b" : color;
  return <group onPointerMove={(event) => { event.stopPropagation(); onHover(true); }} onPointerOut={() => onHover(false)} onClick={(event) => { event.stopPropagation(); if (tool === "delete") onDelete(); else onSelect(); }}><FittingGeometry fitting={fitting} color={display} /></group>;
}

function JunctionBoxMesh({ box, color, selected, preview = false, valid = true }: { box: JunctionBox; color: string; selected?: boolean; preview?: boolean; valid?: boolean }) {
  const normal = box.position.attachment?.normal ?? [0, 1, 0], rotation = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), point(normal).normalize()), [width, height, depth] = box.sizeMm.map((value) => value / 1000);
  return <mesh position={box.position.position} quaternion={rotation}><boxGeometry args={[width, height, depth]} /><meshStandardMaterial color={!valid ? "#ef4444" : selected ? "#f59e0b" : color} transparent={preview} opacity={preview ? .62 : 1} roughness={.5} /></mesh>;
}

function ChaseMesh({ chase }: { chase: SurfaceChase }) {
  const normal = point(chase.surfaceNormal).normalize(), width = chase.widthMm / 1000, samples = sampleChase(chase);
  return <group>{samples.slice(0, -1).map((startValue, index) => {
    const endValue = samples[index + 1], start = point(startValue), end = point(endValue), direction = end.clone().sub(start), length = direction.length();
    if (length < 1e-6) return null;
    direction.normalize();
    const widthAxis = new Vector3().crossVectors(normal, direction).normalize();
    if (widthAxis.lengthSq() < 1e-8) return null;
    const rotation = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(direction, widthAxis, normal));
    const position = start.clone().add(end).multiplyScalar(.5).addScaledVector(normal, .001);
    return <mesh key={index} position={position} quaternion={rotation}><boxGeometry args={[length + width, width, .002]} /><meshStandardMaterial color="#50351f" transparent opacity={.82} roughness={1} /></mesh>;
  })}</group>;
}

export function ConduitScene({ overlay, selectedId, constructionMode, visibleSystems, draft, draftColor, previewPlan, conflictPoints = [], branchPreview, previewHost, tool, hoverId, onSelect, onHover, onBranchPreview, onBranch, onDelete }: Props) {
  const visible = (system: RoutingSystem) => visibleSystems[system] && (constructionMode !== "finished" || system === "sprinkler"), previewColor = previewPlan?.canCommit === false ? "#ef4444" : draftColor;
  return <group name="routing">
    {overlay.segments.map((segment) => <SegmentMesh key={segment.id} segment={segment} color={overlay.settings.colors[segment.system]} selected={selectedId === segment.id} hovered={hoverId === segment.id} visible={visible(segment.system)} tool={tool} branchable={visible(segment.system)} boxSize={overlay.settings.junctionBoxSizeMm} onSelect={() => onSelect(segment.id)} onHover={(active) => onHover(active ? segment.id : null)} onBranchPreview={onBranchPreview} onBranch={(branchPoint) => onBranch(segment, branchPoint)} onDelete={() => onDelete(segment.id)} />)}
    {overlay.fittings.map((fitting) => <FittingMesh key={fitting.id} fitting={fitting} color={overlay.settings.colors[fitting.system]} selected={selectedId === fitting.id} hovered={hoverId === fitting.id} visible={visible(fitting.system)} tool={tool} onSelect={() => onSelect(fitting.id)} onHover={(active) => onHover(active ? fitting.id : null)} onDelete={() => onDelete(fitting.id)} />)}
    {overlay.junctionBoxes.map((box) => visible(box.system) && <group key={box.id} onPointerMove={(event) => { event.stopPropagation(); onHover(box.id); }} onPointerOut={() => onHover(null)} onClick={(event) => { event.stopPropagation(); tool === "delete" ? onDelete(box.id) : onSelect(box.id); }}><JunctionBoxMesh box={box} color={tool === "delete" && hoverId === box.id ? "#ef4444" : overlay.settings.colors[box.system]} selected={selectedId === box.id} /></group>)}
    {constructionMode !== "finished" && overlay.surfaceChases.filter((chase) => { const segment = overlay.segments.find((item) => item.id === chase.routeElementId), fitting = overlay.fittings.find((item) => item.id === chase.routeElementId); return visibleSystems[segment?.system ?? fitting?.system ?? "power"]; }).map((chase) => <ChaseMesh key={chase.id} chase={chase} />)}
    {constructionMode !== "finished" && overlay.penetrations.filter((penetration) => visibleSystems[overlay.segments.find((segment) => segment.id === penetration.segmentId)?.system ?? "power"]).map((penetration) => <mesh key={penetration.id} position={penetration.entry.position}><sphereGeometry args={[penetration.diameterMm / 2000, 10, 8]} /><meshStandardMaterial color="#fbbf24" transparent opacity={.68} /></mesh>)}
    {previewPlan ? <group>{previewPlan.segments.map((segment) => <PipeMesh key={segment.id} segment={segment} color={previewColor} opacity={.68} />)}{previewPlan.fittings.filter((fitting) => fitting.fitting === "elbow").map((fitting) => <FittingGeometry key={fitting.id} fitting={fitting} color={previewColor} opacity={.68} />)}</group> : draft.length >= 2 && <Line points={draft} color={previewColor} lineWidth={3} dashed dashSize={.14} gapSize={.08} />}
    {draft.length >= 1 && <mesh position={draft[draft.length - 1]}><sphereGeometry args={[.055, 12, 10]} /><meshBasicMaterial color={previewColor} /></mesh>}
    {previewHost && draft.length >= 1 && <mesh position={draft[draft.length - 1]}><ringGeometry args={[.07, .095, 16]} /><meshBasicMaterial color={previewColor} side={2} /></mesh>}
    {conflictPoints.map((position, index) => <mesh key={index} position={position}><sphereGeometry args={[.08, 12, 10]} /><meshBasicMaterial color="#ef4444" /></mesh>)}
    {branchPreview && (branchPreview.kind === "junction-box" ? <JunctionBoxMesh box={{ id: "preview", type: "junction-box", system: branchPreview.system as Exclude<RoutingSystem, "sprinkler">, position: { position: branchPreview.point, attachment: branchPreview.attachment }, sizeMm: branchPreview.sizeMm, segmentIds: [], ports: [] }} color={overlay.settings.colors[branchPreview.system]} preview valid={branchPreview.valid} /> : <mesh position={branchPreview.point}><sphereGeometry args={[.075, 12, 10]} /><meshStandardMaterial color={branchPreview.valid ? overlay.settings.colors[branchPreview.system] : "#ef4444"} transparent opacity={.7} /></mesh>)}
  </group>;
}
