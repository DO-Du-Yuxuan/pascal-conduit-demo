import type { NodeData } from "../types";
import { validateBeam, type BeamNode } from "./beams";

/** Existing supported members retain their geometry when a supporting Beam is
 * edited. A support cannot disappear or move away from them implicitly. */
export function supportedBeamDependents(nodes: Record<string, NodeData>, beamId: string): BeamNode[] {
  return Object.values(nodes).flatMap(node => {
    if (node.type !== "beam" || node.id === beamId || node.supports?.end?.objectId !== beamId) return [];
    const beam = validateBeam(node, nodes).beam;
    return beam ? [beam] : [];
  });
}

export function unsupportedDependentsAfterEdit(nodes: Record<string, NodeData>, edited: BeamNode): BeamNode[] {
  const next = { ...nodes, [edited.id]: edited };
  return supportedBeamDependents(nodes, edited.id).filter(beam => !validateBeam(beam, next).valid);
}
