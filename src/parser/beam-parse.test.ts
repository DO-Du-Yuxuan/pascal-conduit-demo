import { describe, expect, it } from "vitest";
import { parseProject } from "./parse";

describe("Beam parse diagnostics", () => {
  it("preserves an invalid Beam record while reporting why it is excluded from interaction", () => {
    const raw = { nodes: { level: { id: "level", type: "level" }, beam: { id: "beam", type: "beam", parentId: "level", name: "坏梁", start: [0, 0], end: [0, 0], width: 0, height: .5, ceilingIds: [], effectiveCeilingElevation: { meters: 2.7, basis: "derived-default-2700mm" }, extension: { preserve: true } } } };
    const parsed = parseProject(raw);
    expect(parsed.nodes.beam).toMatchObject({ extension: { preserve: true } });
    expect(parsed.diagnostics.filter((diagnostic) => diagnostic.nodeId === "beam").map((diagnostic) => diagnostic.code)).toContain("invalid_beam");
  });
});
