import { Html, Line } from "@react-three/drei";
import type { Vec3 } from "../domain/overlay";
import { WorldSpaceCanvasLabel } from "./WorldSpaceCanvasLabel";
import { projectDimensionPointToWall, wallDimensionTextBasis, type WallDimensionFrame } from "./wall-dimension-placement";

export type PositionDimensionGuide = { key: string; start: Vec3; end: Vec3; label: string; offset?: Vec3; labelShift?: Vec3; wallFrame?: WallDimensionFrame; wallProjection?: boolean; displayStart?: Vec3; displayEnd?: Vec3; wallOriented?: boolean; textBasis?: { right: Vec3; up: Vec3; normal: Vec3 }; textPlanePoint?: Vec3; suppressExtensionLines?: boolean; lineWidth?: number; showEndpoints?: boolean };

export function dimensionLinePoints(guide: PositionDimensionGuide) {
  const vertical = Math.abs(guide.end[1] - guide.start[1]) > Math.max(Math.abs(guide.end[0] - guide.start[0]), Math.abs(guide.end[2] - guide.start[2]));
  const offset: Vec3 = guide.offset ?? (vertical ? [.06, 0, 0] : [0, -.06, 0]);
  const start: Vec3 = [guide.start[0] + offset[0], guide.start[1] + offset[1], guide.start[2] + offset[2]];
  const end: Vec3 = [guide.end[0] + offset[0], guide.end[1] + offset[1], guide.end[2] + offset[2]];
  return { start, end, middle: [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2] as Vec3 };
}

export function dimensionLabelStackOffset(index: number, count: number, spacing = 72) {
  return (index - (count - 1) / 2) * spacing / 1000;
}

function projectToTextPlane(point: Vec3, planePoint: Vec3, normal: Vec3): Vec3 {
  const delta: Vec3 = [point[0] - planePoint[0], point[1] - planePoint[1], point[2] - planePoint[2]], distance = delta[0] * normal[0] + delta[1] * normal[1] + delta[2] * normal[2];
  return [point[0] - normal[0] * distance, point[1] - normal[1] * distance, point[2] - normal[2] * distance];
}

/** A dimension line whose optional offset is shared by both displayed endpoints. */
export function PositionDimensionGuides({ name, guides, color = "#f97316", stackedLabels = false }: { name: string; guides: readonly PositionDimensionGuide[]; color?: string; stackedLabels?: boolean }) {
  return <group name={name}>{guides.map((guide, index) => {
    const line = dimensionLinePoints(guide), dimensionStart = guide.displayStart ?? (guide.wallFrame && guide.wallProjection !== false ? projectDimensionPointToWall(line.start, guide.wallFrame) : line.start), dimensionEnd = guide.displayEnd ?? (guide.wallFrame && guide.wallProjection !== false ? projectDimensionPointToWall(line.end, guide.wallFrame) : line.end), middle: Vec3 = [(dimensionStart[0] + dimensionEnd[0]) / 2, (dimensionStart[1] + dimensionEnd[1]) / 2, (dimensionStart[2] + dimensionEnd[2]) / 2], labelOffset = stackedLabels ? dimensionLabelStackOffset(index, guides.length) : 0;
    const wallMark = guide.wallOriented || Boolean(guide.wallFrame);
    const directRay = !wallMark && (guide.offset?.every((value) => Math.abs(value) < 1e-9) ?? false);
    const textBasis = guide.wallFrame ? wallDimensionTextBasis(guide.wallFrame) : guide.textBasis;
    const labelShift = guide.labelShift ?? (textBasis ? [textBasis.up[0] * .09, textBasis.up[1] * .09, textBasis.up[2] * .09] as Vec3 : undefined);
    const shiftedMiddle: Vec3 = labelShift ? [middle[0] + labelShift[0], middle[1] + labelShift[1], middle[2] + labelShift[2]] : middle;
    const labelPosition = guide.wallFrame ? shiftedMiddle : textBasis && guide.textPlanePoint ? projectToTextPlane(shiftedMiddle, guide.textPlanePoint, textBasis.normal) : shiftedMiddle;
    const stackedPosition: Vec3 = textBasis ? [labelPosition[0] + textBasis.up[0] * labelOffset, labelPosition[1] + textBasis.up[1] * labelOffset, labelPosition[2] + textBasis.up[2] * labelOffset] : labelPosition;
    return <group key={guide.key} name={`position-dimension:${guide.key}`}>
      {!directRay && !guide.suppressExtensionLines && <Line points={[guide.start, dimensionStart]} color={color} lineWidth={1.25} raycast={() => null} />}
      {!directRay && !guide.suppressExtensionLines && <Line points={[guide.end, dimensionEnd]} color={color} lineWidth={1.25} raycast={() => null} />}
      <Line points={[dimensionStart, dimensionEnd]} color={color} lineWidth={guide.lineWidth ?? 1.5} depthTest={!directRay} depthWrite={!wallMark && !directRay} renderOrder={directRay ? 24 : 0} raycast={() => null} />
      {guide.showEndpoints !== false && <mesh position={dimensionStart} renderOrder={directRay ? 24 : 0} raycast={() => null}><sphereGeometry args={[wallMark ? .004 : .018, 8, 6]} /><meshBasicMaterial color={color} depthTest={!directRay} depthWrite={!wallMark && !directRay} /></mesh>}
      {guide.showEndpoints !== false && <mesh position={dimensionEnd} renderOrder={directRay ? 24 : 0} raycast={() => null}><sphereGeometry args={[wallMark ? .004 : .018, 8, 6]} /><meshBasicMaterial color={color} depthTest={!directRay} depthWrite={!wallMark && !directRay} /></mesh>}
      {textBasis && guide.label.trim() ? <WorldSpaceCanvasLabel text={guide.label} position={stackedPosition} {...textBasis} fontSizeMm={34} canvasHeightMm={48} color={color} framed /> : !guide.wallOriented && <Html position={middle} center distanceFactor={9} pointerEvents="none"><span className="conduit-dimension-label">{guide.label}</span></Html>}
    </group>;
  })}</group>;
}
