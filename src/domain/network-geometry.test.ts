import { describe, expect, it } from "vitest";
import type { RouteFitting } from "./overlay";
import { teeSocketSegments } from "./network-geometry";

describe("network fitting geometry", () => {
  it("builds a three-barrel tee aligned to its physical ports", () => {
    const fitting: RouteFitting = { id: "tee", type: "sprinkler-fitting", fitting: "tee", system: "sprinkler", diameterMm: 50, position: { position: [1, 2, 3] }, segmentIds: ["a", "b", "c"], ports: [
      { id: "p1", owner: { kind: "fitting", id: "tee" }, position: { position: [.95, 2, 3] }, direction: [-1, 0, 0], role: "branch", system: "sprinkler", connectedSegmentIds: ["a"], segmentId: "a" },
      { id: "p2", owner: { kind: "fitting", id: "tee" }, position: { position: [1.05, 2, 3] }, direction: [1, 0, 0], role: "branch", system: "sprinkler", connectedSegmentIds: ["b"], segmentId: "b" },
      { id: "p3", owner: { kind: "fitting", id: "tee" }, position: { position: [1, 2, 3.05] }, direction: [0, 0, 1], role: "branch", system: "sprinkler", connectedSegmentIds: ["c"], segmentId: "c" },
    ] };
    const sockets = teeSocketSegments(fitting);
    expect(sockets).toHaveLength(3);
    expect(sockets.map((segment) => segment.start.position)).toEqual([[1, 2, 3], [1, 2, 3], [1, 2, 3]]);
    expect(sockets.map((segment) => segment.end.position)).toEqual(fitting.ports.map((port) => port.position.position));
  });
});
