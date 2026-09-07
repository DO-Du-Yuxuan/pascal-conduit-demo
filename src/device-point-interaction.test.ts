// @ts-nocheck -- Vitest runs this Node-only source contract outside the browser bundle.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workspace = readFileSync(new URL("./three/ThreeDWorkspace.tsx", import.meta.url), "utf8");
const scene = readFileSync(new URL("./components/ConduitScene.tsx", import.meta.url), "utf8");

describe("device point interaction wiring", () => {
  it("renders every Ctrl/Command-selected device with selected styling", () => {
    expect(workspace).toContain("displaySelected: selectedDeviceIds.includes(device.id)");
    expect(scene).toContain("displaySelected");
  });

  it("does not short-circuit a bulk vertical edit against only the active device", () => {
    expect(workspace).not.toContain("change.bottomHeightMm === positionDescription.vertical?.millimeters");
  });

  it("removes the construction and chase controls from the editor UI", () => {
    expect(workspace).not.toContain("<b>施工与槽孔</b>");
  });

  it("shows a visible label for active conduit snap and alignment", () => {
    expect(scene).toContain("conduit-snap-label");
    expect(scene).toContain("辅助对齐");
  });

  it("clears point selection from empty space or Escape", () => {
    expect(workspace).toContain("onEmptyClick={() => selectWhileBrowsing(null)}");
    expect(workspace).toContain('if (tool === "select") { selectWhileBrowsing(null); return; }');
  });

  it("finishes an orthogonal route at the target port while keeping an unreachable axis lock constrained", () => {
    expect(workspace).toContain('if (worldAxis && targetResolution.kind === "alignment")');
    expect(workspace).toContain('targetResolution.kind === "alignment" && targetResolution.point ? [targetResolution.point, target] : [target]');
    expect(workspace).toContain('setStatus("目标端口不在当前锁定轴上；已确认辅助对齐点，请切换轴后继续。")');
    expect(workspace).not.toContain("confirmTargetAlignment(endPort.position");
  });

  it("uses the physical click position to choose the target device port", () => {
    expect(workspace).toContain("targetPoint?: [number, number, number]");
    expect(scene).toContain("onStartDeviceRoute(device, undefined, [event.point.x, event.point.y, event.point.z])");
  });

  it("wires L, D, and Delete shortcuts without interfering with text entry", () => {
    expect(workspace).toContain('event.key.toLowerCase() === "l") { chooseTool("draw");');
    expect(workspace).toContain('event.key.toLowerCase() === "d") { chooseTool("point");');
    expect(workspace).toContain('if ((event.key === "Delete" || event.key === "Backspace") && tool === "select") {');
    expect(workspace).toContain("deleteSelectedObjects();");
  });
});
