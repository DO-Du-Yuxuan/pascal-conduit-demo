import { describe, expect, it } from "vitest";
import { routeEscapeAction, shouldIgnoreEditableKeydown } from "./route-escape";

describe("route Escape undo decisions", () => {
  it("pops one confirmed point at a time for fixed-source red and white routes", () => {
    for (const tool of ["draw", "branch"] as const) {
      expect(routeEscapeAction({ tool, draftPointCount: 4, hasFixedStart: true })).toBe("pop-draft-point");
      expect(routeEscapeAction({ tool, draftPointCount: 2, hasFixedStart: true })).toBe("pop-draft-point");
      expect(routeEscapeAction({ tool, draftPointCount: 1, hasFixedStart: true })).toBe("cancel-fixed-start");
    }
  });

  it("pops each free-start route point, including its first confirmed point", () => {
    expect(routeEscapeAction({ tool: "draw", draftPointCount: 2, hasFixedStart: false })).toBe("pop-draft-point");
    expect(routeEscapeAction({ tool: "draw", draftPointCount: 1, hasFixedStart: false })).toBe("pop-draft-point");
    expect(routeEscapeAction({ tool: "draw", draftPointCount: 0, hasFixedStart: false })).toBe("none");
  });

  it("keeps the branch anchor while removing confirmed branch points", () => {
    expect(routeEscapeAction({ tool: "branch", draftPointCount: 3, hasFixedStart: true })).toBe("pop-draft-point");
    expect(routeEscapeAction({ tool: "branch", draftPointCount: 1, hasFixedStart: true })).toBe("cancel-fixed-start");
  });

  it("pops HVAC control waypoints before cancelling the source route", () => {
    expect(routeEscapeAction({ tool: "hvac-control", waypointCount: 2, hasStart: true })).toBe("pop-hvac-control-waypoint");
    expect(routeEscapeAction({ tool: "hvac-control", waypointCount: 1, hasStart: true })).toBe("pop-hvac-control-waypoint");
    expect(routeEscapeAction({ tool: "hvac-control", waypointCount: 0, hasStart: true })).toBe("cancel-hvac-control");
  });

  it("removes one committed terminal HVAC duct segment per Escape", () => {
    expect(routeEscapeAction({ tool: "hvac-duct", segmentCount: 3, hasStart: true })).toBe("pop-hvac-duct-segment");
    expect(routeEscapeAction({ tool: "hvac-duct", segmentCount: 1, hasStart: true })).toBe("pop-hvac-duct-segment");
    expect(routeEscapeAction({ tool: "hvac-duct", segmentCount: 0, hasStart: true })).toBe("cancel-hvac-duct-start");
  });

  it("does not cancel a pending penetration by also popping its preceding point", () => {
    expect(routeEscapeAction({ tool: "draw", draftPointCount: 3, hasFixedStart: true, penetrationActive: true })).toBe("cancel-penetration");
  });
});

describe("editable focus and Escape", () => {
  it("allows Escape through an editable target only while a route undo step exists", () => {
    expect(shouldIgnoreEditableKeydown("Escape", true, true)).toBe(false);
    expect(shouldIgnoreEditableKeydown("Escape", true, false)).toBe(true);
    expect(shouldIgnoreEditableKeydown("Shift", true, true)).toBe(true);
    expect(shouldIgnoreEditableKeydown("Escape", false, false)).toBe(false);
  });
});
