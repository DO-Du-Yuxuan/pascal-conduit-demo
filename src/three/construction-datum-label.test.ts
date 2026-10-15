import { describe, expect, it } from "vitest";
import { constructionDatumLabelFrame } from "./construction-datum-label";

describe("construction datum wall label frame", () => {
  it("faces outward on both wall sides without mirroring glyphs", () => {
    const points = [[0, 2, 0], [2, 2, 0]] as const, position = [1, 2, 0] as const;
    const positive = constructionDatumLabelFrame(points, 1, position)!;
    const negative = constructionDatumLabelFrame(points, -1, position)!;
    expect(positive.right).toEqual([1, 0, 0]);
    expect(positive.normal).toEqual([0, 0, 1]);
    expect(negative.right).toEqual([-1, 0, 0]);
    expect(negative.normal).toEqual([0, 0, -1]);
    expect(negative.up).toEqual(positive.up);
  });

  it("uses the local tangent nearest the label on a curved wall", () => {
    const frame = constructionDatumLabelFrame([[0, 1, 0], [1, 1, 0], [1, 1, 1]], 1, [1, 1, 0.5])!;
    expect(frame.right).toEqual([0, 0, 1]);
    expect(frame.normal).toEqual([-1, 0, 0]);
  });

  it("returns no frame for a line without a horizontal segment", () => {
    expect(constructionDatumLabelFrame([[0, 1, 0]], 1, [0, 1, 0])).toBeNull();
  });
});
