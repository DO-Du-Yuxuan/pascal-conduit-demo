const toggleOrthogonalTools = new Set(["beam", "draw", "branch", "hvac-duct", "hvac-supply", "hvac-return", "hvac-control"]);
const prestartWorldAxisTools = new Set(["draw", "branch", "hvac-control"]);
const axisArrowKeys = new Set(["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"]);

export function canToggleRouteOrthogonal(tool: string): boolean {
  return toggleOrthogonalTools.has(tool);
}

export function shouldHandleWorldAxisArrow(key: string, routeActive: boolean, tool: string): boolean {
  return axisArrowKeys.has(key) && (routeActive || prestartWorldAxisTools.has(tool) || key === "ArrowDown");
}

export function routeModeAfterShift(orthogonal: boolean, worldAxis: "x" | "y" | "z" | null): { orthogonal: boolean; worldAxis: null } {
  return worldAxis ? { orthogonal: true, worldAxis: null } : { orthogonal: !orthogonal, worldAxis: null };
}

export function routeModeAfterAxisButton(axis: "x" | "y" | "z", currentAxis: "x" | "y" | "z" | null): { orthogonal: false; worldAxis: "x" | "y" | "z" | null } {
  return { orthogonal: false, worldAxis: currentAxis === axis ? null : axis };
}

export function hvacEmptyCanvasRouteAction(tool: string, hasRouteStart: boolean, worldAxis: "x" | "y" | "z" | null): "control-waypoint" | "duct-point" | null {
  if (!hasRouteStart || !worldAxis) return null;
  if (tool === "hvac-control") return "control-waypoint";
  if (tool === "hvac-supply" || tool === "hvac-return") return "duct-point";
  return null;
}
