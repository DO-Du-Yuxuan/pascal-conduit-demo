import { Html, Line } from "@react-three/drei";
import type { Vec3 } from "../domain/overlay";

export type PositionDimensionGuide = { key: string; start: Vec3; end: Vec3; label: string; offset?: Vec3 };

export function dimensionLinePoints(guide: PositionDimensionGuide) {
  const vertical = Math.abs(guide.end[1] - guide.start[1]) > Math.max(Math.abs(guide.end[0] - guide.start[0]), Math.abs(guide.end[2] - guide.start[2]));
  const offset: Vec3 = guide.offset ?? (vertical ? [.06, 0, 0] : [0, -.06, 0]);
  const start: Vec3 = [guide.start[0] + offset[0], guide.start[1] + offset[1], guide.start[2] + offset[2]];
  const end: Vec3 = [guide.end[0] + offset[0], guide.end[1] + offset[1], guide.end[2] + offset[2]];
  return { start, end, middle: [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2] as Vec3 };
}

export function dimensionLabelStackOffset(index: number, count: number, spacing = 22) {
  return (index - (count - 1) / 2) * spacing;
}

/** A dimension line whose optional offset is shared by both displayed endpoints. */
export function PositionDimensionGuides({ name, guides, color = "#f97316", stackedLabels = false }: { name: string; guides: readonly PositionDimensionGuide[]; color?: string; stackedLabels?: boolean }) {
  return <group name={name}>{guides.map((guide, index) => {
    const { start: dimensionStart, end: dimensionEnd, middle } = dimensionLinePoints(guide), labelOffset = stackedLabels ? dimensionLabelStackOffset(index, guides.length) : 0;
    const directRay = guide.offset?.every((value) => Math.abs(value) < 1e-9) ?? false;
    return <group key={guide.key} name={`position-dimension:${guide.key}`}>
      {!directRay && <Line points={[guide.start, dimensionStart]} color={color} lineWidth={1.25} raycast={() => null} />}
      {!directRay && <Line points={[guide.end, dimensionEnd]} color={color} lineWidth={1.25} raycast={() => null} />}
      <Line points={[dimensionStart, dimensionEnd]} color={color} lineWidth={1.5} depthTest={!directRay} depthWrite={!directRay} renderOrder={directRay ? 24 : 0} raycast={() => null} />
      <mesh position={dimensionStart} renderOrder={directRay ? 24 : 0} raycast={() => null}><sphereGeometry args={[.018, 8, 6]} /><meshBasicMaterial color={color} depthTest={!directRay} depthWrite={!directRay} /></mesh>
      <mesh position={dimensionEnd} renderOrder={directRay ? 24 : 0} raycast={() => null}><sphereGeometry args={[.018, 8, 6]} /><meshBasicMaterial color={color} depthTest={!directRay} depthWrite={!directRay} /></mesh>
      <Html position={middle} center distanceFactor={9} pointerEvents="none"><span className="conduit-dimension-label" style={stackedLabels ? { transform: `translateY(${labelOffset}px)` } : undefined}>{guide.label}</span></Html>
    </group>;
  })}</group>;
}
