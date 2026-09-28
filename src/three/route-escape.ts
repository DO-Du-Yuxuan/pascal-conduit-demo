export type RouteEscapeState =
  | {
      tool: "draw" | "branch";
      draftPointCount: number;
      hasFixedStart: boolean;
      penetrationActive?: boolean;
    }
  | { tool: "hvac-control"; waypointCount: number; hasStart: boolean }
  | { tool: "hvac-duct"; segmentCount: number; hasStart: boolean }
  | { tool: "other" };

export type RouteEscapeAction =
  | "cancel-penetration"
  | "pop-draft-point"
  | "cancel-fixed-start"
  | "pop-hvac-control-waypoint"
  | "cancel-hvac-control"
  | "pop-hvac-duct-segment"
  | "cancel-hvac-duct-start"
  | "none";

/** Selects exactly one route-editing undo step for a single Escape press. */
export function routeEscapeAction(state: RouteEscapeState): RouteEscapeAction {
  if (state.tool === "other") return "none";

  if (state.tool === "hvac-control") {
    if (state.waypointCount > 0) return "pop-hvac-control-waypoint";
    return state.hasStart ? "cancel-hvac-control" : "none";
  }

  if (state.tool === "hvac-duct") {
    if (state.segmentCount > 0) return "pop-hvac-duct-segment";
    return state.hasStart ? "cancel-hvac-duct-start" : "none";
  }

  if (state.penetrationActive) return "cancel-penetration";
  if (state.hasFixedStart) {
    // The first draft point is the source/branch anchor, not a route waypoint.
    if (state.draftPointCount > 1) return "pop-draft-point";
    return state.draftPointCount > 0 ? "cancel-fixed-start" : "none";
  }
  // Free-start routes consist only of user-confirmed draft points.
  return state.draftPointCount > 0 ? "pop-draft-point" : "none";
}

/** Editable controls suppress shortcuts, except Escape for an active route. */
export function shouldIgnoreEditableKeydown(key: string, targetIsEditable: boolean, routeEscapeActive: boolean): boolean {
  return targetIsEditable && !(key === "Escape" && routeEscapeActive);
}
