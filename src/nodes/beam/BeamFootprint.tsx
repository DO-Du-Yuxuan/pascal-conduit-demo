import type { BeamNode } from "../../domain/beams";
import type { Penetration } from "../../domain/overlay";
import { beamFootprintLayout } from "./geometry";

export type BeamFootprintProps = {
  node: BeamNode;
  selected: boolean;
  penetrations?: Penetration[];
  onSelect: (id: string) => void;
  visualOnly?: boolean;
};

/** Read-only selectable plan footprint. It contains no Beam authoring controls. */
export function BeamFootprint({ node, selected, penetrations = [], onSelect, visualOnly = false }: BeamFootprintProps) {
  const layout = beamFootprintLayout(node, penetrations);
  if (!layout) return null;
  const { center, length, width, rotationDegrees, holes } = layout;
  return <g
    data-selectable={visualOnly ? undefined : "beam"}
    transform={`translate(${center[0]} ${center[1]}) rotate(${rotationDegrees})`}
    pointerEvents={visualOnly ? "none" : undefined}
    onClick={visualOnly ? undefined : (event) => { event.stopPropagation(); onSelect(node.id); }}
  >
    <rect x={-length / 2} y={-width / 2} width={length} height={width} fill={selected ? "#fb923c" : "#818894"} stroke={selected ? "#c2410c" : "#525a65"} strokeWidth={selected ? ".06" : ".025"} opacity=".76" />
    {holes.map((hole) => <g key={hole.id}>
      <circle cx={hole.center[0]} cy={hole.center[1]} r={hole.radius} fill="#f8fafc" stroke="#111827" strokeWidth=".02" />
      {selected && <text x={hole.center[0]} y={hole.center[1] - .12} textAnchor="middle" fontSize=".12" fill="#111827">Ø{Math.round(hole.radius * 2000)} · {hole.segmentId}</text>}
    </g>)}
  </g>;
}
