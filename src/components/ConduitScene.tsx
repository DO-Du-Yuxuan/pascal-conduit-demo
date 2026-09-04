import { Line } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useMemo } from "react";
import { Quaternion, Vector3 } from "three";
import type { ConduitOverlayDocument, HostAttachment, RouteFitting, RouteSegment, RoutingSystem, Vec3 } from "../domain/overlay";

export type ConduitTool = "select" | "draw" | "branch" | "delete";
type Props = { overlay: ConduitOverlayDocument; selectedId: string | null; constructionMode: "construction" | "finished" | "xray"; visibleSystems: Record<RoutingSystem, boolean>; activeSystem: RoutingSystem; draft: Vec3[]; draftColor: string; previewHost?: HostAttachment; tool: ConduitTool; hoverId: string | null; onSelect: (id: string) => void; onHover: (id: string | null) => void; onBranch: (segment: RouteSegment, point: Vec3) => void; onDelete: (id: string) => void };

const point = (value: Vec3) => new Vector3(value[0], value[1], value[2]);

function SegmentMesh({ segment, color, selected, hovered, visible, tool, branchable, onSelect, onHover, onBranch, onDelete }: { segment: RouteSegment; color: string; selected: boolean; hovered: boolean; visible: boolean; tool: ConduitTool; branchable: boolean; onSelect: () => void; onHover: (active: boolean) => void; onBranch: (point: Vec3) => void; onDelete: () => void }) {
  const { midpoint, length, rotation } = useMemo(() => {
    const start = point(segment.start.position), end = point(segment.end.position), direction = end.clone().sub(start);
    return { midpoint: start.clone().add(end).multiplyScalar(0.5), length: direction.length(), rotation: new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize()) };
  }, [segment]);
  if (length < 0.001 || !visible) return null;
  const radius = segment.diameterMm / 2000, signal = segment.system === "signal";
  const display = tool === "delete" && hovered ? "#ef4444" : tool === "branch" && hovered && branchable ? "#facc15" : selected ? "#f59e0b" : color;
  return <group position={midpoint} quaternion={rotation} onPointerMove={(event) => { event.stopPropagation(); onHover(true); }} onPointerOut={() => onHover(false)} onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); if (tool === "delete") onDelete(); else { onSelect(); if (tool === "branch" && branchable) onBranch([event.point.x, event.point.y, event.point.z]); } }}>
    {signal && !selected && <mesh><cylinderGeometry args={[radius + .002, radius + .002, length, 12]} /><meshStandardMaterial color="#94a3b8" roughness={0.42} /></mesh>}
    <mesh><cylinderGeometry args={[radius, radius, length + .002, 12]} /><meshStandardMaterial color={display} emissive={hovered && tool === "branch" ? "#5b4100" : "#000000"} roughness={0.42} /></mesh>
    {tool === "branch" && branchable && hovered && <mesh><sphereGeometry args={[Math.max(radius * 1.9, .04), 12, 10]} /><meshBasicMaterial color="#facc15" /></mesh>}
  </group>;
}

function FittingMesh({ fitting, color, selected, hovered, visible, tool, onSelect, onHover, onDelete }: { fitting: RouteFitting; color: string; selected: boolean; hovered: boolean; visible: boolean; tool: ConduitTool; onSelect: () => void; onHover: (active: boolean) => void; onDelete: () => void }) {
  if (!visible) return null;
  const p = fitting.position.position;
  const radius = fitting.diameterMm / 1800, signal = fitting.system === "signal";
  return <group position={p} onPointerMove={(event) => { event.stopPropagation(); onHover(true); }} onPointerOut={() => onHover(false)} onClick={(event) => { event.stopPropagation(); if (tool === "delete") onDelete(); else onSelect(); }}>{signal && !selected && <mesh><sphereGeometry args={[radius + .002, 12, 10]} /><meshStandardMaterial color="#94a3b8" roughness={0.4} /></mesh>}<mesh><sphereGeometry args={[radius, 12, 10]} /><meshStandardMaterial color={tool === "delete" && hovered ? "#ef4444" : selected ? "#f59e0b" : color} roughness={0.4} /></mesh></group>;
}

export function ConduitScene({ overlay, selectedId, constructionMode, visibleSystems, activeSystem, draft, draftColor, previewHost, tool, hoverId, onSelect, onHover, onBranch, onDelete }: Props) {
  const visible = (system: RoutingSystem) => visibleSystems[system] && (constructionMode !== "finished" || system === "sprinkler");
  return <group name="routing">
    {overlay.segments.map((segment) => <SegmentMesh key={segment.id} segment={segment} color={overlay.settings.colors[segment.system]} selected={selectedId === segment.id} hovered={hoverId === segment.id} visible={visible(segment.system)} tool={tool} branchable={segment.system === activeSystem} onSelect={() => onSelect(segment.id)} onHover={(active) => onHover(active ? segment.id : null)} onBranch={(branchPoint) => onBranch(segment, branchPoint)} onDelete={() => onDelete(segment.id)} />)}
    {overlay.fittings.map((fitting) => <FittingMesh key={fitting.id} fitting={fitting} color={overlay.settings.colors[fitting.system]} selected={selectedId === fitting.id} hovered={hoverId === fitting.id} visible={visible(fitting.system)} tool={tool} onSelect={() => onSelect(fitting.id)} onHover={(active) => onHover(active ? fitting.id : null)} onDelete={() => onDelete(fitting.id)} />)}
    {constructionMode !== "finished" && overlay.wallChases.map((chase) => <Line key={chase.id} points={[chase.start.position, chase.end.position]} color="#50351f" lineWidth={Math.max(2, chase.widthMm / 5)} transparent opacity={0.75} />)}
    {constructionMode !== "finished" && overlay.penetrations.map((penetration) => <mesh key={penetration.id} position={penetration.point.position}><sphereGeometry args={[penetration.diameterMm / 2000, 10, 8]} /><meshStandardMaterial color="#fbbf24" transparent opacity={0.68} /></mesh>)}
    {draft.length >= 2 && <Line points={draft} color={draftColor} lineWidth={3} dashed dashSize={0.14} gapSize={0.08} />}
    {draft.length >= 1 && <mesh position={draft[draft.length - 1]}><sphereGeometry args={[.055, 12, 10]} /><meshBasicMaterial color={draftColor} /></mesh>}
    {previewHost && draft.length >= 1 && <mesh position={draft[draft.length - 1]}><ringGeometry args={[.07, .095, 16]} /><meshBasicMaterial color="#facc15" side={2} /></mesh>}
  </group>;
}
