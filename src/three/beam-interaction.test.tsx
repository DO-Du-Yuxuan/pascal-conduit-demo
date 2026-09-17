// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NodeData } from "../types";
import type { BeamNode } from "../domain/beams";
import { PascalScenePreview } from "./PascalScenePreview";
import type { ThreeDSceneInput } from "./scene-input";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
vi.mock("@react-three/drei", () => ({ Html: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, Line: () => <div /> }));
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(() => { act(() => roots.splice(0).forEach((root) => root.unmount())); document.body.innerHTML = ""; vi.restoreAllMocks(); });

const beam: BeamNode = { id: "beam", type: "beam", parentId: "level", name: "梁 1", start: [0, 1], end: [3, 1], width: .3, height: .5, ceilingIds: ["ceiling"], effectiveCeilingElevation: { meters: 2.7, basis: "derived-default-2700mm" } };
const scene: ThreeDSceneInput = { sceneKey: "beam-test", nodes: { level: { id: "level", type: "level", level: 0 }, ceiling: { id: "ceiling", type: "ceiling", parentId: "level", polygon: [[-1, -1], [5, -1], [5, 5], [-1, 5]] }, wall: { id: "wall", type: "wall", parentId: "level", start: [-1, 0], end: [5, 0], height: 2.7, thickness: .1 }, beam } as Record<string, NodeData>, rootNodeIds: ["level"], collections: {}, materials: {}, installedPlugins: [], diagnostics: [], bounds: { center: [0, 0, 0], span: 10 }, hasRoofData: false, itemCount: 0 };
const layers = { walls: true, floors: true, ceilings: true, beams: true, roofs: true, openings: true, furniture: true, zones: true };

const pointer = (type: string, x: number, z: number) => {
  const event = new Event(type, { bubbles: true });
  Object.assign(event, { point: { x, z }, pointerId: 1 });
  return event;
};

function Harness() {
  return <PascalScenePreview scene={scene} layers={layers} hiddenNodeIds={new Set()} levelMode="stacked" wallMode="up" selectedId="beam" onSelect={() => undefined} />;
}

describe("Beam 3D interaction", () => {
  it("keeps a selected Beam selectable while exposing dimensions, not drag targets", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container); roots.push(root);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    act(() => root.render(<Harness />));
    expect(container.querySelector('[data-beam-handle]')).toBeNull();
    expect(container.querySelector('[data-beam-planar-dimension="cross-axis"]')).not.toBeNull();
    const body = container.querySelector('[data-beam-body="beam"]')!;
    expect(body.getAttribute("aria-label")).toBe("Beam body");
    act(() => body.dispatchEvent(pointer("pointerdown", 1.5, 1)));
    act(() => body.dispatchEvent(pointer("pointerup", 1.6, 1.1)));
  });
});
