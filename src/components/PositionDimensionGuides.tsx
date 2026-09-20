import { Html, Line } from "@react-three/drei";
import type { Vec3 } from "../domain/overlay";

export type PositionDimensionGuide = { key: string; start: Vec3; end: Vec3; label: string };

/** A CAD-style dimension line offset from its two physical witnesses. */
export function PositionDimensionGuides({ name, guides, color = "#f97316" }: { name: string; guides: readonly PositionDimensionGuide[]; color?: string }) {
  return <group name={name}>{guides.map((guide) => {
    const vertical = Math.abs(guide.end[1] - guide.start[1]) > Math.max(Math.abs(guide.end[0] - guide.start[0]), Math.abs(guide.end[2] - guide.start[2]));
    const offset: Vec3 = vertical ? [.06, 0, 0] : [0, -.06, 0];
    const dimensionStart: Vec3 = [guide.start[0] + offset[0], guide.start[1] + offset[1], guide.start[2] + offset[2]];
    const dimensionEnd: Vec3 = [guide.end[0] + offset[0], guide.end[1] + offset[1], guide.end[2] + offset[2]];
    const middle: Vec3 = [(dimensionStart[0] + dimensionEnd[0]) / 2, (dimensionStart[1] + dimensionEnd[1]) / 2, (dimensionStart[2] + dimensionEnd[2]) / 2];
    return <group key={guide.key} name={`position-dimension:${guide.key}`}>
      <Line points={[guide.start, dimensionStart]} color={color} lineWidth={1.25} raycast={() => null} />
      <Line points={[guide.end, dimensionEnd]} color={color} lineWidth={1.25} raycast={() => null} />
      <Line points={[dimensionStart, dimensionEnd]} color={color} lineWidth={1.5} raycast={() => null} />
      <mesh position={dimensionStart} raycast={() => null}><sphereGeometry args={[.018, 8, 6]} /><meshBasicMaterial color={color} /></mesh>
      <mesh position={dimensionEnd} raycast={() => null}><sphereGeometry args={[.018, 8, 6]} /><meshBasicMaterial color={color} /></mesh>
      <Html position={middle} center distanceFactor={9} pointerEvents="none"><span className="conduit-dimension-label">{guide.label}</span></Html>
    </group>;
  })}</group>;
}
