import { Html, Line } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import { type ThreeEvent } from "@react-three/fiber";
import type { BeamNode } from "../../domain/beams";
import type { BeamPlanarClearance } from "../../domain/beam-positioning";
import type { Penetration, Vec3 } from "../../domain/overlay";
import { getBuilderPresentation } from "../../three/builder-presentation";
import { buildBeamGeometry, resolveBeamSurfaceHit, type BeamSurfaceHit } from "./geometry";

export type BeamRendererProps = {
  node: BeamNode;
  selected: boolean;
  onSelect: () => void;
  levelBaseY: number;
  preview?: boolean;
  penetrations?: Penetration[];
  planarClearances?: BeamPlanarClearance[];
  onSurfaceHit?: (hit: BeamSurfaceHit) => void;
  onSurfaceMove?: (hit: BeamSurfaceHit | null) => void;
  onSurfaceFinish?: () => void;
};

const NO_PENETRATIONS: Penetration[] = [];
const BEAM_COLOR = getBuilderPresentation().colors.beam;
type BeamPointerEvent = ThreeEvent<PointerEvent> | ThreeEvent<MouseEvent>;

function BeamPlanarDimensionGuides({ clearances, y }: { clearances: BeamPlanarClearance[]; y: number }) {
  return <group name="beam-planar-position-dimensions">{clearances.map((clearance) => {
    const start: Vec3 = [clearance.origin[0], y, clearance.origin[1]];
    const end: Vec3 = [start[0] + clearance.direction[0] * clearance.meters, y, start[2] + clearance.direction[1] * clearance.meters];
    const middle: Vec3 = [(start[0] + end[0]) / 2, y, (start[2] + end[2]) / 2];
    return <group key={`${clearance.witness.id}:${clearance.witness.face}`} name="beam-planar-dimension:cross-axis">
      <Line points={[start, end]} color="#f97316" lineWidth={1.5} raycast={() => null} />
      <mesh position={start} raycast={() => null}><sphereGeometry args={[.02, 8, 6]} /><meshBasicMaterial color="#f97316" /></mesh>
      <mesh position={end} raycast={() => null}><sphereGeometry args={[.02, 8, 6]} /><meshBasicMaterial color="#f97316" /></mesh>
      <Html position={middle} center distanceFactor={9}><span className="conduit-dimension-label">{Math.round(clearance.meters * 1000)} mm</span></Html>
    </group>;
  })}</group>;
}

/** Shared display renderer for committed, edited-preview, and creation-preview Beams. */
export function BeamRenderer({
  node,
  selected,
  onSelect,
  levelBaseY,
  preview = false,
  penetrations = NO_PENETRATIONS,
  planarClearances = [],
  onSurfaceHit,
  onSurfaceMove,
  onSurfaceFinish,
}: BeamRendererProps) {
  const rendered = useMemo(
    () => buildBeamGeometry(node, levelBaseY, penetrations),
    [node.width, node.height, node.start[0], node.start[1], node.end[0], node.end[1], node.effectiveCeilingElevation.meters, levelBaseY, penetrations],
  );
  useEffect(() => () => rendered?.geometry.dispose(), [rendered]);
  if (!rendered) return null;
  const { transform, geometry } = rendered;
  const { start, end } = node;
  const receiveSurfaceMove = (event: BeamPointerEvent) => {
    if (preview) return;
    onSurfaceMove?.(resolveBeamSurfaceHit(node, levelBaseY, event.point.toArray() as Vec3, event.nativeEvent));
  };
  const receiveClick = (event: ThreeEvent<MouseEvent>) => {
    if (preview) return;
    event.stopPropagation();
    onSelect();
    const hit = resolveBeamSurfaceHit(node, levelBaseY, event.point.toArray() as Vec3, event.nativeEvent);
    if (hit && event.nativeEvent.detail < 2) onSurfaceHit?.(hit);
  };

  return <group name={`beam-renderer:${node.id}`}>
    <mesh
      name={`beam-body:${node.id}`}
      raycast={preview ? () => null : undefined}
      position={transform.center}
      rotation={[0, transform.rotationY, 0]}
      onPointerMove={receiveSurfaceMove}
      onClick={receiveClick}
      onDoubleClick={() => { if (!preview) onSurfaceFinish?.(); }}
    >
      <primitive object={geometry} attach="geometry" />
      <meshStandardMaterial color={selected ? "#fb923c" : BEAM_COLOR} transparent={preview} opacity={preview ? .45 : 1} roughness={.7} />
    </mesh>
    {penetrations.map((penetration) => <mesh key={penetration.id} position={penetration.entry.position}>
      <sphereGeometry args={[penetration.diameterMm / 2000, 12, 8]} />
      <meshBasicMaterial color="#111827" />
    </mesh>)}
    {selected && !preview && <BeamPlanarDimensionGuides clearances={planarClearances} y={levelBaseY + node.effectiveCeilingElevation.meters - node.height - .05} />}
  </group>;
}
