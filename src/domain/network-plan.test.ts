import { describe, expect, it } from "vitest";
import type { RouteFitting } from "./overlay";
import { planFittingDisplay } from "./network-plan";

const fitting = (kind: RouteFitting["fitting"]): RouteFitting => ({ id: kind, type: "conduit-fitting", fitting: kind, system: "receptacle", diameterMm: 20, position: { position: [0, 0, 0] }, segmentIds: [], ports: [] });

describe("2D network symbols", () => {
  it("hides elbow, coupling and tee point symbols", () => {
    expect(planFittingDisplay(fitting("elbow")).kind).toBe("hidden");
    expect(planFittingDisplay(fitting("coupling")).kind).toBe("hidden");
    expect(planFittingDisplay(fitting("tee")).kind).toBe("connectors");
  });

  it("keeps sweep geometry as a continuous arc", () => {
    const sweep = { ...fitting("elbow"), arc: { start: [0, 0, 0], end: [1, 0, 1], center: [0, 0, 1], normal: [0, -1, 0], sweepRadians: Math.PI / 2 } } as RouteFitting;
    expect(planFittingDisplay(sweep).kind).toBe("arc");
  });
});
