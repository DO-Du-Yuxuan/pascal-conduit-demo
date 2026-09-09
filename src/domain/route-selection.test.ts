import { describe, expect, it } from "vitest";
import { connectedRouteElementIds } from "./route-selection";

const segment = (id: string) => ({ id, type: "conduit-segment" as const, system: "network" as const, diameterMm: 20, start: { position: [0, 0, 0] as [number, number, number] }, end: { position: [1, 0, 0] as [number, number, number] }, createdAt: "" });
const fitting = (id: string, segmentIds: string[]) => ({ id, type: "conduit-fitting" as const, fitting: "elbow" as const, system: "network" as const, diameterMm: 20, position: { position: [0, 0, 0] as [number, number, number] }, segmentIds, ports: [] });

describe("connected route selection", () => {
  it("selects every segment and fitting in the same physical route component", () => {
    const overlay = { segments: [segment("a"), segment("b"), segment("c"), segment("isolated")], fittings: [fitting("bend", ["a", "b"]), fitting("tee", ["b", "c"])] };
    expect(connectedRouteElementIds(overlay, "a").sort()).toEqual(["a", "b", "bend", "c", "tee"]);
  });

  it("can begin from a fitting and excludes separate routes", () => {
    const overlay = { segments: [segment("a"), segment("b"), segment("isolated")], fittings: [fitting("bend", ["a", "b"])] };
    expect(connectedRouteElementIds(overlay, "bend").sort()).toEqual(["a", "b", "bend"]);
  });
});
