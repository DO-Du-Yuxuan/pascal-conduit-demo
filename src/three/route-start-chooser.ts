import type { BuilderSystemId } from "../builder-workbench";
import type { RoutingSystem } from "../domain/overlay";

/** Strong-current box holes are shared; the visible Builder category chooses the line system. */
export function strongPanelRouteSystem(category: BuilderSystemId | null | undefined): Extract<RoutingSystem, "receptacle" | "lighting"> {
  return category === "lighting" ? "lighting" : "receptacle";
}
