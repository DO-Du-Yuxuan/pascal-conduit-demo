import { describe, expect, it, vi } from "vitest";
import React, { isValidElement, type ReactNode } from "react";
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";

vi.mock("@react-three/drei", () => ({
  Html: function HtmlMock() { return null; },
  Line: function LineMock() { return null; },
}));

import { dimensionLabelStackOffset, PositionDimensionGuides } from "./PositionDimensionGuides";
import { DeviceDimensionGuides } from "./ConduitScene";
import { HvacThermostatDimensions } from "./HvacScene";
import { WorldSpaceCanvasLabel } from "./WorldSpaceCanvasLabel";
import { nearestWallDimensionFrame, surfaceDimensionTextBasis } from "./wall-dimension-placement";
import { buildBuilderWallGeometry } from "../three/builder-wall-geometry";
import type { Wall } from "../geometry/walls/types";

function elements(node: ReactNode): React.ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  return [node, ...elements((node.props as { children?: ReactNode }).children)];
}

describe("position dimension guide rendering", () => {
  it("renders floor-center dimensions and coded wall seams from the shared reference resolver", () => {
    const faces = [
      { id: "wall-a", start: [0, 0, 0] as [number, number, number], end: [4, 0, 0] as [number, number, number], halfThickness: .1, levelId: "L0", bottomY: 0, topY: 3 },
      { id: "wall-b", start: [-2, 0, 0] as [number, number, number], end: [2, 0, 0] as [number, number, number], halfThickness: .1, levelId: "L0", bottomY: 0, topY: 3 },
    ];
    const device = { id: "floor-point", deviceType: "socket", sizeMm: [86, 50, 86], position: { position: [2, -.025, 2] }, mount: { kind: "finished-floor", levelId: "L0", datumId: "H01", sourceSlabId: "slab", topOffsetMm: 0 } } as never;
    const description = { planar: [
      { key: "u+", direction: [1, 0, 0], millimeters: 800, witness: { objectId: "wall-a", objectKind: "wall", point: [1, 0, .1] } },
      { key: "u-", direction: [-1, 0, 0], millimeters: 600, witness: { objectId: "wall-b", objectKind: "wall", point: [-1, 0, .1] } },
    ] } as never;
    const rendered = elements(DeviceDimensionGuides({ device, description, dimensionFaces: faces, devices: [] }));
    const dimensionGroup = rendered.find(element => (element.props as { name?: string }).name === "device-position-dimensions")!;
    const baselineGroup = rendered.find(element => (element.props as { name?: string }).name === "device-wall-reference-dimensions")!;
    expect((dimensionGroup.props as { guides: { key: string; label: string; textPlanePoint?: number[] }[] }).guides).toMatchObject([
      { key: "ground:u+", label: "至 G01 800 mm", textPlanePoint: [2, .004, 2] },
      { key: "ground:u-", label: "至 G03 600 mm", textPlanePoint: [2, .004, 2] },
    ]);
    expect((baselineGroup.props as { guides: { key: string; label: string; start: number[]; end: number[] }[] }).guides).toMatchObject([
      { key: "ground-baseline:wall-a:+:0", label: "G01", start: [0, 0, .101], end: [4, 0, .101] },
      { key: "ground-baseline:wall-b:+:0", label: "G03", start: [-2, 0, .101], end: [2, 0, .101] },
    ]);
  });

  it("uses one fixed-size, wall-parallel Canvas label with depth-tested geometry and no billboard", () => {
    const wallFrame = nearestWallDimensionFrame("wall", [1, 1, .105], [0, 0, 1], [{ id: "wall", start: [0, 0, 0], end: [2, 0, 0], halfThickness: .05 }])!;
    const tree = PositionDimensionGuides({ name: "wall-dimensions", guides: [{ key: "left", start: [.5, 1, 0], end: [0, 1, .1], label: "左基准 500 mm", wallFrame, wallOriented: true }] });
    const rendered = elements(tree), canvasLabels = rendered.filter(element => element.type === WorldSpaceCanvasLabel), htmlLabels = rendered.filter(element => typeof element.type === "function" && element.type.name === "HtmlMock");
    expect(canvasLabels).toHaveLength(1);
    expect(htmlLabels).toHaveLength(0);
    expect(canvasLabels[0]!.props).toMatchObject({ fontSizeMm: 34, canvasHeightMm: 48, right: [1, 0, 0], up: [0, 1, 0], normal: [0, 0, 1] });
    expect((canvasLabels[0]!.props as { position: number[] }).position[2]).toBeCloseTo(.056);
    const lineMaterial = rendered.find(element => typeof element.type === "function" && element.type.name === "LineMock" && "depthTest" in (element.props as object))!.props;
    expect(lineMaterial).toMatchObject({ depthTest: true, depthWrite: false });
  });

  it("keeps vertical wall witnesses on the matching face without offset leaders", () => {
    const faces = [
      { id: "wall", start: [0, 0, 0] as [number, number, number], end: [2, 0, 0] as [number, number, number], halfThickness: .05 },
      { id: "wall", start: [0, 0, .2] as [number, number, number], end: [2, 0, .2] as [number, number, number], halfThickness: .05 },
    ];
    const sides: Array<[number, [number, number, number]]> = [[0, [0, 0, -1]], [.2, [0, 0, 1]]];
    for (const [z, normal] of sides) {
      const wallFrame = nearestWallDimensionFrame("wall", [1, 1, z], normal, faces)!;
      const tree = PositionDimensionGuides({ name: "wall-references", color: "#b6422e", guides: [{ key: "vertical-reference", start: [1, .7, z], end: [1, 1.3, z], label: "", offset: [0, 0, 0], wallFrame, wallOriented: true, suppressExtensionLines: true }] });
      const rendered = elements(tree), lines = rendered.filter(element => typeof element.type === "function" && element.type.name === "LineMock");
      expect(lines).toHaveLength(1);
      expect((lines[0]!.props as { points: number[][] }).points).toEqual([[1, .7, z + normal[2] * .056], [1, 1.3, z + normal[2] * .056]]);
    }
  });

  it("draws visible red witnesses at both actual wall corners without projection stubs", () => {
    const faces = [
      { id: "host", start: [0, 0, 0] as [number, number, number], end: [2, 0, 0] as [number, number, number], halfThickness: .05, bottomY: 0, topY: 3 },
      { id: "left-wall", start: [0, 0, -1] as [number, number, number], end: [0, 0, 0] as [number, number, number], halfThickness: .05, bottomY: 0, topY: 3 },
      { id: "right-wall", start: [2, 0, 0] as [number, number, number], end: [2, 0, -1] as [number, number, number], halfThickness: .05, bottomY: 0, topY: 3 },
    ];
    const device = { id: "point", deviceType: "socket", sizeMm: [86, 86, 50], position: { position: [1, 1, .05], attachment: { hostId: "host", hostKind: "wall", surface: "wall-face", normal: [0, 0, 1], levelId: "level", basis: { u: [1, 0, 0], v: [0, 1, 0] } } } } as never;
    const description = { planar: [
      { key: "u-", direction: [-1, 0, 0], millimeters: 950, witness: { objectId: "left-wall", objectKind: "wall", point: [.05, 1, .05] } },
      { key: "u+", direction: [1, 0, 0], millimeters: 950, witness: { objectId: "right-wall", objectKind: "wall", point: [1.95, 1, .05] } },
    ] } as never;
    const hostFrame = nearestWallDimensionFrame("host", [1, 1, .05], [0, 0, 1], faces)!;
    const tree = DeviceDimensionGuides({ device, description, wallFrame: hostFrame, dimensionFaces: faces, devices: [] });
    const rendered = elements(tree), referenceGroup = rendered.find(element => (element.props as { name?: string }).name === "device-wall-reference-dimensions")!;
    const referenceProps = referenceGroup.props as Parameters<typeof PositionDimensionGuides>[0], referenceGuides = referenceProps.guides;
    expect(referenceGuides.map(guide => guide.key)).toEqual(["u-:vertical-reference:0", "u+:vertical-reference:0"]);
    const referenceElements = elements(PositionDimensionGuides(referenceProps)), lines = referenceElements.filter(element => typeof element.type === "function" && element.type.name === "LineMock");
    expect(lines).toHaveLength(2);
    expect((lines[0]!.props as { points: number[][] }).points).toEqual([[.05, 0, .0505], [.05, 3, .0505]]);
    expect((lines[1]!.props as { points: number[][] }).points).toEqual([[1.95, 0, .0505], [1.95, 3, .0505]]);
    expect(lines.every(line => (line.props as { lineWidth: number }).lineWidth === 3.75)).toBe(true);
    expect(lines.every(line => (line.props as { depthTest?: boolean }).depthTest === true)).toBe(true);
    expect(referenceGuides.every(guide => guide.suppressExtensionLines && guide.offset?.every(value => value === 0) && guide.showEndpoints === false)).toBe(true);
    expect(referenceGuides.every(guide => guide.wallProjection === false)).toBe(true);

    const dimensionGroup = rendered.find(element => (element.props as { name?: string }).name === "device-position-dimensions")!;
    const dimensionProps = dimensionGroup.props as Parameters<typeof PositionDimensionGuides>[0];
    for (let index = 0; index < dimensionProps.guides.length; index += 1) {
      const dimensionEnd = dimensionProps.guides[index]!.displayEnd!, referenceLine = (lines[index]!.props as { points: number[][] }).points;
      expect(dimensionEnd[0]).toBe(referenceLine[1]![0]);
      expect(dimensionEnd[2]).toBe(referenceLine[1]![2]);
      expect(dimensionEnd[1]).toBe(1);
    }

    const wall = (id: string, start: [number, number], end: [number, number]): Wall => ({ id, type: "wall", start, end, height: 3, thickness: .1 } as Wall);
    const geometryWalls = [wall("host", [0, 0], [2, 0]), wall("left-wall", [0, -1], [0, 0]), wall("right-wall", [2, 0], [2, -1])];
    const walls = geometryWalls.map(source => new Mesh(buildBuilderWallGeometry(source, { levelWalls: geometryWalls }), new MeshBasicMaterial({ color: "#888888", side: DoubleSide })));
    walls.forEach(mesh => mesh.updateMatrixWorld(true));
    const raycaster = new Raycaster(), roomPoint = new Vector3(1, 1, 1);
    for (const line of lines) {
      const points = (line.props as { points: number[][] }).points, target = new Vector3((points[0]![0] + points[1]![0]) / 2, 1, (points[0]![2] + points[1]![2]) / 2), direction = target.clone().sub(roomPoint), targetDistance = direction.length();
      direction.normalize(); raycaster.set(roomPoint, direction); raycaster.far = targetDistance;
      const opaqueHits = raycaster.intersectObjects(walls, false);
      expect(opaqueHits[0]?.distance ?? Infinity).toBeGreaterThanOrEqual(targetDistance - .001);
    }
    walls.forEach(wall => { wall.geometry.dispose(); (wall.material as MeshBasicMaterial).dispose(); });
  });

  it("keeps a floating reference-plane witness vertical and attaches its framed label to the plane", () => {
    const device = { id: "floating-point", deviceType: "sensor", sizeMm: [60, 60, 30], position: { position: [1, 2.7, 1] }, frame: { right: [1, 0, 0], up: [0, 0, 1], front: [0, -1, 0] }, mount: { kind: "reference-plane", levelId: "level", elevationMm: 2700 } } as never;
    const description = { vertical: { millimeters: 1400, kind: "reference-plane", witness: { objectId: "slab", objectKind: "slab", point: [1, 1.3, 1] } } } as never;
    const tree = DeviceDimensionGuides({ device, description, devices: [] });
    const guidesElement = elements(tree).find(element => (element.props as { name?: string }).name === "device-position-dimensions")!;
    const rendered = elements(PositionDimensionGuides(guidesElement.props as Parameters<typeof PositionDimensionGuides>[0]));
    const label = rendered.find(element => element.type === WorldSpaceCanvasLabel)!;
    const htmlLabels = rendered.filter(element => typeof element.type === "function" && element.type.name === "HtmlMock");
    const line = rendered.find(element => typeof element.type === "function" && element.type.name === "LineMock")!;
    expect(htmlLabels).toHaveLength(0);
    expect(label.props).toMatchObject({ framed: true, normal: [0, -1, 0], right: [1, 0, 0], up: [0, 0, 1] });
    expect((label.props as { position: number[] }).position[0]).toBe(1);
    expect((label.props as { position: number[] }).position[1]).toBeCloseTo(2.675);
    expect((label.props as { position: number[] }).position[2]).toBeCloseTo(1.09);
    expect((line.props as { points: number[][] }).points).toEqual([[1, 2.7, 1], [1, 1.3, 1]]);
  });

  it("uses the same shared corner anchor for a wall-mounted thermostat", () => {
    const faces = [
      { id: "host", start: [0, 0, 0] as [number, number, number], end: [2, 0, 0] as [number, number, number], halfThickness: .05, bottomY: 0, topY: 3 },
      { id: "left-wall", start: [0, 0, -1] as [number, number, number], end: [0, 0, 0] as [number, number, number], halfThickness: .05, bottomY: 0, topY: 3 },
    ];
    const thermostat = { id: "thermostat", sizeMm: [86, 86], position: { position: [1, 1, .05], attachment: { hostId: "host", hostKind: "wall", normal: [0, 0, 1], basis: { u: [1, 0, 0], v: [0, 1, 0] } } } } as never;
    const description = { planar: [{ key: "u-", direction: [-1, 0, 0], millimeters: 950, witness: { objectId: "left-wall", objectKind: "wall", point: [.05, 1, .05] } }] } as never;
    const tree = HvacThermostatDimensions({ thermostat, description, wallFrame: nearestWallDimensionFrame("host", [1, 1, .05], [0, 0, 1], faces)!, dimensionFaces: faces, overlay: { devices: [], hvac: { thermostats: [] } } as never });
    const rendered = elements(tree), dimensionProps = rendered.find(element => (element.props as { name?: string }).name === "hvac-thermostat-position-dimensions")!.props as Parameters<typeof PositionDimensionGuides>[0], referenceProps = rendered.find(element => (element.props as { name?: string }).name === "hvac-thermostat-wall-reference-dimensions")!.props as Parameters<typeof PositionDimensionGuides>[0];
    const referenceLine = elements(PositionDimensionGuides(referenceProps)).find(element => typeof element.type === "function" && element.type.name === "LineMock")!.props as { points: number[][]; lineWidth: number };
    expect(referenceLine.points).toEqual([[.05, 0, .0505], [.05, 3, .0505]]);
    expect(referenceLine.lineWidth).toBe(3.75);
    expect(dimensionProps.guides[0]!.displayEnd).toEqual([.05, 1, .0505]);
  });

  it("draws framed physical labels on a non-wall installation plane while preserving the vertical witness", () => {
    const tree = PositionDimensionGuides({ name: "plane-dimensions", stackedLabels: true, guides: [{ key: "vertical", start: [1, 2.7, 1], end: [1, .4, 1], label: "2300 mm", offset: [0, 0, 0], textBasis: surfaceDimensionTextBasis([0, 1, 0], [0, 0, 1], [1, 0, 0]), textPlanePoint: [1, 2.725, 1] }] });
    const rendered = elements(tree), labels = rendered.filter(element => element.type === WorldSpaceCanvasLabel), htmlLabels = rendered.filter(element => typeof element.type === "function" && element.type.name === "HtmlMock");
    expect(labels).toHaveLength(1);
    expect(htmlLabels).toHaveLength(0);
    expect(labels[0]!.props).toMatchObject({ framed: true, fontSizeMm: 34, canvasHeightMm: 48, text: "2300 mm", position: [1, 2.725, 1.09] });
    const dimension = rendered.find(element => typeof element.type === "function" && element.type.name === "LineMock")!;
    expect((dimension.props as { points: number[][] }).points).toEqual([[1, 2.7, 1], [1, .4, 1]]);
    expect(dimensionLabelStackOffset(0, 2)).toBeCloseTo(-.036);
  });
});
