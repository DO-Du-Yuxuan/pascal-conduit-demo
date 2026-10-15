// @ts-ignore Node types are not part of the browser app's compile environment.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { importProjectJson } from "../domain/project-import";
import { describeDevicePosition, editDevicePosition } from "../domain/device-positioning";
import { buildPhysicalPositioningSurfaces } from "../domain/physical-positioning-surfaces";
import { renderedWallFaceEndpoint } from "../geometry/walls/rendered-face-endpoint";
import { buildBuilderWallGeometry } from "../three/builder-wall-geometry";
import { nearestWallDimensionFrame, wallVerticalReferenceSegments, wallWitnessDisplayAnchor, type WallDimensionFace } from "./wall-dimension-placement";

const fixturePath = (globalThis as any).process?.env?.WALL_CORNER_PROJECT_FIXTURE as string | undefined;

describe("same-wall rendered corner reference", () => {
  it("places the vertical datum and dimension endpoint on the actual L-wall miter edge", () => {
    const levelWalls = [
      { id: "host", type: "wall", start: [-2, 1.5], end: [0, 1.5], thickness: 0.1, height: 2.5 },
      { id: "neighbor", type: "wall", start: [-2, -0.5], end: [-2, 1.5], thickness: 0.1, height: 2.5 },
    ] as any[];
    const face: WallDimensionFace = { id: "host", levelId: "level", start: [-2, 0, 1.5], end: [0, 0, 1.5], halfThickness: 0.05, bottomY: 0, topY: 2.5 };
    const faces: WallDimensionFace[] = [
      face,
      { id: "neighbor", levelId: "level", start: [-2, 0, -0.5], end: [-2, 0, 1.5], halfThickness: 0.05, bottomY: 0, topY: 2.5 },
    ];
    const mesh = buildBuilderWallGeometry(levelWalls[0], { levelWalls });
    const positions = mesh.getAttribute("position");
    const miter = Array.from({ length: positions.count }, (_, index) => [positions.getX(index), positions.getY(index), positions.getZ(index)] as [number, number, number])
      .find(([x, , z]) => Math.abs(x + 2.05) < 1e-6 && Math.abs(z - 1.55) < 1e-6)!;
    expect(miter).toBeDefined();
    const frame = nearestWallDimensionFrame("host", [-1.5, 1, 1.55], [0, 0, 1], faces)!;
    const witness: [number, number, number] = [-2, 1, 1.549];
    const anchor = wallWitnessDisplayAnchor(witness, frame, frame, faces);
    const segments = wallVerticalReferenceSegments(witness, frame, frame, faces);

    expect(anchor[0]).toBeCloseTo(miter[0], 6);
    expect(anchor[2]).toBeCloseTo(miter[2] + 0.0005, 6);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.start[0]).toBeCloseTo(anchor[0], 7);
    expect(segments[0]!.start[2]).toBeCloseTo(anchor[2], 7);
    expect(segments[0]!.end[0]).toBeCloseTo(anchor[0], 7);
    expect(segments[0]!.end[2]).toBeCloseTo(anchor[2], 7);
    mesh.dispose();
  });

  it("keeps a near-end opening witness on its opening edge and does not snap an ordinary side hit", () => {
    const levelWalls = [
      { id: "host", type: "wall", start: [-2, 1.5], end: [0, 1.5], thickness: 0.1, height: 2.5 },
      { id: "neighbor", type: "wall", start: [-2, -0.5], end: [-2, 1.5], thickness: 0.1, height: 2.5 },
    ] as any[];
    const hostFace: WallDimensionFace = {
      id: "host", levelId: "level", start: [-2, 0, 1.5], end: [0, 0, 1.5], halfThickness: 0.05,
      bottomY: 0, topY: 2.5,
      openings: [{ id: "opening-near-corner", start: 0.05, end: 0.15, bottomY: 0.3, topY: 2 }],
    };
    const neighborFace: WallDimensionFace = { id: "neighbor", levelId: "level", start: [-2, 0, -0.5], end: [-2, 0, 1.5], halfThickness: 0.05, bottomY: 0, topY: 2.5 };
    const faces = [hostFace, neighborFace];
    const frame = nearestWallDimensionFrame("host", [-1.9, 1, 1.55], [0, 0, 1], faces)!;
    const openingWitness: [number, number, number] = [-1.9, 1, 1.549];
    const openingAnchor = wallWitnessDisplayAnchor(openingWitness, frame, frame, faces, false);
    const openingSegments = wallVerticalReferenceSegments(openingWitness, frame, frame, faces, "opening-near-corner");

    expect(openingAnchor[0]).toBeCloseTo(-1.9, 6);
    expect(openingSegments).toHaveLength(2);
    expect(openingSegments.map(({ start, end }) => [start[1], end[1]])).toEqual([[0, 0.3], [2, 2.5]]);
    expect(openingSegments.every(({ start, end }) => Math.abs(start[0] + 1.9) < 1e-6 && Math.abs(end[0] + 1.9) < 1e-6)).toBe(true);

    // The neighboring wall's ordinary side is close to its endpoint, but is
    // not the cap/miter vertex and must remain on the side face.
    expect(renderedWallFaceEndpoint("host", [-1.99, 1.55], [0, 1], levelWalls)).toBeUndefined();
    expect(renderedWallFaceEndpoint("neighbor", [-1.95, 1.49], [1, 0], levelWalls)).toBeUndefined();
    expect(renderedWallFaceEndpoint("host", [-2, 1.55], [0, 1], levelWalls)).toEqual([-2.05, 1.55]);
    expect(renderedWallFaceEndpoint("host", [-2.05, 1.55], [0, 1], levelWalls)).toEqual([-2.05, 1.55]);
  });
});

