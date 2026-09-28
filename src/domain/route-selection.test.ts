import { describe, expect, it } from "vitest";
import { createEmptyOverlay } from "./overlay";
import { deleteNetworkObjects } from "./routing";
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

  it("does not cross a deleted middle segment even when both remaining sides share a broken circuit", () => {
    const circuitId = "main-circuit";
    const original = {
      ...createEmptyOverlay("selection.json", "sha"),
      segments: ["left", "removed-middle", "right"].map((id) => ({ ...segment(id), circuitId })),
      fittings: [fitting("left-joint", ["left", "removed-middle"]), fitting("right-joint", ["removed-middle", "right"])],
      circuits: [{ id: circuitId, system: "network" as const, sourceDeviceId: null, rootPortId: null, segmentIds: ["left", "removed-middle", "right"], status: "rooted" as const, createdAt: "" }],
    };

    const afterDelete = deleteNetworkObjects(original, ["removed-middle"]);

    expect(afterDelete.circuits[0]).toMatchObject({ segmentIds: ["left", "right"], status: "broken" });
    expect(circuitRouteElementIds(afterDelete, "left").sort()).toEqual(["left"]);
    expect(circuitRouteElementIds(afterDelete, "right").sort()).toEqual(["right"]);
  });

  it("keeps a physically connected branch selectable after a circuit is marked broken", () => {
    const circuitId = "main-circuit";
    const overlay = {
      segments: ["main-a", "main-b", "branch"].map((id) => ({ ...segment(id), circuitId })),
      fittings: [fitting("tee", ["main-a", "main-b", "branch"])],
      junctionBoxes: [],
      circuits: [{ id: circuitId, system: "network" as const, sourceDeviceId: null, rootPortId: null, segmentIds: ["main-a", "main-b", "branch"], status: "broken" as const, createdAt: "" }],
    };

    expect(circuitRouteElementIds(overlay, "branch").sort()).toEqual(["branch", "main-a", "main-b", "tee"]);
  });

  it("uses connected device ports as physical adjacency without crossing into another circuit", () => {
    const overlay = {
      segments: [segment("same-a"), segment("same-b"), segment("other-circuit")].map((item) => ({ ...item, circuitId: item.id === "other-circuit" ? "other-circuit" : "main-circuit" })),
      fittings: [],
      junctionBoxes: [],
      devices: [{
        id: "panel",
        type: "network-device" as const,
        deviceType: "strong-panel" as const,
        name: "panel",
        position: segment("panel").start,
        sizeMm: [100, 100, 100] as [number, number, number],
        orientation: [0, 0, 1] as [number, number, number],
        systems: ["network" as const],
        ports: ["same-a", "same-b", "other-circuit"].map((segmentId) => ({ id: `port-${segmentId}`, owner: { kind: "device" as const, id: "panel" }, position: segment(segmentId).start, direction: [1, 0, 0] as [number, number, number], role: "bidirectional" as const, system: "network" as const, connectedSegmentIds: [segmentId] })),
        createdAt: "",
      }],
      circuits: [
        { id: "main-circuit", system: "network" as const, sourceDeviceId: "panel", rootPortId: "port-same-a", segmentIds: ["same-a", "same-b"], status: "rooted" as const, createdAt: "" },
        { id: "other-circuit", system: "network" as const, sourceDeviceId: "panel", rootPortId: "port-other-circuit", segmentIds: ["other-circuit"], status: "rooted" as const, createdAt: "" },
      ],
    };

    expect(circuitRouteElementIds(overlay, "same-a").sort()).toEqual(["same-a", "same-b"]);
  });

  it("crosses between distinct connected ports on one junction box in the same circuit", () => {
    const firstPort = { id: "box-port-a", owner: { kind: "junction-box" as const, id: "box" }, position: segment("a").start, direction: [1, 0, 0] as [number, number, number], role: "branch" as const, system: "network" as const, connectedSegmentIds: ["a"] };
    const secondPort = { ...firstPort, id: "box-port-b", connectedSegmentIds: ["b"] };
    const overlay = {
      segments: [segment("a"), segment("b")].map((item) => ({ ...item, circuitId: "main-circuit" })),
      fittings: [],
      junctionBoxes: [{ ...box("box", []), segmentIds: [], ports: [firstPort, secondPort] }],
      circuits: [{ id: "main-circuit", system: "network" as const, sourceDeviceId: null, rootPortId: null, segmentIds: ["a", "b"], status: "rooted" as const, createdAt: "" }],
    };

    expect(circuitRouteElementIds(overlay, "a").sort()).toEqual(["a", "b", "box"]);
  });

  it("does not connect geometrically touching segments without a physical reference", () => {
    const touching = { ...segment("touching"), start: segment("a").end, end: segment("a").end };
    const overlay = {
      segments: [segment("a"), touching].map((item) => ({ ...item, circuitId: "main-circuit" })),
      fittings: [],
      junctionBoxes: [],
      circuits: [{ id: "main-circuit", system: "network" as const, sourceDeviceId: null, rootPortId: null, segmentIds: ["a", "touching"], status: "broken" as const, createdAt: "" }],
    };

    expect(circuitRouteElementIds(overlay, "a")).toEqual(["a"]);
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
