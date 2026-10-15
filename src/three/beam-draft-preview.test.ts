import { describe, expect, it } from "vitest";
import { beamDraftPreview } from "./beam-draft-preview";

const topElevation = { meters: 2.5, basis: "wall-top" as const, sourceWallId: "wall-start", measurementBasis: "explicit" as const };
const draft = (overrides: Record<string, unknown> = {}) => ({
  levelId: "level",
  start: [1, 1] as [number, number],
  end: [4, 3] as [number, number],
  topElevation,
  width: .1,
  height: .5,
  orthogonal: false,
  ...overrides,
});

describe("Beam draft preview", () => {
  it("shows the full pointer draft at a free unsupported endpoint without inventing support", () => {
    const input = draft();
    const preview = beamDraftPreview(input);
    expect(preview).toMatchObject({ id: "beam-preview", type: "beam", parentId: "level", start: [1, 1], end: [4, 3], topElevation, ceilingIds: [], width: .1, height: .5 });
    expect(preview).not.toHaveProperty("supports");
    expect(input).toEqual(draft());
  });

  it("constrains the preview endpoint to the locked world axis", () => {
    expect(beamDraftPreview(draft({ orthogonal: true }))).toMatchObject({ start: [1, 1], end: [4, 1] });
  });

  it("returns null for a zero-length draft or invalid dimensions and coordinates", () => {
    expect(beamDraftPreview(draft({ end: [1, 1] }))).toBeNull();
    expect(beamDraftPreview(draft({ width: 0 }))).toBeNull();
    expect(beamDraftPreview(draft({ height: Number.NaN }))).toBeNull();
    expect(beamDraftPreview(draft({ start: [Number.NaN, 0] }))).toBeNull();
    expect(beamDraftPreview(draft({ end: [0, Number.POSITIVE_INFINITY] }))).toBeNull();
  });
});
