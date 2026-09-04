import { Line } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useMemo } from "react";
import { Quaternion, Vector3 } from "three";
import type { Vec3 } from "../domain/building";
import type { ConduitOverlayDocument, RouteFitting, RouteSegment, RoutingSystem } from "../domain/overlay";

type Props = { overlay: ConduitOverlayDocument; selectedId: string | null; constructionMode: "construction" | "finished" | "xray"; visibleSystems: Record<RoutingSystem, boolean>; draft: Vec3[]; draftColor: string; onSelect: (id: string) => void; onBranch: (segment: RouteSegment, point: Vec3) => void };

const point = (value: Vec3) => new Vector3(value[0], value[1], value[2]);

function SegmentMesh({ segment, color, selected, visible, onSelect, onBranch }: { segment: RouteSegment; color: string; selected: boolean; visible: boolean; onSelect: () => void; onBranch: (point: Vec3) => void }) {
  const { midpoint, length, rotation } = useMemo(() => {
    const start = point(segment.start.position), end = point(segment.end.position), direction = end.clone().sub(start);
    return { midpoint: start.clone().add(end).multiplyScalar(0.5), length: direction.length(), rotation: new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize()) };
  }, [segment]);
  if (length < 0.001 || !visible) return null;
  const radius = segment.diameterMm / 2000, signal = segment.system === "signal";
  return <group position={midpoint} quaternion={rotation} onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onSelect(); onBranch([event.point.x, event.point.y, event.point.z]); }}>
    {signal && !selected && <mesh><cylinderGeometry args={[radius + .002, radius + .002, length, 12]} /><meshStandardMaterial color="#94a3b8" roughness={0.42} /></mesh>}
    <mesh><cylinderGeometry args={[radius, radius, length + .002, 12]} /><meshStandardMaterial color={selected ? "#f59e0b" : color} emissive={selected ? "#7c2d12" : "#000000"} roughness={0.42} /></mesh>
  </group>;
}

function FittingMesh({ fitting, color, selected, visible, onSelect }: { fitting: RouteFitting; color: string; selected: boolean; visible: boolean; onSelect: () => void }) {
  if (!visible) return null;
  const p = fitting.position.position;
  const radius = fitting.diameterMm / 1800, signal = fitting.system === "signal";
  return <group position={p} onClick={(event) => { event.stopPropagation(); onSelect(); }}>{signal && !selected && <mesh><sphereGeometry args={[radius + .002, 12, 10]} /><meshStandardMaterial color="#94a3b8" roughness={0.4} /></mesh>}<mesh><sphereGeometry args={[radius, 12, 10]} /><meshStandardMaterial color={selected ? "#f59e0b" : color} roughness={0.4} /></mesh></group>;
}

export function ConduitScene({ overlay, selectedId, constructionMode, visibleSystems, draft, draftColor, onSelect, onBranch }: Props) {
  const visible = (system: RoutingSystem) => visibleSystems[system] && (constructionMode !== "finished" || system === "sprinkler");
  return <group name="routing">
    {overlay.segments.map((segment) => <SegmentMesh key={segment.id} segment={segment} color={overlay.settings.colors[segment.system]} selected={selectedId === segment.id} visible={visible(segment.system)} onSelect={() => onSelect(segment.id)} onBranch={(branchPoint) => onBranch(segment, branchPoint)} />)}
    {overlay.fittings.map((fitting) => <FittingMesh key={fitting.id} fitting={fitting} color={overlay.settings.colors[fitting.system]} selected={selectedId === fitting.id} visible={visible(fitting.system)} onSelect={() => onSelect(fitting.id)} />)}
    {constructionMode !== "finished" && overlay.wallChases.map((chase) => <Line key={chase.id} points={[chase.start.position, chase.end.position]} color="#50351f" lineWidth={Math.max(2, chase.widthMm / 5)} transparent opacity={0.75} />)}
    {constructionMode !== "finished" && overlay.penetrations.map((penetration) => <mesh key={penetration.id} position={penetration.point.position}><sphereGeometry args={[penetration.diameterMm / 2000, 10, 8]} /><meshStandardMaterial color="#fbbf24" transparent opacity={0.68} /></mesh>)}
    {draft.length >= 2 && <Line points={draft} color={draftColor} lineWidth={3} dashed dashSize={0.14} gapSize={0.08} />}
  </group>;
}