describe.skipIf(!fixturePath)("actual project wall socket miter references", () => {
  it("resolves both imported socket left dimensions and display anchors to the rendered wall corner", () => {
    const raw = JSON.parse(readFileSync(fixturePath!, "utf8"));
    const { projectRaw, overlay } = importProjectJson(raw, "wall-corner-project.json", "0".repeat(64));
    const nodes = projectRaw.nodes as Record<string, any>;
    const levelId = "level_85a1fy6iyztkelev";
    const hostId = "wall_su5b2s3ai6ky0iq4";
    const neighbors = Object.values(nodes).filter((node: any) => node.type === "wall" && node.parentId === levelId) as any[];
    const wallFaces: WallDimensionFace[] = neighbors.map((wall) => ({
      id: wall.id,
      levelId,
      start: [wall.start[0], 0, wall.start[1]],
      end: [wall.end[0], 0, wall.end[1]],
      halfThickness: (wall.thickness ?? 0.1) / 2,
      bottomY: 0,
      topY: wall.height ?? 2.5,
    }));
    const context = {
      levelFloorY: { [levelId]: 0 },
      wallSpans: {},
      wallFaces: wallFaces.map((face) => ({ ...face, levelId, point: face.start, normal: [0, 0, 1] as [number, number, number] })),
      physicalSurfaces: buildPhysicalPositioningSurfaces(nodes),
    };
    const sockets = [
      "socket-b6b237d2-abd2-4bef-88aa-bd5602609150",
      "socket-dfdc2a48-6d15-45c8-bacc-7cb06c08cf00",
    ].map((id) => overlay.devices.find((device) => device.id === id)!);
    expect(sockets.every(Boolean)).toBe(true);

    const mitredWall = neighbors.find((wall) => wall.id === hostId)!;
    const actualHostGeometry = buildBuilderWallGeometry(mitredWall, { levelWalls: neighbors, levelY: 0 });
    const positions = actualHostGeometry.getAttribute("position");
    const vertices = Array.from({ length: positions.count }, (_, index) => [
      positions.getX(index), positions.getY(index), positions.getZ(index),
    ] as [number, number, number]);
    const renderedInteriorMiter = vertices.find(([x, , z]) => Math.abs(x + 2.05) < 1e-5 && Math.abs(z - 1.55) < 1e-5);
    expect(renderedInteriorMiter).toBeDefined();

    const observations = sockets.map((device) => {
      const reference = describeDevicePosition(overlay, device.id, context).planar?.find((item) => item.key === "u-")!;
      const hostFrame = nearestWallDimensionFrame(hostId, device.position.position, device.position.attachment!.normal, wallFaces)!;
      const targetFrame = nearestWallDimensionFrame(reference.witness!.objectId, reference.witness!.point, [1, 0, 0], wallFaces)!;
      const anchor = wallWitnessDisplayAnchor(reference.witness!.point, targetFrame, hostFrame, wallFaces);
      const verticalSegments = wallVerticalReferenceSegments(reference.witness!.point, targetFrame, hostFrame, wallFaces);
      return { device, reference, anchor, verticalSegments };
    });

    // Keep this feedback loop sharp: both labels are centre-based and point at
    // the actual visible miter vertex used by the builder wall mesh.
    expect(observations.map(({ reference }) => reference.millimeters)).toEqual([502, 1639]);
    observations.forEach(({ anchor, verticalSegments }) => {
      expect(anchor[0]).toBeCloseTo(renderedInteriorMiter![0], 5);
      expect(anchor[2]).toBeCloseTo(renderedInteriorMiter![2] + 0.0005, 5);
      expect(verticalSegments.length).toBe(1);
      expect(verticalSegments[0]!.start[0]).toBeCloseTo(anchor[0], 7);
      expect(verticalSegments[0]!.start[2]).toBeCloseTo(anchor[2], 7);
      expect(verticalSegments[0]!.end[0]).toBeCloseTo(anchor[0], 7);
      expect(verticalSegments[0]!.end[2]).toBeCloseTo(anchor[2], 7);
    });
    for (const { device } of observations) {
      const originalPosition = [...device.position.position];
      const edited = editDevicePosition(overlay, { deviceIds: [device.id], planarClearanceMm: { "u-": 600 } }, context, "commit");
      expect(edited.status).toBe("committed");
      expect(describeDevicePosition(edited.overlay, device.id, context).planar?.find((item) => item.key === "u-")?.millimeters).toBe(600);
      expect(device.position.position).toEqual(originalPosition);
    }
    actualHostGeometry.dispose();
  });
});
