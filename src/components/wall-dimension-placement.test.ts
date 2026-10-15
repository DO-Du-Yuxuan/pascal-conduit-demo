import { describe, expect, it } from "vitest";
import { adjacentWallCornerAnchor, nearestWallDimensionFrame, projectDimensionPointToWall, surfaceDimensionTextBasis, wallDimensionTextBasis, wallReferenceMarkLabel, type WallDimensionFace } from "./wall-dimension-placement";

describe("wall-mounted positioning marks", () => {
  const faces: WallDimensionFace[] = [
    { id: "wall", start: [0, 0, 0], end: [1, 0, 0], halfThickness: .05 },
    { id: "wall", start: [1, 0, 0], end: [2, 0, 0], halfThickness: .05 },
    { id: "other", start: [0, 0, .2], end: [2, 0, .2], halfThickness: .05 },
  ];

  it("uses the nearest matching host span and projects display points to its actual outer face", () => {
    const frame = nearestWallDimensionFrame("wall", [1.7, 1.2, .105], [0, 0, 1], faces)!;
    expect(frame.face.start).toEqual([1, 0, 0]);
    expect(frame.normal).toEqual([0, 0, 1]);
    const start = [1.4, 1.2, 0] as [number, number, number], witness = [2.4, 1.2, .105] as [number, number, number];
    const measuredLengthBefore = Math.hypot(witness[0] - start[0], witness[1] - start[1], witness[2] - start[2]);
    const displayStart = projectDimensionPointToWall(start, frame), displayWitness = projectDimensionPointToWall(witness, frame);
    expect(displayStart).toEqual([1.4, 1.2, .056]);
    expect(displayWitness).toEqual([2, 1.2, .056]);
    expect(Math.hypot(witness[0] - start[0], witness[1] - start[1], witness[2] - start[2])).toBe(measuredLengthBefore);
    expect(start).toEqual([1.4, 1.2, 0]);
    expect(witness).toEqual([2.4, 1.2, .105]);
  });

  it("keeps text upright and unmirrored on either wall side", () => {
    const positive = nearestWallDimensionFrame("wall", [1.2, 1, .05], [0, 0, 1], faces)!;
    const negative = nearestWallDimensionFrame("wall", [1.2, 1, -.05], [0, 0, -1], faces)!;
    const positiveBasis = wallDimensionTextBasis(positive), negativeBasis = wallDimensionTextBasis(negative);
    expect(positiveBasis.right).toEqual([1, 0, 0]);
    expect(positiveBasis.normal).toEqual([0, 0, 1]);
    expect(negativeBasis.right).toEqual([-1, 0, 0]);
    expect(negativeBasis.normal).toEqual([0, 0, -1]);
    expect(negativeBasis.up).toEqual(positiveBasis.up);
  });

  it("creates right-handed text bases for floor, ceiling, wall, and tilted installation faces", () => {
    const cases = [
      { normal: [0, 1, 0] as [number, number, number], up: [0, 0, 1] as [number, number, number], expectedRight: [-1, 0, 0] },
      { normal: [0, -1, 0] as [number, number, number], up: [0, 0, 1] as [number, number, number], expectedRight: [1, 0, 0] },
      { normal: [0, 0, 1] as [number, number, number], up: [0, 1, 0] as [number, number, number], expectedRight: [1, 0, 0] },
      { normal: [0, 1, 1] as [number, number, number], up: [0, 1, 0] as [number, number, number], expectedRight: undefined },
    ];
    for (const { normal, up, expectedRight } of cases) {
      const basis = surfaceDimensionTextBasis(normal, up, [1, 0, 0]);
      const cross = [basis.right[1] * basis.up[2] - basis.right[2] * basis.up[1], basis.right[2] * basis.up[0] - basis.right[0] * basis.up[2], basis.right[0] * basis.up[1] - basis.right[1] * basis.up[0]];
      cross.forEach((value, index) => expect(value).toBeCloseTo(basis.normal[index]!));
      expect(basis.right.reduce((sum, value, index) => sum + value * basis.normal[index]!, 0)).toBeCloseTo(0);
      expect(basis.up.reduce((sum, value, index) => sum + value * basis.normal[index]!, 0)).toBeCloseTo(0);
      if (expectedRight) expect(basis.right).toEqual(expectedRight);
    }
  });

  it("uses one short numeric mark and preserves named peer targets", () => {
    expect(wallReferenceMarkLabel("左", 1197)).toBe("左基准 1197 mm");
    expect(wallReferenceMarkLabel("右", 1118, { name: "面板 A", envelope: true })).toBe("面板 A 外壳边 1118 mm");
    expect(wallReferenceMarkLabel("左", 890, { name: "温控器 B", envelope: false })).toBe("温控器 B 中心 890 mm");
  });

  it("snaps adjacent wall witnesses only when the physical witness is near their shared face intersection", () => {
    const host = nearestWallDimensionFrame("host", [1, 1, .05], [0, 0, 1], [{ id: "host", start: [0, 0, 0], end: [2, 0, 0], halfThickness: .05 }])!;
    const neighbor = nearestWallDimensionFrame("neighbor", [.05, 1, .05], [1, 0, 0], [{ id: "neighbor", start: [0, 0, -1], end: [0, 0, 0], halfThickness: .05 }])!;
    expect(adjacentWallCornerAnchor(neighbor, host, [.05, 1, .05])).toEqual([.05, 1, .0505]);
    expect(adjacentWallCornerAnchor(neighbor, host, [1, 1, .05])).toBeUndefined();
  });
});
