import { describe, expect, it } from "vitest";
import { circuitRouteElementIds, connectedRouteElementIds } from "./route-selection";

const segment = (id: string) => ({ id, type: "conduit-segment" as const, system: "network" as const, diameterMm: 20, start: { position: [0, 0, 0] as [number, number, number] }, end: { position: [1, 0, 0] as [number, number, number] }, createdAt: "" });
const fitting = (id: string, segmentIds: string[]) => ({ id, type: "conduit-fitting" as const, fitting: "elbow" as const, system: "network" as const, diameterMm: 20, position: { position: [0, 0, 0] as [number, number, number] }, segmentIds, ports: [] });
const box = (id: string, segmentIds: string[]) => ({ id, type: "junction-box" as const, system: "receptacle" as const, position: { position: [0, 0, 0] as [number, number, number] }, sizeMm: [86, 86, 50] as [number, number, number], segmentIds, ports: [] });

describe("connected route selection", () => {
  it("selects every segment and fitting in the same physical route component", () => {
    const overlay = { segments: [segment("a"), segment("b"), segment("c"), segment("isolated")], fittings: [fitting("bend", ["a", "b"]), fitting("tee", ["b", "c"])] };
    expect(connectedRouteElementIds(overlay, "a").sort()).toEqual(["a", "b", "bend", "c", "tee"]);
  });

  it("can begin from a fitting and excludes separate routes", () => {
    const overlay = { segments: [segment("a"), segment("b"), segment("isolated")], fittings: [fitting("bend", ["a", "b"])] };
    expect(connectedRouteElementIds(overlay, "bend").sort()).toEqual(["a", "b", "bend"]);
  });

  it("selects a whole circuit across junction boxes and only its related fittings", () => {
    const overlay = {
      segments: [segment("a"), segment("b"), segment("branch"), segment("other")].map((item) => ({ ...item, circuitId: item.id === "other" ? "other-circuit" : "main-circuit" })),
      fittings: [fitting("bend", ["a", "b"]), fitting("other-bend", ["other"])],
      junctionBoxes: [box("box", ["b", "branch"]), box("other-box", ["other"])],
      circuits: [{ id: "main-circuit", system: "receptacle" as const, sourceDeviceId: null, rootPortId: null, segmentIds: ["a", "b", "branch"], status: "rooted" as const, createdAt: "" }, { id: "other-circuit", system: "receptacle" as const, sourceDeviceId: null, rootPortId: null, segmentIds: ["other"], status: "rooted" as const, createdAt: "" }],
    };
    expect(circuitRouteElementIds(overlay, "a").sort()).toEqual(["a", "b", "bend", "box", "branch"]);
  });

  it("falls back to the physical fitting component for circuit-less fire routes", () => {
    const overlay = { segments: [segment("a"), segment("b"), segment("isolated")], fittings: [fitting("tee", ["a", "b"])], junctionBoxes: [], circuits: [] };
    expect(circuitRouteElementIds(overlay, "a").sort()).toEqual(["a", "b", "tee"]);
  });

  it("crosses a physical junction box when a legacy route has no circuit", () => {
    const overlay = { segments: [segment("a"), segment("b")], fittings: [], junctionBoxes: [box("box", ["a", "b"])], circuits: [] };
    expect(circuitRouteElementIds(overlay, "a").sort()).toEqual(["a", "b", "box"]);
  });
});
