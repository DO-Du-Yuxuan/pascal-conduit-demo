// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DetailsPopoverGroup } from "./DetailsPopoverGroup";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("DetailsPopoverGroup", () => {
  let dispose = () => {};
  afterEach(() => { dispose(); document.body.replaceChildren(); });

  function renderGroup() {
    const host = document.createElement("div");
    const canvasClick = vi.fn();
    const canvasPointerDown = vi.fn((event: Event) => event.stopPropagation());
    const canvas = document.createElement("button");
    canvas.textContent = "canvas";
    canvas.addEventListener("click", canvasClick);
    canvas.addEventListener("pointerdown", canvasPointerDown);
    const root = createRoot(host);
    dispose = () => act(() => root.unmount());
    act(() => root.render(
      <DetailsPopoverGroup>
        <details className="camera"><summary>View</summary><div><label><input type="checkbox" /> Shadows</label></div></details>
        <details className="layers"><summary>Layers</summary><div><label><input type="checkbox" /> Walls</label></div></details>
      </DetailsPopoverGroup>,
    ));
    host.append(canvas);
    document.body.append(host);
    return { host, canvasClick, canvasPointerDown, canvas };
  }

  it("opens only the most recently activated details, including rapid summary clicks", () => {
    const { host } = renderGroup();
    const summaries = host.querySelectorAll("summary");
    act(() => summaries[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    const camera = host.querySelector(".camera") as HTMLDetailsElement;
    const layers = host.querySelector(".layers") as HTMLDetailsElement;
    expect(camera.open).toBe(true);
    act(() => summaries[1]!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(layers.open).toBe(true);
    expect(camera.open).toBe(false);
  });

  it("keeps the popover open when toggling an internal checkbox", () => {
    const { host } = renderGroup();
    const camera = host.querySelector(".camera") as HTMLDetailsElement;
    act(() => host.querySelector("summary")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    const checkbox = host.querySelector<HTMLInputElement>(".camera input")!;
    act(() => checkbox.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(camera.open).toBe(true);
    expect(checkbox.checked).toBe(true);
  });

  it("dismisses on outside pointer/focus without blocking the canvas event", () => {
    const { host, canvasClick, canvasPointerDown, canvas } = renderGroup();
    const camera = host.querySelector(".camera") as HTMLDetailsElement;
    act(() => host.querySelector("summary")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    const pointerEvent = new PointerEvent("pointerdown", { bubbles: true, cancelable: true });
    act(() => canvas.dispatchEvent(pointerEvent));
    expect(camera.open).toBe(false);
    expect(canvasPointerDown).toHaveBeenCalledOnce();
    expect(pointerEvent.defaultPrevented).toBe(false);
    act(() => canvas.click());
    expect(canvasClick).toHaveBeenCalledOnce();

    act(() => host.querySelector("summary")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    act(() => canvas.dispatchEvent(new FocusEvent("focusin", { bubbles: true })));
    expect(camera.open).toBe(false);
  });

  it("dismisses on Escape and returns focus to the active summary", () => {
    const { host } = renderGroup();
    const camera = host.querySelector(".camera") as HTMLDetailsElement;
    const summary = host.querySelector(".camera summary") as HTMLElement;
    act(() => summary.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => document.dispatchEvent(event));
    expect(camera.open).toBe(false);
    expect(document.activeElement).toBe(summary);
    expect(event.defaultPrevented).toBe(true);
  });
});
