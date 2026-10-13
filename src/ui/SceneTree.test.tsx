// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SceneTree } from "./SceneTree";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("read-only scene browser", () => {
  const nodes = Object.freeze({
    building: Object.freeze({ id: "building", type: "building", name: "建筑" }),
    level: Object.freeze({ id: "level", type: "level", name: "首层", parentId: "building" }),
    wall: Object.freeze({ id: "wall", type: "wall", name: "北墙", parentId: "level", futureField: "preserved" }),
  });
  let dispose = () => {};
  afterEach(() => { dispose(); document.body.replaceChildren(); });

  it("selects and hides by stable ID without editing imported nodes", async () => {
    const before = JSON.stringify(nodes), onSelect = vi.fn(), onHide = vi.fn();
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container); dispose = () => { act(() => root.unmount()); };
    await act(async () => root.render(<SceneTree nodes={nodes} hiddenNodeIds={new Set()} selectedId="wall" onSelect={onSelect} onHide={onHide} onRestore={() => {}} />));
    const selection = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.title === "wall · wall")!;
    await act(async () => selection.click());
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="隐藏 北墙"]')!.click());
    expect(onSelect).toHaveBeenCalledWith("wall"); expect(onHide).toHaveBeenCalledWith("wall");
    expect(JSON.stringify(nodes)).toBe(before);
    expect(container.querySelector('[aria-selected="true"]')?.textContent).toContain("北墙");
  });

  it("collapses a subtree and retains a restore action for session-hidden objects", async () => {
    const onRestore = vi.fn(), onRestoreNode = vi.fn(), container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container); dispose = () => { act(() => root.unmount()); };
    await act(async () => root.render(<SceneTree nodes={nodes} hiddenNodeIds={new Set(["wall"])} selectedId={null} onSelect={() => {}} onHide={() => {}} onRestore={onRestore} onRestoreNode={onRestoreNode} />));
    const visibility = container.querySelector<HTMLButtonElement>('[aria-label="显示 北墙"]')!;
    expect(visibility.disabled).toBe(false);
    await act(async () => visibility.click());
    expect(onRestoreNode).toHaveBeenCalledWith("wall");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="收起 首层"]')!.click());
    expect(container.textContent).not.toContain("北墙");
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.includes("恢复隐藏对象"))!.click());
    expect(onRestore).toHaveBeenCalledOnce();
  });

  it("keeps source-hidden nodes read-only and routes layer-hidden eyes to layer recovery", async () => {
    const withSourceHidden = {
      ...nodes,
      layerOnly: { id: "layerOnly", type: "wall", name: "图层墙", parentId: "level" },
      sourceHidden: { id: "sourceHidden", type: "wall", name: "不可见源墙", visible: false },
    };
    const onEnableLayerForNode = vi.fn(), onRestoreNode = vi.fn(), container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container); dispose = () => { act(() => root.unmount()); };
    await act(async () => root.render(<SceneTree nodes={withSourceHidden} hiddenNodeIds={new Set(["wall"])} layerHiddenNodeIds={new Set(["wall", "layerOnly"])} selectedId={null} onSelect={() => {}} onHide={() => {}} onRestore={() => {}} onRestoreNode={onRestoreNode} onEnableLayerForNode={onEnableLayerForNode} />));
    const layerHidden = container.querySelector<HTMLButtonElement>('[aria-label="显示 北墙"]')!;
    expect(layerHidden.querySelector("svg path")?.getAttribute("d")).toContain("18 18");
    const sourceHidden = container.querySelector<HTMLButtonElement>('[aria-label="源数据隐藏 不可见源墙"]')!;
    expect(layerHidden.disabled).toBe(false);
    expect(sourceHidden.disabled).toBe(true);
    await act(async () => layerHidden.click());
    expect(onEnableLayerForNode).toHaveBeenCalledWith("wall");
    expect(onRestoreNode).toHaveBeenCalledWith("wall");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="显示 图层墙"]')!.click());
    expect(onEnableLayerForNode).toHaveBeenCalledWith("layerOnly");
  });
});
