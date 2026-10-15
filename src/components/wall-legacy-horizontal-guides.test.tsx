import { describe, expect, it } from "vitest";
import React, { isValidElement, type ReactNode } from "react";
import { DeviceDimensionGuides } from "./ConduitScene";
import { HvacThermostatDimensions } from "./HvacScene";
import { PositionDimensionGuides } from "./PositionDimensionGuides";
import { nearestWallDimensionFrame } from "./wall-dimension-placement";

function elements(node: ReactNode): React.ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  return [node, ...elements((node.props as { children?: ReactNode }).children)];
}

function firstGuideSet(tree: ReactNode) {
  const guideSet = elements(tree).find(element => element.type === PositionDimensionGuides);
  return (guideSet?.props as { guides?: Array<Record<string, unknown>> } | undefined)?.guides ?? [];
}

describe("legacy wall-mounted horizontal dimensions", () => {
  const wallFrame = nearestWallDimensionFrame("wall", [1, 1, .105], [0, 0, 1], [{ id: "wall", start: [0, 0, 0], end: [2, 0, 0], halfThickness: .05 }])!;

  it("routes a device legacy horizontal guide onto the wall-label path", () => {
    const device = { id: "socket", deviceType: "socket", sizeMm: [86, 86, 50], position: { position: [1, 1, .1], attachment: { hostKind: "wall", hostId: "wall", normal: [0, 0, 1], basis: { u: [1, 0, 0] } } } } as any;
    const guides = firstGuideSet(DeviceDimensionGuides({ device, description: { horizontal: { direction: 1, millimeters: 1197 }, planar: [] } as any, wallFrame, devices: [] }));
    expect(guides).toHaveLength(1);
    expect(guides[0]).toMatchObject({ key: "horizontal", wallFrame, wallOriented: true });
  });

  it("deduplicates the thermostat legacy horizontal value when a planar reference exists", () => {
    const thermostat = { id: "thermostat", sizeMm: [86, 86], position: { position: [1, 1, .1], attachment: { hostKind: "wall", hostId: "wall", normal: [0, 0, 1], basis: { u: [1, 0, 0] } } } } as any;
    const description = { horizontal: { direction: 1, millimeters: 1197 }, planar: [{ key: "u+", millimeters: 1197, direction: [1, 0, 0], witness: { objectKind: "wall", objectId: "wall", point: [2, 1, .1] } }] } as any;
    const guides = firstGuideSet(HvacThermostatDimensions({ thermostat, description, wallFrame, overlay: { devices: [], hvac: { thermostats: [] } } as any }));
    expect(guides).toHaveLength(1);
    expect(guides[0]).toMatchObject({ key: "u+", wallFrame, wallOriented: true });
  });
});
