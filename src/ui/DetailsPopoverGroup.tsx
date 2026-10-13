import React, { useEffect, useRef } from "react";

export type DetailsPopoverGroupProps = {
  children: React.ReactNode;
  className?: string;
};

/**
 * Keeps native details popovers mutually exclusive and dismissible while
 * preserving native summary, checkbox, and keyboard behavior. Pointer events
 * are observed on document without preventing or stopping canvas interaction.
 */
export function DetailsPopoverGroup({ children, className = "three-d-view-controls" }: DetailsPopoverGroupProps) {
  const groupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const details = () => Array.from(group.querySelectorAll<HTMLDetailsElement>("details"));
    const closeOpenDetails = () => {
      for (const detail of details()) detail.open = false;
    };
    const closePeers = (active: HTMLDetailsElement) => {
      for (const detail of details()) if (detail !== active) detail.open = false;
    };

    // The click capture runs before <summary>'s native default action. Closing
    // peers here avoids asynchronous `toggle` events racing rapid summary clicks.
    const onClickCapture = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const summary = target.closest("summary");
      const active = summary?.parentElement;
      if (active instanceof HTMLDetailsElement && !active.open && group.contains(active)) closePeers(active);
    };
    const onToggleCapture = (event: Event) => {
      const active = event.target;
      if (active instanceof HTMLDetailsElement && active.open && group.contains(active)) closePeers(active);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !group.contains(event.target)) closeOpenDetails();
    };
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && !group.contains(event.target)) closeOpenDetails();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const open = details().find(detail => detail.open);
      if (!open) return;
      const summary = open.querySelector<HTMLElement>("summary");
      closeOpenDetails();
      summary?.focus();
      event.preventDefault();
      event.stopPropagation();
    };

    group.addEventListener("click", onClickCapture, true);
    group.addEventListener("toggle", onToggleCapture, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      group.removeEventListener("click", onClickCapture, true);
      group.removeEventListener("toggle", onToggleCapture, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return <div ref={groupRef} className={className}>{children}</div>;
}
