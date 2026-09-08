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

  it("confirms device alignment without connecting until the route truly reaches the port", () => {
    expect(workspace).toContain('if (targetResolution.kind === "confirm-alignment")');
    expect(workspace).toContain('setStatus("已确认设备端口辅助对齐点；管道尚未连接设备，请继续逐点绘制。")');
    expect(workspace).toContain('if (targetResolution.kind !== "connect") return null;');
    expect(workspace).not.toContain('[targetResolution.point, target]');
  });

  it("uses the physical click position to choose the target device port", () => {
    expect(workspace).toContain("targetPoint?: [number, number, number]");
    expect(scene).toContain("onStartDeviceRoute(device, undefined, [event.point.x, event.point.y, event.point.z])");
  });

  it("reveals open destination ports and replaces the large cursor ball with a target reticle", () => {
    expect(scene).toContain("deviceTargetPorts(device, activeRouteSystem)");
    expect(scene).toContain("target:device-port:");
    expect(scene).toContain('name="target-reticle"');
    expect(scene).toContain("!targetingDevice &&");
    expect(scene).toContain("连接后结束");
    expect(workspace).toContain("activeTargetPortId");
  });

  it("wires L, D, and Delete shortcuts without interfering with text entry", () => {
    expect(workspace).toContain('event.key.toLowerCase() === "l") { chooseTool("draw");');
    expect(workspace).toContain('event.key.toLowerCase() === "d") { chooseTool("point");');
    expect(workspace).toContain('if ((event.key === "Delete" || event.key === "Backspace") && tool === "select") {');
    expect(workspace).toContain("deleteSelectedObjects();");
  });

  it("deletes the current selection when the Delete toolbar button is clicked", () => {
    expect(workspace).toContain('item === "delete" && (selectedId || selectedDeviceIds.length) ? deleteSelectedObjects() : chooseTool(item)');
  });
});
