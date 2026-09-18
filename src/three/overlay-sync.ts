import type { ConduitOverlayDocument } from '../domain/overlay';

const stableOverlay = (overlay: ConduitOverlayDocument) => JSON.stringify(overlay);

export function overlayForProject(overlay: ConduitOverlayDocument | null, sourceSha: string, projectId: string | null): ConduitOverlayDocument | null {
  return projectId ? overlay?.source.projectId === projectId ? overlay : null : overlay?.source.sha256 === sourceSha ? overlay : null;
}

/**
 * A mounted 3D workspace keeps local interaction state, while 2D commits can
 * update the same sidecar. Adopt a matching newer shared sidecar before the
 * next 3D edit so the edit cannot write an old whole-document snapshot back.
 */
export function synchronizedOverlay(current: ConduitOverlayDocument, shared: ConduitOverlayDocument | null, sourceSha: string, projectId: string | null): ConduitOverlayDocument | null {
  const matching = overlayForProject(shared, sourceSha, projectId);
  return matching && stableOverlay(current) !== stableOverlay(matching) ? matching : null;
}
