// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NodeData } from "../types";
import type { BeamEdit, BeamNode } from "../domain/beams";
import { PascalScenePreview } from "./PascalScenePreview";
import type { ThreeDSceneInput } from "./scene-input";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(() => { act(() => roots.splice(0).forEach((root) => root.unmount())); document.body.innerHTML = ""; vi.restoreAllMocks(); });

const beam: BeamNode = { id: "beam", type: "beam", parentId: "level", name: "梁 1", start: [0, 1], end: [3, 1], width: .3, height: .5, ceilingIds: ["ceiling"], effectiveCeilingElevation: { meters: 2.7, basis: "derived-default-2700mm" } };
const scene: ThreeDSceneInput = { sceneKey: "beam-test", nodes: { level: { id: "level", type: "level", level: 0 }, ceiling: { id: "ceiling", type: "ceiling", parentId: "level", polygon: [[-1, -1], [5, -1], [5, 5], [-1, 5]] }, beam } as Record<string, NodeData>, rootNodeIds: ["level"], collections: {}, materials: {}, installedPlugins: [], diagnostics: [], bounds: { center: [0, 0, 0], span: 10 }, hasRoofData: false, itemCount: 0 };
const layers = { walls: true, floors: true, ceilings: true, beams: true, roofs: true, openings: true, furniture: true, zones: true };

const pointer = (type: string, x: number, z: number) => {
  const event = new Event(type, { bubbles: true });
  Object.assign(event, { point: { x, z }, pointerId: 1 });
  return event;
};

function Harness({ onCommit }: { onCommit: (edit: BeamEdit) => void }) {
  const [preview, setPreview] = useState<BeamNode | null>(null);
  return <PascalScenePreview scene={scene} layers={layers} hiddenNodeIds={new Set()} levelMode="stacked" wallMode="up" selectedId="beam" beamPreview={preview} beamEditing onSelect={() => undefined} onBeamDrag={(_id, edit, commit) => {
    const candidate = { ...beam, ...edit } as BeamNode;
    setPreview(commit ? null : candidate);
    if (commit) onCommit(edit);
  }} />;
}

describe("Beam 3D interaction", () => {
  it("keeps endpoint and body drag targets interactive through a live preview, then commits once", () => {
    const container = document.createElement("div"), commits: BeamEdit[] = [];
    document.body.append(container);
    const root = createRoot(container); roots.push(root);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    act(() => root.render(<Harness onCommit={(edit) => commits.push(edit)} />));
    const capture = Element.prototype.setPointerCapture;
    Element.prototype.setPointerCapture = () => undefined;
    try {
      const start = container.querySelector('[data-beam-handle="start"]')!;
      expect(start.getAttribute("aria-label")).toBe("Beam start handle");
      act(() => start.dispatchEvent(pointer("pointerdown", 0, 1)));
      act(() => start.dispatchEvent(pointer("pointermove", .1026, 1)));
      act(() => start.dispatchEvent(pointer("pointerup", .1026, 1)));
      expect(commits).toEqual([{ start: [.1026, 1] }]);

      const body = container.querySelector('[data-beam-body="beam"]')!;
      expect(body.getAttribute("aria-label")).toBe("Beam body");
      act(() => body.dispatchEvent(pointer("pointerdown", 1.5, 1)));
      act(() => body.dispatchEvent(pointer("pointermove", 1.6, 1.1)));
      act(() => body.dispatchEvent(pointer("pointerup", 1.6, 1.1)));
      expect(commits[commits.length - 1]).toMatchObject({ start: [expect.closeTo(.1), 1.1], end: [3.1, 1.1] });
    } finally { Element.prototype.setPointerCapture = capture; }
  });
});
