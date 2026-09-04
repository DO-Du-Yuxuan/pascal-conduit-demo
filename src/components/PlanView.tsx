import type { BuildingScene, PascalNode } from "../domain/building";
import type { ConduitOverlayDocument, RoutingSystem } from "../domain/overlay";

type Props = { building: BuildingScene; overlay: ConduitOverlayDocument; selectedId: string | null; visibleSystems: Record<RoutingSystem, boolean>; onSelect: (id: string) => void };
const number = (value: unknown, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const plan = (value: unknown): [number, number] => Array.isArray(value) ? [number(value[0]), number(value[1])] : [0, 0];

function bounds(nodes: PascalNode[]) {
  const values: [number, number][] = [];
  for (const node of nodes) {
    if (node.type === "wall") values.push(plan(node.start), plan(node.end));
    if (["slab", "ceiling"].includes(node.type) && Array.isArray(node.polygon)) values.push(...node.polygon.map(plan));
  }
  const xs = values.map((value) => value[0]), zs = values.map((value) => value[1]);
  return { minX: Math.min(...xs, 0), maxX: Math.max(...xs, 10), minZ: Math.min(...zs, 0), maxZ: Math.max(...zs, 10) };
}

export function PlanView({ building, overlay, selectedId, visibleSystems, onSelect }: Props) {
  const all = Object.values(building.nodes), area = bounds(all), width = 1000, height = 680, padding = 28;
  const scale = Math.min((width - padding * 2) / Math.max(1, area.maxX - area.minX), (height - padding * 2) / Math.max(1, area.maxZ - area.minZ));
  const project = (x: number, z: number): [number, number] => [padding + (x - area.minX) * scale, height - padding - (z - area.minZ) * scale];
  return <svg className="plan-view" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="二维管线平面图">
    <rect width={width} height={height} fill="#f7f4ee" />
    {all.filter((node) => node.type === "slab" && Array.isArray(node.polygon)).map((node) => <polygon key={node.id} points={(node.polygon as unknown[]).map((value) => project(...plan(value)).join(",")).join(" ")} fill="#dfd2be" opacity=".55" />)}
    {all.filter((node) => node.type === "wall").map((node) => { const [x1, z1] = project(...plan(node.start)), [x2, z2] = project(...plan(node.end)); return <line key={node.id} x1={x1} y1={z1} x2={x2} y2={z2} stroke="#76685a" strokeWidth={Math.max(2, number(node.thickness, .12) * scale)} strokeLinecap="round" />; })}
    {overlay.segments.filter((segment) => visibleSystems[segment.system]).map((segment) => { const [x1, y1] = project(segment.start.position[0], segment.start.position[2]), [x2, y2] = project(segment.end.position[0], segment.end.position[2]); const vertical = Math.abs(segment.start.position[0] - segment.end.position[0]) < .001 && Math.abs(segment.start.position[2] - segment.end.position[2]) < .001; return <g key={segment.id} onClick={() => onSelect(segment.id)}><line x1={x1} y1={y1} x2={x2} y2={y2} stroke={selectedId === segment.id ? "#f59e0b" : overlay.settings.colors[segment.system]} strokeWidth={Math.max(3, segment.diameterMm / 5)} strokeLinecap="round" />{vertical && <text x={x1 + 7} y={y1 - 7} fontSize="16" fill="#334155">{segment.end.position[1] >= segment.start.position[1] ? "↑" : "↓"}</text>}</g>; })}
    {overlay.fittings.filter((fitting) => visibleSystems[fitting.system]).map((fitting) => { const [x, y] = project(fitting.position.position[0], fitting.position.position[2]); return <circle key={fitting.id} cx={x} cy={y} r={Math.max(4, fitting.diameterMm / 5)} fill={selectedId === fitting.id ? "#f59e0b" : overlay.settings.colors[fitting.system]} stroke="#334155" strokeWidth="1" onClick={() => onSelect(fitting.id)} />; })}
    {overlay.penetrations.map((feature) => { const [x, y] = project(feature.point.position[0], feature.point.position[2]); return <path key={feature.id} d={`M ${x - 6} ${y - 6} L ${x + 6} ${y + 6} M ${x + 6} ${y - 6} L ${x - 6} ${y + 6}`} stroke="#d97706" strokeWidth="2" />; })}
  </svg>;
}
