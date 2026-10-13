// @ts-ignore Node types are not a production dependency of this browser app.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeUnifiedProject, encodeUnifiedProject } from "../domain/unified-project";
import { resolveEffectiveBuildingParameters } from "../geometry/effective-building";
import { buildThreeDSceneInput } from "../three/scene-input";
import { parseProject } from "./parse";

const fixturePath = (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }).process?.env?.CONDUIT_PROJECT_FIXTURE_PATH;

describe("external Project 4.0 verification", () => {
  it.skipIf(!fixturePath)("reads the chosen file without rewriting source building, spatial fields, or connection IDs", () => {
    const raw = JSON.parse(readFileSync(fixturePath!, "utf8"));
    const before = structuredClone(raw);
    const loaded = decodeUnifiedProject(raw, "verification.json", "verification");
    const parsed = parseProject(loaded.projectRaw);
    expect(parsed.diagnostics.filter(item => item.severity === "error")).toEqual([]);
    const effective = resolveEffectiveBuildingParameters(parsed.nodes);
    const scene = buildThreeDSceneInput(parsed);
    expect(scene.rootNodeIds.length).toBeGreaterThan(0);
    expect(scene.bounds.span).toBeGreaterThan(0);
    for (const node of Object.values(parsed.nodes)) {
      if (node.type === "door" || node.type === "window") {
        if (typeof node.width === "number") expect(effective[node.id]?.width?.value).toBe(node.width);
        if (typeof node.height === "number") expect(effective[node.id]?.height?.value).toBe(node.height);
      }
    }
    const saved = encodeUnifiedProject(loaded.projectRaw, loaded.overlay);
    expect(Object.keys(saved.nodes).sort()).toEqual(Object.keys(raw.nodes).sort());
    for (const id of Object.keys(loaded.projectRaw.nodes)) expect(saved.nodes[id], `building source ${id}`).toEqual(raw.nodes[id]);
    const fields = ["position", "start", "end", "width", "height", "depth", "sizeMm", "orientation", "ports", "segmentIds", "segmentId", "circuitId", "startPortId", "endPortId", "ceilingIds", "effectiveCeilingElevation"];
    for (const [id, value] of Object.entries(raw.nodes)) {
      const original = value as Record<string, unknown>;
      for (const field of fields) if (field in original) expect(saved.nodes[id]?.[field], `${id}.${field}`).toEqual(original[field]);
    }
    expect(raw).toEqual(before);
  });
});
